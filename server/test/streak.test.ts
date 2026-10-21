import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/database.ts';
import { revealSolution, selfAttestReading } from '../src/engines/attempts.ts';
import { DAY_MS } from '../src/engines/clock.ts';
import { addReviewItem, dueItems, review } from '../src/engines/fsrs.ts';
import * as streakEngine from '../src/engines/streak.ts';
import { closeElapsedDays, composeSlate, drillUnitsRemaining, getSlate, streakStatus } from '../src/engines/streak.ts';
import { awardXp } from '../src/engines/xp.ts';
import { makeUnit, submit, unitKey, useTempDb } from './helpers.ts';

const TRACKS = ['js', 'csharp', 'java'] as const;

/** Seed `n` unpassed drill units on a track (content the learner has not reached yet). */
function seedDrills(db: Db, clock: () => Date, track: string, n: number): number[] {
  return Array.from({ length: n }, () => makeUnit(db, clock, { kind: 'drill', track }));
}

/** A drill bank deep enough that no track runs out during a test (the live content case). */
function stockAllTracks(db: Db, clock: () => Date) {
  for (const t of TRACKS) seedDrills(db, clock, t, 40);
}

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
  passNewDrills(db, clock, 'java');
  return composeSlate(db, clock);
}

function slot(db: Db, clock: () => Date, name: string) {
  return composeSlate(db, clock).items.find((i) => i.slot === name);
}

describe('daily slate composition', () => {
  const ctx = useTempDb();
  beforeEach(() => stockAllTracks(ctx.db, ctx.clock));

  it('with no campaign quests seeded: one 5-drill set per active track + review clear (no campaign slot)', () => {
    const slate = composeSlate(ctx.db, ctx.clock);
    expect(slate.items.map((i) => i.slot)).toEqual(['drill:js', 'drill:csharp', 'drill:java', 'review']);
    expect(slate.items.filter((i) => i.kind === 'drill-set').every((i) => 'size' in i && i.size === 5)).toBe(true);
    // java is unlocked with slate_drills (011, like csharp); agentic has no drill bank
    expect(slate.items.some((i) => i.slot === 'drill:agentic')).toBe(false);
    // a LOCKED track never contributes a drill set
    ctx.db.run(`UPDATE track SET locked = 1 WHERE id = 'java'`);
    expect(composeSlate(ctx.db, ctx.clock).items.map((i) => i.slot)).toEqual(['drill:js', 'drill:csharp', 'review']);
    ctx.db.run(`UPDATE track SET locked = 0 WHERE id = 'java'`);
    expect(composeSlate(ctx.db, ctx.clock).items).toEqual(slate.items); // idempotent
  });

  it('sysdesign joins the slate once it has drills (migration 016 + sysdrills pack)', () => {
    // 016 sets slate_drills = 1; with no sysdesign drill units the slot is dropped (the test above)
    seedDrills(ctx.db, ctx.clock, 'sysdesign', 3);
    // sort_order 5: after drill:java, before review; the slot is min(5, remaining) = 3
    expect(composeSlate(ctx.db, ctx.clock).items.map((i) => i.slot)).toEqual(['drill:js', 'drill:csharp', 'drill:java', 'drill:sysdesign', 'review']);
    expect(slot(ctx.db, ctx.clock, 'drill:sysdesign')).toMatchObject({ size: 3, done: false });
  });

  it('a campaign slot appears once a quest is seeded on an unlocked track, and a quest-unit pass ticks it', () => {
    const unitId = makeUnit(ctx.db, ctx.clock, { kind: 'guided-project' });
    const act = ctx.db.run(`INSERT INTO campaign_act (track_id, act_no, title) VALUES ('js', 1, 'Act 1')`).lastInsertRowid;
    ctx.db.run(`INSERT INTO quest (act_id, unit_id, repo, index_rank, verdict) VALUES (?, ?, 'elirc/x', 1, 'study')`, act, unitId);
    expect(composeSlate(ctx.db, ctx.clock).items.map((i) => i.slot)).toEqual(['drill:js', 'drill:csharp', 'drill:java', 'campaign', 'review']);
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
  beforeEach(() => stockAllTracks(ctx.db, ctx.clock));

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
  beforeEach(() => stockAllTracks(ctx.db, ctx.clock));

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

/** Review every due card, plus a fresh one, so the day has a review that leaves the queue empty. */
function clearQueue(db: Db, clock: () => Date, tag: string) {
  addReviewItem(db, { cardKey: `clear-${tag}` }, clock);
  for (const item of dueItems(db, clock)) review(db, item.id, 'good', clock);
}

function drillSlot(db: Db, clock: () => Date, track: string) {
  const s = composeSlate(db, clock).items.find((i) => i.slot === `drill:${track}`);
  return s?.kind === 'drill-set' ? s : undefined;
}

describe('drill-slot exhaustion (fix/slate): a track that runs out of new drills never blocks the slate', () => {
  const ctx = useTempDb();
  /** csharp is the only drill track unless a test says otherwise */
  const csharpOnly = () => ctx.db.run(`UPDATE track SET slate_drills = 0 WHERE id IN ('js', 'java')`);

  it('the slot shrinks to what is left, then drops; every day it is shown it can be completed', () => {
    csharpOnly();
    const bank = seedDrills(ctx.db, ctx.clock, 'csharp', 12);
    const days: Array<{ size: number | undefined; slots: string[] }> = [];
    for (let d = 0; d < 4; d++) {
      const slate = composeSlate(ctx.db, ctx.clock);
      const size = drillSlot(ctx.db, ctx.clock, 'csharp')?.size;
      days.push({ size, slots: slate.items.map((i) => i.slot) });
      for (const id of bank.splice(0, size ?? 0)) submit(ctx.db, ctx.clock, id);
      if (size !== undefined) expect(drillSlot(ctx.db, ctx.clock, 'csharp')!.done).toBe(true);
      clearQueue(ctx.db, ctx.clock, `d${d}`);
      expect(composeSlate(ctx.db, ctx.clock).items.every((i) => i.done)).toBe(true);
      ctx.clock.advance(DAY_MS);
    }
    expect(days).toEqual([
      { size: 5, slots: ['drill:csharp', 'review'] },
      { size: 5, slots: ['drill:csharp', 'review'] },
      { size: 2, slots: ['drill:csharp', 'review'] }, // 12 - 10: shrunk
      { size: undefined, slots: ['review'] }, // exhausted: dropped
    ]);
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 4, slateDaysBanked: 4 });
    expect(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((d) => getSlate(ctx.db, d)!.status)).toEqual(['slate', 'slate', 'slate', 'slate']);
  });

  it('boundaries: exactly 5 left -> 5; exactly 4 -> 4 (and 4 passes complete it); 0 -> no slot', () => {
    csharpOnly();
    expect(drillSlot(ctx.db, ctx.clock, 'csharp')).toBeUndefined(); // 0
    const five = seedDrills(ctx.db, ctx.clock, 'csharp', 5);
    expect(drillSlot(ctx.db, ctx.clock, 'csharp')!.size).toBe(5);
    submit(ctx.db, ctx.clock, five[0]!);
    ctx.clock.advance(DAY_MS);
    expect(drillUnitsRemaining(ctx.db, 'csharp', '2026-10-02')).toBe(4);
    const four = five.slice(1);
    expect(drillSlot(ctx.db, ctx.clock, 'csharp')).toMatchObject({ size: 4, done: false });
    // passing units TODAY does not shrink today's size (they were unpassed at day start)
    submit(ctx.db, ctx.clock, four[0]!);
    submit(ctx.db, ctx.clock, four[1]!);
    expect(drillSlot(ctx.db, ctx.clock, 'csharp')).toMatchObject({ size: 4, done: false });
    submit(ctx.db, ctx.clock, four[2]!);
    submit(ctx.db, ctx.clock, four[3]!);
    expect(drillSlot(ctx.db, ctx.clock, 'csharp')).toMatchObject({ size: 4, done: true });
    ctx.clock.advance(DAY_MS);
    expect(drillUnitsRemaining(ctx.db, 'csharp', '2026-10-03')).toBe(0);
    expect(drillSlot(ctx.db, ctx.clock, 'csharp')).toBeUndefined();
  });

  it('a failed attempt keeps a unit in the bank; retired, revealed and revealed-chain variants leave it', () => {
    csharpOnly();
    const [failed, retired, revealed] = seedDrills(ctx.db, ctx.clock, 'csharp', 4) as [number, number, number, number];
    makeUnit(ctx.db, ctx.clock, { kind: 'drill', track: 'csharp', variationOf: unitKey(ctx.db, revealed) }); // its variant
    submit(ctx.db, ctx.clock, failed, { pass: false });
    ctx.db.run('UPDATE unit SET retired_at = ? WHERE id = ?', ctx.clock().getTime(), retired);
    revealSolution(ctx.db, revealed, ctx.clock);
    // today: the reveal / retire happened DURING the day (retired is out now: not live; revealed still counts as of day start)
    expect(drillUnitsRemaining(ctx.db, 'csharp', '2026-10-01')).toBe(4); // failed, revealed, plain, variant
    ctx.clock.advance(DAY_MS);
    expect(drillUnitsRemaining(ctx.db, 'csharp', '2026-10-02')).toBe(2); // failed, plain
    expect(drillSlot(ctx.db, ctx.clock, 'csharp')!.size).toBe(2);
  });

  it('closed days do not move when content changes afterwards (stored row and re-derived path)', () => {
    csharpOnly();
    seedDrills(ctx.db, ctx.clock, 'csharp', 3).forEach((id) => submit(ctx.db, ctx.clock, id));
    clearQueue(ctx.db, ctx.clock, 'd1');
    expect(drillSlot(ctx.db, ctx.clock, 'csharp')).toMatchObject({ size: 3, done: true }); // row stored
    const before = drillUnitsRemaining(ctx.db, 'csharp', '2026-10-01');
    ctx.clock.advance(DAY_MS);
    // the next day, BEFORE day 1 is closed: a re-seed adds 20 drills and retires one of day 1's
    seedDrills(ctx.db, ctx.clock, 'csharp', 20);
    ctx.db.run(`UPDATE unit SET retired_at = ? WHERE id = (SELECT MIN(id) FROM unit WHERE track_id = 'csharp')`, ctx.clock().getTime());
    expect(drillUnitsRemaining(ctx.db, 'csharp', '2026-10-01')).toBe(before); // the re-derivation for day 1 is unchanged
    expect(closeElapsedDays(ctx.db, ctx.clock).map((c) => c.status)).toEqual(['slate']);
    expect(getSlate(ctx.db, '2026-10-01')!.items).toEqual([
      { slot: 'drill:csharp', kind: 'drill-set', track: 'csharp', size: 3, done: true },
      { slot: 'review', kind: 'review-clear', done: true },
    ]);
    expect(drillSlot(ctx.db, ctx.clock, 'csharp')!.size).toBe(5); // today sees the new content
  });

  it('a day with NO stored row re-derives the same slot list before and after a content change', () => {
    csharpOnly();
    seedDrills(ctx.db, ctx.clock, 'csharp', 2);
    composeSlate(ctx.db, ctx.clock); // day 1 is stored (it starts the history)
    ctx.clock.advance(2 * DAY_MS); // day 2: no compose, no stored row
    expect(getSlate(ctx.db, '2026-10-02')).toBeUndefined();
    const derive = () => drillUnitsRemaining(ctx.db, 'csharp', '2026-10-02');
    expect(derive()).toBe(2);
    seedDrills(ctx.db, ctx.clock, 'csharp', 20); // seeded on day 3: never reaches back
    ctx.db.run(`UPDATE unit SET retired_at = ? WHERE id = (SELECT MIN(id) FROM unit WHERE track_id = 'csharp')`, ctx.clock().getTime());
    expect(derive()).toBe(2);
    expect(closeElapsedDays(ctx.db, ctx.clock).map((c) => c.status)).toEqual(['missed', 'missed']);
    expect(getSlate(ctx.db, '2026-10-02')!.items).toEqual([
      { slot: 'drill:csharp', kind: 'drill-set', track: 'csharp', size: 2, done: false },
      { slot: 'review', kind: 'review-clear', done: true },
    ]);
  });

  it('content seeded mid-day never un-does a drill set that is already done', () => {
    csharpOnly();
    seedDrills(ctx.db, ctx.clock, 'csharp', 3).forEach((id) => submit(ctx.db, ctx.clock, id));
    expect(drillSlot(ctx.db, ctx.clock, 'csharp')).toMatchObject({ size: 3, done: true });
    seedDrills(ctx.db, ctx.clock, 'csharp', 20);
    expect(drillSlot(ctx.db, ctx.clock, 'csharp')).toMatchObject({ size: 3, done: true });
    // an UNDONE set does pick up the new content (it asks for a full set again)
    ctx.clock.advance(DAY_MS);
    seedDrills(ctx.db, ctx.clock, 'java', 1);
    ctx.db.run(`UPDATE track SET slate_drills = 1 WHERE id = 'java'`);
    expect(drillSlot(ctx.db, ctx.clock, 'java')!.size).toBe(1);
    seedDrills(ctx.db, ctx.clock, 'java', 9);
    expect(drillSlot(ctx.db, ctx.clock, 'java')!.size).toBe(5);
  });

  it('after every track is exhausted, review-clearing days still earn the streak and freeze tokens', () => {
    csharpOnly();
    seedDrills(ctx.db, ctx.clock, 'csharp', 5).forEach((id) => submit(ctx.db, ctx.clock, id));
    clearQueue(ctx.db, ctx.clock, 'd0');
    expect(composeSlate(ctx.db, ctx.clock).items.every((i) => i.done)).toBe(true);
    ctx.clock.advance(DAY_MS);
    for (let d = 1; d < 7; d++) {
      expect(composeSlate(ctx.db, ctx.clock).items.map((i) => i.slot)).toEqual(['review']);
      clearQueue(ctx.db, ctx.clock, `d${d}`);
      ctx.clock.advance(DAY_MS);
    }
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 7, tokens: 1, slateDaysBanked: 0 });
  });

  it('a review-only slate does not complete itself on an idle day (empty queue, no review)', () => {
    csharpOnly();
    for (let d = 0; d < 7; d++) {
      seedDrills(ctx.db, ctx.clock, 'csharp', 5).forEach((id) => submit(ctx.db, ctx.clock, id));
      expect(composeSlate(ctx.db, ctx.clock).items.every((i) => i.done)).toBe(true); // no cards: the queue is empty
      ctx.clock.advance(DAY_MS);
    }
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 7, tokens: 1 });
    // day 8: every drill passed, nothing ever due; the learner opens the app and does nothing
    expect(composeSlate(ctx.db, ctx.clock).items).toEqual([{ slot: 'review', kind: 'review-clear', done: false }]);
    expect(streakStatus(ctx.db, ctx.clock).todayComplete).toBe(false);
    ctx.clock.advance(DAY_MS);
    expect(closeElapsedDays(ctx.db, ctx.clock)).toEqual([{ day: '2026-10-08', status: 'frozen', xp: 0 }]);
    expect(getSlate(ctx.db, '2026-10-08')!.items).toEqual([{ slot: 'review', kind: 'review-clear', done: false }]);
  });

  it('F5: a new track slot appearing mid-day (an exhausted track gets content) is never ADDED to an already-complete open day', () => {
    ctx.db.run(`UPDATE track SET slate_drills = 0 WHERE id = 'js'`); // csharp + java on the slate; java has no drills yet
    seedDrills(ctx.db, ctx.clock, 'csharp', 3).forEach((id) => submit(ctx.db, ctx.clock, id));
    clearQueue(ctx.db, ctx.clock, 'd1');
    expect(composeSlate(ctx.db, ctx.clock).items.map((i) => [i.slot, i.done])).toEqual([
      ['drill:csharp', true],
      ['review', true],
    ]);
    expect(streakStatus(ctx.db, ctx.clock).todayComplete).toBe(true);
    // a re-seed + restart mid-day gives java its first drills: java would now ask for a 5-drill set
    seedDrills(ctx.db, ctx.clock, 'java', 8);
    expect(drillUnitsRemaining(ctx.db, 'java', '2026-10-01')).toBe(5 + 3);
    const slate = composeSlate(ctx.db, ctx.clock);
    expect(slate.items.map((i) => i.slot)).toEqual(['drill:csharp', 'review']); // was: drill:java added, day flipped incomplete
    expect(slate.items.every((i) => i.done)).toBe(true);
    expect(streakStatus(ctx.db, ctx.clock).todayComplete).toBe(true);
    ctx.clock.advance(DAY_MS);
    expect(closeElapsedDays(ctx.db, ctx.clock).map((c) => c.status)).toEqual(['slate']);
    // tomorrow the new content is on the slate
    expect(drillSlot(ctx.db, ctx.clock, 'java')).toMatchObject({ size: 5, done: false });
  });

  it('F5: an INCOMPLETE open day still picks up a new slot (only complete days are frozen against additions)', () => {
    ctx.db.run(`UPDATE track SET slate_drills = 0 WHERE id = 'js'`);
    seedDrills(ctx.db, ctx.clock, 'csharp', 3);
    expect(composeSlate(ctx.db, ctx.clock).items.map((i) => i.slot)).toEqual(['drill:csharp', 'review']);
    seedDrills(ctx.db, ctx.clock, 'java', 2);
    expect(composeSlate(ctx.db, ctx.clock).items.map((i) => i.slot)).toEqual(['drill:csharp', 'drill:java', 'review']);
  });

  it('F4: retiring a due card AFTER a day ended never rewrites that day: its review slot is judged with the card live (retired_at as of the day)', () => {
    csharpOnly();
    seedDrills(ctx.db, ctx.clock, 'csharp', 3).forEach((id) => submit(ctx.db, ctx.clock, id));
    const card = addReviewItem(ctx.db, { cardKey: 'quiz-miss:seed:quiz:gone' }, ctx.clock); // due now, never reviewed today
    expect(composeSlate(ctx.db, ctx.clock).items.find((i) => i.slot === 'review')!.done).toBe(false);
    ctx.clock.advance(DAY_MS);
    // the next day, BEFORE day 1 is closed: a re-seed removed the card's item and startup retires the card
    ctx.db.run('UPDATE review_item SET retired_at = ? WHERE id = ?', ctx.clock().getTime(), card.id);
    expect(streakEngine.dueAsOf(ctx.db, ctx.clock().getTime())).toBe(0); // gone from the live queue now ...
    expect(closeElapsedDays(ctx.db, ctx.clock).map((c) => c.status)).not.toContain('slate'); // ... but day 1 had it due
    expect(getSlate(ctx.db, '2026-10-01')!.items.find((i) => i.slot === 'review')!.done).toBe(false);
    // and a card retired DURING a day stops counting from that moment on (today's queue is clear)
    clearQueue(ctx.db, ctx.clock, 'd2');
    expect(composeSlate(ctx.db, ctx.clock).items.find((i) => i.slot === 'review')!.done).toBe(true);
  });

  it('multi-track: an exhausted track drops out while the others keep their 5-drill sets', () => {
    ctx.db.run(`UPDATE track SET slate_drills = 0 WHERE id = 'java'`);
    seedDrills(ctx.db, ctx.clock, 'js', 3).forEach((id) => submit(ctx.db, ctx.clock, id)); // js: all 3 done today
    seedDrills(ctx.db, ctx.clock, 'csharp', 40);
    expect(composeSlate(ctx.db, ctx.clock).items.map((i) => [i.slot, i.kind === 'drill-set' ? i.size : null])).toEqual([
      ['drill:js', 3],
      ['drill:csharp', 5],
      ['review', null],
    ]);
    const csharp = ctx.db.all<{ id: number }>(`SELECT id FROM unit WHERE track_id = 'csharp' ORDER BY id`).map((r) => r.id);
    for (let d = 0; d < 7; d++) {
      for (const id of csharp.splice(0, 5)) submit(ctx.db, ctx.clock, id);
      const slots = composeSlate(ctx.db, ctx.clock).items;
      expect(slots.some((i) => i.slot === 'drill:js')).toBe(d === 0); // js exhausted after day 1
      expect(slots.every((i) => i.done)).toBe(true);
      ctx.clock.advance(DAY_MS);
    }
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 7, tokens: 1, slateDaysBanked: 0 });
  });
});
