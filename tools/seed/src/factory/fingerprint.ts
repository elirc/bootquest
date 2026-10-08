/**
 * Seed fingerprint, kind 'seed:<generator>' — the seed-pack analogue of the
 * server's grader fingerprint (server/src/store/grader-fingerprint.ts): binds a
 * stamp to the exact validator + generator bytes, the shared seed-pack schema,
 * the citation resolver, the exclusion registry and (for generators that
 * execute code) the JS grader + toolchain. Changing any of them invalidates
 * every seed stamp, so seed:check refuses the pack until it is re-validated.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FINGERPRINT_FILES, toolchainVersions } from '@bootquest/server/grader-fingerprint';
import type { SeedGenerator } from '@bootquest/shared';
import { sha256 } from './util.ts';

const SEED_SRC = resolve(import.meta.dirname, '..');
const REPO = resolve(SEED_SRC, '..', '..', '..');

const sources = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'cli.ts')
    .sort()
    .map((f) => join(dir, f));

/** generators that execute code through the real runner */
export const EXECUTING: ReadonlySet<SeedGenerator> = new Set(['variants', 'patches']);

export function seedFingerprintFiles(generator: SeedGenerator): string[] {
  const common = [
    join(REPO, 'shared', 'src', 'seed-pack.ts'),
    join(REPO, 'tools', 'seed', 'exclusions.json'),
    ...sources(join(SEED_SRC, 'citations')),
    ...sources(join(SEED_SRC, 'factory')),
  ];
  const own = sources(join(SEED_SRC, 'factory', generator));
  const runner = EXECUTING.has(generator)
    ? [...sources(join(SEED_SRC, 'factory', 'harness')), ...FINGERPRINT_FILES.js.filter((f) => !f.endsWith('validate.ts'))]
    : [];
  return [...common, ...own, ...runner];
}

export interface SeedToolchain {
  node: string;
  esbuild?: string;
}

export function seedToolchain(generator: SeedGenerator): SeedToolchain {
  return EXECUTING.has(generator) ? { node: process.version, esbuild: toolchainVersions('js').esbuild ?? 'unknown' } : { node: process.version };
}

const cache = new Map<SeedGenerator, string>();

export function seedFingerprint(generator: SeedGenerator): string {
  let fp = cache.get(generator);
  if (fp === undefined) {
    const files = seedFingerprintFiles(generator).map((f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
    const tc = Object.entries(seedToolchain(generator)).map(([k, v]) => `${k}=${v}`);
    fp = sha256([`kind=seed:${generator}`, ...files, ...tc].join('\u0000'));
    cache.set(generator, fp);
  }
  return fp;
}
