// npm run seed:lint:leaks [-- --seed-dir <dir>] [--xleak-baseline <file>]
// Part 1 lists every explain-back key point that restates a keyed answer of a same-repo quest pack
// (ops/leak-lint.ts). Part 2 (ops/xleak-lint.ts) lists the paraphrase leaks that token check cannot
// see: key points inside same-repo quiz explanations, flashcard backs, notes and other explain-back
// sets, flashcard backs that carry a same-pack quiz key, and DESIGN IT/G2 sets with an unweighted
// key point. Exit 0 = both parts clean; 1 = a leak (exempt ones included: the exemption only keeps
// seed:check restamping while they are rewritten), a stale exemption, an xleak pair outside its
// baseline, a stale baseline entry or an unweighted key point.
// EB_LEAK_EXEMPT (guards.ts) and xleak-baseline.json only ever SHRINK: this tool never prints an
// exemption or a baseline entry to paste back in. A new leak is fixed by rewriting its editable side
// in the draft and re-seeding the pack.
import { resolve } from 'node:path';
import { DEFAULT_SEED_DIR, parseArgs } from '../factory/report.ts';
import { formatLeakLintReport, leakLintCounts, leakLintReport } from './leak-lint.ts';
import { DEFAULT_XLEAK_BASELINE, formatXleakReport, loadXleakBaseline, xleakFailed, xleakReport } from './xleak-lint.ts';

const { opts, flags } = parseArgs(process.argv.slice(2));
if (flags.has('exempt-ids')) {
  console.error('[seed:lint:leaks] --exempt-ids was removed: EB_LEAK_EXEMPT only shrinks (rewrite the key point; never re-add an exemption)');
  process.exit(2);
}
const seedDir = resolve(opts.get('seed-dir') ?? DEFAULT_SEED_DIR);
const report = leakLintReport(seedDir);
for (const line of formatLeakLintReport(report)) console.log(line);
const c = leakLintCounts(report);
const xr = xleakReport(seedDir, loadXleakBaseline(resolve(opts.get('xleak-baseline') ?? DEFAULT_XLEAK_BASELINE)));
for (const line of formatXleakReport(xr)) console.log(line);
process.exit(c.leaks || c.stale || xleakFailed(xr) ? 1 : 0);
