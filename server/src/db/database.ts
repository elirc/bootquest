import { createRequire } from 'node:module';
import { cleanRow, toNumber, toParam, type SqlInput } from './hygiene.ts';
import { migrate } from './migrate.ts';

// vite/vitest do not know `node:sqlite` as a builtin; load it through
// createRequire (opusboot2 db.ts L6-8). Types come from @types/node.
const require = createRequire(import.meta.url);
const sqlite = require('node:sqlite') as typeof import('node:sqlite');

export type RawDatabase = import('node:sqlite').DatabaseSync;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface OpenOptions {
  /** Explicit DB file path. Takes precedence over BOOTQUEST_DB. */
  path?: string;
  /** Environment to read BOOTQUEST_DB from (defaults to process.env). */
  env?: Record<string, string | undefined>;
}

export class DbPathError extends Error {
  constructor() {
    super(
      'BootQuest DB path not configured: pass an explicit path or set BOOTQUEST_DB. ' +
        'There is deliberately no default path.',
    );
    this.name = 'DbPathError';
  }
}

/** Resolve the DB path ONLY from an explicit argument or BOOTQUEST_DB. Never a default. */
export function resolveDbPath(opts: OpenOptions = {}): string {
  const env = opts.env ?? process.env;
  const candidate = opts.path ?? env.BOOTQUEST_DB;
  if (candidate === undefined || candidate.trim() === '') throw new DbPathError();
  return candidate;
}

/**
 * Thin wrapper over node:sqlite's DatabaseSync that applies row hygiene on the
 * way out and param hygiene on the way in.
 */
export class Db {
  readonly path: string;
  readonly raw: RawDatabase;
  private txDepth = 0;

  constructor(path: string) {
    this.path = path;
    this.raw = new sqlite.DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL;');
  }

  all<T = Record<string, unknown>>(sql: string, ...params: SqlInput[]): T[] {
    return this.raw
      .prepare(sql)
      .all(...params.map(toParam))
      .map((row) => cleanRow<T>(row));
  }

  get<T = Record<string, unknown>>(sql: string, ...params: SqlInput[]): T | undefined {
    const row = this.raw.prepare(sql).get(...params.map(toParam));
    return row === undefined ? undefined : cleanRow<T>(row);
  }

  run(sql: string, ...params: SqlInput[]): RunResult {
    const res = this.raw.prepare(sql).run(...params.map(toParam));
    return { changes: toNumber(res.changes), lastInsertRowid: toNumber(res.lastInsertRowid) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Run fn in a transaction (BEGIN IMMEDIATE); nested calls use savepoints. */
  tx<T>(fn: () => T): T {
    const depth = this.txDepth;
    const sp = `sp_${depth}`;
    this.raw.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.txDepth++;
    try {
      const out = fn();
      this.raw.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      return out;
    } catch (err) {
      this.raw.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    } finally {
      this.txDepth--;
    }
  }

  close(): void {
    if (this.raw.isOpen) this.raw.close();
  }
}

/** Open (and migrate) the BootQuest DB. Throws DbPathError when no path is configured. */
export function openDb(opts: OpenOptions = {}): Db {
  const db = new Db(resolveDbPath(opts));
  try {
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}
