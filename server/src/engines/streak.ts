import type { Db } from '../db/database.ts';
import { addDays, dayKey, nowMs, type Clock } from './clock.ts';
import { dueCount } from './fsrs.ts';
import { xpOnDay } from './xp.ts';

/**
 * Daily slate + streak engine (spec §6.1).
 *
 * Slate composition: one 5-exercise drill set per active track (track.locked=0
 * AND track.slate_drills=1), one campaign step, and "clear the review queue".
 *
 * Day classification, applied when a day is CLOSED (i.e. once it has passed):
 *   slate   — every slate item done      -> streak +1, +1 toward a freeze token
 *   partial — not a slate-day, >= 20 XP  -> streak kept (not incremented), no token credit
 *   gap     — neither                    -> auto-spend a banked freeze token
 *                                           ('frozen', streak kept), else the streak
 *                                           breaks ('missed', streak = 0)
 * Freeze tokens: every 7 slate-days earn 1 token, at most 2 banked (credit
 * beyond the cap is lost). A gap while the streak is already 0 spends nothing.
 * The 7-slate-day counter is cumulative across partial/frozen days and resets
 * only when the streak breaks.
 */

export const DRILL_SET_SIZE = 5;
export const PARTIAL_DAY_XP = 20;
export const SLATE_DAYS_PER_TOKEN = 7;
export const MAX_TOKENS = 2;

export type SlateItem =
  | { slot: `drill:${string}`; kind: 'drill-set'; track: string; size: number; done: boolean }
  | { slot: 'campaign'; kind: 'campaign-step'; done: boolean }
  | { slot: 'review'; kind: 'review-clear'; done: boolean };

export type DayStatus = 'open' | 'slate' | 'partial' | 'frozen' | 'missed';

export interface SlateRow {
  day: string;
  items: SlateItem[];
  status: DayStatus;
  xp_total: number;
  created_at: number;
  closed_at: number | null;
}

export interface StreakRow {
  current: number;
  longest: number;
  tokens: number;
  slate_days_banked: number;
  last_closed_day: string | null;
}

function readSlate(db: Db, day: string): SlateRow | undefined {
  const row = db.get<Omit<SlateRow, 'items'> & { items: string }>('SELECT * FROM daily_slate WHERE day = ?', day);
  return row ? { ...row, items: JSON.parse(row.items) as SlateItem[] } : undefined;
}

export function isSlateComplete(items: readonly SlateItem[]): boolean {
  return items.length > 0 && items.every((i) => i.done);
}

/** Compose (or return) today's slate. Idempotent per day. */
export function composeSlate(db: Db, now: Clock): SlateRow {
  const t = nowMs(now);
  const day = dayKey(t);
  const existing = readSlate(db, day);
  if (existing) return existing;
  const tracks = db.all<{ id: string }>(
    'SELECT id FROM track WHERE locked = 0 AND slate_drills = 1 ORDER BY sort_order',
  );
  const items: SlateItem[] = [
    ...tracks.map(
      (tr): SlateItem => ({ slot: `drill:${tr.id}`, kind: 'drill-set', track: tr.id, size: DRILL_SET_SIZE, done: false }),
    ),
    { slot: 'campaign', kind: 'campaign-step', done: false },
    { slot: 'review', kind: 'review-clear', done: dueCount(db, now) === 0 },
  ];
  db.run(
    `INSERT INTO daily_slate (day, items, status, xp_total, created_at, closed_at) VALUES (?, ?, 'open', 0, ?, NULL)`,
    day,
    JSON.stringify(items),
    t,
  );
  return readSlate(db, day)!;
}

/**
 * Mark one slot of today's slate done. The review slot can only be marked when
 * the due queue is actually empty at `now`.
 */
export function markSlateItem(db: Db, slot: SlateItem['slot'], now: Clock): SlateRow {
  return db.tx(() => {
    const slate = composeSlate(db, now);
    const item = slate.items.find((i) => i.slot === slot);
    if (!item) throw new Error(`slot ${slot} is not on the ${slate.day} slate`);
    if (slot === 'review' && dueCount(db, now) > 0) throw new Error('review queue is not clear');
    item.done = true;
    db.run('UPDATE daily_slate SET items = ? WHERE day = ?', JSON.stringify(slate.items), slate.day);
    return readSlate(db, slate.day)!;
  });
}

function readStreak(db: Db): StreakRow {
  return db.get<StreakRow>(
    'SELECT current, longest, tokens, slate_days_banked, last_closed_day FROM streak WHERE id = 1',
  )!;
}

function firstActivityDay(db: Db): string | null {
  const row = db.get<{ d: string | null }>(
    'SELECT MIN(d) AS d FROM (SELECT MIN(day) AS d FROM daily_slate UNION ALL SELECT MIN(day) FROM xp_event)',
  );
  return row?.d ?? null;
}

export interface ClosedDay {
  day: string;
  status: Exclude<DayStatus, 'open'>;
  xp: number;
}

/** Close every fully-elapsed day (< today) not yet closed. Returns what was closed. */
export function closeElapsedDays(db: Db, now: Clock): ClosedDay[] {
  const t = nowMs(now);
  const today = dayKey(t);
  return db.tx(() => {
    const s = readStreak(db);
    let day = s.last_closed_day ? addDays(s.last_closed_day, 1) : firstActivityDay(db);
    const closed: ClosedDay[] = [];
    if (day === null) return closed;
    let { current, longest, tokens, slate_days_banked: banked } = s;
    let lastClosed = s.last_closed_day;

    while (day < today) {
      const slate = readSlate(db, day);
      const xp = xpOnDay(db, day);
      let status: ClosedDay['status'];
      if (slate && isSlateComplete(slate.items)) {
        status = 'slate';
        current += 1;
        banked += 1;
        if (banked >= SLATE_DAYS_PER_TOKEN) {
          banked = 0;
          tokens = Math.min(MAX_TOKENS, tokens + 1);
        }
      } else if (xp >= PARTIAL_DAY_XP) {
        status = 'partial';
      } else if (current > 0 && tokens > 0) {
        status = 'frozen';
        tokens -= 1;
      } else {
        status = 'missed';
        current = 0;
        banked = 0;
      }
      longest = Math.max(longest, current);
      if (slate) {
        db.run('UPDATE daily_slate SET status = ?, xp_total = ?, closed_at = ? WHERE day = ?', status, xp, t, day);
      } else {
        db.run(
          `INSERT INTO daily_slate (day, items, status, xp_total, created_at, closed_at) VALUES (?, '[]', ?, ?, ?, ?)`,
          day,
          status,
          xp,
          t,
          t,
        );
      }
      closed.push({ day, status, xp });
      lastClosed = day;
      day = addDays(day, 1);
    }

    db.run(
      `UPDATE streak SET current = ?, longest = ?, tokens = ?, slate_days_banked = ?, last_closed_day = ?, updated_at = ? WHERE id = 1`,
      current,
      longest,
      tokens,
      banked,
      lastClosed,
      t,
    );
    return closed;
  });
}

export interface StreakStatus {
  /** streak through yesterday (closed days) */
  current: number;
  /** current + 1 if today's slate is already complete */
  display: number;
  longest: number;
  tokens: number;
  slateDaysBanked: number;
  todayComplete: boolean;
  today: string;
}

export function streakStatus(db: Db, now: Clock): StreakStatus {
  closeElapsedDays(db, now);
  const s = readStreak(db);
  const today = dayKey(nowMs(now));
  const slate = readSlate(db, today);
  const todayComplete = slate !== undefined && isSlateComplete(slate.items);
  return {
    current: s.current,
    display: s.current + (todayComplete ? 1 : 0),
    longest: Math.max(s.longest, s.current + (todayComplete ? 1 : 0)),
    tokens: s.tokens,
    slateDaysBanked: s.slate_days_banked,
    todayComplete,
    today,
  };
}

export function getSlate(db: Db, day: string): SlateRow | undefined {
  return readSlate(db, day);
}
