// Campaign 2 B2: chart geometry is drawn to scale and labels stay inside the plot.
import { describe, expect, it } from 'vitest';
import { bands, fmtRate, keyParts, longDate, monthStarts, niceScale, placeLabels, yScale } from './chart';

describe('niceScale', () => {
  it('rounds the axis up to a 1/2/2.5/5 x 10^k step and never fractures integer data', () => {
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(niceScale(3)).toEqual({ max: 3, ticks: [0, 1, 2, 3] });
    expect(niceScale(37)).toEqual({ max: 40, ticks: [0, 10, 20, 30, 40] });
    expect(niceScale(185)).toEqual({ max: 200, ticks: [0, 50, 100, 150, 200] });
    expect(niceScale(1000)).toEqual({ max: 1000, ticks: [0, 250, 500, 750, 1000] });
    for (const m of [1, 7, 99, 101, 4321]) {
      const s = niceScale(m);
      expect(s.max).toBeGreaterThanOrEqual(m);
      expect(s.ticks.every((t) => Number.isInteger(t))).toBe(true);
      expect(s.ticks.length).toBeLessThanOrEqual(6);
    }
  });
});

describe('yScale / bands (to scale)', () => {
  it('maps 0 to the baseline and max to the top, linearly, clamped', () => {
    expect(yScale(0, 200, 180, 160)).toBe(180);
    expect(yScale(200, 200, 180, 160)).toBe(20);
    expect(yScale(50, 200, 180, 160)).toBe(140);
    expect(yScale(-5, 200, 180, 160)).toBe(180);
    expect(yScale(999, 200, 180, 160)).toBe(20);
  });

  it('bands tile the plot exactly; a 2px gap only when the band is wide enough', () => {
    const wide = bands(14, 40, 280);
    expect(wide[0]!.bx).toBe(40);
    expect(wide[13]!.bx + wide[13]!.bw).toBeCloseTo(320);
    expect(wide[0]!.w).toBe(18);
    const narrow = bands(90, 40, 300);
    expect(narrow[0]!.w).toBeCloseTo(300 / 90 - 1);
    const tiny = bands(500, 0, 500);
    expect(tiny[0]!.w).toBe(1);
    expect(bands(0, 0, 100)).toEqual([]);
  });
});

describe('placeLabels (inside bounds, no collisions)', () => {
  it('clamps edge labels inside the plot and drops colliding ones', () => {
    const out = placeLabels(
      [
        { x: 2, text: 'Jul' },
        { x: 10, text: 'Aug' }, // collides with Jul
        { x: 100, text: 'Sep' },
        { x: 398, text: 'Oct' },
      ],
      0,
      400,
    );
    expect(out.map((l) => l.text)).toEqual(['Jul', 'Sep', 'Oct']);
    for (const l of out) {
      expect(l.left).toBeGreaterThanOrEqual(0);
      expect(l.left + l.text.length * 6.5).toBeLessThanOrEqual(400);
    }
  });
});

describe('day keys are calendar fields, never shifted by a timezone', () => {
  it('weekday, month starts and long dates', () => {
    expect(keyParts('2026-03-08')).toEqual({ y: 2026, m: 3, d: 8, dow: 0 });
    expect(longDate('2026-11-01')).toBe('Sun Nov 1, 2026');
    expect(monthStarts(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2027-01-01'], true)).toEqual([
      { i: 0, text: 'Sep 2026' },
      { i: 2, text: 'Oct' },
      { i: 4, text: 'Jan 2027' },
    ]);
  });
});

describe('fmtRate', () => {
  it('never rounds an incomplete rate up to 100% or a non-zero rate down to 0%', () => {
    expect(fmtRate(null)).toBe('—');
    expect(fmtRate(0)).toBe('0%');
    expect(fmtRate(0.8)).toBe('80%');
    expect(fmtRate(0.999)).toBe('99%');
    expect(fmtRate(1)).toBe('100%');
    expect(fmtRate(0.004)).toBe('0.4%');
  });
});
