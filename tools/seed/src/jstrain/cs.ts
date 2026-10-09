import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CheckSpec, PACK_FORMAT, PackCourseFile, PackManifest, type LessonSpec, type PackCounts, type PackExclusion, type PackUnit } from '@bootquest/shared';
import { UnitContentEntry } from '@bootquest/shared/api';
import { isHuntModule, rewriteDirectives, splitJstrainCs } from '@bootquest/server/runners/csharp/split';
import { frozenBlocks } from '@bootquest/server/runners/self-run/compose';
import { packBytes } from '../bootforge/import.ts';
import { readmeMeta } from '../csbootcamp/import.ts';
import type { CsSourceExercise, CsSourceModule } from '../csbootcamp/source.ts';
import { ImportError, manifestCourses, writePack } from './import.ts';
import { JSTRAIN_REPO, parseJsHeader, readText, SourceError } from './source.ts';

/**
 * seed:import:jstrain (C# half) — jstrain2.2's EMBEDDED csbootcamp/ copy
 * (29 modules / 147 exercises) → the `jstrain-cs` pack (track csharp, drill-cs
 * through the warm C# runner, keys jstrain-cs/<module>/<exercise>).
 *
 * LEARNING R2 (binding): name-based dedup, the GitHub elirc/csbootcamp copy
 * (content/packs/csbootcamp) WINS. Reality (W3c): the two curricula share NO
 * module+exercise id (different module names: 01-language-core vs
 * 01-csharp-language-core); the dedup key is therefore the exercise NAME
 * (file stem without its NN- number), which overlaps on topic-named exercises
 * (value-vs-reference, out-and-ref, ...). Both overlap counts are reported.
 *
 * Runner capability gate (refuse at import, counted in manifest.excluded):
 * the warm C# runner compiles console-check programs against a prebuilt
 * Check.dll and honours only `#:project …/Check.csproj` (P2/W3a). Exercises
 * whose exercise or solution file needs `#:sdk Microsoft.NET.Sdk.Web` or any
 * `#:package` (ASP.NET Core, EF Core, DI/config NuGet packages) cannot run on
 * it. Per-exercise format refusals (header, directives, no Test(...)) are
 * excluded with their reason too.
 * HARNESS REALITY (W3c): the embedded harness (_lib/Check/Check.cs + Spy.cs +
 * Web.cs) is a DIFFERENT revision than github csbootcamp's: Report() runs
 * itself at ProcessExit, so files have NO `return Report();` and the tests
 * block ends at the next divider (`// ─── types ───`, `given`, ...). The units
 * therefore carry drill-cs `harness: 'jstrain'`: the C# runner compiles THAT
 * revision (Check.cs + Spy.cs, server/src/runners/csharp/fixtures/
 * jstrain-csbootcamp) into its own Check.dll. Scaffolding sections the
 * solution leaves untouched (given / implementations / helpers) are frozen.
 *
 * Mapping per exercise: unit kind 'drill', track csharp, difficulty = stars;
 * check drill-cs {shape console-check, harness jstrain, files {tests, tail,
 * frozen}}; content instructions / starter / solution (PRIVATE) / explanation
 * (PRIVATE Walkthrough). Hunt modules (24/25/26-*-hunts) import too: drill-cs
 * has no inverted flag, and the gate only requires the starter to fail as a
 * structured test verdict, which a ships-red hunt does.
 */

export const CS_SOURCE_KEY = 'jstrain-cs';
export const CS_TRACK = 'csharp' as const;
const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
export const DEFAULT_CS_OUT_DIR = join(REPO, 'content', 'packs', CS_SOURCE_KEY);
export const CS_TIMEOUT_MS = 20_000;
const RUNNER_HARNESS_DIR = join(REPO, 'server', 'src', 'runners', 'csharp', 'fixtures', 'jstrain-csbootcamp', '_lib', 'Check');
export const GITHUB_CSBOOTCAMP_PACK = join(REPO, 'content', 'packs', 'csbootcamp');

const MODULE_DIR = /^\d{2}-[a-z0-9-]+$/;
const CHECK_PROJECT = /^#:project\s+\S*Check\.csproj\s*$/;

/** Read the embedded csbootcamp modules (root = the jstrain2.2 checkout). */
export function readEmbeddedCsModules(root: string): CsSourceModule[] {
  const base = join(root, 'csbootcamp');
  if (!existsSync(base)) throw new SourceError(`no csbootcamp/ under ${root}`);
  const modules: CsSourceModule[] = [];
  for (const id of readdirSync(base).filter((d) => MODULE_DIR.test(d) && statSync(join(base, d)).isDirectory()).sort()) {
    const exDir = join(base, id, 'exercises');
    const solDir = join(base, id, 'solutions');
    const list = (d: string) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.cs') && !f.startsWith('_')).sort() : []);
    const ex = list(exDir);
    const sol = list(solDir);
    const unpaired = [...ex.filter((f) => !sol.includes(f)), ...sol.filter((f) => !ex.includes(f))];
    if (unpaired.length) throw new SourceError(`csbootcamp/${id}: exercise/solution files do not pair up (${unpaired.join(', ')})`);
    modules.push({
      id,
      readme: existsSync(join(base, id, 'README.md')) ? readText(join(base, id, 'README.md')) : '',
      exercises: ex.map((f) => ({ module: id, slug: f.replace(/\.cs$/, ''), exercise: readText(join(exDir, f)), solution: readText(join(solDir, f)) })),
    });
  }
  return modules;
}

/** `#:` directives a file declares, other than the Check project. */
export function foreignDirectives(src: string): string[] {
  return src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('#:') && !CHECK_PROJECT.test(l));
}

/**
 * True when a file cannot compile on the warm runner: a `#:sdk` / `#:package`
 * directive, or a `using Microsoft.Extensions.*` / `Microsoft.AspNetCore.*`
 * (upstream resolves those through Check.csproj's FrameworkReference to
 * Microsoft.AspNetCore.App; the warm runner references Microsoft.NETCore.App
 * only). W3c: the using-rule was added after the first gate run quarantined
 * exactly the 7 such exercises with CS0234 — a runner capability gap, so it
 * is an import-time exclusion (counted), not a content defect.
 */
export function needsAspNetFramework(src: string): boolean {
  return foreignDirectives(src).length > 0 || /^\s*using\s+(static\s+)?Microsoft\.(Extensions|AspNetCore)\b/m.test(src);
}

/** exercise name without its NN- number: the dedup key */
export const exerciseName = (slug: string): string => slug.replace(/^\d{2}-/, '');

/** Exercise ids ("<module>/<slug>") of the GitHub csbootcamp pack, read from its course files. */
export function githubCsbootcampIds(packDir: string = GITHUB_CSBOOTCAMP_PACK): string[] {
  const manifest = PackManifest.parse(JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8')));
  const ids: string[] = [];
  for (const c of manifest.courses) {
    const file = PackCourseFile.parse(JSON.parse(readFileSync(join(packDir, c.file), 'utf8')));
    for (const u of file.units) ids.push(u.origin.id);
  }
  return ids.sort();
}

export interface DedupResult {
  kept: CsSourceExercise[];
  /** embedded exercises whose module+exercise id equals a GitHub id */
  exactOverlap: string[];
  /** embedded exercises whose exercise NAME (sans number) equals a GitHub exercise name — dropped, GitHub wins */
  nameOverlap: { embedded: string; github: string }[];
}

/** Name-based dedup against the GitHub csbootcamp ids (GitHub wins). */
export function dedupAgainstGithub(exercises: readonly CsSourceExercise[], githubIds: readonly string[]): DedupResult {
  const byName = new Map<string, string>();
  for (const id of githubIds) byName.set(exerciseName(id.split('/').pop()!), id);
  const exact = new Set(githubIds);
  const kept: CsSourceExercise[] = [];
  const exactOverlap: string[] = [];
  const nameOverlap: { embedded: string; github: string }[] = [];
  for (const ex of exercises) {
    const id = `${ex.module}/${ex.slug}`;
    if (exact.has(id)) exactOverlap.push(id);
    const gh = byName.get(exerciseName(ex.slug));
    if (exact.has(id) || gh !== undefined) {
      nameOverlap.push({ embedded: id, github: gh ?? id });
      continue;
    }
    kept.push(ex);
  }
  return { kept, exactOverlap, nameOverlap };
}

const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Map one embedded C# exercise (+ solution). Throws ImportError on a format refusal. */
export function mapEmbeddedExercise(ex: CsSourceExercise, position: number): { packUnit: PackUnit; content: UnitContentEntry } {
  const label = `csbootcamp/${ex.module}/${ex.slug}`;
  const fail = (msg: string): never => {
    throw new ImportError(`${label}: ${msg}`);
  };
  let exH;
  let solH;
  let exS;
  let solS;
  try {
    exH = parseJsHeader(ex.exercise, `${label} (exercise)`);
    solH = parseJsHeader(ex.solution, `${label} (solution)`, { solution: true });
    exS = splitJstrainCs(ex.exercise);
    solS = splitJstrainCs(ex.solution);
    rewriteDirectives(ex.exercise);
    rewriteDirectives(ex.solution);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (ex.slug.slice(0, 2) !== exH.number) fail(`header number ${exH.number} does not match the file name`);
  if (solH.number !== exH.number) fail(`solution header number ${solH.number} differs from the exercise (${exH.number})`);
  // the solution is always graded against the EXERCISE's tests (never its own copy), so an upstream
  // divergence of the solution's copy (2 files at 1a8b3bf6: block vs expression lambdas) is harmless: the gate decides
  if (!/^\s*Test\(/m.test(exS.tests)) fail('tests block has no Test(...) call');
  if (exH.stars < 1 || exH.stars > 3) fail(`difficulty ${exH.stars} stars out of range`);
  if (!exH.body.trim()) fail('exercise has no prompt');
  const key = `${CS_SOURCE_KEY}/${ex.module}/${ex.slug}`;
  const spec = CheckSpec.parse({
    type: 'drill-cs',
    shape: 'console-check',
    harness: 'jstrain',
    files: { tests: exS.tests, tail: exS.tail, frozen: frozenBlocks(exS.head + exS.tail, solS.head + solS.tail) },
    timeoutMs: CS_TIMEOUT_MS,
  });
  const unit = {
    key,
    track: CS_TRACK,
    kind: 'drill',
    title: capitalize(exH.title),
    phase: ex.module,
    difficulty: exH.stars,
    competencies: [isHuntModule(ex.module) ? 'code-reading' : 'language-fluency'],
    prerequisites: [],
    checks: [{ spec }],
  } as LessonSpec;
  const hunt = isHuntModule(ex.module) ? ['', '**Debug hunt:** the code ships with a planted bug — the tests fail until you find and fix it.'] : [];
  const instructions = [`**Concepts:** ${exH.concepts.join(' · ')}  \n**Level:** ${'★'.repeat(exH.stars)}${'☆'.repeat(3 - exH.stars)} ${exH.tier}`, ...hunt, '', exH.body, ''].join('\n');
  const walkthrough = solH.body.replace(/^Walkthrough\s*[:—-]?\s*/, '').trim();
  const content = UnitContentEntry.parse({ instructions, starter: ex.exercise, solution: ex.solution, ...(walkthrough ? { explanation: walkthrough } : {}) });
  const origin = { id: `${ex.module}/${ex.slug}`, type: 'code' as const, module: ex.module, lesson: 'readme', position, format: isHuntModule(ex.module) ? 'debugging' : 'self-run', skills: exH.concepts };
  return { packUnit: { unit, origin } as PackUnit, content };
}

/** One course per embedded module (only its importable exercises). */
export function buildEmbeddedCourse(m: CsSourceModule, order: number): PackCourseFile {
  const meta = readmeMeta(m.readme, m.id);
  const title = `C# · ${meta.title}`;
  const units: PackUnit[] = [];
  const content: Record<string, UnitContentEntry> = {};
  m.exercises.forEach((ex, i) => {
    const mapped = mapEmbeddedExercise(ex, i);
    units.push(mapped.packUnit);
    content[mapped.packUnit.unit.key] = mapped.content;
  });
  return PackCourseFile.parse({
    format: PACK_FORMAT,
    source: CS_SOURCE_KEY,
    course: { id: m.id, order, title, description: meta.description, prerequisites: [] },
    modules: [{ id: m.id, title, lessons: [{ id: 'readme', title, explanation: m.readme }] }],
    units,
    content,
  });
}

/** Upstream embedded harness files must equal the runner's copies (refresh deliberately, never drift). */
export function assertCsHarnessMatches(sourceDir: string): void {
  for (const f of ['Check.cs', 'Spy.cs']) {
    const up = join(sourceDir, 'csbootcamp', '_lib', 'Check', f);
    const mine = join(RUNNER_HARNESS_DIR, f);
    if (!existsSync(up) || readText(up) !== readText(mine)) {
      throw new ImportError(`upstream csbootcamp/_lib/Check/${f} differs from the C# runner's jstrain harness copy (${mine}); refresh it deliberately first`);
    }
  }
}

export interface CsImportOptions {
  sourceDir: string;
  outDir: string;
  githubIds: readonly string[];
  expected: PackCounts | null;
  gitHead: string | null;
  dirty: boolean | null;
  /** compare the upstream embedded harness with the runner's copy (off for fixtures) */
  checkHarness?: boolean;
}

export interface CsImportResult {
  manifest: PackManifest;
  written: string[];
  removed: string[];
  census: { embedded: number; dedupDropped: number; exactOverlap: number; runnerExcluded: number; formatRefused: number; imported: number };
  nameOverlap: { embedded: string; github: string }[];
}

export function importJstrainCs(opts: CsImportOptions): CsImportResult {
  if (opts.checkHarness) assertCsHarnessMatches(opts.sourceDir);
  const modules = readEmbeddedCsModules(opts.sourceDir);
  const all = modules.flatMap((m) => m.exercises);
  const dedup = dedupAgainstGithub(all, opts.githubIds);
  const keptIds = new Set(dedup.kept.map((e) => `${e.module}/${e.slug}`));
  const needsSdk: string[] = [];
  const refused: { id: string; reason: string }[] = [];
  const built: { file: PackCourseFile; bytes: string }[] = [];
  let order = 1;
  for (const m of modules) {
    const usable: CsSourceExercise[] = [];
    for (const ex of m.exercises) {
      const id = `${ex.module}/${ex.slug}`;
      if (!keptIds.has(id)) continue;
      if (needsAspNetFramework(ex.exercise) || needsAspNetFramework(ex.solution)) {
        needsSdk.push(id);
        continue;
      }
      try {
        mapEmbeddedExercise(ex, 0); // format gate
        usable.push(ex);
      } catch (err) {
        if (!(err instanceof ImportError)) throw err;
        refused.push({ id, reason: err.message });
      }
    }
    if (usable.length === 0) continue;
    const file = buildEmbeddedCourse({ ...m, exercises: usable }, order++);
    built.push({ file, bytes: packBytes(file) });
  }
  if (built.length === 0) {
    throw new ImportError(
      `no embedded csbootcamp exercise is importable (${all.length} embedded, ${dedup.nameOverlap.length} deduped, ${needsSdk.length} need #:sdk/#:package, ` +
        `${refused.length} format-refused: ${refused.slice(0, 5).map((r) => r.reason).join(' | ')})`,
    );
  }
  const { courses, totals } = manifestCourses(built);
  if (opts.expected && JSON.stringify(totals) !== JSON.stringify(opts.expected)) {
    throw new ImportError(`jstrain-cs counts ${JSON.stringify(totals)} differ from the expected ${JSON.stringify(opts.expected)}; refusing to write`);
  }
  const excluded: PackExclusion[] = [];
  if (dedup.nameOverlap.length) {
    excluded.push({
      what: 'csbootcamp/ exercises also in github elirc/csbootcamp (by exercise name)',
      count: dedup.nameOverlap.length,
      reason: `name-based dedup, the GitHub copy wins (content/packs/csbootcamp); exact module+exercise overlap: ${dedup.exactOverlap.length}`,
      ids: dedup.nameOverlap.map((o) => `${o.embedded} = ${o.github}`),
    });
  }
  if (needsSdk.length) {
    excluded.push({
      what: 'csbootcamp/ exercises needing #:sdk Microsoft.NET.Sdk.Web, #:package or the ASP.NET Core shared framework',
      count: needsSdk.length,
      reason:
        'the warm C# runner compiles console-check programs against Microsoft.NETCore.App + Check.dll only (no Web SDK, no NuGet restore, no Microsoft.AspNetCore.App shared framework — upstream gets Microsoft.Extensions.* through Check.csproj\'s FrameworkReference): ASP.NET Core / EF Core / DI / configuration / caching exercises are not runnable on it yet',
      ...(needsSdk.length <= 50 ? { ids: needsSdk } : {}),
    });
  }
  if (refused.length) {
    excluded.push({
      what: 'csbootcamp/ exercises refused by the format gate',
      count: refused.length,
      reason: refused.map((r) => r.reason).join(' | ').slice(0, 2000),
      ids: refused.map((r) => r.id),
    });
  }
  const manifest = PackManifest.parse({
    format: PACK_FORMAT,
    source: CS_SOURCE_KEY,
    track: CS_TRACK,
    grader: 'csharp',
    excluded,
    importedFrom: {
      repo: JSTRAIN_REPO,
      originKind: 'local-mirror',
      subpath: 'csbootcamp',
      path: resolve(opts.sourceDir).replace(/\\/g, '/'),
      gitHead: opts.gitHead,
      dirty: opts.dirty,
    },
    expected: opts.expected,
    totals,
    courses,
  });
  const { written, removed } = writePack(opts.outDir, built, manifest);
  return {
    manifest,
    written,
    removed,
    census: {
      embedded: all.length,
      dedupDropped: dedup.nameOverlap.length,
      exactOverlap: dedup.exactOverlap.length,
      runnerExcluded: needsSdk.length,
      formatRefused: refused.length,
      imported: totals.total,
    },
    nameOverlap: dedup.nameOverlap,
  };
}
