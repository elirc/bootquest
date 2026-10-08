import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// W3c fixture lessons (one http-check, one repo-check) + their learner-side fixtures; seeded into the
// e2e DB BEFORE the server starts (the smoke's pattern), so the server is the only writer afterwards
import { openDb } from '../../server/src/db/database.ts';
import { insertUnit } from '../../server/src/store/content.ts';
import lessons from '../../server/test/fixtures/check-lessons.json' with { type: 'json' };
import { buildFixtureRepo } from '../../server/test/fixtures/repo-fixture.ts';
import { startTasksServer } from '../../server/test/fixtures/tasks-server.ts';

/**
 * E2E: boots the REAL server entrypoint (server/src/api/serve.ts) as a child
 * (process.execPath + --import tsx, no shell) on a temp DB and a free port with
 * ONE real BootForge course (js-fundamentals), then drives the real CLI
 * launcher (cli/bootquest.mjs) — and once the Windows shim bin/bootquest.cmd —
 * as separate processes from a scratch project directory OUTSIDE the repo.
 * The server is killed with taskkill /T /F and the port is verified free.
 * W3c: the http-check and repo-check fixture lessons are seeded too; the http
 * lesson is checked against a fixture server this process boots on a free
 * port (spec M3 gate: "one HTTP-check lesson passes against a local server"),
 * the repo lesson against fixture git repos built in the temp dir.
 */
const HTTP_KEY = 'fixture:http-tasks-api';
const REPO_KEY = 'fixture:repo-feature-branch';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SERVE = join(REPO, 'server', 'src', 'api', 'serve.ts');
const LAUNCHER = join(REPO, 'cli', 'bootquest.mjs');
const SHIM = join(REPO, 'bin', 'bootquest.cmd');
const PACK_DIR = join(REPO, 'content', 'packs', 'bootforge');
const COURSE = 'js-fundamentals';

interface PackUnit {
  unit: { key: string; kind: string; title: string };
}
const pack = JSON.parse(readFileSync(join(PACK_DIR, `${COURSE}.json`), 'utf8')) as {
  units: PackUnit[];
  content: Record<string, { starter?: string; solution?: string }>;
};
const drill = pack.units.find((u) => u.unit.kind === 'drill')!.unit;
const quiz = pack.units.find((u) => u.unit.kind === 'quiz')!.unit;
const predict = pack.units.find((u) => u.unit.kind === 'predict-output')!.unit;
// the test harness (not the CLI) reads the reference solution from the pack to play a learner who solved it
const drillSolution = pack.content[drill.key]!.solution!;
const drillStarter = pack.content[drill.key]!.starter!;

/** Inherited env minus any BOOTQUEST_* the developer may have set, plus explicit overrides. */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('BOOTQUEST_') && !k.startsWith('npm_')) env[k] = v;
  return { ...env, ...extra };
}

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => ok(port));
    });
  });
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = createServer();
    s.once('error', () => ok(false));
    s.listen({ port, host: '127.0.0.1', exclusive: true }, () => s.close(() => ok(true)));
  });
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProc(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      fail(new Error(`${cmd} ${args.join(' ')} timed out\n${stdout}\n${stderr}`));
    }, 90_000);
    child.once('error', fail);
    child.once('close', (code) => {
      clearTimeout(timer);
      ok({ code, stdout, stderr });
    });
  });
}

let tmp: string;
let proj: string;
let port: number;
let server: ChildProcess | null = null;
let serverLog = '';
let serverExited: Promise<void> = Promise.resolve();
let base: string;

/** BOOTQUEST_E2E_ECHO=1 prints every CLI transcript (for eyeballing the output). */
const cli = async (args: string[], cwd: string = proj, extraEnv: Record<string, string> = {}) => {
  const r = await runProc(process.execPath, [LAUNCHER, ...args], cwd, cleanEnv({ BOOTQUEST_SERVER: base, ...extraEnv }));
  if (process.env.BOOTQUEST_E2E_ECHO === '1') {
    console.log(`$ bootquest ${args.join(' ')}  -> exit ${r.code}\n${r.stdout}${r.stderr ? `[stderr]\n${r.stderr}` : ''}`);
  }
  return r;
};

async function killServer(): Promise<void> {
  if (!server || server.exitCode !== null || server.pid === undefined) return;
  spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
  await serverExited;
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'bq-cli-e2e-'));
  proj = join(tmp, 'my-project');
  mkdirSync(join(proj, 'src'), { recursive: true });
  const seedDb = openDb({ path: join(tmp, 'e2e.db'), env: {} });
  for (const u of lessons.units) insertUnit(seedDb, u, () => new Date());
  seedDb.close();
  writeFileSync(join(tmp, 'unit-content.json'), JSON.stringify(lessons.content));
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--import', 'tsx', SERVE], {
    cwd: REPO,
    env: cleanEnv({
      BOOTQUEST_DB: join(tmp, 'e2e.db'),
      BOOTQUEST_UNIT_CONTENT: join(tmp, 'unit-content.json'),
      BOOTQUEST_PORT: String(port),
      BOOTQUEST_PACKS: PACK_DIR,
      BOOTQUEST_PACK_COURSES: COURSE,
      // test-harness opt-out of the import-gate stamp check (never set by the real entrypoint)
      BOOTQUEST_PACKS_ALLOW_UNSTAMPED: '1',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const child = server;
  serverExited = new Promise((done) => child.once('exit', () => done()));
  child.stdout!.on('data', (d) => (serverLog += d));
  child.stderr!.on('data', (d) => (serverLog += d)); // diagnostics only (ExperimentalWarning lands here)
  const deadline = Date.now() + 90_000;
  while (!serverLog.includes('API listening on')) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode}):\n${serverLog}`);
    if (Date.now() > deadline) throw new Error(`server did not start in 90s:\n${serverLog}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}, 120_000);

afterAll(async () => {
  await killServer();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}, 60_000);

function writeConfig(dir: string, cfg: object): void {
  writeFileSync(join(dir, '.bootquest.json'), JSON.stringify(cfg, null, 2));
}

describe('bootquest CLI against the real server', () => {
  it('setup: project dir with .bootquest.json (unitKey) + starter file', () => {
    writeConfig(proj, { unitKey: drill.key, file: 'src/solution.js' });
    writeFileSync(join(proj, 'src', 'solution.js'), drillStarter);
    expect(serverLog).toMatch(/pack bootforge: 1 course\(s\)/);
  });

  it('status: dashboard + current unit (from a nested dir, walk-up)', async () => {
    const r = await cli(['status'], join(proj, 'src'));
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Streak: 0 days/);
    expect(r.stdout).toMatch(/XP: 0 total - level 1/);
    expect(r.stdout).toMatch(/Reviews due: \d+/);
    expect(r.stdout).toMatch(/Next up:/);
    expect(r.stdout).toContain(`Unit:   ${drill.title} (${drill.key})`);
    expect(r.stdout).toMatch(/Check: +drill-js \(\d+ tests\)/);
    expect(r.stdout).toMatch(/CLI: +run \/ submit from here/);
  });

  it('run (starter = failing code): exit 1, structured failures, nothing recorded', async () => {
    const r = await cli(['run']);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/Run \(free, not recorded\)/);
    expect(r.stdout).toMatch(/Result: FAIL \(0\/\d+ tests passing\)/);
    expect(r.stdout).toMatch(/Failures \(\d+ of \d+ tests\):\n {2}1\. /);
  });

  it('run (correct code): exit 0, PASS', async () => {
    writeFileSync(join(proj, 'src', 'solution.js'), drillSolution);
    const r = await cli(['run']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Result: PASS \((\d+)\/\1 tests\)/);
  });

  let wrongAttempt = 0;
  it('submit wrong: recorded, exit 1, no XP', async () => {
    writeFileSync(join(proj, 'src', 'wrong.js'), drillStarter);
    const r = await cli(['submit', 'src/wrong.js']);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/Verdict: FAIL/);
    const m = /Attempt #(\d+) recorded \(mode: solo, outcome: fail/.exec(r.stdout);
    expect(m).not.toBeNull();
    wrongAttempt = Number(m![1]);
    expect(r.stdout).toMatch(/XP: none \(failed submits cost nothing and earn nothing; the attempt is recorded\)/);
  });

  it('submit right: exit 0, XP awarded', async () => {
    const r = await cli(['submit']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Verdict: PASS/);
    const m = /Attempt #(\d+) recorded \(mode: solo, outcome: pass/.exec(r.stdout);
    expect(Number(m![1])).toBeGreaterThan(wrongAttempt);
    expect(r.stdout).toMatch(/XP: \+[1-9]\d*/);
  });

  it('submit again: exit 0 with the verbatim already-awarded note', async () => {
    const r = await cli(['submit']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/XP: \+0 \(reason: already-awarded\) - you already earned XP/);
  });

  it('status reflects the award', async () => {
    const r = await cli(['status']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/XP: [1-9]\d* total/);
    expect(r.stdout).toMatch(/State: +done/);
  });

  it('unitId config works too (resolved without the key lookup)', async () => {
    const units = (await (await fetch(`${base}/api/tracks/js/units`)).json()) as { units: { id: number; key: string }[] };
    const id = units.units.find((u) => u.key === drill.key)!.id;
    const dir = join(tmp, 'by-id');
    mkdirSync(dir);
    writeConfig(dir, { unitId: id });
    writeFileSync(join(dir, 'answer.js'), drillSolution);
    const r = await cli(['run', 'answer.js'], dir);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Result: PASS/);
  });

  it('quiz and predict-output units: refused as browser material (exit 2, nothing sent)', async () => {
    for (const u of [quiz, predict]) {
      const dir = join(tmp, `browser-${u.kind}`);
      mkdirSync(dir);
      writeConfig(dir, { unitKey: u.key, file: 'a.txt' });
      writeFileSync(join(dir, 'a.txt'), '1');
      const s = await cli(['submit'], dir);
      expect(s.code).toBe(2);
      expect(s.stderr).toMatch(/browser material: answer it in the BootQuest web app/);
      const r = await cli(['run'], dir);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/RUN_NOT_AVAILABLE/);
      expect(s.stdout + r.stdout).toBe('');
    }
  });

  it('unknown unitKey: friendly NOT_FOUND, exit 2', async () => {
    const dir = join(tmp, 'unknown');
    mkdirSync(dir);
    writeConfig(dir, { unitKey: 'bootforge/no/such/unit', file: 'a.js' });
    const r = await cli(['run'], dir);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/Server refused \(NOT_FOUND, HTTP 404\): no unit with key "bootforge\/no\/such\/unit"/);
  });

  it('sync placeholder: health + counts, says W4', async () => {
    const r = await cli(['sync']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/is up \(BootQuest server v/);
    expect(r.stdout).toMatch(/Content: \d+ units, \d+ checks loaded\./);
    expect(r.stdout).toMatch(/js +JavaScript.*: 1\/\d+ done|js +.*: 1\/\d+ done/);
    expect(r.stdout).toMatch(/not implemented yet \(milestone W4\)/);
  });

  it('W3c http lesson: wrong-shape server -> run/submit exit 1 with named failures; good server -> submit exit 0 + XP', async () => {
    const dir = join(tmp, 'http-project');
    mkdirSync(dir);
    writeConfig(dir, { unitKey: HTTP_KEY });
    const st = await cli(['status'], dir);
    expect(st.code).toBe(0);
    expect(st.stdout).toMatch(/Check: +http \(3 requests\), port hint 3000/);

    const wrong = await startTasksServer('wrong-shape');
    try {
      const r = await cli(['run', '--port', String(wrong.port)], dir);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain(`Target: localhost:${wrong.port}`);
      expect(r.stdout).toMatch(/Result: FAIL \(1\/3 requests passing\)/);
      expect(r.stdout).toMatch(/1\. create a task\n {7}body \$\.id: expected integer, got "1" \(string\)/);
      expect(r.stdout).toMatch(/2\. list tasks/);
      const s = await cli(['submit', '--port', String(wrong.port)], dir);
      expect(s.code).toBe(1);
      expect(s.stdout).toMatch(/Attempt #\d+ recorded \(mode: solo, outcome: fail/);
    } finally {
      await wrong.close();
    }
    expect(await portIsFree(wrong.port)).toBe(true);

    const good = await startTasksServer('good');
    try {
      const ok = await cli(['submit', '--port', String(good.port)], dir);
      expect(ok.stderr).toBe('');
      expect(ok.code).toBe(0);
      expect(ok.stdout).toMatch(/Verdict: PASS \(3\/3 requests passing\)/);
      expect(ok.stdout).toMatch(/XP: \+20/);
    } finally {
      await good.close();
    }
    expect(await portIsFree(good.port)).toBe(true);
  }, 180_000); // 2 fixture servers + 4 CLI processes

  it('W3c http lesson: nothing listening on the port -> exit 1, network error verbatim', async () => {
    const dead = await freePort();
    const r = await cli(['run', '--port', String(dead)], join(tmp, 'http-project'));
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`request failed: .*ECONNREFUSED.*${dead}`));
  });

  it('W3c repo lesson: default repo = dir holding .bootquest.json; dirty repo fails exactly clean-worktree; good repo passes + XP', async () => {
    const parent = join(tmp, 'repos');
    const [good, dirty] = await Promise.all([buildFixtureRepo(parent, 'good'), buildFixtureRepo(parent, 'dirty')]);
    // the marker file at the repo root does not make the tree dirty (runner ignores it)
    writeConfig(good, { unitKey: REPO_KEY });
    writeConfig(dirty, { unitKey: REPO_KEY });

    const bad = await cli(['submit'], join(dirty, 'src'));
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain(`Repo: ${dirty}`);
    expect(bad.stdout).toMatch(/Verdict: FAIL \(5\/6 predicates passing\)/);
    expect(bad.stdout).toMatch(/Failures \(1 of 6 predicates\):\n {2}1\. nothing left uncommitted\n/);

    const ok = await cli(['submit'], good);
    expect(ok.stderr).toBe('');
    expect(ok.code).toBe(0);
    expect(ok.stdout).toMatch(/Verdict: PASS \(6\/6 predicates passing\)/);
    expect(ok.stdout).toMatch(/XP: \+20/);

    // --repo from elsewhere (resolved against the cwd); run is free
    const elsewhere = join(tmp, 'repo-flag');
    mkdirSync(elsewhere);
    writeConfig(elsewhere, { unitKey: REPO_KEY });
    const viaFlag = await cli(['run', '--repo', '../repos/dirty'], elsewhere);
    expect(viaFlag.code).toBe(1);
    expect(viaFlag.stdout).toMatch(/Run \(free, not recorded\)/);
    const notRepo = await cli(['run', '--repo', '.'], elsewhere);
    expect(notRepo.code).toBe(2);
    expect(notRepo.stderr).toMatch(/Server refused \(VALIDATION, HTTP 400\): repoPath is not the root of a git working tree/);
  }, 180_000); // 2 fixture repos + 5 CLI processes, each a node cold start: slow on a loaded box

  it('bin/bootquest.cmd works from a foreign cwd and propagates exit codes', async () => {
    const env = cleanEnv({ BOOTQUEST_SERVER: base });
    const ok = await runProc('cmd.exe', ['/d', '/c', SHIM, 'status'], proj, env);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toMatch(/Streak:/);
    const bad = await runProc('cmd.exe', ['/d', '/c', SHIM, 'submit', 'src/wrong.js'], proj, env);
    expect(bad.code).toBe(1);
  });

  it('server down: friendly message, exit 2; server killed cleanly and port freed', async () => {
    await killServer();
    expect(server!.exitCode !== null || server!.signalCode !== null).toBe(true);
    expect(await portIsFree(port)).toBe(true);
    const r = await cli(['status']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(new RegExp(`Cannot reach the BootQuest server at http://127\\.0\\.0\\.1:${port} \\(ECONNREFUSED\\)`));
    expect(r.stderr).toMatch(/npm run serve/);
    expect(r.stderr).not.toMatch(/\n\s+at /); // no stack trace
  });
});
