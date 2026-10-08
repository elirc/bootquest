// npm run seed:import:bootforge [-- --source <dir>] [--out <dir>]
// Reads opusboot2's compiled content/build/*.json (READ-ONLY, working tree per
// LEARNING.md R1) and writes content/packs/bootforge/{<course>.json, manifest.json}.
import { resolve } from 'node:path';
import { BOOTFORGE_EXPECTED, DEFAULT_OUT_DIR, DEFAULT_SOURCE_DIR, importBootforge } from './import.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const sourceDir = resolve(arg('source') ?? DEFAULT_SOURCE_DIR);
  const outDir = resolve(arg('out') ?? DEFAULT_OUT_DIR);
  console.log(`[seed:import:bootforge] source ${sourceDir}`);
  console.log(`[seed:import:bootforge] out    ${outDir}`);
  const { manifest, written, removed } = await importBootforge({ sourceDir, outDir, expected: BOOTFORGE_EXPECTED, recordGit: true });
  for (const c of manifest.courses) {
    const k = c.counts;
    console.log(`  ${String(c.order).padStart(2)} ${c.id.padEnd(22)} total ${String(k.total).padStart(4)}  code ${String(k.code).padStart(4)}  quiz ${String(k.quiz).padStart(3)}  output ${String(k.output).padStart(3)}  written ${k.written}`);
  }
  const t = manifest.totals;
  console.log(`  TOTAL ${t.total} (code ${t.code} / quiz ${t.quiz} / output ${t.output} / written ${t.written}) === expected ${JSON.stringify(manifest.expected)}`);
  console.log(`  upstream HEAD ${manifest.importedFrom.gitHead ?? '(none)'}${manifest.importedFrom.dirty ? ' + uncommitted working-tree changes' : ''}`);
  console.log(`  wrote ${written.length} file(s)${removed.length ? `, removed stale ${removed.join(', ')}` : ''}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[seed:import:bootforge] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
