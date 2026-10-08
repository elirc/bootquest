import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import esbuild from 'esbuild';

/**
 * The grader fingerprint binds seed:validate verdicts (journal entries) and the
 * pack validation stamp to the exact grading toolchain: the grader + validator
 * source bytes AND the versions of the tools that transpile/execute
 * submissions (esbuild strips TS; Node runs the code and provides node:sqlite).
 * Changing any of them invalidates every journaled verdict and every stamp, so
 * the server refuses packs until the import gate has re-run (W2b/F1, F5).
 * Lives in the server so the pack loader and seed:validate compute it the same way.
 */

const REPO = resolve(import.meta.dirname, '..', '..', '..');

export const FINGERPRINT_FILES: readonly string[] = [
  join(REPO, 'server', 'src', 'runners', 'js', 'grade-core.mjs'),
  join(REPO, 'server', 'src', 'runners', 'js', 'index.ts'),
  join(REPO, 'server', 'src', 'api', 'runners.ts'),
  join(REPO, 'tools', 'seed', 'src', 'validate', 'validate.ts'),
];

export interface Toolchain {
  node: string;
  esbuild: string;
}

export function toolchainVersions(): Toolchain {
  return { node: process.version, esbuild: esbuild.version };
}

let cache: string | null = null;

export function graderFingerprint(): string {
  if (cache === null) {
    const files = FINGERPRINT_FILES.map((f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).join('\u0000');
    const t = toolchainVersions();
    cache = createHash('sha256').update(`${files}\u0000node=${t.node}\u0000esbuild=${t.esbuild}`).digest('hex');
  }
  return cache;
}
