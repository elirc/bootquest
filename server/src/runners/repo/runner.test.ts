import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CheckSpec } from '@bootquest/shared';
import lessons from '../../../test/fixtures/check-lessons.json' with { type: 'json' };
import { BROKEN_VARIANTS, buildFixtureRepo, git, type RepoVariant } from '../../../test/fixtures/repo-fixture.ts';
import {
  githubRepoOf,
  RepoPathError,
  runRepoCheck,
  sectionStatus,
  ToolMissingError,
  validateRepoPath,
  type GhExec,
  type RepoCheckSpec,
  type RepoRunResult,
} from './index.ts';

// spawns git / sockets / child servers: generous timeouts, the suites share the CPU with other process-spawning tests
vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const lessonSpec = CheckSpec.parse(lessons.units.find((u) => u.key === 'fixture:repo-feature-branch')!.checks[0]!.spec) as RepoCheckSpec;
const ALL_NAMES = lessonSpec.predicates.map((p) => p.name);

let tmp: string;
const repos = new Map<RepoVariant, string>();
/** the fixture lesson run once against every variant (in parallel: git spawns are ~100ms each on Windows) */
const results = new Map<RepoVariant, RepoRunResult>();

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'bq-repo-check-'));
  const variants = ['good', 'empty', ...Object.keys(BROKEN_VARIANTS)] as RepoVariant[];
  // allSettled: never leave a git child running (and the dir locked) when one build fails
  const built = await Promise.allSettled(variants.map(async (v) => repos.set(v, await buildFixtureRepo(tmp, v))));
  for (const b of built) if (b.status === 'rejected') throw b.reason;
  // sequential on purpose: the suite shares the CPU with timing-sensitive process-spawning runner tests
  for (const v of variants) results.set(v, await runRepoCheck(lessonSpec, repos.get(v)!));
}, 120_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const T = 30_000;

describe('repo runner against the fixture lesson', () => {
  it('good repo: every predicate is a passing named test', () => {
    const r = results.get('good')!;
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
    for (const n of ALL_NAMES) expect(r.output).toContain(`PASS ${n}`);
  });

  for (const [variant, broken] of Object.entries(BROKEN_VARIANTS)) {
    it(`${variant}: fails exactly ${broken.join(' + ')}`, () => {
      const r = results.get(variant as RepoVariant)!;
      expect(r.pass).toBe(false);
      expect(r.failures.map((f) => f.name)).toEqual(broken);
      for (const f of r.failures) {
        expect(f.message.length).toBeGreaterThan(0);
        expect(f.expected).toBeDefined();
        expect(f.actual).toBeDefined();
      }
    });
  }

  it('failure details: expected/actual name the gap', () => {
    const byName = (v: RepoVariant) => Object.fromEntries(results.get(v)!.failures.map((f) => [f.name, f]));
    expect(byName('no-branch')['feature branch exists']).toMatchObject({
      message: 'branch feat/add-tasks does not exist',
      expected: 'branch feat/add-tasks',
      actual: 'branches: feature, main',
    });
    expect(byName('other-branch')['you are on the feature branch']).toMatchObject({ expected: 'HEAD on feat/add-tasks', actual: 'HEAD on wip' });
    expect(byName('detached')['you are on the feature branch']!.actual).toMatch(/^detached HEAD at [0-9a-f]{7}$/);
    expect(byName('uncommitted-file')['decision record committed']).toMatchObject({
      message: 'docs/DECISIONS.md exists on disk but is not committed at HEAD (git add + commit it)',
      actual: 'present in the working tree, not committed',
    });
    expect(byName('dirty')['nothing left uncommitted']).toMatchObject({ expected: 'clean working tree', actual: '1 change(s): .M README.md' });
    expect(byName('few-commits')['small commits (3+)']).toMatchObject({ expected: '>= 3 commits', actual: '2 commits' });
    expect(byName('bad-message')['conventional commit message']!.actual).toBe('stuff');
  });

  it('empty repo (no commits): commit-dependent predicates say so; clean tree still passes', () => {
    const r = results.get('empty')!;
    const names = r.failures.map((f) => f.name);
    expect(names).not.toContain('nothing left uncommitted');
    expect(r.failures.find((f) => f.name === 'decision record committed')!.message).toBe('HEAD has no commits yet');
    expect(r.failures.find((f) => f.name === 'feature branch exists')!.actual).toBe('(no branches)');
  });

  it('clean-worktree ignores the BootQuest marker .bootquest.json at the repo root (only)', async () => {
    const repo = await buildFixtureRepo(tmp, 'good', 'marker');
    writeFileSync(join(repo, '.bootquest.json'), '{"unitKey":"x"}');
    const s = CheckSpec.parse({ type: 'repo', predicates: [{ kind: 'clean-worktree', name: 'clean' }] }) as RepoCheckSpec;
    expect((await runRepoCheck(s, repo)).failures).toEqual([]);
    writeFileSync(join(repo, 'src', '.bootquest.json'), '{}');
    expect((await runRepoCheck(s, repo)).failures[0]?.actual).toBe('1 change(s): ?? src/.bootquest.json');
  }, T);

  it('commit-message-matches which:any scans history; flags apply', async () => {
    const s = CheckSpec.parse({
      type: 'repo',
      predicates: [
        { kind: 'commit-message-matches', name: 'any feat', pattern: '^feat: ', which: 'any' },
        { kind: 'commit-message-matches', name: 'any FEAT /i', pattern: '^FEAT: ', flags: 'i', which: 'any' },
        { kind: 'commit-message-matches', name: 'tip feat', pattern: '^feat: ' },
        { kind: 'min-commits', name: 'main has 1', n: 1, branch: 'main' },
        { kind: 'min-commits', name: 'main has 2', n: 2, branch: 'main' },
        { kind: 'min-commits', name: 'ghost branch', n: 1, branch: 'nope' },
      ],
    }) as RepoCheckSpec;
    const r = await runRepoCheck(s, repos.get('bad-message')!);
    expect(r.failures.map((f) => f.name)).toEqual(['tip feat', 'main has 2', 'ghost branch']);
  }, T);
});

describe('repoPath validation (request errors, never git calls)', () => {
  it('refuses relative, .., missing, file, no-.git, .git-file and UNC paths', () => {
    const good = repos.get('good')!;
    const sub = join(good, 'src'); // inside a repo but not its root: git must NOT discover the parent
    const plain = join(tmp, 'plain-dir');
    mkdirSync(plain, { recursive: true });
    const gitFile = join(tmp, 'gitfile');
    mkdirSync(gitFile, { recursive: true });
    writeFileSync(join(gitFile, '.git'), `gitdir: ${join(good, '.git')}\n`);
    const cases: [string, RegExp][] = [
      ['relative/path', /absolute path/],
      [`${good}/../good`, /\.\. segments/],
      [join(tmp, 'does-not-exist'), /does not exist/],
      [join(good, 'README.md'), /not a directory/],
      [sub, /not the root of a git working tree/],
      [plain, /not the root of a git working tree/],
      [gitFile, /is a file \(a linked worktree or submodule\)/],
      ['\\\\server\\share\\repo', /UNC/],
    ];
    for (const [p, re] of cases) {
      expect(() => validateRepoPath(p), p).toThrow(RepoPathError);
      expect(() => validateRepoPath(p), p).toThrow(re);
    }
    expect(validateRepoPath(good).toLowerCase()).toBe(good.toLowerCase());
  });

  it('runRepoCheck rejects a bad path before running anything', async () => {
    await expect(runRepoCheck(lessonSpec, 'relative')).rejects.toBeInstanceOf(RepoPathError);
  });
});

describe('never executes repo content', () => {
  it('a configured clean filter and fsmonitor hook do NOT run (control: plain git status DOES run them)', async () => {
    const repo = join(tmp, 'trap');
    mkdirSync(repo);
    const marker = join(tmp, 'trap-marker.txt').replace(/\\/g, '/');
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, '.gitattributes'), '* filter=evil\n');
    writeFileSync(join(repo, 'a.txt'), 'hello\n');
    git(repo, 'add', '.gitattributes', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'feat: trap');
    git(repo, 'config', 'filter.evil.clean', `sh -c 'echo filter >> "${marker}"; cat'`);
    git(repo, 'config', 'core.fsmonitor', `sh -c 'echo fsmonitor >> "${marker}"' --`);
    const stale = () => {
      writeFileSync(join(repo, 'a.txt'), 'hello\n'); // same bytes, newer mtime: stat-dirty
      const t = Date.now() / 1000 + 60;
      utimesSync(join(repo, 'a.txt'), t, t);
    };
    stale();
    const s = CheckSpec.parse({ type: 'repo', predicates: [{ kind: 'clean-worktree', name: 'clean' }, { kind: 'file-exists-at-head', name: 'a', path: 'a.txt' }, { kind: 'commit-message-matches', name: 'm', pattern: 'trap' }] }) as RepoCheckSpec;
    const r = await runRepoCheck(s, repo);
    expect(r.failures).toEqual([]);
    expect(existsSync(marker), 'the runner executed repo-configured commands').toBe(false);
    // control: the trap is real — an unprotected `git status` runs both commands
    stale();
    try {
      execFileSync('git', ['-C', repo, 'status', '--porcelain'], { stdio: 'ignore', windowsHide: true });
    } catch {
      /* exit status irrelevant */
    }
    expect(readFileSync(marker, 'utf8')).toMatch(/filter|fsmonitor/);
  }, T);
});

describe('remote predicates (gh CLI) with an injected gh', () => {
  const remoteSpec = CheckSpec.parse({
    type: 'repo',
    predicates: [
      { kind: 'ci-green', name: 'CI is green' },
      { kind: 'pr-has-section', name: 'PR explains testing', heading: 'Testing' },
    ],
  }) as RepoCheckSpec;

  let remoteRepo: string;
  let headSha: string;
  beforeAll(async () => {
    remoteRepo = await buildFixtureRepo(tmp, 'good', 'remote');
    git(remoteRepo, 'remote', 'add', 'origin', 'https://github.com/elirc/tasks-api.git');
    headSha = git(remoteRepo, 'rev-parse', 'HEAD').trim();
  }, 30_000);

  type Route = (args: string[]) => { code: number; stdout?: string; stderr?: string };
  function fakeGh(route: Route, calls: string[][] = []): GhExec {
    return async (args) => {
      calls.push(args);
      const r = route(args);
      return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
  }
  const loggedIn: Route = (a) => (a[0] === 'auth' ? { code: 0, stdout: 'gho_x\n' } : { code: 1, stderr: 'unexpected' });

  it('gh absent: both remote predicates FAIL as "skipped: no token" (never a silent pass)', async () => {
    const gh: GhExec = async () => {
      throw new ToolMissingError('gh');
    };
    const r = await runRepoCheck(remoteSpec, remoteRepo, { gh });
    expect(r.failures.map((f) => f.name)).toEqual(['CI is green', 'PR explains testing']);
    for (const f of r.failures) expect(f.message).toMatch(/^skipped: no token - the gh CLI is not installed; .*fine-grained read-only PAT is an owner to-do/);
  });

  it('gh not logged in: "skipped: no token"; token probed once per run', async () => {
    const calls: string[][] = [];
    const r = await runRepoCheck(remoteSpec, remoteRepo, { gh: fakeGh(() => ({ code: 1, stderr: 'not logged in' }), calls) });
    for (const f of r.failures) expect(f.message).toMatch(/^skipped: no token - gh is not logged in/);
    expect(calls).toEqual([['auth', 'token']]);
  });

  it('ci-green passes on all-green check runs for the LOCAL tip sha; pr-has-section reads the newest PR from the current branch', async () => {
    const calls: string[][] = [];
    const gh = fakeGh((a) => {
      if (a[0] === 'auth') return { code: 0, stdout: 'gho_x\n' };
      const path = a[a.length - 1]!;
      if (path === `repos/elirc/tasks-api/commits/${headSha}/check-runs?per_page=100`) {
        return { code: 0, stdout: JSON.stringify({ total_count: 2, check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }, { name: 'lint', status: 'completed', conclusion: 'skipped' }] }) };
      }
      if (path.startsWith('repos/elirc/tasks-api/pulls?') && path.includes(`head=${encodeURIComponent('elirc:feat/add-tasks')}`)) {
        return { code: 0, stdout: JSON.stringify([{ number: 7, body: '## Summary\nadds tasks\n\n## Testing\n<!-- how -->\nnpm test, 12 green\n' }]) };
      }
      return { code: 1, stderr: `unrouted ${path}` };
    }, calls);
    const r = await runRepoCheck(remoteSpec, remoteRepo, { gh });
    expect(r.failures).toEqual([]);
    expect(calls.filter((c) => c[0] === 'auth')).toHaveLength(1);
  });

  it('ci-green fails on pending / red runs / no runs / unpushed commit; pr-has-section on missing PR / empty or absent section', async () => {
    const scenario = async (checkRuns: unknown, prs: unknown, ghErr?: string) => {
      const gh = fakeGh((a) => {
        if (a[0] === 'auth') return loggedIn(a);
        const path = a[a.length - 1]!;
        if (path.includes('/check-runs')) return ghErr ? { code: 1, stderr: ghErr } : { code: 0, stdout: JSON.stringify(checkRuns) };
        return { code: 0, stdout: JSON.stringify(prs) };
      });
      return Object.fromEntries((await runRepoCheck(remoteSpec, remoteRepo, { gh })).failures.map((f) => [f.name, f.message]));
    };
    const pending = await scenario({ check_runs: [{ name: 'test', status: 'in_progress', conclusion: null }] }, []);
    expect(pending['CI is green']).toMatch(/^CI still running on [0-9a-f]{7}: test$/);
    expect(pending['PR explains testing']).toBe('no pull request from feat/add-tasks in elirc/tasks-api');
    const red = await scenario({ check_runs: [{ name: 'test', status: 'completed', conclusion: 'failure' }] }, [{ number: 3, body: '## Testing\n\n## Notes\nx' }]);
    expect(red['CI is green']).toMatch(/^CI is not green on [0-9a-f]{7}: test=failure$/);
    expect(red['PR explains testing']).toBe('PR #3 has a "Testing" heading but nothing under it');
    const none = await scenario({ check_runs: [] }, [{ number: 4, body: 'no headings at all' }]);
    expect(none['CI is green']).toMatch(/^no CI check runs on/);
    expect(none['PR explains testing']).toBe('PR #4 description has no "Testing" section');
    const unpushed = await scenario(null, [], 'gh: No commit found for SHA: abc (HTTP 422)');
    expect(unpushed['CI is green']).toMatch(/is not on GitHub \(elirc\/tasks-api\) - push it first$/);
  });

  it('no github origin: remote predicates fail naming the gap', async () => {
    const r = await runRepoCheck(remoteSpec, repos.get('good')!, { gh: fakeGh(loggedIn) });
    for (const f of r.failures) expect(f.message).toBe('no "origin" remote: remote predicates need a GitHub origin');
  });

  it('helpers: github origin parsing + markdown section detection', () => {
    expect(githubRepoOf('https://github.com/elirc/tasks-api.git')).toBe('elirc/tasks-api');
    expect(githubRepoOf('git@github.com:elirc/tasks.api')).toBe('elirc/tasks.api');
    expect(githubRepoOf('ssh://git@github.com/elirc/x.git\n')).toBe('elirc/x');
    expect(githubRepoOf('https://gitlab.com/elirc/x.git')).toBeNull();
    expect(sectionStatus('# Testing\nran it', 'testing')).toBe('ok');
    expect(sectionStatus('### Testing ###\n\n  \n## Next\nx', 'Testing')).toBe('empty');
    expect(sectionStatus('Testing\n-------\nx', 'Testing')).toBe('missing'); // setext headings are not supported (documented: ATX only)
  });
});
