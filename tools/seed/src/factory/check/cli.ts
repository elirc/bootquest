// npm run seed:check [-- --dir <seed-root>] [--checkouts <dir>] [--restamp]
// Re-verifies every emitted seed pack (structure, stamp, pin, and every shipped
// item through its generator's validator; variants/patches re-executed by the real
// runner). Exit 0 only when every pack passes. W7's full validate calls this.
// --restamp (W7): a pack whose ONLY problem is a stale seed fingerprint (validator /
// generator / registry / toolchain edited since stamping) is re-stamped after its full
// re-validation comes back clean; any other problem still FAILS.
import { resolve } from 'node:path';
import { DEFAULT_SEED_DIR, parseArgs } from '../report.ts';
import { DEFAULT_CHECKOUTS, runCheck } from './check.ts';

const { opts, flags } = parseArgs(process.argv.slice(2));
const seedDir = resolve(opts.get('dir') ?? DEFAULT_SEED_DIR);
const checkouts = resolve(opts.get('checkouts') ?? process.env.BOOTQUEST_CHECKOUTS ?? DEFAULT_CHECKOUTS);
console.log(`[seed:check] seed packs under ${seedDir}; checkouts ${checkouts}`);
const restamp = flags.has('restamp');
runCheck({ seedDir, checkouts, restamp, ...(opts.has('exclusions') ? { exclusionsPath: opts.get('exclusions')! } : {}), log: (l) => console.log(l) }).then(
  (r) => {
    console.log(`[seed:check] ${r.packs.length} pack(s): ${r.packs.filter((p) => p.ok).length} ok, ${r.packs.filter((p) => !p.ok).length} failed; ${r.packs.reduce((n, p) => n + p.items, 0)} shipped item(s) re-validated${restamp ? `; ${r.packs.filter((p) => p.restamped).length} restamped` : ''}`);
    console.log(`RESULT ${r.ok ? 'OK' : 'FAIL'}`);
    process.exit(r.ok ? 0 : 1);
  },
  (err: unknown) => {
    console.error(`[seed:check] CRASHED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  },
);
