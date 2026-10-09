// W8 GATE — study-quest quiz gates make the campaign PLAYABLE, through the REAL HTTP API.
//   npm run demo:campaign      (= node --import tsx server/scripts/campaign-e2e.mjs)
//
// Temp DBs + an injected, settable clock; the owner's DB (BOOTQUEST_DB) is never opened.
// Content is REAL: the 17 stamped seed:quests packs (content/seed/quests, full stamp verified by
// the server's seed loader) and the committed campaign map (content/campaign). The script reads
// the pack files directly ONLY as the seed-time oracle for the right answers.
//
// Part A (the committed campaign, unmodified): the loader wires every campaign study quest whose
//   repo has a pack (JS 10, C# 6) and leaves the rest content-pending; all 7 playable JS act-1 core
//   quests are passed through the API — and act 2 STAYS LOCKED, because only 7 of act 1's 15 core
//   quests have seeded packs (46.7% < 80%). That is the honest state of the real data.
// Part B (the act-unlock proof): a stamped campaign map assembled from the SAME real quest rows —
//   JS act 1 = the 7 pack-backed act-1 quests + 1 real no-pack core quest (stays pending), JS act 2 =
//   the 3 pack-backed act-2 quests (unlock: 80% of act 1 core + level 3), C# act 1 = its 3 pack-backed
//   quests. Walk: a failed submit (a miss -> a review card due tomorrow), then passes one by one;
//   act 2 stays locked at 5/8 and 6/8 (pct leg) and at 7/8 = 87.5% with level 2 (level leg); the C#
//   quests' XP lifts the one global level to 3 and act 2 flips to unlocked via GET /tracks/js/campaign;
//   an act-2 unit then accepts a submit (it answered 403 ACT_LOCKED before). The missed item's card is
//   due the next day with its text, and grades. Every step is a real assertion; exit 0 only if ALL hold.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/api/app.ts';
import { defaultRunners } from '../src/api/runners.ts';
import { openDb } from '../src/db/database.ts';
import { DAY_MS, fixedClock } from '../src/engines/clock.ts';
import { xpToReach } from '../src/engines/level.ts';
import { loadCampaignIntoDb, readCampaign } from '../src/store/campaign.ts';
import { loadSeedItemStoreWithStats } from '../src/store/seed-items.ts';
import { loadStudyQuestsIntoDb } from '../src/store/study-quests.ts';
import { defaultFixtureTracks, writeCampaignFixture } from '../test/campaign-fixture.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const QUESTS = join(REPO, 'content', 'seed', 'quests');
const CAMPAIGN = join(REPO, 'content', 'campaign');

const results = [];
function step(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
  return Boolean(ok);
}
const section = (t) => console.log(`\n== ${t}`);

/** the seed-time oracle: a pack's quiz items read straight from its items.json */
function oracle(repo) {
  const items = JSON.parse(readFileSync(join(QUESTS, repo, 'items.json'), 'utf8')).items;
  return new Map(items.filter((i) => i.kind === 'quiz').map((q) => [q.key, q]));
}
/** answers in the served question order; `wrong` = indexes to answer with a non-key choice */
function answersFor(detail, repo, wrong = []) {
  const o = oracle(repo);
  return detail.studyQuest.questions.map((q, i) => {
    const key = o.get(q.itemKey).check.answerKey;
    return wrong.includes(i) ? (key + 1) % q.choices.length : key;
  });
}

async function boot(tmp, name, campaignDir, store, clock) {
  const db = openDb({ path: join(tmp, `${name}.db`), env: {} });
  loadCampaignIntoDb(db, readCampaign(campaignDir), clock);
  const stats = loadStudyQuestsIntoDb(db, store, clock);
  const app = createApp({ db, clock, runners: defaultRunners(), seedItems: store });
  const server = app.listen(0, '127.0.0.1');
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
  const close = async () => {
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
    db.close();
  };
  return { db, api, stats, close };
}

async function main() {
  const realDb = process.env.BOOTQUEST_DB;
  const realBefore = realDb && existsSync(realDb) ? statSync(realDb).mtimeMs : null;
  const tmp = mkdtempSync(join(tmpdir(), 'bootquest-campaign-e2e-'));
  console.log(`temp dir ${tmp} (real content; the owner's DB is never opened)`);
  const open = [];
  try {
    // ------------------------------------------------------------ content
    section('content: the 17 stamped seed:quests packs through the stamp-checking seed loader');
    const packDirs = readdirSync(QUESTS).filter((n) => existsSync(join(QUESTS, n, 'items.json'))).map((n) => join(QUESTS, n)).sort();
    const { store, packs } = loadSeedItemStoreWithStats(packDirs);
    const quizTotal = packs.reduce((n, p) => n + (p.byKind.quiz ?? 0), 0);
    step('17 quest packs loaded, full stamp verified (quiz + flashcard + reading-step items)', packs.length === 17 && store.questPacks().size === 17, `${quizTotal} quiz items across ${packs.length} packs`);

    // ============================================================ PART A: the committed campaign
    section('PART A — the committed campaign map (content/campaign), unmodified');
    const clockA = fixedClock(new Date(2026, 9, 5, 9, 0, 0, 0));
    const A = await boot(tmp, 'real', CAMPAIGN, store, clockA);
    open.push(A);
    const js = A.stats.tracks.find((t) => t.track === 'js');
    const cs = A.stats.tracks.find((t) => t.track === 'csharp');
    step('loader: JS 10 + C# 6 study-quest gates, loaded === built; quests without a pack stay content-pending; ww6 matches no quest', js.built === 10 && js.loaded === 10 && cs.built === 6 && cs.loaded === 6 && A.stats.unmatchedPacks.join() === 'ww6', `js ${js.loaded}/${js.built} (${js.pending} pending), csharp ${cs.loaded}/${cs.built} (${cs.pending} pending), unmatched ${A.stats.unmatchedPacks.join(',')}`);
    let camp = (await A.api('GET', '/tracks/js/campaign')).json;
    const act1 = camp.acts[0];
    const playable = act1.quests.filter((q) => q.kind === 'study-quest' && q.state === 'available');
    const pendingCore = act1.quests.filter((q) => q.core && q.contentPending);
    step('GET /tracks/js/campaign: act 1 has 15 core quests; the 7 pack-backed ones are available (content-pending chip cleared), 8 stay pending', act1.progress.coreTotal === 15 && playable.length === 7 && playable.every((q) => !q.contentPending) && pendingCore.length === 8 && pendingCore.every((q) => q.state === 'pending'), `playable: ${playable.map((q) => q.repo).join(', ')}`);
    let xpA = 0;
    for (const q of playable) {
      const d = (await A.api('GET', `/units/${q.unitId}`)).json;
      const r = await A.api('POST', `/units/${q.unitId}/submit`, { answers: answersFor(d, q.repo) });
      if (r.json?.verdict === 'pass') xpA += r.json.xp.amount;
      else console.log(`   ${q.repo}: ${r.status} ${r.text.slice(0, 200)}`);
    }
    camp = (await A.api('GET', '/tracks/js/campaign')).json;
    const dashA = (await A.api('GET', '/dashboard')).json;
    step(
      'all 7 playable JS act-1 quests passed via the API (+50 XP each): act 1 core 7/15 = 46.7% < 80% -> act 2 STAYS LOCKED (honest: 8 core quests have no seeded pack yet)',
      xpA === 350 && camp.acts[0].progress.coreDone === 7 && camp.acts[1].unlocked === false && dashA?.xp?.total === 350,
      `xp ${xpA}, core ${camp.acts[0].progress.coreDone}/${camp.acts[0].progress.coreTotal}, level ${camp.level}, act 2 unlocked=${camp.acts[1].unlocked}`,
    );
    await A.close();
    open.pop();

    // ============================================================ PART B: the act-unlock proof
    section('PART B — act-unlock proof on a stamped map assembled from the same real quest rows');
    const real = (t) => JSON.parse(readFileSync(join(CAMPAIGN, `${t}.json`), 'utf8'));
    const realJs = real('js');
    const realCs = real('csharp');
    const hasPack = (q) => store.questPacks().has(q.repo);
    const jsAct1 = realJs.acts[0].quests.filter((q) => q.kind === 'study-quest' && hasPack(q));
    const noPack = realJs.acts[0].quests.find((q) => q.kind === 'study-quest' && q.core && !hasPack(q));
    const jsAct2 = realJs.acts[1].quests.filter((q) => q.kind === 'study-quest' && hasPack(q));
    const csAct1 = realCs.acts[0].quests.filter((q) => q.kind === 'study-quest' && hasPack(q));
    const ACT2_LEVEL = 3;
    const tracks = defaultFixtureTracks();
    tracks.js = {
      format: realJs.format,
      track: 'js',
      acts: [
        { ...realJs.acts[0], quests: [...jsAct1, noPack].sort((x, y) => x.rank - y.rank) },
        { ...realJs.acts[1], unlockLevel: ACT2_LEVEL, quests: jsAct2 },
      ],
    };
    tracks.csharp = { format: realCs.format, track: 'csharp', acts: [{ ...realCs.acts[0], quests: csAct1 }] };
    const dirB = writeCampaignFixture(join(tmp, 'campaign-b'), tracks);
    const clock = fixedClock(new Date(2026, 9, 6, 9, 0, 0, 0));
    const B = await boot(tmp, 'proof', dirB, store, clock);
    open.push(B);
    step(
      `map: JS act 1 = ${jsAct1.length} pack-backed + 1 no-pack core quest (${noPack.repo}); JS act 2 = ${jsAct2.length} (unlock 80% + level ${ACT2_LEVEL}); C# act 1 = ${csAct1.length}; stamped with the real seeder fingerprint`,
      jsAct1.length === 7 && jsAct2.length === 3 && csAct1.length === 3 && B.stats.tracks.find((t) => t.track === 'js').loaded === 10 && B.stats.tracks.find((t) => t.track === 'js').pending === 1,
      JSON.stringify(B.stats.tracks),
    );
    const campB = async () => (await B.api('GET', '/tracks/js/campaign')).json;
    camp = await campB();
    const pendQ = camp.acts[0].quests.find((q) => q.repo === noPack.repo);
    step('start: level 1, act 1 core 0/8, act 2 locked; the no-pack quest is content-pending', camp.level === 1 && camp.acts[0].progress.coreDone === 0 && camp.acts[0].progress.coreTotal === 8 && camp.acts[1].unlocked === false && pendQ.contentPending && pendQ.state === 'pending');

    const act2Unit = camp.acts[1].quests[0];
    const act2Detail0 = (await B.api('GET', `/units/${act2Unit.unitId}`)).json;
    const lockedTry = await B.api('POST', `/units/${act2Unit.unitId}/submit`, { answers: answersFor(act2Detail0, act2Unit.repo) });
    step(`a JS act-2 unit (${act2Unit.repo}) refuses a submit while act 2 is locked (403 ACT_LOCKED, nothing recorded)`, lockedTry.status === 403 && lockedTry.json?.error?.code === 'ACT_LOCKED');

    // a failed submit first: one miss on the first quest -> a review card due tomorrow
    const first = camp.acts[0].quests.find((q) => q.repo !== noPack.repo);
    const firstD = (await B.api('GET', `/units/${first.unitId}`)).json;
    const total = firstD.studyQuest.questions.length;
    const missIdx = [0, 1, 2, 3].slice(0, total - Math.ceil(total * 0.8) + 1); // just enough misses to fall below 80%
    const fail = await B.api('POST', `/units/${first.unitId}/submit`, { answers: answersFor(firstD, first.repo, missIdx) });
    const missedKey = firstD.studyQuest.questions[0].itemKey;
    step(
      `${first.repo}: a failed submit (${total - missIdx.length}/${total} < 80%) is recorded, earns nothing, and shows right/wrong per question without keys`,
      fail.status === 200 && fail.json.verdict === 'fail' && fail.json.xp === null && fail.json.studyQuiz.items.filter((i) => !i.correct).length === missIdx.length && !/answerKey/.test(fail.text),
      fail.json?.result?.output,
    );
    step(
      `the ${missIdx.length} missed item(s) became review cards due the NEXT day (none due today)`,
      fail.json.studyQuiz.reviewCards.created === missIdx.length && fail.json.studyQuiz.reviewCards.dueAt === clock().getTime() + DAY_MS && (await B.api('GET', '/reviews/queue')).json.count === 0,
      `dueAt ${new Date(fail.json.studyQuiz.reviewCards.dueAt).toISOString()}`,
    );

    // pass the act-1 quests one by one; the gate must hold until BOTH legs are met
    let n = 0;
    let xp = 0;
    for (const q of camp.acts[0].quests.filter((x) => x.repo !== noPack.repo)) {
      const d = (await B.api('GET', `/units/${q.unitId}`)).json;
      const r = await B.api('POST', `/units/${q.unitId}/submit`, { answers: answersFor(d, q.repo) });
      n += r.json?.verdict === 'pass' ? 1 : 0;
      xp += r.json?.xp?.amount ?? 0;
      const c = await campB();
      if (n === 5 || n === 6) {
        step(`after ${n} passes: act 1 core ${c.acts[0].progress.coreDone}/8 = ${((c.acts[0].progress.coreDone / 8) * 100).toFixed(1)}% < 80% -> act 2 still locked (pct leg)`, c.acts[0].progress.coreDone === n && c.acts[1].unlocked === false);
      }
      if (n === 7) {
        step(
          `after 7 passes: act 1 core 7/8 = 87.5% >= 80%, but ${xp} XP = level ${c.level} < ${ACT2_LEVEL} -> act 2 still locked (level leg)`,
          c.acts[0].progress.coreDone === 7 && xp === 350 && c.level === 2 && c.acts[1].unlocked === false,
        );
      }
    }
    step('all 7 pack-backed act-1 quests passed solo, +50 study-quest XP each', n === 7 && xp === 350, `${n} passes, ${xp} XP`);
    const repass = await B.api('POST', `/units/${first.unitId}/submit`, { answers: answersFor(firstD, first.repo) });
    step('re-passing a done quest pays 0 XP (already-awarded) and creates no duplicate cards', repass.json?.verdict === 'pass' && repass.json.xp.amount === 0 && repass.json.xp.reason === 'already-awarded' && repass.json.studyQuiz.reviewCards.created === 0);
    step('the no-pack core quest is still content-pending (never completable without its gate)', (await campB()).acts[0].quests.find((q) => q.repo === noPack.repo).state === 'pending');

    // the level leg: C# quests feed the ONE global ledger
    const cscamp = (await B.api('GET', '/tracks/csharp/campaign')).json;
    let csXp = 0;
    for (const q of cscamp.acts[0].quests) {
      const d = (await B.api('GET', `/units/${q.unitId}`)).json;
      const r = await B.api('POST', `/units/${q.unitId}/submit`, { answers: answersFor(d, q.repo) });
      csXp += r.json?.xp?.amount ?? 0;
    }
    const dash = (await B.api('GET', '/dashboard')).json;
    step(`3 C# act-1 study quests passed: +${csXp} XP -> ${dash.xp.total} XP >= ${xpToReach(ACT2_LEVEL)} -> level ${dash.xp.level}`, csXp === 150 && dash.xp.total === 500 && dash.xp.level === ACT2_LEVEL);
    camp = await campB();
    step(
      'GET /tracks/js/campaign: act 2 FLIPPED TO UNLOCKED (87.5% of act 1 core + level 3); its quests are now available',
      camp.acts[1].unlocked === true && camp.level === ACT2_LEVEL && camp.acts[1].quests.every((q) => q.state === 'available' && !q.contentPending),
      `act 2 unlocked=${camp.acts[1].unlocked}, quests ${camp.acts[1].quests.map((q) => `${q.repo}:${q.state}`).join(', ')}`,
    );
    const nowOpen = await B.api('POST', `/units/${act2Unit.unitId}/submit`, { answers: answersFor(act2Detail0, act2Unit.repo) });
    step(`the act-2 unit (${act2Unit.repo}) that answered 403 now accepts a submit: pass, +50 XP, act 2 progress 1/3`, nowOpen.status === 200 && nowOpen.json.verdict === 'pass' && nowOpen.json.xp.amount === 50 && (await campB()).acts[1].progress.coreDone === 1);

    // misses become FSRS cards: due the next day, with their text, gradable
    clock.advance(DAY_MS);
    const queue = (await B.api('GET', '/reviews/queue')).json;
    const card = queue.items.find((i) => i.cardKey === `quiz-miss:${missedKey}`);
    const o = oracle(first.repo).get(missedKey);
    const keyed = o.check.choices[o.check.answerKey];
    step(
      'next day: the missed item is a DUE review card (kind quiz-miss) — front = the question, back = the keyed answer, with its citation',
      card?.kind === 'quiz-miss' && card.unitId === first.unitId && card.card?.front === o.prompt && card.card.back.startsWith(keyed) && /@[0-9a-f]{7} /.test(card.card.source ?? ''),
      `${queue.count} card(s) due (misses + enrolled flashcards); source ${card?.card?.source}`,
    );
    const g = card ? await B.api('POST', `/reviews/${card.id}/grade`, { grade: 'good' }) : null;
    step('the card grades through POST /reviews/:id/grade (+1 review XP, rescheduled)', g?.status === 200 && g.json.nextDueAt > g.json.prevDueAt && g.json.xp.amount === 1);
    const ev = B.db.get(`SELECT COUNT(*) AS n FROM evidence WHERE competency_id = 'code-reading' AND kind = 'submit'`).n;
    const attempts = B.db.get('SELECT COUNT(*) AS n FROM attempt').n;
    step('ledger: every submit (pass or fail) is an attempt with code-reading evidence', ev === attempts && attempts === 1 + 7 + 1 + 3 + 1, `${attempts} attempts, ${ev} evidence rows`);
    await B.close();
    open.pop();
  } finally {
    for (const o of open) await o.close().catch(() => {});
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  step('temp dir removed; the owner DB (BOOTQUEST_DB) was never opened or modified', !existsSync(tmp) && (realBefore === null || statSync(realDb).mtimeMs === realBefore), realDb ? `BOOTQUEST_DB=${realDb}` : 'BOOTQUEST_DB unset');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? `ALL ${results.length} STEPS PASSED` : `${failed.length} of ${results.length} STEPS FAILED: ${failed.map((f) => f.name).join(' | ')}`}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('FAIL  campaign e2e crashed:', err);
  process.exitCode = 1;
});
