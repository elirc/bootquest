import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from './database.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const FILE_RE = /^(\d{3})_[a-z0-9_]+\.sql$/;

export interface Migration {
  version: number;
  name: string;
  sql: string;
  /** sha256 of the SQL with line endings normalized (CRLF checkouts hash the same) */
  checksum: string;
}

export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export class MigrationChecksumError extends Error {
  constructor(name: string) {
    super(`migration ${name} was edited after it was applied (checksum mismatch); add a new migration instead`);
    this.name = 'MigrationChecksumError';
  }
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const migrations = readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .sort()
    .map((name) => {
      const sql = readFileSync(`${dir}/${name}`, 'utf8');
      return { version: Number(FILE_RE.exec(name)![1]), name, sql, checksum: migrationChecksum(sql) };
    });
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`migration numbering gap at ${m.name} (expected ${i + 1})`);
  });
  return migrations;
}

/**
 * Apply pending numbered migrations, each in its own transaction, recording
 * them (with a sha256 checksum) in schema_version. Idempotent: already-applied
 * versions are skipped, but their checksum is verified — editing an applied
 * migration fails loudly. The applied check is repeated inside the write
 * transaction, so two concurrent starters cannot both apply a version.
 * Returns the versions applied by this call.
 */
export function migrate(db: Db, dir?: string): number[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (' +
      'version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL, checksum TEXT)',
  );
  const cols = db.all<{ name: string }>(`SELECT name FROM pragma_table_info('schema_version')`).map((c) => c.name);
  if (!cols.includes('checksum')) db.exec('ALTER TABLE schema_version ADD COLUMN checksum TEXT');

  const done: number[] = [];
  for (const m of loadMigrations(dir)) {
    const applied = db.get<{ checksum: string | null }>('SELECT checksum FROM schema_version WHERE version = ?', m.version);
    const fkOff = !applied && needsForeignKeysOff(m.sql);
    // PRAGMA foreign_keys is a no-op inside a transaction: toggle it outside.
    if (fkOff) db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.tx(() => {
        const row = db.get<{ checksum: string | null }>('SELECT checksum FROM schema_version WHERE version = ?', m.version);
        if (row) {
          if (row.checksum === null) {
            // applied before checksums existed: record it now (trust on first verify)
            db.run('UPDATE schema_version SET checksum = ? WHERE version = ?', m.checksum, m.version);
          } else if (row.checksum !== m.checksum) {
            throw new MigrationChecksumError(m.name);
          }
          return;
        }
        db.exec(m.sql);
        if (fkOff) {
          // table rebuilds run with FKs off: prove nothing dangles before committing
          const broken = db.all('PRAGMA foreign_key_check');
          if (broken.length > 0) {
            throw new Error(`migration ${m.name} left ${broken.length} foreign-key violation(s): ${JSON.stringify(broken.slice(0, 5))}`);
          }
        }
        // Migration bookkeeping is infrastructure, not an engine: wall clock is fine here.
        db.run(
          'INSERT INTO schema_version (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
          m.version,
          m.name,
          Date.now(),
          m.checksum,
        );
        done.push(m.version);
      });
    } finally {
      if (fkOff) db.exec('PRAGMA foreign_keys = ON;');
    }
  }
  return done;
}

/**
 * First-line marker for table-rebuild migrations (SQLite's 12-step ALTER
 * procedure): such a migration runs with foreign_keys OFF and must leave
 * PRAGMA foreign_key_check empty, or it rolls back.
 */
export const FOREIGN_KEYS_OFF_MARKER = '-- bootquest:foreign-keys-off';

function needsForeignKeysOff(sql: string): boolean {
  const firstLine = sql.split(/\r?\n/, 1)[0] ?? '';
  return firstLine.replace(/^\uFEFF/, '').trim() === FOREIGN_KEYS_OFF_MARKER;
}

export function schemaVersion(db: Db): number {
  return db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_version')?.v ?? 0;
}
