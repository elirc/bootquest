import type { Db } from '../db/database.ts';
import { READING_ATTEST_SQL, VERIFIED_PASS_SQL } from './attempts.ts';
import { campaignStepAvailable } from './campaign.ts';
import { addDays, dayKey, nowMs, type Clock } from './clock.ts';
import { xpOnDay } from './xp.ts';

/**
 * Daily slate + streak engine (spec §6.1).
 *
 * Slate composition: one 5-exercise drill set per active track (track.locked=0
 * AND track.slate_drills=1), one campaign step ONLY when a campaign step can
 * actually be taken that day (W5b: an actionable, not-yet-done quest in an
 * UNLOCKED act — engines/campaign.ts — or the step was already taken that day;
 * a slot nothing can complete would make the streak impossible again, W1b
 * review), and "clear the review queue".
 *
 * Slot completion is DERIVED from the ledger, never marked by a caller (W1a
 * audit #6, W1b review): there is no markSlateItem.
 *   drill:<track> — >= 5 distinct kind='drill' units on the track whose FIRST
 *                   verified pass ever (outcome pass + passing submit run) is on
 *                   this day and was not guided: re-passing an old unit,
 *                   quizzes, and post-reveal passes never tick it;
 *   campaign      — the FIRST-EVER verified pass (or the reading self-attest) of
 *                   a unit a campaign quest points at falls on this day and was
 *                   not guided: re-passing an old quest unit never ticks it
 *                   (same anti-gaming rule as the drill slot);
 *   review        — the due queue was empty right after some review this day,
 *                   or is empty at evaluation time (now for today, end of day
 *                   for a closed day). Past queue states are rebuilt from the
 *                   append-only review_log, so nothing can be pre-marked.
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

/** [start, end) epoch ms of a local calendar day (calendar arithmetic, DST-safe). */
export function dayBounds(day: string): [number, number] {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()];
}

/** The slot list for `day` (done flags unset), from the current tracks and campaign state. */
function slateStructure(db: Db, day: string): SlateItem[] {
  const tracks = db.all<{ id: string }>('SELECT id FROM track WHERE locked = 0 AND slate_drills = 1 ORDER BY sort_order');
  const [start, end] = dayBounds(day);
  const hasCampaign = campaignStepAvailable(db) || campaignStepDone(db, start, end);
  const items: SlateItem[] = tracks.map(
    (tr): SlateItem => ({ slot: `drill:${tr.id}`, kind: 'drill-set', track: tr.id, size: DRILL_SET_SIZE, done: false }),
  );
  if (hasCampaign) items.push({ slot: 'campaign', kind: 'campaign-step', done: false });
  items.push({ slot: 'review', kind: 'review-clear', done: false });
  return items;
}

/** Distinct drill units on a track whose first-ever verified pass falls in [from, to) and was not guided. */
export function newDrillPasses(db: Db, trackId: string, from: number, to: number): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM unit u
        WHERE u.track_id = ? AND u.kind = 'drill'
          AND EXISTS (SELECT 1 FROM attempt a WHERE a.unit_id = u.id AND ${VERIFIED_PASS_SQL}
                        AND a.mode <> 'guided' AND a.created_at >= ? AND a.created_at < ?)
          AND NOT EXISTS (SELECT 1 FROM attempt a WHERE a.unit_id = u.id AND ${VERIFIED_PASS_SQL} AND a.created_at < ?)`,
      trackId,
      from,
      to,
      from,
    )?.n ?? 0
  );
}

/** A quest unit's first-ever completion (verified pass or reading self-attest) is in [from, to) and was not guided. */
export function campaignStepDone(db: Db, from: number, to: number): boolean {
  return (
    db.get(
      `SELECT 1 AS x FROM (
         SELECT a.unit_id AS unit_id, MIN(a.created_at) AS first_at FROM attempt a JOIN unit u ON u.id = a.unit_id
          WHERE a.unit_id IN (SELECT unit_id FROM quest WHERE unit_id IS NOT NULL)
            AND (${VERIFIED_PASS_SQL} OR ${READING_ATTEST_SQL})
          GROUP BY a.unit_id) f
        WHERE f.first_at >= ? AND f.first_at < ?
          AND EXISTS (SELECT 1 FROM attempt a JOIN unit u ON u.id = a.unit_id
                       WHERE a.unit_id = f.unit_id AND a.created_at = f.first_at AND a.mode <> 'guided'
                         AND (${VERIFIED_PASS_SQL} OR ${READING_ATTEST_SQL}))
        LIMIT 1`,
      from,
      to,
    ) !== undefined
  );
}

/** Review items due as of moment T, rebuilt from review_log (reviews after T are undone). */
export function dueAsOf(db: Db, T: number): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM review_item ri
        WHERE ri.created_at <= ?
          AND COALESCE((SELECT rl.prev_due_at FROM review_log rl
                         WHERE rl.review_item_id = ri.id AND rl.reviewed_at > ?
                         ORDER BY rl.reviewed_at, rl.id LIMIT 1), ri.due_at) <= ?`,
      T,
      T,
      T,
    )?.n ?? 0
  );
}

function reviewCleared(db: Db, from: number, at: number): boolean {
  if (dueAsOf(db, at) === 0) return true;
  const moments = db.all<{ t: number }>(
    'SELECT DISTINCT reviewed_at AS t FROM review_log WHERE reviewed_at >= ? AND reviewed_at <= ? ORDER BY reviewed_at',
    from,
    at,
  );
  return moments.some((m) => dueAsOf(db, m.t) === 0);
}

/**
 * Derive every slot's `done` for `day` from the ledger as of `atMs`
 * (capped at the end of that day).
 */
export function deriveSlate(db: Db, day: string, items: readonly SlateItem[], atMs: number): SlateItem[] {
  const [start, end] = dayBounds(day);
  const cutoff = Math.min(end, atMs + 1); // attempts strictly before cutoff count
  const at = cutoff - 1;
  return items.map((item): SlateItem => {
    if (item.kind === 'review-clear') return { ...item, done: reviewCleared(db, start, at) };
    if (item.kind === 'campaign-step') return { ...item, done: campaignStepDone(db, start, cutoff) };
    return { ...item, done: newDrillPasses(db, item.track, start, cutoff) >= item.size };
  });
}

/**
 * Compose today's slate. The slot list is refreshed from the current tracks
 * and quests while the day is open, and every `done` flag is derived from the
 * ledger at `now`. Idempotent per day; done flags are persisted only as a
 * snapshot when the day is closed.
 */
export function composeSlate(db: Db, now: Clock): SlateRow {
  const t = nowMs(now);
  const day = dayKey(t);
  const structure = slateStructure(db, day);
  const existing = readSlate(db, day);
  if (!existing) {
    db.run(
      `INSERT INTO daily_slate (day, items, status, xp_total, created_at, closed_at) VALUES (?, ?, 'open', 0, ?, NULL)`,
      day,
      JSON.stringify(structure),
      t,
    );
  } else if (existing.status === 'open') {
    db.run('UPDATE daily_slate SET items = ? WHERE day = ?', JSON.stringify(structure), day);
  }
  const row = readSlate(db, day)!;
  return { ...row, items: row.status === 'open' ? deriveSlate(db, day, row.items, t) : row.items };
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
      const [, dayEnd] = dayBounds(day);
      // derived at end of day from the ledger; the stored row only supplies the slot list
      const items = deriveSlate(db, day, slate ? slate.items : slateStructure(db, day), dayEnd - 1);
      let status: ClosedDay['status'];
      if (isSlateComplete(items)) {
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
        db.run(
          'UPDATE daily_slate SET items = ?, status = ?, xp_total = ?, closed_at = ? WHERE day = ?',
          JSON.stringify(items),
          status,
          xp,
          t,
          day,
        );
      } else {
        db.run(
          `INSERT INTO daily_slate (day, items, status, xp_total, created_at, closed_at) VALUES (?, ?, ?, ?, ?, ?)`,
          day,
          JSON.stringify(items),
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
  const t = nowMs(now);
  const today = dayKey(t);
  const slate = readSlate(db, today);
  const todayComplete = isSlateComplete(deriveSlate(db, today, slate ? slate.items : slateStructure(db, today), t));
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

/** The stored slate row for a day (for closed days: the derived end-of-day snapshot). */
export function getSlate(db: Db, day: string): SlateRow | undefined {
  return readSlate(db, day);
}
