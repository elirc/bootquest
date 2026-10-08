// End-to-end API smoke (no test framework). Run from the repo root:
//   npm run smoke:api      (= node --import tsx server/scripts/smoke-api.mjs)
// Boots the REAL server entrypoint as a child (process.execPath, no shell) on a
// temp DB + free port, seeds fixture JSON, walks the honesty flows over HTTP,
// verifies ledger rows through a read connection, kills the server and
// verifies the port is free again. Exit 0 only if every step holds.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db, openDb } from '../src/db/database.ts';
import { addReviewItem } from '../src/engines/fsrs.ts';
import { insertUnit } from '../src/store/content.ts';
import { ledgerCounts } from '../src/store/queries.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SERVE = join(REPO, 'server', 'src', 'api', 'serve.ts');
const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', 'smoke-units.json'), 'utf8'));
const realClock = () => new Date();

const results = [];
function step(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
  return ok;
}

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

function portIsFree(port) {
  return new Promise((ok) => {
    const s = createServer();
    s.once('error', () => ok(false));
    s.listen({ port, host: '127.0.0.1', exclusive: true }, () => s.close(() => ok(true)));
  });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON is itself a failure, checked by callers */
  }
  return { status: res.status, text, json };
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'bootquest-smoke-'));
  const dbPath = join(dir, 'smoke.db');
  const contentPath = join(dir, 'unit-content.json');
  let child = null;
  let port = 0;
  try {
    // ---- seed (before the server starts; the server is then the single writer)
    const seedDb = openDb({ path: dbPath, env: {} });
    const ids = {};
    for (const u of fixture.units) ids[u.key] = insertUnit(seedDb, u, realClock);
    for (const c of fixture.reviewCards) addReviewItem(seedDb, c, realClock);
    seedDb.close();
    writeFileSync(contentPath, JSON.stringify(fixture.content));
    const quizId = ids['smoke:quiz-typeof-null'];
    const drillId = ids['smoke:drill-add'];

    // ---- boot the real entrypoint
    port = await freePort();
    child = spawn(process.execPath, ['--import', 'tsx', SERVE], {
      cwd: REPO,
      env: { ...process.env, BOOTQUEST_DB: dbPath, BOOTQUEST_PORT: String(port), BOOTQUEST_UNIT_CONTENT: contentPath },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let serverOut = '';
    child.stdout.on('data', (d) => (serverOut += d));
    child.stderr.on('data', (d) => (serverOut += d)); // kept for diagnostics only; never asserted on
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      if (child.exitCode !== null) break;
      try {
        up = (await fetch(`${base}/api/health`)).ok;
      } catch {
        await sleep(250);
      }
    }
    if (!step('server boots on temp DB + free port', up, `port ${port}`)) {
      console.log(serverOut);
      return false;
    }

    const reader = new Db(dbPath); // read connection for ledger verification (WAL)
    const counts = () => ledgerCounts(reader);
    try {
      // 1. health
      const h = await api(base, 'GET', '/api/health');
      step('health', h.status === 200 && h.json?.ok === true && h.json.counts.units === 2 && h.json.counts.checks === 2, JSON.stringify(h.json));

      // 2. GET unit: public spec only, no leaks
      const u = await api(base, 'GET', `/api/units/${drillId}`);
      const leaks = fixture.markers.filter((m) => u.text.includes(m));
      step(
        'GET unit exposes no solution / test code',
        u.status === 200 && leaks.length === 0 && !('answerKey' in (u.json?.check?.spec ?? {})) && u.json?.starter?.includes('your code here'),
        leaks.length ? `leaked ${leaks.join(',')}` : 'public spec only',
      );
      const sol = await api(base, 'GET', `/api/units/${drillId}/solution`);
      step('solution endpoint 403 before reveal', sol.status === 403 && sol.json?.error?.code === 'NOT_REVEALED');

      // 3. run: free, real runner, writes no rows
      const c0 = counts();
      const r = await api(base, 'POST', `/api/units/${drillId}/run`, { code: fixture.submissions.addWrong });
      const c1 = counts();
      step(
        'run (real JS runner) grades and writes no rows',
        r.status === 200 && r.json?.result?.pass === false && r.json.result.failures.length === 2 && JSON.stringify(c0) === JSON.stringify(c1),
        `failures=${r.json?.result?.failures?.length} rows ${JSON.stringify(c1)}`,
      );

      // 4. submit wrong: recorded, no XP
      const w = await api(base, 'POST', `/api/units/${quizId}/submit`, { answer: fixture.submissions.quizWrong });
      const c2 = counts();
      step(
        'submit wrong: attempt recorded, no XP',
        w.status === 200 && w.json?.verdict === 'fail' && w.json.xp === null && c2.attempt === c1.attempt + 1 && c2.run === c1.run + 1 && c2.xp_event === c1.xp_event,
        JSON.stringify(c2),
      );

      // 5. submit right: XP row
      const ok1 = await api(base, 'POST', `/api/units/${quizId}/submit`, { answer: fixture.submissions.quizRight });
      const c3 = counts();
      step('submit right: XP row (+2)', ok1.json?.verdict === 'pass' && ok1.json.xp?.amount === 2 && c3.xp_event === c2.xp_event + 1, JSON.stringify(ok1.json?.xp));

      // 6. submit right again: already-awarded 0
      const ok2 = await api(base, 'POST', `/api/units/${quizId}/submit`, { answer: fixture.submissions.quizRight });
      step('submit right again: 0 XP already-awarded', ok2.json?.xp?.amount === 0 && ok2.json.xp.reason === 'already-awarded', JSON.stringify(ok2.json?.xp));

      // 7. reveal the drill: row first, then solution
      const rv = await api(base, 'POST', `/api/units/${drillId}/reveal`);
      const revealRow = reader.get(`SELECT id, mode, outcome FROM attempt WHERE unit_id = ? AND outcome = 'revealed'`, drillId);
      step(
        'reveal: guided row written, solution returned',
        rv.status === 200 && rv.json?.solution?.kind === 'code' && rv.json.solution.code.includes('SMOKE_SOLUTION_MARKER') && revealRow?.id === rv.json.attemptId && revealRow.mode === 'guided',
        JSON.stringify(revealRow),
      );

      // 8. submit the revealed unit correctly: 0 XP forever
      const g = await api(base, 'POST', `/api/units/${drillId}/submit`, { code: fixture.submissions.addRight });
      step(
        'submit after reveal: pass but 0 XP (revealed), mode guided',
        g.json?.verdict === 'pass' && g.json.xp?.amount === 0 && g.json.xp.reason === 'revealed' && g.json.attempt.mode === 'guided',
        JSON.stringify(g.json?.xp),
      );

      // 9. review queue flow
      const q1 = await api(base, 'GET', '/api/reviews/queue');
      const item = q1.json?.items?.[0];
      const gr = item ? await api(base, 'POST', `/api/reviews/${item.id}/grade`, { grade: 'good' }) : null;
      const q2 = await api(base, 'GET', '/api/reviews/queue');
      step(
        'review queue: due item graded, due_at moved, queue cleared',
        q1.json?.count === 1 && gr?.status === 200 && gr.json.nextDueAt > gr.json.prevDueAt && gr.json.xp.amount === 1 && q2.json?.count === 0,
        `prev=${gr?.json?.prevDueAt} next=${gr?.json?.nextDueAt}`,
      );

      // 10. dashboard reflects the ledger
      const d = await api(base, 'GET', '/api/dashboard');
      step(
        'dashboard: xp total 3, 7 competencies, 120-day heatmap',
        d.status === 200 && d.json?.xp?.total === 3 && d.json.competencies.length === 7 && d.json.heatmap.length === 120,
        `xp=${d.json?.xp?.total}`,
      );

      // 11. errors are JSON
      const e = await api(base, 'GET', '/definitely-not-a-route');
      step('unknown route answers JSON 404', e.status === 404 && e.json?.error?.code === 'NOT_FOUND');
    } finally {
      reader.close();
    }
    return true;
  } finally {
    if (child) {
      const pid = child.pid;
      if (child.exitCode === null) {
        const exited = new Promise((r) => child.once('exit', r));
        child.kill();
        await Promise.race([exited, sleep(5000)]);
      }
      let free = false;
      for (let i = 0; i < 20 && !free; i++) {
        free = (await portIsFree(port)) && !pidAlive(pid);
        if (!free) await sleep(250);
      }
      step('server killed: process gone, port free again (no zombie)', free, `pid ${pid} port ${port}`);
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\nsmoke:api ${results.length - failed.length}/${results.length} steps passed`);
    process.exit(failed.length === 0 && results.length > 1 ? 0 : 1);
  })
  .catch((err) => {
    console.error('smoke:api crashed:', err);
    process.exit(1);
  });
