import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import esbuild from 'esbuild';
import type { PackManifest } from '@bootquest/shared';
import { discoverToolchain } from '../runners/csharp/scratch.ts';
import { resolveTsx, resolveTypescript } from '../runners/self-run/index.ts';
import { jdkVersion } from '../runners/java/index.ts';

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
 *           compiles + BootQuest's launcher (BqLaunch.cs) + the nonce-checked
 *           result-channel parser + the drill-cs adapter; node + the .NET SDK and reference
 *           pack versions. The JS grader is NOT part of it (and vice versa), so a
 *           JS grader edit does not invalidate the C# stamp.
 *   selfrun (W3c) jstrain self-run drills + its predict-output quiz items: the
 *           self-run runner + compose rules + BootQuest's harness (bq-check.mjs)
 *           + the upstream harness copies it type-checks against + the script
 *           snippet runner, the registry adapter / deterministic graders and
 *           grade-core's normalizeOutput (runners.ts, grade-core.mjs); node,
 *           esbuild, the repo-pinned TypeScript and tsx.
 *   java    drill-java (javabootcamp): the Java runner + split rules + the shared
 *           result-channel parser + the process helpers it imports from the C# scratch module + the
 *           javabootcamp harness it compiles (Check.java, BqMain.java) + the
 *           drill-java adapter + the Java validator; node + the JDK (`javac -version`).
 * The validator (validate.ts) is in all of them: it decides what "validated" means.
 */

export type GraderKind = 'js' | 'csharp' | 'selfrun' | 'java';
export const GRADER_KINDS: readonly GraderKind[] = ['js', 'csharp', 'selfrun', 'java'];

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const VALIDATOR = join(REPO, 'tools', 'seed', 'src', 'validate', 'validate.ts');
const RUNNERS = join(REPO, 'server', 'src', 'runners');
const CSHARP = join(RUNNERS, 'csharp');
const SELFRUN = join(REPO, 'server', 'src', 'runners', 'self-run');
const JAVA = join(REPO, 'server', 'src', 'runners', 'java');

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
    // BootQuest's console-check launcher (nonce + result channel) and the shared channel parser
    join(CSHARP, 'BqLaunch.cs'),
    join(RUNNERS, 'result-channel.ts'),
    join(CSHARP, 'fixtures', 'csbootcamp', '_lib', 'Check', 'Check.cs'),
    // W3c: jstrain2.2's embedded harness revision (drill-cs harness 'jstrain') + the frozen-scaffolding rule
    join(CSHARP, 'fixtures', 'jstrain-csbootcamp', '_lib', 'Check', 'Check.cs'),
    join(CSHARP, 'fixtures', 'jstrain-csbootcamp', '_lib', 'Check', 'Spy.cs'),
    join(SELFRUN, 'compose.ts'),
    join(REPO, 'server', 'src', 'api', 'runner-csharp.ts'),
    VALIDATOR,
  ],
  selfrun: [
    join(SELFRUN, 'index.ts'),
    join(SELFRUN, 'compose.ts'),
    join(SELFRUN, 'snippet.ts'),
    join(SELFRUN, 'bq-check.mjs'),
    join(SELFRUN, 'fixtures', 'jstrain', 'bootcamp', '_lib', 'check.js'),
    join(SELFRUN, 'fixtures', 'jstrain', 'tsbootcamp', '_lib', 'check.ts'),
    join(SELFRUN, 'fixtures', 'jstrain', 'tsbootcamp', '_lib', 'type-assert.ts'),
    join(REPO, 'server', 'src', 'api', 'runners.ts'),
    join(REPO, 'server', 'src', 'runners', 'js', 'grade-core.mjs'),
    VALIDATOR,
  ],
  java: [
    join(JAVA, 'index.ts'),
    join(JAVA, 'split.ts'),
    join(RUNNERS, 'result-channel.ts'),
    join(CSHARP, 'scratch.ts'),
    join(JAVA, 'fixtures', 'javabootcamp', '_lib', 'check', 'bootcamp', 'Check.java'),
    join(JAVA, 'fixtures', 'javabootcamp', '_lib', 'check', 'bootcamp', 'BqMain.java'),
    join(REPO, 'server', 'src', 'api', 'runner-java.ts'),
    VALIDATOR,
    join(REPO, 'tools', 'seed', 'src', 'validate', 'validate-java.ts'),
  ],
};

/** The grader kind that executes a pack, from its manifest track (manifests without a `grader` field). */
export function graderKindForTrack(track: string): GraderKind {
  if (track === 'js') return 'js';
  if (track === 'csharp') return 'csharp';
  if (track === 'java') return 'java';
  throw new Error(`no grader kind for pack track "${track}" (known: js, csharp, java)`);
}

/** The grader kind of a pack: its manifest's explicit `grader` (W3c), else derived from the track. */
export function graderKindForManifest(m: Pick<PackManifest, 'track' | 'grader'>): GraderKind {
  return m.grader ?? graderKindForTrack(m.track);
}

export interface Toolchain {
  node: string;
  esbuild?: string;
  dotnetSdk?: string;
  dotnetRef?: string;
  typescript?: string;
  tsx?: string;
  jdk?: string;
}

/** Versions bound into a kind's fingerprint. csharp shells out to `dotnet --list-sdks`, java to `javac -version` (each once, cached). */
export function toolchainVersions(kind: GraderKind = 'js'): Toolchain {
  if (kind === 'js') return { node: process.version, esbuild: esbuild.version };
  if (kind === 'java') return { node: process.version, jdk: jdkVersion() };
  if (kind === 'selfrun') return { node: process.version, esbuild: esbuild.version, typescript: resolveTypescript().version, tsx: resolveTsx().version };
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
