// npm run seed:lint:keyideas [-- --content-dir <dir>]
// rv2 S2 (PLAN §2.1): checks every content/keyideas/<section>.json side file (ops/keyideas-lint.ts):
// schema, idea counts, word limits, every scope/sources/siblings key a live non-archived unit, and 0
// leaks of keyed answers outside an idea's sources. Exit 0 = clean, 1 = a problem. Read-only.
import { resolve } from 'node:path';
import { parseArgs, REPO_ROOT } from '../factory/report.ts';
import { formatKeyIdeasReport, keyIdeasFailed, keyIdeasReport } from './keyideas-lint.ts';

const { opts } = parseArgs(process.argv.slice(2));
const report = keyIdeasReport(resolve(opts.get('content-dir') ?? resolve(REPO_ROOT, 'content')));
for (const line of formatKeyIdeasReport(report)) console.log(line);
process.exit(keyIdeasFailed(report) ? 1 : 0);
