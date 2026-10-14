/**
 * Stale-quarantine prune (factory fix 4). writeQuarantine only replaces entries
 * for the courses in a RUN's scope and keeps every other course's entries — so an
 * entry whose course was later REMOVED from the manifest is never in scope again,
 * survives forever, and its key stays bound into every future validation stamp.
 * Called by the seed:validate CLI before runValidate: entries whose course is no
 * longer in the manifest are dropped, and quarantine.json + QUARANTINE.md are
 * rewritten through writeQuarantine itself (byte-exact format). Deliberately
 * conservative:
 *   - a malformed quarantine.json is left untouched (runValidate's F8 refusal
 *     owns that case — this module never rewrites what it cannot read);
 *   - an unreadable/invalid manifest prunes nothing (runValidate reports it);
 *   - a quarantine file for another source prunes nothing (runValidate refuses it).
 * NOT part of any grader fingerprint (validate.ts is; this file and cli.ts are not).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { QuarantineFileError, readQuarantineFile, writeQuarantine } from './validate.ts';

/** only what the prune needs from manifest.json (full validation is runValidate's job) */
const ManifestCourses = z.object({
  source: z.string().min(1),
  courses: z.array(z.object({ id: z.string().min(1) })),
});

export interface PrunedEntry {
  key: string;
  course: string;
  reason: string;
}

export function pruneStaleQuarantine(packDir: string, log: (line: string) => void = () => {}): PrunedEntry[] {
  const manifestPath = join(packDir, 'manifest.json');
  if (!existsSync(manifestPath)) return [];
  let manifest: z.infer<typeof ManifestCourses>;
  try {
    manifest = ManifestCourses.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch {
    return []; // runValidate reports the unreadable manifest itself
  }
  let quarantine;
  try {
    quarantine = readQuarantineFile(packDir);
  } catch (err) {
    if (err instanceof QuarantineFileError) return []; // F8: left for runValidate's refusal
    throw err;
  }
  if (!quarantine || quarantine.source !== manifest.source) return [];
  const live = new Set(manifest.courses.map((c) => c.id));
  const stale = quarantine.entries.filter((e) => !live.has(e.course));
  if (stale.length === 0) return [];
  for (const e of stale) log(`PRUNED ${e.key} [${e.course}]: course no longer in the manifest`);
  writeQuarantine(packDir, quarantine.source, [...new Set(stale.map((e) => e.course))], []);
  return stale;
}
