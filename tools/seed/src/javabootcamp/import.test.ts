import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackCourseFile, PackManifest } from '@bootquest/shared';
import { readPack } from '@bootquest/server/packs';
import { composeGraded } from '@bootquest/server/runners/java/split';
import { ImportError, importJavabootcamp, mapExercise, RUNNER_HARNESS_DIR, stableKey } from './import.ts';
import { HARNESS_FILES, readModules } from './source.ts';

// Real upstream bytes: the Java runner's fixture (byte-identical javabootcamp copies, see its SOURCE.txt).
const FX = RUNNER_HARNESS_DIR;
const EX = readFileSync(join(FX, '01-language-core', 'exercises', '01-count-vowels.java'), 'utf8');
const SOL = readFileSync(join(FX, '01-language-core', 'solutions', '01-count-vowels.java'), 'utf8');

/** A second, synthetic module in the same grammar (a record + a two-star tier). */
const BOX_EX = `// ─────────────────────────────────────────────────────────────────────────
//  02 · a box that doubles                                       ★★☆ core
//  concepts: records · methods
//  run: java -cp ../../_lib/out 02-box.java
// ─────────────────────────────────────────────────────────────────────────
//
//  Finish Box.twice:
//
//      new Box(2).twice()   → 4

import static bootcamp.Check.*;

class Exercise {
    record Box(int w) {
        int twice() { throw new UnsupportedOperationException("TODO"); }
    }

    // ─── tests ───────────────────────────────────────────────────────────
    public static void main(String[] args) {
        test("doubles", () -> eq(new Box(2).twice(), 4));
        test("doubles zero", () -> eq(new Box(0).twice(), 0));
        System.exit(report());
    }
    // ─── end tests ───────────────────────────────────────────────────────
}
`;
const BOX_SOL = BOX_EX.replace('//  02 · a box that doubles      ', '//  02 · a box — SOLUTION         ')
  .replace('//  Finish Box.twice:', '//  Walkthrough:\n//  twice is one expression.')
  .replace('throw new UnsupportedOperationException("TODO");', 'return w * 2;');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bq-javabootcamp-'));
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
    ...Object.fromEntries(HARNESS_FILES.map((f) => [f, readFileSync(join(RUNNER_HARNESS_DIR, f), 'utf8')])),
    '01-language-core/README.md': '# 01 · Language Core\n\nJava has a small centre.\nThis module is it.\n\n## The mental model\n',
    '01-language-core/exercises/01-count-vowels.java': EX,
    '01-language-core/solutions/01-count-vowels.java': SOL,
    '02-records/README.md': '# 02 · Records\n\nRecords.\n',
    '02-records/exercises/02-box.java': BOX_EX,
    '02-records/solutions/02-box.java': BOX_SOL,
    ...extra,
  });

const run = (root: string, extra: Partial<Parameters<typeof importJavabootcamp>[0]> = {}) =>
  importJavabootcamp({ sourceDir: root, outDir: join(dir, 'pack'), expected: null, gitHead: null, ...extra });

describe('seed:import:javabootcamp mapping', () => {
  it('maps every exercise to a drill-java unit (java track) with the tests / end-tests split', () => {
    const out = join(dir, 'pack');
    const { manifest } = run(baseSource(), { gitHead: 'a'.repeat(40), harnessDir: RUNNER_HARNESS_DIR });
    expect(manifest.track).toBe('java');
    expect(manifest.courses.map((c) => [c.id, c.order, c.counts.code])).toEqual([
      ['01-language-core', 1, 1],
      ['02-records', 2, 1],
    ]);
    expect(manifest.importedFrom).toMatchObject({ repo: 'elirc/javabootcamp', originKind: 'github', subpath: 'bootcamp', gitHead: 'a'.repeat(40), dirty: false });

    const c1 = PackCourseFile.parse(JSON.parse(readFileSync(join(out, '01-language-core.json'), 'utf8')));
    expect(c1.course).toMatchObject({ id: '01-language-core', title: 'Language Core', description: 'Java has a small centre. This module is it.' });
    const u = c1.units[0]!;
    expect(u.unit).toMatchObject({ key: 'javabootcamp/01-language-core/01-count-vowels', track: 'java', kind: 'drill', title: 'Count the vowels', difficulty: 1, competencies: ['language-fluency'] });
    expect(u.origin).toMatchObject({ id: '01-language-core/01-count-vowels', type: 'code', module: '01-language-core', position: 0 });
    const spec = u.unit.checks[0]!.spec;
    if (spec.type !== 'drill-java') throw new Error(`want drill-java, got ${spec.type}`);
    expect(spec.className).toBe('Exercise');
    expect(spec.timeoutMs).toBe(10_000);
    expect(spec.files.tests.trimStart().startsWith('// ─── tests ─')).toBe(true);
    expect(spec.files.tests.trimEnd()).toMatch(/\/\/ ─── end tests ─+$/);
    expect(spec.files.tail).toBe('}\n');
    const content = c1.content[u.unit.key]!;
    expect(content.starter).toBe(EX.replace(/\r\n/g, '\n'));
    expect(content.solution).toBe(SOL.replace(/\r\n/g, '\n'));
    expect(content.instructions).toMatch(/^\*\*Concepts:\*\* strings · loops · char/);
    expect(content.instructions).not.toMatch(/^\/\//m);
    expect(content.explanation).not.toMatch(/^Walkthrough:/);
    expect(content.explanation).toMatch(/\S/);
    // the graded program for the shipped starter = starter head + EXERCISE tests + starter tail
    expect(composeGraded(content.starter!, spec.files.tests + spec.files.tail)).toBe(EX.replace(/\r\n/g, '\n'));

    const c2 = PackCourseFile.parse(JSON.parse(readFileSync(join(out, '02-records.json'), 'utf8')));
    expect(c2.units[0]!.unit.difficulty).toBe(2);
    expect(c2.units[0]!.unit.title).toBe('A box that doubles');
  });

  it('the imported pack loads through the server loader (unstamped test opt-out); grader kind java', () => {
    const out = join(dir, 'pack');
    run(baseSource());
    const pack = readPack(out, { allowUnstamped: true });
    expect(pack.courses.flatMap((c) => c.units.map((u) => u.unit.key))).toEqual([stableKey('01-language-core', '01-count-vowels'), stableKey('02-records', '02-box')]);
  });

  it('is deterministic: same source -> same bytes', () => {
    const root = baseSource();
    importJavabootcamp({ sourceDir: root, outDir: join(dir, 'a'), expected: null, gitHead: null });
    importJavabootcamp({ sourceDir: root, outDir: join(dir, 'b'), expected: null, gitHead: null });
    for (const f of ['manifest.json', '01-language-core.json', '02-records.json']) {
      expect(readFileSync(join(dir, 'b', f), 'utf8')).toBe(readFileSync(join(dir, 'a', f), 'utf8'));
    }
  });

  it('local dev mode records originKind local + dirtiness', () => {
    const { manifest } = run(baseSource(), { originKind: 'local', gitHead: 'b'.repeat(40), dirty: true });
    expect(manifest.importedFrom).toMatchObject({ originKind: 'local', gitHead: 'b'.repeat(40), dirty: true });
  });

  it('refuses (writing nothing) on a census divergence', () => {
    const out = join(dir, 'pack');
    expect(() => run(baseSource(), { expected: { total: 3, code: 3, quiz: 0, output: 0, written: 0 } })).toThrow(/differ from the expected/);
    expect(() => readFileSync(join(out, 'manifest.json'))).toThrow();
  });

  it('refuses a solution whose tests differ from the exercise (never graded against its own copy)', () => {
    const root = baseSource({ '01-language-core/solutions/01-count-vowels.java': SOL.replace('test("is case-insensitive"', 'test("is case insensitive"') });
    expect(() => run(root)).toThrow(/byte-for-byte/);
  });

  it('refuses a bad header, a missing end-tests marker, a package, a missing Walkthrough', () => {
    expect(() => run(baseSource({ '02-records/exercises/02-box.java': BOX_EX.replace('★★☆ core', 'core') }))).toThrow(ImportError);
    rmSync(join(dir, 'src'), { recursive: true, force: true });
    const noEnd = (s: string) => s.replace(/\/\/ ─── end tests ─+/, '// end');
    expect(() => run(baseSource({ '02-records/exercises/02-box.java': noEnd(BOX_EX), '02-records/solutions/02-box.java': noEnd(BOX_SOL) }))).toThrow(/end tests/);
    rmSync(join(dir, 'src'), { recursive: true, force: true });
    const pkg = (s: string) => s.replace('import static bootcamp.Check.*;', 'package box;\nimport static bootcamp.Check.*;');
    expect(() => run(baseSource({ '02-records/exercises/02-box.java': pkg(BOX_EX), '02-records/solutions/02-box.java': pkg(BOX_SOL) }))).toThrow(/declares a package/);
    rmSync(join(dir, 'src'), { recursive: true, force: true });
    expect(() => run(baseSource({ '02-records/solutions/02-box.java': BOX_SOL.replace('//  Walkthrough:', '//  Notes:') }))).toThrow(/Walkthrough/);
  });

  it('refuses unpaired files', () => {
    const unpaired = baseSource({ '02-records/exercises/03-orphan.java': BOX_EX });
    expect(() => readModules(unpaired)).toThrow(/do not pair up/);
  });

  it('refuses when an upstream harness file differs from (or is missing next to) the runner copy', () => {
    const root = baseSource({ '_lib/check/bootcamp/BqMain.java': '// different\n' });
    expect(() => run(root, { harnessDir: RUNNER_HARNESS_DIR })).toThrow(/BqMain\.java differs from the harness/);
    rmSync(join(root, 'bootcamp', '_lib', 'check', 'bootcamp', 'Check.java'));
    expect(() => run(root, { harnessDir: RUNNER_HARNESS_DIR })).toThrow(/Check\.java is missing/);
  });

  it('mapExercise rejects a header number that does not match the file name', () => {
    expect(() => mapExercise({ module: '01-language-core', slug: '07-count-vowels', exercise: EX.replace(/\r\n/g, '\n'), solution: SOL.replace(/\r\n/g, '\n') }, 0)).toThrow(/does not match the file name/);
  });

  it('manifest totals are what the manifest schema accepts', () => {
    const out = join(dir, 'pack');
    run(baseSource());
    expect(PackManifest.parse(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).totals).toEqual({ total: 2, code: 2, quiz: 0, output: 0, written: 0 });
  });
});
