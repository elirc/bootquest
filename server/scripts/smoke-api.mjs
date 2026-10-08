// End-to-end API smoke (no test framework). Run from the repo root:
//   npm run smoke:api      (= node --import tsx server/scripts/smoke-api.mjs)
// Boots the REAL server entrypoint as a child (process.execPath, no shell) on a
// temp DB + free port, seeds fixture JSON, loads ONE real imported BootForge
// course pack through the startup content loader (loaded === built), walks the
// honesty flows over HTTP — including real BootForge drill / quiz / predict
// submissions graded by the real runners, and (W3a) the whole csbootcamp C#
// pack with a real csbootcamp reference solution AND its untouched starter
// graded by the real warm C# runner (scratch in the temp dir, compiler server
// shut down + process-checked at the end), and (W3c) the http-check fixture
// lesson graded by the real http runner against a fixture server booted on a
// free port —
// verifies ledger rows through a read connection, kills the server and
// verifies the port is free again. Exit 0 only if every step holds.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db, openDb } from '../src/db/database.ts';
import { addReviewItem } from '../src/engines/fsrs.ts';
import { insertUnit } from '../src/store/content.ts';
import { ledgerCounts } from '../src/store/queries.ts';
import { ScratchManager } from '../src/runners/csharp/scratch.ts';
import { startTasksServer } from '../test/fixtures/tasks-server.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SERVE = join(REPO, 'server', 'src', 'api', 'serve.ts');
const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', 'smoke-units.json'), 'utf8'));
// W3c: the http-check fixture lesson (the repo lesson is covered by the test suites)
const checkLessons = JSON.parse(readFileSync(join(HERE, '..', 'test', 'fixtures', 'check-lessons.json'), 'utf8'));
const httpLesson = checkLessons.units.find((u) => u.key === 'fixture:http-tasks-api');
// one real imported BootForge course (W2): the server loads it at startup
const PACK_DIR = join(REPO, 'content', 'packs', 'bootforge');
const PACK_COURSE = 'js-fundamentals';
const packManifest = JSON.parse(readFileSync(join(PACK_DIR, 'manifest.json'), 'utf8'));
const packCourse = JSON.parse(readFileSync(join(PACK_DIR, `${PACK_COURSE}.json`), 'utf8'));
const packCounts = packManifest.courses.find((c) => c.id === PACK_COURSE).counts;
const bfCode = packCourse.units.find((u) => u.origin.type === 'code');
const bfQuiz = packCourse.units.find((u) => u.origin.type === 'quiz');
const bfOutput = packCourse.units.find((u) => u.origin.type === 'output');
// W3a: the csbootcamp C# pack (all modules) — one ★★☆ exercise graded for real
const CS_DIR = join(REPO, 'content', 'packs', 'csbootcamp');
const csManifest = JSON.parse(readFileSync(join(CS_DIR, 'manifest.json'), 'utf8'));
const csCourses = csManifest.courses.map((c) => JSON.parse(readFileSync(join(CS_DIR, c.file), 'utf8')));
const csUnit = csCourses.flatMap((c) => c.units).find((u) => u.unit.difficulty === 2);
const csContent = csCourses.find((c) => csUnit.unit.key in c.content).content[csUnit.unit.key];

/** Live processes whose command line mentions `needle` (Windows CIM query; [] elsewhere). */
function processesMentioning(needle) {
  if (process.platform !== 'win32') return [];
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`],
    { encoding: 'utf8', windowsHide: true },
  );
  return out.split(/\r?\n/).filter((l) => l.trim() && !/powershell/i.test(l));
}
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
  const csScratch = join(dir, 'cs-scratch');
  let child = null;
  let port = 0;
  try {
    // ---- seed (before the server starts; the server is then the single writer)
    const seedDb = openDb({ path: dbPath, env: {} });
    const ids = {};
    for (const u of fixture.units) ids[u.key] = insertUnit(seedDb, u, realClock);
    ids[httpLesson.key] = insertUnit(seedDb, httpLesson, realClock);
    for (const c of fixture.reviewCards) addReviewItem(seedDb, c, realClock);
    seedDb.close();
    writeFileSync(contentPath, JSON.stringify(fixture.content));
    const quizId = ids['smoke:quiz-typeof-null'];
    const drillId = ids['smoke:drill-add'];

    // ---- boot the real entrypoint
    port = await freePort();
    child = spawn(process.execPath, ['--import', 'tsx', SERVE], {
      cwd: REPO,
      env: {
        ...process.env,
        BOOTQUEST_DB: dbPath,
        BOOTQUEST_PORT: String(port),
        BOOTQUEST_UNIT_CONTENT: contentPath,
        BOOTQUEST_PACKS: `${PACK_DIR},${CS_DIR}`,
        BOOTQUEST_PACK_COURSES: [PACK_COURSE, ...csManifest.courses.map((c) => c.id)].join(','),
        BOOTQUEST_CS_SCRATCH: csScratch,
        // explicit test-harness opt-out of the import-gate stamp (W2b/F1): the smoke
        // must not depend on a fresh seed:validate sweep. The real serve path never sets it.
        BOOTQUEST_PACKS_ALLOW_UNSTAMPED: '1',
      },
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
      // 3 fixture units (2 smoke + the W3c http lesson) + the real pack course (written units carry no check) + every csbootcamp drill
      const wantUnits = 3 + packCounts.total + csManifest.totals.total;
      const wantChecks = 3 + packCounts.total - packCounts.written + csManifest.totals.total;
      step(
        `health (3 fixture + ${packCounts.total} BootForge ${PACK_COURSE} + ${csManifest.totals.total} csbootcamp units: loaded === built)`,
        h.status === 200 && h.json?.ok === true && h.json.counts.units === wantUnits && h.json.counts.checks === wantChecks,
        JSON.stringify(h.json),
      );

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

      // 3b. quiz run is refused (submit-only: a free run would be an answer oracle), writes nothing
      const qr = await api(base, 'POST', `/api/units/${quizId}/run`, { answer: fixture.submissions.quizRight });
      step(
        'quiz run refused 409 RUN_NOT_AVAILABLE, no rows',
        qr.status === 409 && qr.json?.error?.code === 'RUN_NOT_AVAILABLE' && JSON.stringify(counts()) === JSON.stringify(c1),
        `status ${qr.status}`,
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

      // 10b. W2: real imported BootForge content, loaded by the server at startup
      const tu = await api(base, 'GET', '/api/tracks/js/units');
      const packUnits = (tu.json?.units ?? []).filter((x) => x.key.startsWith(`bootforge/${PACK_COURSE}/`));
      step(
        `BootForge ${PACK_COURSE}: all ${packCounts.total} pack units listed on the js track, in pack order`,
        tu.status === 200 &&
          packUnits.length === packCounts.total &&
          packUnits.map((x) => x.key).join('\n') === packCourse.units.map((x) => x.unit.key).join('\n'),
        `listed ${packUnits.length}`,
      );
      const idOf = (key) => packUnits.find((x) => x.key === key)?.id;
      const codeId = idOf(bfCode.unit.key);
      const codeContent = packCourse.content[bfCode.unit.key];

      const cu = await api(base, 'GET', `/api/units/${codeId}`);
      const solutionBody = codeContent.solution.split('\n').find((l) => l.trim().length > 12 && !codeContent.starter.includes(l)) ?? codeContent.solution;
      step(
        'BootForge drill detail: public instructions + starter + test names only; no solution, no test code',
        cu.status === 200 &&
          cu.json.instructions === codeContent.instructions &&
          cu.json.starter === codeContent.starter &&
          cu.json.check.spec.type === 'drill-js' &&
          cu.json.check.spec.tests.every((t) => Object.keys(t).join() === 'name') &&
          !cu.text.includes(JSON.stringify(solutionBody).slice(1, -1)) &&
          !('solution' in cu.json),
        `unit ${codeId} ${bfCode.unit.key}`,
      );

      const cb0 = counts();
      const bw = await api(base, 'POST', `/api/units/${codeId}/submit`, { code: codeContent.starter });
      const cb1 = counts();
      step(
        'BootForge drill: submitting the untouched starter fails (real runner), recorded, no XP',
        bw.status === 200 && bw.json.verdict === 'fail' && bw.json.xp === null && cb1.attempt === cb0.attempt + 1 && cb1.run === cb0.run + 1 && cb1.xp_event === cb0.xp_event,
        `failures=${bw.json?.result?.failures?.length}`,
      );

      const br = await api(base, 'POST', `/api/units/${codeId}/submit`, { code: codeContent.solution });
      const cb2 = counts();
      const wantXp = 10 * bfCode.unit.difficulty;
      const attemptRow = reader.get('SELECT id, unit_id, mode, outcome FROM attempt WHERE id = ?', br.json?.attempt?.id ?? -1);
      const runRow = reader.get('SELECT kind, attempt_id, verdict FROM run WHERE id = ?', br.json?.runId ?? -1);
      const xpRow = reader.get('SELECT amount, kind, unit_id, attempt_id FROM xp_event WHERE id = ?', br.json?.xp?.id ?? -1);
      step(
        `BootForge drill: reference solution submitted -> graded pass, +${wantXp} XP (10 x difficulty), attempt + run + xp rows`,
        br.status === 200 &&
          br.json.verdict === 'pass' &&
          br.json.result.pass === true &&
          br.json.xp?.amount === wantXp &&
          cb2.attempt === cb1.attempt + 1 &&
          cb2.run === cb1.run + 1 &&
          cb2.xp_event === cb1.xp_event + 1 &&
          attemptRow?.unit_id === codeId && attemptRow.mode === 'solo' && attemptRow.outcome === 'pass' &&
          runRow?.kind === 'submit' && runRow.attempt_id === attemptRow.id && runRow.verdict === 'pass' &&
          xpRow?.amount === wantXp && xpRow.kind === 'code' && xpRow.unit_id === codeId && xpRow.attempt_id === attemptRow.id,
        `xp=${JSON.stringify(br.json?.xp)} attempt=${JSON.stringify(attemptRow)} run=${JSON.stringify(runRow)}`,
      );

      const quizUnitId = idOf(bfQuiz.unit.key);
      const qd = await api(base, 'GET', `/api/units/${quizUnitId}`);
      const bq = await api(base, 'POST', `/api/units/${quizUnitId}/submit`, { answer: bfQuiz.unit.checks[0].spec.answerKey });
      step(
        'BootForge quiz: public prompt + choices, key hidden; keyed answer submitted -> pass, +2 XP',
        qd.json?.instructions === packCourse.content[bfQuiz.unit.key].instructions &&
          Array.isArray(qd.json?.check?.spec?.choices) &&
          !('answerKey' in qd.json.check.spec) &&
          bq.json?.verdict === 'pass' &&
          bq.json.xp?.amount === 2,
        `unit ${quizUnitId} xp=${JSON.stringify(bq.json?.xp)}`,
      );

      const outUnitId = idOf(bfOutput.unit.key);
      const od = await api(base, 'GET', `/api/units/${outUnitId}`);
      const bo = await api(base, 'POST', `/api/units/${outUnitId}/submit`, { answer: bfOutput.unit.checks[0].spec.expected });
      step(
        'BootForge predict-output: snippet public, expected hidden; captured output submitted -> pass, +4 XP',
        od.json?.snippet === packCourse.content[bfOutput.unit.key].snippet &&
          !od.text.includes('"expected"') &&
          bo.json?.verdict === 'pass' &&
          bo.json.xp?.amount === 4,
        `unit ${outUnitId} xp=${JSON.stringify(bo.json?.xp)}`,
      );

      const d2 = await api(base, 'GET', '/api/dashboard');
      step(
        `dashboard xp total ${3 + wantXp + 2 + 4} after the BootForge submissions`,
        d2.status === 200 && d2.json?.xp?.total === 3 + wantXp + 2 + 4,
        `xp=${d2.json?.xp?.total}`,
      );

      // 10c. W3a: csbootcamp on the csharp track, graded by the REAL warm C# runner
      const tr = await api(base, 'GET', '/api/tracks');
      const csTrack = tr.json?.tracks?.find((t) => t.id === 'csharp');
      step(
        'tracks: js, csharp, java, agentic in order; csharp unlocked, java still locked',
        tr.status === 200 &&
          tr.json.tracks.map((t) => t.id).join() === 'js,csharp,java,agentic' &&
          csTrack?.locked === false &&
          tr.json.tracks.find((t) => t.id === 'java')?.locked === true,
        JSON.stringify(tr.json?.tracks ?? null),
      );
      const ctu = await api(base, 'GET', '/api/tracks/csharp/units');
      const csListed = (ctu.json?.units ?? []).filter((x) => x.key.startsWith('csbootcamp/'));
      step(
        `csharp track lists all ${csManifest.totals.total} csbootcamp drills in pack order`,
        ctu.status === 200 && csListed.map((x) => x.key).join('\n') === csCourses.flatMap((c) => c.units.map((u) => u.unit.key)).join('\n'),
        `listed ${csListed.length}`,
      );
      const csId = csListed.find((x) => x.key === csUnit.unit.key)?.id;
      const csd = await api(base, 'GET', `/api/units/${csId}`);
      const walkLine = csContent.explanation.split('\n').find((l) => l.trim().length > 30) ?? csContent.explanation;
      step(
        'csbootcamp detail: public drill-cs spec {type, shape, timeoutMs}, instructions + starter; no tests spec, no solution, no walkthrough',
        csd.status === 200 &&
          JSON.stringify(Object.keys(csd.json.check.spec).sort()) === JSON.stringify(['shape', 'timeoutMs', 'type']) &&
          csd.json.check.spec.shape === 'console-check' &&
          csd.json.instructions === csContent.instructions &&
          csd.json.starter === csContent.starter &&
          !csd.text.includes('"files"') &&
          !csd.text.includes(JSON.stringify(walkLine).slice(1, -1)),
        `unit ${csId} ${csUnit.unit.key}`,
      );

      const cc0 = counts();
      const cst = await api(base, 'POST', `/api/units/${csId}/submit`, { code: csContent.starter });
      const cc1 = counts();
      const stFailures = cst.json?.result?.failures ?? [];
      step(
        'csbootcamp: the untouched STARTER (exits 0 upstream!) is graded FAIL by the real C# runner: structured todo failures, recorded, no XP',
        cst.status === 200 &&
          cst.json.verdict === 'fail' &&
          cst.json.result.pass === false &&
          cst.json.xp === null &&
          stFailures.length > 0 &&
          stFailures.every((f) => typeof f.name === 'string' && f.name.length > 0 && /todo/.test(f.message)) &&
          /#done passed=0 failed=0 todo=\d+/.test(cst.json.result.output) &&
          cc1.attempt === cc0.attempt + 1 && cc1.run === cc0.run + 1 && cc1.xp_event === cc0.xp_event,
        `failures=${stFailures.length} ${cst.json?.result?.durationMs}ms (incl. first-run prepare)`,
      );

      const csr = await api(base, 'POST', `/api/units/${csId}/submit`, { code: csContent.solution });
      const cc2 = counts();
      const csXp = 10 * csUnit.unit.difficulty;
      const csAttempt = reader.get('SELECT id, unit_id, mode, outcome FROM attempt WHERE id = ?', csr.json?.attempt?.id ?? -1);
      const csRun = reader.get('SELECT kind, attempt_id, verdict FROM run WHERE id = ?', csr.json?.runId ?? -1);
      const csXpRow = reader.get('SELECT amount, kind, unit_id, attempt_id FROM xp_event WHERE id = ?', csr.json?.xp?.id ?? -1);
      step(
        `csbootcamp: reference solution submitted -> real C# grade pass (failed=0 todo=0), +${csXp} XP (10 x difficulty ${csUnit.unit.difficulty}), attempt + run + xp rows`,
        csr.status === 200 &&
          csr.json.verdict === 'pass' &&
          csr.json.result.pass === true &&
          csr.json.result.failures.length === 0 &&
          /#done passed=\d+ failed=0 todo=0/.test(csr.json.result.output) &&
          csr.json.xp?.amount === csXp &&
          cc2.attempt === cc1.attempt + 1 && cc2.run === cc1.run + 1 && cc2.xp_event === cc1.xp_event + 1 &&
          csAttempt?.unit_id === csId && csAttempt.mode === 'solo' && csAttempt.outcome === 'pass' &&
          csRun?.kind === 'submit' && csRun.attempt_id === csAttempt.id && csRun.verdict === 'pass' &&
          csXpRow?.amount === csXp && csXpRow.kind === 'code' && csXpRow.unit_id === csId && csXpRow.attempt_id === csAttempt.id,
        `xp=${JSON.stringify(csr.json?.xp)} ${csr.json?.result?.durationMs}ms warm`,
      );
      const d3 = await api(base, 'GET', '/api/dashboard');
      step(`dashboard xp total ${3 + wantXp + 2 + 4 + csXp} after the C# submission`, d3.json?.xp?.total === 3 + wantXp + 2 + 4 + csXp, `xp=${d3.json?.xp?.total}`);

      // 10d. W3c: the http-check lesson, graded by the REAL http runner against a fixture server
      const httpId = ids[httpLesson.key];
      const hByKey = await api(base, 'GET', `/api/units/by-key/${encodeURIComponent(httpLesson.key)}`);
      step(
        'GET /units/by-key: http lesson detail with the public spec only (request names/methods/paths, no expectations)',
        hByKey.status === 200 &&
          hByKey.json.unit.id === httpId &&
          hByKey.json.check.spec.requests.every((r) => Object.keys(r).sort().join() === 'method,name,path') &&
          !hByKey.text.includes('"expect"') &&
          !hByKey.text.includes('jsonShape'),
        `unit ${httpId}`,
      );
      const wrongSrv = await startTasksServer('wrong-shape');
      let hw;
      try {
        hw = await api(base, 'POST', `/api/units/${httpId}/submit`, { port: wrongSrv.port });
      } finally {
        await wrongSrv.close();
      }
      step(
        'http check vs a wrong-shape server: recorded FAIL, the two shape requests fail by name, no XP',
        hw.status === 200 && hw.json.verdict === 'fail' && hw.json.xp === null && hw.json.result.failures.map((f) => f.name).join('|') === 'create a task|list tasks',
        JSON.stringify(hw.json?.result?.failures?.map((f) => f.message)),
      );
      const goodSrv = await startTasksServer('good');
      let hg;
      try {
        hg = await api(base, 'POST', `/api/units/${httpId}/submit`, { port: goodSrv.port });
      } finally {
        await goodSrv.close();
      }
      const hFree = (await portIsFree(wrongSrv.port)) && (await portIsFree(goodSrv.port));
      step(
        `http check vs the good fixture server: PASS (3/3 requests), +${10 * httpLesson.difficulty} code XP; fixture servers closed, ports free`,
        hg.status === 200 && hg.json.verdict === 'pass' && hg.json.result.failures.length === 0 && hg.json.xp?.amount === 10 * httpLesson.difficulty && hFree,
        `${hg.json?.result?.durationMs}ms xp=${JSON.stringify(hg.json?.xp)}`,
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
      // a hard kill skips the server's graceful runner shutdown: stop the C# compiler
      // server it started (named pipe derived from the scratch dir) and prove nothing lingers
      const sm = new ScratchManager({ appDataDir: csScratch });
      await sm.shutdown();
      let lingering = [];
      for (let i = 0; i < 20; i++) {
        lingering = [...processesMentioning(sm.pipe), ...processesMentioning(csScratch)];
        if (lingering.length === 0) break;
        await sleep(250);
      }
      step('C# runner: compiler server shut down, no dotnet process mentions the scratch dir/pipe', lingering.length === 0, `pipe ${sm.pipe} ${lingering.join('; ')}`);
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
