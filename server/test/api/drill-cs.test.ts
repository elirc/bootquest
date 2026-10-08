// W3a: drill-cs routing through the runner registry (mocked runner — the real
// C# runner is exercised by `npm run test:csharp`, seed:validate and smoke:api).
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { CheckSpec } from '@bootquest/shared';
import { ApiErrorBody, SubmitResponse, TracksResponse, UnitDetailResponse } from '@bootquest/shared/api';
import { createApp } from '../../src/api/app.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import { createDrillCsRunner, CS_SCRATCH_ENV, exerciseFor, resolveCsScratchDir } from '../../src/api/runner-csharp.ts';
import { defaultRunners, type Runner } from '../../src/api/runners.ts';
import { insertUnit } from '../../src/store/content.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
import { useApi } from './harness.ts';

const TESTS = '// ─── tests ───────\nTest("counts TESTS_MARKER_cs", () => Eq(CountVowels("aE"), 2));\nreturn Report();\n';
const TAIL = '\n// ─── the code you edit ───\nclass TAIL_MARKER_cs { }\n';
const STARTER = '#:project ../../_lib/Check/Check.csproj\nusing static Bootcamp.Check;\nstatic int CountVowels(string t) => throw new NotImplementedException("TODO");\n\n' + TESTS + TAIL;
const SOLUTION = STARTER.replace('throw new NotImplementedException("TODO")', 't.Count(c => "aeiouAEIOU".Contains(c)) /* SOLUTION_MARKER_cs */');

function csApp(ctx: ReturnType<typeof useApi>, drillCs: Runner | undefined) {
  const id = insertUnit(
    ctx.db,
    {
      key: 'csbootcamp/01-language-core/01-fixture',
      track: 'csharp',
      kind: 'drill',
      title: 'count the vowels',
      difficulty: 3,
      competencies: ['language-fluency'],
      checks: [{ spec: { type: 'drill-cs', shape: 'console-check', files: { tests: TESTS, tail: TAIL }, timeoutMs: 10000 } }],
    },
    ctx.clock,
  );
  const app = createApp({
    db: ctx.db,
    clock: ctx.clock,
    runners: defaultRunners(drillCs ? { drillCs } : {}),
    content: mapContentStore({ 'csbootcamp/01-language-core/01-fixture': { instructions: 'Count the vowels.', starter: STARTER, solution: SOLUTION } }),
  });
  return { app, id };
}

/** Stand-in for the C# runner: passes iff the solution body is present; records what it was handed. */
function fakeCs(calls: CheckSpec[]): Runner {
  return async (spec, sub) => {
    calls.push(spec);
    return sub.code?.includes('SOLUTION_MARKER_cs')
      ? { pass: true, output: '#done passed=1 failed=0 todo=0', failures: [], durationMs: 5 }
      : { pass: false, output: '#done passed=0 failed=0 todo=1', failures: [{ name: 'counts TESTS_MARKER_cs', message: 'not implemented yet (todo)' }], durationMs: 5 };
  };
}

describe('drill-cs units through the API (W3a)', () => {
  const ctx = useApi();

  it('GET unit: public spec {type, shape, timeoutMs} only — the tests block and tail never leave the server', async () => {
    const { app, id } = csApp(ctx, fakeCs([]));
    const res = await request(app).get(`/api/units/${id}`);
    expect(res.status).toBe(200);
    const body = UnitDetailResponse.parse(res.body);
    expect(body.check?.spec).toEqual({ type: 'drill-cs', shape: 'console-check', timeoutMs: 10000 });
    expect(body.unit.trackId).toBe('csharp');
    expect(body.starter).toBe(STARTER); // the learner's file (tests visible in it, as upstream ships them)
    expect(res.text).not.toContain('SOLUTION_MARKER_cs');
    expect(res.text).not.toContain('"files"');
  });

  it('submit routes to the drill-cs runner with the full private spec; pass pays 10 x difficulty code XP', async () => {
    const calls: CheckSpec[] = [];
    const { app, id } = csApp(ctx, fakeCs(calls));
    const before = ledgerCounts(ctx.db);
    const res = await request(app).post(`/api/units/${id}/submit`).send({ code: SOLUTION });
    expect(res.status).toBe(200);
    const body = SubmitResponse.parse(res.body);
    expect(body.verdict).toBe('pass');
    expect(body.xp?.amount).toBe(30);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: 'drill-cs', shape: 'console-check', files: { tests: TESTS, tail: TAIL } });
    const after = ledgerCounts(ctx.db);
    expect(after.attempt).toBe(before.attempt + 1);
    expect(after.run).toBe(before.run + 1);
    expect(after.xp_event).toBe(before.xp_event + 1);
    const xp = ctx.db.get<{ kind: string; amount: number }>('SELECT kind, amount FROM xp_event WHERE id = ?', body.xp!.id!)!;
    expect({ ...xp }).toEqual({ kind: 'code', amount: 30 });
  });

  it('the untouched starter is recorded as a fail with structured failures and no XP', async () => {
    const { app, id } = csApp(ctx, fakeCs([]));
    const before = ledgerCounts(ctx.db);
    const res = await request(app).post(`/api/units/${id}/submit`).send({ code: STARTER });
    const body = SubmitResponse.parse(res.body);
    expect(body.verdict).toBe('fail');
    expect(body.xp).toBeNull();
    expect(body.result.failures).toEqual([{ name: 'counts TESTS_MARKER_cs', message: 'not implemented yet (todo)' }]);
    const after = ledgerCounts(ctx.db);
    expect(after.attempt).toBe(before.attempt + 1);
    expect(after.xp_event).toBe(before.xp_event);
  });

  it('no drill-cs runner registered -> 501 RUNNER_UNAVAILABLE, nothing recorded', async () => {
    const { app, id } = csApp(ctx, undefined);
    const before = ledgerCounts(ctx.db);
    const res = await request(app).post(`/api/units/${id}/submit`).send({ code: SOLUTION });
    expect(res.status).toBe(501);
    expect(ApiErrorBody.parse(res.body).error.code).toBe('RUNNER_UNAVAILABLE');
    expect(ledgerCounts(ctx.db)).toEqual(before);
  });

  it('the REAL adapter refuses a submit without `code` (400) before touching dotnet', async () => {
    const real = createDrillCsRunner({ appDataDir: join(ctx.tmp.dir, 'never-created') });
    const { app, id } = csApp(ctx, real.runner);
    const res = await request(app).post(`/api/units/${id}/submit`).send({ answer: 'x' });
    expect(res.status).toBe(400);
    expect(ApiErrorBody.parse(res.body).error.code).toBe('VALIDATION');
    expect(existsSync(join(ctx.tmp.dir, 'never-created'))).toBe(false);
    await real.shutdown(); // no-op: no C# grade ran, so no dotnet is spawned
  });

  it('tracks: js, csharp (unlocked), java (locked), agentic — in that order', async () => {
    const { app } = csApp(ctx, fakeCs([]));
    const t = TracksResponse.parse((await request(app).get('/api/tracks')).body);
    expect(t.tracks.map((x) => [x.id, x.locked])).toEqual([
      ['js', false],
      ['csharp', false],
      ['java', true],
      ['agentic', false],
    ]);
  });
});

describe('runner-csharp helpers', () => {
  it('scratch dir: BOOTQUEST_CS_SCRATCH wins, else <db dir>/bootquest-scratch', () => {
    const db = join('some', 'dir', 'bq.db');
    expect(resolveCsScratchDir({ [CS_SCRATCH_ENV]: ' x/y ' }, db)).toBe(resolve('x/y'));
    expect(resolveCsScratchDir({ [CS_SCRATCH_ENV]: '' }, db)).toBe(join(resolve('some', 'dir'), 'bootquest-scratch'));
    expect(resolveCsScratchDir({}, db)).toBe(join(resolve('some', 'dir'), 'bootquest-scratch'));
  });

  it('console-check exercise = tests block + tail (head-less), xunit = the test class', () => {
    expect(exerciseFor({ type: 'drill-cs', shape: 'console-check', files: { tests: TESTS, tail: TAIL }, timeoutMs: 7000 })).toEqual({
      id: 'drill-cs',
      shape: 'console-check',
      exerciseSource: TESTS + TAIL,
      timeoutMs: 7000,
    });
    expect(exerciseFor({ type: 'drill-cs', shape: 'xunit', files: { tests: 'class T {}', tail: '' }, timeoutMs: 30000 })).toEqual({
      id: 'drill-cs',
      shape: 'xunit',
      tests: 'class T {}',
      timeoutMs: 30000,
    });
  });
});
