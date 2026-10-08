import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { GithubClient } from './github.ts';

const execFileP = promisify(execFile);

/**
 * Per-SHA GitHub caches on disk (gitignored `.cache/github/`). Curriculum text
 * lives HERE, never in the DB (spec §3.2 / §9).
 *
 *   <root>/<owner>/<name>/<sha>.tar.gz           tarball cache (one per synced sha)
 *   <root>/<owner>/<name>/<sha>/                  extracted tree (complete only when
 *   <root>/<owner>/<name>/<sha>.complete          this marker exists)
 *   <root>/<owner>/<name>/blobs/<sha>/<path>      render cache: single blobs fetched on
 *                                                 first view when no tree is cached
 *
 * Content at a sha is immutable, so a cache entry never goes stale. Once a
 * sha's tree (or a blob) is cached, everything that needs it — rendering,
 * check-file revalidation, re-sync — works with the network cut.
 */

export class CacheMissError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheMissError';
  }
}

export class CachePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CachePathError';
  }
}

const SHA_RE = /^[0-9a-f]{40}$/;
const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** A repo-relative POSIX path, validated (no absolute, no .., no backslashes, no NUL). */
export function assertRelPath(rel: string): string {
  if (rel.length === 0 || rel.includes('\\') || rel.includes('\0') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
    throw new CachePathError(`invalid repo path ${JSON.stringify(rel)}`);
  }
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new CachePathError(`invalid repo path ${JSON.stringify(rel)}`);
  return rel;
}

function inside(root: string, rel: string): string {
  const abs = resolve(root, ...assertRelPath(rel).split('/'));
  if (!abs.startsWith(resolve(root) + sep)) throw new CachePathError(`path escapes the cache: ${JSON.stringify(rel)}`);
  return abs;
}

/** The tar binary: Windows' bundled bsdtar (GNU tar from Git Bash misreads `C:` paths as remote hosts). */
export function tarBinary(env: Record<string, string | undefined> = process.env): string {
  if (process.platform === 'win32') {
    const sys = join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32', 'tar.exe');
    if (existsSync(sys)) return sys;
  }
  return 'tar';
}

/** Pack `srcDir` as a GitHub-style tarball (single top-level `prefix/` dir). Tests + the demo's fake-sha simulation. */
export async function packTarball(srcDir: string, destFile: string, prefix = 'repo-snapshot'): Promise<void> {
  const stage = `${destFile}.stage`;
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(srcDir, join(stage, prefix), { recursive: true });
  mkdirSync(dirname(destFile), { recursive: true });
  try {
    await execFileP(tarBinary(), ['-czf', destFile, '-C', stage, prefix], { windowsHide: true, timeout: 120_000 });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** Every regular file under `dir` as sorted repo-relative POSIX paths (skips .git and node_modules). */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const d of readdirSync(abs, { withFileTypes: true })) {
      if (d.name === '.git' || d.name === 'node_modules') continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(join(abs, d.name), r);
      else if (d.isFile()) out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

export type ServedFrom = 'tarball-cache' | 'blob-cache' | 'network';

export interface EnsureTreeResult {
  dir: string;
  tarball: 'hit' | 'downloaded';
}

export class GithubCache {
  readonly root: string;
  private readonly github: GithubClient;
  private readonly inflight = new Map<string, Promise<EnsureTreeResult>>();

  constructor(root: string, github: GithubClient) {
    this.root = resolve(root);
    this.github = github;
  }

  private repoDir(repo: string): string {
    if (!REPO_RE.test(repo)) throw new CachePathError(`invalid repo ${JSON.stringify(repo)}`);
    const [owner, name] = repo.split('/') as [string, string];
    return join(this.root, owner, name);
  }

  private shaOk(sha: string): string {
    if (!SHA_RE.test(sha)) throw new CachePathError(`cache keys need a full 40-hex sha, got ${JSON.stringify(sha)}`);
    return sha;
  }

  tarballPath(repo: string, sha: string): string {
    return join(this.repoDir(repo), `${this.shaOk(sha)}.tar.gz`);
  }

  treeDir(repo: string, sha: string): string {
    return join(this.repoDir(repo), this.shaOk(sha));
  }

  private marker(repo: string, sha: string): string {
    return join(this.repoDir(repo), `${this.shaOk(sha)}.complete`);
  }

  hasTree(repo: string, sha: string): boolean {
    return existsSync(this.marker(repo, sha));
  }

  hasTarball(repo: string, sha: string): boolean {
    return existsSync(this.tarballPath(repo, sha));
  }

  /**
   * The extracted tree at `sha`: cache hit if extracted or if the tarball is
   * cached (re-extracted offline); otherwise ONE tarball download.
   */
  ensureTree(repo: string, sha: string): Promise<EnsureTreeResult> {
    const key = `${repo}@${sha}`;
    let p = this.inflight.get(key);
    if (!p) {
      p = this.ensureTreeUncached(repo, sha).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  private async ensureTreeUncached(repo: string, sha: string): Promise<EnsureTreeResult> {
    const dir = this.treeDir(repo, sha);
    if (this.hasTree(repo, sha)) return { dir, tarball: 'hit' };
    const tgz = this.tarballPath(repo, sha);
    let tarball: EnsureTreeResult['tarball'] = 'hit';
    if (!existsSync(tgz)) {
      await this.github.downloadTarball(repo, sha, tgz);
      tarball = 'downloaded';
    }
    const stage = `${dir}.extracting-${process.pid}`;
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    try {
      // GitHub tarballs hold one top-level "<owner>-<name>-<short sha>/" dir
      await execFileP(tarBinary(), ['-xzf', tgz, '-C', stage, '--strip-components=1'], { windowsHide: true, timeout: 300_000 });
      rmSync(dir, { recursive: true, force: true });
      renameSync(stage, dir);
    } catch (err) {
      rmSync(stage, { recursive: true, force: true });
      throw err;
    }
    writeFileSync(this.marker(repo, sha), `${repo}@${sha}\n`);
    return { dir, tarball };
  }

  /** Absolute path of `rel` inside the extracted tree at `sha` (downloads the tarball on a miss). */
  async treeFile(repo: string, sha: string, rel: string): Promise<string> {
    const { dir } = await this.ensureTree(repo, sha);
    const abs = inside(dir, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new CacheMissError(`${repo}@${sha}: no file ${rel}`);
    return abs;
  }

  /**
   * Bytes of one file at `sha`, for rendering: from the extracted tree when
   * that sha is cached, else from the blob render cache, else ONE blob fetch
   * (first view), stored so every later view is offline.
   */
  async readBlob(repo: string, sha: string, rel: string): Promise<{ bytes: Buffer; servedFrom: ServedFrom }> {
    assertRelPath(rel);
    if (this.hasTree(repo, sha)) {
      const abs = inside(this.treeDir(repo, sha), rel);
      if (!existsSync(abs)) throw new CacheMissError(`${repo}@${sha}: no file ${rel}`);
      return { bytes: readFileSync(abs), servedFrom: 'tarball-cache' };
    }
    const blobAbs = inside(join(this.repoDir(repo), 'blobs', this.shaOk(sha)), rel);
    if (existsSync(blobAbs)) return { bytes: readFileSync(blobAbs), servedFrom: 'blob-cache' };
    const bytes = await this.github.fetchBlob(repo, sha, rel);
    mkdirSync(dirname(blobAbs), { recursive: true });
    writeFileSync(`${blobAbs}.part`, bytes);
    renameSync(`${blobAbs}.part`, blobAbs);
    return { bytes, servedFrom: 'network' };
  }
}
