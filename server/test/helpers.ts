import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/db/database.ts';
import { fixedClock, DAY_MS } from '../src/engines/clock.ts';
import { insertUnit } from '../src/store/content.ts';

export { DAY_MS };

/** Local-noon date (DST/timezone-proof day arithmetic in tests). */
export function localNoon(y: number, m1: number, d: number): Date {
  return new Date(y, m1 - 1, d, 12, 0, 0, 0);
}

export interface TempDb {
  db: Db;
  dir: string;
  path: string;
  cleanup(): void;
}

/** A fresh, migrated DB in its own OS temp dir. Never the owner's DB. */
export function makeTempDb(): TempDb {
  const dir = mkdtempSync(join(tmpdir(), 'bootquest-test-'));
  const path = join(dir, 'test.db');
  const db = openDb({ path, env: {} });
  return {
    db,
    dir,
    path,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

/** Per-test temp DB + clock fixed at 2026-10-01 12:00 local. */
export function useTempDb() {
  const ctx = {} as { db: Db; clock: ReturnType<typeof fixedClock>; tmp: TempDb };
  beforeEach(() => {
    ctx.tmp = makeTempDb();
    ctx.db = ctx.tmp.db;
    ctx.clock = fixedClock(localNoon(2026, 10, 1));
  });
  afterEach(() => {
    ctx.tmp.cleanup();
  });
  return ctx;
}

let seq = 0;
/** Insert a minimal drill unit; returns its id. */
export function makeUnit(
  db: Db,
  clock: () => Date,
  over: { key?: string; kind?: string; difficulty?: number; track?: string; variationOf?: string; competencies?: string[] } = {},
): number {
  seq += 1;
  return insertUnit(
    db,
    {
      key: over.key ?? `test:unit-${seq}`,
      track: over.track ?? 'js',
      kind: over.kind ?? 'drill',
      title: `fixture unit ${seq}`,
      difficulty: over.difficulty ?? 2,
      competencies: over.competencies ?? [],
      ...(over.variationOf ? { variationOf: over.variationOf } : {}),
    },
    clock,
  );
}
