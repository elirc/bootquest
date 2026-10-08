import { execFile } from 'node:child_process';
import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { RepoCheck, RepoPredicate } from '@bootquest/shared';
import type { z } from 'zod';

/**
 * Repo check runner (spec §4, W3c): ordered predicates over a LOCAL git
 * working tree, one named test per predicate.
 *
 * Trust / safety model:
 *   - the learner supplies only `repoPath`; validateRepoPath() demands an
 *     ABSOLUTE path with no `..` segment, not a UNC/network path, an existing
 *     directory whose `.git` is a real directory (no symlink, no gitdir file);
 *   - git always runs as `git -C <realpath> ...` (never a cd) with GIT_DIR /
 *     GIT_WORK_TREE pinned to that repo and GIT_CEILING_DIRECTORIES at its
 *     parent, every inherited GIT_* variable dropped — git can never wander to
 *     an enclosing repo;
 *   - nothing in the repo is executed: only read-only plumbing runs, with
 *     core.fsmonitor=false (a configured fsmonitor is a hook command),
 *     log.showSignature=false (would run gpg), and --attr-source=<empty tree>
 *     so the repo's .gitattributes cannot route `git status` through a
 *     clean/smudge filter command (requires git >= 2.40);
 *   - clean-worktree ignores the BootQuest marker `.bootquest.json` at the repo
 *     root (the CLI asks learners to create it there; it is not their work);
 *   - REMOTE predicates (ci-green, pr-has-section) use the gh CLI's existing
 *     login (deviation already recorded: a fine-grained read-only PAT is an
 *     owner to-do). No gh / not logged in => that predicate FAILS with
 *     "skipped: no token ..." — never a silent pass.
 */

export type RepoCheckSpec = z.infer<typeof RepoCheck>;

export interface RepoFailure {
  name: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface RepoRunResult {
  pass: boolean;
  output: string;
  failures: RepoFailure[];
  durationMs: number;
}

export class RepoPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoPathError';
  }
}

/** Validate the learner-supplied repo path; returns the real path git will run in. */
export function validateRepoPath(raw: string): string {
  if (!isAbsolute(raw)) throw new RepoPathError(`repoPath must be an absolute path (got "${raw}")`);
  if (raw.split(/[\\/]+/).includes('..')) throw new RepoPathError('repoPath must not contain .. segments');
  if (/^[\\/]{2}/.test(raw)) throw new RepoPathError('repoPath must be a local path, not a UNC/network path');
  let st;
  try {
    st = statSync(raw);
  } catch {
    throw new RepoPathError(`repoPath does not exist: ${raw}`);
  }
  if (!st.isDirectory()) throw new RepoPathError(`repoPath is not a directory: ${raw}`);
  const real = realpathSync.native(raw);
  let gst;
  try {
    gst = lstatSync(join(real, '.git'));
  } catch {
    throw new RepoPathError(`repoPath is not the root of a git working tree (no .git in ${raw})`);
  }
  if (gst.isSymbolicLink()) throw new RepoPathError(`${join(raw, '.git')} is a symlink; point repoPath at the real repository`);
  if (!gst.isDirectory()) {
    throw new RepoPathError(`${join(raw, '.git')} is a file (a linked worktree or submodule); point repoPath at the main working tree`);
  }
  return real;
}

// ---------------------------------------------------------------- process plumbing

export interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class ToolMissingError extends Error {
  constructor(tool: string) {
    super(`${tool} is not installed or not on PATH`);
    this.name = 'ToolMissingError';
  }
}

function runProc(file: string, args: string[], opts: { env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { env: opts.env, timeout: opts.timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { code?: unknown; killed?: boolean; signal?: string | null };
          if (e.code === 'ENOENT') return reject(new ToolMissingError(file));
          if (e.killed || e.signal) return reject(new Error(`${file} ${args[0] ?? ''} timed out after ${opts.timeoutMs}ms`));
          if (typeof e.code === 'number') return resolve({ code: e.code, stdout, stderr });
          return reject(err);
        }
        resolve({ code: 0, stdout, stderr });
      },
    );
  });
}

/** Inherited env minus every GIT_* variable (they could redirect git to another repo / index). */
function scrubbedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
  return env;
}

const EMPTY_TREE_SHA1 = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const EMPTY_TREE_SHA256 = '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321';

export type GitExec = (args: string[]) => Promise<ProcResult>;

export interface ConfinedGit {
  /**
   * Preflight (ONE git call): can git read this repo at all? Also learns the
   * object format for the empty-tree attr source. Returns the error text, or
   * null when the repo is readable. Must run before `run`.
   */
  init(): Promise<string | null>;
  run: GitExec;
}

/** A git executor confined to one repo (see the safety model above). */
export function confinedGit(repo: string, timeoutMs: number, gitBin = 'git'): ConfinedGit {
  const env: NodeJS.ProcessEnv = {
    ...scrubbedEnv(),
    GIT_DIR: join(repo, '.git'),
    GIT_WORK_TREE: repo,
    GIT_CEILING_DIRECTORIES: dirname(repo),
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
  };
  let emptyTree = EMPTY_TREE_SHA1;
  const base = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '-c', 'core.quotePath=false'];
  return {
    async init() {
      try {
        // rev-parse reads no attributes and runs nothing: safe before the attr source is known
        const r = await runProc(gitBin, [...base, '-C', repo, 'rev-parse', '--is-inside-work-tree', '--show-object-format'], { env, timeoutMs });
        const [inside, format] = r.stdout.trim().split(/\r?\n/);
        if (r.code !== 0 || inside !== 'true') return (r.stderr || r.stdout).trim() || `git exited ${r.code}`;
        if (format === 'sha256') emptyTree = EMPTY_TREE_SHA256;
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    run: (args) => runProc(gitBin, [...base, `--attr-source=${emptyTree}`, '-C', repo, ...args], { env, timeoutMs }),
  };
}

/** gh CLI executor: (args) -> result; rejects ToolMissingError when gh is absent. */
export type GhExec = (args: string[], timeoutMs: number) => Promise<ProcResult>;

export const realGh: GhExec = (args, timeoutMs) =>
  runProc('gh', args, {
    env: { ...scrubbedEnv(), GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
    timeoutMs,
  });

// ---------------------------------------------------------------- repo facts (lazy, cached per run)

interface StatusFacts {
  /** HEAD commit sha, null when HEAD is unborn */
  oid: string | null;
  /** current branch, null when detached */
  branch: string | null;
  /** porcelain v2 change lines (tracked changes + untracked) */
  dirty: string[];
}

/**
 * Every git fact a predicate needs, each fetched at most once per run: one
 * `status --porcelain=v2 --branch` (HEAD sha + branch + dirtiness) and one
 * `for-each-ref refs/heads` (branches) cover most predicates. Spawning git on
 * Windows costs ~100ms, so this halves a typical check's wall time.
 */
class RepoFacts {
  private statusP: Promise<StatusFacts> | null = null;
  private headsP: Promise<Map<string, string>> | null = null;
  constructor(readonly git: GitExec) {}

  status(): Promise<StatusFacts> {
    this.statusP ??= (async () => {
      // the BootQuest marker file (.bootquest.json at the repo root) never makes a tree "dirty"
      const r = await this.git(['status', '--porcelain=v2', '--branch', '--untracked-files=normal', '--', ':(top,exclude).bootquest.json']);
      if (r.code !== 0) throw new Error(`git status failed: ${(r.stderr || r.stdout).trim()}`);
      const facts: StatusFacts = { oid: null, branch: null, dirty: [] };
      for (const line of r.stdout.split(/\r?\n/)) {
        if (!line) continue;
        if (line.startsWith('# branch.oid ')) {
          const v = line.slice('# branch.oid '.length).trim();
          facts.oid = v === '(initial)' ? null : v;
        } else if (line.startsWith('# branch.head ')) {
          const v = line.slice('# branch.head '.length).trim();
          facts.branch = v === '(detached)' ? null : v;
        } else if (!line.startsWith('#')) {
          facts.dirty.push(line);
        }
      }
      return facts;
    })();
    return this.statusP;
  }

  heads(): Promise<Map<string, string>> {
    this.headsP ??= (async () => {
      const r = await this.git(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads/']);
      const map = new Map<string, string>();
      for (const line of r.stdout.split(/\r?\n/)) {
        const m = /^([0-9a-f]+) refs\/heads\/(.+)$/.exec(line.trim());
        if (m) map.set(m[2]!, m[1]!);
      }
      return map;
    })();
    return this.headsP;
  }

  /** Commit sha of <branch> (or HEAD when undefined); null when missing / unborn. */
  async commit(branch: string | undefined): Promise<string | null> {
    if (branch === undefined) return (await this.status()).oid;
    return (await this.heads()).get(branch) ?? null;
  }
}

// ---------------------------------------------------------------- predicates

interface Outcome {
  ok: boolean;
  message?: string;
  expected?: unknown;
  actual?: unknown;
}

const pass = (): Outcome => ({ ok: true });
const fail = (message: string, expected?: unknown, actual?: unknown): Outcome => ({ ok: false, message, expected, actual });

function refLabel(branch: string | undefined): string {
  return branch === undefined ? 'HEAD' : `branch ${branch}`;
}

/** Porcelain v2 change line -> short "XY path" for messages. */
function shortChange(line: string): string {
  if (line.startsWith('? ')) return `?? ${line.slice(2)}`;
  const parts = line.split(' ');
  if (line.startsWith('1 ')) return `${parts[1]} ${parts.slice(8).join(' ')}`;
  if (line.startsWith('2 ')) return `${parts[1]} ${parts.slice(9).join(' ').split('\t')[0]}`;
  if (line.startsWith('u ')) return `${parts[1]} ${parts.slice(10).join(' ')}`;
  return line;
}

async function missingRef(facts: RepoFacts, branch: string | undefined): Promise<Outcome> {
  if (branch === undefined) return fail('HEAD has no commits yet', 'at least one commit', '(no commits)');
  const have = [...(await facts.heads()).keys()].sort().slice(0, 20);
  return fail(`branch ${branch} does not exist`, `branch ${branch}`, have.length ? `branches: ${have.join(', ')}` : '(no branches)');
}

function firstLine(s: string): string {
  return (s.trim().split(/\r?\n/)[0] ?? '').slice(0, 120);
}

/** Markdown section check (ATX headings only): `heading` (case-insensitive) followed by non-empty prose. */
export function sectionStatus(body: string, heading: string): 'ok' | 'empty' | 'missing' {
  const lines = body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const want = heading.trim().toLowerCase();
  const headingRe = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]!);
    if (!m || m[2]!.trim().toLowerCase() !== want) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (headingRe.test(lines[j]!)) break;
      if (lines[j]!.trim()) return 'ok';
    }
    return 'empty';
  }
  return 'missing';
}

/** owner/name of a github.com origin URL (https, ssh or scp-style), else null. */
export function githubRepoOf(url: string): string | null {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

interface RemoteCtx {
  gh: GhExec;
  timeoutMs: number;
  token: Promise<Outcome | null> | null;
}

/** null = gh is installed and logged in; otherwise the "skipped: no token" failure. Probed once per run. */
async function ghReady(ctx: RemoteCtx): Promise<Outcome | null> {
  ctx.token ??= (async () => {
    const note = 'remote predicates use the gh CLI login (a fine-grained read-only PAT is an owner to-do)';
    try {
      const r = await ctx.gh(['auth', 'token'], ctx.timeoutMs);
      if (r.code === 0 && r.stdout.trim()) return null;
      return fail(`skipped: no token - gh is not logged in (run \`gh auth login\`); ${note}`, 'a GitHub token from gh', '(none)');
    } catch (err) {
      if (err instanceof ToolMissingError) return fail(`skipped: no token - the gh CLI is not installed; ${note}`, 'a GitHub token from gh', '(gh not found)');
      return fail(`skipped: no token - ${err instanceof Error ? err.message : String(err)}; ${note}`, 'a GitHub token from gh', '(error)');
    }
  })();
  return ctx.token;
}

async function githubRepo(git: GitExec): Promise<string | Outcome> {
  const r = await git(['remote', 'get-url', 'origin']);
  if (r.code !== 0) return fail('no "origin" remote: remote predicates need a GitHub origin', 'origin -> github.com/<owner>/<repo>', '(no origin)');
  const repo = githubRepoOf(r.stdout);
  return repo ?? fail(`origin is not a github.com repository (${r.stdout.trim()})`, 'origin -> github.com/<owner>/<repo>', r.stdout.trim());
}

async function ghJson(ctx: RemoteCtx, path: string): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  const r = await ctx.gh(['api', '-H', 'Accept: application/vnd.github+json', path], ctx.timeoutMs);
  if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).trim() || `gh exited ${r.code}` };
  try {
    return { ok: true, json: JSON.parse(r.stdout) };
  } catch {
    return { ok: false, error: 'gh api returned non-JSON' };
  }
}

const GREEN = new Set(['success', 'skipped', 'neutral']);

async function evaluate(p: RepoPredicate, facts: RepoFacts, repo: string, remote: RemoteCtx): Promise<Outcome> {
  const git = facts.git;
  switch (p.kind) {
    case 'branch-exists': {
      if (await facts.commit(p.branch)) return pass();
      return missingRef(facts, p.branch);
    }
    case 'head-on-branch': {
      const s = await facts.status();
      if (s.branch === p.branch) return pass();
      if (s.branch !== null) return fail(`HEAD is on ${s.branch}, not ${p.branch}`, `HEAD on ${p.branch}`, `HEAD on ${s.branch}`);
      const at = s.oid ? ` at ${s.oid.slice(0, 7)}` : '';
      return fail(`HEAD is detached${at}, not on ${p.branch}`, `HEAD on ${p.branch}`, `detached HEAD${at}`);
    }
    case 'file-exists-at-head': {
      const path = p.path.replace(/\\/g, '/');
      if (!(await facts.commit(undefined))) return missingRef(facts, undefined);
      const r = await git(['cat-file', '-t', '--end-of-options', `HEAD:${path}`]);
      const type = r.stdout.trim();
      if (r.code === 0 && type === 'blob') return pass();
      if (r.code === 0) return fail(`${path} is a ${type} at HEAD, not a file`, `file ${path} committed at HEAD`, `${type} ${path}`);
      const onDisk = existsSync(join(repo, ...path.split('/')));
      return fail(
        onDisk ? `${path} exists on disk but is not committed at HEAD (git add + commit it)` : `${path} is not in the HEAD commit`,
        `file ${path} committed at HEAD`,
        onDisk ? 'present in the working tree, not committed' : '(absent)',
      );
    }
    case 'clean-worktree': {
      const dirty = (await facts.status()).dirty.map(shortChange);
      if (dirty.length === 0) return pass();
      const shown = dirty.slice(0, 10).join('; ');
      return fail(
        `working tree has ${dirty.length} uncommitted change${dirty.length === 1 ? '' : 's'}: ${shown}${dirty.length > 10 ? '; ...' : ''}`,
        'clean working tree',
        `${dirty.length} change(s): ${shown}`,
      );
    }
    case 'min-commits': {
      const sha = await facts.commit(p.branch);
      if (!sha) return missingRef(facts, p.branch);
      const r = await git(['rev-list', '--count', '--end-of-options', sha]);
      const n = Number(r.stdout.trim());
      if (r.code === 0 && n >= p.n) return pass();
      return fail(`${refLabel(p.branch)} has ${n} commit${n === 1 ? '' : 's'}; at least ${p.n} required`, `>= ${p.n} commits`, `${n} commits`);
    }
    case 'commit-message-matches': {
      const sha = await facts.commit(p.branch);
      if (!sha) return missingRef(facts, p.branch);
      const re = new RegExp(p.pattern, p.flags ?? '');
      const wanted = `/${p.pattern}/${p.flags ?? ''}`;
      if (p.which === 'tip') {
        const r = await git(['log', '-1', '--format=%B', '--end-of-options', sha]);
        const msg = r.stdout.replace(/\s+$/, '');
        if (re.test(msg)) return pass();
        return fail(`the newest commit message on ${refLabel(p.branch)} does not match`, `message matching ${wanted}`, firstLine(msg));
      }
      const r = await git(['log', '-n', '200', '--format=%B%x00', '--end-of-options', sha]);
      const msgs = r.stdout.split('\0').map((m) => m.replace(/^\s+|\s+$/g, '')).filter(Boolean);
      if (msgs.some((m) => re.test(m))) return pass();
      return fail(`none of the newest ${msgs.length} commit messages on ${refLabel(p.branch)} match`, `a message matching ${wanted}`, `newest: ${firstLine(msgs[0] ?? '')}`);
    }
    case 'ci-green': {
      const noToken = await ghReady(remote);
      if (noToken) return noToken;
      const sha = await facts.commit(p.branch);
      if (!sha) return missingRef(facts, p.branch);
      const gh = await githubRepo(git);
      if (typeof gh !== 'string') return gh;
      const res = await ghJson(remote, `repos/${gh}/commits/${sha}/check-runs?per_page=100`);
      if (!res.ok) {
        return /No commit found|422|404/.test(res.error)
          ? fail(`commit ${sha.slice(0, 7)} is not on GitHub (${gh}) - push it first`, `CI green on ${sha.slice(0, 7)}`, res.error)
          : fail(`gh api failed: ${res.error}`, `CI green on ${sha.slice(0, 7)}`, res.error);
      }
      const runs = (res.json as { check_runs?: { name?: string; status?: string; conclusion?: string | null }[] }).check_runs ?? [];
      if (runs.length === 0) return fail(`no CI check runs on ${sha.slice(0, 7)} in ${gh}`, 'at least one green check run', '(no check runs)');
      const pending = runs.filter((r) => r.status !== 'completed').map((r) => r.name ?? '?');
      if (pending.length) return fail(`CI still running on ${sha.slice(0, 7)}: ${pending.join(', ')}`, 'all check runs completed green', `pending: ${pending.join(', ')}`);
      const red = runs.filter((r) => !GREEN.has(String(r.conclusion))).map((r) => `${r.name ?? '?'}=${String(r.conclusion)}`);
      if (red.length) return fail(`CI is not green on ${sha.slice(0, 7)}: ${red.join(', ')}`, 'all check runs completed green', red.join(', '));
      return pass();
    }
    case 'pr-has-section': {
      const noToken = await ghReady(remote);
      if (noToken) return noToken;
      const branch = p.branch ?? (await facts.status()).branch;
      if (branch === null) return fail('HEAD is detached: cannot tell which branch the PR comes from', 'HEAD on the PR branch', 'detached HEAD');
      const gh = await githubRepo(git);
      if (typeof gh !== 'string') return gh;
      const owner = gh.split('/')[0]!;
      const res = await ghJson(remote, `repos/${gh}/pulls?state=all&per_page=1&sort=created&direction=desc&head=${encodeURIComponent(`${owner}:${branch}`)}`);
      if (!res.ok) return fail(`gh api failed: ${res.error}`, `a PR from ${branch}`, res.error);
      const prs = res.json as { number?: number; body?: string | null }[];
      const pr = Array.isArray(prs) ? prs[0] : undefined;
      if (!pr) return fail(`no pull request from ${branch} in ${gh}`, `a PR from ${branch}`, '(no PR)');
      const status = sectionStatus(pr.body ?? '', p.heading);
      if (status === 'ok') return pass();
      return status === 'empty'
        ? fail(`PR #${pr.number} has a "${p.heading}" heading but nothing under it`, `## ${p.heading} with content`, 'empty section')
        : fail(`PR #${pr.number} description has no "${p.heading}" section`, `## ${p.heading} with content`, '(no such heading)');
    }
    default: {
      const never: never = p;
      throw new Error(`unknown repo predicate ${JSON.stringify(never)}`);
    }
  }
}

export interface RepoRunOptions {
  /** gh executor (tests inject a fake); default: the real gh CLI */
  gh?: GhExec;
  /** git binary (default "git" on PATH) */
  gitBin?: string;
}

export async function runRepoCheck(spec: RepoCheckSpec, repoPath: string, opts: RepoRunOptions = {}): Promise<RepoRunResult> {
  const started = performance.now();
  const repo = validateRepoPath(repoPath);
  const git = confinedGit(repo, spec.timeoutMs, opts.gitBin);
  const remote: RemoteCtx = { gh: opts.gh ?? realGh, timeoutMs: spec.timeoutMs, token: null };
  const facts = new RepoFacts(git.run);
  const failures: RepoFailure[] = [];
  const lines: string[] = [`repo ${repo} (${spec.predicates.length} predicate${spec.predicates.length === 1 ? '' : 's'})`];
  // preflight: git must be able to read the repo at all (git missing, dubious ownership, corrupt .git)
  const unreadable = await git.init();
  for (const p of spec.predicates) {
    let o: Outcome;
    try {
      o = unreadable !== null ? fail(`git cannot read this repository: ${unreadable}`) : await evaluate(p, facts, repo, remote);
    } catch (err) {
      o = fail(`could not evaluate: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (o.ok) {
      lines.push(`PASS ${p.name}`);
      continue;
    }
    const f: RepoFailure = { name: p.name, message: o.message ?? 'failed' };
    if (o.expected !== undefined) f.expected = o.expected;
    if (o.actual !== undefined) f.actual = o.actual;
    failures.push(f);
    lines.push(`FAIL ${p.name} - ${f.message}`);
  }
  return { pass: failures.length === 0, output: lines.join('\n'), failures, durationMs: Math.round(performance.now() - started) };
}
