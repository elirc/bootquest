import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ApiErrorBody, DashboardResponse } from '@bootquest/shared/api';
import { SlateSettingsResponse } from '@bootquest/shared/api-ext';
import { DAY_MS } from '../../src/engines/clock.ts';
import { getSlate } from '../../src/engines/streak.ts';
import { insertUnit } from '../../src/store/content.ts';
import { useApi, type ApiCtx } from './harness.ts';

/** Unpassed drill units on every slate track (the fixture has 2 js drills only). */
function stockDrills(ctx: ApiCtx, n = 10): void {
  for (const track of ['js', 'csharp', 'java', 'sysdesign']) {
    for (let i = 0; i < n; i++) {
      const key = `settings:${track}:${i}`;
      insertUnit(
        ctx.db,
        { key, track, kind: 'drill', title: key, difficulty: 1, checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'x' }] } }] },
        ctx.clock,
      );
    }
  }
}

const rows = (ctx: ApiCtx) => ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM slate_setting')!.n;
const put = (ctx: ApiCtx, body: unknown) => request(ctx.app).put('/api/settings/slate').send(body as object);
const dashboard = async (ctx: ApiCtx) => DashboardResponse.parse((await request(ctx.app).get('/api/dashboard')).body);
const shape = (d: DashboardResponse) => d.slate.items.map((i) => (i.kind === 'drill-set' ? `${i.slot}x${i.size}` : i.slot));

function expectError(res: request.Response, status: number, code: string, pathPart?: string): void {
  expect(res.status).toBe(status);
  const body = ApiErrorBody.parse(res.body);
  expect(body.error.code).toBe(code);
  if (pathPart) expect(JSON.stringify(body.error.issues ?? [])).toContain(pathPart);
}

describe('A1 first run: GET /api/dashboard on an empty DB', () => {
  const ctx = useApi();

  it('<= 6 actions, no review slot, nothing ticked; opening it for days never paints missed days', async () => {
    stockDrills(ctx);
    const d = await dashboard(ctx);
    expect(shape(d)).toEqual(['drill:jsx1', 'drill:csharpx1', 'drill:javax1', 'drill:sysdesignx1']);
    expect(d.slate.items.length).toBeLessThanOrEqual(6);
    expect(d.slate.items.some((i) => i.slot === 'review' || i.done)).toBe(false);
    for (let i = 0; i < 5; i++) {
      ctx.clock.advance(DAY_MS);
      await dashboard(ctx);
    }
    const later = await dashboard(ctx);
    expect(later.heatmap.some((h) => h.status === 'missed')).toBe(false);
    expect(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM daily_slate WHERE status = 'missed'`)!.n).toBe(5); // stored rows kept
  });

  it('the first verified drill pass leaves today\'s slate size unchanged (through the real submit route)', async () => {
    const before = shape(await dashboard(ctx));
    const res = await request(ctx.app).post(`/api/units/${ctx.id('fixture:drill-add')}/submit`).send({ code: 'return a + b' });
    expect(res.status).toBe(200);
    const after = await dashboard(ctx);
    expect(shape(after)).toEqual(before);
    expect(after.slate.items.find((i) => i.slot === 'drill:js')!.done).toBe(true);
  });
});

describe('A1 GET/PUT /api/settings/slate', () => {
  const ctx = useApi();

  it('GET on an empty DB: unconfigured, every slate track on at the default size, effective tomorrow', async () => {
    const res = await request(ctx.app).get('/api/settings/slate');
    expect(res.status).toBe(200);
    const s = SlateSettingsResponse.parse(res.body);
    expect(s).toMatchObject({ configured: false, today: '2026-10-01', effectiveDay: '2026-10-02', defaultSize: 1, fullSize: 5, minSize: 1, maxSize: 10 });
    expect(s.todayTracks.map((t) => [t.trackId, t.enabled, t.size, t.configured])).toEqual([
      ['js', true, 1, false],
      ['csharp', true, 1, false],
      ['java', true, 1, false],
      ['sysdesign', true, 1, false],
    ]);
    expect(s.tomorrowTracks).toEqual(s.todayTracks);
    expectError(await request(ctx.app).get('/api/settings/slate?x=1'), 400, 'VALIDATION');
  });

  it('PUT java+sysdesign size 3 changes TOMORROW only; today and closed days keep their history and status', async () => {
    stockDrills(ctx);
    await request(ctx.app).post(`/api/units/${ctx.id('fixture:drill-add')}/submit`).send({ code: 'return a + b' });
    const day1 = await dashboard(ctx);
    const res = await put(ctx, {
      tracks: [
        { trackId: 'js', enabled: false },
        { trackId: 'csharp', enabled: false },
        { trackId: 'java', enabled: true, size: 3 },
        { trackId: 'sysdesign', enabled: true, size: 3 },
      ],
    });
    expect(res.status).toBe(200);
    const s = SlateSettingsResponse.parse(res.body);
    expect(s.configured).toBe(true);
    expect(s.todayTracks.every((t) => t.enabled && t.size === 1)).toBe(true);
    expect(s.tomorrowTracks.map((t) => [t.trackId, t.enabled, t.size])).toEqual([
      ['js', false, 1],
      ['csharp', false, 1],
      ['java', true, 3],
      ['sysdesign', true, 3],
    ]);
    expect(ctx.db.all<{ effective_day: string }>('SELECT DISTINCT effective_day FROM slate_setting')).toEqual([{ effective_day: '2026-10-02' }]);
    const sameDay = await dashboard(ctx);
    expect(sameDay.slate).toEqual(day1.slate);
    // tomorrow
    ctx.clock.advance(DAY_MS);
    const day2 = await dashboard(ctx);
    expect(shape(day2)).toEqual(['drill:javax3', 'drill:sysdesignx3']);
    const closed = getSlate(ctx.db, '2026-10-01')!;
    expect(closed.items.map((i) => i.slot)).toEqual(day1.slate.items.map((i) => i.slot));
    const status1 = day2.heatmap.find((h) => h.day === '2026-10-01')!.status;
    // a later change never moves day 1 or day 2
    await put(ctx, { preset: 'full' });
    ctx.clock.advance(DAY_MS);
    const day3 = await dashboard(ctx);
    expect(shape(day3)).toEqual(['drill:jsx5', 'drill:csharpx5', 'drill:javax5', 'drill:sysdesignx5']);
    expect(getSlate(ctx.db, '2026-10-01')).toEqual(closed);
    expect(getSlate(ctx.db, '2026-10-02')!.items.map((i) => i.slot)).toEqual(['drill:java', 'drill:sysdesign']);
    expect(day3.heatmap.find((h) => h.day === '2026-10-01')!.status).toBe(status1);
  });

  it('presets: full = 5 per track, default = back to the default size; rows are appended, never rewritten', async () => {
    const full = SlateSettingsResponse.parse((await put(ctx, { preset: 'full' })).body);
    expect(full.tomorrowTracks.map((t) => [t.enabled, t.size])).toEqual(Array(4).fill([true, 5]));
    expect(rows(ctx)).toBe(4);
    const def = SlateSettingsResponse.parse((await put(ctx, { preset: 'default' })).body);
    expect(def.tomorrowTracks.map((t) => [t.enabled, t.size, t.configured])).toEqual(Array(4).fill([true, 1, true]));
    expect(rows(ctx)).toBe(8);
    // an unlisted track keeps tomorrow's shape
    const one = SlateSettingsResponse.parse((await put(ctx, { tracks: [{ trackId: 'java', enabled: true, size: 2 }] })).body);
    expect(one.tomorrowTracks.map((t) => t.size)).toEqual([1, 1, 2, 1]);
    expect(rows(ctx)).toBe(9);
  });

  it('refusals write nothing: bad shape, unknown / locked / drill-less track, duplicates, size bounds, every track off', async () => {
    const cases: Array<[unknown, string]> = [
      [{}, 'body'],
      [{ preset: 'huge' }, 'body'],
      [{ preset: 'full', tracks: [] }, 'body'],
      [{ tracks: [] }, 'body'],
      [{ tracks: [{ trackId: 'rust', enabled: true }] }, 'body'],
      [{ tracks: [{ trackId: 'js', enabled: true, size: 0 }] }, 'body'],
      [{ tracks: [{ trackId: 'js', enabled: true, size: 11 }] }, 'body'],
      [{ tracks: [{ trackId: 'js', enabled: true, size: 2.5 }] }, 'body'],
      [{ tracks: [{ trackId: 'js', enabled: 'yes' }] }, 'body'],
      [{ tracks: [{ trackId: 'agentic', enabled: true }] }, 'body.tracks.0.trackId'],
      [{ tracks: [{ trackId: 'js', enabled: true }, { trackId: 'js', enabled: false }] }, 'body.tracks.1.trackId'],
      [{ tracks: ['js', 'csharp', 'java', 'sysdesign'].map((trackId) => ({ trackId, enabled: false })) }, 'body'],
    ];
    for (const [body, path] of cases) expectError(await put(ctx, body), 400, 'VALIDATION', path);
    ctx.db.run(`UPDATE track SET locked = 1 WHERE id = 'java'`);
    expectError(await put(ctx, { tracks: [{ trackId: 'java', enabled: true }] }), 400, 'VALIDATION', 'body.tracks.0.trackId');
    // switching off the last track that is still on is refused too
    ctx.db.run(`UPDATE track SET locked = 0 WHERE id = 'java'`);
    expect((await put(ctx, { tracks: ['js', 'csharp', 'java'].map((trackId) => ({ trackId, enabled: false })) })).status).toBe(200);
    expectError(await put(ctx, { tracks: [{ trackId: 'sysdesign', enabled: false }] }), 400, 'VALIDATION', 'body');
    expect(rows(ctx)).toBe(3);
    // the honesty guard: a PUT without a JSON content type never reaches the route
    const raw = await request(ctx.app).put('/api/settings/slate').set('Content-Type', 'text/plain').send('{"preset":"full"}');
    expectError(raw, 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(rows(ctx)).toBe(3);
  });
});
