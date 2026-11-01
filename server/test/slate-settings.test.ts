import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/database.ts';
import { putSlateSettings } from '../src/api/settings-service.ts';
import { DAY_MS, dayKey, nowMs } from '../src/engines/clock.ts';
import { addReviewItem } from '../src/engines/fsrs.ts';
import {
  closeElapsedDays,
  composeSlate,
  dayBounds,
  DEFAULT_DRILL_SET_SIZE,
  getSlate,
  isSlateComplete,
  reviewSlotShown,
  slateShape,
  streakStatus,
} from '../src/engines/streak.ts';
import { slateStatuses } from '../src/store/queries.ts';
import { makeUnit, submit, useTempDb } from './helpers.ts';

const SLATE_TRACKS = ['js', 'csharp', 'java', 'sysdesign'] as const;

function stock(db: Db, clock: () => Date, n = 20): Record<string, number[]> {
  const ids: Record<string, number[]> = {};
  for (const t of SLATE_TRACKS) ids[t] = Array.from({ length: n }, () => makeUnit(db, clock, { kind: 'drill', track: t }));
  return ids;
}

function setting(db: Db, track: string, enabled: boolean, size: number | null, effectiveDay: string, createdAt = 0): void {
  db.run(
    'INSERT INTO slate_setting (track_id, enabled, size, effective_day, created_at) VALUES (?, ?, ?, ?, ?)',
    track,
    enabled ? 1 : 0,
    size,
    effectiveDay,
    createdAt,
  );
}

const shapeOf = (db: Db, clock: () => Date): string[] =>
  composeSlate(db, clock).items.map((i) => (i.kind === 'drill-set' ? `${i.slot}x${i.size}` : i.slot));

const DEFAULT_SHAPE = ['drill:jsx1', 'drill:csharpx1', 'drill:javax1', 'drill:sysdesignx1'];

describe('A1 unconfigured first-run slate', () => {
  const ctx = useTempDb();

  it('an empty learner gets 1 drill per slate track and no review slot: 4 actions (5 with a campaign step)', () => {
    stock(ctx.db, ctx.clock);
    expect(DEFAULT_DRILL_SET_SIZE).toBe(1);
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(DEFAULT_SHAPE);
    const unitId = makeUnit(ctx.db, ctx.clock, { kind: 'guided-project' });
    const act = ctx.db.run(`INSERT INTO campaign_act (track_id, act_no, title) VALUES ('js', 1, 'Act 1')`).lastInsertRowid;
    ctx.db.run(`INSERT INTO quest (act_id, unit_id, repo, index_rank, verdict) VALUES (?, ?, 'elirc/x', 1, 'study')`, act, unitId);
    const items = composeSlate(ctx.db, ctx.clock).items;
    expect(items.map((i) => i.slot)).toEqual(['drill:js', 'drill:csharp', 'drill:java', 'drill:sysdesign', 'campaign']);
    expect(items.length).toBeLessThanOrEqual(6);
    expect(items.some((i) => i.done)).toBe(false);
  });

  it("C1 defect: the first verified drill pass on day one does NOT change today's slate size", () => {
    const ids = stock(ctx.db, ctx.clock);
    const sizes = (items: ReturnType<typeof composeSlate>['items']) => items.map((i) => [i.slot, i.kind === 'drill-set' ? i.size : null]);
    const before = composeSlate(ctx.db, ctx.clock).items;
    submit(ctx.db, ctx.clock, ids.js![0]!);
    const after = composeSlate(ctx.db, ctx.clock).items;
    expect(sizes(after)).toEqual(sizes(before));
    expect(after.find((i) => i.slot === 'drill:js')!.done).toBe(true);
    // more passes the same day never grow it either
    for (const id of ids.js!.slice(1, 6)) submit(ctx.db, ctx.clock, id);
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(DEFAULT_SHAPE);
    // and the next day is still the default: no auto-ramp
    ctx.clock.advance(DAY_MS);
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(DEFAULT_SHAPE);
  });

  it('a day of 1 drill per track completes and counts as a slate day', () => {
    const ids = stock(ctx.db, ctx.clock);
    for (const t of SLATE_TRACKS) submit(ctx.db, ctx.clock, ids[t]![0]!);
    expect(isSlateComplete(composeSlate(ctx.db, ctx.clock).items)).toBe(true); // the service composes after every submit
    expect(streakStatus(ctx.db, ctx.clock).todayComplete).toBe(true);
    ctx.clock.advance(DAY_MS);
    expect(streakStatus(ctx.db, ctx.clock)).toMatchObject({ current: 1, slateDaysBanked: 1 });
    expect(getSlate(ctx.db, '2026-10-01')!.status).toBe('slate');
  });
});

describe('A1 review slot: hidden until a card existed before the day started', () => {
  const ctx = useTempDb();

  it('a card created today does not add the slot today (no mid-day growth); it is there tomorrow', () => {
    stock(ctx.db, ctx.clock);
    expect(composeSlate(ctx.db, ctx.clock).items.some((i) => i.slot === 'review')).toBe(false);
    addReviewItem(ctx.db, { cardKey: 'today' }, ctx.clock);
    expect(composeSlate(ctx.db, ctx.clock).items.some((i) => i.slot === 'review')).toBe(false);
    ctx.clock.advance(DAY_MS);
    expect(composeSlate(ctx.db, ctx.clock).items.find((i) => i.slot === 'review')).toMatchObject({ done: false }); // it is due
  });

  it('a retest schedule is not a review card', () => {
    const unit = makeUnit(ctx.db, ctx.clock, { kind: 'retest' });
    const t = ctx.clock().getTime();
    ctx.db.run(
      `INSERT INTO review_item (card_key, kind, unit_id, fsrs_state, due_at, created_at, updated_at) VALUES ('retest:x', 'retest', ?, '{}', ?, ?, ?)`,
      unit,
      t,
      t,
      t,
    );
    const [, end] = dayBounds('2026-10-01');
    expect(reviewSlotShown(ctx.db, end + DAY_MS)).toBe(false);
  });
});

describe('A1 slate settings are read as of the day (append-only, effective tomorrow)', () => {
  const ctx = useTempDb();

  it('a setting effective tomorrow leaves today alone; tomorrow follows it; closed days never move', () => {
    const ids = stock(ctx.db, ctx.clock);
    submit(ctx.db, ctx.clock, ids.js![0]!);
    const day1 = composeSlate(ctx.db, ctx.clock).items;
    // the learner chooses java + sysdesign, 3 each, on day 1 (effective day 2)
    for (const t of ['js', 'csharp']) setting(ctx.db, t, false, null, '2026-10-02');
    for (const t of ['java', 'sysdesign']) setting(ctx.db, t, true, 3, '2026-10-02');
    expect(composeSlate(ctx.db, ctx.clock).items).toEqual(day1);
    ctx.clock.advance(DAY_MS);
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(['drill:javax3', 'drill:sysdesignx3']);
    expect(getSlate(ctx.db, '2026-10-01')!.items.map((i) => i.slot)).toEqual(day1.map((i) => i.slot));
    // a later change (effective day 4) never rewrites day 2 or day 3
    setting(ctx.db, 'js', true, 2, '2026-10-04');
    ctx.clock.advance(DAY_MS);
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(['drill:javax3', 'drill:sysdesignx3']);
    ctx.clock.advance(DAY_MS);
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(['drill:jsx2', 'drill:javax3', 'drill:sysdesignx3']);
    expect(getSlate(ctx.db, '2026-10-02')!.items.map((i) => i.slot)).toEqual(['drill:java', 'drill:sysdesign']);
  });

  it('a day with no stored row is re-derived with the settings of THAT day', () => {
    stock(ctx.db, ctx.clock);
    composeSlate(ctx.db, ctx.clock); // day 1 row
    setting(ctx.db, 'js', false, null, '2026-10-03');
    ctx.clock.advance(3 * DAY_MS); // days 2 and 3 have no row
    closeElapsedDays(ctx.db, ctx.clock);
    expect(getSlate(ctx.db, '2026-10-02')!.items.map((i) => i.slot)).toEqual(['drill:js', 'drill:csharp', 'drill:java', 'drill:sysdesign']);
    expect(getSlate(ctx.db, '2026-10-03')!.items.map((i) => i.slot)).toEqual(['drill:csharp', 'drill:java', 'drill:sysdesign']);
  });

  it('the latest row of the latest effective day wins; size NULL is the default size', () => {
    setting(ctx.db, 'java', true, 4, '2026-09-01', 1);
    setting(ctx.db, 'java', true, 7, '2026-09-01', 2);
    setting(ctx.db, 'csharp', true, 3, '2026-09-01');
    setting(ctx.db, 'csharp', true, null, '2026-09-15');
    setting(ctx.db, 'js', false, 9, '2026-10-02'); // future: not yet
    expect(slateShape(ctx.db, '2026-10-01').map((s) => [s.trackId, s.enabled, s.size, s.configured])).toEqual([
      ['js', true, 1, false],
      ['csharp', true, 1, true],
      ['java', true, 7, true],
      ['sysdesign', true, 1, false],
    ]);
  });

  it('track.slate_drills stays the capability flag: an enabled setting does not put a drill-less track on the slate', () => {
    stock(ctx.db, ctx.clock);
    ctx.db.run(`UPDATE track SET slate_drills = 0 WHERE id = 'csharp'`);
    setting(ctx.db, 'csharp', true, 5, '2026-09-01');
    expect(composeSlate(ctx.db, ctx.clock).items.some((i) => i.slot === 'drill:csharp')).toBe(false);
    expect(slateShape(ctx.db, '2026-10-01').map((s) => s.trackId)).toEqual(['js', 'java', 'sysdesign']);
  });

  it('slate_setting is append-only', () => {
    setting(ctx.db, 'js', true, 2, '2026-10-02');
    expect(() => ctx.db.run('UPDATE slate_setting SET size = 3')).toThrow(/append-only/);
    expect(() => ctx.db.run('DELETE FROM slate_setting')).toThrow(/append-only/);
  });
});

describe('A1 phantom missed days (display-only, R3.1)', () => {
  const ctx = useTempDb();
  const storedBeforeDay4 = () =>
    ctx.db.all<{ status: string }>(`SELECT status FROM daily_slate WHERE day < '2026-10-04' ORDER BY day`).map((r) => r.status);

  it('missed days before the first learner action render none; later ones stay missed; stored rows are untouched', () => {
    const ids = stock(ctx.db, ctx.clock);
    // days 1-3: the learner only opens the dashboard (a slate row, no action)
    for (let d = 0; d < 3; d++) {
      streakStatus(ctx.db, ctx.clock);
      composeSlate(ctx.db, ctx.clock);
      ctx.clock.advance(DAY_MS);
    }
    streakStatus(ctx.db, ctx.clock); // closes days 1-3
    expect(storedBeforeDay4()).toEqual(['missed', 'missed', 'missed']);
    expect([...slateStatuses(ctx.db, '2026-09-01', '2026-10-04').keys()]).toEqual([]);
    // day 4: the first action (a failed attempt is a learner action too)
    composeSlate(ctx.db, ctx.clock);
    submit(ctx.db, ctx.clock, ids.js![0]!, { pass: false });
    expect(slateStatuses(ctx.db, '2026-09-01', '2026-10-04').get('2026-10-04')).toBe('open');
    ctx.clock.advance(2 * DAY_MS); // day 5: nothing; now day 6
    streakStatus(ctx.db, ctx.clock);
    const statuses = slateStatuses(ctx.db, '2026-09-01', '2026-10-06');
    for (const d of ['2026-10-01', '2026-10-02', '2026-10-03']) expect(statuses.get(d)).toBeUndefined();
    expect(statuses.get('2026-10-04')).toBe('missed');
    expect(statuses.get('2026-10-05')).toBe('missed');
    expect(storedBeforeDay4()).toEqual(['missed', 'missed', 'missed']); // stored history unchanged
  });

  it('an XP event is a learner action too (a card alone is not)', () => {
    addReviewItem(ctx.db, { cardKey: 'c' }, ctx.clock); // a card is not an action
    composeSlate(ctx.db, ctx.clock);
    ctx.clock.advance(2 * DAY_MS);
    streakStatus(ctx.db, ctx.clock);
    expect(slateStatuses(ctx.db, '2026-10-01', '2026-10-03').get('2026-10-02')).toBeUndefined();
    ctx.db.run(`INSERT INTO xp_event (kind, amount, day, created_at) VALUES ('review', 0, '2026-10-02', ?)`, ctx.clock().getTime());
    expect(slateStatuses(ctx.db, '2026-10-01', '2026-10-03').get('2026-10-01')).toBeUndefined();
    expect(slateStatuses(ctx.db, '2026-10-01', '2026-10-03').get('2026-10-02')).toBe('missed');
  });
});

describe('A1 local-midnight boundary (ring review S7-on-S1 SHOULD-1)', () => {
  const ctx = useTempDb();
  /** 23:59 local on 2026-10-01 (day D) */
  const lateOnD = () => new Date(2026, 9, 1, 23, 59, 0, 0).getTime();

  it('a change saved at 23:59 on day D is effective D+1: D keeps its slate; at 00:01 on D+1 the new shape applies', () => {
    stock(ctx.db, ctx.clock);
    ctx.clock.set(lateOnD());
    const dayD = composeSlate(ctx.db, ctx.clock);
    expect(dayD.day).toBe('2026-10-01');
    const saved = putSlateSettings(
      { db: ctx.db, clock: ctx.clock },
      {
        tracks: [
          { trackId: 'js', enabled: false },
          { trackId: 'csharp', enabled: false },
          { trackId: 'java', enabled: true, size: 3 },
          { trackId: 'sysdesign', enabled: true, size: 3 },
        ],
      },
    );
    expect(saved).toMatchObject({ today: '2026-10-01', effectiveDay: '2026-10-02' });
    expect(ctx.db.all<{ d: string }>('SELECT DISTINCT effective_day AS d FROM slate_setting')).toEqual([{ d: '2026-10-02' }]);
    // still day D (23:59): its slate does not move
    expect(composeSlate(ctx.db, ctx.clock).items).toEqual(dayD.items);
    ctx.clock.advance(2 * 60 * 1000); // 00:01 local on D+1
    expect(dayKey(nowMs(ctx.clock))).toBe('2026-10-02');
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(['drill:javax3', 'drill:sysdesignx3']);
    // D closed with the slot list it had
    expect(getSlate(ctx.db, '2026-10-01')!.items.map((i) => i.slot)).toEqual(dayD.items.map((i) => i.slot));
  });

  it('an attempt at 23:59 on day D makes D (not D+1) the first-action day of the heatmap remap', () => {
    const ids = stock(ctx.db, ctx.clock);
    composeSlate(ctx.db, ctx.clock); // day D noon: a dashboard open only
    ctx.clock.set(new Date(2026, 9, 2, 23, 59, 0, 0).getTime()); // 23:59 on D+1 = 2026-10-02
    composeSlate(ctx.db, ctx.clock);
    submit(ctx.db, ctx.clock, ids.js![0]!, { pass: false }); // the first learner action, a minute before midnight
    ctx.clock.advance(2 * 60 * 1000); // 00:01 on 2026-10-03
    expect(dayKey(nowMs(ctx.clock))).toBe('2026-10-03');
    ctx.clock.advance(DAY_MS); // 2026-10-04: 10-01..10-03 are closed
    streakStatus(ctx.db, ctx.clock);
    const statuses = slateStatuses(ctx.db, '2026-09-01', '2026-10-04');
    expect(statuses.get('2026-10-01')).toBeUndefined(); // before the first action: renders none
    expect(statuses.get('2026-10-02')).toBe('missed'); // the 23:59 attempt's own local day
    expect(statuses.get('2026-10-03')).toBe('missed');
  });
});
