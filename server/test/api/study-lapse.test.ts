/**
 * ab-wave S2 (RULINGS R3.2, R4 L3): the lapse -> demotion rule through the REAL study-quiz path.
 *   - quiz-miss and flashcard cards carry the quest unit's competency (code-reading);
 *   - a lapse (Again on a Review-state card) demotes at most once per competency per local day,
 *     and never writes a demotion row at the rating floor (1);
 * The real grok-js quest pack on a one-quest campaign fixture (as test/api/study-quests.test.ts).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { State } from 'ts-fsrs';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAMPAIGN_FORMAT, type SeedQuizItem } from '@bootquest/shared';
import { GradeResponse, ReviewQueueResponse, SubmitResponse, UnitDetailResponse } from '@bootquest/shared/api';
import { createApp } from '../../src/api/app.ts';
import { defaultRunners } from '../../src/api/runners.ts';
import { DAY_MS, fixedClock } from '../../src/engines/clock.ts';
import { getRating } from '../../src/engines/evidence.ts';
import { deserializeCard, getReviewItem } from '../../src/engines/fsrs.ts';
import { loadCampaignIntoDb, readCampaign } from '../../src/store/campaign.ts';
import { loadSeedItemStore, type SeedItemStore } from '../../src/store/seed-items.ts';
import { loadStudyQuestsIntoDb } from '../../src/store/study-quests.ts';
import { defaultFixtureTracks, quest, writeCampaignFixture } from '../campaign-fixture.ts';
import { graduate, localNoon, makeTempDb, promoteTo, type TempDb } from '../helpers.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const PACK = join(REPO, 'content', 'seed', 'quests', 'grok-js');

let store: SeedItemStore;
beforeAll(() => {
  store = loadSeedItemStore([PACK]);
}, 120_000);

const quizzes = (): SeedQuizItem[] =>
  (JSON.parse(readFileSync(join(PACK, 'items.json'), 'utf8')) as { items: { kind: string }[] }).items.filter((i) => i.kind === 'quiz') as SeedQuizItem[];
/** the right answers (stored frame) with the first `wrong` flipped to another choice */
const withWrong = (wrong: number) => quizzes().map((q, i) => (i < wrong ? ((q.check.answerKey as number) + 1) % q.choices.length : (q.check.answerKey as number)));

interface Ctx {
  tmp: TempDb;
  clock: ReturnType<typeof fixedClock>;
  app: Express;
  unitId: number;
}

function useLapseApi(): Ctx {
  const ctx = {} as Ctx;
  beforeEach(() => {
    ctx.tmp = makeTempDb();
    ctx.clock = fixedClock(localNoon(2026, 10, 1));
    const t = defaultFixtureTracks();
    t.js = {
      format: CAMPAIGN_FORMAT,
      track: 'js',
      acts: [{ actNo: 1, title: 'Act 1', theme: 'theme 1', unlockPct: 0.8, unlockLevel: 1, locked: false, quests: [quest('js', 'grok-js', 'study-quest', 1)] }],
    };
    loadCampaignIntoDb(ctx.tmp.db, readCampaign(writeCampaignFixture(join(ctx.tmp.dir, 'campaign'), t)), ctx.clock);
    loadStudyQuestsIntoDb(ctx.tmp.db, store, ctx.clock);
    ctx.app = createApp({ db: ctx.tmp.db, clock: ctx.clock, runners: defaultRunners(), seedItems: store });
    ctx.unitId = ctx.tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', 'campaign/js/grok-js')!.id;
  });
  afterEach(() => ctx.tmp.cleanup());
  return ctx;
}

/** answers translated into the unit's SERVED choice order (ui-audit #24), as a learner sends them */
async function served(ctx: Ctx, stored: readonly number[]): Promise<number[]> {
  const d = UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${ctx.unitId}`)).body);
  const byKey = new Map(quizzes().map((q) => [q.key, q]));
  return d.studyQuest!.questions.map((q, i) => {
    const item = byKey.get(q.itemKey)!;
    const text = (item.check.choices ?? item.choices.map((c) => c.text))[stored[i]!]!;
    const at = q.choices.indexOf(text);
    if (at === -1) throw new Error(`${q.itemKey}: stored choice ${stored[i]} not served`);
    return at;
  });
}
const submitQuiz = async (ctx: Ctx, wrong: number) =>
  SubmitResponse.parse((await request(ctx.app).post(`/api/units/${ctx.unitId}/submit`).send({ answers: await served(ctx, withWrong(wrong)) })).body);
const grade = async (ctx: Ctx, itemId: number, g: 'again' | 'good') => {
  const res = await request(ctx.app).post(`/api/reviews/${itemId}/grade`).send({ grade: g });
  expect(res.status).toBe(200);
  return GradeResponse.parse(res.body);
};
const cardId = (ctx: Ctx, i: number) => ctx.tmp.db.get<{ id: number }>('SELECT id FROM review_item WHERE card_key = ?', `quiz-miss:${quizzes()[i]!.key}`)!.id;
const count = (ctx: Ctx, sql: string) => ctx.tmp.db.get<{ n: number }>(sql)!.n;
const demotionRows = (ctx: Ctx) => count(ctx, `SELECT COUNT(*) AS n FROM evidence WHERE kind = 'demotion' AND competency_id = 'code-reading'`);
const reviewRows = (ctx: Ctx) => count(ctx, `SELECT COUNT(*) AS n FROM evidence WHERE kind = 'review'`);
const stateOf = (ctx: Ctx, id: number) => deserializeCard(getReviewItem(ctx.tmp.db, id).fsrs_state);

describe('study-quiz cards carry the quest competency; a lapse demotes once per competency per day', { timeout: 60_000 }, () => {
  const ctx = useLapseApi();

  it('quiz miss -> card (code-reading) -> due -> Again: one demotion; a 2nd lapse that day: none; the next day: one; at rating 1: no row', async () => {
    promoteTo(ctx.tmp.db, ctx.clock, 'code-reading', 3);
    expect(getRating(ctx.tmp.db, 'code-reading')).toBe(3);
    const fail = await submitQuiz(ctx, 3);
    expect(fail.verdict).toBe('fail');
    expect(fail.studyQuiz!.reviewCards).toMatchObject({ created: 3, alreadyQueued: 0 });
    const ids = [0, 1, 2].map((i) => cardId(ctx, i));
    for (const id of ids) expect(getReviewItem(ctx.tmp.db, id).competency_id).toBe('code-reading');

    // learn all three into FSRS Review state (Good at each due), then stand where all are due
    for (const id of ids) graduate(ctx.tmp.db, ctx.clock, id);
    ctx.clock.set(Math.max(...ids.map((id) => getReviewItem(ctx.tmp.db, id).due_at)));
    for (const id of ids) expect(stateOf(ctx, id).state).toBe(State.Review);
    const q = ReviewQueueResponse.parse((await request(ctx.app).get('/api/reviews/queue')).body);
    expect(q.items.filter((i) => ids.includes(i.id)).map((i) => i.competencyId)).toEqual(['code-reading', 'code-reading', 'code-reading']);

    // day 1: the first lapse demotes 3 -> 2
    const first = await grade(ctx, ids[0]!, 'again');
    expect(first.demotion).toMatchObject({ competency: 'code-reading', from: 3, to: 2 });
    expect(demotionRows(ctx)).toBe(1);
    // ... a second lapse the same local day is capped: an ordinary review (log, evidence, XP), no demotion
    const reviewsBefore = reviewRows(ctx);
    ctx.clock.advance(60 * 60 * 1000);
    const second = await grade(ctx, ids[1]!, 'again');
    expect(second.demotion).toBeNull();
    expect(second.xp.amount).toBe(1);
    expect(getRating(ctx.tmp.db, 'code-reading')).toBe(2);
    expect(demotionRows(ctx)).toBe(1);
    expect(reviewRows(ctx)).toBe(reviewsBefore + 1);
    const log = ctx.tmp.db.get<{ rating: string; d: number | null }>(
      'SELECT rating, demotion_evidence_id AS d FROM review_log WHERE review_item_id = ? ORDER BY id DESC LIMIT 1',
      ids[1]!,
    )!;
    expect(log).toEqual({ rating: 'again', d: null });
    expect(stateOf(ctx, ids[1]!).state).toBe(State.Relearning); // FSRS rescheduled as usual

    // day 2: the next lapse demotes again, 2 -> 1
    ctx.clock.advance(DAY_MS);
    const third = await grade(ctx, ids[2]!, 'again');
    expect(third.demotion).toMatchObject({ competency: 'code-reading', from: 2, to: 1 });
    expect(demotionRows(ctx)).toBe(2);

    // at the floor: re-learn card 0 into Review state (a later day) and lapse it: no row, rating stays 1
    graduate(ctx.tmp.db, ctx.clock, ids[0]!);
    expect(stateOf(ctx, ids[0]!).state).toBe(State.Review);
    ctx.clock.advance(DAY_MS); // a later day than the last demotion: only the floor can stop it
    const floor = await grade(ctx, ids[0]!, 'again');
    expect(floor.demotion).toBeNull();
    expect(getRating(ctx.tmp.db, 'code-reading')).toBe(1);
    expect(demotionRows(ctx)).toBe(2);
  });

  it('a lapse on a rating-1 competency (every competency on day one) writes no demotion row, only review evidence', async () => {
    expect(getRating(ctx.tmp.db, 'code-reading')).toBe(1);
    await submitQuiz(ctx, 1);
    const id = cardId(ctx, 0);
    graduate(ctx.tmp.db, ctx.clock, id);
    const reviewsBefore = reviewRows(ctx);
    const g = await grade(ctx, id, 'again');
    expect(g.demotion).toBeNull();
    expect(demotionRows(ctx)).toBe(0);
    expect(reviewRows(ctx)).toBe(reviewsBefore + 1);
  });

  it('flashcards enrolled on the first pass carry the competency too', async () => {
    const pass = await submitQuiz(ctx, 2); // 12/14 = 85.7%
    expect(pass.verdict).toBe('pass');
    expect(pass.studyQuiz!.flashcardsEnrolled).toBeGreaterThan(0);
    const rows = ctx.tmp.db.all<{ kind: string; c: string | null }>('SELECT kind, competency_id AS c FROM review_item ORDER BY id');
    expect(rows).toHaveLength(2 + pass.studyQuiz!.flashcardsEnrolled);
    expect(rows.filter((r) => r.kind === 'card')).toHaveLength(pass.studyQuiz!.flashcardsEnrolled);
    for (const r of rows) expect(r.c).toBe('code-reading');
  });
});
