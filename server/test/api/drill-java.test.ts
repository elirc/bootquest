// drill-java routing through the runner registry (fake runner — the real Java
// runner is exercised by `npm run test:java`, seed:validate and smoke:api).
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { CheckSpec } from '@bootquest/shared';
import { ApiErrorBody, SubmitResponse, UnitDetailResponse } from '@bootquest/shared/api';
import { createApp } from '../../src/api/app.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import { createDrillJavaRunner, JAVA_SCRATCH_ENV, javaExerciseFor, resolveJavaScratchDir } from '../../src/api/runner-java.ts';
import { defaultRunners, type Runner } from '../../src/api/runners.ts';
import { insertUnit } from '../../src/store/content.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
import { useApi } from './harness.ts';

const TESTS =
  '    // ─── tests ───────\n    public static void main(String[] args) {\n        test("counts TESTS_MARKER_java", () -> eq(countVowels("aE"), 2));\n        System.exit(report());\n    }\n    // ─── end tests ───────\n';
const TAIL = '} // TAIL_MARKER_java\n';
const STARTER = 'import static bootcamp.Check.*;\n\nclass Exercise {\n    static int countVowels(String t) { throw new UnsupportedOperationException("TODO"); }\n\n' + TESTS + TAIL;
const SOLUTION = STARTER.replace('throw new UnsupportedOperationException("TODO");', 'return (int) t.chars().filter(c -> "aeiouAEIOU".indexOf(c) >= 0).count(); /* SOLUTION_MARKER_java */');

function javaApp(ctx: ReturnType<typeof useApi>, drillJava: Runner | undefined) {
  // the Java track ships locked until the campaign/unlock migration lands; unlock it for these tests
  ctx.db.run(`UPDATE track SET locked = 0 WHERE id = 'java'`);
  const id = insertUnit(
    ctx.db,
    {
      key: 'javabootcamp/01-language-core/01-fixture',
      track: 'java',
      kind: 'drill',
      title: 'count the vowels',
      difficulty: 3,
      competencies: ['language-fluency'],
      checks: [{ spec: { type: 'drill-java', files: { tests: TESTS, tail: TAIL }, className: 'Exercise', timeoutMs: 10000 } }],
    },
    ctx.clock,
  );
  const app = createApp({
    db: ctx.db,
    clock: ctx.clock,
    runners: { ...defaultRunners({}), ...(drillJava ? { 'drill-java': drillJava } : {}) },
    content: mapContentStore({ 'javabootcamp/01-language-core/01-fixture': { instructions: 'Count the vowels.', starter: STARTER, solution: SOLUTION } }),
  });
  return { app, id };
}

/** Stand-in for the Java runner: passes iff the solution body is present; records what it was handed. */
function fakeJava(calls: CheckSpec[]): Runner {
  return async (spec, sub) => {
    calls.push(spec);
    return sub.code?.includes('SOLUTION_MARKER_java')
      ? { pass: true, output: '  ✔ counts TESTS_MARKER_java\n  #done passed=1 failed=0 todo=0', failures: [], durationMs: 5 }
      : { pass: false, output: '  ☐ counts TESTS_MARKER_java todo\n  #done passed=0 failed=0 todo=1', failures: [{ name: 'counts TESTS_MARKER_java', message: 'not implemented yet (todo)' }], durationMs: 5 };
  };
}

describe('drill-java units through the API', () => {
  const ctx = useApi();

  it('GET unit: public spec {type, timeoutMs} only — the tests block, tail and className never leave the server', async () => {
    const { app, id } = javaApp(ctx, fakeJava([]));
    const res = await request(app).get(`/api/units/${id}`);
    expect(res.status).toBe(200);
    const body = UnitDetailResponse.parse(res.body);
    expect(body.check?.spec).toEqual({ type: 'drill-java', timeoutMs: 10000 });
    expect(body.unit.trackId).toBe('java');
    expect(body.starter).toBe(STARTER);
    expect(res.text).not.toContain('SOLUTION_MARKER_java');
    expect(res.text).not.toContain('"files"');
    expect(res.text).not.toContain('"className"');
  });

  it('submit routes to the drill-java runner with the full private spec; pass pays 10 x difficulty code XP', async () => {
    const calls: CheckSpec[] = [];
    const { app, id } = javaApp(ctx, fakeJava(calls));
    const before = ledgerCounts(ctx.db);
    const res = await request(app).post(`/api/units/${id}/submit`).send({ code: SOLUTION });
    expect(res.status).toBe(200);
    const body = SubmitResponse.parse(res.body);
    expect(body.verdict).toBe('pass');
    expect(body.xp?.amount).toBe(30);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: 'drill-java', className: 'Exercise', files: { tests: TESTS, tail: TAIL } });
    const after = ledgerCounts(ctx.db);
    expect(after.attempt).toBe(before.attempt + 1);
    expect(after.run).toBe(before.run + 1);
    expect(after.xp_event).toBe(before.xp_event + 1);
    const xp = ctx.db.get<{ kind: string; amount: number }>('SELECT kind, amount FROM xp_event WHERE id = ?', body.xp!.id!)!;
    expect({ ...xp }).toEqual({ kind: 'code', amount: 30 });
  });

  it('the untouched starter is recorded as a fail with structured failures and no XP', async () => {
    const { app, id } = javaApp(ctx, fakeJava([]));
    const before = ledgerCounts(ctx.db);
    const res = await request(app).post(`/api/units/${id}/submit`).send({ code: STARTER });
    const body = SubmitResponse.parse(res.body);
    expect(body.verdict).toBe('fail');
    expect(body.xp).toBeNull();
    expect(body.result.failures).toEqual([{ name: 'counts TESTS_MARKER_java', message: 'not implemented yet (todo)' }]);
    const after = ledgerCounts(ctx.db);
    expect(after.attempt).toBe(before.attempt + 1);
    expect(after.xp_event).toBe(before.xp_event);
  });

  it('no drill-java runner registered -> 501 RUNNER_UNAVAILABLE, nothing recorded', async () => {
    const { app, id } = javaApp(ctx, undefined);
    const before = ledgerCounts(ctx.db);
    const res = await request(app).post(`/api/units/${id}/submit`).send({ code: SOLUTION });
    expect(res.status).toBe(501);
    expect(ApiErrorBody.parse(res.body).error.code).toBe('RUNNER_UNAVAILABLE');
    expect(ledgerCounts(ctx.db)).toEqual(before);
  });

  it('the REAL adapter refuses a submit without `code` (400) before touching the JDK or its scratch dir', async () => {
    const real = createDrillJavaRunner({ appDataDir: join(ctx.tmp.dir, 'never-created') });
    const { app, id } = javaApp(ctx, real.runner);
    const res = await request(app).post(`/api/units/${id}/submit`).send({ answer: 'x' });
    expect(res.status).toBe(400);
    expect(ApiErrorBody.parse(res.body).error.code).toBe('VALIDATION');
    expect(existsSync(join(ctx.tmp.dir, 'never-created'))).toBe(false);
    await real.shutdown();
  });
});

describe('runner-java helpers', () => {
  it('scratch dir: BOOTQUEST_JAVA_SCRATCH wins, else <db dir>/bootquest-scratch', () => {
    const db = join('some', 'dir', 'bq.db');
    expect(resolveJavaScratchDir({ [JAVA_SCRATCH_ENV]: ' x/y ' }, db)).toBe(resolve('x/y'));
    expect(resolveJavaScratchDir({ [JAVA_SCRATCH_ENV]: '' }, db)).toBe(join(resolve('some', 'dir'), 'bootquest-scratch'));
    expect(resolveJavaScratchDir({}, db)).toBe(join(resolve('some', 'dir'), 'bootquest-scratch'));
  });

  it('exercise = tests block + tail (head-less), className + timeout carried', () => {
    expect(javaExerciseFor({ type: 'drill-java', files: { tests: TESTS, tail: TAIL }, className: 'Exercise', timeoutMs: 7000 })).toEqual({
      id: 'drill-java',
      exerciseSource: TESTS + TAIL,
      className: 'Exercise',
      timeoutMs: 7000,
    });
  });
});
