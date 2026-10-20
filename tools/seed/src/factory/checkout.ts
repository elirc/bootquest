/**
 * A source checkout at a pinned sha (spec §7: "resolve in the repo at the
 * pinned SHA").
 *   pin = 'git-head'        the dir is the top of a real repo whose HEAD equals --sha
 *                           and whose tree git lists (a bare .git/HEAD file with no
 *                           objects is treated as a plain dir: mirror check below)
 *   pin = 'git-tree'        a plain dir checked against a MIRROR holding the sha
 *                           (`<cache>/repos/<repo>` or `<cache>/sources/<repo>`
 *                           next to `<cache>/checkouts/<repo>@<sha>`, or the
 *                           `mirrors` option / BOOTQUEST_REPOS): at open, the
 *                           file set and every byte size must equal
 *                           `git ls-tree -r -l <sha>` (catches a wrong sha, a
 *                           stale overlay and autocrlf-converted bytes)
 *   pin = 'caller-asserted' a plain dir with no mirror (test fixtures, ad-hoc
 *                           dirs): the caller vouches for the sha, nothing is
 *                           checked against git. writeSeedPack refuses to STAMP a
 *                           pack that pins >= 1 blob this way (escape hatch for
 *                           fixtures: BOOTQUEST_SEED_ALLOW_UNVERIFIED_PIN=1), and
 *                           seed:check fails a pack recorded git-tree/git-head whose
 *                           checkout now opens caller-asserted (no silent downgrade).
 *                           `seed:pins` reports a caller-asserted pack UNCHECKABLE
 *                           until a mirror exists — unless it pins 0 blobs: nothing
 *                           pinned is nothing to verify, so it is OK by definition
 *                           (a variants pack made without --checkout).
 * Refused: a .git checkout whose HEAD differs from --sha; a mirror that lacks the
 * sha; a plain dir that does not match the mirror's tree.
 * With a tree (git-head or git-tree), every file read or cited must hash to
 * git's blob id at the sha (byte identity, so a repo's own CRLF files keep their
 * CRs and nothing else may have any): a pack can never record a blob id git
 * does not have. Checkouts are made by `npm run seed:checkout` (pins.ts extractTree).
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { buildRepoIndex, DEFAULT_EXCLUDED_DIRS, type RepoIndex } from '../citations/resolve.ts';
import { checkTreeShape, findMirror, gitBytes, gitTree, mirrorRoots, resolveCommit, type GitTree } from './pins.ts';
import { gitBlobSha1 } from './util.ts';

export class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutError';
  }
}

/** How much a pin proves: git-head / git-tree check every byte against git; caller-asserted checks nothing. */
export const pinStrength = (pin: Checkout['pin']): number => (pin === 'caller-asserted' ? 0 : 1);

export interface Checkout {
  root: string;
  repo: string;
  sha: string;
  pin: 'git-head' | 'git-tree' | 'caller-asserted';
  /** git's blob map at the sha (git-head / git-tree); null when caller-asserted */
  tree: GitTree | null;
  excludeDirs: string[];
  /** pruned index (excludeDirs applied): used for unique-suffix matching */
  index: RepoIndex;
  /** full index (only .git/node_modules skipped): exact root/guide-relative lookups may land in snapshot trees */
  fullIndex: RepoIndex;
  /** blob ids of every file read/cited so far (repo-relative -> sha1) */
  blobs: Map<string, string>;
}

function readGitHead(root: string): string | null {
  const dotgit = join(root, '.git');
  if (!existsSync(dotgit)) return null;
  let gitDir = dotgit;
  if (statSync(dotgit).isFile()) {
    // worktree / submodule: "gitdir: <path>"
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotgit, 'utf8'));
    if (!m) return null;
    gitDir = resolve(root, m[1]!.trim());
  }
  const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
  if (/^[0-9a-f]{40}$/.test(head)) return head;
  const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
  if (!ref) return null;
  const commonDir = existsSync(join(gitDir, 'commondir')) ? resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim()) : gitDir;
  for (const d of [gitDir, commonDir]) {
    const loose = join(d, ref);
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim();
  }
  const packed = join(commonDir, 'packed-refs');
  if (existsSync(packed)) {
    for (const line of readFileSync(packed, 'utf8').split('\n')) {
      const [s, r] = line.trim().split(' ');
      if (r === ref && s && /^[0-9a-f]{40}$/.test(s)) return s;
    }
  }
  return null;
}

const samePath = (a: string, b: string): boolean => {
  const norm = (p: string) => {
    const r = realpathSync.native(resolve(p));
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
};

/** git's tree at `head` when `root` is itself the top of a real, listable repo; else null. */
function realRepoTree(root: string, head: string): GitTree | null {
  try {
    const top = gitBytes(root, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
    if (!top || !samePath(top, root)) return null;
    if (resolveCommit(root, head) !== head) return null;
    return gitTree(root, head);
  } catch {
    return null;
  }
}

/** Snapshot dirs inside guide trees duplicate code and make bare suffixes ambiguous (P4). */
export function discoverSnapshotDirs(index: RepoIndex): string[] {
  return [...index.dirs].filter((d) => /(^|\/)snapshots$/.test(d) && !d.split('/').slice(0, -1).some((s) => s === 'snapshots')).sort();
}

export interface OpenCheckoutOptions {
  root: string;
  sha: string;
  /** default: basename of root, with an "@sha" suffix stripped */
  repo?: string;
  /** extra excludeDirs (bare names or repo-relative paths) */
  excludeDirs?: string[];
  /** auto-exclude <x>/snapshots trees (default true) */
  excludeSnapshots?: boolean;
  /**
   * mirror roots holding <repo> git dirs to verify a plain dir against; false = never
   * look. Default: BOOTQUEST_REPOS, plus <cache>/repos and <cache>/sources when the
   * root is laid out as <cache>/checkouts/<repo>@<sha>.
   */
  mirrors?: readonly string[] | false;
}

const CHECKOUT_DIR_RE = /@[0-9a-f]{7,40}$/;

export function openCheckout(opts: OpenCheckoutOptions): Checkout {
  const root = resolve(opts.root);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new CheckoutError(`checkout ${root} is not a directory`);
  if (!/^[0-9a-f]{7,40}$/.test(opts.sha)) throw new CheckoutError(`--sha must be a 7-40 char lowercase hex git sha, got "${opts.sha}"`);
  const repo = opts.repo ?? basename(root).replace(CHECKOUT_DIR_RE, '');
  const head = readGitHead(root);
  let pin: Checkout['pin'] = 'caller-asserted';
  let tree: GitTree | null = null;
  if (head !== null) {
    if (!head.startsWith(opts.sha)) throw new CheckoutError(`checkout ${root} is at ${head.slice(0, 12)}, not the pinned ${opts.sha}`);
    // only a REAL repo rooted here whose tree lists earns git-head (then every file read must be
    // git's blob; an autocrlf working tree is refused per file). A bare .git/HEAD file (no objects,
    // or a dir git does not accept, so it would walk up to an enclosing repo) proves nothing: fall
    // through to the mirror check like any plain dir.
    tree = realRepoTree(root, head);
    if (tree) pin = 'git-head';
  }
  if (tree === null && opts.mirrors !== false) {
    const roots = opts.mirrors ?? mirrorRoots(CHECKOUT_DIR_RE.test(basename(root)) ? dirname(dirname(root)) : null);
    const m = findMirror(repo, opts.sha, roots);
    if (!m.found && m.why === 'sha-missing') {
      throw new CheckoutError(`mirror ${m.mirrors.join(', ')} does not have ${opts.sha}: fetch it (git -C <mirror> fetch --depth 1 origin ${opts.sha}) so the checkout can be verified`);
    }
    if (m.found) {
      tree = gitTree(m.mirror, m.commit);
      const bad = checkTreeShape(root, tree);
      if (bad.length) {
        throw new CheckoutError(
          `checkout ${root} is not ${repo}@${opts.sha.slice(0, 12)} as git has it in ${m.mirror} (${bad.length} problem(s): ${bad.slice(0, 5).join('; ')}${bad.length > 5 ? '; ...' : ''}): re-extract it with npm run seed:checkout`,
        );
      }
      pin = 'git-tree';
    }
  }
  let excludeDirs = [...DEFAULT_EXCLUDED_DIRS, ...(opts.excludeDirs ?? [])];
  const fullIndex = buildRepoIndex(root, DEFAULT_EXCLUDED_DIRS);
  let index = buildRepoIndex(root, excludeDirs);
  if (opts.excludeSnapshots !== false) {
    const snaps = discoverSnapshotDirs(index).filter((d) => !excludeDirs.includes(d));
    if (snaps.length) {
      excludeDirs = [...excludeDirs, ...snaps];
      index = buildRepoIndex(root, excludeDirs);
    }
  }
  return { root, repo, sha: opts.sha, pin, tree, excludeDirs, index, fullIndex, blobs: new Map() };
}

/** Record `rel`'s blob id; with a tree it must be git's id at the sha, or the checkout is refused. */
function record(co: Checkout, rel: string, bytes: Buffer): void {
  const id = gitBlobSha1(bytes);
  if (co.tree) {
    const e = co.tree.get(rel);
    if (!e) throw new CheckoutError(`${rel} is not in git at ${co.repo}@${co.sha.slice(0, 12)}: a pack may only read or cite files of the pinned tree`);
    if (e.id !== id) {
      const crlf = bytes.includes(13) && bytes.length > e.size ? ' (CRLF-converted bytes: re-extract with npm run seed:checkout)' : '';
      throw new CheckoutError(`${rel}: checkout bytes hash to ${id.slice(0, 12)} but git has ${e.id.slice(0, 12)} at ${co.repo}@${co.sha.slice(0, 12)}${crlf}`);
    }
  }
  co.blobs.set(rel, id);
}

/** Read a repo file's bytes, recording its blob id in the checkout's pin set. */
export function readTracked(co: Checkout, rel: string): string {
  const bytes = readFileSync(join(co.root, rel));
  record(co, rel, bytes);
  return bytes.toString('utf8').replace(/^﻿/, '');
}

/** Record the blob of a cited (not ingested) file. */
export function pinFile(co: Checkout, rel: string): void {
  if (co.blobs.has(rel) || !co.fullIndex.files.has(rel)) return;
  record(co, rel, readFileSync(join(co.root, rel)));
}

/** Compare recorded blobs with the checkout (seed:check) and, with a tree, with git itself: returns mismatches. */
export function verifyBlobs(co: Checkout, blobs: Record<string, string>): string[] {
  const bad: string[] = [];
  for (const [rel, want] of Object.entries(blobs)) {
    if (co.tree) {
      const e = co.tree.get(rel);
      if (!e) {
        bad.push(`${rel}: not in git at ${co.sha.slice(0, 12)}`);
        continue;
      }
      if (e.id !== want) {
        bad.push(`${rel}: pinned ${want.slice(0, 12)} != git ${e.id.slice(0, 12)} at ${co.sha.slice(0, 12)} (a blob id git never had at this sha: re-pin with fix-crlf-pins)`);
        continue;
      }
    }
    const abs = join(co.root, rel);
    if (!existsSync(abs)) {
      bad.push(`${rel}: missing in checkout`);
      continue;
    }
    const got = gitBlobSha1(readFileSync(abs));
    if (got !== want) bad.push(`${rel}: blob ${got.slice(0, 12)} != pinned ${want.slice(0, 12)}`);
  }
  return bad;
}
