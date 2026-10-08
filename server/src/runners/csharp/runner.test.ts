// C# runner gate (W3a spike). Real dotnet, real csbootcamp fixture, real timings.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeGraded, CsbootcampFormatError, rewriteDirectives, splitAtTestsMarker } from './csbootcamp-split.js';
import { createCsharpRunner, type CsExercise, type RunResult } from './index.js';
import { livePids } from './scratch.js';
import { createDrillCsRunner } from '../../api/runner-csharp.ts';
import { CheckSpec } from '@bootquest/shared';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FX = join(HERE, 'fixtures', 'csbootcamp', '01-language-core');
const EXERCISE_SRC = readFileSync(join(FX, 'exercises', '01-count-vowels.cs'), 'utf8');
const SOLUTION_SRC = readFileSync(join(FX, 'solutions', '01-count-vowels.cs'), 'utf8');

const APP = mkdtempSync(join(tmpdir(), 'bootquest-p2-'));
const APP_MSBUILD = mkdtempSync(join(tmpdir(), 'bootquest-p2-msb-'));
const APP_ADAPTER = mkdtempSync(join(tmpdir(), 'bootquest-w3a-'));
const runner = createCsharpRunner({ appDataDir: APP });
const adapter = createDrillCsRunner({ appDataDir: APP_ADAPTER });
const msbuildRunner = createCsharpRunner({ appDataDir: APP_MSBUILD, xunitEngine: 'msbuild' });

const timings: Record<string, unknown> = { machine: { node: process.version } };
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** PIDs of live processes whose command line mentions `needle` (Windows CIM query). */
function processesMentioning(needle: string): string[] {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return out.split(/\r?\n/).filter((l) => l.trim() && !/powershell/i.test(l));
}

const consoleEx: CsExercise = {
  id: 'csbootcamp/01-language-core/01-count-vowels',
  shape: 'console-check',
  exerciseSource: EXERCISE_SRC,
  timeoutMs: 10_000,
};

const XUNIT_TESTS = `
public class CalcTests
{
    [Fact] public void AddsSmallNumbers() => Assert.Equal(3, Calc.Add(1, 2));
    [Fact] public void AddsNegatives() => Assert.Equal(-1, Calc.Add(1, -2));
    [Theory, InlineData(0, 0, 0), InlineData(40, 2, 42)]
    public void AddsTable(int a, int b, int sum) => Assert.Equal(sum, Calc.Add(a, b));
}
`;
const xunitEx: CsExercise = { id: 'probe/xunit-calc', shape: 'xunit', tests: XUNIT_TESTS, timeoutMs: 30_000 };
const XUNIT_SOLUTION = 'public static class Calc { public static int Add(int a, int b) => a + b; }\n';

function brief(r: RunResult) {
  return { pass: r.pass, ms: r.durationMs, phases: r.phases, counts: r.counts };
}

beforeAll(() => {
  // Guard: nothing of ours alive before we start.
  expect(processesMentioning(APP)).toEqual([]);
});

afterAll(async () => {
  await runner.shutdown();
  await msbuildRunner.shutdown();
  await adapter.shutdown();
  const leftovers = [
    ...processesMentioning(APP),
    ...processesMentioning(runner.scratch.pipe),
    ...processesMentioning(msbuildRunner.scratch.pipe),
    ...processesMentioning(APP_ADAPTER),
    ...processesMentioning(adapter.pipe),
  ];
  timings.leftoverProcessesAfterShutdown = leftovers;
  const out = join(tmpdir(), 'bootquest-p2-timings.json');
  writeFileSync(out, JSON.stringify(timings, null, 2));
  console.log(`[p2] timings → ${out}\n${JSON.stringify(timings, null, 2)}`);
  if (!process.env.BQ_KEEP_SCRATCH) {
    rmSync(APP, { recursive: true, force: true });
    rmSync(APP_MSBUILD, { recursive: true, force: true });
    rmSync(APP_ADAPTER, { recursive: true, force: true });
  }
  expect(leftovers).toEqual([]);
  expect(livePids()).toEqual([]);
});

// ── pure format handling ──────────────────────────────────────────────────────

describe('csbootcamp split-at-tests-marker', () => {
  it('splits the real exercise into head / tests / tail', () => {
    const s = splitAtTestsMarker(EXERCISE_SRC);
    expect(s.head).toContain('static int CountVowels(string text) => throw new NotImplementedException("TODO");');
    expect(s.head).toContain('#:project ../../_lib/Check/Check.csproj');
    expect(s.tests.startsWith('// ─── tests ─')).toBe(true);
    expect(s.tests.match(/^Test\(/gm)).toHaveLength(6);
    expect(s.tests.trimEnd().endsWith('return Report();')).toBe(true);
    expect(s.tail.trim()).toBe('');
  });

  it('the solution repeats the exercise tests byte-for-byte (estate memo claim)', () => {
    expect(splitAtTestsMarker(SOLUTION_SRC).tests).toBe(splitAtTestsMarker(EXERCISE_SRC).tests);
  });

  it('grades learner head+tail against the EXERCISE tests (learner-edited tests are discarded)', () => {
    const tampered = SOLUTION_SRC.replace(/^Test\(.*$/gm, '').replace('return Report();', 'Test("fake", () => {});\nreturn Report();');
    const graded = composeGraded(tampered, EXERCISE_SRC);
    expect(graded).toContain('Test("is case-insensitive"');
    expect(graded).not.toContain('Test("fake"');
    expect(graded).toContain('text.Count(c => "aeiouAEIOU".Contains(c))');
    expect(graded).toContain('// [bootquest] project ../../_lib/Check/Check.csproj');
    // line count preserved → compiler line numbers match the learner's file
    expect(composeGraded(SOLUTION_SRC, EXERCISE_SRC).split('\n').length).toBe(SOLUTION_SRC.replace(/\r\n/g, '\n').split('\n').length);
  });

  it('keeps the types section that lives AFTER return Report() (module 05+ layout)', () => {
    const ex = `#:project ../../_lib/Check/Check.csproj\nusing static Bootcamp.Check;\n\n// ─── tests ───────\nTest("w", () => Eq(new Box(2).W, 2));\nreturn Report();\n\n// ─── the types ───\nrecord Box(int W) { }\n`;
    const learner = ex.replace('record Box(int W) { }', 'record Box(int W) { public int Twice => W * 2; }');
    const graded = composeGraded(learner, ex);
    expect(graded).toContain('public int Twice');
    expect(graded.indexOf('return Report();')).toBeLessThan(graded.indexOf('record Box'));
  });

  it('rejects directives the warm path cannot honour', () => {
    expect(() => rewriteDirectives('#:package Humanizer@2.14.1\n')).toThrow(CsbootcampFormatError);
    expect(() => splitAtTestsMarker('no marker here')).toThrow(CsbootcampFormatError);
  });
});

// ── console-check shape (csbootcamp file-based apps) ───────────────────────────

describe('console-check shape: real csbootcamp 01-count-vowels', () => {
  it('first-ever run (prepare included): the SOLUTION passes against the exercise tests', async () => {
    const r = await runner.run(consoleEx, { code: SOLUTION_SRC });
    timings.consoleFirst = brief(r);
    expect(r.output).toContain('#done passed=6 failed=0 todo=0');
    expect(r.counts).toEqual({ passed: 6, failed: 0, todo: 0 });
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it('the untouched STARTER fails (6 todo → not a pass) with structured failures', async () => {
    const r = await runner.run(consoleEx, { code: EXERCISE_SRC });
    timings.consoleStarter = brief(r);
    expect(r.pass).toBe(false);
    expect(r.counts).toEqual({ passed: 0, failed: 0, todo: 6 });
    expect(r.failures.map((f) => f.name)).toContain('is case-insensitive');
    expect(r.failures.every((f) => f.message.includes('todo'))).toBe(true);
  });

  it('a wrong answer fails with name/message/expected/actual', async () => {
    const wrong = EXERCISE_SRC.replace('=> throw new NotImplementedException("TODO");', '=> text.Count(c => "aeiou".Contains(c));');
    const r = await runner.run(consoleEx, { code: wrong });
    expect(r.pass).toBe(false);
    expect(r.counts).toEqual({ passed: 4, failed: 2, todo: 0 });
    const f = r.failures.find((x) => x.name === 'is case-insensitive');
    expect(f).toEqual({ name: 'is case-insensitive', message: 'values differ', expected: '2', actual: '0' });
  });

  it('a syntax error returns the compiler output verbatim', async () => {
    const broken = SOLUTION_SRC.replace('text.Count(c => "aeiouAEIOU".Contains(c));', 'text.Count(c => "aeiouAEIOU".Contains(c))');
    const r = await runner.run(consoleEx, { code: broken });
    timings.consoleCompileError = brief(r);
    expect(r.pass).toBe(false);
    expect(r.compileError).toBe(true);
    // csc's own line: file(line,col): error CSxxxx: message
    expect(r.output).toMatch(/Program\.cs\(\d+,\d+\): error CS1002: ; expected/);
    expect(r.output.trim()).toMatch(/^Program\.cs\(27,46\): error CS1002: ; expected$/); // nothing but csc's line
    console.log('[p2] verbatim compiler output:\n' + r.output);
  });

  it('an infinite loop is killed (process tree) and bin/ stays usable for the NEXT grade', async () => {
    const looping = EXERCISE_SRC.replace('=> throw new NotImplementedException("TODO");', '{ while (true) { } }');
    const r = await runner.run({ ...consoleEx, timeoutMs: 4_000 }, { code: looping });
    timings.consoleInfiniteLoop = brief(r);
    expect(r.timedOut).toBe(true);
    expect(r.pass).toBe(false);
    expect(r.failures[0]!.name).toBe('(timeout)');
    expect(processesMentioning(APP)).toEqual([]);
    expect(livePids()).toEqual([]);
    const again = await runner.run(consoleEx, { code: SOLUTION_SRC });
    timings.consoleAfterKill = brief(again);
    expect(again.pass).toBe(true);
  });

  it('warm runs: median of 5 (each attempt is a fresh edit → real recompile)', async () => {
    const runs: number[] = [];
    const phases: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await runner.run(consoleEx, { code: SOLUTION_SRC + `\n// attempt ${i}\n` });
      expect(r.pass).toBe(true);
      runs.push(r.durationMs);
      phases.push(r.phases);
    }
    timings.consoleWarm = { runs, median: median(runs), phases };
    expect(median(runs)).toBeLessThan(10_000);
  });

  it('per-shape mutex: same-shape grades serialize, other shapes do not wait', async () => {
    const order: string[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await Promise.all([
      runner.scratch.withShape('console-check', async () => {
        order.push('a:start');
        await sleep(300);
        order.push('a:end');
      }),
      runner.scratch.withShape('console-check', async () => {
        order.push('b:start');
        order.push('b:end');
      }),
      runner.scratch.withShape('xunit', async () => {
        order.push('x:start');
        order.push('x:end');
      }),
    ]);
    expect(order.indexOf('b:start')).toBeGreaterThan(order.indexOf('a:end'));
    expect(order.indexOf('x:start')).toBeLessThan(order.indexOf('a:end'));
    // and two real concurrent grades of one shape don't trample each other's files
    const [ok, bad] = await Promise.all([
      runner.run(consoleEx, { code: SOLUTION_SRC }),
      runner.run(consoleEx, { code: EXERCISE_SRC }),
    ]);
    expect(ok.pass).toBe(true);
    expect(bad.pass).toBe(false);
    expect(bad.counts?.todo).toBe(6);
  });
});

// ── xunit shape (classic make-tests-pass) ──────────────────────────────────────

describe('xunit shape (fast engine: csc + dotnet vstest over the warm bin/)', () => {
  it('first-ever run (restore + first build included): solution passes', async () => {
    const r = await runner.run(xunitEx, { code: XUNIT_SOLUTION });
    timings.xunitFirst = brief(r);
    expect(r.counts).toEqual({ passed: 4, failed: 0, todo: 0 });
    expect(r.pass).toBe(true);
  });

  it('a wrong solution fails with structured expected/actual', async () => {
    const r = await runner.run(xunitEx, { code: 'public static class Calc { public static int Add(int a, int b) => a - b; }\n' });
    expect(r.pass).toBe(false);
    expect(r.counts?.failed).toBe(3);
    const f = r.failures.find((x) => x.name === 'CalcTests.AddsSmallNumbers');
    expect(f?.expected).toBe('3');
    expect(f?.actual).toBe('-1');
    expect(f?.message).toContain('Assert.Equal() Failure');
  });

  it('a compile error returns verbatim compiler output', async () => {
    const r = await runner.run(xunitEx, { code: 'public static class Calc { public static int Add(int a, int b) => a + b }\n' });
    expect(r.compileError).toBe(true);
    expect(r.output).toMatch(/Solution\.cs\(1,\d+\): error CS1002: ; expected/);
  });

  it('an infinite loop is killed (vstest → testhost grandchild) and the next grade works', async () => {
    const r = await runner.run({ ...xunitEx, timeoutMs: 15_000 }, {
      code: 'public static class Calc { public static int Add(int a, int b) { while (true) { } } }\n',
    });
    timings.xunitInfiniteLoop = brief(r);
    expect(r.timedOut).toBe(true);
    expect(processesMentioning(APP)).toEqual([]);
    const again = await runner.run(xunitEx, { code: XUNIT_SOLUTION });
    timings.xunitAfterKill = brief(again);
    expect(again.pass).toBe(true);
  });

  it('warm runs: median of 5', async () => {
    const runs: number[] = [];
    const phases: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await runner.run(xunitEx, { code: XUNIT_SOLUTION + `// attempt ${i}\n` });
      expect(r.pass).toBe(true);
      runs.push(r.durationMs);
      phases.push(r.phases);
    }
    timings.xunitWarm = { runs, median: median(runs), phases };
    expect(median(runs)).toBeLessThan(10_000);
  });
});

describe('xunit shape, spec-literal engine (`dotnet test --no-restore`) — measured for comparison, not gated', () => {
  it('first + 3 warm', async () => {
    const first = await msbuildRunner.run(xunitEx, { code: XUNIT_SOLUTION });
    expect(first.pass).toBe(true);
    const runs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await msbuildRunner.run(xunitEx, { code: XUNIT_SOLUTION + `// m${i}\n` });
      expect(r.pass).toBe(true);
      runs.push(r.durationMs);
    }
    const bad = await msbuildRunner.run(xunitEx, { code: 'public static class Calc { public static int Add(int a, int b) => a + b }\n' });
    expect(bad.compileError).toBe(true);
    timings.xunitMsbuild = { first: first.durationMs, warm: runs, median: median(runs) };
  });
});

// ── W3a: the drill-cs adapter (what POST /submit and seed:validate call) ─────────

describe('drill-cs adapter (createDrillCsRunner) over the real runner', () => {
  const ex = splitAtTestsMarker(EXERCISE_SRC);
  const spec = CheckSpec.parse({ type: 'drill-cs', shape: 'console-check', files: { tests: ex.tests, tail: ex.tail } });

  it('GRADER-INTEGRITY TRAP documented: the untouched starter process EXITS 0 with todo=6', async () => {
    const raw = await runner.scratch.withShape('console-check', () => runner.scratch.attemptConsole(composeGraded(EXERCISE_SRC, EXERCISE_SRC), 10_000));
    expect(raw.compile.ok).toBe(true);
    expect(raw.run?.code).toBe(0); // exit code says "fine" ...
    expect(raw.run?.output).toContain('#done passed=0 failed=0 todo=6'); // ... the counts say "nothing done"
  });

  it('reference solution passes; untouched starter FAILS (todo counts as not-passed) with structured failures', async () => {
    const ok = await adapter.runner(spec, { code: SOLUTION_SRC });
    timings.adapterFirst = { pass: ok.pass, ms: ok.durationMs };
    expect(ok.pass).toBe(true);
    expect(ok.failures).toEqual([]);
    const starter = await adapter.runner(spec, { code: EXERCISE_SRC });
    expect(starter.pass).toBe(false);
    expect(starter.failures).toHaveLength(6);
    expect(starter.failures.every((f) => f.message === 'not implemented yet (todo)')).toBe(true);
  });

  it('a partially right answer fails with expected/actual; a syntax error comes back verbatim', async () => {
    const wrong = await adapter.runner(spec, { code: EXERCISE_SRC.replace('=> throw new NotImplementedException("TODO");', '=> text.Count(c => "aeiou".Contains(c));') });
    expect(wrong.pass).toBe(false);
    expect(wrong.failures.find((f) => f.name === 'is case-insensitive')).toEqual({ name: 'is case-insensitive', message: 'values differ', expected: '2', actual: '0' });
    const broken = await adapter.runner(spec, { code: SOLUTION_SRC.replace('text.Count(c => "aeiouAEIOU".Contains(c));', 'text.Count(c => "aeiouAEIOU".Contains(c))') });
    expect(broken.pass).toBe(false);
    expect(broken.failures[0]!.name).toBe('(compile)');
    expect(broken.output).toMatch(/Program\.cs\(\d+,\d+\): error CS1002: ; expected/);
  });

  it('learner-edited tests are discarded: deleting every test cannot pass', async () => {
    const gutted = SOLUTION_SRC.replace(/^Test\(.*$/gm, '');
    const r = await adapter.runner(spec, { code: gutted.replace('static int CountVowels(string text) =>', 'static int CountVowels(string text) => 0; static int Unused(string text) =>') });
    expect(r.pass).toBe(false);
  });

  it('module-05 layout: the edited type lives in the tail; code-only submissions get the exercise tail', async () => {
    const TYPES_EX = [
      '#:project ../../_lib/Check/Check.csproj',
      'using static Bootcamp.Check;',
      '',
      '// ─── tests ───────────────────',
      'Test("doubles", () => Eq(new Box(2).Twice, 4));',
      'Test("doubles zero", () => Eq(new Box(0).Twice, 0));',
      'return Report();',
      '',
      '// ─── the code you edit ───────',
      'record Box(int W)',
      '{',
      '    public int Twice => throw new NotImplementedException("TODO");',
      '}',
      '',
    ].join('\n');
    const s = splitAtTestsMarker(TYPES_EX);
    const tspec = CheckSpec.parse({ type: 'drill-cs', shape: 'console-check', files: { tests: s.tests, tail: s.tail } });
    expect((await adapter.runner(tspec, { code: TYPES_EX })).pass).toBe(false);
    const solved = TYPES_EX.replace('throw new NotImplementedException("TODO")', 'W * 2');
    const r = await adapter.runner(tspec, { code: solved });
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
    // code-only (no tests marker) + the exercise's stub tail -> todo, not a pass
    expect((await adapter.runner(tspec, { code: 'using static Bootcamp.Check;\n' })).pass).toBe(false);
  });

  it('warm adapter runs stay under the gate (median of 5)', async () => {
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await adapter.runner(spec, { code: SOLUTION_SRC + `\n// w3a ${i}\n` });
      expect(r.pass).toBe(true);
      runs.push(r.durationMs);
    }
    timings.adapterWarm = { runs, median: median(runs) };
    expect(median(runs)).toBeLessThan(10_000);
  });
});
