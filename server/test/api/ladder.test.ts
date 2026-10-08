import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { SEED_PACK_FORMAT, type SeedExplainBackItem, type SeedPatchKataItem } from '@bootquest/shared';
import { createApp } from '../../src/api/app.ts';
import type { Runner } from '../../src/api/runners.ts';
import { DAY_MS, fixedClock } from '../../src/engines/clock.ts';
import { getRating } from '../../src/engines/evidence.ts';
import { insertUnit } from '../../src/store/content.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
import { loadSeedItemStore, mapSeedItemStore, SeedItemLoadError } from '../../src/store/seed-items.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';
import fixture from '../fixtures/ladder-fixture.json' with { type: 'json' };

const EB = fixture.seedItems.find((i) => i.kind === 'explain-back') as unknown as SeedExplainBackItem;
const KATAS = fixture.seedItems.filter((i) => i.kind === 'patch-kata') as unknown as SeedPatchKataItem[];
const KEY_POINT_IDS = EB.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => `q${qi + 1}k${ki + 1}`));
const GOOD_PORT = 4000;

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
    const body = ExplainBackScoreResponse.parse((await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(12) })).body);
    expect(body).toMatchObject({ covered: 12, total: 16, passed: false, xp: null, retests: [], promotions: [] });
    expect(body.coverage).toBe(0.75);
    const comp = CompetenciesResponse.parse((await request(ctx.app).get('/api/competencies')).body);
    const row = comp.competencies.find((c) => c.id === 'data-http')!;
    expect(row.promotion.artifact.state).toBe('done');
    expect(row.promotion.explainBack).toMatchObject({ state: 'failed', coverage: 0.75 });
    expect(row.promotion.retest.state).toBe('pending');
    expect(comp.retests).toEqual([]);
  });

  it('the self-score must be filed in the same sitting (24h window) -> 409 SCORE_WINDOW_CLOSED', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    ctx.clock.advance(DAY_MS + 1);
    expectError(await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(16) }), 409, 'SCORE_WINDOW_CLOSED');
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
    // free runs stay available before the retest opens
    expect((await request(ctx.app).post(`/api/units/${retest}/run`).send({ code: fixture.solutions.retest })).status).toBe(200);
    expect(getRating(ctx.tmp.db, 'data-http')).toBe(1);

    ctx.clock.set(dueAt);
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
    expect(body.kata).toMatchObject({ title: kata.title, diff: kata.diff, defectCount: kata.seededDefectKey.length });
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
    expect(stats).toMatchObject({ katasScored: 2, defectsCaught: 2, defectsTotal: 3, gate: { met: false } });
    expect(stats.catchRate).toBeCloseTo(2 / 3);
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

describe('seed item loading (stamped W5a packs only)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bq-seed-load-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (items: string, stampSha: string | null) => {
    writeFileSync(join(dir, 'items.json'), items);
    if (stampSha !== null) {
      writeFileSync(
        join(dir, 'validation.json'),
        JSON.stringify({
          format: SEED_PACK_FORMAT,
          source: 'explainback/test',
          fingerprintKind: 'seed:explainback',
          fingerprint: 'a'.repeat(64),
          toolchain: { node: 'v22.16.0' },
          manifestSha256: 'b'.repeat(64),
          itemsSha256: stampSha,
          counts: { total: 1, byKind: { 'explain-back': 1 } },
          quarantinedKeys: [],
          reviewKeys: [],
          executions: 0,
        }),
      );
    }
  };
  const itemsText = JSON.stringify({ format: SEED_PACK_FORMAT, generator: 'explainback', name: 'test', items: [EB] }, null, 1);
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');

  it('loads a stamped pack (CRLF-normalized bytes accepted) and refuses unstamped or edited ones', () => {
    write(itemsText, sha(itemsText));
    expect(loadSeedItemStore([dir]).explainBack(EB.key)?.questions).toHaveLength(3);
    write(itemsText.replace(/\n/g, '\r\n'), sha(itemsText));
    expect(loadSeedItemStore([dir]).size()).toBe(1);
    write(itemsText.replace('Why', 'How'), sha(itemsText));
    expect(() => loadSeedItemStore([dir])).toThrow(SeedItemLoadError);
    rmSync(join(dir, 'validation.json'));
    expect(() => loadSeedItemStore([dir])).toThrow(/no validation.json stamp/);
  });
});
