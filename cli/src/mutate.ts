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
 *                  under .cache/tools), UseSharedCompilation=false, and whatever
 *                  of the spawned Stryker.NET process tree outlives the run
 *                  (VBCSCompiler, testhost, ...) is killed — never by name system-wide;
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
  /** called with the spawned process's pid (the C# leftover reaper tracks its tree from it) */
  onSpawn?: (pid: number) => void;
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
    if (child.pid !== undefined && run.onSpawn) {
      try {
        run.onSpawn(child.pid);
      } catch {
        /* tracking is best-effort; never break the run */
      }
    }
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

/*
 * Leftover reaping (C#): ONLY processes descended from the Stryker.NET process this
 * CLI spawned — never by name system-wide (that killed a server-side C# grade or an
 * IDE test run that happened to start a testhost/VBCSCompiler meanwhile).
 *
 * Windows does not re-parent orphans: a leftover's ParentProcessId still names its
 * (possibly dead) parent. So while Stryker runs, a watcher samples the process table
 * (pid, ppid, creation time) and the pure observeSnapshot() grows the descendant set
 * from the root pid; intermediates that later exit (dotnet test, csc) stay in the set,
 * so their orphans are still recognised. Identity is pid@creationTime, and a child is
 * attributed to a parent only if it was created after that parent and before any
 * stranger that reused the parent's pid (every such stranger is remembered, also after it
 * exits), and the root itself must have been born by attach() (a holder of the root pid
 * born later reused the pid of a Stryker that died before the first sample). After the run, a final snapshot picks the
 * still-alive members and only those are killed. Limitation (deliberately conservative):
 * an intermediate that lives shorter than one sample (~2s; the first takes a cold
 * PowerShell start) is never seen, so ITS orphans are left alone rather than guessed at.
 */

/** One row of a process-table snapshot. */
export interface ProcInfo {
  pid: number;
  ppid: number;
  /** creation time, epoch ms */
  createdMs: number;
  name: string;
}

export interface TreeState {
  rootPid: number;
  /** the root was spawned at/after this (its creation time until first seen) */
  notBeforeMs: number;
  /**
   * ...and at/before this (attach() time + clock slack): a process holding the root pid that was born
   * later is a stranger that reused the pid of a root which died before the first snapshot
   */
  notAfterMs: number;
  rootSeen: boolean;
  members: Map<string, ProcInfo>;
  /**
   * every non-member ever seen holding a member's pid, born after that member (pid reuse). Remembered
   * after the stranger exits: a process whose ppid names that pid and that was born at/after the
   * stranger is the stranger's child, never the member's.
   */
  strangers: Map<string, ProcInfo>;
}

const procKey = (p: ProcInfo): string => `${p.pid}@${p.createdMs}`;

/** WMI creation times and Date.now() share the system clock; the slack only absorbs rounding */
export const ROOT_CLOCK_SLACK_MS = 500;

export function newTreeState(rootPid: number, notBeforeMs: number, notAfterMs: number = Number.POSITIVE_INFINITY): TreeState {
  const seed: ProcInfo = { pid: rootPid, ppid: -1, createdMs: notBeforeMs, name: '(root)' };
  return { rootPid, notBeforeMs, notAfterMs, rootSeen: false, members: new Map([[procKey(seed), seed]]), strangers: new Map() };
}

/** Did a stranger take member k's pid at/before p was born? Then p (ppid = k.pid) is not k's child. */
function bornAfterPidReuse(p: ProcInfo, k: ProcInfo, state: TreeState): boolean {
  for (const s of state.strangers.values()) {
    if (s.pid === k.pid && s.createdMs > k.createdMs && p.createdMs >= s.createdMs && !state.members.has(procKey(s))) return true;
  }
  return false;
}

/** Parse `pid ppid createdMs name` lines (the PowerShell snapshot format); junk lines are skipped. */
export function parseSnapshot(text: string): ProcInfo[] {
  const out: ProcInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), createdMs: Number(m[3]), name: m[4]! });
  }
  return out;
}

function childOfMember(p: ProcInfo, state: TreeState, live: Map<number, ProcInfo>): boolean {
  const holder = live.get(p.ppid);
  for (const k of state.members.values()) {
    if (k.pid !== p.ppid || p.createdMs < k.createdMs) continue;
    // the parent pid now belongs to a stranger born after k: p is the stranger's child if born after it
    if (holder && !state.members.has(procKey(holder)) && holder.createdMs >= k.createdMs && p.createdMs >= holder.createdMs) continue;
    // ...or a stranger that held it in an EARLIER snapshot and has exited since
    if (bornAfterPidReuse(p, k, state)) continue;
    return true;
  }
  return false;
}

/** Grow the descendant set from one snapshot (pure apart from mutating `state`). */
export function observeSnapshot(state: TreeState, snapshot: readonly ProcInfo[]): void {
  if (!state.rootSeen) {
    // the root existed by attach(): a holder of its pid born after that is a pid-reusing stranger
    const root = snapshot.find((p) => p.pid === state.rootPid && p.createdMs >= state.notBeforeMs && p.createdMs <= state.notAfterMs);
    if (root) {
      state.members.clear();
      state.members.set(procKey(root), root);
      state.rootSeen = true;
    }
  }
  const live = new Map(snapshot.map((p) => [p.pid, p]));
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of snapshot) {
      if (state.members.has(procKey(p)) || p.pid === p.ppid) continue;
      if (childOfMember(p, state, live)) {
        state.members.set(procKey(p), p);
        grew = true;
      }
    }
  }
  // remember every pid-reusing stranger (it may exit before its children are sampled)
  for (const p of snapshot) {
    if (state.members.has(procKey(p))) continue;
    for (const k of state.members.values()) {
      if (k.pid === p.pid && p.createdMs > k.createdMs) {
        state.strangers.set(procKey(p), p);
        break;
      }
    }
  }
}

/** Members of the tree still alive in `snapshot` (same pid AND creation time), excluding `selfPid`. */
export function selectLeftovers(state: TreeState, snapshot: readonly ProcInfo[], selfPid: number = process.pid): ProcInfo[] {
  observeSnapshot(state, snapshot);
  return snapshot.filter((p) => p.pid !== selfPid && state.members.has(procKey(p)));
}

/** PowerShell: print processes created at/after $since as `pid ppid createdMs name`. */
function snapScript(sinceMs: number): string {
  return (
    `$since = ${Math.floor(sinceMs)}; ` +
    `function Snap { Get-CimInstance -ClassName Win32_Process | ForEach-Object { if ($_.CreationDate) { ` +
    `$c = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(); ` +
    `if ($c -ge $since) { "$($_.ProcessId) $($_.ParentProcessId) $c $($_.Name)" } } } }; `
  );
}

/** Watches one spawned tool's process tree; reap() kills what is left of it. */
export interface ProcessTracker {
  /** the spawned tool's pid (ToolRun.onSpawn) */
  attach(pid: number): void;
  /** final snapshot, kill the tree's surviving members, stop watching; returns "pid name" lines */
  reap(): Promise<string[]>;
}

const NOOP_TRACKER: ProcessTracker = { attach: () => {}, reap: async () => [] };

/** Default tracker: Windows only (elsewhere the detached process group is tree-killed already). */
export function trackDotnetDescendants(sinceMs: number, run: ToolRunner = spawnTool): ProcessTracker {
  if (process.platform !== 'win32') return NOOP_TRACKER;
  const notBefore = sinceMs - 2_000;
  let state: TreeState | null = null;
  let watcher: ReturnType<typeof spawn> | null = null;
  let buf = '';
  // complete snapshots end with a `--` line; a trailing partial one is never parsed
  const flush = () => {
    const parts = buf.split(/^--\s*$/m);
    buf = parts.pop()!;
    for (const block of parts) if (state) observeSnapshot(state, parseSnapshot(block));  };
  return {
    attach(pid) {
      // the spawned root exists by now: bound its creation time (a pid holder born later is a stranger)
      state = newTreeState(pid, notBefore, Date.now() + ROOT_CLOCK_SLACK_MS);
      const loop =
        snapScript(notBefore) +
        `while ((Get-Process -Id ${pid} -ErrorAction SilentlyContinue) -and (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)) ` +
        `{ Snap; '--'; [Console]::Out.Flush(); Start-Sleep -Milliseconds 1500 }`;
      try {
        watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', loop], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
        watcher.stdout?.on('data', (b: Buffer) => {
          buf += b.toString('utf8');
          flush();
        });
        watcher.once('error', () => {
          watcher = null;
        });
      } catch {
        watcher = null; // the final snapshot still catches direct orphans of the root
      }
    },
    async reap() {
      if (watcher) {
        try {
          watcher.kill();
        } catch {
          /* already gone */
        }
      }
      if (!state) return []; // never spawned: nothing of ours can exist
      flush();
      const tree: TreeState = state;
      let out = '';
      await run({ command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `${snapScript(notBefore)}Snap`], cwd: process.cwd(), env: process.env, timeoutMs: 60_000 }, (s) => {
        out += s;
      });
      const leftovers = selectLeftovers(tree, parseSnapshot(out));
      for (const p of leftovers) {
        // verified member of OUR tree (pid@creationTime from a snapshot taken just now)
        await run({ command: 'taskkill', args: ['/T', '/F', '/PID', String(p.pid)], cwd: process.cwd(), env: process.env, timeoutMs: 30_000 }, () => {});
      }
      return leftovers.map((p) => `${p.pid} ${p.name}`);
    },
  };
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
  /** test seam: the C# leftover tracker (default: trackDotnetDescendants — the spawned tree only) */
  tracker?: (sinceMs: number) => ProcessTracker;
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
    const tracker = (deps.tracker ?? ((t: number) => trackDotnetDescendants(t)))(started);
    try {
      result = await deps.run({ ...strykerNetRun(projectDir, exe, deps.env, timeoutMs), onSpawn: (pid) => tracker.attach(pid) }, deps.onOutput);
    } finally {
      reaped = await tracker.reap();
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
