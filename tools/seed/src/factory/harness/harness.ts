/**
 * Execution harness for the wrong-solution filter (seed:variants) and the
 * defective-version check (seed:patches). It executes through the REAL
 * runners — the server's drill-js grade adapter (the code path POST /submit
 * uses) and the server's drill-cs adapter over the warm C# runner
 * (createDrillCsRunner, @bootquest/server/runner-csharp) — never a
 * reimplementation. Registry keyed by check type.
 *
 * factoryHarness() is what the CLIs use: drill-js + drill-cs. The C# runner is
 * lazy (no dotnet process until the first drill-cs execution) and keeps its warm
 * projects in its OWN scratch dir (.cache/factory-csharp, overridable with
 * BOOTQUEST_FACTORY_CS_SCRATCH) — never the import gate's .cache/seed-csharp, so
 * a factory run can never collide with a seed:validate sweep. Callers MUST await
 * shutdown() (stops the compiler server + any live dotnet child).
 *
 * Rule: no execution = no emission. A check type with no registered runner is
 * a discard reason, never a pass.
 */
import type { CanonicalRunResult } from '@bootquest/shared/api';
import type { SeedRunnableCheck } from '@bootquest/shared';
import { join } from 'node:path';
import { createDrillCsRunner } from '@bootquest/server/runner-csharp';
import { drillJsRunner, type Runner } from '@bootquest/server/runners';
import { REPO_ROOT } from '../report.ts';

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

export const FACTORY_CS_SCRATCH_ENV = 'BOOTQUEST_FACTORY_CS_SCRATCH';

/** The factory's C# scratch dir: BOOTQUEST_FACTORY_CS_SCRATCH, else <repo>/.cache/factory-csharp. */
export function factoryCsScratchDir(env: Record<string, string | undefined> = process.env): string {
  const raw = env[FACTORY_CS_SCRATCH_ENV];
  return raw && raw.trim() ? raw.trim() : join(REPO_ROOT, '.cache', 'factory-csharp');
}

export interface ManagedHarness {
  harness: Harness;
  /** stop the C# runner's compiler server + live children (a no-op when no C# ran) */
  shutdown(): Promise<void>;
}

/** drill-js + drill-cs through the server's real adapters (the CLIs' harness). */
export function factoryHarness(opts: { csScratch?: string } = {}): ManagedHarness {
  const cs = createDrillCsRunner({ appDataDir: opts.csScratch ?? factoryCsScratchDir() });
  return { harness: withRunner(defaultHarness(), 'drill-cs', cs.runner), shutdown: () => cs.shutdown() };
}

/** Run with a factoryHarness and ALWAYS shut it down (also when the work throws). */
export async function withFactoryHarness<T>(work: (h: Harness) => Promise<T>): Promise<T> {
  const m = factoryHarness();
  try {
    return await work(m.harness);
  } finally {
    await m.shutdown();
  }
}

/** Failures that are not a test verdict (the code never got graded). */
// drill-cs adds '(runner)' (the xunit run produced no TRX results) and '(scaffolding)' (frozen section edited)
export const NOT_A_VERDICT = new Set([
  'code loads without errors',
  'code runs',
  'finishes in time',
  'TypeScript compiles',
  'grader results',
  '(compile)',
  '(timeout)',
  '(program)',
  '(format)',
  '(runner)',
  '(scaffolding)',
]);

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
