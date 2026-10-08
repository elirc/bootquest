import { describe, expect, it } from 'vitest';
import heatmap from '../api/fixtures/heatmap.json';
import type { HeatmapDay } from '../api/types';
import { bucketXp, buildHeatGrid, describeCell, weekdayOf } from './heatmap';

describe('bucketXp', () => {
  it.each([
    [0, 0],
    [-5, 0],
    [Number.NaN, 0],
    [1, 1],
    [19, 1], // below the 20-XP partial-day line
    [20, 2],
    [59, 2],
    [60, 3],
    [119, 3],
    [120, 4],
    [900, 4],
  ])('xp %d → bucket %d', (xp, bucket) => {
    expect(bucketXp(xp)).toBe(bucket);
  });
});

describe('buildHeatGrid', () => {
  it('starts columns on Monday and pads before the first day', () => {
    // 2026-10-01 is a Thursday → Mon..Wed padded.
    expect(weekdayOf('2026-10-01')).toBe(3);
    const g = buildHeatGrid([{ day: '2026-10-01', xp: 30, status: 'partial' }], '2026-10-01');
    expect(g.weeks).toHaveLength(1);
    expect(g.weeks[0]!.slice(0, 3)).toEqual([null, null, null]);
    expect(g.weeks[0]![3]).toMatchObject({ date: '2026-10-01', bucket: 2, isToday: true, weekday: 3 });
    expect(g.weeks[0]!.slice(4)).toEqual([null, null, null]);
  });

  it('fills dates the API omitted as zero-XP days so the grid never shifts', () => {
    const days: HeatmapDay[] = [
      { day: '2026-09-28', xp: 150, status: 'slate' },
      { day: '2026-10-01', xp: 10, status: 'missed' },
    ];
    const g = buildHeatGrid(days, '2026-10-02');
    const cells = g.weeks.flat().filter((c) => c !== null);
    expect(cells.map((c) => c.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(cells[1]).toMatchObject({ xp: 0, status: 'none', bucket: 0 });
    expect(cells[4]!.isToday).toBe(true);
    expect(g.totalXp).toBe(160);
    expect(g.activeDays).toBe(2);
  });

  it('keeps frozen status independent of the XP bucket', () => {
    const g = buildHeatGrid([{ day: '2026-09-28', xp: 0, status: 'frozen' }], '2026-09-28');
    expect(g.weeks[0]![0]).toMatchObject({ status: 'frozen', bucket: 0 });
  });

  it('describes every server day status', () => {
    const statuses = ['open', 'slate', 'partial', 'frozen', 'missed', 'none'] as const;
    for (const status of statuses) {
      const cell = buildHeatGrid([{ day: '2026-09-28', xp: 5, status }], '2026-09-28').weeks[0]![0]!;
      expect(describeCell(cell)).toMatch(/^Mon, Sep 28: 5 XP, \w/);
    }
  });

  it('lays the 90-day fixture out as 14 full week columns', () => {
    const days = heatmap as unknown as HeatmapDay[];
    const g = buildHeatGrid(days, '2026-10-07');
    expect(g.weeks).toHaveLength(14);
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
    expect(g.weeks.flat().filter(Boolean)).toHaveLength(90);
    expect(g.months.map((m) => m.label)).toEqual(['Jul', 'Aug', 'Sep', 'Oct']);
    // every bucket appears in realistic data
    expect(new Set(g.weeks.flat().map((c) => c?.bucket).filter((b) => b !== undefined))).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it('returns an empty grid for no data', () => {
    expect(buildHeatGrid([], '2026-10-07').weeks).toEqual([]);
  });
});
