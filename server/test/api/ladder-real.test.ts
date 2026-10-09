/**
 * W7 (audit #4): the REAL ladder content, end to end on a temp DB — no fixture units.
 * The server boots exactly like `npm run serve` loads content (committed campaign, every
 * committed stamped seed pack under content/seed, the authored agentic units), then:
 *   - one real explain-back set and one real patch kata are reachable and played through
 *     their answer-first flows;
 *   - signalpost is synced from a local tarball of the pinned checkout (.cache/checkouts,
 *     the same tree seed:check verifies; the GitHub client is stubbed: zero network), which
 *     registers U01 as a real program unit; the ladder re-links on sync: U01's explain-back
 *     gains U01 as its artifact prerequisite and the pending changed-example retest is created;
 *   - ONE FULL PROMOTION on real content: U01's real node:test check passes the P3 solution
 *     (leg a) -> U01 explain-back >= 80% (leg b, retest scheduled) -> the retest is CLOSED at
 *     +1 day (no run, no task) -> at the due time the seeded variant's reference solution
 *     passes under the real JS grader (leg c) -> the competency promotes;
 *   - G4's reference solution passes its real tests and a planted accept-everything filter
 *     fails the gate.
 * Skipped (with the reason printed) only when the pinned signalpost checkout is absent.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ExplainBackKeyResponse,
  ExplainBackScoreResponse,
  KataKeyResponse,
  KataScoreResponse,
  KataStatsResponse,
  LadderResponse,
  SubmitResponse,
  UnitDetailResponse,
} from '@bootquest/shared/api';
import type { SeedExplainBackItem, SeedPatchKataItem, SeedVariantItem } from '@bootquest/shared';
import { startServer, type RunningServer } from '../../src/api/serve.ts';
import { DAY_MS, fixedClock } from '../../src/engines/clock.ts';
import { getRating } from '../../src/engines/evidence.ts';
import { createSyncService, resolveSyncPaths } from '../../src/sync/service.ts';
import { offlineGithubClient } from '../../src/sync/github.ts';
import { packTarball } from '../../src/sync/cache.ts';
import { defaultSeedItemDirs, loadSeedItemStore } from '../../src/store/seed-items.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const SP_SHA = 'ff8446042a16d0aaef1687b34932b4f9137e6e0d';
const SP_CHECKOUT = join(REPO, '.cache', 'checkouts', `signalpost-swe-bootcamp@${SP_SHA}`);
const U01_SOLUTION = join(REPO, 'server', 'src', 'runners', 'node-test-file', 'fixtures', 'signalpost', 'solutions', 'u01.mjs');
const HAVE_CHECKOUT = existsSync(join(SP_CHECKOUT, 'docs', 'curriculum', 'program.json'));
if (!HAVE_CHECKOUT) console.warn(`[ladder-real] SKIPPED: pinned signalpost checkout missing at ${SP_CHECKOUT} (see docs/SEEDING.md, checkouts)`);

const freePort = (): Promise<number> =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen({ port: 0, host: '127.0.0.1' }, () => {
      const a = s.address();
      s.close(() => (typeof a === 'object' && a ? ok(a.port) : fail(new Error('no port'))));
    });
  });

describe.skipIf(!HAVE_CHECKOUT)('W7 real ladder content end to end (temp DB, no fixture units)', () => {
  const clock = fixedClock(new Date(2026, 9, 8, 9, 0, 0, 0));
  let tmp: string;
  let running: RunningServer;
  let base: string;
  const store = loadSeedItemStore(defaultSeedItemDirs(join(REPO, 'content', 'seed')));

  const api = async <T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: T; text: string }> => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as T, text };
  };
  const ladder = async () => LadderResponse.parse((await api('GET', '/ladder')).json);
  const allCovered = (item: SeedExplainBackItem) =>
    Object.fromEntries(item.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => [`q${qi + 1}k${ki + 1}`, 'covered'])));

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'bq-ladder-real-'));
    const cacheRoot = join(tmp, 'gh-cache');
    // the GitHub tarball of the pinned commit, packed from the same checkout seed:check verifies
    await packTarball(SP_CHECKOUT, join(cacheRoot, 'elirc', 'signalpost-swe-bootcamp', `${SP_SHA}.tar.gz`), `elirc-signalpost-swe-bootcamp-${SP_SHA.slice(0, 7)}`);
    const port = await freePort();
    const env = {
      BOOTQUEST_DB: join(tmp, 'real.db'),
      BOOTQUEST_PORT: String(port),
      BOOTQUEST_PACKS: '',
      BOOTQUEST_CAMPAIGN: join(REPO, 'content', 'campaign'),
      BOOTQUEST_SEED_ITEMS: defaultSeedItemDirs(join(REPO, 'content', 'seed')).join(','),
      BOOTQUEST_AUTHORED_UNITS: join(REPO, 'content', 'units', 'agentic.json'),
      BOOTQUEST_GITHUB_CACHE: cacheRoot,
      BOOTQUEST_CS_SCRATCH: join(tmp, 'cs'),
    };
    const offline = offlineGithubClient('network stubbed (ladder-real test)');
    const gh = { ...offline, offline: false, resolveHead: async () => ({ sha: SP_SHA, defaultBranch: 'main' }) };
    running = await startServer({ env, clock, sync: createSyncService(resolveSyncPaths(env), gh) });
    base = `http://127.0.0.1:${port}`;
  }, 300_000);

  afterAll(async () => {
    await running?.close();
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('wires every committed explain-back set, G2 rubric and kata as a unit (loaded === built); the U01 retest is pending until sync', async () => {
    const st = running.ladder;
    const ebItems = store.explainBackItems();
    const g2 = ebItems.filter((i) => /^G2 BRIEF\b/.test(i.questions[0]!.prompt)).length;
    expect(st.g2).toEqual({ built: g2, loaded: g2 });
    expect(st.explainBack.built).toBe(ebItems.length - g2);
    expect(st.explainBack.loaded).toBe(st.explainBack.built);
    expect(st.katas).toMatchObject({ built: store.kataItems().length, loaded: store.kataItems().length });
    expect(st.retests.built).toBe(store.variantItems().length);
    expect(st.retests.pending.length).toBe(store.variantItems().length); // no signalpost units before the first sync
    expect(st.authored).toEqual({ built: 2, loaded: 2 });
    const l = await ladder();
    expect(l.counts).toEqual({ explainBack: st.explainBack.loaded, g2, katas: store.kataItems().length, retests: 0, authored: 2 });
    expect(l.units.filter((u) => u.family === 'kata').every((u) => u.trackId === 'agentic')).toBe(true);
    expect(l.units.filter((u) => u.family === 'g2').every((u) => u.trackId === 'agentic')).toBe(true);
    // every ordinary explain-back set's repo is a campaign quest -> linked for display
    expect(l.units.filter((u) => u.family === 'explain-back').every((u) => u.quest !== null)).toBe(true);
  });

  it('a REAL explain-back set plays end to end: questions only -> immutable answer -> key -> self-score (20 XP)', async () => {
    const l = await ladder();
    const unit = l.units.find((u) => u.family === 'explain-back' && u.repo === 'trainjs')!;
    expect(unit).toBeDefined();
    const d = await api('GET', `/units/${unit.id}`);
    const detail = UnitDetailResponse.parse(d.json);
    const item = store.explainBackItems().find((i) => i.provenance.repo === 'trainjs')!;
    expect(detail.explainBack?.questions.map((q) => q.prompt)).toEqual(item.questions.map((q) => q.prompt));
    for (const kp of item.questions.flatMap((q) => q.keyPoints)) expect(d.text).not.toContain(kp.text);
    expect((await api('GET', `/units/${unit.id}/explain-back/key`)).status).toBe(403);
    const ans = await api('POST', `/units/${unit.id}/explain-back/answers`, { answers: item.questions.map((_, i) => `my own answer ${i + 1}`) });
    expect(ans.status, ans.text).toBe(200);
    const key = ExplainBackKeyResponse.parse((await api('GET', `/units/${unit.id}/explain-back/key`)).json);
    expect(key.questions.flatMap((q) => q.keyPoints).length).toBe(item.questions.flatMap((q) => q.keyPoints).length);
    const sc = ExplainBackScoreResponse.parse((await api('POST', `/units/${unit.id}/explain-back/self-score`, { perKeyPoint: allCovered(item) })).json);
    expect(sc).toMatchObject({ passed: true, coverage: 1, xp: { amount: 20 }, retests: [] }); // no project artifact -> no retest
  });

  it('a REAL kata plays end to end: diff + context only (no defect count) -> findings -> key -> catch rate -> G1 stats', async () => {
    const l = await ladder();
    const unit = l.units.find((u) => u.family === 'kata' && u.repo === 'master2')!;
    const d = await api('GET', `/units/${unit.id}`);
    const detail = UnitDetailResponse.parse(d.json);
    expect(detail.kata?.diff.length).toBeGreaterThan(0);
    expect(d.text).not.toContain('defectCount');
    const kataKey = (detail.check!.spec as { kataKey: string }).kataKey;
    const item = store.kataItems().find((k) => k.key === kataKey) as SeedPatchKataItem;
    for (const def of item.seededDefectKey) expect(d.text).not.toContain(def.consequence);
    const f = await api('POST', `/units/${unit.id}/kata/findings`, {
      findings: [{ scenario: 'a provider retries the webhook', evidence: 'the publish is skipped on the duplicate path', consequence: 'downstream never hears about the payment' }],
    });
    expect(f.status, f.text).toBe(200);
    const key = KataKeyResponse.parse((await api('GET', `/units/${unit.id}/kata/key`)).json);
    expect(key.defects.length).toBe(item.seededDefectKey.length);
    const per = Object.fromEntries(key.defects.map((x, i) => [x.id, i === 0 ? 'caught' : 'missed']));
    const sc = KataScoreResponse.parse((await api('POST', `/units/${unit.id}/kata/self-score`, { perDefect: per })).json);
    expect(sc).toMatchObject({ caught: 1, total: item.seededDefectKey.length, xp: { amount: 15 } });
    const stats = KataStatsResponse.parse((await api('GET', '/stats/katas')).json);
    expect(stats).toMatchObject({ katasScored: 1, assistedCount: 0, defectsCaught: 1, defectsTotal: item.seededDefectKey.length });
  });

  it('sync registers U01; the ladder re-links: U01 explain-back -> artifact prerequisite, the U01 retest is created', async () => {
    const s = await api<{ ok: boolean; repos: { error: string | null; program: { units: number; checked: number } | null }[] }>('POST', '/sync', { repos: ['elirc/signalpost-swe-bootcamp'] });
    expect(s.status, s.text).toBe(200);
    expect(s.json.ok).toBe(true);
    expect(s.json.repos[0]!.program).toMatchObject({ units: 12, checked: 3 });
    const l = await ladder();
    const u01 = (await api<{ unit: { id: number } }>('GET', `/units/by-key/${encodeURIComponent('gh:elirc/signalpost-swe-bootcamp:U01')}`)).json.unit.id;
    const eb = l.units.find((u) => u.family === 'explain-back' && u.repo === 'signalpost-swe-bootcamp')!;
    expect(eb.prerequisites).toEqual([u01]);
    const rt = l.units.filter((u) => u.family === 'retest');
    expect(rt).toHaveLength(store.variantItems().length);
    expect(rt[0]!.variationOfUnitId).toBe(u01);
    expect(rt[0]!.trackId).toBe('js');
  }, 300_000);

  it('ONE FULL PROMOTION on real content: U01 artifact -> U01 explain-back -> closed at +1 day -> seeded variant passes at the due time', async () => {
    const u01 = UnitDetailResponse.parse((await api('GET', `/units/by-key/${encodeURIComponent('gh:elirc/signalpost-swe-bootcamp:U01')}`)).json);
    const comp = u01.unit.competencies[0]!;
    expect(comp).toBeDefined();
    const before = getRating(running.db, comp);
    const l = await ladder();
    const eb = l.units.find((u) => u.family === 'explain-back' && u.repo === 'signalpost-swe-bootcamp')!;
    const rtUnit = l.units.find((u) => u.family === 'retest')!;
    // the retest is closed before anything happened
    const closed0 = UnitDetailResponse.parse((await api('GET', `/units/${rtUnit.id}`)).json);
    expect(closed0.retestGate).toEqual({ open: false, reason: 'not-scheduled', opensAt: null });
    expect(closed0.instructions).toBeNull();

    // leg (a): the REAL practice/checks/u01.test.mjs passes the P3 solution
    const art = SubmitResponse.parse((await api('POST', `/units/${u01.unit.id}/submit`, { code: readFileSync(U01_SOLUTION, 'utf8') })).json);
    expect(art.verdict).toBe('pass');
    expect(art.attempt.mode).toBe('solo');
    // leg (b): the U01 explain-back (code hidden), all key points covered
    clock.advance(60_000);
    const ebItem = store.explainBackItems().find((i) => i.provenance.repo === 'signalpost-swe-bootcamp' && i.provenance.path === 'docs/curriculum/U01.md')!;
    expect((await api('POST', `/units/${eb.id}/explain-back/answers`, { answers: ['a', 'b', 'c'].map((x) => `answer ${x}`) })).status).toBe(200);
    const sc = ExplainBackScoreResponse.parse((await api('POST', `/units/${eb.id}/explain-back/self-score`, { perKeyPoint: allCovered(ebItem) })).json);
    expect(sc.passed).toBe(true);
    expect(sc.retests).toHaveLength(1);
    expect(sc.retests[0]!.unitId).toBe(rtUnit.id);
    const dueAt = sc.retests[0]!.dueAt;

    // +1 day: closed, nothing runs, no task text
    clock.advance(DAY_MS);
    const variant = store.variantItems()[0] as SeedVariantItem;
    expect((await api('POST', `/units/${rtUnit.id}/run`, { code: variant.referenceSolution })).status).toBe(409);
    expect((await api('POST', `/units/${rtUnit.id}/submit`, { code: variant.referenceSolution })).status).toBe(409);
    const closed1 = UnitDetailResponse.parse((await api('GET', `/units/${rtUnit.id}`)).json);
    expect(closed1.retestGate).toMatchObject({ open: false, reason: 'not-due', opensAt: dueAt });
    expect(getRating(running.db, comp)).toBe(before);

    // due: the task opens; the deliberately wrong solution fails, the reference passes -> promotion
    clock.set(dueAt);
    const open = UnitDetailResponse.parse((await api('GET', `/units/${rtUnit.id}`)).json);
    expect(open.retestGate?.open).toBe(true);
    expect(open.instructions).toBe(variant.task);
    const wrong = SubmitResponse.parse((await api('POST', `/units/${rtUnit.id}/submit`, { code: variant.deliberatelyWrongSolution })).json);
    expect(wrong.verdict).toBe('fail');
    const rt = SubmitResponse.parse((await api('POST', `/units/${rtUnit.id}/submit`, { code: variant.referenceSolution })).json);
    expect(rt.verdict).toBe('pass');
    expect(rt.attempt.mode).toBe('solo');
    expect(rt.promotions).toEqual(expect.arrayContaining([expect.objectContaining({ competency: comp, from: before, to: before + 1 })]));
    expect(getRating(running.db, comp)).toBe(before + 1);
  }, 300_000);

  it('G4 (authored): the reference filter passes all real tests; a planted accept-everything filter fails the gate test', async () => {
    const g4 = UnitDetailResponse.parse((await api('GET', `/units/by-key/${encodeURIComponent('agentic/g4-verification-engineering')}`)).json);
    expect(g4.unit).toMatchObject({ trackId: 'agentic', kind: 'guided-project' });
    expect(g4.starter).toContain('wrongSolutionFilter');
    const file = JSON.parse(readFileSync(join(REPO, 'content', 'units', 'agentic.json'), 'utf8')) as { content: Record<string, { solution: string }> };
    const planted = await api<{ result: { pass: boolean; failures: { name: string }[] } }>('POST', `/units/${g4.unit.id}/run`, {
      code: 'export async function wrongSolutionFilter() { return { verdict: "accept", reason: "trust me" }; }',
    });
    expect(planted.json.result.pass).toBe(false);
    expect(planted.json.result.failures.map((f) => f.name)).toContain('GATE: rejects the planted bad task whose deliberately wrong solution PASSES the test');
    const ref = await api<{ result: { pass: boolean } }>('POST', `/units/${g4.unit.id}/run`, { code: file.content['agentic/g4-verification-engineering']!.solution });
    expect(ref.json.result.pass).toBe(true);
    const g3 = UnitDetailResponse.parse((await api('GET', `/units/by-key/${encodeURIComponent('agentic/g3-live-delegation')}`)).json);
    expect(g3.unit).toMatchObject({ trackId: 'agentic', kind: 'repo-task' });
    expect(g3.check?.spec.type).toBe('repo');
    expect((g3.check?.spec as { predicates: { kind: string }[] }).predicates.map((p) => p.kind)).toEqual(
      expect.arrayContaining(['branch-exists', 'ci-green', 'pr-has-section']),
    );
  });
});
