import type { CanonicalRunResult } from '@bootquest/shared/api';
import { CheckIntegrityError, run as runNodeTestFile, type NodeTestFileSpec } from '../runners/node-test-file/index.ts';
import type { GithubCache } from '../sync/cache.ts';
import { CheckRefusedError, SubmissionShapeError, UnsupportedCheckError, type Runner } from './runners.ts';

/**
 * node-test-file checks through the app (W4): the pinned check file is read
 * from the per-SHA tarball cache (`<cache>/<owner>/<name>/<sha>/<checkPath>`;
 * a cache miss downloads that sha's tarball ONCE, after which grading is
 * offline forever), then the proven P3 runner verifies sha256 + blob sha and
 * runs `node --test` in a fresh workspace mirroring the repo layout.
 * Any pin problem is a REFUSAL (CheckRefusedError -> 409 CHECK_INTEGRITY):
 * nothing is spawned, no attempt is recorded.
 */
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
    };
    try {
      const r = await runNodeTestFile({ id: spec.checkPath, spec: ntf, checkFile }, { code: submission.code }, opts.workRoot ? { workRoot: opts.workRoot } : {});
      return { pass: r.pass, output: r.output, failures: r.failures, durationMs: r.durationMs };
    } catch (err) {
      if (err instanceof CheckIntegrityError) throw new CheckRefusedError(err.message);
      throw err;
    }
  };
}
