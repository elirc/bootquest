import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import esbuild from 'esbuild';
import { discoverToolchain } from '../runners/csharp/scratch.ts';

/**
 * The grader fingerprint binds seed:validate verdicts (journal entries) and the
 * pack validation stamp to the exact grading toolchain: the grader + validator
 * source bytes AND the versions of the tools that compile/execute submissions.
 * Changing any of them invalidates every journaled verdict and every stamp, so
 * the server refuses packs until the import gate has re-run (W2b/F1, F5).
 * Lives in the server so the pack loader and seed:validate compute it the same way.
 *
 * Per grader KIND (W3a): a pack is bound only to the grader that executes it.
 *   js      BootForge-style drill-js / quiz / predict-output: grade-core + the
 *           JS adapter + the registry/deterministic graders; node + esbuild.
 *   csharp  drill-cs (csbootcamp): the C# runner sources + the Check harness it
 *           compiles + the drill-cs adapter; node + the .NET SDK and reference
 *           pack versions. The JS grader is NOT part of it (and vice versa), so a
 *           JS grader edit does not invalidate the C# stamp.
 * The validator (validate.ts) is in both: it decides what "validated" means.
 */

export type GraderKind = 'js' | 'csharp';
export const GRADER_KINDS: readonly GraderKind[] = ['js', 'csharp'];

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const VALIDATOR = join(REPO, 'tools', 'seed', 'src', 'validate', 'validate.ts');
const CSHARP = join(REPO, 'server', 'src', 'runners', 'csharp');

export const FINGERPRINT_FILES: Readonly<Record<GraderKind, readonly string[]>> = {
  js: [
    join(REPO, 'server', 'src', 'runners', 'js', 'grade-core.mjs'),
    join(REPO, 'server', 'src', 'runners', 'js', 'index.ts'),
    join(REPO, 'server', 'src', 'api', 'runners.ts'),
    VALIDATOR,
  ],
  csharp: [
    join(CSHARP, 'index.ts'),
    join(CSHARP, 'scratch.ts'),
    join(CSHARP, 'csbootcamp-split.ts'),
    join(CSHARP, 'fixtures', 'csbootcamp', '_lib', 'Check', 'Check.cs'),
    join(REPO, 'server', 'src', 'api', 'runner-csharp.ts'),
    VALIDATOR,
  ],
};

/** The grader kind that executes a pack, from its manifest track. */
export function graderKindForTrack(track: string): GraderKind {
  if (track === 'js') return 'js';
  if (track === 'csharp') return 'csharp';
  throw new Error(`no grader kind for pack track "${track}" (known: js, csharp)`);
}

export interface Toolchain {
  node: string;
  esbuild?: string;
  dotnetSdk?: string;
  dotnetRef?: string;
}

/** Versions bound into a kind's fingerprint. csharp shells out to `dotnet --list-sdks` once (cached). */
export function toolchainVersions(kind: GraderKind = 'js'): Toolchain {
  if (kind === 'js') return { node: process.version, esbuild: esbuild.version };
  const tc = discoverToolchain();
  return { node: process.version, dotnetSdk: tc.sdkVersion, dotnetRef: tc.refVersion };
}

const cache = new Map<GraderKind, string>();

export function graderFingerprint(kind: GraderKind = 'js'): string {
  let fp = cache.get(kind);
  if (fp === undefined) {
    const files = FINGERPRINT_FILES[kind].map((f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).join('\u0000');
    const t = toolchainVersions(kind);
    const versions = Object.entries(t)
      .map(([k, v]) => `${k}=${v}`)
      .join('\u0000');
    // js keeps its pre-W3a preimage shape (kind is implied by the file list)
    fp = createHash('sha256').update(kind === 'js' ? `${files}\u0000${versions}` : `kind=${kind}\u0000${files}\u0000${versions}`).digest('hex');
    cache.set(kind, fp);
  }
  return fp;
}
