import { describe, expect, it } from 'vitest';
import { CHECK_TYPES } from '@bootquest/shared';
import { recordAttempt, revealSolution, selfAttestReading } from '../src/engines/attempts.ts';
import { DAY_MS } from '../src/engines/clock.ts';
import { recordEvidence } from '../src/engines/evidence.ts';
import { addReviewItem, review } from '../src/engines/fsrs.ts';
import { levelForXp, levelProgress, xpToReach } from '../src/engines/level.ts';
import { awardXp, baseAmount, REVIEW_DAILY_CAP, totalXp, XP_AMOUNTS, xpKindForCheck, xpOnDay } from '../src/engines/xp.ts';
import { explainBack, makeUnit, submit, useTempDb } from './helpers.ts';

describe('XP amounts (spec §6.1), each paid only for a verified attempt', () => {
  const ctx = useTempDb();

  it('pays code 10 x the UNIT ROW difficulty for every difficulty 1..5', () => {
    for (const d of [1, 2, 3, 4, 5]) {
      const unitId = makeUnit(ctx.db, ctx.clock, { difficulty: d });
      const a = submit(ctx.db, ctx.clock, unitId);
      expect(awardXp(ctx.db, { kind: 'code', attemptId: a.id }, ctx.clock).amount).toBe(10 * d);
    }
    expect(totalXp(ctx.db)).toBe(150);
  });

  it('pays the fixed per-type amounts', () => {
    const quiz = submit(ctx.db, ctx.clock, makeUnit(ctx.db, ctx.clock, { kind: 'quiz' }));
    expect(awardXp(ctx.db, { kind: 'quiz', attemptId: quiz.id }, ctx.clock)).toMatchObject({ amount: 2, reason: null });
    const predict = submit(ctx.db, ctx.clock, makeUnit(ctx.db, ctx.clock, { kind: 'predict-output' }));
    expect(awardXp(ctx.db, { kind: 'predict', attemptId: predict.id }, ctx.clock).amount).toBe(4);
    const study = submit(ctx.db, ctx.clock, makeUnit(ctx.db, ctx.clock, { kind: 'study' }));
    expect(awardXp(ctx.db, { kind: 'study-quest', attemptId: study.id }, ctx.clock).amount).toBe(50);
    const reading = selfAttestReading(ctx.db, makeUnit(ctx.db, ctx.clock, { kind: 'reading' }), ctx.clock);
    expect(awardXp(ctx.db, { kind: 'reading', attemptId: reading.id }, ctx.clock).amount).toBe(5);
    const ebUnit = makeUnit(ctx.db, ctx.clock, { kind: 'explain-back', competencies: ['communication'] });
    const eb = explainBack(ctx.db, ctx.clock, ebUnit, 'communication', 0.9);
    expect(awardXp(ctx.db, { kind: 'explain-back', attemptId: eb.attempt.id }, ctx.clock).amount).toBe(20);
    const kataUnit = makeUnit(ctx.db, ctx.clock, { kind: 'patch-kata', competencies: ['code-reading'] });
    const kata = recordAttempt(ctx.db, { unitId: kataUnit, answer: { findings: [] } }, ctx.clock);
    recordEvidence(ctx.db, { competency: 'code-reading', kind: 'kata', intention: 'i', observation: 'o', score: 0.5, attemptId: kata.id }, ctx.clock);
    expect(awardXp(ctx.db, { kind: 'patch-kata', attemptId: kata.id }, ctx.clock).amount).toBe(15);
    const card = addReviewItem(ctx.db, { cardKey: 'c' }, ctx.clock);
    expect(review(ctx.db, card.id, 'good', ctx.clock).xp.amount).toBe(1);
    expect(XP_AMOUNTS).toMatchObject({ quiz: 2, predict: 4, 'study-quest': 50, reading: 5, 'explain-back': 20, 'patch-kata': 15, review: 1 });
    expect(() => baseAmount('code')).toThrow();
  });

  it('every check type has an explicit XP kind (exhaustive mapping)', () => {
    const map = Object.fromEntries(CHECK_TYPES.map((t) => [t, xpKindForCheck(t)]));
    expect(map).toEqual({
      'drill-js': 'code',
      'drill-cs': 'code',
      quiz: 'quiz',
      'predict-output': 'predict',
      'guided-step': 'code',
      http: 'code',
      repo: 'code',
      'study-quiz': 'study-quest',
      'explain-back': 'explain-back',
      'patch-kata': 'patch-kata',
      review: null,
      'node-test-file': 'code',
      'self-run': 'code',
      'vitest-project': 'code',
    });
  });

  it('caps FSRS review XP at 30 per local day, resetting the next day', () => {
    const cards = Array.from({ length: 36 }, (_, i) => addReviewItem(ctx.db, { cardKey: `cap:${i}` }, ctx.clock));
    const awards = cards.slice(0, 35).map((c) => review(ctx.db, c.id, 'good', ctx.clock).xp);
    expect(awards.filter((a) => a.amount === 1)).toHaveLength(REVIEW_DAILY_CAP);
    expect(awards.slice(30).every((a) => a.amount === 0 && a.reason === 'daily-cap')).toBe(true);
    expect(xpOnDay(ctx.db, awards[0]!.day, 'review')).toBe(30);
    // other kinds are not capped by the review cap
    const quiz = submit(ctx.db, ctx.clock, makeUnit(ctx.db, ctx.clock, { kind: 'quiz' }));
    expect(awardXp(ctx.db, { kind: 'quiz', attemptId: quiz.id }, ctx.clock).amount).toBe(2);

    ctx.clock.advance(DAY_MS);
    expect(review(ctx.db, cards[35]!.id, 'good', ctx.clock).xp).toMatchObject({ amount: 1, reason: null });
  });

  it('reveal-solution zeroes XP forever on that exercise and flags later attempts guided', () => {
    const unitId = makeUnit(ctx.db, ctx.clock, { difficulty: 3 });
    const { attempt } = revealSolution(ctx.db, unitId, ctx.clock);
    expect(attempt).toMatchObject({ mode: 'guided', assisted: true, assistance_source: 'reveal', outcome: 'revealed' });
    for (let i = 0; i < 3; i++) {
      ctx.clock.advance(30 * DAY_MS); // "forever": months later still zero
      const later = submit(ctx.db, ctx.clock, unitId);
      expect(later.mode).toBe('guided');
      expect(awardXp(ctx.db, { kind: 'code', attemptId: later.id }, ctx.clock)).toMatchObject({ amount: 0, reason: 'revealed' });
    }
    expect(totalXp(ctx.db)).toBe(0);
  });

  it('a reveal on one exercise does not zero another', () => {
    const a = makeUnit(ctx.db, ctx.clock);
    const b = makeUnit(ctx.db, ctx.clock);
    revealSolution(ctx.db, a, ctx.clock);
    expect(awardXp(ctx.db, { kind: 'code', attemptId: submit(ctx.db, ctx.clock, b).id }, ctx.clock).amount).toBe(20);
  });

  it('pays once per unit per kind (re-submits record a zero row)', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    expect(awardXp(ctx.db, { kind: 'code', attemptId: submit(ctx.db, ctx.clock, unitId).id }, ctx.clock).amount).toBe(20);
    expect(awardXp(ctx.db, { kind: 'code', attemptId: submit(ctx.db, ctx.clock, unitId).id }, ctx.clock)).toMatchObject({
      amount: 0,
      reason: 'already-awarded',
    });
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM xp_event')!.n).toBe(2);
    // and the SQL index refuses a second paying row even if the engine were bypassed
    expect(() =>
      ctx.db.run(`INSERT INTO xp_event (kind, amount, unit_id, day, created_at) VALUES ('code', 20, ?, '2026-10-01', 0)`, unitId),
    ).toThrow(/UNIQUE/);
  });
});

describe('XP cannot be farmed or claimed without verification (W1a audit #5)', () => {
  const ctx = useTempDb();

  it('no unit-less / attempt-less awards; no review kind through awardXp; no client difficulty', () => {
    expect(() => awardXp(ctx.db, { kind: 'explain-back' } as never, ctx.clock)).toThrow();
    expect(() => awardXp(ctx.db, { kind: 'study-quest' } as never, ctx.clock)).toThrow();
    const a = submit(ctx.db, ctx.clock, makeUnit(ctx.db, ctx.clock, { difficulty: 1 }));
    expect(() => awardXp(ctx.db, { kind: 'review', attemptId: a.id } as never, ctx.clock)).toThrow();
    expect(() => awardXp(ctx.db, { kind: 'code', attemptId: a.id, difficulty: 5 } as never, ctx.clock)).toThrow();
    expect(totalXp(ctx.db)).toBe(0);
  });

  it('a failed attempt earns nothing', () => {
    const a = submit(ctx.db, ctx.clock, makeUnit(ctx.db, ctx.clock), { pass: false });
    expect(() => awardXp(ctx.db, { kind: 'code', attemptId: a.id }, ctx.clock)).toThrow(/not a verified pass/);
  });

  it('the kind must match the check: a quiz pass cannot claim study-quest or code XP', () => {
    const a = submit(ctx.db, ctx.clock, makeUnit(ctx.db, ctx.clock, { kind: 'quiz' }));
    expect(() => awardXp(ctx.db, { kind: 'study-quest', attemptId: a.id }, ctx.clock)).toThrow(/does not earn/);
    expect(() => awardXp(ctx.db, { kind: 'code', attemptId: a.id }, ctx.clock)).toThrow(/does not earn/);
  });

  it('unitId must agree with the attempt (no paying a revealed unit via another unit id)', () => {
    const revealed = makeUnit(ctx.db, ctx.clock);
    revealSolution(ctx.db, revealed, ctx.clock);
    const guided = submit(ctx.db, ctx.clock, revealed);
    const other = makeUnit(ctx.db, ctx.clock);
    expect(() => awardXp(ctx.db, { kind: 'code', attemptId: guided.id, unitId: other }, ctx.clock)).toThrow(/not \d+/);
  });

  it('explain-back XP needs >= 80% self-scored coverage on the stored answer', () => {
    const unit = makeUnit(ctx.db, ctx.clock, { kind: 'explain-back', competencies: ['communication'] });
    const low = explainBack(ctx.db, ctx.clock, unit, 'communication', 0.5);
    expect(() => awardXp(ctx.db, { kind: 'explain-back', attemptId: low.attempt.id }, ctx.clock)).toThrow(/completed explain-back/);
    const bare = recordAttempt(ctx.db, { unitId: unit, answer: { q: 'a' } }, ctx.clock);
    expect(() => awardXp(ctx.db, { kind: 'explain-back', attemptId: bare.id }, ctx.clock)).toThrow();
  });

  it('reading XP only for a reading self-attest, once per unit', () => {
    const drill = makeUnit(ctx.db, ctx.clock);
    expect(() => selfAttestReading(ctx.db, drill, ctx.clock)).toThrow(/only valid on reading units/);
    const a = submit(ctx.db, ctx.clock, drill);
    expect(() => awardXp(ctx.db, { kind: 'reading', attemptId: a.id }, ctx.clock)).toThrow(/does not earn/);
    const reading = makeUnit(ctx.db, ctx.clock, { kind: 'reading' });
    const att = selfAttestReading(ctx.db, reading, ctx.clock);
    expect(att).toMatchObject({ mode: 'solo', outcome: 'pass', check_id: null });
    expect(() => selfAttestReading(ctx.db, reading, ctx.clock)).toThrow(/already/);
    expect(awardXp(ctx.db, { kind: 'reading', attemptId: att.id }, ctx.clock).amount).toBe(5);
    expect(awardXp(ctx.db, { kind: 'reading', attemptId: att.id }, ctx.clock)).toMatchObject({ amount: 0, reason: 'already-awarded' });
  });
});

describe('level curve 150·n^1.6 (cumulative XP to reach level n+1 = floor(150·n^1.6))', () => {
  it('n=1: level 2 is reached at exactly 150 XP', () => {
    expect(xpToReach(1)).toBe(0);
    expect(xpToReach(2)).toBe(150);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(149)).toBe(1);
    expect(levelForXp(150)).toBe(2);
  });

  it('n=2: level 3 is reached at floor(150·2^1.6) = 454 XP', () => {
    expect(xpToReach(3)).toBe(454);
    expect(levelForXp(453)).toBe(2);
    expect(levelForXp(454)).toBe(3);
  });

  it('n=5: level 6 is reached at floor(150·5^1.6) = 1969 XP', () => {
    expect(xpToReach(6)).toBe(1969);
    expect(levelForXp(1968)).toBe(5);
    expect(levelForXp(1969)).toBe(6);
  });

  it('is strictly increasing with growing per-level cost, and reports progress', () => {
    let prevSpan = 0;
    for (let l = 1; l < 40; l++) {
      const span = xpToReach(l + 1) - xpToReach(l);
      expect(span).toBeGreaterThan(prevSpan);
      prevSpan = span;
    }
    expect(levelProgress(200)).toEqual({ level: 2, xp: 200, intoLevel: 50, levelSpan: 304, nextAt: 454 });
    expect(() => xpToReach(0)).toThrow(RangeError);
    expect(() => levelForXp(-1)).toThrow(RangeError);
  });
});
