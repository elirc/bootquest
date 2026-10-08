import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CurriculumConfig, SignalpostProgram } from '@bootquest/shared/sync';
import { parseCurriculumConfig, pathSelected } from '../src/sync/config.ts';
import { assignStableKeys, baseStableKey, normalizeHeading, parseMarkdownSections } from '../src/sync/markdown.ts';
import { milestoneLine, parseProgramJson } from '../src/sync/program.ts';
import { parseYamlSubset, YamlSubsetError } from '../src/sync/yaml.ts';

const REAL_PROGRAM = readFileSync(new URL('./fixtures/sync/program.json', import.meta.url), 'utf8');
const REAL_U01 = readFileSync(new URL('./fixtures/sync/U01.md', import.meta.url), 'utf8');
const REAL_YAML = readFileSync(new URL('../../curriculum.yaml', import.meta.url), 'utf8');

const keysOf = (repo: string, files: Record<string, string>) =>
  assignStableKeys(
    repo,
    Object.entries(files).flatMap(([p, t]) => parseMarkdownSections(p, t)),
  );

describe('curriculum.yaml (source registry)', () => {
  it('the committed registry parses and lists the four first sources with their roles', () => {
    const c = parseCurriculumConfig(REAL_YAML);
    expect(c.sources.map((s) => [s.repo, s.role])).toEqual([
      ['elirc/signalpost-swe-bootcamp', 'curriculum'],
      ['elirc/relay-upskilling', 'reference'],
      ['elirc/harbor-swe-bootcamp', 'reference'],
      ['elirc/csbootcamp', 'reference'],
    ]);
    expect(c.sources[0]!.exclude).toEqual(['apps/web/public/guides/', 'node_modules/']);
  });

  it('YAML subset: nested sequences of mappings, flow lists, quotes, comments, pinned_sha', () => {
    const v = parseYamlSubset(
      [
        '# registry',
        'version: 1',
        'sources:',
        '  - repo: "elirc/a.b_c"   # quoted',
        '    role: corpus',
        `    pinned_sha: '${'a'.repeat(40)}'`,
        '    include:',
        '      - docs/',
        '      - guides/',
        '- repo: elirc/x',
      ].slice(0, 9).join('\n'),
    );
    expect(CurriculumConfig.parse(v)).toEqual({
      version: 1,
      sources: [{ repo: 'elirc/a.b_c', role: 'corpus', pinned_sha: 'a'.repeat(40), include: ['docs/', 'guides/'] }],
    });
  });

  it('refuses YAML outside the subset and invalid registries (never guesses)', () => {
    expect(() => parseYamlSubset('a:\n\t- b')).toThrow(YamlSubsetError);
    expect(() => parseYamlSubset('a: &anchor 1')).toThrow(/unsupported/);
    expect(() => parseYamlSubset('a: 1\na: 2')).toThrow(/duplicate key/);
    expect(() => parseYamlSubset('a: 1\n---\nb: 2')).toThrow(/multiple YAML documents/);
    const dup = 'version: 1\nsources:\n  - repo: elirc/a\n    role: reference\n  - repo: elirc/a\n    role: corpus\n';
    expect(() => parseCurriculumConfig(dup)).toThrow(/duplicate source/);
    expect(() => parseCurriculumConfig('version: 1\nsources:\n  - repo: elirc/a\n    role: teacher\n')).toThrow();
    expect(() => parseCurriculumConfig('version: 1\nsources:\n  - repo: elirc/a\n    role: reference\n    include: [../etc]\n')).toThrow();
    expect(() => parseCurriculumConfig('version: 1\nsources:\n  - repo: elirc/a\n    role: reference\n    pinned_sha: abc\n')).toThrow();
  });

  it('include/exclude prefixes select markdown paths', () => {
    expect(pathSelected({ exclude: ['apps/web/public/guides/'] }, 'apps/web/public/guides/U01.md')).toBe(false);
    expect(pathSelected({ exclude: ['apps/web/public/guides/'] }, 'docs/curriculum/U01.md')).toBe(true);
    expect(pathSelected({ include: ['docs'] }, 'docs/x.md')).toBe(true);
    expect(pathSelected({ include: ['docs'] }, 'docsx/x.md')).toBe(false);
  });
});

describe('stable_key algorithm v1', () => {
  it('real U01.md: one section per ATX heading, nested ranges, H1 spans the file', () => {
    const s = parseMarkdownSections('docs/curriculum/U01.md', REAL_U01);
    expect(s.map((x) => x.title).slice(0, 4)).toEqual(['U01 — Programming you can explain', 'Learn', 'Worked example', 'Guided practice']);
    expect(s[0]).toMatchObject({ level: 1, lineStart: 1, lineEnd: 143, anchor: 'u01--programming-you-can-explain' });
    expect(s.find((x) => x.title.startsWith('U01-02'))).toMatchObject({ level: 2, lineStart: 58, lineEnd: 76 });
    expect(s).toHaveLength(13);
  });

  it('headings inside fenced code are not sections; frontmatter id wins', () => {
    const md = '---\nid: guide-42\n---\n# Title\n\n```md\n# not a heading\n```\n\n## Real\n';
    const s = parseMarkdownSections('a.md', md);
    expect(s.map((x) => x.title)).toEqual(['Title', 'Title', 'Real']);
    const k = assignStableKeys('elirc/r', s);
    expect(k[0]).toMatchObject({ stableKey: 'fm:guide-42', provenance: 'frontmatter', level: 0 });
    expect(k[1]!.provenance).toBe('frontmatter');
    // frontmatter-scoped heading keys follow the id, not the repo-wide heading space
    const other = assignStableKeys('elirc/r', parseMarkdownSections('b.md', '# Title\n\n## Real\n'));
    expect(other.map((x) => x.stableKey)).not.toContain(k[1]!.stableKey);
  });

  it('keys are SCOPED PER REPO: identical headings in twin repos never share a key', () => {
    const files = { 'README.md': '# Exercise 1\n\n## Goal\n' };
    const a = keysOf('elirc/ww12', files).map((x) => x.stableKey);
    const b = keysOf('elirc/organized-experiment-ww12', files).map((x) => x.stableKey);
    expect(a).toHaveLength(2);
    expect(a.filter((k) => b.includes(k))).toEqual([]);
  });

  it('a MOVED file re-matches: same headings -> same keys at the new path', () => {
    const text = '# Guide\n\n## Step one\n\n## Step two\n';
    const before = keysOf('elirc/r', { 'docs/guide.md': text });
    const after = keysOf('elirc/r', { 'docs/archive/2026/renamed-guide.md': text });
    expect(after.map((x) => x.stableKey)).toEqual(before.map((x) => x.stableKey));
    expect(after[0]!.path).toBe('docs/archive/2026/renamed-guide.md');
  });

  it('normalization: em/en dashes, curly quotes, emphasis, code ticks, CRLF and spacing do not change a key', () => {
    const a = keysOf('elirc/r', { 'a.md': '# U01 — “Programming”  you **can** `explain`\n' })[0]!.stableKey;
    const b = keysOf('elirc/r', { 'a.md': '# U01 - "programming" you can explain\r\n' })[0]!.stableKey;
    expect(a).toBe(b);
    expect(normalizeHeading('Step  –  One')).toBe('step - one');
  });

  it('DEDUP within a file: the n-th identical heading path gets ordinal n; adding a later duplicate never renames the first', () => {
    const one = keysOf('elirc/r', { 'a.md': '# T\n\n## Exercise\n' });
    const two = keysOf('elirc/r', { 'a.md': '# T\n\n## Exercise\n\n## Exercise\n' });
    expect(two[1]!.stableKey).toBe(one[1]!.stableKey);
    expect(two[2]!.stableKey).not.toBe(two[1]!.stableKey);
    expect(two[2]!.ordinal).toBe(2);
    expect(new Set(two.map((x) => x.stableKey)).size).toBe(3);
    // GitHub-style anchors are disambiguated too
    expect(two.map((x) => x.anchor)).toEqual(['t', 'exercise', 'exercise-1']);
  });

  it('DEDUP across files: sorted path order, first keeps the key, k-th copy gets "~k" (deterministic)', () => {
    const files = { 'docs/curriculum/U01.md': REAL_U01, 'apps/web/public/guides/U01.md': REAL_U01 };
    const k1 = keysOf('elirc/signalpost-swe-bootcamp', files);
    const k2 = keysOf('elirc/signalpost-swe-bootcamp', Object.fromEntries(Object.entries(files).reverse()));
    expect(k1.map((x) => [x.path, x.stableKey])).toEqual(k2.map((x) => [x.path, x.stableKey]));
    const apps = k1.filter((x) => x.path.startsWith('apps/'));
    const docs = k1.filter((x) => x.path.startsWith('docs/'));
    // 'apps/...' sorts before 'docs/...': the generated copy keeps the base keys
    expect(apps.every((x) => !x.stableKey.includes('~'))).toBe(true);
    expect(docs.every((x) => x.stableKey.endsWith('~2'))).toBe(true);
    expect(new Set(k1.map((x) => x.stableKey)).size).toBe(k1.length);
    // ...which is why curriculum.yaml excludes the generated copies for signalpost
    const alone = keysOf('elirc/signalpost-swe-bootcamp', { 'docs/curriculum/U01.md': REAL_U01 });
    expect(alone.map((x) => x.stableKey)).toEqual(apps.map((x) => x.stableKey));
  });

  it('a heading-less file is one section keyed by its file name', () => {
    const k = keysOf('elirc/r', { 'notes/plain.md': 'just text\nmore\n' });
    expect(k).toHaveLength(1);
    expect(k[0]).toMatchObject({ title: 'plain', level: 0, lineStart: 1, lineEnd: 2, provenance: 'heading-hash' });
    expect(baseStableKey('elirc/r', k[0]!).key).toMatch(/^h:[0-9a-f]{20}$/);
  });
});

describe('program.json (signalpost v2) with the BORROWED zod schema', () => {
  it('the real program.json parses: 12 milestones U01-U12, 4 tickets each, 24 free-text competencies', () => {
    const p = parseProgramJson(REAL_PROGRAM);
    expect(p.version).toBe(2);
    expect(p.milestones.map((m) => m.code)).toEqual(Array.from({ length: 12 }, (_, i) => `U${String(i + 1).padStart(2, '0')}`));
    expect(p.milestones.every((m) => m.tickets.length === 4)).toBe(true);
    const comps = new Set(p.milestones.flatMap((m) => [...m.competencies, ...m.tickets.flatMap((t) => t.competencies)]));
    expect(comps.size).toBe(24);
    expect(milestoneLine(REAL_PROGRAM, 'U01')).toBeGreaterThan(1);
    // upstream extras pass through (non-strict, like upstream): drill, delivery_status, outOfScope
    const raw = JSON.parse(REAL_PROGRAM) as { milestones: Record<string, unknown>[] };
    expect('drill' in raw.milestones[0]!).toBe(true);
  });

  it('the borrowed schema rejects what upstream rejects', () => {
    const p = JSON.parse(REAL_PROGRAM) as { version: number; milestones: { code: string; tickets: unknown[]; lesson: string; competencies: string[] }[] };
    const bad = (mut: (x: typeof p) => void) => {
      const c = structuredClone(p);
      mut(c);
      return SignalpostProgram.safeParse(c).success;
    };
    expect(bad(() => undefined)).toBe(true);
    expect(bad((c) => (c.version = 1))).toBe(false);
    expect(bad((c) => (c.milestones[0]!.code = 'M01'))).toBe(false);
    expect(bad((c) => c.milestones[0]!.tickets.pop())).toBe(false);
    expect(bad((c) => (c.milestones[0]!.lesson = 'too short'))).toBe(false);
    expect(bad((c) => c.milestones[0]!.competencies.push('third'))).toBe(false);
  });
});
