import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readText, SourceError } from '../csbootcamp/source.ts';

/**
 * javabootcamp upstream (github.com/elirc/javabootcamp, private) — READ-ONLY source.
 *
 * Two ways in:
 *   - pinned GitHub (default): `ensureCheckout(cacheDir, JAVABOOTCAMP_SHA, JAVABOOTCAMP_URL)`
 *     from csbootcamp/source.ts — shallow single-commit fetch, `core.autocrlf=false`,
 *     every git call `git -C <dir>`; cache <repo>/.cache/sources/javabootcamp;
 *   - `--source <localdir>` (dev mode, originKind 'local'): a working copy read in
 *     place; its HEAD and dirtiness are recorded in the manifest.
 *
 * Layout read (bootcamp/_lib/FORMAT.md): bootcamp/NN-topic/{README.md,
 * exercises/NN-name.java, solutions/NN-name.java}; files starting with `_` ignored;
 * the harness lives in bootcamp/_lib/check/bootcamp/{Check,BqMain}.java.
 */

export const JAVABOOTCAMP_REPO = 'elirc/javabootcamp';
export const JAVABOOTCAMP_URL = 'https://github.com/elirc/javabootcamp.git';
/**
 * Pinned upstream commit. The orchestrator re-pins it (with JAVABOOTCAMP_EXPECTED in
 * import.ts) once the repo is pushed; until then use `--source <localdir>`.
 */
export const JAVABOOTCAMP_SHA = '0000000000000000000000000000000000000000';

/** the harness files, relative to bootcamp/ */
export const HARNESS_FILES = ['_lib/check/bootcamp/Check.java', '_lib/check/bootcamp/BqMain.java'] as const;

export interface JavaSourceExercise {
  module: string;
  /** file stem, e.g. 01-count-vowels */
  slug: string;
  exercise: string;
  solution: string;
}

export interface JavaSourceModule {
  id: string;
  readme: string;
  exercises: JavaSourceExercise[];
}

/** Read every module (NN-*) under <root>/bootcamp, in directory order. */
export function readModules(root: string): JavaSourceModule[] {
  const bootcamp = join(root, 'bootcamp');
  if (!existsSync(bootcamp)) throw new SourceError(`no bootcamp/ under ${root}`);
  const modules: JavaSourceModule[] = [];
  const dirs = readdirSync(bootcamp, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{2}-[a-z0-9-]+$/.test(d.name))
    .map((d) => d.name)
    .sort();
  for (const id of dirs) {
    const dir = join(bootcamp, id);
    const exDir = join(dir, 'exercises');
    const solDir = join(dir, 'solutions');
    const list = (d: string) =>
      existsSync(d)
        ? readdirSync(d)
            .filter((f) => f.endsWith('.java') && !f.startsWith('_'))
            .sort()
        : [];
    const exFiles = list(exDir);
    const solFiles = list(solDir);
    const missing = [...exFiles.filter((f) => !solFiles.includes(f)).map((f) => `solutions/${f}`), ...solFiles.filter((f) => !exFiles.includes(f)).map((f) => `exercises/${f}`)];
    if (missing.length) throw new SourceError(`${id}: exercise/solution files do not pair up (missing ${missing.join(', ')})`);
    if (exFiles.length === 0) throw new SourceError(`${id}: no exercises`);
    modules.push({
      id,
      readme: existsSync(join(dir, 'README.md')) ? readText(join(dir, 'README.md')) : '',
      exercises: exFiles.map((f) => ({
        module: id,
        slug: f.replace(/\.java$/, ''),
        exercise: readText(join(exDir, f)),
        solution: readText(join(solDir, f)),
      })),
    });
  }
  return modules;
}

/** HEAD + dirtiness of a local working copy (null/null when it is not a git checkout). */
export function localGitState(dir: string): { gitHead: string | null; dirty: boolean | null } {
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const gitHead = git(['rev-parse', 'HEAD']);
    return { gitHead, dirty: git(['status', '--porcelain']) !== '' };
  } catch {
    return { gitHead: null, dirty: null };
  }
}
