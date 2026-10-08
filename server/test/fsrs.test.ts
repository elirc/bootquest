import { describe, expect, it } from 'vitest';
import { State } from 'ts-fsrs';
import { DAY_MS, fixedClock } from '../src/engines/clock.ts';
import { getRating } from '../src/engines/evidence.ts';
import {
  addReviewItem,
  deserializeCard,
  dueCount,
  getReviewItem,
  newCard,
  review,
  schedule,
  serializeCard,
} from '../src/engines/fsrs.ts';
import type { RatingChange } from '../src/engines/evidence.ts';
import { graduate, localNoon, promoteTo, useTempDb } from './helpers.ts';


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

  it('a LAPSE (Again on a Review-state card) on a competency-linked item triggers the demotion hook', () => {
    promoteTo(ctx.db, ctx.clock, 'data-http', 3);
    const item = addReviewItem(ctx.db, { cardKey: 'sql-joins', competencyId: 'data-http' }, ctx.clock);
    graduate(ctx.db, ctx.clock, item.id);
    const hooked: RatingChange[] = [];
    const out = review(ctx.db, item.id, 'again', ctx.clock, { onDemotion: (c) => hooked.push(c) });
    expect(out.demotion).toMatchObject({ competency: 'data-http', from: 3, to: 2 });
    expect(hooked).toHaveLength(1);
    expect(getRating(ctx.db, 'data-http')).toBe(2);
    const ev = ctx.db.get<{ kind: string; competency_id: string }>('SELECT kind, competency_id FROM evidence WHERE id = ?', out.demotion!.evidenceId);
    expect(ev).toEqual({ kind: 'demotion', competency_id: 'data-http' });
    const log = ctx.db.get<{ demotion_evidence_id: number }>('SELECT demotion_evidence_id FROM review_log ORDER BY id DESC LIMIT 1')!;
    expect(log.demotion_evidence_id).toBe(out.demotion!.evidenceId);
  });

  it('Again on a NEW (or still-learning) card is not a lapse and does not demote (audit #7)', () => {
    promoteTo(ctx.db, ctx.clock, 'data-http', 3);
    const item = addReviewItem(ctx.db, { cardKey: 'first-sight', competencyId: 'data-http' }, ctx.clock);
    expect(review(ctx.db, item.id, 'again', ctx.clock).demotion).toBe(null); // New -> Learning
    ctx.clock.set(getReviewItem(ctx.db, item.id).due_at);
    expect(review(ctx.db, item.id, 'again', ctx.clock).demotion).toBe(null); // Learning
    expect(getRating(ctx.db, 'data-http')).toBe(3);
  });

  it('Hard/Good/Easy on a competency item, and Again on an unlinked item, do not demote', () => {
    promoteTo(ctx.db, ctx.clock, 'data-http', 3);
    const linked = addReviewItem(ctx.db, { cardKey: 'linked', competencyId: 'data-http' }, ctx.clock);
    for (const g of ['hard', 'good', 'easy'] as const) {
      ctx.clock.advance(30 * DAY_MS);
      expect(review(ctx.db, linked.id, g, ctx.clock).demotion).toBe(null);
    }
    const unlinked = addReviewItem(ctx.db, { cardKey: 'unlinked' }, ctx.clock);
    graduate(ctx.db, ctx.clock, unlinked.id);
    expect(review(ctx.db, unlinked.id, 'again', ctx.clock).demotion).toBe(null);
    expect(getRating(ctx.db, 'data-http')).toBe(3);
  });

  it('every review of a competency-linked card writes a review evidence row (grade + due movement)', () => {
    const item = addReviewItem(ctx.db, { cardKey: 'ev', competencyId: 'testing-verification' }, ctx.clock);
    const out = review(ctx.db, item.id, 'good', ctx.clock);
    const ev = ctx.db.all<{ kind: string; assessor: string; verified: boolean; observation: string }>(
      `SELECT kind, assessor, verified, observation FROM evidence WHERE competency_id = 'testing-verification'`,
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'review', assessor: 'pipeline', verified: true });
    expect(ev[0]!.observation).toContain('graded good');
    expect(ev[0]!.observation).toContain(new Date(out.nextDueAt).toISOString());
    // an unlinked card has no competency to file evidence under
    const plain = addReviewItem(ctx.db, { cardKey: 'plain' }, ctx.clock);
    review(ctx.db, plain.id, 'good', ctx.clock);
    expect(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM evidence WHERE kind = 'review'`)!.n).toBe(1);
  });

  it('a card that is not due yet cannot be reviewed (no early-review XP)', () => {
    const item = addReviewItem(ctx.db, { cardKey: 'early' }, ctx.clock);
    review(ctx.db, item.id, 'easy', ctx.clock);
    expect(() => review(ctx.db, item.id, 'easy', ctx.clock)).toThrow(/not due/);
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM xp_event')!.n).toBe(1);
  });
});
