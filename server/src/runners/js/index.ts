// BootQuest JS/TS runner: thin adapter over BootForge's grade-core.mjs (spec section 5).
// Maps gradeCode's {pass, results[], stdout, stderr} onto the canonical runner interface.
import { gradeCode, type GradeTest, type GradeResult } from './grade-core.mjs';

export type { GradeTest, GradeResult } from './grade-core.mjs';

export type JsLanguage = 'js' | 'ts';

/** A JS/TS code exercise as the runner sees it (tests are server-side only, never sent to clients). */
export interface JsExercise {
  id?: string;
  language: JsLanguage;
  /** Tests in grade-core's JSON format: {name, code, input?}[]. */
  tests: GradeTest[];
}

export interface Submission {
  /** Learner source (JS or TS, per exercise.language). */
  code: string;
}

export interface RunFailure {
  name: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
  /** Author-supplied case input, util.inspect-formatted by the grader. */
  input?: unknown;
}

export interface RunResult {
  pass: boolean;
  /** Learner stdout (console.log). */
  output: string;
  failures: RunFailure[];
  durationMs: number;
}

function toFailure(r: GradeResult): RunFailure {
  const f: RunFailure = { name: r.name, message: r.message ?? '' };
  if (r.expected !== undefined) f.expected = r.expected;
  if (r.actual !== undefined) f.actual = r.actual;
  if (r.input !== undefined) f.input = r.input;
  return f;
}

export async function run(exercise: JsExercise, submission: Submission): Promise<RunResult> {
  const started = performance.now();
  const outcome = await gradeCode(submission.code, exercise.language, exercise.tests);
  const durationMs = Math.round(performance.now() - started);
  return {
    pass: outcome.pass,
    output: outcome.stdout ?? '',
    failures: outcome.results.filter((r) => !r.pass).map(toFailure),
    durationMs,
  };
}

export const jsRunner = { run };
