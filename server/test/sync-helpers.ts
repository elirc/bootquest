import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CurriculumConfig } from '@bootquest/shared/sync';
import { packTarball } from '../src/sync/cache.ts';
import { NetworkUnavailableError, type GithubClient } from '../src/sync/github.ts';
import { loadCheckSpecTable } from '../src/sync/config.ts';
import { createSyncService, type SyncService } from '../src/sync/service.ts';

export const SIGNALPOST = 'elirc/signalpost-swe-bootcamp';
/** the sha the recorded check table pins (content/sync/check-specs.json) */
export const PINNED_SHA = 'ff8446042a16d0aaef1687b34932b4f9137e6e0d';
export const P3 = fileURLToPath(new URL('../src/runners/node-test-file/fixtures/signalpost/', import.meta.url));
export const FIX = fileURLToPath(new URL('./fixtures/sync/', import.meta.url));
export const CHECK_SPECS = fileURLToPath(new URL('../../content/sync/check-specs.json', import.meta.url));
export const U01_SOLUTION = readFileSync(join(P3, 'solutions', 'u01.mjs'), 'utf8');
export const U01_STARTER = readFileSync(join(P3, 'practice', 'learner', 'u01.mjs'), 'utf8');
export const U03_SOLUTION = readFileSync(join(P3, 'solutions', 'u03.ts'), 'utf8');

/**
 * A signalpost-shaped repo snapshot built from REAL upstream bytes: program.json
 * and U01.md (test fixtures) + practice/checks + practice/learner + the tsconfig
 * chain (P3 fixtures, hash-pinned), plus a reference README and the generated apps/web copy of U01.
 */
export function buildSignalpostTree(dir: string): string {
  mkdirSync(join(dir, 'docs', 'curriculum'), { recursive: true });
  cpSync(join(FIX, 'program.json'), join(dir, 'docs', 'curriculum', 'program.json'));
  cpSync(join(FIX, 'U01.md'), join(dir, 'docs', 'curriculum', 'U01.md'));
  cpSync(join(P3, 'practice'), join(dir, 'practice'), { recursive: true });
  // root tsconfig (hash-pinned P3 fixture): practice/tsconfig.json extends it (U03 tsc_project composite)
  cpSync(join(P3, 'tsconfig.json'), join(dir, 'tsconfig.json'));
  mkdirSync(join(dir, 'apps', 'web', 'public', 'guides'), { recursive: true });
  cpSync(join(FIX, 'U01.md'), join(dir, 'apps', 'web', 'public', 'guides', 'U01.md'));
  writeFileSync(join(dir, 'README.md'), '# Signalpost\n\nA fixture.\n\n## Getting started\n\nRun it.\n');
  return dir;
}

export interface FakeGithub extends GithubClient {
  head: { sha: string };
  /** sha -> source dir of that snapshot */
  trees: Map<string, string>;
  calls: { resolveHead: number; downloadTarball: number; fetchBlob: number };
  online: boolean;
}

/** Serves fixture snapshots as GitHub would (tarballs packed on demand); `online=false` makes every call fail. */
export function fakeGithub(trees: Map<string, string>, headSha: string): FakeGithub {
  const gh: FakeGithub = {
    offline: false,
    online: true,
    head: { sha: headSha },
    trees,
    calls: { resolveHead: 0, downloadTarball: 0, fetchBlob: 0 },
    async resolveHead() {
      gh.calls.resolveHead++;
      if (!gh.online) throw new NetworkUnavailableError('fake: offline');
      return { sha: gh.head.sha, defaultBranch: 'main' };
    },
    async downloadTarball(_repo, sha, dest) {
      gh.calls.downloadTarball++;
      if (!gh.online) throw new NetworkUnavailableError('fake: offline');
      const src = trees.get(sha);
      if (!src) throw new NetworkUnavailableError(`fake: no snapshot ${sha}`);
      await packTarball(src, dest, `elirc-fake-${sha.slice(0, 7)}`);
    },
    async fetchBlob(_repo, sha, path) {
      gh.calls.fetchBlob++;
      if (!gh.online) throw new NetworkUnavailableError('fake: offline');
      const src = trees.get(sha);
      if (!src) throw new NetworkUnavailableError(`fake: no snapshot ${sha}`);
      return readFileSync(join(src, ...path.split('/')));
    },
  };
  return gh;
}

export function sigConfig(extra: Partial<CurriculumConfig['sources'][number]> = {}): CurriculumConfig {
  return { version: 1, sources: [{ repo: SIGNALPOST, role: 'curriculum', exclude: ['apps/web/public/guides/'], ...extra }] };
}

export interface SyncFixture {
  root: string;
  cacheRoot: string;
  base: string;
  gh: FakeGithub;
  svc: SyncService;
  yamlPath: string;
  cleanup(): void;
}

/** temp dir with a base snapshot at PINNED_SHA, a curriculum.yaml, and a sync service over a fake GitHub. */
export function makeSyncFixture(yaml?: string): SyncFixture {
  const root = mkdtempSync(join(tmpdir(), 'bq-sync-test-'));
  const base = buildSignalpostTree(join(root, 'snap-base'));
  const gh = fakeGithub(new Map([[PINNED_SHA, base]]), PINNED_SHA);
  const yamlPath = join(root, 'curriculum.yaml');
  writeFileSync(
    yamlPath,
    yaml ?? `version: 1\nsources:\n  - repo: ${SIGNALPOST}\n    role: curriculum\n    exclude: [apps/web/public/guides/]\n`,
  );
  const cacheRoot = join(root, 'gh-cache');
  const svc = createSyncService({ curriculum: yamlPath, checkSpecs: CHECK_SPECS, cacheRoot, offline: false }, gh);
  return { root, cacheRoot, base, gh, svc, yamlPath, cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) };
}

/** Copy a snapshot dir to a new one and let the caller mutate it. */
export function forkTree(from: string, to: string, mutate: (dir: string) => void): string {
  cpSync(from, to, { recursive: true });
  mutate(to);
  return to;
}

export { loadCheckSpecTable };
