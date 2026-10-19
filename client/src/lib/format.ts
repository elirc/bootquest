const MS_DAY = 86_400_000;

// Every date the app shows is a LOCAL calendar day: the server's day keys ('YYYY-MM-DD') are the
// owner's local days, and a stored timestamp (epoch ms) is shown on the local day it falls on.
// (fix/client-dash: fmtShortDate rendered timestamps in UTC, so a retest opening 20:00 local in
// a UTC-negative zone showed the NEXT day.)

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const fmtInt = (n: number): string => n.toLocaleString('en-US');

/** 'YYYY-MM-DD' of an epoch-ms timestamp in the LOCAL day (the server's day basis). */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/**
 * A Date at LOCAL midnight of a day key (that calendar day in every time zone), or the instant
 * of a timestamp: epoch ms, or an ISO string with a time part.
 */
function toLocalDate(when: string | number): Date {
  if (typeof when === 'string' && DAY_KEY.test(when)) {
    const [y, m, d] = when.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d);
  }
  return new Date(typeof when === 'number' ? when : Date.parse(when));
}

/** "Oct 9": a day key is that calendar day; a timestamp is the LOCAL day it falls on. */
export function fmtShortDate(when: string | number): string {
  return toLocalDate(when).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** A day key as is; a timestamp (epoch ms or ISO with a time) as its LOCAL day key. */
function dayKeyOf(when: string | number): string {
  if (typeof when === 'string' && DAY_KEY.test(when)) return when;
  return localDayKey(typeof when === 'number' ? when : Date.parse(when));
}

/** Whole calendar days from `today` (a local day key) to `when`; negative = past. */
export function daysFrom(today: string, when: string | number): number {
  // both sides are calendar-day keys here, so UTC midnights only measure the calendar distance
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${dayKeyOf(when)}T00:00:00Z`);
  return Math.round((b - a) / MS_DAY);
}

export function fmtRelative(today: string, when: string | number): string {
  const d = daysFrom(today, when);
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
  return `${localDayKey(ms)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** "1 drill" / "2 drills". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
