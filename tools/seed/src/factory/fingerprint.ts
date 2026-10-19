/**
 * Seed fingerprint, kind 'seed:<generator>' — the seed-pack analogue of the
 * server's grader fingerprint (server/src/store/grader-fingerprint.ts): binds a
 * stamp to the exact validator + generator bytes, the shared seed-pack schema,
 * the citation resolver, the exclusion registry and (for generators that
 * execute code) EVERY grader the harness registers: drill-js (the JS grader +
 * node/esbuild), drill-cs (the C# runner sources, its Check harnesses, the
 * drill-cs adapter + the .NET SDK / ref-pack versions) and drill-java (the Java
 * runner + split rules, the javabootcamp Check/BqMain harness, the drill-java
 * adapter + the JDK version). The import gate's validators (validate.ts,
 * validate-java.ts) are not part of it: the factory never runs them. Changing any
 * of them invalidates every seed stamp, so seed:check refuses the pack until it is
 * re-validated.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
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

/** the import gate's validators (seed:validate) ride in the grader file lists; the factory never runs them */
const IMPORT_GATE_VALIDATORS: ReadonlySet<string> = new Set(['validate.ts', 'validate-java.ts']);

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
  const graders = [...new Set([...FINGERPRINT_FILES.js, ...FINGERPRINT_FILES.csharp, ...FINGERPRINT_FILES.java])].filter((f) => !IMPORT_GATE_VALIDATORS.has(basename(f)));
  const runner = EXECUTING.has(generator) ? [...sources(join(SEED_SRC, 'factory', 'harness')), ...graders] : [];
  return [...common, ...own, ...runner];
}

export interface SeedToolchain {
  node: string;
  esbuild?: string;
  /** executing generators: the .NET SDK + Microsoft.NETCore.App.Ref versions drill-cs compiles with */
  dotnetSdk?: string;
  dotnetRef?: string;
  /** executing generators: the JDK (`javac -version`) drill-java compiles + runs with */
  jdk?: string;
}

/** `javac -version`, or 'unknown' on a machine without a JDK (a drill-java execution then fails, never passes) */
function jdkOrUnknown(): string {
  try {
    return toolchainVersions('java').jdk ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function seedToolchain(generator: SeedGenerator): SeedToolchain {
  if (!EXECUTING.has(generator)) return { node: process.version };
  const cs = toolchainVersions('csharp');
  return { node: process.version, esbuild: toolchainVersions('js').esbuild ?? 'unknown', dotnetSdk: cs.dotnetSdk ?? 'unknown', dotnetRef: cs.dotnetRef ?? 'unknown', jdk: jdkOrUnknown() };
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
