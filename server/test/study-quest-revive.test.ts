import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../src/engines/clock.ts';
import { deserializeCard, dueCount } from '../src/engines/fsrs.ts';
import { enrollFlashcards, queueQuizMisses } from '../src/engines/study-quest.ts';
import { makeUnit, useTempDb } from './helpers.ts';

/** Server review F7b: re-enqueueing a RETIRED seeded card revives it, never instantly due. */
describe('study-quest enqueue revives a retired card on a sensible schedule', () => {
  const ctx = useTempDb();
  const card = (key: string) =>
    ctx.db.get<{ id: number; due_at: number; retired_at: number | null; fsrs_state: string }>('SELECT id, due_at, retired_at, fsrs_state FROM review_item WHERE card_key = ?', key)!;

  it('a quiz-miss card retired by a re-seed, missed again weeks later, is live and due the NEXT day (not at its stale due time)', () => {
    const unit = makeUnit(ctx.db, ctx.clock, { kind: 'study' });
    const first = queueQuizMisses(ctx.db, unit, ['seed:quiz:a'], ctx.clock);
    expect(first.created).toBe(1);
    const t0 = ctx.clock().getTime();
    expect(card('quiz-miss:seed:quiz:a').due_at).toBe(t0 + DAY_MS);
    // a re-seed retires it (its item left the packs) ...
    ctx.clock.advance(3 * DAY_MS);
    ctx.db.run('UPDATE review_item SET retired_at = ? WHERE card_key = ?', ctx.clock().getTime(), 'quiz-miss:seed:quiz:a');
    // ... the item returns and is missed again three weeks later
    ctx.clock.advance(21 * DAY_MS);
    const t1 = ctx.clock().getTime();
    const again = queueQuizMisses(ctx.db, unit, ['seed:quiz:a'], ctx.clock);
    expect(again).toMatchObject({ created: 0, alreadyQueued: 1, dueAt: t1 + DAY_MS });
    const c = card('quiz-miss:seed:quiz:a');
    expect(c.retired_at).toBeNull();
    expect(c.due_at).toBe(t1 + DAY_MS); // was: t0 + DAY (24 days stale) -> instantly due
    expect(deserializeCard(c.fsrs_state).due.getTime()).toBe(t1 + DAY_MS); // the FSRS state agrees with the row
    expect(dueCount(ctx.db, ctx.clock)).toBe(0); // nothing became due mid-day
    ctx.clock.advance(DAY_MS);
    expect(dueCount(ctx.db, ctx.clock)).toBe(1);
  });

  it('a LIVE card keeps its own schedule (dedup unchanged); a revived card is due at the LATER of its own due time and a new card\'s', () => {
    const unit = makeUnit(ctx.db, ctx.clock, { kind: 'study' });
    queueQuizMisses(ctx.db, unit, ['seed:quiz:b'], ctx.clock);
    const before = card('quiz-miss:seed:quiz:b');
    ctx.clock.advance(60_000);
    queueQuizMisses(ctx.db, unit, ['seed:quiz:b'], ctx.clock);
    expect(card('quiz-miss:seed:quiz:b')).toEqual(before);
    // flashcard enrolled, retired an hour later, re-enrolled an hour after that
    enrollFlashcards(ctx.db, unit, ['seed:flash:c'], ctx.clock);
    const due = card('flashcard:seed:flash:c').due_at;
    ctx.clock.advance(60 * 60 * 1000);
    ctx.db.run('UPDATE review_item SET retired_at = ? WHERE card_key = ?', ctx.clock().getTime(), 'flashcard:seed:flash:c');
    ctx.clock.advance(60 * 60 * 1000);
    enrollFlashcards(ctx.db, unit, ['seed:flash:c'], ctx.clock);
    expect(card('flashcard:seed:flash:c')).toMatchObject({ retired_at: null, due_at: Math.max(due, ctx.clock().getTime() + DAY_MS) });
  });
});
