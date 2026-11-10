// f52 wave B (app ruling 4): the completion panel's XP count-up.
import { describe, expect, it } from 'vitest';
import { COUNT_UP_MS, countUpEnabled, countUpValue } from './countup';

describe('countUpValue', () => {
  it('runs from 0 to the amount in 600 ms, never past it, never backwards', () => {
    expect(COUNT_UP_MS).toBe(600);
    expect(countUpValue(50, 0)).toBe(0);
    expect(countUpValue(50, 600)).toBe(50);
    expect(countUpValue(50, 5000)).toBe(50);
    expect(countUpValue(50, -10)).toBe(0);
    let prev = 0;
    for (let t = 0; t <= 600; t += 16) {
      const v = countUpValue(50, t);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(50);
      prev = v;
    }
    // ease-out: more than half is counted by the midpoint
    expect(countUpValue(100, 300)).toBe(75);
  });

  it('nothing to count: the amount itself', () => {
    expect(countUpValue(0, 100)).toBe(0);
    expect(countUpValue(7, 100, 0)).toBe(7);
  });
});

describe('countUpEnabled', () => {
  it('never under prefers-reduced-motion, never in tests, never for 0 XP', () => {
    expect(countUpEnabled(50, 'test', false)).toBe(false);
    expect(countUpEnabled(50, 'production', true)).toBe(false);
    expect(countUpEnabled(0, 'production', false)).toBe(false);
    expect(countUpEnabled(50, 'production', false)).toBe(typeof requestAnimationFrame === 'function');
    expect(countUpEnabled(50, 'development', false)).toBe(typeof requestAnimationFrame === 'function');
  });
});
