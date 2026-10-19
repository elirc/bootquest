import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CACHE_MARKER, cacheDisposition, ensureCheckout, isOwnedCache, SourceError } from './source.ts';

// ensureCheckout's --cache is user-supplied: it may only ever delete a directory it
// created itself (CACHE_MARKER). Fixture upstream = a local repo fetched over file://.

const gitIn = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', '-C', dir, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

let root: string;
let upstreamUrl: string;
let sha1: string;
let sha2: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bq-ensure-checkout-'));
  const up = join(root, 'upstream');
  mkdirSync(join(up, 'bootcamp'), { recursive: true });
  gitIn(up, 'init', '--quiet');
  writeFileSync(join(up, 'bootcamp', 'a.txt'), 'one\ntwo\n');
  gitIn(up, 'add', '.');
  gitIn(up, 'commit', '--quiet', '-m', 'first');
  sha1 = gitIn(up, 'rev-parse', 'HEAD');
  writeFileSync(join(up, 'bootcamp', 'a.txt'), 'one\ntwo\nthree\n');
  gitIn(up, 'commit', '--quiet', '-am', 'second');
  sha2 = gitIn(up, 'rev-parse', 'HEAD');
  upstreamUrl = pathToFileURL(up).href;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('cacheDisposition (pure delete guard)', () => {
  it('absent or empty -> create; marker -> replace; anything else -> refuse', () => {
    const base = mkdtempSync(join(root, 'disp-'));
    expect(cacheDisposition(join(base, 'nope'))).toBe('create');
    mkdirSync(join(base, 'empty'));
    expect(cacheDisposition(join(base, 'empty'))).toBe('create');
    mkdirSync(join(base, 'foreign'));
    writeFileSync(join(base, 'foreign', 'work.txt'), 'uncommitted');
    expect(cacheDisposition(join(base, 'foreign'))).toBe('refuse');
    expect(isOwnedCache(join(base, 'foreign'))).toBe(false);
    mkdirSync(join(base, 'ours'));
    writeFileSync(join(base, 'ours', CACHE_MARKER), 'x');
    writeFileSync(join(base, 'ours', 'junk.txt'), 'x');
    expect(cacheDisposition(join(base, 'ours'))).toBe('replace');
    // a marker that is a directory is not ours
    mkdirSync(join(base, 'fake', CACHE_MARKER), { recursive: true });
    expect(cacheDisposition(join(base, 'fake'))).toBe('refuse');
    // a plain file named as the cache is never deleted
    writeFileSync(join(base, 'file'), 'x');
    expect(cacheDisposition(join(base, 'file'))).toBe('refuse');
  });
});

describe('ensureCheckout', () => {
  it('fetches into a new dir, marks it, and reuses it clean on a re-run (LF bytes)', () => {
    const dir = join(root, 'fresh');
    const a = ensureCheckout(dir, sha1, upstreamUrl);
    expect(a).toEqual({ dir, sha: sha1, fetched: true });
    expect(isOwnedCache(dir)).toBe(true);
    expect(readFileSync(join(dir, 'bootcamp', 'a.txt'), 'utf8')).toBe('one\ntwo\n');
    const b = ensureCheckout(dir, sha1, upstreamUrl);
    expect(b.fetched).toBe(false);
  });

  it('replaces its own marked cache when the sha moves', () => {
    const dir = join(root, 'moves');
    ensureCheckout(dir, sha1, upstreamUrl);
    writeFileSync(join(dir, 'stray.txt'), 'leftover');
    const r = ensureCheckout(dir, sha2, upstreamUrl);
    expect(r.fetched).toBe(true);
    expect(existsSync(join(dir, 'stray.txt'))).toBe(false);
    expect(readFileSync(join(dir, 'bootcamp', 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
    expect(isOwnedCache(dir)).toBe(true);
  });

  it('accepts an existing EMPTY dir', () => {
    const dir = join(root, 'empty');
    mkdirSync(dir);
    expect(ensureCheckout(dir, sha1, upstreamUrl).fetched).toBe(true);
    expect(isOwnedCache(dir)).toBe(true);
  });

  it('REFUSES a foreign non-empty dir and leaves every byte in place', () => {
    const dir = join(root, 'foreign');
    mkdirSync(dir);
    writeFileSync(join(dir, 'notes.md'), 'my uncommitted work');
    expect(() => ensureCheckout(dir, sha1, upstreamUrl)).toThrow(SourceError);
    expect(() => ensureCheckout(dir, sha1, upstreamUrl)).toThrow(/refusing to delete .*new or empty directory/s);
    expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe('my uncommitted work');
  });

  it('REFUSES a real working copy (the --cache/--source mix-up): .git and dirty work survive', () => {
    const dir = join(root, 'working-copy');
    mkdirSync(dir);
    gitIn(dir, 'init', '--quiet');
    writeFileSync(join(dir, 'tracked.txt'), 'v1\n');
    gitIn(dir, 'add', '.');
    gitIn(dir, 'commit', '--quiet', '-m', 'mine');
    const head = gitIn(dir, 'rev-parse', 'HEAD');
    writeFileSync(join(dir, 'tracked.txt'), 'v2 uncommitted\n');
    // wrong sha
    expect(() => ensureCheckout(dir, sha1, upstreamUrl)).toThrow(SourceError);
    // its own HEAD but dirty
    expect(() => ensureCheckout(dir, head, upstreamUrl)).toThrow(SourceError);
    expect(existsSync(join(dir, '.git'))).toBe(true);
    expect(readFileSync(join(dir, 'tracked.txt'), 'utf8')).toBe('v2 uncommitted\n');
    expect(gitIn(dir, 'rev-parse', 'HEAD')).toBe(head);
  });
});
