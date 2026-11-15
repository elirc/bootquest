import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { countPackUnits, PACK_FORMAT, PackCourseFile, PackManifest, type LessonSpec, type PackCounts, type PackUnit } from '@bootquest/shared';
import type { UnitContentEntry } from '@bootquest/shared/api';
import { packBytes, sha256 } from '../bootforge/import.ts';
import { mapExercise } from '../sysdrills/import.ts';
import { ImportError, readModules, type SysdrillsModule } from '../sysdrills/source.ts';
import { AGENTDRILLS_EXPECTED, precisionRecallTest, readFixtures, type AgentdrillsFixture } from './source.ts';

/**
 * seed:import:agentdrills (rv3 S4 W8, C8 eval lab) — the committed agentdrills authoring
 * (tools/seed/authoring/agentdrills: sysdrills-authoring@1 modules + one fixture per exercise) → pack files
 * content/packs/agentdrills/<module>.json + manifest.json, on the AGENTIC track.
 *
 * Reuses the sysdrills source schema (readModules) and mapExercise unchanged (every sysdrills refusal holds:
 * NN-kebab ids, TODO starters, tests touching `mod.`, the hint-2 prose rule, no formula in "Your task"); the
 * mapped unit is then re-keyed agentdrills/<module>/<slug>, put on track agentic with competency
 * agentic-engineering, and given one generated test: the learner's grader against the fixture's hand
 * labels at precision and recall >= 0.9 (source.ts). Refusals (nothing written): an exercise without a
 * fixture, a fixture without an exercise, a fixture rule (source.ts checkFixture), a census other than
 * AGENTDRILLS_EXPECTED. Same authoring bytes → same pack bytes. Not under factory/ (not fingerprinted).
 */

export const SOURCE_KEY = 'agentdrills';
export const TRACK = 'agentic' as const;
export const COMPETENCY = 'agentic-engineering' as const;
export const GRADER = 'js' as const;
export const REPO_NAME = 'elirc/selfboot';
export const AUTHORING_SUBPATH = 'tools/seed/authoring/agentdrills';
export const LESSON_ID = 'drills';

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
export const DEFAULT_AUTHORING_DIR = join(REPO, ...AUTHORING_SUBPATH.split('/'));
export const DEFAULT_OUT_DIR = join(REPO, 'content', 'packs', SOURCE_KEY);

export { AGENTDRILLS_EXPECTED, ImportError };

export const stableKey = (module: string, slug: string): string => `${SOURCE_KEY}/${module}/${slug}`;

/** Build one pack course file (validated) from an authoring module and its fixtures. */
export function buildCourseFile(m: SysdrillsModule, fixtures: ReadonlyMap<string, AgentdrillsFixture>): PackCourseFile {
  const units: PackUnit[] = [];
  const content: Record<string, UnitContentEntry> = {};
  m.exercises.forEach((ex, i) => {
    const fx = fixtures.get(`${m.module}/${ex.slug}`);
    if (!fx) throw new ImportError(`${m.module}/${ex.slug}: no fixture (fixtures/${m.module}/${ex.slug}.json): every agentdrill grades recorded cases against hand labels`);
    const pr = precisionRecallTest(fx);
    if (ex.tests.some((t) => t.name === pr.name)) throw new ImportError(`${m.module}/${ex.slug}: a test is already named ${JSON.stringify(pr.name)} (the importer adds it)`);
    const mapped = mapExercise(m.module, { ...ex, tests: [...ex.tests, pr] }, i);
    const key = stableKey(m.module, ex.slug);
    const unit = { ...mapped.packUnit.unit, key, track: TRACK, competencies: [COMPETENCY] } as LessonSpec;
    units.push({ ...mapped.packUnit, unit } as PackUnit);
    content[key] = mapped.content;
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

function gitInfo(dir: string): { gitHead: string | null; dirty: boolean | null } {
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return { gitHead: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--', '.']).length > 0 };
  } catch {
    return { gitHead: null, dirty: null };
  }
}

export interface ImportOptions {
  authoringDir: string;
  outDir: string;
  expected: PackCounts | null;
  recordGit?: boolean;
}

export interface ImportResult {
  manifest: PackManifest;
  written: string[];
  removed: string[];
}

/** Import every module (read-only) and write the pack. Every refusal runs BEFORE anything is written. */
export function importAgentdrills(opts: ImportOptions): ImportResult {
  const modules = readModules(opts.authoringDir);
  const fixtures = readFixtures(opts.authoringDir);
  const slugs = new Set(modules.flatMap((m) => m.exercises.map((e) => `${m.module}/${e.slug}`)));
  for (const k of fixtures.keys()) if (!slugs.has(k)) throw new ImportError(`fixture ${k} has no exercise`);
  const built = modules.map((m) => {
    const file = buildCourseFile(m, fixtures);
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
    importedFrom: { repo: REPO_NAME, originKind: 'local', subpath: AUTHORING_SUBPATH, path: resolve(opts.authoringDir).replace(/\\/g, '/'), ...git },
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
