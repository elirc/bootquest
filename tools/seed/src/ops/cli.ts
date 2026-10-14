// npm run restamp:all [-- --dry-run] [--checkouts <dir>]
// ONE command for the post-integration re-sweep (RECIPES.md "fingerprint-aware
// integration order" step 2): sequential full seed:validate per code-pack source,
// one validator shutdown, seed:check --restamp over the seed packs, then the
// estate-wide STAMP STATUS table (code packs through the server's own loader,
// seed packs through loadSeedPack, campaign via the seeder fingerprint).
// --dry-run prints the plan + the current table and EXECUTES NOTHING; the full
// run re-executes every reference solution (~60 min on this machine) — run it
// foreground and let the per-source journals absorb any interrupt.
import { resolve } from 'node:path';
import { campaignSeederFingerprint } from '@bootquest/server/campaign-fingerprint';
import { readPack } from '@bootquest/server/packs';
import { loadSeedPack } from '../factory/pack.ts';
import { DEFAULT_CHECKOUTS, runCheck } from '../factory/check/check.ts';
import { DEFAULT_SEED_DIR, parseArgs, REPO_ROOT } from '../factory/report.ts';
import { DEFAULT_JOURNAL_DIR, runValidate, shutdownValidatorRunners } from '../validate/validate.ts';
import { runRestampAll, type RestampAllDeps, type RestampAllPaths } from './restamp-all.ts';

const { opts, flags } = parseArgs(process.argv.slice(2));
const dryRun = flags.has('dry-run');
const checkouts = resolve(opts.get('checkouts') ?? process.env.BOOTQUEST_CHECKOUTS ?? DEFAULT_CHECKOUTS);

const paths: RestampAllPaths = {
  packsDir: resolve(REPO_ROOT, 'content', 'packs'),
  seedDir: resolve(DEFAULT_SEED_DIR),
  campaignDir: resolve(REPO_ROOT, 'content', 'campaign'),
  journalDir: DEFAULT_JOURNAL_DIR,
};

const deps: RestampAllDeps = {
  async validate({ packDir, journalPath }) {
    const report = await runValidate({ packDir, journalPath, concurrency: 4, log: (l) => console.log(l) });
    return { ok: report.ok, stampPath: report.stampPath };
  },
  shutdown: () => shutdownValidatorRunners(),
  async check() {
    const r = await runCheck({ seedDir: paths.seedDir, checkouts, restamp: true, log: (l) => console.log(l) });
    return { ok: r.ok };
  },
  // verifyStamp mirror: the exact loader (+ stamp check) `npm run serve` runs at startup
  probeCodePack: (dir) => void readPack(dir),
  probeSeedPack: (dir) => void loadSeedPack(dir, { requireStamp: true }),
  campaignFingerprint: () => campaignSeederFingerprint(),
};

console.log(`[restamp:all] packs ${paths.packsDir}`);
console.log(`[restamp:all] seed ${paths.seedDir}; checkouts ${checkouts}`);
console.log(`[restamp:all] campaign ${paths.campaignDir}; journals ${paths.journalDir}`);
runRestampAll({ paths, deps, dryRun, log: (l) => console.log(l) }).then(
  (r) => {
    console.log(`RESULT ${r.ok ? 'OK' : 'FAIL'}${r.dryRun ? ' (dry run: table reflects the CURRENT stamps; nothing was executed)' : ''}`);
    process.exit(r.ok ? 0 : 1);
  },
  (err: unknown) => {
    console.error(`[restamp:all] CRASHED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  },
);
