import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';
import { ReviewGrade, type CompetencyId } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { nowMs, type Clock } from './clock.ts';
import { HonestyRuleError } from './attempts.ts';
import { demote, writeReviewEvidence, type RatingChange } from './evidence.ts';
import { awardReviewXp, type XpAward } from './xp.ts';

/**
 * FSRS review engine over ts-fsrs (pinned 5.2.3). Fuzz is disabled so due
 * dates are deterministic under an injected clock.
 */
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

const GRADE_TO_RATING: Readonly<Record<ReviewGrade, Grade>> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export interface ReviewItemRow {
  id: number;
  card_key: string;
  /** 'retest' rows are changed-example retest SCHEDULES (engines/ladder.ts), never FSRS cards */
  kind: 'card' | 'finding' | 'quiz-miss' | 'concept' | 'retest';
  unit_id: number | null;
  content_ref_id: number | null;
  competency_id: CompetencyId | null;
  fsrs_state: string;
  due_at: number;
  created_at: number;
  updated_at: number;
}

/** ts-fsrs Card <-> JSON (Dates as epoch ms). */
export function serializeCard(card: Card): string {
  return JSON.stringify({
    ...card,
    due: card.due.getTime(),
    last_review: card.last_review ? card.last_review.getTime() : null,
  });
}

export function deserializeCard(json: string): Card {
  const raw = JSON.parse(json) as Omit<Card, 'due' | 'last_review'> & { due: number; last_review: number | null };
  const card: Card = { ...raw, due: new Date(raw.due), last_review: undefined };
  if (raw.last_review !== null) card.last_review = new Date(raw.last_review);
  return card;
}

export function newCard(now: Clock): Card {
  return createEmptyCard(new Date(nowMs(now)));
}

/** Pure preview: the card that `grade` would produce at `now`. */
export function schedule(card: Card, grade: ReviewGrade, now: Clock): Card {
  return scheduler.next(card, new Date(nowMs(now)), GRADE_TO_RATING[ReviewGrade.parse(grade)]).card;
}

export interface NewReviewItem {
  cardKey: string;
  /** FSRS cards only; retest schedules are written by engines/ladder.ts */
  kind?: Exclude<ReviewItemRow['kind'], 'retest'>;
  unitId?: number;
  contentRefId?: number;
  competencyId?: CompetencyId;
}

export function addReviewItem(db: Db, item: NewReviewItem, now: Clock): ReviewItemRow {
  const t = nowMs(now);
  const card = newCard(now);
  const { lastInsertRowid } = db.run(
    `INSERT INTO review_item (card_key, kind, unit_id, content_ref_id, competency_id, fsrs_state, due_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.cardKey,
    item.kind ?? 'card',
    item.unitId,
    item.contentRefId,
    item.competencyId,
    serializeCard(card),
    card.due.getTime(),
    t,
    t,
  );
  return getReviewItem(db, lastInsertRowid);
}

export function getReviewItem(db: Db, id: number): ReviewItemRow {
  const row = db.get<ReviewItemRow>('SELECT * FROM review_item WHERE id = ?', id);
  if (!row) throw new Error(`review_item ${id} not found`);
  return row;
}

export function dueItems(db: Db, now: Clock): ReviewItemRow[] {
  return db.all<ReviewItemRow>(`SELECT * FROM review_item WHERE due_at <= ? AND kind <> 'retest' ORDER BY due_at, id`, nowMs(now));
}

export function dueCount(db: Db, now: Clock): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM review_item WHERE due_at <= ? AND kind <> 'retest'`, nowMs(now))?.n ?? 0;
}

export interface ReviewOutcome {
  item: ReviewItemRow;
  prevDueAt: number;
  nextDueAt: number;
  state: State;
  xp: XpAward;
  /** set when a failed review on a competency-linked item demoted that competency */
  demotion: RatingChange | null;
}

export interface ReviewOptions {
  /** demotion hook — called after the demotion evidence row is written */
  onDemotion?: (change: RatingChange) => void;
}

/**
 * Grade one review: reschedule via FSRS, append review_log, award 1 XP
 * (capped 30/day), write a 'review' evidence row for a competency-linked item
 * (spec §6.2: every review writes evidence), and — only on a LAPSE, i.e.
 * 'again' on a card that was in FSRS Review state before this grade — demote
 * that competency one notch. Again on a New/Learning/Relearning card is not
 * forgetting learned material and does not demote (W1a audit #7).
 * Cards that are not due yet are refused (no early-review XP farming).
 */
export function review(db: Db, itemId: number, grade: ReviewGrade, now: Clock, opts: ReviewOptions = {}): ReviewOutcome {
  const g = ReviewGrade.parse(grade);
  const t = nowMs(now);
  const outcome = db.tx(() => {
    const item = getReviewItem(db, itemId);
    if (item.kind === 'retest') {
      throw new HonestyRuleError('WRONG_UNIT_KIND', `review item ${itemId} is a scheduled changed-example retest: submit its unit, it is not graded by recall`);
    }
    if (item.due_at > t) throw new HonestyRuleError('NOT_DUE', `review item ${itemId} is not due until ${new Date(item.due_at).toISOString()}`);
    const before = deserializeCard(item.fsrs_state);
    const next = schedule(before, g, now);
    db.run(
      'UPDATE review_item SET fsrs_state = ?, due_at = ?, updated_at = ? WHERE id = ?',
      serializeCard(next),
      next.due.getTime(),
      t,
      itemId,
    );
    const xp = awardReviewXp(db, now);
    let demotion: RatingChange | null = null;
    if (item.competency_id !== null) {
      writeReviewEvidence(
        db,
        { competency: item.competency_id, unitId: item.unit_id, cardKey: item.card_key, grade: g, prevDueAt: item.due_at, nextDueAt: next.due.getTime() },
        t,
      );
      if (g === 'again' && before.state === State.Review) {
        demotion = demote(db, item.competency_id, now, `lapse: failed FSRS review of ${item.card_key}`);
      }
    }
    db.run(
      `INSERT INTO review_log (review_item_id, rating, prev_due_at, next_due_at, xp_event_id, demotion_evidence_id, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      itemId,
      g,
      item.due_at,
      next.due.getTime(),
      xp.id,
      demotion?.evidenceId,
      t,
    );
    return {
      item: getReviewItem(db, itemId),
      prevDueAt: item.due_at,
      nextDueAt: next.due.getTime(),
      state: next.state,
      xp,
      demotion,
    };
  });
  if (outcome.demotion && opts.onDemotion) opts.onDemotion(outcome.demotion);
  return outcome;
}
