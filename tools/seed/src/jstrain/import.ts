import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CheckSpec,
  countPackUnits,
  PACK_FORMAT,
  PackCourseFile,
  PackManifest,
  type CompetencyId,
  type LessonSpec,
  type PackCounts,
  type PackExclusion,
  type PackUnit,
} from '@bootquest/shared';
import { UnitContentEntry } from '@bootquest/shared/api';
import { frozenBlocks, isHuntModule, splitSelfRun } from '@bootquest/server/runners/self-run/compose';
import { packBytes, sha256 } from '../bootforge/import.ts';
import { readmeMeta } from '../csbootcamp/import.ts';
import { buildQuizCourses, type QuizCapture } from './quiz.ts';
import { JSTRAIN_REPO, parseJsHeader, readExerciseModules, readVitestProjectCensus, type SourceExercise, type SourceModule } from './source.ts';

/**
 * seed:import:jstrain — jstrain2.2 (claiufe mirror, READ-ONLY) → the `jstrain`
 * pack (content/packs/jstrain/: one course file per module + manifest.json),
 * track js, graded by the `selfrun` grader kind. The embedded csbootcamp/ is a
 * separate pack (`jstrain-cs`, ./cs.ts) because a pack has one track + grader.
 *
 * Mapping (stable keys jstrain/<course>/<exercise>; course = upstream module,
 * `ts-` prefixed for tsbootcamp, `quiz-` for the quiz bank):
 *   bootcamp/tsbootcamp exercise → unit kind 'drill', track js, check self-run
 *       {language js|ts, file, tsc (TS), fixtures, inverted (*-debug / *-hunts),
 *        files: {tests = the EXERCISE's protected block, fixture bytes, frozen
 *        scaffolding}}; content: instructions = concepts/level + the header
 *        prompt; starter = exercise file verbatim (LF); solution = solution file
 *        verbatim (PRIVATE); explanation = its Walkthrough (PRIVATE)
 *   quizzes/NN-*.md item → predict-output (runAs script, keyTokens) or written
 *       (self-assessed) — see quiz.ts
 * Import-time format checks REFUSE (never patch): headers parse, exercise and
 * solution pair up (header numbers agree), the exercise has a tests divider and test(...) calls,
 * fixtures identical in exercises/ and solutions/, the upstream harness equals
 * the copy the runner type-checks against.
 */

export const SOURCE_KEY = 'jstrain';
export const TRACK = 'js' as const;
export const SELFRUN_TIMEOUT_MS = 30_000;

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
export const DEFAULT_OUT_DIR = join(REPO, 'content', 'packs', SOURCE_KEY);

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** pack course id of an upstream module */
export const courseIdFor = (track: 'bootcamp' | 'tsbootcamp', module: string): string => (track === 'tsbootcamp' ? `ts-${module}` : module);
export const stableKey = (course: string, slug: string): string => `${SOURCE_KEY}/${course}/${slug}`;

const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** competency tag by module theme (informational; evidence routing) */
export function competencyFor(module: string): CompetencyId {
  if (/-debug|-hunts?$/.test(module)) return 'code-reading';
  if (/testing|write-the-test/.test(module)) return 'testing-verification';
  if (/http|persistence|sql|api-consumer/.test(module)) return 'data-http';
  return 'language-fluency';
}

export interface MappedExercise {
  packUnit: PackUnit;
  content: UnitContentEntry;
}

/** Map one exercise (+ its solution) to a pack unit + content entry. */
export function mapExercise(ex: SourceExercise, position: number): MappedExercise {
  const label = `${ex.track}/${ex.module}/${ex.fileName}`;
  const fail = (msg: string): never => {
    throw new ImportError(`${label}: ${msg}`);
  };
  let exH;
  let solH;
  let exSplit;
  let solSplit;
  try {
    exH = parseJsHeader(ex.exercise, `${label} (exercise)`);
    solH = parseJsHeader(ex.solution, `${label} (solution)`, { solution: true });
    exSplit = splitSelfRun(ex.exercise);
    solSplit = splitSelfRun(ex.solution);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (!/^\d{2}-/.test(ex.slug) || ex.slug.slice(0, 2) !== exH.number) fail(`header number ${exH.number} does not match the file name`);
  if (solH.number !== exH.number) fail(`solution header number ${solH.number} differs from the exercise (${exH.number})`);
  // FORMAT.md says solutions repeat the SAME tests; the solution is graded against the EXERCISE's
  // tests anyway (never its own copy), so the gate — not a text compare — decides
  if (!/^\s*test\(/m.test(exSplit.tests)) fail('tests block has no test(...) call');
  if (exH.stars < 1 || exH.stars > 3) fail(`difficulty ${exH.stars} stars out of range`);
  if (!exH.body.trim()) fail('exercise has no prompt');
  if (exH.concepts.length === 0) fail('exercise header has no concepts: line');

  const course = courseIdFor(ex.track, ex.module);
  const key = stableKey(course, ex.slug);
  const isTs = ex.fileName.endsWith('.ts');
  const inverted = isHuntModule(ex.module);
  const fixturePaths = Object.keys(ex.fixtures).sort();
  const spec = CheckSpec.parse({
    type: 'self-run',
    language: isTs ? 'ts' : 'js',
    file: `${ex.track}/${ex.module}/exercises/${ex.fileName}`,
    tsc: isTs,
    fixtures: fixturePaths,
    inverted,
    timeoutMs: SELFRUN_TIMEOUT_MS,
    files: {
      tests: exSplit.tests,
      fixtures: Object.fromEntries(fixturePaths.map((p) => [p, ex.fixtures[p]!])),
      frozen: frozenBlocks(exSplit.head, solSplit.head),
    },
  });
  const unit = {
    key,
    track: TRACK,
    kind: 'drill',
    title: capitalize(exH.title),
    phase: course,
    difficulty: exH.stars,
    competencies: [competencyFor(ex.module)],
    prerequisites: [],
    checks: [{ spec }],
  } as LessonSpec;
  const level = `${'★'.repeat(exH.stars)}${'☆'.repeat(3 - exH.stars)} ${exH.tier}`;
  const mode = inverted
    ? '**Debug hunt:** the code below ships with a planted bug — the tests fail until you find and fix it.'
    : isTs
      ? '**TypeScript:** `tsc --strict` must be clean (type errors are part of the todo list) and every test green.'
      : '';
  const instructions = [`**Concepts:** ${exH.concepts.join(' · ')}  \n**Level:** ${level}`, ...(mode ? ['', mode] : []), '', exH.body, ''].join('\n');
  // the solution header's Walkthrough (capstones carry none: their walkthrough lives in the code comments)
  const walkthrough = solH.body.replace(/^Walkthrough\s*[:—-]?\s*/, '').trim();
  const content = UnitContentEntry.parse({ instructions, starter: ex.exercise, solution: ex.solution, ...(walkthrough ? { explanation: walkthrough } : {}) });
  const origin = {
    id: `${ex.track}/${ex.module}/${ex.slug}`,
    type: 'code' as const,
    module: ex.module,
    lesson: 'readme',
    position,
    format: inverted ? 'debugging' : isTs ? 'typescript' : 'self-run',
    skills: exH.concepts,
  };
  return { packUnit: { unit, origin } as PackUnit, content };
}

/** One pack course file per upstream exercise module. */
export function buildModuleCourse(m: SourceModule, order: number): PackCourseFile {
  const course = courseIdFor(m.track, m.id);
  const meta = readmeMeta(m.readme, m.id);
  const title = m.track === 'tsbootcamp' ? `TS · ${meta.title}` : meta.title;
  const units: PackUnit[] = [];
  const content: Record<string, UnitContentEntry> = {};
  const errors: string[] = [];
  m.exercises.forEach((ex, i) => {
    try {
      const mapped = mapExercise(ex, i);
      units.push(mapped.packUnit);
      content[mapped.packUnit.unit.key] = mapped.content;
    } catch (err) {
      if (!(err instanceof ImportError)) throw err;
      errors.push(err.message);
    }
  });
  // every refusal of the module at once (never patch, never skip silently)
  if (errors.length) throw new ImportError(errors.join('\n'));
  return PackCourseFile.parse({
    format: PACK_FORMAT,
    source: SOURCE_KEY,
    course: { id: course, order, title, description: meta.description, prerequisites: [] },
    modules: [{ id: m.id, title, lessons: [{ id: 'readme', title, explanation: m.readme }] }],
    units,
    content,
  });
}

export interface ImportOptions {
  /** root of the jstrain2.2 checkout (READ-ONLY) */
  sourceDir: string;
  outDir: string;
  /** counts the source must have (null = no expectation, e.g. test fixtures) */
  expected: PackCounts | null;
  gitHead: string | null;
  dirty: boolean | null;
  /** quiz snippet capture (injectable for tests); default runs `node snippet.js` */
  capture?: QuizCapture;
  /** compare upstream _lib harness files with the runner's copies (off for fixtures) */
  checkHarness?: boolean;
  log?: (line: string) => void;
}

export interface ImportResult {
  manifest: PackManifest;
  written: string[];
  removed: string[];
  quizReport: { predict: number; written: number; reasons: Record<string, number> };
}

/** Write a pack dir: course files + manifest, prune stale course files (stamp/quarantine kept). */
export function writePack(outDir: string, built: { file: PackCourseFile; bytes: string }[], manifest: PackManifest): { written: string[]; removed: string[] } {
  mkdirSync(outDir, { recursive: true });
  // validation.json is kept: the loader compares its manifest sha256, so a changed import is refused until re-validated
  const keep = new Set(['manifest.json', 'quarantine.json', 'validation.json', ...built.map((b) => `${b.file.course.id}.json`)]);
  const removed: string[] = [];
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.json') && !keep.has(f)) {
      rmSync(join(outDir, f));
      removed.push(f);
    }
  }
  const written: string[] = [];
  for (const { file, bytes } of built) {
    writeFileSync(join(outDir, `${file.course.id}.json`), bytes);
    written.push(`${file.course.id}.json`);
  }
  writeFileSync(join(outDir, 'manifest.json'), packBytes(manifest));
  written.push('manifest.json');
  return { written, removed };
}

export function manifestCourses(built: { file: PackCourseFile; bytes: string }[]): { courses: PackManifest['courses']; totals: PackCounts } {
  const courses = built.map(({ file, bytes }) => ({
    id: file.course.id,
    order: file.course.order,
    file: `${file.course.id}.json`,
    sha256: sha256(bytes),
    counts: countPackUnits(file.units),
  }));
  const totals = { total: 0, code: 0, quiz: 0, output: 0, written: 0 };
  for (const c of courses) for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += c.counts[k];
  return { courses, totals };
}

/** Import exercises + quizzes (read-only) and write the pack. Assertions run BEFORE anything is written. */
export async function importJstrain(opts: ImportOptions): Promise<ImportResult> {
  const log = opts.log ?? (() => {});
  if (opts.checkHarness) assertHarnessMatches(opts.sourceDir);
  const { modules, skipped } = readExerciseModules(opts.sourceDir);
  const built: { file: PackCourseFile; bytes: string }[] = [];
  let order = 1;
  const errors: string[] = [];
  for (const m of modules) {
    try {
      const file = buildModuleCourse(m, order++);
      built.push({ file, bytes: packBytes(file) });
    } catch (err) {
      if (!(err instanceof ImportError)) throw err;
      errors.push(err.message);
    }
  }
  if (errors.length) throw new ImportError(`${errors.join('\n').split('\n').length} exercise(s) refused:\n${errors.join('\n')}`);
  log(`exercises: ${modules.length} modules, ${built.reduce((n, b) => n + b.file.units.length, 0)} self-run drills`);
  const quiz = await buildQuizCourses(opts.sourceDir, order, opts.capture);
  for (const file of quiz.courses) built.push({ file, bytes: packBytes(file) });
  log(`quizzes: ${quiz.report.predict} predict-output + ${quiz.report.written} written (${JSON.stringify(quiz.report.reasons)})`);

  const ids = new Set<string>();
  for (const b of built) {
    if (ids.has(b.file.course.id)) throw new ImportError(`duplicate course id ${b.file.course.id}`);
    ids.add(b.file.course.id);
  }
  const { courses, totals } = manifestCourses(built);
  if (opts.expected && JSON.stringify(totals) !== JSON.stringify(opts.expected)) {
    throw new ImportError(`source counts ${JSON.stringify(totals)} differ from the expected ${JSON.stringify(opts.expected)}; refusing to write`);
  }
  const excluded: PackExclusion[] = skipped.map((s) => ({ what: s.what, count: s.ids.length, reason: s.reason, ...(s.ids.length <= 50 ? { ids: s.ids } : {}) }));
  const vitest = readVitestProjectCensus(opts.sourceDir);
  if (vitest.files > 0) {
    excluded.push({
      what: `jstrain/exercises/{${vitest.tracks.join(',')}} (vitest project)`,
      count: vitest.files,
      reason: 'a separate vitest + React project (multi-problem files graded by separate *.test files, jsdom, @testing-library): vitest-project format, no runner yet — not self-run',
    });
  }
  excluded.push({
    what: 'csbootcamp/ (embedded C# track)',
    count: 1,
    reason: 'imported as its own pack `jstrain-cs` (track csharp, drill-cs, deduped against elirc/csbootcamp): a pack carries one track and one grader',
  });
  const manifest = PackManifest.parse({
    format: PACK_FORMAT,
    source: SOURCE_KEY,
    track: TRACK,
    grader: 'selfrun',
    excluded,
    importedFrom: {
      repo: JSTRAIN_REPO,
      originKind: 'local-mirror',
      subpath: '',
      path: resolve(opts.sourceDir).replace(/\\/g, '/'),
      gitHead: opts.gitHead,
      dirty: opts.dirty,
    },
    expected: opts.expected,
    totals,
    courses,
  });
  const { written, removed } = writePack(opts.outDir, built, manifest);
  return { manifest, written, removed, quizReport: quiz.report };
}

/** The upstream harness files must equal the runner's reference copies (refresh deliberately, never drift). */
export function assertHarnessMatches(sourceDir: string): void {
  const pairs: [string, string][] = [
    [join(sourceDir, 'bootcamp', '_lib', 'check.js'), join(REPO, 'server', 'src', 'runners', 'self-run', 'fixtures', 'jstrain', 'bootcamp', '_lib', 'check.js')],
    [join(sourceDir, 'tsbootcamp', '_lib', 'check.ts'), join(REPO, 'server', 'src', 'runners', 'self-run', 'fixtures', 'jstrain', 'tsbootcamp', '_lib', 'check.ts')],
    [join(sourceDir, 'tsbootcamp', '_lib', 'type-assert.ts'), join(REPO, 'server', 'src', 'runners', 'self-run', 'fixtures', 'jstrain', 'tsbootcamp', '_lib', 'type-assert.ts')],
  ];
  for (const [up, mine] of pairs) {
    if (readTextSafe(up) !== readTextSafe(mine)) {
      throw new ImportError(`upstream ${up} differs from the runner's reference copy ${mine}; refresh the runner fixture (and bq-check.mjs) deliberately first`);
    }
  }
}

const readTextSafe = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n') : null);
