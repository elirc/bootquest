import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PackManifest } from '@bootquest/shared';
import type { UnitContentEntry } from '@bootquest/shared/api';
import { openDb, resolveDbPath, type Db } from '../db/database.ts';
import type { Clock } from '../engines/clock.ts';
import { loadCampaignIntoDb, readCampaign, type CampaignLoadStats } from '../store/campaign.ts';
import { ALLOW_UNSTAMPED_ENV, loadPackIntoDb, packContentEntries, PackLoadError, readPack, type LoadStats } from '../store/packs.ts';
import { createApp } from './app.ts';
import { combineContentStores, fileContentEntries } from './content-store.ts';
import { createDrillCsRunner, resolveCsScratchDir, type DrillCsRunner } from './runner-csharp.ts';
import { defaultRunners, type RunnerRegistry } from './runners.ts';
import { createNodeTestFileRunner } from './runner-node-test-file.ts';
import { removeWorkParent } from '../runners/node-test-file/index.ts';
import { createSyncService, resolveSyncPaths, type SyncService } from '../sync/service.ts';
import { defaultSeedItemDirs, loadSeedItemStoreWithStats, type SeedPackStat } from '../store/seed-items.ts';
import { DEFAULT_AUTHORED_UNITS, ladderContentEntries, loadLadderIntoDb, readAuthoredUnits, readKataDifficulty, type LadderLoadStats } from '../store/ladder.ts';
import { loadStudyQuestsIntoDb, type StudyQuestLoadStats } from '../store/study-quests.ts';

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
 *   BOOTQUEST_CAMPAIGN      (optional) the campaign dir (manifest.json + track files from
 *                           `npm run seed:campaign`); when serve.ts is run directly and this is
 *                           unset, <repo>/content/campaign is loaded if present. '' = none.
 *                           A seeder-fingerprint / file-hash / loaded !== built mismatch
 *                           REFUSES TO START (W5b).
 *   BOOTQUEST_CS_SCRATCH    (optional) app-data dir of the C# runner's warm scratch
 *                           projects; default <dir of BOOTQUEST_DB>/bootquest-scratch.
 *                           drill-cs submissions route there (W3a).
 *   BOOTQUEST_CURRICULUM / BOOTQUEST_CHECK_SPECS / BOOTQUEST_GITHUB_CACHE / BOOTQUEST_OFFLINE
 *                           W4 GitHub sync (see sync/service.ts): POST /api/sync, GET
 *                           /api/refs/:id/content, and node-test-file grading from the
 *                           per-SHA tarball cache.
 *   BOOTQUEST_SEED_ITEMS    (optional, W6) comma-separated stamped seed-pack dirs (items.json +
 *                           validation.json) holding explain-back question sets / patch katas;
 *                           when serve.ts is run directly and this is unset, every
 *                           <repo>/content/seed/{explainback,patches}/<name>/ is loaded. '' = none.
 *                           An unstamped / edited pack REFUSES TO START. W7: the FULL stamp is
 *                           verified (seed:check's verifier: bytes, counts, quarantine/review keys,
 *                           current seed fingerprint), and content/seed/variants/<name>/ is loaded too.
 *                           W8: content/seed/quests/<repo>/ (seed:quests) is loaded too: the campaign's
 *                           study quests get their quiz gates from it (store/study-quests.ts).
 *   BOOTQUEST_AUTHORED_UNITS (optional, W7) authored unit definitions (content/units/agentic.json:
 *                           G3 / G4); when serve.ts is run directly and this is unset, the repo's
 *                           file is loaded. '' = none.
 * W7 ladder wiring: after the campaign + seed items load, the ladder loader derives the
 * explain-back / G2 / kata-bank / retest units from the seed items (store/ladder.ts) and
 * asserts loaded === built per family; it re-runs after every successful sync.
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
  /** campaign load stats (null when no campaign dir was configured) */
  campaign: CampaignLoadStats | null;
  /** the C# runner's app-data dir (null when the caller injected its own registry) */
  csharpScratch: string | null;
  /** W7: one row per loaded seed pack (full stamp verified) */
  seedPacks: SeedPackStat[];
  /** W7: ladder wiring stats (loaded === built per family already asserted) */
  ladder: LadderLoadStats;
  /** W8: study-quest gates derived from the stamped seed:quests packs (loaded === built per track asserted) */
  studyQuests: StudyQuestLoadStats;
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

/** <repo>/content/campaign when it holds a manifest (default for the real entrypoint), else ''. */
/** <repo>/content/seed/{explainback,patches}/* dirs (default for the real entrypoint). */
export function defaultSeedDirs(root: string = fileURLToPath(new URL('../../../content/seed/', import.meta.url))): string[] {
  return defaultSeedItemDirs(root);
}

export function defaultCampaignDir(root: string = fileURLToPath(new URL('../../../content/campaign/', import.meta.url))): string {
  return existsSync(join(root, 'manifest.json')) ? root : '';
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
    const campaignDir = (env.BOOTQUEST_CAMPAIGN ?? '').trim();
    const campaign = campaignDir ? loadCampaignIntoDb(db, readCampaign(resolve(campaignDir)), clock) : null;
    const seedDirs = splitList(env.BOOTQUEST_SEED_ITEMS).map((d) => resolve(d));
    const { store: seedItems, packs: seedPacks } = loadSeedItemStoreWithStats(seedDirs);
    // W7: the ladder units (explain-back / G2 / kata bank / retests) + the authored G3/G4 units
    const authoredPath = (env.BOOTQUEST_AUTHORED_UNITS ?? '').trim();
    const authored = authoredPath ? readAuthoredUnits(resolve(authoredPath)) : null;
    const kataDifficulty = new Map<string, number>();
    for (const d of new Set(seedDirs.filter((x) => /[\\/]patches[\\/][^\\/]+$/.test(x)).map((x) => join(x, '..', 'katas-index.json')))) {
      for (const [k, v] of readKataDifficulty(d)) kataDifficulty.set(k, v);
    }
    const ladderInputs = { seedItems, authored, kataDifficulty };
    const ladder = loadLadderIntoDb(db, ladderInputs, clock);
    // W8: campaign study quests whose repo has a stamped quest pack get their quiz gate (others stay pending)
    const studyQuests = loadStudyQuestsIntoDb(db, seedItems, clock);
    sources.push(ladderContentEntries(seedItems));
    if (authored) sources.push(new Map(Object.entries(authored.content)));
    const content = combineContentStores(sources);
    // drill-cs -> the warm C# runner (lazy: no dotnet process until the first C# grade)
    csharp = opts.runners ? null : createDrillCsRunner({ appDataDir: resolveCsScratchDir(env, dbPath) });
    const sync = opts.sync ?? createSyncService(resolveSyncPaths(env));
    const runners: RunnerRegistry =
      opts.runners ?? defaultRunners({ ...(csharp ? { drillCs: csharp.runner } : {}), nodeTestFile: createNodeTestFileRunner(sync.cache) });
    // a sync can register new project units (signalpost U01...): re-link explain-backs + create pending retests
    const app = createApp({ db, clock, content, runners, sync, seedItems, afterSync: () => void loadLadderIntoDb(db, ladderInputs, clock) });

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
          // stop the compiler server (named pipe) + any live dotnet child we started; F12: then drop
          // this process's (by now empty) node-test-file workspace parent when we own that runner
          void (csharp ? csharp.shutdown() : Promise.resolve())
            .then(() => (opts.runners ? false : removeWorkParent()))
            .catch(() => undefined)
            .finally(done);
        });
        server.closeAllConnections();
      });
      return closing;
    };
    return { server, db, port, host, close, packs: packStats, campaign, csharpScratch: csharp?.appDataDir ?? null, seedPacks, ladder, studyQuests };
  } catch (err) {
    db.close();
    throw err;
  }
}

/**
 * W7: the startup summary — one line per loaded source with its counts (packs, campaign
 * tracks, seed packs, ladder families, authored units). Every count printed here was already
 * asserted loaded === built by its loader (a mismatch refuses to start before this prints).
 */
export function startupSummary(running: Pick<RunningServer, 'packs' | 'campaign' | 'seedPacks' | 'ladder'> & Partial<Pick<RunningServer, 'studyQuests'>>): string[] {
  const out: string[] = [];
  for (const p of running.packs) {
    out.push(
      `[bootquest] pack ${p.source}: ${p.courses.length} course(s), loaded ${p.loaded} === built ${p.built} ` +
        `(inserted ${p.inserted}, updated ${p.updated}, unchanged ${p.unchanged}, quarantined ${p.withheld}, retired now ${p.retired})`,
    );
  }
  for (const t of running.campaign?.tracks ?? []) {
    out.push(`[bootquest] campaign ${t.track}: ${t.acts} act(s), loaded ${t.loaded} === built ${t.built} quests (${t.units} playable units)`);
  }
  for (const s of running.seedPacks) {
    const kinds = Object.entries(s.byKind).map(([k, n]) => `${n} ${k}`).join(', ');
    out.push(`[bootquest] seed ${s.source}: ${s.items} item(s) (${kinds || 'none'}), stamp verified`);
  }
  const l = running.ladder;
  out.push(
    `[bootquest] ladder: explain-back ${l.explainBack.loaded} === ${l.explainBack.built} (${l.explainBack.linkedToArtifact} linked to a project artifact, ` +
      `${l.explainBack.linkedToQuest} to a campaign quest), G2 briefs ${l.g2.loaded} === ${l.g2.built}, ` +
      `kata bank ${l.katas.loaded} === ${l.katas.built} (${l.katas.linkedToQuest} linked to a quest), ` +
      `retests ${l.retests.loaded} === ${l.retests.built} built - ${l.retests.pending.length} pending, standalone study packs ${l.study.loaded} === ${l.study.built}, ` +
      `authored ${l.authored.loaded} === ${l.authored.built}`,
  );
  for (const p of l.retests.pending) out.push(`[bootquest] ladder: retest pending: ${p}`);
  const sq = running.studyQuests;
  if (sq) {
    for (const t of sq.tracks) {
      out.push(`[bootquest] study quests ${t.track}: loaded ${t.loaded} === built ${t.built} quiz gates from quest packs, ${t.pending} still content-pending (no pack)`);
    }
    if (sq.unmatchedPacks.length) out.push(`[bootquest] study quests: quest pack(s) matching no campaign study quest (served as standalone ladder study units): ${sq.unmatchedPacks.join(', ')}`);
    for (const o of sq.orphaned) out.push(`[bootquest] study quests: ${o} lost its quest pack after attempts were recorded (gate kept for history, quest content-pending)`);
  }
  return out;
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
  if (env.BOOTQUEST_CAMPAIGN === undefined) env.BOOTQUEST_CAMPAIGN = defaultCampaignDir();
  if (env.BOOTQUEST_SEED_ITEMS === undefined) env.BOOTQUEST_SEED_ITEMS = defaultSeedDirs().join(',');
  if (env.BOOTQUEST_AUTHORED_UNITS === undefined) {
    const def = DEFAULT_AUTHORED_UNITS(fileURLToPath(new URL('../../../', import.meta.url)));
    env.BOOTQUEST_AUTHORED_UNITS = existsSync(def) ? def : '';
  }
  startServer({ env })
    .then((running) => {
      installShutdown(running);
      for (const line of startupSummary(running)) console.log(line);
      console.log(`[bootquest] API listening on http://${running.host}:${running.port} (db: ${running.db.path})`);
    })
    .catch((err: unknown) => {
      console.error(`[bootquest] failed to start: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
