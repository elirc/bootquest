import { CompetencyId, EvidenceInput, type Assistance } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { getAttempt } from './attempts.ts';
import { DAY_MS, nowMs, type Clock } from './clock.ts';

/**
 * Competency ladder (spec §6.2) — the truth layer.
 *
 * Seven competencies, each with ONE current rating 1..5 (competency_rating);
 * history lives in the append-only evidence table. Ratings are never averaged:
 * nothing here aggregates across competencies or across evidence ratings.
 *
 * Promotion rule: a competency moves up one notch only when, since its last
 * rating change, ALL THREE legs hold:
 *   (a) an independent verified artifact — kind 'artifact', verified, assessor
 *       'pipeline', assistance 'none';
 *   (b) an explain-back with >= 80% key-point coverage, unassisted;
 *   (c) a changed-example retest — kind 'retest', verified, pipeline,
 *       assistance 'none' — created >= 2 days (48h) after leg (b).
 * A failed FSRS review on a competency-linked item drops it one notch (demote).
 */

export const PROMOTION_MIN_COVERAGE = 0.8;
export const RETEST_MIN_DELAY_MS = 2 * DAY_MS;
export const MIN_RATING = 1;
export const MAX_RATING = 5;

export interface EvidenceRow {
  id: number;
  competency_id: CompetencyId;
  attempt_id: number | null;
  unit_id: number | null;
  kind: string;
  intention: string;
  observation: string;
  assistance: Assistance;
  assessor: 'pipeline' | 'self';
  rating: number | null;
  verified: boolean;
  score: number | null;
  created_at: number;
}

/**
 * Append an evidence row. When linked to an attempt, assistance is DERIVED from
 * the attempt (self-flag or reveal auto-flag) — a caller cannot launder an
 * assisted attempt into unassisted evidence.
 */
export function recordEvidence(db: Db, input: EvidenceInput, now: Clock): EvidenceRow {
  const e = EvidenceInput.parse(input);
  let assistance: Assistance = e.assistance;
  let unitId = e.unitId;
  if (e.attemptId !== undefined) {
    const attempt = getAttempt(db, e.attemptId);
    assistance = attempt.assistance_source;
    unitId ??= attempt.unit_id;
  }
  const { lastInsertRowid } = db.run(
    `INSERT INTO evidence (competency_id, attempt_id, unit_id, kind, intention, observation, assistance, assessor, rating, verified, score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.competency,
    e.attemptId,
    unitId,
    e.kind,
    e.intention,
    e.observation,
    assistance,
    e.assessor,
    e.rating,
    e.verified,
    e.score,
    nowMs(now),
  );
  return getEvidence(db, lastInsertRowid);
}

export function getEvidence(db: Db, id: number): EvidenceRow {
  const row = db.get<EvidenceRow>('SELECT * FROM evidence WHERE id = ?', id);
  if (!row) throw new Error(`evidence ${id} not found`);
  return row;
}

export function getRating(db: Db, competency: CompetencyId): number {
  const row = db.get<{ rating: number }>('SELECT rating FROM competency_rating WHERE competency_id = ?', competency);
  if (!row) throw new Error(`unknown competency ${competency}`);
  return row.rating;
}

/** All seven current ratings — one integer per competency, never an aggregate. */
export function getRatings(db: Db): { competency: CompetencyId; rating: number; lastEvidenceId: number | null }[] {
  return db.all<{ competency: CompetencyId; rating: number; lastEvidenceId: number | null }>(
    `SELECT r.competency_id AS competency, r.rating AS rating, r.last_evidence_id AS lastEvidenceId
       FROM competency_rating r JOIN competency c ON c.id = r.competency_id ORDER BY c.sort_order`,
  );
}

function lastRatingChangeAt(db: Db, competency: CompetencyId): number {
  const row = db.get<{ t: number | null }>(
    `SELECT MAX(created_at) AS t FROM evidence WHERE competency_id = ? AND kind IN ('promotion', 'demotion')`,
    competency,
  );
  return row?.t ?? Number.NEGATIVE_INFINITY;
}

export interface PromotionEvaluation {
  competency: CompetencyId;
  rating: number;
  eligible: boolean;
  legs: { artifact: number | null; explainBack: number | null; retest: number | null };
  missing: string[];
}

export function evaluatePromotion(db: Db, competency: CompetencyId, now: Clock): PromotionEvaluation {
  CompetencyId.parse(competency);
  const t = nowMs(now);
  const since = lastRatingChangeAt(db, competency);
  const sinceParam = Number.isFinite(since) ? since : -1;
  const rating = getRating(db, competency);

  const artifact = db.get<{ id: number }>(
    `SELECT id FROM evidence
      WHERE competency_id = ? AND kind = 'artifact' AND verified = 1 AND assessor = 'pipeline'
        AND assistance = 'none' AND created_at > ? AND created_at <= ?
      ORDER BY created_at, id LIMIT 1`,
    competency,
    sinceParam,
    t,
  );
  const explainBack = db.get<{ id: number; created_at: number }>(
    `SELECT id, created_at FROM evidence
      WHERE competency_id = ? AND kind = 'explain-back' AND score >= ? AND assistance = 'none'
        AND created_at > ? AND created_at <= ?
      ORDER BY created_at, id LIMIT 1`,
    competency,
    PROMOTION_MIN_COVERAGE,
    sinceParam,
    t,
  );
  const retest = explainBack
    ? db.get<{ id: number }>(
        `SELECT id FROM evidence
          WHERE competency_id = ? AND kind = 'retest' AND verified = 1 AND assessor = 'pipeline'
            AND assistance = 'none' AND created_at >= ? AND created_at <= ?
          ORDER BY created_at, id LIMIT 1`,
        competency,
        explainBack.created_at + RETEST_MIN_DELAY_MS,
        t,
      )
    : undefined;

  const missing: string[] = [];
  if (!artifact) missing.push('artifact: no unassisted, pipeline-verified artifact since last rating change');
  if (!explainBack) missing.push(`explain-back: none with >= ${PROMOTION_MIN_COVERAGE * 100}% coverage since last rating change`);
  if (!retest) missing.push('retest: no unassisted verified changed-example retest >= 2 days after the explain-back');
  if (rating >= MAX_RATING) missing.push(`rating already at max (${MAX_RATING})`);

  return {
    competency,
    rating,
    eligible: missing.length === 0,
    legs: { artifact: artifact?.id ?? null, explainBack: explainBack?.id ?? null, retest: retest?.id ?? null },
    missing,
  };
}

export interface RatingChange {
  competency: CompetencyId;
  from: number;
  to: number;
  evidenceId: number;
}

function writeRatingChange(
  db: Db,
  competency: CompetencyId,
  kind: 'promotion' | 'demotion',
  to: number,
  observation: string,
  t: number,
): number {
  const { lastInsertRowid } = db.run(
    `INSERT INTO evidence (competency_id, attempt_id, unit_id, kind, intention, observation, assistance, assessor, rating, verified, score, created_at)
     VALUES (?, NULL, NULL, ?, ?, ?, 'none', 'pipeline', ?, 1, NULL, ?)`,
    competency,
    kind,
    kind === 'promotion' ? 'promotion rule evaluated' : 'demotion on failed review',
    observation,
    to,
    t,
  );
  db.run(
    'UPDATE competency_rating SET rating = ?, last_evidence_id = ?, updated_at = ? WHERE competency_id = ?',
    to,
    lastInsertRowid,
    t,
    competency,
  );
  return lastInsertRowid;
}

/** Promote one notch iff all three legs hold. Returns null when not eligible. */
export function promoteIfEligible(db: Db, competency: CompetencyId, now: Clock): RatingChange | null {
  return db.tx(() => {
    const ev = evaluatePromotion(db, competency, now);
    if (!ev.eligible) return null;
    const to = ev.rating + 1;
    const evidenceId = writeRatingChange(
      db,
      competency,
      'promotion',
      to,
      `legs: artifact #${ev.legs.artifact}, explain-back #${ev.legs.explainBack}, retest #${ev.legs.retest}`,
      nowMs(now),
    );
    return { competency, from: ev.rating, to, evidenceId };
  });
}

/**
 * Drop one notch (floor 1) and log a demotion evidence row. The row is written
 * even at the floor so the event is never silently lost. Resets the promotion
 * window: legs must be re-earned after a demotion.
 */
export function demote(db: Db, competency: CompetencyId, now: Clock, observation: string): RatingChange {
  CompetencyId.parse(competency);
  return db.tx(() => {
    const from = getRating(db, competency);
    const to = Math.max(MIN_RATING, from - 1);
    const evidenceId = writeRatingChange(db, competency, 'demotion', to, observation, nowMs(now));
    return { competency, from, to, evidenceId };
  });
}
