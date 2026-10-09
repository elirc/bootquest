// npm run seed:import:jstrain [-- --mirror <dir>] [--out <dir>] [--cs-out <dir>] [--no-expect]
// Reads the jstrain2.2 claiufe mirror READ-ONLY (default Desktop\claiufe\jstrain2.2)
// and writes two packs:
//   content/packs/jstrain/     track js, grader selfrun: bootcamp + tsbootcamp
//                              self-run drills + the quiz bank
//   content/packs/jstrain-cs/  track csharp, grader csharp: the embedded
//                              csbootcamp/, deduped against content/packs/csbootcamp
// The census assertion (JSTRAIN_EXPECTED / JSTRAIN_CS_EXPECTED) runs only when
// the mirror HEAD is the pinned recon sha; --no-expect skips it deliberately.
import { resolve } from 'node:path';
import type { PackCounts } from '@bootquest/shared';
import { DEFAULT_CS_OUT_DIR, githubCsbootcampIds, importJstrainCs } from './cs.ts';
import { DEFAULT_OUT_DIR, importJstrain } from './import.ts';
import { DEFAULT_MIRROR, JSTRAIN_SHA, readGitDirty, readGitHead } from './source.ts';

/**
 * census of the jstrain pack at JSTRAIN_SHA (W3c): 855 self-run drills (731 JS
 * of 734 — 3 multi-file codebase hunts excluded — + 124 TS) and the 453-item
 * quiz bank as 312 predict-output + 141 written.
 */
export const JSTRAIN_EXPECTED: PackCounts = { total: 1308, code: 855, quiz: 0, output: 312, written: 141 };
/** census of the jstrain-cs pack at JSTRAIN_SHA: 147 embedded - 4 dedup - 55 #:sdk/#:package - 7 `using Microsoft.Extensions.*` = 81 */
export const JSTRAIN_CS_EXPECTED: PackCounts = { total: 81, code: 81, quiz: 0, output: 0, written: 0 };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<number> {
  const mirror = resolve(arg('mirror') ?? DEFAULT_MIRROR);
  const outDir = resolve(arg('out') ?? DEFAULT_OUT_DIR);
  const csOutDir = resolve(arg('cs-out') ?? DEFAULT_CS_OUT_DIR);
  const gitHead = readGitHead(mirror);
  const dirty = readGitDirty(mirror);
  const pinned = gitHead === JSTRAIN_SHA && !flag('no-expect');
  console.log(`[seed:import:jstrain] mirror ${mirror} (READ-ONLY) @ ${String(gitHead)}${dirty ? ' (DIRTY)' : ''}`);
  if (gitHead !== JSTRAIN_SHA) console.log(`[seed:import:jstrain] WARNING: mirror HEAD is not the recon sha ${JSTRAIN_SHA}; census not asserted`);

  const js = await importJstrain({
    sourceDir: mirror,
    outDir,
    expected: pinned ? JSTRAIN_EXPECTED : null,
    gitHead,
    dirty,
    checkHarness: true,
    log: (l) => console.log(`  ${l}`),
  });
  console.log(`[seed:import:jstrain] out ${outDir}`);
  for (const c of js.manifest.courses) {
    const n = c.counts;
    console.log(`  ${String(c.order).padStart(2)} ${c.id.padEnd(40)} drills ${String(n.code).padStart(3)}  predict ${String(n.output).padStart(3)}  written ${String(n.written).padStart(3)}`);
  }
  console.log(`  TOTAL ${JSON.stringify(js.manifest.totals)}${js.manifest.expected ? ` === expected` : ' (no census asserted)'}`);
  for (const e of js.manifest.excluded ?? []) console.log(`  EXCLUDED ${e.count} × ${e.what}: ${e.reason}`);
  console.log(`  quiz routing: ${JSON.stringify(js.quizReport)}`);
  console.log(`  wrote ${js.written.length} file(s)${js.removed.length ? `, removed stale ${js.removed.join(', ')}` : ''}`);

  const cs = importJstrainCs({
    sourceDir: mirror,
    outDir: csOutDir,
    githubIds: githubCsbootcampIds(),
    expected: pinned ? JSTRAIN_CS_EXPECTED : null,
    gitHead,
    dirty,
    checkHarness: true,
  });
  console.log(`[seed:import:jstrain] out ${csOutDir}`);
  for (const c of cs.manifest.courses) console.log(`  ${String(c.order).padStart(2)} ${c.id.padEnd(32)} drills ${String(c.counts.code).padStart(3)}`);
  console.log(`  C# census ${JSON.stringify(cs.census)}`);
  for (const o of cs.nameOverlap) console.log(`  DEDUP ${o.embedded} -> github ${o.github}`);
  for (const e of cs.manifest.excluded ?? []) console.log(`  EXCLUDED ${e.count} × ${e.what}`);
  console.log(`  TOTAL ${JSON.stringify(cs.manifest.totals)}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[seed:import:jstrain] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
