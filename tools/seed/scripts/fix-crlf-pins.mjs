#!/usr/bin/env node
// ONE-SHOT migration: re-pin seed packs whose blob ids came from autocrlf-converted
// checkouts (see tools/seed/src/ops/fix-crlf-pins.ts for exactly what it does).
//
//   npm run seed:fix-crlf-pins -- [--dry-run] [--repos a,b] [--root <app repo>] [--cache <dir>]
//   (= node --import tsx tools/seed/scripts/fix-crlf-pins.mjs ...; plain `node` re-execs under tsx)
//
// Run it FOREGROUND from the app repo. It refuses (changes nothing) while any pinned
// repo has no mirror holding its sha, printing the fetch commands. Exit 0 = everything
// fixed (or nothing to do); 1 = something could not be fixed (listed); 2 = refused.
// Afterwards every changed pack's stamp carries a zeroed fingerprint: run
// `npm run seed:pins` (must be RESULT OK), then `npm run restamp:all` (or
// `npm run seed:check -- --restamp`) to re-validate and restamp.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let mod;
try {
  mod = await import(pathToFileURL(resolve(here, '..', 'src', 'ops', 'fix-crlf-pins.ts')).href);
} catch (err) {
  if (process.env.BQ_FIX_CRLF_REEXEC) throw err;
  // plain node cannot load .ts: re-run under the tsx loader the seed tools use
  const r = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, BQ_FIX_CRLF_REEXEC: '1' },
  });
  process.exit(r.status ?? 1);
}

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
const root = resolve(opt('root') ?? resolve(here, '..', '..', '..'));
const cache = opt('cache');
const repos = opt('repos')?.split(',').filter(Boolean);
const dryRun = argv.includes('--dry-run');

const log = (l) => console.log(l);
const rep = mod.runFixCrlfPins({ root, ...(cache ? { cacheDir: resolve(cache) } : {}), ...(repos ? { repos } : {}), dryRun, log });
mod.printSummary(rep, log);
process.exit(rep.refused.length ? 2 : rep.ok ? 0 : 1);
