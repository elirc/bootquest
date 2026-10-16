import { join, resolve } from 'node:path';
import type { CanonicalRunResult } from '@bootquest/shared/api';
import { createDrillJavaRunner, type DrillJavaRunner } from '@bootquest/server/runner-java';
import { realValidator, type UnitValidator, type UnitVerdict } from './validate.ts';

/**
 * seed:validate for java-graded packs (javabootcamp, drill-java). Same import
 * gate as drill-cs in validate.ts (which stays byte-identical: it is hashed into
 * every grader fingerprint), as a separate UnitValidator the CLI passes when the
 * pack's grader kind is `java`:
 *   - the reference solution passes the Java runner (two strikes: a run that is
 *     not a compile error is retried once, and a timeout is retried once);
 *   - the untouched starter FAILS, and fails as a TEST verdict (todo / failed
 *     tests), never as a compile error, timeout, crash or format error.
 * Every other unit type is delegated to realValidator.
 *
 * Scratch: BOOTQUEST_JAVA_SCRATCH, else <repo>/.cache/seed-java. Callers MUST
 * await shutdownJavaValidatorRunner() when done.
 */

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');

let javaRunner: DrillJavaRunner | null = null;
export function validatorJavaScratch(): string {
  const raw = process.env.BOOTQUEST_JAVA_SCRATCH;
  return raw && raw.trim() ? resolve(raw.trim()) : join(REPO, '.cache', 'seed-java');
}
function runner(): DrillJavaRunner {
  javaRunner ??= createDrillJavaRunner({ appDataDir: validatorJavaScratch() });
  return javaRunner;
}
export async function shutdownJavaValidatorRunner(): Promise<void> {
  const r = javaRunner;
  javaRunner = null;
  if (r) await r.shutdown();
}

/** Failure names that mean "the program did not produce a test verdict". */
export const JAVA_NOT_A_VERDICT = new Set(['(compile)', '(timeout)', '(program)', '(format)', '(incomplete)']);

const describeFailures = (r: CanonicalRunResult): string =>
  r.failures
    .map((f) => `${f.name}: ${f.message}`.replace(/\s+/g, ' ').trim())
    .join(' | ')
    .slice(0, 600);

export const javaValidator: UnitValidator = async (pu, content): Promise<UnitVerdict> => {
  const spec = pu.unit.checks[0]?.spec;
  if (spec?.type !== 'drill-java') return realValidator(pu, content);

  const started = performance.now();
  const reasons: string[] = [];
  let attempts = 0;
  const done = (): UnitVerdict => ({
    verdict: reasons.length ? 'fail' : 'pass',
    reasons,
    attempts,
    durationMs: Math.round(performance.now() - started),
  });
  if (!content.instructions?.trim()) reasons.push('no instructions');
  if (!content.solution) {
    reasons.push('no reference solution');
    return done();
  }
  if (!content.starter) {
    reasons.push('no starter');
    return done();
  }
  const java = runner();
  const grade = async (code: string): Promise<CanonicalRunResult> => {
    attempts++;
    let r = await java.runner(spec, { code });
    if (!r.pass && r.failures.some((f) => f.name === '(timeout)')) {
      attempts++; // timeout flake under load: retry once before calling it a failure
      r = await java.runner(spec, { code });
    }
    return r;
  };
  let ref = await grade(content.solution);
  // two strikes (as drill-cs / self-run): a real defect fails twice, a starved run does not
  if (!ref.pass && !ref.failures.some((f) => f.name === '(compile)')) ref = await grade(content.solution);
  if (!ref.pass) {
    const compile = ref.failures.some((f) => f.name === '(compile)');
    reasons.push(`reference solution fails under the Java runner: ${describeFailures(ref)}${compile ? ` :: ${ref.output.slice(0, 400)}` : ''}`);
  }
  const starter = await grade(content.starter);
  if (starter.pass) reasons.push('vacuous-check: the untouched starter passes its own tests (must fail)');
  else {
    const broken = starter.failures.filter((f) => JAVA_NOT_A_VERDICT.has(f.name));
    if (broken.length) reasons.push(`starter does not fail as a test verdict (${broken.map((f) => f.name).join(', ')}): ${starter.output.slice(0, 400)}`);
    else if (starter.failures.length === 0) reasons.push('starter fails without any structured failure');
  }
  return done();
};
