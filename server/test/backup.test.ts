import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupBeforeStart, BackupError, BACKUP_KEEP, backupDirOf, listBackups, NO_BACKUP_ENV } from '../src/db/backup.ts';
import { backupSummary, startServer } from '../src/api/serve.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { localNoon } from './helpers.ts';

const require = createRequire(import.meta.url);
const sqlite = require('node:sqlite') as typeof import('node:sqlite');

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return port;
}

/** a pre-existing, NOT yet migrated DB holding one learner row in a table of its own */
function legacyDb(path: string): void {
  const db = new sqlite.DatabaseSync(path);
  db.exec(`CREATE TABLE legacy_marker (v TEXT); INSERT INTO legacy_marker VALUES ('before-migrations');`);
  db.close();
}

function tables(path: string): string[] {
  const db = new sqlite.DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]).map((r) => r.name);
  } finally {
    db.close();
  }
}

describe('startup DB backup (db/backup.ts)', () => {
  let dir: string;
  const now = new Date(Date.UTC(2026, 9, 19, 8, 30, 15, 123));
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bootquest-backup-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  it('creates a verified VACUUM INTO snapshot at <db dir>/backups/bootquest-<UTC>.db', () => {
    const path = join(dir, 'bq.db');
    legacyDb(path);
    const r = backupBeforeStart(path, { env: {}, now });
    expect(r.status).toBe('created');
    expect(r.path).toBe(join(dir, 'backups', 'bootquest-20261019T083015.123Z.db'));
    expect(backupDirOf(path)).toBe(join(dir, 'backups'));
    const copy = new sqlite.DatabaseSync(r.path!, { readOnly: true });
    expect(copy.prepare('SELECT v FROM legacy_marker').get()).toMatchObject({ v: 'before-migrations' });
    copy.close();
    // same stamp again (a fixed clock, a fast restart): a suffixed name, never an overwrite
    const r2 = backupBeforeStart(path, { env: {}, now });
    expect(r2.path).toBe(join(dir, 'backups', 'bootquest-20261019T083015.123Z-2.db'));
    expect(listBackups(join(dir, 'backups'))).toEqual(['bootquest-20261019T083015.123Z.db', 'bootquest-20261019T083015.123Z-2.db']);
  });

  it('skips a brand-new DB: no file, an empty file, or a file with no schema (no backups dir created)', () => {
    expect(backupBeforeStart(join(dir, 'missing.db'), { env: {}, now })).toMatchObject({ status: 'skipped', reason: 'new-db' });
    writeFileSync(join(dir, 'zero.db'), '');
    expect(backupBeforeStart(join(dir, 'zero.db'), { env: {}, now })).toMatchObject({ status: 'skipped', reason: 'new-db' });
    new sqlite.DatabaseSync(join(dir, 'blank.db')).close();
    expect(backupBeforeStart(join(dir, 'blank.db'), { env: {}, now })).toMatchObject({ status: 'skipped', reason: 'new-db' });
    expect(existsSync(join(dir, 'backups'))).toBe(false);
  });

  it(`retention keeps the newest ${BACKUP_KEEP} snapshots and deletes ONLY files matching the backup name pattern`, () => {
    const path = join(dir, 'bq.db');
    legacyDb(path);
    const b = join(dir, 'backups');
    backupBeforeStart(path, { env: {}, now: new Date(Date.UTC(2026, 0, 1)) }); // creates the dir (oldest real one)
    const olds = Array.from({ length: 8 }, (_, i) => `bootquest-2026010${i + 2}T000000.000Z.db`);
    for (const f of olds) writeFileSync(join(b, f), 'x');
    const strangers = ['bootquest-manual.db', 'bootquest-20200101T000000.000Z.db.keep', 'notes.txt', 'bootquest-20200101T000000Z.db', 'other-20200101T000000.000Z.db'];
    for (const f of strangers) writeFileSync(join(b, f), 'keep me');
    const r = backupBeforeStart(path, { env: {}, now });
    expect(r.status).toBe('created');
    const kept = listBackups(b);
    expect(kept).toHaveLength(BACKUP_KEEP);
    expect(kept.at(-1)).toBe('bootquest-20261019T083015.123Z.db');
    expect(kept).toEqual([...olds.slice(-6), 'bootquest-20261019T083015.123Z.db']);
    expect(r.pruned).toHaveLength(3); // the first real one + the two oldest planted
    for (const f of strangers) expect(existsSync(join(b, f)), f).toBe(true);
    expect(backupSummary(r)).toEqual([`[bootquest] backup: ${r.path} (pruned 3 older)`]);
  });

  it('FAIL-CLOSED: an impossible backup refuses with BackupError naming the escape hatch; nothing is written', () => {
    const path = join(dir, 'bq.db');
    legacyDb(path);
    writeFileSync(join(dir, 'backups'), 'a FILE where the backups dir should be');
    const err = (() => {
      try {
        backupBeforeStart(path, { env: {}, now });
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(BackupError);
    expect((err as Error).message).toMatch(/cannot start: the pre-migration backup of .* failed/);
    expect((err as Error).message).toContain(`${NO_BACKUP_ENV}=1`);
    // a file that is not a database refuses too (it cannot be read to back it up)
    const junk = join(dir, 'junk.db');
    writeFileSync(junk, 'this is not sqlite '.repeat(100));
    rmSync(join(dir, 'backups'));
    expect(() => backupBeforeStart(junk, { env: {}, now })).toThrow(BackupError);
    // the escape hatch skips it entirely
    writeFileSync(join(dir, 'backups'), 'still a file');
    const skipped = backupBeforeStart(path, { env: { [NO_BACKUP_ENV]: '1' }, now });
    expect(skipped).toMatchObject({ status: 'skipped', reason: 'disabled', path: null });
    expect(backupSummary(skipped)).toEqual(['[bootquest] backup: skipped (disabled)', `[bootquest] WARNING: ${NO_BACKUP_ENV}=1: starting WITHOUT the pre-migration DB backup`]);
    // only '1' disables it
    expect(() => backupBeforeStart(path, { env: { [NO_BACKUP_ENV]: 'yes' }, now })).toThrow(BackupError);
  });

  it('startServer snapshots BEFORE migrating, refuses to start (DB untouched) when it cannot, and BOOTQUEST_NO_BACKUP=1 starts anyway', async () => {
    const clock = fixedClock(localNoon(2026, 10, 19));
    // 1. an existing un-migrated DB: the snapshot holds the pre-migration schema only
    const path = join(dir, 'live.db');
    legacyDb(path);
    const running = await startServer({ env: { BOOTQUEST_DB: path, BOOTQUEST_PORT: String(await freePort()) }, clock });
    try {
      expect(running.backup.status).toBe('created');
      expect(tables(running.backup.path!)).toEqual(['legacy_marker']);
      expect(tables(path)).toContain('unit'); // the live DB was migrated after the snapshot
    } finally {
      await running.close();
    }

    // 2. fail-closed: the backup cannot be written -> startServer rejects BEFORE migrating
    const path2 = join(dir, 'sub', 'second.db');
    rmSync(join(dir, 'sub'), { recursive: true, force: true });
    mkdirSync(join(dir, 'sub'));
    legacyDb(path2);
    writeFileSync(join(dir, 'sub', 'backups'), 'a FILE where the backups dir should be');
    const port = await freePort();
    await expect(startServer({ env: { BOOTQUEST_DB: path2, BOOTQUEST_PORT: String(port) }, clock })).rejects.toBeInstanceOf(BackupError);
    expect(tables(path2)).toEqual(['legacy_marker']); // NOT migrated
    // 3. the escape hatch
    const r2 = await startServer({ env: { BOOTQUEST_DB: path2, BOOTQUEST_PORT: String(port), [NO_BACKUP_ENV]: '1' }, clock });
    try {
      expect(r2.backup).toMatchObject({ status: 'skipped', reason: 'disabled' });
      expect(tables(path2)).toContain('unit');
    } finally {
      await r2.close();
    }
    // 4. a brand-new DB path starts with no backup at all
    const path3 = join(dir, 'fresh', 'new.db');
    mkdirSync(join(dir, 'fresh'));
    const r3 = await startServer({ env: { BOOTQUEST_DB: path3, BOOTQUEST_PORT: String(await freePort()) }, clock });
    try {
      expect(r3.backup).toMatchObject({ status: 'skipped', reason: 'new-db' });
      expect(readdirSync(join(dir, 'fresh'))).not.toContain('backups');
    } finally {
      await r3.close();
    }
  });
});
