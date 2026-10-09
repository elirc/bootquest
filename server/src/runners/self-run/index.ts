/**
 * `self-run` check runner (W3c) — jstrain2.2 single-file self-testing exercises.
 *
 *   1. A fresh temp workspace mirrors the upstream layout: the graded program
 *      (learner head + the exercise's PROTECTED tests, compose.ts) is written at
 *      spec.file, fixtures at their paths, and `<track>/_lib/check.js|.ts`
 *      re-export BootQuest's harness (bq-check.mjs). Frozen scaffolding missing
 *      from the submission is a structured failure before anything runs.
 *   2. TS (spec.tsc): the REPO-PINNED TypeScript runs `tsc --noEmit` first with
 *      upstream's strict flags (tsbootcamp/_lib/tsc-config.js) against the
 *      upstream check.ts + type-assert.ts. Type errors come back verbatim and
 *      fail the run (esbuild/tsx alone would silently drop type-assertion
 *      grading — LEARNING R2). The tests still run, so the learner sees both.
 *   3. `process.execPath [--import tsx] --import <bq-check.mjs> <file>`, no
 *      shell, minimal env, wall-clock timeout => `taskkill /T /F` (process-group
 *      SIGKILL elsewhere).
 *   4. FORGERY DEFENSE: the verdict comes ONLY from the harness's authenticated
 *      `#bq-result <nonce> <base64 json>` line on fd 3 (nonce delivered through a
 *      file the preloaded harness deletes before learner code runs). The
 *      upstream `#done` line on stdout is ignored, so learner code printing a
 *      fake `#done passed=9 failed=0 todo=0` gains nothing. Zero or several
 *      authenticated lines => error verdict, never a pass.
 *   Learner verdict: pass iff tsc is clean AND passed > 0 AND failed == 0 AND
 *   todo == 0 (selfRunVerdict). todo entries are failures with message
 *   'not implemented yet (todo)'. `inverted` never changes the learner verdict;
 *   it only changes what the SHIPPED STARTER must do (starterContract below,
 *   used by the import gate) — consistent with recordSubmission's contract.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SelfRunCheck } from '@bootquest/shared';
import type { z } from 'zod';
import { selfRunVerdict, starterMeetsContract, type MarkerCounts } from '../../store/content.ts';
import { composeSelfRun, missingFrozen } from './compose.ts';

export type SelfRunSpec = z.infer<typeof SelfRunCheck>;
export type SelfRunVerdict = 'pass' | 'fail' | 'todo' | 'error';

export interface SelfRunFailure {
  name: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface TscError {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
}

export interface SelfRunResult {
  /** learner verdict === 'pass' */
  pass: boolean;
  verdict: SelfRunVerdict;
  output: string;
  failures: SelfRunFailure[];
  durationMs: number;
  /** authenticated harness counts (null = no trustworthy result) */
  counts: MarkerCounts | null;
  /** TS only: tsc errors (null when tsc did not run) */
  tsc: { errors: TscError[]; exitCode: number | null; timedOut: boolean } | null;
  timedOut: boolean;
  /** `#bq-result` lines seen on the result channel (1 on any healthy run) */
  resultLines: number;
}

export class SelfRunSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfRunSpecError';
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HARNESS_PATH = path.join(HERE, 'bq-check.mjs');
export const UPSTREAM_LIB = path.join(HERE, 'fixtures', 'jstrain');
const REPO = path.resolve(HERE, '..', '..', '..', '..');
export const TSC_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT = 64 * 1024;

/** tsc flags of upstream tsbootcamp/_lib/tsc-config.js (+ typeRoots: the workspace lives outside the repo). */
export const TSC_FLAGS = [
  '--noEmit',
  '--strict',
  '--target',
  'es2022',
  '--lib',
  'es2023',
  '--module',
  'nodenext',
  '--moduleResolution',
  'nodenext',
  '--allowImportingTsExtensions',
  '--skipLibCheck',
  '--types',
  'node',
  '--pretty',
  'false',
] as const;

const require = createRequire(import.meta.url);

let cachedTsc: { js: string; version: string; typeRoots: string } | undefined;
/** The repo-pinned TypeScript (root devDependency) — never the learner's or upstream's. */
export function resolveTypescript(): { js: string; version: string; typeRoots: string } {
  if (!cachedTsc) {
    const pkgPath = require.resolve('typescript/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    const typesNode = path.dirname(require.resolve('@types/node/package.json'));
    cachedTsc = { js: path.join(path.dirname(pkgPath), 'lib', 'tsc.js'), version: pkg.version, typeRoots: path.dirname(typesNode) };
  }
  return cachedTsc;
}

let cachedTsx: { url: string; version: string } | undefined;
/** tsx's `--import` entry, resolved from BootQuest's own node_modules. */
export function resolveTsx(): { url: string; version: string } {
  if (!cachedTsx) {
    const pkgPath = require.resolve('tsx/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    cachedTsx = { url: pathToFileURL(require.resolve('tsx')).href, version: pkg.version };
  }
  return cachedTsx;
}

export { REPO as SELF_RUN_REPO_ROOT };

// ---------------------------------------------------------------------------
// process plumbing
// ---------------------------------------------------------------------------

export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const k = spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { shell: false, windowsHide: true, stdio: 'ignore' });
      k.on('error', () => resolve());
      k.on('close', () => resolve());
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
      resolve();
    }
  });
}

export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === 'NODE_OPTIONS' || k === 'NODE_TEST_CONTEXT' || k.startsWith('VITEST') || k === 'TSX_TSCONFIG_PATH' || k.startsWith('BQ_SELFRUN')) {
      delete env[k];
    }
  }
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  return { ...env, ...extra };
}

export interface Spawned {
  stdout: string;
  stderr: string;
  /** fd 3 (result channel) */
  channel: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export function spawnCapture(
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; channel?: boolean; onSpawn?: (pid: number) => void },
): Promise<Spawned> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: opts.channel ? ['ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });
    if (child.pid !== undefined) opts.onSpawn?.(child.pid);
    let out = '';
    let err = '';
    let chan = '';
    let timedOut = false;
    const cap = (s: string) => (s.length > 4 * OUTPUT_LIMIT ? s.slice(-2 * OUTPUT_LIMIT) : s);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (out = cap(out + d)));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = cap(err + d)));
    const fd3 = opts.channel ? (child.stdio[3] as NodeJS.ReadableStream | null) : null;
    fd3?.setEncoding('utf8');
    fd3?.on('data', (d: string) => {
      // the channel carries one short line; anything huge is not ours
      if (chan.length < 8 * 1024 * 1024) chan += d;
    });
    fd3?.on('error', () => {});
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) void killTree(child.pid);
    }, opts.timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err, channel: chan, code, signal, timedOut });
    });
  });
}

// ---------------------------------------------------------------------------
// tsc output
// ---------------------------------------------------------------------------

/** `--pretty false` lines: `path/file.ts(12,5): error TS2322: message` (+ indented continuations). */
export function parseTscOutput(stdout: string): TscError[] {
  const errors: TscError[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
    if (m) {
      errors.push({ file: m[1]!.replace(/\\/g, '/'), line: Number(m[2]), col: Number(m[3]), code: m[4]!, message: m[5]! });
    } else if (errors.length && /^\s+\S/.test(line)) {
      errors[errors.length - 1]!.message += `\n${line.trim()}`;
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// authenticated result channel
// ---------------------------------------------------------------------------

const ResultLine = /^#bq-result ([0-9a-f]{32}) ([A-Za-z0-9+/=]+)$/;

interface HarnessRecord {
  name: string;
  status: 'pass' | 'fail' | 'todo';
  message?: string;
  expected?: string;
  actual?: string;
}
interface HarnessReport {
  passed: number;
  failed: number;
  todo: number;
  registered: number;
  tests: HarnessRecord[];
}

/**
 * Parse the fd-3 channel. Only lines carrying THIS run's nonce count; a report
 * must be internally consistent (counts === per-test records). Returns null +
 * a reason when there is no single trustworthy report.
 */
export function parseResultChannel(channel: string, nonce: string): { report: HarnessReport | null; lines: number; problem?: string } {
  const mine: string[] = [];
  let foreign = 0;
  for (const raw of channel.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = ResultLine.exec(line);
    if (m && m[1] === nonce) mine.push(m[2]!);
    else foreign++;
  }
  if (mine.length === 0) return { report: null, lines: 0, problem: foreign ? `no authenticated result (${foreign} unauthenticated line(s) ignored)` : 'no result' };
  if (mine.length > 1) return { report: null, lines: mine.length, problem: `${mine.length} authenticated results (expected exactly one)` };
  try {
    const r = JSON.parse(Buffer.from(mine[0]!, 'base64').toString('utf8')) as HarnessReport;
    const ints = [r.passed, r.failed, r.todo, r.registered].every((n) => Number.isInteger(n) && n >= 0);
    if (!ints || !Array.isArray(r.tests)) return { report: null, lines: 1, problem: 'malformed result' };
    const by = (s: string) => r.tests.filter((t) => t.status === s).length;
    if (by('pass') !== r.passed || by('fail') !== r.failed || by('todo') !== r.todo || r.tests.length !== r.registered) {
      return { report: null, lines: 1, problem: 'inconsistent result (counts do not match the test records)' };
    }
    return { report: r, lines: 1 };
  } catch {
    return { report: null, lines: 1, problem: 'unreadable result' };
  }
}

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------

function resolveInside(root: string, rel: string, what: string): string {
  if (rel.length === 0 || rel.includes('\\') || rel.includes('\0') || path.posix.isAbsolute(rel)) throw new SelfRunSpecError(`invalid ${what} path ${JSON.stringify(rel)}`);
  const norm = path.posix.normalize(rel);
  if (norm !== rel || norm.split('/').includes('..')) throw new SelfRunSpecError(`invalid ${what} path ${JSON.stringify(rel)}`);
  const abs = path.resolve(root, ...norm.split('/'));
  if (!abs.startsWith(root + path.sep)) throw new SelfRunSpecError(`${what} path escapes the workspace: ${JSON.stringify(rel)}`);
  return abs;
}

/** `bootcamp/01-x/exercises/01-y.js` -> `bootcamp` (the track root that holds `_lib/`). */
function trackRootOf(file: string): string {
  const parts = file.split('/');
  // <track>/<module>/<exercises|solutions>/<file>
  if (parts.length < 4) throw new SelfRunSpecError(`self-run file must be <track>/<module>/<dir>/<file>, got ${file}`);
  return parts.slice(0, parts.length - 3).join('/');
}

function scrub(text: string, root: string): string {
  let out = text;
  for (const form of [pathToFileURL(root).href, root.replace(/\\/g, '\\\\'), root, root.replace(/\\/g, '/')]) {
    out = out.split(form).join('<workspace>');
  }
  return out.length > OUTPUT_LIMIT ? `…[truncated ${out.length - OUTPUT_LIMIT} chars]\n${out.slice(-OUTPUT_LIMIT)}` : out;
}

export interface RunSelfRunOptions {
  onSpawn?: (pid: number, phase: 'tsc' | 'run') => void;
}

/** Run one self-run exercise against a learner submission (full file or head only). */
export async function runSelfRun(spec: SelfRunSpec, code: string, options: RunSelfRunOptions = {}): Promise<SelfRunResult> {
  const started = performance.now();
  if (!spec.files) throw new SelfRunSpecError('self-run spec has no files (protected tests block); re-import the pack');
  if (spec.language === 'cs') throw new SelfRunSpecError('self-run language cs is graded by the C# runner (drill-cs), not this runner');
  const isTs = spec.language === 'ts';
  const done = (r: Omit<SelfRunResult, 'durationMs' | 'pass'>): SelfRunResult => ({ ...r, pass: r.verdict === 'pass', durationMs: Math.round(performance.now() - started) });

  // frozen scaffolding: the tests rely on it, so an edited copy is a structured failure (nothing runs)
  const missing = missingFrozen(code, spec.files.frozen);
  if (missing.length) {
    return done({
      verdict: 'fail',
      output: `provided scaffolding was edited: ${missing.map((m) => `"${m.label}"`).join(', ')} — restore it (the tests depend on it) and fix only your code`,
      failures: missing.map((m) => ({ name: '(scaffolding)', message: `section "${m.label}" was changed; it must stay as shipped` })),
      counts: null,
      tsc: null,
      timedOut: false,
      resultLines: 0,
    });
  }
  const program = composeSelfRun(code, spec.files.tests);

  const root = await mkdtemp(path.join(tmpdir(), 'bq-selfrun-'));
  try {
    const track = trackRootOf(spec.file);
    const fileAbs = resolveInside(root, spec.file, 'exercise');
    const libDir = resolveInside(root, `${track}/_lib`, 'lib');
    await mkdir(path.dirname(fileAbs), { recursive: true });
    await mkdir(libDir, { recursive: true });
    await mkdir(path.join(root, '_bq'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    await writeFile(path.join(root, '_bq', 'check.mjs'), await readFile(HARNESS_PATH));
    const harnessUrl = pathToFileURL(path.join(root, '_bq', 'check.mjs')).href;
    const reexport = `export * from '../../_bq/check.mjs';\n`;
    for (const [rel, body] of Object.entries(spec.files.fixtures)) {
      const abs = resolveInside(root, rel, 'fixture');
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, body, 'utf8');
    }
    for (const f of spec.fixtures) if (!(f in spec.files.fixtures)) throw new SelfRunSpecError(`fixture ${f} listed but has no bytes`);
    await writeFile(fileAbs, program, 'utf8');

    let tsc: SelfRunResult['tsc'] = null;
    let tscOut = '';
    if (isTs) {
      // phase 1: the REAL type checker against upstream's typed harness
      await writeFile(path.join(libDir, 'check.ts'), await readFile(path.join(UPSTREAM_LIB, 'tsbootcamp', '_lib', 'check.ts')));
      await writeFile(path.join(libDir, 'type-assert.ts'), await readFile(path.join(UPSTREAM_LIB, 'tsbootcamp', '_lib', 'type-assert.ts')));
      const ts = resolveTypescript();
      const r = await spawnCapture([ts.js, ...TSC_FLAGS, '--typeRoots', ts.typeRoots, spec.file], {
        cwd: root,
        env: childEnv(),
        timeoutMs: TSC_TIMEOUT_MS,
        onSpawn: (pid) => options.onSpawn?.(pid, 'tsc'),
      });
      const errors = parseTscOutput(r.stdout);
      tsc = { errors, exitCode: r.code, timedOut: r.timedOut };
      tscOut = errors.length
        ? `tsc: ${errors.length} type error(s)\n${errors.map((e) => `  ${e.file}(${e.line},${e.col}): error ${e.code}: ${e.message}`).join('\n')}\n`
        : r.timedOut
          ? `tsc: timed out after ${TSC_TIMEOUT_MS} ms\n`
          : r.code === 0
            ? 'tsc: types clean\n'
            : `tsc: exited ${String(r.code)} without parseable errors\n${r.stdout}${r.stderr}\n`;
      // phase 2 runs the same harness as JS: check.ts becomes a re-export of bq-check.mjs
      await writeFile(path.join(libDir, 'check.ts'), reexport);
    } else {
      await writeFile(path.join(libDir, 'check.js'), reexport);
    }

    const nonce = randomBytes(16).toString('hex');
    const nonceFile = path.join(root, '_bq', `n-${randomBytes(8).toString('hex')}`);
    await writeFile(nonceFile, nonce);
    const args: string[] = [];
    if (isTs) args.push('--import', resolveTsx().url);
    args.push('--import', harnessUrl, fileAbs);
    const r = await spawnCapture(args, {
      // upstream verify.js runs every file from the repo root; the workspace root mirrors it
      cwd: root,
      env: childEnv({ BQ_SELFRUN_NONCE_FILE: nonceFile }),
      timeoutMs: spec.timeoutMs,
      channel: true,
      onSpawn: (pid) => options.onSpawn?.(pid, 'run'),
    });

    const parsed = parseResultChannel(r.channel, nonce);
    const failures: SelfRunFailure[] = [];
    const tscErrors = tsc?.errors ?? [];
    for (const e of tscErrors.slice(0, 50)) failures.push({ name: '(tsc)', message: `${e.code} L${e.line}:${e.col} ${e.message}` });
    if (tsc && tscErrors.length === 0 && (tsc.timedOut || tsc.exitCode !== 0)) {
      failures.push({ name: '(tsc)', message: tsc.timedOut ? 'type check timed out' : `type check exited ${String(tsc.exitCode)}` });
    }
    let counts: MarkerCounts | null = null;
    let verdict: SelfRunVerdict;
    if (r.timedOut) {
      failures.push({ name: '(timeout)', message: `exceeded ${spec.timeoutMs} ms; process tree killed` });
      verdict = 'error';
    } else if (!parsed.report) {
      failures.push({
        name: '(no result)',
        message: `the exercise did not report a trustworthy result (${parsed.problem ?? 'unknown'}; exit ${String(r.code ?? r.signal)}) — it crashed, exited early, or left tests unfinished`,
      });
      verdict = 'error';
    } else {
      const rep = parsed.report;
      counts = { passed: rep.passed, failed: rep.failed, todo: rep.todo };
      for (const t of rep.tests) {
        if (t.status === 'fail') {
          const f: SelfRunFailure = { name: t.name, message: t.message || 'failed' };
          if (t.expected !== undefined) f.expected = t.expected;
          if (t.actual !== undefined) f.actual = t.actual;
          failures.push(f);
        } else if (t.status === 'todo') {
          failures.push({ name: t.name, message: 'not implemented yet (todo)' });
        }
      }
      const v = selfRunVerdict(counts); // pass | todo | fail by construction
      verdict = v === 'pass' || v === 'todo' ? v : 'fail';
      if (verdict === 'pass' && tsc && (tscErrors.length > 0 || tsc.timedOut || tsc.exitCode !== 0)) verdict = 'fail';
    }
    const output = scrub(`${tscOut}${r.stdout}${r.stderr ? `\n--- stderr ---\n${r.stderr}` : ''}`, root);
    return done({ verdict, output, failures, counts, tsc, timedOut: r.timedOut, resultLines: parsed.lines });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/**
 * Import-gate contract for the SHIPPED STARTER (returns null when met, else the
 * reason). Builds on starterMeetsContract (counts) and adds the TS rules of
 * tsbootcamp/_lib/FORMAT-TS.md:
 *   normal JS    failed == 0 and todo > 0                    (all-todo, nothing red)
 *   normal TS    failed == 0 and (todo > 0 or >= 1 tsc error) — type errors ARE the
 *                todo list; never a syntax error (TS1xxx)
 *   inverted JS  failed > 0                                   (*-debug / *-hunts ship red)
 *   inverted TS  failed > 0 and tsc clean                     (compiles, still wrong)
 * A starter that passes as a learner submission is always vacuous.
 */
export function starterContract(r: SelfRunResult, inverted: boolean): string | null {
  if (r.verdict === 'pass') return 'vacuous-check: the untouched starter passes its own tests (must not)';
  if (!r.counts) return `starter does not report a structured result: ${r.failures.map((f) => `${f.name}: ${f.message}`).join(' | ').slice(0, 300)}`;
  const tscErrors = r.tsc?.errors ?? [];
  const syntax = tscErrors.filter((e) => /^TS1\d{3}$/.test(e.code));
  if (syntax.length) return `starter has syntax errors (${syntax.map((e) => e.code).join(', ')})`;
  if (inverted) {
    if (!starterMeetsContract(r.counts, true)) return `inverted starter must FAIL (ship red), got passed=${r.counts.passed} failed=${r.counts.failed} todo=${r.counts.todo}`;
    if (r.tsc && tscErrors.length) return `inverted TS starter must type-check clean, got ${tscErrors.length} tsc error(s)`;
    return null;
  }
  if (r.tsc) {
    if (r.counts.failed === 0 && (r.counts.todo > 0 || tscErrors.length > 0)) return null;
    return `TS starter must be unfinished (todo or type errors) with nothing red, got failed=${r.counts.failed} todo=${r.counts.todo} tscErrors=${tscErrors.length}`;
  }
  if (starterMeetsContract(r.counts, false)) return null;
  return `starter must be all-todo with nothing red, got passed=${r.counts.passed} failed=${r.counts.failed} todo=${r.counts.todo}`;
}
