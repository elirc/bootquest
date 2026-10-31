import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackCourseFile, PackManifest } from '@bootquest/shared';
import { readPack } from '@bootquest/server/packs';
import {
  DEFAULT_AUTHORING_DIR,
  DEFAULT_OUT_DIR,
  hintThreeCode,
  ImportError,
  importSysdrills,
  mapExercise,
  stableKey,
  SYSDRILLS_EXPECTED,
  taskFormulaSpans,
  taskSection,
} from './import.ts';
import { readModules, SYSDRILLS_FORMAT, type SysdrillsExercise } from './source.ts';

const exercise = (over: Partial<SysdrillsExercise> = {}): SysdrillsExercise => ({
  slug: '01-double-it',
  title: 'Double it',
  difficulty: 1,
  skills: ['estimation'],
  instructions: 'Export `double(n)` returning n × 2.',
  starter: 'export function double(n) {\n  // TODO\n}\n',
  solution: 'export function double(n) {\n  return n * 2;\n}\n',
  tests: [
    { name: 'double(2) -> 4', code: "assert.equal(typeof mod.double, 'function', 'export a function named double');\nassert.equal(mod.double(2), 4);", input: [2] },
    { name: 'double(0) -> 0', code: 'assert.equal(mod.double(0), 0);', input: [0] },
  ],
  explanation: '2 × 2 = 4.',
  hints: ['Multiply by two.'],
  ...over,
});

const moduleFile = (module: string, exercises: SysdrillsExercise[]) => ({
  format: SYSDRILLS_FORMAT,
  module,
  title: `Module ${module}`,
  description: `About ${module}.`,
  exercises,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bq-sysdrills-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

/** write authoring files into <dir>/src; returns the authoring dir */
function writeAuthoring(files: Record<string, unknown>): string {
  const root = join(dir, 'src');
  mkdirSync(root, { recursive: true });
  for (const [name, doc] of Object.entries(files)) writeFileSync(join(root, name), typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2));
  return root;
}

const twoExercises = () =>
  writeAuthoring({
    '01-alpha.json': moduleFile('01-alpha', [
      exercise(),
      exercise({
        slug: '02-triple-it',
        title: 'Triple it',
        difficulty: 3,
        skills: [],
        starter: 'export function triple(n) {\n  // TODO\n}\n',
        solution: 'export function triple(n) {\n  return n * 3;\n}\n',
        tests: [{ name: 'triple(3) -> 9', code: "assert.equal(typeof mod.triple, 'function', 'export a function named triple');\nassert.equal(mod.triple(3), 9);" }],
        hints: undefined,
      }),
    ]),
  });

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const refuse = (exercises: SysdrillsExercise[], re: RegExp) => {
  const root = writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', exercises) });
  const out = join(dir, 'pack');
  expect(() => importSysdrills({ authoringDir: root, outDir: out, expected: null })).toThrow(ImportError);
  expect(() => importSysdrills({ authoringDir: root, outDir: out, expected: null })).toThrow(re);
  expect(existsSync(out)).toBe(false); // refused before anything is written
};

describe('seed:import:sysdrills happy path', () => {
  it('imports a 2-exercise module; the pack round-trips through the server loader with correct counts', () => {
    const out = join(dir, 'pack');
    const { manifest, written } = importSysdrills({ authoringDir: twoExercises(), outDir: out, expected: null });
    expect(written).toEqual(['01-alpha.json', 'manifest.json']);
    expect(manifest.courses.map((c) => [c.id, c.order, c.counts])).toEqual([['01-alpha', 1, { total: 2, code: 2, quiz: 0, output: 0, written: 0 }]]);
    expect(manifest.totals).toEqual({ total: 2, code: 2, quiz: 0, output: 0, written: 0 });
    const pack = readPack(out, { allowUnstamped: true });
    expect(pack.courses.flatMap((c) => c.units.map((u) => u.unit.key))).toEqual([stableKey('01-alpha', '01-double-it'), stableKey('01-alpha', '02-triple-it')]);
  });

  it('is deterministic: importing twice gives identical bytes (sha256)', () => {
    const root = twoExercises();
    importSysdrills({ authoringDir: root, outDir: join(dir, 'a'), expected: null });
    importSysdrills({ authoringDir: root, outDir: join(dir, 'b'), expected: null });
    for (const f of ['manifest.json', '01-alpha.json']) expect(sha(join(dir, 'b', f))).toBe(sha(join(dir, 'a', f)));
  });

  it('keeps validation.json / quarantine.json and removes stale course files on re-import', () => {
    const root = twoExercises();
    const out = join(dir, 'pack');
    mkdirSync(out);
    for (const f of ['validation.json', 'quarantine.json', '09-gone.json']) writeFileSync(join(out, f), '{}');
    const { removed } = importSysdrills({ authoringDir: root, outDir: out, expected: null });
    expect(removed).toEqual(['09-gone.json']);
    expect(readdirSync(out).sort()).toEqual(['01-alpha.json', 'manifest.json', 'quarantine.json', 'validation.json']);
  });
});

describe('unit key prefix + check spec shape', () => {
  it('every unit is a sysdesign drill keyed sysdrills/<course>/<slug> with a public-safe drill-js spec', () => {
    const out = join(dir, 'pack');
    importSysdrills({ authoringDir: twoExercises(), outDir: out, expected: null });
    const c = PackCourseFile.parse(JSON.parse(readFileSync(join(out, '01-alpha.json'), 'utf8')));
    expect(c.course).toMatchObject({ id: '01-alpha', order: 1, title: 'Module 01-alpha', description: 'About 01-alpha.', prerequisites: [] });
    expect(c.modules).toEqual([{ id: '01-alpha', title: 'Module 01-alpha', lessons: [{ id: 'drills', title: 'Module 01-alpha', explanation: 'About 01-alpha.' }] }]);
    for (const u of c.units) {
      expect(u.unit.key.startsWith(`sysdrills/${c.course.id}/`)).toBe(true);
      expect(u.unit).toMatchObject({ track: 'sysdesign', kind: 'drill', phase: '01-alpha', competencies: ['system-design'], prerequisites: [] });
      const spec = u.unit.checks[0]!.spec;
      expect(spec.type).toBe('drill-js');
      if (spec.type !== 'drill-js') throw new Error('unreachable');
      expect(spec.language).toBe('js');
      expect(spec.timeoutMs).toBe(8000);
      expect(spec.tests.every((t) => t.code.includes('mod.'))).toBe(true);
    }
    const [u1, u2] = c.units;
    expect(u1!.unit.difficulty).toBe(1);
    expect(u2!.unit.difficulty).toBe(3);
    expect(u1!.origin).toEqual({ id: '01-alpha/01-double-it', type: 'code', module: '01-alpha', lesson: 'drills', position: 0, skills: ['estimation'] });
    const content = c.content[u1!.unit.key]!;
    expect(content.starter).toContain('// TODO');
    expect(content.solution).toContain('return n * 2;');
    expect(content.instructions).toMatch(/^\*\*Skills:\*\* estimation {2}\n\*\*Level:\*\* ★☆☆\n\nExport `double\(n\)`/);
    expect(content.hints).toEqual(['Multiply by two.']);
    expect(c.content[u2!.unit.key]!.hints).toBeUndefined();
    expect(c.content[u2!.unit.key]!.instructions).toMatch(/^\*\*Level:\*\* ★★★\n\n/);
  });
});

describe('manifest', () => {
  it('declares grader js, track sysdesign, the local authoring origin and the census', () => {
    const out = join(dir, 'pack');
    importSysdrills({ authoringDir: twoExercises(), outDir: out, expected: { total: 2, code: 2, quiz: 0, output: 0, written: 0 } });
    const m = PackManifest.parse(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')));
    expect(m.source).toBe('sysdrills');
    expect(m.track).toBe('sysdesign');
    expect(m.grader).toBe('js');
    expect(m.importedFrom).toMatchObject({ repo: 'elirc/selfboot', originKind: 'local', subpath: 'tools/seed/authoring/sysdrills', gitHead: null, dirty: null });
    expect(m.importedFrom.path).not.toContain('\\');
    expect(m.expected).toEqual({ total: 2, code: 2, quiz: 0, output: 0, written: 0 });
  });

  it('SYSDRILLS_EXPECTED pins the committed census (129 drill-js units)', () => {
    expect(SYSDRILLS_EXPECTED).toEqual({ total: 129, code: 129, quiz: 0, output: 0, written: 0 });
  });
});

describe('import-time refusals (write nothing)', () => {
  it('refuses a census divergence', () => {
    const out = join(dir, 'pack');
    expect(() => importSysdrills({ authoringDir: twoExercises(), outDir: out, expected: SYSDRILLS_EXPECTED })).toThrow(/differ from the expected/);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses an empty or missing authoring dir', () => {
    const root = writeAuthoring({});
    expect(() => readModules(root)).toThrow(/no authoring JSON/);
    expect(() => readModules(join(dir, 'nope'))).toThrow(/does not exist/);
  });

  it('refuses non-JSON, schema violations (strict: unknown keys) and a wrong format tag', () => {
    expect(() => readModules(writeAuthoring({ '01-alpha.json': '{ not json' }))).toThrow(/not JSON/);
    rmSync(join(dir, 'src'), { recursive: true });
    expect(() => readModules(writeAuthoring({ '01-alpha.json': { ...moduleFile('01-alpha', [exercise()]), extra: 1 } }))).toThrow(ImportError);
    rmSync(join(dir, 'src'), { recursive: true });
    expect(() => readModules(writeAuthoring({ '01-alpha.json': moduleFile('01-alpha', [{ ...exercise(), timeoutMS: 1 } as SysdrillsExercise]) }))).toThrow(/Unrecognized key/);
    rmSync(join(dir, 'src'), { recursive: true });
    expect(() => readModules(writeAuthoring({ '01-alpha.json': { ...moduleFile('01-alpha', [exercise()]), format: 'other@1' } }))).toThrow(/not a sysdrills-authoring@1 module/);
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

  it('refuses empty instructions, starter, solution and tests', () => {
    const cases: [Partial<SysdrillsExercise>, RegExp][] = [
      [{ instructions: '  \n' }, /empty instructions/],
      [{ starter: '' }, /empty starter/],
      [{ solution: '\n' }, /empty solution/],
      [{ tests: [] }, /no tests/],
    ];
    for (const [over, re] of cases) {
      refuse([exercise(over)], re);
      rmSync(join(dir, 'src'), { recursive: true });
    }
  });

  it('refuses duplicate test names and a test that never touches mod.', () => {
    const t = exercise().tests[0]!;
    refuse([exercise({ tests: [t, { ...t }] })], /duplicate test name/);
    rmSync(join(dir, 'src'), { recursive: true });
    refuse([exercise({ tests: [t, { name: 'tautology', code: 'assert.equal(1, 1);' }] })], /never touches the learner module/);
  });

  it('refuses solution === starter and a starter without TODO', () => {
    const s = exercise().solution;
    refuse([exercise({ starter: s, solution: s })], /identical to the starter/);
    rmSync(join(dir, 'src'), { recursive: true });
    refuse([exercise({ starter: 'export function double(n) {\n  return 0;\n}\n' })], /no TODO marker/);
  });

  it('refuses a difficulty outside 1..3', () => {
    for (const d of [0, 4]) {
      refuse([exercise({ difficulty: d })], /difficulty .* out of range 1\.\.3/);
      rmSync(join(dir, 'src'), { recursive: true });
    }
    expect(() => mapExercise('01-alpha', exercise({ difficulty: 5 }), 0)).toThrow(ImportError);
  });
});

describe('seed:import:sysdrills shape gates (task line and hint 3)', () => {
  const task = (yourTask: string) =>
    [
      '**Interview prompt.** "How many requests are in flight?"',
      '**Why it works.** In flight = rate × time, so `qps × latencyMs / 1000` is the classic form.',
      `**Your task.** ${yourTask}`,
      '**Worked example.** 200 QPS × 50 ms → `200 × 50 / 1000` = **10**.',
    ].join('\n\n');
  const hinted = (h3: string) => exercise({ hints: ['Rate times time.', 'inFlight = qps × latencyMs ÷ 1000.', h3] });

  it('taskSection runs from the Your task marker to the next bold paragraph header', () => {
    const t = taskSection(task('Export `inFlight(qps, latencyMs)` → requests in flight.'));
    expect(t.startsWith('**Your task.**')).toBe(true);
    expect(t).toContain('requests in flight.');
    expect(t).not.toContain('Worked example');
    expect(t).not.toContain('Why it works');
    expect(taskSection('Export `double(n)`.')).toBe('');
  });

  it('refuses a "Your task" that hands over the formula in backticks, and writes nothing', () => {
    refuse([exercise({ instructions: task('Export `inFlight(qps, latencyMs)` → `qps × latencyMs / 1000`.') })], /"Your task" hands over the formula in backticks .*move the formula to hint 2/);
    const formulas = [
      '`qps × latencyMs ÷ 1000`',
      '`Math.ceil(items / batchSize)`',
      '`ceil(backlog / rate)`',
      '`max(0, arrive - capacity)`',
      '`qps * latencyMs`',
      '`n − w + 1`',
      '`sortedAckMs[k−1]`',
      '`bytes/8`',
      '`base × 2^attempt`',
      '`⌈rows ÷ perPage⌉`',
    ];
    for (const f of formulas) {
      expect(() => mapExercise('01-alpha', exercise({ instructions: task(`Export \`inFlight(qps, latencyMs)\` → ${f}.`) }), 0), f).toThrow(/hands over the formula/);
    }
  });

  it('accepts signatures, names and values in the task, and arithmetic outside it', () => {
    const ok = [
      'Export `inFlight(qps, latencyMs)` → the average number of requests in flight, **rounded UP**.',
      'Export `backoffMs(baseMs, capMs, attempt)`: reuse 03/04 `exponential-backoff` and `01-estimation`; return `{ min, max }` or `[50, 100]`; `true` when `r` and `w` overlap.',
    ];
    for (const yourTask of ok) {
      expect(taskFormulaSpans(task(yourTask)), yourTask).toEqual([]);
      expect(() => mapExercise('01-alpha', exercise({ instructions: task(yourTask) }), 0)).not.toThrow();
    }
    expect(taskFormulaSpans('No task section, only `a × b` in prose.')).toEqual([]);
  });

  it('refuses a hint 3 that reads as code, and writes nothing', () => {
    refuse([hinted('return (qps * latencyMs) / 1000;')], /hint 3 must be the approach in words, never pasteable code.*contains/);
    const code: [string, RegExp][] = [
      ['Multiply the rate by the time; then divide by 1,000', /contains ";"/],
      ['parts.reduce of acc => acc times p', /contains "=>"/],
      ['Just return the product of the two inputs', /contains "return"/],
      ['Multiply the rate by the time (in seconds)', /contains "\("/],
      ['Use `qps × latencyMs ÷ 1000` and you are done', /has arithmetic in backticks/],
    ];
    for (const [h3, re] of code) {
      expect(hintThreeCode(h3), h3).not.toBeNull();
      expect(() => mapExercise('01-alpha', hinted(h3), 0), h3).toThrow(re);
    }
  });

  it('accepts a prose hint 3, a hint 2 with the formula, and drills with fewer than three hints', () => {
    const prose = 'Convert the latency from milliseconds to seconds, then multiply it by the arrival rate for the in-flight count, rounding any fraction up.';
    expect(hintThreeCode(prose)).toBeNull();
    expect(hintThreeCode('Reuse the `latencyMs` input and the 03/04 `exponential-backoff` rule.')).toBeNull();
    expect(() => mapExercise('01-alpha', hinted(prose), 0)).not.toThrow();
    expect(() => mapExercise('01-alpha', exercise({ hints: ['a', 'x = (a + b) × 2;'] }), 0)).not.toThrow();
    expect(() => mapExercise('01-alpha', exercise({ hints: undefined }), 0)).not.toThrow();
  });

  it('every committed sysdrill passes both gates (no task formula, hint 3 in words)', () => {
    const flagged: string[] = [];
    for (const m of readModules(DEFAULT_AUTHORING_DIR)) {
      for (const ex of m.exercises) {
        if (taskFormulaSpans(ex.instructions).length > 0) flagged.push(`${m.module}/${ex.slug}: task formula`);
        const h3 = ex.hints?.[2];
        if (h3 !== undefined && hintThreeCode(h3) !== null) flagged.push(`${m.module}/${ex.slug}: hint 3 code`);
      }
    }
    expect(flagged).toEqual([]);
  });
});

describe('committed sysdrills authoring + pack (content/packs/sysdrills)', () => {
  it('the authoring imports to the pinned census and its course files match the committed pack byte-for-byte', () => {
    const out = join(dir, 'pack');
    const { manifest } = importSysdrills({ authoringDir: DEFAULT_AUTHORING_DIR, outDir: out, expected: SYSDRILLS_EXPECTED });
    expect(manifest.totals).toEqual(SYSDRILLS_EXPECTED);
    const committed = PackManifest.parse(JSON.parse(readFileSync(join(DEFAULT_OUT_DIR, 'manifest.json'), 'utf8')));
    expect(committed.courses).toEqual(manifest.courses);
    expect(committed).toMatchObject({ source: 'sysdrills', track: 'sysdesign', grader: 'js', expected: SYSDRILLS_EXPECTED, totals: SYSDRILLS_EXPECTED });
    for (const c of manifest.courses) expect(sha(join(DEFAULT_OUT_DIR, c.file))).toBe(c.sha256);
  });
});
