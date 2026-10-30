import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  CheckSpec,
  countPackUnits,
  PACK_FORMAT,
  PackCourseFile,
  PackManifest,
  type LessonSpec,
  type PackCounts,
  type PackUnit,
} from '@bootquest/shared';
import { UnitContentEntry } from '@bootquest/shared/api';
import { packBytes, sha256 } from '../bootforge/import.ts';
import { CSDRILLS_EXPECTED, ID_RE, ImportError, readModules, type CsdrillsExercise, type CsdrillsModule } from './source.ts';

/**
 * seed:import:csdrills — the committed csdrills authoring JSON
 * (tools/seed/authoring/csdrills/*.json, hand-written in this repo) → BootQuest
 * pack files (content/packs/csdrills/<module>.json + manifest.json). The csharp
 * track's authored drill bank: interview-shaped C# reps (set reconciliation, task
 * composition, flags, money, time, edge strings, hashing, data structures, thread
 * safety, CRUD endpoint logic).
 *
 * Mapping (one pack COURSE per authoring module; stable keys csdrills/<module>/<slug>):
 *   exercise → unit kind 'drill', track 'csharp', competency language-fluency,
 *              check drill-cs {shape console-check, harness jstrain, files {tests,
 *              tail, frozen: []}, timeoutMs 20000} graded by the real warm C#
 *              runner (manifest grader 'csharp') — byte-compatible in shape with
 *              the jstrain-cs units
 *   content  → instructions (skills + level header + the authored markdown),
 *              starter = starterHead + tests + tail (public), solution =
 *              solutionHead + tests + (solutionTail ?? tail) / explanation / hints
 *              (PRIVATE); spec.files.tail is always the STARTER's tail (jstrain-cs
 *              precedent — the grader composes with the learner's own tail)
 *   difficulty 1..3 → code XP 10 × difficulty
 * Import-time refusals (throw ImportError, write nothing): ids not NN-kebab,
 * duplicate slug, difficulty outside 1..3, empty instructions / starterHead /
 * solutionHead / tests / explanation, a starterHead without TODO or without
 * `using static Bootcamp.Check;`, solutionHead === starterHead, a solutionHead
 * still throwing NotImplementedException, any `#:` directive, a tests block that
 * does not open with the tests divider / does not end with a newline / contains a
 * further section divider, a tests divider in a head or the tail, a tail that does
 * not open with a section divider, a solutionTail without a tail / identical to it /
 * still throwing NotImplementedException / not opening with a section divider (with a
 * solutionTail the TODO marker may sit in starterHead or tail), a duplicate literal Test("…") name,
 * fewer than 4 or more than 8 of them, none containing "(boundary", a pasteable hint 3
 * (`;`, `=>`, `return` or parentheses), and a census that
 * differs from the expected counts. Output is deterministic: same authoring bytes →
 * same pack bytes (the manifest's importedFrom.path / gitHead / dirty record where
 * it came from).
 */

export const SOURCE_KEY = 'csdrills';
export const TRACK = 'csharp' as const;
export const GRADER = 'csharp' as const;
export const REPO_NAME = 'elirc/selfboot';
export const AUTHORING_SUBPATH = 'tools/seed/authoring/csdrills';
/** per graded run (the jstrain-cs value: compile + run under the warm runner) */
export const DRILL_TIMEOUT_MS = 20000;
export const LESSON_ID = 'drills';
/** every drill registers 4-8 literal Test("…") names, at least one of them containing "(boundary" */
export const MIN_TESTS = 4;
export const MAX_TESTS = 8;

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
export const DEFAULT_AUTHORING_DIR = join(REPO, ...AUTHORING_SUBPATH.split('/'));
export const DEFAULT_OUT_DIR = join(REPO, 'content', 'packs', SOURCE_KEY);

export { CSDRILLS_EXPECTED, ImportError };

export const stableKey = (module: string, slug: string): string => `${SOURCE_KEY}/${module}/${slug}`;

// ── the runner's divider grammar (server/src/runners/csharp/csbootcamp-split.ts), ported —
// the importer never imports server runner code ───────────────────────────────────────
/** the tests divider anywhere in a text (TESTS_MARKER) */
const TESTS_MARKER = /^\/\/ ─+ tests ─+\s*$/m;
/** the tests divider as the block's first line */
const TESTS_FIRST_LINE = /^\/\/ ─+ tests ─+$/;
/** any labelled divider (SECTION_DIVIDER): where a jstrain tests block ends */
const SECTION_DIVIDER = /^\/\/ ─+ \S.*? ─+[ \t]*$/m;
const SECTION_FIRST_LINE = /^\/\/ ─+ \S.*? ─+[ \t]*$/;
const DIRECTIVE = /^#:/m;

function unescapeCs(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|x[0-9a-fA-F]{1,4}|.)/g, (_, e: string) => {
    if (e[0] === 'u' || e[0] === 'U' || (e[0] === 'x' && e.length > 1)) return String.fromCodePoint(parseInt(e.slice(1), 16));
    return ({ n: '\n', t: '\t', r: '\r', 0: '\0', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b' } as Record<string, string>)[e] ?? e;
  });
}

/** The plain-string-literal names a tests block registers (port of the runner's literalTestNames). */
export function literalTestNames(tests: string): string[] {
  const names: string[] = [];
  const code = tests.replace(/\r\n/g, '\n').replace(/^\s*\/\/.*$/gm, ''); // whole-line comments register nothing
  for (const m of code.matchAll(/(?<![\w.])(?:Check\.)?Test\(\s*"((?:[^"\\\n]|\\.)*)"\s*,/g)) names.push(unescapeCs(m[1]!));
  return names;
}

export interface MappedExercise {
  packUnit: PackUnit;
  content: UnitContentEntry;
}

const stars = (d: number): string => `${'★'.repeat(d)}${'☆'.repeat(3 - d)}`;

/** Map one authored exercise to a pack unit + content entry (both Zod-validated). */
export function mapExercise(module: string, ex: CsdrillsExercise, position: number): MappedExercise {
  const label = `${module}/${ex.slug}`;
  const fail = (msg: string): never => {
    throw new ImportError(`${label}: ${msg}`);
  };
  if (!ID_RE.test(module)) fail(`module id must match ${ID_RE}`);
  if (!ID_RE.test(ex.slug)) fail(`slug must match ${ID_RE}`);
  if (!Number.isInteger(ex.difficulty) || ex.difficulty < 1 || ex.difficulty > 3) fail(`difficulty ${ex.difficulty} out of range 1..3`);
  if (!ex.instructions.trim()) fail('empty instructions');
  if (!ex.starterHead.trim()) fail('empty starterHead');
  if (!ex.solutionHead.trim()) fail('empty solutionHead');
  if (!ex.tests.trim()) fail('empty tests');
  if (!ex.explanation.trim()) fail('empty explanation');
  if (ex.solutionTail !== undefined) {
    // a class drill: the learner's work lives in the tail (types must follow the top-level statements)
    if (ex.tail === undefined) fail('solutionTail without a tail (the starter needs the stubbed types section)');
    if (ex.solutionTail === ex.tail) fail('solutionTail is identical to the tail (the starter types section)');
    if (ex.solutionTail.includes('NotImplementedException')) fail('solutionTail still contains NotImplementedException (its tests would report todo)');
    if (!/\bTODO\b/.test(ex.starterHead + (ex.tail ?? ''))) fail('neither starterHead nor tail has a TODO marker (the learner must see what to write)');
  } else if (!/\bTODO\b/.test(ex.starterHead)) fail('starterHead has no TODO marker (the learner must see what to write)');
  if (!ex.starterHead.includes('using static Bootcamp.Check;')) fail('starterHead lacks `using static Bootcamp.Check;` (the harness API)');
  if (ex.solutionHead === ex.starterHead) fail('solutionHead is identical to the starterHead');
  if (ex.solutionHead.includes('NotImplementedException')) fail('solutionHead still contains NotImplementedException (its tests would report todo)');
  const sections: [string, string | undefined][] = [
    ['starterHead', ex.starterHead],
    ['solutionHead', ex.solutionHead],
    ['tests', ex.tests],
    ['tail', ex.tail],
    ['solutionTail', ex.solutionTail],
  ];
  for (const [name, text] of sections) {
    if (text !== undefined && DIRECTIVE.test(text)) fail(`${name} contains a \`#:\` file-based-app directive (unsupported: the warm runner references Check.dll itself)`);
  }
  const firstLine = ex.tests.split('\n', 1)[0]!;
  if (!TESTS_FIRST_LINE.test(firstLine)) fail('tests must start (first line) with the `// ─── tests ───` divider');
  if (!ex.tests.endsWith('\n')) fail('tests must end with a newline');
  if (SECTION_DIVIDER.test(ex.tests.slice(firstLine.length))) fail('tests contain a further section divider (the runner would end the tests block there)');
  for (const [name, text] of [['starterHead', ex.starterHead], ['solutionHead', ex.solutionHead], ['tail', ex.tail], ['solutionTail', ex.solutionTail]] as const) {
    if (text !== undefined && TESTS_MARKER.test(text)) fail(`${name} contains a tests divider (only the tests block may)`);
  }
  if (ex.tail !== undefined && !SECTION_FIRST_LINE.test(ex.tail.split('\n', 1)[0]!)) fail('tail must start (first line) with a labelled section divider such as `// ─── types ───`');
  if (ex.solutionTail !== undefined && !SECTION_FIRST_LINE.test(ex.solutionTail.split('\n', 1)[0]!)) fail('solutionTail must start (first line) with a labelled section divider such as `// ─── types ───`');
  const names = literalTestNames(ex.tests);
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) fail(`duplicate test name ${JSON.stringify(n)}`);
    seen.add(n);
  }
  if (names.length < MIN_TESTS || names.length > MAX_TESTS) {
    fail(`tests register ${names.length} literal Test("…") name(s); ${MIN_TESTS}-${MAX_TESTS} required`);
  }
  if (!names.some((n) => n.includes('(boundary'))) fail('no test name contains "(boundary": every drill needs at least one boundary test');
  const h3 = ex.hints[2]!;
  if (/;|=>|\breturn\b|[()]/.test(h3)) fail('hint 3 must be approach in words, never pasteable code (no `;`, `=>`, `return` or parentheses)');

  const tail = ex.tail ?? '';
  const key = stableKey(module, ex.slug);
  const spec = CheckSpec.parse({
    type: 'drill-cs',
    shape: 'console-check',
    files: { tests: ex.tests, tail, frozen: [] },
    harness: 'jstrain',
    timeoutMs: DRILL_TIMEOUT_MS,
  });
  const unit = {
    key,
    track: TRACK,
    kind: 'drill',
    title: ex.title,
    phase: module,
    difficulty: ex.difficulty,
    competencies: ['language-fluency'],
    prerequisites: [],
    checks: [{ spec }],
  } as LessonSpec;
  const header = `${ex.skills.length ? `**Skills:** ${ex.skills.join(' · ')}  \n` : ''}**Level:** ${stars(ex.difficulty)}`;
  const content = UnitContentEntry.parse({
    instructions: `${header}\n\n${ex.instructions.trim()}\n`,
    starter: ex.starterHead + ex.tests + tail,
    solution: ex.solutionHead + ex.tests + (ex.solutionTail ?? tail),
    explanation: ex.explanation,
    hints: ex.hints,
  });
  const origin = {
    id: `${module}/${ex.slug}`,
    type: 'code' as const,
    module,
    lesson: LESSON_ID,
    position,
    skills: ex.skills,
  };
  return { packUnit: { unit, origin } as PackUnit, content };
}

/** Build one pack course file (validated) from an authoring module. */
export function buildCourseFile(m: CsdrillsModule): PackCourseFile {
  const units: PackUnit[] = [];
  const content: Record<string, UnitContentEntry> = {};
  m.exercises.forEach((ex, i) => {
    const mapped = mapExercise(m.module, ex, i);
    units.push(mapped.packUnit);
    content[mapped.packUnit.unit.key] = mapped.content;
  });
  return PackCourseFile.parse({
    format: PACK_FORMAT,
    source: SOURCE_KEY,
    course: { id: m.module, order: m.order, title: m.title, description: m.description, prerequisites: [] },
    modules: [{ id: m.module, title: m.title, lessons: [{ id: LESSON_ID, title: m.title, explanation: m.description }] }],
    units,
    content,
  });
}

/** git HEAD + dirtiness of the authoring dir (copy of bootforge's gitInfo; null outside a work tree). */
function gitInfo(dir: string): { gitHead: string | null; dirty: boolean | null } {
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const gitHead = git(['rev-parse', 'HEAD']);
    const dirty = git(['status', '--porcelain', '--', '.']).length > 0;
    return { gitHead, dirty };
  } catch {
    return { gitHead: null, dirty: null };
  }
}

export interface ImportOptions {
  /** the authoring dir (contains <NN-module>.json) */
  authoringDir: string;
  outDir: string;
  /** counts the authoring must have (null = no expectation, e.g. test fixtures) */
  expected: PackCounts | null;
  /** record git HEAD/dirty of the authoring dir (off for fixtures: deterministic bytes) */
  recordGit?: boolean;
}

export interface ImportResult {
  manifest: PackManifest;
  written: string[];
  removed: string[];
}

/** Import every module (read-only) and write the pack. Every refusal runs BEFORE anything is written. */
export function importCsdrills(opts: ImportOptions): ImportResult {
  const modules = readModules(opts.authoringDir);
  const built = modules.map((m) => {
    const file = buildCourseFile(m);
    return { file, bytes: packBytes(file) };
  });
  const courses = built.map(({ file, bytes }) => ({
    id: file.course.id,
    order: file.course.order,
    file: `${file.course.id}.json`,
    sha256: sha256(bytes),
    counts: countPackUnits(file.units),
  }));
  const totals = { total: 0, code: 0, quiz: 0, output: 0, written: 0 };
  for (const c of courses) for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += c.counts[k];
  if (opts.expected && JSON.stringify(totals) !== JSON.stringify(opts.expected)) {
    throw new ImportError(`source counts ${JSON.stringify(totals)} differ from the expected ${JSON.stringify(opts.expected)}; refusing to write`);
  }
  const git = opts.recordGit ? gitInfo(opts.authoringDir) : { gitHead: null, dirty: null };
  const manifest = PackManifest.parse({
    format: PACK_FORMAT,
    source: SOURCE_KEY,
    track: TRACK,
    grader: GRADER,
    importedFrom: {
      repo: REPO_NAME,
      originKind: 'local',
      subpath: AUTHORING_SUBPATH,
      path: resolve(opts.authoringDir).replace(/\\/g, '/'),
      ...git,
    },
    expected: opts.expected,
    totals,
    courses,
  });

  mkdirSync(opts.outDir, { recursive: true });
  // validation.json is kept: the loader compares its manifest sha256, so a changed import is refused until re-validated
  const keep = new Set(['manifest.json', 'quarantine.json', 'validation.json', ...courses.map((c) => c.file)]);
  const removed: string[] = [];
  for (const f of readdirSync(opts.outDir)) {
    if (f.endsWith('.json') && !keep.has(f)) {
      rmSync(join(opts.outDir, f));
      removed.push(f);
    }
  }
  const written: string[] = [];
  for (const { file, bytes } of built) {
    const path = join(opts.outDir, `${file.course.id}.json`);
    writeFileSync(path, bytes);
    written.push(basename(path));
  }
  writeFileSync(join(opts.outDir, 'manifest.json'), packBytes(manifest));
  written.push('manifest.json');
  return { manifest, written, removed };
}
