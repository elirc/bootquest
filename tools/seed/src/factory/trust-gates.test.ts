/**
 * The writers' trust gates (review fix/tooling-review), exercised on writeSeedPack directly and
 * WITHOUT the fixtures' escape hatch:
 *   - a pack that pins >= 1 blob at pin 'caller-asserted' (no mirror verified anything) is never
 *     stamped unless the caller explicitly opts in (option / BOOTQUEST_SEED_ALLOW_UNVERIFIED_PIN=1);
 *   - a registry that is not the committed tools/seed/exclusions.json never gets a pack stamped
 *     (the stamp's fingerprint binds the committed file) unless the test-only unsafe flag is set.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SeedItem } from '@bootquest/shared';
import { ExclusionRegistry, Exclusions, loadExclusions } from './exclusions.ts';
import { ALLOW_UNVERIFIED_PIN_ENV, emptyOutcome, loadSeedPack, unverifiedPinProblem, writeSeedPack, type WriteSeedPackOptions } from './pack.ts';

const tmp = mkdtempSync(join(tmpdir(), 'bq-trust-gates-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => {
  delete process.env[ALLOW_UNVERIFIED_PIN_ENV];
});

const item = {
  kind: 'reading-step',
  key: 'seed:quests:r/reading-step/0123456789abcdef',
  provenance: { repo: 'r', sha: 'abcdef1', path: 'a.md', lines: { start: 1, end: 2 } },
  citations: [],
  title: 'Read the guide',
  headingPath: ['Guide'],
} as unknown as SeedItem;

let n = 0;
function write(pin: 'git-head' | 'git-tree' | 'caller-asserted', blobs: number, extra: Partial<WriteSeedPackOptions> = {}) {
  const dir = join(tmp, `p${++n}`);
  const outcome = { ...emptyOutcome(), accepted: [item] };
  const r = writeSeedPack({
    dir,
    generator: 'quests',
    name: 'r',
    checkout: { repo: 'r', sha: 'abcdef1', pin, excludeDirs: [], blobs: new Map(Array.from({ length: blobs }, (_, i) => [`f${i}.md`, 'a'.repeat(40)])) },
    inputs: ['a.md'],
    outcome,
    guardSeedRoot: null,
    ...extra,
  });
  return { r, dir };
}

describe('caller-asserted pins are never stamped silently', () => {
  it('unverifiedPinProblem: only caller-asserted WITH pinned blobs, and only without the hatch', () => {
    expect(unverifiedPinProblem('caller-asserted', 3, false)).toMatch(/pin caller-asserted with 3 pinned blob\(s\): no mirror verified/);
    expect(unverifiedPinProblem('caller-asserted', 0, false)).toBeNull(); // nothing pinned: nothing to verify
    expect(unverifiedPinProblem('git-tree', 3, false)).toBeNull();
    expect(unverifiedPinProblem('git-head', 3, false)).toBeNull();
    expect(unverifiedPinProblem('caller-asserted', 3, true)).toBeNull();
  });

  it('writeSeedPack: caller-asserted + blobs -> written, NOT stamped; git-tree / 0 blobs / explicit hatch -> stamped', () => {
    const bad = write('caller-asserted', 2);
    expect(bad.r.stamped).toBe(false);
    expect(bad.r.unstampedBecause.join('\n')).toMatch(/pin caller-asserted with 2 pinned blob\(s\)/);
    expect(existsSync(join(bad.dir, 'validation.json'))).toBe(false);
    expect(write('git-tree', 2).r.stamped).toBe(true);
    expect(write('caller-asserted', 0).r.stamped).toBe(true);
    expect(write('caller-asserted', 2, { allowUnverifiedPin: true }).r.stamped).toBe(true);
    process.env[ALLOW_UNVERIFIED_PIN_ENV] = '1';
    const viaEnv = write('caller-asserted', 2);
    expect(viaEnv.r.stamped).toBe(true);
    expect(loadSeedPack(viaEnv.dir, { requireStamp: true }).manifest.source.pin).toBe('caller-asserted');
    // an explicit `false` beats the environment
    expect(write('caller-asserted', 2, { allowUnverifiedPin: false }).r.stamped).toBe(false);
  });
});

describe('a non-committed exclusions registry never gets a stamp', () => {
  const committed = loadExclusions();
  const permissive = new Exclusions(ExclusionRegistry.parse({ ...committed, entries: [], secretPatterns: [{ id: 'never', regex: 'NEVERMATCHES_[0-9]{40}' }] }));

  it('isCommitted: content equality with tools/seed/exclusions.json (key order irrelevant), any edit is not', () => {
    expect(Exclusions.load().isCommitted()).toBe(true);
    expect(new Exclusions(Object.fromEntries(Object.entries(committed).reverse()) as ExclusionRegistry).isCommitted()).toBe(true);
    expect(permissive.isCommitted()).toBe(false);
    expect(new Exclusions({ ...committed, secretPatterns: committed.secretPatterns.slice(1) }).isCommitted()).toBe(false);
  });

  it('writeSeedPack under a permissive registry: written, NOT stamped (unsafeExclusions is the tests-only override)', () => {
    const a = write('git-tree', 1, { exclusions: permissive });
    expect(a.r.stamped).toBe(false);
    expect(a.r.unstampedBecause.join('\n')).toMatch(/exclusions: the registry in use is not the committed tools\/seed\/exclusions\.json/);
    expect(write('git-tree', 1, { exclusions: permissive, unsafeExclusions: true }).r.stamped).toBe(true);
    expect(write('git-tree', 1, { exclusions: Exclusions.load() }).r.stamped).toBe(true);
    expect(readFileSync(join(a.dir, 'manifest.json'), 'utf8')).toContain('"pin": "git-tree"');
  });
});
