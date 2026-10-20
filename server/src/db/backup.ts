import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// same loader as database.ts: vite/vitest do not know `node:sqlite` as a builtin
const require = createRequire(import.meta.url);
const sqlite = require('node:sqlite') as typeof import('node:sqlite');

/**
 * Automatic pre-migration DB snapshot (serve.ts calls it at startup, BEFORE openDb migrates).
 *
 *   <dir of BOOTQUEST_DB>/backups/bootquest-<UTC yyyymmddThhmmss.mmmZ>[-n].db
 *
 * - made with `VACUUM INTO` on its own connection: a consistent, compacted copy that includes
 *   committed WAL content, then re-opened and `PRAGMA quick_check`ed;
 * - skipped for a brand-new DB (no file, an empty file, or a file with no schema yet): there is
 *   nothing to lose;
 * - retention (pruneBackups, run only after a SUCCESSFUL start): the newest BACKUP_KEEP snapshots
 *   are kept; only files matching BACKUP_NAME_RE in that backups/ dir are ever deleted (a prune
 *   failure is a warning, never a refusal);
 * - HARD CAP (server review F7a, applied at backup time, so also on starts that are refused
 *   later): never more than BACKUP_HARD_CAP snapshots; the oldest beyond it are deleted. A run of
 *   refused restarts therefore cannot fill the disk; it can rotate the oldest snapshot out only
 *   after BACKUP_HARD_CAP of them, and every refused start's snapshot is itself a full copy of
 *   the DB as it then was;
 * - FAIL-CLOSED: if the snapshot cannot be made or verified, the server refuses to start
 *   (BackupError) before any migration touches the DB. `BOOTQUEST_NO_BACKUP=1` skips the
 *   snapshot entirely (escape hatch: full disk, read-only dir, ...).
 */

export const NO_BACKUP_ENV = 'BOOTQUEST_NO_BACKUP';
export const BACKUP_DIR_NAME = 'backups';
export const BACKUP_KEEP = 7;
/** at most this many snapshots exist after any backup, even when every start since was refused */
export const BACKUP_HARD_CAP = 20;
/** the ONLY file names retention may delete */
export const BACKUP_NAME_RE = /^bootquest-(\d{8}T\d{6}\.\d{3}Z)(?:-(\d+))?\.db$/;

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export type BackupResult =
  | { status: 'created'; path: string; pruned: string[]; warnings: string[] }
  | { status: 'skipped'; reason: 'disabled' | 'new-db'; path: null; pruned: []; warnings: string[] };

export interface BackupOptions {
  env: Record<string, string | undefined>;
  /** the injected clock's reading: names the snapshot */
  now: Date;
}

export const backupStamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '');

export function backupDirOf(dbPath: string): string {
  return join(dirname(resolve(dbPath)), BACKUP_DIR_NAME);
}

/** Order snapshots oldest -> newest by (stamp, collision suffix). */
function byAge(a: string, b: string): number {
  const ma = BACKUP_NAME_RE.exec(a)!;
  const mb = BACKUP_NAME_RE.exec(b)!;
  if (ma[1] !== mb[1]) return ma[1]! < mb[1]! ? -1 : 1;
  return Number(ma[2] ?? 0) - Number(mb[2] ?? 0);
}

export function listBackups(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && BACKUP_NAME_RE.test(e.name))
    .map((e) => e.name)
    .sort(byAge);
}

function hasSchema(dbPath: string): boolean {
  const db = new sqlite.DatabaseSync(dbPath);
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get() as { n: number | bigint } | undefined;
    return Number(row?.n ?? 0) > 0;
  } finally {
    db.close();
  }
}

function snapshot(dbPath: string, target: string): void {
  const src = new sqlite.DatabaseSync(dbPath);
  try {
    src.exec('PRAGMA busy_timeout = 5000;');
    src.prepare('VACUUM INTO ?').run(target);
  } finally {
    src.close();
  }
  const copy = new sqlite.DatabaseSync(target, { readOnly: true });
  try {
    const rows = copy.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
    const verdict = rows.map((r) => r.quick_check).join('; ');
    if (verdict !== 'ok') throw new Error(`the snapshot failed PRAGMA quick_check: ${verdict.slice(0, 300)}`);
  } finally {
    copy.close();
  }
}

export function backupBeforeStart(dbPath: string, opts: BackupOptions): BackupResult {
  if (opts.env[NO_BACKUP_ENV] === '1') {
    return { status: 'skipped', reason: 'disabled', path: null, pruned: [], warnings: [`${NO_BACKUP_ENV}=1: starting WITHOUT the pre-migration DB backup`] };
  }
  const abs = resolve(dbPath);
  const fresh = (): BackupResult => ({ status: 'skipped', reason: 'new-db', path: null, pruned: [], warnings: [] });
  if (dbPath === ':memory:' || !existsSync(abs) || statSync(abs).size === 0) return fresh();

  const dir = backupDirOf(abs);
  const stamp = backupStamp(opts.now);
  let target = join(dir, `bootquest-${stamp}.db`);
  const refuse = (what: string, err: unknown): never => {
    throw new BackupError(
      `BootQuest cannot start: ${what} (${err instanceof Error ? err.message : String(err)}). ` +
        `Nothing was migrated or changed in ${abs}. Fix the cause (disk space? permissions? a damaged DB?) ` +
        `or set ${NO_BACKUP_ENV}=1 to start without the backup.`,
    );
  };
  try {
    if (!hasSchema(abs)) return fresh();
  } catch (err) {
    refuse(`cannot read ${abs} to back it up`, err);
  }
  try {
    mkdirSync(dir, { recursive: true });
    for (let n = 2; existsSync(target); n++) target = join(dir, `bootquest-${stamp}-${n}.db`);
    snapshot(abs, target);
  } catch (err) {
    try {
      rmSync(target, { force: true });
    } catch {
      /* the refusal below names the path */
    }
    refuse(`the pre-migration backup of ${abs} to ${target} failed`, err);
  }

  // F7a: the hard cap holds even if this start is refused later (retention to BACKUP_KEEP waits for a good start)
  return pruneBackups({ status: 'created', path: target, pruned: [], warnings: [] }, BACKUP_HARD_CAP);
}

/**
 * Retention: keep the newest `keep` of OUR snapshots in the backups dir; never touch anything
 * else there (only BACKUP_NAME_RE names) and never the snapshot just made. serve.ts calls it with
 * BACKUP_KEEP only once the server is up: a startup that REFUSES (stamp, ladder, port...) prunes
 * only beyond BACKUP_HARD_CAP (backupBeforeStart), so a run of failed restarts cannot rotate the
 * last good snapshot out before that many. It never throws: a failure is a warning.
 */
export function pruneBackups(result: BackupResult, keep: number = BACKUP_KEEP): BackupResult {
  if (result.status !== 'created') return result;
  const dir = dirname(result.path);
  const pruned: string[] = [];
  const warnings = [...result.warnings];
  let all: string[];
  try {
    all = listBackups(dir);
  } catch (err) {
    return { ...result, warnings: [...warnings, `could not list ${dir} to prune old backups: ${err instanceof Error ? err.message : String(err)}`] };
  }
  for (const name of all.slice(0, Math.max(0, all.length - keep))) {
    const p = join(dir, name);
    if (p === result.path) continue;
    try {
      rmSync(p);
      pruned.push(p);
    } catch (err) {
      warnings.push(`could not prune old backup ${p}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { ...result, pruned: [...result.pruned, ...pruned], warnings };
}
