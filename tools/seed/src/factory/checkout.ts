/**
 * A source checkout at a pinned sha (spec §7: "resolve in the repo at the
 * pinned SHA"). W4's tarball cache will hand us extracted trees; today any
 * plain directory is accepted.
 *   pin = 'git-head'        the dir has a .git and its HEAD equals --sha
 *   pin = 'caller-asserted' a plain dir (tarball / git archive): the caller
 *                           vouches for the sha; the pack records the git blob
 *                           id of every file read or cited, so the pin is
 *                           checkable later against `git ls-tree <sha>`.
 * A .git checkout whose HEAD differs from --sha is refused.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { buildRepoIndex, DEFAULT_EXCLUDED_DIRS, type RepoIndex } from '../citations/resolve.ts';
import { gitBlobSha1 } from './util.ts';

export class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutError';
  }
}

export interface Checkout {
  root: string;
  repo: string;
  sha: string;
  pin: 'git-head' | 'caller-asserted';
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
}

export function openCheckout(opts: OpenCheckoutOptions): Checkout {
  const root = resolve(opts.root);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new CheckoutError(`checkout ${root} is not a directory`);
  if (!/^[0-9a-f]{7,40}$/.test(opts.sha)) throw new CheckoutError(`--sha must be a 7-40 char lowercase hex git sha, got "${opts.sha}"`);
  const repo = opts.repo ?? basename(root).replace(/@[0-9a-f]{7,40}$/, '');
  const head = readGitHead(root);
  let pin: Checkout['pin'] = 'caller-asserted';
  if (head !== null) {
    if (!head.startsWith(opts.sha)) throw new CheckoutError(`checkout ${root} is at ${head.slice(0, 12)}, not the pinned ${opts.sha}`);
    pin = 'git-head';
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
  return { root, repo, sha: opts.sha, pin, excludeDirs, index, fullIndex, blobs: new Map() };
}

/** Read a repo file's bytes, recording its blob id in the checkout's pin set. */
export function readTracked(co: Checkout, rel: string): string {
  const bytes = readFileSync(join(co.root, rel));
  co.blobs.set(rel, gitBlobSha1(bytes));
  return bytes.toString('utf8').replace(/^﻿/, '');
}

/** Record the blob of a cited (not ingested) file. */
export function pinFile(co: Checkout, rel: string): void {
  if (co.blobs.has(rel) || !co.fullIndex.files.has(rel)) return;
  co.blobs.set(rel, gitBlobSha1(readFileSync(join(co.root, rel))));
}

/** Compare recorded blobs with the checkout (seed:check): returns mismatches. */
export function verifyBlobs(co: Checkout, blobs: Record<string, string>): string[] {
  const bad: string[] = [];
  for (const [rel, want] of Object.entries(blobs)) {
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
