// ab S4 "find things": GET /units/search, the dashboard's slate targetUnitId, GET /drills/next?mode=mixed.
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DashboardResponseExt, DrillNextResponse, UnitSearchResponse } from '@bootquest/shared/api-ext';
import { UnitDetailResponse } from '@bootquest/shared/api';
import { createApp } from '../../src/api/app.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import type { Db } from '../../src/db/database.ts';
import { DAY_MS, dayKey, fixedClock } from '../../src/engines/clock.ts';
import { loadCampaignIntoDb, readCampaign } from '../../src/store/campaign.ts';
import { insertUnit } from '../../src/store/content.ts';
import { writeCampaignFixture } from '../campaign-fixture.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';
import { fakeDrillJs } from './harness.ts';

const RIGHT = 'export function f(a, b) { return a + b; }\n';
const WRONG = 'export function f(a, b) { return a - b; }\n';
const MARK = 'SEEDTEXT_MARKER';

const drill = (key: string, track: string, title: string, prerequisites: string[] = []) => ({
  key,
  track,
  kind: 'drill',
  title,
  difficulty: 1,
  prerequisites,
  checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', input: [1, 2], code: `assert.equal(mod.f(1, 2), 3, '${MARK}_test');` }] } }],
});

const UNITS = [
  // first (lowest id), with "counter" in its key only: a title match must still rank above it
  { key: 'find/js/counter-quiz', track: 'js', kind: 'quiz', title: 'Loop invariants', checks: [{ spec: { type: 'quiz', itemKey: 'qc', grading: 'exact', answerKey: 'x' } }] },
  drill('find/js/closure', 'js', 'Closures: counter factory'),
  drill('find/js/promise', 'js', 'Promise chains', ['find/js/closure']),
  drill('find/js/revealed', 'js', 'Revealed drill'),
  drill('find/cs/linq', 'csharp', 'LINQ: group by customer'),
  drill('find/cs/span', 'csharp', 'Span slicing'),
  drill('find/java/streams', 'java', 'Streams: collect to map'),
  { key: 'find/js/quiz-percent', track: 'js', kind: 'quiz', title: '100% coverage myths', checks: [{ spec: { type: 'quiz', itemKey: 'qp', grading: 'exact', answerKey: `${MARK}_key` } }] },
];

interface Ctx {
  tmp: TempDb;
  db: Db;
  clock: ReturnType<typeof fixedClock>;
  app: Express;
  id(key: string): number;
}

function useFindApi(): Ctx {
  const ctx = {} as Ctx;
  beforeEach(() => {
    ctx.tmp = makeTempDb();
    ctx.db = ctx.tmp.db;
    ctx.clock = fixedClock(localNoon(2026, 10, 1));
    loadCampaignIntoDb(ctx.db, readCampaign(writeCampaignFixture(join(ctx.tmp.dir, 'campaign'))), ctx.clock);
    for (const u of UNITS) insertUnit(ctx.db, u, ctx.clock);
    ctx.id = (key) => ctx.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', key)!.id;
    // prose / starter / solution of every unit carry the marker: none of it is searchable
    const content = Object.fromEntries(
      UNITS.map((u) => [u.key, { instructions: `${MARK} instructions`, starter: `// ${MARK} starter\n`, solution: `// ${MARK} solution\n` }]),
    );
    ctx.app = createApp({ db: ctx.db, clock: ctx.clock, runners: { 'drill-js': fakeDrillJs }, content: mapContentStore(content) });
  });
  afterEach(() => ctx.tmp.cleanup());
  return ctx;
}

async function search(app: Express, query: string) {
  const res = await request(app).get(`/api/units/search?${query}`);
  expect(res.status).toBe(200);
  return UnitSearchResponse.parse(res.body);
}

async function dashboard(app: Express) {
  const res = await request(app).get('/api/dashboard');
  expect(res.status).toBe(200);
  return DashboardResponseExt.parse(res.body);
}

async function mixed(app: Express, tracks: string) {
  const res = await request(app).get(`/api/drills/next?tracks=${tracks}&mode=mixed`);
  expect(res.status).toBe(200);
  return DrillNextResponse.parse(res.body);
}

async function pass(app: Express, unitId: number) {
  const res = await request(app).post(`/api/units/${unitId}/submit`).send({ code: RIGHT, selfAssisted: false });
  expect(res.status).toBe(200);
  expect(res.body.verdict).toBe('pass');
}

const target = (d: Awaited<ReturnType<typeof dashboard>>, slot: string) => d.slate.items.find((i) => i.slot === slot)?.targetUnitId;

describe('GET /api/units/search', { timeout: 30_000 }, () => {
  const ctx = useFindApi();

  it('includes the campaign study quests and readings that the track unit list omits, each with its act lock', async () => {
    const body = await search(ctx.app, 'q=read-r');
    expect(body.items.map((h) => [h.key, h.campaign, h.state])).toEqual([
      ['campaign/js/read-r1', true, 'available'],
      ['campaign/js/read-r2', true, 'available'],
      ['campaign/js/read-r3', true, 'locked'], // act 2 is locked (80% of act 1 core + level 2)
    ]);
    const units = (await request(ctx.app).get('/api/tracks/js/units')).body as { units: { key: string }[] };
    expect(units.units.some((u) => u.key.startsWith('campaign/'))).toBe(false);
    const study = await search(ctx.app, 'q=study%20quest');
    expect(study.items.map((h) => h.key)).toEqual(['campaign/js/study-a', 'campaign/js/study-b', 'campaign/csharp/study-c']);
    expect(study.items.map((h) => h.state)).toEqual(['available', 'locked', 'available']);
  });

  it('a locked act stays locked: the hit shows only title + locked, and opening it still hits the act gate', async () => {
    const [hit] = (await search(ctx.app, 'q=read-r3')).items;
    expect(hit).toEqual({ id: ctx.id('campaign/js/read-r3'), key: 'campaign/js/read-r3', trackId: 'js', kind: 'reading', title: 'Reading: read-r3', state: 'locked', campaign: true });
    const detail = UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${hit!.id}`)).body);
    expect(detail.actGate).toEqual({ locked: true });
    const write = await request(ctx.app).post(`/api/units/${hit!.id}/self-attest`).send({});
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('ACT_LOCKED');
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt')!.n).toBe(0);
  });

  it('searches key + title only: prose, starter, solution and check text are never matched or returned', async () => {
    for (const q of [MARK, `${MARK}_test`, `${MARK}_key`, 'instructions', 'assert.equal']) {
      const body = await search(ctx.app, `q=${encodeURIComponent(q)}`);
      expect(body, q).toEqual({ q, total: 0, items: [] });
    }
    const raw = (await request(ctx.app).get('/api/units/search?q=find')).text;
    expect(raw).not.toContain(MARK);
    const body = await search(ctx.app, 'q=find');
    expect(body.total).toBe(UNITS.length); // every unit key starts with find/
    // a hit is the strict summary: no check, prose, prerequisite or content field rides along
    for (const h of body.items) expect(Object.keys(h).sort()).toEqual(['campaign', 'id', 'key', 'kind', 'state', 'title', 'trackId']);
  });

  it('every token must match (key or title, case-insensitive); title matches rank before key-only matches; % is literal', async () => {
    expect((await search(ctx.app, 'q=LINQ%20customer')).items.map((h) => h.key)).toEqual(['find/cs/linq']);
    expect((await search(ctx.app, 'q=linq%20nothing')).items).toEqual([]);
    // "cs/" matches keys only
    const keyOnly = await search(ctx.app, 'q=cs/');
    expect(keyOnly.items.map((h) => h.key)).toEqual(['find/cs/linq', 'find/cs/span']);
    const ranked = await search(ctx.app, 'q=COUNTER');
    expect(ranked.items.map((h) => h.key)).toEqual(['find/js/closure', 'find/js/counter-quiz']);
    expect((await search(ctx.app, 'q=100%25')).items.map((h) => h.key)).toEqual(['find/js/quiz-percent']);
    expect((await search(ctx.app, 'q=%25')).items.map((h) => h.key)).toEqual(['find/js/quiz-percent']);
    expect((await search(ctx.app, 'q=_')).total).toBe(0);
  });

  it('states follow the unit lists: prerequisites lock, a pass is done; limit caps items but total counts every match', async () => {
    let body = await search(ctx.app, 'q=find/js');
    const state = (key: string) => body.items.find((h) => h.key === key)?.state;
    expect(state('find/js/promise')).toBe('locked');
    await pass(ctx.app, ctx.id('find/js/closure'));
    body = await search(ctx.app, 'q=find/js');
    expect(state('find/js/closure')).toBe('done');
    expect(state('find/js/promise')).toBe('available');
    const capped = await search(ctx.app, 'q=find&limit=2');
    expect(capped.items).toHaveLength(2);
    expect(capped.total).toBe(UNITS.length);
  });

  it('a locked track serves its units as locked', async () => {
    ctx.db.run("UPDATE track SET locked = 1 WHERE id = 'java'");
    expect((await search(ctx.app, 'q=streams')).items.map((h) => h.state)).toEqual(['locked']);
  });

  it('refuses a missing, blank, over-long or repeated q, a bad limit and unknown parameters (400 VALIDATION)', async () => {
    for (const qs of ['', 'q=', 'q=%20%20', `q=${'x'.repeat(101)}`, 'q=a&q=b', 'q=a&limit=0', 'q=a&limit=51', 'q=a&limit=x', 'q=a&extra=1']) {
      const res = await request(ctx.app).get(`/api/units/search?${qs}`);
      expect(res.status, qs).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    }
  });

  it('/units/search is not read as a unit id; /units/:id still works', async () => {
    const id = ctx.id('find/js/closure');
    expect((await request(ctx.app).get(`/api/units/${id}`)).status).toBe(200);
    expect((await request(ctx.app).get('/api/units/search?q=closure')).status).toBe(200);
  });
});

describe('GET /api/dashboard slate targetUnitId', { timeout: 30_000 }, () => {
  const ctx = useFindApi();

  it('a drill set targets the first passable, unrevealed drill of its track; the campaign step its quest unit; review none', async () => {
    let d = await dashboard(ctx.app);
    expect(target(d, 'drill:js')).toBe(ctx.id('find/js/closure'));
    expect(target(d, 'drill:csharp')).toBe(ctx.id('find/cs/linq'));
    // act 1 of js: study A has no check (content pending), so the first AVAILABLE quest is reading R1
    expect(target(d, 'campaign')).toBe(ctx.id('campaign/js/read-r1'));
    const review = d.slate.items.find((i) => i.slot === 'review');
    expect(review && 'targetUnitId' in review).toBe(false);

    // reveal skips a drill for good; a pass moves the target on (and unlocks the prerequisite chain)
    await request(ctx.app).post(`/api/units/${ctx.id('find/js/revealed')}/reveal`).send({});
    await pass(ctx.app, ctx.id('find/js/closure'));
    d = await dashboard(ctx.app);
    expect(target(d, 'drill:js')).toBe(ctx.id('find/js/promise'));
    await pass(ctx.app, ctx.id('find/js/promise'));
    d = await dashboard(ctx.app);
    // every js drill is passed or revealed: no target (the client falls back to the track page)
    const js = d.slate.items.find((i) => i.slot === 'drill:js');
    if (js) expect(js.targetUnitId).toBeNull();

    // the campaign target follows the ledger: R1 attested -> R2
    await request(ctx.app).post(`/api/units/${ctx.id('campaign/js/read-r1')}/self-attest`).send({});
    d = await dashboard(ctx.app);
    expect(target(d, 'campaign')).toBe(ctx.id('campaign/js/read-r2'));
  });

  it('targetUnitId exists in the response only: the stored slate row never gains it', async () => {
    const d = await dashboard(ctx.app);
    expect(d.slate.items.some((i) => typeof i.targetUnitId === 'number')).toBe(true);
    const rows = ctx.db.all<{ items: string }>('SELECT items FROM daily_slate');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.items).not.toContain('targetUnitId');
    // and the next day's close derives from the untouched stored slot list
    ctx.clock.advance(DAY_MS);
    await dashboard(ctx.app);
    for (const r of ctx.db.all<{ items: string }>('SELECT items FROM daily_slate')) expect(r.items).not.toContain('targetUnitId');
  });
});

describe('GET /api/drills/next?mode=mixed', { timeout: 30_000 }, () => {
  const ctx = useFindApi();
  const dayNo = () => Math.floor(Date.parse(`${dayKey(ctx.clock().getTime())}T00:00:00Z`) / DAY_MS);

  it('is deterministic: start = (day number + drills passed on these tracks) mod n; each pass moves it one track on', async () => {
    const tracks = ['js', 'csharp', 'java'];
    const first = await mixed(ctx.app, tracks.join(','));
    expect(first.mode).toBe('mixed');
    expect(first.tracks).toEqual(tracks);
    expect(first.startIndex).toBe(dayNo() % 3);
    expect(await mixed(ctx.app, tracks.join(','))).toEqual(first); // same ledger, same day: same answer
    const firstOf: Record<string, string> = { js: 'find/js/closure', csharp: 'find/cs/linq', java: 'find/java/streams' };
    expect(first.unit).toMatchObject({ id: ctx.id(firstOf[tracks[first.startIndex]!]!), trackId: tracks[first.startIndex] });

    await pass(ctx.app, first.unit!.id);
    const second = await mixed(ctx.app, tracks.join(','));
    expect(second.startIndex).toBe((dayNo() + 1) % 3);
    expect(second.unit!.trackId).toBe(tracks[(first.startIndex + 1) % 3]);

    // the next day rotates on by one without any new pass
    ctx.clock.advance(DAY_MS);
    expect((await mixed(ctx.app, tracks.join(','))).startIndex).toBe((dayNo() + 1) % 3);
  });

  it('skips tracks with nothing passable (locked, exhausted, revealed) and answers null when none has a drill', async () => {
    ctx.db.run("UPDATE track SET locked = 1 WHERE id = 'java'");
    // java locked, sysdesign without drills: both csharp drills come up in turn, then nothing
    const picked: string[] = [];
    for (let i = 0; i < 2; i++) {
      const next = await mixed(ctx.app, 'java,sysdesign,csharp');
      expect(next.unit?.trackId).toBe('csharp');
      picked.push(next.unit!.key);
      await pass(ctx.app, next.unit!.id);
    }
    expect(picked).toEqual(['find/cs/linq', 'find/cs/span']);
    expect((await mixed(ctx.app, 'java,sysdesign,csharp')).unit).toBeNull();
    // js: two drills revealed, the third locked behind a revealed one -> nothing passable either
    for (const key of ['find/js/closure', 'find/js/revealed']) {
      expect((await request(ctx.app).post(`/api/units/${ctx.id(key)}/reveal`).send({})).status).toBe(200);
    }
    expect((await mixed(ctx.app, 'js')).unit).toBeNull();
  });

  it('writes nothing', async () => {
    const before = ctx.db.get<{ n: number }>('SELECT (SELECT COUNT(*) FROM attempt) + (SELECT COUNT(*) FROM run) + (SELECT COUNT(*) FROM xp_event) AS n')!.n;
    await mixed(ctx.app, 'js,csharp');
    await search(ctx.app, 'q=find');
    expect(ctx.db.get<{ n: number }>('SELECT (SELECT COUNT(*) FROM attempt) + (SELECT COUNT(*) FROM run) + (SELECT COUNT(*) FROM xp_event) AS n')!.n).toBe(before);
  });

  it('refuses unknown, duplicate or missing tracks and any mode but mixed (400 VALIDATION)', async () => {
    for (const qs of ['', 'mode=mixed', 'tracks=python', 'tracks=js,js', 'tracks=js,', 'tracks=js&mode=random', 'tracks=js&x=1']) {
      const res = await request(ctx.app).get(`/api/drills/next?${qs}`);
      expect(res.status, qs).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    }
    expect((await request(ctx.app).get('/api/drills/next?tracks=js')).status).toBe(200); // mode defaults to mixed
  });
});
