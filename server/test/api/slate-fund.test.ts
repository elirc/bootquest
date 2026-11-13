// f52 U6 (W3.9): a language track's slate drill set links to its next Fundamentals drill first:
// once a topic gate is passed, the highest passed topic that still has a drill; before any pass, the
// lowest topic whose lesson is open; never a study (gate) unit, falling back to the first open drill
// of the track that is not in a LOCKED Fundamentals topic. firstOpenDrill and GET /drills/next are
// unchanged (find.test.ts pins them).
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DashboardResponseExt, DrillNextResponse } from '@bootquest/shared/api-ext';
import { createApp } from '../../src/api/app.ts';
import type { Db } from '../../src/db/database.ts';
import { revealSolution } from '../../src/engines/attempts.ts';
import { fixedClock } from '../../src/engines/clock.ts';
import { insertUnit } from '../../src/store/content.ts';
import { localNoon, makeTempDb, submit, type TempDb } from '../helpers.ts';
import { fakeDrillJs } from './harness.ts';
import { abSlate } from '../slate-fixtures.ts';

const drillSpec = { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.ok(true)' }] };
const drill = (key: string, track = 'js', prerequisites: string[] = []) => ({ key, track, kind: 'drill', title: key, difficulty: 1, prerequisites, checks: [{ spec: drillSpec }] });
const gate = (key: string, prerequisites: string[] = []) => ({
  key,
  track: 'js',
  kind: 'study',
  title: key,
  difficulty: 1,
  prerequisites,
  checks: [{ spec: { type: 'study-quiz', itemKeys: [`${key}:q1`] } }],
});

// inserted in this order: the bank drill has the LOWEST id, so firstOpenDrill picks it
const UNITS = [
  drill('bank/js/01-first'),
  drill('bank/cs/01-first', 'csharp'),
  gate('fund/js/01-alpha'),
  gate('fund/js/02-beta', ['fund/js/01-alpha']),
  // topic 02's drill is inserted BEFORE topic 01's: topic order wins over id order
  drill('fund-js/02-beta/01-b1'),
  drill('fund-js/01-alpha/01-a1'),
  drill('fund-js/01-alpha/02-a2'),
];

describe('GET /api/dashboard: drill-set target prefers Fundamentals', { timeout: 30_000 }, () => {
  let tmp: TempDb;
  let db: Db;
  let clock: ReturnType<typeof fixedClock>;
  let app: Express;
  const id = (key: string) => db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', key)!.id;
  beforeEach(() => {
    tmp = makeTempDb();
    db = tmp.db;
    abSlate(db); // rv wave C: these pin the ab drill-set slots (every track on); the default day is the Fundamentals step
    clock = fixedClock(localNoon(2026, 10, 1));
    for (const u of UNITS) insertUnit(db, u, clock);
    app = createApp({ db, clock, runners: { 'drill-js': fakeDrillJs } });
  });
  afterEach(() => tmp.cleanup());

  const target = async (slot: string) => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    return DashboardResponseExt.parse(res.body).slate.items.find((i) => i.slot === slot)?.targetUnitId;
  };

  it('lowest open topic first, in served order, until a gate passes; then the bank drill', async () => {
    expect(await target('drill:js')).toBe(id('fund-js/01-alpha/01-a1'));
    expect(await target('drill:csharp')).toBe(id('bank/cs/01-first')); // no Fundamentals drills: unchanged rule
    submit(db, clock, id('fund-js/01-alpha/01-a1'));
    expect(await target('drill:js')).toBe(id('fund-js/01-alpha/02-a2'));
    submit(db, clock, id('fund-js/01-alpha/02-a2'));
    // topic 02's lesson is still locked behind topic 01's gate: no Fundamentals drill, the bank drill
    expect(await target('drill:js')).toBe(id('bank/js/01-first'));
    submit(db, clock, id('fund/js/01-alpha')); // the gate passes (verdict simulated)
    // a gate is passed and the passed topic has no drill left: never an unpassed topic's drill, the bank drill
    expect(await target('drill:js')).toBe(id('bank/js/01-first'));
    // never a study unit, even when it is the next open ladder step
    expect([id('fund/js/01-alpha'), id('fund/js/02-beta')]).not.toContain(await target('drill:js'));
  });

  it('after a passed gate: the HIGHEST passed topic that still has a drill, not the open next topic', async () => {
    submit(db, clock, id('fund/js/01-alpha'));
    // topic 02 is open now, but its gate is not passed: practise the passed topic 01
    expect(await target('drill:js')).toBe(id('fund-js/01-alpha/01-a1'));
    submit(db, clock, id('fund/js/02-beta'));
    // both passed: the higher topic first
    expect(await target('drill:js')).toBe(id('fund-js/02-beta/01-b1'));
    submit(db, clock, id('fund-js/02-beta/01-b1'));
    // topic 02 has nothing left: the next-highest passed topic that still has a drill
    expect(await target('drill:js')).toBe(id('fund-js/01-alpha/01-a1'));
  });

  it('a revealed Fundamentals drill is skipped', async () => {
    revealSolution(db, id('fund-js/01-alpha/01-a1'), clock);
    expect(await target('drill:js')).toBe(id('fund-js/01-alpha/02-a2'));
  });

  it('GET /drills/next is unchanged (first open drill in served order)', async () => {
    const res = await request(app).get('/api/drills/next?tracks=js&mode=mixed');
    expect(DrillNextResponse.parse(res.body).unit?.id).toBe(id('bank/js/01-first'));
  });
});

// the slate fallback never links a drill of a LOCKED Fundamentals topic, even when it is first in served order
describe('GET /api/dashboard: the drill-set fallback skips locked Fundamentals topics', { timeout: 30_000 }, () => {
  let tmp: TempDb;
  let db: Db;
  let clock: ReturnType<typeof fixedClock>;
  let app: Express;
  const id = (key: string) => db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', key)!.id;
  beforeEach(() => {
    tmp = makeTempDb();
    db = tmp.db;
    abSlate(db); // rv wave C: these pin the ab drill-set slots (every track on); the default day is the Fundamentals step
    clock = fixedClock(localNoon(2026, 10, 1));
    // the locked topic's drill has the LOWEST id: firstOpenDrill (and /drills/next) pick it
    for (const u of [
      drill('fund-js/02-beta/01-b1'),
      gate('fund/js/01-alpha'),
      gate('fund/js/02-beta', ['fund/js/01-alpha']),
      drill('fund-js/01-alpha/01-a1'),
      drill('bank/js/01-first'),
    ])
      insertUnit(db, u, clock);
    app = createApp({ db, clock, runners: { 'drill-js': fakeDrillJs } });
  });
  afterEach(() => tmp.cleanup());

  it('topic 01 done, its gate not passed: the bank drill, never topic 02 (locked); /drills/next unchanged', async () => {
    submit(db, clock, id('fund-js/01-alpha/01-a1'));
    const res = await request(app).get('/api/dashboard');
    expect(DashboardResponseExt.parse(res.body).slate.items.find((i) => i.slot === 'drill:js')?.targetUnitId).toBe(id('bank/js/01-first'));
    const next = await request(app).get('/api/drills/next?tracks=js&mode=mixed');
    expect(DrillNextResponse.parse(next.body).unit?.id).toBe(id('fund-js/02-beta/01-b1'));
  });
});
