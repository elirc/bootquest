import { describe, expect, it } from 'vitest';
import { dayKey } from '../src/engines/clock.ts';
import { getRating } from '../src/engines/evidence.ts';
import { addReviewItem, review } from '../src/engines/fsrs.ts';
import { graduate, promoteTo, useTempDb } from './helpers.ts';

/** ab-wave R3.2: the lapse demotion cap is per competency and per LOCAL day (engine level). */
describe('lapse demotion cap', () => {
  const ctx = useTempDb();
  const demotions = (c: string) => ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM evidence WHERE kind = 'demotion' AND competency_id = ?`, c)!.n;

  it('a capped competency does not cap another one the same day', () => {
    promoteTo(ctx.db, ctx.clock, 'data-http', 3);
    promoteTo(ctx.db, ctx.clock, 'testing-verification', 3);
    const a1 = addReviewItem(ctx.db, { cardKey: 'a1', competencyId: 'data-http' }, ctx.clock);
    const a2 = addReviewItem(ctx.db, { cardKey: 'a2', competencyId: 'data-http' }, ctx.clock);
    const b1 = addReviewItem(ctx.db, { cardKey: 'b1', competencyId: 'testing-verification' }, ctx.clock);
    for (const id of [a1.id, a2.id, b1.id]) graduate(ctx.db, ctx.clock, id);
    ctx.clock.set(Math.max(...[a1, a2, b1].map((i) => ctx.db.get<{ d: number }>('SELECT due_at AS d FROM review_item WHERE id = ?', i.id)!.d)));
    expect(review(ctx.db, a1.id, 'again', ctx.clock).demotion).toMatchObject({ competency: 'data-http', from: 3, to: 2 });
    expect(review(ctx.db, a2.id, 'again', ctx.clock).demotion).toBeNull();
    expect(review(ctx.db, b1.id, 'again', ctx.clock).demotion).toMatchObject({ competency: 'testing-verification', from: 3, to: 2 });
    expect([getRating(ctx.db, 'data-http'), getRating(ctx.db, 'testing-verification')]).toEqual([2, 2]);
    expect([demotions('data-http'), demotions('testing-verification')]).toEqual([1, 1]);
  });

  it('the day is the LOCAL calendar day: one minute after local midnight the cap has reset', () => {
    promoteTo(ctx.db, ctx.clock, 'data-http', 3);
    const a1 = addReviewItem(ctx.db, { cardKey: 'm1', competencyId: 'data-http' }, ctx.clock);
    const a2 = addReviewItem(ctx.db, { cardKey: 'm2', competencyId: 'data-http' }, ctx.clock);
    for (const id of [a1.id, a2.id]) graduate(ctx.db, ctx.clock, id);
    const due = Math.max(...[a1, a2].map((i) => ctx.db.get<{ d: number }>('SELECT due_at AS d FROM review_item WHERE id = ?', i.id)!.d));
    const d = new Date(due);
    const lateEvening = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 0, 0).getTime();
    ctx.clock.set(Math.max(due, lateEvening));
    const day1 = dayKey(ctx.clock().getTime());
    expect(review(ctx.db, a1.id, 'again', ctx.clock).demotion).not.toBeNull();
    ctx.clock.advance(2 * 60 * 1000); // 00:01 the next local day
    expect(dayKey(ctx.clock().getTime())).not.toBe(day1);
    expect(review(ctx.db, a2.id, 'again', ctx.clock).demotion).toMatchObject({ from: 2, to: 1 });
  });
});
