import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { plantedToken } from './demo/plant.ts';
import { Exclusions, loadExclusions, pathPatternRegex, UnregisteredSecretError } from './exclusions.ts';

describe('exclusion / redaction registry', () => {
  const ex = Exclusions.load();

  it('loads the committed registry with the R2 recon entries (reason-coded)', () => {
    const r = loadExclusions();
    const byId = new Map(r.entries.map((e) => [e.id, e]));
    expect(byId.get('andie-verification-token')).toMatchObject({ repo: 'andie', reason: 'leaked-secret', paths: ['**/VERIFICATION.md'] });
    expect(byId.get('z8-test-time-bomb')).toMatchObject({ repo: 'z8', reason: 'expiring-tests', until: { bombDate: '2026-12-31', clearedBy: null } });
    for (const repo of ['Skillforge1', 'skillforgejs', 'tagalog', 'ww45', 'organized-experiment-ww45', 'AnkiJS1', 'vg', 'vgdemo', 'perch', 'aaa1']) {
      expect(r.entries.some((e) => e.repo === repo && e.reason === 'stale-anchors'), repo).toBe(true);
    }
  });

  it('file-level: andie VERIFICATION.md at any depth, andie only', () => {
    expect(ex.path('andie', 'astraupskill/VERIFICATION.md')?.reason).toBe('excluded:andie-verification-token (leaked-secret)');
    expect(ex.path('andie', 'VERIFICATION.md')).not.toBeNull();
    expect(ex.path('andie', 'astraupskill/05-PRACTICE.md')).toBeNull();
    expect(ex.path('ww6', 'astraupskill/VERIFICATION.md')).toBeNull();
    expect(ex.repo('andie')).toBeNull(); // the rest of andie stays seedable
  });

  it('repo-level and path-prefix entries; exact-case repo names', () => {
    expect(ex.repo('z8')?.entry.id).toBe('z8-test-time-bomb');
    expect(ex.path('z8', 'README.md')?.entry.id).toBe('z8-test-time-bomb');
    expect(ex.repo('Z8')).toBeNull();
    expect(ex.path('tagalog', 'apps/web/src/App.tsx')?.entry.reason).toBe('stale-anchors');
    expect(ex.path('tagalog', 'apps/webby/x.ts')).toBeNull();
    expect(ex.path('ww45', 'docs2/guide.md')).not.toBeNull();
    expect(ex.path('ww45', 'docs/learning/guide.md')).toBeNull();
  });

  it('a date-bounded entry is lifted only by a human clearing it, never by the clock', () => {
    const r = loadExclusions();
    const cleared = new Exclusions({ ...r, entries: r.entries.map((e) => (e.id === 'z8-test-time-bomb' ? { ...e, until: { bombDate: '2026-12-31', clearedBy: 'owner 2027-01-02: clock pinned' } } : e)) });
    expect(cleared.repo('z8')).toBeNull();
    expect(ex.repo('z8')).not.toBeNull();
  });

  it('glob translation', () => {
    expect(pathPatternRegex('**/VERIFICATION.md').test('a/b/VERIFICATION.md')).toBe(true);
    expect(pathPatternRegex('**/VERIFICATION.md').test('VERIFICATION.md')).toBe(true);
    expect(pathPatternRegex('**/VERIFICATION.md').test('a/VERIFICATION.md.bak')).toBe(false);
    expect(pathPatternRegex('docs/*.md').test('docs/a.md')).toBe(true);
    expect(pathPatternRegex('docs/*.md').test('docs/x/a.md')).toBe(false);
    expect(pathPatternRegex('apps/web/').test('apps/web/x/y.ts')).toBe(true);
  });

  it('secret scan: a planted token is detected; admit() refuses it unless the registry already excludes the file', () => {
    const text = `token ${plantedToken()} here`;
    expect(ex.scan(text)).toEqual(['shopify-token']);
    expect(ex.scan('no secrets, just shpat_ prose')).toEqual([]);
    expect(ex.admit('andie', 'astraupskill/VERIFICATION.md', text)?.entry.id).toBe('andie-verification-token');
    expect(() => ex.admit('notandie', 'astraupskill/VERIFICATION.md', text)).toThrow(UnregisteredSecretError);
    expect(() => ex.admit('notandie', 'astraupskill/VERIFICATION.md', text)).toThrow(/UNREGISTERED SECRET: notandie\/astraupskill\/VERIFICATION.md matches secret pattern\(s\) shopify-token/);
  });

  it('determinism guard: no wall clock or unseeded randomness anywhere in the factory sources', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) {
          if (f !== 'fixtures') walk(p);
        } else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.push(p);
      }
    };
    walk(import.meta.dirname);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/Math\.random|Date\.now\(|new Date\(|randomInt|randomUUID|performance\.now/);
    }
  });
});
