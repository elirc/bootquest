// npm run test:mutate-fixture
//
// The REAL mutation gate end to end (kept OUT of `npm test`: it runs Stryker for minutes).
// FIXTURE project cli/test/fixtures/mutate-js/{honest,gutted}: the same src/ (cart.js +
// slug.js); `gutted` deletes every assertion in test/slug.test.js ("tests that test nothing").
//   1. an in-process BootQuest API on a temp DB (never the owner's DB) with one fixture
//      http-lab unit per variant, each given a verified passing submit first;
//   2. `bootquest mutate <dir>` (runCli, the real command) -> real Stryker 10 + vitest runner;
//   3. PASS iff honest clears the gate AND its mutation evidence is recorded (verified,
//      pipeline), and gutted FAILS on slug.js's per-file floor with NOTHING recorded.
// Prints wall-clock timings. Leftover Stryker / vitest processes are checked and killed.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/src/api/app.ts';
import type { Runner } from '../../server/src/api/runners.ts';
import { openDb } from '../../server/src/db/database.ts';
import { insertUnit } from '../../server/src/store/content.ts';
import { runCli } from '../src/program.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIXTURES = join(REPO, 'cli', 'test', 'fixtures', 'mutate-js');
// inside the repo (gitignored .cache/) so the fixture resolves vitest from the repo's node_modules
const WORK = join(REPO, '.cache', 'mutate-fixture');

const results: { name: string; ok: boolean }[] = [];
function step(name: string, ok: boolean, detail = ''): boolean {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
  return ok;
}

function strykerProcesses(): string[] {
  if (process.platform !== 'win32') return [];
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('@stryker-mutator') -and $_.ProcessId -ne $PID -and $_.Name -ne 'powershell.exe' } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(`${process.pid} `));
}

const passHttp: Runner = async () => ({ pass: true, output: 'fixture http runner: project passes', failures: [], durationMs: 1 });

async function main(): Promise<void> {
  const dbDir = mkdtempSync(join(tmpdir(), 'bootquest-mutate-fixture-'));
  const db = openDb({ path: join(dbDir, 'fixture.db'), env: {} });
  const clock = () => new Date();
  const ids: Record<string, number> = {};
  for (const v of ['honest', 'gutted']) {
    ids[v] = insertUnit(
      db,
      {
        key: `fixture:mutate/${v}`,
        track: 'js',
        kind: 'http-lab',
        title: `[fixture] mutation gate (${v} tests)`,
        competencies: ['testing-verification'],
        checks: [{ spec: { type: 'http', requests: [{ name: 'health', method: 'GET', path: '/health', expect: { status: 200 } }] } }],
      },
      clock,
    );
  }
  const app = createApp({ db, clock, runners: { http: passHttp } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((ok) => server.once('listening', () => ok()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const timings: Record<string, number> = {};
  try {
    for (const v of ['honest', 'gutted'] as const) {
      const res = await fetch(`${base}/api/units/${ids[v]}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ port: 4000 }) });
      step(`${v}: project has a verified passing submit (precondition)`, res.status === 200 && ((await res.json()) as { verdict: string }).verdict === 'pass');
    }

    rmSync(WORK, { recursive: true, force: true });
    for (const v of ['honest', 'gutted'] as const) {
      const dir = join(WORK, v);
      mkdirSync(dir, { recursive: true });
      cpSync(join(FIXTURES, v), dir, { recursive: true });
      writeFileSync(join(dir, '.bootquest.json'), JSON.stringify({ unitId: ids[v] }));
      const stdout: string[] = [];
      const stderr: string[] = [];
      const t0 = performance.now();
      const code = await runCli(['mutate', dir, '--server', base, '--quiet'], {
        cwd: dir,
        env: process.env,
        fetch: (url, init) => fetch(url, init),
        out: (t) => {
          stdout.push(t);
          console.log(`  [${v}] ${t.split('\n').join(`\n  [${v}] `)}`);
        },
        err: (t) => {
          stderr.push(t);
          console.log(`  [${v}:err] ${t}`);
        },
      });
      timings[v] = Math.round((performance.now() - t0) / 100) / 10;
      const ev = db.all<{ kind: string; verified: boolean; assessor: string; score: number }>(
        `SELECT kind, verified, assessor, score FROM evidence WHERE unit_id = ? AND kind = 'mutation'`,
        ids[v],
      );
      const out = stdout.join('\n');
      if (v === 'honest') {
        step('honest: real Stryker run clears the gate (exit 0)', code === 0, `exit ${code}, ${timings[v]}s wall`);
        step('honest: verified pipeline mutation evidence recorded on the server', ev.length === 1 && ev[0]!.verified === true && ev[0]!.assessor === 'pipeline', JSON.stringify(ev));
      } else {
        step('gutted: the gate FAILS (exit 1)', code === 1, `exit ${code}, ${timings[v]}s wall`);
        step('gutted: caught by the PER-FILE floor on src/slug.js', /src\/slug\.js: [\d.]+% < per-file floor 40%/.test(out));
        const overall = /Overall: ([\d.]+)%/.exec(out)?.[1];
        console.log(`  note: gutted overall score ${overall}% (break 60%) — the per-file floor is what catches a diluted gutted file`);
        step('gutted: nothing recorded on the server', ev.length === 0);
      }
      step(`${v}: Stryker wrote its incremental file (reruns are incremental)`, existsSync(join(dir, 'reports', 'stryker-incremental.json')));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
    db.close();
    rmSync(dbDir, { recursive: true, force: true });
  }
  const left = strykerProcesses();
  for (const l of left) {
    const pid = l.split(' ')[0]!;
    try {
      execFileSync('taskkill', ['/T', '/F', '/PID', pid], { stdio: 'ignore' });
    } catch {
      /* gone */
    }
  }
  step('no Stryker / vitest child processes left behind', left.length === 0, left.join(', '));
  console.log(`TIMINGS  honest ${timings.honest}s  gutted ${timings.gutted}s (wall, incl. Stryker startup + dry run)`);
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? `ALL ${results.length} CHECKS PASSED` : `${failed.length} of ${results.length} CHECKS FAILED`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error('FAIL  mutate fixture crashed:', err);
  process.exitCode = 1;
});
