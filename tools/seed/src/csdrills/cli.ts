// npm run seed:import:csdrills [-- --authoring <dir>] [--out <dir>]
// Reads the committed csdrills authoring JSON (default tools/seed/authoring/csdrills,
// hand-written in this repo — no checkout) READ-ONLY and writes
// content/packs/csdrills/{<module>.json, manifest.json}. Then stamp it with
// `npm run seed:validate -- --source csdrills` (the real warm C# runner).
import { resolve } from 'node:path';
import { CSDRILLS_EXPECTED, DEFAULT_AUTHORING_DIR, DEFAULT_OUT_DIR, importCsdrills } from './import.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): number {
  const authoringDir = resolve(arg('authoring') ?? DEFAULT_AUTHORING_DIR);
  const outDir = resolve(arg('out') ?? DEFAULT_OUT_DIR);
  console.log(`[seed:import:csdrills] authoring ${authoringDir}`);
  console.log(`[seed:import:csdrills] out       ${outDir}`);
  const { manifest, written, removed } = importCsdrills({ authoringDir, outDir, expected: CSDRILLS_EXPECTED, recordGit: true });
  const f = manifest.importedFrom;
  console.log(`[seed:import:csdrills] git HEAD ${f.gitHead ?? '(none)'}${f.dirty ? ' + uncommitted authoring changes' : ''}`);
  for (const c of manifest.courses) console.log(`  ${String(c.order).padStart(2)} ${c.id.padEnd(30)} drills ${String(c.counts.code).padStart(3)}`);
  const t = manifest.totals;
  console.log(`  TOTAL ${t.total} (code ${t.code}) === expected ${JSON.stringify(manifest.expected)}`);
  console.log(`  wrote ${written.length} file(s)${removed.length ? `, removed stale ${removed.join(', ')}` : ''}`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`[seed:import:csdrills] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
