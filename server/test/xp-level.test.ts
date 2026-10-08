import { describe, expect, it } from 'vitest';
import { revealSolution, recordAttempt } from '../src/engines/attempts.ts';
import { DAY_MS } from '../src/engines/clock.ts';
import { levelForXp, levelProgress, xpToReach } from '../src/engines/level.ts';
import { awardXp, baseAmount, REVIEW_DAILY_CAP, totalXp, XP_AMOUNTS, xpOnDay } from '../src/engines/xp.ts';
import { makeUnit, useTempDb } from './helpers.ts';

describe('XP amounts (spec §6.1)', () => {
  const ctx = useTempDb();

  it('pays code 10 x difficulty for every difficulty 1..5', () => {
    for (const d of [1, 2, 3, 4, 5]) {
      const unitId = makeUnit(ctx.db, ctx.clock, { difficulty: d });
      expect(awardXp(ctx.db, { kind: 'code', difficulty: d, unitId }, ctx.clock).amount).toBe(10 * d);
    }
    expect(totalXp(ctx.db)).toBe(150);
  });

  it('pays the fixed per-type amounts', () => {
    const expected = {
      quiz: 2,
      predict: 4,
      'study-quest': 50,
      reading: 5,
      'explain-back': 20,
      'patch-kata': 15,
      review: 1,
    } as const;
    for (const [kind, amount] of Object.entries(expected)) {
      const unitId = makeUnit(ctx.db, ctx.clock);
      const award = awardXp(ctx.db, { kind: kind as keyof typeof expected, unitId }, ctx.clock);
      expect(award, kind).toMatchObject({ amount, reason: null });
      expect(XP_AMOUNTS[kind as keyof typeof expected]).toBe(amount);
    }
    expect(() => baseAmount('code')).toThrow();
    expect(() => awardXp(ctx.db, { kind: 'code' }, ctx.clock)).toThrow(); // zod: difficulty required
  });

  it('caps FSRS review XP at 30 per local day, resetting the next day', () => {
    const awards = Array.from({ length: 35 }, () => awardXp(ctx.db, { kind: 'review' }, ctx.clock));
    expect(awards.filter((a) => a.amount === 1)).toHaveLength(REVIEW_DAILY_CAP);
    expect(awards.slice(30).every((a) => a.amount === 0 && a.reason === 'daily-cap')).toBe(true);
    expect(xpOnDay(ctx.db, awards[0]!.day, 'review')).toBe(30);
    // other kinds are not capped by the review cap
    expect(awardXp(ctx.db, { kind: 'quiz' }, ctx.clock).amount).toBe(2);

    ctx.clock.advance(DAY_MS);
    expect(awardXp(ctx.db, { kind: 'review' }, ctx.clock)).toMatchObject({ amount: 1, reason: null });
  });

  it('reveal-solution zeroes XP forever on that exercise and flags later attempts guided', () => {
    const unitId = makeUnit(ctx.db, ctx.clock, { difficulty: 3 });
    const { attempt } = revealSolution(ctx.db, unitId, ctx.clock);
    expect(attempt).toMatchObject({ mode: 'guided', assisted: true, assistance_source: 'reveal', outcome: 'revealed' });

    for (let i = 0; i < 3; i++) {
      ctx.clock.advance(30 * DAY_MS); // "forever": months later still zero
      const later = recordAttempt(ctx.db, { unitId, outcome: 'pass' }, ctx.clock);
      expect(later.mode).toBe('guided');
      const award = awardXp(ctx.db, { kind: 'code', difficulty: 3, unitId, attemptId: later.id }, ctx.clock);
      expect(award).toMatchObject({ amount: 0, reason: 'revealed' });
    }
    // XP resolved via the attempt alone is also zeroed
    const viaAttempt = recordAttempt(ctx.db, { unitId, outcome: 'pass' }, ctx.clock);
    expect(awardXp(ctx.db, { kind: 'code', difficulty: 3, attemptId: viaAttempt.id }, ctx.clock).amount).toBe(0);
    expect(totalXp(ctx.db)).toBe(0);
  });

  it('a reveal on one exercise does not zero another', () => {
    const a = makeUnit(ctx.db, ctx.clock);
    const b = makeUnit(ctx.db, ctx.clock);
    revealSolution(ctx.db, a, ctx.clock);
    expect(awardXp(ctx.db, { kind: 'code', difficulty: 2, unitId: b }, ctx.clock).amount).toBe(20);
  });

  it('pays once per unit per kind (re-submits record a zero row)', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    expect(awardXp(ctx.db, { kind: 'code', difficulty: 2, unitId }, ctx.clock).amount).toBe(20);
    expect(awardXp(ctx.db, { kind: 'code', difficulty: 2, unitId }, ctx.clock)).toMatchObject({ amount: 0, reason: 'already-awarded' });
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM xp_event')!.n).toBe(2);
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
