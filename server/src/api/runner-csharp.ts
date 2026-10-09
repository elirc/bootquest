import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanonicalRunResult } from '@bootquest/shared/api';
import { createCsharpRunner, type CsExercise } from '../runners/csharp/index.ts';
import { missingFrozen } from '../runners/self-run/compose.ts';
import { SubmissionShapeError, UnsupportedCheckError, type Runner } from './runners.ts';

/**
 * drill-cs → the warm C# runner (P2, W3a). Direct-compiler path by default
 * (csc.dll -shared:<pipe> + prebuilt Check.dll / warm bin); `dotnet test` only
 * as the opt-in msbuild engine for the xunit shape.
 *
 * Verdict rule (LEARNING P2, BINDING): pass requires the runner's parsed counts
 * with failed == 0 AND todo == 0 (and at least one passed test). Exit codes are
 * never trusted on their own — an untouched csbootcamp starter EXITS 0 (its
 * NotImplementedException stubs count as todo, and Report() returns 1 only on
 * failures). Compiler errors come back verbatim in `output`.
 *
 * Scratch/app-data dir: BOOTQUEST_CS_SCRATCH, else `<db dir>/bootquest-scratch`.
 * The runner keeps one warm project per shape under <dir>/csharp/<shape>/ and a
 * per-shape in-process mutex; two server processes must not share a dir.
 *
 * W3c: drill-cs specs with `harness: 'jstrain'` (jstrain2.2's embedded
 * csbootcamp revision) go to a SECOND warm runner under <dir>/jstrain-harness/
 * whose Check.dll is compiled from that revision (Check.cs + Spy.cs) and whose
 * tests end at the next divider (no `return Report();`). Frozen scaffolding
 * (files.frozen) missing from a submission is a structured failure before
 * anything compiles.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
export const JSTRAIN_CS_HARNESS: readonly string[] = [
  join(HERE, '..', 'runners', 'csharp', 'fixtures', 'jstrain-csbootcamp', '_lib', 'Check', 'Check.cs'),
  join(HERE, '..', 'runners', 'csharp', 'fixtures', 'jstrain-csbootcamp', '_lib', 'Check', 'Spy.cs'),
];

export const CS_SCRATCH_ENV = 'BOOTQUEST_CS_SCRATCH';

export function resolveCsScratchDir(env: Record<string, string | undefined>, dbPath: string): string {
  const raw = env[CS_SCRATCH_ENV];
  if (raw !== undefined && raw.trim() !== '') return resolve(raw.trim());
  return join(dirname(resolve(dbPath)), 'bootquest-scratch');
}

export interface DrillCsRunner {
  runner: Runner;
  appDataDir: string;
  /** named compiler-server pipe of this runner (process-hygiene checks) */
  pipe: string;
  /** stop the compiler server + any live child of this runner */
  shutdown(): Promise<void>;
}

/** Build the runner's exercise from a drill-cs spec (files.tests is the exercise's tests block). */
export function exerciseFor(spec: Extract<Parameters<Runner>[0], { type: 'drill-cs' }>, id = 'drill-cs'): CsExercise {
  if (spec.shape === 'console-check') {
    // tests block starts with the `// ─── tests ───` marker, so the split yields head='' + tests + tail
    return {
      id,
      shape: 'console-check',
      exerciseSource: spec.files.tests + spec.files.tail,
      ...(spec.harness === 'jstrain' ? { format: 'jstrain' as const } : {}),
      timeoutMs: spec.timeoutMs,
    };
  }
  return { id, shape: 'xunit', tests: spec.files.tests, timeoutMs: spec.timeoutMs };
}

export function createDrillCsRunner(opts: { appDataDir: string }): DrillCsRunner {
  const cs = createCsharpRunner({ appDataDir: opts.appDataDir });
  // the jstrain harness revision: its own Check.dll, scratch dir and compiler-server pipe (lazy)
  let jsCs: ReturnType<typeof createCsharpRunner> | null = null;
  const jstrainRunner = () => (jsCs ??= createCsharpRunner({ appDataDir: join(opts.appDataDir, 'jstrain-harness'), checkHarnessPaths: JSTRAIN_CS_HARNESS }));
  let used = false; // shutdown spawns dotnet; skip it when no C# grade ever ran
  const runner: Runner = async (spec, submission): Promise<CanonicalRunResult> => {
    if (spec.type !== 'drill-cs') throw new UnsupportedCheckError(`drill-cs runner got ${spec.type}`);
    if (submission.code === undefined) throw new SubmissionShapeError('drill-cs checks take `code`');
    const missing = missingFrozen(submission.code, spec.files.frozen ?? [], { wholeFile: true });
    if (missing.length) {
      return {
        pass: false,
        output: `provided scaffolding was edited: ${missing.map((m) => `"${m.label}"`).join(', ')} — restore it (the tests depend on it) and fix only your code`,
        failures: missing.map((m) => ({ name: '(scaffolding)', message: `section "${m.label}" was changed; it must stay as shipped` })),
        durationMs: 0,
      };
    }
    let r;
    used = true;
    try {
      r = await (spec.harness === 'jstrain' ? jstrainRunner() : cs).run(exerciseFor(spec), { code: submission.code });
    } catch (err) {
      // toolchain missing / scratch prepare failed: the runner is unavailable, not the learner wrong
      throw new UnsupportedCheckError(`C# runner unavailable: ${err instanceof Error ? err.message.slice(0, 2000) : String(err)}`);
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
    pipe: cs.scratch.pipe,
    shutdown: async () => {
      if (!used) return;
      await cs.shutdown();
      if (jsCs) await jsCs.shutdown();
    },
  };
}
