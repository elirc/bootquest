/**
 * rv B (REVIEW Q3, Wave 1b rows 1 + 6; R4-01/02/06/08/09/14/15/16, R1-round2, R4-round2): quiz gates as
 * EVIDENCE vs PRACTICE.
 *   - a failed gate returns the score and what to re-read: no per-question marks, no question numbers;
 *   - a server retry budget: the 3rd graded try within 24 h is 409 NOT_DUE and records nothing;
 *   - GET /units/:id/gate-status: this unit's try number (not the global attempt id) and the re-read sections;
 *   - a retake once a key of the gate was released (a pass, a shown miss card) is recorded prior-key;
 *   - an assisted gate pass earns half XP; a quick check passed after a failed first try earns 0 XP;
 *   - practice grades and explains every item and records nothing but its timestamp; a graded try of that unit
 *     is refused for 2 days after the latest practice;
 *   - quiz-miss card fronts carry the choices; review XP is paid once per card per day.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SubmitResponse, UnitDetailResponse } from '@bootquest/shared/api';
import { GateStatusResponse, PracticeResponse } from '@bootquest/shared/api-ext';
import { FundamentalsFile, fundTopicUnitKey } from '@bootquest/shared/fundamentals';
import { createApp } from '../../src/api/app.ts';
import { entriesContentStore } from '../../src/api/content-store.ts';
import { studyKeyReleased } from '../../src/api/practice-service.ts';
import { reviewCardText, withChoices } from '../../src/api/study-service.ts';
import { defaultRunners } from '../../src/api/runners.ts';
import { recordSubmission } from '../../src/engines/attempts.ts';
import { DAY_MS, fixedClock, nowMs } from '../../src/engines/clock.ts';
import { review } from '../../src/engines/fsrs.ts';
import { queueQuizMisses } from '../../src/engines/study-quest.ts';
import { awardXp } from '../../src/engines/xp.ts';
import { fundContentEntries, loadFundamentalsIntoDb, mapFundStore, type FundStore } from '../../src/store/fundamentals.ts';
import { emptySeedItemStore, withFundamentals } from '../../src/store/seed-items.ts';
import { FAIL, localNoon, makeTempDb, makeUnit, PASS, type TempDb } from '../helpers.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const realFile = (track: string): FundamentalsFile =>
  FundamentalsFile.parse(JSON.parse(readFileSync(join(REPO, 'content', 'fundamentals', track, 'topics.json'), 'utf8')));

const JAVA = realFile('java');
const T0 = JAVA.topics[0]!;
/** a lesson-aids gate map: questions 1 and 3 -> heading A, question 2 -> heading B, the rest unmapped */
const SECTIONS = new Map([['java', new Map([[T0.id, { gate: { '1': 'Heading A', '2': 'Heading B', '3': 'Heading A' }, checks: [] }]])]]);

describe('rv B quiz gates over HTTP', () => {
  let tmp: TempDb;
  let clock: ReturnType<typeof fixedClock>;
  let app: Express;
  let store: FundStore;

  beforeEach(() => {
    tmp = makeTempDb();
    clock = fixedClock(localNoon(2026, 11, 12));
    store = mapFundStore([JAVA], new Map(), SECTIONS as never);
    loadFundamentalsIntoDb(tmp.db, store, clock);
    app = createApp({ db: tmp.db, clock, runners: defaultRunners(), seedItems: withFundamentals(emptySeedItemStore, store), content: entriesContentStore(fundContentEntries(store)) });
  }, 60_000);
  afterEach(() => tmp.cleanup());

  const gate = () => tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', fundTopicUnitKey('java', T0.id))!.id;
  /** served answers with the first `wrong` questions answered wrong */
  async function served(unitId: number, wrong = 0): Promise<number[]> {
    const d = UnitDetailResponse.parse((await request(app).get(`/api/units/${unitId}`)).body);
    return d.studyQuest!.questions.map((q, i) => {
      const item = T0.quiz.find((x) => x.key === q.itemKey)!;
      const right = q.choices.indexOf(item.choices[item.answer]!);
      return i < wrong ? (right + 1) % q.choices.length : right;
    });
  }
  const post = async (unitId: number, body: object) => request(app).post(`/api/units/${unitId}/submit`).send(body);
  const status = async (unitId: number) => GateStatusResponse.parse((await request(app).get(`/api/units/${unitId}/gate-status`)).body);
  const count = (table: string) => tmp.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;

  it('a failed gate: score + re-read sections, no per-question marks and no question numbers anywhere', async () => {
    const u = gate();
    const res = await post(u, { answers: await served(u, 3) });
    expect(res.status, res.text).toBe(200);
    const fail = SubmitResponse.parse(res.body);
    expect(fail.verdict).toBe('fail');
    expect(fail.studyQuiz).toMatchObject({ correct: 7, total: 10, passed: false, items: [] });
    expect(fail.result.failures).toHaveLength(1);
    expect(JSON.stringify(fail.result)).not.toMatch(/\bQ\d/);
    expect(fail.result.output).toContain('7/10 correct');
    expect(fail.result.output).toContain('re-read: Heading A · Heading B');
    // the try number is this unit's, not the global attempt id
    const s = await status(u);
    expect(s.lastTry).toEqual({ number: 1, passed: false, reread: ['Heading A', 'Heading B'] });
    expect(s).toMatchObject({ tries: 1, triesInWindow: 1, budget: 2, opensAt: null, reason: null, practiceable: true, passed: false });
    // the notes stay shut after a fail (nothing tells right from wrong)
    const notes = (await request(app).get(`/api/units/${u}/notes`)).body;
    expect(notes.explanations.released).toEqual([]);
  });

  it('a pass still marks every question; the try number counts this unit only', async () => {
    makeUnit(tmp.db, clock); // another unit's attempt ids would make a global id differ
    const u = gate();
    await post(u, { answers: await served(u, 4) });
    const pass = SubmitResponse.parse((await post(u, { answers: await served(u) })).body);
    expect(pass.verdict).toBe('pass');
    expect(pass.studyQuiz!.items).toHaveLength(10);
    expect((await status(u)).lastTry).toEqual({ number: 2, passed: true, reread: [] });
  });

  it('retry budget: the 3rd graded try within 24 h is 409 NOT_DUE and records nothing; it reopens when the oldest ages out', async () => {
    const u = gate();
    const t0 = nowMs(clock);
    expect((await post(u, { answers: await served(u, 5) })).status).toBe(200); // first fail: no cooldown
    clock.advance(60_000);
    expect((await post(u, { answers: await served(u, 5) })).status).toBe(200);
    const before = { attempt: count('attempt'), run: count('run'), review: count('review_item') };
    clock.advance(60_000);
    const third = await post(u, { answers: await served(u) });
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('NOT_DUE');
    expect(third.body.error.message).toMatch(/2 graded tries per 24 hours/);
    expect({ attempt: count('attempt'), run: count('run'), review: count('review_item') }).toEqual(before);
    const s = await status(u);
    expect(s).toMatchObject({ triesInWindow: 2, reason: 'budget', opensAt: t0 + DAY_MS });
    clock.set(new Date(t0 + DAY_MS + 1));
    expect((await post(u, { answers: await served(u) })).status).toBe(200);
  });

  it('an assisted gate pass ("Show lesson" / "I had help") earns half XP and still completes the gate', async () => {
    const u = gate();
    const pass = SubmitResponse.parse((await post(u, { answers: await served(u), selfAssisted: true })).body);
    expect(pass).toMatchObject({ verdict: 'pass', attempt: { mode: 'assisted' }, xp: { amount: 25, reason: null } });
    expect((await status(u)).passed).toBe(true);
  });

  it('a retake after a pass is recorded prior-key (the pass panel showed every key) and pays nothing', async () => {
    const u = gate();
    expect(SubmitResponse.parse((await post(u, { answers: await served(u) })).body).attempt.mode).toBe('solo');
    clock.advance(DAY_MS + 1);
    const again = SubmitResponse.parse((await post(u, { answers: await served(u) })).body);
    expect(again.attempt.mode).toBe('assisted');
    expect(tmp.db.get<{ s: string }>('SELECT assistance_source AS s FROM attempt WHERE id = ?', again.attempt.id)!.s).toBe('prior-key');
    expect(again.xp).toMatchObject({ amount: 0, reason: 'already-awarded' });
  });

  it('practice: per-item verdicts + keyed answers + explanations, nothing recorded but the timestamp; the graded try waits 2 days', async () => {
    const u = gate();
    const tables = ['attempt', 'run', 'xp_event', 'evidence', 'review_item', 'review_log', 'hint_taken'];
    const before = tables.map(count);
    const res = await request(app).post(`/api/units/${u}/practice`).send({ answers: await served(u, 2) });
    expect(res.status, res.text).toBe(200);
    const p = PracticeResponse.parse(res.body);
    expect(p).toMatchObject({ correct: 8, total: 10, wouldPass: true, passPct: 80, gradedOpensAt: nowMs(clock) + 2 * DAY_MS });
    expect(p.items.map((i) => i.correct)).toEqual([false, false, true, true, true, true, true, true, true, true]);
    const q0 = T0.quiz.find((q) => q.key === p.items[0]!.itemKey)!;
    expect(p.items[0]).toMatchObject({ answer: q0.choices[q0.answer], explanation: q0.explanation });
    expect(tables.map(count)).toEqual(before);
    expect(count('practice_log')).toBe(1);
    // no unlock, no completion: the next topic would still be locked, the gate is not done
    expect(UnitDetailResponse.parse((await request(app).get(`/api/units/${u}`)).body).unit.state).toBe('available');
    // the graded try is refused for 2 days after the latest practice, and records nothing
    const graded = await post(u, { answers: await served(u) });
    expect(graded.status).toBe(409);
    expect(graded.body.error.code).toBe('NOT_DUE');
    expect(graded.body.error.message).toMatch(/practised/);
    expect(count('attempt')).toBe(0);
    expect(await status(u)).toMatchObject({ reason: 'practice', opensAt: p.gradedOpensAt, lastPracticeAt: nowMs(clock) });
    clock.advance(2 * DAY_MS + 1);
    expect(SubmitResponse.parse((await post(u, { answers: await served(u) })).body).verdict).toBe('pass');
    // practice_log is append-only
    expect(() => tmp.db.run('UPDATE practice_log SET correct = 10')).toThrow(/append-only/);
    expect(() => tmp.db.run('DELETE FROM practice_log')).toThrow(/append-only/);
  });

  it('practice refuses units without a practice mode and malformed bodies', async () => {
    const drill = makeUnit(tmp.db, clock);
    const r = await request(app).post(`/api/units/${drill}/practice`).send({ answer: 0 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('WRONG_UNIT_KIND');
    const u = gate();
    expect((await request(app).post(`/api/units/${u}/practice`).send({})).status).toBe(400);
    expect((await request(app).post(`/api/units/${u}/practice`).send({ answer: 1 })).status).toBe(400);
    expect((await request(app).post(`/api/units/${u}/practice`).send({ answers: [0] })).status).toBe(400);
    expect(count('practice_log')).toBe(0);
  });

  it('quick-check practice returns the keyed answer; the graded check then waits 2 days', async () => {
    const quiz = makeUnit(tmp.db, clock, { kind: 'quiz' });
    const p = PracticeResponse.parse((await request(app).post(`/api/units/${quiz}/practice`).send({ answer: 0 })).body);
    expect(p.total).toBe(1);
    expect(p.items[0]!.answer).toBe('a');
    const g = await post(quiz, { answer: 0 });
    expect(g.status).toBe(409);
    expect(g.body.error.code).toBe('NOT_DUE');
  });

  it('a quiz-miss card front lists the choices', () => {
    const q = T0.quiz[0]!;
    const text = reviewCardText(withFundamentals(emptySeedItemStore, store), `quiz-miss:${q.key}`)!;
    expect(text.front).toBe(withChoices(q.prompt, q.choices));
    for (const c of q.choices) expect(text.front).toContain(c);
    expect(text.front.startsWith(q.prompt)).toBe(true);
  });
});

describe('rv B engine rules', () => {
  let tmp: TempDb;
  const clock = fixedClock(localNoon(2026, 11, 12));
  beforeEach(() => {
    tmp = makeTempDb();
  }, 60_000);
  afterEach(() => tmp.cleanup());
  const checkOf = (u: number) => tmp.db.get<{ id: number }>('SELECT id FROM "check" WHERE unit_id = ?', u)!.id;

  it('R4-09: a quick check passed after a failed first try earns 0 XP (no zero reason), and is still a pass', () => {
    const u = makeUnit(tmp.db, clock, { kind: 'quiz' });
    recordSubmission(tmp.db, { unitId: u, checkId: checkOf(u), result: FAIL }, clock);
    const pass = recordSubmission(tmp.db, { unitId: u, checkId: checkOf(u), result: PASS }, clock).attempt;
    const xp = awardXp(tmp.db, { kind: 'quiz', attemptId: pass.id }, clock);
    expect(xp).toMatchObject({ amount: 0, reason: null, note: 'first-try-missed' });
    // a first-try pass pays as before
    const v = makeUnit(tmp.db, clock, { kind: 'predict-output' });
    const first = recordSubmission(tmp.db, { unitId: v, checkId: checkOf(v), result: PASS }, clock).attempt;
    expect(awardXp(tmp.db, { kind: 'predict', attemptId: first.id }, clock)).toMatchObject({ amount: 4, reason: null });
    // a code drill keeps paying after a failed submit (failing first is how drills are worked)
    const d = makeUnit(tmp.db, clock);
    recordSubmission(tmp.db, { unitId: d, checkId: checkOf(d), result: FAIL }, clock);
    const dp = recordSubmission(tmp.db, { unitId: d, checkId: checkOf(d), result: PASS }, clock).attempt;
    expect(awardXp(tmp.db, { kind: 'code', attemptId: dp.id }, clock).amount).toBe(20);
  });

  it('R4-14: review XP is paid for a card\'s first grade of the day only (Again-farming pays nothing)', () => {
    const u = makeUnit(tmp.db, clock, { kind: 'study' });
    queueQuizMisses(tmp.db, u, ['k1'], clock);
    const card = tmp.db.get<{ id: number }>('SELECT id FROM review_item')!.id;
    clock.advance(DAY_MS + 1);
    const first = review(tmp.db, card, 'again', clock);
    expect(first.xp.amount).toBe(1);
    // Again re-dues a learning card within minutes; grading it again the same day pays nothing
    for (let i = 0; i < 3; i++) {
      clock.advance(15 * 60_000);
      const again = review(tmp.db, card, 'again', clock);
      expect(again.xp).toMatchObject({ amount: 0, reason: 'already-awarded' });
    }
    expect(tmp.db.get<{ s: number }>("SELECT SUM(amount) AS s FROM xp_event WHERE kind = 'review'")!.s).toBe(1);
  });

  it('R4-01b: a campaign study-quiz key counts as released once its miss card is due or reviewed', () => {
    const u = makeUnit(tmp.db, clock, { kind: 'study' });
    expect(studyKeyReleased(tmp.db, u, ['k1', 'k2'], nowMs(clock))).toBe(false);
    queueQuizMisses(tmp.db, u, ['k1'], clock);
    expect(studyKeyReleased(tmp.db, u, ['k1', 'k2'], nowMs(clock))).toBe(false); // queued, due tomorrow
    expect(studyKeyReleased(tmp.db, u, ['k1', 'k2'], nowMs(clock) + DAY_MS + 1)).toBe(true); // shown once due
    // a Fundamentals miss card is held until the pass: only the pass releases its key
    expect(studyKeyReleased(tmp.db, u, ['fund:java/x/q01'], nowMs(clock) + 5 * DAY_MS)).toBe(false);
  });
});
