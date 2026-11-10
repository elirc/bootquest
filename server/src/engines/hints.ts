import type { Db } from '../db/database.ts';
import { VERIFIED_PASS_SQL } from './attempts.ts';
import { nowMs, type Clock } from './clock.ts';

/**
 * f52 U13 (council ruling 6): progressive hints, the cheaper step before "Reveal solution".
 * The ledger is hint_taken (migration 019, append-only). The rules:
 *   - hints are served on drill / code-check units only (never quiz, study, retest, explain-back, kata);
 *   - the servable hints are the authored ones EXCEPT the last (some banks author the full solution as the
 *     last hint): 1 authored hint serves none, 3 serve 2;
 *   - hint N+1 is available only after >= 1 recorded failed graded submit on the unit, and never after a
 *     verified pass;
 *   - each hint taken at/before a passing attempt cuts that pass's XP by 25% (floor 50%; xp.ts). Reveal
 *     stays 0 XP;
 *   - an attempt with a hint taken at/before it is a verified pass but NOT unassisted ladder evidence
 *     (UNASSISTED_PASS_SQL, used by the promotion legs in evidence.ts and the solo-pass reads in ladder.ts).
 * Assistance (shared/src/enums.ts) is untouched: hints are a server-side fact read from this table.
 */

/** XP cut per hint taken before the pass, and the floor of the multiplier. */
export const HINT_XP_STEP = 0.25;
export const HINT_XP_FLOOR = 0.5;

/**
 * SQL predicate (alias `a` = attempt): no hint was taken on the attempt's unit at or before the attempt.
 * At-or-before (not strictly before): a hint and a submit in the same millisecond count as hinted.
 */
export const HINT_FREE_SQL = `NOT EXISTS (SELECT 1 FROM hint_taken h WHERE h.unit_id = a.unit_id AND h.created_at <= a.created_at)`;

/**
 * SQL predicate (alias `a` = attempt): an UNASSISTED verified pass — a verified pass (VERIFIED_PASS_SQL)
 * in solo mode (no self-flag, no reveal: attempts.ts deriveMode) with no hint taken at/before it
 * (HINT_FREE_SQL). Assistance (shared/src/enums.ts) has no 'hint' value, so a hinted pass is stored
 * solo / assistance 'none'; this predicate is the ONE place that folds the hint ledger in, and every
 * promotion leg (evidence.ts) and ladder solo-pass read (ladder.ts) uses it.
 */
export const UNASSISTED_PASS_SQL = `(a.mode = 'solo' AND ${VERIFIED_PASS_SQL} AND ${HINT_FREE_SQL})`;

/** The authored hints a unit may serve: all but the last one. */
export function servableHints(authored: readonly string[] | undefined): string[] {
  return authored && authored.length > 1 ? authored.slice(0, -1) : [];
}

/** Hints taken on a unit, in the order they were taken (1-based idx). */
export function hintsTaken(db: Db, unitId: number): { idx: number; createdAt: number }[] {
  return db.all<{ idx: number; createdAt: number }>('SELECT idx, created_at AS createdAt FROM hint_taken WHERE unit_id = ? ORDER BY idx', unitId);
}

/** Number of hints taken on a unit at or before time `t`. */
export function hintsTakenAtOrBefore(db: Db, unitId: number, t: number): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM hint_taken WHERE unit_id = ? AND created_at <= ?', unitId, t)!.n;
}

/** True once any hint was ever taken on the unit (every later attempt is hinted). */
export function anyHintTaken(db: Db, unitId: number): boolean {
  return db.get('SELECT 1 AS x FROM hint_taken WHERE unit_id = ? LIMIT 1', unitId) !== undefined;
}

/** The pass-XP multiplier after `n` hints: 1, 0.75, 0.5, 0.5, ... */
export function hintXpMultiplier(n: number): number {
  return Math.max(HINT_XP_FLOOR, 1 - HINT_XP_STEP * Math.max(0, n));
}

/** True when the unit has at least one failed (non-pass) graded submit. */
export function hasFailedSubmit(db: Db, unitId: number): boolean {
  return (
    db.get(
      `SELECT 1 AS x FROM attempt a WHERE a.unit_id = ? AND a.outcome IN ('fail', 'todo', 'error')
         AND EXISTS (SELECT 1 FROM run r WHERE r.attempt_id = a.id AND r.kind = 'submit') LIMIT 1`,
      unitId,
    ) !== undefined
  );
}

/** True when the unit has a verified pass (any mode). */
export function hasVerifiedPass(db: Db, unitId: number): boolean {
  return db.get(`SELECT 1 AS x FROM attempt a WHERE a.unit_id = ? AND ${VERIFIED_PASS_SQL} LIMIT 1`, unitId) !== undefined;
}

/** Append the next hint row (idx = taken + 1). The caller has checked the rules. */
export function recordHint(db: Db, unitId: number, now: Clock): number {
  return db.tx(() => {
    const idx = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM hint_taken WHERE unit_id = ?', unitId)!.n + 1;
    db.run('INSERT INTO hint_taken (unit_id, idx, created_at) VALUES (?, ?, ?)', unitId, idx, nowMs(now));
    return idx;
  });
}
