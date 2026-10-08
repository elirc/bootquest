// npm run seed:import:csbootcamp [-- --cache <dir>] [--out <dir>] [--sha <sha>]
// Fetches github.com/elirc/csbootcamp at the PINNED sha (shallow, `git -C`, LF
// working tree) into a gitignored cache (default .cache/sources/csbootcamp),
// reads it READ-ONLY and writes content/packs/csbootcamp/{<module>.json, manifest.json}.
import { resolve } from 'node:path';
import { CSBOOTCAMP_EXPECTED, DEFAULT_CACHE_DIR, DEFAULT_OUT_DIR, importCsbootcamp, RUNNER_CHECK_HARNESS } from './import.ts';
import { CSBOOTCAMP_SHA, ensureCheckout } from './source.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): number {
  const cacheDir = resolve(arg('cache') ?? DEFAULT_CACHE_DIR);
  const outDir = resolve(arg('out') ?? DEFAULT_OUT_DIR);
  const sha = arg('sha') ?? CSBOOTCAMP_SHA;
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('--sha must be a full 40-hex commit id');
  console.log(`[seed:import:csbootcamp] cache ${cacheDir}`);
  const co = ensureCheckout(cacheDir, sha);
  console.log(`[seed:import:csbootcamp] source elirc/csbootcamp @ ${co.sha} (${co.fetched ? 'fetched' : 'cached checkout reused'})`);
  console.log(`[seed:import:csbootcamp] out   ${outDir}`);
  const { manifest, written, removed } = importCsbootcamp({
    sourceDir: cacheDir,
    outDir,
    expected: sha === CSBOOTCAMP_SHA ? CSBOOTCAMP_EXPECTED : null,
    gitHead: co.sha,
    checkHarness: RUNNER_CHECK_HARNESS,
  });
  for (const c of manifest.courses) console.log(`  ${String(c.order).padStart(2)} ${c.id.padEnd(26)} drills ${String(c.counts.code).padStart(3)}`);
  const t = manifest.totals;
  console.log(`  TOTAL ${t.total} (code ${t.code}) === expected ${JSON.stringify(manifest.expected)}`);
  console.log(`  wrote ${written.length} file(s)${removed.length ? `, removed stale ${removed.join(', ')}` : ''}`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`[seed:import:csbootcamp] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
