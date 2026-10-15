import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
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
/** The extends chain never legitimately needs more files than this (signalpost: 2). */
const MAX_TSCONFIG_FILES = 8;

/**
 * U03 composite: collect the tsconfig `extends` chain from the pinned tree at `sha`
 * (cache.treeFile — a cache miss downloads that sha's tarball once, like the check
 * file itself). RELATIVE extends only (`./` / `../`): a package-ref extends would
 * need node_modules the workspace deliberately lacks, so it is left for tsc to
 * report. Depth/size-capped; a chain that escapes the repo is a refusal.
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
  const files: Record<string, string> = {};
  const queue = [project];
  while (queue.length > 0 && Object.keys(files).length < MAX_TSCONFIG_FILES) {
    const rel = queue.shift()!;
    if (rel in files) continue; // cycle / duplicate
    let abs: string;
    try {
      abs = await cache.treeFile(repo, sha, rel);
    } catch (err) {
      throw new CheckRefusedError(
        `tsconfig ${repo}@${sha.slice(0, 7)}:${rel} is not available (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(abs);
    } catch (err) {
      throw new CheckRefusedError(
        `tsconfig ${repo}@${sha.slice(0, 7)}:${rel} could not be read from the cache (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    if (pins) {
      const want = pins[rel];
      if (want === undefined) {
        throw new CheckRefusedError(`tsconfig chain file ${rel} has no recorded pin (the chain at ${sha.slice(0, 7)} differs from check-specs tsc_files) — refusing to run`);
      }
      const got = createHash('sha256').update(bytes).digest('hex');
      if (got !== want) {
        throw new CheckRefusedError(`tsconfig ${rel} at ${sha.slice(0, 7)} does not hash to its recorded pin (sha256 ${got.slice(0, 12)}… != ${want.slice(0, 12)}…) — refusing to run`);
      }
    }
    const content = bytes.toString('utf8');
    files[rel] = content;
    let ext: unknown;
    try {
      ext = (JSON.parse(content) as { extends?: unknown }).extends;
    } catch {
      continue; // not strict JSON (jsonc?): materialize what we have; tsc reports the real problem
    }
    const refs = typeof ext === 'string' ? [ext] : Array.isArray(ext) ? ext.filter((x): x is string => typeof x === 'string') : [];
    for (const r of refs) {
      if (!r.startsWith('./') && !r.startsWith('../')) continue; // relative extends only
      const next = posix.normalize(posix.join(posix.dirname(rel), r.endsWith('.json') ? r : `${r}.json`));
      if (next === '..' || next.startsWith('../')) {
        throw new CheckRefusedError(`tsconfig extends chain escapes the repo: ${rel} -> ${r}`);
      }
      queue.push(next);
    }
  }
  if (pins) {
    const missing = Object.keys(pins).filter((p) => !(p in files));
    if (missing.length > 0) {
      throw new CheckRefusedError(`recorded tsconfig pin(s) ${missing.join(', ')} are not part of the ${project} extends chain at ${sha.slice(0, 7)} — refusing to run`);
    }
  }
  return files;
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
