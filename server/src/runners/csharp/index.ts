// C# runner — canonical interface (spec §5):
//   run(exercise, submission) → { pass, output, failures[{name,message,expected?,actual?}], durationMs }
// Compiler errors come back VERBATIM in `output` with pass=false.
//
// console-check verdicts (Java parity, see ../java/index.ts and ../result-channel.ts):
// the graded program runs under BootQuest's launcher (BqLaunch.cs), which reads a fresh
// random nonce from a file and DELETES it before Exercise.dll is loaded, then records
// only the lines the Check harness itself prints (`✔ / ✘ / ☐`, `#done`) and on the
// harness's report writes `#bq-result <nonce> <base64 json>` to a result file. The
// verdict comes ONLY from that nonce-checked result; stdout is display and the exit
// code is never trusted. No result (crash, early Environment.Exit, timeout) is never
// a pass, nor is a result that misses a test the canonical tests block names
// literally (an early Report() from learner code). The scratch project is re-verified
// before every grade (scratch.ts), so no attempt can tamper with a later one.
//
// xunit verdicts come from the TRX that `dotnet vstest` (not learner code) writes;
// every [Fact]/[Theory] method of the canonical tests must appear in it.

import { composeGraded, composeGradedJstrain, literalTestNames, splitAtTestsMarker, splitJstrainCs } from './csbootcamp-split.js';
import { ScratchManager, type AttemptRaw, type Shape, type XunitEngine } from './scratch.js';
import { failureFrom, missingTests, parseResultFile } from '../result-channel.ts';

export interface Failure {
  name: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface RunResult {
  pass: boolean;
  output: string;
  failures: Failure[];
  durationMs: number;
  /** extra detail for callers that want it (verdict JSON: todo ≠ fail) */
  counts?: { passed: number; failed: number; todo: number };
  compileError?: boolean;
  timedOut?: boolean;
  /** the program ended without a valid, nonce-checked, complete result (crash / early exit / forgery) */
  crashed?: boolean;
  phases?: { compileMs: number; runMs: number };
}

export type CsExercise =
  | {
      id: string;
      shape: 'console-check';
      /** csbootcamp exercise file (the canonical tests are taken from it) */
      exerciseSource: string;
      /** W3c: file protocol — 'csbootcamp' (tests end at `return Report();`, default) or 'jstrain' (tests end at the next divider) */
      format?: 'csbootcamp' | 'jstrain';
      timeoutMs?: number;
    }
  | {
      id: string;
      shape: 'xunit';
      /** test class source, compiled next to the learner's Solution.cs */
      tests: string;
      timeoutMs?: number;
    };

export interface Submission {
  code: string;
}

export interface CsharpRunnerOptions {
  appDataDir: string;
  checkHarnessPath?: string;
  /** W3c: several harness files compiled together into Check.dll (jstrain revision: Check.cs + Spy.cs) */
  checkHarnessPaths?: readonly string[];
  xunitEngine?: XunitEngine;
}

const DEFAULT_TIMEOUT: Record<Shape, number> = { 'console-check': 10_000, xunit: 30_000 };

export function createCsharpRunner(opts: CsharpRunnerOptions) {
  const scratch = new ScratchManager(opts);

  async function run(exercise: CsExercise, submission: Submission): Promise<RunResult> {
    const started = Date.now();
    return scratch.withShape(exercise.shape, async () => {
      await scratch.prepare(exercise.shape);
      const timeoutMs = exercise.timeoutMs ?? DEFAULT_TIMEOUT[exercise.shape];
      let raw: AttemptRaw;
      let result: RunResult;
      if (exercise.shape === 'console-check') {
        let program: string;
        let required: string[];
        try {
          const jstrain = exercise.format === 'jstrain';
          program = jstrain ? composeGradedJstrain(submission.code, exercise.exerciseSource) : composeGraded(submission.code, exercise.exerciseSource);
          required = literalTestNames((jstrain ? splitJstrainCs(exercise.exerciseSource) : splitAtTestsMarker(exercise.exerciseSource)).tests);
        } catch (e) {
          const msg = (e as Error).message;
          return { pass: false, output: msg, failures: [{ name: '(format)', message: msg }], durationMs: Date.now() - started };
        }
        raw = await scratch.attemptConsole(program, timeoutMs);
        result = fromCheck(raw, timeoutMs, required);
      } else {
        raw = await scratch.attemptXunit(submission.code, exercise.tests, timeoutMs);
        result = fromXunit(raw, timeoutMs, xunitTestMethods(exercise.tests));
      }
      result.durationMs = Date.now() - started;
      return result;
    });
  }

  return {
    run,
    scratch,
    prepare: (shape: Shape) => scratch.withShape(shape, () => scratch.prepare(shape)),
    shutdown: () => scratch.shutdown(),
  };
}

function compileFailure(raw: AttemptRaw): RunResult {
  return {
    pass: false,
    output: raw.compile.output,
    failures: [{ name: '(compile)', message: 'compilation failed — see output' }],
    durationMs: raw.totalMs,
    compileError: true,
    phases: { compileMs: raw.compile.ms, runMs: 0 },
  };
}

function timeoutFailure(raw: AttemptRaw, timeoutMs: number): RunResult {
  return {
    pass: false,
    output: (raw.run?.output ?? '') + `\n[killed: exceeded ${timeoutMs} ms — process tree terminated]`,
    failures: [{ name: '(timeout)', message: `exceeded ${timeoutMs} ms; process tree killed` }],
    durationMs: raw.totalMs,
    timedOut: true,
    phases: { compileMs: raw.compile.ms, runMs: raw.run?.ms ?? 0 },
  };
}

// ── console-check: the nonce-checked result channel ──────────────────────────────

function fromCheck(raw: AttemptRaw, timeoutMs: number, required: readonly string[]): RunResult {
  if (!raw.compile.ok) return compileFailure(raw);
  const run = raw.run!;
  if (run.timedOut) return timeoutFailure(raw, timeoutMs);
  const phases = { compileMs: raw.compile.ms, runMs: run.ms };
  const output = run.output;
  const crash = (message: string): RunResult => ({
    pass: false,
    output,
    failures: [{ name: '(program)', message }],
    durationMs: raw.totalMs,
    crashed: true,
    phases,
  });
  const channel = raw.channel!;
  if (channel.nonceLeft) return crash(`the program never reached the BootQuest launcher (exit code ${run.code}); not graded`);
  if (channel.result === undefined) {
    return crash(`ended without a result from the harness report: crashed or exited early (exit code ${run.code}); never a pass`);
  }
  const parsed = parseResultFile(channel.result, channel.nonce);
  if (!parsed.ok) return crash(parsed.reason);
  const { payload } = parsed;
  const failures: Failure[] = payload.tests.filter((t) => t.status !== 'pass').map(failureFrom);
  const counts = { passed: payload.passed, failed: payload.failed, todo: payload.todo };
  const missing = missingTests(payload, required);
  if (missing.length) {
    failures.push({ name: '(incomplete)', message: `the harness reported before every test ran; never ran: ${missing.map((n) => `"${n}"`).join(', ')}` });
    return { pass: false, output, failures, durationMs: raw.totalMs, counts, crashed: true, phases };
  }
  const pass = counts.passed > 0 && counts.failed === 0 && counts.todo === 0;
  return { pass, output, failures, durationMs: raw.totalMs, counts, phases };
}

// ── xunit TRX ──────────────────────────────────────────────────────────────────

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function parseTrx(trx: string): { failures: Failure[]; counts: { passed: number; failed: number; todo: number }; names: string[] } {
  const failures: Failure[] = [];
  const names: string[] = [];
  let passed = 0;
  let failed = 0;
  let todo = 0;
  const re = /<UnitTestResult\b([^>]*?)(\/>|>([\s\S]*?)<\/UnitTestResult>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trx))) {
    const attrs = m[1]!;
    const name = decodeXml(/\btestName="([^"]*)"/.exec(attrs)?.[1] ?? '?');
    names.push(name);
    const outcome = /\boutcome="([^"]*)"/.exec(attrs)?.[1] ?? '';
    if (outcome === 'Passed') {
      passed++;
      continue;
    }
    if (outcome === 'NotExecuted') {
      todo++;
      failures.push({ name, message: 'skipped / not executed' });
      continue;
    }
    failed++;
    const body = m[3] ?? '';
    const message = decodeXml(/<Message>([\s\S]*?)<\/Message>/.exec(body)?.[1] ?? outcome).replace(/\r\n/g, '\n');
    const f: Failure = { name, message };
    const e = /^Expected:\s*(.*)$/m.exec(message);
    const a = /^Actual:\s*(.*)$/m.exec(message);
    if (e) f.expected = e[1]!.trim();
    if (a) f.actual = a[1]!.trim();
    failures.push(f);
  }
  return { failures, counts: { passed, failed, todo }, names };
}

/**
 * Test names of an xunit tests source: every method carrying [Fact] / [Theory] — its
 * literal `DisplayName = "…"` when it has one (that replaces the method name in the
 * TRX), else the method name. Each must show up in the TRX: a test host that died
 * early (Environment.Exit in learner code) is an incomplete run, never a pass. A
 * DisplayName that is not a plain literal is not required.
 */
export function xunitTestMethods(tests: string): string[] {
  const out: string[] = [];
  const code = tests.replace(/\r\n/g, '\n').replace(/^\s*\/\/.*$/gm, '');
  const re = /\[\s*(?:Xunit\.)?(?:Fact|Theory)\b((?:[^\]\n"]|"(?:[^"\\\n]|\\.)*")*)\]((?:\s*\[[^\]\n]*\])*)\s*(?:(?:public|internal|protected|private|static|async|virtual|override|unsafe)\s+)*[\w.<>?,[\]]+\s+(\w+)\s*\(/g;
  for (const m of code.matchAll(re)) {
    const args = m[1] ?? '';
    if (/\bDisplayName\b/.test(args)) {
      const d = /\bDisplayName\s*=\s*"((?:[^"\\\n]|\\.)*)"\s*[,)]/.exec(args);
      if (d) out.push(unescapeCsLiteral(d[1]!));
      continue;
    }
    out.push(m[3]!);
  }
  return [...new Set(out)];
}

function unescapeCsLiteral(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e: string) =>
    e[0] === 'u' ? String.fromCharCode(parseInt(e.slice(1), 16)) : (({ n: '\n', t: '\t', r: '\r', 0: '\0' } as Record<string, string>)[e] ?? e),
  );
}

function fromXunit(raw: AttemptRaw, timeoutMs: number, required: readonly string[]): RunResult {
  if (!raw.compile.ok) return compileFailure(raw);
  const run = raw.run!;
  if (run.timedOut) return timeoutFailure(raw, timeoutMs);
  if (!raw.trx) {
    return {
      pass: false,
      output: run.output,
      failures: [{ name: '(runner)', message: `test run produced no results (exit code ${run.code})` }],
      durationMs: raw.totalMs,
      phases: { compileMs: raw.compile.ms, runMs: run.ms },
    };
  }
  const { failures, counts, names } = parseTrx(raw.trx);
  // a method name shows up as `Class.Method` / `Ns.Class.Method(args)`; a DisplayName as itself / `Name(args)`
  const ran = (test: string) => names.some((n) => n === test || n.endsWith(`.${test}`) || n.includes(`.${test}(`) || n.startsWith(`${test}(`));
  const missing = required.filter((m) => !ran(m));
  if (missing.length) {
    failures.push({ name: '(incomplete)', message: `the test run ended before every test ran; never ran: ${missing.map((n) => `"${n}"`).join(', ')}` });
    return { pass: false, output: run.output, failures, durationMs: raw.totalMs, counts, crashed: true, phases: { compileMs: raw.compile.ms, runMs: run.ms } };
  }
  return {
    pass: run.code === 0 && counts.passed > 0 && counts.failed === 0 && counts.todo === 0,
    output: run.output,
    failures,
    durationMs: raw.totalMs,
    counts,
    phases: { compileMs: raw.compile.ms, runMs: run.ms },
  };
}

export type { Shape, XunitEngine } from './scratch.js';
