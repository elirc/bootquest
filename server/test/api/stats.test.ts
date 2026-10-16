import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CampaignProgressResponse,
  PassRatesResponse,
  ReviewStatsResponse,
  TrackUnitsResponse,
  TracksResponse,
  XP_STATS_DAYS,
  XpStatsResponse,
} from '@bootquest/shared/api';
import { createApp } from '../../src/api/app.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import type { Runner } from '../../src/api/runners.ts';
import type { Db } from '../../src/db/database.ts';
import { addDays, DAY_MS, dayKey, fixedClock } from '../../src/engines/clock.ts';
import { addReviewItem } from '../../src/engines/fsrs.ts';
import { loadCampaignIntoDb, readCampaign } from '../../src/store/campaign.ts';
import { insertCheck, insertUnit } from '../../src/store/content.ts';
import { writeCampaignFixture } from '../campaign-fixture.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';
import { fakeDrillJs } from './harness.ts';

// Campaign 2 B2: the read-only stats endpoints, end to end through the real routes + ledgers.

const fakeStudyQuiz: Runner = async (_spec, sub) =>
  sub.answer === 'pass'
    ? { pass: true, output: '', failures: [], durationMs: 1 }
    : { pass: false, output: '', failures: [{ name: 'gate', message: 'below 80%' }], durationMs: 1 };

interface Ctx {
  tmp: TempDb;
  db: Db;
  clock: ReturnType<typeof fixedClock>;
  app: Express;
}

function useStatsApi(): Ctx {
  const ctx = {} as Ctx;
  beforeEach(() => {
    ctx.tmp = makeTempDb();
    ctx.db = ctx.tmp.db;
    ctx.clock = fixedClock(localNoon(2026, 10, 1));
    loadCampaignIntoDb(ctx.db, readCampaign(writeCampaignFixture(join(ctx.tmp.dir, 'campaign'))), ctx.clock);
    ctx.app = createApp({ db: ctx.db, clock: ctx.clock, runners: { 'drill-js': fakeDrillJs, 'study-quiz': fakeStudyQuiz }, content: mapContentStore({ 'stats:g': { solution: 'return a + b' } }) });
  });
  afterEach(() => ctx.tmp.cleanup());
  return ctx;
}

const unitOf = (db: Db, key: string) => db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', key)!.id;

function drill(ctx: Ctx, key: string, track = 'js'): number {
  return insertUnit(
    ctx.db,
    { key, track, kind: 'drill', title: key, difficulty: 1, competencies: [], prerequisites: [], checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.ok(true)' }] } }] },
    ctx.clock,
  );
}

const submit = (app: Express, id: number, body: Record<string, unknown>) => request(app).post(`/api/units/${id}/submit`).send(body);

async function get<T>(app: Express, path: string, schema: { parse(v: unknown): T }): Promise<T> {
  const res = await request(app).get(path);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return schema.parse(res.body);
}

describe('GET /api/stats/*: honest empty states on a fresh ledger', () => {
  const ctx = useStatsApi();

  it('xp: 90 zero days ending today, no weeks, zero totals', async () => {
    const xp = await get(ctx.app, '/api/stats/xp', XpStatsResponse);
    expect(xp.today).toBe('2026-10-01');
    expect(xp.days).toHaveLength(XP_STATS_DAYS);
    expect(xp.days.at(-1)!.day).toBe('2026-10-01');
    expect(xp.days.every((d) => d.total === 0)).toBe(true);
    expect(xp.weeks).toEqual([]);
    expect(xp.totals).toEqual({ allTime: 0, lastDays: 0, events: 0 });
  });

  it('pass rates: null rates, no groups', async () => {
    const p = await get(ctx.app, '/api/stats/pass-rates', PassRatesResponse);
    expect(p).toEqual({ overall: { attempts: 0, passes: 0, guidedPasses: 0, passRate: null, units: 0, firstTryPasses: 0, firstTryRate: null }, byTrack: [], byCheckType: [] });
  });

  it('reviews: 14 zero days, null retention', async () => {
    const r = await get(ctx.app, '/api/stats/reviews', ReviewStatsResponse);
    expect(r.forecast).toHaveLength(14);
    expect(r.forecast[0]!.day).toBe('2026-10-01');
    expect(r.forecast.every((d) => d.due === 0)).toBe(true);
    expect(r).toMatchObject({ cards: 0, dueNow: 0, overdue: 0, later: 0, retention: { window: { reviews: 0, rate: null }, allTime: { reviews: 0, rate: null } } });
  });

  it('campaign: per-track acts with the campaign map counts; a locked track is basis none', async () => {
    const c = await get(ctx.app, '/api/stats/campaign', CampaignProgressResponse);
    expect(c.tracks.map((t) => t.trackId)).toEqual(['js', 'csharp', 'java', 'agentic']);
    const js = c.tracks[0]!;
    expect(js.progress).toEqual({ pct: 0, basis: 'campaign-core', coreDone: 0, coreTotal: 2, practiceDone: 0, practiceTotal: 0 });
    expect(js.acts).toEqual([
      { actNo: 1, title: 'Act 1', unlocked: true, coreDone: 0, coreTotal: 1, corePending: 1, readingDone: 0, readingTotal: 2 },
      { actNo: 2, title: 'Act 2', unlocked: false, coreDone: 0, coreTotal: 1, corePending: 1, readingDone: 0, readingTotal: 1 },
    ]);
    expect(c.tracks[2]!.progress).toMatchObject({ basis: 'campaign-core', pct: 0, coreDone: 0 }); // java unlocked (011)
    ctx.db.run(`UPDATE track SET locked = 1 WHERE id = 'java'`);
    const locked = await get(ctx.app, '/api/stats/campaign', CampaignProgressResponse);
    expect(locked.tracks[2]!.progress.basis).toBe('none');
    expect(c.tracks[3]).toMatchObject({ acts: [], progress: { basis: 'none', pct: 0 } });
  });

  it('every stats route rejects unknown query parameters (strict)', async () => {
    for (const p of ['xp', 'pass-rates', 'reviews', 'campaign']) expect((await request(ctx.app).get(`/api/stats/${p}?x=1`)).status).toBe(400);
  });
});

describe('GET /api/stats/* over real ledger writes', () => {
  const ctx = useStatsApi();

  it('xp: buckets by local day and track (review XP is trackless), weeks run first-XP-week to now', async () => {
    const a = drill(ctx, 'stats:a');
    const cs = drill(ctx, 'stats:cs', 'csharp');
    expect((await submit(ctx.app, a, { code: 'return a + b' })).status).toBe(200);
    ctx.clock.advance(3 * DAY_MS);
    expect((await submit(ctx.app, cs, { code: 'return a * b' })).status).toBe(200);
    const item = addReviewItem(ctx.db, { cardKey: 'card:x' }, ctx.clock);
    expect((await request(ctx.app).post(`/api/reviews/${item.id}/grade`).send({ grade: 'good' })).status).toBe(200);

    const xp = await get(ctx.app, '/api/stats/xp', XpStatsResponse);
    expect(xp.today).toBe('2026-10-04');
    const byDay = new Map(xp.days.map((d) => [d.day, d]));
    const d1 = byDay.get('2026-10-01')!;
    const d4 = byDay.get('2026-10-04')!;
    expect(d1.byTrack.js).toBeGreaterThan(0);
    expect(d1.total).toBe(d1.byTrack.js);
    expect(d4.byTrack.csharp).toBeGreaterThan(0);
    expect(d4.byTrack.none).toBe(1);
    // the stats agree with the ledger itself
    const ledger = ctx.db.get<{ s: number }>('SELECT SUM(amount) AS s FROM xp_event')!.s;
    expect(xp.totals.allTime).toBe(ledger);
    expect(xp.totals.lastDays).toBe(ledger);
    expect(xp.weeks.map((w) => w.weekStart)).toEqual(['2026-09-28']); // Thu 10-01 and Sun 10-04 share a week
    expect(xp.weeks[0]!.total).toBe(ledger);
  });

  it('pass rates: per track and per check type from graded attempts; first try = earliest graded attempt, solo', async () => {
    const a = drill(ctx, 'stats:a');
    const b = drill(ctx, 'stats:b');
    const c = drill(ctx, 'stats:c');
    await submit(ctx.app, a, { code: 'return a + b' }); // first-try pass
    await submit(ctx.app, b, { code: 'return 0' }); // fail
    ctx.clock.advance(1000);
    await submit(ctx.app, b, { code: 'return a + b' }); // pass on retry
    await submit(ctx.app, c, { code: 'return a + b', selfAssisted: true }); // assisted pass
    const study = unitOf(ctx.db, 'campaign/js/study-a');
    insertCheck(ctx.db, study, { type: 'study-quiz', itemKeys: ['q1'] }, ctx.clock);
    await submit(ctx.app, study, { answer: 'pass' });
    // a reading self-attest is not a graded attempt
    expect((await request(ctx.app).post(`/api/units/${unitOf(ctx.db, 'campaign/js/read-r1')}/self-attest`).send({})).status).toBe(200);

    const p = await get(ctx.app, '/api/stats/pass-rates', PassRatesResponse);
    expect(p.overall).toEqual({ attempts: 5, passes: 4, guidedPasses: 0, passRate: 0.8, units: 4, firstTryPasses: 2, firstTryRate: 0.5 });
    expect(p.byTrack).toEqual([{ trackId: 'js', attempts: 5, passes: 4, guidedPasses: 0, passRate: 0.8, units: 4, firstTryPasses: 2, firstTryRate: 0.5 }]);
    expect(p.byCheckType.map((g) => [g.checkType, g.attempts, g.passes, g.firstTryPasses])).toEqual([
      ['drill-js', 4, 3, 1],
      ['study-quiz', 1, 1, 1],
    ]);
  });

  it('pass rates: a reveal then a passing (guided) submit is NOT a pass; the reveal row itself is not graded', async () => {
    const a = drill(ctx, 'stats:a');
    const g = drill(ctx, 'stats:g');
    await submit(ctx.app, a, { code: 'return a + b' }); // honest first-try pass
    await submit(ctx.app, g, { code: 'return 0' }); // honest fail
    ctx.clock.advance(1000);
    expect((await request(ctx.app).post(`/api/units/${g}/reveal`).send()).status).toBe(200);
    ctx.clock.advance(1000);
    const sub = await submit(ctx.app, g, { code: 'return a + b' }); // copies the revealed answer
    expect(sub.status).toBe(200);
    expect(sub.body.verdict).toBe('pass');
    expect(sub.body.attempt.mode).toBe('guided');

    const p = await get(ctx.app, '/api/stats/pass-rates', PassRatesResponse);
    expect(p.overall).toEqual({ attempts: 3, passes: 1, guidedPasses: 1, passRate: 1 / 3, units: 2, firstTryPasses: 1, firstTryRate: 0.5 });
    expect(p.byCheckType).toEqual([{ checkType: 'drill-js', attempts: 3, passes: 1, guidedPasses: 1, passRate: 1 / 3, units: 2, firstTryPasses: 1, firstTryRate: 0.5 }]);

    // the guided submit wrote a 0-XP ledger row ('revealed'); totals.events counts only rows that earned XP
    const rows = ctx.db.all<{ amount: number; reason: string }>('SELECT amount, reason FROM xp_event ORDER BY id');
    expect(rows.some((r) => r.amount === 0 && r.reason === 'revealed')).toBe(true);
    const xp = await get(ctx.app, '/api/stats/xp', XpStatsResponse);
    expect(xp.totals.events).toBe(rows.filter((r) => r.amount > 0).length);
    expect(xp.totals.events).toBeLessThan(rows.length);
  });

  it('xp: a day whose only ledger rows earned 0 XP does not start the all-time weeks', async () => {
    const g = drill(ctx, 'stats:g');
    expect((await request(ctx.app).post(`/api/units/${g}/reveal`).send()).status).toBe(200);
    expect((await submit(ctx.app, g, { code: 'return a + b' })).status).toBe(200); // 0 XP, 'revealed'
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM xp_event WHERE amount = 0')!.n).toBeGreaterThan(0);
    const xp = await get(ctx.app, '/api/stats/xp', XpStatsResponse);
    expect(xp.weeks).toEqual([]);
    expect(xp.totals).toEqual({ allTime: 0, lastDays: 0, events: 0 });
  });

  it('reviews: forecast by local due day (overdue folds into today), retention from review_log, retests excluded', async () => {
    const due = (cardKey: string, at: number, kind?: 'retest') => {
      const it = addReviewItem(ctx.db, { cardKey }, ctx.clock);
      // retest schedules are written by engines/ladder.ts; the kind is all these stats care about
      ctx.db.run('UPDATE review_item SET due_at = ?, kind = ? WHERE id = ?', at, kind ?? 'card', it.id);
      return it.id;
    };
    const now = ctx.clock().getTime();
    const g1 = due('c:1', now - 1000);
    const g2 = due('c:2', now - 1000);
    due('c:overdue', now - 3 * DAY_MS);
    due('c:tomorrow', localNoon(2026, 10, 2).getTime());
    due('c:later', now + 40 * DAY_MS);
    due('r:retest', now - 1000, 'retest');
    expect((await request(ctx.app).post(`/api/reviews/${g1}/grade`).send({ grade: 'again' })).status).toBe(200);
    expect((await request(ctx.app).post(`/api/reviews/${g2}/grade`).send({ grade: 'good' })).status).toBe(200);

    const r = await get(ctx.app, '/api/stats/reviews', ReviewStatsResponse);
    expect(r.cards).toBe(5);
    expect(r.overdue).toBe(1);
    expect(r.later).toBe(1);
    expect(r.retention.window).toEqual({ reviews: 2, recalled: 1, rate: 0.5 });
    expect(r.retention.allTime).toEqual({ reviews: 2, recalled: 1, rate: 0.5 });
    expect(r.ratings).toEqual({ again: 1, hard: 0, good: 1, easy: 0 });
    // every non-retest card lands in exactly one place
    expect(r.forecast.reduce((s, d) => s + d.due, 0) + r.later).toBe(r.cards);
    // forecast agrees with the review queue's own due count for today
    const queue = (await request(ctx.app).get('/api/reviews/queue')).body as { count: number };
    expect(r.dueNow).toBe(queue.count);
    const tomorrow = r.forecast.find((d) => d.day === addDays(dayKey(now), 1))!;
    expect(tomorrow.due).toBeGreaterThanOrEqual(1);
  });

  it('ui-audit #26: clearing a campaign core quest moves the sidebar % and it equals the campaign and stats numbers', async () => {
    const tracks0 = await get(ctx.app, '/api/tracks', TracksResponse);
    expect(tracks0.tracks.find((t) => t.id === 'js')!.progress).toMatchObject({ pct: 0, basis: 'campaign-core', coreDone: 0, coreTotal: 2 });

    const study = unitOf(ctx.db, 'campaign/js/study-a');
    insertCheck(ctx.db, study, { type: 'study-quiz', itemKeys: ['q1'] }, ctx.clock);
    expect((await submit(ctx.app, study, { answer: 'pass' })).status).toBe(200);

    const js = (await get(ctx.app, '/api/tracks', TracksResponse)).tracks.find((t) => t.id === 'js')!;
    expect(js.progress).toEqual({ pct: 50, basis: 'campaign-core', coreDone: 1, coreTotal: 2, practiceDone: 0, practiceTotal: 0 });
    expect(js.unitCount).toBe(0); // the old practice-only count that kept the sidebar at 0%
    const campaignRes = (await request(ctx.app).get('/api/tracks/js/campaign')).body as { acts: { progress: { coreDone: number; coreTotal: number } }[] };
    const sum = campaignRes.acts.reduce((s, a) => ({ d: s.d + a.progress.coreDone, t: s.t + a.progress.coreTotal }), { d: 0, t: 0 });
    expect([sum.d, sum.t]).toEqual([js.progress.coreDone, js.progress.coreTotal]);
    const units = await get(ctx.app, '/api/tracks/js/units', TrackUnitsResponse);
    expect(units.track.progress).toEqual(js.progress);
    const stats = await get(ctx.app, '/api/stats/campaign', CampaignProgressResponse);
    expect(stats.tracks.find((t) => t.trackId === 'js')!.progress).toEqual(js.progress);
  });

  it('a track without campaign core falls back to practice units', async () => {
    const id = insertUnit(ctx.db, { key: 'stats:ag', track: 'agentic', kind: 'drill', title: 'ag', difficulty: 1, competencies: [], prerequisites: [], checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.ok(true)' }] } }] }, ctx.clock);
    drill(ctx, 'stats:ag2', 'agentic');
    await submit(ctx.app, id, { code: 'return a + b' });
    const ag = (await get(ctx.app, '/api/tracks', TracksResponse)).tracks.find((t) => t.id === 'agentic')!;
    expect(ag.progress).toEqual({ pct: 50, basis: 'practice', coreDone: 0, coreTotal: 0, practiceDone: 1, practiceTotal: 2 });
    expect([ag.doneCount, ag.unitCount]).toEqual([1, 2]);
  });
});
