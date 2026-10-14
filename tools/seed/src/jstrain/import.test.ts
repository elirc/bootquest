import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackCourseFile, PackManifest } from '@bootquest/shared';
import { readPack } from '@bootquest/server/packs';
import { runSelfRun, type SelfRunSpec } from '@bootquest/server/runners/self-run';
import { dedupAgainstGithub, exerciseName, foreignDirectives, githubCsbootcampIds, importJstrainCs, needsAspNetFramework } from './cs.ts';
import { courseIdFor, ImportError, importJstrain, stableKey } from './import.ts';
import { answerKey, correctedKeyTokens, KEY_CORRECTIONS, parseQuizFile, routeItem, type QuizCapture } from './quiz.ts';
import { parseJsHeader, readGitHead } from './source.ts';

/** a FORMAT.md-shaped JS exercise / solution pair */
function jsPair(n: string, name: string, opts: { hunt?: boolean; fixture?: boolean } = {}): { ex: string; sol: string } {
  const header = (sol: boolean) => `// ─────────────────────────────────────────────────────────────────────────
//  ${n} · ${name}${sol ? ' — SOLUTION' : ''}                                    ★★☆ core
${sol ? '' : '//  concepts: closures · tests\n'}//  run: node ${n}-${name}.js
// ─────────────────────────────────────────────────────────────────────────
//
${sol ? '//  Walkthrough: return the doubled value.' : '//  Return n doubled.\n//\n//      double(2) → 4'}
`;
  const imp = `import { test, eq } from '../../_lib/check.js';\n${opts.fixture ? "import { SEED } from './fixtures/seed.js';\n" : ''}\n`;
  const tests = `// ──────────────────────────── tests ──────────────────────────────────────

test('doubles', () => {
  eq(double(2), 4);
});

test('doubles zero', () => {
  eq(double(0), 0);
});
`;
  const body = (impl: string) => `export function double(n) {\n  ${impl}\n}\n\n`;
  const starterImpl = opts.hunt ? 'return n + n + (n === 0 ? 1 : 0);' : "throw new Error('TODO');";
  return { ex: `${header(false)}\n${imp}${body(starterImpl)}${tests}`, sol: `${header(true)}\n${imp}${body(opts.fixture ? 'return n * 2 + SEED;' : 'return n * 2;')}${tests}` };
}

const QUIZ = `# 01 · Language Core — types

Cover the answer.

---

### Q1 — typeof zoo

What does this print?

\`\`\`js
console.log(typeof null);
console.log(typeof 1);
\`\`\`

<details><summary>Answer</summary>

**\`object\`, \`number\`** — the type tag.
</details>

---

### Q2 — const is not frozen

What does this print?

\`\`\`js
const a = 1;
a = 2;
\`\`\`

<details><summary>Answer</summary>

**\`TypeError: Assignment to constant variable.\`** — const binds.
</details>

---

### Q3 — say it out loud

Explain closures.

<details><summary>Answer</summary>

**A function plus its lexical environment.** More words.
</details>
`;

const CS_EX = (sol: boolean) => `// ─────────────────────────────────────────────────────────────────────────
//  01 · fizzbuzz${sol ? ' — SOLUTION' : ''}                                    ★☆☆ warm-up
//  concepts: control flow
//  run: dotnet run 01-fizzbuzz.cs
// ─────────────────────────────────────────────────────────────────────────
//
//  ${sol ? 'Walkthrough: loop.' : 'Return the values.'}
#:project ../../_lib/Check/Check.csproj

using static Bootcamp.Check;

int Twice(int n)
{
    ${sol ? 'return n * 2;' : 'throw new NotImplementedException();'}
}

// ──────────────────────────── tests ──────────────────────────────────────

Test("doubles", () => Eq(Twice(2), 4));

// ──────────────────────────── given ──────────────────────────────────────

record Box(int V);
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bq-jstrain-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

function writeTree(files: Record<string, string>): string {
  const root = join(dir, 'src');
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, ...rel.split('/'));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

function miniMirror(): string {
  const a = jsPair('01', 'double');
  const h = jsPair('01', 'double', { hunt: true });
  const f = jsPair('02', 'seeded', { fixture: true });
  const t = jsPair('01', 'typed');
  return writeTree({
    'bootcamp/01-language-core/README.md': '# 01 · Language Core\n\nThe basics.\n',
    'bootcamp/01-language-core/exercises/01-double.js': a.ex,
    'bootcamp/01-language-core/solutions/01-double.js': a.sol.replace(/\n/g, '\r\n'), // autocrlf checkout bytes
    'bootcamp/08-modules/exercises/02-seeded.js': f.ex,
    'bootcamp/08-modules/solutions/02-seeded.js': f.sol,
    'bootcamp/08-modules/exercises/fixtures/seed.js': 'export const SEED = 0;\n',
    'bootcamp/08-modules/solutions/fixtures/seed.js': 'export const SEED = 0;\n',
    'bootcamp/13-dom-and-browser/exercises/01-x.html': '<html></html>',
    'bootcamp/13-dom-and-browser/solutions/01-x.html': '<html></html>',
    'bootcamp/24-debug-hunts/exercises/01-double.js': h.ex,
    'bootcamp/24-debug-hunts/solutions/01-double.js': h.sol,
    'bootcamp/25-codebase-debug-hunts/exercises/01-app.js': h.ex.replace("import { test, eq } from '../../_lib/check.js';", "import { test, eq } from '../../_lib/check.js';\nimport { x } from './01-app-app/x.js';"),
    'bootcamp/25-codebase-debug-hunts/solutions/01-app.js': h.sol,
    'bootcamp/25-codebase-debug-hunts/exercises/01-app-app/x.js': 'export const x = 1;\n',
    'tsbootcamp/01-types/exercises/01-typed.ts': t.ex.replace('run: node 01-typed.js', 'run: node ../run.js exercises/01-typed.ts').replace("import { test, eq } from '../../_lib/check.js';", "import { test, eq } from '../../_lib/check.ts';").replace('export function double(n) {', 'export function double(n: number): number {').replace('// ──────────────────────────── tests', '// ─────────────────────────── runtime tests'),
    'tsbootcamp/01-types/solutions/01-typed.ts': t.sol.replace("import { test, eq } from '../../_lib/check.js';", "import { test, eq } from '../../_lib/check.ts';").replace('export function double(n) {', 'export function double(n: number): number {').replace('// ──────────────────────────── tests', '// ─────────────────────────── runtime tests'),
    'quizzes/01-language-core.md': QUIZ,
    'jstrain/exercises/js/01-values.js': '// vitest project\n',
    'csbootcamp/01-csharp-language-core/exercises/01-fizzbuzz.cs': CS_EX(false),
    'csbootcamp/01-csharp-language-core/solutions/01-fizzbuzz.cs': CS_EX(true),
    'csbootcamp/01-csharp-language-core/exercises/02-count-vowels.cs': CS_EX(false).replace('01 · fizzbuzz', '02 · vowels'),
    'csbootcamp/01-csharp-language-core/solutions/02-count-vowels.cs': CS_EX(true).replace('01 · fizzbuzz', '02 · vowels'),
    'csbootcamp/13-minimal-apis/exercises/01-hello.cs': `#:sdk Microsoft.NET.Sdk.Web\n${CS_EX(false)}`,
    'csbootcamp/13-minimal-apis/solutions/01-hello.cs': `#:sdk Microsoft.NET.Sdk.Web\n${CS_EX(true)}`,
  });
}

/** deterministic capture for quiz routing (no process) */
const fakeCapture: QuizCapture = async (code) =>
  code.includes('a = 2')
    ? { stdout: '', stderr: 'TypeError: Assignment to constant variable.', exitCode: 1, timedOut: false }
    : { stdout: 'object\nnumber\n', stderr: '', exitCode: 0, timedOut: false };

describe('jstrain importer: exercise mapping', () => {
  it('maps bootcamp + tsbootcamp exercises to self-run drills with protected tests, fixtures, inverted hunts, tsc for TS', async () => {
    const root = miniMirror();
    const out = join(dir, 'out');
    const r = await importJstrain({ sourceDir: root, outDir: out, expected: null, gitHead: null, dirty: null, capture: fakeCapture });
    const pack = readPack(out, { allowUnstamped: true });
    expect(pack.manifest.grader).toBe('selfrun');
    expect(pack.manifest.track).toBe('js');
    const units = new Map(pack.courses.flatMap((c) => c.units.map((u) => [u.unit.key, { u, content: c.content[u.unit.key]! }] as const)));
    expect([...units.keys()].filter((k) => !k.includes('/quiz-')).sort()).toEqual([
      'jstrain/01-language-core/01-double',
      'jstrain/08-modules/02-seeded',
      'jstrain/24-debug-hunts/01-double',
      'jstrain/ts-01-types/01-typed',
    ]);
    const plain = units.get('jstrain/01-language-core/01-double')!;
    const spec = plain.u.unit.checks[0]!.spec;
    expect(spec).toMatchObject({ type: 'self-run', language: 'js', file: 'bootcamp/01-language-core/exercises/01-double.js', tsc: false, inverted: false });
    if (spec.type !== 'self-run') throw new Error('unreachable');
    expect(spec.files!.tests.startsWith('// ──────────────────────────── tests')).toBe(true);
    expect(plain.u.unit).toMatchObject({ kind: 'drill', track: 'js', difficulty: 2, phase: '01-language-core' });
    expect(plain.content.solution).not.toContain('\r'); // CRLF mirror bytes normalized
    expect(plain.content.explanation).toBe('return the doubled value.');
    expect(plain.content.instructions).toContain('Return n doubled.');
    expect(units.get('jstrain/24-debug-hunts/01-double')!.u.unit.checks[0]!.spec).toMatchObject({ inverted: true });
    expect(units.get('jstrain/24-debug-hunts/01-double')!.u.unit.competencies).toEqual(['code-reading']);
    const ts = units.get('jstrain/ts-01-types/01-typed')!.u.unit.checks[0]!.spec;
    expect(ts).toMatchObject({ language: 'ts', tsc: true, file: 'tsbootcamp/01-types/exercises/01-typed.ts' });
    const fx = units.get('jstrain/08-modules/02-seeded')!.u.unit.checks[0]!.spec;
    expect(fx).toMatchObject({ fixtures: ['bootcamp/08-modules/exercises/fixtures/seed.js'] });
    // excluded material is listed with counts and reasons, never silently dropped
    const ex = Object.fromEntries((pack.manifest.excluded ?? []).map((e) => [e.what, e]));
    expect(ex['bootcamp/13-dom-and-browser/exercises/*.html']).toMatchObject({ count: 1 });
    expect(ex['bootcamp/25-codebase-debug-hunts (multi-file apps)']).toMatchObject({ count: 1, ids: ['bootcamp/25-codebase-debug-hunts/exercises/01-app.js'] });
    expect(Object.keys(ex).some((k) => k.includes('vitest project'))).toBe(true);
    expect(r.manifest.totals).toEqual({ total: 7, code: 4, quiz: 0, output: 1, written: 2 });
  });

  it('imported specs actually grade: solution passes, starter is todo, hunt starter ships red (real runner)', async () => {
    const root = miniMirror();
    const out = join(dir, 'out');
    await importJstrain({ sourceDir: root, outDir: out, expected: null, gitHead: null, dirty: null, capture: fakeCapture });
    const pack = readPack(out, { allowUnstamped: true });
    for (const key of ['jstrain/01-language-core/01-double', 'jstrain/24-debug-hunts/01-double', 'jstrain/08-modules/02-seeded']) {
      const file = pack.courses.find((c) => c.units.some((u) => u.unit.key === key))!;
      const u = file.units.find((x) => x.unit.key === key)!;
      const spec = u.unit.checks[0]!.spec as SelfRunSpec;
      const c = file.content[key]!;
      expect((await runSelfRun(spec, c.solution!)).verdict).toBe('pass');
      expect((await runSelfRun(spec, c.starter!)).verdict).toBe(spec.inverted ? 'fail' : 'todo');
    }
  }, 60_000);

  it('refuses (never patches) a malformed exercise, listing every refusal at once', async () => {
    const a = jsPair('01', 'double');
    const root = writeTree({
      'bootcamp/01-x/exercises/01-double.js': a.ex.replace('// ──────────────────────────── tests', '// ---- tests'),
      'bootcamp/01-x/solutions/01-double.js': a.sol,
      'bootcamp/01-x/exercises/02-other.js': a.ex.replace('01 · double', '07 · double'),
      'bootcamp/01-x/solutions/02-other.js': a.sol,
      'tsbootcamp/README.md': '# TS\n',
      'quizzes/01-q.md': QUIZ,
    });
    await expect(importJstrain({ sourceDir: root, outDir: join(dir, 'out'), expected: null, gitHead: null, dirty: null, capture: fakeCapture })).rejects.toThrow(
      /2 exercise\(s\) refused:[\s\S]*01-double\.js: .*divider[\s\S]*02-other\.js: header number 07/,
    );
  });

  it('refuses when the census differs from the expected counts (before writing anything)', async () => {
    const root = miniMirror();
    const out = join(dir, 'out');
    await expect(
      importJstrain({ sourceDir: root, outDir: out, expected: { total: 1, code: 1, quiz: 0, output: 0, written: 0 }, gitHead: null, dirty: null, capture: fakeCapture }),
    ).rejects.toThrow(ImportError);
  });

  it('header parsing tolerates solution headers without concepts/stars; keys and course ids are stable', () => {
    expect(parseJsHeader('// ─────────────────────────\n//  18 · receiptFor — SOLUTION ★★☆ core\n//  run: x\n// ─────────────────────────\n//\n//  Walkthrough: y\n', 's', { solution: true })).toMatchObject({ number: '18', title: 'receiptFor', stars: 2, concepts: [] });
    expect(parseJsHeader('// ─────────────────────────\n//  23 · the migration — SOLUTION\n//  run: x\n// ─────────────────────────\n', 's', { solution: true }).number).toBe('23');
    expect(() => parseJsHeader('// ─────────────────────────\n//  23 · no stars\n', 'e')).toThrow();
    expect(courseIdFor('tsbootcamp', '08-debug-hunts')).toBe('ts-08-debug-hunts');
    expect(stableKey('01-language-core', '01-type-of')).toBe('jstrain/01-language-core/01-type-of');
  });
});

describe('jstrain importer: quiz bank routing (single-keyed or written)', () => {
  it('print questions with a clean deterministic run -> predict-output {runAs script, keyTokens}; throws / verbal -> written with rubric', async () => {
    const root = miniMirror();
    const out = join(dir, 'out');
    const r = await importJstrain({ sourceDir: root, outDir: out, expected: null, gitHead: null, dirty: null, capture: fakeCapture });
    expect(r.quizReport).toEqual({ predict: 1, written: 2, reasons: { 'snippet-throws (the answer is an exception, not output)': 1, 'not-a-print-question': 1 } });
    const file = PackCourseFile.parse(JSON.parse(readFileSync(join(out, 'quiz-01-language-core.json'), 'utf8')));
    const q1 = file.units.find((u) => u.unit.key === 'jstrain/quiz-01-language-core/q01')!;
    expect(q1.unit.kind).toBe('predict-output');
    expect(q1.unit.checks[0]!.spec).toMatchObject({ type: 'predict-output', language: 'js', expected: 'object\nnumber', runAs: 'script', keyTokens: ['object', 'number'] });
    expect(file.content['jstrain/quiz-01-language-core/q01']).toMatchObject({ snippet: 'console.log(typeof null);\nconsole.log(typeof 1);\n' });
    expect(file.content['jstrain/quiz-01-language-core/q01']!.instructions).not.toContain('```');
    const q2 = file.units.find((u) => u.unit.key === 'jstrain/quiz-01-language-core/q02')!;
    expect(q2.unit).toMatchObject({ kind: 'written', checks: [] });
    expect(file.content['jstrain/quiz-01-language-core/q02']!.rubric![0]!.label).toContain('TypeError');
    expect(file.content['jstrain/quiz-01-language-core/q03']!.solution).toContain('lexical environment');
  });

  it('parses items and keys; nondeterministic output routes to written', async () => {
    const { items } = parseQuizFile('01-language-core.md', QUIZ);
    expect(items.map((i) => [i.slug, i.title])).toEqual([
      ['q01', 'typeof zoo'],
      ['q02', 'const is not frozen'],
      ['q03', 'say it out loud'],
    ]);
    expect(answerKey(items[0]!.answer).tokens).toEqual(['object', 'number']);
    let n = 0;
    const flaky: QuizCapture = async () => ({ stdout: `run ${n++}\n`, stderr: '', exitCode: 0, timedOut: false });
    expect(await routeItem(items[0]!, flaky)).toEqual({ kind: 'written', reason: 'nondeterministic-output' });
  });

  it('the default capture runs the snippet for real in script (CommonJS) mode', async () => {
    const { items } = parseQuizFile('01-language-core.md', QUIZ);
    expect(await routeItem(items[0]!, (await import('./quiz.ts')).defaultCapture)).toMatchObject({ kind: 'predict', expected: 'object\nnumber' });
  }, 30_000);

  it('KEY_CORRECTIONS overlay: corrected tokens replace a wrong upstream key, and a stale / wrong correction REFUSES', async () => {
    // the real quarantined item's shape, upstream tokens exactly as shipped
    const md = `# 04 · Async — event loop\n\nCover.\n\n### Q10 — two independent chains\n\nWhat does this print, in what order?\n\n\`\`\`js\nsnippet();\n\`\`\`\n\n<details><summary>Answer</summary>\n\n**\`A1, B1, A2, B2, A3, B3\`** — interleaved.\n</details>\n`;
    const { items } = parseQuizFile('04-async-event-loop.md', md);
    const q10 = items[0]!;
    expect(q10.course).toBe('quiz-04-async-event-loop');
    expect(q10.slug).toBe('q10');
    const real = 'chain A1\nchain B1\nchain A2\nchain B2\nchain A3\nchain B3\n';
    const cap: QuizCapture = async () => ({ stdout: real, stderr: '', exitCode: 0, timedOut: false });
    const route = await routeItem(q10, cap);
    expect(route).toEqual({ kind: 'predict', snippet: 'snippet();\n', expected: real.trimEnd(), keyTokens: [...KEY_CORRECTIONS.get('quiz-04-async-event-loop/q10')!.tokens] });
    // stale: the upstream answer changed since the correction was verified -> loud refusal
    const stale = { ...q10, answer: q10.answer.replace('A1, B1, A2, B2, A3, B3', 'B1 first actually') };
    await expect(routeItem(stale, cap)).rejects.toThrow(/key-correction overlay is stale/);
    expect(() => correctedKeyTokens(stale, ['B1 first actually'])).toThrow(/stale/);
    // wrong: the captured output no longer carries the corrected tokens -> loud refusal
    const other: QuizCapture = async () => ({ stdout: 'something else entirely\n', stderr: '', exitCode: 0, timedOut: false });
    await expect(routeItem(q10, other)).rejects.toThrow(/key-correction token .* is not in the captured output/);
    // untouched items pass through unchanged
    expect(correctedKeyTokens({ file: 'x.md', number: 1, course: 'quiz-01-x', slug: 'q01' }, ['a'])).toEqual(['a']);
  });
});

describe('jstrain-cs: embedded csbootcamp, deduped against github csbootcamp (GitHub wins)', () => {
  it('dedup is by exercise NAME (module ids never match); reports exact + name overlap', () => {
    const exs = [
      { module: '01-csharp-language-core', slug: '03-value-vs-reference', exercise: '', solution: '' },
      { module: '01-csharp-language-core', slug: '01-fizzbuzz-range', exercise: '', solution: '' },
      { module: '01-language-core', slug: '01-count-vowels', exercise: '', solution: '' },
    ];
    const r = dedupAgainstGithub(exs, ['01-language-core/01-count-vowels', '01-language-core/02-value-vs-reference']);
    expect(r.kept.map((e) => e.slug)).toEqual(['01-fizzbuzz-range']);
    expect(r.exactOverlap).toEqual(['01-language-core/01-count-vowels']);
    expect(r.nameOverlap).toEqual([
      { embedded: '01-csharp-language-core/03-value-vs-reference', github: '01-language-core/02-value-vs-reference' },
      { embedded: '01-language-core/01-count-vowels', github: '01-language-core/01-count-vowels' },
    ]);
    expect(exerciseName('12-out-and-ref')).toBe('out-and-ref');
  });

  it('the committed github pack ids feed the dedup (real content/packs/csbootcamp)', () => {
    const ids = githubCsbootcampIds();
    expect(ids).toContain('01-language-core/01-count-vowels');
    expect(ids.length).toBe(31);
  });

  it('imports plain exercises as drill-cs harness jstrain with frozen given-sections; excludes #:sdk / dedup with counts', () => {
    const root = miniMirror();
    const out = join(dir, 'cs');
    const r = importJstrainCs({ sourceDir: root, outDir: out, githubIds: ['01-language-core/01-count-vowels'], expected: null, gitHead: null, dirty: null });
    expect(r.census).toEqual({ embedded: 3, dedupDropped: 1, exactOverlap: 0, runnerExcluded: 1, formatRefused: 0, imported: 1 });
    const pack = readPack(out, { allowUnstamped: true });
    expect(pack.manifest).toMatchObject({ source: 'jstrain-cs', track: 'csharp', grader: 'csharp' });
    const u = pack.courses[0]!.units[0]!;
    expect(u.unit.key).toBe('jstrain-cs/01-csharp-language-core/01-fizzbuzz');
    const spec = u.unit.checks[0]!.spec;
    if (spec.type !== 'drill-cs') throw new Error('unreachable');
    expect(spec.harness).toBe('jstrain');
    expect(spec.files.tests).toMatch(/^\/\/ ─+ tests ─+\n\nTest\("doubles"/);
    expect(spec.files.tests).not.toContain('record Box');
    expect(spec.files.tail).toContain('record Box(int V);');
    expect(spec.files.frozen).toEqual([{ label: 'given', body: 'record Box(int V);' }]);
    expect(foreignDirectives('#:sdk Microsoft.NET.Sdk.Web\n#:project ../../_lib/Check/Check.csproj\n')).toEqual(['#:sdk Microsoft.NET.Sdk.Web']);
    expect(needsAspNetFramework('using Microsoft.Extensions.DependencyInjection;\nTest("x", () => {});\n')).toBe(true);
    expect(needsAspNetFramework('// using Microsoft.Extensions.X is not needed here\nusing System.Linq;\n')).toBe(false);
    const excl = (pack.manifest.excluded ?? []).map((e) => [e.count, e.what]);
    expect(excl).toEqual([
      [1, 'csbootcamp/ exercises also in github elirc/csbootcamp (by exercise name)'],
      [1, 'csbootcamp/ exercises needing #:sdk Microsoft.NET.Sdk.Web, #:package or the ASP.NET Core shared framework'],
    ]);
    PackManifest.parse(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')));
  });
});

describe('mirror is read, never written', () => {
  it('readGitHead resolves a ref from .git files without running git', () => {
    const root = writeTree({ '.git/HEAD': 'ref: refs/heads/main\n', '.git/refs/heads/main': `${'c'.repeat(40)}\n` });
    expect(readGitHead(root)).toBe('c'.repeat(40));
    expect(readGitHead(join(dir, 'nope'))).toBeNull();
  });
});
