import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Builds learner-style git repos for the repo-check fixture lesson
 * (check-lessons.json, fixture:repo-feature-branch) in a caller-owned temp
 * dir. `good` satisfies every predicate; each broken variant breaks the
 * predicate(s) named in BROKEN_VARIANTS and nothing else.
 *
 * Cost matters (git spawns are ~100ms each on Windows and the suites share
 * the CPU with process-spawning runner tests): the `good` history is built
 * ONCE per parent dir as a template, every variant is a directory copy of it
 * plus 0-2 git commands.
 */
export type RepoVariant =
  | 'good'
  | 'no-branch'
  | 'other-branch'
  | 'detached'
  | 'uncommitted-file'
  | 'dirty'
  | 'few-commits'
  | 'bad-message'
  | 'empty';

/** variant -> the predicate names (fixture lesson) that must FAIL against it — exactly these. */
export const BROKEN_VARIANTS: Readonly<Record<Exclude<RepoVariant, 'good' | 'empty'>, readonly string[]>> = {
  'no-branch': ['feature branch exists', 'you are on the feature branch'],
  'other-branch': ['you are on the feature branch'],
  detached: ['you are on the feature branch'],
  'uncommitted-file': ['decision record committed'],
  dirty: ['nothing left uncommitted'],
  'few-commits': ['small commits (3+)'],
  'bad-message': ['conventional commit message'],
};

// Deterministic identity/config; never touches the developer's global settings beyond reading them.
const GIT_CFG = ['-c', 'user.name=Fixture Learner', '-c', 'user.email=learner@example.invalid', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
  return env;
}

/** Synchronous git in a fixture repo (test setup helper). */
export function git(repo: string, ...args: string[]): string {
  return execFileSync('git', [...GIT_CFG, '-C', repo, ...args], { encoding: 'utf8', env: cleanEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

const execFileP = promisify(execFile);

async function gitA(repo: string, ...args: string[]): Promise<void> {
  await execFileP('git', [...GIT_CFG, '-C', repo, ...args], { env: cleanEnv(), windowsHide: true });
}

function write(repo: string, rel: string, text: string): void {
  const p = join(repo, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

async function commit(repo: string, message: string, files: Record<string, string>): Promise<void> {
  for (const [rel, text] of Object.entries(files)) write(repo, rel, text);
  await gitA(repo, 'add', '--', ...Object.keys(files));
  await gitA(repo, 'commit', '-q', '-m', message);
}

/** The `good` history: main (1 commit) -> feat/add-tasks (+2 conventional commits incl. docs/DECISIONS.md), HEAD on it, clean. */
async function buildGood(repo: string): Promise<void> {
  mkdirSync(repo, { recursive: true });
  await gitA(repo, 'init', '-q', '-b', 'main');
  await commit(repo, 'chore: initial skeleton', { 'README.md': '# tasks\n', 'src/index.js': 'export {};\n' });
  await gitA(repo, 'checkout', '-q', '-b', 'feat/add-tasks');
  await commit(repo, 'feat: add the tasks module', { 'src/tasks.js': 'export const tasks = [];\n' });
  await commit(repo, 'docs: record the storage decision', { 'docs/DECISIONS.md': '# Decisions\n\n- tasks live in memory for now\n' });
}

const templates = new Map<string, Promise<string>>();

function template(parent: string): Promise<string> {
  let t = templates.get(parent);
  if (!t) {
    const dir = join(parent, '.template-good');
    t = buildGood(dir).then(() => dir);
    templates.set(parent, t);
  }
  return t;
}

/** Create `<parent>/<name ?? variant>` as a git repo in the given state; resolves to its path. */
export async function buildFixtureRepo(parent: string, variant: RepoVariant, name: string = variant): Promise<string> {
  const repo = join(parent, name);
  if (variant === 'empty') {
    mkdirSync(repo, { recursive: true });
    await gitA(repo, 'init', '-q', '-b', 'main');
    return repo;
  }
  cpSync(await template(parent), repo, { recursive: true });
  switch (variant) {
    case 'good':
      break;
    case 'no-branch':
      await gitA(repo, 'branch', '-q', '-m', 'feat/add-tasks', 'feature');
      break;
    case 'other-branch':
      await gitA(repo, 'checkout', '-q', '-b', 'wip');
      break;
    case 'detached':
      await gitA(repo, 'checkout', '-q', '--detach');
      break;
    case 'uncommitted-file':
      // docs/DECISIONS.md stays on disk but leaves the HEAD tree; ignored via .git/info/exclude so the tree is clean
      await gitA(repo, 'rm', '-q', '--cached', '--', 'docs/DECISIONS.md');
      appendFileSync(join(repo, '.git', 'info', 'exclude'), '\ndocs/DECISIONS.md\n');
      write(repo, 'test/tasks.test.js', '// tests\n');
      await gitA(repo, 'add', '--', 'test/tasks.test.js');
      await gitA(repo, 'commit', '-q', '--amend', '-m', 'test: cover the tasks module');
      break;
    case 'dirty':
      write(repo, 'README.md', '# tasks\n\nedited but not committed\n');
      break;
    case 'few-commits':
      await gitA(repo, 'reset', '-q', '--soft', 'HEAD~2');
      await gitA(repo, 'commit', '-q', '-m', 'feat: add tasks and record the decision');
      break;
    case 'bad-message':
      await gitA(repo, 'commit', '-q', '--amend', '-m', 'stuff');
      break;
    default: {
      const never: never = variant;
      throw new Error(`unknown variant ${String(never)}`);
    }
  }
  return repo;
}
