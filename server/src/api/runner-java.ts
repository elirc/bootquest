import { dirname, join, resolve } from 'node:path';
import type { CanonicalRunResult } from '@bootquest/shared/api';
import { createJavaRunner, type JavaExercise } from '../runners/java/index.ts';
import { SubmissionShapeError, UnsupportedCheckError, type Runner } from './runners.ts';

/**
 * drill-java → the Java runner (javabootcamp). javac + java per attempt against
 * the bootcamp harness compiled once; the verdict is read from the nonce-checked
 * result file BqMain/report() writes, never from stdout or the exit code.
 *
 * Verdict rule (same as drill-cs): pass requires parsed counts with
 * passed > 0 AND failed == 0 AND todo == 0. An untouched starter exits 0 (its
 * `UnsupportedOperationException("TODO")` stubs count as todo) and fails.
 * Compiler errors come back verbatim in `output`.
 *
 * Scratch/app-data dir: BOOTQUEST_JAVA_SCRATCH, else `<db dir>/bootquest-scratch`
 * (the runner works under <dir>/java/, beside the C# runner's <dir>/csharp/).
 * One in-process mutex; two server processes must not share a dir. Lazy: no JVM
 * is started until the first Java grade.
 */
export const JAVA_SCRATCH_ENV = 'BOOTQUEST_JAVA_SCRATCH';

export function resolveJavaScratchDir(env: Record<string, string | undefined>, dbPath: string): string {
  const raw = env[JAVA_SCRATCH_ENV];
  if (raw !== undefined && raw.trim() !== '') return resolve(raw.trim());
  return join(dirname(resolve(dbPath)), 'bootquest-scratch');
}

export interface DrillJavaRunner {
  runner: Runner;
  appDataDir: string;
  /** wait for an in-flight grade (nothing stays resident between grades) */
  shutdown(): Promise<void>;
}

/** Build the runner's exercise from a drill-java spec (files.tests is the exercise's tests block). */
export function javaExerciseFor(spec: Extract<Parameters<Runner>[0], { type: 'drill-java' }>, id = 'drill-java'): JavaExercise {
  // the tests block starts with the `// ─── tests ───` line, so the split yields head='' + tests + tail
  return { id, exerciseSource: spec.files.tests + spec.files.tail, className: spec.className, timeoutMs: spec.timeoutMs };
}

export function createDrillJavaRunner(opts: { appDataDir: string; javaHome?: string }): DrillJavaRunner {
  let java: ReturnType<typeof createJavaRunner> | null = null;
  const get = () => (java ??= createJavaRunner({ appDataDir: opts.appDataDir, ...(opts.javaHome ? { javaHome: opts.javaHome } : {}) }));
  const runner: Runner = async (spec, submission): Promise<CanonicalRunResult> => {
    if (spec.type !== 'drill-java') throw new UnsupportedCheckError(`drill-java runner got ${spec.type}`);
    if (submission.code === undefined) throw new SubmissionShapeError('drill-java checks take `code`');
    let r;
    try {
      r = await get().run(javaExerciseFor(spec), { code: submission.code });
    } catch (err) {
      // JDK missing / harness failed to compile: the runner is unavailable, not the learner wrong
      throw new UnsupportedCheckError(`Java runner unavailable: ${err instanceof Error ? err.message.slice(0, 2000) : String(err)}`);
    }
    const c = r.counts;
    const pass = r.pass && c !== undefined && c.passed > 0 && c.failed === 0 && c.todo === 0;
    return {
      pass,
      output: r.output,
      failures: r.failures.map((f) => {
        const out: CanonicalRunResult['failures'][number] = { name: f.name, message: f.message };
        if (f.expected !== undefined) out.expected = f.expected;
        if (f.actual !== undefined) out.actual = f.actual;
        return out;
      }),
      durationMs: r.durationMs,
    };
  };
  return {
    runner,
    appDataDir: opts.appDataDir,
    shutdown: async () => {
      if (java) await java.shutdown();
    },
  };
}
