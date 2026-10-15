import type { CanonicalRunResult } from '@bootquest/shared/api';
import { CheckIntegrityError, run as runNodeTestFile, type NodeTestFileSpec } from '../runners/node-test-file/index.ts';
import type { GithubCache } from '../sync/cache.ts';
import { TsconfigChainError, verifyTsconfigChain } from '../sync/tsconfig-chain.ts';
import { CheckRefusedError, SubmissionShapeError, UnsupportedCheckError, type Runner } from './runners.ts';

/**
 * node-test-file checks through the app (W4): the pinned check file is read
 * from the per-SHA tarball cache (`<cache>/<owner>/<name>/<sha>/<checkPath>`;
 * a cache miss downloads that sha's tarball ONCE, after which grading is
 * offline forever), then the proven P3 runner verifies sha256 + blob sha and
 * runs `node --test` in a fresh workspace mirroring the repo layout.
 * Any pin problem is a REFUSAL (CheckRefusedError -> 409 CHECK_INTEGRITY):
 * nothing is spawned, no attempt is recorded.
 *
 * U03 composite: the tsconfig `extends` chain from the pinned tree at `sha` (cache.treeFile — a
 * cache miss downloads that sha's tarball once, like the check file itself), verified by the
 * shared sync/tsconfig-chain.ts (F15: the same verifier sync uses for the recorded pins).
 *
 * campaign 2 (OPS review): every failure to obtain a chain file is a REFUSAL
 * (CheckRefusedError -> 409 CHECK_INTEGRITY), never a raw 500; and when the check
 * carries the recorded pins (`tscFiles`, from check-specs.json `tsc_files`), the chain
 * must be EXACTLY that set of files with exactly those sha256s, or nothing runs.
 */
async function collectProjectFiles(
  cache: GithubCache,
  repo: string,
  sha: string,
  project: string,
  pins?: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  try {
    return await verifyTsconfigChain((r, s, rel) => cache.treeFile(r, s, rel), repo, sha, project, pins);
  } catch (err) {
    if (err instanceof TsconfigChainError) throw new CheckRefusedError(err.message);
    throw err;
  }
}

export function createNodeTestFileRunner(cache: GithubCache, opts: { workRoot?: string } = {}): Runner {
  return async (spec, submission): Promise<CanonicalRunResult> => {
    if (spec.type !== 'node-test-file') throw new UnsupportedCheckError(`node-test-file runner got ${spec.type}`);
    if (submission.code === undefined) throw new SubmissionShapeError('node-test-file checks take `code` (the learner module)');
    if (!spec.repo || !spec.checkSha256 || !/^[0-9a-f]{40}$/.test(spec.sha)) {
      throw new CheckRefusedError('node-test-file check is not pinned (needs repo, full 40-hex sha and checkSha256) — refusing to run');
    }
    let checkFile: string;
    try {
      checkFile = await cache.treeFile(spec.repo, spec.sha, spec.checkPath);
    } catch (err) {
      throw new CheckRefusedError(
        `check file ${spec.repo}@${spec.sha.slice(0, 7)}:${spec.checkPath} is not available (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    const ntf: NodeTestFileSpec = {
      repo: spec.repo,
      sha: spec.sha,
      path: spec.checkPath,
      sha256: spec.checkSha256,
      learner_path: spec.learnerPath,
      needs_tsx: spec.tsx,
      timeout_ms: spec.timeoutMs,
      ...(spec.blobSha ? { blob_sha: spec.blobSha } : {}),
      ...(spec.moduleType ? { module_type: spec.moduleType } : {}),
      ...(spec.expectedTests ? { expected_tests: spec.expectedTests } : {}),
      ...(spec.tscProject ? { tsc_project: spec.tscProject } : {}),
    };
    // U03 composite: pin the tsconfig chain from the same per-SHA tree the check came from
    const projectFiles = spec.tscProject ? await collectProjectFiles(cache, spec.repo, spec.sha, spec.tscProject, spec.tscFiles) : undefined;
    try {
      const r = await runNodeTestFile(
        { id: spec.checkPath, spec: ntf, checkFile, ...(projectFiles ? { projectFiles } : {}) },
        { code: submission.code },
        opts.workRoot ? { workRoot: opts.workRoot } : {},
      );
      return { pass: r.pass, output: r.output, failures: r.failures, durationMs: r.durationMs };
    } catch (err) {
      if (err instanceof CheckIntegrityError) throw new CheckRefusedError(err.message);
      throw err;
    }
  };
}
