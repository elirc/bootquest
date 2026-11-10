// f52 wave B (app ruling 4): the XP count-up of the completion panel. 600 ms from 0 to the amount;
// no animation at all under prefers-reduced-motion, in tests, or without requestAnimationFrame: the
// final number is simply there.
import { useEffect, useState } from 'react';

export const COUNT_UP_MS = 600;

/** The number to show `elapsed` ms into a count-up to `target` (ease-out; whole numbers; exact at the end). */
export function countUpValue(target: number, elapsed: number, ms: number = COUNT_UP_MS): number {
  if (target <= 0) return Math.max(0, target);
  if (ms <= 0 || elapsed >= ms) return target;
  if (elapsed <= 0) return 0;
  const t = elapsed / ms;
  return Math.min(target, Math.floor(target * (1 - (1 - t) * (1 - t))));
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Should a count-up run at all? `mode` is the build mode (import.meta.env.MODE). */
export function countUpEnabled(target: number, mode: string, reducedMotion: boolean): boolean {
  return target > 0 && mode !== 'test' && !reducedMotion && typeof requestAnimationFrame === 'function';
}

export function useCountUp(target: number, ms: number = COUNT_UP_MS): number {
  const [animate] = useState(() => countUpEnabled(target, import.meta.env.MODE, prefersReducedMotion()));
  const [value, setValue] = useState(animate ? 0 : target);
  useEffect(() => {
    if (!animate) {
      setValue(target);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const v = countUpValue(target, now - start, ms);
      setValue(v);
      if (v < target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, target, ms]);
  return value;
}
