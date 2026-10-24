import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackCourseFile, PackManifest } from '@bootquest/shared';
import { readPack } from '@bootquest/server/packs';
import { CSDRILLS_EXPECTED, DEFAULT_AUTHORING_DIR, DEFAULT_OUT_DIR, ImportError, importCsdrills, literalTestNames, mapExercise, stableKey } from './import.ts';
import { CSDRILLS_FORMAT, readModules, type CsdrillsExercise } from './source.ts';

// C# content is inert here: import tests never run dotnet (seed:validate is the execution gate).
const MARKER = '// ──────────────────────────── tests ──────────────────────────────────────';
const TYPES = '// ──────────────────────────── types ──────────────────────────────────────';

const exercise = (over: Partial<CsdrillsExercise> = {}): CsdrillsExercise => ({
  slug: '01-double-it',
  title: 'Double it',
  difficulty: 1,
  skills: ['arithmetic'],
  instructions: 'Implement `int DoubleIt(int n)` returning n × 2.',
  starterHead: 'using static Bootcamp.Check;\n\nint DoubleIt(int n)\n{\n    // TODO: double it\n    throw new NotImplementedException();\n}\n\n',
  solutionHead: 'using static Bootcamp.Check;\n\nint DoubleIt(int n)\n{\n    return n * 2;\n}\n\n',
  tests: `${MARKER}\n\nTest("DoubleIt(2) -> 4", () =>\n    Eq(DoubleIt(2), 4));\n\nTest("DoubleIt(0) -> 0 (boundary)", () =>\n    Eq(DoubleIt(0), 0));\n\nTest("DoubleIt(-3) -> -6", () =>\n    Eq(DoubleIt(-3), -6));\n`,
  explanation: '2 × 2 = **4**.',
  hints: ['Multiply.', 'n * 2.', 'Multiply the input by two'],
  ...over,
});

const moduleFile = (module: string, exercises: CsdrillsExercise[]) => ({
  format: CSDRILLS_FORMAT,
  module,
  title: `Module ${module}`,
  description: `About ${module}.`,
  exercises,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bq-csdrills-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

/** write authoring files into <dir>/src; returns the authoring dir */
function writeAuthoring(files: Record<string, unknown>): string {
  const root = join(dir, 'src');
  mkdirSync(root, { recursive: true });
  for (const [name, doc] of Object.entries(files)) writeFileSync(join(root, name), typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2));
  return root;
}

const TAIL = `${TYPES}\n\nenum Sign { Neg = -1, Zero = 0, Pos = 1 }\n`;

const twoExercises = () =>
  writeAuthoring({
    '01-alpha.json': moduleFile('01-alpha', [
      exercise(),
      exercise({
        slug: '02-sign-of',
        title: 'Sign of',
        difficulty: 3,
        skills: ['enums', 'comparison'],
        starterHead: 'using static Bootcamp.Check;\n\nSign SignOf(int n)\n{\n    // TODO\n    throw new NotImplementedException();\n}\n\n',
        solutionHead: 'using static Bootcamp.Check;\n\nSign SignOf(int n)\n{\n    return (Sign)Math.Sign(n);\n}\n\n',
        tests: `${MARKER}\n\nTest("SignOf(5) -> Pos", () => Eq(SignOf(5), Sign.Pos));\nTest("SignOf(0) -> Zero (boundary)", () => Eq(SignOf(0), Sign.Zero));\nTest("SignOf(-2) -> Neg", () => Eq(SignOf(-2), Sign.Neg));\n\n`,
        tail: TAIL,
      }),
    ]),
  });

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const refuse = (exercises: CsdrillsExercise[], re: RegExp) => {
  const root = writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', exercises) });
  const out = join(dir, 'pack');
  expect(() => importCsdrills({ authoringDir: root, outDir: out, expected: null })).toThrow(ImportError);
  expect(() => importCsdrills({ authoringDir: root, outDir: out, expected: null })).toThrow(re);
  expect(existsSync(out)).toBe(false); // refused before anything is written
};
const refuseEach = (cases: [Partial<CsdrillsExercise>, RegExp][]) => {
  for (const [over, re] of cases) {
    refuse([exercise(over)], re);
    rmSync(join(dir, 'src'), { recursive: true });
  }
};

describe('seed:import:csdrills happy path', () => {
  it('imports a 2-exercise module; the pack round-trips through the server loader with correct counts', () => {
    const out = join(dir, 'pack');
    const { manifest, written } = importCsdrills({ authoringDir: twoExercises(), outDir: out, expected: null });
    expect(written).toEqual(['01-alpha.json', 'manifest.json']);
    expect(manifest.courses.map((c) => [c.id, c.order, c.counts])).toEqual([['01-alpha', 1, { total: 2, code: 2, quiz: 0, output: 0, written: 0 }]]);
    expect(manifest.totals).toEqual({ total: 2, code: 2, quiz: 0, output: 0, written: 0 });
    const pack = readPack(out, { allowUnstamped: true });
    expect(pack.courses.flatMap((c) => c.units.map((u) => u.unit.key))).toEqual([stableKey('01-alpha', '01-double-it'), stableKey('01-alpha', '02-sign-of')]);
  });

  it('is deterministic: importing twice gives identical bytes (sha256)', () => {
    const root = twoExercises();
    importCsdrills({ authoringDir: root, outDir: join(dir, 'a'), expected: null });
    importCsdrills({ authoringDir: root, outDir: join(dir, 'b'), expected: null });
    for (const f of ['manifest.json', '01-alpha.json']) expect(sha(join(dir, 'b', f))).toBe(sha(join(dir, 'a', f)));
  });

  it('keeps validation.json / quarantine.json and removes stale course files on re-import', () => {
    const root = twoExercises();
    const out = join(dir, 'pack');
    mkdirSync(out);
    for (const f of ['validation.json', 'quarantine.json', '09-gone.json']) writeFileSync(join(out, f), '{}');
    const { removed } = importCsdrills({ authoringDir: root, outDir: out, expected: null });
    expect(removed).toEqual(['09-gone.json']);
    expect(readdirSync(out).sort()).toEqual(['01-alpha.json', 'manifest.json', 'quarantine.json', 'validation.json']);
  });
});

describe('unit key prefix + check spec shape', () => {
  it('every unit is a csharp drill keyed csdrills/<course>/<slug> with a jstrain console-check drill-cs spec', () => {
    const out = join(dir, 'pack');
    importCsdrills({ authoringDir: twoExercises(), outDir: out, expected: null });
    const c = PackCourseFile.parse(JSON.parse(readFileSync(join(out, '01-alpha.json'), 'utf8')));
    expect(c.course).toMatchObject({ id: '01-alpha', order: 1, title: 'Module 01-alpha', description: 'About 01-alpha.', prerequisites: [] });
    expect(c.modules).toEqual([{ id: '01-alpha', title: 'Module 01-alpha', lessons: [{ id: 'drills', title: 'Module 01-alpha', explanation: 'About 01-alpha.' }] }]);
    for (const u of c.units) {
      expect(u.unit.key.startsWith(`csdrills/${c.course.id}/`)).toBe(true);
      expect(u.unit).toMatchObject({ track: 'csharp', kind: 'drill', phase: '01-alpha', competencies: ['language-fluency'], prerequisites: [] });
      const spec = u.unit.checks[0]!.spec;
      expect(spec.type).toBe('drill-cs');
      if (spec.type !== 'drill-cs') throw new Error('unreachable');
      expect(spec).toMatchObject({ shape: 'console-check', harness: 'jstrain', timeoutMs: 20000 });
      expect(spec.files.tests.split('\n', 1)[0]).toBe(MARKER);
      expect(spec.files.frozen).toEqual([]);
      const content = c.content[u.unit.key]!;
      expect(content.starter).toContain('TODO');
      expect(content.hints).toHaveLength(3);
    }
    const [u1, u2] = c.units;
    expect(u1!.unit.difficulty).toBe(1);
    expect(u2!.unit.difficulty).toBe(3);
    expect(u1!.origin).toEqual({ id: '01-alpha/01-double-it', type: 'code', module: '01-alpha', lesson: 'drills', position: 0, skills: ['arithmetic'] });
    const ex = exercise();
    const content = c.content[u1!.unit.key]!;
    expect(content.starter).toBe(ex.starterHead + ex.tests);
    expect(content.solution).toBe(ex.solutionHead + ex.tests);
    expect(content.solution).toContain('return n * 2;');
    expect(content.instructions).toMatch(/^\*\*Skills:\*\* arithmetic {2}\n\*\*Level:\*\* ★☆☆\n\nImplement `int DoubleIt\(int n\)`/);
    expect(content.hints).toEqual(['Multiply.', 'n * 2.', 'Multiply the input by two']);
    const s1 = u1!.unit.checks[0]!.spec;
    if (s1.type !== 'drill-cs') throw new Error('unreachable');
    expect(s1.files).toEqual({ tests: ex.tests, tail: '', frozen: [] });
    // the tail rides in the spec AND after the tests in starter + solution
    const s2 = u2!.unit.checks[0]!.spec;
    if (s2.type !== 'drill-cs') throw new Error('unreachable');
    expect(s2.files.tail).toBe(TAIL);
    const c2 = c.content[u2!.unit.key]!;
    expect(c2.starter!.endsWith(s2.files.tests + TAIL)).toBe(true);
    expect(c2.solution!.endsWith(s2.files.tests + TAIL)).toBe(true);
    expect(c2.instructions).toMatch(/^\*\*Skills:\*\* enums · comparison {2}\n\*\*Level:\*\* ★★★\n\n/);
  });

  it('literalTestNames sees plain-literal names only (whole-line comments register nothing)', () => {
    expect(literalTestNames(`${MARKER}\n// Test("commented", () => {});\nTest("a \\"q\\"", () => {});\nCheck.Test("b", () => {});\nTest($"c{1}", () => {});\n`)).toEqual(['a "q"', 'b']);
  });
});

describe('manifest', () => {
  it('declares grader csharp, track csharp, the local authoring origin and the census', () => {
    const out = join(dir, 'pack');
    importCsdrills({ authoringDir: twoExercises(), outDir: out, expected: { total: 2, code: 2, quiz: 0, output: 0, written: 0 } });
    const m = PackManifest.parse(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')));
    expect(m.source).toBe('csdrills');
    expect(m.track).toBe('csharp');
    expect(m.grader).toBe('csharp');
    expect(m.importedFrom).toMatchObject({ repo: 'elirc/selfboot', originKind: 'local', subpath: 'tools/seed/authoring/csdrills', gitHead: null, dirty: null });
    expect(m.importedFrom.path).not.toContain('\\');
    expect(m.expected).toEqual({ total: 2, code: 2, quiz: 0, output: 0, written: 0 });
  });

  it('CSDRILLS_EXPECTED pins the committed census (80 drill-cs units)', () => {
    expect(CSDRILLS_EXPECTED).toEqual({ total: 80, code: 80, quiz: 0, output: 0, written: 0 });
  });
});

describe('import-time refusals (write nothing)', () => {
  it('refuses a census divergence', () => {
    const out = join(dir, 'pack');
    expect(() => importCsdrills({ authoringDir: twoExercises(), outDir: out, expected: CSDRILLS_EXPECTED })).toThrow(/differ from the expected/);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses an empty or missing authoring dir', () => {
    const root = writeAuthoring({});
    expect(() => readModules(root)).toThrow(/no authoring JSON/);
    expect(() => readModules(join(dir, 'nope'))).toThrow(/does not exist/);
  });

  it('refuses non-JSON, schema violations (strict: unknown keys, hint count) and a wrong format tag', () => {
    expect(() => readModules(writeAuthoring({ '01-alpha.json': '{ not json' }))).toThrow(/not JSON/);
    rmSync(join(dir, 'src'), { recursive: true });
    expect(() => readModules(writeAuthoring({ '01-alpha.json': { ...moduleFile('01-alpha', [exercise()]), extra: 1 } }))).toThrow(ImportError);
    rmSync(join(dir, 'src'), { recursive: true });
    expect(() => readModules(writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', [{ ...exercise(), starter: 'x' } as CsdrillsExercise]) }))).toThrow(/Unrecognized key/);
    rmSync(join(dir, 'src'), { recursive: true });
    expect(() => readModules(writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', [exercise({ hints: ['a', 'b'] })]) }))).toThrow(/hints/);
    rmSync(join(dir, 'src'), { recursive: true });
    expect(() => readModules(writeAuthoring({ '01-alpha.json': { ...moduleFile('01-alpha', [exercise()]), format: 'other@1' } }))).toThrow(/not a csdrills-authoring@1 module/);
  });

  it('refuses module ids outside NN-kebab, a file named differently, and duplicate module orders', () => {
    expect(() => readModules(writeAuthoring({ 'Alpha.json': moduleFile('Alpha', [exercise()]) }))).toThrow(/must match/);
    rmSync(join(dir, 'src'), { recursive: true });
    expect(() => readModules(writeAuthoring({ '01-beta.json': moduleFile('01-alpha', [exercise()]) }))).toThrow(/file must be named 01-alpha.json/);
    rmSync(join(dir, 'src'), { recursive: true });
    expect(() => readModules(writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', [exercise()]), '01-beta.json': moduleFile('01-beta', [exercise()]) }))).toThrow(/duplicate module order 1/);
  });

  it('refuses a duplicate slug and a slug outside NN-kebab', () => {
    refuse([exercise(), exercise()], /duplicate exercise slug 01-double-it/);
    rmSync(join(dir, 'src'), { recursive: true });
    refuse([exercise({ slug: 'double_it' })], /slug must match/);
  });

  it('refuses empty instructions, starterHead, solutionHead, tests and explanation', () => {
    refuseEach([
      [{ instructions: '  \n' }, /empty instructions/],
      [{ starterHead: '' }, /empty starterHead/],
      [{ solutionHead: '\n' }, /empty solutionHead/],
      [{ tests: ' ' }, /empty tests/],
      [{ explanation: '' }, /empty explanation/],
    ]);
  });

  it('refuses a starterHead without TODO or without the harness using, solution === starter, and a solution still throwing NotImplementedException', () => {
    const ex = exercise();
    refuseEach([
      [{ starterHead: ex.starterHead.replace('// TODO: double it', '// write it') }, /no TODO marker/],
      [{ starterHead: ex.starterHead.replace('using static Bootcamp.Check;', 'using Bootcamp;') }, /lacks `using static Bootcamp.Check;`/],
      [{ solutionHead: ex.starterHead }, /identical to the starterHead/],
      [{ solutionHead: ex.starterHead.replace('// TODO: double it', '// done') }, /still contains NotImplementedException/],
    ]);
  });

  it('refuses any `#:` directive in a head, the tests or the tail', () => {
    const ex = exercise();
    refuseEach([
      [{ starterHead: `#:project ../../_lib/Check/Check.csproj\n${ex.starterHead}` }, /starterHead contains a `#:`/],
      [{ solutionHead: `#:package Foo@1.0.0\n${ex.solutionHead}` }, /solutionHead contains a `#:`/],
      [{ tests: `${ex.tests}#:property X=1\n` }, /tests contains a `#:`/],
      [{ tail: `${TYPES}\n#:sdk Microsoft.NET.Sdk.Web\n` }, /tail contains a `#:`/],
    ]);
  });

  it('refuses a tests block that does not open with the divider, lacks its final newline, or holds a further divider', () => {
    const ex = exercise();
    refuseEach([
      [{ tests: `\n${ex.tests}` }, /must start \(first line\) with the `\/\/ ─── tests ───` divider/],
      [{ tests: ex.tests.replace(MARKER, '// --- tests ---') }, /must start \(first line\)/],
      [{ tests: ex.tests.slice(0, -1) }, /must end with a newline/],
      [{ tests: `${ex.tests}${TYPES}\nTest("late", () => Eq(1, 1));\n` }, /further section divider/],
    ]);
  });

  it('refuses a tests divider in a head or the tail, and a tail without a section divider', () => {
    const ex = exercise();
    refuseEach([
      [{ starterHead: `${ex.starterHead}${MARKER}\n` }, /starterHead contains a tests divider/],
      [{ solutionHead: `${ex.solutionHead}${MARKER}\n` }, /solutionHead contains a tests divider/],
      [{ tail: `${TYPES}\n${MARKER}\n` }, /tail contains a tests divider/],
      [{ tail: 'enum Sign { Neg, Pos }\n' }, /tail must start \(first line\) with a labelled section divider/],
      [{ tail: '' }, /tail must start/],
    ]);
  });

  it('refuses fewer than 3 literal test names and a duplicate literal test name', () => {
    refuseEach([
      [{ tests: `${MARKER}\n\nTest("one", () => Eq(DoubleIt(1), 2));\nTest("two", () => Eq(DoubleIt(2), 4));\n` }, /register 2 literal Test/],
      [{ tests: `${MARKER}\n\nTest("one", () => Eq(DoubleIt(1), 2));\n// Test("two", () => Eq(DoubleIt(2), 4));\nTest($"three", () => Eq(DoubleIt(3), 6));\n` }, /register 1 literal Test/],
      [{ tests: `${MARKER}\n\nTest("same", () => Eq(DoubleIt(1), 2));\nTest("other", () => Eq(DoubleIt(2), 4));\nTest("same", () => Eq(DoubleIt(3), 6));\n` }, /duplicate test name "same"/],
    ]);
  });

  it('refuses a pasteable hint 3 (`;`, `=>` or `return`)', () => {
    refuseEach([
      [{ hints: ['a', 'b', 'n * 2;'] }, /hint 3 must be approach in words/],
      [{ hints: ['a', 'b', 'x => x * 2'] }, /hint 3 must be approach in words/],
      [{ hints: ['a', 'b', 'return the doubled value'] }, /hint 3 must be approach in words/],
    ]);
  });

  it('refuses a difficulty outside 1..3', () => {
    for (const d of [0, 4]) {
      refuse([exercise({ difficulty: d })], /difficulty .* out of range 1\.\.3/);
      rmSync(join(dir, 'src'), { recursive: true });
    }
    expect(() => mapExercise('01-alpha', exercise({ difficulty: 5 }), 0)).toThrow(ImportError);
  });
});

// a class drill: the learner implements a type, which must follow the top-level statements,
// so the starter's tail stubs it and the solution's tail implements it
const STUB_TAIL = `${TYPES}\n\nclass Counter\n{\n    public int Next()\n    {\n        // TODO: count up from 1\n        throw new NotImplementedException();\n    }\n}\n`;
const IMPL_TAIL = `${TYPES}\n\nclass Counter\n{\n    private int _n;\n    public int Next() => ++_n;\n}\n`;
const classExercise = (over: Partial<CsdrillsExercise> = {}): CsdrillsExercise =>
  exercise({
    slug: '03-counter',
    title: 'Counter',
    starterHead: 'using static Bootcamp.Check;\n\n// TODO: implement Counter in the types section below\n\n',
    solutionHead: 'using static Bootcamp.Check;\n\n// Counter is implemented in the types section below\n\n',
    tests: `${MARKER}\n\nTest("first Next -> 1 (boundary)", () => Eq(new Counter().Next(), 1));\nTest("second Next -> 2", () => { var c = new Counter(); c.Next(); Eq(c.Next(), 2); });\nTest("counters are independent", () => { new Counter().Next(); Eq(new Counter().Next(), 1); });\n\n`,
    tail: STUB_TAIL,
    solutionTail: IMPL_TAIL,
    ...over,
  });

describe('class drills (solutionTail)', () => {
  it('composes the solution with solutionTail while the starter and spec.files.tail keep the stubbed tail', () => {
    const out = join(dir, 'pack');
    const root = writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', [exercise(), classExercise()]) });
    importCsdrills({ authoringDir: root, outDir: out, expected: null });
    const c = PackCourseFile.parse(JSON.parse(readFileSync(join(out, '01-alpha.json'), 'utf8')));
    const u = c.units[1]!;
    const spec = u.unit.checks[0]!.spec;
    if (spec.type !== 'drill-cs') throw new Error('unreachable');
    const ex = classExercise();
    expect(spec.files.tail).toBe(STUB_TAIL);
    const content = c.content[u.unit.key]!;
    expect(content.starter).toBe(ex.starterHead + ex.tests + STUB_TAIL);
    expect(content.solution).toBe(ex.solutionHead + ex.tests + IMPL_TAIL);
    expect(content.solution).not.toContain('NotImplementedException');
    // a drill without solutionTail still shares its tail (unchanged behaviour)
    const s0 = c.content[c.units[0]!.unit.key]!;
    expect(s0.solution).toBe(exercise().solutionHead + exercise().tests);
  });

  it('accepts a TODO that sits only in the stubbed tail when a solutionTail is given', () => {
    const out = join(dir, 'pack');
    const root = writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', [classExercise({ starterHead: 'using static Bootcamp.Check;\n\n// implement Counter below\n\n' })]) });
    expect(() => importCsdrills({ authoringDir: root, outDir: out, expected: null })).not.toThrow();
  });

  it('refuses a solutionTail without a tail', () => {
    refuse([classExercise({ tail: undefined })], /solutionTail without a tail/);
  });

  it('refuses a solutionTail identical to the tail', () => {
    refuse([classExercise({ solutionTail: STUB_TAIL })], /solutionTail is identical to the tail/);
  });

  it('refuses a solutionTail still throwing NotImplementedException', () => {
    refuse([classExercise({ solutionTail: `${IMPL_TAIL}\nclass Extra { public void X() => throw new NotImplementedException(); }\n` })], /solutionTail still contains NotImplementedException/);
  });

  it('refuses a solutionTail that does not open with a section divider', () => {
    refuse([classExercise({ solutionTail: IMPL_TAIL.slice(TYPES.length + 2) })], /solutionTail must start \(first line\) with a labelled section divider/);
  });

  it('refuses a solutionTail containing a tests divider', () => {
    refuse([classExercise({ solutionTail: `${IMPL_TAIL}${MARKER}\n` })], /solutionTail contains a tests divider/);
  });

  it('refuses a `#:` directive in the solutionTail', () => {
    refuse([classExercise({ solutionTail: `${IMPL_TAIL}#:package Foo@1.0.0\n` })], /solutionTail contains a `#:`/);
  });

  it('refuses a class drill with no TODO in either starterHead or tail', () => {
    refuse(
      [classExercise({ starterHead: 'using static Bootcamp.Check;\n\n// implement Counter below\n\n', tail: STUB_TAIL.replace('// TODO: count up from 1', '// count up from 1') })],
      /neither starterHead nor tail has a TODO marker/,
    );
  });
});

describe('committed csdrills authoring + pack (content/packs/csdrills)', () => {
  it('the authoring imports to the pinned census and its course files match the committed pack byte-for-byte', () => {
    const out = join(dir, 'pack');
    const { manifest } = importCsdrills({ authoringDir: DEFAULT_AUTHORING_DIR, outDir: out, expected: CSDRILLS_EXPECTED });
    expect(manifest.totals).toEqual(CSDRILLS_EXPECTED);
    const committed = PackManifest.parse(JSON.parse(readFileSync(join(DEFAULT_OUT_DIR, 'manifest.json'), 'utf8')));
    expect(committed.courses).toEqual(manifest.courses);
    expect(committed).toMatchObject({ source: 'csdrills', track: 'csharp', grader: 'csharp', expected: CSDRILLS_EXPECTED, totals: CSDRILLS_EXPECTED });
    for (const c of manifest.courses) expect(sha(join(DEFAULT_OUT_DIR, c.file))).toBe(c.sha256);
  });
});
