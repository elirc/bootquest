import { VERIFIED_PASS_SQL } from './attempts.ts';

/**
 * f52 fix (Fundamentals closed-book gate): a missed Fundamentals gate question still becomes its
 * 'quiz-miss:fund:<key>' review card in the failed submit's transaction (enrolled exactly as today,
 * FSRS state and due time included), but the card's back IS the keyed choice + explanation
 * (study-service reviewCardText). Served the next day it would make a retry open-key. So the card is
 * HELD: not in GET /reviews/queue, not in any due count / forecast / review-clear, not gradeable,
 * until the gate's unit (review_item.unit_id) has a verified pass. Right after that pass it is an
 * ordinary card again (due at its scheduled time).
 *
 * Campaign study-quest misses ('quiz-miss:<seed key>', never 'fund:') are not held: their release
 * rule is the card's due time (notes-service explanationRelease (c)).
 *
 * Kept in its own module (it imports only attempts.ts) so fsrs.ts, streak.ts, store/queries.ts and
 * the stats service can share it without an import cycle.
 */

/** Card-key prefix of a held-able card (QUIZ_MISS_CARD_PREFIX + the fund item-key prefix). */
export const FUND_QUIZ_MISS_PREFIX = 'quiz-miss:fund:';

/**
 * SQL predicate: the review_item referenced by `ri` (a table name or alias) is a HELD Fundamentals
 * quiz-miss card. `asOf` (an SQL expression, e.g. '?') judges the pass as of that moment (streak.ts
 * dueAsOf rebuilds past days); omitted, any verified pass counts.
 */
export function fundMissHeldSql(ri: string, asOf?: string): string {
  const when = asOf === undefined ? '' : ` AND a.created_at <= ${asOf}`;
  return `(${ri}.kind = 'quiz-miss' AND substr(${ri}.card_key, 1, ${FUND_QUIZ_MISS_PREFIX.length}) = '${FUND_QUIZ_MISS_PREFIX}'
    AND NOT EXISTS (SELECT 1 FROM attempt a WHERE a.unit_id = ${ri}.unit_id${when} AND ${VERIFIED_PASS_SQL}))`;
}
