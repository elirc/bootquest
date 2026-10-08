import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SyncReport } from '@bootquest/shared/sync';
import type { Db } from '../db/database.ts';
import type { Clock } from '../engines/clock.ts';
import { GithubCache } from './cache.ts';
import { loadCheckSpecTable, loadCurriculumConfig } from './config.ts';
import { createGithubClient, offlineGithubClient, type GithubClient } from './github.ts';
import { runSync } from './job.ts';

/** The app repo root (server/src/sync -> ../../../). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface SyncPaths {
  curriculum: string;
  checkSpecs: string;
  cacheRoot: string;
  offline: boolean;
}

/**
 *   BOOTQUEST_CURRICULUM   source registry (default <repo>/curriculum.yaml)
 *   BOOTQUEST_CHECK_SPECS  recorded node-test-file table (default <repo>/content/sync/check-specs.json)
 *   BOOTQUEST_GITHUB_CACHE per-SHA tarball/blob cache (default <repo>/.cache/github, gitignored)
 *   BOOTQUEST_OFFLINE=1    never touch the network (cache only)
 */
export function resolveSyncPaths(env: Record<string, string | undefined>, root: string = REPO_ROOT): SyncPaths {
  return {
    curriculum: resolve(env.BOOTQUEST_CURRICULUM?.trim() || resolve(root, 'curriculum.yaml')),
    checkSpecs: resolve(env.BOOTQUEST_CHECK_SPECS?.trim() || resolve(root, 'content', 'sync', 'check-specs.json')),
    cacheRoot: resolve(env.BOOTQUEST_GITHUB_CACHE?.trim() || resolve(root, '.cache', 'github')),
    offline: env.BOOTQUEST_OFFLINE === '1',
  };
}

export interface SyncService {
  readonly paths: SyncPaths;
  readonly github: GithubClient;
  readonly cache: GithubCache;
  run(db: Db, clock: Clock, opts?: { repos?: string[]; log?: (line: string) => void }): Promise<SyncReport>;
}

export function createSyncService(paths: SyncPaths, github?: GithubClient): SyncService {
  const gh = github ?? (paths.offline ? offlineGithubClient() : createGithubClient());
  const cache = new GithubCache(paths.cacheRoot, gh);
  return {
    paths,
    github: gh,
    cache,
    run(db, clock, opts = {}) {
      // re-read on every run: editing curriculum.yaml needs no restart
      const config = loadCurriculumConfig(paths.curriculum);
      const checkTable = existsSync(paths.checkSpecs) ? loadCheckSpecTable(paths.checkSpecs) : null;
      return runSync(
        { db, clock, github: gh, cache, config, checkTable, ...(opts.log ? { log: opts.log } : {}) },
        opts.repos ? { repos: opts.repos } : {},
      );
    },
  };
}
