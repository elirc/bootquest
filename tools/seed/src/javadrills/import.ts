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
import { literalTestNames, splitAtTestsMarker, type SplitFile } from '@bootquest/server/runners/java/split';
import { packBytes, sha256 } from '../bootforge/import.ts';
import { ID_RE, ImportError, JAVADRILLS_EXPECTED, readModules, type JavadrillsExercise, type JavadrillsModule } from './source.ts';

/**
 * seed:import:javadrills — the committed javadrills authoring JSON
 * (tools/seed/authoring/javadrills/*.json, hand-written in this repo) → BootQuest
 * pack files (content/packs/javadrills/<module>.json + manifest.json). The Java
 * track's authored drill bank, complementing javabootcamp.
 *
 * Mapping (one pack COURSE per authoring module; stable keys javadrills/<module>/<slug>):
 *   exercise → unit kind 'drill', track 'java', competency language-fluency,
 *              check drill-java {files:{tests, tail}, className Exercise, timeoutMs 10000}
 *              — the starter's `// ─── tests ───` line through `// ─── end tests ───`
 *              and what follows (the class's closing brace). Graded by the real Java
 *              runner (manifest has NO grader field: track java derives kind java,
 *              exactly like javabootcamp).
 *   content  → instructions (skills + level header + the authored markdown),
 *              starter (public), solution / explanation / hints (PRIVATE)
 *   difficulty 1..3 → code XP 10 × difficulty
 * Import-time refusals (throw ImportError, write nothing): ids not NN-kebab,
 * duplicate slug, empty instructions / starter / solution, solution === starter,
 * a starter without TODO, difficulty outside 1..3, a starter or solution without
 * the tests / end-tests markers, a solution whose tests block differs from the
 * starter's by even one byte, no `class Exercise` or a `package` statement, a tests
 * block without test(...) / report() / a literal test name, fewer than 4 or more
 * than 8 literally named tests, a duplicate test name, no test named with "(boundary)", a pasteable
 * hint 3 (`;`, `return` or a parenthesis — hint 3 is the approach in words), and a census that
 * differs from the expected counts. Output is deterministic: same authoring bytes →
 * same pack bytes (the manifest's importedFrom.path / gitHead / dirty record where it
 * came from).
 */

export const SOURCE_KEY = 'javadrills';
export const TRACK = 'java' as const;
export const CLASS_NAME = 'Exercise';
export const REPO_NAME = 'elirc/selfboot';
export const AUTHORING_SUBPATH = 'tools/seed/authoring/javadrills';
/** per graded run (the Java runner's own default; javac has its own cap) */
export const JAVA_TIMEOUT_MS = 10_000;
export const LESSON_ID = 'drills';

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
export const DEFAULT_AUTHORING_DIR = join(REPO, ...AUTHORING_SUBPATH.split('/'));
export const DEFAULT_OUT_DIR = join(REPO, 'content', 'packs', SOURCE_KEY);

export { ImportError, JAVADRILLS_EXPECTED };

export const stableKey = (module: string, slug: string): string => `${SOURCE_KEY}/${module}/${slug}`;

export interface MappedExercise {
  packUnit: PackUnit;
  content: UnitContentEntry;
}

const stars = (d: number): string => `${'★'.repeat(d)}${'☆'.repeat(3 - d)}`;

/** Map one authored exercise to a pack unit + content entry (both Zod-validated). */
export function mapExercise(module: string, ex: JavadrillsExercise, position: number): MappedExercise {
  const label = `${module}/${ex.slug}`;
  const fail = (msg: string): never => {
    throw new ImportError(`${label}: ${msg}`);
  };
  if (!ID_RE.test(module)) fail(`module id must match ${ID_RE}`);
  if (!ID_RE.test(ex.slug)) fail(`slug must match ${ID_RE}`);
  if (!Number.isInteger(ex.difficulty) || ex.difficulty < 1 || ex.difficulty > 3) fail(`difficulty ${ex.difficulty} out of range 1..3`);
  if (!ex.instructions.trim()) fail('empty instructions');
  if (!ex.starter.trim()) fail('empty starter');
  if (!ex.solution.trim()) fail('empty solution');
  if (ex.solution === ex.starter) fail('solution is identical to the starter');
  if (!/\bTODO\b/.test(ex.starter)) fail('starter has no TODO marker (the learner must see what to write)');
  if (ex.hints.length !== 3) fail(`needs exactly 3 hints (has ${ex.hints.length})`);
  if (/;|\breturn\b|[()]/.test(ex.hints[2]!)) fail('hint 3 must be the approach in words, never pasteable code (no `;`, `return` or parentheses)');

  let exSplit: SplitFile | undefined;
  let solSplit: SplitFile | undefined;
  for (const [which, src] of [['starter', ex.starter], ['solution', ex.solution]] as const) {
    try {
      const split = splitAtTestsMarker(src);
      if (which === 'starter') exSplit = split;
      else solSplit = split;
    } catch (err) {
      fail(`${which}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!exSplit || !solSplit) return fail('unreachable: split failed');
  if (solSplit.tests !== exSplit.tests) fail('the solution does not repeat the starter tests byte-for-byte');
  if (!/^\s*test\(/m.test(exSplit.tests)) fail('tests block has no test(...) call');
  if (!/\breport\(\)/.test(exSplit.tests)) fail('tests block never calls report()');
  const testNames = literalTestNames(exSplit.tests);
  if (testNames.length === 0) fail('tests block names no test with a string literal');
  const dup = testNames.find((n, i) => testNames.indexOf(n) !== i);
  if (dup !== undefined) fail(`duplicate test name ${JSON.stringify(dup)}`);
  if (testNames.length < 4 || testNames.length > 8) fail(`needs 4-8 literally named tests (has ${testNames.length})`);
  if (!testNames.some((n) => n.includes('(boundary)'))) fail('needs at least one test named with "(boundary)"');
  for (const [which, src] of [['starter', ex.starter], ['solution', ex.solution]] as const) {
    if (!new RegExp(`^\\s*(?:final\\s+)?class\\s+${CLASS_NAME}\\b`, 'm').test(src)) fail(`${which} does not declare \`class ${CLASS_NAME}\``);
    if (/^\s*package\s+[\w.]+\s*;/m.test(src)) fail(`${which} declares a package (exercises live in the default package)`);
  }

  const key = stableKey(module, ex.slug);
  const spec = CheckSpec.parse({
    type: 'drill-java',
    files: { tests: exSplit.tests, tail: exSplit.tail },
    className: CLASS_NAME,
    timeoutMs: JAVA_TIMEOUT_MS,
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
    starter: ex.starter,
    solution: ex.solution,
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
export function buildCourseFile(m: JavadrillsModule): PackCourseFile {
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
export function importJavadrills(opts: ImportOptions): ImportResult {
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
