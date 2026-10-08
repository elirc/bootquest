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
import { isHuntModule, rewriteDirectives, splitAtTestsMarker } from '@bootquest/server/runners/csharp/split';
import { packBytes, sha256 } from '../bootforge/import.ts';
import { CSBOOTCAMP_REPO, CSBOOTCAMP_SHA, parseHeader, readModules, readText, type CsSourceExercise, type CsSourceModule } from './source.ts';

/**
 * seed:import:csbootcamp — elirc/csbootcamp (C# fundamentals, .NET 10
 * file-based apps graded by its `Check` harness) → BootQuest pack files
 * (content/packs/csbootcamp/<module>.json + manifest.json). The .NET track opener.
 *
 * Mapping (one pack COURSE per upstream module, so stable keys are
 * csbootcamp/<module>/<exercise> and the loader's <source>/<course>/ prefix holds):
 *   exercise → unit kind 'drill', track 'csharp', check drill-cs
 *              {shape:'console-check', files:{tests, tail}} — the exercise's
 *              `// ─── tests ───` block through `return Report();` and its types
 *              section (P2 three-part split: the learner owns head + tail, the
 *              tests are always the EXERCISE's)
 *   content  → instructions = header concepts/tier + prompt (comment-stripped);
 *              starter = the exercise file verbatim (LF); solution = the solution
 *              file verbatim (PRIVATE); explanation = its Walkthrough (PRIVATE)
 *   difficulty = stars (★☆☆ 1, ★★☆ 2, ★★★ 3) → code XP 10 × difficulty
 * Import-time format checks (refuse, never patch): exercise/solution pair up,
 * headers parse, the solution repeats the exercise's tests BYTE-FOR-BYTE, the
 * only file-based-app directive is `#:project …/Check.csproj`, no hunt
 * (inverted-contract) modules, and upstream's Check.cs equals the harness the
 * C# runner compiles. Output is deterministic: same upstream sha → same bytes.
 */

export const SOURCE_KEY = 'csbootcamp';
export const TRACK = 'csharp' as const;

/** Census of csbootcamp @ e05b3505 (4 modules: 10 + 8 + 8 + 5 exercises). */
export const CSBOOTCAMP_EXPECTED: PackCounts = { total: 31, code: 31, quiz: 0, output: 0, written: 0 };

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
export const DEFAULT_CACHE_DIR = join(REPO, '.cache', 'sources', SOURCE_KEY);
export const DEFAULT_OUT_DIR = join(REPO, 'content', 'packs', SOURCE_KEY);
/** the Check harness the C# runner compiles into Check.dll (P2 fixture, byte-identical upstream copy) */
export const RUNNER_CHECK_HARNESS = join(REPO, 'server', 'src', 'runners', 'csharp', 'fixtures', 'csbootcamp', '_lib', 'Check', 'Check.cs');

/** console-check timeout per graded run (the runner's own default; compile has its own cap) */
export const CS_TIMEOUT_MS = 10_000;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export const stableKey = (module: string, slug: string): string => `${SOURCE_KEY}/${module}/${slug}`;

const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** `# 01 · Language Core` → { title, description (first paragraph) } */
export function readmeMeta(readme: string, moduleId: string): { title: string; description: string } {
  const lines = readme.split('\n');
  const h = lines.find((l) => /^# /.test(l));
  const title = h ? h.replace(/^#\s+(\d{2}\s+·\s+)?/, '').trim() : moduleId;
  const start = h ? lines.indexOf(h) + 1 : 0;
  const para: string[] = [];
  for (const l of lines.slice(start)) {
    if (l.trim() === '') {
      if (para.length) break;
      continue;
    }
    if (/^#/.test(l)) break;
    para.push(l.trim());
  }
  return { title: title || moduleId, description: para.join(' ') };
}

export interface MappedExercise {
  packUnit: PackUnit;
  content: UnitContentEntry;
}

/** Map one csbootcamp exercise (+ its solution) to a pack unit + content entry. */
export function mapExercise(ex: CsSourceExercise, position: number): MappedExercise {
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
    // only `#:project …/Check.csproj` is honoured by the warm runner; anything else is refused here
    rewriteDirectives(ex.exercise);
    rewriteDirectives(ex.solution);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (!/^\d{2}-/.test(ex.slug) || ex.slug.slice(0, 2) !== exH.number) fail(`header number ${exH.number} does not match the file name`);
  // number must agree; the title may be abbreviated in the solution header (upstream
  // 04-strings-and-time/02: "text in, text out" vs the exercise's longer title) — the exercise's wins
  if (solH.number !== exH.number) fail(`solution header number ${solH.number} differs from the exercise (${exH.number})`);
  if (solSplit.tests !== exSplit.tests) fail('the solution does not repeat the exercise tests byte-for-byte (FORMAT.md rule)');
  if (!/^\s*Test\(/m.test(exSplit.tests)) fail('tests block has no Test(...) call');
  if (exH.stars < 1 || exH.stars > 3) fail(`difficulty ${exH.stars} stars out of range`);
  if (!/Walkthrough:/.test(solH.body)) fail('solution has no Walkthrough block');
  if (!exH.body.trim()) fail('exercise has no prompt');

  const key = stableKey(ex.module, ex.slug);
  const spec = CheckSpec.parse({
    type: 'drill-cs',
    shape: 'console-check',
    files: { tests: exSplit.tests, tail: exSplit.tail },
    timeoutMs: CS_TIMEOUT_MS,
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
export function buildCourseFile(m: CsSourceModule, order: number): PackCourseFile {
  if (isHuntModule(m.id)) throw new ImportError(`${m.id}: hunt/debug modules (inverted "ships red" contract) are not supported by this importer yet`);
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
  /** counts the source must have (null = no expectation, e.g. test fixtures) */
  expected: PackCounts | null;
  /** upstream commit recorded in the manifest (null for fixtures) */
  gitHead: string | null;
  /** compare upstream bootcamp/_lib/Check/Check.cs with the runner's harness (off for fixtures without one) */
  checkHarness?: string | null;
  originKind?: 'github' | 'local-mirror' | 'local';
}

export interface ImportResult {
  manifest: PackManifest;
  written: string[];
  removed: string[];
}

/** Import every module (read-only) and write the pack. Assertions run BEFORE anything is written. */
export function importCsbootcamp(opts: ImportOptions): ImportResult {
  const modules = readModules(opts.sourceDir);
  if (opts.checkHarness) {
    const upstream = readText(join(opts.sourceDir, 'bootcamp', '_lib', 'Check', 'Check.cs'));
    if (upstream !== readText(opts.checkHarness)) {
      throw new ImportError(`upstream bootcamp/_lib/Check/Check.cs differs from the harness the C# runner compiles (${opts.checkHarness}); refresh the runner fixture deliberately first`);
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
      repo: CSBOOTCAMP_REPO,
      originKind: opts.originKind ?? 'github',
      subpath: 'bootcamp',
      // the local cache the pack was read from; the pinned sha is what identifies the source
      path: resolve(opts.sourceDir).replace(/\\/g, '/'),
      gitHead: opts.gitHead,
      dirty: opts.gitHead === null ? null : false,
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

export { CSBOOTCAMP_SHA };
