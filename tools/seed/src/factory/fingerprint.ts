/**
 * Seed fingerprint, kind 'seed:<generator>' — the seed-pack analogue of the
 * server's grader fingerprint (server/src/store/grader-fingerprint.ts): binds a
 * stamp to the exact validator + generator bytes, the shared seed-pack schema,
 * the citation resolver, the exclusion registry and (for generators that
 * execute code) BOTH graders the harness registers: drill-js (the JS grader +
 * node/esbuild) and drill-cs (the C# runner sources, its Check harnesses, the
 * drill-cs adapter + the .NET SDK / ref-pack versions). Changing any of them invalidates
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
  const graders = [...new Set([...FINGERPRINT_FILES.js, ...FINGERPRINT_FILES.csharp])].filter((f) => !f.endsWith('validate.ts'));
  const runner = EXECUTING.has(generator) ? [...sources(join(SEED_SRC, 'factory', 'harness')), ...graders] : [];
  return [...common, ...own, ...runner];
}

export interface SeedToolchain {
  node: string;
  esbuild?: string;
  /** executing generators: the .NET SDK + Microsoft.NETCore.App.Ref versions drill-cs compiles with */
  dotnetSdk?: string;
  dotnetRef?: string;
}

export function seedToolchain(generator: SeedGenerator): SeedToolchain {
  if (!EXECUTING.has(generator)) return { node: process.version };
  const cs = toolchainVersions('csharp');
  return { node: process.version, esbuild: toolchainVersions('js').esbuild ?? 'unknown', dotnetSdk: cs.dotnetSdk ?? 'unknown', dotnetRef: cs.dotnetRef ?? 'unknown' };
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
