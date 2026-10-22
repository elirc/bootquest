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
import { recordAttempt, revealSolution } from '../../src/engines/attempts.ts';
import { EB_SET_MIN_GAP_MS, retestGate } from '../../src/engines/ladder.ts';
import { assertUniqueSeedItemRefs, explainBackUnitKey, kataUnitKey } from '../../src/store/ladder.ts';
import { loadSeedDerivedContent } from '../../src/api/serve.ts';
import { insertUnit } from '../../src/store/content.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import { ledgerCounts, primaryCheck } from '../../src/store/queries.ts';
import { loadSeedItemStore, mapSeedItemStore, SeedItemLoadError, seedItemHash } from '../../src/store/seed-items.ts';
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

/** leg (a) first: explain-api / explain-low refuse answers (409 ARTIFACT_REQUIRED) until their project passes solo */
async function passArtifact(ctx: Ctx, key = 'fixture:ladder/project-api'): Promise<void> {
  const res = await request(ctx.app).post(`/api/units/${ctx.id(key)}/submit`).send({ port: GOOD_PORT });
  expect(res.status, res.text).toBe(200);
  expect(res.body.verdict).toBe('pass');
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

    await passArtifact(ctx);
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
    await passArtifact(ctx);
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

  it('dead end #1 (no self-score window): scored 30 days after the answer -> evidence, 20 XP once, leg (b); the retest anchors on the ANSWER time and the chain promotes', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    const retest = ctx.id('fixture:ladder/project-api-retest');
    await request(ctx.app).post(`/api/units/${ctx.id('fixture:ladder/project-api')}/submit`).send({ port: GOOD_PORT }).expect(200);
    ctx.clock.advance(60_000);
    const ans = await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const answeredAt = ctx.clock().getTime();
    ctx.clock.advance(30 * DAY_MS); // the old 24h window would have voided this item for good (409, no XP, no leg)
    const res = await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(14) });
    expect(res.status, res.text).toBe(200);
    const body = ExplainBackScoreResponse.parse(res.body);
    expect(body).toMatchObject({ attemptId: ans.body.attemptId, passed: true, xp: { amount: 20, reason: null } });
    // timing is on the immutable answer row, never on when the score was filed
    expect(body.retests[0]!.dueAt).toBe(answeredAt + 2 * DAY_MS);
    const ev = ctx.tmp.db.get<{ created_at: number }>('SELECT created_at FROM evidence WHERE id = ?', body.evidenceIds[0]!)!;
    expect(ev.created_at).toBe(answeredAt + 30 * DAY_MS);
    const row = CompetenciesResponse.parse((await request(ctx.app).get('/api/competencies')).body).competencies.find((c) => c.id === 'data-http')!;
    expect(row.promotion).toMatchObject({ artifact: { state: 'done' }, explainBack: { state: 'done' }, retest: { state: 'scheduled', unitId: retest } });
    // still once per answer
    expectError(await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(16) }), 409, 'ALREADY_SCORED');
    // the schedule is already due (>= 2 days after the answer), so the late-scored chain completes now
    expect(retestGate(ctx.tmp.db, retest, ctx.clock)).toEqual({ open: true, reason: 'due', opensAt: null });
    const rt = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${retest}/submit`).send({ code: fixture.solutions.retest })).body);
    expect(rt.promotions).toEqual([expect.objectContaining({ competency: 'data-http', from: 1, to: 2 })]);
  });

  it('F7c: a self-score whose evidence would PREDATE its answer (the server clock moved back) is a 409 EVIDENCE_PREDATES_ATTEMPT, not a 500; nothing recorded', async () => {
    const k1 = ctx.id('fixture:ladder/kata-1');
    await request(ctx.app)
      .post(`/api/units/${k1}/kata/findings`)
      .send({ findings: [{ scenario: 'two rules, one matches', evidence: 'allocationSummary.mjs:17', consequence: 'coverage is overstated' }] })
      .expect(200);
    const answeredAt = ctx.clock().getTime();
    ctx.clock.set(answeredAt - 60 * 60 * 1000); // the machine clock was set back an hour
    const before = ledgerCounts(ctx.tmp.db);
    const res = await request(ctx.app).post(`/api/units/${k1}/kata/self-score`).send({ perDefect: { d1: 'caught' } });
    expectError(res, 409, 'EVIDENCE_PREDATES_ATTEMPT');
    expect(res.body.error.message).toMatch(/clock/);
    expect(ledgerCounts(ctx.tmp.db)).toEqual(before);
    ctx.clock.set(answeredAt + 1);
    await request(ctx.app).post(`/api/units/${k1}/kata/self-score`).send({ perDefect: { d1: 'caught' } }).expect(200);
  });

  it('dead end #1 (no self-score window): a kata self-scored a week late still files its catch rate and pays 15 XP once', async () => {
    const k1 = ctx.id('fixture:ladder/kata-1');
    const f = await request(ctx.app)
      .post(`/api/units/${k1}/kata/findings`)
      .send({ findings: [{ scenario: 'two rules, one matches', evidence: 'allocationSummary.mjs:17', consequence: 'coverage is overstated' }] })
      .expect(200);
    ctx.clock.advance(7 * DAY_MS);
    const s = KataScoreResponse.parse((await request(ctx.app).post(`/api/units/${k1}/kata/self-score`).send({ perDefect: { d1: 'caught' } })).body);
    expect(s).toMatchObject({ attemptId: f.body.attemptId, caught: 1, total: 1, xp: { amount: 15 } });
    expectError(await request(ctx.app).post(`/api/units/${k1}/kata/self-score`).send({ perDefect: { d1: 'caught' } }), 409, 'ALREADY_SCORED');
  });

  it('second answer / second self-score errors carry no global attempt id', async () => {
    const eb = ctx.id('fixture:ladder/explain-api');
    await passArtifact(ctx);
    const ans = await request(ctx.app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const again = await request(ctx.app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: ANSWERS });
    expectError(again, 403, 'ALREADY_ANSWERED');
    expect(again.body.error.message).toContain(`unit ${eb}: your explain-back answer is recorded and immutable`);
    expect(again.body.error.message).not.toContain('#' + ans.body.attemptId);

    await request(ctx.app).post(`/api/units/${eb}/explain-back/self-score`).send({ perKeyPoint: marks(16) }).expect(200);
    const rescore = await request(ctx.app).post(`/api/units/${eb}/explain-back/self-score`).send({ perKeyPoint: marks(16) });
    expectError(rescore, 409, 'ALREADY_SCORED');
    expect(rescore.body.error.message).toContain('your answer on this unit is already self-scored');
    expect(rescore.body.error.message).not.toContain('#' + ans.body.attemptId);

    const k1 = ctx.id('fixture:ladder/kata-1');
    const FINDING = { scenario: 'two rules, one matches', evidence: 'allocationSummary.mjs:17', consequence: 'coverage is overstated' };
    const f = await request(ctx.app).post(`/api/units/${k1}/kata/findings`).send({ findings: [FINDING] }).expect(200);
    const f2 = await request(ctx.app).post(`/api/units/${k1}/kata/findings`).send({ findings: [FINDING] });
    expectError(f2, 403, 'ALREADY_ANSWERED');
    expect(f2.body.error.message).toContain(`unit ${k1}: your findings are recorded and immutable`);
    expect(f2.body.error.message).not.toContain('#' + f.body.attemptId);
    await request(ctx.app).post(`/api/units/${k1}/kata/self-score`).send({ perDefect: { d1: 'caught' } }).expect(200);
    const kre = await request(ctx.app).post(`/api/units/${k1}/kata/self-score`).send({ perDefect: { d1: 'caught' } });
    expectError(kre, 409, 'ALREADY_SCORED');
    expect(kre.body.error.message).toContain('your findings on this unit are already self-scored');
    expect(kre.body.error.message).not.toContain('#' + f.body.attemptId);
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
      // distinct source paths: copies sharing EB's (repo, path) would be alternate SETS of one group (rotation-gated)
      seedItems: mapSeedItemStore([
        ...fixture.seedItems,
        { ...EB, key: 'seed:explainback:strict-copy', provenance: { ...EB.provenance, path: 'docs/learning/strict-copy.md' } },
        { ...EB, key: 'seed:explainback:lax-copy', provenance: { ...EB.provenance, path: 'docs/learning/lax-copy.md' } },
      ]),
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
    await passArtifact(ctx);
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

  it('dead end #3 (F11 shape): a re-seeded set (same key, changed content) SUPERSEDES the unscored old answer: never keyed / scored against the new content, ONE fresh answer — ASSISTED (prior-key), which pays but is never leg (b)', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    await passArtifact(ctx);
    const old = await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    expect(old.body.mode).toBe('solo');
    const oldRow = ctx.tmp.db.get('SELECT * FROM attempt WHERE id = ?', old.body.attemptId);
    const changed = { ...EB, questions: EB.questions.map((q, i) => (i === 0 ? { ...q, keyPoints: q.keyPoints.slice(1) } : q)) };
    const changedIds = changed.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => `q${qi + 1}k${ki + 1}`));
    const app = createApp({ db: ctx.tmp.db, clock: ctx.clock, runners: {}, seedItems: mapSeedItemStore([changed, ...KATAS]) });

    // the old answer is superseded: the new version is unanswered (was: 409 CONTENT_CHANGED on key AND self-score, forever)
    const detail = UnitDetailResponse.parse((await request(app).get(`/api/units/${id}`)).body).explainBack;
    expect(detail?.answered).toBe(false);
    // F7e: the superseded answers are structured, not only prose
    expect(detail?.supersededAnswerIds).toEqual([old.body.attemptId]);
    expect(UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${id}`)).body).explainBack?.supersededAnswerIds).toEqual([]);
    const k0 = await request(app).get(`/api/units/${id}/explain-back/key`);
    expectError(k0, 403, 'NOT_ANSWERED');
    expect(k0.body.error.message).toContain(`#${old.body.attemptId} answered an earlier version`);
    expectError(await request(app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: Object.fromEntries(changedIds.map((k) => [k, 'covered'])) }), 403, 'NOT_ANSWERED');

    // ONE fresh answer against the new content, still answer-before-key
    ctx.clock.advance(60_000);
    const fresh = await request(app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS.map((a) => `v2: ${a}`) });
    expect(fresh.status, fresh.text).toBe(200);
    expect(fresh.body.attemptId).not.toBe(old.body.attemptId);
    // F2: the v1 answer unlocked the v1 key (key reads are not recorded), so v2 cannot be blind
    expect(fresh.body.mode).toBe('assisted');
    expect(ctx.tmp.db.get('SELECT mode, assisted, assistance_source FROM attempt WHERE id = ?', fresh.body.attemptId)).toEqual({ mode: 'assisted', assisted: true, assistance_source: 'prior-key' });
    expectError(await request(app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }), 403, 'ALREADY_ANSWERED');
    // supersession is DERIVED: the old row is byte-identical and still append-only
    expect(ctx.tmp.db.get('SELECT * FROM attempt WHERE id = ?', old.body.attemptId)).toEqual(oldRow);
    expect(() => ctx.tmp.db.run('UPDATE attempt SET answer = NULL WHERE id = ?', old.body.attemptId)).toThrow(/append-only/);

    const key = ExplainBackKeyResponse.parse((await request(app).get(`/api/units/${id}/explain-back/key`)).body);
    expect(key.attemptId).toBe(fresh.body.attemptId);
    expect(key.answers[0]).toMatch(/^v2: /);
    expect(key.questions.flatMap((q) => q.keyPoints.map((p) => p.id))).toEqual(changedIds);
    const sc = ExplainBackScoreResponse.parse((await request(app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: Object.fromEntries(changedIds.map((k) => [k, 'covered'])) })).body);
    // XP: the old version was never scored, so this unit never paid explain-back XP -> the fresh answer pays (see the pays-once
    // test); like any assisted answer (self flag) it pays — XP semantics are those of every other assisted attempt
    expect(sc).toMatchObject({ attemptId: fresh.body.attemptId, passed: true, xp: { amount: 20, reason: null } });
    // ...but its evidence is assisted, so it is NEVER promotion leg (b), even at 100% coverage after a solo artifact
    expect(ctx.tmp.db.all<{ assistance: string }>('SELECT assistance FROM evidence WHERE attempt_id = ?', fresh.body.attemptId).map((e) => e.assistance)).toEqual(
      sc.evidenceIds.map(() => 'prior-key'),
    );
    const row = CompetenciesResponse.parse((await request(app).get('/api/competencies')).body).competencies.find((c) => c.id === 'data-http')!;
    expect(row.promotion.artifact.state).toBe('done');
    expect(row.promotion.explainBack).toMatchObject({ state: 'pending', evidenceId: null });
    // the ORIGINAL content still serves its own answer's key (each version's answer of record is its first)
    expect(ExplainBackKeyResponse.parse((await request(ctx.app).get(`/api/units/${id}/explain-back/key`)).body).attemptId).toBe(old.body.attemptId);
  });

  it('dead end #3 + pays-once: when the earlier version already PAID on this unit, the fresh answer files evidence but pays 0 — xp_event_pays_once (unit, kind) is untouched', async () => {
    // Reasoning: the partial unique index xp_event_pays_once is ON xp_event(unit_id, kind) WHERE amount > 0 -
    // one paying explain-back award per UNIT, not per answer. It is an honesty guard, so it is not widened.
    // A fresh answer to a re-seeded set therefore pays 20 only when its unit never paid explain-back XP (the
    // stranded F11 case: the old answer could never be scored, so it never paid), and 0 'already-awarded'
    // otherwise. No farming loop through the app: only a re-seed of the stamped pack changes the item hash,
    // and each hash takes exactly one fresh answer — recorded as assisted (prior-key, F2), never a blind leg.
    const id = ctx.id('fixture:ladder/explain-api');
    await passArtifact(ctx);
    await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const v1 = ExplainBackScoreResponse.parse((await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(16) })).body);
    expect(v1.xp).toMatchObject({ amount: 20 });
    const changed = { ...EB, questions: EB.questions.map((q, i) => (i === 0 ? { ...q, keyPoints: q.keyPoints.slice(1) } : q)) };
    const changedIds = changed.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => `q${qi + 1}k${ki + 1}`));
    const app = createApp({ db: ctx.tmp.db, clock: ctx.clock, runners: {}, seedItems: mapSeedItemStore([changed, ...KATAS]) });
    const v2a = await request(app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    expect(v2a.body.mode).toBe('assisted'); // F2: v1 was answered, keyed and scored: v2 is prior-key
    await request(app).get(`/api/units/${id}/explain-back/key`).expect(200);
    const v2 = ExplainBackScoreResponse.parse((await request(app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: Object.fromEntries(changedIds.map((k) => [k, 'covered'])) })).body);
    expect(v2.evidenceIds.length).toBeGreaterThan(0);
    expect(v2.xp).toMatchObject({ amount: 0, reason: 'already-awarded' });
    expect(ctx.tmp.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM xp_event WHERE unit_id = ? AND kind = 'explain-back' AND amount > 0`, id)!.n).toBe(1);
    expect(() =>
      ctx.tmp.db.run(`INSERT INTO xp_event (kind, amount, reason, unit_id, attempt_id, track_id, day, created_at) VALUES ('explain-back', 20, NULL, ?, ?, 'js', '2026-10-01', 0)`, id, v2.attemptId),
    ).toThrow(/UNIQUE/);
  });

  it('dead end #3: an answer stranded on a RETIRED unit is keyed and self-scored from the live unit carrying the same item (explain-back and kata)', async () => {
    const a = ctx.id('fixture:ladder/explain-api');
    await passArtifact(ctx);
    const ans = await request(ctx.app).post(`/api/units/${a}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const k1 = ctx.id('fixture:ladder/kata-1');
    const FINDING = { scenario: 'two rules, one matches', evidence: 'allocationSummary.mjs:17', consequence: 'coverage is overstated' };
    const findings = await request(ctx.app).post(`/api/units/${k1}/kata/findings`).send({ findings: [FINDING] }).expect(200);
    // a re-seed / re-link moves both items to new unit keys: the old units retire (they 404 everywhere)
    ctx.tmp.db.run('UPDATE unit SET retired_at = ? WHERE id IN (?, ?)', ctx.clock().getTime(), a, k1);
    const liveEb = insertUnit(
      ctx.tmp.db,
      {
        key: 'fixture:ladder/explain-api-v2',
        track: 'js',
        kind: 'explain-back',
        title: '[fixture] explain-api moved',
        competencies: ['data-http'],
        prerequisites: ['fixture:ladder/project-api'],
        checks: [{ spec: { type: 'explain-back', questionSetKey: EB.key } }],
      },
      ctx.clock,
    );
    const kataSpec1 = fixture.units.find((u) => u.key === 'fixture:ladder/kata-1')!.checks[0]!.spec;
    const liveKata = insertUnit(
      ctx.tmp.db,
      { key: 'fixture:ladder/kata-1-v2', track: 'agentic', kind: 'patch-kata', title: '[fixture] kata moved', competencies: ['code-reading'], checks: [{ spec: kataSpec1 }] },
      ctx.clock,
    );
    expect(() => assertUniqueSeedItemRefs(ctx.tmp.db)).not.toThrow(); // one LIVE unit per item
    expectError(await request(ctx.app).get(`/api/units/${a}`), 404, 'NOT_FOUND');

    // explain-back: still answered (the set's key may have been read), re-answer refused with a pointer here
    expect(UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${liveEb}`)).body).explainBack?.answered).toBe(true);
    const re = await request(ctx.app).post(`/api/units/${liveEb}/explain-back/answers`).send({ answers: ANSWERS });
    expectError(re, 403, 'ALREADY_ANSWERED');
    expect(re.body.error.message).toMatch(/since retired; open its key and self-score it here/);
    expect(ExplainBackKeyResponse.parse((await request(ctx.app).get(`/api/units/${liveEb}/explain-back/key`)).body).attemptId).toBe(ans.body.attemptId);
    // was: 403 "self-score it there" while "there" 404s - a permanent dead end
    const sc = ExplainBackScoreResponse.parse((await request(ctx.app).post(`/api/units/${liveEb}/explain-back/self-score`).send({ perKeyPoint: marks(16) })).body);
    expect(sc).toMatchObject({ attemptId: ans.body.attemptId, passed: true, xp: { amount: 20 } });
    expect(sc.retests).toHaveLength(1);
    // the evidence binds the ANSWER's own attempt and unit: nothing re-labelled
    const ev = ctx.tmp.db.get<{ attempt_id: number; unit_id: number }>('SELECT attempt_id, unit_id FROM evidence WHERE id = ?', sc.evidenceIds[0]!)!;
    expect(ev).toEqual({ attempt_id: ans.body.attemptId, unit_id: a });
    const row = CompetenciesResponse.parse((await request(ctx.app).get('/api/competencies')).body).competencies.find((c) => c.id === 'data-http')!;
    expect(row.promotion.explainBack.state).toBe('done');
    expectError(await request(ctx.app).post(`/api/units/${liveEb}/explain-back/self-score`).send({ perKeyPoint: marks(16) }), 409, 'ALREADY_SCORED');

    // kata: same path
    expect(KataKeyResponse.parse((await request(ctx.app).get(`/api/units/${liveKata}/kata/key`)).body).attemptId).toBe(findings.body.attemptId);
    const ks = KataScoreResponse.parse((await request(ctx.app).post(`/api/units/${liveKata}/kata/self-score`).send({ perDefect: { d1: 'caught' } })).body);
    expect(ks).toMatchObject({ attemptId: findings.body.attemptId, caught: 1, xp: { amount: 15 } });
  });

  it('a LIVE twin still cannot self-score another live unit\'s answer (the retired carve-out is retired-only)', async () => {
    const twin = insertUnit(
      ctx.tmp.db,
      { key: 'fixture:ladder/explain-twin2', track: 'js', kind: 'explain-back', title: '[fixture] twin2', competencies: ['data-http'], checks: [{ spec: { type: 'explain-back', questionSetKey: EB.key } }] },
      ctx.clock,
    );
    await passArtifact(ctx);
    await request(ctx.app).post(`/api/units/${ctx.id('fixture:ladder/explain-api')}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const res = await request(ctx.app).post(`/api/units/${twin}/explain-back/self-score`).send({ perKeyPoint: marks(16) });
    expectError(res, 403, 'ALREADY_ANSWERED');
    expect(res.body.error.message).toMatch(/self-score it there/);
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

  it('campaign 2 (HONESTY): reveal on a CLOSED retest is refused (409, nothing recorded) and never hands over its reference; once due it reveals as guided practice, never a leg', async () => {
    const project = ctx.id('fixture:ladder/project-api');
    const retest = ctx.id('fixture:ladder/project-api-retest');
    const eb = ctx.id('fixture:ladder/explain-api');
    const REF = `${fixture.solutions.retest}\n// reference-marker-7f3a`;
    // the same DB, now with a content store that HOLDS the retest's reference solution (the leak is real)
    const app = createApp({
      db: ctx.tmp.db,
      clock: ctx.clock,
      runners: { http: fakeHttp, 'drill-js': fakeDrill },
      seedItems: mapSeedItemStore(fixture.seedItems),
      content: mapContentStore({ 'fixture:ladder/project-api-retest': { solution: REF } }),
    });
    const noLeak = (res: request.Response) => expect(res.text).not.toContain('reference-marker-7f3a');

    // 1. unscheduled: refused like run/submit, nothing written, solution still 403
    let before = ledgerCounts(ctx.tmp.db);
    let rv = await request(app).post(`/api/units/${retest}/reveal`).send({});
    expectError(rv, 409, 'RETEST_NOT_OPEN');
    noLeak(rv);
    expect(ledgerCounts(ctx.tmp.db)).toEqual(before);
    expectError(await request(app).get(`/api/units/${retest}/solution`), 403, 'NOT_REVEALED');

    // 2. scheduled but not due: refused NOT_DUE, nothing written
    expect((await request(app).post(`/api/units/${project}/submit`).send({ port: GOOD_PORT })).status).toBe(200);
    await request(app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const score = ExplainBackScoreResponse.parse((await request(app).post(`/api/units/${eb}/explain-back/self-score`).send({ perKeyPoint: marks(14) })).body);
    const dueAt = score.retests[0]!.dueAt;
    ctx.clock.advance(DAY_MS);
    before = ledgerCounts(ctx.tmp.db);
    rv = await request(app).post(`/api/units/${retest}/reveal`).send({});
    expectError(rv, 409, 'NOT_DUE');
    noLeak(rv);
    expect(ledgerCounts(ctx.tmp.db)).toEqual(before);
    expect(ctx.tmp.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM attempt WHERE unit_id = ?`, retest)!.n).toBe(0);
    expectError(await request(app).get(`/api/units/${retest}/solution`), 403, 'NOT_REVEALED');

    // 3. due: the reveal works (guided row first), and the retest can no longer be a promotion leg
    ctx.clock.set(dueAt);
    rv = await request(app).post(`/api/units/${retest}/reveal`).send({});
    expect(rv.status, rv.text).toBe(200);
    expect(rv.body.solution).toEqual({ kind: 'code', code: REF });
    const sub = SubmitResponse.parse((await request(app).post(`/api/units/${retest}/submit`).send({ code: fixture.solutions.retest })).body);
    expect(sub.verdict).toBe('pass');
    expect(sub.attempt.mode).toBe('guided');
    expect(sub.promotions).toEqual([]);
    expect(getRating(ctx.tmp.db, 'data-http')).toBe(1);
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

describe('dead end #2: an explain-back that is leg (b) of an artifact refuses answers until that artifact passes solo', () => {
  const ctx = useLadder();
  const PROJECT_TITLE = '[fixture] Health endpoint project';

  it('before any solo pass: 409 ARTIFACT_REQUIRED naming the project unit, nothing recorded; failed / assisted passes do not count; a solo pass opens it', async () => {
    const eb = ctx.id('fixture:ladder/explain-api');
    const project = ctx.id('fixture:ladder/project-api');
    const detail = async () => UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${eb}`)).body).explainBack;
    expect(await detail()).toMatchObject({ answered: false, artifactRequired: [{ unitId: project, title: PROJECT_TITLE }] });

    const before = ledgerCounts(ctx.tmp.db);
    const res = await request(ctx.app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: ANSWERS });
    expectError(res, 409, 'ARTIFACT_REQUIRED');
    expect(res.body.error.message).toContain(`unit ${project} "${PROJECT_TITLE}"`);
    expect(ledgerCounts(ctx.tmp.db)).toEqual(before); // refused before anything is written: the set is NOT burned

    // a failed submit and a self-flagged assisted pass are not leg (a): still refused
    await request(ctx.app).post(`/api/units/${project}/submit`).send({ port: 1 }).expect(200);
    await request(ctx.app).post(`/api/units/${project}/submit`).send({ port: GOOD_PORT, selfAssisted: true }).expect(200);
    expectError(await request(ctx.app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: ANSWERS }), 409, 'ARTIFACT_REQUIRED');
    expectError(await request(ctx.app).get(`/api/units/${eb}/explain-back/key`), 403, 'NOT_ANSWERED'); // answer-first still holds

    await passArtifact(ctx);
    expect(await detail()).toMatchObject({ answered: false, artifactRequired: [] });
    ctx.clock.advance(60_000);
    const answeredAt = ctx.clock().getTime();
    await request(ctx.app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const sc = ExplainBackScoreResponse.parse((await request(ctx.app).post(`/api/units/${eb}/explain-back/self-score`).send({ perKeyPoint: marks(14) })).body);
    expect(sc.retests).toEqual([expect.objectContaining({ artifactUnitId: project, dueAt: answeredAt + 2 * DAY_MS })]);
  });

  it('standalone explain-backs stay answerable: no prerequisite (G2 / design-set / quest-linked shape) or a non-project prerequisite is never gated', async () => {
    const solo = insertUnit(
      ctx.tmp.db,
      { key: 'fixture:ladder/explain-standalone', track: 'js', kind: 'explain-back', title: '[fixture] design it', competencies: ['language-fluency'], checks: [{ spec: { type: 'explain-back', questionSetKey: 'seed:explainback:standalone-copy' } }] },
      ctx.clock,
    );
    const drillLinked = insertUnit(
      ctx.tmp.db,
      {
        key: 'fixture:ladder/explain-drill-linked',
        track: 'js',
        kind: 'explain-back',
        title: '[fixture] drill-linked',
        competencies: ['language-fluency'],
        prerequisites: ['fixture:ladder/drill'],
        checks: [{ spec: { type: 'explain-back', questionSetKey: 'seed:explainback:drill-copy' } }],
      },
      ctx.clock,
    );
    const app = createApp({
      db: ctx.tmp.db,
      clock: ctx.clock,
      runners: {},
      // distinct source paths: copies sharing EB's (repo, path) would be alternate SETS of one group (rotation-gated)
      seedItems: mapSeedItemStore([
        ...fixture.seedItems,
        { ...EB, key: 'seed:explainback:standalone-copy', provenance: { ...EB.provenance, path: 'docs/learning/standalone-copy.md' } },
        { ...EB, key: 'seed:explainback:drill-copy', provenance: { ...EB.provenance, path: 'docs/learning/drill-copy.md' } },
      ]),
    });
    for (const u of [solo, drillLinked]) {
      expect(UnitDetailResponse.parse((await request(app).get(`/api/units/${u}`)).body).explainBack?.artifactRequired).toEqual([]);
      await request(app).post(`/api/units/${u}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
      const sc = ExplainBackScoreResponse.parse((await request(app).post(`/api/units/${u}/explain-back/self-score`).send({ perKeyPoint: marks(16) })).body);
      expect(sc).toMatchObject({ passed: true, xp: { amount: 20 }, retests: [] });
    }
  });

  it('a prerequisite that can never pass solo is not waited on (no new dead end): a revealed or a retired artifact unit', async () => {
    const eb = ctx.id('fixture:ladder/explain-api');
    const low = ctx.id('fixture:ladder/explain-low');
    revealSolution(ctx.tmp.db, ctx.id('fixture:ladder/project-api'), ctx.clock); // every later attempt on it is guided
    ctx.tmp.db.run('UPDATE unit SET retired_at = ? WHERE id = ?', ctx.clock().getTime(), ctx.id('fixture:ladder/project-low'));
    for (const u of [eb, low]) {
      expect(UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${u}`)).body).explainBack?.artifactRequired).toEqual([]);
      await request(ctx.app).post(`/api/units/${u}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
      // the two fixture sets cover the same source (ww6 testing-rationale.md): sibling sets, spaced >= 2 days
      ctx.clock.advance(EB_SET_MIN_GAP_MS);
    }
    // ...and with no solo pass behind the answer, a passing self-score schedules NO (pointless) retest
    const sc = ExplainBackScoreResponse.parse((await request(ctx.app).post(`/api/units/${eb}/explain-back/self-score`).send({ perKeyPoint: marks(16) })).body);
    expect(sc).toMatchObject({ passed: true, retests: [] });
  });

  it('a LEGACY answer recorded before the artifact pass (pre-fix) schedules no retest: no solo pass at/before the answer can pair with it', async () => {
    const eb = ctx.id('fixture:ladder/explain-api');
    // the engine path, as the server did before this gate existed
    recordAttempt(
      ctx.tmp.db,
      { unitId: eb, checkId: primaryCheck(ctx.tmp.db, eb)!.id, selfAssisted: false, answer: { explainBack: { questionSetKey: EB.key, itemSha: seedItemHash(EB), answers: ANSWERS } } },
      ctx.clock,
    );
    ctx.clock.advance(60_000);
    await passArtifact(ctx); // the pass comes AFTER the answer
    const sc = ExplainBackScoreResponse.parse((await request(ctx.app).post(`/api/units/${eb}/explain-back/self-score`).send({ perKeyPoint: marks(16) })).body);
    expect(sc).toMatchObject({ passed: true, xp: { amount: 20 }, retests: [] });
    expect(CompetenciesResponse.parse((await request(ctx.app).get('/api/competencies')).body).retests).toEqual([]);
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
    // (a re-seed of these katas is exercised through the PRODUCTION loader below: "re-seed through
    // loadSeedDerivedContent". It used to be simulated here by swapping the seed-item store under
    // hand-inserted units, which hid that the real loader refused the changed defect count.)
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

describe('re-seed through the production startup loader (serve.ts loadSeedDerivedContent): retire-and-replace, never refuse', () => {
  let tmp: TempDb;
  let clock: ReturnType<typeof fixedClock>;
  beforeEach(() => {
    tmp = makeTempDb();
    clock = fixedClock(localNoon(2026, 10, 1));
  });
  afterEach(() => tmp.cleanup());
  const load = (items: (SeedExplainBackItem | SeedPatchKataItem)[]) => loadSeedDerivedContent(tmp.db, { seedItems: mapSeedItemStore(items), authored: null }, clock);
  const appFor = (items: (SeedExplainBackItem | SeedPatchKataItem)[]) => createApp({ db: tmp.db, clock, runners: {}, seedItems: mapSeedItemStore(items) });
  const unitOf = (key: string) => tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ? AND retired_at IS NULL', key)!.id;
  const checksOf = (unitId: number) =>
    tmp.db.all<{ id: number; spec: string; retired: number | null }>('SELECT id, spec, retired_at AS retired FROM "check" WHERE unit_id = ? ORDER BY id', unitId).map((c) => ({ ...c, spec: JSON.parse(c.spec) as Record<string, unknown> }));
  const FINDING = { scenario: 'a tenant with two rules where one matches', evidence: 'allocationSummary.mjs:17 uses rules.length', consequence: 'the summary overstates coverage' };

  it('F3 + F2 (kata): a re-seed that changes the DEFECT COUNT boots; the answered check is retired (history keeps its frame); the v1-answered-but-never-scored kata yields no solo G1 via v2', async () => {
    load(KATAS);
    const k1 = unitOf(kataUnitKey(KATAS[0]!));
    const k2 = unitOf(kataUnitKey(KATAS[1]!));
    const app1 = appFor(KATAS);
    // k1: answered + scored solo (the G1 baseline); k2: answered on v1, NEVER scored (its key was readable from then on)
    await request(app1).post(`/api/units/${k1}/kata/findings`).send({ findings: [FINDING] }).expect(200);
    await request(app1).post(`/api/units/${k1}/kata/self-score`).send({ perDefect: { d1: 'caught' } }).expect(200);
    const v1 = await request(app1).post(`/api/units/${k2}/kata/findings`).send({ findings: [FINDING] }).expect(200);
    expect(v1.body.mode).toBe('solo');
    await request(app1).get(`/api/units/${k2}/kata/key`).expect(200);
    const before = KataStatsResponse.parse((await request(app1).get('/api/stats/katas')).body);
    expect(before).toMatchObject({ katasScored: 1, assistedCount: 0, defectsCaught: 1, defectsTotal: 1 });
    const [v1Check] = checksOf(k2);

    // the re-seed: same kata key, one more seeded defect (spec defectCount 2 -> 3). Was: LadderLoadError at startup.
    const grown = { ...KATAS[1]!, seededDefectKey: [...KATAS[1]!.seededDefectKey, KATAS[1]!.seededDefectKey[0]!] };
    expect(() => load([KATAS[0]!, grown])).not.toThrow();
    expect(unitOf(kataUnitKey(grown))).toBe(k2); // same unit (the key binds the item key)
    const after = checksOf(k2);
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ id: v1Check!.id, spec: { defectCount: 2 } });
    expect(after[0]!.retired).not.toBeNull(); // referenced by the v1 answer: retired, its frame intact
    expect(after[1]).toMatchObject({ spec: { defectCount: 3 }, retired: null });
    expect(tmp.db.get<{ check_id: number }>('SELECT check_id FROM attempt WHERE id = ?', v1.body.attemptId)!.check_id).toBe(v1Check!.id);
    expect(() => load([KATAS[0]!, grown])).not.toThrow(); // idempotent: nothing more retired
    expect(checksOf(k2)).toHaveLength(2);

    const app2 = appFor([KATAS[0]!, grown]);
    expect(UnitDetailResponse.parse((await request(app2).get(`/api/units/${k2}`)).body).kata?.supersededAnswerIds).toEqual([v1.body.attemptId]);
    expectError(await request(app2).get(`/api/units/${k2}/kata/key`), 403, 'NOT_ANSWERED');
    const v2 = await request(app2).post(`/api/units/${k2}/kata/findings`).send({ findings: [FINDING] }).expect(200);
    expect(v2.body.mode).toBe('assisted');
    expect(tmp.db.get('SELECT assistance_source, check_id FROM attempt WHERE id = ?', v2.body.attemptId)).toEqual({ assistance_source: 'prior-key', check_id: after[1]!.id });
    expect(KataKeyResponse.parse((await request(app2).get(`/api/units/${k2}/kata/key`)).body).defects).toHaveLength(3);
    const s = KataScoreResponse.parse((await request(app2).post(`/api/units/${k2}/kata/self-score`).send({ perDefect: { d1: 'caught', d2: 'caught', d3: 'caught' } })).body);
    expect(s).toMatchObject({ caught: 3, total: 3 });
    // G1: the kata counts by its EARLIEST ANSWER (v1, never scored), so the perfect v2 score adds nothing - not a solo kata,
    // not a stand-in for v1; the gate's history is unchanged
    expect(KataStatsResponse.parse((await request(app2).get('/api/stats/katas')).body)).toMatchObject({ katasScored: 1, defectsCaught: 1, defectsTotal: 1 });
  });

  it('F3 + F2 (kata, scored v1): G1 keeps the v1 score as answered; the v2 re-answer after the key was read is assisted and never counted', async () => {
    load(KATAS);
    const k2 = unitOf(kataUnitKey(KATAS[1]!));
    const app1 = appFor(KATAS);
    await request(app1).post(`/api/units/${k2}/kata/findings`).send({ findings: [FINDING] }).expect(200);
    await request(app1).get(`/api/units/${k2}/kata/key`).expect(200);
    await request(app1).post(`/api/units/${k2}/kata/self-score`).send({ perDefect: { d1: 'caught', d2: 'missed' } }).expect(200);
    const grown = { ...KATAS[1]!, seededDefectKey: [...KATAS[1]!.seededDefectKey, KATAS[1]!.seededDefectKey[0]!] };
    load([KATAS[0]!, grown]);
    const app2 = appFor([KATAS[0]!, grown]);
    const v2 = await request(app2).post(`/api/units/${k2}/kata/findings`).send({ findings: [FINDING] }).expect(200);
    expect(v2.body.mode).toBe('assisted');
    const s = KataScoreResponse.parse((await request(app2).post(`/api/units/${k2}/kata/self-score`).send({ perDefect: { d1: 'caught', d2: 'caught', d3: 'caught' } })).body);
    expect(s).toMatchObject({ caught: 3, total: 3, xp: { amount: 0, reason: 'already-awarded' } }); // this unit paid on v1
    expect(KataStatsResponse.parse((await request(app2).get('/api/stats/katas')).body)).toMatchObject({ katasScored: 1, assistedCount: 0, defectsCaught: 1, defectsTotal: 2 });
  });

  it('F3 (explain-back): a re-seed that changes the QUESTION COUNT boots; the answered check is retired with its frame; the unit shows the superseded answer', async () => {
    load([EB_LOW]);
    const u = unitOf(explainBackUnitKey(EB_LOW));
    const app1 = appFor([EB_LOW]);
    const v1 = await request(app1).post(`/api/units/${u}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const [v1Check] = checksOf(u);
    expect(v1Check!.spec).toMatchObject({ questionCount: EB_LOW.questions.length });

    const more = { ...EB_LOW, questions: [...EB_LOW.questions, EB_LOW.questions[0]!] };
    expect(() => load([more])).not.toThrow(); // was: LadderLoadError (questionCount changed) at startup
    expect(unitOf(explainBackUnitKey(more))).toBe(u);
    const after = checksOf(u);
    expect(after.map((c) => [c.spec.questionCount, c.retired === null])).toEqual([
      [EB_LOW.questions.length, false],
      [more.questions.length, true],
    ]);
    expect(tmp.db.get<{ check_id: number }>('SELECT check_id FROM attempt WHERE id = ?', v1.body.attemptId)!.check_id).toBe(v1Check!.id);
    expect(UnitDetailResponse.parse((await request(appFor([more])).get(`/api/units/${u}`)).body).explainBack).toMatchObject({ answered: false, supersededAnswerIds: [v1.body.attemptId] });
  });

  it('F3 (explain-back): a check stored by an OLDER writer (no questionCount; the schema default makes it the same check) and referenced by an answer neither refuses startup nor churns', async () => {
    load([EB_LOW]);
    const u = unitOf(explainBackUnitKey(EB_LOW));
    const [c] = checksOf(u);
    // the pre-W7 shape: the spec without questionCount (allowed while unreferenced)
    tmp.db.run('UPDATE "check" SET spec = ? WHERE id = ?', JSON.stringify({ type: 'explain-back', questionSetKey: EB_LOW.key, minCoverage: 0.8 }), c!.id);
    const app = appFor([EB_LOW]);
    const v1 = await request(app).post(`/api/units/${u}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    // was: the loader's key-by-key compare saw questionCount "change" and refused EVERY restart ("its check changed")
    expect(() => load([EB_LOW])).not.toThrow();
    // semantically the same check (questionCount defaults to 3): nothing retired, nothing rewritten
    expect(checksOf(u)).toEqual([{ id: c!.id, spec: { type: 'explain-back', questionSetKey: EB_LOW.key, minCoverage: 0.8 }, retired: null }]);
    // the same item version: v1 is still its answer of record, keyed through the live unit
    expect(ExplainBackKeyResponse.parse((await request(app).get(`/api/units/${u}/explain-back/key`)).body).attemptId).toBe(v1.body.attemptId);
  });

  it('F3: an UNREFERENCED changed check is updated in place (nothing was graded by it), not retired', () => {
    load(KATAS);
    const k2 = unitOf(kataUnitKey(KATAS[1]!));
    const [c] = checksOf(k2);
    const grown = { ...KATAS[1]!, seededDefectKey: [...KATAS[1]!.seededDefectKey, KATAS[1]!.seededDefectKey[0]!] };
    load([KATAS[0]!, grown]);
    expect(checksOf(k2)).toEqual([{ id: c!.id, spec: expect.objectContaining({ defectCount: 3 }), retired: null }]);
  });
});

describe('F6: artifactsAwaitingSoloPass never waits on an artifact that can never pass solo', () => {
  const ctx = useLadder();

  it('an artifact whose variation_of CHAIN was revealed, or whose only check was retired, is not waited on (no permanent ARTIFACT_REQUIRED)', async () => {
    const httpSpec = primaryCheck(ctx.tmp.db, ctx.id('fixture:ladder/project-api'))!.spec;
    const mk = (key: string) =>
      insertUnit(ctx.tmp.db, { key, track: 'js', kind: 'http-lab', title: `[fixture] ${key}`, competencies: ['data-http'], checks: [{ spec: httpSpec }] }, ctx.clock);
    const chained = mk('fixture:ladder/project-chained');
    const noLiveCheck = mk('fixture:ladder/project-no-live-check');
    const healthy = mk('fixture:ladder/project-healthy');
    // `chained` is a variation of project-api; project-api's solution gets revealed -> every attempt on `chained` is guided
    ctx.tmp.db.run('UPDATE unit SET variation_of_unit_id = ? WHERE id = ?', ctx.id('fixture:ladder/project-api'), chained);
    ctx.tmp.db.run('UPDATE "check" SET retired_at = ? WHERE unit_id = ?', ctx.clock().getTime(), noLiveCheck);
    const eb = insertUnit(
      ctx.tmp.db,
      {
        key: 'fixture:ladder/explain-chain',
        track: 'js',
        kind: 'explain-back',
        title: '[fixture] explain the chain',
        competencies: ['data-http'],
        prerequisites: ['fixture:ladder/project-chained', 'fixture:ladder/project-no-live-check', 'fixture:ladder/project-healthy'],
        checks: [{ spec: { type: 'explain-back', questionSetKey: 'seed:explainback:chain-copy' } }],
      },
      ctx.clock,
    );
    const app = createApp({ db: ctx.tmp.db, clock: ctx.clock, runners: { http: fakeHttp }, seedItems: mapSeedItemStore([...fixture.seedItems, { ...EB, key: 'seed:explainback:chain-copy' }]) });
    const required = async () => UnitDetailResponse.parse((await request(app).get(`/api/units/${eb}`)).body).explainBack?.artifactRequired?.map((a) => a.unitId);
    // before the reveal: `chained` can still pass solo, so it is waited on; the retired-check unit never is
    expect(await required()).toEqual([chained, healthy]);
    revealSolution(ctx.tmp.db, ctx.id('fixture:ladder/project-api'), ctx.clock);
    expect(await required()).toEqual([healthy]);
    // proof the wait would have been permanent: a pass on `chained` is guided now
    const sub = SubmitResponse.parse((await request(app).post(`/api/units/${chained}/submit`).send({ port: GOOD_PORT })).body);
    expect(sub.attempt.mode).toBe('guided');
    await request(app).post(`/api/units/${healthy}/submit`).send({ port: GOOD_PORT }).expect(200);
    expect(await required()).toEqual([]);
    await request(app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
  });
});

describe('explain-back PRACTICE retakes (assisted, 0 XP, never a promotion leg; the answer of record is untouched)', () => {
  const ctx = useLadder();
  const practiceUrl = (id: number) => `/api/units/${id}/explain-back/practice`;
  const practiceScoreUrl = (id: number) => `/api/units/${id}/explain-back/practice-score`;
  const detail = async (app: Express, id: number) => UnitDetailResponse.parse((await request(app).get(`/api/units/${id}`)).body).explainBack;
  const PRACTICE = ['practice: read-only roles are guarded', 'practice: transitions are guarded', 'practice: tenants are isolated'];

  it('refused before the answer of record (403 NOT_ANSWERED) and before its self-score (409 NOT_VERIFIED); nothing recorded', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    expect((await detail(ctx.app, id))?.practice).toEqual({ available: false, count: 0, latestUnscoredAttemptId: null });
    expectError(await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE }), 403, 'NOT_ANSWERED');
    await passArtifact(ctx);
    const ans = await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const before = ledgerCounts(ctx.tmp.db);
    const res = await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE });
    expectError(res, 409, 'NOT_VERIFIED');
    expect(res.body.error.message).toContain('self-score your answer of record first');
    expect(res.body.error.message).not.toContain('#' + ans.body.attemptId);
    expect(ledgerCounts(ctx.tmp.db)).toEqual(before);
    expect((await detail(ctx.app, id))?.practice).toEqual({ available: false, count: 0, latestUnscoredAttemptId: null });
  });

  it('strict bodies: 3 non-empty answers, no selfAssisted (practice is assisted by construction); practice-score marks every key point once', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    expectError(await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE.slice(0, 2) }), 400, 'VALIDATION');
    expectError(await request(ctx.app).post(practiceUrl(id)).send({ answers: [...PRACTICE.slice(0, 2), '  '] }), 400, 'VALIDATION');
    expectError(await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE, selfAssisted: false }), 400, 'VALIDATION');
    expectError(await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: 0, perKeyPoint: marks(16) }), 400, 'VALIDATION');
    expectError(await request(ctx.app).post(practiceScoreUrl(id)).send({ perKeyPoint: marks(16) }), 400, 'VALIDATION');
    expectError(await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: 1, perKeyPoint: marks(16), xp: 20 }), 400, 'VALIDATION');
  });

  it('dead end #3 (practice): a practice attempt stranded on a RETIRED unit is scored from the live twin carrying the same item; practice continues there', async () => {
    const a = ctx.id('fixture:ladder/explain-api');
    await passArtifact(ctx);
    await request(ctx.app).post(`/api/units/${a}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    await request(ctx.app).post(`/api/units/${a}/explain-back/self-score`).send({ perKeyPoint: marks(16) }).expect(200);
    const p1 = await request(ctx.app).post(practiceUrl(a)).send({ answers: PRACTICE }).expect(200);
    // a re-seed / re-link moves the item to a new unit key: the old unit retires (404s everywhere)
    ctx.tmp.db.run('UPDATE unit SET retired_at = ? WHERE id = ?', ctx.clock().getTime(), a);
    const live = insertUnit(
      ctx.tmp.db,
      {
        key: 'fixture:ladder/explain-api-v2',
        track: 'js',
        kind: 'explain-back',
        title: '[fixture] explain-api moved',
        competencies: ['data-http'],
        prerequisites: ['fixture:ladder/project-api'],
        checks: [{ spec: { type: 'explain-back', questionSetKey: EB.key } }],
      },
      ctx.clock,
    );
    expect(() => assertUniqueSeedItemRefs(ctx.tmp.db)).not.toThrow();
    // the stranded UNSCORED practice attempt is scored FROM the live twin (was: 409 NOT_VERIFIED — a wedge,
    // since the retired unit 404s); the evidence still binds the attempt's own unit and competencies
    const sc = await request(ctx.app).post(practiceScoreUrl(live)).send({ attemptId: p1.body.attemptId, perKeyPoint: marks(16) });
    expect(sc.status, sc.text).toBe(200);
    expect(sc.body).toMatchObject({ xp: null, retests: [], promotions: [] });
    expect(ctx.tmp.db.get<{ unit_id: number }>('SELECT unit_id FROM evidence WHERE attempt_id = ?', p1.body.attemptId)!.unit_id).toBe(a);
    // and new practice continues on the twin
    await request(ctx.app).post(practiceUrl(live)).send({ answers: PRACTICE }).expect(200);
  });

  it('a practice retake: assisted attempt (practice), listed on the key, self-scored as practice evidence with NO xp_event / retest / promotion; one unscored at a time; append-only', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    await passArtifact(ctx);
    ctx.clock.advance(60_000);
    const rec = await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const sc = ExplainBackScoreResponse.parse((await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(14) })).body);
    expect(sc.xp).toMatchObject({ amount: 20 });
    expect((await detail(ctx.app, id))?.practice).toEqual({ available: true, count: 0, latestUnscoredAttemptId: null });
    const reviewItems = () => ctx.tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_item')!.n;
    const rating = getRating(ctx.tmp.db, 'data-http');
    const retestsBefore = reviewItems();

    ctx.clock.advance(60_000);
    const before = ledgerCounts(ctx.tmp.db);
    const p1 = await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE });
    expect(p1.status, p1.text).toBe(200);
    expect(p1.body).toMatchObject({ mode: 'assisted', outcome: 'submitted' });
    expect(ledgerCounts(ctx.tmp.db)).toEqual({ ...before, attempt: before.attempt + 1 });
    const row = ctx.tmp.db.get<{ mode: string; assisted: boolean; assistance_source: string; answer: string }>(
      'SELECT mode, assisted, assistance_source, answer FROM attempt WHERE id = ?',
      p1.body.attemptId,
    )!;
    expect({ mode: row.mode, assisted: row.assisted, assistance_source: row.assistance_source }).toEqual({ mode: 'assisted', assisted: true, assistance_source: 'practice' });
    expect(JSON.parse(row.answer)).toEqual({ explainBack: { questionSetKey: EB.key, itemSha: seedItemHash(EB), answers: PRACTICE, practice: true } });
    expect(() => ctx.tmp.db.run('UPDATE attempt SET answer = NULL WHERE id = ?', p1.body.attemptId)).toThrow(/append-only/);
    expect((await detail(ctx.app, id))?.practice).toEqual({ available: true, count: 1, latestUnscoredAttemptId: p1.body.attemptId });

    // the answer of record is untouched: the key, POST /answers one-shot and the record's score all stand
    const key = ExplainBackKeyResponse.parse((await request(ctx.app).get(`/api/units/${id}/explain-back/key`)).body);
    expect(key.attemptId).toBe(rec.body.attemptId);
    expect(key.answers).toEqual(ANSWERS);
    expect(key.scored?.score).toBeCloseTo(0.875);
    expect(key.practice).toEqual([{ attemptId: p1.body.attemptId, answeredAt: ctx.clock().getTime(), answers: PRACTICE, scored: null }]);
    expectError(await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }), 403, 'ALREADY_ANSWERED');
    expectError(await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(16) }), 409, 'ALREADY_SCORED');

    // one unscored practice at a time
    const p2early = await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE });
    expectError(p2early, 403, 'ALREADY_ANSWERED');
    expect(p2early.body.error.message).toContain('practice attempt 1');
    expect(p2early.body.error.message).not.toContain('#' + p1.body.attemptId);

    // practice-score: never the answer of record, never an unknown attempt
    expectError(await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: rec.body.attemptId, perKeyPoint: marks(16) }), 409, 'NOT_VERIFIED');
    expectError(await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: 999_999, perKeyPoint: marks(16) }), 404, 'NOT_FOUND');
    expectError(await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: p1.body.attemptId, perKeyPoint: { ...marks(16), q9k9: 'covered' } }), 400, 'VALIDATION');
    // ...nor from another unit
    expectError(
      await request(ctx.app).post(practiceScoreUrl(ctx.id('fixture:ladder/explain-low'))).send({ attemptId: p1.body.attemptId, perKeyPoint: marksLow(LOW_IDS.length) }),
      409,
      'NOT_VERIFIED',
    );

    ctx.clock.advance(60_000);
    const xpBefore = ledgerCounts(ctx.tmp.db).xp_event;
    const ps = ExplainBackScoreResponse.parse((await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: p1.body.attemptId, perKeyPoint: marks(16) })).body);
    expect(ps).toMatchObject({ attemptId: p1.body.attemptId, covered: 16, total: 16, passed: true, xp: null, retests: [], promotions: [] });
    expect(ledgerCounts(ctx.tmp.db).xp_event).toBe(xpBefore); // no xp_event row at all (not even a 0-XP one)
    expect(reviewItems()).toBe(retestsBefore);
    expect(getRating(ctx.tmp.db, 'data-http')).toBe(rating);
    const evs = ctx.tmp.db.all<{ kind: string; assessor: string; assistance: string; attempt_id: number; score: number }>(
      `SELECT kind, assessor, assistance, attempt_id, score FROM evidence WHERE id IN (${ps.evidenceIds.map(() => '?').join(', ')})`,
      ...ps.evidenceIds,
    );
    expect(evs.length).toBeGreaterThan(0);
    for (const e of evs) expect(e).toEqual({ kind: 'explain-back', assessor: 'self', assistance: 'practice', attempt_id: p1.body.attemptId, score: 1 });
    expectError(await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: p1.body.attemptId, perKeyPoint: marks(16) }), 409, 'ALREADY_SCORED');

    // scored -> the next practice opens; history is ascending, each with its own score
    const p2 = await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE.map((a) => `again ${a}`) });
    expect(p2.status, p2.text).toBe(200);
    const key2 = ExplainBackKeyResponse.parse((await request(ctx.app).get(`/api/units/${id}/explain-back/key`)).body);
    expect(key2.attemptId).toBe(rec.body.attemptId);
    expect(key2.practice?.map((p) => p.attemptId)).toEqual([p1.body.attemptId, p2.body.attemptId]);
    expect(key2.practice?.[0]!.scored?.score).toBe(1);
    expect(key2.practice?.[1]!.scored).toBeNull();
    expect((await detail(ctx.app, id))?.practice).toEqual({ available: true, count: 2, latestUnscoredAttemptId: p2.body.attemptId });
  });

  it('learner-facing errors use per-unit practice ordinals, never global attempt ids', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    await passArtifact(ctx);
    await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(16) }).expect(200);

    // practice #1 recorded -> a second practice is refused, naming it by its per-unit ordinal
    const p1 = await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE }).expect(200);
    const early = await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE });
    expectError(early, 403, 'ALREADY_ANSWERED');
    expect(early.body.error.message).toContain('practice attempt 1 is recorded and unscored');
    expect(early.body.error.message).not.toContain('#' + p1.body.attemptId);

    // score #1, then record and score #2
    await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: p1.body.attemptId, perKeyPoint: marks(16) }).expect(200);
    const p2 = await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE }).expect(200);
    await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: p2.body.attemptId, perKeyPoint: marks(16) }).expect(200);

    // re-scoring #1 names #1 (index-based), not the latest
    const again1 = await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: p1.body.attemptId, perKeyPoint: marks(16) });
    expectError(again1, 409, 'ALREADY_SCORED');
    expect(again1.body.error.message).toContain('practice attempt 1 is already self-scored');
    expect(again1.body.error.message).not.toContain('#' + p1.body.attemptId);
    const again2 = await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: p2.body.attemptId, perKeyPoint: marks(16) });
    expectError(again2, 409, 'ALREADY_SCORED');
    expect(again2.body.error.message).toContain('practice attempt 2 is already self-scored');
    expect(again2.body.error.message).not.toContain('#' + p2.body.attemptId);

    // the ordinals match the served practice array (oldest-first)
    const key = ExplainBackKeyResponse.parse((await request(ctx.app).get(`/api/units/${id}/explain-back/key`)).body);
    expect(key.practice?.map((p) => p.attemptId)).toEqual([p1.body.attemptId, p2.body.attemptId]);
  });

  it('a practice pass never anchors leg (b); a weak practice score never renders a failed leg (the display query is assistance-none only)', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    await passArtifact(ctx);
    // the answer of record is honor-system assisted, so leg (b) is open; practice must not fill it
    await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS, selfAssisted: true }).expect(200);
    await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(16) }).expect(200);
    const leg = async () => CompetenciesResponse.parse((await request(ctx.app).get('/api/competencies')).body).competencies.find((c) => c.id === 'data-http')!.promotion;
    expect((await leg()).explainBack).toMatchObject({ state: 'pending', evidenceId: null });

    const p1 = await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE }).expect(200);
    const pass = ExplainBackScoreResponse.parse((await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: p1.body.attemptId, perKeyPoint: marks(16) })).body);
    expect(pass.passed).toBe(true);
    expect((await leg()).explainBack).toMatchObject({ state: 'pending', evidenceId: null });

    const p2 = await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE }).expect(200);
    const weak = ExplainBackScoreResponse.parse((await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: p2.body.attemptId, perKeyPoint: marks(4) })).body);
    expect(weak).toMatchObject({ passed: false, xp: null, retests: [], promotions: [] });
    // was: the newest explain-back evidence of ANY assistance showed as a failed promotion leg
    expect((await leg()).explainBack).toMatchObject({ state: 'pending', evidenceId: null, coverage: null });
    expect((await leg()).retest.state).toBe('pending');
  });

  it('a solo answer of record keeps leg (b) through practice: the leg stays the RECORD evidence', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    await passArtifact(ctx);
    await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const rec = ExplainBackScoreResponse.parse((await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(16) })).body);
    const p = await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE }).expect(200);
    await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: p.body.attemptId, perKeyPoint: marks(2) }).expect(200);
    const row = CompetenciesResponse.parse((await request(ctx.app).get('/api/competencies')).body).competencies.find((c) => c.id === 'data-http')!;
    expect(row.promotion.explainBack).toMatchObject({ state: 'done', evidenceId: rec.evidenceIds[0] });
  });

  it('interplay with a re-seed: practice rows of the earlier version are superseded with it; the fresh answer is still prior-key; practice restarts per version', async () => {
    const id = ctx.id('fixture:ladder/explain-api');
    await passArtifact(ctx);
    const rec = await request(ctx.app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    await request(ctx.app).post(`/api/units/${id}/explain-back/self-score`).send({ perKeyPoint: marks(16) }).expect(200);
    const p = await request(ctx.app).post(practiceUrl(id)).send({ answers: PRACTICE }).expect(200);
    await request(ctx.app).post(practiceScoreUrl(id)).send({ attemptId: p.body.attemptId, perKeyPoint: marks(16) }).expect(200);

    const changed = { ...EB, questions: EB.questions.map((q, i) => (i === 0 ? { ...q, keyPoints: q.keyPoints.slice(1) } : q)) };
    const app = createApp({ db: ctx.tmp.db, clock: ctx.clock, runners: {}, seedItems: mapSeedItemStore([changed, ...KATAS]) });
    const d = await detail(app, id);
    expect(d?.answered).toBe(false);
    expect(d?.supersededAnswerIds).toEqual([rec.body.attemptId, p.body.attemptId]);
    expect(d?.practice).toEqual({ available: false, count: 0, latestUnscoredAttemptId: null });
    expectError(await request(app).post(practiceUrl(id)).send({ answers: PRACTICE }), 403, 'NOT_ANSWERED');
    // the earlier version's practice attempt cannot be scored against the new content
    expectError(await request(app).post(practiceScoreUrl(id)).send({ attemptId: p.body.attemptId, perKeyPoint: marks(15) }), 409, 'NOT_VERIFIED');
    ctx.clock.advance(60_000);
    const fresh = await request(app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    expect(ctx.tmp.db.get('SELECT mode, assisted, assistance_source FROM attempt WHERE id = ?', fresh.body.attemptId)).toEqual({ mode: 'assisted', assisted: true, assistance_source: 'prior-key' });
    expect(ExplainBackKeyResponse.parse((await request(app).get(`/api/units/${id}/explain-back/key`)).body)).toMatchObject({ attemptId: fresh.body.attemptId, practice: [] });
    // the original content still serves its own record and its practice history
    const old = ExplainBackKeyResponse.parse((await request(ctx.app).get(`/api/units/${id}/explain-back/key`)).body);
    expect(old.attemptId).toBe(rec.body.attemptId);
    expect(old.practice?.map((x) => x.attemptId)).toEqual([p.body.attemptId]);
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
