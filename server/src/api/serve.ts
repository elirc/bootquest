import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PackManifest } from '@bootquest/shared';
import type { UnitContentEntry } from '@bootquest/shared/api';
import { openDb, resolveDbPath, type Db } from '../db/database.ts';
import type { Clock } from '../engines/clock.ts';
import { ALLOW_UNSTAMPED_ENV, loadPackIntoDb, packContentEntries, PackLoadError, readPack, type LoadStats } from '../store/packs.ts';
import { createApp } from './app.ts';
import { combineContentStores, fileContentEntries } from './content-store.ts';
import { createDrillCsRunner, resolveCsScratchDir, type DrillCsRunner } from './runner-csharp.ts';
import { defaultRunners, type RunnerRegistry } from './runners.ts';
import { createNodeTestFileRunner } from './runner-node-test-file.ts';
import { createSyncService, resolveSyncPaths, type SyncService } from '../sync/service.ts';

/**
 * Real entrypoint: `node --import tsx server/src/api/serve.ts`
 *   BOOTQUEST_DB            (required) the one DB file — there is no default
 *   BOOTQUEST_PORT          (optional) default 4178
 *   BOOTQUEST_UNIT_CONTENT  (optional) JSON {unitKey: UnitContentEntry} from content/
 *   BOOTQUEST_PACKS         (optional) comma-separated pack dirs (each with manifest.json)
 *                           loaded at startup; when serve.ts is run directly and this is
 *                           unset, every pack under <repo>/content/packs is loaded.
 *                           Set it to '' to load none.
 *   BOOTQUEST_PACK_COURSES  (optional) comma-separated course ids to load from the packs;
 *                           an id no pack provides REFUSES TO START (lists the valid ids)
 *   BOOTQUEST_PACKS_ALLOW_UNSTAMPED  tests/smoke ONLY ('1'): skip the import-gate stamp
 *                           check. Never set by this entrypoint.
 *   BOOTQUEST_CS_SCRATCH    (optional) app-data dir of the C# runner's warm scratch
 *                           projects; default <dir of BOOTQUEST_DB>/bootquest-scratch.
 *                           drill-cs submissions route there (W3a).
 *   BOOTQUEST_CURRICULUM / BOOTQUEST_CHECK_SPECS / BOOTQUEST_GITHUB_CACHE / BOOTQUEST_OFFLINE
 *                           W4 GitHub sync (see sync/service.ts): POST /api/sync, GET
 *                           /api/refs/:id/content, and node-test-file grading from the
 *                           per-SHA tarball cache.
 * A pack without a matching validation stamp (seed:validate full run), or whose
 * loaded count differs from its built count, REFUSES TO START.
 */
export const DEFAULT_PORT = 4178;
export const DEFAULT_HOST = '127.0.0.1';

/** The ONE sanctioned wall-clock read: the real server's injected clock. */
export const systemClock: Clock = () => new Date();

export class PortBusyError extends Error {
  readonly port: number;
  constructor(port: number, host: string) {
    super(
      `BootQuest cannot start: port ${port} on ${host} is already in use. ` +
        'Stop the other process (is another BootQuest server running?) or set BOOTQUEST_PORT to a free port.',
    );
    this.name = 'PortBusyError';
    this.port = port;
  }
}

export class PortConfigError extends Error {
  constructor(raw: string) {
    super(`BOOTQUEST_PORT must be an integer 1-65535, got "${raw}"`);
    this.name = 'PortConfigError';
  }
}

export function resolvePort(env: Record<string, string | undefined>): number {
  const raw = env.BOOTQUEST_PORT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  if (!/^\d{1,5}$/.test(raw.trim())) throw new PortConfigError(raw);
  const port = Number(raw.trim());
  if (port < 1 || port > 65535) throw new PortConfigError(raw);
  return port;
}

/** Busy-port pre-check: briefly bind the port; EADDRINUSE becomes a clear PortBusyError. */
export function assertPortFree(port: number, host: string = DEFAULT_HOST): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const probe = createServer();
    probe.once('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'EADDRINUSE' || err.code === 'EACCES' ? new PortBusyError(port, host) : err);
    });
    probe.once('listening', () => probe.close(() => resolvePromise()));
    probe.listen({ port, host, exclusive: true });
  });
}

export interface StartOptions {
  env?: Record<string, string | undefined>;
  clock?: Clock;
  host?: string;
  runners?: RunnerRegistry;
  /** W4 sync service (default: built from env via resolveSyncPaths) */
  sync?: SyncService;
}

export interface RunningServer {
  server: Server;
  db: Db;
  port: number;
  host: string;
  close(): Promise<void>;
  /** one entry per loaded pack (loaded === built already asserted) */
  packs: LoadStats[];
  /** the C# runner's app-data dir (null when the caller injected its own registry) */
  csharpScratch: string | null;
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Course ids a pack's manifest declares (unreadable manifest -> none; readPack reports it). */
function packCourseIds(dir: string): string[] {
  try {
    return PackManifest.parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))).courses.map((c) => c.id);
  } catch {
    return [];
  }
}

/** Every content/packs/<source>/ directory with a manifest (default for the real entrypoint). */
export function defaultPackDirs(root: string = fileURLToPath(new URL('../../../content/packs/', import.meta.url))): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'manifest.json')))
    .map((d) => join(root, d.name))
    .sort();
}

export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const env = opts.env ?? process.env;
  const host = opts.host ?? DEFAULT_HOST;
  const dbPath = resolveDbPath({ env }); // throws DbPathError when BOOTQUEST_DB is unset
  const port = resolvePort(env);
  await assertPortFree(port, host); // before touching the DB

  const db = openDb({ path: dbPath, env: {} });
  let csharp: DrillCsRunner | null = null;
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    const mode = db.get<{ journal_mode: string }>('PRAGMA journal_mode')?.journal_mode;
    if (mode !== 'wal') throw new Error(`expected journal_mode=wal on ${dbPath}, got ${String(mode)}`);
    const clock = opts.clock ?? systemClock;
    const sources: Map<string, UnitContentEntry>[] = [];
    if (env.BOOTQUEST_UNIT_CONTENT) sources.push(fileContentEntries(resolve(env.BOOTQUEST_UNIT_CONTENT)));
    const packStats: LoadStats[] = [];
    const courses = splitList(env.BOOTQUEST_PACK_COURSES);
    const packDirs = splitList(env.BOOTQUEST_PACKS).map((d) => resolve(d));
    // F7: a requested course id that no pack provides is a startup refusal, never a silent no-op
    if (courses.length) {
      const known = new Set(packDirs.flatMap((d) => packCourseIds(d)));
      const unknown = courses.filter((c) => !known.has(c));
      if (unknown.length) {
        throw new PackLoadError(
          `BOOTQUEST_PACK_COURSES names course(s) no loaded pack provides: ${unknown.join(', ')}. ` +
            `Valid ids: ${[...known].sort().join(', ') || '(none: BOOTQUEST_PACKS loads no pack)'}`,
        );
      }
    }
    // tests / smoke only (see ALLOW_UNSTAMPED_ENV); the real entrypoint never sets it
    const allowUnstamped = env[ALLOW_UNSTAMPED_ENV] === '1';
    if (allowUnstamped && packDirs.length) {
      console.warn(`[bootquest] ${ALLOW_UNSTAMPED_ENV}=1: loading pack(s) WITHOUT checking the import-gate stamp (tests/smoke only)`);
    }
    for (const dir of packDirs) {
      const pack = readPack(dir, { allowUnstamped, ...(courses.length ? { courses: courses.filter((c) => packCourseIds(dir).includes(c)) } : {}) });
      packStats.push(loadPackIntoDb(db, pack, clock)); // throws PackLoadError on loaded !== built
      sources.push(packContentEntries(pack));
    }
    const content = combineContentStores(sources);
    // drill-cs -> the warm C# runner (lazy: no dotnet process until the first C# grade)
    csharp = opts.runners ? null : createDrillCsRunner({ appDataDir: resolveCsScratchDir(env, dbPath) });
    const sync = opts.sync ?? createSyncService(resolveSyncPaths(env));
    const runners: RunnerRegistry =
      opts.runners ?? defaultRunners({ ...(csharp ? { drillCs: csharp.runner } : {}), nodeTestFile: createNodeTestFileRunner(sync.cache) });
    const app = createApp({ db, clock, content, runners, sync });

    const server = await new Promise<Server>((ok, fail) => {
      const s = app.listen(port, host);
      s.once('listening', () => ok(s));
      s.once('error', (err: NodeJS.ErrnoException) => fail(err.code === 'EADDRINUSE' ? new PortBusyError(port, host) : err));
    });

    let closing: Promise<void> | null = null;
    const close = (): Promise<void> => {
      closing ??= new Promise<void>((done) => {
        server.close(() => {
          db.close();
          // stop the compiler server (named pipe) + any live dotnet child we started
          void (csharp ? csharp.shutdown() : Promise.resolve()).finally(done);
        });
        server.closeAllConnections();
      });
      return closing;
    };
    return { server, db, port, host, close, packs: packStats, csharpScratch: csharp?.appDataDir ?? null };
  } catch (err) {
    db.close();
    throw err;
  }
}

/** Graceful shutdown on SIGINT/SIGTERM: stop accepting, close the DB, then exit 0. */
export function installShutdown(
  running: Pick<RunningServer, 'close'>,
  proc: { once(event: 'SIGINT' | 'SIGTERM', fn: () => void): unknown; exit(code?: number): void } = process,
  log: (msg: string) => void = (m) => console.log(m),
): void {
  let done = false;
  const handler = (signal: string) => {
    if (done) return;
    done = true;
    log(`[bootquest] ${signal} received, shutting down`);
    void running.close().then(() => proc.exit(0));
  };
  proc.once('SIGINT', () => handler('SIGINT'));
  proc.once('SIGTERM', () => handler('SIGTERM'));
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const env = { ...process.env };
  if (env.BOOTQUEST_PACKS === undefined) env.BOOTQUEST_PACKS = defaultPackDirs().join(',');
  startServer({ env })
    .then((running) => {
      installShutdown(running);
      for (const p of running.packs) {
        console.log(
          `[bootquest] pack ${p.source}: ${p.courses.length} course(s), loaded ${p.loaded} === built ${p.built} ` +
            `(inserted ${p.inserted}, updated ${p.updated}, unchanged ${p.unchanged}, quarantined ${p.withheld}, retired now ${p.retired})`,
        );
      }
      console.log(`[bootquest] API listening on http://${running.host}:${running.port} (db: ${running.db.path})`);
    })
    .catch((err: unknown) => {
      console.error(`[bootquest] failed to start: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
