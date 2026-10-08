import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FILE_FLOOR_PCT,
  evaluateMutation,
  floorPctFor,
  MUTATE_TIMEOUT_MS,
  parseMutationReport,
  type MutationTool,
  type MutationVerdict,
  type ParsedMutationReport,
} from '@bootquest/shared/mutation';
import type { UnitDetailResponse } from '@bootquest/shared/api';

/**
 * `bootquest mutate [path]` (W6, spec §5 mutation gate; thresholds and process
 * rules from docs/recon/stryker-spike.md — BINDING):
 *   - JS track  -> Stryker 10 (+ vitest runner, pinned 10.0.0 in cli/package.json),
 *                  `--incremental` so reruns only redo what changed;
 *   - C# track  -> Stryker.NET (dotnet-stryker 5.0.0, a repo-local --tool-path install
 *                  under .cache/tools), UseSharedCompilation=false, and any
 *                  VBCSCompiler / testhost left behind is killed after the run;
 *   - hard 15-minute wall clock (the whole process tree is killed on expiry);
 *   - the JSON report is parsed (never the console), the per-file floor (check
 *     threshold, default 40%) AND the overall break (60%) are checked locally,
 *     and ONLY a passing run is reported to the server, which re-evaluates the
 *     counts before it records verified pipeline evidence.
 * Solo-project units only (never drills).
 */

/** Mirrors PROJECT_UNIT_KINDS in shared/src/enums.ts (cli/test/mutate.test.ts asserts they agree). */
export const PROJECT_KINDS: readonly string[] = ['guided-project', 'http-lab', 'repo-task', 'program-unit'];

export const STRYKER_JS_VERSION = '10.0.0';
export const STRYKER_NET_VERSION = '5.0.0';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface ToolRun {
  /** executable (process.execPath for Stryker JS, the dotnet-stryker exe for C#) */
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
}

export interface ToolResult {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

/** Process seam: tests inject a fake; the real one spawns without a shell and tree-kills on timeout. */
export type ToolRunner = (run: ToolRun, onOutput: (chunk: string) => void) => Promise<ToolResult>;

/** Windows-safe tree kill (the Stryker / dotnet child spawns grandchildren). */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    } catch {
      /* already gone */
    }
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
  }
}

export const spawnTool: ToolRunner = (run, onOutput) =>
  new Promise((done, fail) => {
    const started = performance.now();
    const child = spawn(run.command, run.args, {
      cwd: run.cwd,
      env: run.env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) killTree(child.pid);
    }, run.timeoutMs);
    child.stdout?.on('data', (b: Buffer) => onOutput(b.toString('utf8')));
    child.stderr?.on('data', (b: Buffer) => onOutput(b.toString('utf8')));
    child.once('error', (err) => {
      clearTimeout(timer);
      fail(err);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      done({ exitCode: code, timedOut, durationMs: Math.round(performance.now() - started) });
    });
  });

export class MutateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutateError';
  }
}

function strip(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out = { ...env };
  // a parent vitest / node --test must not leak into the learner's test runs
  for (const k of Object.keys(out)) if (/^(VITEST|NODE_TEST_CONTEXT|NODE_OPTIONS)/.test(k)) delete out[k];
  return out;
}

const require = createRequire(import.meta.url);
function packageDir(name: string): string {
  return dirname(require.resolve(`${name}/package.json`));
}

/** Stryker JS invocation for a learner project dir (vitest runner, --incremental, JSON report). */
export function strykerJsRun(projectDir: string, env: Record<string, string | undefined>, timeoutMs: number): ToolRun {
  const core = packageDir('@stryker-mutator/core');
  // the plugin's ENTRY FILE: Stryker's ESM plugin loader refuses directory imports
  const runner = require.resolve('@stryker-mutator/vitest-runner');
  const concurrency = Math.max(1, Math.floor(availableParallelism() / 2));
  return {
    command: process.execPath,
    args: [
      join(core, 'bin', 'stryker.js'),
      'run',
      '--testRunner',
      'vitest',
      // absolute plugin path: resolves from BootQuest's pinned install, whatever the learner has
      '--plugins',
      runner,
      '--reporters',
      'json,clear-text',
      '--coverageAnalysis',
      'perTest',
      '--incremental',
      '--incrementalFile',
      'reports/stryker-incremental.json',
      '--concurrency',
      String(concurrency),
      '--tempDirName',
      '.stryker-tmp',
      '--cleanTempDir',
      'always',
    ],
    cwd: projectDir,
    env: strip(env),
    timeoutMs,
  };
}

export const JS_REPORT = join('reports', 'mutation', 'mutation.json');
export const NET_OUTPUT = join('StrykerOutput', 'bootquest');

export function dotnetStrykerToolDir(root: string = REPO_ROOT): string {
  return join(root, '.cache', 'tools', `dotnet-stryker-${STRYKER_NET_VERSION}`);
}

/** Stryker.NET invocation, run from the TEST project dir (spike: avoids needing the solution). */
export function strykerNetRun(projectDir: string, toolExe: string, env: Record<string, string | undefined>, timeoutMs: number): ToolRun {
  const concurrency = Math.max(1, Math.floor(availableParallelism() / 2));
  return {
    command: toolExe,
    args: ['--reporter', 'json', '--reporter', 'progress', '--concurrency', String(concurrency), '--output', NET_OUTPUT],
    cwd: projectDir,
    // no shared compiler server: VBCSCompiler would outlive the run (spike)
    env: { ...strip(env), UseSharedCompilation: 'false', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
    timeoutMs,
  };
}

/** Install the pinned dotnet-stryker into the repo-local tool path once (not global, not a manifest walk). */
export async function ensureDotnetStryker(run: ToolRunner, onOutput: (s: string) => void, root: string = REPO_ROOT): Promise<string> {
  const dir = dotnetStrykerToolDir(root);
  const exe = join(dir, process.platform === 'win32' ? 'dotnet-stryker.exe' : 'dotnet-stryker');
  if (existsSync(exe)) return exe;
  mkdirSync(dir, { recursive: true });
  const r = await run(
    { command: 'dotnet', args: ['tool', 'install', 'dotnet-stryker', '--version', STRYKER_NET_VERSION, '--tool-path', dir], cwd: dir, env: { ...process.env, DOTNET_NOLOGO: '1' }, timeoutMs: 5 * 60_000 },
    onOutput,
  );
  if (r.exitCode !== 0 || !existsSync(exe)) throw new MutateError(`could not install dotnet-stryker ${STRYKER_NET_VERSION} into ${dir} (exit ${r.exitCode})`);
  return exe;
}

/** The C# report: <output>/reports/mutation-report.json, else the newest StrykerOutput/<ts>/reports one. */
export function findNetReport(projectDir: string, sinceMs: number): string | null {
  const direct = join(projectDir, NET_OUTPUT, 'reports', 'mutation-report.json');
  if (existsSync(direct)) return direct;
  // older Stryker.NET ignores --output naming: newest timestamped dir written by THIS run only
  const base = join(projectDir, 'StrykerOutput');
  if (!existsSync(base)) return null;
  const candidates = readdirSync(base)
    .map((d) => join(base, d, 'reports', 'mutation-report.json'))
    .filter((p) => existsSync(p) && statSync(p).mtimeMs >= sinceMs)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

/** Kill compiler-server / testhost processes a .NET run left behind (only ones started at/after the run). */
export async function reapDotnetLeftovers(sinceMs: number, run: ToolRunner = spawnTool): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const since = new Date(sinceMs - 5_000).toISOString();
  const script =
    `$since = [datetime]::Parse('${since}').ToUniversalTime(); ` +
    `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'VBCSCompiler.exe' -or $_.Name -like 'testhost*.exe') -and $_.CreationDate.ToUniversalTime() -ge $since } | ` +
    `ForEach-Object { taskkill /T /F /PID $_.ProcessId | Out-Null; "$($_.ProcessId) $($_.Name)" }`;
  let out = '';
  await run({ command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script], cwd: process.cwd(), env: process.env, timeoutMs: 60_000 }, (s) => {
    out += s;
  });
  return out.split(/\r?\n/).filter((l) => l.trim());
}

export interface MutateOutcome {
  tool: MutationTool;
  toolVersion: string;
  report: ParsedMutationReport;
  verdict: MutationVerdict;
  durationMs: number;
  reportPath: string;
  reaped: string[];
}

export interface MutateDeps {
  run: ToolRunner;
  onOutput: (s: string) => void;
  env: Record<string, string | undefined>;
  timeoutMs?: number;
  /** test seam: where dotnet-stryker lives (default: ensureDotnetStryker) */
  dotnetStrykerExe?: string;
  reap?: (sinceMs: number) => Promise<string[]>;
  now?: () => number;
}

/** Run the mutation tool for the unit's track against the learner's project dir and evaluate the gate locally. */
export async function mutateProject(detail: UnitDetailResponse, projectDir: string, deps: MutateDeps): Promise<MutateOutcome> {
  const { unit } = detail;
  if (!PROJECT_KINDS.includes(unit.kind)) {
    throw new MutateError(
      `"${unit.title}" is a ${unit.kind} unit. The mutation gate applies to solo-project units only (${PROJECT_KINDS.join(', ')}) — never to drills.`,
    );
  }
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) throw new MutateError(`project directory not found: ${projectDir}`);
  const timeoutMs = Math.min(deps.timeoutMs ?? MUTATE_TIMEOUT_MS, MUTATE_TIMEOUT_MS);
  const now = deps.now ?? (() => Date.now());
  const floorPct = floorPctFor(detail.check?.threshold);

  let tool: MutationTool;
  let toolVersion: string;
  let reportPath: string | null;
  let result: ToolResult;
  let reaped: string[] = [];
  if (unit.trackId === 'js') {
    tool = 'stryker-js';
    toolVersion = STRYKER_JS_VERSION;
    // never read a previous run's report: a crashed run must not pass on stale numbers
    rmSync(join(projectDir, JS_REPORT), { force: true });
    result = await deps.run(strykerJsRun(projectDir, deps.env, timeoutMs), deps.onOutput);
    reportPath = join(projectDir, JS_REPORT);
  } else if (unit.trackId === 'csharp') {
    tool = 'stryker-net';
    toolVersion = STRYKER_NET_VERSION;
    const exe = deps.dotnetStrykerExe ?? (await ensureDotnetStryker(deps.run, deps.onOutput));
    rmSync(join(projectDir, NET_OUTPUT), { recursive: true, force: true });
    const started = now();
    try {
      result = await deps.run(strykerNetRun(projectDir, exe, deps.env, timeoutMs), deps.onOutput);
    } finally {
      reaped = await (deps.reap ?? ((t: number) => reapDotnetLeftovers(t)))(started);
    }
    reportPath = findNetReport(projectDir, started);
  } else {
    throw new MutateError(`no mutation tool for track "${unit.trackId}" (JS -> Stryker, C# -> Stryker.NET)`);
  }

  if (result.timedOut) {
    throw new MutateError(`mutation run exceeded the ${Math.round(timeoutMs / 60_000)}-minute hard limit and was killed (process tree); nothing was reported`);
  }
  if (reportPath === null || !existsSync(reportPath)) {
    throw new MutateError(`${tool} exited ${result.exitCode} without a JSON report (${reportPath ?? 'no StrykerOutput'}); see its output above`);
  }
  const report = parseMutationReport(JSON.parse(readFileSync(reportPath, 'utf8')) as unknown);
  const verdict = evaluateMutation(report.files, { floorPct });
  return { tool, toolVersion, report, verdict, durationMs: result.durationMs, reportPath, reaped };
}

/** Learner-facing summary: per-file scores + the surviving mutants (the teaching payload). */
export function formatMutation(o: MutateOutcome, maxSurvivors = 25): string {
  const lines: string[] = [];
  lines.push(`${o.tool} ${o.toolVersion} in ${Math.round(o.durationMs / 1000)}s — report ${o.reportPath}`);
  lines.push(`Gate: every file >= ${o.verdict.floorPct}% (default ${DEFAULT_FILE_FLOOR_PCT}) AND overall >= ${o.verdict.breakPct}%`);
  for (const f of o.verdict.files) {
    lines.push(`  ${f.pass ? 'ok  ' : 'FAIL'}  ${f.scorePct === null ? '  n/a' : `${f.scorePct.toFixed(2).padStart(6)}%`}  ${f.path}`);
  }
  lines.push(`Overall: ${o.verdict.overallPct === null ? 'n/a' : `${o.verdict.overallPct}%`}`);
  if (o.report.survivors.length) {
    lines.push(`Surviving mutants (${o.report.survivors.length}) — tests that did not notice the change:`);
    for (const s of o.report.survivors.slice(0, maxSurvivors)) {
      lines.push(`  ${s.path}:${s.line ?? '?'}  ${s.mutator}${s.replacement !== null ? ` -> ${s.replacement.replace(/\s+/g, ' ').slice(0, 60)}` : ''}${s.status === 'NoCoverage' ? ' (no test covers it)' : ''}`);
    }
    if (o.report.survivors.length > maxSurvivors) lines.push(`  ... ${o.report.survivors.length - maxSurvivors} more in the report`);
  }
  lines.push(o.verdict.pass ? 'PASS: the tests kill enough mutants.' : `FAIL: ${o.verdict.failures.join('; ')}`);
  if (o.reaped.length) lines.push(`Reaped leftover .NET processes: ${o.reaped.join(', ')}`);
  return lines.join('\n');
}
