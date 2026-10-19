import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RefContentResponse, SeedQueueResponse, SyncReport } from '@bootquest/shared/sync';
import { UnitDetailResponse } from '@bootquest/shared/api';
import { createApp } from '../../src/api/app.ts';
import { createNodeTestFileRunner } from '../../src/api/runner-node-test-file.ts';
import { defaultRunners } from '../../src/api/runners.ts';
import { fixedClock } from '../../src/engines/clock.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';
import { CHECK_SPECS, makeSyncFixture, PINNED_SHA, SIGNALPOST, U01_SOLUTION, U01_STARTER, U03_SOLUTION, type SyncFixture } from '../sync-helpers.ts';
import { createSyncService } from '../../src/sync/service.ts';

describe('W4 API: POST /sync, GET /sync/queue, GET /refs/:id/content, node-test-file submit', { timeout: 180_000 }, () => {
  let fx: SyncFixture;
  let tmp: TempDb;
  let app: Express;
  const clock = fixedClock(localNoon(2026, 10, 8));
  beforeEach(() => {
    fx = makeSyncFixture();
    tmp = makeTempDb();
    // private workspace root: the P3 runner suite snapshots os.tmpdir()/bq-ntf-* concurrently
    const workRoot = join(fx.root, 'ntf-work');
    mkdirSync(workRoot);
    app = createApp({ db: tmp.db, clock, sync: fx.svc, runners: defaultRunners({ nodeTestFile: createNodeTestFileRunner(fx.svc.cache, { workRoot }) }) });
  });
  afterEach(() => {
    tmp.cleanup();
    fx.cleanup();
  });

  async function syncAndUnit(code: string, on: Express = app): Promise<{ unitId: number; detail: UnitDetailResponse }> {
    const s = await request(on).post('/api/sync').send({});
    expect(s.status).toBe(200);
    expect(SyncReport.parse(s.body).ok).toBe(true);
    const units = await request(on).get('/api/tracks/js/units');
    const u = (units.body as { units: { id: number; key: string }[] }).units.find((x) => x.key === `gh:${SIGNALPOST}:${code}`)!;
    const d = await request(on).get(`/api/units/${u.id}`);
    expect(d.status).toBe(200);
    return { unitId: u.id, detail: UnitDetailResponse.parse(d.body) };
  }
  const syncAndU01 = () => syncAndUnit('U01');

  it('POST /sync runs the job; the unit detail links its refs; the guide renders from the cache', async () => {
    const { detail } = await syncAndU01();
    expect(detail.unit.code).toBe('U01');
    expect(detail.check?.spec).toEqual({ type: 'node-test-file', learnerPath: 'practice/learner/u01.mjs', sha: PINNED_SHA, tsx: false, timeoutMs: 30000 });
    // private pins never reach the client
    expect(JSON.stringify(detail)).not.toMatch(/checkSha256|blobSha|expectedTests|u01\.test\.mjs/);
    expect(detail.refs!.map((r) => [r.role, r.path, r.contentUrl === null])).toEqual([
      ['program', 'docs/curriculum/program.json', true],
      ['guide', 'docs/curriculum/U01.md', false],
    ]);
    const guide = detail.refs!.find((r) => r.role === 'guide')!;
    const c = await request(app).get(guide.contentUrl!);
    expect(c.status).toBe(200);
    const body = RefContentResponse.parse(c.body);
    expect(body.servedFrom).toBe('tarball-cache');
    expect(body.markdown.split('\n')[0]).toBe('# U01 — Programming you can explain');
    expect(body.markdown.split('\n')).toHaveLength(143);
    // a sub-section serves exactly its line range
    const sub = tmp.db.get<{ id: number }>(`SELECT id FROM content_ref WHERE title LIKE 'U01-02%'`)!;
    const s2 = RefContentResponse.parse((await request(app).get(`/api/refs/${sub.id}/content`)).body);
    expect(s2.markdown.startsWith('## U01-02')).toBe(true);
    expect(s2.markdown).not.toMatch(/## U01-03/);
  });

  it('GET /sync/queue lists pending keys; status/limit validated', async () => {
    await syncAndU01();
    const q = await request(app).get('/api/sync/queue?limit=5');
    expect(q.status).toBe(200);
    const body = SeedQueueResponse.parse(q.body);
    expect(body.count).toBe(27);
    expect(body.items).toHaveLength(5);
    expect(body.items[0]).toMatchObject({ repo: SIGNALPOST, reason: 'initial', status: 'pending' });
    expect((await request(app).get('/api/sync/queue?status=bogus')).status).toBe(400);
    expect((await request(app).get('/api/sync/queue?path=../../x')).status).toBe(400);
  });

  it('LEAK CHECK: only registered markdown refs are servable — no arbitrary path reads', async () => {
    await syncAndU01();
    const programRef = tmp.db.get<{ id: number }>(`SELECT id FROM content_ref WHERE kind = 'program-unit' LIMIT 1`)!;
    expect((await request(app).get(`/api/refs/${programRef.id}/content`)).body.error.code).toBe('NOT_RENDERABLE');
    expect((await request(app).get('/api/refs/999999/content')).status).toBe(404);
    for (const bad of ['abc', '0', '-1', '1.5', '..%2F..%2Fpackage.json']) {
      expect((await request(app).get(`/api/refs/${bad}/content`)).status, bad).toBe(400);
    }
    // a request can never name a path: query strings are rejected outright
    const any = tmp.db.get<{ id: number }>(`SELECT id FROM content_ref WHERE path = 'docs/curriculum/U01.md' LIMIT 1`)!;
    expect((await request(app).get(`/api/refs/${any.id}/content?path=practice/checks/u01.test.mjs`)).status).toBe(400);
    // even a POISONED row cannot read outside the cache tree
    const evil = tmp.db.run(
      `INSERT INTO content_ref (repo, path, sha, title, stable_key, kind, provenance, created_at, updated_at)
       VALUES (?, '../../../../package.json.md', ?, 'evil', 'h:evil', 'guide', 'heading-hash', 0, 0)`,
      SIGNALPOST,
      PINNED_SHA,
    ).lastInsertRowid;
    const e = await request(app).get(`/api/refs/${evil}/content`);
    expect(e.status).toBe(409);
    expect(e.body.error.code).toBe('NOT_RENDERABLE');
    // quarantined refs are refused
    tmp.db.run(`UPDATE content_ref SET status = 'quarantined' WHERE id = ?`, any.id);
    expect((await request(app).get(`/api/refs/${any.id}/content`)).body.error.code).toBe('NOT_RENDERABLE');
  });

  it('U01 through the app: the real upstream starter FAILS, the P3 fixture solution PASSES (node-test-file runner)', async () => {
    const { unitId } = await syncAndU01();
    const stub = await request(app).post(`/api/units/${unitId}/submit`).send({ code: U01_STARTER });
    expect(stub.status).toBe(200);
    expect(stub.body.verdict).toBe('fail');
    expect(stub.body.result.failures.map((f: { message: string }) => f.message)).toEqual([
      'U01 learner implementation required',
      'U01 learner implementation required',
    ]);
    const good = await request(app).post(`/api/units/${unitId}/submit`).send({ code: U01_SOLUTION });
    expect(good.body.verdict).toBe('pass');
    expect(good.body.xp.amount).toBe(30); // code XP 10 x difficulty (targetLevel 3)
    // free run works too and writes nothing
    const runs = tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM run')!.n;
    expect((await request(app).post(`/api/units/${unitId}/run`).send({ code: U01_SOLUTION })).body.result.pass).toBe(true);
    expect(tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM run')!.n).toBe(runs);
    // every per-run workspace was removed
    expect(readdirSync(join(fx.root, 'ntf-work'))).toEqual([]);
  });

  it('U03 composite through the app: the adapter pins the tsconfig chain from the tarball cache; tsc runs BEFORE node --test', async () => {
    const { unitId, detail } = await syncAndUnit('U03');
    // public projection names the project (never the private pins); the carve-out is gone
    expect(detail.check!.spec).toMatchObject({ type: 'node-test-file', tscProject: 'practice/tsconfig.json' });
    expect(detail.uncoveredLegs).toBeUndefined();
    // campaign 2 (OPS review): the registered check carries the recorded chain pins; they stay PRIVATE
    const table = JSON.parse(readFileSync(CHECK_SPECS, 'utf8')) as { repos: Record<string, { units: Record<string, { tsc_files: Record<string, { sha256: string }> }> }> };
    const pins = Object.fromEntries(Object.entries(table.repos[SIGNALPOST]!.units.U03!.tsc_files).map(([p, f]) => [p, f.sha256]));
    expect(Object.keys(pins).sort()).toEqual(['practice/tsconfig.json', 'tsconfig.json']);
    const registered = JSON.parse(tmp.db.get<{ spec: string }>('SELECT spec FROM "check" WHERE unit_id = ?', unitId)!.spec) as { tscFiles?: Record<string, string> };
    expect(registered.tscFiles).toEqual(pins);
    expect('tscFiles' in (detail.check!.spec as object)).toBe(false);
    const good = await request(app).post(`/api/units/${unitId}/submit`).send({ code: U03_SOLUTION });
    expect(good.status).toBe(200);
    expect(good.body.result.failures).toEqual([]);
    expect(good.body.verdict).toBe('pass');
    // a type error the type-stripping runtime never sees: only the composite fails it
    const bad = await request(app).post(`/api/units/${unitId}/submit`).send({ code: `${U03_SOLUTION}\nconst bqBad: number = "s";\n` });
    expect(bad.status).toBe(200);
    expect(bad.body.verdict).toBe('fail');
    const failures = bad.body.result.failures as { name: string; message: string }[];
    expect(failures[0]!.name).toBe('(tsc)');
    expect(failures[0]!.message).toContain('TS2322');
    expect(failures.every((f) => f.name === '(tsc)')).toBe(true); // the behavioral tests themselves stayed green
    expect(readdirSync(join(fx.root, 'ntf-work'))).toEqual([]);
  });

  it('U03 composite: a tsconfig missing from the pinned tree is a 409 CHECK_INTEGRITY refusal and NOTHING is recorded', async () => {
    const { unitId } = await syncAndUnit('U03');
    // practice/tsconfig.json extends ../tsconfig.json: drop the parent from the extracted per-sha tree
    rmSync(join(fx.cacheRoot, 'elirc', 'signalpost-swe-bootcamp', PINNED_SHA, 'tsconfig.json'));
    const before = tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt')!.n;
    const r = await request(app).post(`/api/units/${unitId}/submit`).send({ code: U03_SOLUTION });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CHECK_INTEGRITY');
    expect(r.body.error.message).toMatch(/tsconfig .*tsconfig\.json is not available/);
    expect(tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt')!.n).toBe(before);
  });

  it('U03 composite: a TAMPERED cached tsconfig (valid JSON, same extends) is a 409 CHECK_INTEGRITY refusal against its recorded pin; NOTHING is recorded', async () => {
    const { unitId } = await syncAndUnit('U03');
    const f = join(fx.cacheRoot, 'elirc', 'signalpost-swe-bootcamp', PINNED_SHA, 'tsconfig.json');
    chmodSync(f, 0o644);
    // loosen the parent config: a learner-side edit that would silently weaken the type check
    writeFileSync(f, JSON.stringify({ compilerOptions: { strict: false, noEmit: true } }));
    const before = tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt')!.n;
    const r = await request(app).post(`/api/units/${unitId}/submit`).send({ code: `${U03_SOLUTION}\nconst bqBad: number = "s";\n` });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CHECK_INTEGRITY');
    expect(r.body.error.message).toMatch(/tsconfig tsconfig\.json .*does not hash to its recorded pin/);
    expect(tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt')!.n).toBe(before);
  });

  it('uncoveredLegs: a recorded carve-out is surfaced read-only on the program unit detail (and only there)', async () => {
    const table = JSON.parse(readFileSync(CHECK_SPECS, 'utf8')) as { repos: Record<string, { units: Record<string, { uncovered_legs?: string[] }> }> };
    table.repos[SIGNALPOST]!.units.U01!.uncovered_legs = ['U01-02 acceptance leg X is NOT covered (test carve-out)'];
    const specs = join(fx.root, 'check-specs.carve-out.json');
    writeFileSync(specs, JSON.stringify(table));
    const svc = createSyncService({ ...fx.svc.paths, checkSpecs: specs }, fx.gh);
    const carved = createApp({ db: tmp.db, clock, sync: svc, runners: defaultRunners({ nodeTestFile: createNodeTestFileRunner(svc.cache) }) });
    const u01 = await syncAndUnit('U01', carved);
    expect(u01.detail.uncoveredLegs).toEqual(['U01-02 acceptance leg X is NOT covered (test carve-out)']);
    const units = (await request(carved).get('/api/tracks/js/units')).body as { units: { id: number; key: string }[] };
    const u02Id = units.units.find((x) => x.key === `gh:${SIGNALPOST}:U02`)!.id;
    const u02 = await request(carved).get(`/api/units/${u02Id}`);
    expect(u02.status).toBe(200);
    expect(UnitDetailResponse.parse(u02.body).uncoveredLegs).toBeUndefined(); // empty list => absent
  });

  describe('U03 on a DB synced BEFORE the tsc composite (old table -> new table, same DB)', () => {
    const OLD_LEG = "U03-02 acceptance 'practice typecheck pass' (tsc -p practice/tsconfig.json) is NOT covered by this check (pre-OPS table)";
    function oldTableApp(): Express {
      const table = JSON.parse(readFileSync(CHECK_SPECS, 'utf8')) as {
        repos: Record<string, { units: Record<string, { tsc_project?: string; tsc_files?: unknown; uncovered_legs?: string[] }> }>;
      };
      const u03 = table.repos[SIGNALPOST]!.units.U03!;
      expect(u03.tsc_project).toBe('practice/tsconfig.json'); // the current table carries the composite
      delete u03.tsc_project;
      delete u03.tsc_files; // the pre-OPS table had neither (tsc_files without tsc_project is refused by the schema)
      u03.uncovered_legs = [OLD_LEG];
      const specs = join(fx.root, 'check-specs.pre-ops.json');
      writeFileSync(specs, JSON.stringify(table));
      const svc = createSyncService({ ...fx.svc.paths, checkSpecs: specs }, fx.gh);
      const workRoot = join(fx.root, 'ntf-work-old');
      mkdirSync(workRoot);
      return createApp({ db: tmp.db, clock, sync: svc, runners: defaultRunners({ nodeTestFile: createNodeTestFileRunner(svc.cache, { workRoot }) }) });
    }
    async function resync(): Promise<string[]> {
      const s = await request(app).post('/api/sync').send({});
      expect(s.status).toBe(200);
      const r = SyncReport.parse(s.body);
      expect(r.ok).toBe(true);
      return r.repos[0]!.program!.checkDrift;
    }

    it('unreferenced: the next sync re-registers the check, so the composite really runs and no carve-out remains', async () => {
      const old = oldTableApp();
      const before = await syncAndUnit('U03', old);
      expect((before.detail.check!.spec as { tscProject?: string }).tscProject).toBeUndefined();
      expect(before.detail.uncoveredLegs).toEqual([OLD_LEG]);
      // switch to the current table on the SAME DB
      const drift = await resync();
      expect(drift).toContainEqual(expect.stringMatching(/^U03: recorded check spec changed — re-registered the check \(no attempts referenced the old one\)$/));
      const d = UnitDetailResponse.parse((await request(app).get(`/api/units/${before.unitId}`)).body);
      expect(d.check!.spec).toMatchObject({ type: 'node-test-file', tscProject: 'practice/tsconfig.json' });
      expect(d.uncoveredLegs).toBeUndefined();
      // and the re-registered check really runs tsc
      const bad = await request(app).post(`/api/units/${before.unitId}/submit`).send({ code: `${U03_SOLUTION}\nconst bqBad: number = "s";\n` });
      expect(bad.body.verdict).toBe('fail');
      expect((bad.body.result.failures as { name: string }[])[0]!.name).toBe('(tsc)');
      // a further sync is quiet (the specs now agree)
      expect((await resync()).filter((x) => x.startsWith('U03:'))).toEqual([]);
    });

    it('referenced: the old check stays pinned, the drift is reported, AND GET /units still shows the typecheck carve-out', async () => {
      const old = oldTableApp();
      const before = await syncAndUnit('U03', old);
      // an attempt graded by the OLD check: a type error the old check cannot see passes
      const sub = await request(old).post(`/api/units/${before.unitId}/submit`).send({ code: `${U03_SOLUTION}\nconst bqBad: number = "s";\n` });
      expect(sub.status).toBe(200);
      expect(sub.body.verdict).toBe('pass');
      const drift = await resync();
      expect(drift).toContainEqual('U03: recorded check spec differs from the registered one — kept the registered check (attempts reference it)');
      const d = UnitDetailResponse.parse((await request(app).get(`/api/units/${before.unitId}`)).body);
      expect((d.check!.spec as { tscProject?: string }).tscProject).toBeUndefined();
      expect(d.uncoveredLegs).toHaveLength(1);
      expect(d.uncoveredLegs![0]).toMatch(/^U03-02 acceptance 'practice typecheck pass' \(tsc -p practice\/tsconfig\.json\) is NOT covered by this unit's registered check: it predates the tsc composite/);
      // the honest statement matches behavior: the pinned check still does not typecheck
      const again = await request(app).post(`/api/units/${before.unitId}/submit`).send({ code: `${U03_SOLUTION}\nconst bqBad: number = "s";\n` });
      expect(again.body.verdict).toBe('pass');
    });
  });

  it('a tampered cached check file is a 409 CHECK_INTEGRITY refusal and NOTHING is recorded', async () => {
    const { unitId } = await syncAndU01();
    const f = join(fx.cacheRoot, 'elirc', 'signalpost-swe-bootcamp', PINNED_SHA, 'practice', 'checks', 'u01.test.mjs');
    chmodSync(f, 0o644);
    writeFileSync(f, 'import test from "node:test"; test("remainingTitles preserves order and input", () => {});');
    const before = tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt')!.n;
    const r = await request(app).post(`/api/units/${unitId}/submit`).send({ code: U01_SOLUTION });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CHECK_INTEGRITY');
    expect(r.body.error.message).toMatch(/sha256 .* != pinned/);
    expect(tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt')!.n).toBe(before);
  });

  it('offline (network stubbed to fail): re-render and revalidate purely from the cache', async () => {
    const { unitId, detail } = await syncAndU01();
    fx.gh.online = false;
    const c = await request(app).get(detail.refs!.find((r) => r.role === 'guide')!.contentUrl!);
    expect(c.status).toBe(200);
    expect(c.body.servedFrom).toBe('tarball-cache');
    expect((await request(app).post(`/api/units/${unitId}/submit`).send({ code: U01_SOLUTION })).body.verdict).toBe('pass');
    const s = SyncReport.parse((await request(app).post('/api/sync').send({})).body);
    expect(s.repos[0]).toMatchObject({ shaFrom: 'cache', tarball: 'hit', error: null });
    const calls = { ...fx.gh.calls };
    expect(calls.downloadTarball).toBe(1);
  });

  it('afterSync throws AFTER the sync committed: 500 SYNC_RELINK_FAILED says so (never a bare INTERNAL); the API stays usable', async () => {
    let calls = 0;
    const errors: unknown[][] = [];
    const origError = console.error;
    console.error = (...a: unknown[]) => void errors.push(a);
    try {
      const broken = createApp({
        db: tmp.db,
        clock,
        sync: fx.svc,
        afterSync: () => {
          calls++;
          throw new Error('ladder loaded !== built: katas 3 vs 4');
        },
        syncRecoveryHint: 'restore /x/backups/bootquest-1.db',
      });
      const r = await request(broken).post('/api/sync').send({});
      expect(r.status).toBe(500);
      const env = r.body as { error: { code: string; message: string } };
      expect(env.error.code).toBe('SYNC_RELINK_FAILED');
      const syncId = tmp.db.get<{ id: number }>('SELECT MAX(id) AS id FROM sync_run')!.id;
      expect(env.error.message).toMatch(new RegExp(`^sync ${syncId} COMMITTED \\(${SIGNALPOST}@${PINNED_SHA.slice(0, 12)}\\)`));
      expect(env.error.message).toContain('ladder loaded !== built: katas 3 vs 4');
      expect(env.error.message).toMatch(/will likely REFUSE to start/);
      expect(env.error.message).toContain('restore /x/backups/bootquest-1.db');
      // logged loudly, with the same message
      expect(errors.some((a) => String(a[0]).includes('SYNC_RELINK_FAILED') || String(a[0]).includes(`sync ${syncId} COMMITTED`))).toBe(true);
      // the sync really committed: its units are served
      const units = (await request(broken).get('/api/tracks/js/units')).body as { units: { key: string }[] };
      expect(units.units.some((u) => u.key === `gh:${SIGNALPOST}:U01`)).toBe(true);
      // sane state: the in-flight flag was released (a second sync is not 409), health answers
      const again = await request(broken).post('/api/sync').send({});
      expect(again.status).toBe(500);
      expect(again.body.error.code).toBe('SYNC_RELINK_FAILED');
      expect(calls).toBe(2);
      expect((await request(broken).get('/api/health')).status).toBe(200);
      // a sync that FAILED before committing is still the plain path (config error -> 400), afterSync never runs
      expect((await request(broken).post('/api/sync').send({ repos: ['elirc/unknown'] })).status).toBe(400);
      expect(calls).toBe(2);
    } finally {
      console.error = origError;
    }
  });

  it('POST /sync without a configured sync service is 501; bad bodies are 400', async () => {
    const bare = createApp({ db: tmp.db, clock });
    const r = await request(bare).post('/api/sync').send({});
    expect(r.status).toBe(501);
    expect(r.body.error.code).toBe('SYNC_UNAVAILABLE');
    expect((await request(app).post('/api/sync').send({ repos: ['not a repo'] })).status).toBe(400);
    expect((await request(app).post('/api/sync').send({ repos: ['elirc/unknown'] })).body.error.code).toBe('VALIDATION');
    expect((await request(app).post('/api/sync').send({ extra: 1 })).status).toBe(400);
  });
});
