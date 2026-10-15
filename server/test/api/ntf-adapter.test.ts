/**
 * campaign 2 (OPS review): the node-test-file API adapter's tsconfig-chain handling
 * (server/src/api/runner-node-test-file.ts) with a stub per-SHA cache over the P3 fixture tree.
 * Every case here is a REFUSAL raised before anything is spawned: no learner code runs.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CheckSpec } from '@bootquest/shared';
import { createNodeTestFileRunner } from '../../src/api/runner-node-test-file.ts';
import { CheckRefusedError } from '../../src/api/runners.ts';
import type { GithubCache } from '../../src/sync/cache.ts';
import { P3, PINNED_SHA, SIGNALPOST, U03_SOLUTION } from '../sync-helpers.ts';

const PINS = {
  'practice/tsconfig.json': 'b65f4e90413f16dd886cb5d9ced31c55e83da1c6b212034ef1152a00b81cda00',
  'tsconfig.json': 'b336977c3469218b8d7131e3ceeff30c422edc3518ed432ed1f9613a6a7b291d',
};

/** treeFile over the fixture dir; `vanish` paths resolve to a file that does not exist (a read failure after lookup) */
function stubCache(vanish: readonly string[] = []): GithubCache {
  return {
    async treeFile(_repo: string, _sha: string, rel: string): Promise<string> {
      if (vanish.includes(rel)) return join(P3, '__vanished__', rel);
      const abs = join(P3, ...rel.split('/'));
      if (!existsSync(abs)) throw new Error(`no file ${rel}`);
      return abs;
    },
  } as unknown as GithubCache;
}

const spec = (tscFiles?: Record<string, string>): CheckSpec => ({
  type: 'node-test-file',
  repo: SIGNALPOST,
  sha: PINNED_SHA,
  checkPath: 'practice/checks/u03.test.ts',
  learnerPath: 'practice/learner/u03.ts',
  checkSha256: '030ee10343215f1c0ba99c4099ed23d374798967ff8c268f166140c63f5110df',
  blobSha: 'c0f7f480c939291c571f4d75e6d07161e00b8e67',
  tsx: true,
  tscProject: 'practice/tsconfig.json',
  timeoutMs: 30_000,
  ...(tscFiles ? { tscFiles } : {}),
});

const run = (cache: GithubCache, s: CheckSpec) => createNodeTestFileRunner(cache)(s, { code: U03_SOLUTION });

describe('node-test-file adapter: tsconfig chain refusals (409 CHECK_INTEGRITY, nothing spawned)', () => {
  it('a chain file that cannot be READ after lookup is a CheckRefusedError, never a raw error (500)', async () => {
    await expect(run(stubCache(['tsconfig.json']), spec())).rejects.toBeInstanceOf(CheckRefusedError);
    await expect(run(stubCache(['tsconfig.json']), spec())).rejects.toThrow(/tsconfig .*tsconfig\.json could not be read from the cache/);
    await expect(run(stubCache(['practice/tsconfig.json']), spec(PINS))).rejects.toBeInstanceOf(CheckRefusedError);
  });

  it('a chain file whose bytes differ from its recorded pin is refused', async () => {
    const wrong = { ...PINS, 'tsconfig.json': '0'.repeat(64) };
    await expect(run(stubCache(), spec(wrong))).rejects.toThrow(/tsconfig tsconfig\.json .*does not hash to its recorded pin/);
  });

  it('a chain file with NO recorded pin is refused (the chain grew)', async () => {
    await expect(run(stubCache(), spec({ 'practice/tsconfig.json': PINS['practice/tsconfig.json'] }))).rejects.toThrow(/tsconfig chain file tsconfig\.json has no recorded pin/);
  });

  it('a recorded pin that is not part of the chain is refused (the chain shrank)', async () => {
    await expect(run(stubCache(), spec({ ...PINS, 'base/tsconfig.json': '1'.repeat(64) }))).rejects.toThrow(/recorded tsconfig pin\(s\) base\/tsconfig\.json are not part of/);
  });
});
