// C# runner gate (W3a spike). Real dotnet, real csbootcamp fixture, real timings.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeGraded, CsbootcampFormatError, literalTestNames, rewriteDirectives, splitAtTestsMarker } from './csbootcamp-split.js';
import { createCsharpRunner, xunitTestMethods, type CsExercise, type RunResult } from './index.js';
import { livePids } from './scratch.js';
import { createDrillCsRunner, JSTRAIN_CS_HARNESS } from '../../api/runner-csharp.ts';
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

// ── console-check verdict integrity (Java parity: nonce channel, required names, per-grade scratch) ──

describe('console-check verdict integrity: the verdict comes only from the nonce-checked harness report', () => {
  const SOLVED = /static int CountVowels\(string text\) =>\r?\n\s*text\.Count\(c => "aeiouAEIOU"\.Contains\(c\)\);/;
  /** the solution file with CountVowels' body replaced (tests block unchanged) */
  const withBody = (body: string) => {
    expect(SOLUTION_SRC).toMatch(SOLVED);
    return SOLUTION_SRC.replace(SOLVED, `static int CountVowels(string text) { ${body} }`);
  };
  const COUNT = 'return text.Count(c => "aeiouAEIOU".Contains(c));';
  const NAMES = ['counts lowercase vowels', 'is case-insensitive', 'handles the empty string', 'counts nothing in a word with no vowels', 'counts every vowel exactly once', 'ignores digits and punctuation'];
  const csDir = () => runner.scratch.dir('console-check');

  it('the canonical tests name six literal tests (the required set)', () => {
    expect(literalTestNames(splitAtTestsMarker(EXERCISE_SRC).tests)).toEqual(NAMES);
    expect(literalTestNames('// Test("old", () => {});\nTest("say \\"hi\\"\\u0021", () => Ok(true));\nTest($"n{i}", () => {});\nTest(@"raw", () => {});\nx.Test("not the harness", 1);\n')).toEqual(['say "hi"!']);
  });

  it('ATTACK (a): a forged `#done` (and forged ✔ lines) on stdout + Environment.Exit(0) inside the solved method is a crash, never a pass', async () => {
    const forge = `foreach (var n in new[] { ${NAMES.map((n) => JSON.stringify(n)).join(', ')} }) Console.WriteLine("  ✔ " + n); Console.WriteLine("  #done passed=6 failed=0 todo=0"); Environment.Exit(0); return 0;`;
    const r = await runner.run(consoleEx, { code: withBody(forge) });
    expect(r.output).toContain('#done passed=6 failed=0 todo=0'); // the learner's line is displayed ...
    expect(r.pass).toBe(false); // ... and never believed
    expect(r.crashed).toBe(true);
    expect(r.failures[0]).toMatchObject({ name: '(program)', message: expect.stringMatching(/without a result/) });
    // through the drill-cs adapter (what POST /submit and seed:validate call) too
    const spec = CheckSpec.parse({ type: 'drill-cs', shape: 'console-check', files: { tests: splitAtTestsMarker(EXERCISE_SRC).tests, tail: '' } });
    const a = await adapter.runner(spec, { code: withBody(forge) });
    expect(a.pass).toBe(false);
    expect(a.failures.map((f) => f.name)).toEqual(['(program)']);
  });

  it('an early Report() + Environment.Exit(0) from learner code (2 of 6 tests ran) is incomplete, never a pass', async () => {
    const r = await runner.run(consoleEx, { code: withBody(`if (text.Length == 0) { Report(); Environment.Exit(0); } ${COUNT}`) });
    expect(r.counts).toEqual({ passed: 2, failed: 0, todo: 0 });
    expect(r.pass).toBe(false);
    expect(r.crashed).toBe(true);
    expect(r.failures.at(-1)).toMatchObject({ name: '(incomplete)', message: expect.stringMatching(/"handles the empty string"/) });
  });

  it('a forged result file (the learner cannot know the nonce: it was deleted) is rejected', async () => {
    const forge =
      'var a = Environment.GetCommandLineArgs(); File.WriteAllText(a[2], "#bq-result guess " + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("{\\"passed\\":6,\\"failed\\":0,\\"todo\\":0,\\"tests\\":[]}"))); Environment.Exit(0); return 0;';
    const r = await runner.run(consoleEx, { code: withBody(forge) });
    expect(r.pass).toBe(false);
    expect(r.crashed).toBe(true);
    expect(r.failures[0]!.message).toMatch(/nonce does not match/);
  });

  it('the nonce file is gone before learner code runs (reading it throws → failed tests)', async () => {
    const r = await runner.run(consoleEx, { code: withBody('try { return File.ReadAllText(Environment.GetCommandLineArgs()[1]).Length; } catch (IOException e) { throw new InvalidOperationException("no nonce: " + e.GetType().Name); }') });
    expect(r.pass).toBe(false);
    expect(r.counts?.failed).toBe(6);
    expect(r.failures[0]!.message).toMatch(/no nonce: FileNotFoundException/);
  });

  it('ATTACK (b) PERSISTENT: a submission that plants a [ModuleInitializer] in src/_globals.cs and files in bin/ cannot touch the next grade', async () => {
    const plant = [
      'var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));',
      'File.AppendAllText(Path.Combine(root, "src", "_globals.cs"), "\\nnamespace Evil { internal static class Pwn { [System.Runtime.CompilerServices.ModuleInitializer] internal static void Init() { System.Console.WriteLine(\\"  #done passed=1 failed=0 todo=0\\"); System.Environment.Exit(0); } } }\\n");',
      'File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "planted.dll"), "junk");',
      'File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "BqLaunch.runtimeconfig.json"), "{}");',
      COUNT,
    ].join(' ');
    const r = await runner.run(consoleEx, { code: withBody(plant) });
    expect(r.pass).toBe(true); // the planting grade itself still grades honestly
    // the writes really happened
    expect(readFileSync(join(csDir(), 'src', '_globals.cs'), 'utf8')).toContain('namespace Evil');
    expect(existsSync(join(csDir(), 'bin', 'planted.dll'))).toBe(true);
    // the next grade (the untouched starter) is graded by the prepared scaffolding, not the planted one
    const next = await runner.run(consoleEx, { code: EXERCISE_SRC });
    expect(next.pass).toBe(false);
    expect(next.counts).toEqual({ passed: 0, failed: 0, todo: 6 });
    expect(next.output).not.toContain('#done passed=1');
    expect(readFileSync(join(csDir(), 'src', '_globals.cs'), 'utf8')).not.toContain('Evil');
    expect(existsSync(join(csDir(), 'bin', 'planted.dll'))).toBe(false);
    expect(readFileSync(join(csDir(), 'bin', 'BqLaunch.runtimeconfig.json'), 'utf8')).toContain('Microsoft.NETCore.App');
  });

  it('an overwritten Check.dll (written between grades) is detected and the harness re-prepared', async () => {
    writeFileSync(join(csDir(), 'bin', 'Check.dll'), 'junk');
    const r = await runner.run(consoleEx, { code: SOLUTION_SRC });
    timings.consoleAfterHarnessTamper = brief(r);
    expect(r.pass).toBe(true);
    expect(readFileSync(join(csDir(), 'bin', 'Check.dll')).subarray(0, 2).toString()).toBe('MZ');
  });

  it('every grade runs in a fresh attempt dir; the nonce file never survives a launch', async () => {
    const r = await runner.run(consoleEx, { code: withBody('Console.WriteLine("cwd=" + Environment.CurrentDirectory); ' + COUNT) });
    expect(r.pass).toBe(true);
    const cwd = /cwd=(.+)/.exec(r.output)![1]!.trim();
    expect(cwd.replace(/\\/g, '/')).toMatch(/\/console-check\/attempts\/[0-9a-f]{12}$/);
    expect(existsSync(join(cwd, 'nonce'))).toBe(false);
    expect(readFileSync(join(cwd, 'result'), 'utf8')).toMatch(/^#bq-result \S+ [A-Za-z0-9+/=]+\n$/);
  });
});

// ── the jstrain2.2 harness revision (report at ProcessExit, no `return Report();`) ──

describe('console-check, jstrain harness revision: same channel, report at ProcessExit', () => {
  const APP_JS = mkdtempSync(join(tmpdir(), 'bootquest-p2-jstrain-'));
  const jsRunner = createCsharpRunner({ appDataDir: APP_JS, checkHarnessPaths: JSTRAIN_CS_HARNESS });
  const EX = [
    'using static Bootcamp.Check;',
    '',
    'static int Twice(int x) => throw new NotImplementedException();',
    '',
    '// ─── tests ───────────────────────',
    'Test("doubles two", () => Eq(Twice(2), 4));',
    'Test("doubles zero", () => Eq(Twice(0), 0));',
    'Test("doubles negatives", () => Eq(Twice(-3), -6));',
    '',
    '// ─── types ───────────────────────',
    'public record Unused(int X);',
    '',
  ].join('\n');
  const ex: CsExercise = { id: 'probe/jstrain-twice', shape: 'console-check', format: 'jstrain', exerciseSource: EX, timeoutMs: 10_000 };
  const solve = (body: string) => EX.replace('static int Twice(int x) => throw new NotImplementedException();', `static int Twice(int x) { ${body} }`);

  afterAll(async () => {
    await jsRunner.shutdown();
    if (!process.env.BQ_KEEP_SCRATCH) rmSync(APP_JS, { recursive: true, force: true });
  });

  it('solution passes; starter is 3 todo; a wrong answer fails with expected/actual', async () => {
    const ok = await jsRunner.run(ex, { code: solve('return x * 2;') });
    timings.jstrainFirst = brief(ok);
    expect(ok.counts).toEqual({ passed: 3, failed: 0, todo: 0 });
    expect(ok.pass).toBe(true);
    const starter = await jsRunner.run(ex, { code: EX });
    expect(starter.pass).toBe(false);
    expect(starter.counts).toEqual({ passed: 0, failed: 0, todo: 3 });
    expect(starter.failures.every((f) => f.message === 'not implemented yet (todo)')).toBe(true);
    const wrong = await jsRunner.run(ex, { code: solve('return x + 2;') });
    expect(wrong.pass).toBe(false);
    expect(wrong.failures.find((f) => f.name === 'doubles zero')).toEqual({ name: 'doubles zero', message: 'values differ', expected: '0', actual: '2' });
  });

  it('ATTACK (a): stdout `#done` + Environment.Exit(0) → the harness ProcessExit report is incomplete, never a pass', async () => {
    const r = await jsRunner.run(ex, { code: solve('Console.WriteLine("  #done passed=3 failed=0 todo=0"); Environment.Exit(0); return 0;') });
    expect(r.pass).toBe(false);
    expect(r.counts).toEqual({ passed: 0, failed: 0, todo: 0 });
    expect(r.failures.at(-1)).toMatchObject({ name: '(incomplete)', message: expect.stringMatching(/"doubles two"/) });
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

  it('required tests: every [Fact]/[Theory] method; a test host killed by learner code mid-run is never a pass', async () => {
    expect(xunitTestMethods(XUNIT_TESTS)).toEqual(['AddsSmallNumbers', 'AddsNegatives', 'AddsTable']);
    expect(xunitTestMethods('[Fact(DisplayName = "x [1] \\"q\\"")] public void Named() {}\n[Fact]\n[Trait("k", "v")]\npublic async Task Later() {}\n[Fact(DisplayName = Names.Y)] public void Computed() {}\n')).toEqual(['x [1] "q"', 'Later']);
    const r = await runner.run(xunitEx, { code: 'public static class Calc { public static int Add(int a, int b) { if (b == 2 || b == -2) System.Environment.Exit(0); return a + b; } }\n' });
    expect(r.pass).toBe(false);
  });

  it('a planted [ModuleInitializer] in src/_globals.cs or a file planted in bin/ cannot touch the next xunit grade', async () => {
    const dir = runner.scratch.dir('xunit');
    const plant =
      'public static class Calc { public static int Add(int a, int b) { var root = System.IO.Path.GetFullPath(System.IO.Path.Combine(System.AppContext.BaseDirectory, "..")); ' +
      'System.IO.File.AppendAllText(System.IO.Path.Combine(root, "src", "_globals.cs"), "\\nnamespace Evil { internal static class Pwn { [System.Runtime.CompilerServices.ModuleInitializer] internal static void Init() { } } }\\n"); ' +
      'System.IO.File.WriteAllText(System.IO.Path.Combine(System.AppContext.BaseDirectory, "planted.dll"), "junk"); return a + b; } }\n';
    const r = await runner.run(xunitEx, { code: plant });
    expect(r.pass).toBe(true);
    expect(readFileSync(join(dir, 'src', '_globals.cs'), 'utf8')).toContain('namespace Evil');
    const next = await runner.run(xunitEx, { code: XUNIT_SOLUTION });
    expect(next.pass).toBe(true);
    expect(readFileSync(join(dir, 'src', '_globals.cs'), 'utf8')).not.toContain('Evil');
    expect(existsSync(join(dir, 'bin', 'planted.dll'))).toBe(false);
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
