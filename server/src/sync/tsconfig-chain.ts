import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';

/**
 * campaign 2 release (F15): ONE verifier for a node-test-file check's tsconfig `extends`
 * chain, shared by the runner adapter (api/runner-node-test-file.ts, before every U03
 * composite run) and sync (sync/job.ts planProgram, when the recorded table carries
 * `tsc_files`). Both used to hash the chain their own way.
 *
 * Walks the chain from `project` in the pinned tree at `sha` (`treeFile` resolves a
 * repo-relative path to the cached file; a cache miss downloads that sha's tarball once).
 * RELATIVE extends only (`./` / `../`): a package-ref extends would need node_modules the
 * workspace deliberately lacks, so it is left for tsc to report. Depth/size-capped; a
 * chain that escapes the repo is refused.
 *
 * With `pins`, the chain must be EXACTLY that set of files, each with exactly its recorded
 * sha256 (and git blob sha, when the pin carries one), or this throws.
 * Every failure is a TsconfigChainError; callers map it to their own refusal
 * (CheckRefusedError -> 409 CHECK_INTEGRITY; ProgramError -> a sync error).
 */
export class TsconfigChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TsconfigChainError';
  }
}

/** A recorded pin: a bare sha256 (check spec `tscFiles`) or {sha256, blob_sha} (check-specs.json `tsc_files`). */
export type TsconfigPin = string | { sha256: string; blob_sha?: string };

/** The extends chain never legitimately needs more files than this (signalpost: 2). */
export const MAX_TSCONFIG_FILES = 8;

const sha256Hex = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const gitBlobSha = (b: Buffer): string =>
  createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b]))
    .digest('hex');

export async function verifyTsconfigChain(
  treeFile: (repo: string, sha: string, rel: string) => Promise<string>,
  repo: string,
  sha: string,
  project: string,
  pins?: Readonly<Record<string, TsconfigPin>>,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const queue = [project];
  while (queue.length > 0 && Object.keys(files).length < MAX_TSCONFIG_FILES) {
    const rel = queue.shift()!;
    if (rel in files) continue; // cycle / duplicate
    let abs: string;
    try {
      abs = await treeFile(repo, sha, rel);
    } catch (err) {
      throw new TsconfigChainError(`tsconfig ${repo}@${sha.slice(0, 7)}:${rel} is not available (${err instanceof Error ? err.message : String(err)})`);
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(abs);
    } catch (err) {
      throw new TsconfigChainError(
        `tsconfig ${repo}@${sha.slice(0, 7)}:${rel} could not be read from the cache (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    if (pins) {
      const want = pins[rel];
      if (want === undefined) {
        throw new TsconfigChainError(`tsconfig chain file ${rel} has no recorded pin (the chain at ${sha.slice(0, 7)} differs from check-specs tsc_files) — refusing to run`);
      }
      const pin = typeof want === 'string' ? { sha256: want } : want;
      const got = sha256Hex(bytes);
      if (got !== pin.sha256) {
        throw new TsconfigChainError(`tsconfig ${rel} at ${sha.slice(0, 7)} does not hash to its recorded pin (sha256 ${got.slice(0, 12)}… != ${pin.sha256.slice(0, 12)}…) — refusing to run`);
      }
      if (pin.blob_sha !== undefined && gitBlobSha(bytes) !== pin.blob_sha) {
        throw new TsconfigChainError(`tsconfig ${rel} at ${sha.slice(0, 7)} does not hash to its recorded pin (git blob sha != ${pin.blob_sha.slice(0, 12)}…) — refusing to run`);
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
        throw new TsconfigChainError(`tsconfig extends chain escapes the repo: ${rel} -> ${r}`);
      }
      queue.push(next);
    }
  }
  if (pins) {
    const missing = Object.keys(pins).filter((p) => !(p in files));
    if (missing.length > 0) {
      throw new TsconfigChainError(`recorded tsconfig pin(s) ${missing.join(', ')} are not part of the ${project} extends chain at ${sha.slice(0, 7)} — refusing to run`);
    }
  }
  return files;
}
