// M6 GATE — one full competency-promotion cycle through the REAL HTTP API (spec §6.2, §11 M6).
//   npm run demo:promotion      (= node --import tsx server/scripts/promotion-e2e.mjs)
//
// Everything runs on a TEMP DB with an injected, settable clock; the owner's evidence DB
// (BOOTQUEST_DB) is never opened. Content is FIXTURE content (server/test/fixtures/
// ladder-fixture.json, unit keys "fixture:ladder/...", titles "[fixture] ..."), except the
// explain-back question set and the patch katas, which are produced HERE by the REAL W5a
// generators (seed:explainback / seed:patches over the ww6 fixture checkout) and loaded
// through the stamp-checking seed loader. Grading uses the REAL runners: the http runner
// against a tiny loopback "learner server", the JS grader for the changed-example retest.
//
// Happy path: project artifact (verified, solo) -> explain-back answers -> key -> self-score
// >= 80% (retest scheduled) -> +1 day retest REJECTED -> +2 days retest passes solo ->
// data-http promotes 1 -> 2 with the linked evidence chain.
// Negative legs: assisted artifact, < 80% coverage, same-attempt reuse, forged REPLACE (raw
// SQL on a second connection), failed Review-state FSRS review -> demotion 2 -> 1.
// Every step prints PASS/FAIL; exit 0 only if ALL hold.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { State } from 'ts-fsrs';
import { createApp } from '../src/api/app.ts';
import { defaultRunners, drillJsRunner } from '../src/api/runners.ts';
import { openDb } from '../src/db/database.ts';
import { recordSubmission } from '../src/engines/attempts.ts';
import { DAY_MS, fixedClock } from '../src/engines/clock.ts';
import { evaluatePromotion, getRating, recordEvidence } from '../src/engines/evidence.ts';
import { addReviewItem, deserializeCard, getReviewItem } from '../src/engines/fsrs.ts';
import { insertUnit } from '../src/store/content.ts';
import { ledgerCounts } from '../src/store/queries.ts';
import { loadSeedItemStore } from '../src/store/seed-items.ts';
import { runExplainBack } from '../../tools/seed/src/factory/explainback/run.ts';
import { runPatches } from '../../tools/seed/src/factory/patches/run.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const fixture = JSON.parse(readFileSync(join(REPO, 'server', 'test', 'fixtures', 'ladder-fixture.json'), 'utf8'));
const FX = join(REPO, 'tools', 'seed', 'src', 'factory', 'fixtures');
const WW6 = '09751ceaee909a30e5c4b5ff5cdde99880b9a3e5';
const COMP = 'data-http';
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const results = [];
function step(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
  return Boolean(ok);
}
function section(t) {
  console.log(`\n== ${t}`);
}
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

async function main() {
  const realDb = process.env.BOOTQUEST_DB;
  const realBefore = realDb && existsSync(realDb) ? statSync(realDb).mtimeMs : null;
  const tmp = mkdtempSync(join(tmpdir(), 'bootquest-promotion-e2e-'));
  const dbPath = join(tmp, 'promotion-e2e.db');
  console.log(`temp dir ${tmp} (fixture content; the owner's DB is never opened)`);
  let server = null;
  let learner = null;
  let db = null;
  try {
    // ------------------------------------------------------------ content
    section('content: real W5a generators -> stamped seed packs -> stamp-checking loader');
    const co = join(tmp, 'checkouts', `ww6@${WW6}`);
    mkdirSync(co, { recursive: true });
    cpSync(join(FX, 'ww6'), co, { recursive: true });
    const seedDir = join(tmp, 'seed');
    const eb = runExplainBack({ unit: 'docs/learning/testing-rationale.md', checkout: co, sha: WW6, draft: join(FX, 'drafts', 'explainback-ww6-testing-rationale.json'), out: join(seedDir, 'explainback', 'ww6-tr') });
    const pk = await runPatches({ draft: join(FX, 'drafts', 'patches-ww6.json'), checkout: co, sha: WW6, out: join(seedDir, 'patches', 'ww6-katas') });
    step('seed:explainback + seed:patches validators pass and stamp their packs', eb.ok && pk.ok);
    const seedItems = loadSeedItemStore([join(seedDir, 'explainback', 'ww6-tr'), join(seedDir, 'patches', 'ww6-katas')]);
    const ebKey = fixture.units.find((u) => u.key === 'fixture:ladder/explain-api').checks[0].spec.questionSetKey;
    const ebItem = seedItems.explainBack(ebKey);
    step('the stamped question set the fixture units reference is loaded', ebItem !== undefined, `${ebKey}, ${seedItems.size()} item(s)`);

    db = openDb({ path: dbPath, env: {} });
    const clock = fixedClock(new Date(2026, 9, 5, 9, 0, 0, 0));
    const ids = {};
    for (const u of fixture.units) ids[u.key] = insertUnit(db, u, clock);
    const id = (k) => ids[`fixture:ladder/${k}`];
    step('fixture units inserted (keys fixture:ladder/*, titles [fixture])', Object.keys(ids).every((k) => k.startsWith('fixture:')), `${Object.keys(ids).length} units`);

    // the learner's project: a loopback server the REAL http runner checks
    learner = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise((ok) => learner.listen(0, '127.0.0.1', ok));
    const learnerPort = learner.address().port;

    const app = createApp({ db, clock, runners: defaultRunners(), seedItems });
    server = app.listen(0, '127.0.0.1');
    await new Promise((ok) => server.once('listening', ok));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const api = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* checked by callers */
      }
      return { status: res.status, json, text };
    };
    const comp = async () => (await api('GET', '/competencies')).json.competencies.find((c) => c.id === COMP);
    const KP = ebItem.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => `q${qi + 1}k${ki + 1}`));
    const marks = (n) => Object.fromEntries(KP.map((k, i) => [k, i < n ? 'covered' : 'missed']));
    const ANSWERS = [
      'Read-only roles must not trigger runAllocation; a route-level test would prove the 403 with real middleware.',
      'The transition map test stops regressions, but the worker catch block can still write FAILED over COMPLETED.',
      'Tenant filtering is tested at the repository; finance data leaking across tenants is the critical failure.',
    ];

    // ------------------------------------------------------------ happy path
    section(`happy path: ${COMP} 1 -> 2 (clock starts ${iso(clock().getTime())})`);
    step(`starting rating of ${COMP} is 1`, getRating(db, COMP) === 1);
    const ebUnit = await api('GET', `/units/${id('explain-api')}`);
    const leaks = ebItem.questions.flatMap((q) => q.keyPoints).filter((kp) => ebUnit.text.includes(kp.text));
    step('GET explain-back unit serves the 3 questions and NO key point', ebUnit.status === 200 && ebUnit.json.explainBack.questions.length === 3 && leaks.length === 0 && !/keyPoints/.test(ebUnit.text));

    const artAt = clock().getTime();
    const art = await api('POST', `/units/${id('project-api')}/submit`, { port: learnerPort });
    const artEv = art.json?.evidenceIds?.[0];
    const artRow = artEv ? db.get('SELECT kind, verified, assessor, assistance FROM evidence WHERE id = ?', artEv) : null;
    step(
      'project artifact submit: real http runner passes, solo, verified pipeline artifact evidence',
      art.status === 200 && art.json.verdict === 'pass' && art.json.attempt.mode === 'solo' && artRow?.kind === 'artifact' && artRow.verified === true && artRow.assessor === 'pipeline' && artRow.assistance === 'none',
      `attempt #${art.json?.attempt?.id}, evidence #${artEv}`,
    );

    const keyBefore = await api('GET', `/units/${id('explain-api')}/explain-back/key`);
    step('explain-back key BEFORE answering -> 403 NOT_ANSWERED', keyBefore.status === 403 && keyBefore.json.error.code === 'NOT_ANSWERED');
    clock.advance(5 * 60_000);
    const ebAt = clock().getTime();
    const ans = await api('POST', `/units/${id('explain-api')}/explain-back/answers`, { answers: ANSWERS });
    step('explain-back answers stored immutably (code hidden; solo; no XP yet)', ans.status === 200 && ans.json.mode === 'solo' && ans.json.outcome === 'submitted', `attempt #${ans.json?.attemptId}`);
    const again = await api('POST', `/units/${id('explain-api')}/explain-back/answers`, { answers: ANSWERS });
    step('re-answering the same explain-back -> 403 ALREADY_ANSWERED', again.status === 403 && again.json.error.code === 'ALREADY_ANSWERED');
    const key = await api('GET', `/units/${id('explain-api')}/explain-back/key`);
    step('key revealed only now, with the stored answers verbatim', key.status === 200 && key.json.answers.join('|') === ANSWERS.join('|') && key.json.questions.flatMap((q) => q.keyPoints).length === KP.length, `${KP.length} key points`);
    clock.advance(10 * 60_000);
    const covered = KP.length - 2;
    const score = await api('POST', `/units/${id('explain-api')}/explain-back/self-score`, { perKeyPoint: marks(covered) });
    const retest = score.json?.retests?.[0];
    step(
      `self-score ${covered}/${KP.length} = ${(covered / KP.length) * 100}% (>= 80%): explain-back evidence (assessor self), +20 XP, retest scheduled`,
      score.status === 200 && score.json.passed === true && score.json.xp?.amount === 20 && retest?.unitId === id('project-api-retest'),
      `evidence #${score.json?.evidenceIds?.[0]}, retest opens ${retest ? iso(retest.dueAt) : '?'}`,
    );
    const ebEvRow = db.get('SELECT assessor, score FROM evidence WHERE id = ?', score.json.evidenceIds[0]);
    step('explain-back evidence is self-assessed with coverage as its score', ebEvRow.assessor === 'self' && Math.abs(ebEvRow.score - covered / KP.length) < 1e-9);
    step('retest due >= 2 days after the later of artifact + explain-back attempts', retest.dueAt === Math.max(artAt, ebAt) + 2 * DAY_MS, `artifact ${iso(artAt)}, explain-back ${iso(ebAt)}, due ${iso(retest.dueAt)}`);
    let c = await comp();
    step('dashboard legs: artifact done, explain-back done, retest scheduled', c.promotion.artifact.state === 'done' && c.promotion.explainBack.state === 'done' && c.promotion.retest.state === 'scheduled' && c.promotion.retest.dueAt === retest.dueAt);

    clock.advance(DAY_MS);
    console.log(`  clock -> ${iso(clock().getTime())} (+1 day)`);
    const before1d = ledgerCounts(db);
    const early = await api('POST', `/units/${id('project-api-retest')}/submit`, { code: fixture.solutions.retest });
    step('+1 day: changed-example retest submit REJECTED (409 NOT_DUE)', early.status === 409 && early.json.error.code === 'NOT_DUE', early.json?.error?.message);
    step('+1 day: nothing graded or recorded by the rejected submit', JSON.stringify(ledgerCounts(db)) === JSON.stringify(before1d));
    // defense in depth: even a retest pass that WERE recorded at +1 day (engine path, real grader) does not count
    const retestCheck = db.get('SELECT id, spec FROM "check" WHERE unit_id = ?', id('project-api-retest'));
    const graded = await drillJsRunner(JSON.parse(retestCheck.spec), { code: fixture.solutions.retest });
    const engineEarly = recordSubmission(db, { unitId: id('project-api-retest'), checkId: retestCheck.id, result: graded }, clock);
    recordEvidence(db, { competency: COMP, kind: 'retest', intention: 'engine-layer probe: a 1-day retest', observation: 'real grader pass at +1 day', attemptId: engineEarly.attempt.id }, clock);
    const evalEarly = evaluatePromotion(db, COMP, clock);
    step('+1 day: the engine itself refuses a 1-day retest as leg (c) (48h rule on attempt time)', graded.pass && !evalEarly.eligible && evalEarly.legs.retest === null, evalEarly.missing.find((m) => m.startsWith('retest')));

    clock.set(retest.dueAt);
    console.log(`  clock -> ${iso(clock().getTime())} (+2 days: the scheduled due time)`);
    const rt = await api('POST', `/units/${id('project-api-retest')}/submit`, { code: fixture.solutions.retest });
    const promo = rt.json?.promotions?.[0];
    step('+2 days: variation retest passes SOLO under the real JS grader', rt.status === 200 && rt.json.verdict === 'pass' && rt.json.attempt.mode === 'solo', `attempt #${rt.json?.attempt?.id}, evidence #${rt.json?.evidenceIds?.[0]}`);
    step(`${COMP} PROMOTED 1 -> 2`, promo?.competency === COMP && promo.from === 1 && promo.to === 2 && getRating(db, COMP) === 2, `promotion evidence #${promo?.evidenceId}`);
    const promoRow = promo ? db.get('SELECT observation, verified, assessor FROM evidence WHERE id = ?', promo.evidenceId) : null;
    const chain = `legs: artifact #${artEv}, explain-back #${score.json.evidenceIds[0]}, retest #${rt.json?.evidenceIds?.[0]}`;
    step('the promotion evidence names the LINKED chain artifact -> explain-back -> retest', promoRow?.observation === chain, promoRow?.observation);
    c = await comp();
    step('GET /competencies shows rating 2 and a fresh window (target 3, legs pending)', c.rating === 2 && c.promotion.targetRating === 3 && c.promotion.artifact.state === 'pending');

    // ------------------------------------------------------------ negative legs
    section('negative legs (window reset by the promotion)');
    const assisted = await api('POST', `/units/${id('project-assisted')}/submit`, { port: learnerPort, selfAssisted: true });
    c = await comp();
    step(
      'ASSISTED artifact: passes the check, recorded as assisted, but never anchors leg (a)',
      assisted.status === 200 && assisted.json.verdict === 'pass' && assisted.json.attempt.mode === 'assisted' && c.promotion.artifact.state === 'pending' && evaluatePromotion(db, COMP, clock).legs.artifact === null,
    );
    const assistedEv = assisted.json.evidenceIds[0];

    clock.advance(60 * 60_000);
    const low = await api('POST', `/units/${id('project-low')}/submit`, { port: learnerPort });
    // probed right after the submit (inside the filing window) so the refusal is about REUSE, not lateness
    let reuse = '';
    try {
      recordEvidence(db, { competency: COMP, kind: 'retest', intention: 'reuse the artifact attempt as its own retest', observation: 'forged', attemptId: low.json.attempt.id }, clock);
    } catch (e) {
      reuse = String(e.message);
    }
    step('same-attempt reuse: the artifact attempt cannot double as the retest (engine refuses)', /retest unit/.test(reuse), reuse);
    await api('POST', `/units/${id('explain-low')}/explain-back/answers`, { answers: ANSWERS });
    const lowN = KP.length - 4;
    const lowScore = await api('POST', `/units/${id('explain-low')}/explain-back/self-score`, { perKeyPoint: marks(lowN) });
    c = await comp();
    step(
      `< 80% coverage (${lowN}/${KP.length} = ${(lowN / KP.length) * 100}%): recorded, no XP, NO retest scheduled, leg (b) shows failed`,
      low.json.verdict === 'pass' && lowScore.status === 200 && lowScore.json.passed === false && lowScore.json.xp === null && lowScore.json.retests.length === 0 && c.promotion.explainBack.state === 'failed',
    );
    clock.advance(2 * DAY_MS + 60_000);
    const lowRetest = await api('POST', `/units/${id('project-low-retest')}/submit`, { code: fixture.solutions.retest });
    step('...and a passing retest 2 days later still does NOT promote (leg (b) missing)', lowRetest.json.verdict === 'pass' && lowRetest.json.promotions.length === 0 && getRating(db, COMP) === 2);

    const rescore = await api('POST', `/units/${id('explain-low')}/explain-back/self-score`, { perKeyPoint: marks(KP.length) });
    step('same-attempt reuse: re-scoring the scored answer -> 409 ALREADY_SCORED', rescore.status === 409 && rescore.json.error.code === 'ALREADY_SCORED');
    const reanswer = await api('POST', `/units/${id('explain-low')}/explain-back/answers`, { answers: ANSWERS });
    step('same-attempt reuse: answering again to get a better score -> 403 ALREADY_ANSWERED', reanswer.status === 403 && reanswer.json.error.code === 'ALREADY_ANSWERED');
    let reuse2 = '';
    try {
      recordEvidence(db, { competency: COMP, kind: 'artifact', intention: 'reuse the explain-back answer as an artifact', observation: 'forged', attemptId: lowScore.json.attemptId }, clock);
    } catch (e) {
      reuse2 = String(e.message);
    }
    step('same-attempt reuse: an explain-back answer cannot be filed as an artifact (engine refuses)', /graded submit attempt/.test(reuse2), reuse2);

    // forged REPLACE from a SECOND raw connection (no wrapper pragmas: an attacker's sqlite shell)
    const raw = new DatabaseSync(dbPath);
    const forge = (sql, ...p) => {
      try {
        raw.prepare(sql).run(...p);
        return 'ACCEPTED';
      } catch (e) {
        return String(e.message);
      }
    };
    const r1 = forge(
      `REPLACE INTO evidence (id, competency_id, attempt_id, unit_id, kind, intention, observation, assistance, assessor, rating, verified, score, created_at)
       VALUES (?, ?, ?, ?, 'artifact', 'laundered', 'laundered', 'none', 'pipeline', NULL, 1, 1, ?)`,
      assistedEv,
      COMP,
      assisted.json.attempt.id,
      id('project-assisted'),
      clock().getTime(),
    );
    const r2 = forge(
      `INSERT OR REPLACE INTO attempt (id, unit_id, check_id, mode, assisted, assistance_source, outcome, score, answer, variation_unit_id, created_at)
       VALUES (?, ?, NULL, 'solo', 0, 'none', 'pass', 1, NULL, NULL, ?)`,
      assisted.json.attempt.id,
      id('project-assisted'),
      clock().getTime(),
    );
    const r3 = forge(`UPDATE competency_rating SET rating = 3, last_evidence_id = ? WHERE competency_id = ?`, assistedEv, COMP);
    raw.close();
    step('forged REPLACE of the assisted evidence row (laundering assistance) -> aborted', /append-only/.test(r1), r1);
    step('forged INSERT OR REPLACE of the assisted attempt (assisted -> solo) -> aborted', /append-only/.test(r2), r2);
    step('forged UPDATE of competency_rating -> aborted', /rating integrity/.test(r3), r3);
    const after = db.get('SELECT assistance, intention FROM evidence WHERE id = ?', assistedEv);
    step('...and the ledger is unchanged (still assisted, rating still 2)', after.assistance === 'self' && after.intention !== 'laundered' && getRating(db, COMP) === 2);

    section('demotion: a failed review of a Review-state card drops the competency one notch');
    const card = addReviewItem(db, { cardKey: 'fixture:card/http-idempotency', kind: 'card', competencyId: COMP }, clock); // fixture card (seed setup)
    for (let i = 0; i < 6 && deserializeCard(getReviewItem(db, card.id).fsrs_state).state !== State.Review; i++) {
      clock.set(Math.max(clock().getTime(), getReviewItem(db, card.id).due_at));
      const g = await api('POST', `/reviews/${card.id}/grade`, { grade: 'good' });
      if (g.status !== 200) throw new Error(`grading good failed: ${g.text}`);
    }
    step('card graduated to FSRS Review state via the API (graded good when due)', deserializeCard(getReviewItem(db, card.id).fsrs_state).state === State.Review);
    clock.set(getReviewItem(db, card.id).due_at);
    const lapse = await api('POST', `/reviews/${card.id}/grade`, { grade: 'again' });
    const dem = lapse.json?.demotion;
    const demRow = dem ? db.get('SELECT kind, rating, observation FROM evidence WHERE id = ?', dem.evidenceId) : null;
    step(`lapse (again on a Review card) DEMOTES ${COMP} 2 -> 1`, lapse.status === 200 && dem?.from === 2 && dem.to === 1 && getRating(db, COMP) === 1, `demotion evidence #${dem?.evidenceId}`);
    step('the demotion is an evidence row (kind demotion, rating 1, names the card)', demRow?.kind === 'demotion' && demRow.rating === 1 && /http-idempotency/.test(demRow.observation), demRow?.observation);
    c = await comp();
    step('GET /competencies shows rating 1 after the demotion', c.rating === 1);

    const ev = (await api('GET', `/evidence?competency=${COMP}&limit=100`)).json;
    console.log(`\n  ${COMP} evidence trail (${ev.total} rows, newest first):`);
    for (const e of ev.items.slice().reverse()) {
      console.log(`    #${e.id} ${e.kind.padEnd(12)} ${e.assessor.padEnd(8)} assist=${e.assistance.padEnd(4)} verified=${String(e.verified).padEnd(5)} ${e.score === null ? '' : `score=${Math.round(e.score * 1000) / 1000} `}${e.rating === null ? '' : `rating=${e.rating} `}${e.observation.slice(0, 90)}`);
    }
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
    }
    if (learner) {
      learner.closeAllConnections();
      await new Promise((ok) => learner.close(ok));
    }
    if (db) db.close();
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  step('temp dir removed; the owner DB (BOOTQUEST_DB) was never opened or modified', !existsSync(tmp) && (realBefore === null || statSync(realDb).mtimeMs === realBefore), realDb ? `BOOTQUEST_DB=${realDb}` : 'BOOTQUEST_DB unset');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? `ALL ${results.length} STEPS PASSED` : `${failed.length} of ${results.length} STEPS FAILED: ${failed.map((f) => f.name).join(' | ')}`}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('FAIL  promotion e2e crashed:', err);
  process.exitCode = 1;
});
