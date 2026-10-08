import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Read-only GitHub access for the sync job (spec §3.2). Authentication is the
 * gh CLI's token (`gh auth token`, gh is logged in as elirc) or an explicit
 * BOOTQUEST_GITHUB_TOKEN / GITHUB_TOKEN — DEVIATION already recorded in
 * LEARNING.md: the spec's fine-grained read-only PAT is an owner to-do; the
 * env var is where it plugs in. The token is never logged or stored.
 *
 * Everything the app needs at runtime is reachable through three calls, all
 * injectable (tests and the offline proof stub them to fail).
 */
export interface GithubClient {
  readonly offline: boolean;
  /** the default branch and its current commit */
  resolveHead(repo: string): Promise<{ sha: string; defaultBranch: string }>;
  /** download the repo tarball (.tar.gz) at `sha` to `destFile` */
  downloadTarball(repo: string, sha: string, destFile: string): Promise<void>;
  /** raw bytes of one file at `sha` */
  fetchBlob(repo: string, sha: string, path: string): Promise<Buffer>;
}

export class NetworkUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkUnavailableError';
  }
}

/** A client whose every call fails — BOOTQUEST_OFFLINE=1, and the disconnect proof. */
export function offlineGithubClient(reason = 'offline mode: network access is disabled'): GithubClient {
  const fail = (what: string) => Promise.reject(new NetworkUnavailableError(`${what}: ${reason}`));
  return {
    offline: true,
    resolveHead: (repo) => fail(`resolve HEAD of ${repo}`),
    downloadTarball: (repo, sha) => fail(`download tarball ${repo}@${sha}`),
    fetchBlob: (repo, sha, path) => fail(`fetch ${repo}@${sha}:${path}`),
  };
}

export type FetchFn = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal; redirect?: 'follow' }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface GhClientOptions {
  env?: Record<string, string | undefined>;
  /** token provider; default env token, else `gh auth token` */
  token?: () => string;
  fetchImpl?: FetchFn;
  apiBase?: string;
  timeoutMs?: number;
}

function ghCliToken(): string {
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }).trim();
  } catch (err) {
    throw new NetworkUnavailableError(`no GitHub token: set BOOTQUEST_GITHUB_TOKEN or log in with \`gh auth login\` (${err instanceof Error ? err.message : String(err)})`);
  }
}

function repoPath(repo: string): string {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`bad repo name ${repo}`);
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export function createGithubClient(opts: GhClientOptions = {}): GithubClient {
  const env = opts.env ?? process.env;
  const apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
  const fetchImpl: FetchFn = opts.fetchImpl ?? (fetch as unknown as FetchFn);
  const timeoutMs = opts.timeoutMs ?? 120_000;
  let cached: string | undefined;
  const token = () => {
    cached ??= opts.token?.() ?? (env.BOOTQUEST_GITHUB_TOKEN?.trim() || env.GITHUB_TOKEN?.trim() || ghCliToken());
    return cached;
  };

  async function get(url: string, accept: string) {
    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await fetchImpl(url, {
        headers: {
          accept,
          authorization: `Bearer ${token()}`,
          'user-agent': 'bootquest-sync',
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
    } catch (err) {
      if (err instanceof NetworkUnavailableError) throw err;
      throw new NetworkUnavailableError(`GET ${url} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new NetworkUnavailableError(`GET ${url} answered HTTP ${res.status}${body ? `: ${body}` : ''}`);
    }
    return res;
  }

  return {
    offline: false,
    async resolveHead(repo) {
      const meta = JSON.parse(await (await get(`${apiBase}/repos/${repoPath(repo)}`, 'application/vnd.github+json')).text()) as {
        default_branch?: unknown;
      };
      if (typeof meta.default_branch !== 'string') throw new Error(`GitHub returned no default_branch for ${repo}`);
      const sha = (
        await (await get(`${apiBase}/repos/${repoPath(repo)}/commits/${encodeURIComponent(meta.default_branch)}`, 'application/vnd.github.sha')).text()
      ).trim();
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`GitHub returned a malformed sha for ${repo}: ${sha.slice(0, 60)}`);
      return { sha, defaultBranch: meta.default_branch };
    },
    async downloadTarball(repo, sha, destFile) {
      const res = await get(`${apiBase}/repos/${repoPath(repo)}/tarball/${sha}`, 'application/vnd.github+json');
      const bytes = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(destFile), { recursive: true });
      const tmp = `${destFile}.part`;
      writeFileSync(tmp, bytes);
      rmSync(destFile, { force: true });
      renameSync(tmp, destFile);
    },
    async fetchBlob(repo, sha, path) {
      const enc = path.split('/').map(encodeURIComponent).join('/');
      const res = await get(`${apiBase}/repos/${repoPath(repo)}/contents/${enc}?ref=${sha}`, 'application/vnd.github.raw');
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** Wrap a client to count calls (the M4 demo proves exactly which steps touched the network). */
export function countingClient(inner: GithubClient): GithubClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    offline: inner.offline,
    calls,
    resolveHead: (repo) => (calls.push(`resolveHead ${repo}`), inner.resolveHead(repo)),
    downloadTarball: (repo, sha, dest) => (calls.push(`downloadTarball ${repo}@${sha.slice(0, 7)}`), inner.downloadTarball(repo, sha, dest)),
    fetchBlob: (repo, sha, path) => (calls.push(`fetchBlob ${repo}@${sha.slice(0, 7)}:${path}`), inner.fetchBlob(repo, sha, path)),
  };
}
