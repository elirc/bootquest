import type { DayStatus, HeatmapDay } from '../api/types';

/**
 * XP → intensity bucket (0..4). Thresholds line up with the streak rules:
 * bucket 1 is "did something but < 20 XP" (does NOT keep a streak), bucket 2 starts at
 * the 20-XP partial-day line, 3 and 4 separate solid days from big ones.
 */
export const XP_BUCKETS = [0, 1, 20, 60, 120] as const;
export type Bucket = 0 | 1 | 2 | 3 | 4;

export function bucketXp(xp: number): Bucket {
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  if (xp < XP_BUCKETS[2]) return 1;
  if (xp < XP_BUCKETS[3]) return 2;
  if (xp < XP_BUCKETS[4]) return 3;
  return 4;
}

export interface HeatCell {
  /** YYYY-MM-DD (the server's `day`). */
  date: string;
  xp: number;
  status: DayStatus;
  bucket: Bucket;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  isToday: boolean;
}

export interface HeatGrid {
  /** Columns of 7 (Mon..Sun). `null` pads days outside the range. */
  weeks: (HeatCell | null)[][];
  /** Month labels positioned at the first column whose Monday-row week contains the 1st…or the first column. */
  months: { label: string; col: number }[];
  totalXp: number;
  activeDays: number;
}

const MS_DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** Monday-based weekday of a YYYY-MM-DD date (timezone-independent). */
export const weekdayOf = (iso: string): number => (new Date(toMs(iso)).getUTCDay() + 6) % 7;

/**
 * Lays days out as GitHub-style week columns. Missing days inside the range are filled
 * as zero-XP `none` days, so a sparse API response can never shift the grid.
 * Input is the server's heatmap row `{ day, xp, status }`.
 */
export function buildHeatGrid(days: HeatmapDay[], today: string): HeatGrid {
  if (days.length === 0) return { weeks: [], months: [], totalXp: 0, activeDays: 0 };
  const byDate = new Map(days.map((d) => [d.day, d]));
  const sorted = [...byDate.keys()].sort();
  const start = toMs(sorted[0]!);
  const end = Math.max(toMs(sorted[sorted.length - 1]!), toMs(today));

  const weeks: (HeatCell | null)[][] = [];
  const months: { label: string; col: number }[] = [];
  let week: (HeatCell | null)[] = Array.from({ length: weekdayOf(toIso(start)) }, () => null);
  let totalXp = 0;
  let activeDays = 0;
  let lastMonth = -1;

  for (let ms = start; ms <= end; ms += MS_DAY) {
    const date = toIso(ms);
    const src = byDate.get(date);
    const xp = src?.xp ?? 0;
    const cell: HeatCell = {
      date,
      xp,
      status: src?.status ?? 'none',
      bucket: bucketXp(xp),
      weekday: weekdayOf(date),
      isToday: date === today,
    };
    totalXp += xp;
    if (xp > 0) activeDays++;
    const month = new Date(ms).getUTCMonth();
    if (month !== lastMonth) {
      const col = weeks.length;
      // Skip a label that would collide with the previous one (needs ≥ 3 columns of room).
      const prev = months[months.length - 1];
      if (!prev || col - prev.col >= 3) months.push({ label: MONTHS[month]!, col });
      lastMonth = month;
    }
    week.push(cell);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return { weeks, months, totalXp, activeDays };
}

export function describeCell(c: HeatCell): string {
  const label = new Date(toMs(c.date)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const what: Record<DayStatus, string> = {
    slate: 'slate cleared',
    partial: 'partial day',
    frozen: 'freeze token used',
    missed: c.xp > 0 ? 'below 20 XP, missed' : 'missed',
    open: 'today, in progress',
    none: c.xp > 0 ? 'below 20 XP' : 'no activity',
  };
  return `${label}: ${c.xp} XP, ${what[c.status]}`;
}
