import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PACK_FORMAT, PackQuarantine } from '@bootquest/shared';
import { pruneStaleQuarantine } from './prune.ts';
import { readQuarantineFile } from './validate.ts';

const tmp = mkdtempSync(join(tmpdir(), 'bq-prune-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const E1 = { key: 'bootforge:c1/e1', course: 'c1', reason: 'reference solution fails' };
const E2 = { key: 'bootforge:gone/e9', course: 'gone-course', reason: 'vacuous-check' };
const E3 = { key: 'bootforge:gone2/e3', course: 'gone-course-2', reason: 'no starter' };

function pack(name: string, opts: { manifest?: unknown; quarantine?: unknown; rawQuarantine?: string } = {}): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  const manifest = opts.manifest ?? { source: 'packs/x', courses: [{ id: 'c1' }, { id: 'c2' }] };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  if (opts.rawQuarantine !== undefined) writeFileSync(join(dir, 'quarantine.json'), opts.rawQuarantine);
  else if (opts.quarantine !== undefined) writeFileSync(join(dir, 'quarantine.json'), `${JSON.stringify(opts.quarantine, null, 1)}\n`);
  return dir;
}

const q = (entries: object[], source = 'packs/x') => ({ format: PACK_FORMAT, source, entries });

describe('pruneStaleQuarantine (fix 4: entries for courses dropped from the manifest)', () => {
  it('drops stale-course entries, keeps live ones, logs one PRUNED line each, rewrites both files', () => {
    const dir = pack('stale', { quarantine: q([E1, E2, E3]) });
    const lines: string[] = [];
    const pruned = pruneStaleQuarantine(dir, (l) => lines.push(l));
    expect(pruned.map((e) => e.key).sort()).toEqual([E3.key, E2.key].sort());
    expect(lines).toHaveLength(2);
    expect(lines.join('\n')).toMatch(/PRUNED bootforge:gone\/e9 \[gone-course\]: course no longer in the manifest/);
    const after = PackQuarantine.parse(JSON.parse(readFileSync(join(dir, 'quarantine.json'), 'utf8')));
    expect(after.entries).toEqual([E1]);
    const md = readFileSync(join(dir, 'QUARANTINE.md'), 'utf8');
    expect(md).toContain(E1.key);
    expect(md).not.toContain(E2.key);
    // idempotent: a second prune finds nothing
    expect(pruneStaleQuarantine(dir)).toEqual([]);
  });

  it('no-op when every entry is for a live course (bytes untouched)', () => {
    const dir = pack('live', { quarantine: q([E1]) });
    const before = readFileSync(join(dir, 'quarantine.json'), 'utf8');
    expect(pruneStaleQuarantine(dir)).toEqual([]);
    expect(readFileSync(join(dir, 'quarantine.json'), 'utf8')).toBe(before);
  });

  it('a malformed quarantine.json is left untouched for the F8 refusal (never rewritten)', () => {
    const dir = pack('mal', { rawQuarantine: '{ torn' });
    expect(pruneStaleQuarantine(dir)).toEqual([]);
    expect(readFileSync(join(dir, 'quarantine.json'), 'utf8')).toBe('{ torn');
    expect(() => readQuarantineFile(dir)).toThrow(/malformed/);
  });

  it('prunes nothing when the manifest is missing/unreadable or the quarantine is for another source', () => {
    const noQ = pack('no-quarantine');
    expect(pruneStaleQuarantine(noQ)).toEqual([]);
    const badM = pack('bad-manifest', { manifest: { nope: true }, quarantine: q([E2]) });
    expect(pruneStaleQuarantine(badM)).toEqual([]);
    expect(PackQuarantine.parse(JSON.parse(readFileSync(join(badM, 'quarantine.json'), 'utf8'))).entries).toEqual([E2]);
    const wrongSrc = pack('wrong-source', { quarantine: q([E2], 'packs/other') });
    expect(pruneStaleQuarantine(wrongSrc)).toEqual([]);
    expect(PackQuarantine.parse(JSON.parse(readFileSync(join(wrongSrc, 'quarantine.json'), 'utf8'))).entries).toEqual([E2]);
  });
});
