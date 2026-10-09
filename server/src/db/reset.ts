import { existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertPortFree, PortBusyError, resolvePort } from '../api/serve.ts';
import { openDb } from './database.ts';
import { schemaVersion } from './migrate.ts';

/**
 * `npm run reset -- --yes-really` / `bootquest reset --yes-really` (W7, spec §11 M7 "seed/reset
 * command"): start over with a fresh, empty, migrated DB. Content is NOT in the DB (packs,
 * campaign, seed items and ladder units load at the next `npm run serve`), so a reset loses only
 * the learner's own history — which is why it is guarded three ways:
 *   1. it refuses unless BOOTQUEST_DB is set explicitly (it never guesses a path, never a default);
 *   2. it refuses without --yes-really (prints exactly what it would do);
 *   3. it refuses while a server answers on BOOTQUEST_PORT (default 4178), and it never deletes:
 *      the DB file and its -wal / -shm side files are RENAMED to <file>.reset-<stamp>.bak (an
 *      open file cannot be renamed on Windows, so a DB held by any process also refuses; any
 *      partial rename is rolled back).
 * Exit codes: 0 reset done, 1 refused because something holds the DB, 2 usage / guard refusal.
 */
export interface ResetDeps {
  env: Record<string, string | undefined>;
  now: () => Date;
  out(line: string): void;
  err(line: string): void;
}

export const RESET_FLAG = '--yes-really';

const stampOf = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export async function runReset(argv: readonly string[], deps: ResetDeps): Promise<number> {
  const { env, out, err } = deps;
  const unknown = argv.filter((a) => a !== RESET_FLAG);
  if (unknown.length) {
    err(`bootquest reset: unknown argument(s) ${unknown.join(' ')}. Usage: reset ${RESET_FLAG}   (BOOTQUEST_DB must be set)`);
    return 2;
  }
  const raw = env.BOOTQUEST_DB;
  if (raw === undefined || raw.trim() === '') {
    err('bootquest reset: REFUSED — BOOTQUEST_DB is not set. Reset never guesses a database path; set BOOTQUEST_DB to the DB you mean.');
    return 2;
  }
  const dbPath = resolve(raw.trim());
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].filter((f) => existsSync(f));
  if (!argv.includes(RESET_FLAG)) {
    err(
      `bootquest reset: REFUSED — this would move ${files.length ? files.join(', ') : `(nothing yet at ${dbPath})`} aside and start a FRESH, EMPTY database ` +
        `at ${dbPath}: every attempt, XP event, evidence row, rating and streak in it would stop being loaded (the files are kept as *.reset-<time>.bak). ` +
        `Re-run with ${RESET_FLAG} to do it.`,
    );
    return 2;
  }
  let port: number;
  try {
    port = resolvePort(env);
    await assertPortFree(port);
  } catch (e) {
    if (e instanceof PortBusyError) {
      err(`bootquest reset: REFUSED — something is listening on port ${e.port} (a BootQuest server using this DB?). Stop it first, then reset.`);
      return 1;
    }
    err(`bootquest reset: REFUSED — ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const stamp = stampOf(deps.now());
  const moved: [string, string][] = [];
  try {
    for (const f of files) {
      const to = `${f}.reset-${stamp}.bak`;
      renameSync(f, to);
      moved.push([f, to]);
    }
  } catch (e) {
    for (const [from, to] of moved.reverse()) {
      try {
        renameSync(to, from);
      } catch {
        /* reported below */
      }
    }
    err(`bootquest reset: REFUSED — ${dbPath} is in use by another process (${e instanceof Error ? e.message : String(e)}); nothing was changed.`);
    return 1;
  }
  const fresh = openDb({ path: dbPath, env: {} });
  let version: number;
  try {
    version = schemaVersion(fresh);
  } finally {
    fresh.close();
  }
  for (const [from, to] of moved) out(`bootquest reset: moved ${from} -> ${to}`);
  out(`bootquest reset: fresh database at ${dbPath} (schema version ${version}). Content loads at the next \`npm run serve\` (port ${port}).`);
  return 0;
}
