import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckSpec } from '@bootquest/shared';
import { CacheMissError, CachePathError, GithubCache } from '../src/sync/cache.ts';
import { NetworkUnavailableError } from '../src/sync/github.ts';
import { SyncConfigError, seedQueue } from '../src/sync/job.ts';
import { localNoon, makeTempDb, type TempDb } from './helpers.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { fakeGithub, forkTree, makeSyncFixture, PINNED_SHA, SIGNALPOST, type SyncFixture } from './sync-helpers.ts';

const SHA2 = '2'.repeat(40);
const SHA3 = '3'.repeat(40);

describe('per-SHA tarball + blob cache', { timeout: 120_000 }, () => {
  let fx: SyncFixture;
  beforeEach(() => {
    fx = makeSyncFixture();
  });
  afterEach(() => fx.cleanup());

  it('miss downloads ONE tarball; then hit; a deleted extracted tree is rebuilt from the cached tarball (no download)', async () => {
    const cache = new GithubCache(fx.cacheRoot, fx.gh);
    const a = await cache.ensureTree(SIGNALPOST, PINNED_SHA);
    expect(a.tarball).toBe('downloaded');
    expect(existsSync(join(fx.cacheRoot, 'elirc', 'signalpost-swe-bootcamp', `${PINNED_SHA}.tar.gz`))).toBe(true);
    expect(readFileSync(join(a.dir, 'docs', 'curriculum', 'U01.md'), 'utf8')).toMatch(/^# U01/);
    const b = await cache.ensureTree(SIGNALPOST, PINNED_SHA);
    expect(b.tarball).toBe('hit');
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(join(fx.cacheRoot, 'elirc', 'signalpost-swe-bootcamp', `${PINNED_SHA}.complete`));
    fx.gh.online = false; // re-extraction must not need the network
    const c = await cache.ensureTree(SIGNALPOST, PINNED_SHA);
    expect(c.tarball).toBe('hit');
    expect(existsSync(join(c.dir, 'practice', 'checks', 'u01.test.mjs'))).toBe(true);
    expect(fx.gh.calls.downloadTarball).toBe(1);
  });

  it('offline with nothing cached is a NetworkUnavailableError, never an empty success', async () => {
    fx.gh.online = false;
    const cache = new GithubCache(fx.cacheRoot, fx.gh);
    await expect(cache.ensureTree(SIGNALPOST, PINNED_SHA)).rejects.toBeInstanceOf(NetworkUnavailableError);
    await expect(cache.readBlob(SIGNALPOST, PINNED_SHA, 'docs/curriculum/U01.md')).rejects.toBeInstanceOf(NetworkUnavailableError);
  });

  it('render blobs: tree when the sha is extracted, else ONE blob fetch on first view, then the blob cache (offline)', async () => {
    const cache = new GithubCache(fx.cacheRoot, fx.gh);
    const first = await cache.readBlob(SIGNALPOST, PINNED_SHA, 'docs/curriculum/U01.md');
    expect(first.servedFrom).toBe('network');
    fx.gh.online = false;
    const second = await cache.readBlob(SIGNALPOST, PINNED_SHA, 'docs/curriculum/U01.md');
    expect(second.servedFrom).toBe('blob-cache');
    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(fx.gh.calls.fetchBlob).toBe(1);
    fx.gh.online = true;
    await cache.ensureTree(SIGNALPOST, PINNED_SHA);
    expect((await cache.readBlob(SIGNALPOST, PINNED_SHA, 'docs/curriculum/U01.md')).servedFrom).toBe('tarball-cache');
  });

  it('refuses any path that is not a plain repo-relative path, and a short sha', async () => {
    const cache = new GithubCache(fx.cacheRoot, fx.gh);
    await cache.ensureTree(SIGNALPOST, PINNED_SHA);
    for (const p of ['../secret.md', 'docs/../../x.md', '/etc/passwd', 'C:/Windows/win.ini', 'docs\\U01.md', 'docs//U01.md', '']) {
      await expect(cache.readBlob(SIGNALPOST, PINNED_SHA, p), p).rejects.toBeInstanceOf(CachePathError);
    }
    await expect(cache.treeFile(SIGNALPOST, PINNED_SHA, 'docs/nope.md')).rejects.toBeInstanceOf(CacheMissError);
    expect(() => cache.treeDir(SIGNALPOST, 'ff84460')).toThrow(CachePathError);
    expect(() => cache.treeDir('../evil', PINNED_SHA)).toThrow(CachePathError);
  });
});

describe('sync job', { timeout: 120_000 }, () => {
  let fx: SyncFixture;
  let tmp: TempDb;
  const clock = fixedClock(localNoon(2026, 10, 8));
  beforeEach(() => {
    fx = makeSyncFixture();
    tmp = makeTempDb();
  });
  afterEach(() => {
    tmp.cleanup();
    fx.cleanup();
  });
  const db = () => tmp.db;
  const count = (sql: string, ...p: (string | number)[]) => db().get<{ n: number }>(sql, ...p)!.n;

  it('first sync registers refs, program units (U01-U03 checked, U04-U12 study), tickets, and queues every key as initial', async () => {
    const r = await fx.svc.run(db(), clock);
    expect(r.ok).toBe(true);
    const x = r.repos[0]!;
    expect(x).toMatchObject({ repo: SIGNALPOST, sha: PINNED_SHA, shaFrom: 'network', tarball: 'downloaded', markdownFiles: 2, error: null });
    expect(x.program).toEqual({ units: 12, checked: 3, study: 9, checkDrift: [] });
    // 13 U01.md sections + 2 README sections + 12 program milestones; the apps/ copy is excluded
    expect(x.refs).toEqual({ inserted: 27, updated: 0, unchanged: 0, missing: 0 });
    expect(count(`SELECT COUNT(*) AS n FROM content_ref WHERE path LIKE 'apps/%'`)).toBe(0);
    expect(x.newKeys).toBe(27);
    expect(seedQueue(db()).items.every((i) => i.reason === 'initial')).toBe(true);
    expect(seedQueue(db()).count).toBe(27);

    const units = db().all<{ key: string; kind: string; code: string; target_level: number }>('SELECT key, kind, code, target_level FROM unit ORDER BY id');
    expect(units.map((u) => [u.code, u.kind])).toEqual([
      ['U01', 'program-unit'], ['U02', 'program-unit'], ['U03', 'program-unit'],
      ...['U04', 'U05', 'U06', 'U07', 'U08', 'U09', 'U10', 'U11', 'U12'].map((c) => [c, 'study']),
    ]);
    expect(units[0]!.key).toBe(`gh:${SIGNALPOST}:U01`);
    // free-text competencies mapped through competency_alias (U02: systematic debugging / problem decomposition)
    const u02c = db().all<{ c: string }>(`SELECT competency_id AS c FROM unit_competency uc JOIN unit u ON u.id = uc.unit_id WHERE u.code = 'U02' ORDER BY c`).map((r) => r.c);
    expect(u02c).toEqual(['code-reading', 'feature-delivery']);
    // linear prerequisite chain
    expect(count(`SELECT COUNT(*) AS n FROM unit_prerequisite`)).toBe(11);
    expect(count(`SELECT COUNT(*) AS n FROM ticket`)).toBe(48);
    expect(db().get<{ c: string | null }>(`SELECT content_ref_id AS c FROM ticket WHERE ticket_code = 'U01-02'`)!.c).not.toBeNull();
    // the check is pinned by repo + sha + sha256 + blob sha + expected tests
    const spec = CheckSpec.parse(JSON.parse(db().get<{ spec: string }>(`SELECT spec FROM "check" c JOIN unit u ON u.id = c.unit_id WHERE u.code = 'U01'`)!.spec));
    expect(spec).toMatchObject({
      type: 'node-test-file',
      repo: SIGNALPOST,
      sha: PINNED_SHA,
      checkPath: 'practice/checks/u01.test.mjs',
      learnerPath: 'practice/learner/u01.mjs',
      checkSha256: 'b6d8a906d589644e3804e4f2c27dd2c33f5ac4a6ac2568689c83e93caf539d00',
      blobSha: 'abaa808d2ab4ee5da6ab7191fd5f03c31b691718',
      expectedTests: ['remainingTitles preserves order and input', 'totalMinutes combines every value including zero'],
    });
    expect(count(`SELECT COUNT(*) AS n FROM "check" c JOIN unit u ON u.id = c.unit_id WHERE u.kind = 'study'`)).toBe(0);
    // unit -> refs: every unit has its program ref; only U01 has a guide in this fixture
    expect(count(`SELECT COUNT(*) AS n FROM unit_ref WHERE role = 'program'`)).toBe(12);
    expect(db().all<{ path: string; title: string }>(`SELECT r.path, r.title FROM unit_ref ur JOIN content_ref r ON r.id = ur.content_ref_id WHERE ur.role = 'guide'`)).toEqual([
      { path: 'docs/curriculum/U01.md', title: 'U01 — Programming you can explain' },
    ]);
    expect(db().get<{ last_synced_sha: string }>(`SELECT last_synced_sha FROM source WHERE key = ?`, `github:${SIGNALPOST}`)!.last_synced_sha).toBe(PINNED_SHA);
  });

  it('is IDEMPOTENT: a second sync at the same sha changes nothing and downloads nothing', async () => {
    await fx.svc.run(db(), clock);
    const snapshot = () => ({
      refs: db().all('SELECT * FROM content_ref ORDER BY id'),
      units: db().all('SELECT * FROM unit ORDER BY id'),
      checks: db().all('SELECT * FROM "check" ORDER BY id'),
      tickets: db().all('SELECT * FROM ticket ORDER BY id'),
      unitRefs: db().all('SELECT * FROM unit_ref ORDER BY unit_id, role'),
      comps: db().all('SELECT * FROM unit_competency ORDER BY unit_id, competency_id'),
      queue: db().all('SELECT * FROM seed_queue ORDER BY id'),
    });
    const before = snapshot();
    const r2 = await fx.svc.run(db(), clock);
    expect(r2.repos[0]).toMatchObject({ tarball: 'hit', newKeys: 0, queued: 0, refs: { inserted: 0, updated: 0, unchanged: 27, missing: 0 } });
    expect(snapshot()).toEqual(before);
    expect(fx.gh.calls.downloadTarball).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM sync_run WHERE ok = 1')).toBe(2);
  });

  it('a new sha: NEW headings are queued as "new"; a MOVED file re-matches its keys; a removed heading goes missing-at-sha', async () => {
    await fx.svc.run(db(), clock);
    const idsBefore = new Map(db().all<{ stable_key: string; id: number }>('SELECT stable_key, id FROM content_ref').map((r) => [r.stable_key, r.id]));
    const readmeKeys = db().all<{ stable_key: string; id: number }>(`SELECT stable_key, id FROM content_ref WHERE path = 'README.md'`);
    const stuck = db().get<{ id: number }>(`SELECT id FROM content_ref WHERE path = 'docs/curriculum/U01.md' AND title = 'If stuck'`)!;
    forkTree(fx.base, join(fx.root, 'snap-2'), (d) => {
      appendFileSync(join(d, 'docs', 'curriculum', 'U01.md'), '\n## Brand new follow-up\n\nAdded later.\n');
      writeFileSync(join(d, 'docs', 'curriculum', 'NEW.md'), '# New guide\n\n## Part A\n');
      renameSync(join(d, 'README.md'), join(d, 'docs', 'readme-moved.md'));
      const u01 = join(d, 'docs', 'curriculum', 'U01.md');
      writeFileSync(u01, readFileSync(u01, 'utf8').replace('## If stuck', 'If stuck (no longer a heading)'));
    });
    fx.gh.trees.set(SHA2, join(fx.root, 'snap-2'));
    fx.gh.head.sha = SHA2;
    const r = (await fx.svc.run(db(), clock)).repos[0]!;
    expect(r.sha).toBe(SHA2);
    expect(r.newKeys).toBe(3);
    expect(r.refs.missing).toBe(1);
    const fresh = seedQueue(db()).items.filter((i) => i.reason === 'new');
    expect(fresh.map((i) => i.title).sort()).toEqual(['Brand new follow-up', 'New guide', 'Part A']);
    expect(fresh.every((i) => i.sha === SHA2)).toBe(true);
    // moved: same keys, same ids, new path, not queued again
    for (const k of readmeKeys) {
      const row = db().get<{ id: number; path: string }>('SELECT id, path FROM content_ref WHERE stable_key = ?', k.stable_key)!;
      expect(row).toEqual({ id: k.id, path: 'docs/readme-moved.md' });
    }
    expect(db().get<{ status: string }>('SELECT status FROM content_ref WHERE id = ?', stuck.id)!.status).toBe('missing-at-sha');
    // every pre-existing key kept its row id (units / tickets / queue keep pointing at the same refs)
    for (const [k, id] of idsBefore) expect(db().get<{ id: number }>('SELECT id FROM content_ref WHERE stable_key = ?', k)!.id).toBe(id);
    // a ref that comes back is revived, not re-queued
    fx.gh.head.sha = PINNED_SHA;
    const back = (await fx.svc.run(db(), clock)).repos[0]!;
    expect(back.newKeys).toBe(0);
    expect(db().get<{ status: string }>('SELECT status FROM content_ref WHERE id = ?', stuck.id)!.status).toBe('ok');
  });

  it('check drift at a newer sha is REPORTED; the check stays pinned to the recorded sha', async () => {
    forkTree(fx.base, join(fx.root, 'snap-3'), (d) => appendFileSync(join(d, 'practice', 'checks', 'u01.test.mjs'), '\n// upstream edit\n'));
    fx.gh.trees.set(SHA3, join(fx.root, 'snap-3'));
    fx.gh.head.sha = SHA3;
    const r = (await fx.svc.run(db(), clock)).repos[0]!;
    expect(r.error).toBeNull();
    expect(r.program!.checkDrift).toEqual([expect.stringMatching(/^U01: practice\/checks\/u01\.test\.mjs changed at 3333333 \(check stays pinned at ff84460/)]);
    const spec = JSON.parse(db().get<{ spec: string }>(`SELECT spec FROM "check" c JOIN unit u ON u.id = c.unit_id WHERE u.code = 'U01'`)!.spec) as { sha: string };
    expect(spec.sha).toBe(PINNED_SHA);
    // both trees were needed: the synced sha and the pinned one
    expect(fx.gh.calls.downloadTarball).toBe(2);
  });

  it('offline: falls back to the last synced sha from the cache; with nothing cached the repo FAILS in the report', async () => {
    await fx.svc.run(db(), clock);
    fx.gh.online = false;
    const r = await fx.svc.run(db(), clock);
    expect(r.ok).toBe(true);
    expect(r.repos[0]).toMatchObject({ sha: PINNED_SHA, shaFrom: 'cache', tarball: 'hit', newKeys: 0 });
    // a fresh DB + empty cache cannot sync offline
    const other = makeSyncFixture();
    const t2 = makeTempDb();
    try {
      other.gh.online = false;
      const bad = await other.svc.run(t2.db, clock);
      expect(bad.ok).toBe(false);
      expect(bad.repos[0]!.error).toMatch(/^NetworkUnavailableError: fake: offline/);
      expect(t2.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM content_ref')!.n).toBe(0);
      expect(t2.db.get<{ ok: number }>('SELECT ok FROM sync_run')!.ok).toBe(0);
    } finally {
      t2.cleanup();
      other.cleanup();
    }
  });

  it('a pinned_sha in curriculum.yaml wins over HEAD (no resolveHead call)', async () => {
    const pinned = makeSyncFixture(`version: 1\nsources:\n  - repo: ${SIGNALPOST}\n    role: curriculum\n    pinned_sha: ${PINNED_SHA}\n`);
    try {
      pinned.gh.head.sha = SHA2; // HEAD moved; the pin must win
      const r = await pinned.svc.run(db(), clock);
      expect(r.repos[0]).toMatchObject({ sha: PINNED_SHA, shaFrom: 'pinned' });
      expect(pinned.gh.calls.resolveHead).toBe(0);
    } finally {
      pinned.cleanup();
    }
  });

  it('rejects unregistered repos; a reference-role repo never registers program units', async () => {
    await expect(fx.svc.run(db(), clock, { repos: ['elirc/not-registered'] })).rejects.toBeInstanceOf(SyncConfigError);
    const ref = makeSyncFixture(`version: 1\nsources:\n  - repo: ${SIGNALPOST}\n    role: reference\n`);
    try {
      const r = await ref.svc.run(db(), clock);
      expect(r.repos[0]!.program).toBeNull();
      expect(count('SELECT COUNT(*) AS n FROM unit')).toBe(0);
      // no exclude list here: the generated apps/ copy registers too, deduped with "~2" keys
      expect(count(`SELECT COUNT(*) AS n FROM content_ref WHERE stable_key LIKE '%~2'`)).toBe(13);
    } finally {
      ref.cleanup();
    }
  });

  it('an unmapped free-text competency fails the repo ATOMICALLY (nothing half-written)', async () => {
    const t = makeSyncFixture();
    try {
      forkTree(t.base, join(t.root, 'snap-bad'), (d) => {
        const p = join(d, 'docs', 'curriculum', 'program.json');
        writeFileSync(p, readFileSync(p, 'utf8').replace('"systematic debugging"', '"competitive juggling"'));
      });
      t.gh.trees.set(SHA2, join(t.root, 'snap-bad'));
      t.gh.head.sha = SHA2;
      const r = await t.svc.run(db(), clock);
      expect(r.ok).toBe(false);
      expect(r.repos[0]!.error).toMatch(/competitive juggling" has no competency_alias mapping/);
      expect(count('SELECT COUNT(*) AS n FROM content_ref')).toBe(0);
      expect(count('SELECT COUNT(*) AS n FROM unit')).toBe(0);
      expect(count('SELECT COUNT(*) AS n FROM seed_queue')).toBe(0);
    } finally {
      t.cleanup();
    }
  });

  it('a recorded check whose bytes do not match its pin is a sync ERROR (the table is wrong), never re-pinned', async () => {
    const t = makeSyncFixture();
    try {
      appendFileSync(join(t.base, 'practice', 'checks', 'u02.test.mjs'), '\n// tampered\n');
      const r = await t.svc.run(db(), clock);
      expect(r.repos[0]!.error).toMatch(/U02: recorded check practice\/checks\/u02\.test\.mjs does not hash to its pin/);
      expect(count('SELECT COUNT(*) AS n FROM unit')).toBe(0);
    } finally {
      t.cleanup();
    }
  });

  it('F15: a recorded tsconfig pin that does not hold at the recorded sha is a sync ERROR, judged by the shared chain verifier', async () => {
    const t = makeSyncFixture();
    try {
      // practice/tsconfig.json extends ../tsconfig.json: tamper the parent (still valid JSON)
      appendFileSync(join(t.base, 'tsconfig.json'), '\n');
      const r = await t.svc.run(db(), clock);
      expect(r.repos[0]!.error).toMatch(
        /U03: recorded tsconfig chain does not hold at [0-9a-f]{40} — the table is wrong \(tsconfig tsconfig\.json at [0-9a-f]{7} does not hash to its recorded pin/,
      );
      expect(count('SELECT COUNT(*) AS n FROM unit')).toBe(0);
    } finally {
      t.cleanup();
    }
  });

  it('the DB NEVER stores curriculum text: no markdown body line or program prose lands in any column', async () => {
    await fx.svc.run(db(), clock);
    const u01 = readFileSync(join(fx.base, 'docs', 'curriculum', 'U01.md'), 'utf8');
    const program = JSON.parse(readFileSync(join(fx.base, 'docs', 'curriculum', 'program.json'), 'utf8')) as {
      milestones: { lesson: string; objective: string; transfer: string; example: string; tickets: { context: string; acceptance: string[] }[] }[];
    };
    const needles = [
      ...u01.split('\n').map((l) => l.trim()).filter((l) => l.length >= 25 && !l.startsWith('#')),
      ...program.milestones.flatMap((m) => [m.lesson.slice(0, 60), m.objective, m.transfer, m.example.slice(0, 40), ...m.tickets.flatMap((t) => [t.context, ...t.acceptance])]),
    ];
    expect(needles.length).toBeGreaterThan(200);
    const tables = db().all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((t) => t.name);
    const hits: string[] = [];
    for (const t of tables) {
      for (const row of db().all<Record<string, unknown>>(`SELECT * FROM "${t}"`)) {
        for (const [col, v] of Object.entries(row)) {
          if (typeof v === 'string' && needles.some((n) => v.includes(n))) hits.push(`${t}.${col}`);
        }
      }
    }
    expect(hits).toEqual([]);
    // summaries stay null until a seed session authors one
    expect(count('SELECT COUNT(*) AS n FROM content_ref WHERE summary IS NOT NULL')).toBe(0);
  });

  it('fakeGithub sanity: unknown sha is a network error, not a crash', async () => {
    const gh = fakeGithub(new Map(), PINNED_SHA);
    await expect(gh.downloadTarball(SIGNALPOST, SHA2, join(fx.root, 'x.tgz'))).rejects.toBeInstanceOf(NetworkUnavailableError);
  });
});
