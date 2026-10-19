/**
 * Pins checked against git itself (not against the checkout that produced them).
 *
 * A seed pack pins its source repo by sha and records the git blob id of every
 * file it read or cited. Those ids are only worth anything if they are the ids
 * git has at that sha (`git ls-tree -r <sha>`). This module is the one place that
 * talks to the mirror (`.cache/repos/<repo>`, or an importer's `.cache/sources/<repo>`):
 *   - gitTree:        the blob map of a commit (ls-tree, no filters involved)
 *   - extractTree:    the checkout recipe — every blob written byte-for-byte from
 *                     `git cat-file --batch` into a FRESH temp dir that is then
 *                     renamed into place (no smudge filters, no autocrlf, no
 *                     .gitattributes eol / export-subst rewriting, and no stale files
 *                     surviving from an older extraction)
 *   - checkTreeShape: the cheap open-time check (path set + byte sizes)
 *   - verifyManifestBlobs: seed:pins — recorded ids vs the tree
 *
 * The rule is BYTE IDENTITY with the blob, never "no CR": about 30 of the pinned
 * repos legitimately commit CRLF files (j1/j2 guides, nopCommerce, eShop, ...),
 * and those must keep their CRs while autocrlf-converted LF files must lose them.
 * Every git call pins `core.autocrlf=false` on the command line (this machine's
 * SYSTEM gitconfig sets it to true).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { buildRepoIndex, DEFAULT_EXCLUDED_DIRS } from '../citations/resolve.ts';
import { gitBlobSha1 } from './util.ts';

export class PinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinError';
  }
}

/** git with this repo's non-negotiable config: no line-ending conversion, ever. */
export function gitBytes(dir: string, args: readonly string[], input?: string | Buffer): Buffer {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-C', dir, ...args], {
    input,
    env,
    maxBuffer: 1 << 30,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

export interface TreeEntry {
  /** 100644 / 100755 / 120000 (symlink: the blob is the link text) */
  mode: string;
  id: string;
  size: number;
}
/** repo-relative posix path -> blob (submodule commits are not blobs and are left out) */
export type GitTree = Map<string, TreeEntry>;

/** The full commit id `sha` (7-40 hex) names in `mirror`, or null (not a repo / sha absent, e.g. a shallow mirror at a newer HEAD). */
export function resolveCommit(mirror: string, sha: string): string | null {
  if (!existsSync(mirror)) return null;
  try {
    const out = gitBytes(mirror, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]).toString('utf8').trim();
    return /^[0-9a-f]{40}$/.test(out) && out.startsWith(sha) ? out : null;
  } catch {
    return null;
  }
}

const treeCache = new Map<string, GitTree>();

/** `git ls-tree -r -l -z <commit>`: every blob at the commit, with its size. */
export function gitTree(mirror: string, commit: string): GitTree {
  const k = `${resolve(mirror)}\u0000${commit}`;
  const hit = treeCache.get(k);
  if (hit) return hit;
  const raw = gitBytes(mirror, ['ls-tree', '-r', '-l', '-z', '--full-tree', commit]).toString('utf8');
  const tree: GitTree = new Map();
  for (const rec of raw.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [mode, type, id, size] = rec.slice(0, tab).split(/ +/);
    if (type !== 'blob') continue;
    tree.set(rec.slice(tab + 1), { mode: mode!, id: id!, size: Number(size) });
  }
  treeCache.set(k, tree);
  return tree;
}

/** Mirror roots: BOOTQUEST_REPOS (path list) first, then <cache>/repos and <cache>/sources. */
export function mirrorRoots(cacheDir: string | null): string[] {
  const env = (process.env.BOOTQUEST_REPOS ?? '').split(delimiter).filter(Boolean);
  return [...env, ...(cacheDir ? [join(cacheDir, 'repos'), join(cacheDir, 'sources')] : [])].map((d) => resolve(d));
}

export type MirrorLookup =
  | { found: true; mirror: string; commit: string }
  /** no mirror dir for the repo at all: the pin cannot be checked */
  | { found: false; why: 'no-mirror'; tried: string[] }
  /** a mirror exists but does not have the commit (shallow at another HEAD): fetch it */
  | { found: false; why: 'sha-missing'; mirrors: string[] };

export function findMirror(repo: string, sha: string, roots: readonly string[]): MirrorLookup {
  const present: string[] = [];
  for (const r of roots) {
    const dir = join(r, repo);
    if (!existsSync(dir)) continue;
    present.push(dir);
    const commit = resolveCommit(dir, sha);
    if (commit) return { found: true, mirror: dir, commit };
  }
  if (present.length) return { found: false, why: 'sha-missing', mirrors: present };
  return { found: false, why: 'no-mirror', tried: roots.map((r) => join(r, repo)) };
}

/** The shell to obtain a mirror holding `sha` (printed by refusals; never run by the factory). */
export function fetchHint(repo: string, sha: string, cacheDir: string): string {
  const m = join(cacheDir, 'repos', repo).replace(/\\/g, '/');
  return `[ -d "${m}" ] || gh repo clone elirc/${repo} "${m}" -- --depth 1 -q; git -C "${m}" fetch --depth 1 origin ${sha}`;
}

const skipPath = (rel: string): boolean => rel.split('/').some((s) => DEFAULT_EXCLUDED_DIRS.includes(s));

/**
 * Write every blob of `commit` byte-for-byte into `dest`, via a fresh sibling temp
 * dir renamed into place: an old extraction at `dest` is replaced whole (moved
 * aside, then deleted), so files the commit does not have can never survive.
 * Symlinks (mode 120000) are written as plain files holding the link text (what
 * git does with core.symlinks=false). Submodules are skipped (no blob).
 */
export function extractTree(mirror: string, commit: string, dest: string): { files: number; bytes: number } {
  const tree = gitTree(mirror, commit);
  const lower = new Map<string, string>();
  for (const rel of tree.keys()) {
    if (rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s === '.' || s === '') || /[:<>"|?*\\]/.test(rel)) {
      throw new PinError(`${commit.slice(0, 12)}: path ${JSON.stringify(rel)} cannot be written on this filesystem`);
    }
    const prev = lower.get(rel.toLowerCase());
    if (prev) throw new PinError(`${commit.slice(0, 12)}: ${prev} and ${rel} differ only by case (cannot coexist on this filesystem)`);
    lower.set(rel.toLowerCase(), rel);
  }
  const parent = dirname(resolve(dest));
  mkdirSync(parent, { recursive: true });
  // siblings of dest (same volume, so the renames below are atomic directory moves)
  const tmp = mkdtempSync(`${resolve(dest)}.tmp-`);
  let files = 0;
  let bytes = 0;
  try {
    const entries = [...tree.entries()];
    // chunks keep each cat-file output well under the buffer cap
    for (let i = 0; i < entries.length; ) {
      const chunk: Array<[string, TreeEntry]> = [];
      let sz = 0;
      while (i < entries.length && (chunk.length === 0 || (chunk.length < 2000 && sz + entries[i]![1].size < 256 * 1024 * 1024))) {
        sz += entries[i]![1].size;
        chunk.push(entries[i++]!);
      }
      const out = gitBytes(mirror, ['cat-file', '--batch'], `${chunk.map(([, e]) => e.id).join('\n')}\n`);
      let off = 0;
      for (const [rel, e] of chunk) {
        const nl = out.indexOf(10, off);
        const head = out.subarray(off, nl).toString('utf8').split(' ');
        if (head[0] !== e.id || head[1] !== 'blob') throw new PinError(`cat-file returned ${head.join(' ')} for ${rel} (${e.id})`);
        const size = Number(head[2]);
        const body = out.subarray(nl + 1, nl + 1 + size);
        off = nl + 1 + size + 1;
        if (gitBlobSha1(body) !== e.id) throw new PinError(`${rel}: blob bytes do not hash to ${e.id}`);
        const abs = join(tmp, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, body);
        files++;
        bytes += size;
      }
    }
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw err;
  }
  const target = resolve(dest);
  if (existsSync(target)) {
    const old = mkdtempSync(`${target}.old-`);
    renameSync(target, join(old, 'co'));
    renameSync(tmp, target);
    rmSync(old, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } else {
    renameSync(tmp, target);
  }
  return { files, bytes };
}

/**
 * Cheap open-time check of a plain checkout against its tree: the same file set
 * (a stale overlay leaves extra files; a wrong sha or a partial extraction leaves
 * missing ones) and the same byte size per file (autocrlf conversion grows every
 * LF file by its line count). `deep` also hashes every file (byte identity).
 * Paths under .git/node_modules are out of scope (the repo index skips them too).
 */
export function checkTreeShape(root: string, tree: GitTree, opts: { deep?: boolean } = {}): string[] {
  const files = buildRepoIndex(root, DEFAULT_EXCLUDED_DIRS).files;
  const problems: string[] = [];
  for (const [rel, e] of tree) {
    if (skipPath(rel) || e.mode === '120000') continue;
    if (!files.has(rel)) {
      problems.push(`${rel}: missing (in git at this sha)`);
      continue;
    }
    const abs = join(root, rel);
    const size = statSync(abs).size;
    if (size !== e.size) {
      problems.push(`${rel}: ${size} bytes, git blob has ${e.size}${size > e.size ? ' (CRLF-converted?)' : ''}`);
      continue;
    }
    if (opts.deep) {
      const id = gitBlobSha1(readFileSync(abs));
      if (id !== e.id) problems.push(`${rel}: blob ${id.slice(0, 12)} != git ${e.id.slice(0, 12)}`);
    }
  }
  for (const rel of files) if (!tree.has(rel)) problems.push(`${rel}: not in git at this sha (stale file from an older extraction?)`);
  return problems.sort();
}

export interface ManifestPinResult {
  status: 'ok' | 'mismatch' | 'uncheckable';
  /** mismatch: per-file lines; uncheckable: why */
  problems: string[];
  checked: number;
  mirror: string | null;
}

/** seed:pins for one manifest's (repo, sha, blobs): every recorded id must be git's id at the sha. */
export function verifyManifestBlobs(repo: string, sha: string, blobs: Record<string, string>, roots: readonly string[]): ManifestPinResult {
  const m = findMirror(repo, sha, roots);
  if (!m.found) {
    return {
      status: 'uncheckable',
      problems: [m.why === 'no-mirror' ? `no mirror for ${repo} (looked in ${m.tried.join(', ')})` : `mirror ${m.mirrors.join(', ')} lacks ${sha.slice(0, 12)} (fetch it)`],
      checked: 0,
      mirror: null,
    };
  }
  const tree = gitTree(m.mirror, m.commit);
  const problems: string[] = [];
  for (const [rel, want] of Object.entries(blobs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const e = tree.get(rel);
    if (!e) problems.push(`${rel}: not in git at ${sha.slice(0, 12)} (manifest ${want.slice(0, 12)})`);
    else if (e.id !== want) problems.push(`${rel}: manifest ${want.slice(0, 12)} != git ${e.id.slice(0, 12)}`);
  }
  return { status: problems.length ? 'mismatch' : 'ok', problems, checked: Object.keys(blobs).length, mirror: m.mirror };
}
