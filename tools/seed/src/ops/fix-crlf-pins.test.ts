/**
 * fix-crlf-pins on a throwaway app root: a pack pinned from an autocrlf-converted
 * checkout (CRLF-derived blob ids, a CR-contaminated verbatim kata file + diff +
 * adapted file + draft + spec) is re-pinned to git's ids, the kata text becomes the
 * repo's bytes (a file git itself has as CRLF keeps its CRs), the stamp is rebound
 * with a zeroed fingerprint, seed:pins then says OK, and a second run does nothing.
 * Missing mirror: refused, nothing written.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitTree, mirrorRoots } from '../factory/pins.ts';
import { gitBlobSha1, sha256, stableJson, stableKey } from '../factory/util.ts';
import { runFixCrlfPins } from './fix-crlf-pins.ts';
import { runPins } from './pins.ts';

const tmp = mkdtempSync(join(tmpdir(), 'bq-fixcrlf-'));
const root = join(tmp, 'app');
const cache = join(root, '.cache');
const mirror = join(cache, 'repos', 'demo');
let SHA = '';

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
const put = (rel: string, text: string, base = root) => {
  mkdirSync(join(base, rel, '..'), { recursive: true });
  writeFileSync(join(base, rel), text);
};
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');
const id = (s: string) => gitBlobSha1(Buffer.from(s));

const GUIDE = '# Guide\n\nThe service keeps a counter.\n';
const SVC = 'class Svc {\n  int a;\n  int b;\n}\n';
const LEGACY = 'legacy\r\nfile\r\n';
const DIFF = (eol: string) => `diff --git a/src/Svc.java b/src/Svc.java\n--- a/src/Svc.java\n+++ b/src/Svc.java\n@@ -1,4 +1,4 @@\n class Svc {${eol}\n-  int a;${eol}\n+  long a;${eol}\n   int b;${eol}\n }${eol}\n`;
const LEGACY_DIFF = 'diff --git a/legacy.txt b/legacy.txt\n--- a/legacy.txt\n+++ b/legacy.txt\n@@ -1,2 +1,2 @@\n-legacy\r\n+LEGACY\r\n file\r\n';
const KEY = stableKey('patches', 'demo', 'patch-kata', ['demo-katas', 'k1']);

function seedPack(dir: string, generator: string, blobs: Record<string, string>, items: unknown): void {
  const itemsBytes = stableJson({ format: 'bootquest-seed-pack@1', generator, name: dir.split('/')[1], items });
  const manifest = stableJson({
    format: 'bootquest-seed-pack@1',
    generator,
    name: dir.split('/')[1],
    source: { repo: 'demo', sha: SHA, pin: 'caller-asserted', inputs: ['guide.md'], excludeDirs: ['.git', 'node_modules'] },
    blobs,
    items: { file: 'items.json', sha256: sha256(itemsBytes) },
    counts: { total: 0, byKind: {} },
    candidates: 0,
    quarantined: 0,
    review: 0,
    skipped: [],
    dropped: 0,
  });
  put(`content/seed/${dir}/items.json`, itemsBytes);
  put(`content/seed/${dir}/manifest.json`, manifest);
  put(
    `content/seed/${dir}/validation.json`,
    stableJson({ format: 'bootquest-seed-pack@1', source: dir, fingerprintKind: `seed:${generator}`, fingerprint: 'f'.repeat(64), toolchain: { node: 'v22' }, manifestSha256: sha256(manifest), itemsSha256: sha256(itemsBytes), counts: { total: 0, byKind: {} }, quarantinedKeys: [], reviewKeys: [], executions: 0 }),
  );
}

beforeAll(() => {
  mkdirSync(mirror, { recursive: true });
  git(mirror, 'init', '-q');
  put('guide.md', GUIDE, mirror);
  put('src/Svc.java', SVC, mirror);
  put('legacy.txt', LEGACY, mirror);
  git(mirror, 'add', '-A');
  git(mirror, 'commit', '-q', '-m', 'init');
  SHA = git(mirror, 'rev-parse', 'HEAD');
  // the old recipe's output: LF files came out CRLF (legacy.txt was already CRLF in git, untouched)
  const old = join(cache, 'checkouts', `demo@${SHA}`);
  put('guide.md', crlf(GUIDE), old);
  put('src/Svc.java', crlf(SVC), old);
  put('legacy.txt', LEGACY, old);
  put('stale-from-older-sha.md', 'x\n', old);

  seedPack('quests/demo', 'quests', { 'guide.md': id(crlf(GUIDE)), 'legacy.txt': id(LEGACY) }, []);
  const kata = {
    kind: 'patch-kata',
    key: KEY,
    provenance: { repo: 'demo', sha: SHA, path: 'guide.md', lines: { start: 3, end: 3 } },
    citations: [],
    title: 'k1',
    diff: DIFF('\r') + LEGACY_DIFF,
    contextFiles: [
      { path: 'src/Svc.java', content: crlf(SVC), origin: { kind: 'verbatim', repoPath: 'src/Svc.java' } },
      { path: 'legacy.txt', content: LEGACY, origin: { kind: 'verbatim', repoPath: 'legacy.txt' } },
      { path: 'bootquest-kata/Svc.Testable.java', content: crlf('// adapted\nclass T {}\n'), origin: { kind: 'adapted', repoPath: 'src/Svc.java' } },
    ],
    seededDefectKey: [],
  };
  seedPack('patches/demo-katas', 'patches', { 'guide.md': id(crlf(GUIDE)), 'src/Svc.java': id(crlf(SVC)), 'legacy.txt': id(LEGACY) }, [kata]);
  put(
    'tools/seed/authoring/katas/demo.draft.json',
    stableJson({ name: 'demo-katas', katas: [{ id: 'k1', title: 'k1', provenance: { path: 'guide.md', lines: { start: 3, end: 3 } }, diff: DIFF('\r') + LEGACY_DIFF, contextFiles: [{ path: 'src/Svc.java', origin: { kind: 'verbatim', repoPath: 'src/Svc.java' } }, { path: 'legacy.txt', origin: { kind: 'verbatim', repoPath: 'legacy.txt' } }, { path: 'bootquest-kata/Svc.Testable.java', content: crlf('// adapted\nclass T {}\n'), origin: { kind: 'adapted', repoPath: 'src/Svc.java' } }], seededDefectKey: [] }] }),
  );
  put(
    'tools/seed/authoring/katas/demo.spec.json',
    stableJson({
      name: 'demo-katas',
      checkout: `.cache/checkouts/demo@${SHA}`,
      katas: [
        {
          id: 'k1',
          provenance: { path: 'guide.md', find: 'The service keeps a counter.\r\n' },
          contextFiles: [{ path: 'src/Svc.java', repoPath: 'src/Svc.java', kind: 'verbatim' }, { path: 'legacy.txt', repoPath: 'legacy.txt', kind: 'verbatim' }],
          edits: [{ path: 'src/Svc.java', find: '  int a;\r\n', replace: '  long a;\r\n' }, { path: 'legacy.txt', find: 'legacy\r\n', replace: 'LEGACY\r\n' }],
          defects: [{ in: 'repo', path: 'src/Svc.java', find: '  int b;\r\n' }],
        },
      ],
    }),
  );
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('fix-crlf-pins', () => {
  it('refuses (writes nothing) while a pinned repo has no mirror, printing the fetch command', () => {
    const before = read('content/seed/quests/demo/manifest.json');
    const log: string[] = [];
    const r = runFixCrlfPins({ root, cacheDir: join(tmp, 'empty-cache'), log: (l) => log.push(l) });
    expect(r.refused).toEqual([expect.stringMatching(new RegExp(`^demo@${SHA}: no mirror\\n.*gh repo clone elirc/demo .*git -C .* fetch --depth 1 origin ${SHA}`, 's'))]);
    expect(r.ok).toBe(false);
    expect(read('content/seed/quests/demo/manifest.json')).toBe(before);
  });

  it('seed:pins sees the CRLF-derived ids as MISMATCH before the fix', () => {
    const r = runPins({ seedDir: join(root, 'content', 'seed'), roots: mirrorRoots(cache) });
    expect([r.ok, r.mismatch]).toEqual([0, 2]);
    expect(r.packs.find((p) => p.pack === 'quests/demo')!.problems).toEqual([`guide.md: manifest ${id(crlf(GUIDE)).slice(0, 12)} != git ${id(GUIDE).slice(0, 12)}`]);
  });

  it('dry run: reports the work, writes nothing', () => {
    const before = read('content/seed/patches/demo-katas/items.json');
    const r = runFixCrlfPins({ root, dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.checkouts).toEqual([{ pin: `demo@${SHA}`, action: 'would re-extract', problems: 3 }]);
    expect(read('content/seed/patches/demo-katas/items.json')).toBe(before);
    expect(existsSync(join(cache, 'checkouts', `demo@${SHA}`, 'stale-from-older-sha.md'))).toBe(true);
  });

  it('re-extracts, re-pins to git ids, fixes kata text to the repo bytes (CRLF files keep CRs), rebinds stamps', () => {
    const r = runFixCrlfPins({ root });
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.checkouts).toEqual([{ pin: `demo@${SHA}`, action: 're-extracted', problems: 3 }]);
    const co = join(cache, 'checkouts', `demo@${SHA}`);
    expect(existsSync(join(co, 'stale-from-older-sha.md'))).toBe(false);
    expect(readFileSync(join(co, 'guide.md'), 'utf8')).toBe(GUIDE);

    const tree = gitTree(mirror, SHA);
    for (const p of ['quests/demo', 'patches/demo-katas']) {
      const mBytes = read(`content/seed/${p}/manifest.json`);
      const m = JSON.parse(mBytes);
      expect(m.source.pin).toBe('git-tree');
      for (const [rel, b] of Object.entries(m.blobs)) expect(b).toBe(tree.get(rel)!.id);
      const st = JSON.parse(read(`content/seed/${p}/validation.json`));
      expect(st.fingerprint).toBe('0'.repeat(64));
      expect(st.manifestSha256).toBe(sha256(mBytes));
      expect(st.itemsSha256).toBe(sha256(read(`content/seed/${p}/items.json`)));
      expect(m.items.sha256).toBe(st.itemsSha256);
    }
    expect(r.stampsRebound.sort()).toEqual(['patches/demo-katas', 'quests/demo']);

    const kata = JSON.parse(read('content/seed/patches/demo-katas/items.json')).items[0];
    expect(kata.contextFiles[0].content).toBe(SVC); // the exact repo bytes
    expect(kata.contextFiles[1].content).toBe(LEGACY); // CRLF in git: kept
    expect(kata.contextFiles[2].content).toBe('// adapted\nclass T {}\n'); // adapted from an LF file
    expect(kata.diff).toBe(DIFF('') + LEGACY_DIFF);
    expect(r.kataFiles.map((k) => [k.file, k.kind, k.crs])).toEqual([
      ['src/Svc.java', 'verbatim', 4],
      ['bootquest-kata/Svc.Testable.java', 'adapted', 2],
    ]);

    const draft = JSON.parse(read('tools/seed/authoring/katas/demo.draft.json')).katas[0];
    expect(draft.diff).toBe(kata.diff);
    expect(draft.contextFiles[2].content).toBe('// adapted\nclass T {}\n');
    const spec = JSON.parse(read('tools/seed/authoring/katas/demo.spec.json')).katas[0];
    expect(spec.provenance.find).toBe('The service keeps a counter.\n');
    expect(spec.edits).toEqual([
      { path: 'src/Svc.java', find: '  int a;\n', replace: '  long a;\n' },
      { path: 'legacy.txt', find: 'legacy\r\n', replace: 'LEGACY\r\n' },
    ]);
    expect(spec.defects[0].find).toBe('  int b;\n');

    const pins = runPins({ seedDir: join(root, 'content', 'seed'), roots: mirrorRoots(cache) });
    expect([pins.ok, pins.mismatch, pins.uncheckable]).toEqual([2, 0, 0]);
  });

  it('is idempotent: a second run changes nothing', () => {
    const snap = ['content/seed/quests/demo/manifest.json', 'content/seed/patches/demo-katas/items.json', 'content/seed/patches/demo-katas/validation.json', 'tools/seed/authoring/katas/demo.spec.json'].map(read);
    const r = runFixCrlfPins({ root });
    expect(r.ok).toBe(true);
    expect(r.checkouts).toEqual([{ pin: `demo@${SHA}`, action: 'clean', problems: 0 }]);
    expect([r.manifests, r.kataFiles, r.authoring, r.stampsRebound]).toEqual([[], [], [], []]);
    expect(['content/seed/quests/demo/manifest.json', 'content/seed/patches/demo-katas/items.json', 'content/seed/patches/demo-katas/validation.json', 'tools/seed/authoring/katas/demo.spec.json'].map(read)).toEqual(snap);
  });

  it('a verbatim file that differs from the repo beyond line endings is reported, and its pack left untouched', () => {
    const p = 'content/seed/patches/demo-katas/items.json';
    const f = JSON.parse(read(p));
    f.items[0].contextFiles[0].content = crlf('class Svc {\n  int CHANGED;\n  int b;\n}\n');
    put(p, stableJson(f));
    const r = runFixCrlfPins({ root });
    expect(r.ok).toBe(false);
    expect(r.failures).toContain(`patches/demo-katas ${KEY} src/Svc.java: verbatim content differs from src/Svc.java at the pin beyond line endings`);
    expect(JSON.parse(read(p)).items[0].contextFiles[0].content).toContain('\r\n');
  });
});
