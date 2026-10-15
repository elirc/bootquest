import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CampaignResponse, DashboardResponse, SelfAttestResponse, SubmitResponse, TrackUnitsResponse } from '@bootquest/shared/api';
import { createApp } from '../../src/api/app.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import type { Runner } from '../../src/api/runners.ts';
import type { Db } from '../../src/db/database.ts';
import { campaignStateStats } from '../../src/engines/campaign.ts';
import { DAY_MS, fixedClock } from '../../src/engines/clock.ts';
import { loadCampaignIntoDb, readCampaign } from '../../src/store/campaign.ts';
import { insertCheck, insertUnit } from '../../src/store/content.ts';
import { writeCampaignFixture } from '../campaign-fixture.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';
import { fakeDrillJs } from './harness.ts';

/** study-quiz stand-in: passes iff the answer is "pass" (the real quiz gate arrives with seed:quests). */
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

function useCampaignApi(): Ctx {
  const ctx = {} as Ctx;
  beforeEach(() => {
    ctx.tmp = makeTempDb();
    ctx.db = ctx.tmp.db;
    ctx.clock = fixedClock(localNoon(2026, 10, 1));
    loadCampaignIntoDb(ctx.db, readCampaign(writeCampaignFixture(join(ctx.tmp.dir, 'campaign'))), ctx.clock);
    ctx.app = createApp({ db: ctx.db, clock: ctx.clock, runners: { 'drill-js': fakeDrillJs, 'study-quiz': fakeStudyQuiz }, content: mapContentStore({}) });
  });
  afterEach(() => ctx.tmp.cleanup());
  return ctx;
}

const unitOf = (db: Db, key: string) => db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', key)!.id;

async function campaign(app: Express, track: string) {
  const res = await request(app).get(`/api/tracks/${track}/campaign`);
  expect(res.status).toBe(200);
  return CampaignResponse.parse(res.body);
}

async function slateCampaign(app: Express) {
  const d = DashboardResponse.parse((await request(app).get('/api/dashboard')).body);
  return { slot: d.slate.items.find((i) => i.slot === 'campaign'), dashboard: d };
}

describe('GET /api/tracks/:id/campaign', { timeout: 30_000 }, () => {
  const ctx = useCampaignApi();

  it('returns acts in order with derived unlock state, core progress and quests in rank order', async () => {
    const body = await campaign(ctx.app, 'js');
    expect(body.track).toEqual({ id: 'js', name: 'JS/TS + React', locked: false });
    expect(body.level).toBe(1);
    expect(body.acts.map((a) => [a.ordinal, a.title, a.unlocked, a.progress])).toEqual([
      [1, 'Act 1', true, { coreDone: 0, coreTotal: 1 }],
      [2, 'Act 2', false, { coreDone: 0, coreTotal: 1 }],
    ]);
    expect(body.acts[1]!.unlockRule).toEqual({ previousCorePct: 80, level: 2, staticLock: false });
    const q = body.acts[0]!.quests;
    expect(q.map((x) => [x.kind, x.repo, x.rank, x.state])).toEqual([
      ['study-quest', 'study-a', 1, 'pending'],
      ['reading', 'read-r1', 2, 'available'],
      ['reading', 'read-r2', 3, 'available'],
    ]);
    expect(q[1]!.unitId).toBe(unitOf(ctx.db, 'campaign/js/read-r1'));
    expect(q[0]).toMatchObject({ core: true, contentPending: true, twinRepo: null });
  });

  it('java: one statically locked act, inert quests without a unitId', async () => {
    const body = await campaign(ctx.app, 'java');
    expect(body.track.locked).toBe(true);
    expect(body.acts).toHaveLength(1);
    expect(body.acts[0]).toMatchObject({ unlocked: false, unlockRule: { staticLock: true } });
    expect(body.acts[0]!.quests[0]!.state).toBe('locked');
    expect('unitId' in body.acts[0]!.quests[0]!).toBe(false);
  });

  it('a track with no campaign returns no acts; unknown track ids are 400; extra query is 400', async () => {
    expect((await campaign(ctx.app, 'agentic')).acts).toEqual([]);
    expect((await request(ctx.app).get('/api/tracks/python/campaign')).status).toBe(400);
    expect((await request(ctx.app).get('/api/tracks/js/campaign?x=1')).status).toBe(400);
  });

  it('campaign placeholder units stay out of the practice unit list and next-up', async () => {
    const units = TrackUnitsResponse.parse((await request(ctx.app).get('/api/tracks/js/units')).body);
    expect(units.track.unitCount).toBe(0);
    expect(units.units.some((u) => u.key.startsWith('campaign/'))).toBe(false);
    const d = DashboardResponse.parse((await request(ctx.app).get('/api/dashboard')).body);
    expect(d.nextUp.find((n) => n.trackId === 'js')!.unit).toBeNull();
  });

  it('units of a locked act refuse writes with 403 ACT_LOCKED; reading them is allowed', async () => {
    const r3 = unitOf(ctx.db, 'campaign/js/read-r3');
    const res = await request(ctx.app).post(`/api/units/${r3}/self-attest`).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACT_LOCKED');
    expect((await request(ctx.app).get(`/api/units/${r3}`)).status).toBe(200);
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt')!.n).toBe(0);
  });
});

describe('B3 skill-tree fields on GET /api/tracks/:id/campaign (additive)', { timeout: 30_000 }, () => {
  const ctx = useCampaignApi();

  it('every quest carries inProgress=false and prerequisites=[] on a fresh ledger', async () => {
    const body = await campaign(ctx.app, 'js');
    for (const q of body.acts.flatMap((a) => a.quests)) expect(q).toMatchObject({ inProgress: false, prerequisites: [] });
    const java = await campaign(ctx.app, 'java');
    for (const q of java.acts.flatMap((a) => a.quests)) expect(q).toMatchObject({ inProgress: false, prerequisites: [] });
  });

  it('a failed submit marks an available quest in progress; the pass turns it done (not in progress)', async () => {
    const a = unitOf(ctx.db, 'campaign/js/study-a');
    insertCheck(ctx.db, a, { type: 'study-quiz', itemKeys: ['q1'] }, ctx.clock);
    await request(ctx.app).post(`/api/units/${a}/submit`).send({ answer: 'nope' });
    let q = (await campaign(ctx.app, 'js')).acts[0]!.quests[0]!;
    expect(q).toMatchObject({ state: 'available', inProgress: true });
    await request(ctx.app).post(`/api/units/${a}/submit`).send({ answer: 'pass' });
    q = (await campaign(ctx.app, 'js')).acts[0]!.quests[0]!;
    expect(q).toMatchObject({ state: 'done', inProgress: false });
  });

  it('a quest in a locked act is never in progress, even with ledger rows on its unit', async () => {
    const r3 = unitOf(ctx.db, 'campaign/js/read-r3');
    // a stray historical row (e.g. from before the act re-locked); the act gate still wins
    ctx.db.run(
      `INSERT INTO attempt (unit_id, mode, assisted, assistance_source, outcome, created_at) VALUES (?, 'solo', 0, 'none', 'fail', ?)`,
      r3,
      ctx.clock().getTime(),
    );
    const act2 = (await campaign(ctx.app, 'js')).acts[1]!;
    const q = act2.quests.find((x) => x.unitId === r3)!;
    expect(q).toMatchObject({ state: 'locked', inProgress: false });
  });

  it('unit_prerequisite rows between quest units surface as quest-id prerequisites; non-quest prereqs are left out', async () => {
    const a = unitOf(ctx.db, 'campaign/js/study-a');
    const r1 = unitOf(ctx.db, 'campaign/js/read-r1');
    const r3 = unitOf(ctx.db, 'campaign/js/read-r3');
    const outside = insertUnit(
      ctx.db,
      { key: 'fixture/outside', track: 'js', kind: 'drill', title: 'Outside', difficulty: 1 },
      ctx.clock,
    );
    ctx.db.run('INSERT INTO unit_prerequisite (unit_id, prereq_unit_id) VALUES (?, ?)', r3, r1);
    ctx.db.run('INSERT INTO unit_prerequisite (unit_id, prereq_unit_id) VALUES (?, ?)', r3, a);
    ctx.db.run('INSERT INTO unit_prerequisite (unit_id, prereq_unit_id) VALUES (?, ?)', r1, outside);
    const body = await campaign(ctx.app, 'js');
    const all = body.acts.flatMap((x) => x.quests);
    const qid = (u: number) => all.find((x) => x.unitId === u)!.id;
    expect(all.find((x) => x.unitId === r3)!.prerequisites).toEqual([qid(a), qid(r1)].sort((x, y) => x - y));
    expect(all.find((x) => x.unitId === r1)!.prerequisites).toEqual([]);
  });
});

describe('campaign slate slot, end to end through the API', { timeout: 30_000 }, () => {
  const ctx = useCampaignApi();

  it('passing a quest unit (seeded quiz gate) ticks the campaign slot and pays study-quest XP', async () => {
    expect((await slateCampaign(ctx.app)).slot).toMatchObject({ kind: 'campaign-step', done: false });
    const a = unitOf(ctx.db, 'campaign/js/study-a');
    insertCheck(ctx.db, a, { type: 'study-quiz', itemKeys: ['q1'] }, ctx.clock); // what seed:quests will do
    const fail = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${a}/submit`).send({ answer: 'nope' })).body);
    expect(fail.verdict).toBe('fail');
    expect((await slateCampaign(ctx.app)).slot!.done).toBe(false);
    const pass = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${a}/submit`).send({ answer: 'pass' })).body);
    expect(pass.xp).toMatchObject({ amount: 50, reason: null });
    expect((await slateCampaign(ctx.app)).slot!.done).toBe(true);
    const body = await campaign(ctx.app, 'js');
    expect(body.acts[0]!.progress).toEqual({ coreDone: 1, coreTotal: 1 });
    expect(body.acts[0]!.quests[0]!.state).toBe('done');
    expect(body.acts[1]!.unlocked).toBe(false); // 100% core, but level 1 < 2
  });

  it('a full slate day (5 drills per track + a campaign reading step + clear queue) is streak day 1', async () => {
    for (const track of ['js', 'csharp']) {
      for (let i = 0; i < 5; i++) {
        const id = insertUnit(
          ctx.db,
          { key: `e2e:${track}:${i}`, track, kind: 'drill', title: `drill ${i}`, difficulty: 1, competencies: [], prerequisites: [], checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.ok(true)' }] } }] },
          ctx.clock,
        );
        const r = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ code: 'return a + b' })).body);
        expect(r.verdict).toBe('pass');
      }
    }
    let s = await slateCampaign(ctx.app);
    expect(s.dashboard.slate.items.map((i) => [i.slot, i.done])).toEqual([
      ['drill:js', true],
      ['drill:csharp', true],
      ['campaign', false],
      ['review', true],
    ]);
    expect(s.dashboard.streak.todayComplete).toBe(false);

    const attest = SelfAttestResponse.parse((await request(ctx.app).post(`/api/units/${unitOf(ctx.db, 'campaign/js/read-r1')}/self-attest`).send({})).body);
    expect(attest.xp.amount).toBe(5);
    s = await slateCampaign(ctx.app);
    expect(s.slot!.done).toBe(true);
    expect(s.dashboard.streak).toMatchObject({ current: 1, todayComplete: true });

    ctx.clock.advance(DAY_MS);
    s = await slateCampaign(ctx.app);
    expect(s.dashboard.streak).toMatchObject({ current: 1, longest: 1, todayComplete: false, slateDaysBanked: 1 });
    expect(s.dashboard.heatmap.find((h) => h.day === '2026-10-01')!.status).toBe('slate');
  });
});

describe('F16: GET /api/units/:id builds the campaign state ONCE per request', { timeout: 30_000 }, () => {
  const ctx = useCampaignApi();

  it('a campaign quest unit (locked or open) costs exactly one build; a non-quest unit costs none', async () => {
    for (const [key, locked] of [
      ['campaign/js/read-r1', false],
      ['campaign/js/read-r3', true],
    ] as const) {
      const before = campaignStateStats.builds;
      const res = await request(ctx.app).get(`/api/units/${unitOf(ctx.db, key)}`);
      expect(res.status).toBe(200);
      expect(Boolean(res.body.actGate?.locked)).toBe(locked);
      expect(campaignStateStats.builds - before, key).toBe(1);
    }
    const plain = insertUnit(ctx.db, { key: 'fixture:plain', track: 'js', kind: 'reading', title: 'plain', difficulty: 1, competencies: ['language-fluency'] }, ctx.clock);
    const before = campaignStateStats.builds;
    expect((await request(ctx.app).get(`/api/units/${plain}`)).status).toBe(200);
    expect(campaignStateStats.builds - before).toBe(0);
  });

  it('a unit held by quests of TWO tracks is judged with one build and unlocked iff ANY holding act is unlocked', async () => {
    // also place js read-r3 (act 2, locked) into the csharp act 1 (unlocked): one open act suffices
    const r3 = unitOf(ctx.db, 'campaign/js/read-r3');
    const csAct = ctx.db.get<{ id: number }>(`SELECT id FROM campaign_act WHERE track_id = 'csharp' AND act_no = 1`)!.id;
    ctx.db.run(
      `INSERT INTO quest (act_id, key, quest_kind, title, repo, index_rank, unit_id, core, content_pending, verdict)
       VALUES (?, 'campaign/csharp/twin-r3', 'reading', 'twin', 'twin-r3', 99, ?, 0, 0, 'skim')`,
      csAct,
      r3,
    );
    const before = campaignStateStats.builds;
    const res = await request(ctx.app).get(`/api/units/${r3}`);
    expect(res.status).toBe(200);
    expect(res.body.actGate).toBeUndefined();
    expect(campaignStateStats.builds - before).toBe(1);
  });
});
