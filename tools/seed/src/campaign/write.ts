import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BuiltCampaign } from './build.ts';

/** Write the built campaign (exact bytes) and remove stale *.json the build no longer produces. */
export function writeCampaign(outDir: string, built: BuiltCampaign): { written: string[]; removed: string[] } {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const [name, bytes] of [...built.files].sort(([a], [b]) => a.localeCompare(b))) {
    writeFileSync(join(outDir, name), bytes, 'utf8');
    written.push(name);
  }
  const removed: string[] = [];
  for (const f of readdirSync(outDir).filter((f) => f.endsWith('.json')).sort()) {
    if (!built.files.has(f)) {
      rmSync(join(outDir, f));
      removed.push(f);
    }
  }
  return { written, removed };
}

/** --check: the committed files must equal a fresh build byte-for-byte. Returns the differing file names. */
export function diffCampaign(outDir: string, built: BuiltCampaign): string[] {
  const diffs: string[] = [];
  for (const [name, bytes] of built.files) {
    const p = join(outDir, name);
    if (!existsSync(p) || readFileSync(p, 'utf8') !== bytes) diffs.push(name);
  }
  if (existsSync(outDir)) {
    for (const f of readdirSync(outDir).filter((f) => f.endsWith('.json'))) if (!built.files.has(f)) diffs.push(`${f} (stale)`);
  }
  return diffs.sort();
}
