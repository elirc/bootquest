import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * jstrain2.2 upstream (github.com/elirc/jstrain2.2) — read from the claiufe
 * study mirror (Desktop\claiufe\jstrain2.2), which is READ-ONLY: this module
 * only ever reads files. The git HEAD is read from .git files directly; the
 * dirty check runs `git --no-optional-locks status` (no index refresh = no
 * write into the mirror).
 *
 * Layout found at 1a8b3bf6 (W3c recon; R2's summary in brackets):
 *   bootcamp/NN-topic/{README.md, exercises/*.js, solutions/*.js}   29 modules
 *     734 .js exercises [R2: 734 JS] — of which 3 in 25-codebase-debug-hunts
 *     are multi-file apps (exercises/NN-app/ dirs), and 13-dom-and-browser
 *     holds 37 .html DOM exercises (jsdom-graded by its own verify-dom.js)
 *     instead of .js; fixtures/ dirs in 08-iterators-generators-modules
 *   tsbootcamp/NN-topic/{exercises,solutions}/*.ts   8 modules, 124 [R2: 124 TS]
 *   quizzes/NN-*.md   15 files, 453 open-answer items [R2: 453 quiz items] —
 *     NOT multiple choice: "what does this print?" + a <details> model answer
 *   csbootcamp/NN-topic/...   29 modules, 147 C# exercises [R2: 147] — a
 *     DIFFERENT harness revision than github elirc/csbootcamp (Spy.cs, Web.cs),
 *     99 files need `#:sdk Microsoft.NET.Sdk.Web`, 40+ need `#:package`
 *   jstrain/  a SEPARATE vitest + React project (24 files / 274 problems /
 *     1057 tests) [not in R2's summary]
 *   cheatsheets/ guides/ docs/ codexdocs/ portfolio-projects/  study prose
 */

export const JSTRAIN_REPO = 'elirc/jstrain2.2';
export const DEFAULT_MIRROR = 'C:/Users/Owner/Desktop/claiufe/jstrain2.2';
/** the mirror HEAD this importer was written against (W3c recon) */
export const JSTRAIN_SHA = '1a8b3bf6af189136af7d65e70c2c8a0360b4bc5b';

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

/** Upstream bytes, normalized: BOM stripped, CRLF -> LF (the mirror is an autocrlf checkout). */
export const readText = (path: string): string => readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

/** HEAD commit of a checkout, read from .git files (no git process, no writes). */
export function readGitHead(root: string): string | null {
  try {
    const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref: (\S+)$/.exec(head)?.[1];
    if (!ref) return null;
    const loose = join(root, '.git', ...ref.split('/'));
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim();
    const packed = readFileSync(join(root, '.git', 'packed-refs'), 'utf8');
    const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
    return line ? line.split(' ')[0]! : null;
  } catch {
    return null;
  }
}

/** true when the checkout has uncommitted changes (null = unknown). Never refreshes the index. */
export function readGitDirty(root: string): boolean | null {
  try {
    const out = execFileSync('git', ['--no-optional-locks', '-C', root, 'status', '--porcelain', '--untracked-files=no'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
    });
    return out.trim().length > 0;
  } catch {
    return null;
  }
}

export type TrackDir = 'bootcamp' | 'tsbootcamp';

export interface SourceExercise {
  track: TrackDir;
  module: string;
  /** file stem, e.g. 01-type-of */
  slug: string;
  /** file name incl. extension */
  fileName: string;
  exercise: string;
  solution: string;
  /** fixture files the exercise imports (`./fixtures/…`), path relative to the track root's parent */
  fixtures: Record<string, string>;
}

export interface SourceModule {
  track: TrackDir;
  id: string;
  readme: string;
  exercises: SourceExercise[];
}

export interface SkippedGroup {
  what: string;
  reason: string;
  ids: string[];
}

export interface ReadResult {
  modules: SourceModule[];
  skipped: SkippedGroup[];
}

const MODULE_DIR = /^\d{2}-[a-z0-9-]+$/;

const listDir = (d: string): string[] => (existsSync(d) ? readdirSync(d).sort() : []);

/**
 * Read bootcamp/ and tsbootcamp/ exercise modules. Exercises that the
 * single-file self-run runner cannot grade are NOT read as exercises; they are
 * returned in `skipped` with a reason (never silently dropped):
 *   - .html DOM exercises (13-dom-and-browser: jsdom harness)
 *   - multi-file codebase hunts (an `exercises/<stem>-app/` dir next to the file)
 */
export function readExerciseModules(root: string): ReadResult {
  const modules: SourceModule[] = [];
  const skipped: SkippedGroup[] = [];
  const html: string[] = [];
  const multi: string[] = [];
  for (const track of ['bootcamp', 'tsbootcamp'] as const) {
    const base = join(root, track);
    if (!existsSync(base)) throw new SourceError(`no ${track}/ under ${root}`);
    const ext = track === 'bootcamp' ? '.js' : '.ts';
    for (const id of listDir(base).filter((d) => MODULE_DIR.test(d) && statSync(join(base, d)).isDirectory())) {
      const exDir = join(base, id, 'exercises');
      const solDir = join(base, id, 'solutions');
      const exNames = listDir(exDir);
      const solNames = listDir(solDir);
      for (const f of exNames.filter((n) => n.endsWith('.html'))) html.push(`${track}/${id}/exercises/${f}`);
      const files = exNames.filter((n) => n.endsWith(ext) && statSync(join(exDir, n)).isFile());
      const solFiles = solNames.filter((n) => n.endsWith(ext) && statSync(join(solDir, n)).isFile());
      const unpaired = [...files.filter((f) => !solFiles.includes(f)).map((f) => `solutions/${f}`), ...solFiles.filter((f) => !files.includes(f)).map((f) => `exercises/${f}`)];
      if (unpaired.length) throw new SourceError(`${track}/${id}: exercise/solution files do not pair up (missing ${unpaired.join(', ')})`);
      const exercises: SourceExercise[] = [];
      for (const fileName of files) {
        const slug = fileName.slice(0, -ext.length);
        const exercise = readText(join(exDir, fileName));
        const solution = readText(join(solDir, fileName));
        // a sibling app dir the test imports (`./01-shipping-quote-app/…`) = multi-file exercise
        const appDirs = exNames.filter((n) => n !== 'fixtures' && statSync(join(exDir, n)).isDirectory() && new RegExp(`from '\\./${n}/`).test(exercise));
        if (appDirs.length) {
          multi.push(`${track}/${id}/exercises/${fileName}`);
          continue;
        }
        const fixtures: Record<string, string> = {};
        if (/from '\.\/fixtures\//.test(exercise) || /from '\.\/fixtures\//.test(solution)) {
          const fxEx = join(exDir, 'fixtures');
          const fxSol = join(solDir, 'fixtures');
          for (const fx of listDir(fxEx)) {
            const a = readText(join(fxEx, fx));
            const b = existsSync(join(fxSol, fx)) ? readText(join(fxSol, fx)) : null;
            if (b !== a) throw new SourceError(`${track}/${id}: exercises/fixtures/${fx} differs from solutions/fixtures/${fx}`);
            fixtures[`${track}/${id}/exercises/fixtures/${fx}`] = a;
          }
          if (Object.keys(fixtures).length === 0) throw new SourceError(`${track}/${id}/${fileName}: imports ./fixtures/ but the module has none`);
        }
        exercises.push({ track, module: id, slug, fileName, exercise, solution, fixtures });
      }
      if (exercises.length === 0) continue;
      modules.push({ track, id, readme: existsSync(join(base, id, 'README.md')) ? readText(join(base, id, 'README.md')) : '', exercises });
    }
  }
  if (html.length) {
    skipped.push({
      what: 'bootcamp/13-dom-and-browser/exercises/*.html',
      reason: 'browser DOM exercises graded by upstream verify-dom.js in a jsdom window (window.__RESULTS); BootQuest has no DOM runner yet — not importable as self-run',
      ids: html,
    });
  }
  if (multi.length) {
    skipped.push({
      what: 'bootcamp/25-codebase-debug-hunts (multi-file apps)',
      reason: 'the bug lives in a sibling app directory (exercises/NN-*-app/*.js) the learner edits, not in the graded file; a single-file self-run submission cannot carry it',
      ids: multi,
    });
  }
  return { modules, skipped };
}

/** The separate vitest/React project under jstrain/ — counted, not imported. */
export function readVitestProjectCensus(root: string): { files: number; tracks: string[] } {
  const ex = join(root, 'jstrain', 'exercises');
  if (!existsSync(ex)) return { files: 0, tracks: [] };
  let files = 0;
  const tracks = listDir(ex).filter((d) => statSync(join(ex, d)).isDirectory());
  for (const t of tracks) files += listDir(join(ex, t)).filter((f) => statSync(join(ex, t, f)).isFile()).length;
  return { files, tracks };
}

export interface ParsedHeader {
  number: string;
  title: string;
  stars: number;
  tier: string;
  /** empty when the file has no `concepts:` line (most jstrain SOLUTION headers) */
  concepts: string[];
  /** prompt (exercise) or walkthrough (solution) text, comment markers stripped */
  body: string;
}

const RULE = /^\/\/ ─{20,}\s*$/;

/**
 * jstrain header block (bootcamp/_lib/FORMAT.md): rule, `NN · name  ★★☆ tier`,
 * `concepts:` (exercises; solutions usually omit it), `run:`, rule, then `//`
 * comment lines up to the first non-comment line. (csbootcamp's parser demands
 * concepts on solutions too; jstrain's contract does not.)
 */
export function parseJsHeader(src: string, label: string, opts: { solution?: boolean } = {}): ParsedHeader {
  const lines = src.split('\n');
  if (!RULE.test(lines[0] ?? '')) throw new SourceError(`${label}: line 1 is not the header rule`);
  let m = /^\/\/\s+(\d{2}) · (.+?)\s+([★☆]{3})\s+(\S.*?)\s*$/.exec(lines[1] ?? '');
  // solution headers only need their number (stars/tier are sometimes dropped or wrapped upstream)
  if (!m && opts.solution) m = /^\/\/\s+(\d{2}) · (.+?)()()\s*$/.exec(lines[1] ?? '');
  if (!m) throw new SourceError(`${label}: line 2 is not "NN · name   ★★☆ tier": ${JSON.stringify(lines[1])}`);
  let i = 2;
  let concepts: string[] = [];
  const c = /^\/\/\s+concepts:\s*(.+?)\s*$/.exec(lines[i] ?? '');
  if (c) {
    concepts = c[1]!.split('·').map((s) => s.trim()).filter(Boolean);
    i++;
  }
  // the rest of the header block (run: line) up to the closing rule
  while (i < lines.length && i < 8 && !RULE.test(lines[i]!)) {
    if (!lines[i]!.startsWith('//')) throw new SourceError(`${label}: header block is not closed by a rule`);
    i++;
  }
  if (!RULE.test(lines[i] ?? '')) throw new SourceError(`${label}: no closing header rule`);
  const body: string[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j]!;
    if (!l.startsWith('//')) break;
    body.push(l.replace(/^\/\/ ?( ?)/, ''));
  }
  while (body.length && body[0]!.trim() === '') body.shift();
  while (body.length && body[body.length - 1]!.trim() === '') body.pop();
  return {
    number: m[1]!,
    title: m[2]!.replace(/\s+—\s+SOLUTION$/, '').trim(),
    stars: [...m[3]!].filter((ch) => ch === '★').length,
    tier: m[4]!,
    concepts,
    body: body.join('\n'),
  };
}
