import { XpAwardInput, type CheckType, type XpKind, type XpZeroReason } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { getAttempt, HonestyRuleError, isRevealed, isVerifiedPass, READING_ATTEST_SQL } from './attempts.ts';
import { dayKey, nowMs, type Clock } from './clock.ts';
import { PROMOTION_MIN_COVERAGE } from './evidence.ts';

/** Spec §6.1 amounts. `code` is per difficulty point (10 x difficulty). */
export const XP_AMOUNTS: Readonly<Record<XpKind, number>> = {
  code: 10,
  quiz: 2,
  predict: 4,
  'study-quest': 50,
  reading: 5,
  'explain-back': 20,
  'patch-kata': 15,
  review: 1,
};

export const REVIEW_DAILY_CAP = 30;

/**
 * The XP kind a passing attempt on a check of this type earns. Exhaustive over
 * every check type: adding a CheckType without deciding its XP fails to
 * compile. `review` checks pay nothing through submit — FSRS reviews are paid
 * by fsrs.review() alone. Reading self-attest is not a check (no runner): it
 * pays 'reading' via selfAttestReading + awardXp.
 */
export function xpKindForCheck(type: CheckType): Exclude<XpKind, 'review' | 'reading'> | null {
  switch (type) {
    case 'quiz':
      return 'quiz';
    case 'predict-output':
      return 'predict';
    case 'study-quiz':
      return 'study-quest';
    case 'explain-back':
      return 'explain-back';
    case 'patch-kata':
      return 'patch-kata';
    case 'review':
      return null;
    case 'drill-js':
    case 'drill-cs':
    case 'drill-java':
    case 'guided-step':
    case 'http':
    case 'repo':
    case 'node-test-file':
    case 'self-run':
    case 'vitest-project':
      return 'code';
    default: {
      const unhandled: never = type;
      throw new Error(`no XP rule for check type ${String(unhandled)}`);
    }
  }
}

export function baseAmount(kind: XpKind, difficulty?: number): number {
  if (kind === 'code') {
    if (difficulty === undefined) throw new Error('code XP needs difficulty');
    return XP_AMOUNTS.code * difficulty;
  }
  return XP_AMOUNTS[kind];
}

export interface XpAward {
  id: number;
  amount: number;
  reason: XpZeroReason | null;
  day: string;
}

function insertXp(
  db: Db,
  r: { kind: XpKind; amount: number; reason: XpZeroReason | null; unitId: number | null; attemptId: number | null; trackId: string | null },
  t: number,
): XpAward {
  const day = dayKey(t);
  const { lastInsertRowid } = db.run(
    `INSERT INTO xp_event (kind, amount, reason, unit_id, attempt_id, track_id, day, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    r.kind,
    r.amount,
    r.reason,
    r.unitId,
    r.attemptId,
    r.trackId,
    day,
    t,
  );
  return { id: lastInsertRowid, amount: r.amount, reason: r.reason, day };
}

/**
 * Append one xp_event for a recorded attempt. The claim is VERIFIED against
 * the ledger before anything is paid (W1a audit #5):
 *  - code / quiz / predict / study-quest: the attempt is a verified pass (outcome
 *    pass + passing submit run) on a check whose type earns exactly that kind;
 *  - explain-back: the stored answer attempt has explain-back evidence with
 *    >= 80% coverage; patch-kata: the answer attempt has kata evidence;
 *  - reading: the attempt is a reading self-attest on a reading unit.
 * Unit, track and difficulty come from the DB, never the caller. Then, in
 * priority order: revealed => 0 forever; already paid for this unit+kind => 0
 * ('already-awarded'; also a partial unique index in SQL).
 */
export function awardXp(db: Db, input: XpAwardInput, now: Clock): XpAward {
  const x = XpAwardInput.parse(input);
  const t = nowMs(now);
  return db.tx(() => {
    const attempt = getAttempt(db, x.attemptId);
    if (x.unitId !== undefined && x.unitId !== attempt.unit_id) {
      throw new HonestyRuleError('MISMATCH', `attempt ${attempt.id} is on unit ${attempt.unit_id}, not ${x.unitId}`);
    }
    const unit = db.get<{ id: number; kind: string; track_id: string; difficulty: number | null }>(
      'SELECT id, kind, track_id, difficulty FROM unit WHERE id = ?',
      attempt.unit_id,
    )!;
    const checkType =
      attempt.check_id === null
        ? null
        : db.get<{ type: CheckType }>('SELECT type FROM "check" WHERE id = ?', attempt.check_id)!.type;
    if (checkType !== null && xpKindForCheck(checkType) !== x.kind) {
      throw new HonestyRuleError('MISMATCH', `a ${checkType} check does not earn ${x.kind} XP`);
    }

    switch (x.kind) {
      case 'code':
      case 'quiz':
      case 'predict':
      case 'study-quest':
        if (checkType === null || !isVerifiedPass(db, attempt.id)) {
          throw new HonestyRuleError('NOT_VERIFIED', `attempt ${attempt.id} is not a verified pass`);
        }
        break;
      case 'explain-back':
      case 'patch-kata': {
        const evKind = x.kind === 'explain-back' ? 'explain-back' : 'kata';
        const minScore = x.kind === 'explain-back' ? PROMOTION_MIN_COVERAGE : 0;
        const ok = db.get(
          `SELECT 1 AS x FROM evidence WHERE attempt_id = ? AND kind = ? AND score >= ?`,
          attempt.id,
          evKind,
          minScore,
        );
        if (attempt.outcome !== 'submitted' || !ok) {
          throw new HonestyRuleError('NOT_VERIFIED', `attempt ${attempt.id} has no completed ${evKind}${minScore ? ` >= ${minScore * 100}%` : ''}`);
        }
        break;
      }
      case 'reading': {
        const ok = db.get(`SELECT 1 AS x FROM attempt a JOIN unit u ON u.id = a.unit_id WHERE a.id = ? AND ${READING_ATTEST_SQL}`, attempt.id);
        if (!ok) throw new HonestyRuleError('NOT_VERIFIED', `attempt ${attempt.id} is not a reading self-attest`);
        break;
      }
    }

    let amount = baseAmount(x.kind, x.kind === 'code' ? (unit.difficulty ?? 1) : undefined);
    let reason: XpZeroReason | null = null;
    if (attempt.assistance_source === 'reveal' || isRevealed(db, unit.id)) {
      amount = 0;
      reason = 'revealed';
    } else if (db.get('SELECT 1 AS x FROM xp_event WHERE unit_id = ? AND kind = ? AND amount > 0 LIMIT 1', unit.id, x.kind)) {
      amount = 0;
      reason = 'already-awarded';
    }
    return insertXp(db, { kind: x.kind, amount, reason, unitId: unit.id, attemptId: attempt.id, trackId: unit.track_id }, t);
  });
}

/**
 * Engine-internal: 1 XP for an FSRS review, capped at 30 per local day. Called
 * only by fsrs.review() inside its transaction (the review_log row written
 * there links this xp_event). Not exposed through awardXp/XpAwardInput.
 */
export function awardReviewXp(db: Db, now: Clock): XpAward {
  const t = nowMs(now);
  const used = xpOnDay(db, dayKey(t), 'review');
  const amount = Math.max(0, Math.min(XP_AMOUNTS.review, REVIEW_DAILY_CAP - used));
  return insertXp(db, { kind: 'review', amount, reason: amount === 0 ? 'daily-cap' : null, unitId: null, attemptId: null, trackId: null }, t);
}

export function xpOnDay(db: Db, day: string, kind?: XpKind): number {
  const row = kind
    ? db.get<{ s: number | null }>('SELECT SUM(amount) AS s FROM xp_event WHERE day = ? AND kind = ?', day, kind)
    : db.get<{ s: number | null }>('SELECT SUM(amount) AS s FROM xp_event WHERE day = ?', day);
  return row?.s ?? 0;
}

export function totalXp(db: Db): number {
  return db.get<{ s: number | null }>('SELECT SUM(amount) AS s FROM xp_event')?.s ?? 0;
}

/** Per-day XP totals for the calendar heatmap, inclusive day-key range. */
export function dailyXp(db: Db, fromDay: string, toDay: string): { day: string; xp: number }[] {
  return db.all<{ day: string; xp: number }>(
    'SELECT day, SUM(amount) AS xp FROM xp_event WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day',
    fromDay,
    toDay,
  );
}
