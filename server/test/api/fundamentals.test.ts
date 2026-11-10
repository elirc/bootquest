/**
 * fund wave: the Fundamentals ladder (store/fundamentals.ts) from the REAL compiled
 * content/fundamentals/<track>/ dirs (seed:import:fundamentals output), plus synthetic stores for the
 * ladder-order, retire and re-seed cases the one-topic pilot cannot show.
 *   - the loader refuses edited bytes and a loaded !== built count;
 *   - one study unit per topic, its ONE check the topic's study-quiz gate (80%), topic N locked
 *     behind topic N-1; idempotent; a topic that left is retired; a changed gate follows THE re-seed
 *     policy (in place while unreferenced, retired-and-replaced once attempts reference it);
 *   - GET /tracks/:id/fundamentals serves metadata + unit states, never a lesson or a key;
 *   - the unit serves the lesson as instructions, the gate's questions with choices only; a miss
 *     queues a review card whose text resolves from the Fundamentals store, a first pass enrols the
 *     topic's flashcards and unlocks the next topic; review-card reconciliation keeps fund cards.
 */
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReviewQueueResponse, ReviewStatsResponse, SubmitResponse, UnitDetailResponse, UnitNotesResponse } from '@bootquest/shared/api';
import { FundamentalsResponse } from '@bootquest/shared/api-ext';
import { FundamentalsFile, fundTopicUnitKey, type FundTopic } from '@bootquest/shared/fundamentals';
import { createApp } from '../../src/api/app.ts';
import { entriesContentStore } from '../../src/api/content-store.ts';
import { defaultRunners } from '../../src/api/runners.ts';
import { DAY_MS, fixedClock, nowMs } from '../../src/engines/clock.ts';
import { dueCount } from '../../src/engines/fsrs.ts';
import { dueAsOf } from '../../src/engines/streak.ts';
import {
  defaultFundamentalsDirs,
  FUND_SOURCE_KEY,
  fundContentEntries,
  FundamentalsLoadError,
  loadFundamentalsIntoDb,
  loadFundStore,
  mapFundStore,
  readFundamentalsDir,
  type FundStore,
} from '../../src/store/fundamentals.ts';
import { reconcileSeededReviewCards } from '../../src/store/review-cards.ts';
import { emptySeedItemStore, withFundamentals } from '../../src/store/seed-items.ts';
import { localNoon, makeTempDb, submit, type TempDb } from '../helpers.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const FUND = join(REPO, 'content', 'fundamentals');

const realFile = (track: string): FundamentalsFile => FundamentalsFile.parse(JSON.parse(readFileSync(join(FUND, track, 'topics.json'), 'utf8')));

/** a second (and third) topic cloned from a real one under a new id, keys re-homed */
function cloneTopic(t: FundTopic, id: string, order: number, track = 'java'): FundTopic {
  const rekey = (k: string) => k.replace(`/${t.id}/`, `/${id}/`);
  return {
    ...t,
    id,
    order,
    title: `${t.title} (${order})`,
    quiz: t.quiz.map((q) => ({ ...q, key: rekey(q.key) })),
    flashcards: t.flashcards.map((c) => ({ ...c, key: rekey(c.key) })),
    drillKeys: t.drillKeys.map((k) => k.replace(`fund-${track}/${t.id}/`, `fund-${track}/${id}/`)),
  };
}

function ladderOf(n: number): FundamentalsFile {
  const base = realFile('java');
  const t0 = base.topics[0]!;
  const topics = [t0, ...Array.from({ length: n - 1 }, (_, i) => cloneTopic(t0, `0${i + 2}-clone-${i + 2}`, i + 2))];
  return { ...base, topics };
}

describe('readFundamentalsDir', () => {
  let tmp: TempDb;
  beforeEach(() => {
    tmp = makeTempDb();
  });
  afterEach(() => tmp.cleanup());

  it('loads every committed track (bytes bound, counts === manifest)', () => {
    const dirs = defaultFundamentalsDirs(FUND);
    expect(dirs.map((d) => d.split(/[\\/]/).pop()).sort()).toEqual(['csharp', 'java', 'js']);
    const store = loadFundStore(dirs);
    for (const track of ['js', 'csharp', 'java'] as const) {
      const topics = store.topics(track);
      expect(topics.length).toBeGreaterThan(0);
      for (const t of topics) {
        expect(t.lesson.length).toBeGreaterThan(600);
        expect(t.quiz.length).toBeGreaterThanOrEqual(8);
        expect(t.flashcards.length).toBeGreaterThanOrEqual(4);
        expect(store.topicOfUnitKey(fundTopicUnitKey(track, t.id))?.topic.id).toBe(t.id);
        for (const q of t.quiz) expect(store.topicOfItem(q.key)?.track).toBe(track);
      }
    }
  });

  it('refuses topics.json bytes the manifest does not bind', () => {
    const dir = join(tmp.dir, 'java');
    cpSync(join(FUND, 'java'), dir, { recursive: true });
    writeFileSync(join(dir, 'topics.json'), readFileSync(join(dir, 'topics.json'), 'utf8').replace('integer division', 'whole-number division'));
    expect(() => readFundamentalsDir(dir)).toThrow(FundamentalsLoadError);
    expect(() => readFundamentalsDir(dir)).toThrow(/manifest binds/);
  });

  it('refuses loaded !== built (bytes re-bound by hand, counts left stale)', () => {
    const dir = join(tmp.dir, 'java');
    cpSync(join(FUND, 'java'), dir, { recursive: true });
    const f = realFile('java');
    f.topics[0]!.flashcards.pop();
    const bytes = `${JSON.stringify(f, null, 2)}\n`;
    writeFileSync(join(dir, 'topics.json'), bytes);
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { sha256: string };
    m.sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
    expect(() => readFundamentalsDir(dir)).toThrow(/loaded .* !== built/);
  });
});

describe('loadFundamentalsIntoDb', () => {
  let tmp: TempDb;
  const clock = fixedClock(localNoon(2026, 11, 4));
  beforeEach(() => {
    tmp = makeTempDb();
  });
  afterEach(() => tmp.cleanup());

  const unitRow = (key: string) =>
    tmp.db.get<{ id: number; kind: string; track_id: string; title: string; retired_at: number | null; difficulty: number | null }>(
      'SELECT id, kind, track_id, title, retired_at, difficulty FROM unit WHERE key = ?',
      key,
    );
  const liveGate = (unitId: number) =>
    tmp.db.all<{ id: number; spec: string; threshold: number | null }>('SELECT id, spec, threshold FROM "check" WHERE unit_id = ? AND retired_at IS NULL', unitId);

  it('one study unit per topic with the topic quiz as its ONE gate; idempotent', () => {
    const store = loadFundStore(defaultFundamentalsDirs(FUND));
    const first = loadFundamentalsIntoDb(tmp.db, store, clock);
    const total = (['js', 'csharp', 'java'] as const).reduce((n, t) => n + store.topics(t).length, 0);
    expect(first.inserted).toBe(total);
    for (const s of first.tracks) expect(s.loaded).toBe(s.topics);
    const t = store.topics('java')[0]!;
    const u = unitRow(fundTopicUnitKey('java', t.id))!;
    expect(u).toMatchObject({ kind: 'study', track_id: 'java', retired_at: null, difficulty: 1 });
    expect(u.title).toBe(`01 · ${t.title}`);
    const gates = liveGate(u.id);
    expect(gates).toHaveLength(1);
    expect(JSON.parse(gates[0]!.spec)).toEqual({ type: 'study-quiz', itemKeys: t.quiz.map((q) => q.key), passPct: 0.8 });
    expect(gates[0]!.threshold).toBe(0.8);
    expect(tmp.db.all('SELECT competency_id AS c FROM unit_competency WHERE unit_id = ?', u.id)).toEqual([{ c: 'language-fluency' }]);
    const again = loadFundamentalsIntoDb(tmp.db, store, clock);
    expect(again.inserted).toBe(0);
    expect(again.retired).toBe(0);
    expect(tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM unit u JOIN source s ON s.id = u.source_id WHERE s.key = ?', FUND_SOURCE_KEY)!.n).toBe(total);
  });

  it('the ladder order is the gate: topic N has topic N-1 as its only prerequisite', () => {
    loadFundamentalsIntoDb(tmp.db, mapFundStore([ladderOf(3)]), clock);
    const ids = ladderOf(3).topics.map((t) => unitRow(fundTopicUnitKey('java', t.id))!.id);
    const prereq = (id: number) => tmp.db.all<{ p: number }>('SELECT prereq_unit_id AS p FROM unit_prerequisite WHERE unit_id = ?', id).map((r) => r.p);
    expect(prereq(ids[0]!)).toEqual([]);
    expect(prereq(ids[1]!)).toEqual([ids[0]]);
    expect(prereq(ids[2]!)).toEqual([ids[1]]);
  });

  it('a topic that leaves the file is retired, and comes back with its unit id', () => {
    loadFundamentalsIntoDb(tmp.db, mapFundStore([ladderOf(2)]), clock);
    const key = fundTopicUnitKey('java', ladderOf(2).topics[1]!.id);
    const id = unitRow(key)!.id;
    const r = loadFundamentalsIntoDb(tmp.db, mapFundStore([ladderOf(1)]), clock);
    expect(r.retired).toBe(1);
    expect(unitRow(key)!.retired_at).not.toBeNull();
    loadFundamentalsIntoDb(tmp.db, mapFundStore([ladderOf(2)]), clock);
    expect(unitRow(key)).toMatchObject({ id, retired_at: null });
  });

  it('a changed gate is updated in place while unreferenced, retired-and-replaced once an attempt references it', () => {
    const f = ladderOf(1);
    loadFundamentalsIntoDb(tmp.db, mapFundStore([f]), clock);
    const id = unitRow(fundTopicUnitKey('java', f.topics[0]!.id))!.id;
    const g0 = liveGate(id)[0]!;
    const shorter = { ...f, topics: [{ ...f.topics[0]!, quiz: f.topics[0]!.quiz.slice(0, 9) }] };
    loadFundamentalsIntoDb(tmp.db, mapFundStore([shorter]), clock);
    const g1 = liveGate(id);
    expect(g1).toHaveLength(1);
    expect(g1[0]!.id).toBe(g0.id); // in place
    expect((JSON.parse(g1[0]!.spec) as { itemKeys: string[] }).itemKeys).toHaveLength(9);
    // an attempt now references the gate
    submit(tmp.db, clock, id, { pass: false });
    const r = loadFundamentalsIntoDb(tmp.db, mapFundStore([f]), clock);
    expect(r.replaced).toEqual([fundTopicUnitKey('java', f.topics[0]!.id)]);
    const g2 = liveGate(id);
    expect(g2).toHaveLength(1);
    expect(g2[0]!.id).not.toBe(g0.id);
    expect(tmp.db.get<{ r: number | null }>('SELECT retired_at AS r FROM "check" WHERE id = ?', g0.id)!.r).not.toBeNull();
  });
});

describe('Fundamentals over HTTP', () => {
  let tmp: TempDb;
  let clock: ReturnType<typeof fixedClock>;
  let app: Express;
  let store: FundStore;
  const ladder = ladderOf(2);

  beforeEach(() => {
    tmp = makeTempDb();
    clock = fixedClock(localNoon(2026, 11, 4));
    store = mapFundStore([ladder, realFile('js'), realFile('csharp')]);
    loadFundamentalsIntoDb(tmp.db, store, clock);
    app = createApp({ db: tmp.db, clock, runners: defaultRunners(), seedItems: withFundamentals(emptySeedItemStore, store), content: entriesContentStore(fundContentEntries(store)) });
  });
  afterEach(() => tmp.cleanup());

  const topicUnit = (i: number) => tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', fundTopicUnitKey('java', ladder.topics[i]!.id))!.id;
  /** the stored keyed choice's index in the SERVED (permuted) order, per question */
  async function served(unitId: number, wrong = 0): Promise<number[]> {
    const d = UnitDetailResponse.parse((await request(app).get(`/api/units/${unitId}`)).body);
    const topic = store.topicOfUnitKey(d.unit.key)!.topic;
    return d.studyQuest!.questions.map((q, i) => {
      const item = topic.quiz.find((x) => x.key === q.itemKey)!;
      const right = q.choices.indexOf(item.choices[item.answer]!);
      return i < wrong ? (right + 1) % q.choices.length : right;
    });
  }

  it('GET /tracks/:id/fundamentals: topics in order with unit states, never a lesson or a key', async () => {
    const res = await request(app).get('/api/tracks/java/fundamentals');
    expect(res.status).toBe(200);
    const body = FundamentalsResponse.parse(res.body);
    expect(body.topics.map((t) => t.order)).toEqual([1, 2]);
    expect(body.topics.map((t) => t.unit.state)).toEqual(['available', 'locked']);
    expect(body.topics[0]).toMatchObject({ quizQuestions: 10, passPct: 80, flashcards: 8, level: 'beginner' });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(ladder.topics[0]!.lesson.slice(0, 40));
    expect(raw).not.toContain('"answer"');
    expect(raw).not.toContain(ladder.topics[0]!.quiz[0]!.prompt);
    // a track without a ladder, and an unknown one
    expect((await request(app).get('/api/tracks/sysdesign/fundamentals')).body).toEqual({ trackId: 'sysdesign', topics: [] });
    expect((await request(app).get('/api/tracks/nope/fundamentals')).status).toBe(400);
  });

  it('the topic unit serves the lesson as instructions and the gate without keys', async () => {
    const res = await request(app).get(`/api/units/${topicUnit(0)}`);
    const d = UnitDetailResponse.parse(res.body);
    expect(d.instructions).toBe(ladder.topics[0]!.lesson);
    expect(d.studyQuest).toMatchObject({ repo: 'fundamentals', readingSteps: [], passPct: 80, flashcards: 8 });
    expect(d.studyQuest!.questions).toHaveLength(10);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('answerKey');
    expect(raw).not.toContain(ladder.topics[0]!.quiz[0]!.explanation);
  });

  it('a miss queues a review card with Fundamentals text; a pass enrols the flashcards and unlocks the next topic', async () => {
    const u0 = topicUnit(0);
    const fail = SubmitResponse.parse((await request(app).post(`/api/units/${u0}/submit`).send({ answers: await served(u0, 3) })).body);
    expect(fail.verdict).toBe('fail');
    expect(fail.studyQuiz).toMatchObject({ correct: 7, total: 10, passed: false });
    const misses = tmp.db.all<{ k: string }>(`SELECT card_key AS k FROM review_item WHERE card_key LIKE 'quiz-miss:fund:%' ORDER BY id`).map((r) => r.k);
    expect(misses).toEqual(ladder.topics[0]!.quiz.slice(0, 3).map((q) => `quiz-miss:${q.key}`));

    const pass = SubmitResponse.parse((await request(app).post(`/api/units/${u0}/submit`).send({ answers: await served(u0) })).body);
    expect(pass.verdict).toBe('pass');
    expect(pass.studyQuiz!.flashcardsEnrolled).toBe(8);
    const states = FundamentalsResponse.parse((await request(app).get('/api/tracks/java/fundamentals')).body).topics.map((t) => t.unit.state);
    expect(states).toEqual(['done', 'available']);

    // the queue (tomorrow): every card resolves its text from the Fundamentals store
    clock.advance(DAY_MS + 1);
    const q = ReviewQueueResponse.parse((await request(app).get('/api/reviews/queue?limit=50')).body);
    const fund = q.items.filter((it) => it.cardKey.includes('fund:java/'));
    expect(fund).toHaveLength(3 + 8);
    for (const it of fund) {
      expect(it.card?.source).toBe(`Fundamentals · Java · 01 ${ladder.topics[0]!.title}`);
      expect(it.card?.front.length).toBeGreaterThan(0);
    }
    const miss = fund.find((it) => it.cardKey === `quiz-miss:${ladder.topics[0]!.quiz[0]!.key}`)!;
    const q0 = ladder.topics[0]!.quiz[0]!;
    expect(miss.card).toMatchObject({ front: q0.prompt, back: `${q0.choices[q0.answer]}\n\n${q0.explanation}` });
  });

  // f52 fix: a failed gate's miss cards (back = keyed choice) are HELD until the gate is passed
  it('a failed gate keeps its miss cards enrolled but out of the queue, due counts and grading until a pass', async () => {
    const u0 = topicUnit(0);
    const quiz = ladder.topics[0]!.quiz;
    const fail = SubmitResponse.parse((await request(app).post(`/api/units/${u0}/submit`).send({ answers: await served(u0, 3) })).body);
    expect(fail.verdict).toBe('fail');
    expect(fail.studyQuiz!.reviewCards.created).toBe(3);
    expect(JSON.stringify(fail)).not.toContain('due tomorrow');
    const cards = tmp.db.all<{ id: number }>(`SELECT id FROM review_item WHERE card_key LIKE 'quiz-miss:fund:%' ORDER BY id`);
    expect(cards).toHaveLength(3);

    // a day later the cards are past their due time, yet nothing serves, counts or grades them
    clock.advance(DAY_MS + 1);
    const held = ReviewQueueResponse.parse((await request(app).get('/api/reviews/queue?limit=50')).body);
    expect(held.count).toBe(0);
    expect(held.items).toEqual([]);
    expect(dueCount(tmp.db, clock)).toBe(0);
    expect(dueAsOf(tmp.db, nowMs(clock))).toBe(0);
    expect(ReviewStatsResponse.parse((await request(app).get('/api/stats/reviews')).body)).toMatchObject({ cards: 0, dueNow: 0 });
    const grade = await request(app).post(`/api/reviews/${cards[0]!.id}/grade`).send({ grade: 'good' });
    expect(grade.status).toBe(409);
    expect(grade.body.error.code).toBe('NOT_DUE');
    expect(tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_log')!.n).toBe(0);

    // the pass releases them at once (their due time already elapsed): ordinary cards from here on
    const passAt = nowMs(clock);
    const pass = SubmitResponse.parse((await request(app).post(`/api/units/${u0}/submit`).send({ answers: await served(u0) })).body);
    expect(pass.verdict).toBe('pass');
    const open = ReviewQueueResponse.parse((await request(app).get('/api/reviews/queue?limit=50')).body);
    expect(open.items.map((it) => it.id)).toEqual(cards.map((c) => c.id));
    expect(open.count).toBe(3);
    const q0 = quiz[0]!;
    expect(open.items[0]!.card).toMatchObject({ front: q0.prompt, back: `${q0.choices[q0.answer]}\n\n${q0.explanation}` });
    expect(dueAsOf(tmp.db, passAt - 1)).toBe(0); // as of before the pass they were still held
    expect(dueAsOf(tmp.db, nowMs(clock))).toBe(3);
    expect((await request(app).post(`/api/reviews/${cards[0]!.id}/grade`).send({ grade: 'good' })).status).toBe(200);
  });

  // f52 U3 (ruling 4): keyed answers + explanations after a PASSED gate; a failed gate releases nothing
  it('GET /units/:id/notes: nothing before or after a failed gate, every keyed answer + explanation after a pass', async () => {
    const u0 = topicUnit(0);
    const quiz = ladder.topics[0]!.quiz;
    const notes = async () => UnitNotesResponse.parse((await request(app).get(`/api/units/${u0}/notes`)).body);
    const leaks = (raw: string) => quiz.some((q) => raw.includes(q.explanation));

    const before = await notes();
    expect(before.explanations).toMatchObject({ state: 'locked', released: [], withheld: 10, nextAt: null });
    expect(leaks(JSON.stringify(before))).toBe(false);

    // a fail (7/10): not even the seven answered right are released, so a retry is never open-key
    const fail = SubmitResponse.parse((await request(app).post(`/api/units/${u0}/submit`).send({ answers: await served(u0, 3) })).body);
    expect(fail.verdict).toBe('fail');
    expect(JSON.stringify(fail)).not.toContain(quiz[5]!.explanation);
    const afterFail = await notes();
    expect(afterFail.explanations).toMatchObject({ state: 'locked', released: [], withheld: 10 });
    expect(leaks(JSON.stringify(afterFail))).toBe(false);

    // a pass with two misses: all ten, in question order, each with the keyed choice TEXT first
    const pass = SubmitResponse.parse((await request(app).post(`/api/units/${u0}/submit`).send({ answers: await served(u0, 2) })).body);
    expect(pass.verdict).toBe('pass');
    const after = await notes();
    expect(after.explanations.state).toBe('released');
    expect(after.explanations.withheld).toBe(0);
    expect(after.explanations.released.map((n) => n.target)).toEqual(quiz.map((q) => q.key));
    for (const [i, n] of after.explanations.released.entries()) {
      const q = quiz[i]!;
      expect(n).toMatchObject({ phase: 'after', targetKind: 'quiz', title: `Q${i + 1}`, excerpts: [], readMore: [] });
      expect(n.body).toBe(`Answer: ${q.choices[q.answer]}\n\n${q.explanation}`);
    }
    // the keyed text is one of the choices the learner was served (whatever position it landed in)
    const d = UnitDetailResponse.parse((await request(app).get(`/api/units/${u0}`)).body);
    for (const [i, q] of d.studyQuest!.questions.entries()) expect(q.choices).toContain(quiz[i]!.choices[quiz[i]!.answer]);
    // the next topic's gate (unlocked, never passed) still serves nothing
    const next = UnitNotesResponse.parse((await request(app).get(`/api/units/${topicUnit(1)}/notes`)).body);
    expect(next.explanations).toMatchObject({ state: 'locked', released: [] });
  });

  it('review-card reconciliation keeps fund cards while the store has them, retires them when it does not', async () => {
    const u0 = topicUnit(0);
    await request(app).post(`/api/units/${u0}/submit`).send({ answers: await served(u0, 3) });
    const keep = reconcileSeededReviewCards(tmp.db, withFundamentals(emptySeedItemStore, store), clock);
    expect(keep.retired).toEqual([]);
    const gone = reconcileSeededReviewCards(tmp.db, emptySeedItemStore, clock);
    expect(gone.retired).toHaveLength(3);
    const back = reconcileSeededReviewCards(tmp.db, withFundamentals(emptySeedItemStore, store), clock);
    expect(back.restored).toHaveLength(3);
  });
});
