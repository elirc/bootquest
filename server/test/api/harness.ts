import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterEach, beforeEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../src/api/app.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import type { Runner, RunnerRegistry } from '../../src/api/runners.ts';
import { defaultRunners } from '../../src/api/runners.ts';
import type { Db } from '../../src/db/database.ts';
import { fixedClock } from '../../src/engines/clock.ts';
import { insertUnit } from '../../src/store/content.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';

export interface Fixture {
  units: { key: string }[];
  content: Record<string, { starter?: string; solution?: string }>;
  submissions: { addRight: string; addWrong: string };
  markers: string[];
}

export const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/api-units.json', import.meta.url), 'utf8'),
) as Fixture;

export function seedFixture(db: Db, clock: () => Date): Map<string, number> {
  const ids = new Map<string, number>();
  for (const u of fixture.units) ids.set(u.key, insertUnit(db, u, clock));
  return ids;
}

/**
 * Fast stand-in for drill-js: passes iff the submitted code contains "a + b"
 * or "a * b". Most API tests use it; the real-runner tests opt in explicitly.
 */
export const fakeDrillJs: Runner = async (_spec, sub) => {
  const ok = /a \+ b|a \* b/.test(sub.code ?? '');
  return ok
    ? { pass: true, output: '', failures: [], durationMs: 1 }
    : { pass: false, output: '', failures: [{ name: 'fake', message: 'wrong', expected: '5', actual: '-1' }], durationMs: 1 };
};

export interface ApiCtx {
  db: Db;
  clock: ReturnType<typeof fixedClock>;
  tmp: TempDb;
  app: Express;
  ids: Map<string, number>;
  id(key: string): number;
}

export function useApi(opts: { realRunners?: boolean } = {}): ApiCtx {
  const ctx = {} as ApiCtx;
  beforeEach(() => {
    ctx.tmp = makeTempDb();
    ctx.db = ctx.tmp.db;
    ctx.clock = fixedClock(localNoon(2026, 10, 1));
    ctx.ids = seedFixture(ctx.db, ctx.clock);
    ctx.id = (key) => {
      const v = ctx.ids.get(key);
      if (v === undefined) throw new Error(`no fixture unit ${key}`);
      return v;
    };
    const runners: RunnerRegistry = opts.realRunners ? defaultRunners() : { 'drill-js': fakeDrillJs };
    ctx.app = createApp({ db: ctx.db, clock: ctx.clock, runners, content: mapContentStore(fixture.content) });
  });
  afterEach(() => ctx.tmp.cleanup());
  return ctx;
}

/**
 * ui-audit #24: choices are SERVED in a stable per-unit permutation, so a test that knows the
 * STORED (authored, keyed) index answers with the index the learner would click: it finds the
 * stored choice's TEXT in the served list from GET /units/:id, exactly as a learner would.
 */
export async function servedQuizAnswer(app: Express, db: Db, unitId: number, storedIndex: number): Promise<number> {
  const spec = JSON.parse(db.get<{ spec: string }>('SELECT spec FROM "check" WHERE unit_id = ? AND retired_at IS NULL', unitId)!.spec) as { choices?: string[] };
  const text = spec.choices?.[storedIndex];
  if (text === undefined) throw new Error(`unit ${unitId} has no stored choice ${storedIndex}`);
  const res = await request(app).get(`/api/units/${unitId}`);
  const served = (res.body as { check?: { spec?: { choices?: string[] } } }).check?.spec?.choices ?? [];
  const i = served.indexOf(text);
  if (i === -1) throw new Error(`unit ${unitId}: stored choice "${text}" is not among the served choices`);
  return i;
}
