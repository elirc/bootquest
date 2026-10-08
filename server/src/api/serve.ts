import type { Server } from 'node:http';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb, resolveDbPath, type Db } from '../db/database.ts';
import type { Clock } from '../engines/clock.ts';
import { createApp } from './app.ts';
import { emptyContentStore, fileContentStore } from './content-store.ts';
import type { RunnerRegistry } from './runners.ts';

/**
 * Real entrypoint: `node --import tsx server/src/api/serve.ts`
 *   BOOTQUEST_DB            (required) the one DB file — there is no default
 *   BOOTQUEST_PORT          (optional) default 4178
 *   BOOTQUEST_UNIT_CONTENT  (optional) JSON {unitKey: {starter?, solution?}} from content/
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
}

export interface RunningServer {
  server: Server;
  db: Db;
  port: number;
  host: string;
  close(): Promise<void>;
}

export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const env = opts.env ?? process.env;
  const host = opts.host ?? DEFAULT_HOST;
  const dbPath = resolveDbPath({ env }); // throws DbPathError when BOOTQUEST_DB is unset
  const port = resolvePort(env);
  await assertPortFree(port, host); // before touching the DB

  const db = openDb({ path: dbPath, env: {} });
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    const mode = db.get<{ journal_mode: string }>('PRAGMA journal_mode')?.journal_mode;
    if (mode !== 'wal') throw new Error(`expected journal_mode=wal on ${dbPath}, got ${String(mode)}`);
    const content = env.BOOTQUEST_UNIT_CONTENT ? fileContentStore(resolve(env.BOOTQUEST_UNIT_CONTENT)) : emptyContentStore;
    const app = createApp({ db, clock: opts.clock ?? systemClock, content, ...(opts.runners ? { runners: opts.runners } : {}) });

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
          done();
        });
        server.closeAllConnections();
      });
      return closing;
    };
    return { server, db, port, host, close };
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
  startServer()
    .then((running) => {
      installShutdown(running);
      console.log(`[bootquest] API listening on http://${running.host}:${running.port} (db: ${running.db.path})`);
    })
    .catch((err: unknown) => {
      console.error(`[bootquest] failed to start: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
