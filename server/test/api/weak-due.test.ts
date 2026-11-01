import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { SeedExplainBackItem } from '@bootquest/shared';
import { CompetenciesResponse, ExplainBackScoreResponse } from '@bootquest/shared/api';
import { DueResponse, WEAK_SPOTS_MAX_EXAMPLES, WEAK_SPOTS_MAX_GROUPS, WeakSpotsResponse } from '@bootquest/shared/api-ext';
import { createApp } from '../../src/api/app.ts';
import type { Runner } from '../../src/api/runners.ts';
import { loadSeedDerivedContent } from '../../src/api/serve.ts';
import { rankWeakSpots, weakGroupOf, type WeakSignal } from '../../src/api/weak-service.ts';
import { DAY_MS, fixedClock } from '../../src/engines/clock.ts';
import { addReviewItem } from '../../src/engines/fsrs.ts';
import { EB_SET_MIN_GAP_MS } from '../../src/engines/ladder.ts';
import { enrollFlashcards, queueQuizMisses } from '../../src/engines/study-quest.ts';
import { insertContentRef, insertUnit } from '../../src/store/content.ts';
import { explainBackUnitKey } from '../../src/store/ladder.ts';
import { mapSeedItemStore } from '../../src/store/seed-items.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';
import { fakeDrillJs } from './harness.ts';
import fixture from '../fixtures/ladder-fixture.json' with { type: 'json' };

/**
 * ab wave S3: GET /stats/weak (what the learner keeps getting wrong, released keys only) and
 * GET /due (open retests + alternate explain-back sets whose rotation gate has opened).
 * eb_score_detail rows are written by S5's self-score; here they are inserted directly.
 */

const BASE = fixture.seedItems.find((i) => i.kind === 'explain-back') as unknown as SeedExplainBackItem;
const REPO = 'weakrepo';
const PATH = 'docs/learning/weak.md';

function setItem(origin: string, set?: string): SeedExplainBackItem {
  const it = structuredClone(BASE);
  return {
    ...it,
    key: `seed:explainback:${REPO}/explain-back/${origin}`,
    provenance: { ...it.provenance, repo: REPO, path: PATH },
    questions: it.questions.map((q, i) => ({
      ...q,
      prompt: `[${set ?? 'a'}] ${i + 1}. ${q.prompt}`,
      // a weighted set: the [wN] prefix stays in the stored text, the weak list strips it for display
      keyPoints: q.keyPoints.map((k, ki) => ({ ...k, text: `[w${ki === 0 ? 3 : 1}] ${k.text}` })),
    })),
    ...(set ? { set } : {}),
  };
}

const A = setItem('draft');
const B = setItem('draft-b', 'b');
const IDS = A.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => `q${qi + 1}k${ki + 1}`));
const ANSWERS = ['one', 'two', 'three'];
const GOOD_PORT = 4000;
const fakeHttp: Runner = async (_spec, sub) =>
  sub.port === GOOD_PORT
    ? { pass: true, output: '', failures: [], durationMs: 1 }
    : { pass: false, output: '', failures: [{ name: 'health', message: 'refused' }], durationMs: 1 };
const PROJECT_SPEC = fixture.units.find((u) => u.key === 'fixture:ladder/project-api')!.checks[0]!.spec;
const QUIZ_KEYS = ['seed:quests:weakquests/quiz/q1', 'seed:quests:weakquests/quiz/q2'];

describe('GET /api/stats/weak and GET /api/due (ab wave S3)', () => {
  let tmp: TempDb;
  let clock: ReturnType<typeof fixedClock>;
  let app: Express;
  let project: number;
  let drill: number;
  let study: number;
  const unitId = (it: SeedExplainBackItem) => tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', explainBackUnitKey(it))!.id;
  const weak = async () => {
    const res = await request(app).get('/api/stats/weak');
    expect(res.status, res.text).toBe(200);
    return WeakSpotsResponse.parse(res.body);
  };
  const due = async () => {
    const res = await request(app).get('/api/due');
    expect(res.status, res.text).toBe(200);
    return DueResponse.parse(res.body);
  };
  const answer = (id: number) => request(app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS });
  const submitDrill = (code: string) => request(app).post(`/api/units/${drill}/submit`).send({ code });

  /** a graded study-quiz submit that missed `missed` (the ledger rows the real submit writes + its cards) */
  function failStudyQuiz(missed: string[]): void {
    const check = tmp.db.get<{ id: number }>('SELECT id FROM "check" WHERE unit_id = ?', study)!.id;
    const t = clock().getTime();
    const { lastInsertRowid } = tmp.db.run(
      `INSERT INTO attempt (unit_id, check_id, mode, assisted, assistance_source, outcome, score, created_at) VALUES (?, ?, 'solo', 0, 'none', 'fail', 0.5, ?)`,
      study,
      check,
      t,
    );
    tmp.db.run(`INSERT INTO run (kind, attempt_id, check_id, unit_id, verdict, raw, created_at) VALUES ('submit', ?, ?, ?, 'fail', '{}', ?)`, lastInsertRowid, check, study, t);
    queueQuizMisses(tmp.db, study, missed, clock);
  }

  beforeEach(() => {
    tmp = makeTempDb();
    clock = fixedClock(localNoon(2026, 10, 1));
    project = insertUnit(tmp.db, { key: 'fixture:weak/project', track: 'js', kind: 'http-lab', title: '[fixture] weak project', competencies: ['data-http'], checks: [{ spec: PROJECT_SPEC }] }, clock);
    const ref = insertContentRef(
      tmp.db,
      { repo: `elirc/${REPO}`, path: PATH, sha: 'abcdef1', title: 'Weak', stableKey: 'guide:weak', kind: 'guide', provenance: 'frontmatter' },
      clock,
    );
    tmp.db.run(`INSERT INTO unit_ref (unit_id, content_ref_id, role) VALUES (?, ?, 'guide')`, project, ref);
    drill = insertUnit(
      tmp.db,
      { key: 'sysdrills/01-estimation/01-qps', track: 'js', kind: 'drill', title: 'QPS from DAU', difficulty: 1, competencies: [], prerequisites: [], checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.ok(true)' }] } }] },
      clock,
    );
    study = insertUnit(
      tmp.db,
      { key: 'campaign/js/weakquests', track: 'js', kind: 'study', title: 'Study weakquests', competencies: [], prerequisites: [], checks: [{ spec: { type: 'study-quiz', itemKeys: QUIZ_KEYS, passPct: 0.8 } }] },
      clock,
    );
    loadSeedDerivedContent(tmp.db, { seedItems: mapSeedItemStore([A, B]), authored: null }, clock);
    app = createApp({ db: tmp.db, clock, runners: { http: fakeHttp, 'drill-js': fakeDrillJs }, seedItems: mapSeedItemStore([A, B]) });
  });
  afterEach(() => tmp.cleanup());

  // ---------------------------------------------------------------- /stats/weak

  it('an empty ledger lists nothing (no false reassurance, no placeholder rows)', async () => {
    expect(await weak()).toEqual({ today: '2026-10-01', totalGroups: 0, groups: [] });
  });

  it('honesty: a missed quiz question is hidden until its card is due (the Learn-more release rule), then listed', async () => {
    failStudyQuiz([QUIZ_KEYS[0]!]);
    const before = await weak();
    expect(before.groups).toEqual([]);
    expect(JSON.stringify(before)).not.toContain(QUIZ_KEYS[0]);
    clock.advance(DAY_MS - 1);
    expect((await weak()).groups).toEqual([]);
    clock.advance(1); // the card is due: the card itself now shows the keyed answer
    const after = await weak();
    expect(after.groups).toHaveLength(1);
    expect(after.groups[0]).toMatchObject({
      group: 'weakquests',
      scope: 'repo',
      trackId: 'js',
      count: 1,
      bySource: { quizMiss: 1, again: 0, fail: 0, ebMissed: 0 },
      examples: [{ kind: 'quiz-miss', unitId: study, unitTitle: 'Study weakquests', ref: QUIZ_KEYS[0], label: null }],
    });
  });

  it('a failed drill submit counts until a later verified pass clears it; groups by bank/module', async () => {
    expect((await submitDrill('return a - b')).status).toBe(200);
    clock.advance(60_000);
    expect((await submitDrill('return 0')).status).toBe(200);
    const w = await weak();
    expect(w.groups).toEqual([
      expect.objectContaining({ group: 'sysdrills/01-estimation', scope: 'module', count: 2, bySource: { quizMiss: 0, again: 0, fail: 2, ebMissed: 0 } }),
    ]);
    // two fails of one unit are ONE distinct example
    expect(w.groups[0]!.examples).toEqual([{ kind: 'fail', unitId: drill, unitTitle: 'QPS from DAU', ref: null, label: null, at: clock().getTime() }]);
    clock.advance(60_000);
    expect((await submitDrill('return a + b')).status).toBe(200);
    expect((await weak()).groups).toEqual([]);
  });

  it('Again grades count per grade (the card back was shown to grade it)', async () => {
    enrollFlashcards(tmp.db, study, ['seed:quests:weakquests/flashcard/f1'], clock);
    clock.advance(DAY_MS);
    const card = tmp.db.get<{ id: number }>(`SELECT id FROM review_item WHERE card_key = 'flashcard:seed:quests:weakquests/flashcard/f1'`)!.id;
    const g = await request(app).post(`/api/reviews/${card}/grade`).send({ grade: 'again' });
    expect(g.status, g.text).toBe(200);
    const w = await weak();
    expect(w.groups[0]).toMatchObject({ group: 'weakquests', count: 1, bySource: { again: 1 }, examples: [{ kind: 'again', ref: 'seed:quests:weakquests/flashcard/f1' }] });
    // a Good grade is not a weakness
    const other = addReviewItem(tmp.db, { cardKey: 'flashcard:seed:quests:weakquests/flashcard/f2', kind: 'card', unitId: study, dueAt: clock().getTime() }, clock);
    expect((await request(app).post(`/api/reviews/${other.id}/grade`).send({ grade: 'good' })).status).toBe(200);
    expect((await weak()).groups[0]!.count).toBe(1);
  });

  it('missed explain-back key points: once per self-score (not per competency row), released text without [wN]', async () => {
    await request(app).post(`/api/units/${project}/submit`).send({ port: GOOD_PORT }).expect(200);
    const b = unitId(B);
    expect((await answer(b)).status).toBe(200);
    const marks = Object.fromEntries(IDS.map((id, i) => [id, i < 2 ? 'missed' : 'covered']));
    const s = ExplainBackScoreResponse.parse((await request(app).post(`/api/units/${b}/explain-back/self-score`).send({ perKeyPoint: marks })).body);
    expect(s.evidenceIds.length).toBeGreaterThan(1); // one evidence row per competency
    const missed = IDS.slice(0, 2);
    // S5's self-score writes these rows itself (merged tree); on this branch alone they are inserted
    // here. 018 is append-only (a second insert aborts), so insert only where the row is missing.
    for (const id of s.evidenceIds) {
      tmp.db.run(
        `INSERT INTO eb_score_detail (evidence_id, plain, weighted, w3_missed, missed_ids, created_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM eb_score_detail WHERE evidence_id = ?)`,
        id,
        0.8,
        0.7,
        1,
        JSON.stringify(missed),
        clock().getTime(),
        id,
      );
    }
    const w = await weak();
    expect(w.groups).toHaveLength(1);
    const g = w.groups[0]!;
    expect(g).toMatchObject({ group: REPO, scope: 'repo', count: 2, bySource: { ebMissed: 2 } });
    expect(g.examples.map((e) => e.ref).sort()).toEqual(missed);
    const label = g.examples.find((e) => e.ref === 'q1k1')!.label!;
    expect(label).toBe(BASE.questions[0]!.keyPoints[0]!.text);
    expect(label).not.toContain('[w');
  });

  it('PURE ranking: recency-weighted (half-life), capped groups and distinct examples', () => {
    const now = localNoon(2026, 10, 30).getTime();
    const sig = (unitKey: string, ageDays: number, ref: string | null = null): WeakSignal => ({
      kind: 'fail',
      unitId: unitKey.length,
      unitKey,
      unitTitle: unitKey,
      trackId: 'js',
      ref,
      label: null,
      at: now - ageDays * DAY_MS,
    });
    // old: 3 signals 60 days ago (weight 3 * 2^-60/14 ~ 0.15); fresh: 1 signal today (weight 1)
    const ranked = rankWeakSpots([sig('bank/old/a', 60), sig('bank/old/a', 60), sig('bank/old/a', 60), sig('bank/new/a', 0)], now);
    expect(ranked.groups.map((g) => g.group)).toEqual(['bank/new', 'bank/old']);
    expect(ranked.groups[0]!.weight).toBeCloseTo(1, 6);
    expect(ranked.groups[1]!.count).toBe(3);
    const many = Array.from({ length: WEAK_SPOTS_MAX_GROUPS + 2 }, (_, i) => sig(`bank/m${String(i).padStart(2, '0')}/x`, i));
    const capped = rankWeakSpots(many, now);
    expect(capped.totalGroups).toBe(WEAK_SPOTS_MAX_GROUPS + 2);
    expect(capped.groups).toHaveLength(WEAK_SPOTS_MAX_GROUPS);
    expect(capped.groups[0]!.group).toBe('bank/m00');
    const refs = Array.from({ length: 5 }, (_, i) => sig('bank/r/x', i, `k${i}`));
    expect(rankWeakSpots(refs, now).groups[0]!.examples.map((e) => e.ref)).toEqual(['k0', 'k1', 'k2'].slice(0, WEAK_SPOTS_MAX_EXAMPLES));
  });

  it('weakGroupOf: repo for campaign / ladder / gh keys, bank/module for drill banks', () => {
    expect(weakGroupOf('campaign/js/grok-js')).toEqual({ group: 'grok-js', scope: 'repo' });
    expect(weakGroupOf('ladder/explain-back/agora/abc123')).toEqual({ group: 'agora', scope: 'repo' });
    expect(weakGroupOf('gh:elirc/signalpost:U02')).toEqual({ group: 'signalpost', scope: 'repo' });
    expect(weakGroupOf('javadrills/03-streams/02-group-by')).toEqual({ group: 'javadrills/03-streams', scope: 'module' });
    expect(weakGroupOf('bootforge:js-basics:yes-no')).toEqual({ group: 'bootforge/js-basics', scope: 'module' });
  });

  // ---------------------------------------------------------------- /due

  it('an empty ledger: nothing due, no alternate set (an untouched group is ordinary work)', async () => {
    expect(await due()).toEqual({ retests: [], altSets: [], nextAltSetAt: null });
  });

  it('an alternate set appears exactly when its rotation gate opens, and leaves once answered', async () => {
    await request(app).post(`/api/units/${project}/submit`).send({ port: GOOD_PORT }).expect(200);
    clock.advance(60_000);
    const a = unitId(A);
    const b = unitId(B);
    expect((await answer(b)).status).toBe(200);
    const bAt = clock().getTime();
    expect(await due()).toEqual({ retests: [], altSets: [], nextAltSetAt: bAt + EB_SET_MIN_GAP_MS });
    clock.set(bAt + EB_SET_MIN_GAP_MS - 1);
    expect((await due()).altSets).toEqual([]);
    expect((await answer(a)).status).toBe(409); // the same gate: NOT_DUE
    clock.set(bAt + EB_SET_MIN_GAP_MS);
    const open = await due();
    expect(open.altSets).toEqual([{ unitId: a, title: expect.stringContaining('weak.md'), label: 'A', group: expect.any(String), openedAt: bAt + EB_SET_MIN_GAP_MS }]);
    expect(open.nextAltSetAt).toBeNull();
    // the listed set really is answerable now
    expect((await answer(a)).status).toBe(200);
    expect(await due()).toEqual({ retests: [], altSets: [], nextAltSetAt: null });
  });

  it('retests are exactly GET /competencies retests (one due, one later)', async () => {
    const t = clock().getTime();
    // two changed-example schedules the way engines/ladder.ts scheduleRetests writes them
    const ins = (unit: number, dueAt: number, eb: number) =>
      tmp.db.run(
        `INSERT INTO review_item (card_key, kind, unit_id, content_ref_id, competency_id, fsrs_state, due_at, created_at, updated_at) VALUES (?, 'retest', ?, NULL, NULL, ?, ?, ?, ?)`,
        `retest:u${unit}:eb${eb}`,
        unit,
        JSON.stringify({ retest: { artifactUnitId: project, explainBackAttemptId: eb } }),
        dueAt,
        t,
        t,
      );
    ins(drill, t - DAY_MS, 9001);
    ins(study, t + DAY_MS, 9002);
    const comp = CompetenciesResponse.parse((await request(app).get('/api/competencies')).body);
    const d = await due();
    expect(d.retests).toHaveLength(2);
    expect(d.retests).toEqual(comp.retests);
    expect(d.retests.map((r) => [r.unitId, r.due, r.artifactUnitId])).toEqual([
      [drill, true, project],
      [study, false, project],
    ]);
  });

  it('both routes refuse a query string (strict like every stats route)', async () => {
    expect((await request(app).get('/api/due?x=1')).status).toBe(400);
    expect((await request(app).get('/api/stats/weak?x=1')).status).toBe(400);
  });
});
