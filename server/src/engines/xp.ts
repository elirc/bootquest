import { XpAwardInput, type XpKind, type XpZeroReason } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { isRevealed } from './attempts.ts';
import { dayKey, nowMs, type Clock } from './clock.ts';

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

/**
 * Append one xp_event (the ledger is append-only; zero awards are recorded with
 * their reason so the ledger explains itself). Rules, in priority order:
 *  1. revealed  — any reveal on the unit => 0 XP forever on that exercise;
 *  2. daily-cap — FSRS reviews earn 1 each, capped at 30/day;
 *  3. already-awarded — non-review kinds pay out once per unit (no farming by
 *     re-submitting a passed exercise).
 */
export function awardXp(db: Db, input: XpAwardInput, now: Clock): XpAward {
  const x = XpAwardInput.parse(input);
  const t = nowMs(now);
  const day = dayKey(t);

  let unitId = x.unitId;
  if (unitId === undefined && x.attemptId !== undefined) {
    unitId = db.get<{ unit_id: number }>('SELECT unit_id FROM attempt WHERE id = ?', x.attemptId)?.unit_id;
  }

  return db.tx(() => {
    let amount = baseAmount(x.kind, x.difficulty);
    let reason: XpZeroReason | null = null;

    if (unitId !== undefined && isRevealed(db, unitId)) {
      amount = 0;
      reason = 'revealed';
    } else if (x.kind === 'review') {
      const used = xpOnDay(db, day, 'review');
      amount = Math.max(0, Math.min(amount, REVIEW_DAILY_CAP - used));
      if (amount === 0) reason = 'daily-cap';
    } else if (unitId !== undefined) {
      const prior = db.get(
        'SELECT 1 AS x FROM xp_event WHERE unit_id = ? AND kind = ? AND amount > 0 LIMIT 1',
        unitId,
        x.kind,
      );
      if (prior) {
        amount = 0;
        reason = 'already-awarded';
      }
    }

    const { lastInsertRowid } = db.run(
      `INSERT INTO xp_event (kind, amount, reason, unit_id, attempt_id, track_id, day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      x.kind,
      amount,
      reason,
      unitId,
      x.attemptId,
      x.trackId,
      day,
      t,
    );
    return { id: lastInsertRowid, amount, reason, day };
  });
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
