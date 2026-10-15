import type { CheckType, TrackId } from '@bootquest/shared';
import type { XpByTrack } from '@bootquest/shared/api';
import { addDays, dayKey } from './clock.ts';

/**
 * Campaign 2 B2: PURE bucket math for the stats endpoints (no DB, no clock reads).
 * Everything works on the owner's LOCAL calendar day keys ('YYYY-MM-DD'), never on
 * fixed 24h ms offsets, so a 23h or 25h DST day is still exactly one bucket.
 */

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseKey(key: string): [number, number, number] {
  if (!KEY_RE.test(key)) throw new RangeError(`not a day key: ${key}`);
  return key.split('-').map(Number) as [number, number, number];
}

/** The Monday (local calendar) that starts the week containing `key`. */
export function weekStart(key: string): string {
  const [y, m, d] = parseKey(key);
  // local noon: never near a DST transition, and getDay() reads the calendar weekday
  const dow = new Date(y, m - 1, d, 12).getDay(); // 0 = Sunday
  return addDays(key, -((dow + 6) % 7));
}

/** Inclusive contiguous day keys from `from` to `to` (empty when from > to). */
export function dayRange(from: string, to: string): string[] {
  parseKey(from);
  parseKey(to);
  const out: string[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) {
    out.push(k);
    if (out.length > 100_000) throw new RangeError('day range too long');
  }
  return out;
}

export const XP_TRACK_KEYS = ['js', 'csharp', 'java', 'agentic', 'none'] as const;
export type XpTrackKey = (typeof XP_TRACK_KEYS)[number];

const emptyByTrack = (): XpByTrack => ({ js: 0, csharp: 0, java: 0, agentic: 0, none: 0 });

function trackKey(t: string | null): XpTrackKey {
  return (XP_TRACK_KEYS as readonly string[]).includes(t ?? '') ? (t as XpTrackKey) : 'none';
}

export interface XpDayRow {
  day: string;
  trackId: string | null;
  xp: number;
}

export interface XpBucket {
  total: number;
  byTrack: XpByTrack;
}

function add(b: XpBucket, r: XpDayRow): void {
  b.total += r.xp;
  b.byTrack[trackKey(r.trackId)] += r.xp;
}

/** `n` contiguous daily buckets ending `today` (inclusive); rows outside the window are ignored. */
export function dailyBuckets(rows: readonly XpDayRow[], today: string, n: number): (XpBucket & { day: string })[] {
  const days = dayRange(addDays(today, -(n - 1)), today);
  const map = new Map(days.map((day) => [day, { day, total: 0, byTrack: emptyByTrack() }]));
  for (const r of rows) {
    const b = map.get(r.day);
    if (b) add(b, r);
  }
  return days.map((d) => map.get(d)!);
}

/**
 * All-time weekly buckets (Monday start), contiguous from the week of the earliest row
 * to the week of `today`. No rows -> []. Rows dated after today land in no bucket.
 */
export function weeklyBuckets(rows: readonly XpDayRow[], today: string): (XpBucket & { weekStart: string })[] {
  if (rows.length === 0) return [];
  const first = rows.reduce((min, r) => (r.day < min ? r.day : min), rows[0]!.day);
  const last = weekStart(today);
  const out: (XpBucket & { weekStart: string })[] = [];
  const map = new Map<string, XpBucket & { weekStart: string }>();
  for (let w = weekStart(first <= today ? first : today); w <= last; w = addDays(w, 7)) {
    const b = { weekStart: w, total: 0, byTrack: emptyByTrack() };
    out.push(b);
    map.set(w, b);
  }
  for (const r of rows) {
    const b = map.get(weekStart(r.day));
    if (b) add(b, r);
  }
  return out;
}

/**
 * Review due forecast: `n` local-day buckets starting today. A card's bucket is the
 * LOCAL day of its due instant (dayKey), so a card due 00:30 on a DST-change day is
 * that day's card. Overdue cards (due before today) count into today's bucket.
 */
export function forecastBuckets(
  dueAts: readonly number[],
  today: string,
  n: number,
): { forecast: { day: string; due: number }[]; overdue: number; later: number } {
  const days = dayRange(today, addDays(today, n - 1));
  const counts = new Map(days.map((d) => [d, 0]));
  const lastDay = days[days.length - 1]!;
  let overdue = 0;
  let later = 0;
  for (const at of dueAts) {
    const k = dayKey(at);
    if (k < today) {
      overdue += 1;
      counts.set(today, counts.get(today)! + 1);
    } else if (k > lastDay) {
      later += 1;
    } else {
      counts.set(k, counts.get(k)! + 1);
    }
  }
  return { forecast: days.map((day) => ({ day, due: counts.get(day)! })), overdue, later };
}

/** Retention: share of reviews not rated 'again'; null without reviews. */
export function retention(ratings: readonly string[]): { reviews: number; recalled: number; rate: number | null } {
  const recalled = ratings.filter((r) => r !== 'again').length;
  return { reviews: ratings.length, recalled, rate: ratings.length === 0 ? null : recalled / ratings.length };
}

// ---------------------------------------------------------------- pass rates

export interface GradedAttemptRow {
  id: number;
  unitId: number;
  trackId: TrackId;
  checkType: CheckType;
  mode: 'solo' | 'assisted' | 'guided';
  verified: boolean;
  createdAt: number;
}

export interface PassRate {
  attempts: number;
  /** verified passes made WITHOUT a reveal (solo or self-assisted); guided passes are not passes */
  passes: number;
  /** verified passes made after the solution was revealed (mode 'guided'): reported, never counted */
  guidedPasses: number;
  passRate: number | null;
  units: number;
  firstTryPasses: number;
  firstTryRate: number | null;
}

/**
 * Aggregate graded attempts (any order in; first-try is judged by createdAt, then id).
 * A submit made after a reveal (mode 'guided') stays in the denominator but is never a pass:
 * copying the revealed answer is not passing the check. It is surfaced as `guidedPasses`.
 */
export function passRate(rows: readonly GradedAttemptRow[]): PassRate {
  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  const first = new Map<number, GradedAttemptRow>();
  for (const r of sorted) if (!first.has(r.unitId)) first.set(r.unitId, r);
  const passes = rows.filter((r) => r.verified && r.mode !== 'guided').length;
  const guidedPasses = rows.filter((r) => r.verified && r.mode === 'guided').length;
  const firstTryPasses = [...first.values()].filter((r) => r.verified && r.mode === 'solo').length;
  return {
    attempts: rows.length,
    passes,
    guidedPasses,
    passRate: rows.length === 0 ? null : passes / rows.length,
    units: first.size,
    firstTryPasses,
    firstTryRate: first.size === 0 ? null : firstTryPasses / first.size,
  };
}

/** Group then aggregate, keeping the caller's key order and dropping empty groups. */
export function passRatesBy<K extends string>(rows: readonly GradedAttemptRow[], keyOf: (r: GradedAttemptRow) => K, order: readonly K[]): (PassRate & { key: K })[] {
  const groups = new Map<K, GradedAttemptRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  return order.filter((k) => groups.has(k)).map((k) => ({ key: k, ...passRate(groups.get(k)!) }));
}

// ---------------------------------------------------------------- track progress (ui-audit #26)

export interface TrackProgressInput {
  locked: boolean;
  coreDone: number;
  coreTotal: number;
  practiceDone: number;
  practiceTotal: number;
}

const floorPct = (done: number, total: number) => Math.min(100, Math.max(0, Math.floor((done * 100) / total)));

/** The ONE definition of a track's progress percentage (documented on TrackProgress in shared/src/api.ts). */
export function trackProgress(i: TrackProgressInput): {
  pct: number;
  basis: 'campaign-core' | 'practice' | 'none';
  coreDone: number;
  coreTotal: number;
  practiceDone: number;
  practiceTotal: number;
} {
  const counts = { coreDone: i.coreDone, coreTotal: i.coreTotal, practiceDone: i.practiceDone, practiceTotal: i.practiceTotal };
  if (i.locked) return { pct: 0, basis: 'none', ...counts };
  if (i.coreTotal > 0) return { pct: floorPct(i.coreDone, i.coreTotal), basis: 'campaign-core', ...counts };
  if (i.practiceTotal > 0) return { pct: floorPct(i.practiceDone, i.practiceTotal), basis: 'practice', ...counts };
  return { pct: 0, basis: 'none', ...counts };
}
