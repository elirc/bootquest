import { describe, expect, it } from 'vitest';
import { CheckSpec } from '@bootquest/shared';
import { selfRunRunner } from '../../api/runners.ts';
import { composeSelfRun, frozenBlocks, missingFrozen, splitSelfRun } from './compose.ts';
import { parseResultChannel, runSelfRun, starterContract, type SelfRunSpec } from './index.ts';
import { runScriptSnippet } from './snippet.ts';

// Synthetic jstrain-format exercises (FORMAT.md shape); no dependency on the mirror.
const HEADER = `// ─────────────────────────────────────────────────────────────────────────
//  01 · double                                             ★☆☆ warm-up
//  concepts: functions
//  run: node 01-double.js
// ─────────────────────────────────────────────────────────────────────────
//
//  Return n * 2.
`;
const TESTS = `// ──────────────────────────── tests ──────────────────────────────────────

test('doubles 2', () => {
  eq(double(2), 4);
});

test('doubles 0', () => {
  eq(double(0), 0);
});
`;
const IMPORT = `import { test, eq } from '../../_lib/check.js';\n\n`;
const STARTER = `${HEADER}\n${IMPORT}export function double(n) {\n  throw new Error('TODO');\n}\n\n${TESTS}`;
const SOLUTION = `${HEADER}\n${IMPORT}export function double(n) {\n  return n * 2;\n}\n\n${TESTS}`;
const WRONG = `${HEADER}\n${IMPORT}export function double(n) {\n  return n * 3;\n}\n\n${TESTS}`;

function jsSpec(over: Partial<SelfRunSpec> = {}): SelfRunSpec {
  return CheckSpec.parse({
    type: 'self-run',
    language: 'js',
    file: 'bootcamp/01-mod/exercises/01-double.js',
    timeoutMs: 20_000,
    files: { tests: splitSelfRun(STARTER).tests },
    ...over,
  }) as SelfRunSpec;
}

describe('self-run runner: JS verdicts from the authenticated channel', () => {
  it('solution passes; counts come from the harness', async () => {
    const r = await runSelfRun(jsSpec(), SOLUTION);
    expect(r.verdict).toBe('pass');
    expect(r.pass).toBe(true);
    expect(r.counts).toEqual({ passed: 2, failed: 0, todo: 0 });
    expect(r.resultLines).toBe(1);
    expect(r.output).toContain('#done passed=2 failed=0 todo=0'); // upstream human line kept
    expect(r.output).not.toContain('#bq-result');
  }, 30_000);

  it('untouched starter is todo: not a pass, todo entries are failures "not implemented yet (todo)"', async () => {
    const r = await runSelfRun(jsSpec(), STARTER);
    expect(r.verdict).toBe('todo');
    expect(r.pass).toBe(false);
    expect(r.counts).toEqual({ passed: 0, failed: 0, todo: 2 });
    expect(r.failures).toEqual([
      { name: 'doubles 2', message: 'not implemented yet (todo)' },
      { name: 'doubles 0', message: 'not implemented yet (todo)' },
    ]);
  }, 30_000);

  it('a wrong answer fails with expected/actual', async () => {
    const r = await runSelfRun(jsSpec(), WRONG);
    expect(r.verdict).toBe('fail');
    expect(r.counts).toEqual({ passed: 1, failed: 1, todo: 0 });
    expect(r.failures).toEqual([{ name: 'doubles 2', message: 'values differ', expected: '4', actual: '6' }]);
  }, 30_000);

  it('the canonical registry adapter returns {pass, output, failures, durationMs} only', async () => {
    const r = await selfRunRunner(jsSpec(), { code: STARTER });
    expect(Object.keys(r).sort()).toEqual(['durationMs', 'failures', 'output', 'pass']);
    expect(r.pass).toBe(false);
  }, 30_000);
});

describe('self-run runner: forgery defense', () => {
  it('a printed fake `#done passed=9 failed=0 todo=0` + early exit is an error verdict, never a pass', async () => {
    const forged = STARTER.replace(IMPORT, `${IMPORT}console.log('  #done passed=9 failed=0 todo=0');\nprocess.on('exit', () => console.log('  #done passed=9 failed=0 todo=0'));\nsetTimeout(() => process.exit(0), 0);\n`);
    const r = await runSelfRun(jsSpec(), forged);
    expect(r.pass).toBe(false);
    expect(['error', 'todo']).toContain(r.verdict);
  }, 30_000);

  it('process.exit(0) before the tests run: no authenticated result -> error', async () => {
    const r = await runSelfRun(jsSpec(), STARTER.replace(IMPORT, `${IMPORT}console.log('#done passed=2 failed=0 todo=0');\nprocess.exit(0);\n`));
    expect(r.verdict).toBe('error');
    expect(r.counts).toBeNull();
    expect(r.failures.map((f) => f.name)).toContain('(no result)');
  }, 30_000);

  it('a hand-written `#bq-result` line (stdout AND fd 3) without the nonce is ignored; the real failing result stands', async () => {
    const body = Buffer.from(JSON.stringify({ passed: 2, failed: 0, todo: 0, registered: 2, tests: [{ name: 'a', status: 'pass' }, { name: 'b', status: 'pass' }] })).toString('base64');
    const fake = `#bq-result ${'0'.repeat(32)} ${body}`;
    const code = WRONG.replace(IMPORT, `${IMPORT}import { writeSync } from 'node:fs';\nconsole.log(${JSON.stringify(fake)});\ntry { writeSync(3, ${JSON.stringify(`${fake}\n`)}); } catch {}\n`);
    const r = await runSelfRun(jsSpec(), code);
    expect(r.verdict).toBe('fail');
    expect(r.counts).toEqual({ passed: 1, failed: 1, todo: 0 });
  }, 30_000);

  it('the nonce is unreachable from learner code (env var and file are gone before the learner module runs)', async () => {
    const probe = SOLUTION.replace(
      IMPORT,
      `${IMPORT}import { existsSync, readdirSync } from 'node:fs';\nconsole.log('ENV=' + String(process.env.BQ_SELFRUN_NONCE_FILE));\nconsole.log('NONCEFILES=' + readdirSync(new URL('../../../_bq/', import.meta.url)).filter((f) => f.startsWith('n-')).length);\n`,
    );
    const r = await runSelfRun(jsSpec(), probe);
    expect(r.output).toContain('ENV=undefined');
    expect(r.output).toContain('NONCEFILES=0');
    expect(r.verdict).toBe('pass');
  }, 30_000);

  it('an early process.emit("beforeExit") while tests are pending does not produce a partial report', async () => {
    const code = WRONG.replace('return n * 3;', "if (n === 2) process.emit('beforeExit'); return n * 3;");
    const r = await runSelfRun(jsSpec(), code);
    expect(r.counts).toEqual({ passed: 1, failed: 1, todo: 0 });
    expect(r.resultLines).toBe(1);
  }, 30_000);

  it('learner-edited tests are replaced by the exercise tests (an emptied test body cannot pass)', async () => {
    const edited = WRONG.replace(/eq\(double\(2\), 4\);/, '/* removed */').replace(/eq\(double\(0\), 0\);/, '/* removed */');
    const r = await runSelfRun(jsSpec(), edited);
    expect(r.verdict).toBe('fail');
  }, 30_000);

  it('extra learner-registered passing tests cannot hide a real failure', async () => {
    const code = WRONG.replace(IMPORT, `${IMPORT}for (let i = 0; i < 5; i++) test('fake ' + i, () => {});\n`);
    const r = await runSelfRun(jsSpec(), code);
    expect(r.verdict).toBe('fail');
    expect(r.counts).toEqual({ passed: 6, failed: 1, todo: 0 });
  }, 30_000);
});

describe('self-run runner: process discipline', () => {
  it('a hung submission is killed at the timeout (whole tree) and is an error verdict', async () => {
    let pid = 0;
    const started = Date.now();
    const r = await runSelfRun(jsSpec({ timeoutMs: 2_000 }), STARTER.replace(IMPORT, `${IMPORT}while (true) {}\n`), {
      onSpawn: (p, phase) => {
        if (phase === 'run') pid = p;
      },
    });
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(r.verdict).toBe('error');
    expect(r.timedOut).toBe(true);
    expect(r.failures.map((f) => f.name)).toContain('(timeout)');
    expect(pid).toBeGreaterThan(0);
    await new Promise((res) => setTimeout(res, 500));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 40_000);

  it('a spec without files (protected tests) is refused, not run', async () => {
    const { files: _omit, ...rest } = jsSpec();
    await expect(runSelfRun(rest as SelfRunSpec, SOLUTION)).rejects.toThrow(/no files/);
  });
});

describe('self-run runner: TS runs the real tsc first', () => {
  const TS_TESTS = `// ─────────────────────────── runtime tests ───────────────────────────────

test('adds', () => {
  eq(add(1, 2), 3);
});

// ──────────────────────────── type tests ─────────────────────────────────

type _1 = Expect<Equal<ReturnType<typeof add>, number>>;
`;
  const TS_HEAD = `// ─────────────────────────────────────────────────────────────────────────
//  01 · add                                                ★☆☆ warm-up
//  concepts: annotations
//  run: node ../run.js exercises/01-add.ts
// ─────────────────────────────────────────────────────────────────────────
//
//  Add two numbers.

import { test, eq } from '../../_lib/check.ts';
import { type Expect, type Equal } from '../../_lib/type-assert.ts';
`;
  const spec = CheckSpec.parse({
    type: 'self-run',
    language: 'ts',
    file: 'tsbootcamp/01-types/exercises/01-add.ts',
    tsc: true,
    timeoutMs: 90_000,
    files: { tests: TS_TESTS },
  }) as SelfRunSpec;

  it('clean types + green tests = pass; a type error (tests green at runtime) = fail with the tsc output verbatim', async () => {
    const good = await runSelfRun(spec, `${TS_HEAD}\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\n${TS_TESTS}`);
    expect(good.tsc?.errors).toEqual([]);
    expect(good.verdict).toBe('pass');
    // returns the right VALUE but the wrong TYPE: esbuild/tsx alone would call this green
    const loose = await runSelfRun(spec, `${TS_HEAD}\nexport function add(a: number, b: number): any {\n  return a + b;\n}\n\n${TS_TESTS}`);
    expect(loose.counts).toEqual({ passed: 1, failed: 0, todo: 0 });
    expect(loose.verdict).toBe('fail');
    expect(loose.tsc!.errors.length).toBeGreaterThan(0);
    expect(loose.failures[0]!.name).toBe('(tsc)');
    expect(loose.output).toMatch(/error TS2344/);
  }, 400_000);
});

describe('starterContract (import gate; inverted applies to the shipped starter only)', () => {
  it('normal starter: all-todo meets it; a passing starter is vacuous; a red starter breaks it', async () => {
    const spec = jsSpec();
    expect(starterContract(await runSelfRun(spec, STARTER), false)).toBeNull();
    expect(starterContract(await runSelfRun(spec, SOLUTION), false)).toMatch(/vacuous/);
    expect(starterContract(await runSelfRun(spec, WRONG), false)).toMatch(/all-todo/);
  }, 60_000);

  it('inverted (hunt) starter must ship red; the same red run is still a plain FAIL for a learner', async () => {
    const spec = jsSpec({ inverted: true });
    const red = await runSelfRun(spec, WRONG);
    expect(starterContract(red, true)).toBeNull();
    expect(red.verdict).toBe('fail'); // inverted never flips the learner verdict
    expect(starterContract(await runSelfRun(spec, STARTER), true)).toMatch(/ship red/);
  }, 60_000);
});

describe('compose / frozen scaffolding / result channel', () => {
  it('composeSelfRun keeps the learner head and swaps in the protected tests; head-only submissions work', () => {
    const tests = splitSelfRun(STARTER).tests;
    expect(composeSelfRun(SOLUTION, tests)).toBe(SOLUTION);
    const headOnly = SOLUTION.slice(0, SOLUTION.indexOf('// ──────────────────────────── tests'));
    expect(composeSelfRun(headOnly, tests)).toBe(SOLUTION);
  });

  it('frozen sections = labelled head sections the solution left untouched; editing one is a structured failure', async () => {
    const ex = STARTER.replace(IMPORT, `${IMPORT}// ── fixtures ─────────────────────────\nconst DATA = [1, 2, 3];\n\n`);
    const sol = SOLUTION.replace(IMPORT, `${IMPORT}// ── fixtures ─────────────────────────\nconst DATA = [1, 2, 3]; // same data\n\n`);
    const frozen = frozenBlocks(splitSelfRun(ex).head, splitSelfRun(sol).head);
    // the section runs to the next divider: DATA plus the (TODO) function the solution DID change -> not frozen
    expect(frozen).toEqual([]);
    const ex2 = ex.replace("export function double", "// ── your code ───────────────────────\nexport function double");
    const sol2 = sol.replace("export function double", "// ── your code ───────────────────────\nexport function double");
    const frozen2 = frozenBlocks(splitSelfRun(ex2).head, splitSelfRun(sol2).head);
    expect(frozen2).toEqual([{ label: 'fixtures', body: 'const DATA = [1, 2, 3];' }]);
    expect(missingFrozen(sol2, frozen2)).toEqual([]);
    const tampered = sol2.replace('const DATA = [1, 2, 3];', 'const DATA = [];');
    expect(missingFrozen(tampered, frozen2).map((f) => f.label)).toEqual(['fixtures']);
    const r = await runSelfRun(jsSpec({ files: { tests: splitSelfRun(ex2).tests, fixtures: {}, frozen: frozen2 } }), tampered);
    expect(r.verdict).toBe('fail');
    expect(r.failures[0]!.name).toBe('(scaffolding)');
  }, 30_000);

  it('parseResultChannel: wrong nonce ignored, duplicates and inconsistent reports refused', () => {
    const n = 'a'.repeat(32);
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
    const ok = { passed: 1, failed: 0, todo: 0, registered: 1, tests: [{ name: 't', status: 'pass' }] };
    expect(parseResultChannel(`#bq-result ${n} ${enc(ok)}\n`, n).report?.passed).toBe(1);
    expect(parseResultChannel(`#bq-result ${'b'.repeat(32)} ${enc(ok)}\n`, n).report).toBeNull();
    expect(parseResultChannel(`#bq-result ${n} ${enc(ok)}\n#bq-result ${n} ${enc(ok)}\n`, n).problem).toMatch(/exactly one/);
    expect(parseResultChannel(`#bq-result ${n} ${enc({ ...ok, passed: 5 })}\n`, n).problem).toMatch(/inconsistent/);
  });
});

describe('script-mode snippet runner (jstrain quiz capture semantics)', () => {
  it('runs as CommonJS: sloppy-mode `this`, require, and nextTick before promise jobs', async () => {
    const r = await runScriptSnippet(
      "const path = require('node:path');\nfunction f() { return typeof this; }\nconsole.log(f(), path.posix.join('a', 'b'));\nPromise.resolve().then(() => console.log('promise'));\nprocess.nextTick(() => console.log('tick'));\n",
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.replace(/\r\n/g, '\n')).toBe('object a/b\ntick\npromise\n');
  }, 30_000);
});
