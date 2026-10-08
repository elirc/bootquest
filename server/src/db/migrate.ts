import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from './database.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const FILE_RE = /^(\d{3})_[a-z0-9_]+\.sql$/;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const migrations = readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .sort()
    .map((name) => ({
      version: Number(FILE_RE.exec(name)![1]),
      name,
      sql: readFileSync(`${dir}/${name}`, 'utf8'),
    }));
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`migration numbering gap at ${m.name} (expected ${i + 1})`);
  });
  return migrations;
}

/**
 * Apply pending numbered migrations, each in its own transaction, recording
 * them in schema_version. Idempotent: already-applied versions are skipped.
 * Returns the versions applied by this call.
 */
export function migrate(db: Db, dir?: string): number[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (' +
      'version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
  const applied = new Set(db.all<{ version: number }>('SELECT version FROM schema_version').map((r) => r.version));
  const done: number[] = [];
  for (const m of loadMigrations(dir)) {
    if (applied.has(m.version)) continue;
    db.tx(() => {
      db.exec(m.sql);
      // Migration bookkeeping is infrastructure, not an engine: wall clock is fine here.
      db.run('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)', m.version, m.name, Date.now());
    });
    done.push(m.version);
  }
  return done;
}

export function schemaVersion(db: Db): number {
  return db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_version')?.v ?? 0;
}
