// npm run seed:lint:leaks [-- --seed-dir <dir>] [--exempt-ids]
// Lists every explain-back key point that restates a keyed answer of a same-repo quest pack
// (ops/leak-lint.ts). Exit 0 = no leak at all; 1 = leak(s) (exempt ones included: the exemption
// only keeps seed:check restamping while they are rewritten) or a stale exemption.
// --exempt-ids additionally prints the current leaks as an EB_LEAK_EXEMPT literal.
import { resolve } from 'node:path';
import { DEFAULT_SEED_DIR, parseArgs } from '../factory/report.ts';
import { formatLeakLintReport, leakLintCounts, leakLintReport } from './leak-lint.ts';

const { opts, flags } = parseArgs(process.argv.slice(2));
const report = leakLintReport(resolve(opts.get('seed-dir') ?? DEFAULT_SEED_DIR));
for (const line of formatLeakLintReport(report)) console.log(line);
if (flags.has('exempt-ids')) {
  console.log('EB_LEAK_EXEMPT = {');
  for (const row of report.rows.filter((r) => r.leaks.length)) console.log(`  ${JSON.stringify(row.pack)}: [${row.leaks.map((l) => JSON.stringify(l.id)).join(', ')}],`);
  console.log('};');
}
const c = leakLintCounts(report);
process.exit(c.leaks || c.stale ? 1 : 0);
