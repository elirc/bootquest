// npm run demo:m4 — the scripted M4 vertical-slice gate (spec §11 M4, BUILD-PLAN W4).
//
//  1. REAL sync (one network pass): POST /api/sync for elirc/signalpost-swe-bootcamp
//     through the real server; gh-token GitHub client; tarball lands in a temp cache.
//  2. RENDER: U01's lesson guide via GET /api/refs/:id/content (bytes from the
//     per-SHA cache, never the DB); a DB-wide scan proves no markdown body is stored.
//  3. CHECK: U01's REAL practice/checks/u01.test.mjs through POST /api/units/:id/submit
//     (node-test-file runner): the upstream starter FAILS, the P3 fixture solution PASSES.
//  4. NEW GUIDE: a cached copy under a FAKE sha gains a heading + a new guide file;
//     sync (HEAD stubbed to the fake sha, network calls stubbed to fail) detects the new
//     stable_keys and they appear in GET /api/sync/queue.
//  5. DISCONNECT: a server started with BOOTQUEST_OFFLINE=1 re-renders U01 and
//     revalidates it (submit -> pass) purely from the cache — even after the extracted
//     tree is deleted (re-extracted from the cached tarball); an offline sync re-checks
//     every cached repo with zero network calls.
// Exit 0 only if every assertion held. Uses a temp DB + temp cache; never the owner's.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, type RunningServer } from '@bootquest/server/serve';
import {
  countingClient,
  createGithubClient,
  createSyncService,
  offlineGithubClient,
  packTarball,
  resolveSyncPaths,
  type GithubClient,
} from '@bootquest/server/sync';

const REPO = 'elirc/signalpost-swe-bootcamp';
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SOLUTION = join(ROOT, 'server/src/runners/node-test-file/fixtures/signalpost/solutions/u01.mjs');

let failures = 0;
function check(cond: boolean, what: string): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}`);
  if (!cond) failures++;
}

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen({ port: 0, host: '127.0.0.1' }, () => {
      const a = s.address();
      s.close(() => (typeof a === 'object' && a ? ok(a.port) : fail(new Error('no port'))));
    });
  });
}

async function api<T>(base: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as T };
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

interface UnitList { units: { id: number; key: string; kind: string }[] }
interface Detail { unit: { id: number; key: string; title: string; competencies: string[] }; check: { spec: { type: string } } | null; refs?: { id: number; role: string; path: string; sha: string; contentUrl: string | null }[] }
interface Content { markdown: string; servedFrom: string; ref: { sha: string; path: string } }
interface Submit { verdict: string; result: { pass: boolean; failures: { name: string; message: string }[] }; xp: { amount: number } | null }
interface Report { ok: boolean; offline: boolean; repos: { repo: string; sha: string | null; shaFrom: string | null; tarball: string | null; newKeys: number; refs: Record<string, number>; program: { units: number; checked: number; study: number } | null; error: string | null }[] }
interface Queue { count: number; items: { reason: string; repo: string; path: string; anchor: string | null; title: string; stableKey: string; sha: string }[] }

async function main(): Promise<number> {
  const tmp = mkdtempSync(join(tmpdir(), 'bq-m4-'));
  const dbPath = join(tmp, 'm4.db');
  const cacheRoot = join(tmp, 'gh-cache');
  const env = (extra: Record<string, string> = {}) => ({ BOOTQUEST_DB: dbPath, BOOTQUEST_PACKS: '', BOOTQUEST_GITHUB_CACHE: cacheRoot, ...extra });
  console.log(`[m4] temp dir ${tmp}`);
  let running: RunningServer | null = null;
  const start = async (gh: GithubClient | null, extra: Record<string, string> = {}) => {
    const port = await freePort();
    const e = env({ BOOTQUEST_PORT: String(port), ...extra });
    running = await startServer({ env: e, ...(gh ? { sync: createSyncService(resolveSyncPaths(e), gh) } : {}) });
    return `http://127.0.0.1:${port}`;
  };
  const stop = async () => {
    if (running) await running.close();
    running = null;
  };

  try {
    // ------------------------------------------------------------ 1. real sync
    console.log('\n[m4] 1. REAL sync through POST /api/sync (gh token, network)');
    const real = countingClient(createGithubClient());
    let base = await start(real);
    const s1 = await api<Report>(base, 'POST', '/sync', { repos: [REPO] });
    const r1 = s1.json.repos[0]!;
    console.log(`       ${r1.repo} @ ${r1.sha} (${r1.shaFrom}, tarball ${r1.tarball}), refs ${JSON.stringify(r1.refs)}, program ${JSON.stringify(r1.program)}`);
    console.log(`       network calls: ${JSON.stringify(real.calls)}`);
    check(s1.status === 200 && s1.json.ok, 'sync answered 200 ok');
    check(r1.shaFrom === 'network' && r1.tarball === 'downloaded', 'HEAD resolved over the network and the tarball was downloaded (one real gh fetch)');
    check(real.calls.length === 2 && real.calls[1]!.startsWith('downloadTarball'), 'exactly 2 network calls: resolveHead + downloadTarball');
    check(r1.program?.units === 12 && r1.program.checked === 3 && r1.program.study === 9, 'program.json registered 12 units (U01-U03 checked, U04-U12 study)');
    const baseSha = r1.sha!;
    check(existsSync(join(cacheRoot, 'elirc', 'signalpost-swe-bootcamp', `${baseSha}.tar.gz`)), `tarball cached at gh-cache/elirc/signalpost-swe-bootcamp/${baseSha.slice(0, 7)}….tar.gz`);

    // ------------------------------------------------------------ 2. render
    console.log('\n[m4] 2. RENDER U01 through the API');
    const units = (await api<UnitList>(base, 'GET', '/tracks/js/units')).json.units;
    const u01 = units.find((u) => u.key === `gh:${REPO}:U01`)!;
    check(u01 !== undefined && u01.kind === 'program-unit', `unit ${u01?.key} registered as program-unit (id ${u01?.id})`);
    const detail = (await api<Detail>(base, 'GET', `/units/${u01.id}`)).json;
    console.log(`       ${detail.unit.title} — competencies ${detail.unit.competencies.join(', ')}; check ${detail.check?.spec.type}`);
    for (const r of detail.refs ?? []) console.log(`       ref ${r.role.padEnd(7)} #${r.id} ${r.path}@${r.sha.slice(0, 7)} -> ${r.contentUrl ?? '(not markdown)'}`);
    const guide = detail.refs?.find((r) => r.role === 'guide');
    check(guide?.contentUrl != null, 'unit detail links its lesson guide ref');
    const c1 = (await api<Content>(base, 'GET', `/refs/${guide!.id}/content`)).json;
    console.log(`       servedFrom=${c1.servedFrom}, ${c1.markdown.split('\n').length} lines; first line: ${c1.markdown.split('\n')[0]}`);
    check(c1.markdown.startsWith('# U01') && c1.markdown.includes('U01-02'), 'U01 guide markdown rendered from the cache (contains ticket U01-02)');
    check(c1.servedFrom === 'tarball-cache', 'served from the per-SHA tarball cache');
    // no markdown body anywhere in the DB
    const { openDb } = await import('@bootquest/server/db');
    const peek = openDb({ path: dbPath, env: {} });
    const bodyLines = c1.markdown.split('\n').map((l) => l.trim()).filter((l) => l.length >= 25 && !l.startsWith('#'));
    const tables = peek.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((t) => t.name);
    let leaks = 0;
    for (const t of tables) {
      for (const row of peek.all<Record<string, unknown>>(`SELECT * FROM "${t}"`)) {
        for (const v of Object.values(row)) if (typeof v === 'string' && bodyLines.some((l) => v.includes(l))) leaks++;
      }
    }
    peek.close();
    check(bodyLines.length > 50 && leaks === 0, `no markdown body in the DB: 0 of ${bodyLines.length} U01 body lines found in any column of ${tables.length} tables`);

    // ------------------------------------------------------------ 3. real check via the app
    console.log('\n[m4] 3. U01 REAL practice/checks/u01.test.mjs via POST /api/units/:id/submit');
    const starterBytes = readFileSync(join(cacheRoot, 'elirc', 'signalpost-swe-bootcamp', baseSha, 'practice', 'learner', 'u01.mjs'));
    check(sha256(starterBytes) === '20ecc0ff300663729c39ba1a2260b708ef5d3d64d4fdde5edc067341b94e1e6e', 'upstream starter read from the cache matches its recorded sha256');
    const stub = (await api<Submit>(base, 'POST', `/units/${u01.id}/submit`, { code: starterBytes.toString('utf8') })).json;
    console.log(`       starter  -> verdict ${stub.verdict}; failures: ${stub.result.failures.map((f) => `${f.name}: ${f.message}`).join(' | ')}`);
    check(stub.verdict === 'fail' && stub.result.failures.length >= 2, 'starter stub FAILS the real check');
    const solution = readFileSync(SOLUTION, 'utf8');
    const good = (await api<Submit>(base, 'POST', `/units/${u01.id}/submit`, { code: solution })).json;
    console.log(`       solution -> verdict ${good.verdict}; xp ${good.xp?.amount ?? 0}`);
    check(good.verdict === 'pass' && good.result.pass, 'P3 fixture solution PASSES the real check');
    await stop();

    // ------------------------------------------------------------ 4. simulated new guide
    console.log('\n[m4] 4. NEW GUIDE simulation (fake sha, HEAD stubbed, network stubbed to fail)');
    const fakeSha = sha1(`bootquest-m4-simulated-guide:${baseSha}`);
    const stage = join(tmp, 'stage');
    cpSync(join(cacheRoot, 'elirc', 'signalpost-swe-bootcamp', baseSha), stage, { recursive: true });
    const u01md = join(stage, 'docs', 'curriculum', 'U01.md');
    writeFileSync(u01md, `${readFileSync(u01md, 'utf8')}\n## Simulated follow-up drill (W4 demo)\n\nA heading added after the first sync.\n`);
    mkdirSync(join(stage, 'docs', 'curriculum'), { recursive: true });
    writeFileSync(join(stage, 'docs', 'curriculum', 'NEW_GUIDE.md'), '# A brand-new guide\n\nIntro.\n\n## First exercise\n\nDo the thing.\n');
    await packTarball(stage, join(cacheRoot, 'elirc', 'signalpost-swe-bootcamp', `${fakeSha}.tar.gz`), `elirc-signalpost-swe-bootcamp-${fakeSha.slice(0, 7)}`);
    rmSync(stage, { recursive: true, force: true });
    const offline = offlineGithubClient('network stubbed to fail (M4 demo)');
    const headStub = countingClient({ ...offline, offline: false, resolveHead: async () => ({ sha: fakeSha, defaultBranch: 'main' }) });
    base = await start(headStub);
    const s2 = (await api<Report>(base, 'POST', '/sync', { repos: [REPO] })).json;
    const r2 = s2.repos[0]!;
    console.log(`       ${r2.repo} @ ${r2.sha?.slice(0, 7)} (${r2.shaFrom}, tarball ${r2.tarball}), refs ${JSON.stringify(r2.refs)}, newKeys ${r2.newKeys}`);
    console.log(`       calls: ${JSON.stringify(headStub.calls)}`);
    check(s2.ok && r2.sha === fakeSha && r2.tarball === 'hit', 'sync moved to the fake sha from the tarball cache (no download)');
    check(r2.newKeys === 3, 'exactly 3 new stable_keys detected (1 heading in U01.md + 2 in NEW_GUIDE.md)');
    const q = (await api<Queue>(base, 'GET', '/sync/queue?limit=10000')).json;
    const fresh = q.items.filter((i) => i.reason === 'new');
    for (const i of fresh) console.log(`       queued new: ${i.path}#${i.anchor} "${i.title}" (${i.stableKey})`);
    check(fresh.length === 3 && fresh.some((i) => i.title === 'Simulated follow-up drill (W4 demo)') && fresh.some((i) => i.path === 'docs/curriculum/NEW_GUIDE.md'), 'the new guide sections are in the seed queue (reason "new")');
    const s2b = (await api<Report>(base, 'POST', '/sync', { repos: [REPO] })).json.repos[0]!;
    check(s2b.newKeys === 0 && s2b.refs.inserted === 0 && s2b.refs.updated === 0, 'a repeat sync is idempotent (0 new, 0 updated)');
    await stop();

    // ------------------------------------------------------------ 5. disconnect
    console.log('\n[m4] 5. DISCONNECT: BOOTQUEST_OFFLINE=1 server, network calls fail');
    base = await start(null, { BOOTQUEST_OFFLINE: '1' });
    const d5 = (await api<Detail>(base, 'GET', `/units/${u01.id}`)).json;
    const g5 = d5.refs!.find((r) => r.role === 'guide')!;
    const c5 = (await api<Content>(base, 'GET', `/refs/${g5.id}/content`)).json;
    console.log(`       re-render: ${g5.path}@${c5.ref.sha.slice(0, 7)} servedFrom=${c5.servedFrom}, ${c5.markdown.split('\n').length} lines`);
    check(c5.markdown.startsWith('# U01') && c5.markdown.includes('Simulated follow-up drill'), 'U01 re-rendered offline (at the fake sha, incl. the new heading)');
    // drop the extracted tree of the CHECK's pinned sha: revalidation must re-extract from the tarball, offline
    rmSync(join(cacheRoot, 'elirc', 'signalpost-swe-bootcamp', baseSha), { recursive: true, force: true });
    rmSync(join(cacheRoot, 'elirc', 'signalpost-swe-bootcamp', `${baseSha}.complete`), { force: true });
    const g = (await api<Submit>(base, 'POST', `/units/${u01.id}/submit`, { code: solution })).json;
    console.log(`       revalidate U01 (extracted tree deleted first): verdict ${g.verdict}`);
    check(g.verdict === 'pass', 'U01 revalidated offline: real check re-extracted from the cached tarball, solution PASSES');
    const bad = (await api<Submit>(base, 'POST', `/units/${u01.id}/submit`, { code: starterBytes.toString('utf8') })).json;
    check(bad.verdict === 'fail', 'offline: starter still FAILS');
    const s5 = (await api<Report>(base, 'POST', '/sync', { repos: [REPO] })).json;
    const r5 = s5.repos[0]!;
    console.log(`       offline sync: ${r5.repo} @ ${r5.sha?.slice(0, 7)} (${r5.shaFrom}, tarball ${r5.tarball}), error ${r5.error}`);
    check(s5.offline && s5.ok && r5.shaFrom === 'cache' && r5.tarball === 'hit', 'offline sync revalidates from the cache (shaFrom=cache, tarball hit)');
    await stop();
  } finally {
    await stop();
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  console.log(`\n[m4] ${failures === 0 ? 'M4 VERTICAL SLICE: ALL CHECKS PASSED' : `M4 VERTICAL SLICE: ${failures} CHECK(S) FAILED`}`);
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[m4] CRASHED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  },
);
