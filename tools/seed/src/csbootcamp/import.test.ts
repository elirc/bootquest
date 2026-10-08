import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackCourseFile, PackManifest } from '@bootquest/shared';
import { readPack } from '@bootquest/server/packs';
import { composeGraded } from '@bootquest/server/runners/csharp/split';
import { CSBOOTCAMP_EXPECTED, ImportError, importCsbootcamp, mapExercise, readmeMeta, RUNNER_CHECK_HARNESS, stableKey } from './import.ts';
import { parseHeader, readModules, SourceError } from './source.ts';

// Real upstream bytes: the P2 fixture (csbootcamp @ e05b3505, byte-identical copies).
const FX = join(import.meta.dirname, '..', '..', '..', '..', 'server', 'src', 'runners', 'csharp', 'fixtures', 'csbootcamp');
const EX = readFileSync(join(FX, '01-language-core', 'exercises', '01-count-vowels.cs'), 'utf8');
const SOL = readFileSync(join(FX, '01-language-core', 'solutions', '01-count-vowels.cs'), 'utf8');

/** A module-05-style exercise: the code the learner edits lives in a types section AFTER `return Report();`. */
const TYPES_EX = `// ─────────────────────────────────────────────────────────────────────────
//  02 · a box that doubles                                       ★★☆ core
//  concepts: records · computed members
//  run: dotnet run 02-box.cs
// ─────────────────────────────────────────────────────────────────────────
//
//  Finish the Box record at the BOTTOM of this file:
//
//      new Box(2).Twice   → 4
//
//  hint: one expression.

#:project ../../_lib/Check/Check.csproj

using static Bootcamp.Check;

// ─── tests ───────────────────────────────────────────────────────────────

Test("doubles", () => Eq(new Box(2).Twice, 4));
Test("doubles zero", () => Eq(new Box(0).Twice, 0));

return Report();

// ─── the code you edit ───────────────────────────────────────────────────

record Box(int W)
{
    public int Twice => throw new NotImplementedException("TODO");
}
`;
const TYPES_SOL = TYPES_EX.replace('//  02 · a box that doubles      ', '//  02 · a box — SOLUTION         ')
  .replace('//  Finish the Box record at the BOTTOM of this file:', '//  Walkthrough:\n//  Twice is a computed member.')
  .replace('throw new NotImplementedException("TODO")', 'W * 2');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bq-csbootcamp-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

function writeSource(files: Record<string, string>): string {
  const root = join(dir, 'src');
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, 'bootcamp', ...rel.split('/'));
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

const baseSource = (extra: Record<string, string> = {}) =>
  writeSource({
    '_lib/Check/Check.cs': readFileSync(RUNNER_CHECK_HARNESS, 'utf8'),
    '01-language-core/README.md': '# 01 · Language Core\n\nC# has a small centre.\nThis module is it.\n\n## The mental model\n',
    '01-language-core/exercises/01-count-vowels.cs': EX,
    '01-language-core/solutions/01-count-vowels.cs': SOL,
    '05-types/README.md': '# 05 · Types\n\nTypes.\n',
    '05-types/exercises/02-box.cs': TYPES_EX,
    '05-types/solutions/02-box.cs': TYPES_SOL,
    ...extra,
  });

describe('csbootcamp header + README parsing', () => {
  it('parses the FORMAT.md header of the real exercise and solution', () => {
    const h = parseHeader(EX.replace(/\r\n/g, '\n'), 'ex');
    expect(h).toMatchObject({ number: '01', title: 'count the vowels', stars: 1, tier: 'warm-up' });
    expect(h.body.split('\n')[0]).not.toMatch(/^\/\//);
    const s = parseHeader(SOL.replace(/\r\n/g, '\n'), 'sol');
    expect(s.title).toBe('count the vowels');
    expect(s.body).toMatch(/^Walkthrough:/);
  });

  it('refuses a file without the header block', () => {
    expect(() => parseHeader('using System;\n', 'x')).toThrow(SourceError);
  });

  it('README: title without the number, first paragraph as the description', () => {
    expect(readmeMeta('# 01 · Language Core\n\nC# has a small centre.\nThis module is it.\n\n## x\n', 'm')).toEqual({
      title: 'Language Core',
      description: 'C# has a small centre. This module is it.',
    });
  });
});

describe('seed:import:csbootcamp mapping', () => {
  it('maps every exercise to a drill-cs console-check unit (csharp track) with the three-part split', () => {
    const root = baseSource();
    const out = join(dir, 'pack');
    const { manifest } = importCsbootcamp({ sourceDir: root, outDir: out, expected: null, gitHead: 'e05b3505f22acbb95ed4531204e08991d29a7da9', checkHarness: RUNNER_CHECK_HARNESS });
    expect(manifest.track).toBe('csharp');
    expect(manifest.courses.map((c) => [c.id, c.order, c.counts.code])).toEqual([
      ['01-language-core', 1, 1],
      ['05-types', 2, 1],
    ]);
    expect(manifest.importedFrom).toMatchObject({ repo: 'elirc/csbootcamp', originKind: 'github', subpath: 'bootcamp', gitHead: 'e05b3505f22acbb95ed4531204e08991d29a7da9', dirty: false });

    const c1 = PackCourseFile.parse(JSON.parse(readFileSync(join(out, '01-language-core.json'), 'utf8')));
    expect(c1.course).toMatchObject({ id: '01-language-core', title: 'Language Core', description: 'C# has a small centre. This module is it.' });
    const u = c1.units[0]!;
    expect(u.unit).toMatchObject({ key: 'csbootcamp/01-language-core/01-count-vowels', track: 'csharp', kind: 'drill', title: 'Count the vowels', difficulty: 1, competencies: ['language-fluency'] });
    expect(u.origin).toMatchObject({ id: '01-language-core/01-count-vowels', type: 'code', module: '01-language-core', position: 0 });
    const spec = u.unit.checks[0]!.spec;
    expect(spec.type).toBe('drill-cs');
    if (spec.type !== 'drill-cs') throw new Error('unreachable');
    expect(spec.shape).toBe('console-check');
    expect(spec.files.tests.startsWith('// ─── tests ─')).toBe(true);
    expect(spec.files.tests.trimEnd().endsWith('return Report();')).toBe(true);
    const content = c1.content[u.unit.key]!;
    expect(content.starter).toBe(EX.replace(/\r\n/g, '\n'));
    expect(content.solution).toBe(SOL.replace(/\r\n/g, '\n'));
    expect(content.instructions).toMatch(/^\*\*Concepts:\*\*/);
    expect(content.instructions).not.toMatch(/^\/\//m);
    expect(content.explanation).not.toMatch(/^Walkthrough:/);
    // the graded program for the shipped starter = starter head + EXERCISE tests + starter tail
    expect(composeGraded(content.starter!, spec.files.tests + spec.files.tail)).toContain('throw new NotImplementedException("TODO")');

    // module-05 layout: the types section is the tail; solution graded with ITS tail and the exercise tests
    const c2 = PackCourseFile.parse(JSON.parse(readFileSync(join(out, '05-types.json'), 'utf8')));
    const t = c2.units[0]!;
    expect(t.unit.difficulty).toBe(2);
    const tspec = t.unit.checks[0]!.spec;
    if (tspec.type !== 'drill-cs') throw new Error('unreachable');
    expect(tspec.files.tail).toContain('record Box(int W)');
    const graded = composeGraded(c2.content[t.unit.key]!.solution!, tspec.files.tests + tspec.files.tail);
    expect(graded).toContain('public int Twice => W * 2;');
    expect(graded.indexOf('return Report();')).toBeLessThan(graded.indexOf('record Box'));
  });

  it('the imported pack loads through the server loader (unstamped test opt-out) with loaded counts', () => {
    const out = join(dir, 'pack');
    importCsbootcamp({ sourceDir: baseSource(), outDir: out, expected: null, gitHead: null });
    const pack = readPack(out, { allowUnstamped: true });
    expect(pack.courses.flatMap((c) => c.units.map((u) => u.unit.key))).toEqual([stableKey('01-language-core', '01-count-vowels'), stableKey('05-types', '02-box')]);
  });

  it('is deterministic: same source -> same bytes', () => {
    const root = baseSource();
    importCsbootcamp({ sourceDir: root, outDir: join(dir, 'a'), expected: null, gitHead: null });
    importCsbootcamp({ sourceDir: root, outDir: join(dir, 'b'), expected: null, gitHead: null });
    for (const f of ['manifest.json', '01-language-core.json', '05-types.json']) {
      expect(readFileSync(join(dir, 'b', f), 'utf8').replace(/"path": "[^"]*"/, '')).toBe(readFileSync(join(dir, 'a', f), 'utf8').replace(/"path": "[^"]*"/, ''));
    }
  });

  it('refuses (writing nothing) on a census divergence', () => {
    const out = join(dir, 'pack');
    expect(() => importCsbootcamp({ sourceDir: baseSource(), outDir: out, expected: CSBOOTCAMP_EXPECTED, gitHead: null })).toThrow(/differ from the expected/);
    expect(() => readFileSync(join(out, 'manifest.json'))).toThrow();
  });

  it('refuses a solution whose tests differ from the exercise (never graded against its own copy)', () => {
    const root = baseSource({ '01-language-core/solutions/01-count-vowels.cs': SOL.replace('Test("is case-insensitive"', 'Test("is case insensitive"') });
    expect(() => importCsbootcamp({ sourceDir: root, outDir: join(dir, 'p'), expected: null, gitHead: null })).toThrow(/byte-for-byte/);
  });

  it('refuses directives the warm runner cannot honour', () => {
    const root = baseSource({ '05-types/exercises/02-box.cs': TYPES_EX.replace('#:project ../../_lib/Check/Check.csproj', '#:package Humanizer@2.14.1') });
    expect(() => importCsbootcamp({ sourceDir: root, outDir: join(dir, 'p'), expected: null, gitHead: null })).toThrow(/unsupported file-based-app directive/);
  });

  it('refuses hunt modules (inverted contract not supported yet) and unpaired files', () => {
    const hunt = baseSource({ '24-debug-hunts/exercises/01-x.cs': EX, '24-debug-hunts/solutions/01-x.cs': SOL });
    expect(() => importCsbootcamp({ sourceDir: hunt, outDir: join(dir, 'p'), expected: null, gitHead: null })).toThrow(ImportError);
    rmSync(join(dir, 'src'), { recursive: true, force: true });
    const unpaired = baseSource({ '05-types/exercises/03-orphan.cs': TYPES_EX });
    expect(() => readModules(unpaired)).toThrow(/do not pair up/);
  });

  it('refuses when upstream Check.cs differs from the harness the runner compiles', () => {
    const root = baseSource({ '_lib/Check/Check.cs': '// different\n' });
    expect(() => importCsbootcamp({ sourceDir: root, outDir: join(dir, 'p'), expected: null, gitHead: null, checkHarness: RUNNER_CHECK_HARNESS })).toThrow(/differs from the harness/);
  });

  it('mapExercise rejects a header number that does not match the file name', () => {
    expect(() => mapExercise({ module: '01-language-core', slug: '07-count-vowels', exercise: EX.replace(/\r\n/g, '\n'), solution: SOL.replace(/\r\n/g, '\n') }, 0)).toThrow(/does not match the file name/);
  });

  it('manifest totals are what the manifest schema accepts', () => {
    const out = join(dir, 'pack');
    importCsbootcamp({ sourceDir: baseSource(), outDir: out, expected: null, gitHead: null });
    expect(PackManifest.parse(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).totals).toEqual({ total: 2, code: 2, quiz: 0, output: 0, written: 0 });
  });
});
