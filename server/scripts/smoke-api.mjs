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
// the javabootcamp Java pack (untouched starter FAIL as todo, a wrong answer FAIL with
// expected/received, the reference solution PASS, all on the real Java runner; nothing resident,
// scratch process-checked at the end) —
// shut down + process-checked at the end) — and (W3c) jstrain: self-run JS
// + TS drills (real self-run runner, real tsc), a forged `#done` line, a quiz
// predict-output item and one jstrain-cs C# drill on the jstrain harness —
// verifies ledger rows through a read connection, kills the server and
// verifies the port is free again. W7 (M7 hardening) adds: the startup summary
// (every pack / campaign / seed source with counts), the competency-ladder units
// wired from the REAL stamped seed packs (loaded === built), one real explain-back
// and one real kata played end to end, the campaign link of a ladder unit, the
// authored G3/G4 units, a stamp refusal (tampered seed pack -> the real entrypoint
// refuses to start), a busy-port refusal (second server on the same port) and the
// reset guards (no BOOTQUEST_DB / no --yes-really / server running -> refused).
// Security fixes add: the local-only lockdown on the real entrypoint (body-less / text/plain
// reveal 415, foreign Origin 403, rebound Host 403, nothing written) and the pre-migration
// startup backup of the seeded DB.
// Exit 0 only if every step holds.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
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
// Java track: the javabootcamp pack (all modules), graded by the real Java runner (javac + java,
// nothing resident; scratch in the temp dir, process-checked at the end). The pinned unit is
// 01-count-vowels: its walkthrough names the classic wrong turn (no capitals), used as the wrong answer.
const JAVA_DIR = join(REPO, 'content', 'packs', 'javabootcamp');
const javaManifest = JSON.parse(readFileSync(join(JAVA_DIR, 'manifest.json'), 'utf8'));
const javaCourses = javaManifest.courses.map((c) => JSON.parse(readFileSync(join(JAVA_DIR, c.file), 'utf8')));
const JAVA_KEY = 'javabootcamp/01-language-core/01-count-vowels';
const javaUnit = javaCourses.flatMap((c) => c.units).find((u) => u.unit.key === JAVA_KEY);
const javaContent = javaCourses.find((c) => JAVA_KEY in c.content).content[JAVA_KEY];
const javaWrong = javaContent.solution.replace('"aeiouAEIOU".indexOf(c)', '"aeiou".indexOf(c)');
// W5b: the committed campaign map (seed:campaign output), loaded at startup (light stamp + loaded === built)
const CAMPAIGN_DIR = join(REPO, 'content', 'campaign');
const campaignManifest = JSON.parse(readFileSync(join(CAMPAIGN_DIR, 'manifest.json'), 'utf8'));
const campaignUnits = campaignManifest.tracks.reduce((n, t) => n + t.counts.units, 0);
const jsCampaign = campaignManifest.tracks.find((t) => t.track === 'js');
const javaCampaign = campaignManifest.tracks.find((t) => t.track === 'java');
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
// variants whose artifact unit is PRE-INSERTED before boot (the http-lab fixture, line ~212) are LIVE
// retest units at startup; every other variant's artifact arrives with a sync (or, for the authored G4
// unit, only on a LATER load — authored units load after retests), so those retests stay pending here
const liveRetests = variantItems.filter((i) => i.unitKey === httpLesson.key).length;
const ladderUnitCount = ebItems.length + kataItems.length + authoredUnits.length + liveRetests;
// W8: the stamped seed:quests packs; every campaign study quest whose repo has one (with quiz items) gains a quiz gate
const QUEST_DIR = join(SEED_DIR, 'quests');
const questPackDirs = existsSync(QUEST_DIR) ? readdirSync(QUEST_DIR).filter((n) => existsSync(join(QUEST_DIR, n, 'items.json'))) : [];
const questQuizzes = new Map(
  questPackDirs.map((n) => [n, JSON.parse(readFileSync(join(QUEST_DIR, n, 'items.json'), 'utf8')).items.filter((i) => i.kind === 'quiz')]),
);
// "Learn more": the stamped seed:notes packs (each binds its quest pack's bytes)
const notesPackDirs = existsSync(join(SEED_DIR, 'notes')) ? readdirSync(join(SEED_DIR, 'notes')).filter((n) => existsSync(join(SEED_DIR, 'notes', n, 'items.json'))) : [];
const campaignQuests = campaignManifest.tracks.flatMap((t) => JSON.parse(readFileSync(join(CAMPAIGN_DIR, t.file), 'utf8')).acts.flatMap((a) => a.quests));
const campaignStudyGates = campaignQuests.filter((q) => q.kind === 'study-quest' && q.unit !== null && (questQuizzes.get(q.repo)?.length ?? 0) > 0).length;
// quest packs (with quiz items) matching NO campaign study quest load as standalone ladder study units (e.g. ww6)
const studyQuestRepos = new Set(campaignQuests.filter((q) => q.kind === 'study-quest').map((q) => q.repo));
const standaloneStudyUnits = [...questQuizzes].filter(([repo, quiz]) => quiz.length > 0 && !studyQuestRepos.has(repo)).length;

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
// W3c: jstrain (self-run JS + TS drills, quiz bank) and jstrain-cs (embedded C# revision)
const JS_DIR = join(REPO, 'content', 'packs', 'jstrain');
const JS_COURSES = ['01-language-core', 'ts-01-types-and-annotations', 'quiz-01-language-core'];
const jsManifest = JSON.parse(readFileSync(join(JS_DIR, 'manifest.json'), 'utf8'));
const jsFiles = Object.fromEntries(JS_COURSES.map((id) => [id, JSON.parse(readFileSync(join(JS_DIR, `${id}.json`), 'utf8'))]));
const jsCount = (k) => JS_COURSES.reduce((n, id) => n + jsManifest.courses.find((c) => c.id === id).counts[k], 0);
const jsDrill = jsFiles['01-language-core'].units.find((u) => u.unit.difficulty === 2);
const jsDrillContent = jsFiles['01-language-core'].content[jsDrill.unit.key];
const tsDrill = jsFiles['ts-01-types-and-annotations'].units[0];
const tsDrillContent = jsFiles['ts-01-types-and-annotations'].content[tsDrill.unit.key];
const jsPredict = jsFiles['quiz-01-language-core'].units.find((u) => u.unit.kind === 'predict-output');
// B4: a real jstrain written (verbal) item: its rubric quotes the model answer's key point
const jsWritten = jsFiles['quiz-01-language-core'].units.find((u) => u.unit.kind === 'written');
const jsWrittenContent = jsFiles['quiz-01-language-core'].content[jsWritten.unit.key];
const JCS_DIR = join(REPO, 'content', 'packs', 'jstrain-cs');
const JCS_COURSE = '01-csharp-language-core';
const jcsFile = JSON.parse(readFileSync(join(JCS_DIR, `${JCS_COURSE}.json`), 'utf8'));
const jcsUnit = jcsFile.units[0];
const jcsContent = jcsFile.content[jcsUnit.unit.key];

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

/**
 * ui-audit #24: choices are SERVED in a stable per-unit secret permutation, so a STORED choice index
 * (fixture / pack oracle) is translated the way a learner answers: by finding the stored choice's
 * TEXT in the served list. Throws (never guesses) when the text is not served.
 */
async function servedChoice(base, unitId, storedChoices, storedIndex) {
  const d = await api(base, 'GET', `/api/units/${unitId}`);
  const at = (d.json?.check?.spec?.choices ?? []).indexOf(storedChoices[storedIndex]);
  if (at === -1) throw new Error(`unit ${unitId}: stored choice ${storedIndex} is not among the served choices`);
  return at;
}
/** the same translation for a study-quiz question (its served choices + the pack item's stored texts) */
function servedStudyChoice(question, item, storedIndex) {
  const texts = item.check.choices ?? item.choices.map((c) => c.text);
  const at = question.choices.indexOf(texts[storedIndex]);
  if (at === -1) throw new Error(`${question.itemKey}: stored choice ${storedIndex} is not served`);
  return at;
}

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

/** A GET with an explicit Host header (fetch does not let a caller forge Host; node:http does). */
function rawGet(port, path, headers) {
  return new Promise((ok, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (text += d));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* checked by the caller */
        }
        ok({ status: res.statusCode, text, json });
      });
    });
    req.on('error', fail);
    req.end();
  });
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
  const javaScratch = join(dir, 'java-scratch');
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
        BOOTQUEST_PACKS: `${PACK_DIR},${CS_DIR},${JS_DIR},${JCS_DIR},${JAVA_DIR}`,
        BOOTQUEST_PACK_COURSES: [PACK_COURSE, ...csManifest.courses.map((c) => c.id), ...JS_COURSES, JCS_COURSE, ...javaManifest.courses.map((c) => c.id)].join(','),
        BOOTQUEST_CS_SCRATCH: csScratch,
        BOOTQUEST_JAVA_SCRATCH: javaScratch,
        BOOTQUEST_CAMPAIGN: CAMPAIGN_DIR,
        // W7: the real default seed packs + authored units (named explicitly so a caller's shell cannot override them)
        BOOTQUEST_SEED_ITEMS: ['explainback', 'patches', 'variants', 'quests', 'notes']
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
    // wall-clock deadline (not an iteration cap: a fast-failing fetch must not burn the budget
    // in seconds) — 180s covers 4 packs + tsx cold start on a loaded box; 250ms between ALL attempts
    const bootDeadline = Date.now() + 180_000;
    while (!up && Date.now() < bootDeadline) {
      if (child.exitCode !== null) break;
      try {
        up = (await fetch(`${base}/api/health`)).ok;
      } catch {
        /* not listening yet */
      }
      if (!up) await sleep(250);
    }
    if (!step('server boots on temp DB + free port', up, `port ${port}`)) {
      console.log(serverOut);
      return false;
    }

    // the seeded DB existed before boot: the entrypoint snapshotted it BEFORE migrating (db/backup.ts)
    const backups = existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')) : [];
    step(
      'startup backup: the existing DB was snapshotted to <db dir>/backups/ before migrations',
      backups.length === 1 && /^bootquest-\d{8}T\d{6}\.\d{3}Z\.db$/.test(backups[0]) && statSync(join(dir, 'backups', backups[0])).size > 0,
      backups.join(',') || 'none',
    );

    const reader = new Db(dbPath); // read connection for ledger verification (WAL)
    const counts = () => ledgerCounts(reader);
    try {
      // 1. health
      const h = await api(base, 'GET', '/api/health');
      // 3 fixture units (2 smoke + the W3c http lesson) + the real pack course (written units carry no check)
      // + every csbootcamp drill + one placeholder unit per playable campaign quest (no checks until seed:quests)
      // + W7: one ladder unit per explain-back set / kata + the authored G3/G4 units + the retests whose
      //   pre-seeded artifact made them live at boot (each with one check)
      const wantUnits = 3 + packCounts.total + csManifest.totals.total + javaManifest.totals.total + campaignUnits + ladderUnitCount + jsCount('total') + jcsFile.units.length + standaloneStudyUnits;
      const wantChecks = 3 + packCounts.total - packCounts.written + csManifest.totals.total + javaManifest.totals.total + ladderUnitCount + jsCount('total') - jsCount('written') + jcsFile.units.length + campaignStudyGates + standaloneStudyUnits;
      step(
        `health (3 fixture + ${packCounts.total} BootForge ${PACK_COURSE} + ${csManifest.totals.total} csbootcamp + ${javaManifest.totals.total} javabootcamp + ${campaignUnits} campaign + ${ladderUnitCount} ladder/authored + ${jsCount('total')} jstrain + ${jcsFile.units.length} jstrain-cs + ${standaloneStudyUnits} standalone study units; + ${campaignStudyGates} W8 study-quest gates: loaded === built)`,
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
      const quizChoices = fixture.units.find((u) => u.key === 'smoke:quiz-typeof-null').checks[0].spec.choices;
      const quizWrongServed = await servedChoice(base, quizId, quizChoices, fixture.submissions.quizWrong);
      const quizRightServed = await servedChoice(base, quizId, quizChoices, fixture.submissions.quizRight);
      const w = await api(base, 'POST', `/api/units/${quizId}/submit`, { answer: quizWrongServed });
      const c2 = counts();
      step(
        'submit wrong: attempt recorded, no XP',
        w.status === 200 && w.json?.verdict === 'fail' && w.json.xp === null && c2.attempt === c1.attempt + 1 && c2.run === c1.run + 1 && c2.xp_event === c1.xp_event,
        JSON.stringify(c2),
      );

      // 5. submit right: XP row
      const ok1 = await api(base, 'POST', `/api/units/${quizId}/submit`, { answer: quizRightServed });
      const c3 = counts();
      step('submit right: XP row (+2)', ok1.json?.verdict === 'pass' && ok1.json.xp?.amount === 2 && c3.xp_event === c2.xp_event + 1, JSON.stringify(ok1.json?.xp));

      // 6. submit right again: already-awarded 0
      const ok2 = await api(base, 'POST', `/api/units/${quizId}/submit`, { answer: quizRightServed });
      step('submit right again: 0 XP already-awarded', ok2.json?.xp?.amount === 0 && ok2.json.xp.reason === 'already-awarded', JSON.stringify(ok2.json?.xp));

      // 6b. local-only lockdown (server/src/api/guard.ts): the cross-site CSRF shapes and a
      // DNS-rebinding Host are refused BEFORE any route runs: the irreversible reveal writes nothing
      const cx0 = counts();
      const noCt = await fetch(`${base}/api/units/${drillId}/reveal`, { method: 'POST' });
      const plain = await fetch(`${base}/api/units/${drillId}/reveal`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
      const foreign = await fetch(`${base}/api/units/${drillId}/reveal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: '{}',
      });
      const rebound = await rawGet(port, `/api/units/${drillId}`, { host: `evil.example:${port}` });
      const lockCodes = [
        [noCt.status, (await noCt.json().catch(() => null))?.error?.code],
        [plain.status, (await plain.json().catch(() => null))?.error?.code],
        [foreign.status, (await foreign.json().catch(() => null))?.error?.code],
        [rebound.status, rebound.json?.error?.code],
      ];
      step(
        'lockdown: body-less / text/plain reveal 415, foreign Origin 403, rebound Host 403; no rows written',
        JSON.stringify(lockCodes) ===
          JSON.stringify([[415, 'UNSUPPORTED_MEDIA_TYPE'], [415, 'UNSUPPORTED_MEDIA_TYPE'], [403, 'ORIGIN_NOT_ALLOWED'], [403, 'HOST_NOT_ALLOWED']]) &&
          JSON.stringify(counts()) === JSON.stringify(cx0),
        JSON.stringify(lockCodes),
      );

      // 7. reveal the drill: row first, then solution (the legit shape: JSON {} as the client sends it)
      const rv = await api(base, 'POST', `/api/units/${drillId}/reveal`, {});
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
      const cjavaQuests = (cjava.json?.acts ?? []).flatMap((a) => a.quests);
      step(
        `campaign: js ${jsCampaign.counts.acts} acts / ${jsCampaign.counts.quests} quests in rank order, act 1 open, act 2 locked; ` +
          `java ${javaCampaign.counts.acts} acts / ${javaCampaign.counts.quests} core study quests, act 1 open, act 2 locked`,
        cj.status === 200 &&
          cj.json.acts.length === jsCampaign.counts.acts &&
          cjQuests === jsCampaign.counts.quests &&
          cj.json.acts[0].unlocked === true &&
          cj.json.acts[1].unlocked === false &&
          cj.json.acts.every((a) => a.quests.every((q, i, qs) => i === 0 || qs[i - 1].rank < q.rank)) &&
          cjava.status === 200 &&
          cjava.json.track.locked === false &&
          cjava.json.acts.length === javaCampaign.counts.acts &&
          cjavaQuests.length === javaCampaign.counts.quests &&
          cjava.json.acts[0].unlocked === true &&
          cjava.json.acts[1].unlocked === false &&
          cjavaQuests.every((q) => q.kind === 'study-quest' && q.core && typeof q.unitId === 'number') &&
          cjava.json.acts.every((a) => a.quests.every((q, i, qs) => i === 0 || qs[i - 1].rank < q.rank)),
        `js acts ${cj.json?.acts?.length} quests ${cjQuests}; java acts ${cjava.json?.acts?.length} quests ${cjavaQuests.length}`,
      );
      const slateNow = d.json?.slate?.items?.map((i) => i.slot) ?? [];
      const readingStep = cj.json?.acts?.[0]?.quests?.find((q) => q.kind === 'reading' && q.state === 'available');
      const att = readingStep ? await api(base, 'POST', `/api/units/${readingStep.unitId}/self-attest`, {}) : null;
      const dCamp = await api(base, 'GET', '/api/dashboard');
      step(
        'campaign slate slot: present, ticked by an act-1 reading self-attest (5 XP)',
        slateNow.includes('campaign') && att?.status === 200 && att.json.xp.amount === 5 && dCamp.json?.slate?.items?.find((i) => i.slot === 'campaign')?.done === true,
        `slots ${slateNow.join(',')}; attest ${att?.status}`,
      );
      const lockedStep = cj.json?.acts?.[1]?.quests?.find((q) => q.kind === 'reading');
      const la = lockedStep ? await api(base, 'POST', `/api/units/${lockedStep.unitId}/self-attest`, {}) : null;
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
      const bfSpec = bfQuiz.unit.checks[0].spec;
      const bq = await api(base, 'POST', `/api/units/${quizUnitId}/submit`, { answer: await servedChoice(base, quizUnitId, bfSpec.choices, bfSpec.answerKey) });
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
        'tracks: js, csharp, java, agentic in order; csharp and java unlocked (java since migration 011)',
        tr.status === 200 &&
          tr.json.tracks.map((t) => t.id).join() === 'js,csharp,java,agentic' &&
          csTrack?.locked === false &&
          tr.json.tracks.find((t) => t.id === 'java')?.locked === false,
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

      // 10c-java. javabootcamp on the java track, graded by the REAL Java runner (javac + java per attempt)
      const jvTu = await api(base, 'GET', '/api/tracks/java/units');
      const javaListed = (jvTu.json?.units ?? []).filter((x) => x.key.startsWith('javabootcamp/'));
      const javaTrack = tr.json?.tracks?.find((t) => t.id === 'java');
      // the rest of the java track: 18 explain-back ladder units — one per Java campaign repo
      // (j1-j5, j7, the six organized-experiment repos) plus the six standalone javabootcamp
      // system-design rubric sets (javabootcamp has no campaign quest, so they link to none)
      const javaOther = (jvTu.json?.units ?? []).filter((x) => !x.key.startsWith('javabootcamp/'));
      const javaEbRepo = /^ladder\/explain-back\/(j[123457]|javabootcamp|organized-experiment-[a-z0-9-]+(?:\.[a-z0-9.-]+)?)\//;
      const javaJbSets = javaOther.filter((x) => x.key.startsWith('ladder/explain-back/javabootcamp/'));
      step(
        `java track lists all ${javaManifest.totals.total} javabootcamp drills in pack order + the 18 explain-backs incl. 6 javabootcamp design sets (java unitCount = pack + 18, 0 done)`,
        jvTu.status === 200 &&
          javaListed.length === javaManifest.totals.total &&
          javaListed.map((x) => x.key).join('\n') === javaCourses.flatMap((c) => c.units.map((u) => u.unit.key)).join('\n') &&
          javaOther.length === 18 && javaOther.every((x) => javaEbRepo.test(x.key)) &&
          javaJbSets.length === 6 &&
          javaTrack?.unitCount === javaManifest.totals.total + 18 && javaTrack.doneCount === 0,
        `listed ${javaListed.length} + ${javaOther.map((x) => x.key).join(', ')}; java unitCount ${javaTrack?.unitCount}`,
      );
      const javaId = javaListed.find((x) => x.key === JAVA_KEY)?.id;
      const jvD = await api(base, 'GET', `/api/units/${javaId}`);
      const jWalkLine = javaContent.explanation.split('\n').find((l) => l.trim().length > 30) ?? javaContent.explanation;
      step(
        'javabootcamp detail: public drill-java spec {type, timeoutMs}, instructions + starter; no tests block, no solution, no walkthrough',
        jvD.status === 200 &&
          JSON.stringify(Object.keys(jvD.json.check.spec).sort()) === JSON.stringify(['timeoutMs', 'type']) &&
          jvD.json.check.spec.type === 'drill-java' &&
          jvD.json.instructions === javaContent.instructions &&
          jvD.json.starter === javaContent.starter &&
          !jvD.text.includes('"files"') &&
          !jvD.text.includes('"aeiouAEIOU"') &&
          !jvD.text.includes(JSON.stringify(jWalkLine).slice(1, -1)),
        `unit ${javaId} ${JAVA_KEY}`,
      );

      const jvC0 = counts();
      const jvSt = await api(base, 'POST', `/api/units/${javaId}/submit`, { code: javaContent.starter });
      const jvC1 = counts();
      const jvStFailures = jvSt.json?.result?.failures ?? [];
      step(
        'javabootcamp: the untouched STARTER (exits 0 upstream) is graded FAIL by the real Java runner: every test todo, recorded, no XP',
        jvSt.status === 200 &&
          jvSt.json.verdict === 'fail' &&
          jvSt.json.result.pass === false &&
          jvSt.json.xp === null &&
          jvStFailures.length > 0 &&
          jvStFailures.every((f) => typeof f.name === 'string' && f.name.length > 0 && /todo/.test(f.message)) &&
          /#done passed=0 failed=0 todo=\d+/.test(jvSt.json.result.output) &&
          jvC1.attempt === jvC0.attempt + 1 && jvC1.run === jvC0.run + 1 && jvC1.xp_event === jvC0.xp_event,
        `failures=${jvStFailures.length} ${jvSt.json?.result?.durationMs}ms (incl. first-run harness compile)`,
      );

      const jvW = await api(base, 'POST', `/api/units/${javaId}/submit`, { code: javaWrong });
      const jvC2 = counts();
      const jvWCase = (jvW.json?.result?.failures ?? []).find((f) => f.name === 'is case-insensitive');
      step(
        'javabootcamp: a WRONG answer (lowercase-only vowels) compiles and FAILs by test name with expected/received, recorded, no XP',
        javaWrong !== javaContent.solution &&
          jvW.status === 200 &&
          jvW.json.verdict === 'fail' &&
          jvW.json.xp === null &&
          jvWCase?.expected === '2' && jvWCase?.actual === '0' &&
          /#done passed=\d+ failed=[1-9]\d* todo=0/.test(jvW.json.result.output) &&
          jvC2.attempt === jvC1.attempt + 1 && jvC2.xp_event === jvC1.xp_event,
        JSON.stringify(jvW.json?.result?.failures ?? null).slice(0, 300),
      );

      const jvR = await api(base, 'POST', `/api/units/${javaId}/submit`, { code: javaContent.solution });
      const jvC3 = counts();
      const javaXp = 10 * javaUnit.unit.difficulty;
      const jvAttempt = reader.get('SELECT id, unit_id, mode, outcome FROM attempt WHERE id = ?', jvR.json?.attempt?.id ?? -1);
      const jvRun = reader.get('SELECT kind, attempt_id, verdict FROM run WHERE id = ?', jvR.json?.runId ?? -1);
      const jvXpRow = reader.get('SELECT amount, kind, unit_id, attempt_id FROM xp_event WHERE id = ?', jvR.json?.xp?.id ?? -1);
      step(
        `javabootcamp: reference solution submitted -> real Java grade pass (failed=0 todo=0), +${javaXp} code XP (10 x difficulty ${javaUnit.unit.difficulty}), attempt + run + xp rows`,
        jvR.status === 200 &&
          jvR.json.verdict === 'pass' &&
          jvR.json.result.pass === true &&
          jvR.json.result.failures.length === 0 &&
          /#done passed=\d+ failed=0 todo=0/.test(jvR.json.result.output) &&
          jvR.json.xp?.amount === javaXp &&
          jvC3.attempt === jvC2.attempt + 1 && jvC3.run === jvC2.run + 1 && jvC3.xp_event === jvC2.xp_event + 1 &&
          jvAttempt?.unit_id === javaId && jvAttempt.mode === 'solo' && jvAttempt.outcome === 'pass' &&
          jvRun?.kind === 'submit' && jvRun.attempt_id === jvAttempt.id && jvRun.verdict === 'pass' &&
          jvXpRow?.amount === javaXp && jvXpRow.kind === 'code' && jvXpRow.unit_id === javaId && jvXpRow.attempt_id === jvAttempt.id,
        `xp=${JSON.stringify(jvR.json?.xp)} ${jvR.json?.result?.durationMs}ms`,
      );
      const jvDash = await api(base, 'GET', '/api/dashboard');
      step(
        `dashboard xp total ${3 + 5 + wantXp + 2 + 4 + csXp + javaXp} after the Java submission; drill:java slate slot present (now completable: javabootcamp drills exist)`,
        jvDash.json?.xp?.total === 3 + 5 + wantXp + 2 + 4 + csXp + javaXp && (jvDash.json?.slate?.items ?? []).some((i) => i.slot === 'drill:java'),
        `xp=${jvDash.json?.xp?.total}`,
      );

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
        `startup summary: pack + campaign lines, one stamp-verified line per seed pack (${readdirSync(join(SEED_DIR, 'explainback')).length + readdirSync(join(SEED_DIR, 'patches')).filter((n) => !n.endsWith('.json')).length + (existsSync(join(SEED_DIR, 'variants')) ? readdirSync(join(SEED_DIR, 'variants')).length : 0) + questPackDirs.length + notesPackDirs.length}), and the ladder line`,
        /\[bootquest\] pack bootforge: .*loaded \d+ === built \d+/.test(serverOut) &&
          /\[bootquest\] campaign js: .*loaded \d+ === built \d+/.test(serverOut) &&
          seedLines.length > 0 &&
          seedLines.every((l) => /stamp verified$/.test(l)) &&
          seedLines.length === readdirSync(join(SEED_DIR, 'explainback')).length + readdirSync(join(SEED_DIR, 'patches')).filter((n) => !n.endsWith('.json')).length + (existsSync(join(SEED_DIR, 'variants')) ? readdirSync(join(SEED_DIR, 'variants')).length : 0) + questPackDirs.length + notesPackDirs.length &&
          /\[bootquest\] ladder: explain-back (\d+) === \1 .*kata bank (\d+) === \2 .*authored (\d+) === \3/.test(serverOut) &&
          /\[bootquest\] study quests js: loaded (\d+) === built \1 quiz gates/.test(serverOut),
        `${seedLines.length} seed line(s)`,
      );

      // 10f. W7: the competency-ladder units wired from the REAL stamped seed packs
      const lad = await api(base, 'GET', '/api/ladder');
      step(
        `ladder wiring: ${ebItems.length - g2Count} explain-back + ${g2Count} G2 + ${kataItems.length} kata-bank + ${authoredUnits.length} authored units; ${liveRetests} retest(s) live (pre-seeded fixture artifact), ${variantItems.length - liveRetests} pending until sync (loaded === built)`,
        lad.status === 200 &&
          lad.json.counts.explainBack === ebItems.length - g2Count &&
          lad.json.counts.g2 === g2Count &&
          lad.json.counts.katas === kataItems.length &&
          lad.json.counts.retests === liveRetests &&
          lad.json.counts.authored === authoredUnits.length &&
          lad.json.units.filter((u) => u.family === 'kata' || u.family === 'g2' || u.family === 'authored').every((u) => u.trackId === 'agentic') &&
          /retest pending: /.test(serverOut) === (variantItems.length - liveRetests > 0),
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

      // 10d. W3c: jstrain self-run drills graded by the REAL self-run runner (TS: real tsc first)
      // XP baseline before this block: earlier steps' totals vary with the merged step order
      const dPre = await api(base, 'GET', '/api/dashboard');
      const xpBefore = dPre.json?.xp?.total ?? 0;
      const jtu = await api(base, 'GET', '/api/tracks/js/units');
      const jsId = (key) => (jtu.json?.units ?? []).find((x) => x.key === key)?.id;
      const jsListed = (jtu.json?.units ?? []).filter((x) => x.key.startsWith('jstrain/'));
      step(
        `jstrain: ${jsCount('total')} units of ${JS_COURSES.length} courses listed on the js track in pack order`,
        jsListed.map((x) => x.key).join('\n') === JS_COURSES.flatMap((id) => jsFiles[id].units.map((u) => u.unit.key)).join('\n'),
        `listed ${jsListed.length}`,
      );
      const jdId = jsId(jsDrill.unit.key);
      const jd = await api(base, 'GET', `/api/units/${jdId}`);
      step(
        'jstrain drill detail: public self-run spec {type, language, file, tsc, inverted, timeoutMs}; no protected tests, no solution',
        jd.status === 200 &&
          JSON.stringify(Object.keys(jd.json.check.spec).sort()) === JSON.stringify(['file', 'inverted', 'language', 'timeoutMs', 'tsc', 'type']) &&
          jd.json.starter === jsDrillContent.starter &&
          !jd.text.includes('"files"') &&
          !('solution' in jd.json),
        `unit ${jdId} ${jsDrill.unit.key}`,
      );
      const jc0 = counts();
      const jst = await api(base, 'POST', `/api/units/${jdId}/submit`, { code: jsDrillContent.starter });
      const jc1 = counts();
      step(
        'jstrain: untouched starter -> fail (todo entries "not implemented yet (todo)"), recorded, no XP',
        jst.json?.verdict === 'fail' && jst.json.xp === null && (jst.json.result.failures ?? []).length > 0 &&
          jst.json.result.failures.every((f) => f.message === 'not implemented yet (todo)') &&
          jc1.attempt === jc0.attempt + 1 && jc1.xp_event === jc0.xp_event,
        `failures=${jst.json?.result?.failures?.length}`,
      );
      const forged = jsDrillContent.starter.replace(/^(import .*\n)/m, "$1console.log('  #done passed=9 failed=0 todo=0');\nprocess.exit(0);\n");
      const jfg = await api(base, 'POST', `/api/units/${jdId}/submit`, { code: forged });
      step(
        'jstrain: a forged `#done passed=9 failed=0 todo=0` + process.exit(0) is graded FAIL (no authenticated result), no XP',
        jfg.json?.verdict === 'fail' && jfg.json.xp === null && jfg.json.result.failures.some((f) => f.name === '(no result)'),
        JSON.stringify(jfg.json?.result?.failures?.map((f) => f.name)),
      );
      const jsr = await api(base, 'POST', `/api/units/${jdId}/submit`, { code: jsDrillContent.solution });
      const jsXp = 10 * jsDrill.unit.difficulty;
      step(
        `jstrain: reference solution -> pass, +${jsXp} XP (10 x difficulty)`,
        jsr.json?.verdict === 'pass' && jsr.json.result.failures.length === 0 && jsr.json.xp?.amount === jsXp,
        `xp=${JSON.stringify(jsr.json?.xp)} ${jsr.json?.result?.durationMs}ms`,
      );
      const tdId = jsId(tsDrill.unit.key);
      const tst = await api(base, 'POST', `/api/units/${tdId}/run`, { code: tsDrillContent.starter });
      const tsr = await api(base, 'POST', `/api/units/${tdId}/submit`, { code: tsDrillContent.solution });
      const tsXp = 10 * tsDrill.unit.difficulty;
      step(
        `jstrain TS: starter run shows tsc errors verbatim + todo; solution (tsc clean) submitted -> pass, +${tsXp} XP`,
        tst.json?.result?.pass === false && /error TS\d+/.test(tst.json.result.output) && tst.json.result.failures.some((f) => f.name === '(tsc)') &&
          tsr.json?.verdict === 'pass' && /tsc: types clean/.test(tsr.json.result.output) && tsr.json.xp?.amount === tsXp,
        `run ${tst.json?.result?.durationMs}ms submit ${tsr.json?.result?.durationMs}ms`,
      );
      const qpId = jsId(jsPredict.unit.key);
      const qpr = await api(base, 'POST', `/api/units/${qpId}/run`, { answer: 'x' });
      const qps = await api(base, 'POST', `/api/units/${qpId}/submit`, { answer: jsPredict.unit.checks[0].spec.expected });
      step(
        'jstrain quiz predict-output: run refused 409; captured output submitted -> pass, +4 XP; keyTokens/runAs never public',
        qpr.status === 409 && qps.json?.verdict === 'pass' && qps.json.xp?.amount === 4,
        `unit ${qpId}`,
      );
      const qpd = await api(base, 'GET', `/api/units/${qpId}`);
      step('jstrain quiz detail leaks no expected/keyTokens/runAs', qpd.status === 200 && !/"expected"|"keyTokens"|"runAs"/.test(qpd.text));

      // 10d'. B4: a real written unit: no model answer and NO rubric (it quotes the key) before the
      // learner's own answer is stored; then the model answer + rubric; no XP, no evidence
      const wId = jsId(jsWritten.unit.key);
      const wd0 = await api(base, 'GET', `/api/units/${wId}`);
      const wKey0 = await api(base, 'GET', `/api/units/${wId}/model-answer`);
      const wc0 = counts();
      const wAns = await api(base, 'POST', `/api/units/${wId}/answer`, { answer: 'SMOKE written answer' });
      const wc1 = counts();
      const wKey1 = await api(base, 'GET', `/api/units/${wId}/model-answer`);
      const wd1 = await api(base, 'GET', `/api/units/${wId}`);
      const rubricLabels = (jsWrittenContent.rubric ?? []).map((r) => JSON.stringify(r.label).slice(1, -1));
      step(
        'jstrain written: detail serves no rubric / model answer before the answer (403 NOT_ANSWERED); stored answer (no XP) -> model answer + rubric',
        wd0.status === 200 && wd0.json.rubric === null && wd0.json.written?.answered === false && rubricLabels.length > 0 &&
          rubricLabels.every((l) => !wd0.text.includes(l)) && !wd0.text.includes(JSON.stringify(jsWrittenContent.solution).slice(1, -1)) &&
          wKey0.status === 403 && wKey0.json?.error?.code === 'NOT_ANSWERED' &&
          wAns.status === 200 && wAns.json.outcome === 'submitted' &&
          wc1.attempt === wc0.attempt + 1 && wc1.xp_event === wc0.xp_event && wc1.evidence === wc0.evidence &&
          wKey1.status === 200 && wKey1.json.attemptId === wAns.json.attemptId && wKey1.json.answer === 'SMOKE written answer' &&
          wKey1.json.modelAnswer === jsWrittenContent.solution &&
          wd1.json?.written?.answered === true && JSON.stringify(wd1.json.rubric) === JSON.stringify(jsWrittenContent.rubric),
        `unit ${wId} ${jsWritten.unit.key}`,
      );

      // 10e. W3c: jstrain-cs on the csharp track, the jstrain harness revision (its own Check.dll)
      const ctu2 = await api(base, 'GET', '/api/tracks/csharp/units');
      const jcsId = (ctu2.json?.units ?? []).find((x) => x.key === jcsUnit.unit.key)?.id;
      const jcst = await api(base, 'POST', `/api/units/${jcsId}/submit`, { code: jcsContent.starter });
      const jcsr = await api(base, 'POST', `/api/units/${jcsId}/submit`, { code: jcsContent.solution });
      const jcsXp = 10 * jcsUnit.unit.difficulty;
      step(
        `jstrain-cs: starter FAIL (todo), solution PASS on the jstrain harness (#done failed=0 todo=0), +${jcsXp} XP`,
        jcst.json?.verdict === 'fail' && jcst.json.xp === null &&
          jcsr.json?.verdict === 'pass' && /#done passed=\d+ failed=0 todo=0/.test(jcsr.json.result.output) && jcsr.json.xp?.amount === jcsXp,
        `starter ${jcst.json?.result?.durationMs}ms (incl. Check.dll prepare) solution ${jcsr.json?.result?.durationMs}ms`,
      );
      const d4 = await api(base, 'GET', '/api/dashboard');
      const total4 = xpBefore + jsXp + tsXp + 4 + jcsXp;
      step(`dashboard xp +${jsXp + tsXp + 4 + jcsXp} (= ${total4}) after the jstrain submissions`, d4.json?.xp?.total === total4, `xp=${d4.json?.xp?.total}`);

      // 10n. W8: a REAL study quest (grok-js, js act 1) — reading list + quiz gate; misses -> review cards; pass +50 (delta XP)
      const sqCamp = await api(base, 'GET', '/api/tracks/js/campaign');
      const sqQuest = sqCamp.json?.acts?.[0]?.quests?.find((q) => q.repo === 'grok-js');
      const sqD = await api(base, 'GET', `/api/units/${sqQuest?.unitId}`);
      const sqKeys = new Map((questQuizzes.get('grok-js') ?? []).map((q) => [q.key, q])); // seed-time oracle
      // ui-audit #24: the keyed choice where it is SERVED (by its text), not its stored index
      const sqRight = (sqD.json?.studyQuest?.questions ?? []).map((q) => servedStudyChoice(q, sqKeys.get(q.itemKey), sqKeys.get(q.itemKey).check.answerKey));
      const sqWrong = sqRight.map((a, i) => (i < 4 ? (a + 1) % sqD.json.studyQuest.questions[i].choices.length : a));
      const sqRun = await api(base, 'POST', `/api/units/${sqQuest?.unitId}/run`, { answers: sqRight });
      const sqC0 = counts();
      const sqFail = await api(base, 'POST', `/api/units/${sqQuest?.unitId}/submit`, { answers: sqWrong });
      const sqC1 = counts();
      const sqQueue = await api(base, 'GET', '/api/reviews/queue');
      const sqCards = reader.get(`SELECT COUNT(*) AS n, MIN(due_at) AS d FROM review_item WHERE kind = 'quiz-miss' AND unit_id = ?`, sqQuest?.unitId);
      step(
        'W8 study quest (real grok-js pack): detail = reading list + questions (no keys), run refused 409; a below-80% answer set is recorded with no XP and its 4 misses become review cards due tomorrow',
        sqQuest?.state === 'available' && sqQuest.contentPending === false && sqD.status === 200 && sqD.json.studyQuest.questions.length === sqKeys.size &&
          sqD.json.studyQuest.readingSteps.every((r) => r.url.startsWith('https://github.com/elirc/grok-js/blob/')) && !/answerKey/.test(sqD.text) &&
          sqRun.status === 409 && sqRun.json?.error?.code === 'RUN_NOT_AVAILABLE' &&
          sqFail.json?.verdict === 'fail' && sqFail.json.xp === null && sqC1.attempt === sqC0.attempt + 1 && sqC1.xp_event === sqC0.xp_event &&
          sqFail.json.studyQuiz.reviewCards.created === 4 && sqCards.n === 4 && sqCards.d > Date.now() && sqQueue.json.items.every((i) => !i.cardKey.startsWith('quiz-miss:')),
        sqFail.json?.result?.output,
      );
      const sqXp0 = (await api(base, 'GET', '/api/dashboard')).json?.xp?.total ?? 0;
      const sqPass = await api(base, 'POST', `/api/units/${sqQuest?.unitId}/submit`, { answers: sqRight });
      const sqXp1 = (await api(base, 'GET', '/api/dashboard')).json?.xp?.total ?? 0;
      const sqAfter = (await api(base, 'GET', '/api/tracks/js/campaign')).json?.acts?.[0]?.quests?.find((q) => q.repo === 'grok-js');
      step(
        'W8 study quest pass: +50 study-quest XP (dashboard delta), quest done on the campaign map, flashcards enrolled',
        sqPass.json?.verdict === 'pass' && sqPass.json.xp?.amount === 50 && sqXp1 === sqXp0 + 50 && sqAfter?.state === 'done' && sqPass.json.studyQuiz.flashcardsEnrolled > 0,
        `xp ${sqXp0} -> ${sqXp1}`,
      );

      // 10o. "Learn more" notes (GET /units/:id/notes) — gates on the REAL server, then the REAL
      // storefront notes pack end to end on a second real server (storefront is a locked act-3 quest
      // here, so the second server loads it without a campaign: a standalone ladder study unit)
      const nCamp = await api(base, 'GET', '/api/tracks/js/campaign');
      const nQuests = (nCamp.json?.acts ?? []).flatMap((a) => a.quests);
      const sfQuest = nQuests.find((q) => q.repo === 'storefront');
      const sfLocked = await api(base, 'GET', `/api/units/${sfQuest?.unitId}/notes`);
      const gjNotes = await api(base, 'GET', `/api/units/${sqQuest?.unitId}/notes`);
      const notesLine = serverOut.split(/\r?\n/).find((l) => l.startsWith('[bootquest] seed notes/storefront:'));
      step(
        'notes gates (real server): a locked-act quest serves no notes (403 ACT_LOCKED); grok-js (passed above) serves its readings and every explanation, one per quiz; the storefront notes pack line is stamp-verified at startup',
        sfLocked.status === 403 && sfLocked.json?.error?.code === 'ACT_LOCKED' &&
          gjNotes.status === 200 && Array.isArray(gjNotes.json?.readings) && gjNotes.json.readings.length >= 2 && gjNotes.json.explanations?.state === 'released' && gjNotes.json.explanations.released.length === (questQuizzes.get('grok-js') ?? []).length && Array.isArray(gjNotes.json.refs) &&
          /15 item\(s\) \(15 note\), stamp verified$/.test(notesLine ?? ''),
        notesLine,
      );

      const sfNotes = JSON.parse(readFileSync(join(SEED_DIR, 'notes', 'storefront', 'items.json'), 'utf8')).items;
      const sfQuiz = new Map((questQuizzes.get('storefront') ?? []).map((q) => [q.key, q]));
      const nPort = await freePort();
      const nDb = join(dir, 'notes.db');
      const nChild = spawn(process.execPath, ['--import', 'tsx', SERVE], {
        cwd: REPO,
        env: cleanEnv({
          BOOTQUEST_DB: nDb,
          BOOTQUEST_PORT: String(nPort),
          BOOTQUEST_PACKS: '',
          BOOTQUEST_CAMPAIGN: '',
          BOOTQUEST_SEED_ITEMS: [join(SEED_DIR, 'quests', 'storefront'), join(SEED_DIR, 'notes', 'storefront')].join(','),
          BOOTQUEST_AUTHORED_UNITS: '',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let nOut = '';
      nChild.stdout.on('data', (d) => (nOut += d));
      nChild.stderr.on('data', (d) => (nOut += d));
      const nBase = `http://127.0.0.1:${nPort}`;
      try {
        let nUp = false;
        const nDeadline = Date.now() + 120_000;
        while (!nUp && Date.now() < nDeadline && nChild.exitCode === null) {
          try {
            nUp = (await fetch(`${nBase}/api/health`)).ok;
          } catch {
            /* not listening yet */
          }
          if (!nUp) await sleep(250);
        }
        const nLad = nUp ? await api(nBase, 'GET', '/api/ladder') : null;
        const nUnit = (nLad?.json?.units ?? []).find((u) => u.family === 'study' && u.repo === 'storefront');
        const n0 = await api(nBase, 'GET', `/api/units/${nUnit?.id}/notes`);
        const afterTitles = sfNotes.filter((x) => x.phase === 'after').map((x) => x.title);
        step(
          'notes (real storefront pack, second real server): 3 readings before answering; all 12 explanations withheld as a COUNT ("unlock after you answer"); no explanation title in the response',
          nUp && n0.status === 200 && n0.json.readings.length === 3 && n0.json.readings.every((r) => r.phase === 'before' && r.excerpts.every((e) => e.url.includes('/blob/9d52bffef289c23d3136f868d201ba76b89a314c/'))) &&
            n0.json.explanations.state === 'locked' && n0.json.explanations.withheld === 12 && n0.json.explanations.released.length === 0 &&
            /unlock after you answer/.test(n0.json.explanations.message) && afterTitles.every((t) => !n0.text.includes(t)),
          nUp ? `unit ${nUnit?.key}` : nOut.slice(-400),
        );
        const nD = await api(nBase, 'GET', `/api/units/${nUnit?.id}`);
        const qs = nD.json?.studyQuest?.questions ?? [];
        const right = qs.map((q) => servedStudyChoice(q, sfQuiz.get(q.itemKey), sfQuiz.get(q.itemKey).check.answerKey));
        const wrong = right.map((a, i) => (i < 3 ? (a + 1) % qs[i].choices.length : a));
        const nRun = await api(nBase, 'POST', `/api/units/${nUnit?.id}/run`, { answers: right });
        const nAfterRun = await api(nBase, 'GET', `/api/units/${nUnit?.id}/notes`);
        const nFail = await api(nBase, 'POST', `/api/units/${nUnit?.id}/submit`, { answers: wrong });
        const n1 = await api(nBase, 'GET', `/api/units/${nUnit?.id}/notes`);
        const missedKeys = new Set(qs.slice(0, 3).map((q) => q.itemKey));
        step(
          'notes gate: /run (409) releases nothing; after a FAILED submit the 9 questions answered right are explained, the 3 missed stay withheld until their review cards are due (no key the day it was missed)',
          nRun.status === 409 && nAfterRun.json?.explanations?.state === 'locked' &&
            nFail.json?.verdict === 'fail' && n1.json?.explanations?.state === 'partial' && n1.json.explanations.withheld === 3 && n1.json.explanations.released.length === 9 &&
            n1.json.explanations.released.every((x) => !missedKeys.has(x.target)) && typeof n1.json.explanations.nextAt === 'number' && n1.json.explanations.nextAt > Date.now(),
          n1.json?.explanations?.message,
        );
        const nPass = await api(nBase, 'POST', `/api/units/${nUnit?.id}/submit`, { answers: right });
        const n2 = await api(nBase, 'GET', `/api/units/${nUnit?.id}/notes`);
        step(
          'notes gate: after a PASSING submit all 12 explanations (one per quiz) are released, each linked to its pinned source',
          nPass.json?.verdict === 'pass' && n2.json?.explanations?.state === 'released' && n2.json.explanations.released.length === 12 &&
            new Set(n2.json.explanations.released.map((x) => x.target)).size === sfQuiz.size && n2.json.explanations.released.every((x) => x.excerpts.length > 0),
          `${n2.json?.explanations?.released?.length} released`,
        );
      } finally {
        nChild.kill();
      }

      // stale refusal: the notes bind the quest pack's items.json bytes; a re-seeded quest pack refuses startup
      const stale = join(dir, 'stale-seed');
      cpSync(join(SEED_DIR, 'quests', 'storefront'), join(stale, 'quests', 'storefront'), { recursive: true });
      cpSync(join(SEED_DIR, 'notes', 'storefront'), join(stale, 'notes', 'storefront'), { recursive: true });
      writeFileSync(join(stale, 'quests', 'storefront', 'items.json'), `${readFileSync(join(stale, 'quests', 'storefront', 'items.json'), 'utf8')} `);
      const sPort = await freePort();
      const staleRun = runNode(SERVE, [], cleanEnv({ BOOTQUEST_DB: join(dir, 'stale.db'), BOOTQUEST_PORT: String(sPort), BOOTQUEST_PACKS: '', BOOTQUEST_CAMPAIGN: '', BOOTQUEST_SEED_ITEMS: [join(stale, 'quests', 'storefront'), join(stale, 'notes', 'storefront')].join(','), BOOTQUEST_AUTHORED_UNITS: '' }));
      step(
        'notes stale refusal: the quest pack changed after its notes were validated -> the real entrypoint refuses to start (exit 1, "stale notes"), port never bound',
        staleRun.code === 1 && /failed to start/.test(staleRun.out) && /stale notes/.test(staleRun.out) && (await portIsFree(sPort)),
        staleRun.out.split(/\r?\n/).find((l) => /failed to start/.test(l))?.slice(0, 200),
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
      // W3c: the jstrain-harness runner has its own compiler server (pipe derived from its dir)
      const sm2 = new ScratchManager({ appDataDir: join(csScratch, 'jstrain-harness') });
      await sm2.shutdown();
      let lingering = [];
      for (let i = 0; i < 20; i++) {
        lingering = [...processesMentioning(sm.pipe), ...processesMentioning(sm2.pipe), ...processesMentioning(csScratch)];
        if (lingering.length === 0) break;
        await sleep(250);
      }
      step('C# runner: compiler server shut down, no dotnet process mentions the scratch dir/pipe', lingering.length === 0, `pipe ${sm.pipe} ${lingering.join('; ')}`);
      // Java runner: nothing stays resident between grades (no compiler server); prove no javac/java
      // process mentions its scratch dir after the kill
      let javaLingering = [];
      for (let i = 0; i < 20; i++) {
        javaLingering = processesMentioning(javaScratch);
        if (javaLingering.length === 0) break;
        await sleep(250);
      }
      step('Java runner: no javac/java process mentions the Java scratch dir (nothing resident)', javaLingering.length === 0, `${javaScratch} ${javaLingering.join('; ')}`);
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
