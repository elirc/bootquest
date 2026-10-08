import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../src/engines/clock.ts';
import { addReviewItem } from '../src/engines/fsrs.ts';
import {
  closeElapsedDays,
  composeSlate,
  getSlate,
  markSlateItem,
  streakStatus,
  type SlateItem,
} from '../src/engines/streak.ts';
import { awardXp } from '../src/engines/xp.ts';
import { useTempDb } from './helpers.ts';
import type { Db } from '../src/db/database.ts';

function completeToday(db: Db, clock: () => Date) {
  const slate = composeSlate(db, clock);
  for (const item of slate.items) markSlateItem(db, item.slot as SlateItem['slot'], clock);
}

describe('daily slate composition', () => {
  const ctx = useTempDb();

  it('has one 5-drill set per active track + 1 campaign step + review clear', () => {
    const slate = composeSlate(ctx.db, ctx.clock);
    expect(slate.items.map((i) => i.slot)).toEqual(['drill:js', 'drill:csharp', 'campaign', 'review']);
    expect(slate.items.filter((i) => i.kind === 'drill-set').every((i) => 'size' in i && i.size === 5)).toBe(true);
    // java is locked and agentic has no drill bank: neither contributes a drill set
    expect(slate.items.some((i) => i.slot === 'drill:java' || i.slot === 'drill:agentic')).toBe(false);
    // compose is idempotent per day
    expect(composeSlate(ctx.db, ctx.clock).items).toEqual(slate.items);
  });

  it('review slot is only done when the due queue is actually empty', () => {
    addReviewItem(ctx.db, { cardKey: 'due-now' }, ctx.clock); // new cards are due immediately
    const slate = composeSlate(ctx.db, ctx.clock);
    expect(slate.items.find((i) => i.slot === 'review')!.done).toBe(false);
    expect(() => markSlateItem(ctx.db, 'review', ctx.clock)).toThrow(/not clear/);
  });
});

describe('streak engine', () => {
  const ctx = useTempDb();

  it('a completed slate-day earns a streak day', () => {
    completeToday(ctx.db, ctx.clock);
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 0, display: 1, todayComplete: true });
    ctx.clock.advance(DAY_MS);
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 1, display: 1, todayComplete: false, slateDaysBanked: 1 });
    expect(getSlate(ctx.db, '2026-10-01')!.status).toBe('slate');
  });

  it('an incomplete slate is not a slate-day', () => {
    composeSlate(ctx.db, ctx.clock);
    markSlateItem(ctx.db, 'campaign', ctx.clock);
    ctx.clock.advance(DAY_MS);
    expect(streakStatus(ctx.db, ctx.clock).current).toBe(0);
  });

  it('a 20+ XP day without the slate is partial: keeps the streak, no token credit', () => {
    completeToday(ctx.db, ctx.clock); // day 1 slate
    ctx.clock.advance(DAY_MS);
    awardXp(ctx.db, { kind: 'explain-back' }, ctx.clock); // day 2: exactly 20 XP, no slate
    ctx.clock.advance(DAY_MS);
    const s = streakStatus(ctx.db, ctx.clock);
    expect(s.current).toBe(1); // kept, not broken
    expect(s.slateDaysBanked).toBe(1); // partial day did not count toward the token
    expect(s.tokens).toBe(0);
    expect(getSlate(ctx.db, '2026-10-02')!.status).toBe('partial');
  });

  it('19 XP is not enough for a partial day (boundary) and breaks the streak', () => {
    completeToday(ctx.db, ctx.clock);
    ctx.clock.advance(DAY_MS);
    awardXp(ctx.db, { kind: 'patch-kata' }, ctx.clock); // 15
    awardXp(ctx.db, { kind: 'predict' }, ctx.clock); // +4 = 19
    ctx.clock.advance(DAY_MS);
    expect(streakStatus(ctx.db, ctx.clock).current).toBe(0);
    expect(getSlate(ctx.db, '2026-10-02')!.status).toBe('missed');
  });

  it('7 slate-days earn 1 freeze token; tokens cap at 2 banked', () => {
    for (let d = 0; d < 7; d++) {
      completeToday(ctx.db, ctx.clock);
      ctx.clock.advance(DAY_MS);
    }
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 7, tokens: 1, slateDaysBanked: 0 });
    for (let d = 0; d < 6; d++) {
      completeToday(ctx.db, ctx.clock);
      ctx.clock.advance(DAY_MS);
    }
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 13, tokens: 1, slateDaysBanked: 6 });
    completeToday(ctx.db, ctx.clock);
    ctx.clock.advance(DAY_MS);
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 14, tokens: 2 });
    for (let d = 0; d < 7; d++) {
      completeToday(ctx.db, ctx.clock);
      ctx.clock.advance(DAY_MS);
    }
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 21, tokens: 2, longest: 21 });
  });

  it('a gap day auto-spends a banked token and keeps the streak', () => {
    for (let d = 0; d < 7; d++) {
      completeToday(ctx.db, ctx.clock);
      ctx.clock.advance(DAY_MS);
    }
    expect(streakStatus(ctx.db, ctx.clock).tokens).toBe(1);
    ctx.clock.advance(DAY_MS); // day 8: nothing done
    const s = streakStatus(ctx.db, ctx.clock);
    expect(s).toMatchObject({ current: 7, tokens: 0 });
    expect(getSlate(ctx.db, '2026-10-08')!.status).toBe('frozen');
    // and the streak continues afterwards
    completeToday(ctx.db, ctx.clock);
    ctx.clock.advance(DAY_MS);
    expect(streakStatus(ctx.db, ctx.clock).current).toBe(8);
  });

  it('two gap days with two tokens are both covered; a third breaks the streak', () => {
    for (let d = 0; d < 14; d++) {
      completeToday(ctx.db, ctx.clock);
      ctx.clock.advance(DAY_MS);
    }
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 14, tokens: 2 });
    ctx.clock.advance(3 * DAY_MS); // three empty days
    const closed = closeElapsedDays(ctx.db, ctx.clock);
    expect(closed.map((c) => c.status)).toEqual(['frozen', 'frozen', 'missed']);
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 0, tokens: 0, longest: 14 });
  });

  it('a gap day with no token breaks the streak', () => {
    for (let d = 0; d < 3; d++) {
      completeToday(ctx.db, ctx.clock);
      ctx.clock.advance(DAY_MS);
    }
    expect(streakStatus(ctx.db, ctx.clock).current).toBe(3);
    ctx.clock.advance(DAY_MS); // gap
    const s = streakStatus(ctx.db, ctx.clock);
    expect(s).toMatchObject({ current: 0, tokens: 0, longest: 3, slateDaysBanked: 0 });
  });

  it('closing days is idempotent', () => {
    completeToday(ctx.db, ctx.clock);
    ctx.clock.advance(DAY_MS);
    expect(closeElapsedDays(ctx.db, ctx.clock)).toHaveLength(1);
    expect(closeElapsedDays(ctx.db, ctx.clock)).toHaveLength(0);
    expect(streakStatus(ctx.db, ctx.clock).current).toBe(1);
  });
});
