/**
 * f52 U13 (council ruling 6): progressive hints.
 *   - GET /units/:id/hints + POST /units/:id/hint on drill / code-check units only (never a project kind,
 *     a retest or a variation: their passes are promotion legs a hint would silently forfeit);
 *   - the servable hints are the authored ones except the last (3 authored -> 2 served, 1 -> none);
 *   - a hint opens only after >= 1 failed graded submit and never after a verified pass;
 *   - each hint taken before the pass cuts its XP by 25% (floor 50%; rounded to the nearest XP); reveal stays 0;
 *   - a hinted pass is verified but never unassisted ladder evidence (leg (a)), and a hinted artifact
 *     is not waited on by its explain-back (it can never pass hint-free again);
 *   - hint_taken is append-only (migration 019).
 */
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HintsResponse, HintTakenResponse } from '@bootquest/shared/api-ext';
import { PROJECT_UNIT_KINDS } from '@bootquest/shared';
import { SubmitResponse, UnitDetailResponse } from '@bootquest/shared/api';
import { createApp } from '../../src/api/app.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import type { Db } from '../../src/db/database.ts';
import { fixedClock } from '../../src/engines/clock.ts';
import { evaluatePromotion, recordEvidence } from '../../src/engines/evidence.ts';
import { HINT_XP_FLOOR, hintXpMultiplier, recordHint, servableHints, UNASSISTED_PASS_SQL } from '../../src/engines/hints.ts';
import { artifactsAwaitingSoloPass } from '../../src/engines/ladder.ts';
import { fakeDrillJs } from './harness.ts';
import { localNoon, makeTempDb, makeUnit, submit, type TempDb } from '../helpers.ts';

const RIGHT = 'export const add = (a, b) => a + b;';
const WRONG = 'export const add = (a, b) => a - b;';

describe('hint rules (engine)', () => {
  it('serves every authored hint but the last', () => {
    expect(servableHints(undefined)).toEqual([]);
    expect(servableHints([])).toEqual([]);
    expect(servableHints(['only'])).toEqual([]);
    expect(servableHints(['a', 'b'])).toEqual(['a']);
    expect(servableHints(['a', 'b', 'c'])).toEqual(['a', 'b']);
  });

  it('XP multiplier: 100% / 75% / 50%, floored at 50%', () => {
    expect([0, 1, 2, 3, 9].map(hintXpMultiplier)).toEqual([1, 0.75, 0.5, 0.5, 0.5]);
    expect(HINT_XP_FLOOR).toBe(0.5);
  });
});

describe('GET /units/:id/hints + POST /units/:id/hint', () => {
  let tmp: TempDb;
  let db: Db;
  let clock: ReturnType<typeof fixedClock>;
  let app: Express;
  const ids: Record<string, number> = {};

  beforeEach(() => {
    tmp = makeTempDb();
    db = tmp.db;
    clock = fixedClock(localNoon(2026, 10, 1));
    ids.drill = makeUnit(db, clock, { key: 'h:drill', difficulty: 2 });
    ids.drill2 = makeUnit(db, clock, { key: 'h:drill2', difficulty: 2 });
    ids.plain = makeUnit(db, clock, { key: 'h:plain', difficulty: 2 });
    ids.one = makeUnit(db, clock, { key: 'h:one' });
    ids.quiz = makeUnit(db, clock, { key: 'h:quiz', kind: 'quiz' });
    ids.retest = makeUnit(db, clock, { key: 'h:retest', kind: 'retest', variationOf: 'h:drill' });
    ids.cs = makeUnit(db, clock, { key: 'h:cs', track: 'agentic' });
    ids.d1 = makeUnit(db, clock, { key: 'h:d1', difficulty: 1 });
    ids.d3 = makeUnit(db, clock, { key: 'h:d3', difficulty: 3 });
    ids.d3b = makeUnit(db, clock, { key: 'h:d3b', difficulty: 3 });
    // f52 fix: project kinds (promotion leg (a)) and a variation that is not kind-labelled retest (leg (c))
    for (const kind of PROJECT_UNIT_KINDS) ids[kind] = makeUnit(db, clock, { key: `h:${kind}`, kind });
    ids.variation = makeUnit(db, clock, { key: 'h:variation', variationOf: 'h:drill' });
    const three = { starter: WRONG, solution: RIGHT, hints: ['first nudge', 'second nudge', 'FULL SOLUTION HINT'] };
    app = createApp({
      db,
      clock,
      runners: { 'drill-js': fakeDrillJs },
      content: mapContentStore({
        'h:drill': three,
        'h:drill2': three,
        'h:plain': three,
        'h:one': { starter: WRONG, solution: RIGHT, hints: ['the only hint'] },
        'h:quiz': { hints: ['q1', 'q2', 'q3'] },
        'h:retest': three,
        'h:cs': three,
        'h:d1': three,
        'h:d3': three,
        'h:d3b': three,
        'h:variation': three,
        ...Object.fromEntries(PROJECT_UNIT_KINDS.map((k) => [`h:${k}`, three])),
      }),
    });
  });
  afterEach(() => tmp.cleanup());

  const hints = async (id: number) => {
    const res = await request(app).get(`/api/units/${id}/hints`);
    expect(res.status).toBe(200);
    return HintsResponse.parse(res.body);
  };
  const take = (id: number) => request(app).post(`/api/units/${id}/hint`).send({});
  const send = async (id: number, code: string) => {
    const res = await request(app).post(`/api/units/${id}/submit`).send({ code, selfAssisted: false });
    expect(res.status).toBe(200);
    return SubmitResponse.parse(res.body);
  };
  const rows = () => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM hint_taken')!.n;

  it('a drill with 3 authored hints serves 2, and only after a failed submit', async () => {
    expect(await hints(ids.drill!)).toEqual({ unitId: ids.drill, total: 2, taken: [], nextAvailable: false, lockedReason: 'needs-fail', xpPct: 100 });
    const early = await take(ids.drill!);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('NOT_ANSWERED');
    expect(rows()).toBe(0);

    await send(ids.drill!, WRONG);
    expect(await hints(ids.drill!)).toMatchObject({ total: 2, taken: [], nextAvailable: true, xpPct: 100 });
    expect((await hints(ids.drill!)).lockedReason).toBeUndefined();

    const first = await take(ids.drill!);
    expect(first.status).toBe(200);
    expect(HintTakenResponse.parse(first.body)).toEqual({
      unitId: ids.drill,
      total: 2,
      taken: ['first nudge'],
      nextAvailable: true,
      xpPct: 75,
      hint: { index: 1, text: 'first nudge' },
    });
    const second = HintTakenResponse.parse((await take(ids.drill!)).body);
    expect(second).toMatchObject({ taken: ['first nudge', 'second nudge'], nextAvailable: false, lockedReason: 'exhausted', xpPct: 50, hint: { index: 2, text: 'second nudge' } });
    const third = await take(ids.drill!);
    expect(third.status).toBe(404);
    expect(third.body.error.code).toBe('NOT_FOUND');
    expect(rows()).toBe(2);

    // the last authored hint never leaves the server (hints endpoint, unit detail)
    expect(JSON.stringify(await hints(ids.drill!))).not.toContain('FULL SOLUTION');
    const detail = UnitDetailResponse.parse((await request(app).get(`/api/units/${ids.drill}`)).body);
    expect(JSON.stringify(detail)).not.toMatch(/nudge|FULL SOLUTION/);
  });

  it('pass XP: 25% off per hint taken before the pass (floor 50%); no hint = full XP', async () => {
    // difficulty 2 drill = 20 code XP
    await send(ids.plain!, WRONG);
    expect((await send(ids.plain!, RIGHT)).xp).toMatchObject({ amount: 20, reason: null });

    await send(ids.drill!, WRONG);
    await take(ids.drill!);
    expect((await send(ids.drill!, RIGHT)).xp).toMatchObject({ amount: 15, reason: null });

    await send(ids.drill2!, WRONG);
    await take(ids.drill2!);
    await take(ids.drill2!);
    const r = await send(ids.drill2!, RIGHT);
    expect(r.verdict).toBe('pass'); // a hinted pass is a verified pass
    expect(r.xp).toMatchObject({ amount: 10, reason: null });
  });

  it('pass XP rounds to the nearest whole XP: 75% of 10 -> 8, of 30 -> 23; 50% of 30 -> 15', async () => {
    const hinted = async (id: number, n: number) => {
      await send(id, WRONG);
      for (let i = 0; i < n; i++) expect((await take(id)).status).toBe(200);
      return (await send(id, RIGHT)).xp;
    };
    expect(await hinted(ids.d1!, 1)).toMatchObject({ amount: 8, reason: null });
    expect(await hinted(ids.d3!, 1)).toMatchObject({ amount: 23, reason: null });
    expect(await hinted(ids.d3b!, 2)).toMatchObject({ amount: 15, reason: null });
  });

  it('no hint after a verified pass', async () => {
    await send(ids.drill!, WRONG);
    await send(ids.drill!, RIGHT);
    expect(await hints(ids.drill!)).toMatchObject({ nextAvailable: false, lockedReason: 'passed', taken: [] });
    const res = await take(ids.drill!);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_ANSWERED');
  });

  it('not hintable: a single authored hint, quiz, retest, a variation, every project kind; POST refuses', async () => {
    // a failed submit first, so the only reason left to refuse is the unit itself
    for (const id of [ids.retest!, ids.variation!, ...PROJECT_UNIT_KINDS.map((k) => ids[k]!)]) submit(db, clock, id, { pass: false });
    for (const id of [ids.one!, ids.quiz!, ids.retest!, ids.variation!, ...PROJECT_UNIT_KINDS.map((k) => ids[k]!)]) {
      expect(await hints(id)).toMatchObject({ total: 0, taken: [], nextAvailable: false, lockedReason: 'not-hintable' });
      const res = await take(id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('WRONG_UNIT_KIND');
    }
    expect(rows()).toBe(0);
  });

  it('a locked track serves no hint (403), unknown unit 404, a body is refused', async () => {
    db.run(`UPDATE track SET locked = 1 WHERE id = 'agentic'`);
    expect(await hints(ids.cs!)).toMatchObject({ total: 2, nextAvailable: false, lockedReason: 'locked' });
    const res = await take(ids.cs!);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TRACK_LOCKED');
    expect((await request(app).get('/api/units/99999/hints')).status).toBe(404);
    expect((await request(app).post(`/api/units/${ids.drill}/hint`).send({ idx: 3 })).status).toBe(400);
  });

  it('hint_taken is append-only', async () => {
    await send(ids.drill!, WRONG);
    await take(ids.drill!);
    const id = db.get<{ id: number }>('SELECT id FROM hint_taken')!.id;
    expect(() => db.run('UPDATE hint_taken SET idx = 5 WHERE id = ?', id)).toThrow(/append-only/);
    expect(() => db.run('DELETE FROM hint_taken WHERE id = ?', id)).toThrow(/append-only/);
    expect(() => db.run('INSERT OR REPLACE INTO hint_taken (id, unit_id, idx, created_at) SELECT id, unit_id, idx, created_at FROM hint_taken WHERE id = ?', id)).toThrow(/append-only/);
    expect(rows()).toBe(1);
  });
});

describe('a hinted pass is not unassisted ladder evidence', () => {
  let tmp: TempDb;
  let db: Db;
  let clock: ReturnType<typeof fixedClock>;
  beforeEach(() => {
    tmp = makeTempDb();
    db = tmp.db;
    clock = fixedClock(localNoon(2026, 10, 1));
  });
  afterEach(() => tmp.cleanup());

  function artifact(hinted: boolean): number {
    const unitId = makeUnit(db, clock, { kind: 'guided-project', competencies: ['feature-delivery'] });
    submit(db, clock, unitId, { pass: false });
    clock.advance(1000);
    if (hinted) recordHint(db, unitId, clock);
    clock.advance(1000);
    const pass = submit(db, clock, unitId, { pass: true });
    recordEvidence(db, { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', attemptId: pass.id }, clock);
    return unitId;
  }

  it('UNASSISTED_PASS_SQL is the one unassisted-pass predicate: solo + verified + hint-free', () => {
    const unassisted = (attemptId: number) => db.get(`SELECT 1 AS x FROM attempt a WHERE a.id = ? AND ${UNASSISTED_PASS_SQL}`, attemptId) !== undefined;
    const plain = makeUnit(db, clock);
    const ok = submit(db, clock, plain, { pass: true });
    const flagged = submit(db, clock, makeUnit(db, clock), { pass: true, selfAssisted: true });
    const failed = submit(db, clock, makeUnit(db, clock), { pass: false });
    const hintedUnit = makeUnit(db, clock);
    const before = submit(db, clock, hintedUnit, { pass: false });
    clock.advance(1000);
    recordHint(db, hintedUnit, clock);
    const hinted = submit(db, clock, hintedUnit, { pass: true }); // same millisecond as the hint: hinted
    // a hinted pass is stored as an ordinary solo pass (Assistance has no 'hint'); only the predicate tells it apart
    expect(hinted.mode).toBe('solo');
    expect(hinted.assistance_source).toBe('none');
    expect([ok, flagged, failed, before, hinted].map((a) => unassisted(a.id))).toEqual([true, false, false, false, false]);
  });

  it('leg (a): an unhinted solo pass counts, a hinted one does not', () => {
    artifact(true);
    expect(evaluatePromotion(db, 'feature-delivery', clock).legs.artifact).toBeNull();
    artifact(false);
    expect(evaluatePromotion(db, 'feature-delivery', clock).legs.artifact).not.toBeNull();
  });

  it('an explain-back does not wait on a hinted artifact (it can never pass hint-free)', () => {
    const art = makeUnit(db, clock, { key: 'h:art', kind: 'guided-project', competencies: ['feature-delivery'] });
    const eb = makeUnit(db, clock, { kind: 'explain-back', prerequisites: ['h:art'], competencies: ['feature-delivery'] });
    expect(artifactsAwaitingSoloPass(db, eb).map((p) => p.unitId)).toEqual([art]);
    submit(db, clock, art, { pass: false });
    recordHint(db, art, clock);
    expect(artifactsAwaitingSoloPass(db, eb)).toEqual([]);
  });
});
