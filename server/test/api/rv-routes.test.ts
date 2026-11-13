import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardResponseExt, RoutingResponse, SlateSettingsResponse } from '@bootquest/shared/api-ext';
import { insertUnit } from '../../src/store/content.ts';
import { makeRouting, setRouting } from '../../src/store/routing.ts';
import { useApi, type ApiCtx } from './harness.ts';

/** rv wave C: PUT /settings/learner, GET /routing, and the dashboard's routed next steps (R3-08, R4-10). */

const drill = (ctx: ApiCtx, key: string, track: string, prerequisites: string[] = []) =>
  insertUnit(ctx.db, { key, track, kind: 'drill', title: key, difficulty: 1, prerequisites, checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'x' }] } }] }, ctx.clock);
const eb = (ctx: ApiCtx, key: string, track: string, kind: 'explain-back' | 'patch-kata' = 'explain-back') =>
  insertUnit(
    ctx.db,
    { key, track, kind, title: key, difficulty: 2, checks: [{ spec: kind === 'explain-back' ? { type: 'explain-back', questionSetKey: key } : { type: 'patch-kata', kataKey: key, defectCount: 1 } }] },
    ctx.clock,
  );
const dashboard = async (ctx: ApiCtx) => DashboardResponseExt.parse((await request(ctx.app).get('/api/dashboard')).body);

describe('rv wave C routes', () => {
  const ctx = useApi();
  afterEach(() => setRouting(null));

  it('PUT /settings/learner: the first language pick applies today, later changes tomorrow; append-only rows', async () => {
    drill(ctx, 'fund/js/01-a', 'js');
    drill(ctx, 'fund/csharp/01-a', 'csharp');
    setRouting(makeRouting([]));
    let d = await dashboard(ctx);
    expect(d.slate.items.find((i) => i.kind === 'fund-step')).toMatchObject({ track: 'js' });
    const first = SlateSettingsResponse.parse((await request(ctx.app).put('/api/settings/learner').send({ primaryLanguage: 'csharp' })).body);
    expect(first.learner!.today).toMatchObject({ primaryLanguage: 'csharp', primaryChosen: true });
    d = await dashboard(ctx);
    expect(d.slate.items.find((i) => i.kind === 'fund-step')).toMatchObject({ track: 'csharp' });
    const second = SlateSettingsResponse.parse((await request(ctx.app).put('/api/settings/learner').send({ primaryLanguage: 'js', seniorRep: false, campaignStep: true })).body);
    expect(second.learner!.today).toMatchObject({ primaryLanguage: 'csharp', seniorRep: true, campaignStep: false });
    expect(second.learner!.tomorrow).toMatchObject({ primaryLanguage: 'js', seniorRep: false, campaignStep: true });
    expect((await request(ctx.app).put('/api/settings/learner').send({})).status).toBe(400);
    expect((await request(ctx.app).put('/api/settings/learner').send({ primaryLanguage: 'rust' })).status).toBe(400);
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM learner_setting')!.n).toBe(4);
  });

  it('the default slate (no settings): every drill set off; a "default" preset writes them off, "full" on', async () => {
    const s = SlateSettingsResponse.parse((await request(ctx.app).get('/api/settings/slate')).body);
    expect(s.todayTracks.every((t) => !t.enabled && !t.configured)).toBe(true);
    const full = SlateSettingsResponse.parse((await request(ctx.app).put('/api/settings/slate').send({ preset: 'full' })).body);
    expect(full.tomorrowTracks.every((t) => t.enabled && t.size === 5)).toBe(true);
    const def = SlateSettingsResponse.parse((await request(ctx.app).put('/api/settings/slate').send({ preset: 'default' })).body);
    expect(def.tomorrowTracks.every((t) => !t.enabled && t.configured)).toBe(true);
    // all off is a valid choice now (the Fundamentals step + senior rep carry the day)
    expect((await request(ctx.app).put('/api/settings/slate').send({ tracks: [{ trackId: 'js', enabled: false }] })).status).toBe(200);
  });

  it('GET /routing: archived ids + resolved paths; next-up follows the path and skips archived units, the senior rep links to it', async () => {
    const d1 = drill(ctx, 'sysdrills/01-estimation/01-qps', 'sysdesign');
    eb(ctx, 'ladder/explain-back/a/111111111111', 'sysdesign'); // off the path
    const set2 = eb(ctx, 'ladder/explain-back/b/222222222222', 'sysdesign');
    const archived = eb(ctx, 'ladder/explain-back/c/333333333333', 'sysdesign');
    const kata = eb(ctx, 'ladder/kata/k/444444444444', 'agentic', 'patch-kata');
    setRouting(
      makeRouting(['ladder/explain-back/c/333333333333'], {
        sysdesign: [{ id: '01', title: '01 estimation', keys: ['sysdrills/01-estimation/', 'ladder/explain-back/b/222222222222', 'ladder/explain-back/c/333333333333', 'nope/unknown'] }],
        agentic: [{ id: 'k', title: 'katas', keys: ['ladder/kata/k/444444444444'] }],
      }),
    );
    const r = RoutingResponse.parse((await request(ctx.app).get('/api/routing')).body);
    expect(r.archivedUnitIds).toEqual([archived]);
    expect(r.paths.sysdesign).toEqual([{ id: '01', title: '01 estimation', unitIds: [d1, set2] }]);
    const d = await dashboard(ctx);
    // the path's first open unit, never the archived set; an EB / kata on a path is offered (C8 narrowed)
    expect(d.nextUp.find((n) => n.trackId === 'sysdesign')?.unit?.id).toBe(d1);
    expect(d.nextUp.find((n) => n.trackId === 'agentic')?.unit?.id).toBe(kata);
    // 2026-10-01 is a design day: the senior rep links to the path's first open DESIGN IT set
    expect(d.slate.items.find((i) => i.kind === 'senior-rep')).toMatchObject({ rep: 'design', targetUnitId: set2 });
  });

  it('G3/G4 (project kinds) are never a fallback next step; off a path an EB waits behind other units', async () => {
    setRouting(makeRouting([]));
    insertUnit(ctx.db, { key: 'agentic/g3-live-delegation', track: 'agentic', kind: 'repo-task', title: 'G3', difficulty: 3, checks: [{ spec: { type: 'repo', predicates: [{ kind: 'branch-exists', name: 'b', branch: 'feat/x' }] } }] }, ctx.clock);
    // the fixture's agentic reading unit is open: it is next up; once read, G3 is still never offered
    const agentic = async () => (await dashboard(ctx)).nextUp.find((n) => n.trackId === 'agentic')?.unit ?? null;
    expect((await agentic())?.key).toBe('fixture:no-check');
    expect((await request(ctx.app).post(`/api/units/${ctx.id('fixture:no-check')}/self-attest`).send({})).status).toBe(200);
    expect(await agentic()).toBeNull();
    const k = eb(ctx, 'ladder/kata/k/555555555555', 'agentic', 'patch-kata');
    expect((await agentic())?.id).toBe(k);
  });

  it('a Fundamentals track offers its ladder step first: the gate, then that topic\'s drill', async () => {
    setRouting(makeRouting([]));
    const gate = drill(ctx, 'fund/java/01-a', 'java');
    const fd = drill(ctx, 'fund-java/01-a/x', 'java');
    drill(ctx, 'fund/java/02-b', 'java', ['fund/java/01-a']);
    expect((await dashboard(ctx)).nextUp.find((n) => n.trackId === 'java')?.unit?.id).toBe(gate);
    await request(ctx.app).post(`/api/units/${gate}/submit`).send({ code: 'return a + b' });
    expect((await dashboard(ctx)).nextUp.find((n) => n.trackId === 'java')?.unit?.id).toBe(fd);
  });
});

