import type { Db } from '../db/database.ts';
import { nowMs, type Clock } from '../engines/clock.ts';
import { FLASHCARD_CARD_PREFIX, QUIZ_MISS_CARD_PREFIX } from '../engines/study-quest.ts';
import type { SeedItemStore } from './seed-items.ts';

/**
 * Seeded review cards under THE re-seed policy (store/check-policy.ts): retire, never delete.
 *
 * A study-quest miss ('quiz-miss:<item key>') or an enrolled flashcard ('flashcard:<item key>')
 * stores only its card key; the TEXT is resolved from the stamped seed packs at read time
 * (api/study-service.ts reviewCardText). When a re-seed removes the source item, the card has no
 * text to show, yet it would stay due forever and hold the slate's review-clear slot shut.
 *
 * At startup, after the seed store loads, every seeded card whose source item is NOT in the store
 * is RETIRED (review_item.retired_at = load time): it leaves the queue, every due count and the
 * review-clear slot (engines/fsrs.ts REVIEWABLE_SQL, engines/streak.ts dueAsOf), and grading it
 * is refused. The row is kept (review_log rows reference it; its FSRS state is preserved), so a
 * re-seed that brings the item back un-retires the card with its schedule intact. Cards that are
 * not seed-derived (other prefixes) are never touched.
 */

export interface ReviewCardReconcileStats {
  /** seeded cards checked against the store */
  seeded: number;
  /** card keys retired by this load (source item gone) */
  retired: string[];
  /** card keys un-retired by this load (source item back) */
  restored: string[];
}

function sourceExists(store: SeedItemStore, cardKey: string): boolean | null {
  if (cardKey.startsWith(QUIZ_MISS_CARD_PREFIX)) return store.quiz(cardKey.slice(QUIZ_MISS_CARD_PREFIX.length)) !== undefined;
  if (cardKey.startsWith(FLASHCARD_CARD_PREFIX)) return store.flashcard(cardKey.slice(FLASHCARD_CARD_PREFIX.length)) !== undefined;
  return null; // not a seeded card
}

export function reconcileSeededReviewCards(db: Db, store: SeedItemStore, clock: Clock): ReviewCardReconcileStats {
  const t = nowMs(clock);
  return db.tx(() => {
    const rows = db.all<{ id: number; key: string; retired: number | null }>(
      `SELECT id, card_key AS key, retired_at AS retired FROM review_item
        WHERE substr(card_key, 1, ?) = ? OR substr(card_key, 1, ?) = ? ORDER BY id`,
      QUIZ_MISS_CARD_PREFIX.length,
      QUIZ_MISS_CARD_PREFIX,
      FLASHCARD_CARD_PREFIX.length,
      FLASHCARD_CARD_PREFIX,
    );
    const stats: ReviewCardReconcileStats = { seeded: rows.length, retired: [], restored: [] };
    for (const r of rows) {
      const exists = sourceExists(store, r.key);
      if (exists === null) continue;
      if (!exists && r.retired === null) {
        db.run('UPDATE review_item SET retired_at = ? WHERE id = ?', t, r.id);
        stats.retired.push(r.key);
      } else if (exists && r.retired !== null) {
        db.run('UPDATE review_item SET retired_at = NULL WHERE id = ?', r.id);
        stats.restored.push(r.key);
      }
    }
    return stats;
  });
}
