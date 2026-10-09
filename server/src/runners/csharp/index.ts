// C# runner — canonical interface (spec §5):
//   run(exercise, submission) → { pass, output, failures[{name,message,expected?,actual?}], durationMs }
// Compiler errors come back VERBATIM in `output` with pass=false.

import { composeGraded, composeGradedJstrain } from './csbootcamp-split.js';
import { ScratchManager, type AttemptRaw, type Shape, type XunitEngine } from './scratch.js';

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
      if (exercise.shape === 'console-check') {
        let program: string;
        try {
          program = exercise.format === 'jstrain' ? composeGradedJstrain(submission.code, exercise.exerciseSource) : composeGraded(submission.code, exercise.exerciseSource);
        } catch (e) {
          const msg = (e as Error).message;
          return { pass: false, output: msg, failures: [{ name: '(format)', message: msg }], durationMs: Date.now() - started };
        }
        raw = await scratch.attemptConsole(program, timeoutMs);
      } else {
        raw = await scratch.attemptXunit(submission.code, exercise.tests, timeoutMs);
      }
      const result = exercise.shape === 'console-check' ? fromCheck(raw, timeoutMs) : fromXunit(raw, timeoutMs);
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

// ── csbootcamp Check output ────────────────────────────────────────────────────

export function parseCheckOutput(output: string): { failures: Failure[]; counts?: RunResult['counts']; passedNames: string[] } {
  const lines = output.replace(/\r\n/g, '\n').split('\n');
  const failures: Failure[] = [];
  const passedNames: string[] = [];
  let counts: RunResult['counts'];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let m: RegExpExecArray | null;
    if ((m = /^\s*#done passed=(\d+) failed=(\d+) todo=(\d+)/.exec(line))) {
      counts = { passed: +m[1]!, failed: +m[2]!, todo: +m[3]! };
    } else if ((m = /^ {2}✔ (.+)$/.exec(line))) {
      passedNames.push(m[1]!);
    } else if ((m = /^ {2}☐ (.+?)(?: ·)? todo$/.exec(line))) {
      // github csbootcamp prints `☐ name todo`, jstrain2.2's revision `☐ name · todo`
      failures.push({ name: m[1]!, message: 'not implemented yet (todo)' });
    } else if ((m = /^ {2}✘ (.+)$/.exec(line))) {
      const detail: string[] = [];
      while (i + 1 < lines.length && /^ {6}/.test(lines[i + 1]!)) detail.push(lines[++i]!.trim());
      const f: Failure = { name: m[1]!, message: detail.filter((d) => !/^(expected|received):/.test(d)).join('\n') || 'failed' };
      for (const d of detail) {
        const e = /^expected: (.*)$/.exec(d);
        const a = /^received: (.*)$/.exec(d);
        if (e) f.expected = e[1];
        if (a) f.actual = a[1];
      }
      failures.push(f);
    }
  }
  return { failures, counts, passedNames };
}

function fromCheck(raw: AttemptRaw, timeoutMs: number): RunResult {
  if (!raw.compile.ok) return compileFailure(raw);
  const run = raw.run!;
  if (run.timedOut) return timeoutFailure(raw, timeoutMs);
  const { failures, counts } = parseCheckOutput(run.output);
  if (!counts) {
    failures.push({ name: '(program)', message: `crashed before Report(): exit code ${run.code}, no #done marker` });
  }
  const pass = !!counts && run.code === 0 && counts.passed > 0 && counts.failed === 0 && counts.todo === 0;
  return {
    pass,
    output: run.output,
    failures,
    durationMs: raw.totalMs,
    counts,
    phases: { compileMs: raw.compile.ms, runMs: run.ms },
  };
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

export function parseTrx(trx: string): { failures: Failure[]; counts: { passed: number; failed: number; todo: number } } {
  const failures: Failure[] = [];
  let passed = 0;
  let failed = 0;
  let todo = 0;
  const re = /<UnitTestResult\b([^>]*?)(\/>|>([\s\S]*?)<\/UnitTestResult>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trx))) {
    const attrs = m[1]!;
    const name = decodeXml(/\btestName="([^"]*)"/.exec(attrs)?.[1] ?? '?');
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
  return { failures, counts: { passed, failed, todo } };
}

function fromXunit(raw: AttemptRaw, timeoutMs: number): RunResult {
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
  const { failures, counts } = parseTrx(raw.trx);
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
