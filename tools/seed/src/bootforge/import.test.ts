import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackCourseFile, PackManifest } from '@bootquest/shared';
import { drillJsRunner } from '@bootquest/server/runners';
import { bfCourse, codeEx, outputEx, quizEx, sqlEx, writeBfSource, writtenEx } from './fixtures.ts';
import { BOOTFORGE_EXPECTED, DEFAULT_OUT_DIR, ImportError, importBootforge, mapExercise, parseCourse, stableKey } from './import.ts';
import { parseExercise } from './source.ts';

const ctx = (index: Map<string, 'code' | 'quiz' | 'output' | 'written'> = new Map()) => ({ course: 'js-fundamentals', module: 'm1', lesson: 'l1', position: 0, index });

describe('BootForge → BootQuest mapping (per exercise type)', () => {
  it('code → drill unit + drill-js check (tests incl. input); starter public, solution private in content', async () => {
    const ex = parseExercise(codeEx('js-fundamentals/m1/l1/add'));
    const { packUnit, content } = await mapExercise(ex, ctx());
    expect(packUnit.unit).toMatchObject({
      key: 'bootforge/js-fundamentals/m1/l1/add',
      track: 'js',
      kind: 'drill',
      title: 'add',
      difficulty: 2,
      xp: 20,
      prerequisites: [],
    });
    expect(packUnit.unit.checks).toEqual([
      {
        spec: {
          type: 'drill-js',
          language: 'js',
          timeoutMs: 8000,
          tests: [
            { name: 'add(2, 3) → 5', input: [2, 3], code: 'assert.equal(mod.add(2, 3), 5);' },
            { name: 'add(-1, 1) → 0', input: [-1, 1], code: 'assert.equal(mod.add(-1, 1), 0);' },
          ],
        },
      },
    ]);
    expect(content).toEqual({
      instructions: 'Export a function `add(a, b)` returning the sum.',
      explanation: 'Addition is the + operator.',
      hints: ['Use +.'],
      starter: 'export function add(a, b) {\n  // your code here\n}\n',
      solution: 'export function add(a, b) {\n  return a + b;\n}',
    });
    expect(packUnit.origin).toEqual({ id: 'js-fundamentals/m1/l1/add', type: 'code', module: 'm1', lesson: 'l1', position: 0, xp: 20, skills: ['c1/m1'] });
  });

  it('quiz → single-keyed choice check (answer key in the private spec); prompt is the public instructions', async () => {
    const { packUnit, content } = await mapExercise(parseExercise(quizEx('js-fundamentals/m1/l1/q')), ctx());
    expect(packUnit.unit.kind).toBe('quiz');
    expect(packUnit.unit.checks[0]!.spec).toEqual({
      type: 'quiz',
      itemKey: 'bootforge/js-fundamentals/m1/l1/q',
      grading: 'choice',
      answerKey: 1,
      choices: ['"null"', '"object"', '"undefined"'],
    });
    expect(content.instructions).toBe('What does `typeof null` return?');
    expect(content.solution).toBeUndefined();
  });

  it('output → predict-output with inferred language (JS vs TS) and the snippet as public content', async () => {
    const js = await mapExercise(parseExercise(outputEx('js-fundamentals/m1/l1/o1', 'console.log(1 + 1);', '2')), ctx());
    expect(js.packUnit.unit.kind).toBe('predict-output');
    expect(js.packUnit.unit.checks[0]!.spec).toEqual({ type: 'predict-output', language: 'js', expected: '2', normalize: true });
    expect(js.content.snippet).toBe('console.log(1 + 1);');
    const ts = await mapExercise(parseExercise(outputEx('js-fundamentals/m1/l1/o2', 'const n: number = 2;\nconsole.log(n * 2);', '4')), ctx());
    expect(ts.packUnit.unit.checks[0]!.spec).toMatchObject({ language: 'ts' });
  });

  it('written → written unit with NO check; model answer private, rubric public', async () => {
    const { packUnit, content } = await mapExercise(parseExercise(writtenEx('js-fundamentals/m1/l1/w')), ctx());
    expect(packUnit.unit.kind).toBe('written');
    expect(packUnit.unit.checks).toEqual([]);
    expect(packUnit.unit.competencies).toEqual(['code-reading', 'communication']); // format pr-review
    expect(content.solution).toBe('The check-then-act race ...');
    expect(content.rubric).toHaveLength(2);
    expect(packUnit.origin.format).toBe('pr-review');
  });

  it('BootForge "SQL" code exercises map to drill-js js and are graded by the JS runner against node:sqlite', async () => {
    const { packUnit, content } = await mapExercise(parseExercise(sqlEx('js-fundamentals/m1/l1/sql')), ctx());
    const spec = packUnit.unit.checks[0]!.spec;
    expect(spec).toMatchObject({ type: 'drill-js', language: 'js' });
    const ok = await drillJsRunner(spec, { code: content.solution! });
    expect(ok.pass).toBe(true);
    const bad = await drillJsRunner(spec, { code: "export const query = 'SELECT name FROM users ORDER BY id DESC';" });
    expect(bad.pass).toBe(false);
    // language 'sql' (no longer a 501) grades the same JS module
    const asSql = await drillJsRunner({ ...spec, language: 'sql' } as typeof spec, { code: content.solution! });
    expect(asSql.pass).toBe(true);
  }, 30000);

  it('reviewOf maps to variationOf (a review hint), NEVER a prerequisite lock; a dangling reviewOf is refused', async () => {
    const index = new Map<string, 'code' | 'written'>([
      ['js-fundamentals/m1/l1/orig', 'code'],
      ['js-fundamentals/m1/l1/w-orig', 'written'],
    ]);
    const review = await mapExercise(parseExercise(codeEx('js-fundamentals/m1/l1/alt', { reviewOf: 'js-fundamentals/m1/l1/orig' })), ctx(index));
    expect(review.packUnit.unit.prerequisites).toEqual([]);
    expect(review.packUnit.unit.variationOf).toBe('bootforge/js-fundamentals/m1/l1/orig');
    expect(review.packUnit.origin.reviewOf).toBe('js-fundamentals/m1/l1/orig');
    const wReview = await mapExercise(parseExercise(writtenEx('js-fundamentals/m1/l1/w-alt', { reviewOf: 'js-fundamentals/m1/l1/w-orig' })), ctx(index));
    expect(wReview.packUnit.unit.prerequisites).toEqual([]);
    expect(wReview.packUnit.unit.variationOf).toBe('bootforge/js-fundamentals/m1/l1/w-orig');
    expect(wReview.packUnit.origin.reviewOf).toBe('js-fundamentals/m1/l1/w-orig');
    const plain = await mapExercise(parseExercise(codeEx('js-fundamentals/m1/l1/plain')), ctx(index));
    expect(plain.packUnit.unit.variationOf).toBeUndefined();
    await expect(mapExercise(parseExercise(codeEx('js-fundamentals/m1/l1/x', { reviewOf: 'js-fundamentals/m1/l1/nope' })), ctx(index))).rejects.toThrow(ImportError);
  });

  it('strict source schema: an unknown upstream field or type is an import error, not silently dropped', () => {
    expect(() => parseExercise(codeEx('js-fundamentals/m1/l1/a', { mystery: 1 }))).toThrow(/mystery/);
    expect(() => parseExercise({ ...quizEx('js-fundamentals/m1/l1/q'), answerIndex: 9 })).toThrow(/answerIndex/);
    expect(() => parseExercise({ ...quizEx('js-fundamentals/m1/l1/q'), options: ['a', 'a'] })).toThrow(/single-keyed/);
    expect(() => parseExercise({ type: 'essay' })).toThrow(/unknown BootForge exercise type/);
    expect(() => parseCourse(bfCourse('js-fundamentals', 1, [codeEx('other/m1/l1/a')]), 'js-fundamentals.json')).toThrow(/must start with js-fundamentals\/m1\/l1\//);
  });

  it('stable keys are bootforge/<course>/<module>/<lesson>/<slug>', () => {
    expect(stableKey('js-fundamentals/control-flow/switch-and-ternary/yes-no')).toBe('bootforge/js-fundamentals/control-flow/switch-and-ternary/yes-no');
  });
});

describe('importBootforge (files)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bq-import-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const courses = () => [
    bfCourse('node-core', 2, [writtenEx('node-core/m1/l1/w'), codeEx('node-core/m1/l1/b', { reviewOf: 'js-fundamentals/m1/l1/a' })]),
    bfCourse('js-fundamentals', 1, [codeEx('js-fundamentals/m1/l1/a'), quizEx('js-fundamentals/m1/l1/q'), outputEx('js-fundamentals/m1/l1/o', 'console.log("hi")', 'hi')]),
  ];

  it('writes course files in course order + a manifest whose counts/sha256 match; output is byte-deterministic', async () => {
    writeBfSource(join(dir, 'src'), courses());
    const out = join(dir, 'out');
    const r = await importBootforge({ sourceDir: join(dir, 'src'), outDir: out, expected: { total: 5, code: 2, quiz: 1, output: 1, written: 1 } });
    expect(r.manifest.courses.map((c) => c.id)).toEqual(['js-fundamentals', 'node-core']);
    expect(r.manifest.totals).toEqual({ total: 5, code: 2, quiz: 1, output: 1, written: 1 });
    for (const c of r.manifest.courses) {
      const bytes = readFileSync(join(out, c.file));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(c.sha256);
      expect(PackCourseFile.parse(JSON.parse(bytes.toString('utf8'))).course.id).toBe(c.id);
    }
    // cross-course reviewOf resolved (node-core → js-fundamentals)
    const c2 = PackCourseFile.parse(JSON.parse(readFileSync(join(out, 'node-core.json'), 'utf8')));
    const b = c2.units.find((u) => u.origin.id === 'node-core/m1/l1/b')!.unit;
    expect(b.variationOf).toBe('bootforge/js-fundamentals/m1/l1/a');
    expect(b.prerequisites).toEqual([]);

    const snapshot = readdirSync(out).map((f) => [f, readFileSync(join(out, f), 'utf8')]);
    await importBootforge({ sourceDir: join(dir, 'src'), outDir: out, expected: null });
    expect(readdirSync(out).map((f) => [f, readFileSync(join(out, f), 'utf8')])).toEqual(
      snapshot.map(([f, s]) => (f === 'manifest.json' ? [f, s!.replace(/"expected": \{[^}]*\}/, '"expected": null')] : [f, s])),
    );
  });

  it('refuses (writing nothing) when the source counts differ from the expected census', async () => {
    writeBfSource(join(dir, 'src'), courses());
    const out = join(dir, 'out');
    await expect(
      importBootforge({ sourceDir: join(dir, 'src'), outDir: out, expected: { total: 6, code: 3, quiz: 1, output: 1, written: 1 } }),
    ).rejects.toThrow(/differ from the expected/);
    expect(existsSync(out)).toBe(false);
  });

  it('removes a stale course file that no longer exists upstream', async () => {
    writeBfSource(join(dir, 'src'), courses());
    const out = join(dir, 'out');
    await importBootforge({ sourceDir: join(dir, 'src'), outDir: out, expected: null });
    writeFileSync(join(out, 'gone.json'), '{}');
    const r = await importBootforge({ sourceDir: join(dir, 'src'), outDir: out, expected: null });
    expect(r.removed).toEqual(['gone.json']);
  });
});

describe('committed BootForge pack (content/packs/bootforge)', () => {
  it('manifest totals equal the R1 census and every course file matches its manifest sha256 + counts', () => {
    const manifest = PackManifest.parse(JSON.parse(readFileSync(join(DEFAULT_OUT_DIR, 'manifest.json'), 'utf8')));
    expect(manifest.totals).toEqual(BOOTFORGE_EXPECTED);
    expect(manifest.expected).toEqual(BOOTFORGE_EXPECTED);
    expect(manifest.courses).toHaveLength(16);
    for (const c of manifest.courses) {
      const bytes = readFileSync(join(DEFAULT_OUT_DIR, c.file));
      expect(createHash('sha256').update(bytes).digest('hex'), c.file).toBe(c.sha256);
    }
  });
});
