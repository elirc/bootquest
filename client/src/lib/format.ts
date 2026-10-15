const MS_DAY = 86_400_000;

export const fmtInt = (n: number): string => n.toLocaleString('en-US');

/** "Oct 9" from an ISO date or timestamp (rendered in UTC so fixtures are stable). */
export function fmtShortDate(iso: string): string {
  const ms = iso.length === 10 ? Date.parse(`${iso}T00:00:00Z`) : Date.parse(iso);
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Whole days from `today` (YYYY-MM-DD) to `iso`; negative = past. */
export function daysFrom(today: string, iso: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / MS_DAY);
}

export function fmtRelative(today: string, iso: string): string {
  const d = daysFrom(today, iso);
  if (d === 0) return 'today';
  if (d === -1) return 'yesterday';
  if (d === 1) return 'tomorrow';
  return d < 0 ? `${-d}d ago` : `in ${d}d`;
}

export function toRoman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);
}

export const pct = (n: number, d: number): number => (d <= 0 ? 0 : Math.max(0, Math.min(100, (n / d) * 100)));

/** W11: a stored timestamp in LOCAL time, like every other date in the app (the server's day keys are local days). */
export const fmtWhen = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** W11: "2026-10-14 21:05" in LOCAL time (the evidence list's sortable stamp; was UTC, a day off the local day keys at night). */
export function fmtStamp(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
