import { CompetencyId, EvidenceInput, PROJECT_UNIT_KINDS, PROMOTION_MIN_COVERAGE, type Assistance } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { getAttempt, HonestyRuleError, isVerifiedPass, VERIFIED_PASS_SQL, type AttemptRow } from './attempts.ts';
import { DAY_MS, nowMs, type Clock } from './clock.ts';

/**
 * Competency ladder (spec §6.2) — the truth layer.
 *
 * Seven competencies, each with ONE current rating 1..5 (competency_rating);
 * history lives in the append-only evidence table. Ratings are never averaged:
 * nothing here aggregates across competencies or across evidence ratings.
 * competency_rating can only change through promote/demote: an SQL trigger
 * (migration 003) refuses any UPDATE not backed by the newest one-notch
 * promotion/demotion evidence row.
 *
 * Promotion rule: a competency moves up one notch only when, since its last
 * real rating change, ONE LINKED CHAIN holds (W1a audit #2-#4):
 *   (a) artifact — 'artifact' evidence on an attempt that is a VERIFIED pass
 *       (outcome pass + passing submit run), solo, on a PROJECT_UNIT_KINDS
 *       unit that declares the competency;
 *   (b) ITS explain-back — 'explain-back' evidence >= 80% self-scored
 *       coverage on an unassisted 'submitted' answer attempt made at/after the
 *       artifact attempt, on the artifact's unit itself or on an
 *       explain-back-kind unit that lists the artifact unit as a prerequisite;
 *   (c) changed-example retest — 'retest' evidence on a DIFFERENT, verified,
 *       solo attempt on a 'retest' unit whose variation_of_unit_id chain
 *       reaches the artifact's unit, ATTEMPTED >= 48h after the later of the
 *       artifact and explain-back ATTEMPTS.
 * All timing is on attempt.created_at (server clock at submit / answer), never on
 * when evidence was filed. Pipeline evidence must be filed with its submit (no
 * back-fill); a self-score (explain-back / kata) may be filed any time after its
 * immutable answer — the answer row, not the score, is what the legs time on.
 * A failed FSRS review of a Review-state card on a competency drops it one
 * notch (fsrs.ts -> demote).
 */

// one definition, shared with the client's self-score preview (shared/src/thresholds.ts)
export { PROMOTION_MIN_COVERAGE };
export const RETEST_MIN_DELAY_MS = 2 * DAY_MS;
export const MIN_RATING = 1;
export const MAX_RATING = 5;
/** pipeline evidence is written in the submit transaction; anything later is a back-fill */
export const PIPELINE_EVIDENCE_MAX_LAG_MS = 10 * 60 * 1000;
/*
 * Self-scored evidence (explain-back / kata) has NO filing window (ladder dead ends #1): a
 * 24h window used to void a missed item for good (no XP, no leg, no re-answer). Nothing is
 * gained by lateness: the answer is immutable and stored before the key, every leg / retest
 * times on the ANSWER attempt's created_at, and each answer is scored at most once.
 */

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

const PROJECT_KINDS_SQL = PROJECT_UNIT_KINDS.map((k) => `'${k}'`).join(', ');

function unitDeclares(db: Db, unitId: number, competency: CompetencyId): boolean {
  return db.get('SELECT 1 AS x FROM unit_competency WHERE unit_id = ? AND competency_id = ?', unitId, competency) !== undefined;
}

function unitRow(db: Db, unitId: number): { kind: string; variation_of_unit_id: number | null } {
  const row = db.get<{ kind: string; variation_of_unit_id: number | null }>('SELECT kind, variation_of_unit_id FROM unit WHERE id = ?', unitId);
  if (!row) throw new Error(`unit ${unitId} not found`);
  return row;
}

/** True when `unitId`'s variation_of_unit_id chain reaches `ancestorId` (a variation of a variation counts). */
export function isVariationOf(db: Db, unitId: number, ancestorId: number): boolean {
  const seen = new Set<number>([unitId]);
  let cur: number | null = unitRow(db, unitId).variation_of_unit_id;
  while (cur !== null && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = unitRow(db, cur).variation_of_unit_id;
  }
  return false;
}

function hasSubmitRun(db: Db, attemptId: number): boolean {
  return db.get(`SELECT 1 AS x FROM run WHERE attempt_id = ? AND kind = 'submit'`, attemptId) !== undefined;
}

/**
 * Append an evidence row. Everything that makes evidence count is DERIVED:
 *  - assistance from the linked attempt (self-flag / reveal auto-flag);
 *  - `verified` only from a passing submit run on that attempt; assessor
 *    'pipeline' for run-backed kinds, 'self' for self-scored ones;
 *  - artifact/retest/submit/explain-back/kata need a linked attempt, filed
 *    promptly (no back-filling old attempts);
 *  - the competency must be one the unit declares.
 */
export function recordEvidence(db: Db, input: EvidenceInput, now: Clock): EvidenceRow {
  const e = EvidenceInput.parse(input);
  const t = nowMs(now);
  return db.tx(() => {
    let attempt: AttemptRow | undefined;
    let unitId = e.unitId;
    let assistance: Assistance = 'none';
    if (e.attemptId !== undefined) {
      attempt = getAttempt(db, e.attemptId);
      if (unitId !== undefined && unitId !== attempt.unit_id) {
        throw new HonestyRuleError('MISMATCH', `attempt ${attempt.id} is on unit ${attempt.unit_id}, not ${unitId}`);
      }
      unitId = attempt.unit_id;
      assistance = attempt.assistance_source;
      if (t < attempt.created_at) throw new HonestyRuleError('STALE', 'evidence cannot predate its attempt');
    }
    if (unitId !== undefined && !unitDeclares(db, unitId, e.competency)) {
      throw new HonestyRuleError('MISMATCH', `unit ${unitId} does not declare competency ${e.competency}`);
    }

    let assessor: 'pipeline' | 'self' = 'self';
    let verified = false;
    let score: number | null = null;
    let rating: number | null = null;
    switch (e.kind) {
      case 'artifact':
      case 'retest':
      case 'submit': {
        const a = attempt!;
        if (a.check_id === null || !hasSubmitRun(db, a.id)) {
          throw new HonestyRuleError('NOT_VERIFIED', `${e.kind} evidence needs a graded submit attempt (attempt ${a.id} has no submit run)`);
        }
        if (t - a.created_at > PIPELINE_EVIDENCE_MAX_LAG_MS) {
          throw new HonestyRuleError('STALE', `${e.kind} evidence must be recorded with its submit, not back-filled`);
        }
        const kind = unitRow(db, a.unit_id);
        if (e.kind === 'artifact' && !(PROJECT_UNIT_KINDS as readonly string[]).includes(kind.kind)) {
          throw new HonestyRuleError('WRONG_UNIT_KIND', `artifact evidence needs a project unit (${PROJECT_UNIT_KINDS.join('/')}), not ${kind.kind}`);
        }
        if (e.kind === 'retest' && (kind.kind !== 'retest' || kind.variation_of_unit_id === null)) {
          throw new HonestyRuleError('WRONG_UNIT_KIND', 'retest evidence needs a retest unit that is a variation of another unit');
        }
        assessor = 'pipeline';
        verified = isVerifiedPass(db, a.id);
        score = verified ? 1 : 0;
        break;
      }
      case 'explain-back':
      case 'kata': {
        const a = attempt!;
        if (a.outcome !== 'submitted' || a.answer === null) {
          throw new HonestyRuleError('NOT_VERIFIED', `${e.kind} evidence needs the stored answer attempt (outcome 'submitted')`);
        }
        if (e.kind === 'kata' && unitRow(db, a.unit_id).kind !== 'patch-kata') {
          throw new HonestyRuleError('WRONG_UNIT_KIND', 'kata evidence needs a patch-kata unit');
        }
        score = e.score!;
        break;
      }
      case 'self-assessment':
        rating = e.rating ?? null;
        break;
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
      assessor,
      rating,
      verified,
      score,
      t,
    );
    return getEvidence(db, lastInsertRowid);
  });
}

/**
 * Engine-internal: the evidence row every competency-linked FSRS review writes
 * (spec §6.2 "every submit/review/kata writes an evidence row"). Assessor
 * pipeline (the scheduler observed it), no attempt.
 */
export function writeReviewEvidence(
  db: Db,
  r: { competency: CompetencyId; unitId: number | null; cardKey: string; grade: string; prevDueAt: number; nextDueAt: number },
  t: number,
): number {
  return db.run(
    `INSERT INTO evidence (competency_id, attempt_id, unit_id, kind, intention, observation, assistance, assessor, rating, verified, score, created_at)
     VALUES (?, NULL, ?, 'review', ?, ?, 'none', 'pipeline', NULL, ?, NULL, ?)`,
    r.competency,
    r.unitId,
    `FSRS review of ${r.cardKey}`,
    `graded ${r.grade}; due moved ${new Date(r.prevDueAt).toISOString()} -> ${new Date(r.nextDueAt).toISOString()}`,
    r.grade !== 'again',
    t,
  ).lastInsertRowid;
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

/**
 * Start of the current promotion window: the latest promotion, or demotion that
 * actually lowered the rating (a floor demotion 1 -> 1 is logged but does not
 * discard banked legs — W1a audit #10), at or before `t` (audit #11).
 */
export function lastRatingChangeAt(db: Db, competency: CompetencyId, t: number): number {
  const row = db.get<{ t: number | null }>(
    `SELECT MAX(e.created_at) AS t FROM evidence e
      WHERE e.competency_id = ? AND e.kind IN ('promotion', 'demotion') AND e.created_at <= ?
        AND (e.kind = 'promotion' OR e.rating < COALESCE(
              (SELECT p.rating FROM evidence p
                WHERE p.competency_id = e.competency_id AND p.kind IN ('promotion', 'demotion') AND p.id < e.id
                ORDER BY p.id DESC LIMIT 1), 1))`,
    competency,
    t,
  );
  return row?.t ?? -1;
}

export interface PromotionEvaluation {
  competency: CompetencyId;
  rating: number;
  eligible: boolean;
  legs: { artifact: number | null; explainBack: number | null; retest: number | null };
  missing: string[];
}

interface LegRow {
  id: number;
  attemptId: number;
  unitId: number;
  at: number;
}

export function evaluatePromotion(db: Db, competency: CompetencyId, now: Clock): PromotionEvaluation {
  CompetencyId.parse(competency);
  const t = nowMs(now);
  const since = lastRatingChangeAt(db, competency, t);
  const rating = getRating(db, competency);

  // (a) candidate artifacts, oldest first
  const artifacts = db.all<LegRow>(
    `SELECT e.id AS id, a.id AS attemptId, a.unit_id AS unitId, a.created_at AS at
       FROM evidence e JOIN attempt a ON a.id = e.attempt_id JOIN unit u ON u.id = a.unit_id
      WHERE e.competency_id = ? AND e.kind = 'artifact' AND e.verified = 1 AND e.assessor = 'pipeline'
        AND e.assistance = 'none' AND a.mode = 'solo' AND ${VERIFIED_PASS_SQL}
        AND u.kind IN (${PROJECT_KINDS_SQL})
        AND EXISTS (SELECT 1 FROM unit_competency uc WHERE uc.unit_id = u.id AND uc.competency_id = e.competency_id)
        AND a.created_at > ? AND e.created_at > ? AND e.created_at <= ?
      ORDER BY a.created_at, e.id`,
    competency,
    since,
    since,
    t,
  );

  // (b) explain-backs of a given artifact
  const explainBacksFor = (art: LegRow) =>
    db.all<LegRow>(
      `SELECT e.id AS id, a.id AS attemptId, a.unit_id AS unitId, a.created_at AS at
         FROM evidence e JOIN attempt a ON a.id = e.attempt_id JOIN unit u ON u.id = a.unit_id
        WHERE e.competency_id = ? AND e.kind = 'explain-back' AND e.score >= ? AND e.assistance = 'none'
          AND a.mode = 'solo' AND a.outcome = 'submitted' AND a.answer IS NOT NULL
          AND (a.unit_id = ? OR (u.kind = 'explain-back' AND EXISTS (
                SELECT 1 FROM unit_prerequisite p WHERE p.unit_id = u.id AND p.prereq_unit_id = ?)))
          AND a.created_at >= ? AND a.created_at > ? AND e.created_at > ? AND e.created_at <= ?
        ORDER BY a.created_at, e.id`,
      competency,
      PROMOTION_MIN_COVERAGE,
      art.unitId,
      art.unitId,
      art.at,
      since,
      since,
      t,
    );

  // (c) a changed-example retest of that artifact's unit, >= 48h after both
  const retestFor = (art: LegRow, eb: LegRow) =>
    db
      .all<LegRow>(
        `SELECT e.id AS id, a.id AS attemptId, a.unit_id AS unitId, a.created_at AS at
           FROM evidence e JOIN attempt a ON a.id = e.attempt_id JOIN unit u ON u.id = a.unit_id
          WHERE e.competency_id = ? AND e.kind = 'retest' AND e.verified = 1 AND e.assessor = 'pipeline'
            AND e.assistance = 'none' AND a.mode = 'solo' AND ${VERIFIED_PASS_SQL}
            AND u.kind = 'retest' AND a.id NOT IN (?, ?)
            AND a.created_at >= ? AND a.created_at <= ? AND e.created_at <= ?
          ORDER BY a.created_at, e.id`,
        competency,
        art.attemptId,
        eb.attemptId,
        Math.max(art.at, eb.at) + RETEST_MIN_DELAY_MS,
        t,
        t,
      )
      .find((r) => isVariationOf(db, r.unitId, art.unitId));

  let best: { artifact: number | null; explainBack: number | null; retest: number | null } = {
    artifact: null,
    explainBack: null,
    retest: null,
  };
  let found = false;
  for (const art of artifacts) {
    if (best.artifact === null) best = { artifact: art.id, explainBack: null, retest: null };
    for (const eb of explainBacksFor(art)) {
      if (best.explainBack === null) best = { artifact: art.id, explainBack: eb.id, retest: null };
      const rt = retestFor(art, eb);
      if (rt) {
        best = { artifact: art.id, explainBack: eb.id, retest: rt.id };
        found = true;
        break;
      }
    }
    if (found) break;
  }

  const missing: string[] = [];
  if (best.artifact === null) missing.push('artifact: no unassisted, run-verified project artifact since the last rating change');
  if (best.explainBack === null) {
    missing.push(`explain-back: none of the artifact's explain-backs reaches ${PROMOTION_MIN_COVERAGE * 100}% unassisted coverage`);
  }
  if (best.retest === null) {
    missing.push("retest: no unassisted, run-verified changed-example retest of the artifact's unit >= 2 days after artifact + explain-back");
  }
  if (rating >= MAX_RATING) missing.push(`rating already at max (${MAX_RATING})`);

  return { competency, rating, eligible: missing.length === 0, legs: best, missing };
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
  // guarded by the competency_rating_guarded_update trigger (migration 003)
  db.run(
    'UPDATE competency_rating SET rating = ?, last_evidence_id = ?, updated_at = ? WHERE competency_id = ?',
    to,
    lastInsertRowid,
    t,
    competency,
  );
  return lastInsertRowid;
}

/** Promote one notch iff one linked three-leg chain holds. Returns null when not eligible. */
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
 * even at the floor so the event is never silently lost; a demotion that
 * actually lowers the rating resets the promotion window (legs re-earned),
 * a floor demotion does not.
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
