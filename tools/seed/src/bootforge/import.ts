import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  CheckSpec,
  countPackUnits,
  PACK_FORMAT,
  PackCourseFile,
  PackManifest,
  type CompetencyId,
  type LessonSpec,
  type PackCounts,
  type PackUnit,
} from '@bootquest/shared';
import { UnitContentEntry } from '@bootquest/shared/api';
import { detectSnippetLanguage } from '@bootquest/server/runners/js/language';
import { BfCourse, parseExercise, type BfExercise } from './source.ts';

/**
 * seed:import:bootforge — BootForge (opusboot2) compiled course JSON →
 * BootQuest pack files (content/packs/bootforge/<course>.json + manifest.json).
 *
 * Mapping (discriminated by upstream exercise type):
 *   code    → unit kind 'drill',          check drill-js {language, tests}
 *             (BootForge "SQL" exercises are JS modules exporting SQL strings
 *              whose tests open node:sqlite — they keep language js/ts and the
 *              JS runner grades them)
 *   quiz    → unit kind 'quiz',           check quiz {grading:'choice', answerKey (PRIVATE), choices}
 *   output  → unit kind 'predict-output', check predict-output {language (inferred), expected (PRIVATE)}
 *   written → unit kind 'written',        NO check (self-assessed carve-out, never a pass target)
 * Per-unit content (instructions, starter, snippet, rubric public; solution,
 * explanation, hints private) goes to the pack's content map, never the DB.
 * Stable keys: bootforge/<course>/<module>/<lesson>/<slug> — i.e. the source
 * prefix + BootForge's own globally unique exercise id (which begins with the
 * course id). Output is deterministic: same input bytes → same pack bytes.
 */

export const SOURCE_KEY = 'bootforge';
export const TRACK = 'js' as const;

/** R1 recon census of the opusboot2 working tree (LEARNING.md): the importer refuses a divergence. */
export const BOOTFORGE_EXPECTED: PackCounts = { total: 2571, code: 1825, quiz: 544, output: 196, written: 6 };

export const DEFAULT_SOURCE_DIR = resolve(import.meta.dirname, '..', '..', '..', '..', '..', 'opusboot2', 'content', 'build');
export const DEFAULT_OUT_DIR = resolve(import.meta.dirname, '..', '..', '..', '..', 'content', 'packs', SOURCE_KEY);

export const stableKey = (exerciseId: string): string => `${SOURCE_KEY}/${exerciseId}`;

/**
 * Course → ladder competencies (spec §6.2). Drill/quiz/predict submits write
 * one evidence row per competency; browser drills never anchor a promotion.
 */
export const COURSE_COMPETENCIES: Readonly<Record<string, readonly CompetencyId[]>> = {
  'js-fundamentals': ['language-fluency'],
  'arrays-objects': ['language-fluency'],
  'functions-deep': ['language-fluency'],
  'async-js': ['language-fluency'],
  'errors-modules': ['language-fluency'],
  'ts-basics': ['language-fluency'],
  'ts-apps': ['language-fluency'],
  'node-core': ['language-fluency'],
  'http-rest': ['language-fluency', 'data-http'],
  'express-api': ['language-fluency', 'data-http'],
  'sql-data': ['data-http'],
  'react-fundamentals': ['language-fluency', 'feature-delivery'],
  'react-state': ['language-fluency', 'feature-delivery'],
  'react-ts': ['language-fluency', 'feature-delivery'],
  'fullstack-crud': ['feature-delivery', 'data-http'],
};

/** engineering-practice exercises carry a `format`; it decides the competency. */
export const FORMAT_COMPETENCIES: Readonly<Record<string, readonly CompetencyId[]>> = {
  debugging: ['code-reading'],
  'test-writing': ['testing-verification'],
  'pr-review': ['code-reading', 'communication'],
  'schema-migration': ['data-http'],
  incident: ['code-reading', 'communication'],
  project: ['feature-delivery'],
};

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

function competenciesFor(course: string, ex: BfExercise): CompetencyId[] {
  if (ex.format !== undefined) {
    const byFormat = FORMAT_COMPETENCIES[ex.format];
    if (!byFormat) throw new ImportError(`${ex.id}: no competency mapping for format ${ex.format}`);
    return [...byFormat];
  }
  const byCourse = COURSE_COMPETENCIES[course];
  if (!byCourse) throw new ImportError(`${ex.id}: course ${course} has no competency mapping (add it to COURSE_COMPETENCIES)`);
  return [...byCourse];
}

export interface MapContext {
  course: string;
  module: string;
  lesson: string;
  position: number;
  /** every upstream exercise id in the import → its type (reviewOf resolution) */
  index: ReadonlyMap<string, BfExercise['type']>;
}

export interface MappedExercise {
  packUnit: PackUnit;
  content: UnitContentEntry;
}

/** Map one BootForge exercise to a pack unit + its content entry (both Zod-validated). */
export async function mapExercise(ex: BfExercise, ctx: MapContext): Promise<MappedExercise> {
  const key = stableKey(ex.id);
  let variationOf: string | undefined;
  if (ex.reviewOf !== undefined) {
    const targetType = ctx.index.get(ex.reviewOf);
    if (targetType === undefined) throw new ImportError(`${ex.id}: reviewOf ${ex.reviewOf} does not exist`);
    if (ex.reviewOf === ex.id) throw new ImportError(`${ex.id}: reviewOf points at itself`);
    // W2b/F6: upstream reviewOf is a spaced-review RANKING HINT (opusboot2
    // learning.ts), never a lock. It maps to BootQuest's changed-example
    // variant link (unit.variation_of_unit_id), not to a prerequisite edge.
    variationOf = stableKey(ex.reviewOf);
  }
  const base = {
    key,
    track: TRACK,
    title: ex.title,
    phase: ctx.course,
    difficulty: ex.difficulty,
    xp: ex.xp,
    competencies: competenciesFor(ctx.course, ex),
    prerequisites: [] as string[],
    ...(variationOf !== undefined ? { variationOf } : {}),
  };
  let unit: LessonSpec;
  let content: UnitContentEntry;
  const common = { instructions: ex.prompt, explanation: ex.explanation, hints: ex.hints };
  switch (ex.type) {
    case 'code': {
      unit = {
        ...base,
        kind: 'drill',
        checks: [{ spec: CheckSpec.parse({ type: 'drill-js', language: ex.language, tests: ex.tests }) }],
      } as LessonSpec;
      content = { ...common, starter: ex.starter, solution: ex.solution };
      break;
    }
    case 'quiz': {
      unit = {
        ...base,
        kind: 'quiz',
        checks: [{ spec: CheckSpec.parse({ type: 'quiz', itemKey: key, grading: 'choice', answerKey: ex.answerIndex, choices: ex.options }) }],
      } as LessonSpec;
      content = { ...common };
      break;
    }
    case 'output': {
      const language = await detectSnippetLanguage(ex.code);
      if (language === null) throw new ImportError(`${ex.id}: output snippet parses as neither JS nor TS`);
      unit = {
        ...base,
        kind: 'predict-output',
        checks: [{ spec: CheckSpec.parse({ type: 'predict-output', language, expected: ex.expected, normalize: true }) }],
      } as LessonSpec;
      content = { ...common, snippet: ex.code };
      break;
    }
    case 'written': {
      unit = { ...base, kind: 'written', checks: [] } as LessonSpec;
      content = { ...common, solution: ex.solution, rubric: ex.rubric, ...(ex.starter !== undefined ? { starter: ex.starter } : {}) };
      break;
    }
  }
  const origin = {
    id: ex.id,
    type: ex.type,
    module: ctx.module,
    lesson: ctx.lesson,
    position: ctx.position,
    xp: ex.xp,
    ...(ex.format !== undefined ? { format: ex.format } : {}),
    ...(ex.reviewOf !== undefined ? { reviewOf: ex.reviewOf } : {}),
    skills: ex.skills ?? [],
  };
  return { packUnit: { unit, origin } as PackUnit, content: UnitContentEntry.parse(content) };
}

export interface ParsedCourse {
  course: BfCourse;
  exercises: { ex: BfExercise; module: string; lesson: string; position: number }[];
}

/** Parse + structurally check one upstream course file. */
export function parseCourse(raw: unknown, label: string): ParsedCourse {
  const course = BfCourse.parse(raw);
  const exercises: ParsedCourse['exercises'] = [];
  let position = 0;
  for (const m of course.modules) {
    for (const l of m.lessons) {
      for (const [i, rawEx] of l.exercises.entries()) {
        let ex: BfExercise;
        try {
          ex = parseExercise(rawEx);
        } catch (err) {
          throw new ImportError(`${label} ${m.id}/${l.id} exercise #${i}: ${err instanceof Error ? err.message : String(err)}`);
        }
        const prefix = `${course.id}/${m.id}/${l.id}/`;
        if (!ex.id.startsWith(prefix)) throw new ImportError(`${ex.id}: id must start with ${prefix}`);
        exercises.push({ ex, module: m.id, lesson: l.id, position: position++ });
      }
    }
  }
  return { course, exercises };
}

/** Build one pack course file (validated) from a parsed upstream course. */
export async function buildCourseFile(parsed: ParsedCourse, index: ReadonlyMap<string, BfExercise['type']>): Promise<PackCourseFile> {
  const { course } = parsed;
  const units: PackUnit[] = [];
  const content: Record<string, UnitContentEntry> = {};
  for (const e of parsed.exercises) {
    const mapped = await mapExercise(e.ex, { course: course.id, module: e.module, lesson: e.lesson, position: e.position, index });
    units.push(mapped.packUnit);
    content[mapped.packUnit.unit.key] = mapped.content;
  }
  return PackCourseFile.parse({
    format: PACK_FORMAT,
    source: SOURCE_KEY,
    course: { id: course.id, order: course.order, title: course.title, description: course.description, prerequisites: [] },
    modules: course.modules.map((m) => ({
      id: m.id,
      title: m.title,
      lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, explanation: l.explanation })),
    })),
    units,
    content,
  });
}

/** Canonical bytes of a pack JSON document (deterministic, LF, trailing newline). */
export const packBytes = (doc: unknown): string => `${JSON.stringify(doc, null, 1)}\n`;
export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

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
  sourceDir: string;
  outDir: string;
  /** counts the source must have (null = no expectation, e.g. test fixtures) */
  expected: PackCounts | null;
  /** record git HEAD/dirty of the source dir (off for fixtures) */
  recordGit?: boolean;
  repo?: string;
  originKind?: 'github' | 'local-mirror' | 'local';
  subpath?: string;
}

export interface ImportResult {
  manifest: PackManifest;
  written: string[];
  removed: string[];
}

/**
 * Import every course file in sourceDir (read-only) and write the pack. The
 * expected-count assertion runs BEFORE anything is written.
 */
export async function importBootforge(opts: ImportOptions): Promise<ImportResult> {
  const files = readdirSync(opts.sourceDir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new ImportError(`no course JSON in ${opts.sourceDir}`);
  const parsed = files.map((f) => {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(opts.sourceDir, f), 'utf8'));
    } catch (err) {
      throw new ImportError(`${f}: not JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    const p = parseCourse(raw, f);
    if (`${p.course.id}.json` !== f) throw new ImportError(`${f}: declares course id ${p.course.id}`);
    return p;
  });
  parsed.sort((a, b) => a.course.order - b.course.order);
  const orders = parsed.map((p) => p.course.order);
  if (new Set(orders).size !== orders.length) throw new ImportError(`duplicate course order in ${orders.join(',')}`);

  const index = new Map<string, BfExercise['type']>();
  for (const p of parsed) {
    for (const { ex } of p.exercises) {
      if (index.has(ex.id)) throw new ImportError(`duplicate exercise id ${ex.id}`);
      index.set(ex.id, ex.type);
    }
  }

  const built: { file: PackCourseFile; bytes: string }[] = [];
  for (const p of parsed) {
    const file = await buildCourseFile(p, index);
    built.push({ file, bytes: packBytes(file) });
  }

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
  const git = opts.recordGit ? gitInfo(opts.sourceDir) : { gitHead: null, dirty: null };
  const manifest = PackManifest.parse({
    format: PACK_FORMAT,
    source: SOURCE_KEY,
    track: TRACK,
    importedFrom: {
      repo: opts.repo ?? 'elirc/opusboot2',
      originKind: opts.originKind ?? 'local',
      subpath: opts.subpath ?? 'content/build',
      path: resolve(opts.sourceDir).replace(/\\/g, '/'),
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
