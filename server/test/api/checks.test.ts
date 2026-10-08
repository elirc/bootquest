import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorBody, RunResponse, SubmitResponse, UnitDetailResponse } from '@bootquest/shared/api';
import type { Express } from 'express';
import { createApp } from '../../src/api/app.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import { defaultRunners } from '../../src/api/runners.ts';
import type { Db } from '../../src/db/database.ts';
import { fixedClock } from '../../src/engines/clock.ts';
import { insertUnit } from '../../src/store/content.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
import lessons from '../fixtures/check-lessons.json' with { type: 'json' };
import { buildFixtureRepo } from '../fixtures/repo-fixture.ts';
import { startTasksServer, type RunningFixture } from '../fixtures/tasks-server.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';

// spawns git / sockets / child servers: generous timeouts, the suites share the CPU with other process-spawning tests
vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

/**
 * W3c: the http + repo check fixture lessons through the REAL API and the
 * REAL runners (no fakes): run is free and writes nothing, submit is recorded
 * and pays code XP on pass, request-shape errors are 400s that record nothing,
 * the public spec carries only names, and GET /units/by-key/:key answers the
 * same shape as /units/:id.
 */

const HTTP_KEY = 'fixture:http-tasks-api';
const REPO_KEY = 'fixture:repo-feature-branch';

interface Ctx {
  tmp: TempDb;
  db: Db;
  app: Express;
  ids: Map<string, number>;
}

function useCheckApi(): Ctx {
  const ctx = {} as Ctx;
  beforeEach(() => {
    ctx.tmp = makeTempDb();
    ctx.db = ctx.tmp.db;
    const clock = fixedClock(localNoon(2026, 10, 1));
    ctx.ids = new Map(lessons.units.map((u) => [u.key, insertUnit(ctx.db, u, clock)]));
    ctx.app = createApp({ db: ctx.db, clock, runners: defaultRunners(), content: mapContentStore(lessons.content) });
  });
  afterEach(() => ctx.tmp.cleanup());
  return ctx;
}

function expectApiError(res: request.Response, status: number, code: string): string {
  expect(res.status).toBe(status);
  const body = ApiErrorBody.parse(res.body);
  expect(body.error.code).toBe(code);
  return body.error.message;
}

let repoDir: string;
let goodRepo: string;
let dirtyRepo: string;
beforeAll(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'bq-api-repo-'));
  [goodRepo, dirtyRepo] = await Promise.all([buildFixtureRepo(repoDir, 'good'), buildFixtureRepo(repoDir, 'dirty')]);
}, 60_000);
afterAll(() => rmSync(repoDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

describe('http check lesson through the API', () => {
  const ctx = useCheckApi();
  let server: RunningFixture | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('detail: public spec = request names/methods/paths + port hint; no expectations, bodies or headers', async () => {
    const res = await request(ctx.app).get(`/api/units/${ctx.ids.get(HTTP_KEY)}`);
    expect(res.status).toBe(200);
    const d = UnitDetailResponse.parse(res.body);
    expect(d.check?.spec).toEqual({
      type: 'http',
      port: 3000,
      timeoutMs: 5000,
      requests: [
        { name: 'health check answers ok', method: 'GET', path: '/health' },
        { name: 'create a task', method: 'POST', path: '/api/tasks' },
        { name: 'list tasks', method: 'GET', path: '/api/tasks' },
      ],
    });
    expect(JSON.stringify(d.check?.spec)).not.toMatch(/"expect"|jsonShape|write the tests first|"status"|"headers"|"body"/);
  });

  it('run against a good server: pass, writes nothing', async () => {
    server = await startTasksServer('good');
    const before = ledgerCounts(ctx.db);
    const res = await request(ctx.app).post(`/api/units/${ctx.ids.get(HTTP_KEY)}/run`).send({ port: server.port });
    expect(res.status).toBe(200);
    const { result } = RunResponse.parse(res.body);
    expect(result.failures).toEqual([]);
    expect(result.pass).toBe(true);
    expect(ledgerCounts(ctx.db)).toEqual(before);
  });

  it('submit wrong shape: recorded fail with structured failures; then a good server: pass + code XP (10 x difficulty 2)', async () => {
    const id = ctx.ids.get(HTTP_KEY)!;
    server = await startTasksServer('wrong-shape');
    const bad = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ port: server.port })).body);
    expect(bad.verdict).toBe('fail');
    expect(bad.xp).toBeNull();
    expect(bad.result.failures.map((f) => f.name)).toEqual(['create a task', 'list tasks']);
    expect(bad.result.failures[0]).toMatchObject({ expected: '$.id: integer', actual: '$.id: "1" (string)' });
    await server.close();

    server = await startTasksServer('good');
    const ok = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ port: server.port })).body);
    expect(ok.verdict).toBe('pass');
    expect(ok.xp?.amount).toBe(20);
    const row = ctx.db.get<{ answer: string; outcome: string }>('SELECT answer, outcome FROM attempt WHERE id = ?', ok.attempt.id)!;
    expect({ ...row, answer: JSON.parse(row.answer) }).toEqual({ answer: { port: server.port }, outcome: 'pass' });
    expect(ok.evidenceIds).toHaveLength(1); // data-http
  });

  it('wrong submission shape (code / no port / port out of range) is a 400 and records nothing', async () => {
    const id = ctx.ids.get(HTTP_KEY)!;
    const before = ledgerCounts(ctx.db);
    expect(expectApiError(await request(ctx.app).post(`/api/units/${id}/submit`).send({ code: 'x' }), 400, 'VALIDATION')).toMatch(/http checks take `port`/);
    expectApiError(await request(ctx.app).post(`/api/units/${id}/submit`).send({ port: 70000 }), 400, 'VALIDATION');
    expectApiError(await request(ctx.app).post(`/api/units/${id}/run`).send({ port: 3000, host: 'example.com' }), 400, 'VALIDATION');
    expect(ledgerCounts(ctx.db)).toEqual(before);
  });
});

describe('repo check lesson through the API', () => {
  const ctx = useCheckApi();

  it('detail: public spec = predicate kinds + names only', async () => {
    const res = await request(ctx.app).get(`/api/units/${ctx.ids.get(REPO_KEY)}`);
    const d = UnitDetailResponse.parse(res.body);
    expect(d.check?.spec).toEqual({
      type: 'repo',
      timeoutMs: 15000,
      predicates: [
        { kind: 'branch-exists', name: 'feature branch exists' },
        { kind: 'head-on-branch', name: 'you are on the feature branch' },
        { kind: 'file-exists-at-head', name: 'decision record committed' },
        { kind: 'clean-worktree', name: 'nothing left uncommitted' },
        { kind: 'min-commits', name: 'small commits (3+)' },
        { kind: 'commit-message-matches', name: 'conventional commit message' },
      ],
    });
    // the task statement (public instructions prose) may name the branch; the SPEC carries no grading values
    expect(JSON.stringify(d.check?.spec)).not.toMatch(/feat\/add-tasks|DECISIONS|refactor|"n"|"pattern"|"branch"|"path"/);
  });

  it('run is free; submit fail then pass is recorded with code XP', async () => {
    const id = ctx.ids.get(REPO_KEY)!;
    const before = ledgerCounts(ctx.db);
    const run = RunResponse.parse((await request(ctx.app).post(`/api/units/${id}/run`).send({ repoPath: goodRepo })).body);
    expect(run.result.pass).toBe(true);
    expect(ledgerCounts(ctx.db)).toEqual(before);

    const bad = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ repoPath: dirtyRepo })).body);
    expect(bad.verdict).toBe('fail');
    expect(bad.result.failures.map((f) => f.name)).toEqual(['nothing left uncommitted']);
    const ok = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ repoPath: goodRepo })).body);
    expect(ok.verdict).toBe('pass');
    expect(ok.xp?.amount).toBe(20);
  }, 30_000);

  it('a repoPath that is not a usable repo root is a 400 that records nothing', async () => {
    const id = ctx.ids.get(REPO_KEY)!;
    const before = ledgerCounts(ctx.db);
    expect(expectApiError(await request(ctx.app).post(`/api/units/${id}/submit`).send({ repoPath: 'relative/dir' }), 400, 'VALIDATION')).toMatch(/absolute path/);
    expect(expectApiError(await request(ctx.app).post(`/api/units/${id}/submit`).send({ repoPath: join(goodRepo, 'src') }), 400, 'VALIDATION')).toMatch(/not the root of a git working tree/);
    expect(expectApiError(await request(ctx.app).post(`/api/units/${id}/submit`).send({ port: 3000 }), 400, 'VALIDATION')).toMatch(/repo checks take `repoPath`/);
    expect(ledgerCounts(ctx.db)).toEqual(before);
  });
});

describe('GET /api/units/by-key/:key', () => {
  const ctx = useCheckApi();

  it('answers exactly what /units/:id answers (key URL-encoded as one segment)', async () => {
    for (const key of [HTTP_KEY, REPO_KEY]) {
      const byKey = await request(ctx.app).get(`/api/units/by-key/${encodeURIComponent(key)}`);
      const byId = await request(ctx.app).get(`/api/units/${ctx.ids.get(key)}`);
      expect(byKey.status).toBe(200);
      expect(UnitDetailResponse.parse(byKey.body)).toEqual(byId.body);
    }
  });

  it('works for slash keys (source/course/...) and 404s unknown or retired keys', async () => {
    const clock = fixedClock(localNoon(2026, 10, 1));
    const key = 'bootforge/js-fundamentals/values/variables/swap';
    const id = insertUnit(ctx.db, { key, track: 'js', kind: 'drill', title: 'swap', difficulty: 1, checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.ok(1)' }] } }] }, clock);
    const ok = await request(ctx.app).get(`/api/units/by-key/${encodeURIComponent(key)}`);
    expect(UnitDetailResponse.parse(ok.body).unit.id).toBe(id);
    expect(expectApiError(await request(ctx.app).get(`/api/units/by-key/${encodeURIComponent('bootforge/nope')}`), 404, 'NOT_FOUND')).toBe('no unit with key "bootforge/nope"');
    ctx.db.run('UPDATE unit SET retired_at = 1 WHERE id = ?', id);
    expectApiError(await request(ctx.app).get(`/api/units/by-key/${encodeURIComponent(key)}`), 404, 'NOT_FOUND');
  });

  it('validates the key format and rejects query strings', async () => {
    for (const bad of ['a%2F%2Fb', 'a%2F..%2Fb', 'has%20space', '-x']) {
      expectApiError(await request(ctx.app).get(`/api/units/by-key/${bad}`), 400, 'VALIDATION');
    }
    expectApiError(await request(ctx.app).get(`/api/units/by-key/${encodeURIComponent(HTTP_KEY)}?x=1`), 400, 'VALIDATION');
    // an unencoded slash key is a different (unknown) route, never a partial match
    expectApiError(await request(ctx.app).get('/api/units/by-key/bootforge/js-fundamentals'), 404, 'NOT_FOUND');
  });
});
