// npm run seed:lint:leaks [-- --seed-dir <dir>]
// Lists every explain-back key point that restates a keyed answer of a same-repo quest pack
// (ops/leak-lint.ts). Exit 0 = no leak at all; 1 = leak(s) (exempt ones included: the exemption
// only keeps seed:check restamping while they are rewritten) or a stale exemption.
// EB_LEAK_EXEMPT (guards.ts) only ever SHRINKS: this tool never prints an exemption literal to paste
// back in. A new leak is fixed by rewriting the key point in its draft and re-seeding the pack.
import { resolve } from 'node:path';
import { DEFAULT_SEED_DIR, parseArgs } from '../factory/report.ts';
import { formatLeakLintReport, leakLintCounts, leakLintReport } from './leak-lint.ts';

const { opts, flags } = parseArgs(process.argv.slice(2));
if (flags.has('exempt-ids')) {
  console.error('[seed:lint:leaks] --exempt-ids was removed: EB_LEAK_EXEMPT only shrinks (rewrite the key point; never re-add an exemption)');
  process.exit(2);
}
const report = leakLintReport(resolve(opts.get('seed-dir') ?? DEFAULT_SEED_DIR));
for (const line of formatLeakLintReport(report)) console.log(line);
const c = leakLintCounts(report);
process.exit(c.leaks || c.stale ? 1 : 0);
