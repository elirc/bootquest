import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackCourseFile, PackManifest } from '@bootquest/shared';
import { readPack } from '@bootquest/server/packs';
import { composeGraded } from '@bootquest/server/runners/java/split';
import { DEFAULT_AUTHORING_DIR, DEFAULT_OUT_DIR, ImportError, importJavadrills, JAVADRILLS_EXPECTED, mapExercise, stableKey } from './import.ts';
import { JAVADRILLS_FORMAT, readModules, type JavadrillsExercise } from './source.ts';

/** A tiny valid single-file Exercise.java in the javabootcamp grammar (shrunk from the wave exemplar). */
const STARTER = `// ─────────────────────────────────────────────────────────────────────────
//  01 · double it                                                    ★☆☆
// ─────────────────────────────────────────────────────────────────────────

import static bootcamp.Check.*;

class Exercise {

    static int twice(int n) {
        throw new UnsupportedOperationException("TODO: multiply by two");
    }

    // ─── tests ───────────────────────────────────────────────────────────
    public static void main(String[] args) {
        test("twice(2) is 4", () -> eq(twice(2), 4));
        test("twice(0) is 0 (boundary)", () -> eq(twice(0), 0));
        test("twice(1) is 2", () -> eq(twice(1), 2));
        test("twice(-3) is -6", () -> eq(twice(-3), -6));
        System.exit(report());
    }
    // ─── end tests ───────────────────────────────────────────────────────
}
`;
const SOLUTION = STARTER.replace('throw new UnsupportedOperationException("TODO: multiply by two");', 'return n * 2;');

const exercise = (over: Partial<JavadrillsExercise> = {}): JavadrillsExercise => ({
  slug: '01-double-it',
  title: 'Double it',
  difficulty: 1,
  skills: ['arithmetic'],
  instructions: 'Implement `twice(int n)` returning n × 2.',
  starter: STARTER,
  solution: SOLUTION,
  explanation: '2 × 2 = 4.',
  hints: ['Multiply.', 'The * operator.', 'times two'],
  ...over,
});

const moduleFile = (module: string, exercises: JavadrillsExercise[]) => ({
  format: JAVADRILLS_FORMAT,
  module,
  title: `Module ${module}`,
  description: `About ${module}.`,
  exercises,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bq-javadrills-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

/** write authoring files into <dir>/src; returns the authoring dir */
function writeAuthoring(files: Record<string, unknown>): string {
  const root = join(dir, 'src');
  mkdirSync(root, { recursive: true });
  for (const [name, doc] of Object.entries(files)) writeFileSync(join(root, name), typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2));
  return root;
}

const TRIPLE_STARTER = STARTER.replace(/twice/g, 'thrice').replace('multiply by two', 'multiply by three').replace('eq(thrice(2), 4)', 'eq(thrice(2), 6)').replace('thrice(2) is 4', 'thrice(2) is 6')
  .replace('eq(thrice(1), 2)', 'eq(thrice(1), 3)').replace('thrice(1) is 2', 'thrice(1) is 3').replace('eq(thrice(-3), -6)', 'eq(thrice(-3), -9)').replace('thrice(-3) is -6', 'thrice(-3) is -9');
const TRIPLE_SOLUTION = TRIPLE_STARTER.replace('throw new UnsupportedOperationException("TODO: multiply by three");', 'return n * 3;');

const twoExercises = () =>
  writeAuthoring({
    '01-alpha.json': moduleFile('01-alpha', [
      exercise(),
      exercise({ slug: '02-triple-it', title: 'Triple it', difficulty: 3, skills: [], starter: TRIPLE_STARTER, solution: TRIPLE_SOLUTION }),
    ]),
  });

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const refuse = (exercises: JavadrillsExercise[], re: RegExp) => {
  const root = writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', exercises) });
  const out = join(dir, 'pack');
  expect(() => importJavadrills({ authoringDir: root, outDir: out, expected: null })).toThrow(ImportError);
  expect(() => importJavadrills({ authoringDir: root, outDir: out, expected: null })).toThrow(re);
  expect(existsSync(out)).toBe(false); // refused before anything is written
};
const clean = () => rmSync(join(dir, 'src'), { recursive: true });

describe('seed:import:javadrills happy path', () => {
  it('imports a 2-exercise module; the pack round-trips through the server loader with correct counts', () => {
    const out = join(dir, 'pack');
    const { manifest, written } = importJavadrills({ authoringDir: twoExercises(), outDir: out, expected: null });
    expect(written).toEqual(['01-alpha.json', 'manifest.json']);
    expect(manifest.courses.map((c) => [c.id, c.order, c.counts])).toEqual([['01-alpha', 1, { total: 2, code: 2, quiz: 0, output: 0, written: 0 }]]);
    expect(manifest.totals).toEqual({ total: 2, code: 2, quiz: 0, output: 0, written: 0 });
    const pack = readPack(out, { allowUnstamped: true });
    expect(pack.courses.flatMap((c) => c.units.map((u) => u.unit.key))).toEqual([stableKey('01-alpha', '01-double-it'), stableKey('01-alpha', '02-triple-it')]);
  });

  it('is deterministic: importing twice gives identical bytes (sha256)', () => {
    const root = twoExercises();
    importJavadrills({ authoringDir: root, outDir: join(dir, 'a'), expected: null });
    importJavadrills({ authoringDir: root, outDir: join(dir, 'b'), expected: null });
    for (const f of ['manifest.json', '01-alpha.json']) expect(sha(join(dir, 'b', f))).toBe(sha(join(dir, 'a', f)));
  });

  it('keeps validation.json / quarantine.json and removes stale course files on re-import', () => {
    const root = twoExercises();
    const out = join(dir, 'pack');
    mkdirSync(out);
    for (const f of ['validation.json', 'quarantine.json', '09-gone.json']) writeFileSync(join(out, f), '{}');
    const { removed } = importJavadrills({ authoringDir: root, outDir: out, expected: null });
    expect(removed).toEqual(['09-gone.json']);
    expect(readdirSync(out).sort()).toEqual(['01-alpha.json', 'manifest.json', 'quarantine.json', 'validation.json']);
  });
});

describe('unit key prefix + check spec shape', () => {
  it('every unit is a java drill keyed javadrills/<course>/<slug> with a drill-java {tests, tail} spec', () => {
    const out = join(dir, 'pack');
    importJavadrills({ authoringDir: twoExercises(), outDir: out, expected: null });
    const c = PackCourseFile.parse(JSON.parse(readFileSync(join(out, '01-alpha.json'), 'utf8')));
    expect(c.course).toMatchObject({ id: '01-alpha', order: 1, title: 'Module 01-alpha', description: 'About 01-alpha.', prerequisites: [] });
    expect(c.modules).toEqual([{ id: '01-alpha', title: 'Module 01-alpha', lessons: [{ id: 'drills', title: 'Module 01-alpha', explanation: 'About 01-alpha.' }] }]);
    for (const u of c.units) {
      expect(u.unit.key.startsWith(`javadrills/${c.course.id}/`)).toBe(true);
      expect(u.unit).toMatchObject({ track: 'java', kind: 'drill', phase: '01-alpha', competencies: ['language-fluency'], prerequisites: [] });
      const spec = u.unit.checks[0]!.spec;
      expect(spec.type).toBe('drill-java');
      if (spec.type !== 'drill-java') throw new Error('unreachable');
      expect(spec.className).toBe('Exercise');
      expect(spec.timeoutMs).toBe(10000);
      expect(spec.files.tests.startsWith('    // ─── tests ───')).toBe(true);
      expect(spec.files.tests.trimEnd().endsWith('// ─── end tests ───────────────────────────────────────────────────────')).toBe(true);
      expect(spec.files.tail).toBe('}\n');
    }
    const [u1, u2] = c.units;
    expect(u1!.unit.difficulty).toBe(1);
    expect(u2!.unit.difficulty).toBe(3);
    expect(u1!.origin).toEqual({ id: '01-alpha/01-double-it', type: 'code', module: '01-alpha', lesson: 'drills', position: 0, skills: ['arithmetic'] });
    const content = c.content[u1!.unit.key]!;
    expect(content.starter).toBe(STARTER);
    expect(content.solution).toBe(SOLUTION);
    expect(content.instructions).toMatch(/^\*\*Skills:\*\* arithmetic {2}\n\*\*Level:\*\* ★☆☆\n\nImplement `twice\(int n\)`/);
    expect(content.hints).toEqual(['Multiply.', 'The * operator.', 'times two']);
    expect(c.content[u2!.unit.key]!.instructions).toMatch(/^\*\*Level:\*\* ★★★\n\n/);
    // the graded program for the solution = solution head + the STARTER's tests + solution tail
    const spec = u1!.unit.checks[0]!.spec;
    if (spec.type !== 'drill-java') throw new Error('unreachable');
    expect(composeGraded(SOLUTION, STARTER)).toBe(SOLUTION);
    expect(SOLUTION.includes(spec.files.tests)).toBe(true);
  });
});

describe('manifest', () => {
  it('declares track java with NO grader field (derived kind java), the local authoring origin and the census', () => {
    const out = join(dir, 'pack');
    importJavadrills({ authoringDir: twoExercises(), outDir: out, expected: { total: 2, code: 2, quiz: 0, output: 0, written: 0 } });
    const raw = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect('grader' in raw).toBe(false);
    const m = PackManifest.parse(raw);
    expect(m.source).toBe('javadrills');
    expect(m.track).toBe('java');
    expect(m.grader).toBeUndefined();
    expect(m.importedFrom).toMatchObject({ repo: 'elirc/selfboot', originKind: 'local', subpath: 'tools/seed/authoring/javadrills', gitHead: null, dirty: null });
    expect(m.importedFrom.path).not.toContain('\\');
    expect(m.expected).toEqual({ total: 2, code: 2, quiz: 0, output: 0, written: 0 });
  });

  it('JAVADRILLS_EXPECTED pins the committed census (80 drill-java units)', () => {
    expect(JAVADRILLS_EXPECTED).toEqual({ total: 80, code: 80, quiz: 0, output: 0, written: 0 });
  });
});

describe('import-time refusals (write nothing)', () => {
  it('refuses a census divergence', () => {
    const out = join(dir, 'pack');
    expect(() => importJavadrills({ authoringDir: twoExercises(), outDir: out, expected: JAVADRILLS_EXPECTED })).toThrow(/differ from the expected/);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses an empty or missing authoring dir', () => {
    const root = writeAuthoring({});
    expect(() => readModules(root)).toThrow(/no authoring JSON/);
    expect(() => readModules(join(dir, 'nope'))).toThrow(/does not exist/);
  });

  it('refuses non-JSON, schema violations (strict: unknown keys, a tests array) and a wrong format tag', () => {
    expect(() => readModules(writeAuthoring({ '01-alpha.json': '{ not json' }))).toThrow(/not JSON/);
    clean();
    expect(() => readModules(writeAuthoring({ '01-alpha.json': { ...moduleFile('01-alpha', [exercise()]), extra: 1 } }))).toThrow(ImportError);
    clean();
    expect(() => readModules(writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', [{ ...exercise(), tests: [] } as JavadrillsExercise]) }))).toThrow(/Unrecognized key/);
    clean();
    expect(() => readModules(writeAuthoring({ '01-alpha.json': { ...moduleFile('01-alpha', [exercise()]), format: 'other@1' } }))).toThrow(/not a javadrills-authoring@1 module/);
  });

  it('refuses anything but exactly 3 hints (schema and mapper)', () => {
    for (const hints of [[], ['a', 'b'], ['a', 'b', 'c', 'd']]) {
      expect(() => readModules(writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', [exercise({ hints })]) }))).toThrow(/hints/);
      clean();
      expect(() => mapExercise('01-alpha', exercise({ hints }), 0)).toThrow(/exactly 3 hints/);
    }
    const { hints: _drop, ...noHints } = exercise();
    expect(() => readModules(writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', [noHints as JavadrillsExercise]) }))).toThrow(/hints/);
  });

  it('refuses module ids outside NN-kebab, a file named differently, and duplicate module orders', () => {
    expect(() => readModules(writeAuthoring({ 'Alpha.json': moduleFile('Alpha', [exercise()]) }))).toThrow(/must match/);
    clean();
    expect(() => readModules(writeAuthoring({ '01-beta.json': moduleFile('01-alpha', [exercise()]) }))).toThrow(/file must be named 01-alpha.json/);
    clean();
    expect(() => readModules(writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', [exercise()]), '01-beta.json': moduleFile('01-beta', [exercise()]) }))).toThrow(/duplicate module order 1/);
  });

  it('refuses a duplicate slug and a slug outside NN-kebab', () => {
    refuse([exercise(), exercise()], /duplicate exercise slug 01-double-it/);
    clean();
    refuse([exercise({ slug: 'double_it' })], /slug must match/);
  });

  it('refuses empty instructions, starter and solution', () => {
    const cases: [Partial<JavadrillsExercise>, RegExp][] = [
      [{ instructions: '  \n' }, /empty instructions/],
      [{ starter: '' }, /empty starter/],
      [{ solution: '\n' }, /empty solution/],
    ];
    for (const [over, re] of cases) {
      refuse([exercise(over)], re);
      clean();
    }
  });

  it('refuses solution === starter and a starter without TODO', () => {
    refuse([exercise({ starter: SOLUTION, solution: SOLUTION })], /identical to the starter/);
    clean();
    const noTodo = STARTER.replace('throw new UnsupportedOperationException("TODO: multiply by two");', 'return 0;');
    refuse([exercise({ starter: noTodo })], /no TODO marker/);
  });

  it('refuses a difficulty outside 1..3', () => {
    for (const d of [0, 4]) {
      refuse([exercise({ difficulty: d })], /difficulty .* out of range 1\.\.3/);
      clean();
    }
    expect(() => mapExercise('01-alpha', exercise({ difficulty: 5 }), 0)).toThrow(ImportError);
  });

  it('refuses a starter or solution without the tests marker or the end-tests marker', () => {
    const noTests = (s: string) => s.replace(/^ {4}\/\/ ─+ tests ─+$/m, '    // tests');
    const noEnd = (s: string) => s.replace(/^ {4}\/\/ ─+ end tests ─+$/m, '    // end of tests');
    refuse([exercise({ starter: noTests(STARTER) })], /starter: no `\/\/ ─── tests ───` marker/);
    clean();
    refuse([exercise({ solution: noTests(SOLUTION) })], /solution: no `\/\/ ─── tests ───` marker/);
    clean();
    refuse([exercise({ starter: noEnd(STARTER) })], /starter: tests block has no `\/\/ ─── end tests ───` line/);
    clean();
    refuse([exercise({ solution: noEnd(SOLUTION) })], /solution: tests block has no `\/\/ ─── end tests ───` line/);
  });

  it('refuses a solution whose tests block differs from the starter by one byte', () => {
    refuse([exercise({ solution: SOLUTION.replace('eq(twice(0), 0)', 'eq(twice(0), 0) ') })], /does not repeat the starter tests byte-for-byte/);
  });

  it('refuses a package declaration and a file without class Exercise', () => {
    refuse([exercise({ starter: `package drills;\n\n${STARTER}` , solution: `package drills;\n\n${SOLUTION}` })], /starter declares a package/);
    clean();
    refuse([exercise({ solution: `package drills;\n\n${SOLUTION}` })], /solution declares a package/);
    clean();
    refuse([exercise({ starter: STARTER.replace('class Exercise', 'class Drill'), solution: SOLUTION.replace('class Exercise', 'class Drill') })], /starter does not declare `class Exercise`/);
  });

  it('refuses a tests block without report(), without test(...) and without a literal test name', () => {
    const both = (f: (s: string) => string) => exercise({ starter: f(STARTER), solution: f(SOLUTION) });
    refuse([both((s) => s.replace('System.exit(report());', 'System.exit(0);'))], /never calls report\(\)/);
    clean();
    refuse([both((s) => s.replace(/^ {8}test\(.*\n/gm, '        check();\n'))], /no test\(\.\.\.\) call/);
    clean();
    refuse([both((s) => s.replace(/test\("[^"]*",/g, 'test(NAME,'))], /names no test with a string literal/);
  });

  it('refuses fewer than 4 or more than 8 named tests, a duplicate name, and no "(boundary)" test', () => {
    const both = (f: (s: string) => string) => exercise({ starter: f(STARTER), solution: f(SOLUTION) });
    refuse([both((s) => s.replace(/^ {8}test\("twice\((1|-3)\).*\n/gm, ''))], /needs 4-8 literally named tests \(has 2\)/);
    clean();
    const extra = Array.from({ length: 5 }, (_, i) => `        test("extra ${i}", () -> eq(twice(${i}), ${2 * i}));\n`).join('');
    refuse([both((s) => s.replace('        System.exit(report());', `${extra}        System.exit(report());`))], /needs 4-8 literally named tests \(has 9\)/);
    clean();
    refuse([both((s) => s.replace(' (boundary)"', '"'))], /at least one test named with "\(boundary\)"/);
    clean();
    refuse([both((s) => s.replace('test("twice(1) is 2"', 'test("twice(2) is 4"'))], /duplicate test name "twice\(2\) is 4"/);
  });

  it('refuses a pasteable hint 3: a semicolon, return or parentheses', () => {
    for (const h3 of ['return n times two', 'n * 2;', 'call twice(n)', 'double it ) then stop']) {
      refuse([exercise({ hints: ['Multiply.', 'The * operator.', h3] })], /hint 3 must be the approach in words/);
      clean();
    }
    expect(() => mapExercise('01-alpha', exercise({ hints: ['a', 'b', 'multiply by two, then hand back the product'] }), 0)).not.toThrow();
  });
});

describe('committed javadrills authoring + pack (content/packs/javadrills)', () => {
  it('the authoring imports to the pinned census and its course files match the committed pack byte-for-byte', () => {
    const out = join(dir, 'pack');
    const { manifest } = importJavadrills({ authoringDir: DEFAULT_AUTHORING_DIR, outDir: out, expected: JAVADRILLS_EXPECTED });
    expect(manifest.totals).toEqual(JAVADRILLS_EXPECTED);
    const committed = PackManifest.parse(JSON.parse(readFileSync(join(DEFAULT_OUT_DIR, 'manifest.json'), 'utf8')));
    expect(committed.courses).toEqual(manifest.courses);
    expect(committed).toMatchObject({ source: 'javadrills', track: 'java', expected: JAVADRILLS_EXPECTED, totals: JAVADRILLS_EXPECTED });
    expect(committed.grader).toBeUndefined();
    for (const c of manifest.courses) expect(sha(join(DEFAULT_OUT_DIR, c.file))).toBe(c.sha256);
  });
});
