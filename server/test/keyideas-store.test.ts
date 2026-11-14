/**
 * rv2 S1 task 1 (PLAN §2.1, §4 S1.1): the key-ideas side-file reader (store/keyideas.ts).
 *   - the bootquest-keyideas@1 format is validated; a bad file (broken JSON, empty `sources`, a section id that is
 *     not its file name) is warned once and SKIPPED, the good files load;
 *   - a missing content/keyideas/ dir is "no ideas" with no warning; BOOTQUEST_KEYIDEAS='' turns the layer off;
 *   - card-tags.json (F3) and headlines.json (F2) are read from the same content dir; absent = no filter / generic.
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyIdeasFile, keyIdeas, makeKeyIdeas, readKeyIdeas, setKeyIdeas } from '../src/store/keyideas.ts';

const FIX = join(import.meta.dirname, 'fixtures', 'keyideas');
const CONTENT = join(FIX, 'content');
const EMPTY = join(FIX, 'empty');

describe('key-ideas side files (store/keyideas.ts)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setKeyIdeas(null);
  });

  it('loads the good files and skips each bad one with one problem line', () => {
    const s = readKeyIdeas(CONTENT);
    expect([...s.sections.keys()]).toEqual(['fx-alpha', 'fx-beta']);
    expect(s.sections.get('fx-alpha')!.ideas.map((i) => i.id)).toEqual(['idempotent-write', 'lost-update', 'keyset-pagination', 'archived-only', 'unknown-only']);
    expect(s.problems).toHaveLength(3);
    expect(s.problems.find((p) => p.startsWith('keyideas/broken-json.json is malformed'))).toBeDefined();
    expect(s.problems.find((p) => p.startsWith('keyideas/bad-schema.json is malformed'))).toMatch(/sources/);
    expect(s.problems.find((p) => p.startsWith('keyideas/misnamed.json is malformed'))).toMatch(/does not match the file name/);
  });

  it('reads card-tags.json (repo-recall + noEnrol) and headlines.json (array and record forms)', () => {
    const s = readKeyIdeas(CONTENT);
    expect([...s.noEnrol].sort()).toEqual(['fc:kx-listed', 'fc:kx-repo-recall']);
    expect(s.headlines.get('eb:kx-design#q1k1')).toBe('Name the envelope number first');
    expect(s.headlines.has('eb:kx-design#q1k2')).toBe(false);
    expect(s.headlines.get('eb:kx-design#q2k1')).toBe('Say what happens when a dependency is down');
  });

  it('a content dir without keyideas/ (or the other files) is empty and silent', () => {
    const s = readKeyIdeas(EMPTY);
    expect(s.sections.size).toBe(0);
    expect(s.noEnrol.size).toBe(0);
    expect(s.headlines.size).toBe(0);
    expect(s.problems).toEqual([]);
  });

  it('lazy load from BOOTQUEST_KEYIDEAS warns each problem once; "" turns the layer off', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('BOOTQUEST_KEYIDEAS', CONTENT);
    expect(keyIdeas().sections.size).toBe(2);
    expect(keyIdeas().sections.size).toBe(2); // cached: no second read, no second warning
    expect(warn).toHaveBeenCalledTimes(3);
    setKeyIdeas(null);
    vi.stubEnv('BOOTQUEST_KEYIDEAS', '');
    expect(keyIdeas().sections.size).toBe(0);
    setKeyIdeas(null);
    vi.stubEnv('BOOTQUEST_KEYIDEAS', EMPTY);
    warn.mockClear();
    expect(keyIdeas().sections.size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('schema: an idea needs >= 1 source; ids are unique; recapAfter is a fraction or a whole count', () => {
    const base = readKeyIdeas(CONTENT).sections.get('fx-beta')!;
    expect(KeyIdeasFile.safeParse({ ...base, ideas: [{ ...base.ideas[0]!, sources: [] }] }).success).toBe(false);
    expect(KeyIdeasFile.safeParse({ ...base, ideas: [base.ideas[0]!, base.ideas[0]!] }).success).toBe(false);
    expect(KeyIdeasFile.safeParse({ ...base, recapAfter: 2.5 }).success).toBe(false);
    expect(KeyIdeasFile.safeParse({ ...base, recapAfter: 3 }).success).toBe(true);
    expect(KeyIdeasFile.safeParse({ ...base, recapAfter: 0.5 }).success).toBe(true);
    expect(KeyIdeasFile.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(makeKeyIdeas([base]).sections.get('fx-beta')!.title).toBe('Fixture beta: reads');
  });
});
