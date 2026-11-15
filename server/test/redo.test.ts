/**
 * rv2 S1 task 5 (PLAN §2.1 items 5-6, F2 + F3 acceptance).
 *   redo   3 days after a drill source of an idea with siblings is passed, a redo card opens a sibling (not passed
 *          first, else the least recently passed) in practice mode; a passing run rates it Good, a fail Again; at
 *          most ONE redo card is served per day (flood: three earned the same day come out on three days); a redo
 *          run writes no attempt, run row, evidence or practice_log, and no XP beyond the card's review XP; a bare
 *          self-rating of a redo card is refused.
 *   ebmiss on the answer-of-record self-score, missed [w2]/[w3] key points become cards: <= 3 per attempt, [w3]
 *          first, unweighted ones never; the front is the question + the headline (never the key point); a re-miss
 *          re-grades; a key point re-seeded away retires its card, and grading a retired card is refused.
 *   F3     a flashcard tagged repo-recall in card-tags.json is never enrolled; existing rows are untouched.
 */
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { conceptCardText } from '../src/api/keyideas-service.ts';
import { DAY_MS, fixedClock, nowMs } from '../src/engines/clock.ts';
import { addReviewItem } from '../src/engines/fsrs.ts';
import { enrolEbMisses, GENERIC_HEADLINE, MAX_EBMISS_PER_ATTEMPT } from '../src/engines/redo.ts';
import { enrollFlashcards } from '../src/engines/study-quest.ts';
import { keyIdeas, makeKeyIdeas, readKeyIdeas, setKeyIdeas } from '../src/store/keyideas.ts';
import { makeRouting, setRouting } from '../src/store/routing.ts';
import { reconcileSeededReviewCards } from '../src/store/review-cards.ts';
import { emptySeedItemStore, type SeedItemStore } from '../src/store/seed-items.ts';
import { fakeDrillJs } from './api/harness.ts';
import { localNoon, makeTempDb, makeUnit, submit, type TempDb } from './helpers.ts';

const CONTENT = join(import.meta.dirname, 'fixtures', 'keyideas', 'content');
const RIGHT = 'export const add = (a, b) => a + b;';
const WRONG = 'export const add = (a, b) => a - b;';
const n = (db: TempDb['db'], sql: string, ...p: (string | number)[]): number => db.get<{ n: number }>(sql, ...p)!.n;
const ledger = (db: TempDb['db']) => ({
  attempt: n(db, 'SELECT COUNT(*) AS n FROM attempt'),
  run: n(db, 'SELECT COUNT(*) AS n FROM run'),
  evidence: n(db, 'SELECT COUNT(*) AS n FROM evidence'),
  practice: n(db, 'SELECT COUNT(*) AS n FROM practice_log'),
  nonReviewXp: n(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM xp_event WHERE kind <> 'review'"),
});

const idea = (id: string, source: string, siblings: string[]) => ({ id, idea: `Idea ${id}.`, why: 'w', prompt: `Prompt ${id}?`, answer: `Answer ${id}.`, tags: ['t'], sources: [source], siblings });

describe('redo cards (spaced production)', () => {
  let tmp: TempDb;
  let app: Express;
  const clock = fixedClock(localNoon(2026, 11, 14));
  const ids: Record<string, number> = {};
  beforeEach(() => {
    tmp = makeTempDb();
    clock.set(localNoon(2026, 11, 14));
    setRouting(makeRouting([]));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const k of ['kr/d1', 'kr/d2', 'kr/d3', 'kr/s1', 'kr/s2', 'kr/s3']) ids[k] = makeUnit(tmp.db, clock, { key: k, competencies: ['language-fluency'] });
    setKeyIdeas(
      makeKeyIdeas([
        {
          format: 'bootquest-keyideas@1',
          section: 'fx-redo',
          title: 'Redo fixture',
          track: 'js',
          scope: ['kr/'],
          ideas: [idea('one', 'kr/d1', ['kr/s1', 'kr/s2']), idea('two', 'kr/d2', ['kr/s2']), idea('three', 'kr/d3', ['kr/s3']), idea('no-sibling', 'kr/s3', [])],
        },
      ]),
    );
    app = createApp({ db: tmp.db, clock, runners: { 'drill-js': fakeDrillJs } });
  }, 60_000);
  afterEach(() => {
    tmp.cleanup();
    setKeyIdeas(null);
    setRouting(null);
    vi.restoreAllMocks();
  });

  const queue = async () => (await request(app).get('/api/reviews/queue')).body as { count: number; items: { id: number; cardKey: string }[] };
  const redoOut = (items: { cardKey: string }[]) => items.filter((i) => i.cardKey.startsWith('redo:')).map((i) => i.cardKey);

  it('three redo cards earned on one day come out one per day, three days after the pass; a sibling idea without siblings gets none', async () => {
    for (const k of ['kr/d1', 'kr/d2', 'kr/d3']) submit(tmp.db, clock, ids[k]!);
    await request(app).get('/api/keyideas');
    expect(n(tmp.db, "SELECT COUNT(*) AS n FROM review_item WHERE card_key LIKE 'redo:%'")).toBe(3);
    expect(redoOut((await queue()).items)).toEqual([]);
    clock.advance(2 * DAY_MS);
    expect(redoOut((await queue()).items)).toEqual([]);
    const served: string[] = [];
    for (let day = 0; day < 3; day++) {
      clock.advance(DAY_MS);
      const q = await queue();
      const out = redoOut(q.items);
      expect(out.length).toBeLessThanOrEqual(1);
      // the queue count never counts a parked redo card
      expect(q.count).toBe(q.items.length);
      for (const key of out) {
        const id = q.items.find((i) => i.cardKey === key)!.id;
        expect((await request(app).post(`/api/redo/${id}/run`).send({ code: RIGHT })).body.grade).toBe('good');
        served.push(key);
        // after the day's redo, nothing else comes out today
        expect(redoOut((await queue()).items)).toEqual([]);
      }
    }
    // one a day, each earned card once (a graded redo card returns later on its own FSRS schedule)
    expect(served.sort()).toEqual(['redo:fx-redo/one', 'redo:fx-redo/three', 'redo:fx-redo/two']);
    // ideas whose source passed but list no sibling never get a redo card
    submit(tmp.db, clock, ids['kr/s3']!);
    await request(app).get('/api/keyideas');
    expect(n(tmp.db, "SELECT COUNT(*) AS n FROM review_item WHERE card_key = 'redo:fx-redo/no-sibling'")).toBe(0);
  });

  it('a redo run grades only the card (Good on pass, Again on fail) and writes no attempt / run / evidence / practice_log / extra XP', async () => {
    submit(tmp.db, clock, ids['kr/d1']!);
    await request(app).get('/api/keyideas');
    clock.advance(3 * DAY_MS + 1);
    const q = await queue();
    const id = q.items.find((i) => i.cardKey === 'redo:fx-redo/one')!.id;
    // the card opens the first sibling not passed yet
    expect((await request(app).get(`/api/keyideas/cards/${id}`)).body.redo).toMatchObject({ unitId: ids['kr/s1'], key: 'kr/s1' });
    expect((await request(app).post(`/api/reviews/${id}/grade`).send({ grade: 'easy' })).status).toBe(409);
    const before = ledger(tmp.db);
    const fail = await request(app).post(`/api/redo/${id}/run`).send({ code: WRONG });
    expect(fail.status).toBe(200);
    expect(fail.body).toMatchObject({ grade: 'again', unitId: ids['kr/s1'], result: { pass: false }, xp: { amount: 1 } });
    expect(ledger(tmp.db)).toEqual(before);
    // graded today: it is parked again and not due until a later day
    expect((await request(app).post(`/api/redo/${id}/run`).send({ code: RIGHT })).status).toBe(409);
    clock.advance(DAY_MS);
    const q2 = await queue();
    expect(redoOut(q2.items)).toEqual(['redo:fx-redo/one']);
    const ok = await request(app).post(`/api/redo/${id}/run`).send({ code: RIGHT });
    expect(ok.body).toMatchObject({ grade: 'good', result: { pass: true }, xp: { amount: 1 } });
    expect(ledger(tmp.db)).toEqual(before);
    // the only XP: one review XP per graded day (two runs on two days)
    expect(n(tmp.db, "SELECT COALESCE(SUM(amount), 0) AS n FROM xp_event WHERE kind = 'review'")).toBe(2);
    // once s1 is passed the card opens s2 (the least recently passed of the rest)
    submit(tmp.db, clock, ids['kr/s1']!);
    expect((await request(app).get(`/api/keyideas/cards/${id}`)).body.redo).toMatchObject({ key: 'kr/s2' });
  });
  it('rv3 W10c: a released redo card is first in the reviews queue, ahead of 100 older due flashcards', async () => {
    submit(tmp.db, clock, ids['kr/d1']!);
    await request(app).get('/api/keyideas');
    // 100 flashcard-style cards, all due before the redo card is released
    for (let k = 0; k < 100; k++) addReviewItem(tmp.db, { cardKey: `flashcard:fx/w10c-${k}`, kind: 'card', dueAt: nowMs(clock) + DAY_MS + k }, clock);
    clock.advance(3 * DAY_MS + 1);
    const page = (await request(app).get('/api/reviews/queue').query({ limit: '10' })).body as { count: number; items: { cardKey: string }[] };
    expect(page.count).toBe(102); // + idea one's own key-idea card (due the day after the pass)
    expect(page.items).toHaveLength(10);
    expect(page.items[0]!.cardKey).toBe('redo:fx-redo/one');
    // the rest keep their due order, and no card is listed twice
    expect(page.items.slice(1).map((i) => i.cardKey)).toEqual(['keyidea:fx-redo/one', ...Array.from({ length: 8 }, (_, k) => `flashcard:fx/w10c-${k}`)]);
    const all = (await request(app).get('/api/reviews/queue')).body.items as { cardKey: string }[];
    expect(new Set(all.map((i) => i.cardKey)).size).toBe(all.length);
    expect(all).toHaveLength(102);
  });

  it('rv3 MF-3: a redo card whose idea lost every live sibling is skipped, never blocks the others, retires at startup and returns with a sibling', async () => {
    const base = keyIdeas();
    const withSiblings = (one: string[]) =>
      makeKeyIdeas([{ ...base.sections.get('fx-redo')!, ideas: base.sections.get('fx-redo')!.ideas.map((i) => (i.id === 'one' ? { ...i, siblings: one } : i)) }]);
    submit(tmp.db, clock, ids['kr/d1']!);
    clock.advance(DAY_MS);
    submit(tmp.db, clock, ids['kr/d2']!);
    await request(app).get('/api/keyideas');
    clock.advance(3 * DAY_MS);
    expect(redoOut((await queue()).items)).toEqual(['redo:fx-redo/one']);
    // the side file drops idea one's siblings (rv3 edits these lists) while its card is out
    setKeyIdeas(withSiblings([]));
    const q = await queue();
    // the dead card leaves the queue at once and does not hold back the next redo card
    expect(redoOut(q.items)).toEqual(['redo:fx-redo/two']);
    expect(q.count).toBe(q.items.length);
    const two = q.items.find((i) => i.cardKey === 'redo:fx-redo/two')!.id;
    expect((await request(app).post(`/api/redo/${two}/run`).send({ code: RIGHT })).body.grade).toBe('good');
    // the following days: never released while it has no live sibling
    for (let d = 0; d < 3; d++) {
      clock.advance(DAY_MS);
      expect(redoOut((await queue()).items)).not.toContain('redo:fx-redo/one');
    }
    // startup: retired; a sibling that comes back restores it, and it is released again
    expect(reconcileSeededReviewCards(tmp.db, emptySeedItemStore, clock).retired).toContain('redo:fx-redo/one');
    // an archived or retired sibling unit counts as no sibling too
    setKeyIdeas(withSiblings(['kr/s3']));
    tmp.db.run("UPDATE unit SET retired_at = 1 WHERE key = 'kr/s3'");
    expect(reconcileSeededReviewCards(tmp.db, emptySeedItemStore, clock).restored).toEqual([]);
    tmp.db.run("UPDATE unit SET retired_at = NULL WHERE key = 'kr/s3'");
    expect(reconcileSeededReviewCards(tmp.db, emptySeedItemStore, clock).restored).toEqual(['redo:fx-redo/one']);
    // released again: one redo a day, so run whatever is out (two may be due again on its own schedule) until it is
    let released = false;
    for (let d = 0; d < 6 && !released; d++) {
      clock.advance(DAY_MS);
      const day = await queue();
      const out = redoOut(day.items);
      expect(out.length).toBeLessThanOrEqual(1);
      if (out[0] === 'redo:fx-redo/one') released = true;
      else for (const key of out) await request(app).post(`/api/redo/${day.items.find((i) => i.cardKey === key)!.id}/run`).send({ code: RIGHT });
    }
    expect(released).toBe(true);
  });
});

describe('missed-key-point cards (ebmiss) + F3', () => {
  let tmp: TempDb;
  const clock = fixedClock(localNoon(2026, 11, 14));
  const SET = 'eb:kx-design';
  const kps = (q: number) => [
    { text: `[w3] q${q} big point`, id: `q${q}k1` },
    { text: `[w2] q${q} medium point`, id: `q${q}k2` },
    { text: `[w1] q${q} small point`, id: `q${q}k3` },
  ];
  const questions = [1, 2, 3].map((q) => ({ prompt: `DESIGN IT question ${q}?`, keyPoints: kps(q) }));
  const store = (qs: typeof questions): SeedItemStore =>
    ({
      ...emptySeedItemStore,
      explainBack: (k: string) => (k === SET ? ({ key: SET, questions: qs.map((q) => ({ prompt: q.prompt, keyPoints: q.keyPoints.map((kp) => ({ text: kp.text })) })) } as never) : undefined),
    }) as SeedItemStore;
  let unitId = 0;
  beforeEach(() => {
    tmp = makeTempDb();
    setKeyIdeas(readKeyIdeas(CONTENT));
    unitId = makeUnit(tmp.db, clock, { key: 'ladder/explain-back/kx/abc', kind: 'explain-back' });
    tmp.db.run('UPDATE "check" SET spec = json_set(spec, \'$.questionSetKey\', ?) WHERE unit_id = ?', SET, unitId);
  }, 60_000);
  afterEach(() => {
    tmp.cleanup();
    setKeyIdeas(null);
  });

  it('<= 3 per attempt, [w3] first, unweighted never; the front shows the headline, never the key point; a re-miss re-grades', () => {
    const all = Object.fromEntries(questions.flatMap((q) => q.keyPoints.map((kp) => [kp.id, 'missed' as const])));
    const keys = enrolEbMisses(tmp.db, { id: unitId, key: 'ladder/explain-back/kx/abc' }, questions, all, clock);
    expect(keys).toHaveLength(MAX_EBMISS_PER_ATTEMPT);
    expect(keys).toEqual(['ladder/explain-back/kx/abc#q1k1', 'ladder/explain-back/kx/abc#q2k1', 'ladder/explain-back/kx/abc#q3k1'].map((k) => `ebmiss:${k}`));
    const t = nowMs(clock);
    for (const r of tmp.db.all<{ due: number; kind: string }>("SELECT due_at AS due, kind FROM review_item WHERE card_key LIKE 'ebmiss:%'")) expect(r).toEqual({ due: t + DAY_MS, kind: 'concept' });
    // only [w1] missed: no card
    expect(enrolEbMisses(tmp.db, { id: unitId, key: 'ladder/explain-back/kx/abc' }, questions, { q1k3: 'missed' }, clock)).toEqual([]);
    const seed = store(questions);
    const withHeadline = conceptCardText(tmp.db, seed, 'ebmiss:ladder/explain-back/kx/abc#q1k1')!;
    expect(withHeadline.front).toContain('DESIGN IT question 1?');
    expect(withHeadline.front).toContain('Name the envelope number first'); // headlines.json
    expect(withHeadline.front).not.toContain('big point');
    expect(withHeadline.back).toBe('q1 big point'); // the [w3] prefix is display-stripped
    expect(conceptCardText(tmp.db, seed, 'ebmiss:ladder/explain-back/kx/abc#q3k1')!.front).toContain(GENERIC_HEADLINE);
    // a re-miss re-grades the card (no second row) and stays within 3
    clock.advance(2 * DAY_MS);
    expect(enrolEbMisses(tmp.db, { id: unitId, key: 'ladder/explain-back/kx/abc' }, questions, { q1k1: 'missed', q1k2: 'missed' }, clock)).toHaveLength(2);
    expect(n(tmp.db, "SELECT COUNT(*) AS n FROM review_item WHERE card_key LIKE 'ebmiss:%'")).toBe(4);
  });

  it('a key point re-seeded away retires its card; grading the retired card is refused', async () => {
    enrolEbMisses(tmp.db, { id: unitId, key: 'ladder/explain-back/kx/abc' }, questions, { q3k1: 'missed', q1k1: 'missed' }, clock);
    const shorter = [questions[0]!, questions[1]!, { ...questions[2]!, keyPoints: [] }];
    const r = reconcileSeededReviewCards(tmp.db, store(shorter), clock);
    expect(r.retired).toEqual(['ebmiss:ladder/explain-back/kx/abc#q3k1']);
    clock.advance(DAY_MS + 1);
    const app = createApp({ db: tmp.db, clock, seedItems: store(shorter) });
    const id = tmp.db.get<{ id: number }>("SELECT id FROM review_item WHERE card_key = 'ebmiss:ladder/explain-back/kx/abc#q3k1'")!.id;
    expect((await request(app).post(`/api/reviews/${id}/grade`).send({ grade: 'good' })).status).toBe(404);
    const q = (await request(app).get('/api/reviews/queue')).body;
    expect(q.items.map((i: { cardKey: string }) => i.cardKey)).toEqual(['ebmiss:ladder/explain-back/kx/abc#q1k1']);
  });

  it('F3: a repo-recall flashcard is never enrolled; a row that already exists is untouched', () => {
    const u = makeUnit(tmp.db, clock, { kind: 'study' });
    addReviewItem(tmp.db, { cardKey: 'flashcard:fc:kx-listed', kind: 'card', unitId: u }, clock);
    const before = tmp.db.get('SELECT * FROM review_item WHERE card_key = ?', 'flashcard:fc:kx-listed');
    expect(enrollFlashcards(tmp.db, u, ['fc:kx-repo-recall', 'fc:kx-transferable', 'fc:kx-listed', 'fc:kx-other'], clock)).toBe(2);
    const keys = tmp.db.all<{ k: string }>("SELECT card_key AS k FROM review_item WHERE card_key LIKE 'flashcard:%' ORDER BY card_key").map((r) => r.k);
    expect(keys).toEqual(['flashcard:fc:kx-listed', 'flashcard:fc:kx-other', 'flashcard:fc:kx-transferable']);
    expect(tmp.db.get('SELECT * FROM review_item WHERE card_key = ?', 'flashcard:fc:kx-listed')).toEqual(before);
    // no card-tags.json: no filter
    setKeyIdeas(makeKeyIdeas([]));
    expect(enrollFlashcards(tmp.db, u, ['fc:kx-repo-recall'], clock)).toBe(1);
  });
});
