/**
 * Clock injection. Every engine takes `now: Clock` and never reads the wall
 * clock itself (BUILD-PLAN standing rule; required for an honest ≥2-day retest
 * gate). server/test/clock-discipline.test.ts greps engines for violations.
 */
export type Clock = () => Date;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Epoch ms from the injected clock. */
export function nowMs(now: Clock): number {
  const t = now().getTime();
  if (!Number.isFinite(t)) throw new Error('clock returned an invalid Date');
  return t;
}

/** Local calendar day key 'YYYY-MM-DD' (the owner's day, used for streaks/slates/caps). */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Shift a day key by n calendar days (DST-safe: works on calendar fields, not ms). */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d + n, 12);
  return dayKey(date.getTime());
}

/** Fixed/settable clock for tests and scripted demos. */
export function fixedClock(start: Date | number): Clock & { set(t: Date | number): void; advance(ms: number): void } {
  let t = typeof start === 'number' ? start : start.getTime();
  const clock = (() => new Date(t)) as Clock & { set(t: Date | number): void; advance(ms: number): void };
  clock.set = (v) => {
    t = typeof v === 'number' ? v : v.getTime();
  };
  clock.advance = (ms) => {
    t += ms;
  };
  return clock;
}
