import { chmodSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
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
import { makeSyncFixture, PINNED_SHA, SIGNALPOST, U01_SOLUTION, U01_STARTER, type SyncFixture } from '../sync-helpers.ts';

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

  async function syncAndU01(): Promise<{ unitId: number; detail: UnitDetailResponse }> {
    const s = await request(app).post('/api/sync').send({});
    expect(s.status).toBe(200);
    expect(SyncReport.parse(s.body).ok).toBe(true);
    const units = await request(app).get('/api/tracks/js/units');
    const u = (units.body as { units: { id: number; key: string }[] }).units.find((x) => x.key === `gh:${SIGNALPOST}:U01`)!;
    const d = await request(app).get(`/api/units/${u.id}`);
    expect(d.status).toBe(200);
    return { unitId: u.id, detail: UnitDetailResponse.parse(d.body) };
  }

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
