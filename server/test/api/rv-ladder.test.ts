/**
 * rv B (Wave 1b row 5; R4-07, R3-05): explain-back grading repairs.
 *   - a minimum real answer: an answer of record with < 15 words in any question is refused (400) before any key
 *     point is readable, and records nothing ("x, x, x" passed 18/18 and filed evidence);
 *   - GET /units/:id/source: the pinned repo tree of an explain-back / kata (seed provenance); G2 briefs are
 *     open-book, other sets are not; non-ladder units 404.
 */
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnitSourceResponse } from '@bootquest/shared/api-ext';
import { KataReviewResponse, KataVerdictScoreResponse } from '@bootquest/shared/api-ext';
import { KataKeyResponse, KataStatsResponse, UnitDetailResponse } from '@bootquest/shared/api';
import { makeKataFlags, setKataFlags } from '../../src/store/kata-flags.ts';
import { answerWords, EB_MIN_ANSWER_WORDS } from '@bootquest/shared/eb-weight';
import type { SeedExplainBackItem, SeedPatchKataItem } from '@bootquest/shared';
import { createApp } from '../../src/api/app.ts';
import type { Runner } from '../../src/api/runners.ts';
import { fixedClock } from '../../src/engines/clock.ts';
import { insertUnit } from '../../src/store/content.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
import { mapSeedItemStore } from '../../src/store/seed-items.ts';
import { localNoon, makeTempDb, makeUnit, type TempDb } from '../helpers.ts';
import fixture from '../fixtures/ladder-fixture.json' with { type: 'json' };

const EB = fixture.seedItems.find((i) => i.kind === 'explain-back') as unknown as SeedExplainBackItem;
const KATA = fixture.seedItems.find((i) => i.kind === 'patch-kata') as unknown as SeedPatchKataItem;
/** a G2 delegation brief: same shape, a "G2 BRIEF" prompt prefix (store/ladder.ts isG2) */
const G2: SeedExplainBackItem = {
  ...structuredClone(EB),
  key: 'seed:explainback:ww6/explain-back/g2-brief-fixture',
  questions: EB.questions.map((q, i) => ({ ...q, prompt: i === 0 ? `G2 BRIEF ${q.prompt}` : q.prompt })),
};
const GOOD_PORT = 4000;
const fakeHttp: Runner = async (_spec, sub) =>
  sub.port === GOOD_PORT ? { pass: true, output: '', failures: [], durationMs: 1 } : { pass: false, output: '', failures: [{ name: 'down', message: 'refused' }], durationMs: 1 };

describe('rv B explain-back + source', () => {
  let tmp: TempDb;
  let app: Express;
  const ids = new Map<string, number>();
  const clock = fixedClock(localNoon(2026, 11, 12));

  beforeEach(() => {
    tmp = makeTempDb();
    for (const u of fixture.units) ids.set(u.key, insertUnit(tmp.db, u, clock));
    ids.set('g2', insertUnit(tmp.db, { key: 'ladder/g2/ww6/fixture', track: 'js', kind: 'explain-back', title: 'G2 brief', competencies: ['agentic-engineering'], checks: [{ spec: { type: 'explain-back', questionSetKey: G2.key } }] }, clock));
    app = createApp({ db: tmp.db, clock, runners: { http: fakeHttp }, seedItems: mapSeedItemStore([...fixture.seedItems, G2] as never) });
  }, 60_000);
  afterEach(() => tmp.cleanup());
  const id = (k: string) => ids.get(k)!;

  it('answerWords counts letter/digit runs; "x, x, x" is 3 words', () => {
    expect(answerWords('x, x, x')).toBe(3);
    expect(answerWords("don't retry p99 O(n) — ever")).toBe(6); // O(n): two runs
    expect(EB_MIN_ANSWER_WORDS).toBe(15);
  });

  it('R4-07: an answer of record with fewer than 15 words in a question is refused before the key, recording nothing', async () => {
    await request(app).post(`/api/units/${id('fixture:ladder/project-api')}/submit`).send({ port: GOOD_PORT }).expect(200);
    const eb = id('fixture:ladder/explain-api');
    const before = ledgerCounts(tmp.db);
    const long = 'the guard rejects a viewer token on every write route, so the repository is never called and nothing changes';
    const res = await request(app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: ['x', long, 'x, x, x'] });
    expect(res.status, res.text).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/at least 15 words per answer.*Q1 has 1, Q3 has 3/);
    expect(res.body.error.issues.map((i: { path: string }) => i.path)).toEqual(['body.answers.0', 'body.answers.2']);
    expect(ledgerCounts(tmp.db)).toEqual(before);
    expect((await request(app).get(`/api/units/${eb}/explain-back/key`)).status).toBe(403);
    // a real answer goes through
    expect((await request(app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: [long, long, long] })).status).toBe(200);
  });

  it('R3-05: GET /units/:id/source serves the pinned tree; G2 briefs are open-book, other sets and katas are not', async () => {
    const g2 = UnitSourceResponse.parse((await request(app).get(`/api/units/${id('g2')}/source`)).body);
    expect(g2).toEqual({
      unitId: id('g2'),
      repo: G2.provenance.repo,
      sha: G2.provenance.sha,
      url: `https://github.com/elirc/${G2.provenance.repo}/tree/${G2.provenance.sha}`,
      openBook: true,
    });
    expect(UnitSourceResponse.parse((await request(app).get(`/api/units/${id('fixture:ladder/explain-api')}/source`)).body).openBook).toBe(false);
    const kata = UnitSourceResponse.parse((await request(app).get(`/api/units/${id('fixture:ladder/kata-1')}/source`)).body);
    expect(kata).toMatchObject({ repo: KATA.provenance.repo, sha: KATA.provenance.sha, openBook: false });
    const drill = makeUnit(tmp.db, clock);
    expect((await request(app).get(`/api/units/${drill}/source`)).status).toBe(404);
    expect((await request(app).get('/api/units/999999/source')).status).toBe(404);
  });
});

/**
 * rv3 S5 (PLAN W9 / F10, ruling 6): kata precision. A kata flagged in content/seed/kata-flags.json asks for a verdict:
 * approve (POST .../kata/approve, no findings) or block (POST .../kata/findings). The verdict is stored with the
 * answer (kata_verdict, migration 029) before any key; it is scored with POST .../kata/verdict-score:
 *   - a clean PR passes on approve and fails on ANY finding (so a random finding never passes it);
 *   - on a decoy kata each decoy line flagged is a false positive (G1: one more miss; the kata does not pass);
 *   - unflagged katas refuse the new endpoints and are scored exactly as before (ladder.test.ts pins G1).
 */
describe('rv3 W9 kata precision: approve / block on flagged katas', () => {
  const [K1, K2] = fixture.seedItems.filter((i) => i.kind === 'patch-kata') as unknown as SeedPatchKataItem[];
  /** a clean PR: its one key entry (in: 'repo') is the shipped defect the PR fixes */
  const CLEAN: SeedPatchKataItem = {
    ...structuredClone(K1!),
    key: 'seed:patches:ww6/patch-kata/clean-fixture',
    seededDefectKey: K1!.seededDefectKey.map((d) => ({ ...d, evidence: { ...d.evidence, in: 'repo' as const } })),
  };
  /** a PR with a real defect (d1 patched, d2 repo) and two nit-only decoy lines in the patched file */
  const DECOY: SeedPatchKataItem = { ...structuredClone(K2!), key: 'seed:patches:ww6/patch-kata/decoy-fixture' };
  const DECOY_PATH = K2!.seededDefectKey[0]!.evidence.path; // src/services/allocationSummary.mjs
  const FLAGS = {
    format: 'bootquest-kata-flags@1',
    counts: { clean: 1, decoyKatas: 1, decoyLines: 2 },
    katas: {
      [CLEAN.key]: { unitKey: 'ladder/kata/ww6/clean', pack: 'fixture', title: 'clean', pattern: 'clean', clean: true, note: 'approve' },
      [DECOY.key]: {
        unitKey: 'ladder/kata/ww6/decoy',
        pack: 'fixture',
        title: 'decoy',
        pattern: 'decoys',
        decoys: [
          { path: DECOY_PATH, lineStart: 15, lineEnd: 15, in: 'patched', why: 'a reworded comment' },
          { path: DECOY_PATH, lineStart: 19, lineEnd: 19, in: 'patched', why: 'a rename' },
        ],
      },
    },
  };
  const FINDING = { scenario: 'two rules match one line item', evidence: 'allocationSummary.mjs:17', consequence: 'the summary over-reports matched rules' };
  let tmp: TempDb;
  let app: Express;
  const ids = new Map<string, number>();
  const clock = fixedClock(localNoon(2026, 11, 15));
  const kataUnit = (key: string, item: SeedPatchKataItem) =>
    insertUnit(
      tmp.db,
      {
        key,
        track: 'agentic',
        kind: 'patch-kata',
        title: key,
        competencies: ['code-reading', 'agentic-engineering'],
        checks: [{ spec: { type: 'patch-kata', kataKey: item.key, defectCount: item.seededDefectKey.length } }],
      } as never,
      clock,
    );
  const boot = () => {
    tmp = makeTempDb();
    for (const u of fixture.units) ids.set(u.key, insertUnit(tmp.db, u, clock));
    ids.set('clean', kataUnit('ladder/kata/ww6/clean', CLEAN));
    ids.set('decoy', kataUnit('ladder/kata/ww6/decoy', DECOY));
    app = createApp({ db: tmp.db, clock, runners: { http: fakeHttp }, seedItems: mapSeedItemStore([...fixture.seedItems, CLEAN, DECOY] as never) });
  };

  beforeEach(() => {
    setKataFlags(makeKataFlags(FLAGS));
    boot();
  }, 60_000);
  afterEach(() => {
    setKataFlags(null);
    tmp.cleanup();
  });
  const id = (k: string) => ids.get(k)!;
  const review = async (k: string) => KataReviewResponse.parse((await request(app).get(`/api/units/${id(k)}/kata/review`)).body);
  const stats = async () => KataStatsResponse.parse((await request(app).get('/api/stats/katas')).body);
  const verdicts = () => tmp.db.all('SELECT attempt_id AS attemptId, verdict FROM kata_verdict ORDER BY attempt_id');

  it('no key before the answer: a clean and a decoy kata look the same (review, detail); key and score are 403; an unflagged kata asks no verdict', async () => {
    const before = { verdictAsked: true, verdict: null, key: null, scored: null };
    expect(await review('clean')).toEqual(before);
    expect(await review('decoy')).toEqual(before);
    expect(await review('fixture:ladder/kata-1')).toEqual({ verdictAsked: false, verdict: null, key: null, scored: null });
    for (const k of ['clean', 'decoy']) {
      const d = await request(app).get(`/api/units/${id(k)}`);
      expect(d.text).not.toMatch(/a reworded comment|a rename|verdict/);
      expect(Object.keys(UnitDetailResponse.parse(d.body).kata ?? {}).sort()).toEqual(['answered', 'contextFiles', 'diff', 'supersededAnswerIds', 'title']);
      const r = await request(app).get(`/api/units/${id(k)}/kata/review`);
      expect(r.text).not.toMatch(/a reworded comment|a rename|"fixes"|"clean"/);
      expect((await request(app).get(`/api/units/${id(k)}/kata/key`)).status).toBe(403);
      const s = await request(app).post(`/api/units/${id(k)}/kata/verdict-score`).send({});
      expect([s.status, s.body.error.code]).toEqual([403, 'NOT_ANSWERED']);
    }
    expect(ledgerCounts(tmp.db).attempt).toBe(0);
  });

  it('clean PR + approve = pass: the verdict is stored with the answer, the key entry is "what this PR fixes", score 1 and 15 XP once; G1 +1/+1', async () => {
    const a = await request(app).post(`/api/units/${id('clean')}/kata/approve`).send({});
    expect(a.status, a.text).toBe(200);
    expect(verdicts()).toEqual([{ attemptId: a.body.attemptId, verdict: 'approve' }]);
    // immutable: no second verdict, approve or block
    expect((await request(app).post(`/api/units/${id('clean')}/kata/approve`).send({})).body.error.code).toBe('ALREADY_ANSWERED');
    expect((await request(app).post(`/api/units/${id('clean')}/kata/findings`).send({ findings: [FINDING] })).body.error.code).toBe('ALREADY_ANSWERED');
    expect(await review('clean')).toEqual({ verdictAsked: true, verdict: 'approve', key: { clean: true, fixes: ['d1'], decoys: [] }, scored: null });
    const key = KataKeyResponse.parse((await request(app).get(`/api/units/${id('clean')}/kata/key`)).body);
    expect(key.findings).toEqual([]);
    expect(key.defects.map((d) => [d.id, d.evidence.in])).toEqual([['d1', 'repo']]);
    // the old self-score refuses a flagged kata (it would score the fix as a "caught defect")
    const old = await request(app).post(`/api/units/${id('clean')}/kata/self-score`).send({ perDefect: { d1: 'caught' } });
    expect([old.status, old.body.error.code]).toEqual([409, 'WRONG_UNIT_KIND']);
    // nothing to mark on a clean kata
    expect((await request(app).post(`/api/units/${id('clean')}/kata/verdict-score`).send({ perDefect: { d1: 'caught' } })).status).toBe(400);
    const s = KataVerdictScoreResponse.parse((await request(app).post(`/api/units/${id('clean')}/kata/verdict-score`).send({})).body);
    expect(s).toMatchObject({ verdict: 'approve', clean: true, passed: true, score: 1, caught: 1, total: 1, decoysFlagged: 0, decoysTotal: 0, xp: { amount: 15 } });
    expect((await request(app).post(`/api/units/${id('clean')}/kata/verdict-score`).send({})).body.error.code).toBe('ALREADY_SCORED');
    expect((await review('clean')).scored).toEqual({ passed: true, score: 1, decoysFlagged: 0, decoysTotal: 0 });
    expect(await stats()).toMatchObject({ katasScored: 1, assistedCount: 0, defectsCaught: 1, defectsTotal: 1 });
    // one precision row per evidence row (two competencies); no rv B split row for a clean kata
    expect(tmp.db.all('SELECT verdict, clean, passed, g1_total AS t, g1_caught AS c FROM kata_precision')).toEqual([
      { verdict: 'approve', clean: 1, passed: 1, t: 1, c: 1 },
      { verdict: 'approve', clean: 1, passed: 1, t: 1, c: 1 },
    ]);
    expect(tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM kata_score_detail')!.n).toBe(0);
  });

  it('clean PR + any finding = fail: a random finding cannot pass it (score 0, G1 +0/+1), and the verdict cannot be changed afterwards', async () => {
    const f = await request(app).post(`/api/units/${id('clean')}/kata/findings`).send({ findings: [{ scenario: 'random', evidence: 'somewhere:1', consequence: 'maybe' }] });
    expect(f.status, f.text).toBe(200);
    expect(verdicts()).toEqual([{ attemptId: f.body.attemptId, verdict: 'block' }]);
    expect((await request(app).post(`/api/units/${id('clean')}/kata/approve`).send({})).body.error.code).toBe('ALREADY_ANSWERED');
    expect((await review('clean')).verdict).toBe('block');
    const s = KataVerdictScoreResponse.parse((await request(app).post(`/api/units/${id('clean')}/kata/verdict-score`).send({})).body);
    expect(s).toMatchObject({ verdict: 'block', clean: true, passed: false, score: 0, caught: 0, total: 1 });
    expect(await stats()).toMatchObject({ katasScored: 1, defectsCaught: 0, defectsTotal: 1, catchRate: 0 });
  });

  it('decoys: a finding on a decoy line is a false positive (cited is a suggestion; the learner marks); the kata does not pass and G1 counts one more miss', async () => {
    const f = await request(app)
      .post(`/api/units/${id('decoy')}/kata/findings`)
      .send({ findings: [FINDING, { scenario: 'the comment is unclear', evidence: `${DECOY_PATH}:15`, consequence: 'readers get confused' }] });
    expect(f.status, f.text).toBe(200);
    const r = await review('decoy');
    expect(r.verdict).toBe('block');
    expect(r.key).toEqual({
      clean: false,
      fixes: [],
      decoys: [
        { id: 'n1', path: DECOY_PATH, lineStart: 15, lineEnd: 15, why: 'a reworded comment', cited: true },
        { id: 'n2', path: DECOY_PATH, lineStart: 19, lineEnd: 19, why: 'a rename', cited: false },
      ],
    });
    // every defect AND every decoy marked exactly once
    const missing = await request(app).post(`/api/units/${id('decoy')}/kata/verdict-score`).send({ perDefect: { d1: 'caught', d2: 'caught' } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toBe('mark every decoy line exactly once');
    const s = KataVerdictScoreResponse.parse(
      (await request(app).post(`/api/units/${id('decoy')}/kata/verdict-score`).send({ perDefect: { d1: 'caught', d2: 'caught' }, perDecoy: { n1: 'flagged', n2: 'clear' } })).body,
    );
    expect(s).toMatchObject({ verdict: 'block', clean: false, passed: false, caught: 2, total: 2, catchRate: 1, decoysFlagged: 1, decoysTotal: 2, xp: { amount: 15 } });
    expect(s.score).toBeCloseTo(2 / 3);
    // G1: patched defect d1 caught (1) over patched defects (1) + decoys flagged (1)
    expect(await stats()).toMatchObject({ katasScored: 1, defectsCaught: 1, defectsTotal: 2 });
    expect(tmp.db.all('SELECT patched_total AS pt, patched_caught AS pc, repo_total AS rt, repo_caught AS rc FROM kata_score_detail')).toEqual([
      { pt: 1, pc: 1, rt: 1, rc: 1 },
      { pt: 1, pc: 1, rt: 1, rc: 1 },
    ]);
  });

  it('decoys: block, every defect caught, no decoy flagged = pass (G1 as rv B); an approve on a PR with a defect fails with every defect missed', async () => {
    await request(app).post(`/api/units/${id('decoy')}/kata/findings`).send({ findings: [FINDING] }).expect(200);
    const s = KataVerdictScoreResponse.parse(
      (await request(app).post(`/api/units/${id('decoy')}/kata/verdict-score`).send({ perDefect: { d1: 'caught', d2: 'caught' }, perDecoy: { n1: 'clear', n2: 'clear' } })).body,
    );
    expect(s).toMatchObject({ passed: true, score: 1, decoysFlagged: 0 });
    expect(await stats()).toMatchObject({ katasScored: 1, defectsCaught: 1, defectsTotal: 1 });
    // a fresh DB: approve on the decoy kata
    tmp.cleanup();
    boot();
    await request(app).post(`/api/units/${id('decoy')}/kata/approve`).send({}).expect(200);
    expect((await request(app).post(`/api/units/${id('decoy')}/kata/verdict-score`).send({ perDecoy: { n1: 'clear' } })).status).toBe(400);
    const a = KataVerdictScoreResponse.parse((await request(app).post(`/api/units/${id('decoy')}/kata/verdict-score`).send({})).body);
    expect(a).toMatchObject({ verdict: 'approve', passed: false, caught: 0, total: 2, missed: ['d1', 'd2'], score: 0, decoysFlagged: 0 });
    expect(await stats()).toMatchObject({ katasScored: 1, defectsCaught: 0, defectsTotal: 1 });
  });

  it('an unflagged kata refuses approve / verdict-score (409 WRONG_UNIT_KIND) and its findings write no verdict row; a self-assisted verdict stays out of G1', async () => {
    const k1 = id('fixture:ladder/kata-1');
    for (const path of ['approve', 'verdict-score']) {
      const res = await request(app).post(`/api/units/${k1}/kata/${path}`).send({});
      expect([res.status, res.body.error.code]).toEqual([409, 'WRONG_UNIT_KIND']);
    }
    await request(app).post(`/api/units/${k1}/kata/findings`).send({ findings: [FINDING] }).expect(200);
    expect(verdicts()).toEqual([]);
    await request(app).post(`/api/units/${id('clean')}/kata/approve`).send({ selfAssisted: true }).expect(200);
    await request(app).post(`/api/units/${id('clean')}/kata/verdict-score`).send({}).expect(200);
    expect(await stats()).toMatchObject({ katasScored: 0, assistedCount: 1, defectsTotal: 0 });
    // strict bodies
    expect((await request(app).post(`/api/units/${id('decoy')}/kata/approve`).send({ verdict: 'approve' })).status).toBe(400);
  });
});
