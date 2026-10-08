/**
 * Execution harness for the wrong-solution filter (seed:variants) and the
 * defective-version check (seed:patches). It executes through the REAL
 * runners — the server's drill-js grade adapter (the code path POST /submit
 * uses) — never a reimplementation. Registry keyed by check type so drill-cs
 * plugs in later (createDrillCsRunner from @bootquest/server/runner-csharp has
 * the same Runner signature; register it with `withRunner('drill-cs', ...)`).
 *
 * Rule: no execution = no emission. A check type with no registered runner is
 * a discard reason, never a pass.
 */
import type { CanonicalRunResult } from '@bootquest/shared/api';
import type { SeedRunnableCheck } from '@bootquest/shared';
import { drillJsRunner, type Runner } from '@bootquest/server/runners';

export type HarnessRunner = (check: SeedRunnableCheck, code: string) => Promise<CanonicalRunResult>;

export interface Harness {
  runners: Partial<Record<SeedRunnableCheck['type'], HarnessRunner>>;
  /** executions performed through this harness (reported + stamped) */
  executions: number;
}

const fromServerRunner =
  (r: Runner): HarnessRunner =>
  (check, code) =>
    r(check, { code });

/** The default harness: drill-js through the server's real grade adapter. */
export function defaultHarness(): Harness {
  return { runners: { 'drill-js': fromServerRunner(drillJsRunner) }, executions: 0 };
}

export function withRunner(h: Harness, type: SeedRunnableCheck['type'], runner: Runner): Harness {
  return { ...h, runners: { ...h.runners, [type]: fromServerRunner(runner) } };
}

/** Failures that are not a test verdict (the code never got graded). */
export const NOT_A_VERDICT = new Set(['code loads without errors', 'code runs', 'finishes in time', 'TypeScript compiles', 'grader results', '(compile)', '(timeout)', '(program)', '(format)']);

export type Execution =
  | { ok: true; result: CanonicalRunResult }
  | { ok: false; reason: string };

/** Execute once (a timeout is retried once, as seed:validate does). */
export async function execute(h: Harness, check: SeedRunnableCheck, code: string): Promise<Execution> {
  const run = h.runners[check.type];
  if (!run) return { ok: false, reason: `no runner registered for ${check.type} (no execution = no emission)` };
  try {
    h.executions++;
    let r = await run(check, code);
    if (!r.pass && r.failures.some((f) => f.name === 'finishes in time' || f.name === '(timeout)')) {
      h.executions++;
      r = await run(check, code);
    }
    return { ok: true, result: r };
  } catch (err) {
    return { ok: false, reason: `runner crashed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export const describeFailures = (r: CanonicalRunResult): string =>
  r.failures
    .map((f) => `${f.name}: ${f.message}`.replace(/\s+/g, ' ').trim())
    .join(' | ')
    .slice(0, 400);

/** A FAIL that counts: the code loaded and at least one named test failed. */
export function failsAsVerdict(r: CanonicalRunResult): { ok: true } | { ok: false; why: string } {
  if (r.pass) return { ok: false, why: 'passes' };
  const structured = r.failures.filter((f) => !NOT_A_VERDICT.has(f.name));
  if (structured.length === 0) return { ok: false, why: `fails only without a test verdict (${r.failures.map((f) => f.name).join(', ') || 'no failures reported'})` };
  return { ok: true };
}
