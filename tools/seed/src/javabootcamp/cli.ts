// npm run seed:import:javabootcamp [-- --cache <dir>] [--out <dir>] [--sha <sha>]
// npm run seed:import:javabootcamp -- --source <localdir> [--out <dir>]
// Default: fetches github.com/elirc/javabootcamp at the PINNED sha (shallow, `git -C`,
// LF working tree) into a gitignored cache (default .cache/sources/javabootcamp).
// --source: dev mode, reads a local working copy in place (originKind 'local'; its
// HEAD and dirtiness go into the manifest). Either way the source is read READ-ONLY
// and content/packs/javabootcamp/{<module>.json, manifest.json} is written.
import { resolve } from 'node:path';
import { ensureCheckout } from '../csbootcamp/source.ts';
import { DEFAULT_CACHE_DIR, DEFAULT_OUT_DIR, importJavabootcamp, JAVABOOTCAMP_EXPECTED, RUNNER_HARNESS_DIR } from './import.ts';
import { JAVABOOTCAMP_SHA, JAVABOOTCAMP_URL, localGitState } from './source.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const UNPINNED = /^0{40}$/;

function main(): number {
  const outDir = resolve(arg('out') ?? DEFAULT_OUT_DIR);
  const local = arg('source');
  let sourceDir: string;
  let gitHead: string | null;
  let dirty: boolean | null;
  let originKind: 'github' | 'local';
  let expected = null as typeof JAVABOOTCAMP_EXPECTED;
  if (local !== undefined) {
    sourceDir = resolve(local);
    ({ gitHead, dirty } = localGitState(sourceDir));
    originKind = 'local';
    console.log(`[seed:import:javabootcamp] source ${sourceDir} (local working copy @ ${gitHead ?? 'no git'}${dirty ? ', DIRTY' : ''})`);
  } else {
    const sha = arg('sha') ?? JAVABOOTCAMP_SHA;
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('--sha must be a full 40-hex commit id');
    if (UNPINNED.test(sha)) throw new Error('JAVABOOTCAMP_SHA is not pinned yet (tools/seed/src/javabootcamp/source.ts); pass --sha <commit> or --source <localdir>');
    const cacheDir = resolve(arg('cache') ?? DEFAULT_CACHE_DIR);
    console.log(`[seed:import:javabootcamp] cache ${cacheDir}`);
    const co = ensureCheckout(cacheDir, sha, JAVABOOTCAMP_URL);
    console.log(`[seed:import:javabootcamp] source elirc/javabootcamp @ ${co.sha} (${co.fetched ? 'fetched' : 'cached checkout reused'})`);
    sourceDir = cacheDir;
    gitHead = co.sha;
    dirty = false;
    originKind = 'github';
    if (sha === JAVABOOTCAMP_SHA) expected = JAVABOOTCAMP_EXPECTED;
  }
  console.log(`[seed:import:javabootcamp] out   ${outDir}`);
  const { manifest, written, removed } = importJavabootcamp({ sourceDir, outDir, expected, gitHead, dirty, originKind, harnessDir: RUNNER_HARNESS_DIR });
  for (const c of manifest.courses) console.log(`  ${String(c.order).padStart(2)} ${c.id.padEnd(30)} drills ${String(c.counts.code).padStart(3)}`);
  const t = manifest.totals;
  console.log(`  TOTAL ${t.total} (code ${t.code})${manifest.expected ? ` === expected ${JSON.stringify(manifest.expected)}` : ' (no census pinned for this source)'}`);
  console.log(`  wrote ${written.length} file(s)${removed.length ? `, removed stale ${removed.join(', ')}` : ''}`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`[seed:import:javabootcamp] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
