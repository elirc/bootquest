import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * csbootcamp upstream (github.com/elirc/csbootcamp) — READ-ONLY source.
 *
 * Fetched at a PINNED sha into a gitignored cache (<repo>/.cache/sources/csbootcamp):
 * shallow single-commit fetch, `core.autocrlf=false` so the working tree holds the
 * upstream LF bytes (LEARNING P2: copy LF files, not autocrlf-converted ones).
 * Every git call uses `git -C <dir>` (never cd). A cached checkout is reused only
 * when HEAD is the pinned sha and the tree is clean; otherwise the dir is re-fetched,
 * but only if it is absent, empty, or carries CACHE_MARKER (made by this tool) —
 * a user-supplied --cache that names anything else is refused, never deleted.
 *
 * Layout read (bootcamp/_lib/FORMAT.md): bootcamp/NN-topic/{README.md,
 * exercises/NN-name.cs, solutions/NN-name.cs}; files starting with `_` ignored.
 */

export const CSBOOTCAMP_REPO = 'elirc/csbootcamp';
export const CSBOOTCAMP_URL = 'https://github.com/elirc/csbootcamp.git';
/** pinned upstream commit (P2 fetched its fixtures at this sha) */
export const CSBOOTCAMP_SHA = 'e05b3505f22acbb95ed4531204e08991d29a7da9';

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

/**
 * Ownership marker: ensureCheckout writes it into every cache dir it CREATES and
 * deletes a directory only when the marker is there. `--cache` is user-supplied
 * (a mix-up with a real working copy must never wipe it, .git and all).
 */
export const CACHE_MARKER = '.bootquest-cache';

/**
 * Every call pins `core.autocrlf=false` on the command line: a system/global
 * `autocrlf=true` (this machine's default) must neither convert the checkout's
 * bytes nor make our own checkout look dirty on a re-run.
 */
function git(dir: string, args: string[], timeoutMs = 120_000): string {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-C', dir, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  }).trim();
}

function headOf(dir: string): string | null {
  try {
    return git(dir, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
}

export interface CheckoutInfo {
  dir: string;
  sha: string;
  /** true when this call fetched (false = reused the cached checkout) */
  fetched: boolean;
}

/** true when `dir` carries the marker ensureCheckout writes into directories it created. */
export function isOwnedCache(dir: string): boolean {
  try {
    return lstatSync(join(dir, CACHE_MARKER)).isFile();
  } catch {
    return false;
  }
}

/**
 * What ensureCheckout may do with an existing `dir` that is not a reusable checkout:
 * 'create' (absent or empty: nothing to delete), 'replace' (ours: marker present),
 * or 'refuse' (anything else: never deleted).
 */
export function cacheDisposition(dir: string): 'create' | 'replace' | 'refuse' {
  let st;
  try {
    st = lstatSync(dir);
  } catch {
    return 'create';
  }
  if (!st.isDirectory()) return 'refuse';
  if (readdirSync(dir).length === 0) return 'create';
  return isOwnedCache(dir) ? 'replace' : 'refuse';
}

/**
 * Ensure `dir` is a clean LF checkout of `sha` (fetching it if needed). A clean
 * checkout at `sha` is reused read-only whoever made it; otherwise `dir` is
 * deleted and re-fetched ONLY if this tool created it (CACHE_MARKER) — a foreign
 * non-empty directory is refused with a SourceError and left untouched.
 */
export function ensureCheckout(dir: string, sha: string = CSBOOTCAMP_SHA, url: string = CSBOOTCAMP_URL): CheckoutInfo {
  if (existsSync(join(dir, '.git')) && headOf(dir) === sha) {
    let clean = false;
    try {
      // --local: the checkout itself must have been made LF (the -c override would always say false)
      clean = git(dir, ['config', '--local', '--get', 'core.autocrlf']) === 'false' && git(dir, ['status', '--porcelain']) === '';
    } catch {
      clean = false;
    }
    if (clean) return { dir, sha, fetched: false };
  }
  const disposition = cacheDisposition(dir);
  if (disposition === 'refuse') {
    throw new SourceError(
      `refusing to delete ${dir}: it is not a cache directory this tool created (no ${CACHE_MARKER} marker) and not a clean ` +
        `core.autocrlf=false checkout of ${sha}. Point --cache at a new or empty directory ` +
        `(or delete this one yourself if it really is a disposable old cache).`,
    );
  }
  if (disposition === 'replace') rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(dir, { recursive: true });
  // marker first: a fetch that dies half-way still leaves a directory we may replace
  writeFileSync(join(dir, CACHE_MARKER), `BootQuest source cache (ensureCheckout) for ${url}\nSafe to delete; the importer re-fetches it.\n`);
  git(dir, ['init', '--quiet']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  // the marker is untracked: keep it out of `git status` so the cache counts as clean on re-runs
  mkdirSync(join(dir, '.git', 'info'), { recursive: true });
  appendFileSync(join(dir, '.git', 'info', 'exclude'), `\n/${CACHE_MARKER}\n`);
  git(dir, ['remote', 'add', 'origin', url]);
  git(dir, ['fetch', '--quiet', '--depth', '1', 'origin', sha], 300_000);
  git(dir, ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
  const head = headOf(dir);
  if (head !== sha) throw new SourceError(`fetched ${url} but HEAD is ${String(head)}, not the pinned ${sha}`);
  return { dir, sha, fetched: true };
}

/** Upstream bytes, normalized: BOM stripped, CRLF -> LF. */
export const readText = (path: string): string => readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

export interface CsSourceExercise {
  module: string;
  /** file stem, e.g. 01-count-vowels */
  slug: string;
  exercise: string;
  solution: string;
}

export interface CsSourceModule {
  id: string;
  readme: string;
  exercises: CsSourceExercise[];
}

/** Read every module (NN-*) under <root>/bootcamp, in directory order. */
export function readModules(root: string): CsSourceModule[] {
  const bootcamp = join(root, 'bootcamp');
  if (!existsSync(bootcamp)) throw new SourceError(`no bootcamp/ under ${root}`);
  const modules: CsSourceModule[] = [];
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
            .filter((f) => f.endsWith('.cs') && !f.startsWith('_'))
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
        slug: f.replace(/\.cs$/, ''),
        exercise: readText(join(exDir, f)),
        solution: readText(join(solDir, f)),
      })),
    });
  }
  return modules;
}

export interface ParsedHeader {
  number: string;
  title: string;
  stars: number;
  tier: string;
  concepts: string[];
  /** prompt (exercise) or walkthrough (solution) text, comment markers stripped */
  body: string;
}

const RULE = /^\/\/ ─{20,}\s*$/;

/**
 * Parse the FORMAT.md header block: rule, `NN · name  ★★☆ tier`, `concepts:`,
 * `run:`, rule, then `//` comment lines up to the first non-comment line.
 */
export function parseHeader(src: string, label: string): ParsedHeader {
  const lines = src.split('\n');
  if (!RULE.test(lines[0] ?? '')) throw new SourceError(`${label}: line 1 is not the header rule`);
  const m = /^\/\/\s+(\d{2}) · (.+?)\s{2,}([★☆]{3})\s+(\S.*?)\s*$/.exec(lines[1] ?? '');
  if (!m) throw new SourceError(`${label}: line 2 is not "NN · name   ★★☆ tier": ${JSON.stringify(lines[1])}`);
  const c = /^\/\/\s+concepts:\s*(.+?)\s*$/.exec(lines[2] ?? '');
  if (!c) throw new SourceError(`${label}: line 3 is not a concepts: line`);
  if (!/^\/\/\s+run:/.test(lines[3] ?? '')) throw new SourceError(`${label}: line 4 is not a run: line`);
  if (!RULE.test(lines[4] ?? '')) throw new SourceError(`${label}: line 5 is not the closing header rule`);
  const body: string[] = [];
  for (let i = 5; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.startsWith('//')) break;
    body.push(l.replace(/^\/\/ ?( ?)/, ''));
  }
  while (body.length && body[0]!.trim() === '') body.shift();
  while (body.length && body[body.length - 1]!.trim() === '') body.pop();
  const stars = [...m[3]!].filter((ch) => ch === '★').length;
  return {
    number: m[1]!,
    title: m[2]!.replace(/\s+—\s+SOLUTION$/, '').trim(),
    stars,
    tier: m[4]!,
    concepts: c[1]!.split('·').map((s) => s.trim()).filter(Boolean),
    body: body.join('\n'),
  };
}
