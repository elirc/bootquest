import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, dayKey } from '../src/engines/clock.ts';
import {
  dailyBuckets,
  dayRange,
  forecastBuckets,
  passRate,
  passRatesBy,
  retention,
  trackProgress,
  weekStart,
  weeklyBuckets,
  type GradedAttemptRow,
} from '../src/engines/stats.ts';

// Campaign 2 B2: the stats bucket math. Day keys are LOCAL calendar days; these tests pin the
// behaviour under a non-UTC zone with DST, a zone whose DST jump skips local midnight, and the
// date-line zones where one UTC instant is two different local days.

const ORIGINAL_TZ = process.env.TZ;
function withTz(tz: string) {
  beforeEach(() => {
    process.env.TZ = tz;
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });
}

describe('weekStart / dayRange (calendar math, Monday weeks)', () => {
  withTz('America/New_York');

  it('maps every weekday to its Monday, across month and year ends', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(weekStart('2026-10-14')).toBe('2026-10-12'); // Wednesday
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday belongs to the week before
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(weekStart('2026-11-01')).toBe('2026-10-26'); // Sunday of the fall-back DST weekend
    expect(weekStart('2027-01-01')).toBe('2026-12-28'); // Friday, week starts in the previous year
    expect(weekStart('2028-02-29')).toBe('2028-02-28'); // leap day
  });

  it('dayRange is inclusive, contiguous across DST changes (a 23h and a 25h day are one key each)', () => {
    const spring = dayRange('2026-03-07', '2026-03-09');
    expect(spring).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    const fall = dayRange('2026-10-31', '2026-11-02');
    expect(fall).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(dayRange('2026-01-02', '2026-01-01')).toEqual([]);
    expect(dayRange('2026-01-01', '2026-12-31')).toHaveLength(365);
    expect(() => dayRange('2026-1-1', '2026-01-02')).toThrow(RangeError);
  });
});

describe('dailyBuckets / weeklyBuckets (XP over time)', () => {
  withTz('America/New_York');

  it('90 contiguous days ending today; zero days present; outside rows ignored; split by track', () => {
    const today = '2026-03-10';
    const rows = [
      { day: '2026-03-08', trackId: 'js', xp: 10 }, // DST spring-forward day
      { day: '2026-03-08', trackId: null, xp: 1 }, // review XP has no track
      { day: '2026-03-10', trackId: 'csharp', xp: 25 },
      { day: addDays(today, -90), trackId: 'js', xp: 999 }, // one day before the window
      { day: '2026-03-11', trackId: 'js', xp: 7 }, // future (clock skew) -> no bucket
    ];
    const days = dailyBuckets(rows, today, 90);
    expect(days).toHaveLength(90);
    expect(days[0]!.day).toBe(addDays(today, -89));
    expect(days[89]!.day).toBe(today);
    for (let i = 1; i < days.length; i++) expect(days[i]!.day).toBe(addDays(days[i - 1]!.day, 1));
    const dst = days.find((d) => d.day === '2026-03-08')!;
    expect(dst).toEqual({ day: '2026-03-08', total: 11, byTrack: { js: 10, csharp: 0, java: 0, agentic: 0, none: 1 } });
    expect(days.reduce((s, d) => s + d.total, 0)).toBe(36);
  });

  it('weekly buckets are all-time Monday weeks from the first XP week to the current week, gaps filled', () => {
    const rows = [
      { day: '2026-10-25', trackId: 'js', xp: 5 }, // Sunday -> week of Mon 10-19
      { day: '2026-10-26', trackId: 'agentic', xp: 3 }, // Monday
      { day: '2026-11-01', trackId: 'js', xp: 2 }, // Sunday (fall-back day) -> week of 10-26
      { day: '2026-11-16', trackId: 'csharp', xp: 8 },
    ];
    const weeks = weeklyBuckets(rows, '2026-11-18');
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
    expect(weeks.map((w) => w.total)).toEqual([5, 5, 0, 0, 8]);
    expect(weeks[1]!.byTrack).toEqual({ js: 2, csharp: 0, java: 0, agentic: 3, none: 0 });
    expect(weeklyBuckets([], '2026-11-18')).toEqual([]);
  });

  it('an XP ledger dated only in the future yields just the current week (no negative range)', () => {
    expect(weeklyBuckets([{ day: '2027-01-05', trackId: 'js', xp: 4 }], '2026-12-30').map((w) => [w.weekStart, w.total])).toEqual([['2026-12-28', 0]]);
  });
});

describe('forecastBuckets (review due forecast)', () => {
  describe('America/New_York (DST)', () => {
    withTz('America/New_York');

    it('buckets by the LOCAL day of the due instant across spring-forward; overdue folds into today; later counted', () => {
      const today = '2026-03-07';
      const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();
      const dues = [
        at(2026, 3, 1, 9), // overdue
        at(2026, 3, 7, 23, 59), // today
        at(2026, 3, 8, 0, 30), // DST day, before the jump
        at(2026, 3, 8, 3, 30), // DST day, after the 02:00 -> 03:00 jump
        at(2026, 3, 8, 23, 30), // DST day, late (the day is only 23h long)
        at(2026, 3, 9, 0, 0), // midnight after the short day belongs to the 9th
        at(2026, 3, 20, 23, 59), // last day of a 14-day window
        at(2026, 3, 21, 0, 0), // first instant after the window
      ];
      const f = forecastBuckets(dues, today, 14);
      expect(f.forecast).toHaveLength(14);
      expect(f.forecast[0]).toEqual({ day: '2026-03-07', due: 2 });
      expect(f.forecast[1]).toEqual({ day: '2026-03-08', due: 3 });
      expect(f.forecast[2]).toEqual({ day: '2026-03-09', due: 1 });
      expect(f.forecast[13]).toEqual({ day: '2026-03-20', due: 1 });
      expect(f.overdue).toBe(1);
      expect(f.later).toBe(1);
      expect(f.forecast.reduce((s, d) => s + d.due, 0) + f.later).toBe(dues.length);
    });

    it('fall-back: both 01:30s of the 25h day are that day', () => {
      const first = new Date(2026, 10, 1, 1, 30).getTime(); // EDT
      const second = first + 60 * 60 * 1000; // the repeated 01:30 EST
      expect(dayKey(second)).toBe('2026-11-01');
      const f = forecastBuckets([first, second, new Date(2026, 10, 1, 23, 30).getTime()], '2026-10-31', 3);
      expect(f.forecast.map((d) => d.due)).toEqual([0, 3, 0]);
    });
  });

  describe('America/Havana (DST jump skips local midnight)', () => {
    withTz('America/Havana');

    it('a card due at the first instant of the shortened day is still that day', () => {
      // 2026-03-08 00:00 does not exist in Havana (00:00 -> 01:00); JS normalises it to 01:00
      const firstInstant = new Date(2026, 2, 8, 0, 0).getTime();
      expect(dayKey(firstInstant)).toBe('2026-03-08');
      const before = firstInstant - 1;
      expect(dayKey(before)).toBe('2026-03-07');
      const f = forecastBuckets([before, firstInstant], '2026-03-07', 2);
      expect(f.forecast).toEqual([
        { day: '2026-03-07', due: 1 },
        { day: '2026-03-08', due: 1 },
      ]);
    });
  });

  describe('date-line zones: the same UTC instant is a different local day', () => {
    const instant = Date.UTC(2026, 9, 14, 11, 0); // 2026-10-14 11:00Z
    describe('Pacific/Kiritimati (UTC+14)', () => {
      withTz('Pacific/Kiritimati');
      it('is already tomorrow', () => {
        expect(forecastBuckets([instant], '2026-10-15', 1).forecast).toEqual([{ day: '2026-10-15', due: 1 }]);
      });
    });
    describe('Pacific/Pago_Pago (UTC-11)', () => {
      withTz('Pacific/Pago_Pago');
      it('is still today (00:00 local)', () => {
        expect(forecastBuckets([instant], '2026-10-14', 1).forecast).toEqual([{ day: '2026-10-14', due: 1 }]);
        expect(forecastBuckets([instant - 1], '2026-10-14', 1)).toMatchObject({ overdue: 1, forecast: [{ day: '2026-10-14', due: 1 }] });
      });
    });
  });
});

describe('retention', () => {
  it('recalled = not again; null without reviews (never a fake 0%)', () => {
    expect(retention([])).toEqual({ reviews: 0, recalled: 0, rate: null });
    expect(retention(['again', 'good', 'hard', 'easy'])).toEqual({ reviews: 4, recalled: 3, rate: 0.75 });
    expect(retention(['again'])).toEqual({ reviews: 1, recalled: 0, rate: 0 });
  });
});

describe('passRate (graded attempts)', () => {
  let id = 0;
  const row = (o: Partial<GradedAttemptRow>): GradedAttemptRow => ({
    id: ++id,
    unitId: 1,
    trackId: 'js',
    checkType: 'drill-js',
    mode: 'solo',
    verified: false,
    createdAt: id,
    ...o,
  });

  it('first try = the unit\'s EARLIEST graded attempt, a verified pass made solo', () => {
    const rows = [
      row({ unitId: 1, verified: true, createdAt: 10 }), // first try pass
      row({ unitId: 2, verified: false, createdAt: 11 }),
      row({ unitId: 2, verified: true, createdAt: 12 }), // passed on retry: not first-try
      row({ unitId: 3, verified: true, mode: 'assisted', createdAt: 13 }), // self-assisted: not first-try
      row({ unitId: 4, verified: true, mode: 'guided', createdAt: 14 }), // after a reveal: not first-try
    ];
    // input order must not matter: the earliest attempt decides
    const r = passRate([...rows].reverse());
    expect(r).toEqual({ attempts: 5, passes: 4, passRate: 0.8, units: 4, firstTryPasses: 1, firstTryRate: 0.25 });
  });

  it('ties on createdAt break by id; empty input gives null rates', () => {
    const r = passRate([row({ unitId: 9, verified: false, createdAt: 5, id: 100 }), row({ unitId: 9, verified: true, createdAt: 5, id: 101 })]);
    expect(r.firstTryPasses).toBe(0);
    expect(passRate([])).toEqual({ attempts: 0, passes: 0, passRate: null, units: 0, firstTryPasses: 0, firstTryRate: null });
  });

  it('passRatesBy keeps the enum order and drops empty groups', () => {
    const rows = [row({ trackId: 'csharp', checkType: 'drill-cs', verified: true }), row({ unitId: 2, trackId: 'js', checkType: 'quiz' })];
    expect(passRatesBy(rows, (r) => r.trackId, ['js', 'csharp', 'java', 'agentic'] as const).map((g) => g.key)).toEqual(['js', 'csharp']);
  });
});

describe('trackProgress (ui-audit #26: the one sidebar/campaign definition)', () => {
  it('campaign core quests drive the percentage when the track has any', () => {
    expect(trackProgress({ locked: false, coreDone: 3, coreTotal: 12, practiceDone: 0, practiceTotal: 900 })).toMatchObject({ pct: 25, basis: 'campaign-core' });
  });
  it('floors, so 100% means all done and a first quest out of 300 still reads 0 with done > 0 visible', () => {
    expect(trackProgress({ locked: false, coreDone: 199, coreTotal: 200, practiceDone: 0, practiceTotal: 0 }).pct).toBe(99);
    expect(trackProgress({ locked: false, coreDone: 200, coreTotal: 200, practiceDone: 0, practiceTotal: 0 }).pct).toBe(100);
    expect(trackProgress({ locked: false, coreDone: 1, coreTotal: 300, practiceDone: 0, practiceTotal: 0 })).toMatchObject({ pct: 0, coreDone: 1 });
  });
  it('falls back to practice units without campaign core; locked or empty tracks are basis none', () => {
    expect(trackProgress({ locked: false, coreDone: 0, coreTotal: 0, practiceDone: 1, practiceTotal: 4 })).toMatchObject({ pct: 25, basis: 'practice' });
    expect(trackProgress({ locked: true, coreDone: 0, coreTotal: 5, practiceDone: 0, practiceTotal: 4 })).toMatchObject({ pct: 0, basis: 'none' });
    expect(trackProgress({ locked: false, coreDone: 0, coreTotal: 0, practiceDone: 0, practiceTotal: 0 })).toMatchObject({ pct: 0, basis: 'none' });
  });
});
