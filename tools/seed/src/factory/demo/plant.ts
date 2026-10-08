/**
 * Planted-bad helpers shared by the demo and the tests. The secret-bearing
 * VERIFICATION.md is materialized only in temp dirs, from a token-shaped string
 * assembled at runtime — no token-shaped string is ever committed.
 */
import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../report.ts';

export const FIXTURES = join(REPO_ROOT, 'tools', 'seed', 'src', 'factory', 'fixtures');

/** A fake Shopify-shaped token (matches the registry's shopify-token pattern). */
export const plantedToken = (): string => ['shp', 'at_', 'deadbeef'.repeat(4)].join('');

/** Copy the planted andie tree to root/<repoDirName> and add a VERIFICATION.md carrying the planted token. */
export function plantAndie(root: string, repoDirName: string): string {
  const dir = join(root, repoDirName);
  cpSync(join(FIXTURES, 'planted', 'andie'), dir, { recursive: true });
  writeFileSync(
    join(dir, 'astraupskill', 'VERIFICATION.md'),
    ['# Verification (PLANTED FAKE)', '', `Store API token used for the run: ${plantedToken()}`, '', 'Ran the suite: 43 pass.', ''].join('\n'),
  );
  return dir;
}
