// Java runner (javabootcamp): run(exercise, submission) →
//   { pass, output, failures[{name,message,expected?,actual?}], durationMs, counts? }
// Compiler errors come back VERBATIM in `output` with pass=false.
//
// Layout under `<appDataDir>/java/`:
//   harness/         Check + BqMain compiled ONCE (`.ready` holds the sha256 of
//                    the harness sources; a changed harness recompiles)
//   attempt/src/     <ClassName>.java  (learner head + canonical tests + learner tail)
//   attempt/classes/ javac output, wiped per attempt
//   attempt/nonce, attempt/result     the grading channel (see below)
// One in-process mutex serializes every grade (one attempt dir); two server
// processes must not share an appDataDir.
//
// Per attempt: `javac --release 17 -encoding UTF-8 -cp harness -d attempt/classes`
// (30 s cap), then `java ... -cp harness<sep>attempt/classes bootcamp.BqMain <Class>`
// under the check's timeout; on timeout the whole process tree is killed
// (runProc/killTree from the C# runner's scratch module — shared, not copied).
//
// Grading channel (the javabootcamp harness protocol, FORMAT.md): the runner
// writes a fresh random nonce to `-Dbq.nonce.file`; BqMain reads it and DELETES
// the file before the exercise class is loaded, then report() writes
//     #bq-result <nonce> <base64 json {passed,failed,todo,tests:[{name,status,detail?}]}>
// to `-Dbq.result.file`. The verdict comes ONLY from a result file carrying
// this attempt's nonce; stdout (`✔ / ✘ / ☐`, `#done`) is display. No result
// file (crash, early System.exit, timeout) is never a pass, nor is a result
// that misses a test the canonical tests block names literally (an early
// report() from learner code). The exit code is never trusted.

import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProc } from '../csharp/scratch.ts';
import { composeGraded, literalTestNames, splitAtTestsMarker } from './split.ts';

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
  counts?: { passed: number; failed: number; todo: number };
  compileError?: boolean;
  timedOut?: boolean;
  /** the program ended without a valid, nonce-checked result (crash / early exit / forgery) */
  crashed?: boolean;
  phases?: { compileMs: number; runMs: number };
}

export interface JavaExercise {
  id: string;
  /** javabootcamp exercise file (the canonical tests are taken from it) */
  exerciseSource: string;
  /** the top-level class BqMain launches (javabootcamp: always Exercise) */
  className?: string;
  timeoutMs?: number;
}

export interface Submission {
  code: string;
}

export interface JavaRunnerOptions {
  appDataDir: string;
  /** harness sources (Check.java + BqMain.java); default: the javabootcamp fixture copy */
  harnessPaths?: readonly string[];
  /** a JDK home whose bin/ holds javac + java; default: javac/java from PATH */
  javaHome?: string;
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const HARNESS_DIR = join(HERE, 'fixtures', 'javabootcamp', '_lib', 'check', 'bootcamp');
export const DEFAULT_HARNESS: readonly string[] = [join(HARNESS_DIR, 'Check.java'), join(HARNESS_DIR, 'BqMain.java')];

const DEFAULT_TIMEOUT = 10_000;
const COMPILE_TIMEOUT = 30_000;
const CLASS_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// A JVM prints "Picked up JAVA_TOOL_OPTIONS: ..." when the user's environment sets these (even
// empty); runProc cannot unset variables, so the notice is stripped from the shown output instead.
const JVM_ENV: Record<string, string> = {};
const PICKED_UP = /^(?:NOTE: )?Picked up (?:JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS):.*\n?/gm;
/** child output as shown to the learner: LF line ends (Windows println is CRLF), no JVM option notices */
export function cleanOutput(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(PICKED_UP, '');
}
const JAVAC_LOCALE = ['-J-Duser.language=en', '-J-Duser.country=US', '-J-Dsun.stdout.encoding=UTF-8', '-J-Dsun.stderr.encoding=UTF-8'];

export function javaTool(tool: 'java' | 'javac', javaHome?: string): string {
  if (!javaHome) return tool;
  return join(javaHome, 'bin', process.platform === 'win32' ? `${tool}.exe` : tool);
}

let cachedJdk: string | undefined;
/** `javac -version` → e.g. "17.0.10" (bound into the java grader fingerprint). */
export function jdkVersion(javaHome?: string): string {
  if (!javaHome && cachedJdk) return cachedJdk;
  const out = execFileSync(javaTool('javac', javaHome), ['-version'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...JVM_ENV }, stdio: ['ignore', 'pipe', 'pipe'] });
  const m = /javac\s+(\S+)/.exec(out);
  if (!m) throw new Error(`unparseable \`javac -version\` output: ${out}`);
  if (!javaHome) cachedJdk = m[1]!;
  return m[1]!;
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  drain(): Promise<void> {
    return this.tail;
  }
}

// ── the result channel ─────────────────────────────────────────────────────────

interface ResultTest {
  name: string;
  status: 'pass' | 'fail' | 'todo';
  detail?: string;
}
interface ResultPayload {
  passed: number;
  failed: number;
  todo: number;
  tests: ResultTest[];
}

/** Parse + nonce-check the result file's text. Returns the payload or why it is refused. */
export function parseResultFile(text: string, nonce: string): { ok: true; payload: ResultPayload } | { ok: false; reason: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l !== '');
  if (lines.length !== 1) return { ok: false, reason: `result file has ${lines.length} lines (want exactly one)` };
  const m = /^#bq-result (\S+) ([A-Za-z0-9+/=]+)$/.exec(lines[0]!);
  if (!m) return { ok: false, reason: 'result line is malformed' };
  if (m[1] !== nonce) return { ok: false, reason: 'result nonce does not match this attempt (forged or stale result)' };
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(m[2]!, 'base64').toString('utf8'));
  } catch {
    return { ok: false, reason: 'result payload is not base64 JSON' };
  }
  const p = raw as Partial<ResultPayload>;
  const nat = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  if (!p || !nat(p.passed) || !nat(p.failed) || !nat(p.todo) || !Array.isArray(p.tests)) return { ok: false, reason: 'result payload has the wrong shape' };
  const tally = { pass: 0, fail: 0, todo: 0 };
  for (const t of p.tests) {
    if (!t || typeof t.name !== 'string' || !(t.status === 'pass' || t.status === 'fail' || t.status === 'todo')) {
      return { ok: false, reason: 'result payload has a malformed test entry' };
    }
    tally[t.status]++;
  }
  if (tally.pass !== p.passed || tally.fail !== p.failed || tally.todo !== p.todo) {
    return { ok: false, reason: 'result counts disagree with its test list' };
  }
  return { ok: true, payload: p as ResultPayload };
}

/** A failed test's detail (`message\n      expected: x\n      received: y\n      at ...`) → Failure. */
export function failureFrom(t: ResultTest): Failure {
  if (t.status === 'todo') return { name: t.name, message: 'not implemented yet (todo)' };
  const lines = (t.detail ?? '').split('\n').map((l) => l.trim());
  const f: Failure = { name: t.name, message: lines.filter((d) => d && !/^(expected|received):/.test(d)).join('\n') || 'failed' };
  for (const d of lines) {
    const e = /^expected: (.*)$/.exec(d);
    const a = /^received: (.*)$/.exec(d);
    if (e) f.expected = e[1];
    if (a) f.actual = a[1];
  }
  return f;
}

// ── the runner ─────────────────────────────────────────────────────────────────

export function createJavaRunner(opts: JavaRunnerOptions) {
  const root = join(opts.appDataDir, 'java');
  const harnessOut = join(root, 'harness');
  const attemptDir = join(root, 'attempt');
  const harnessSources = opts.harnessPaths?.length ? opts.harnessPaths : DEFAULT_HARNESS;
  const javac = javaTool('javac', opts.javaHome);
  const java = javaTool('java', opts.javaHome);
  const mutex = new Mutex();

  function harnessDigest(): string {
    const h = createHash('sha256');
    for (const f of harnessSources) h.update(readFileSync(f)).update('\0');
    return h.digest('hex');
  }

  /** Compile the harness once (re-done when its sources change). Caller holds the mutex. */
  async function prepareLocked(): Promise<{ prepared: boolean; ms: number }> {
    const started = Date.now();
    const marker = join(harnessOut, '.ready');
    const digest = harnessDigest();
    if (existsSync(marker) && readFileSync(marker, 'utf8') === digest) return { prepared: false, ms: 0 };
    rmSync(harnessOut, { recursive: true, force: true });
    mkdirSync(harnessOut, { recursive: true });
    const r = await runProc(javac, ['--release', '17', '-encoding', 'UTF-8', ...JAVAC_LOCALE, '-J-XX:TieredStopAtLevel=1', '-J-XX:+UseSerialGC', '-J-Xmx256m', '-proc:none', '-d', harnessOut, ...harnessSources], {
      cwd: root,
      timeoutMs: 120_000,
      env: JVM_ENV,
    });
    if (r.timedOut || r.code !== 0) throw new Error(`java: the bootcamp harness failed to compile\n${r.output}`);
    writeFileSync(marker, digest);
    return { prepared: true, ms: Date.now() - started };
  }

  async function prepare() {
    return mutex.run(async () => {
      mkdirSync(root, { recursive: true });
      return prepareLocked();
    });
  }

  async function attempt(program: string, className: string, timeoutMs: number, required: string[], started: number): Promise<RunResult> {
    rmSync(attemptDir, { recursive: true, force: true });
    const src = join(attemptDir, 'src');
    const classes = join(attemptDir, 'classes');
    mkdirSync(src, { recursive: true });
    mkdirSync(classes, { recursive: true });
    writeFileSync(join(src, `${className}.java`), program);

    const compile = await runProc(
      javac,
      ['--release', '17', '-encoding', 'UTF-8', ...JAVAC_LOCALE, '-J-XX:TieredStopAtLevel=1', '-J-XX:+UseSerialGC', '-J-Xmx256m', '-proc:none', '-cp', harnessOut, '-d', classes, `${className}.java`],
      { cwd: src, timeoutMs: COMPILE_TIMEOUT, env: JVM_ENV },
    );
    if (compile.timedOut || compile.code !== 0) {
      const output = compile.timedOut ? `compiler timed out after ${compile.ms} ms\n${cleanOutput(compile.output)}` : cleanOutput(compile.output);
      return {
        pass: false,
        output,
        failures: [{ name: '(compile)', message: 'compilation failed — see output' }],
        durationMs: Date.now() - started,
        compileError: true,
        phases: { compileMs: compile.ms, runMs: 0 },
      };
    }
    // a learner class in package `bootcamp` cannot shadow the harness (harness is first on the
    // classpath), but refuse it outright so no one wonders
    if (existsSync(join(classes, 'bootcamp'))) {
      return {
        pass: false,
        output: cleanOutput(compile.output) + '\npackage `bootcamp` is reserved for the bootcamp harness',
        failures: [{ name: '(program)', message: 'declares classes in the reserved package `bootcamp`' }],
        durationMs: Date.now() - started,
        crashed: true,
        phases: { compileMs: compile.ms, runMs: 0 },
      };
    }

    const nonce = randomBytes(24).toString('base64url');
    const nonceFile = join(attemptDir, 'nonce');
    const resultFile = join(attemptDir, 'result');
    writeFileSync(nonceFile, nonce);
    const run = await runProc(
      java,
      [
        '-Dfile.encoding=UTF-8',
        '-Dsun.stdout.encoding=UTF-8',
        '-Dsun.stderr.encoding=UTF-8',
        '-Duser.language=en',
        '-Duser.country=US',
        '-Xmx256m',
        '-XX:+UseSerialGC',
        '-XX:TieredStopAtLevel=1',
        '-cp',
        [harnessOut, classes].join(delimiter),
        `-Dbq.nonce.file=${nonceFile}`,
        `-Dbq.result.file=${resultFile}`,
        'bootcamp.BqMain',
        className,
      ],
      { cwd: attemptDir, timeoutMs, env: { ...JVM_ENV, NO_COLOR: '1' } },
    );
    const phases = { compileMs: compile.ms, runMs: run.ms };
    const compileOut = cleanOutput(compile.output);
    const output = compileOut ? `${compileOut}\n${cleanOutput(run.output)}` : cleanOutput(run.output);
    if (run.timedOut) {
      return {
        pass: false,
        output: cleanOutput(run.output) + `\n[killed: exceeded ${timeoutMs} ms — process tree terminated]`,
        failures: [{ name: '(timeout)', message: `exceeded ${timeoutMs} ms; process tree killed` }],
        durationMs: Date.now() - started,
        timedOut: true,
        phases,
      };
    }
    const crash = (message: string): RunResult => ({
      pass: false,
      output,
      failures: [{ name: '(program)', message }],
      durationMs: Date.now() - started,
      crashed: true,
      phases,
    });
    if (existsSync(nonceFile)) return crash(`the program never reached the bootcamp launcher (exit code ${run.code}); not graded`);
    if (!existsSync(resultFile)) {
      return crash(`ended without a result from report(): crashed or exited early (exit code ${run.code}); never a pass`);
    }
    const parsed = parseResultFile(readFileSync(resultFile, 'utf8'), nonce);
    if (!parsed.ok) return crash(parsed.reason);
    const { payload } = parsed;
    const failures = payload.tests.filter((t) => t.status !== 'pass').map(failureFrom);
    const seen = new Set(payload.tests.map((t) => t.name));
    const missing = [...new Set(required)].filter((n) => !seen.has(n));
    const counts = { passed: payload.passed, failed: payload.failed, todo: payload.todo };
    if (missing.length) {
      failures.push({ name: '(incomplete)', message: `report() ran before every test did; never ran: ${missing.map((n) => `"${n}"`).join(', ')}` });
      return { pass: false, output, failures, durationMs: Date.now() - started, counts, crashed: true, phases };
    }
    const pass = counts.passed > 0 && counts.failed === 0 && counts.todo === 0;
    return { pass, output, failures, durationMs: Date.now() - started, counts, phases };
  }

  async function run(exercise: JavaExercise, submission: Submission): Promise<RunResult> {
    const started = Date.now();
    const className = exercise.className ?? 'Exercise';
    const timeoutMs = exercise.timeoutMs ?? DEFAULT_TIMEOUT;
    let program: string;
    let required: string[];
    try {
      if (!CLASS_NAME.test(className)) throw new Error(`invalid class name ${JSON.stringify(className)}`);
      program = composeGraded(submission.code, exercise.exerciseSource);
      required = literalTestNames(splitAtTestsMarker(exercise.exerciseSource).tests);
    } catch (e) {
      const msg = (e as Error).message;
      return { pass: false, output: msg, failures: [{ name: '(format)', message: msg }], durationMs: Date.now() - started };
    }
    return mutex.run(async () => {
      mkdirSync(root, { recursive: true });
      await prepareLocked();
      return attempt(program, className, timeoutMs, required, started);
    });
  }

  return {
    run,
    prepare,
    root,
    /** nothing stays resident between grades (no compiler server); wait for the in-flight grade */
    shutdown: () => mutex.drain(),
    /** files left in the attempt dir (tests: the nonce file must be gone after a launch) */
    attemptFiles: () => (existsSync(attemptDir) ? readdirSync(attemptDir) : []),
  };
}

export type JavaRunner = ReturnType<typeof createJavaRunner>;
