import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The campaign seeder fingerprint (W5b): sha256 over the seeder's own source
 * bytes (tools/seed/src/campaign/*.ts, tests excluded, CRLF-normalized, sorted
 * by file name) plus the shared pack schema. Lives in the server so the seeder
 * (which writes it into content/campaign/manifest.json) and the campaign loader
 * (which refuses a manifest stamped by a different seeder) compute it the same way.
 *
 * Deliberately lighter than the grader fingerprint: campaign packs are
 * structural (which repos sit in which act), never executed, so no toolchain
 * versions are bound in — a node upgrade does not invalidate the map.
 */

const REPO = resolve(import.meta.dirname, '..', '..', '..');
export const CAMPAIGN_SEEDER_DIR = join(REPO, 'tools', 'seed', 'src', 'campaign');
const SHARED_SCHEMA = join(REPO, 'shared', 'src', 'campaign.ts');

export function campaignSeederFiles(dir: string = CAMPAIGN_SEEDER_DIR): string[] {
  const own = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
    .map((f) => join(dir, f));
  return [...own, SHARED_SCHEMA];
}

let cached: string | undefined;

export function campaignSeederFingerprint(): string {
  if (cached === undefined) {
    const h = createHash('sha256');
    for (const f of campaignSeederFiles()) {
      h.update(f.slice(REPO.length).replace(/\\/g, '/'));
      h.update('\u0000');
      h.update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
      h.update('\u0000');
    }
    cached = h.digest('hex');
  }
  return cached;
}
