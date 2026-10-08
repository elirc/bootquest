import { describe, expect, it } from 'vitest';
import { State } from 'ts-fsrs';
import { DAY_MS, fixedClock } from '../src/engines/clock.ts';
import { getRating } from '../src/engines/evidence.ts';
import {
  addReviewItem,
  deserializeCard,
  dueCount,
  newCard,
  review,
  schedule,
  serializeCard,
} from '../src/engines/fsrs.ts';
import type { RatingChange } from '../src/engines/evidence.ts';
import { localNoon, useTempDb } from './helpers.ts';

const GRADES = ['again', 'hard', 'good', 'easy'] as const;

describe('FSRS wrapper (ts-fsrs)', () => {
  const ctx = useTempDb();

  it('new card: Again <= Hard <= Good <= Easy due dates, all after now', () => {
    const card = newCard(ctx.clock);
    const t = ctx.clock().getTime();
    const dues = GRADES.map((g) => schedule(card, g, ctx.clock).due.getTime());
    for (const d of dues) expect(d).toBeGreaterThan(t);
    for (let i = 1; i < dues.length; i++) expect(dues[i]!).toBeGreaterThanOrEqual(dues[i - 1]!);
    expect(dues[3]!).toBeGreaterThan(dues[0]!); // Easy strictly later than Again
  });

  it('review-state card: Again < Hard < Good < Easy strictly; Good grows the interval', () => {
    const clock = fixedClock(localNoon(2026, 10, 1));
    let card = newCard(clock);
    // graduate the card into Review with a few Good reviews, each at its due date
    for (let i = 0; i < 4; i++) {
      card = schedule(card, 'good', clock);
      clock.set(card.due);
    }
    expect(card.state).toBe(State.Review);
    const dues = GRADES.map((g) => schedule(card, g, clock).due.getTime());
    for (let i = 1; i < dues.length; i++) expect(dues[i]!).toBeGreaterThan(dues[i - 1]!);
    const prevInterval = card.scheduled_days;
    const afterGood = schedule(card, 'good', clock);
    expect(afterGood.scheduled_days).toBeGreaterThan(prevInterval);
    expect(schedule(card, 'again', clock).state).toBe(State.Relearning);
  });

  it('is deterministic (fuzz disabled) and round-trips through JSON', () => {
    const card = schedule(newCard(ctx.clock), 'good', ctx.clock);
    const back = deserializeCard(serializeCard(card));
    expect(back).toEqual(card);
    expect(schedule(back, 'easy', ctx.clock).due.getTime()).toBe(schedule(card, 'easy', ctx.clock).due.getTime());
  });

  it('review() persists the new due_at, logs history, and awards 1 XP', () => {
    const item = addReviewItem(ctx.db, { cardKey: 'c1' }, ctx.clock);
    expect(dueCount(ctx.db, ctx.clock)).toBe(1);
    const out = review(ctx.db, item.id, 'easy', ctx.clock);
    expect(out.nextDueAt).toBeGreaterThan(ctx.clock().getTime());
    expect(out.item.due_at).toBe(out.nextDueAt);
    expect(out.xp.amount).toBe(1);
    expect(out.demotion).toBe(null);
    expect(dueCount(ctx.db, ctx.clock)).toBe(0);
    expect(ctx.db.get('SELECT rating, prev_due_at, next_due_at FROM review_log')).toEqual({
      rating: 'easy',
      prev_due_at: item.due_at,
      next_due_at: out.nextDueAt,
    });
  });

  it('a failed review on a competency-linked item triggers the demotion hook', () => {
    ctx.db.run(`UPDATE competency_rating SET rating = 3 WHERE competency_id = 'data-http'`);
    const item = addReviewItem(ctx.db, { cardKey: 'sql-joins', competencyId: 'data-http' }, ctx.clock);
    const hooked: RatingChange[] = [];
    const out = review(ctx.db, item.id, 'again', ctx.clock, { onDemotion: (c) => hooked.push(c) });
    expect(out.demotion).toMatchObject({ competency: 'data-http', from: 3, to: 2 });
    expect(hooked).toHaveLength(1);
    expect(getRating(ctx.db, 'data-http')).toBe(2);
    const ev = ctx.db.get<{ kind: string; competency_id: string }>('SELECT kind, competency_id FROM evidence WHERE id = ?', out.demotion!.evidenceId);
    expect(ev).toEqual({ kind: 'demotion', competency_id: 'data-http' });
    expect(ctx.db.get<{ demotion_evidence_id: number }>('SELECT demotion_evidence_id FROM review_log')!.demotion_evidence_id).toBe(out.demotion!.evidenceId);
  });

  it('Hard/Good/Easy on a competency item, and Again on an unlinked item, do not demote', () => {
    ctx.db.run(`UPDATE competency_rating SET rating = 3 WHERE competency_id = 'data-http'`);
    const linked = addReviewItem(ctx.db, { cardKey: 'linked', competencyId: 'data-http' }, ctx.clock);
    for (const g of ['hard', 'good', 'easy'] as const) {
      ctx.clock.advance(30 * DAY_MS);
      expect(review(ctx.db, linked.id, g, ctx.clock).demotion).toBe(null);
    }
    const unlinked = addReviewItem(ctx.db, { cardKey: 'unlinked' }, ctx.clock);
    expect(review(ctx.db, unlinked.id, 'again', ctx.clock).demotion).toBe(null);
    expect(getRating(ctx.db, 'data-http')).toBe(3);
  });
});
