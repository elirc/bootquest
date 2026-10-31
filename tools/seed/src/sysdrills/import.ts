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
import { ID_RE, ImportError, readModules, SYSDRILLS_EXPECTED, type SysdrillsExercise, type SysdrillsModule } from './source.ts';

/**
 * seed:import:sysdrills — the committed sysdrills authoring JSON
 * (tools/seed/authoring/sysdrills/*.json, hand-written in this repo) → BootQuest
 * pack files (content/packs/sysdrills/<module>.json + manifest.json). The
 * sysdesign track's drill bank: estimation / capacity / reliability math reps.
 *
 * Mapping (one pack COURSE per authoring module; stable keys sysdrills/<module>/<slug>):
 *   exercise → unit kind 'drill', track 'sysdesign', competency system-design,
 *              check drill-js {language js, tests, timeoutMs 8000} graded by the
 *              real JS runner (manifest grader 'js')
 *   content  → instructions (skills + level header + the authored markdown),
 *              starter (public), solution / explanation / hints (PRIVATE)
 *   difficulty 1..3 → code XP 10 × difficulty
 * Import-time refusals (throw ImportError, write nothing): ids not NN-kebab,
 * duplicate slug, empty instructions / starter / solution / tests, duplicate test
 * names, solution === starter, a starter without TODO, a test whose code never
 * touches `mod.`, difficulty outside 1..3, a hint 3 that reads as code (see
 * hintThreeCode), a "Your task" section that hands over the formula in backticks
 * (see taskFormulaSpans), and a census that differs from the expected counts.
 * Output is deterministic: same authoring bytes → same pack bytes (the
 * manifest's importedFrom.path / gitHead / dirty record where it came from).
 */

export const SOURCE_KEY = 'sysdrills';
export const TRACK = 'sysdesign' as const;
export const GRADER = 'js' as const;
export const REPO_NAME = 'elirc/selfboot';
export const AUTHORING_SUBPATH = 'tools/seed/authoring/sysdrills';
/** per graded run (the drill-js default) */
export const DRILL_TIMEOUT_MS = 8000;
export const LESSON_ID = 'drills';

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
export const DEFAULT_AUTHORING_DIR = join(REPO, ...AUTHORING_SUBPATH.split('/'));
export const DEFAULT_OUT_DIR = join(REPO, 'content', 'packs', SOURCE_KEY);

export { ImportError, SYSDRILLS_EXPECTED };

export const stableKey = (module: string, slug: string): string => `${SOURCE_KEY}/${module}/${slug}`;

export interface MappedExercise {
  packUnit: PackUnit;
  content: UnitContentEntry;
}

/**
 * Arithmetic inside one backtick span: a × ÷ or ceil/floor bracket, a spaced or
 * glued operator between operands (an ASCII hyphen only when spaced, so kebab
 * names such as `01-estimation` pass), Math.*, or a call to a math helper. Plain
 * signatures (`fn(a, b)`) and identifiers (`latencyMs`) do not match.
 */
export const ARITHMETIC_RE = /[×÷⌈⌉⌊⌋]|\s[-−+*/%]\s|[\w)]\s*[+−]\s*[\w(]|\w\s*\*\s*\w|[\w)]\/\d|\d\s*\^\s*\d|\bMath\.|\b(?:ceil|floor|max|min|round|log2?|sqrt|pow|abs)\(/;

/** tokens that make a hint pasteable code (the cs/java hint-3 rule, with JS's `=>`) */
const HINT_CODE_RE = /;|=>|\breturn\b|[()]/;

/**
 * Why hint 3 reads as code, or null. Hint 3 is the approach in words (SEEDING §3
 * sysdrills): no `;`, `=>`, `return`, parentheses, or arithmetic inside backticks.
 */
export function hintThreeCode(hint: string): string | null {
  const tok = HINT_CODE_RE.exec(hint);
  if (tok) return `contains ${JSON.stringify(tok[0])}`;
  const span = (hint.match(/`[^`]*`/g) ?? []).find((s) => ARITHMETIC_RE.test(s));
  return span ? `has arithmetic in backticks ${span}` : null;
}

/**
 * The "Your task" section of an exercise's instructions: from the `**Your task`
 * marker to the next bold paragraph header (`**Worked example.**` etc.) or the end.
 * Empty when the instructions have no such section.
 */
export function taskSection(instructions: string): string {
  const i = instructions.indexOf('**Your task');
  if (i < 0) return '';
  const rest = instructions.slice(i);
  const end = rest.slice(2).search(/\n\n\*\*[A-Z][^*\n]*\.\*\*/);
  return end < 0 ? rest : rest.slice(0, end + 2);
}

/**
 * Backtick spans in the "Your task" section that hold arithmetic or a formula.
 * The task states semantics, units and rounding; the formula belongs in hint 2.
 */
export function taskFormulaSpans(instructions: string): string[] {
  return (taskSection(instructions).match(/`[^`]*`/g) ?? []).filter((s) => ARITHMETIC_RE.test(s));
}

const stars = (d: number): string => `${'★'.repeat(d)}${'☆'.repeat(3 - d)}`;

/** Map one authored exercise to a pack unit + content entry (both Zod-validated). */
export function mapExercise(module: string, ex: SysdrillsExercise, position: number): MappedExercise {
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
  if (ex.tests.length === 0) fail('no tests');
  const names = new Set<string>();
  for (const t of ex.tests) {
    if (!t.name.trim()) fail('a test has an empty name');
    if (names.has(t.name)) fail(`duplicate test name ${JSON.stringify(t.name)}`);
    names.add(t.name);
    if (!t.code.trim()) fail(`test ${JSON.stringify(t.name)} has empty code`);
    if (!t.code.includes('mod.')) fail(`test ${JSON.stringify(t.name)} never touches the learner module (no \`mod.\`)`);
  }
  const formula = taskFormulaSpans(ex.instructions);
  if (formula.length > 0) {
    fail(`"Your task" hands over the formula in backticks (${formula.slice(0, 3).join(', ')}): state semantics, units and rounding there and move the formula to hint 2`);
  }
  const h3 = ex.hints?.[2];
  const code = h3 === undefined ? null : hintThreeCode(h3);
  if (code !== null) fail(`hint 3 must be the approach in words, never pasteable code (no \`;\`, \`=>\`, \`return\`, parentheses or arithmetic in backticks): it ${code}`);

  const key = stableKey(module, ex.slug);
  const spec = CheckSpec.parse({ type: 'drill-js', language: 'js', tests: ex.tests, timeoutMs: DRILL_TIMEOUT_MS });
  const unit = {
    key,
    track: TRACK,
    kind: 'drill',
    title: ex.title,
    phase: module,
    difficulty: ex.difficulty,
    competencies: ['system-design'],
    prerequisites: [],
    checks: [{ spec }],
  } as LessonSpec;
  const header = `${ex.skills.length ? `**Skills:** ${ex.skills.join(' · ')}  \n` : ''}**Level:** ${stars(ex.difficulty)}`;
  const content = UnitContentEntry.parse({
    instructions: `${header}\n\n${ex.instructions.trim()}\n`,
    starter: ex.starter,
    solution: ex.solution,
    explanation: ex.explanation,
    ...(ex.hints !== undefined ? { hints: ex.hints } : {}),
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
export function buildCourseFile(m: SysdrillsModule): PackCourseFile {
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
export function importSysdrills(opts: ImportOptions): ImportResult {
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
