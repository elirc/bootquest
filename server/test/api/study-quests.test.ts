/**
 * W8: study-quest quiz gates from the REAL stamped seed:quests packs (content/seed/quests),
 * on a small stamped campaign fixture whose quests are named after real pack repos:
 *   js     act 1: study grok-js (pack), study no-pack-repo (NO pack), reading read-r1
 *          act 2: study ship-it (pack)                [80% of act 1 core + level 2]
 *   csharp act 1: study csbootcamp (pack: 15 quiz items -> 12/15 is exactly 80%)
 * ww6's pack matches no quest (reported as unmatched) and is wired by the LADDER as a standalone
 * study unit (store/ladder.ts, family 'study').
 */
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAMPAIGN_FORMAT, SeedQuizItem, type SeedQuizItem as QuizItem } from '@bootquest/shared';
import { CampaignResponse, DashboardResponse, ReviewQueueResponse, SubmitResponse, UnitDetailResponse } from '@bootquest/shared/api';
import { createApp } from '../../src/api/app.ts';
import { defaultRunners } from '../../src/api/runners.ts';
import { DAY_MS, fixedClock } from '../../src/engines/clock.ts';
import { gradeStudyQuiz, StudyQuizShapeError } from '../../src/engines/study-quest.ts';
import { loadCampaignIntoDb, readCampaign } from '../../src/store/campaign.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
import { loadSeedItemStore, mapSeedItemStore, readSeedPackItems, SeedItemLoadError, type SeedItemStore } from '../../src/store/seed-items.ts';
import { loadStudyQuestsIntoDb, StudyQuestLoadError } from '../../src/store/study-quests.ts';
import { assertUniqueSeedItemRefs, ladderUnits, LadderLoadError, loadLadderIntoDb, studyUnitKey } from '../../src/store/ladder.ts';
import { insertUnit } from '../../src/store/content.ts';
import { defaultFixtureTracks, quest, writeCampaignFixture, type FixtureTracks } from '../campaign-fixture.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const QUESTS = join(REPO, 'content', 'seed', 'quests');
const PACKS = ['grok-js', 'ship-it', 'csbootcamp', 'ww6'];

function tracks(): FixtureTracks {
  const t = defaultFixtureTracks();
  const act = (actNo: number, quests: ReturnType<typeof quest>[], unlockLevel = 1) => ({ actNo, title: `Act ${actNo}`, theme: `theme ${actNo}`, unlockPct: 0.8, unlockLevel, locked: false, quests });
  t.js = {
    format: CAMPAIGN_FORMAT,
    track: 'js',
    acts: [
      act(1, [quest('js', 'grok-js', 'study-quest', 1), quest('js', 'no-pack-repo', 'study-quest', 2), quest('js', 'read-r1', 'reading', 3)]),
      act(2, [quest('js', 'ship-it', 'study-quest', 4)], 2),
    ],
  };
  t.csharp = { format: CAMPAIGN_FORMAT, track: 'csharp', acts: [act(1, [quest('csharp', 'csbootcamp', 'study-quest', 6)])] };
  return t;
}

let store: SeedItemStore;
beforeAll(() => {
  store = loadSeedItemStore(PACKS.map((p) => join(QUESTS, p)));
}, 120_000);

/** the pack file read directly: the seed-time oracle for the right answers */
function packQuizzes(repo: string): QuizItem[] {
  return (JSON.parse(readFileSync(join(QUESTS, repo, 'items.json'), 'utf8')) as { items: { kind: string }[] }).items.filter((i) => i.kind === 'quiz') as QuizItem[];
}
const keysOf = (repo: string) => packQuizzes(repo).map((q) => q.check.answerKey as number);
/** the right answers with the first `wrong` flipped to another choice */
const withWrong = (repo: string, wrong: number) => packQuizzes(repo).map((q, i) => (i < wrong ? ((q.check.answerKey as number) + 1) % q.choices.length : (q.check.answerKey as number)));

interface Ctx {
  tmp: TempDb;
  clock: ReturnType<typeof fixedClock>;
  app: Express;
  campaignDir: string;
}

function useStudyApi(): Ctx {
  const ctx = {} as Ctx;
  beforeEach(() => {
    ctx.tmp = makeTempDb();
    ctx.clock = fixedClock(localNoon(2026, 10, 1));
    ctx.campaignDir = writeCampaignFixture(join(ctx.tmp.dir, 'campaign'), tracks());
    loadCampaignIntoDb(ctx.tmp.db, readCampaign(ctx.campaignDir), ctx.clock);
    loadStudyQuestsIntoDb(ctx.tmp.db, store, ctx.clock);
    ctx.app = createApp({ db: ctx.tmp.db, clock: ctx.clock, runners: defaultRunners(), seedItems: store });
  });
  afterEach(() => ctx.tmp.cleanup());
  return ctx;
}

const unitOf = (ctx: Ctx, repo: string, track = 'js') => ctx.tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', `campaign/${track}/${repo}`)!.id;
const pendingFlag = (ctx: Ctx, repo: string, track = 'js') => ctx.tmp.db.get<{ p: number }>('SELECT content_pending AS p FROM quest WHERE key = ?', `campaign/${track}/${repo}`)!.p;
const submit = async (ctx: Ctx, unitId: number, body: unknown) => request(ctx.app).post(`/api/units/${unitId}/submit`).send(body as object);

/** every pack quiz item by key (the seed-time oracle, read straight from items.json) */
const quizByKey = (repo: string) => new Map(packQuizzes(repo).map((q) => [q.key, q]));
const storedTexts = (q: QuizItem) => q.check.choices ?? q.choices.map((c) => c.text);
/**
 * ui-audit #24: choices are SERVED in a stable per-unit permutation, so an answer set known in the
 * STORED (keyed) frame is translated the way a learner would: find each stored choice's TEXT in
 * the served list of GET /units/:id. Throws (never guesses) when a text is not served.
 */
async function served(ctx: Ctx, unitId: number, repo: string, stored: readonly number[]): Promise<number[]> {
  const d = UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${unitId}`)).body);
  const qs = d.studyQuest!.questions;
  expect(qs).toHaveLength(stored.length);
  const byKey = quizByKey(repo);
  return qs.map((q, i) => {
    const text = storedTexts(byKey.get(q.itemKey)!)[stored[i]!]!;
    const at = q.choices.indexOf(text);
    if (at === -1) throw new Error(`${q.itemKey}: stored choice ${stored[i]} not served`);
    return at;
  });
}

// ---------------------------------------------------------------- loader

describe('study-quest loader (store/study-quests.ts)', { timeout: 60_000 }, () => {
  const ctx = useStudyApi();

  it('derives one quiz gate per campaign study quest with a pack; loaded === built per track; no-pack quests stay pending; unmatched packs reported', () => {
    const s = loadStudyQuestsIntoDb(ctx.tmp.db, store, ctx.clock); // second load: idempotent
    expect(s.tracks.find((t) => t.track === 'js')).toEqual({ track: 'js', built: 2, loaded: 2, pending: 1 });
    expect(s.tracks.find((t) => t.track === 'csharp')).toEqual({ track: 'csharp', built: 1, loaded: 1, pending: 0 });
    expect(s.unmatchedPacks).toEqual(['ww6']);
    expect(s.packs).toBe(4);
    expect([s.inserted, s.updated, s.removed]).toEqual([0, 0, 0]);
    const spec = JSON.parse(ctx.tmp.db.get<{ spec: string }>('SELECT spec FROM "check" WHERE unit_id = ?', unitOf(ctx, 'grok-js'))!.spec);
    expect(spec).toEqual({ type: 'study-quiz', itemKeys: packQuizzes('grok-js').map((q) => q.key), passPct: 0.8 });
    expect(pendingFlag(ctx, 'grok-js')).toBe(0);
    expect(pendingFlag(ctx, 'no-pack-repo')).toBe(1);
    expect(ctx.tmp.db.get('SELECT 1 AS x FROM "check" WHERE unit_id = ?', unitOf(ctx, 'no-pack-repo'))).toBeUndefined();
    expect(ctx.tmp.db.all('SELECT competency_id AS c FROM unit_competency WHERE unit_id = ?', unitOf(ctx, 'grok-js'))).toEqual([{ c: 'code-reading' }]);
    // a campaign reload never re-flags a gated quest
    const c = loadCampaignIntoDb(ctx.tmp.db, readCampaign(ctx.campaignDir), ctx.clock);
    expect(c.updated).toBe(0);
    expect(pendingFlag(ctx, 'grok-js')).toBe(0);
  });

  it('GET campaign: the pack-backed quest is available + not content-pending; the no-pack quest stays pending', async () => {
    const body = CampaignResponse.parse((await request(ctx.app).get('/api/tracks/js/campaign')).body);
    const q = body.acts[0]!.quests;
    expect(q.map((x) => [x.repo, x.state, x.contentPending])).toEqual([
      ['grok-js', 'available', false],
      ['no-pack-repo', 'pending', true],
      ['read-r1', 'available', false],
    ]);
  });

  it('a pack that leaves: its unattempted gate is removed and the quest is pending again; after attempts it is kept (orphaned)', async () => {
    const empty = mapSeedItemStore([]);
    let s = loadStudyQuestsIntoDb(ctx.tmp.db, empty, ctx.clock);
    expect(s.removed).toBe(3);
    expect(pendingFlag(ctx, 'grok-js')).toBe(1);
    expect(ctx.tmp.db.get('SELECT 1 AS x FROM "check" WHERE unit_id = ?', unitOf(ctx, 'grok-js'))).toBeUndefined();
    // back again, then an attempt, then the pack leaves: history keeps its gate
    loadStudyQuestsIntoDb(ctx.tmp.db, store, ctx.clock);
    expect((await submit(ctx, unitOf(ctx, 'grok-js'), { answers: await served(ctx, unitOf(ctx, 'grok-js'), 'grok-js', withWrong('grok-js', 5)) })).status).toBe(200);
    s = loadStudyQuestsIntoDb(ctx.tmp.db, empty, ctx.clock);
    expect(s.orphaned).toEqual(['campaign/js/grok-js']);
    expect(pendingFlag(ctx, 'grok-js')).toBe(1);
    expect(ctx.tmp.db.get('SELECT 1 AS x FROM "check" WHERE unit_id = ?', unitOf(ctx, 'grok-js'))).toBeDefined();
  });

  it('a re-seeded gate updates in place while unattempted, and REFUSES once attempts reference it', async () => {
    const quizzes = packQuizzes('grok-js');
    const reseeded = mapSeedItemStore(quizzes.slice(1)); // as if the pack lost its first item
    expect(loadStudyQuestsIntoDb(ctx.tmp.db, reseeded, ctx.clock).updated).toBe(1);
    loadStudyQuestsIntoDb(ctx.tmp.db, store, ctx.clock);
    expect((await submit(ctx, unitOf(ctx, 'grok-js'), { answers: await served(ctx, unitOf(ctx, 'grok-js'), 'grok-js', keysOf('grok-js')) })).status).toBe(200);
    expect(() => loadStudyQuestsIntoDb(ctx.tmp.db, reseeded, ctx.clock)).toThrow(StudyQuestLoadError);
    expect(() => loadStudyQuestsIntoDb(ctx.tmp.db, reseeded, ctx.clock)).toThrow(/re-seeded/);
  });

  it('stamp discipline: a quest pack edited after validation is refused by the seed loader', () => {
    const dir = join(ctx.tmp.dir, 'tampered', 'grok-js');
    cpSync(join(QUESTS, 'grok-js'), dir, { recursive: true });
    expect(readSeedPackItems(dir).length).toBeGreaterThan(0);
    writeFileSync(join(dir, 'items.json'), readFileSync(join(dir, 'items.json'), 'utf8').replace('"prompt": "', '"prompt": "EDITED '));
    expect(() => readSeedPackItems(dir)).toThrow(SeedItemLoadError);
    expect(() => loadSeedItemStore([dir])).toThrow(/sha256|stamp/);
  });
});

// ---------------------------------------------------------------- standalone study packs (ladder)

describe('standalone study packs: a quest pack matching no campaign study quest is a ladder study unit (ww6)', { timeout: 60_000 }, () => {
  const ctx = useStudyApi();
  const ww6Keys = () => packQuizzes('ww6').map((q) => q.key);
  const ladderStudyUnits = (ctx: Ctx) =>
    ctx.tmp.db.all<{ id: number; key: string; kind: string; track_id: string; retired_at: number | null }>(
      `SELECT id, key, kind, track_id, retired_at FROM unit WHERE key LIKE 'ladder/study/%' ORDER BY id`,
    );

  it('wires ww6 ONLY (campaign-matched packs stay with their quests); loaded === built; idempotent', () => {
    const s = loadLadderIntoDb(ctx.tmp.db, { seedItems: store, authored: null }, ctx.clock);
    expect(s.study).toEqual({ built: 1, loaded: 1 });
    const units = ladderStudyUnits(ctx);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ key: studyUnitKey('ww6', ww6Keys()), kind: 'study', track_id: 'js', retired_at: null });
    const chk = ctx.tmp.db.get<{ type: string; spec: string; threshold: number }>('SELECT type, spec, threshold FROM "check" WHERE unit_id = ?', units[0]!.id)!;
    expect(chk.type).toBe('study-quiz');
    expect(chk.threshold).toBe(0.8);
    expect(JSON.parse(chk.spec)).toEqual({ type: 'study-quiz', itemKeys: ww6Keys(), passPct: 0.8 });
    expect(ctx.tmp.db.all('SELECT competency_id AS c FROM unit_competency WHERE unit_id = ?', units[0]!.id)).toEqual([{ c: 'code-reading' }]);
    // the campaign-matched packs are NOT duplicated as ladder units
    for (const repo of ['grok-js', 'ship-it', 'csbootcamp']) expect(units.some((u) => u.key.includes(`/study/${repo}/`))).toBe(false);
    // second load: nothing inserted, nothing retired, same unit
    const again = loadLadderIntoDb(ctx.tmp.db, { seedItems: store, authored: null }, ctx.clock);
    expect([again.study.built, again.study.loaded, again.inserted, again.retired]).toEqual([1, 1, 0, 0]);
    expect(ladderStudyUnits(ctx).map((u) => u.id)).toEqual([units[0]!.id]);
    // the listing names the family + repo
    const row = ladderUnits(ctx.tmp.db).find((u) => u.id === units[0]!.id)!;
    expect(row).toMatchObject({ family: 'study', repo: 'ww6', quest: null });
  });

  it('plays like a study quest: reading list + questions without keys, graded server-side, review cards on misses', async () => {
    loadLadderIntoDb(ctx.tmp.db, { seedItems: store, authored: null }, ctx.clock);
    const id = ladderStudyUnits(ctx)[0]!.id;
    const res = await request(ctx.app).get(`/api/units/${id}`);
    expect(res.status).toBe(200);
    const d = UnitDetailResponse.parse(res.body);
    expect(d.studyQuest!.repo).toBe('ww6');
    expect(d.studyQuest!.questions.map((q) => q.prompt)).toEqual(packQuizzes('ww6').map((q) => q.prompt));
    expect(d.studyQuest!.readingSteps.length).toBeGreaterThan(0);
    expect(res.text).not.toMatch(/answerKey|"explanation"/);
    const fail = SubmitResponse.parse((await submit(ctx, id, { answers: await served(ctx, id, 'ww6', withWrong('ww6', 10)) })).body);
    expect(fail.verdict).toBe('fail');
    expect(fail.studyQuiz!.reviewCards.created).toBe(10);
    const pass = SubmitResponse.parse((await submit(ctx, id, { answers: await served(ctx, id, 'ww6', keysOf('ww6')) })).body);
    expect(pass.verdict).toBe('pass');
    expect(pass.studyQuiz!.correct).toBe(keysOf('ww6').length);
  });

  it('a re-seeded ww6 pack retires the old unit and creates a fresh one (never a silent in-place rebind)', () => {
    loadLadderIntoDb(ctx.tmp.db, { seedItems: store, authored: null }, ctx.clock);
    const old = ladderStudyUnits(ctx)[0]!;
    const reseeded = mapSeedItemStore(packQuizzes('ww6').slice(1));
    const s = loadLadderIntoDb(ctx.tmp.db, { seedItems: reseeded, authored: null }, ctx.clock);
    expect(s.study).toEqual({ built: 1, loaded: 1 });
    expect(s.retired).toBe(1);
    const after = ladderStudyUnits(ctx);
    expect(after.find((u) => u.id === old.id)!.retired_at).not.toBeNull();
    expect(after.filter((u) => u.retired_at === null).map((u) => u.key)).toEqual([studyUnitKey('ww6', ww6Keys().slice(1))]);
  });

  it('refuses a quiz item gated by two live units (a review card of one would answer the other)', () => {
    loadLadderIntoDb(ctx.tmp.db, { seedItems: store, authored: null }, ctx.clock);
    insertUnit(
      ctx.tmp.db,
      { key: 'hand/dup-ww6', track: 'js', kind: 'study', title: 'dup', competencies: ['code-reading'], checks: [{ spec: { type: 'study-quiz', itemKeys: [ww6Keys()[0]!], passPct: 0.8 } }] },
      ctx.clock,
    );
    expect(() => assertUniqueSeedItemRefs(ctx.tmp.db)).toThrow(LadderLoadError);
    expect(() => assertUniqueSeedItemRefs(ctx.tmp.db)).toThrow(/hand\/dup-ww6/);
  });
});

// ---------------------------------------------------------------- grading (pure)

function synthetic(n: number): QuizItem[] {
  return Array.from({ length: n }, (_, i) =>
    SeedQuizItem.parse({
      key: `seed:quests:synthetic/quiz/${i}`,
      provenance: { repo: 'synthetic', sha: 'abcdef1', path: 'README.md', lines: { start: 1, end: 2 } },
      kind: 'quiz',
      variety: 'concept',
      prompt: `question ${i}`,
      choices: [{ text: 'a' }, { text: 'b' }],
      check: { type: 'quiz', itemKey: `seed:quests:synthetic/quiz/${i}`, grading: 'choice', answerKey: 1, choices: ['a', 'b'] },
    }),
  );
}

describe('gradeStudyQuiz: >= 80% in integer math', () => {
  const items = synthetic(100);
  const answers = (right: number) => items.map((_, i) => (i < right ? 1 : 0));
  it('79% fails, 80% passes, 100% passes', () => {
    expect(gradeStudyQuiz(items, answers(79), 0.8)).toMatchObject({ correct: 79, passed: false });
    expect(gradeStudyQuiz(items, answers(80), 0.8)).toMatchObject({ correct: 80, passed: true });
    const all = gradeStudyQuiz(items, answers(100), 0.8);
    expect(all).toMatchObject({ correct: 100, total: 100, score: 1, passed: true, missed: [] });
  });
  it('misses are listed by item key; the answer set must be complete; a string is never a choice', () => {
    const g = gradeStudyQuiz(synthetic(5), [1, 1, 1, 0, '1'], 0.8);
    expect(g).toMatchObject({ correct: 3, passed: false, missed: ['seed:quests:synthetic/quiz/3', 'seed:quests:synthetic/quiz/4'] });
    expect(() => gradeStudyQuiz(synthetic(5), [1, 1], 0.8)).toThrow(StudyQuizShapeError);
  });
});

// ---------------------------------------------------------------- API flow

describe('study-quest API flow (real packs)', { timeout: 60_000 }, () => {
  const ctx = useStudyApi();

  it('unit detail: reading steps with repo links + questions with choices; never keys or explanations', async () => {
    const res = await request(ctx.app).get(`/api/units/${unitOf(ctx, 'grok-js')}`);
    expect(res.status).toBe(200);
    const d = UnitDetailResponse.parse(res.body);
    const sq = d.studyQuest!;
    const quizzes = packQuizzes('grok-js');
    expect(d.unit.kind).toBe('study');
    expect(d.check?.spec).toEqual({ type: 'study-quiz', itemKeys: quizzes.map((q) => q.key), passPct: 0.8 });
    expect(sq.passPct).toBe(80);
    expect(sq.questions.map((q) => q.prompt)).toEqual(quizzes.map((q) => q.prompt));
    // ui-audit #24: every question serves exactly its stored choices (as a set), in the unit's served order
    for (const [i, q] of quizzes.entries()) expect([...sq.questions[i]!.choices].sort()).toEqual([...storedTexts(q)].sort());
    expect(sq.readingSteps.length).toBe(17);
    expect(sq.readingSteps[0]!.url).toMatch(/^https:\/\/github\.com\/elirc\/grok-js\/blob\/[0-9a-f]{40}\/.+#L\d+-L\d+$/);
    expect(sq.flashcards).toBe(4);
    expect(res.text).not.toMatch(/answerKey|"explanation"|"evidence"/);
    for (const q of quizzes) if (q.explanation) expect(res.text).not.toContain(q.explanation.slice(0, 60));
  });

  it('run is refused (submit-only) and writes nothing; malformed bodies are 400 and record nothing', async () => {
    const id = unitOf(ctx, 'grok-js');
    const before = ledgerCounts(ctx.tmp.db);
    const run = await request(ctx.app).post(`/api/units/${id}/run`).send({ answers: keysOf('grok-js') });
    expect([run.status, run.body.error.code]).toEqual([409, 'RUN_NOT_AVAILABLE']);
    expect((await submit(ctx, id, { answer: 1 })).status).toBe(400);
    expect((await submit(ctx, id, { answers: [1, 2] })).status).toBe(400);
    expect((await submit(ctx, id, { answers: keysOf('grok-js'), code: 'x' })).status).toBe(400);
    expect(ledgerCounts(ctx.tmp.db)).toEqual(before);
  });

  it('a failed submit is recorded and free; each miss becomes ONE review card due tomorrow (deduped on re-attempts), with front = question, back = keyed answer + citation', async () => {
    const id = unitOf(ctx, 'grok-js');
    const fail = SubmitResponse.parse((await submit(ctx, id, { answers: await served(ctx, id, 'grok-js', withWrong('grok-js', 3)) })).body);
    expect(fail.verdict).toBe('fail');
    expect(fail.xp).toBeNull();
    expect(fail.studyQuiz).toMatchObject({ correct: 11, total: 14, passed: false, passPct: 80, reviewCards: { created: 3, alreadyQueued: 0 } });
    expect(fail.studyQuiz!.items.filter((i) => !i.correct)).toHaveLength(3);
    expect(fail.result.failures.map((f) => f.name)).toEqual(['Q1', 'Q2', 'Q3']);
    // keys never leave in the submit response
    const quizzes = packQuizzes('grok-js');
    const keyedTexts = quizzes.slice(0, 3).map((q) => q.check.choices![q.check.answerKey as number]!);
    expect(JSON.stringify(fail)).not.toContain(keyedTexts[0]);
    expect(fail.studyQuiz!.reviewCards.dueAt).toBe(ctx.clock().getTime() + DAY_MS);
    // not due today
    expect(ReviewQueueResponse.parse((await request(ctx.app).get('/api/reviews/queue')).body).count).toBe(0);
    // re-attempt missing the same + one more: one new card, three deduped
    const again = SubmitResponse.parse((await submit(ctx, id, { answers: await served(ctx, id, 'grok-js', withWrong('grok-js', 4)) })).body);
    expect(again.studyQuiz!.reviewCards).toMatchObject({ created: 1, alreadyQueued: 3 });
    expect(ctx.tmp.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM review_item WHERE kind = 'quiz-miss'`)!.n).toBe(4);
    // tomorrow: the cards are due, with their text
    ctx.clock.advance(DAY_MS);
    const q = ReviewQueueResponse.parse((await request(ctx.app).get('/api/reviews/queue')).body);
    expect(q.count).toBe(4);
    const card = q.items.find((i) => i.cardKey === `quiz-miss:${quizzes[0]!.key}`)!;
    expect(card.kind).toBe('quiz-miss');
    expect(card.unitId).toBe(id);
    expect(card.card!.front).toBe(quizzes[0]!.prompt);
    expect(card.card!.back.startsWith(keyedTexts[0]!)).toBe(true);
    expect(card.card!.source).toContain('grok-js@');
    // the attempts are recorded with their real score
    const scores = ctx.tmp.db.all<{ s: number; o: string }>('SELECT score AS s, outcome AS o FROM attempt WHERE unit_id = ? ORDER BY id', id);
    expect(scores.map((r) => r.o)).toEqual(['fail', 'fail']);
    expect(scores[0]!.s).toBeCloseTo(11 / 14);
  });

  it('pass: +50 study-quest XP once, evidence, quest done (act progress), campaign slate slot ticked, flashcards enrolled; a re-pass pays 0', async () => {
    const id = unitOf(ctx, 'grok-js');
    const pass = SubmitResponse.parse((await submit(ctx, id, { answers: await served(ctx, id, 'grok-js', withWrong('grok-js', 2)) })).body); // 12/14 = 85.7%
    expect(pass.verdict).toBe('pass');
    expect(pass.result.failures).toEqual([]);
    expect(pass.xp).toMatchObject({ amount: 50, reason: null });
    expect(pass.evidenceIds).toHaveLength(1);
    const ev = ctx.tmp.db.get<{ competency_id: string; kind: string; observation: string }>('SELECT competency_id, kind, observation FROM evidence WHERE id = ?', pass.evidenceIds[0]);
    expect(ev).toEqual({ competency_id: 'code-reading', kind: 'submit', observation: 'study quiz 12/14 (85%) passed' });
    expect(pass.studyQuiz).toMatchObject({ passed: true, reviewCards: { created: 2 }, flashcardsEnrolled: 4 });
    const camp = CampaignResponse.parse((await request(ctx.app).get('/api/tracks/js/campaign')).body);
    expect(camp.acts[0]!.quests[0]).toMatchObject({ repo: 'grok-js', state: 'done', contentPending: false });
    expect(camp.acts[0]!.progress).toEqual({ coreDone: 1, coreTotal: 2 });
    const dash = DashboardResponse.parse((await request(ctx.app).get('/api/dashboard')).body);
    expect(dash.slate.items.find((i) => i.slot === 'campaign')?.done).toBe(true);
    expect(dash.xp.total).toBe(50);

    const again = SubmitResponse.parse((await submit(ctx, id, { answers: await served(ctx, id, 'grok-js', keysOf('grok-js')) })).body);
    expect(again.xp).toMatchObject({ amount: 0, reason: 'already-awarded' });
    expect(again.studyQuiz!.flashcardsEnrolled).toBe(0);
    expect(ctx.tmp.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM review_item WHERE kind = 'card'`)!.n).toBe(4);
  });

  it('exactly 80% passes, 73% fails (csbootcamp: 15 questions)', async () => {
    const id = unitOf(ctx, 'csbootcamp', 'csharp');
    expect(keysOf('csbootcamp')).toHaveLength(15);
    const low = SubmitResponse.parse((await submit(ctx, id, { answers: await served(ctx, id, 'csbootcamp', withWrong('csbootcamp', 4)) })).body);
    expect([low.verdict, low.studyQuiz!.correct]).toEqual(['fail', 11]);
    const edge = SubmitResponse.parse((await submit(ctx, id, { answers: await served(ctx, id, 'csbootcamp', withWrong('csbootcamp', 3)) })).body);
    expect([edge.verdict, edge.studyQuiz!.correct, edge.xp?.amount]).toEqual(['pass', 12, 50]);
  });

  it('honest act gate: the no-pack core quest holds act 2 shut (1/2 = 50% < 80%); act 2 units refuse (ACT_LOCKED)', async () => {
    expect((await submit(ctx, unitOf(ctx, 'grok-js'), { answers: await served(ctx, unitOf(ctx, 'grok-js'), 'grok-js', keysOf('grok-js')) })).body.verdict).toBe('pass');
    const camp = CampaignResponse.parse((await request(ctx.app).get('/api/tracks/js/campaign')).body);
    expect(camp.acts[0]!.progress).toEqual({ coreDone: 1, coreTotal: 2 });
    expect(camp.acts[1]!.unlocked).toBe(false);
    const locked = await submit(ctx, unitOf(ctx, 'ship-it'), { answers: keysOf('ship-it') });
    expect([locked.status, locked.body.error.code]).toEqual([403, 'ACT_LOCKED']);
  });

  it('W9 (ui-audit #1) no leak: a locked-act quest unit serves an act gate and NO reading list, quiz question, choice or check', async () => {
    const id = unitOf(ctx, 'ship-it');
    const res = await request(ctx.app).get(`/api/units/${id}`);
    expect(res.status).toBe(200);
    const d = UnitDetailResponse.parse(res.body);
    expect(d.actGate).toEqual({ locked: true });
    expect(d.unit.state).toBe('locked');
    expect([d.check, d.instructions, d.starter, d.snippet, d.rubric]).toEqual([null, null, null, null, null]);
    expect(d.refs).toEqual([]);
    expect(d.studyQuest).toBeUndefined();
    expect(d.explainBack).toBeUndefined();
    expect(d.kata).toBeUndefined();
    // belt and braces: not one question prompt, choice or reading-step title appears anywhere in the raw body
    const raw = JSON.stringify(res.body);
    const quizzes = packQuizzes('ship-it');
    expect(quizzes.length).toBeGreaterThan(0);
    for (const q of quizzes) {
      expect(raw).not.toContain(JSON.stringify(q.prompt).slice(1, -1));
      for (const c of q.choices) if (c.text.length > 12) expect(raw).not.toContain(JSON.stringify(c.text).slice(1, -1));
    }
    expect(raw).not.toContain('readingSteps');
    // by-key reads take the same gate
    const byKey = await request(ctx.app).get(`/api/units/by-key/${encodeURIComponent('campaign/js/ship-it')}`);
    expect(UnitDetailResponse.parse(byKey.body).actGate).toEqual({ locked: true });
    // an unlocked act's unit carries no gate and its full public half
    const open = UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${unitOf(ctx, 'grok-js')}`)).body);
    expect(open.actGate).toBeUndefined();
    expect(open.studyQuest?.questions.length).toBe(keysOf('grok-js').length);
  });

  it('W9 (ui-audit #1) 403: every write on a locked-act unit refuses with ACT_LOCKED and records nothing', async () => {
    const id = unitOf(ctx, 'ship-it');
    const sub = await submit(ctx, id, { answers: keysOf('ship-it') });
    expect([sub.status, sub.body.error.code]).toEqual([403, 'ACT_LOCKED']);
    const run = await request(ctx.app).post(`/api/units/${id}/run`).send({ answer: 0 });
    expect(run.status).toBe(403);
    expect(run.body.error.code).toBe('ACT_LOCKED');
    const reveal = await request(ctx.app).post(`/api/units/${id}/reveal`).send({});
    expect(reveal.status).toBe(403);
    expect(reveal.body.error.code).toBe('ACT_LOCKED');
    expect(ctx.tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt WHERE unit_id = ?', id)!.n).toBe(0);
  });
});

// ---------------------------------------------------------------- ui-audit #24: served choice order

describe('ui-audit #24 (HONESTY): choices are served in a stable secret permutation, so an all-key-0 pack cannot be passed by position', { timeout: 120_000 }, () => {
  const ZERO_PACKS = ['csharp-tut', 'csharp-interview', 'dotnet-snapshot'];
  let zeroStore: SeedItemStore;
  beforeAll(() => {
    zeroStore = loadSeedItemStore(ZERO_PACKS.map((p) => join(QUESTS, p)));
  }, 120_000);

  const ctx = {} as Ctx & { units: Map<string, number> };
  beforeEach(() => {
    ctx.tmp = makeTempDb();
    ctx.clock = fixedClock(localNoon(2026, 10, 1));
    ctx.units = new Map();
    for (const repo of ZERO_PACKS) {
      const spec = { type: 'study-quiz' as const, itemKeys: packQuizzes(repo).map((q) => q.key), passPct: 0.8 };
      ctx.units.set(repo, insertUnit(ctx.tmp.db, { key: `hand/zero/${repo}`, track: 'csharp', kind: 'study', title: repo, competencies: ['code-reading'], checks: [{ spec }] }, ctx.clock));
    }
    ctx.app = createApp({ db: ctx.tmp.db, clock: ctx.clock, runners: defaultRunners(), seedItems: zeroStore });
  });
  afterEach(() => ctx.tmp.cleanup());

  const detail = async (app: Express, id: number) => UnitDetailResponse.parse((await request(app).get(`/api/units/${id}`)).body).studyQuest!.questions;

  it('precondition: these real packs key EVERY question at stored choice 0 (the bias the server must not serve)', () => {
    for (const repo of ZERO_PACKS) {
      const keys = keysOf(repo);
      expect(keys.length, repo).toBeGreaterThanOrEqual(6);
      expect(new Set(keys), repo).toEqual(new Set([0]));
    }
  });

  it('an all-zeros submit FAILS on every all-key-0 pack (recorded, no XP); the right answers in SERVED order PASS', async () => {
    for (const repo of ZERO_PACKS) {
      const id = ctx.units.get(repo)!;
      const zeros = keysOf(repo).map(() => 0);
      const fail = SubmitResponse.parse((await submit(ctx, id, { answers: zeros })).body);
      expect(fail.verdict, `${repo} all-zeros`).toBe('fail');
      expect(fail.xp, repo).toBeNull();
      expect(fail.studyQuiz!.correct, repo).toBeLessThan(Math.ceil(zeros.length * 0.8));
      const pass = SubmitResponse.parse((await submit(ctx, id, { answers: await served(ctx, id, repo, keysOf(repo)) })).body);
      expect(pass.verdict, `${repo} served keys`).toBe('pass');
      expect(pass.studyQuiz!.correct).toBe(zeros.length);
    }
  });

  it('the served order is STABLE: re-fetch, by-key read and a fresh app on the same DB all serve it; it is a permutation of the stored choices and not the authored order', async () => {
    for (const repo of ZERO_PACKS) {
      const id = ctx.units.get(repo)!;
      const a = await detail(ctx.app, id);
      expect(await detail(ctx.app, id)).toEqual(a);
      const byKey = UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/by-key/${encodeURIComponent(`hand/zero/${repo}`)}`)).body);
      expect(byKey.studyQuest!.questions).toEqual(a);
      const fresh = createApp({ db: ctx.tmp.db, clock: ctx.clock, runners: defaultRunners(), seedItems: zeroStore });
      expect(await detail(fresh, id)).toEqual(a);
      const byKeyItems = quizByKey(repo);
      for (const q of a) expect([...q.choices].sort()).toEqual([...storedTexts(byKeyItems.get(q.itemKey)!)].sort());
      // 13+ questions of 3-4 choices all landing on the identity permutation: ~(1/6)^13 or less
      expect(a.map((q) => q.choices)).not.toEqual(a.map((q) => storedTexts(byKeyItems.get(q.itemKey)!)));
    }
  });

  it('the served key positions are spread (no single index holds most keys), and a second DB serves a different order', async () => {
    const positions: number[] = [];
    const orders: string[][] = [];
    for (const repo of ZERO_PACKS) {
      const id = ctx.units.get(repo)!;
      const qs = await detail(ctx.app, id);
      orders.push(qs.map((q) => q.choices.join('|')));
      const byKeyItems = quizByKey(repo);
      for (const q of qs) positions.push(q.choices.indexOf(storedTexts(byKeyItems.get(q.itemKey)!)[0]!));
    }
    expect(positions.every((p) => p >= 0)).toBe(true);
    const counts = new Map<number, number>();
    for (const p of positions) counts.set(p, (counts.get(p) ?? 0) + 1);
    // 40 keys over 3-4 slots: expected ~10-13 per slot; 60% at one slot is > 5 sigma
    expect(Math.max(...counts.values()) / positions.length).toBeLessThan(0.6);

    // a different DB has its own secret: its served order differs (collision ~ 1/24^13)
    const other = makeTempDb();
    try {
      const repo = ZERO_PACKS[0]!;
      const spec = { type: 'study-quiz' as const, itemKeys: packQuizzes(repo).map((q) => q.key), passPct: 0.8 };
      // same unit id on the fresh DB (the first insert), so only the secret differs
      const otherId = insertUnit(other.db, { key: `hand/zero/${repo}`, track: 'csharp', kind: 'study', title: repo, competencies: ['code-reading'], checks: [{ spec }] }, ctx.clock);
      expect(otherId).toBe(ctx.units.get(repo));
      const app2 = createApp({ db: other.db, clock: ctx.clock, runners: defaultRunners(), seedItems: zeroStore });
      expect((await detail(app2, otherId)).map((q) => q.choices.join('|'))).not.toEqual(orders[0]);
    } finally {
      other.cleanup();
    }
  });

  it('a missed item\'s review card quotes the keyed choice TEXT (no served or stored index anywhere)', async () => {
    const repo = 'csharp-tut';
    const id = ctx.units.get(repo)!;
    const qs = await detail(ctx.app, id);
    const byKeyItems = quizByKey(repo);
    // miss question 1 deliberately: answer a served index whose text is NOT the key
    const right = await served(ctx, id, repo, keysOf(repo));
    const answers = right.map((r, i) => (i === 0 ? (r + 1) % qs[0]!.choices.length : r));
    const sub = SubmitResponse.parse((await submit(ctx, id, { answers })).body);
    expect(sub.studyQuiz!.items[0]!.correct).toBe(false);
    ctx.clock.advance(DAY_MS);
    const queue = ReviewQueueResponse.parse((await request(ctx.app).get('/api/reviews/queue')).body);
    const item = byKeyItems.get(qs[0]!.itemKey)!;
    const card = queue.items.find((i) => i.cardKey === `quiz-miss:${item.key}`)!;
    expect(card.card!.front).toBe(item.prompt);
    expect(card.card!.back.startsWith(storedTexts(item)[0]!)).toBe(true);
  });
});
