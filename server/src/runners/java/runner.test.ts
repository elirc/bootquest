// Java runner gate. Real javac/java (JDK 17), real javabootcamp fixture, real timings.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CheckSpec } from '@bootquest/shared';
import { createDrillJavaRunner, javaExerciseFor } from '../../api/runner-java.ts';
import { createJavaRunner, failureFrom, jdkVersion, parseResultFile, type JavaExercise, type RunResult } from './index.ts';
import { composeGraded, JavabootcampFormatError, literalTestNames, splitAtTestsMarker } from './split.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FX = join(HERE, 'fixtures', 'javabootcamp', '01-language-core');
const EXERCISE_SRC = readFileSync(join(FX, 'exercises', '01-count-vowels.java'), 'utf8');
const SOLUTION_SRC = readFileSync(join(FX, 'solutions', '01-count-vowels.java'), 'utf8');
const STUB = 'throw new UnsupportedOperationException("TODO");';
const BODY = 'return (int) text.chars().filter(c -> "aeiouAEIOU".indexOf(c) >= 0).count();';

const APP = mkdtempSync(join(tmpdir(), 'bootquest-java-'));
const APP_ADAPTER = mkdtempSync(join(tmpdir(), 'bootquest-java-adapter-'));
const runner = createJavaRunner({ appDataDir: APP });
const adapter = createDrillJavaRunner({ appDataDir: APP_ADAPTER });

const timings: Record<string, unknown> = { machine: { node: process.version, jdk: jdkVersion() } };
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/** Live processes whose command line mentions `needle` (Windows CIM query). */
function processesMentioning(needle: string): string[] {
  if (process.platform !== 'win32') return [];
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

const ex: JavaExercise = { id: 'javabootcamp/01-language-core/01-count-vowels', exerciseSource: EXERCISE_SRC, timeoutMs: 10_000 };
/** the solution file with its method body replaced (the walkthrough comments stay) */
const withBody = (body: string) => {
  expect(SOLUTION_SRC).toContain(BODY);
  return SOLUTION_SRC.replace(BODY, body);
};
const brief = (r: RunResult) => ({ pass: r.pass, ms: r.durationMs, phases: r.phases, counts: r.counts });

beforeAll(() => {
  expect(processesMentioning(APP)).toEqual([]);
});

afterAll(async () => {
  await runner.shutdown();
  await adapter.shutdown();
  const leftovers = [...processesMentioning(APP), ...processesMentioning(APP_ADAPTER)];
  timings.leftoverProcessesAfterShutdown = leftovers;
  const out = join(tmpdir(), 'bootquest-java-timings.json');
  writeFileSync(out, JSON.stringify(timings, null, 2));
  console.log(`[java] timings → ${out}\n${JSON.stringify(timings, null, 2)}`);
  if (!process.env.BQ_KEEP_SCRATCH) {
    rmSync(APP, { recursive: true, force: true });
    rmSync(APP_ADAPTER, { recursive: true, force: true });
  }
  expect(leftovers).toEqual([]);
});

// ── pure format handling ──────────────────────────────────────────────────────

describe('javabootcamp split at the tests / end tests markers', () => {
  it('splits the real exercise into head / tests / tail', () => {
    const s = splitAtTestsMarker(EXERCISE_SRC);
    expect(s.head).toContain(STUB);
    expect(s.head).not.toContain('public static void main');
    expect(s.tests.split('\n')[0]).toMatch(/^ {4}\/\/ ─+ tests ─+$/);
    expect(s.tests).toContain('System.exit(report());');
    expect(s.tests.trimEnd().split('\n').pop()).toMatch(/^ {4}\/\/ ─+ end tests ─+$/);
    expect(s.tail).toBe('}\n');
    expect(s.head + s.tests + s.tail).toBe(EXERCISE_SRC.replace(/\r\n/g, '\n'));
  });

  it('the solution repeats the exercise tests byte-for-byte', () => {
    expect(splitAtTestsMarker(SOLUTION_SRC).tests).toBe(splitAtTestsMarker(EXERCISE_SRC).tests);
  });

  it('grades learner head+tail against the EXERCISE tests (learner-edited tests are discarded), line count kept', () => {
    const cheat = SOLUTION_SRC.replace(/test\("is case-insensitive"[^\n]*\n/, '');
    const g = composeGraded(cheat.replace(BODY, 'return 0;'), EXERCISE_SRC);
    expect(g).toContain('test("is case-insensitive"');
    expect(composeGraded(SOLUTION_SRC, EXERCISE_SRC).split('\n').length).toBe(SOLUTION_SRC.replace(/\r\n/g, '\n').split('\n').length);
  });

  it('a code-only submission (no markers) gets the exercise tests and its closing tail', () => {
    const g = composeGraded('import static bootcamp.Check.*;\nclass Exercise {\n  static int countVowels(String t) { return 0; }\n', EXERCISE_SRC);
    expect(g).toContain('// ─── tests');
    expect(g.trimEnd().endsWith('}')).toBe(true);
  });

  it('a file without the end-tests marker is a format error; CRLF and BOM are normalized', () => {
    expect(() => splitAtTestsMarker(EXERCISE_SRC.replace(/\/\/ ─+ end tests ─+/, '// gone'))).toThrow(JavabootcampFormatError);
    expect(splitAtTestsMarker('﻿' + EXERCISE_SRC.replace(/\n/g, '\r\n')).tests).toBe(splitAtTestsMarker(EXERCISE_SRC).tests);
  });

  it('literal test names (comments ignored, escapes decoded)', () => {
    expect(literalTestNames(splitAtTestsMarker(EXERCISE_SRC).tests)).toEqual([
      'counts lowercase vowels',
      'is case-insensitive',
      'handles the empty string',
      'counts nothing in a word with no vowels',
      'counts every vowel exactly once',
      'ignores digits and punctuation',
    ]);
    expect(literalTestNames('  // test("old", () -> {});\n  test("say \\"hi\\"", () -> ok(true));\n  test("n" + i, () -> {});\n')).toEqual(['say "hi"']);
  });
});

describe('result channel parsing', () => {
  const line = (nonce: string, payload: unknown) => `#bq-result ${nonce} ${Buffer.from(JSON.stringify(payload)).toString('base64')}\n`;
  const good = { passed: 1, failed: 1, todo: 0, tests: [{ name: 'a', status: 'pass' }, { name: 'b', status: 'fail', detail: 'values differ\n      expected: 2\n      received: 0' }] };

  it('accepts the right nonce; refuses a wrong nonce, extra lines, inconsistent counts', () => {
    expect(parseResultFile(line('n1', good), 'n1').ok).toBe(true);
    expect(parseResultFile(line('n2', good), 'n1')).toMatchObject({ ok: false, reason: expect.stringMatching(/nonce/) });
    expect(parseResultFile(line('n1', good) + line('n1', good), 'n1').ok).toBe(false);
    expect(parseResultFile(line('n1', { ...good, passed: 2 }), 'n1')).toMatchObject({ ok: false, reason: expect.stringMatching(/disagree/) });
    expect(parseResultFile('#done passed=6 failed=0 todo=0\n', 'n1').ok).toBe(false);
  });

  it('a failed test detail becomes message / expected / actual', () => {
    expect(failureFrom(good.tests[1] as never)).toEqual({ name: 'b', message: 'values differ', expected: '2', actual: '0' });
    expect(failureFrom({ name: 't', status: 'todo' })).toEqual({ name: 't', message: 'not implemented yet (todo)' });
  });
});

// ── the real runner ───────────────────────────────────────────────────────────

describe('real javabootcamp 01-count-vowels', () => {
  it('first-ever run (harness compile included): the SOLUTION passes; ✔ lines shown, no CR', async () => {
    const r = await runner.run(ex, { code: SOLUTION_SRC });
    timings.first = brief(r);
    expect(r.counts).toEqual({ passed: 6, failed: 0, todo: 0 });
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.output).toContain('  ✔ counts lowercase vowels\n');
    expect(r.output).toContain('#done passed=6 failed=0 todo=0');
    expect(r.output).not.toContain('\r');
    expect(r.output).not.toMatch(/Picked up/);
    // BqMain deleted the nonce before loading the exercise
    expect(runner.attemptFiles()).not.toContain('nonce');
  });

  it('the untouched STARTER fails (6 todo → not a pass) with structured failures', async () => {
    const r = await runner.run(ex, { code: EXERCISE_SRC });
    timings.starter = brief(r);
    expect(r.pass).toBe(false);
    expect(r.counts).toEqual({ passed: 0, failed: 0, todo: 6 });
    expect(r.failures).toHaveLength(6);
    expect(r.failures.every((f) => f.message === 'not implemented yet (todo)')).toBe(true);
    expect(r.crashed).toBeUndefined();
  });

  it('a wrong answer fails with name / message / expected / actual', async () => {
    const r = await runner.run(ex, { code: withBody('return (int) text.chars().filter(c -> "aeiou".indexOf(c) >= 0).count();') });
    expect(r.pass).toBe(false);
    expect(r.counts).toEqual({ passed: 4, failed: 2, todo: 0 });
    expect(r.failures.find((f) => f.name === 'is case-insensitive')).toEqual({ name: 'is case-insensitive', message: 'values differ', expected: '2', actual: '0' });
    expect(r.output).toContain('  ✘ is case-insensitive');
  });

  it('a syntax error returns the javac output verbatim', async () => {
    const r = await runner.run(ex, { code: withBody(BODY.replace(/;$/, '')) });
    timings.compileError = brief(r);
    expect(r.pass).toBe(false);
    expect(r.compileError).toBe(true);
    expect(r.failures[0]!.name).toBe('(compile)');
    expect(r.output).toMatch(/^Exercise\.java:\d+: error: ';' expected$/m);
    expect(r.output).toMatch(/1 error\s*$/);
    console.log('[java] verbatim compiler output:\n' + r.output);
  });

  it('an infinite loop is killed (process tree) and the NEXT grade works', async () => {
    const r = await runner.run({ ...ex, timeoutMs: 4_000 }, { code: withBody('while (true) { }') });
    timings.infiniteLoop = brief(r);
    expect(r.timedOut).toBe(true);
    expect(r.pass).toBe(false);
    expect(r.failures[0]!.name).toBe('(timeout)');
    expect(processesMentioning(APP)).toEqual([]);
    const again = await runner.run(ex, { code: SOLUTION_SRC });
    timings.afterKill = brief(again);
    expect(again.pass).toBe(true);
  });

  it('a forged `#done` on stdout followed by System.exit(0) is a crash, never a pass', async () => {
    const r = await runner.run(ex, { code: withBody('System.out.println("  #done passed=6 failed=0 todo=0"); System.exit(0); return 0;') });
    expect(r.output).toContain('#done passed=6 failed=0 todo=0');
    expect(r.pass).toBe(false);
    expect(r.crashed).toBe(true);
    expect(r.failures[0]).toMatchObject({ name: '(program)', message: expect.stringMatching(/without a result/) });
  });

  it('a forged result file (the learner cannot know the nonce: it was deleted) is rejected', async () => {
    const forge =
      'try { java.nio.file.Files.writeString(java.nio.file.Path.of(System.getProperty("bq.result.file")), "#bq-result guess " + java.util.Base64.getEncoder().encodeToString("{\\"passed\\":6,\\"failed\\":0,\\"todo\\":0,\\"tests\\":[]}".getBytes())); } catch (Exception e) { } System.exit(0); return 0;';
    const r = await runner.run(ex, { code: withBody(forge) });
    expect(r.pass).toBe(false);
    expect(r.crashed).toBe(true);
    expect(r.failures[0]!.message).toMatch(/nonce does not match|disagree/);
  });

  it('the nonce file is gone before learner code runs (reading it throws → a failed test)', async () => {
    const peek = 'try { return java.nio.file.Files.readString(java.nio.file.Path.of(System.getProperty("bq.nonce.file"))).length(); } catch (java.io.IOException e) { throw new IllegalStateException("no nonce: " + e.getClass().getSimpleName()); }';
    const r = await runner.run(ex, { code: withBody(peek) });
    expect(r.pass).toBe(false);
    expect(r.counts?.failed).toBe(6);
    expect(r.failures[0]!.message).toMatch(/no nonce: NoSuchFileException/);
  });

  it('an early System.exit(report()) from learner code (only 2 of 6 tests ran) is incomplete, never a pass', async () => {
    const early = 'if (text.isEmpty()) System.exit(report()); ' + BODY;
    const r = await runner.run(ex, { code: withBody(early) });
    expect(r.counts).toEqual({ passed: 2, failed: 0, todo: 0 });
    expect(r.pass).toBe(false);
    expect(r.failures.at(-1)).toMatchObject({ name: '(incomplete)', message: expect.stringMatching(/"handles the empty string"/) });
    // and a plain early System.exit(0) leaves no result at all
    const plain = await runner.run(ex, { code: withBody('if (text.isEmpty()) System.exit(0); ' + BODY) });
    expect(plain.pass).toBe(false);
    expect(plain.failures[0]!.name).toBe('(program)');
  });

  it('warm runs: median of 5 (each attempt a fresh edit → real recompile)', async () => {
    const runs: number[] = [];
    const phases: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await runner.run(ex, { code: SOLUTION_SRC + `// attempt ${i}\n` });
      expect(r.pass).toBe(true);
      runs.push(r.durationMs);
      phases.push(r.phases);
    }
    timings.warm = { runs, median: median(runs), phases };
    expect(median(runs)).toBeLessThan(10_000);
  });

  it('mutex: grades serialize; concurrent real grades do not trample each other', async () => {
    const order: string[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await Promise.all([
      runner.withLock(async () => {
        order.push('a:start');
        await sleep(300);
        order.push('a:end');
      }),
      runner.withLock(async () => {
        order.push('b:start');
        order.push('b:end');
      }),
    ]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    const [ok, bad] = await Promise.all([runner.run(ex, { code: SOLUTION_SRC }), runner.run(ex, { code: EXERCISE_SRC })]);
    expect(ok.pass).toBe(true);
    expect(bad.pass).toBe(false);
    expect(bad.counts?.todo).toBe(6);
  });
});

// ── the drill-java adapter ────────────────────────────────────────────────────

describe('drill-java adapter (createDrillJavaRunner) over the real runner', () => {
  const split = splitAtTestsMarker(EXERCISE_SRC);
  const spec = CheckSpec.parse({ type: 'drill-java', files: { tests: split.tests, tail: split.tail } });

  it('spec → exercise: tests + tail, className Exercise, timeout 10 s', () => {
    expect(javaExerciseFor(spec as Extract<CheckSpec, { type: 'drill-java' }>)).toEqual({
      id: 'drill-java',
      exerciseSource: split.tests + split.tail,
      className: 'Exercise',
      timeoutMs: 10_000,
    });
  });

  it('reference solution passes; untouched starter FAILS with structured todo failures; learner-deleted tests cannot pass', async () => {
    const ok = await adapter.runner(spec, { code: SOLUTION_SRC });
    expect(ok.pass).toBe(true);
    const starter = await adapter.runner(spec, { code: EXERCISE_SRC });
    expect(starter.pass).toBe(false);
    expect(starter.failures).toHaveLength(6);
    const gutted = EXERCISE_SRC.replace(/ {8}test\([^\n]*\n/g, '');
    const g = await adapter.runner(spec, { code: gutted });
    expect(g.pass).toBe(false);
  });

  it('a submission without `code` is a shape error', async () => {
    await expect(adapter.runner(spec, { answer: 'x' } as never)).rejects.toThrow(/take `code`/);
  });
});
