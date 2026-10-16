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
import { literalTestNames, splitAtTestsMarker } from '@bootquest/server/runners/java/split';
import { packBytes, sha256 } from '../bootforge/import.ts';
import { readmeMeta } from '../csbootcamp/import.ts';
import { parseHeader, readText } from '../csbootcamp/source.ts';
import { HARNESS_FILES, JAVABOOTCAMP_REPO, JAVABOOTCAMP_SHA, readModules, type JavaSourceExercise, type JavaSourceModule } from './source.ts';

/**
 * seed:import:javabootcamp — elirc/javabootcamp (Java fundamentals, JDK 17
 * single-file exercises graded by its `Check` harness through `bootcamp.BqMain`)
 * → BootQuest pack files (content/packs/javabootcamp/<module>.json + manifest.json).
 * The Java track's code-exercise pack, graded by the Java runner (drill-java).
 *
 * Mapping (one pack COURSE per upstream module; stable keys javabootcamp/<module>/<slug>):
 *   exercise → unit kind 'drill', track 'java', check drill-java {files:{tests, tail}}
 *              — the exercise's `// ─── tests ───` line through `// ─── end tests ───`
 *              and what follows (the class's closing brace). The learner owns
 *              head + tail; the tests are always the EXERCISE's.
 *   content  → instructions = header concepts/tier + prompt (comment-stripped);
 *              starter = the exercise file verbatim (LF); solution = the solution
 *              file verbatim (PRIVATE); explanation = its Walkthrough (PRIVATE)
 *   difficulty = stars (★☆☆ 1, ★★☆ 2, ★★★ 3) → code XP 10 × difficulty
 * Import-time format checks (refuse, never patch): exercise/solution pair up,
 * headers parse (csbootcamp header grammar), the solution repeats the exercise's
 * tests BYTE-FOR-BYTE, the file declares `class Exercise` and no package, the
 * tests call test(...) and report(), upstream's harness (Check.java, BqMain.java)
 * equals the copy the Java runner compiles, and the census matches. Output is
 * deterministic: same upstream bytes → same pack bytes.
 */

export const SOURCE_KEY = 'javabootcamp';
export const TRACK = 'java' as const;
export const CLASS_NAME = 'Exercise';

/**
 * Census of javabootcamp @ JAVABOOTCAMP_SHA. Re-pinned together with the sha (source.ts);
 * null = no expectation (the placeholder sha / --source dev mode pass --expect explicitly).
 */
export const JAVABOOTCAMP_EXPECTED: PackCounts | null = { total: 64, code: 64, quiz: 0, output: 0, written: 0 };

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
export const DEFAULT_CACHE_DIR = join(REPO, '.cache', 'sources', SOURCE_KEY);
export const DEFAULT_OUT_DIR = join(REPO, 'content', 'packs', SOURCE_KEY);
/** the harness the Java runner compiles (byte-identical upstream copy), keyed by its path under bootcamp/ */
export const RUNNER_HARNESS_DIR = join(REPO, 'server', 'src', 'runners', 'java', 'fixtures', 'javabootcamp');

/** per graded run (the runner's own default; javac has its own cap) */
export const JAVA_TIMEOUT_MS = 10_000;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export const stableKey = (module: string, slug: string): string => `${SOURCE_KEY}/${module}/${slug}`;

const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export interface MappedExercise {
  packUnit: PackUnit;
  content: UnitContentEntry;
}

/** Map one javabootcamp exercise (+ its solution) to a pack unit + content entry. */
export function mapExercise(ex: JavaSourceExercise, position: number): MappedExercise {
  const label = `${ex.module}/${ex.slug}`;
  const fail = (msg: string): never => {
    throw new ImportError(`${label}: ${msg}`);
  };
  let exH;
  let solH;
  let exSplit;
  let solSplit;
  try {
    exH = parseHeader(ex.exercise, `${label} (exercise)`);
    solH = parseHeader(ex.solution, `${label} (solution)`);
    exSplit = splitAtTestsMarker(ex.exercise);
    solSplit = splitAtTestsMarker(ex.solution);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (!/^\d{2}-/.test(ex.slug) || ex.slug.slice(0, 2) !== exH.number) fail(`header number ${exH.number} does not match the file name`);
  if (solH.number !== exH.number) fail(`solution header number ${solH.number} differs from the exercise (${exH.number})`);
  if (solSplit.tests !== exSplit.tests) fail('the solution does not repeat the exercise tests byte-for-byte (FORMAT.md rule)');
  if (!/^\s*test\(/m.test(exSplit.tests)) fail('tests block has no test(...) call');
  if (!/\breport\(\)/.test(exSplit.tests)) fail('tests block never calls report()');
  if (literalTestNames(exSplit.tests).length === 0) fail('tests block names no test with a string literal');
  for (const [which, src] of [['exercise', ex.exercise], ['solution', ex.solution]] as const) {
    if (!new RegExp(`^\\s*(?:final\\s+)?class\\s+${CLASS_NAME}\\b`, 'm').test(src)) fail(`${which} does not declare \`class ${CLASS_NAME}\``);
    if (/^\s*package\s+[\w.]+\s*;/m.test(src)) fail(`${which} declares a package (exercises live in the default package)`);
  }
  if (exH.stars < 1 || exH.stars > 3) fail(`difficulty ${exH.stars} stars out of range`);
  if (!/Walkthrough:/.test(solH.body)) fail('solution has no Walkthrough block');
  if (!exH.body.trim()) fail('exercise has no prompt');

  const key = stableKey(ex.module, ex.slug);
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
    title: capitalize(exH.title),
    phase: ex.module,
    difficulty: exH.stars,
    competencies: ['language-fluency'],
    prerequisites: [],
    checks: [{ spec }],
  } as LessonSpec;
  const instructions = [`**Concepts:** ${exH.concepts.join(' · ')}  \n**Level:** ${'★'.repeat(exH.stars)}${'☆'.repeat(3 - exH.stars)} ${exH.tier}`, '', exH.body, ''].join('\n');
  const walkthrough = solH.body.replace(/^Walkthrough:\s*\n?/, '').trim();
  const content = UnitContentEntry.parse({
    instructions,
    starter: ex.exercise,
    solution: ex.solution,
    explanation: walkthrough,
  });
  const origin = {
    id: `${ex.module}/${ex.slug}`,
    type: 'code' as const,
    module: ex.module,
    lesson: 'readme',
    position,
    skills: exH.concepts,
  };
  return { packUnit: { unit, origin } as PackUnit, content };
}

/** Build one pack course file (validated) from an upstream module. */
export function buildCourseFile(m: JavaSourceModule, order: number): PackCourseFile {
  const meta = readmeMeta(m.readme, m.id);
  const units: PackUnit[] = [];
  const content: Record<string, UnitContentEntry> = {};
  m.exercises.forEach((ex, i) => {
    const mapped = mapExercise(ex, i);
    units.push(mapped.packUnit);
    content[mapped.packUnit.unit.key] = mapped.content;
  });
  return PackCourseFile.parse({
    format: PACK_FORMAT,
    source: SOURCE_KEY,
    course: { id: m.id, order, title: meta.title, description: meta.description, prerequisites: [] },
    modules: [{ id: m.id, title: meta.title, lessons: [{ id: 'readme', title: meta.title, explanation: m.readme }] }],
    units,
    content,
  });
}

export interface ImportOptions {
  /** root of the upstream checkout (contains bootcamp/) */
  sourceDir: string;
  outDir: string;
  /** counts the source must have (null = no expectation) */
  expected: PackCounts | null;
  /** upstream commit recorded in the manifest (null when unknown) */
  gitHead: string | null;
  /** working-copy dirtiness recorded in the manifest (default: false when gitHead is set) */
  dirty?: boolean | null;
  /** compare upstream bootcamp/_lib/check/bootcamp/{Check,BqMain}.java with the runner's copy under this dir (null = skip, test fixtures) */
  harnessDir?: string | null;
  originKind?: 'github' | 'local-mirror' | 'local';
}

export interface ImportResult {
  manifest: PackManifest;
  written: string[];
  removed: string[];
}

/** Import every module (read-only) and write the pack. Assertions run BEFORE anything is written. */
export function importJavabootcamp(opts: ImportOptions): ImportResult {
  const modules = readModules(opts.sourceDir);
  if (opts.harnessDir) {
    for (const f of HARNESS_FILES) {
      let upstream: string;
      try {
        upstream = readText(join(opts.sourceDir, 'bootcamp', f));
      } catch {
        throw new ImportError(`upstream bootcamp/${f} is missing`);
      }
      if (upstream !== readText(join(opts.harnessDir, f))) {
        throw new ImportError(`upstream bootcamp/${f} differs from the harness the Java runner compiles (${join(opts.harnessDir, f)}); refresh the runner fixture deliberately first`);
      }
    }
  }
  const built = modules.map((m, i) => {
    const file = buildCourseFile(m, i + 1);
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
  const manifest = PackManifest.parse({
    format: PACK_FORMAT,
    source: SOURCE_KEY,
    track: TRACK,
    importedFrom: {
      repo: JAVABOOTCAMP_REPO,
      originKind: opts.originKind ?? 'github',
      subpath: 'bootcamp',
      path: resolve(opts.sourceDir).replace(/\\/g, '/'),
      gitHead: opts.gitHead,
      dirty: opts.dirty !== undefined ? opts.dirty : opts.gitHead === null ? null : false,
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

export { JAVABOOTCAMP_SHA };
