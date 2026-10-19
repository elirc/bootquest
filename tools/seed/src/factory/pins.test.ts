/**
 * Pins against git itself: the extraction recipe (byte identity, fresh dir), the
 * open-time refusals (CRLF-converted bytes, stale overlay, wrong sha, mirror
 * without the sha), the lazy per-file check, and seed:pins (OK / MISMATCH /
 * UNCHECKABLE). Every repo here is a throwaway `git init` in a temp dir.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPins } from '../ops/pins.ts';
import { CheckoutError, openCheckout, readTracked, verifyBlobs } from './checkout.ts';
import { checkTreeShape, extractTree, gitTree, verifyManifestBlobs } from './pins.ts';
import { gitBlobSha1, stableJson } from './util.ts';

const tmp = mkdtempSync(join(tmpdir(), 'bq-pins-'));
const cache = join(tmp, 'cache');
const mirror = join(cache, 'repos', 'demo');
const roots = [join(cache, 'repos'), join(cache, 'sources')];
let A = '';
let B = '';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}
const put = (root: string, rel: string, text: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};
/** what `git archive` produced under the SYSTEM core.autocrlf=true: every LF-only text file as CRLF */
const crlfify = (s: string) => s.replace(/\r?\n/g, '\r\n');
const co = (sha: string) => join(cache, 'checkouts', `demo@${sha}`);

beforeAll(() => {
  mkdirSync(mirror, { recursive: true });
  git(mirror, 'init', '-q');
  put(mirror, 'README.md', '# Demo\n\nLF in git.\n');
  put(mirror, 'src/Svc.java', 'class Svc {\n  int a;\n}\n');
  put(mirror, 'legacy.txt', 'committed\r\nwith CRLF\r\n');
  put(mirror, 'old.txt', 'removed in B\n');
  git(mirror, 'add', '-A');
  git(mirror, 'commit', '-q', '-m', 'A');
  A = git(mirror, 'rev-parse', 'HEAD');
  git(mirror, 'rm', '-q', 'old.txt');
  put(mirror, 'src/Svc.java', 'class Svc {\n  int b;\n}\n');
  git(mirror, 'add', '-A');
  git(mirror, 'commit', '-q', '-m', 'B');
  B = git(mirror, 'rev-parse', 'HEAD');
  // the mirror itself says autocrlf=true (as this machine's system config does): extraction must not care
  git(mirror, 'config', 'core.autocrlf', 'true');
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('extractTree: the checkout recipe', () => {
  it('writes every blob byte-for-byte (LF stays LF, a committed CRLF file keeps its CRs), whatever autocrlf says', () => {
    extractTree(mirror, B, co(B));
    expect(readFileSync(join(co(B), 'README.md'), 'utf8')).toBe('# Demo\n\nLF in git.\n');
    expect(readFileSync(join(co(B), 'legacy.txt'), 'utf8')).toBe('committed\r\nwith CRLF\r\n');
    expect(checkTreeShape(co(B), gitTree(mirror, B), { deep: true })).toEqual([]);
  });

  it('lands in a fresh dir: a file the commit does not have never survives an older extraction', () => {
    const d = join(tmp, 'overlay', `demo@${B}`);
    extractTree(mirror, A, d);
    expect(readFileSync(join(d, 'old.txt'), 'utf8')).toBe('removed in B\n');
    extractTree(mirror, B, d);
    expect(() => readFileSync(join(d, 'old.txt'))).toThrow();
    expect(checkTreeShape(d, gitTree(mirror, B), { deep: true })).toEqual([]);
  });
});

describe('openCheckout verifies a <cache>/checkouts/<repo>@<sha> dir against <cache>/repos/<repo>', () => {
  it('a byte-identical extraction opens as pin git-tree, and every recorded blob is git\'s', () => {
    const c = openCheckout({ root: co(B), sha: B });
    expect(c.pin).toBe('git-tree');
    expect(c.repo).toBe('demo');
    readTracked(c, 'README.md');
    readTracked(c, 'legacy.txt');
    const tree = gitTree(mirror, B);
    expect(Object.fromEntries(c.blobs)).toEqual({ 'README.md': tree.get('README.md')!.id, 'legacy.txt': tree.get('legacy.txt')!.id });
  });

  it('REFUSES autocrlf-converted bytes (sizes differ from the blobs)', () => {
    const d = join(tmp, 'crlf', 'checkouts', `demo@${B}`);
    extractTree(mirror, B, d);
    put(d, 'README.md', crlfify('# Demo\n\nLF in git.\n'));
    expect(() => openCheckout({ root: d, sha: B, mirrors: roots })).toThrow(/README\.md: 22 bytes, git blob has 19 \(CRLF-converted\?\)\): re-extract it with npm run seed:checkout/);
  });

  it('REFUSES a stale overlay (a file not in git at the sha) and a wrong-sha extraction', () => {
    const d = join(tmp, 'stale', 'checkouts', `demo@${B}`);
    extractTree(mirror, B, d);
    put(d, 'old.txt', 'removed in B\n');
    expect(() => openCheckout({ root: d, sha: B, mirrors: roots })).toThrow(/old\.txt: not in git at this sha/);
    const w = join(tmp, 'wrong', 'checkouts', `demo@${B}`);
    extractTree(mirror, A, w);
    expect(() => openCheckout({ root: w, sha: B, mirrors: roots })).toThrow(CheckoutError);
  });

  it('REFUSES when the mirror exists but lacks the sha (fetch it), never silently caller-asserted', () => {
    expect(() => openCheckout({ root: co(B), sha: 'abcdef1234567', repo: 'demo' })).toThrow(/does not have abcdef1234567: fetch it/);
  });

  it('a same-size edit passes the cheap open check but is refused the moment the file is read or cited', () => {
    const d = join(tmp, 'tamper', 'checkouts', `demo@${B}`);
    extractTree(mirror, B, d);
    put(d, 'README.md', '# Demo\n\nLF in GIT.\n');
    const c = openCheckout({ root: d, sha: B, mirrors: roots });
    expect(() => readTracked(c, 'README.md')).toThrow(/README\.md: checkout bytes hash to [0-9a-f]{12} but git has/);
  });

  it('seed:check pin: a recorded id git never had is flagged even when the checkout bytes are fine', () => {
    const c = openCheckout({ root: co(B), sha: B });
    const crlfId = gitBlobSha1(Buffer.from(crlfify('# Demo\n\nLF in git.\n')));
    expect(verifyBlobs(c, { 'README.md': crlfId })).toEqual([expect.stringMatching(/README\.md: pinned [0-9a-f]{12} != git [0-9a-f]{12} .*a blob id git never had/)]);
    expect(verifyBlobs(c, { 'README.md': gitTree(mirror, B).get('README.md')!.id })).toEqual([]);
  });

  it('no mirror: a fixture-style dir stays caller-asserted (seed:pins reports it UNCHECKABLE)', () => {
    const d = join(tmp, 'fixture', 'ww6');
    put(d, 'a.md', 'x\r\n');
    expect(openCheckout({ root: d, sha: B }).pin).toBe('caller-asserted');
    expect(openCheckout({ root: co(B), sha: B, mirrors: false }).pin).toBe('caller-asserted');
  });
});

describe('seed:pins', () => {
  it('verifyManifestBlobs: ok / mismatch with file detail / uncheckable', () => {
    const t = gitTree(mirror, B);
    expect(verifyManifestBlobs('demo', B, { 'README.md': t.get('README.md')!.id }, roots).status).toBe('ok');
    const bad = verifyManifestBlobs('demo', B, { 'README.md': '0'.repeat(40), 'old.txt': '1'.repeat(40) }, roots);
    expect(bad.status).toBe('mismatch');
    expect(bad.problems).toEqual([`README.md: manifest 000000000000 != git ${t.get('README.md')!.id.slice(0, 12)}`, `old.txt: not in git at ${B.slice(0, 12)} (manifest 111111111111)`]);
    expect(verifyManifestBlobs('nope', B, {}, roots)).toMatchObject({ status: 'uncheckable', problems: [expect.stringMatching(/^no mirror for nope/)] });
    expect(verifyManifestBlobs('demo', 'abcdef1234567', {}, roots)).toMatchObject({ status: 'uncheckable', problems: [expect.stringMatching(/lacks abcdef123456/)] });
  });

  it('runPins walks content/seed/<generator>/<name>/manifest.json and counts each status', () => {
    const seed = join(tmp, 'seed');
    const t = gitTree(mirror, B);
    const manifest = (repo: string, blobs: Record<string, string>) =>
      stableJson({
        format: 'bootquest-seed-pack@1',
        generator: 'quests',
        name: repo,
        source: { repo, sha: B, pin: 'caller-asserted', inputs: ['README.md'], excludeDirs: ['.git', 'node_modules'] },
        blobs,
        items: { file: 'items.json', sha256: 'a'.repeat(64) },
        counts: { total: 0, byKind: {} },
        candidates: 0,
        quarantined: 0,
        review: 0,
        skipped: [],
        dropped: 0,
      });
    put(seed, 'quests/demo/manifest.json', manifest('demo', { 'README.md': t.get('README.md')!.id }));
    put(seed, 'notes/demo/manifest.json', manifest('demo', { 'README.md': gitBlobSha1(Buffer.from(crlfify('# Demo\n\nLF in git.\n'))) }));
    put(seed, 'quests/other/manifest.json', manifest('other', { 'README.md': t.get('README.md')!.id }));
    put(seed, 'variants/nothing-pinned/manifest.json', manifest('selfboot', {}));
    const log: string[] = [];
    const r = runPins({ seedDir: seed, roots, log: (l) => log.push(l) });
    // ok: quests/demo + the 0-blob variants pack (nothing pinned needs no mirror)
    expect([r.ok, r.mismatch, r.uncheckable]).toEqual([2, 1, 1]);
    expect(log.join('\n')).toMatch(/^MISMATCH {4}notes\/demo .*\n {14}README\.md: manifest [0-9a-f]{12} != git [0-9a-f]{12}$/m);
    expect(runPins({ seedDir: seed, roots, repos: ['other'] }).packs.map((p) => p.status)).toEqual(['uncheckable']);
  });
});
