import type { SeedQuizItem } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { DAY_MS, nowMs, type Clock } from './clock.ts';
import { meetsCorePct } from './campaign.ts';
import { addReviewItem, reviveRetiredCard } from './fsrs.ts';

/**
 * W8 study-quest quiz gate (spec §4 "Study quest": reading steps + pre-seeded quiz gate,
 * pass >= 80%; misses become FSRS cards).
 *
 *   gradeStudyQuiz   PURE: the full answer set against the stamped quiz items' single keys.
 *                    Pass = correct/total >= passPct in integer math (79.99% never rounds
 *                    up to 80%), the same rule as the campaign's act gate.
 *   queueQuizMisses  each missed item becomes ONE review_item (kind 'quiz-miss', card key
 *                    'quiz-miss:<item key>') due the next day; a re-attempt that misses it
 *                    again finds the existing card and leaves its schedule alone (dedup).
 *   enrollFlashcards the quest's seeded flashcards become review cards (kind 'card',
 *                    'flashcard:<item key>') on the quest's first pass, due the next day.
 * Card TEXT is never stored: the review queue resolves it from the stamped pack by card key.
 */

export const QUIZ_MISS_CARD_PREFIX = 'quiz-miss:';
export const FLASHCARD_CARD_PREFIX = 'flashcard:';

export class StudyQuizShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudyQuizShapeError';
  }
}

export interface StudyQuizGrade {
  correct: number;
  total: number;
  score: number;
  passed: boolean;
  items: { itemKey: string; correct: boolean }[];
  missed: string[];
}

function isCorrect(item: SeedQuizItem, answer: number | string): boolean {
  const c = item.check;
  if (c.grading === 'choice') return typeof answer === 'number' && answer === c.answerKey;
  if (c.grading === 'exact') return typeof answer === 'string' && answer.trim() === String(c.answerKey).trim();
  throw new StudyQuizShapeError(`quiz item ${item.key} is self-graded; a study-quest gate needs single-keyed items`);
}

/** PURE: grade one full answer set (answers[i] answers items[i]). */
export function gradeStudyQuiz(items: readonly SeedQuizItem[], answers: readonly (number | string)[], passPct: number): StudyQuizGrade {
  if (items.length === 0) throw new StudyQuizShapeError('a study-quest gate needs at least one question');
  if (answers.length !== items.length) {
    throw new StudyQuizShapeError(`send exactly ${items.length} answers (one per question, in order); got ${answers.length}`);
  }
  const graded = items.map((it, i) => ({ itemKey: it.key, correct: isCorrect(it, answers[i]!) }));
  const correct = graded.filter((g) => g.correct).length;
  return {
    correct,
    total: items.length,
    score: correct / items.length,
    passed: meetsCorePct(correct, items.length, passPct),
    items: graded,
    missed: graded.filter((g) => !g.correct).map((g) => g.itemKey),
  };
}

function enqueue(db: Db, unitId: number, cardKeys: readonly string[], kind: 'quiz-miss' | 'card', dueAt: number, now: Clock) {
  let created = 0;
  let alreadyQueued = 0;
  for (const cardKey of cardKeys) {
    if (db.get('SELECT 1 AS x FROM review_item WHERE card_key = ?', cardKey)) {
      // the item is being graded / enrolled, so it exists again: a card retired by an earlier
      // re-seed (store/review-cards.ts) is live again with its FSRS memory, but a due time that went
      // stale while it was retired moves to `dueAt` like a new card's (F7b: never instantly due)
      reviveRetiredCard(db, cardKey, dueAt, now);
      alreadyQueued++;
      continue;
    }
    addReviewItem(db, { cardKey, kind, unitId, dueAt }, now);
    created++;
  }
  return { created, alreadyQueued };
}

/** Misses -> FSRS cards due the next day (deduped by card key). Call inside the submit transaction. */
export function queueQuizMisses(db: Db, unitId: number, missedItemKeys: readonly string[], now: Clock): { created: number; alreadyQueued: number; dueAt: number | null } {
  if (missedItemKeys.length === 0) return { created: 0, alreadyQueued: 0, dueAt: null };
  const keys = missedItemKeys.map((k) => `${QUIZ_MISS_CARD_PREFIX}${k}`);
  const counts = enqueue(db, unitId, keys, 'quiz-miss', nowMs(now) + DAY_MS, now);
  // the earliest due time among these misses' cards (a deduped card keeps its own schedule)
  const row = db.get<{ d: number | null }>(`SELECT MIN(due_at) AS d FROM review_item WHERE card_key IN (${keys.map(() => '?').join(', ')})`, ...keys);
  return { ...counts, dueAt: row?.d ?? null };
}

/** The quest's seeded flashcards -> FSRS cards due the next day (first pass; deduped by card key). */
export function enrollFlashcards(db: Db, unitId: number, flashcardItemKeys: readonly string[], now: Clock): number {
  if (flashcardItemKeys.length === 0) return 0;
  return enqueue(db, unitId, flashcardItemKeys.map((k) => `${FLASHCARD_CARD_PREFIX}${k}`), 'card', nowMs(now) + DAY_MS, now).created;
}
