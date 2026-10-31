import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { CompetenciesResponse, ExplainBackKeyResponse, ExplainBackScoreResponse, SubmitResponse } from '@bootquest/shared/api';
import type { SeedExplainBackItem } from '@bootquest/shared';
import { createApp } from '../src/api/app.ts';
import type { Runner } from '../src/api/runners.ts';
import { DAY_MS, fixedClock } from '../src/engines/clock.ts';
import { EB_PASS_SQL, ebObservation, ebPasses, ebScore } from '../src/engines/eb-score.ts';
import { evaluatePromotion, recordEvidence } from '../src/engines/evidence.ts';
import { recordAttempt } from '../src/engines/attempts.ts';
import { awardXp } from '../src/engines/xp.ts';
import { insertUnit } from '../src/store/content.ts';
import { primaryCheck } from '../src/store/queries.ts';
import { mapSeedItemStore, seedItemHash } from '../src/store/seed-items.ts';
import { localNoon, makeTempDb, type TempDb } from './helpers.ts';
import fixture from './fixtures/ladder-fixture.json' with { type: 'json' };

/**
 * A5 explain-back weights: a set whose every key point carries `[wN]` is scored by weight and passes
 * only with weighted coverage >= 80% AND no [w3] missed; a legacy (unweighted) set behaves exactly as
 * before. One predicate (ebPasses / EB_PASS_SQL) decides `passed`, XP, the leg display and promotion.
 */

const EB = fixture.seedItems.find((i) => i.kind === 'explain-back') as unknown as SeedExplainBackItem;
const IDS = EB.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => `q${qi + 1}k${ki + 1}`));
// 16 key points: six [w3], six [w2], four [w1] -> total weight 34
const WEIGHTS: Record<string, 1 | 2 | 3> = Object.fromEntries(
  IDS.map((id) => [id, /k[12]$/.test(id) ? 3 : ['q1k5', 'q2k5', 'q2k6', 'q3k5'].includes(id) ? 1 : 2]),
);
const WEIGHTED: SeedExplainBackItem = {
  ...structuredClone(EB),
  questions: EB.questions.map((q, qi) => ({
    ...q,
    keyPoints: q.keyPoints.map((kp, ki) => ({ ...kp, text: `[w${WEIGHTS[`q${qi + 1}k${ki + 1}`]}] ${kp.text}` })),
  })),
};
const SEED_ITEMS = (weighted: boolean) => fixture.seedItems.map((i) => (i.key === EB.key && weighted ? WEIGHTED : i));
const ANSWERS = ['the permission test guards read-only roles', 'the state machine test guards transitions', 'tenant isolation is tested per repository'];
const markMissed = (...missed: string[]) => Object.fromEntries(IDS.map((id) => [id, missed.includes(id) ? 'missed' : 'covered'])) as Record<string, 'covered' | 'missed'>;
const GOOD_PORT = 4000;
const fakeHttp: Runner = async (_spec, sub) =>
  sub.port === GOOD_PORT
    ? { pass: true, output: '', failures: [], durationMs: 1 }
    : { pass: false, output: '', failures: [{ name: 'health answers ok', message: 'connection refused' }], durationMs: 1 };
const fakeDrill: Runner = async (_spec, sub) =>
  /Math\.min\(n, 100\)/.test(sub.code ?? '')
    ? { pass: true, output: '', failures: [], durationMs: 1 }
    : { pass: false, output: '', failures: [{ name: 'caps at 100', message: 'wrong' }], durationMs: 1 };

interface DetailRow {
  plain: number;
  weighted: number;
  w3_missed: number;
  missed_ids: string;
}

describe('ebScore / ebPasses (pure)', () => {
  const kps = (texts: string[]) => texts.map((text, i) => ({ id: `q1k${i + 1}`, text }));

  it('legacy set: plain coverage, no w3 rule; a mixed set is legacy too', () => {
    const s = ebScore(kps(['a', 'b', 'c', 'd', 'e']), { q1k1: 'covered', q1k2: 'covered', q1k3: 'covered', q1k4: 'covered', q1k5: 'missed' });
    expect(s).toEqual({ covered: 4, total: 5, plain: 0.8, weighted: 0.8, weightedSet: false, score: 0.8, missed: ['q1k5'], w3Missed: [] });
    expect(ebPasses(s.score, s.w3Missed.length)).toBe(true);
    const mixed = ebScore(kps(['[w3] a', 'b']), { q1k1: 'missed', q1k2: 'covered' });
    expect(mixed).toMatchObject({ weightedSet: false, score: 0.5, w3Missed: [] });
  });

  it('weighted set: Σ weight(covered) / Σ weight(all); a missed [w3] fails at any score', () => {
    const set = kps(['[w3] a', '[w2] b', '[w1] c', '[w1] d', '[w1] e']); // total 8
    const lowWeights = ebScore(set, { q1k1: 'covered', q1k2: 'covered', q1k3: 'missed', q1k4: 'covered', q1k5: 'covered' });
    expect(lowWeights).toMatchObject({ plain: 0.8, weighted: 7 / 8, score: 7 / 8, w3Missed: [] });
    expect(ebPasses(lowWeights.score, 0)).toBe(true);
    const w3 = ebScore(kps(['[w3] a', ...Array.from({ length: 11 }, (_, i) => `[w3] k${i}`)]), { ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`q1k${i + 1}`, 'covered'])), q1k1: 'missed' });
    expect(w3.score).toBeCloseTo(11 / 12);
    expect(w3.w3Missed).toEqual(['q1k1']);
    expect(ebPasses(w3.score, w3.w3Missed.length)).toBe(false);
    // the unit mark may be stricter, never laxer than the 80% floor
    expect(ebPasses(0.85, 0, 0.9)).toBe(false);
    expect(ebPasses(0.8, 0, 0.5)).toBe(true);
    expect(ebPasses(0.79, 0, 0.5)).toBe(false);
    expect(ebPasses(null, 0)).toBe(false);
  });

  it('legacy observation text is byte-identical to the pre-A5 format; weighted sets add the weighted % and the w3 misses', () => {
    const s = ebScore(kps(['a', 'b', 'c']), { q1k1: 'covered', q1k2: 'missed', q1k3: 'missed' });
    expect(ebObservation(s)).toBe('1/3 key points covered (33.3%); missed q1k2, q1k3');
    const w = ebScore(kps(['[w3] a', '[w2] b', '[w1] c']), { q1k1: 'missed', q1k2: 'covered', q1k3: 'covered' });
    expect(ebObservation(w)).toBe('2/3 key points covered (66.7%); weighted 50%; missed q1k1; [w3] missed q1k1');
  });
});

describe('explain-back weights through the HTTP API', () => {
  let tmp: TempDb;
  let clock: ReturnType<typeof fixedClock>;
  let app: Express;
  let ids: Map<string, number>;
  const id = (k: string) => ids.get(k)!;

  function boot(weighted: boolean): void {
    tmp = makeTempDb();
    clock = fixedClock(localNoon(2026, 10, 1));
    ids = new Map();
    for (const u of fixture.units) ids.set(u.key, insertUnit(tmp.db, u, clock));
    app = createApp({ db: tmp.db, clock, runners: { http: fakeHttp, 'drill-js': fakeDrill }, seedItems: mapSeedItemStore(SEED_ITEMS(weighted)) });
  }
  afterEach(() => tmp.cleanup());

  async function answerAndScore(perKeyPoint: Record<string, 'covered' | 'missed'>) {
    await request(app).post(`/api/units/${id('fixture:ladder/project-api')}/submit`).send({ port: GOOD_PORT }).expect(200);
    clock.advance(60_000);
    const ans = await request(app).post(`/api/units/${id('fixture:ladder/explain-api')}/explain-back/answers`).send({ answers: ANSWERS }).expect(200);
    const res = await request(app).post(`/api/units/${id('fixture:ladder/explain-api')}/explain-back/self-score`).send({ perKeyPoint });
    expect(res.status, res.text).toBe(200);
    return { attemptId: ans.body.attemptId as number, score: ExplainBackScoreResponse.parse(res.body) };
  }
  const detail = (evidenceId: number) => tmp.db.get<DetailRow>('SELECT plain, weighted, w3_missed, missed_ids FROM eb_score_detail WHERE evidence_id = ?', evidenceId);
  const sqlPasses = (evidenceId: number) => !!tmp.db.get<{ p: number }>(`SELECT ${EB_PASS_SQL} AS p FROM evidence e WHERE e.id = ?`, evidenceId)!.p;
  const leg = async () =>
    CompetenciesResponse.parse((await request(app).get('/api/competencies')).body).competencies.find((c) => c.id === 'data-http')!.promotion.explainBack;
  const passRetest = async () => {
    clock.advance(2 * DAY_MS);
    return SubmitResponse.parse((await request(app).post(`/api/units/${id('fixture:ladder/project-api-retest')}/submit`).send({ code: fixture.solutions.retest })).body);
  };

  describe('weighted set', () => {
    beforeEach(() => boot(true));

    it('91% weighted but a [w3] missed -> fail: no pass XP, no retest, leg (b) failed, no promotion; one detail row per evidence row', async () => {
      const { attemptId, score } = await answerAndScore(markMissed('q1k1'));
      expect(score).toMatchObject({ covered: 15, total: 16, passed: false, xp: null, retests: [], promotions: [], missed: ['q1k1'] });
      expect(score.coverage).toBeCloseTo(31 / 34); // >= 80%: only the w3 rule fails it
      expect(score.evidenceIds.length).toBeGreaterThan(0);
      for (const ev of score.evidenceIds) {
        expect(tmp.db.get<{ score: number }>('SELECT score FROM evidence WHERE id = ?', ev)!.score).toBeCloseTo(31 / 34);
        const d = detail(ev)!;
        expect(d).toMatchObject({ w3_missed: 1, missed_ids: '["q1k1"]' });
        expect(d.plain).toBeCloseTo(15 / 16);
        expect(d.weighted).toBeCloseTo(31 / 34);
        expect(sqlPasses(ev)).toBe(false);
      }
      expect(tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM eb_score_detail')!.n).toBe(score.evidenceIds.length);
      // the XP engine refuses it on its own (not only because the service skipped it)
      expect(() => awardXp(tmp.db, { kind: 'explain-back', attemptId }, clock)).toThrow(/every \[w3\]/);
      expect(tmp.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM xp_event WHERE kind = 'explain-back'")!.n).toBe(0);
      expect(evaluatePromotion(tmp.db, 'data-http', clock).legs.explainBack).toBeNull();
      expect(await leg()).toEqual({ state: 'failed', evidenceId: score.evidenceIds[0], coverage: expect.closeTo(31 / 34, 9) });
      // no retest was scheduled: the retest unit refuses a solo submit, and nothing promotes
      clock.advance(2 * DAY_MS);
      const rt = await request(app).post(`/api/units/${id('fixture:ladder/project-api-retest')}/submit`).send({ code: fixture.solutions.retest });
      expect(rt.status, rt.text).toBe(409);
      expect(tmp.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM review_item WHERE kind = 'retest'")!.n).toBe(0);
      expect(tmp.db.get<{ rating: number }>("SELECT rating FROM competency_rating WHERE competency_id = 'data-http'")!.rating).toBe(1);
    });

    it('plain 75% but weighted 88% with every [w3] covered -> pass: 20 XP, retest scheduled, leg done, the chain promotes', async () => {
      const { score } = await answerAndScore(markMissed('q1k5', 'q2k5', 'q2k6', 'q3k5'));
      expect(score).toMatchObject({ covered: 12, total: 16, passed: true, xp: { amount: 20, reason: null } });
      expect(score.coverage).toBeCloseTo(30 / 34);
      expect(score.retests).toHaveLength(1);
      const d = detail(score.evidenceIds[0]!)!;
      expect(d).toMatchObject({ plain: 0.75, w3_missed: 0, missed_ids: '["q1k5","q2k5","q2k6","q3k5"]' });
      expect(sqlPasses(score.evidenceIds[0]!)).toBe(true);
      expect(evaluatePromotion(tmp.db, 'data-http', clock).legs.explainBack).toBe(score.evidenceIds[0]);
      expect((await leg()).state).toBe('done');
      // the key response's score of record is the weighted one
      const key = ExplainBackKeyResponse.parse((await request(app).get(`/api/units/${id('fixture:ladder/explain-api')}/explain-back/key`)).body);
      expect(key.scored?.score).toBeCloseTo(30 / 34);
      expect(key.questions[0]!.keyPoints[0]!.text.startsWith('[w3] ')).toBe(true); // served text keeps the prefix
      const rt = await passRetest();
      expect(rt.promotions).toEqual([expect.objectContaining({ competency: 'data-http', from: 1, to: 2 })]);
    });

    it('weighted below 80% with every [w3] covered -> fail', async () => {
      // miss all six [w2] and two [w1]: (34 - 12 - 2) / 34 = 58.8%
      const { score } = await answerAndScore(markMissed('q1k3', 'q1k4', 'q2k3', 'q2k4', 'q3k3', 'q3k4', 'q1k5', 'q2k5'));
      expect(score).toMatchObject({ passed: false, xp: null });
      expect(score.coverage).toBeCloseTo(20 / 34);
      expect(detail(score.evidenceIds[0]!)!.w3_missed).toBe(0);
      expect((await leg()).state).toBe('failed');
    });

    it('practice score: detail row written, the same predicate decides `passed`, never XP', async () => {
      await answerAndScore(markMissed());
      const eb = id('fixture:ladder/explain-api');
      const p = await request(app).post(`/api/units/${eb}/explain-back/practice`).send({ answers: ANSWERS }).expect(200);
      const res = await request(app).post(`/api/units/${eb}/explain-back/practice-score`).send({ attemptId: p.body.attemptId, perKeyPoint: markMissed('q2k1') });
      expect(res.status, res.text).toBe(200);
      const ps = ExplainBackScoreResponse.parse(res.body);
      expect(ps).toMatchObject({ passed: false, xp: null, retests: [], promotions: [], missed: ['q2k1'] });
      expect(ps.coverage).toBeCloseTo(31 / 34);
      expect(detail(ps.evidenceIds[0]!)).toMatchObject({ w3_missed: 1, missed_ids: '["q2k1"]' });
    });
  });

  describe('legacy (unweighted) set: unchanged', () => {
    beforeEach(() => boot(false));

    it('golden: 14/16 -> 87.5% plain, same observation text as before, detail plain = weighted, pass + 20 XP + promotion', async () => {
      const { score } = await answerAndScore(markMissed('q3k4', 'q3k5'));
      expect(score).toMatchObject({ covered: 14, total: 16, coverage: 0.875, minCoveragePct: 80, passed: true, missed: ['q3k4', 'q3k5'], xp: { amount: 20, reason: null } });
      const ev = tmp.db.get<{ score: number; observation: string }>('SELECT score, observation FROM evidence WHERE id = ?', score.evidenceIds[0]!)!;
      expect(ev).toEqual({ score: 0.875, observation: '14/16 key points covered (87.5%); missed q3k4, q3k5' });
      expect(detail(score.evidenceIds[0]!)).toEqual({ plain: 0.875, weighted: 0.875, w3_missed: 0, missed_ids: '["q3k4","q3k5"]' });
      const rt = await passRetest();
      expect(rt.promotions).toEqual([expect.objectContaining({ competency: 'data-http', from: 1, to: 2 })]);
    });

    it('golden: 12/16 -> 75% fails exactly as before (no XP, leg failed)', async () => {
      const { score } = await answerAndScore(markMissed('q3k2', 'q3k3', 'q3k4', 'q3k5'));
      expect(score).toMatchObject({ coverage: 0.75, passed: false, xp: null, retests: [] });
      expect(await leg()).toEqual({ state: 'failed', evidenceId: score.evidenceIds[0], coverage: 0.75 });
    });

    it('pre-A5 evidence (no detail row) keeps its plain meaning: it anchors leg (b) and pays XP at >= 80%', async () => {
      await request(app).post(`/api/units/${id('fixture:ladder/project-api')}/submit`).send({ port: GOOD_PORT }).expect(200);
      clock.advance(60_000);
      const eb = id('fixture:ladder/explain-api');
      const check = primaryCheck(tmp.db, eb)!;
      const attempt = recordAttempt(tmp.db, { unitId: eb, checkId: check.id, selfAssisted: false, answer: { explainBack: { questionSetKey: EB.key, itemSha: seedItemHash(EB), answers: ANSWERS } } }, clock);
      const ev = recordEvidence(tmp.db, { competency: 'data-http', kind: 'explain-back', intention: 'pre-A5 row', observation: 'x', score: 0.8, attemptId: attempt.id }, clock);
      expect(detail(ev.id)).toBeUndefined();
      expect(sqlPasses(ev.id)).toBe(true);
      expect(evaluatePromotion(tmp.db, 'data-http', clock).legs.explainBack).toBe(ev.id);
      expect(awardXp(tmp.db, { kind: 'explain-back', attemptId: attempt.id }, clock).amount).toBe(20);
    });
  });
});
