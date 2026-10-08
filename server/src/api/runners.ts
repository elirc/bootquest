import type { CheckSpec, CheckType } from '@bootquest/shared';
import type { CanonicalRunResult } from '@bootquest/shared/api';
import { run as runJs } from '../runners/js/index.ts';
import { normalizeOutput } from '../runners/js/grade-core.mjs';
import { runHttpCheck } from '../runners/http/index.ts';
import { RepoPathError, runRepoCheck, type GhExec } from '../runners/repo/index.ts';

/**
 * What the learner sent: `code` for code checks, `answer` for quiz /
 * predict-output, `port` for http checks, `repoPath` for repo checks.
 */
export interface LearnerSubmission {
  code?: string;
  answer?: string | number;
  port?: number;
  repoPath?: string;
}

/**
 * A code runner for one check type. Returns the canonical runner result
 * {pass, output, failures[], durationMs} (BUILD-PLAN).
 */
export type Runner = (spec: CheckSpec, submission: LearnerSubmission) => Promise<CanonicalRunResult>;

/** Runner registry keyed by check type (Java / C# slot in later without API changes). */
export type RunnerRegistry = Partial<Record<CheckType, Runner>>;

export class UnsupportedCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedCheckError';
  }
}

export class SubmissionShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmissionShapeError';
  }
}

/**
 * The grader language for a drill-js spec. SQL drills (W2 decision) are
 * BootForge-style: the learner submits a JS module exporting SQL strings
 * (`export const query = '...'`) and the tests open an in-memory node:sqlite
 * DB (spec §5), so they grade exactly like a JS drill.
 */
export function graderLanguage(language: 'js' | 'ts' | 'sql'): 'js' | 'ts' {
  return language === 'sql' ? 'js' : language;
}

/** drill-js via the P1 adapter (BootForge grade-core); js, ts and sql (JS module + node:sqlite tests). */
export const drillJsRunner: Runner = async (spec, submission) => {
  if (spec.type !== 'drill-js') throw new UnsupportedCheckError(`drill-js runner got ${spec.type}`);
  if (submission.code === undefined) throw new SubmissionShapeError('drill-js checks take `code`');
  const r = await runJs({ language: graderLanguage(spec.language), tests: spec.tests }, { code: submission.code });
  return {
    pass: r.pass,
    output: r.output,
    // the adapter's extra `input` field is not part of the canonical shape
    failures: r.failures.map((f) => {
      const out: CanonicalRunResult['failures'][number] = { name: f.name, message: f.message };
      if (f.expected !== undefined) out.expected = f.expected;
      if (f.actual !== undefined) out.actual = f.actual;
      return out;
    }),
    durationMs: r.durationMs,
  };
};

/**
 * http checks (W3c): the learner sends only `port`; the runner targets the
 * loopback interface by construction (server/src/runners/http).
 */
export const httpRunner: Runner = async (spec, submission) => {
  if (spec.type !== 'http') throw new UnsupportedCheckError(`http runner got ${spec.type}`);
  if (submission.port === undefined) {
    throw new SubmissionShapeError('http checks take `port`: the local port your server listens on (e.g. {"port": 3000})');
  }
  return runHttpCheck(spec, submission.port);
};

/**
 * repo checks (W3c): the learner sends only `repoPath` (absolute path of a
 * local working tree). A path that is not a usable repo root is a request
 * error (400, nothing recorded), not a failed attempt.
 */
export function createRepoRunner(opts: { gh?: GhExec } = {}): Runner {
  return async (spec, submission) => {
    if (spec.type !== 'repo') throw new UnsupportedCheckError(`repo runner got ${spec.type}`);
    if (submission.repoPath === undefined) {
      throw new SubmissionShapeError('repo checks take `repoPath`: the absolute path of your local git working tree');
    }
    try {
      return await runRepoCheck(spec, submission.repoPath, opts.gh ? { gh: opts.gh } : {});
    } catch (err) {
      if (err instanceof RepoPathError) throw new SubmissionShapeError(err.message);
      throw err;
    }
  };
}

/**
 * The registry: drill-js, http and repo always; drill-cs when the caller
 * supplies the C# runner (it owns a scratch dir + a compiler server, so its
 * lifecycle belongs to whoever starts the server — see serve.ts /
 * runner-csharp.ts). `gh` overrides the gh CLI executor of the repo runner's
 * remote predicates (tests).
 */
export function defaultRunners(opts: { drillCs?: Runner; gh?: GhExec } = {}): RunnerRegistry {
  return {
    'drill-js': drillJsRunner,
    http: httpRunner,
    repo: createRepoRunner(opts.gh ? { gh: opts.gh } : {}),
    ...(opts.drillCs ? { 'drill-cs': opts.drillCs } : {}),
  };
}

/**
 * Deterministic graders for quiz and predict-output (no process, no clock).
 * Failures never echo the key or the expected output — run is free and
 * unlimited, so echoing them would hand out the answer.
 */
export function gradeDeterministic(spec: CheckSpec, submission: LearnerSubmission): CanonicalRunResult | null {
  if (spec.type === 'quiz') {
    if (spec.grading === 'self') throw new UnsupportedCheckError('self-graded quiz items are not auto-gradable');
    if (submission.answer === undefined) throw new SubmissionShapeError('quiz checks take `answer`');
    let pass: boolean;
    if (spec.grading === 'choice') {
      pass = typeof submission.answer === 'number' && submission.answer === spec.answerKey;
    } else {
      pass = typeof submission.answer === 'string' && submission.answer.trim() === String(spec.answerKey).trim();
    }
    return pass
      ? { pass: true, output: '', failures: [], durationMs: 0 }
      : { pass: false, output: '', failures: [{ name: spec.itemKey, message: 'incorrect answer' }], durationMs: 0 };
  }
  if (spec.type === 'predict-output') {
    if (typeof submission.answer !== 'string') throw new SubmissionShapeError('predict-output checks take a string `answer`');
    const norm = (s: string) => (spec.normalize ? normalizeOutput(s) : s);
    const pass = norm(submission.answer) === norm(spec.expected);
    return pass
      ? { pass: true, output: '', failures: [], durationMs: 0 }
      : { pass: false, output: '', failures: [{ name: 'predicted output', message: 'prediction does not match the captured output' }], durationMs: 0 };
  }
  return null;
}
