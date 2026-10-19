// npm run seed:pins [-- --seed <dir>] [--cache <dir>] [--repos a,b] [--strict]
// Read-only: every seed pack manifest's blob ids vs `git ls-tree -r <pinned sha>` in
// the repo mirror (<cache>/repos/<repo> or <cache>/sources/<repo>; BOOTQUEST_REPOS adds
// roots). Exit 1 on any MISMATCH; with --strict also on any UNCHECKABLE (missing mirror).
import { resolve } from 'node:path';
import { mirrorRoots } from '../factory/pins.ts';
import { DEFAULT_SEED_DIR, parseArgs, REPO_ROOT } from '../factory/report.ts';
import { runPins } from './pins.ts';

const { opts, flags } = parseArgs(process.argv.slice(2));
const seedDir = resolve(opts.get('seed') ?? DEFAULT_SEED_DIR);
const cacheDir = resolve(opts.get('cache') ?? resolve(REPO_ROOT, '.cache'));
const roots = mirrorRoots(cacheDir);
const repos = opts.get('repos')?.split(',').filter(Boolean);
const strict = flags.has('strict');

console.log(`[seed:pins] seed ${seedDir}`);
console.log(`[seed:pins] mirrors ${roots.join(', ')}${repos ? `; repos ${repos.join(', ')}` : ''}`);
const r = runPins({ seedDir, roots, ...(repos ? { repos } : {}), log: (l) => console.log(l) });
const fail = r.mismatch > 0 || (strict && r.uncheckable > 0);
console.log(`RESULT ${fail ? 'FAIL' : 'OK'}: ${r.packs.length} pack(s): ${r.ok} OK, ${r.mismatch} MISMATCH, ${r.uncheckable} UNCHECKABLE${strict ? ' (--strict)' : ''}`);
process.exit(fail ? 1 : 0);
