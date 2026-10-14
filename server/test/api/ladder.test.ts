import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import {
  ApiErrorBody,
  AttemptDetailResponse,
  CompetenciesResponse,
  DashboardResponse,
  EvidenceListResponse,
  ExplainBackKeyResponse,
  ExplainBackScoreResponse,
  KataKeyResponse,
  KataScoreResponse,
  KataStatsResponse,
  MutationMarkerResponse,
  ReviewQueueResponse,
  SubmitResponse,
  UnitDetailResponse,
} from '@bootquest/shared/api';
import type { SeedExplainBackItem, SeedPatchKataItem } from '@bootquest/shared';
import { createApp } from '../../src/api/app.ts';
import type { Runner } from '../../src/api/runners.ts';
import { DAY_MS, fixedClock } from '../../src/engines/clock.ts';
import { getRating } from '../../src/engines/evidence.ts';
import { revealSolution } from '../../src/engines/attempts.ts';
import { retestGate } from '../../src/engines/ladder.ts';
import { assertUniqueSeedItemRefs } from '../../src/store/ladder.ts';
import { insertUnit } from '../../src/store/content.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
import { loadSeedItemStore, mapSeedItemStore, SeedItemLoadError } from '../../src/store/seed-items.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';
import fixture from '../fixtures/ladder-fixture.json' with { type: 'json' };

const EB = fixture.seedItems.find((i) => i.kind === 'explain-back') as unknown as SeedExplainBackItem;
/** explain-low's OWN set (W7: two live units never share a question set) */
const EB_LOW = fixture.seedItems.find((i) => i.key === (fixture.units.find((u) => u.key === 'fixture:ladder/explain-low')!.checks[0]!.spec as { questionSetKey: string }).questionSetKey) as unknown as SeedExplainBackItem;
const LOW_IDS = EB_LOW.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => `q${qi + 1}k${ki + 1}`));
const marksLow = (coveredCount: number) => Object.fromEntries(LOW_IDS.map((id, i) => [id, i < coveredCount ? 'covered' : 'missed']));
const KATAS = fixture.seedItems.filter((i) => i.kind === 'patch-kata') as unknown as SeedPatchKataItem[];
const KEY_POINT_IDS = EB.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => `q${qi + 1}k${ki + 1}`));
const GOOD_PORT = 4000;
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

/** fake http runner: the "learner's server" is up iff they send port 4000 */
const fakeHttp: Runner = async (_spec, sub) =>
  sub.port === GOOD_PORT
    ? { pass: true, output: '', failures: [], durationMs: 1 }
    : { pass: false, output: '', failures: [{ name: 'health answers ok', message: 'connection refused' }], durationMs: 1 };
/** fake drill runner: passes iff the code caps at 100 */
const fakeDrill: Runner = async (_spec, sub) =>
  /Math\.min\(n, 100\)/.test(sub.code ?? '')
    ? { pass: true, output: '', failures: [], durationMs: 1 }
    : { pass: false, output: '', failures: [{ name: 'caps at 100', message: 'wrong' }], durationMs: 1 };

interface Ctx {
  tmp: TempDb;
  clock: ReturnType<typeof fixedClock>;
  app: Express;
  id(key: string): number;
}

function useLadder(): Ctx {
  const ctx = {} as Ctx;
  beforeEach(() => {
    ctx.tmp = makeTempDb();
    ctx.clock = fixedClock(localNoon(2026, 10, 1));
    const ids = new Map<string, number>();
    for (const u of fixture.units) ids.set(u.key, insertUnit(ctx.tmp.db, u, ctx.clock));
    ctx.id = (k) => {
      const v = ids.get(k);
      if (v === undefined) throw new Error(`no fixture unit ${k}`);
      return v;
    };
    ctx.app = createApp({
      db: ctx.tmp.db,
      clock: ctx.clock,
      runners: { http: fakeHttp, 'drill-js': fakeDrill },
      seedItems: mapSeedItemStore(fixture.seedItems),
    });
  });
  afterEach(() => ctx.tmp.cleanup());
  return ctx;
}

function expectError(res: request.Response, status: number, code: string): void {
  expect(res.status, res.text).toBe(status);
  expect(ApiErrorBody.parse(res.body).error.code).toBe(code);
}

const ANSWERS = ['the permission test guards read-only roles', 'the state machine test guards transitions', 'tenant isolation is tested per repository'];
const marks = (coveredCount: number) => Object.fromEntries(KEY_POINT_IDS.map((id, i) => [id, i < coveredCount ? 'covered' : 'missed']));

describe('explain-back: immutable answer first, then the key, then the self-score', () => {
  const ctx = useLadder();

  it('GET /units/:id serves the questions ONLY: no key point text, quote or cite anywhere in the payload', async () => {
    const res = await request(ctx.app).get(`/api/units/${ctx.id('fixture:ladder/explain-api')}`);
    expect(res.status).toBe(200);
    const body = UnitDetailResponse.parse(res.body);
    expect(body.explainBack?.questions.map((q) => q.prompt)).toEqual(EB.questions.map((q) => q.prompt));
    expect(body.explainBack?.minCoveragePct).toBe(80);
    for (const q of EB.questions) {
      for (const kp of q.keyPoints) {
        expect(res.text).not.toContain(kp.text);
        if (kp.quote) expect(res.text).not.toContain(kp.quote.slice(0, 40));
      }
    }
    expect(res.text).not.toMatch(/keyPoints|"quote"|"cite"/);
  });

  it('key is 403 NOT_ANSWERED before the answer row exists; the answer is append-only (403 on re-answer)', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    // W9 (ui-audit #10): detail says whether the key is readable, so the client need not probe it
    expect(UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${id}`)).body).explainBack?.answered).toBe(false);
    expectError(await request(ctx.app).get(`/api/units/${id}/explain-back/key`), 403, 'NOT_ANSWERED');
    expectError(await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(16) }), 403, 'NOT_ANSWERED');

    const before = ledgerCounts(ctx.tmp.db);
    const ans = await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS });
    expect(ans.status, ans.text).toBe(200);
    expect(ans.body).toMatchObject({ mode: 'solo', outcome: 'submitted' });
    expect(ledgerCounts(ctx.tmp.db)).toEqual({ ...before, attempt: before.attempt + 1 }); // no XP / evidence for the bare answer

    expectError(await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }), 403, 'ALREADY_ANSWERED');
    expect(() => ctx.tmp.db.run('UPDATE attempt SET answer = ? WHERE id = ?', '{"explainBack":{}}', ans.body.attemptId)).toThrow(/append-only/);

    const key = ExplainBackKeyResponse.parse((await request(ctx.app).get(`/api/units/${id}/explain-back/key`)).body);
    expect(key.attemptId).toBe(ans.body.attemptId);
    expect(key.answers).toEqual(ANSWERS);
    expect(key.questions.flatMap((q) => q.keyPoints.map((k) => k.id))).toEqual(KEY_POINT_IDS);
    expect(key.questions[0]!.keyPoints[0]!.text).toBe(EB.questions[0]!.keyPoints[0]!.text);
    expect(key.scored).toBeNull();
    expect(UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${id}`)).body).explainBack?.answered).toBe(true);
  });

  it('strict bodies: exactly 3 non-empty answers, no extra fields; every key point marked exactly once', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    const url = `/api/units/${id}/explain-back/answers`;
    expectError(await request(ctx.app).post(url).send({ answers: ANSWERS.slice(0, 2) }), 400, 'VALIDATION');
    expectError(await request(ctx.app).post(url).send({ answers: [...ANSWERS.slice(0, 2), '   '] }), 400, 'VALIDATION');
    expectError(await request(ctx.app).post(url).send({ answers: ANSWERS, assistance: 'none' }), 400, 'VALIDATION');
    expectError(await request(ctx.app).post(url).send({ answers: ANSWERS, score: 1 }), 400, 'VALIDATION');
    await request(ctx.app).post(url).send({ answers: ANSWERS }).expect(200);
    const score = `/api/units/${id}/explain-back/self-score`;
    const partial = marks(16);
    delete (partial as Record<string, string>).q3k5;
    expectError(await request(ctx.app).post(score).send({ perKeyPoint: partial }), 400, 'VALIDATION');
    expectError(await request(ctx.app).post(score).send({ perKeyPoint: { ...marks(16), q9k9: 'covered' } }), 400, 'VALIDATION');
    expectError(await request(ctx.app).post(score).send({ perKeyPoint: marks(16), coverage: 1 }), 400, 'VALIDATION');
  });

  it('>= 80% coverage: self-assessed evidence, 20 XP once, the retest scheduled >= 2 days out; re-scoring is 409', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    await request(ctx.app).post(`/api/units/${ctx.id('fixture:ladder/project-api')}/submit`).send({ port: GOOD_PORT }).expect(200);
    ctx.clock.advance(60_000);
    const ans = await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    ctx.clock.advance(60_000);
    const res = await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(14) });
    expect(res.status, res.text).toBe(200);
    const body = ExplainBackScoreResponse.parse(res.body);
    expect(body).toMatchObject({ covered: 14, total: 16, passed: true, minCoveragePct: 80 });
    expect(body.coverage).toBeCloseTo(0.875);
    expect(body.missed).toEqual(['q3k4', 'q3k5']);
    expect(body.xp).toMatchObject({ amount: 20, reason: null });
    const ev = ctx.tmp.db.get<{ kind: string; assessor: string; score: number; attempt_id: number; assistance: string }>('SELECT * FROM evidence WHERE id = ?', body.evidenceIds[0]!)!;
    expect(ev).toMatchObject({ kind: 'explain-back', assessor: 'self', attempt_id: ans.body.attemptId, assistance: 'none' });
    expect(ev.score).toBeCloseTo(0.875);
    expect(body.retests).toHaveLength(1);
    expect(body.retests[0]!.unitId).toBe(ctx.id('fixture:ladder/project-api-retest'));
    expect(body.retests[0]!.dueAt).toBe(localNoon(2026, 10, 1).getTime() + 60_000 + 2 * DAY_MS);
    expect(body.promotions).toEqual([]);

    expectError(await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(16) }), 409, 'ALREADY_SCORED');
    const key = ExplainBackKeyResponse.parse((await request(ctx.app).get(`/api/units/${id}/explain-back/key`)).body);
    expect(key.scored?.score).toBeCloseTo(0.875);

    // the retest schedule is NOT an FSRS card: absent from the review queue, refused by the grader
    const q = ReviewQueueResponse.parse((await request(ctx.app).get('/api/reviews/queue')).body);
    expect(q.count).toBe(0);
    ctx.clock.advance(3 * DAY_MS);
    expect(ReviewQueueResponse.parse((await request(ctx.app).get('/api/reviews/queue')).body).count).toBe(0);
    expectError(await request(ctx.app).post(`/api/reviews/${body.retests[0]!.reviewItemId}/grade`).send({ grade: 'good' }), 409, 'WRONG_UNIT_KIND');
  });

  it('< 80% coverage: recorded honestly, no XP, no retest, the promotion leg shows failed', async () => {
    const id = ctx.id('fixture:ladder/explain-low');
    await request(ctx.app).post(`/api/units/${ctx.id('fixture:ladder/project-low')}/submit`).send({ port: GOOD_PORT }).expect(200);
    await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const lowN = LOW_IDS.length - 5; // 17/22 = 77.3%
    const body = ExplainBackScoreResponse.parse((await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marksLow(lowN) })).body);
    expect(body).toMatchObject({ covered: lowN, total: LOW_IDS.length, passed: false, xp: null, retests: [], promotions: [] });
    expect(body.coverage).toBeCloseTo(lowN / LOW_IDS.length);
    const comp = CompetenciesResponse.parse((await request(ctx.app).get('/api/competencies')).body);
    const row = comp.competencies.find((c) => c.id === 'data-http')!;
    expect(row.promotion.artifact.state).toBe('done');
    expect(row.promotion.explainBack).toMatchObject({ state: 'failed' });
    expect(row.promotion.explainBack.coverage).toBeCloseTo(lowN / LOW_IDS.length);
    expect(row.promotion.retest.state).toBe('pending');
    expect(comp.retests).toEqual([]);
  });

  it('the self-score must be filed in the same sitting (24h window) -> 409 SCORE_WINDOW_CLOSED', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    ctx.clock.advance(DAY_MS + 1);
    expectError(await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(16) }), 409, 'SCORE_WINDOW_CLOSED');
  });

  it('W7 audit #12a: exactly 24h after the answer the window is still open (the engine refuses only > 24h)', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    ctx.clock.advance(DAY_MS);
    const res = await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(16) });
    expect(res.status, res.text).toBe(200);
  });

  it('W7 audit #12e: a unit stricter than the floor (minCoverage 0.9) shows AND enforces 90%; a laxer one is floored at 80%', async () => {
    const strict = insertUnit(
      ctx.tmp.db,
      { key: 'fixture:ladder/explain-strict', track: 'js', kind: 'explain-back', title: '[fixture] strict', competencies: ['data-http'], checks: [{ spec: { type: 'explain-back', questionSetKey: 'seed:explainback:strict-copy', minCoverage: 0.9 } }] },
      ctx.clock,
    );
    const lax = insertUnit(
      ctx.tmp.db,
      { key: 'fixture:ladder/explain-lax', track: 'js', kind: 'explain-back', title: '[fixture] lax', competencies: ['data-http'], checks: [{ spec: { type: 'explain-back', questionSetKey: 'seed:explainback:lax-copy', minCoverage: 0.5 } }] },
      ctx.clock,
    );
    const app = createApp({
      db: ctx.tmp.db,
      clock: ctx.clock,
      runners: {},
      seedItems: mapSeedItemStore([...fixture.seedItems, { ...EB, key: 'seed:explainback:strict-copy' }, { ...EB, key: 'seed:explainback:lax-copy' }]),
    });
    expect(UnitDetailResponse.parse((await request(app).get(`/api/units/${strict}`)).body).explainBack?.minCoveragePct).toBe(90);
    expect(UnitDetailResponse.parse((await request(app).get(`/api/units/${lax}`)).body).explainBack?.minCoveragePct).toBe(80);
    await request(app).post(`/api/units/${strict}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const s1 = ExplainBackScoreResponse.parse((await request(app).post(`/api/units/${strict}/explain-back/self-score`).send({ perKeyPoint: marks(14) })).body);
    expect(s1).toMatchObject({ passed: false, minCoveragePct: 90, xp: null, retests: [] }); // 87.5% < 90%
    await request(app).post(`/api/units/${lax}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const s2 = ExplainBackScoreResponse.parse((await request(app).post(`/api/units/${lax}/explain-back/self-score`).send({ perKeyPoint: marks(12) })).body);
    expect(s2).toMatchObject({ passed: false, minCoveragePct: 80 }); // 75% passes 50% but never the 80% floor
  });

  it('W7 audit #3: answer-before-key is per QUESTION SET: a second unit on the same set cannot be answered after the first; startup refuses the pair', async () => {
    const twin = insertUnit(
      ctx.tmp.db,
      { key: 'fixture:ladder/explain-twin', track: 'js', kind: 'explain-back', title: '[fixture] twin', competencies: ['data-http'], checks: [{ spec: { type: 'explain-back', questionSetKey: EB.key } }] },
      ctx.clock,
    );
    const a = ctx.id('fixture:ladder/explain-api');
    expect(() => assertUniqueSeedItemRefs(ctx.tmp.db)).toThrow(/more than one live unit/);
    const ans = await request(ctx.app).post(`/api/units/${a}/explain-back/answers`).send({ answers: ANSWERS });
    expect(ans.status).toBe(200);
    await request(ctx.app).get(`/api/units/${a}/explain-back/key`).expect(200); // the key of S is now seen
    const before = ledgerCounts(ctx.tmp.db);
    const res = await request(ctx.app).post(`/api/units/${twin}/explain-back/answers`).send({ answers: ANSWERS });
    expectError(res, 403, 'ALREADY_ANSWERED');
    expect(res.body.error.message).toMatch(new RegExp(`answered on unit ${a}`));
    expect(ledgerCounts(ctx.tmp.db)).toEqual(before);
    // and the twin cannot self-score the first unit's answer either
    expectError(await request(ctx.app).post(`/api/units/${twin}/explain-back/self-score`).send({ perKeyPoint: marks(16) }), 403, 'ALREADY_ANSWERED');
  });

  it('W7 audit #8: a re-seeded item (same key, changed content) refuses the old answer\'s key / self-score with 409 CONTENT_CHANGED', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const changed = { ...EB, questions: EB.questions.map((q, i) => (i === 0 ? { ...q, keyPoints: q.keyPoints.slice(1) } : q)) };
    const app = createApp({ db: ctx.tmp.db, clock: ctx.clock, runners: {}, seedItems: mapSeedItemStore([changed, ...KATAS]) });
    expectError(await request(app).get(`/api/units/${id}/explain-back/key`), 409, 'CONTENT_CHANGED');
    expectError(await request(app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(15) }), 409, 'CONTENT_CHANGED');
    await request(ctx.app).get(`/api/units/${id}/explain-back/key`).expect(200); // the original content still serves its key
  });

  it('explain-back / kata units are never run or submitted through /run or /submit', async () => {
    for (const k of ['fixture:ladder/explain-api', 'fixture:ladder/kata-1']) {
      expectError(await request(ctx.app).post(`/api/units/${ctx.id(k)}/submit`).send({ answer: 'x' }), 409, 'WRONG_UNIT_KIND');
      expectError(await request(ctx.app).post(`/api/units/${ctx.id(k)}/run`).send({ answer: 'x' }), 409, 'WRONG_UNIT_KIND');
    }
  });

  it('content pending: a unit whose question set is not loaded serves explainBack: null and refuses answers', async () => {
    const app = createApp({ db: ctx.tmp.db, clock: ctx.clock, runners: {} });
    const id = ctx.id('fixture:ladder/explain-api');
    const body = UnitDetailResponse.parse((await request(app).get(`/api/units/${id}`)).body);
    expect(body.explainBack).toBeNull();
    expectError(await request(app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }), 409, 'CONTENT_PENDING');
  });
});

describe('the promotion cycle through the HTTP API (artifact -> explain-back -> >=2-day retest)', () => {
  const ctx = useLadder();

  it('retest refused at +1 day (nothing recorded), passes at the due time and promotes 1 -> 2 with linked legs', async () => {
    const project = ctx.id('fixture:ladder/project-api');
    const retest = ctx.id('fixture:ladder/project-api-retest');
    const eb = ctx.id('fixture:ladder/explain-api');
    const art = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${project}/submit`).send({ port: GOOD_PORT })).body);
    expect(art.verdict).toBe('pass');
    const artEv = ctx.tmp.db.get<{ kind: string; verified: boolean; assessor: string }>('SELECT kind, verified, assessor FROM evidence WHERE id = ?', art.evidenceIds[0]!)!;
    expect(artEv).toEqual({ kind: 'artifact', verified: true, assessor: 'pipeline' }); // db hygiene: 0/1 -> boolean
    await request(ctx.app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const score = ExplainBackScoreResponse.parse((await request(ctx.app).post(`/api/units/${eb}/explain-back/self-score`).send({ perKeyPoint: marks(14) })).body);
    const dueAt = score.retests[0]!.dueAt;

    let comp = CompetenciesResponse.parse((await request(ctx.app).get('/api/competencies')).body);
    let row = comp.competencies.find((c) => c.id === 'data-http')!;
    expect(row.promotion).toMatchObject({ targetRating: 2, eligible: false, artifact: { state: 'done' }, explainBack: { state: 'done' }, retest: { state: 'scheduled', dueAt, unitId: retest } });
    expect(comp.retests).toEqual([expect.objectContaining({ unitId: retest, dueAt, due: false })]);

    ctx.clock.advance(DAY_MS);
    const before = ledgerCounts(ctx.tmp.db);
    expectError(await request(ctx.app).post(`/api/units/${retest}/submit`).send({ code: fixture.solutions.retest }), 409, 'NOT_DUE');
    expect(ledgerCounts(ctx.tmp.db)).toEqual(before);
    // W7 (audit #1): NO free pre-solving runs either, and the task itself is withheld until due
    expectError(await request(ctx.app).post(`/api/units/${retest}/run`).send({ code: fixture.solutions.retest }), 409, 'NOT_DUE');
    const closed = UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${retest}`)).body);
    expect(closed.retestGate).toEqual({ open: false, reason: 'not-due', opensAt: dueAt });
    expect(closed).toMatchObject({ instructions: null, starter: null, snippet: null, check: null });
    expect(getRating(ctx.tmp.db, 'data-http')).toBe(1);

    ctx.clock.set(dueAt);
    const open = UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${retest}`)).body);
    expect(open.retestGate).toEqual({ open: true, reason: 'due', opensAt: null });
    expect(open.check?.spec.type).toBe('drill-js');
    expect((await request(ctx.app).post(`/api/units/${retest}/run`).send({ code: fixture.solutions.retest })).status).toBe(200);
    const rt = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${retest}/submit`).send({ code: fixture.solutions.retest })).body);
    expect(rt.verdict).toBe('pass');
    expect(rt.promotions).toEqual([expect.objectContaining({ competency: 'data-http', from: 1, to: 2 })]);
    expect(getRating(ctx.tmp.db, 'data-http')).toBe(2);
    const promo = ctx.tmp.db.get<{ observation: string }>('SELECT observation FROM evidence WHERE id = ?', rt.promotions![0]!.evidenceId)!;
    expect(promo.observation).toBe(`legs: artifact #${art.evidenceIds[0]}, explain-back #${score.evidenceIds[0]}, retest #${rt.evidenceIds[0]}`);

    comp = CompetenciesResponse.parse((await request(ctx.app).get('/api/competencies')).body);
    row = comp.competencies.find((c) => c.id === 'data-http')!;
    expect(row.rating).toBe(2);
    expect(row.promotion).toMatchObject({ targetRating: 3, artifact: { state: 'pending' }, retest: { state: 'pending' } });
    expect(comp.retests).toEqual([]); // passed at/after the due time -> done
    const dash = DashboardResponse.parse((await request(ctx.app).get('/api/dashboard')).body);
    expect(dash.competencies.find((c) => c.id === 'data-http')?.promotion?.targetRating).toBe(3);
  });

  it('W7 audit #1: an UNSCHEDULED retest refuses run + submit (409 RETEST_NOT_OPEN) and withholds its task; nothing is recorded', async () => {
    const retest = ctx.id('fixture:ladder/project-api-retest');
    const before = ledgerCounts(ctx.tmp.db);
    expectError(await request(ctx.app).post(`/api/units/${retest}/run`).send({ code: fixture.solutions.retest }), 409, 'RETEST_NOT_OPEN');
    expectError(await request(ctx.app).post(`/api/units/${retest}/submit`).send({ code: fixture.solutions.retest }), 409, 'RETEST_NOT_OPEN');
    expect(ledgerCounts(ctx.tmp.db)).toEqual(before);
    const d = UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${retest}`)).body);
    expect(d.retestGate).toEqual({ open: false, reason: 'not-scheduled', opensAt: null });
    expect(d).toMatchObject({ instructions: null, starter: null, check: null });
  });

  it('W7 audit #1: when a newer schedule is not due, an older DUE schedule does not open the gate', async () => {
    const retest = ctx.id('fixture:ladder/project-api-retest');
    const t = ctx.clock().getTime();
    const ins = (due: number, eb: number) =>
      ctx.tmp.db.run(
        `INSERT INTO review_item (card_key, kind, unit_id, content_ref_id, competency_id, fsrs_state, due_at, created_at, updated_at) VALUES (?, 'retest', ?, NULL, NULL, ?, ?, ?, ?)`,
        `retest:u${retest}:eb${eb}`,
        retest,
        JSON.stringify({ retest: { artifactUnitId: ctx.id('fixture:ladder/project-api'), explainBackAttemptId: eb } }),
        due,
        t,
        t,
      );
    ins(t - DAY_MS, 9001); // an old cycle, due
    expect(retestGate(ctx.tmp.db, retest, ctx.clock)).toEqual({ open: true, reason: 'due', opensAt: null });
    ins(t + DAY_MS, 9002); // the new cycle, not due yet
    expect(retestGate(ctx.tmp.db, retest, ctx.clock)).toEqual({ open: false, reason: 'not-due', opensAt: t + DAY_MS });
    expectError(await request(ctx.app).post(`/api/units/${retest}/run`).send({ code: fixture.solutions.retest }), 409, 'NOT_DUE');
  });

  it('W7 audit #1 carve-out + #6: after the ARTIFACT is revealed the retest opens as guided practice, auto-flagged, never a leg', async () => {
    const project = ctx.id('fixture:ladder/project-api');
    const retest = ctx.id('fixture:ladder/project-api-retest');
    revealSolution(ctx.tmp.db, project, ctx.clock); // engine path: the http-lab fixture has no content solution
    const d = UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${retest}`)).body);
    expect(d.retestGate).toEqual({ open: true, reason: 'practice', opensAt: null });
    expect((await request(ctx.app).post(`/api/units/${retest}/run`).send({ code: fixture.solutions.retest })).status).toBe(200);
    const sub = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${retest}/submit`).send({ code: fixture.solutions.retest })).body);
    expect(sub.verdict).toBe('pass');
    expect(sub.attempt.mode).toBe('guided'); // the reveal on the variation_of ancestor taints the retest
    expect(sub.xp?.amount ?? 0).toBe(0);
    expect(sub.promotions).toEqual([]);
  });

  it('an assisted artifact never anchors a promotion', async () => {
    const res = SubmitResponse.parse(
      (await request(ctx.app).post(`/api/units/${ctx.id('fixture:ladder/project-assisted')}/submit`).send({ port: GOOD_PORT, selfAssisted: true })).body,
    );
    expect(res.attempt.mode).toBe('assisted');
    const comp = CompetenciesResponse.parse((await request(ctx.app).get('/api/competencies')).body);
    expect(comp.competencies.find((c) => c.id === 'data-http')!.promotion.artifact.state).toBe('pending');
  });
});

describe('patch-review kata: findings first, then the seeded-defect key, then the catch rate', () => {
  const ctx = useLadder();
  const FINDING = { scenario: 'a tenant with two rules where one matches', evidence: 'allocationSummary.mjs:17 uses rules.length', consequence: 'the summary overstates coverage' };

  it('detail serves diff + context, never the key; key 403 before findings; findings append-only', async () => {
    const id = ctx.id('fixture:ladder/kata-2');
    const kata = KATAS[1]!;
    const res = await request(ctx.app).get(`/api/units/${id}`);
    const body = UnitDetailResponse.parse(res.body);
    expect(body.kata).toMatchObject({ title: kata.title, diff: kata.diff });
    // W7 (audit #9): blind review — the defect COUNT is not public before the findings are recorded
    expect(body.kata).not.toHaveProperty('defectCount');
    expect(body.check?.spec).not.toHaveProperty('defectCount');
    expect(res.text).not.toContain('defectCount');
    expect(body.kata?.contextFiles.map((f) => f.path)).toEqual(kata.contextFiles.map((f) => f.path));
    for (const d of kata.seededDefectKey) {
      expect(res.text).not.toContain(d.consequence);
      expect(res.text).not.toContain(d.scenario);
    }
    expect(res.text).not.toMatch(/seededDefectKey|findingRef|"test"/);

    expectError(await request(ctx.app).get(`/api/units/${id}/kata/key`), 403, 'NOT_ANSWERED');
    expectError(await request(ctx.app).post(`/api/units/${id}/kata/findings`).send({ findings: [] }), 400, 'VALIDATION');
    expectError(await request(ctx.app).post(`/api/units/${id}/kata/findings`).send({ findings: [{ ...FINDING, severity: 'high' }] }), 400, 'VALIDATION');
    expectError(await request(ctx.app).post(`/api/units/${id}/kata/findings`).send({ findings: [{ ...FINDING, consequence: ' ' }] }), 400, 'VALIDATION');
    await request(ctx.app).post(`/api/units/${id}/kata/findings`).send({ findings: [FINDING] }).expect(200);
    expectError(await request(ctx.app).post(`/api/units/${id}/kata/findings`).send({ findings: [FINDING] }), 403, 'ALREADY_ANSWERED');

    const key = KataKeyResponse.parse((await request(ctx.app).get(`/api/units/${id}/kata/key`)).body);
    expect(key.findings).toEqual([FINDING]);
    expect(key.defects.map((d) => d.consequence)).toEqual(kata.seededDefectKey.map((d) => d.consequence));
    expect(key.defects.map((d) => d.id)).toEqual(['d1', 'd2']);
    // W9 (ui-audit #10): the detail flips to answered once the findings row exists
    expect(body.kata?.answered).toBe(false);
    expect(UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${id}`)).body).kata?.answered).toBe(true);
  });

  it('self-score: catch rate as kata evidence + 15 XP once; G1 aggregates across the bank', async () => {
    const k1 = ctx.id('fixture:ladder/kata-1');
    const k2 = ctx.id('fixture:ladder/kata-2');
    let stats = KataStatsResponse.parse((await request(ctx.app).get('/api/stats/katas')).body);
    expect(stats).toMatchObject({ katasScored: 0, defectsTotal: 0, catchRate: null, gate: { met: false, targetRate: 0.8, minDefects: 10 } });

    await request(ctx.app).post(`/api/units/${k2}/kata/findings`).send({ findings: [FINDING] }).expect(200);
    expectError(await request(ctx.app).post(`/api/units/${k2}/kata/self-score`).send({ perDefect: { d1: 'caught' } }), 400, 'VALIDATION');
    const s2 = KataScoreResponse.parse((await request(ctx.app).post(`/api/units/${k2}/kata/self-score`).send({ perDefect: { d1: 'caught', d2: 'missed' } })).body);
    expect(s2).toMatchObject({ caught: 1, total: 2, catchRate: 0.5, missed: ['d2'], xp: { amount: 15 } });
    const ev = ctx.tmp.db.all<{ kind: string; assessor: string; score: number; competency_id: string }>('SELECT * FROM evidence WHERE attempt_id = ? ORDER BY id', s2.attemptId);
    expect(ev.map((e) => [e.kind, e.assessor, e.score, e.competency_id])).toEqual([
      ['kata', 'self', 0.5, 'agentic-engineering'],
      ['kata', 'self', 0.5, 'code-reading'],
    ]);
    expectError(await request(ctx.app).post(`/api/units/${k2}/kata/self-score`).send({ perDefect: { d1: 'caught', d2: 'caught' } }), 409, 'ALREADY_SCORED');

    await request(ctx.app).post(`/api/units/${k1}/kata/findings`).send({ findings: [FINDING] }).expect(200);
    await request(ctx.app).post(`/api/units/${k1}/kata/self-score`).send({ perDefect: { d1: 'caught' } }).expect(200);
    stats = KataStatsResponse.parse((await request(ctx.app).get('/api/stats/katas')).body);
    expect(stats).toMatchObject({ katasScored: 2, assistedCount: 0, defectsCaught: 2, defectsTotal: 3, gate: { met: false } });
    expect(stats.catchRate).toBeCloseTo(2 / 3);

    // W7 (audit #8): a re-seeded kata (same key, one more defect) never rewrites the G1 history
    const grown = { ...KATAS[1]!, seededDefectKey: [...KATAS[1]!.seededDefectKey, KATAS[1]!.seededDefectKey[0]!] };
    const app2 = createApp({ db: ctx.tmp.db, clock: ctx.clock, runners: {}, seedItems: mapSeedItemStore([EB, KATAS[0]!, grown]) });
    expect(KataStatsResponse.parse((await request(app2).get('/api/stats/katas')).body)).toMatchObject({ katasScored: 2, defectsCaught: 2, defectsTotal: 3 });
    expectError(await request(app2).get(`/api/units/${k2}/kata/key`), 409, 'CONTENT_CHANGED');
  });

  it('W7 audit #2: a self-flagged ASSISTED kata never counts toward G1 — reported as assistedCount, gate untouched', async () => {
    const k1 = ctx.id('fixture:ladder/kata-1');
    const ans = await request(ctx.app).post(`/api/units/${k1}/kata/findings`).send({ findings: [FINDING], selfAssisted: true });
    expect(ans.status, ans.text).toBe(200);
    expect(ans.body.mode).toBe('assisted');
    await request(ctx.app).post(`/api/units/${k1}/kata/self-score`).send({ perDefect: { d1: 'caught' } }).expect(200);
    const stats = KataStatsResponse.parse((await request(ctx.app).get('/api/stats/katas')).body);
    expect(stats).toMatchObject({ katasScored: 0, assistedCount: 1, defectsCaught: 0, defectsTotal: 0, catchRate: null, gate: { met: false } });
  });
});

describe('mutation gate marker (POST /units/:id/mutation)', () => {
  const ctx = useLadder();
  const files = (scores: [number, number][]) =>
    scores.map(([killed, survived], i) => ({ path: `src/f${i}.js`, killed, timeout: 0, survived, noCoverage: 0 }));
  const marker = (f: ReturnType<typeof files>) => ({ tool: 'stryker-js', toolVersion: '10.0.0', durationMs: 90_000, files: f });

  it('refuses non-project units and projects without a verified pass', async () => {
    expectError(await request(ctx.app).post(`/api/units/${ctx.id('fixture:ladder/drill')}/mutation`).send(marker(files([[9, 1]]))), 409, 'WRONG_UNIT_KIND');
    const project = ctx.id('fixture:ladder/project-api');
    expectError(await request(ctx.app).post(`/api/units/${project}/mutation`).send(marker(files([[9, 1]]))), 409, 'NOT_VERIFIED');
    await request(ctx.app).post(`/api/units/${project}/submit`).send({ port: 1 }).expect(200); // a FAILED submit
    expectError(await request(ctx.app).post(`/api/units/${project}/mutation`).send(marker(files([[9, 1]]))), 409, 'NOT_VERIFIED');
  });

  it('the server re-evaluates the per-file floor (default 40) and the overall break (60); a gutted file fails even when the total passes', async () => {
    const project = ctx.id('fixture:ladder/project-api');
    const pass = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${project}/submit`).send({ port: GOOD_PORT })).body);
    // overall 80.6% but one file at 0% (the spike's "gutted slug" shape) -> refused
    const gutted = await request(ctx.app).post(`/api/units/${project}/mutation`).send(marker(files([[60, 2], [44, 8], [0, 12]])));
    expectError(gutted, 409, 'MUTATION_BELOW_THRESHOLD');
    expect(gutted.body.error.message).toMatch(/src\/f2\.js: 0% < per-file floor 40%/);
    expectError(await request(ctx.app).post(`/api/units/${project}/mutation`).send(marker(files([[11, 9], [11, 9]]))), 409, 'MUTATION_BELOW_THRESHOLD'); // 55% < break
    expectError(await request(ctx.app).post(`/api/units/${project}/mutation`).send({ ...marker(files([[9, 1]])), verdict: 'pass' }), 400, 'VALIDATION');

    const ok = MutationMarkerResponse.parse((await request(ctx.app).post(`/api/units/${project}/mutation`).send(marker(files([[60, 2], [44, 8], [5, 7]])))).body);
    expect(ok.attemptId).toBe(pass.attempt.id);
    expect(ok.verdict).toMatchObject({ pass: true, floorPct: 40, breakPct: 60 });
    const ev = ctx.tmp.db.get<{ kind: string; verified: boolean; assessor: string; attempt_id: number; score: number }>('SELECT * FROM evidence WHERE id = ?', ok.evidenceIds[0]!)!;
    expect(ev).toMatchObject({ kind: 'mutation', verified: true, assessor: 'pipeline', attempt_id: pass.attempt.id });
    expect(ev.score).toBeCloseTo(109 / 126, 3);
    expect(() => ctx.tmp.db.run('UPDATE evidence SET score = 1 WHERE id = ?', ok.evidenceIds[0]!)).toThrow(/append-only/);
  });

  it('per-lesson floor override via check.threshold (project-low: 50%) and stale-attempt refusal', async () => {
    const project = ctx.id('fixture:ladder/project-low');
    const first = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${project}/submit`).send({ port: GOOD_PORT })).body);
    ctx.clock.advance(1000);
    await request(ctx.app).post(`/api/units/${project}/submit`).send({ port: GOOD_PORT }).expect(200);
    const res = await request(ctx.app).post(`/api/units/${project}/mutation`).send(marker(files([[45, 5], [9, 11]]))); // 45% file: >= 40 but < 50
    expectError(res, 409, 'MUTATION_BELOW_THRESHOLD');
    expect(res.body.error.message).toMatch(/< per-file floor 50%/);
    expectError(await request(ctx.app).post(`/api/units/${project}/mutation`).send({ ...marker(files([[9, 1]])), attemptId: first.attempt.id }), 409, 'NOT_VERIFIED');
  });
});

describe('evidence browser + attempt detail', () => {
  const ctx = useLadder();

  it('lists evidence newest first, filtered by competency / kind, and links each row to its attempt', async () => {
    await request(ctx.app).post(`/api/units/${ctx.id('fixture:ladder/project-api')}/submit`).send({ port: GOOD_PORT }).expect(200);
    await request(ctx.app).post(`/api/units/${ctx.id('fixture:ladder/drill')}/submit`).send({ code: fixture.solutions.retest }).expect(200);
    const all = EvidenceListResponse.parse((await request(ctx.app).get('/api/evidence')).body);
    expect(all.total).toBe(2);
    expect(all.items.map((i) => i.kind)).toEqual(['submit', 'artifact']);
    const http = EvidenceListResponse.parse((await request(ctx.app).get('/api/evidence?competency=data-http')).body);
    expect(http.items).toHaveLength(1);
    expect(http.items[0]).toMatchObject({ kind: 'artifact', assessor: 'pipeline', assistance: 'none', verified: true, unitTitle: '[fixture] Health endpoint project' });
    expect(EvidenceListResponse.parse((await request(ctx.app).get('/api/evidence?kind=submit&limit=1')).body).items).toHaveLength(1);
    expectError(await request(ctx.app).get('/api/evidence?competency=nope'), 400, 'VALIDATION');

    const att = AttemptDetailResponse.parse((await request(ctx.app).get(`/api/attempts/${http.items[0]!.attemptId}`)).body);
    expect(att).toMatchObject({ unitKind: 'http-lab', mode: 'solo', outcome: 'pass', answer: { port: GOOD_PORT } });
    expect(att.runs).toHaveLength(1);
    expect(att.evidenceIds).toEqual([http.items[0]!.id]);
    expectError(await request(ctx.app).get('/api/attempts/999'), 404, 'NOT_FOUND');
  });
});

describe('seed item loading (stamped W5a packs only, FULL stamp verification — W7 audit #7)', () => {
  let dir: string;
  // a real committed, stamped pack (seed:check verifies the same bytes)
  const REAL = join(REPO_ROOT, 'content', 'seed', 'explainback', 'trainjs--docs-lessons-02-functions-scope-data.md');
  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), 'bq-seed-load-')), 'explainback', 'trainjs');
    cpSync(REAL, dir, { recursive: true });
  });
  afterEach(() => rmSync(join(dir, '..', '..'), { recursive: true, force: true }));

  const edit = (file: string, fn: (s: string) => string) => writeFileSync(join(dir, file), fn(readFileSync(join(dir, file), 'utf8')));

  it('loads a stamped pack', () => {
    const store = loadSeedItemStore([dir]);
    expect(store.explainBackItems()).toHaveLength(1);
  });
  it('refuses edited items bytes', () => {
    edit('items.json', (s) => s.replace('"prompt": "', '"prompt": "X'));
    expect(() => loadSeedItemStore([dir])).toThrow(SeedItemLoadError);
  });
  it('refuses an edited manifest (stamp binds the manifest bytes, not only items)', () => {
    edit('manifest.json', (s) => s.replace('"review": 0', '"review": 0 '));
    expect(() => loadSeedItemStore([dir])).toThrow(/manifest/);
  });
  it('refuses a stamp from an older validator (fingerprint) with the restamp hint', () => {
    edit('validation.json', (s) => s.replace(/"fingerprint": "[0-9a-f]{64}"/, `"fingerprint": "${'a'.repeat(64)}"`));
    expect(() => loadSeedItemStore([dir])).toThrow(/fingerprint[\s\S]*seed:check -- --restamp/);
  });
  it('refuses quarantine keys that disagree with the stamp', () => {
    edit('validation.json', (s) => s.replace('"quarantinedKeys": []', '"quarantinedKeys": ["seed:explainback:x/y/z"]'));
    expect(() => loadSeedItemStore([dir])).toThrow(SeedItemLoadError);
  });
  it('refuses an unstamped pack', () => {
    rmSync(join(dir, 'validation.json'));
    expect(() => loadSeedItemStore([dir])).toThrow(/no validation.json stamp/);
  });
});
