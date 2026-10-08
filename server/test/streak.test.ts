import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/database.ts';
import { revealSolution, selfAttestReading } from '../src/engines/attempts.ts';
import { DAY_MS } from '../src/engines/clock.ts';
import { addReviewItem, review } from '../src/engines/fsrs.ts';
import * as streakEngine from '../src/engines/streak.ts';
import { closeElapsedDays, composeSlate, getSlate, streakStatus } from '../src/engines/streak.ts';
import { awardXp } from '../src/engines/xp.ts';
import { makeUnit, submit, useTempDb } from './helpers.ts';

/** Pass `n` brand-new drill units on a track today (first-ever passes). */
function passNewDrills(db: Db, clock: () => Date, track: string, n = 5): number[] {
  return Array.from({ length: n }, () => {
    const id = makeUnit(db, clock, { kind: 'drill', track });
    submit(db, clock, id);
    return id;
  });
}

/** A full slate day with no campaign seeded: 5 new drills per active track, review queue clear. */
function completeToday(db: Db, clock: () => Date) {
  passNewDrills(db, clock, 'js');
  passNewDrills(db, clock, 'csharp');
  return composeSlate(db, clock);
}

function slot(db: Db, clock: () => Date, name: string) {
  return composeSlate(db, clock).items.find((i) => i.slot === name);
}

describe('daily slate composition', () => {
  const ctx = useTempDb();

  it('with no campaign quests seeded: one 5-drill set per active track + review clear (no campaign slot)', () => {
    const slate = composeSlate(ctx.db, ctx.clock);
    expect(slate.items.map((i) => i.slot)).toEqual(['drill:js', 'drill:csharp', 'review']);
    expect(slate.items.filter((i) => i.kind === 'drill-set').every((i) => 'size' in i && i.size === 5)).toBe(true);
    // java is locked and agentic has no drill bank: neither contributes a drill set
    expect(slate.items.some((i) => i.slot === 'drill:java' || i.slot === 'drill:agentic')).toBe(false);
    expect(composeSlate(ctx.db, ctx.clock).items).toEqual(slate.items); // idempotent
  });

  it('a campaign slot appears once a quest is seeded on an unlocked track, and a quest-unit pass ticks it', () => {
    const unitId = makeUnit(ctx.db, ctx.clock, { kind: 'guided-project' });
    const act = ctx.db.run(`INSERT INTO campaign_act (track_id, act_no, title) VALUES ('js', 1, 'Act 1')`).lastInsertRowid;
    ctx.db.run(`INSERT INTO quest (act_id, unit_id, repo, index_rank, verdict) VALUES (?, ?, 'elirc/x', 1, 'study')`, act, unitId);
    expect(composeSlate(ctx.db, ctx.clock).items.map((i) => i.slot)).toEqual(['drill:js', 'drill:csharp', 'campaign', 'review']);
    expect(slot(ctx.db, ctx.clock, 'campaign')!.done).toBe(false);
    submit(ctx.db, ctx.clock, unitId, { pass: false });
    expect(slot(ctx.db, ctx.clock, 'campaign')!.done).toBe(false);
    submit(ctx.db, ctx.clock, unitId);
    expect(slot(ctx.db, ctx.clock, 'campaign')!.done).toBe(true);
  });

  it('there is no caller-facing way to mark a slot done', () => {
    expect('markSlateItem' in streakEngine).toBe(false);
  });
});

describe('slot completion is derived from the ledger', () => {
  const ctx = useTempDb();

  it('drill slot: 5 first-ever drill passes on the track today; 4 is not enough; failures do not count', () => {
    passNewDrills(ctx.db, ctx.clock, 'js', 4);
    const failed = makeUnit(ctx.db, ctx.clock, { kind: 'drill' });
    submit(ctx.db, ctx.clock, failed, { pass: false });
    expect(slot(ctx.db, ctx.clock, 'drill:js')!.done).toBe(false);
    passNewDrills(ctx.db, ctx.clock, 'js', 1);
    expect(slot(ctx.db, ctx.clock, 'drill:js')!.done).toBe(true);
    expect(slot(ctx.db, ctx.clock, 'drill:csharp')!.done).toBe(false);
  });

  it('quizzes never tick the drill slot', () => {
    for (let i = 0; i < 5; i++) submit(ctx.db, ctx.clock, makeUnit(ctx.db, ctx.clock, { kind: 'quiz', track: 'csharp' }));
    expect(slot(ctx.db, ctx.clock, 'drill:csharp')!.done).toBe(false);
  });

  it('re-passing units first passed on an earlier day does not tick the slot', () => {
    const units = passNewDrills(ctx.db, ctx.clock, 'js');
    ctx.clock.advance(DAY_MS);
    for (const id of units) submit(ctx.db, ctx.clock, id);
    expect(slot(ctx.db, ctx.clock, 'drill:js')!.done).toBe(false);
  });

  it('guided (post-reveal) passes do not tick the slot', () => {
    const units = Array.from({ length: 5 }, () => makeUnit(ctx.db, ctx.clock, { kind: 'drill' }));
    revealSolution(ctx.db, units[0]!, ctx.clock);
    for (const id of units) submit(ctx.db, ctx.clock, id);
    expect(slot(ctx.db, ctx.clock, 'drill:js')!.done).toBe(false);
  });

  it('review slot: not done while a card is due; done once cleared, and stays done if a card falls due later that day', () => {
    const card = addReviewItem(ctx.db, { cardKey: 'due-now' }, ctx.clock); // new cards are due immediately
    expect(slot(ctx.db, ctx.clock, 'review')!.done).toBe(false);
    review(ctx.db, card.id, 'good', ctx.clock);
    expect(slot(ctx.db, ctx.clock, 'review')!.done).toBe(true);
    ctx.clock.advance(60 * 60 * 1000);
    addReviewItem(ctx.db, { cardKey: 'later' }, ctx.clock); // due now, after the clear
    expect(slot(ctx.db, ctx.clock, 'review')!.done).toBe(true);
  });

  it('a day whose due queue was never cleared closes with the review slot undone', () => {
    addReviewItem(ctx.db, { cardKey: 'ignored' }, ctx.clock);
    completeToday(ctx.db, ctx.clock);
    ctx.clock.advance(DAY_MS);
    expect(streakStatus(ctx.db, ctx.clock).current).toBe(0);
    expect(getSlate(ctx.db, '2026-10-01')!.items.find((i) => i.slot === 'review')!.done).toBe(false);
  });
});

describe('streak engine', () => {
  const ctx = useTempDb();

  it('a full drill + review day (no campaign seeded) earns a streak day', () => {
    const card = addReviewItem(ctx.db, { cardKey: 'c' }, ctx.clock);
    review(ctx.db, card.id, 'good', ctx.clock);
    completeToday(ctx.db, ctx.clock);
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 0, display: 1, todayComplete: true });
    ctx.clock.advance(DAY_MS);
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 1, display: 1, todayComplete: false, slateDaysBanked: 1 });
    expect(getSlate(ctx.db, '2026-10-01')!.status).toBe('slate');
  });

  it('an incomplete slate is not a slate-day', () => {
    passNewDrills(ctx.db, ctx.clock, 'js');
    ctx.clock.advance(DAY_MS);
    expect(streakStatus(ctx.db, ctx.clock).current).toBe(0);
  });

  it('a 20+ XP day without the slate is partial: keeps the streak, no token credit', () => {
    completeToday(ctx.db, ctx.clock); // day 1 slate
    ctx.clock.advance(DAY_MS);
    const unit = makeUnit(ctx.db, ctx.clock, { difficulty: 2 });
    expect(awardXp(ctx.db, { kind: 'code', attemptId: submit(ctx.db, ctx.clock, unit).id }, ctx.clock).amount).toBe(20); // day 2: exactly 20
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
    const code = makeUnit(ctx.db, ctx.clock, { difficulty: 1 });
    awardXp(ctx.db, { kind: 'code', attemptId: submit(ctx.db, ctx.clock, code).id }, ctx.clock); // 10
    const predict = makeUnit(ctx.db, ctx.clock, { kind: 'predict-output' });
    awardXp(ctx.db, { kind: 'predict', attemptId: submit(ctx.db, ctx.clock, predict).id }, ctx.clock); // +4
    const reading = makeUnit(ctx.db, ctx.clock, { kind: 'reading' });
    awardXp(ctx.db, { kind: 'reading', attemptId: selfAttestReading(ctx.db, reading, ctx.clock).id }, ctx.clock); // +5 = 19
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
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 0, tokens: 0, longest: 3, slateDaysBanked: 0 });
  });

  it('closing days is idempotent and snapshots the derived slots', () => {
    completeToday(ctx.db, ctx.clock);
    ctx.clock.advance(DAY_MS);
    expect(closeElapsedDays(ctx.db, ctx.clock)).toHaveLength(1);
    expect(closeElapsedDays(ctx.db, ctx.clock)).toHaveLength(0);
    expect(streakStatus(ctx.db, ctx.clock).current).toBe(1);
    expect(getSlate(ctx.db, '2026-10-01')!.items.every((i) => i.done)).toBe(true);
  });
});
