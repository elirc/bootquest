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
// verifies the port is free again. W7 (M7 hardening) adds: the startup summary
// (every pack / campaign / seed source with counts), the competency-ladder units
// wired from the REAL stamped seed packs (loaded === built), one real explain-back
// and one real kata played end to end, the campaign link of a ladder unit, the
// authored G3/G4 units, a stamp refusal (tampered seed pack -> the real entrypoint
// refuses to start), a busy-port refusal (second server on the same port) and the
// reset guards (no BOOTQUEST_DB / no --yes-really / server running -> refused).
// Exit 0 only if every step holds.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
// W5b: the committed campaign map (seed:campaign output), loaded at startup (light stamp + loaded === built)
const CAMPAIGN_DIR = join(REPO, 'content', 'campaign');
const campaignManifest = JSON.parse(readFileSync(join(CAMPAIGN_DIR, 'manifest.json'), 'utf8'));
const campaignUnits = campaignManifest.tracks.reduce((n, t) => n + t.counts.units, 0);
const jsCampaign = campaignManifest.tracks.find((t) => t.track === 'js');
// W7: the stamped seed packs the real entrypoint loads by default, counted independently of the server
const SEED_DIR = join(REPO, 'content', 'seed');
const seedItems = ['explainback', 'patches', 'variants'].flatMap((g) =>
  existsSync(join(SEED_DIR, g))
    ? readdirSync(join(SEED_DIR, g))
        .filter((n) => existsSync(join(SEED_DIR, g, n, 'items.json')))
        .flatMap((n) => JSON.parse(readFileSync(join(SEED_DIR, g, n, 'items.json'), 'utf8')).items)
    : [],
);
const ebItems = seedItems.filter((i) => i.kind === 'explain-back');
const g2Count = ebItems.filter((i) => /^G2 BRIEF\b/.test(i.questions[0].prompt)).length;
const kataItems = seedItems.filter((i) => i.kind === 'patch-kata');
const variantItems = seedItems.filter((i) => i.kind === 'variant');
const authoredUnits = JSON.parse(readFileSync(join(REPO, 'content', 'units', 'agentic.json'), 'utf8')).units;
// variants stay PENDING on a fresh DB (their artifact units arrive with a sync), so they add no unit here
const ladderUnitCount = ebItems.length + kataItems.length + authoredUnits.length;

/** Run a node entrypoint (process.execPath --import tsx, never a shell) to completion; returns {code, out}. */
function runNode(entry, args, env, timeoutMs = 120_000) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', entry, ...args], { cwd: REPO, env, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  return { code: r.status, signal: r.signal, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
/** env for a child that must NOT inherit any BOOTQUEST_* setting from the caller's shell */
function cleanEnv(extra) {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith('BOOTQUEST_')) delete e[k];
  return { ...e, ...extra };
}
const RESET = join(REPO, 'server', 'src', 'db', 'reset-cli.ts');

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
  // W7: the refusal steps block this event loop in spawnSync for several seconds; meanwhile the
  // server's keep-alive timeout closes the pooled socket, and the next request on it sees
  // ECONNRESET. A GET is idempotent: retry it once on a fresh connection (never a POST).
  if (method === 'GET') {
    try {
      return await apiOnce(base, method, path, body);
    } catch (err) {
      if (err?.cause?.code !== 'ECONNRESET') throw err;
      return apiOnce(base, method, path, body);
    }
  }
  return apiOnce(base, method, path, body);
}

async function apiOnce(base, method, path, body) {
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
        BOOTQUEST_CAMPAIGN: CAMPAIGN_DIR,
        // W7: the real default seed packs + authored units (named explicitly so a caller's shell cannot override them)
        BOOTQUEST_SEED_ITEMS: ['explainback', 'patches', 'variants']
          .flatMap((g) => (existsSync(join(SEED_DIR, g)) ? readdirSync(join(SEED_DIR, g)).map((n) => join(SEED_DIR, g, n)) : []))
          .filter((d) => existsSync(join(d, 'items.json')))
          .join(','),
        BOOTQUEST_AUTHORED_UNITS: join(REPO, 'content', 'units', 'agentic.json'),
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
      // 3 fixture units (2 smoke + the W3c http lesson) + the real pack course (written units carry no check)
      // + every csbootcamp drill + one placeholder unit per playable campaign quest (no checks until seed:quests)
      // + W7: one ladder unit per explain-back set / kata + the authored G3/G4 units (each with one check)
      const wantUnits = 3 + packCounts.total + csManifest.totals.total + campaignUnits + ladderUnitCount;
      const wantChecks = 3 + packCounts.total - packCounts.written + csManifest.totals.total + ladderUnitCount;
      step(
        `health (3 fixture + ${packCounts.total} BootForge ${PACK_COURSE} + ${csManifest.totals.total} csbootcamp + ${campaignUnits} campaign + ${ladderUnitCount} ladder/authored units: loaded === built)`,
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

      // 10a. W5b: the real campaign map, loaded at boot
      const cj = await api(base, 'GET', '/api/tracks/js/campaign');
      const cjQuests = (cj.json?.acts ?? []).reduce((n, a) => n + a.quests.length, 0);
      const cjava = await api(base, 'GET', '/api/tracks/java/campaign');
      step(
        `campaign: js ${jsCampaign.counts.acts} acts / ${jsCampaign.counts.quests} quests in rank order, act 1 open, act 2 locked; java placeholder locked + inert`,
        cj.status === 200 &&
          cj.json.acts.length === jsCampaign.counts.acts &&
          cjQuests === jsCampaign.counts.quests &&
          cj.json.acts[0].unlocked === true &&
          cj.json.acts[1].unlocked === false &&
          cj.json.acts.every((a) => a.quests.every((q, i, qs) => i === 0 || qs[i - 1].rank < q.rank)) &&
          cjava.status === 200 &&
          cjava.json.acts.length === 1 &&
          cjava.json.acts[0].unlocked === false &&
          cjava.json.acts[0].quests.every((q) => q.state === 'locked' && q.unitId === undefined),
        `js acts ${cj.json?.acts?.length} quests ${cjQuests}`,
      );
      const slateNow = d.json?.slate?.items?.map((i) => i.slot) ?? [];
      const readingStep = cj.json?.acts?.[0]?.quests?.find((q) => q.kind === 'reading' && q.state === 'available');
      const att = readingStep ? await api(base, 'POST', `/api/units/${readingStep.unitId}/self-attest`) : null;
      const dCamp = await api(base, 'GET', '/api/dashboard');
      step(
        'campaign slate slot: present, ticked by an act-1 reading self-attest (5 XP)',
        slateNow.includes('campaign') && att?.status === 200 && att.json.xp.amount === 5 && dCamp.json?.slate?.items?.find((i) => i.slot === 'campaign')?.done === true,
        `slots ${slateNow.join(',')}; attest ${att?.status}`,
      );
      const lockedStep = cj.json?.acts?.[1]?.quests?.find((q) => q.kind === 'reading');
      const la = lockedStep ? await api(base, 'POST', `/api/units/${lockedStep.unitId}/self-attest`) : null;
      step('campaign: a locked act refuses its units (403 ACT_LOCKED)', la?.status === 403 && la.json?.error?.code === 'ACT_LOCKED', `status ${la?.status}`);

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
        `dashboard xp total ${3 + 5 + wantXp + 2 + 4} after the BootForge submissions`,
        d2.status === 200 && d2.json?.xp?.total === 3 + 5 + wantXp + 2 + 4,
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
      step(`dashboard xp total ${3 + 5 + wantXp + 2 + 4 + csXp} after the C# submission`, d3.json?.xp?.total === 3 + 5 + wantXp + 2 + 4 + csXp, `xp=${d3.json?.xp?.total}`);

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

      // 10e. W7: startup summary — one line per loaded source, with its counts
      const seedLines = serverOut.split(/\r?\n/).filter((l) => l.startsWith('[bootquest] seed '));
      step(
        `startup summary: pack + campaign lines, one stamp-verified line per seed pack (${readdirSync(join(SEED_DIR, 'explainback')).length + readdirSync(join(SEED_DIR, 'patches')).filter((n) => !n.endsWith('.json')).length + (existsSync(join(SEED_DIR, 'variants')) ? readdirSync(join(SEED_DIR, 'variants')).length : 0)}), and the ladder line`,
        /\[bootquest\] pack bootforge: .*loaded \d+ === built \d+/.test(serverOut) &&
          /\[bootquest\] campaign js: .*loaded \d+ === built \d+/.test(serverOut) &&
          seedLines.length > 0 &&
          seedLines.every((l) => /stamp verified$/.test(l)) &&
          seedLines.length === readdirSync(join(SEED_DIR, 'explainback')).length + readdirSync(join(SEED_DIR, 'patches')).filter((n) => !n.endsWith('.json')).length + (existsSync(join(SEED_DIR, 'variants')) ? readdirSync(join(SEED_DIR, 'variants')).length : 0) &&
          /\[bootquest\] ladder: explain-back (\d+) === \1 .*kata bank (\d+) === \2 .*authored (\d+) === \3/.test(serverOut),
        `${seedLines.length} seed line(s)`,
      );

      // 10f. W7: the competency-ladder units wired from the REAL stamped seed packs
      const lad = await api(base, 'GET', '/api/ladder');
      step(
        `ladder wiring: ${ebItems.length - g2Count} explain-back + ${g2Count} G2 + ${kataItems.length} kata-bank + ${authoredUnits.length} authored units; ${variantItems.length} retest(s) pending until sync (loaded === built)`,
        lad.status === 200 &&
          lad.json.counts.explainBack === ebItems.length - g2Count &&
          lad.json.counts.g2 === g2Count &&
          lad.json.counts.katas === kataItems.length &&
          lad.json.counts.retests === 0 &&
          lad.json.counts.authored === authoredUnits.length &&
          lad.json.units.filter((u) => u.family === 'kata' || u.family === 'g2' || u.family === 'authored').every((u) => u.trackId === 'agentic') &&
          /retest pending: /.test(serverOut) === variantItems.length > 0,
        JSON.stringify(lad.json?.counts),
      );

      // 10g. W7: one REAL explain-back set end to end (not a fixture)
      const ebUnit = lad.json.units.find((u) => u.family === 'explain-back' && u.repo === 'jstrain2.2');
      const ebItem = ebItems.find((i) => i.provenance.repo === 'jstrain2.2');
      const ebD = await api(base, 'GET', `/api/units/${ebUnit?.id}`);
      const ebLeak = ebItem.questions.flatMap((q) => q.keyPoints).some((kp) => ebD.text.includes(kp.text));
      const ebKey0 = await api(base, 'GET', `/api/units/${ebUnit?.id}/explain-back/key`);
      const ebAns = await api(base, 'POST', `/api/units/${ebUnit?.id}/explain-back/answers`, { answers: ebItem.questions.map((_, i) => `smoke answer ${i + 1}`) });
      const ebKey = await api(base, 'GET', `/api/units/${ebUnit?.id}/explain-back/key`);
      const allIds = ebItem.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => `q${qi + 1}k${ki + 1}`));
      const ebScore = await api(base, 'POST', `/api/units/${ebUnit?.id}/explain-back/self-score`, { perKeyPoint: Object.fromEntries(allIds.map((k) => [k, 'covered'])) });
      step(
        'ladder flow (real explain-back, jstrain2.2): questions only, key 403 before the answer, immutable answer -> key -> self-score 100% (+20 XP, evidence)',
        ebD.status === 200 && ebD.json.explainBack?.questions?.length === ebItem.questions.length && !ebLeak &&
          ebKey0.status === 403 && ebAns.status === 200 && ebKey.status === 200 &&
          ebScore.status === 200 && ebScore.json.passed === true && ebScore.json.xp?.amount === 20 && ebScore.json.evidenceIds.length > 0,
        `unit ${ebUnit?.key}`,
      );

      // 10h. W7: one REAL kata end to end + the G1 stats
      const kUnit = lad.json.units.find((u) => u.family === 'kata' && u.repo === 'tenantadmin');
      const kD = await api(base, 'GET', `/api/units/${kUnit?.id}`);
      const kF = await api(base, 'POST', `/api/units/${kUnit?.id}/kata/findings`, {
        findings: [{ scenario: 'smoke: a cross-tenant request', evidence: 'the patched handler', consequence: 'data leaks across tenants' }],
      });
      const kK = await api(base, 'GET', `/api/units/${kUnit?.id}/kata/key`);
      const kS = kK.json?.defects ? await api(base, 'POST', `/api/units/${kUnit?.id}/kata/self-score`, { perDefect: Object.fromEntries(kK.json.defects.map((d) => [d.id, 'caught'])) }) : null;
      const kStats = await api(base, 'GET', '/api/stats/katas');
      step(
        'ladder flow (real kata, tenantadmin): diff + context without a defect count -> findings -> key -> catch rate 100% (+15 XP) -> G1 stats count it (solo)',
        kD.status === 200 && typeof kD.json.kata?.diff === 'string' && !kD.text.includes('defectCount') &&
          kF.status === 200 && kK.status === 200 && kS?.status === 200 && kS.json.catchRate === 1 && kS.json.xp?.amount === 15 &&
          kStats.json?.katasScored === 1 && kStats.json.assistedCount === 0 && kStats.json.defectsCaught === kK.json.defects.length,
        `unit ${kUnit?.key}, ${kK.json?.defects?.length} defect(s)`,
      );

      // 10i. W7: campaign-act link of a ladder unit (display only; ladder units never inherit an act lock)
      const linked = lad.json.units.find((u) => u.family === 'explain-back' && u.quest && u.quest.track === 'js' && u.quest.actNo > 1);
      const cj2 = await api(base, 'GET', '/api/tracks/js/campaign');
      const linkedAct = cj2.json?.acts?.find((a) => a.ordinal === linked?.quest?.actNo);
      const linkedOpen = linked ? await api(base, 'GET', `/api/units/${linked.id}`) : null;
      step(
        `campaign-act link: ladder explain-back for ${linked?.repo} points at its quest in js act ${linked?.quest?.actNo} (locked act) and stays playable`,
        Boolean(linked) && linkedAct?.unlocked === false && linkedAct.quests.some((q) => q.id === linked.quest.id && q.repo === linked.repo) &&
          linkedOpen?.status === 200 && linkedOpen.json.explainBack?.questions?.length === 3,
        `quest ${linked?.quest?.key}`,
      );

      // 10j. W7: the authored agentic units (spec §8 G3/G4)
      const g3 = await api(base, 'GET', `/api/units/by-key/${encodeURIComponent('agentic/g3-live-delegation')}`);
      const g4 = await api(base, 'GET', `/api/units/by-key/${encodeURIComponent('agentic/g4-verification-engineering')}`);
      const planted = g4.json?.unit ? await api(base, 'POST', `/api/units/${g4.json.unit.id}/run`, { code: 'export async function wrongSolutionFilter() { return { verdict: "accept", reason: "" }; }' }) : null;
      step(
        'G3 + G4 registered on the agentic track; G4 rejects a planted accept-everything filter (real JS runner, gate test fails)',
        g3.json?.unit?.kind === 'repo-task' && g3.json.unit.trackId === 'agentic' && g3.json.check?.spec?.predicates?.some((p) => p.kind === 'ci-green') &&
          g3.json.check.spec.predicates.some((p) => p.kind === 'pr-has-section') &&
          g4.json?.unit?.kind === 'guided-project' && planted?.json?.result?.pass === false &&
          planted.json.result.failures.some((f) => /^GATE:/.test(f.name)),
        planted?.json?.result?.failures?.map((f) => f.name.slice(0, 30)).join(' | '),
      );

      // 10k. W7: busy-port refusal — a second real server on the SAME port refuses before touching any DB
      const db2 = join(dir, 'second.db');
      const busy = runNode(SERVE, [], cleanEnv({ BOOTQUEST_DB: db2, BOOTQUEST_PORT: String(port), BOOTQUEST_PACKS: '', BOOTQUEST_CAMPAIGN: '', BOOTQUEST_SEED_ITEMS: '', BOOTQUEST_AUTHORED_UNITS: '' }));
      step(
        'busy-port refusal: a second server on the same port exits 1 ("already in use") and never creates its DB',
        busy.code === 1 && /already in use/.test(busy.out) && !existsSync(db2),
        `exit ${busy.code}${busy.signal ? ` signal ${busy.signal}` : ''}`,
      );

      // 10l. W7: stamp refusal — a seed pack edited after validation refuses startup (real entrypoint)
      const tampered = join(dir, 'tampered', 'explainback', 'pack');
      cpSync(join(SEED_DIR, 'explainback', readdirSync(join(SEED_DIR, 'explainback'))[0]), tampered, { recursive: true });
      writeFileSync(join(tampered, 'items.json'), readFileSync(join(tampered, 'items.json'), 'utf8').replace('"prompt": "', '"prompt": "EDITED '));
      const port3 = await freePort();
      const db3 = join(dir, 'tampered.db');
      const stamp = runNode(SERVE, [], cleanEnv({ BOOTQUEST_DB: db3, BOOTQUEST_PORT: String(port3), BOOTQUEST_PACKS: '', BOOTQUEST_CAMPAIGN: '', BOOTQUEST_SEED_ITEMS: tampered, BOOTQUEST_AUTHORED_UNITS: '' }));
      step(
        'stamp refusal: a seed pack edited after validation -> the real entrypoint refuses to start (exit 1, names the stamp), port never bound',
        stamp.code === 1 && /failed to start/.test(stamp.out) && /stamp|sha256/.test(stamp.out) && (await portIsFree(port3)),
        stamp.out.split(/\r?\n/).find((l) => /failed to start/.test(l))?.slice(0, 160),
      );

      // 10m. W7: reset guards (never a default path, never without --yes-really, never while a server runs)
      const noDb = runNode(RESET, ['--yes-really'], cleanEnv({}));
      const before = statSync(dbPath).size;
      const noFlag = runNode(RESET, [], cleanEnv({ BOOTQUEST_DB: dbPath, BOOTQUEST_PORT: String(port) }));
      const running = runNode(RESET, ['--yes-really'], cleanEnv({ BOOTQUEST_DB: dbPath, BOOTQUEST_PORT: String(port) }));
      const stillThere = existsSync(dbPath) && !readdirSync(dir).some((f) => f.includes('.reset-')) && reader.get('SELECT COUNT(*) AS n FROM attempt').n > 0;
      step(
        'reset guards: no BOOTQUEST_DB -> exit 2; no --yes-really -> exit 2; server running on the port -> exit 1; the DB and its ledger untouched',
        noDb.code === 2 && /BOOTQUEST_DB is not set/.test(noDb.out) && noFlag.code === 2 && /--yes-really/.test(noFlag.out) &&
          running.code === 1 && /listening on port/.test(running.out) && stillThere && statSync(dbPath).size >= before,
        `exits ${noDb.code}/${noFlag.code}/${running.code}`,
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
