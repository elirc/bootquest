// npm run seed:import:fundamentals -- --track <js|csharp|java|all> [--authoring <dir>] [--topics <dir>] [--packs <dir>]
// Reads the committed Fundamentals authoring JSON (default tools/seed/authoring/fundamentals/<track>,
// hand-written in this repo — no checkout) READ-ONLY and writes
//   content/fundamentals/<track>/{topics.json, manifest.json}  (lessons, quiz gates, flashcards)
//   content/packs/fund-<track>/{<NN-topic>.json, manifest.json} (drills)
// Then stamp the drills with `npm run seed:validate -- --source fund-<track>` (the real runners).
import { resolve } from 'node:path';
import { FUND_TRACKS, FundTrack } from '@bootquest/shared/fundamentals';
import { DEFAULT_AUTHORING_ROOT, DEFAULT_PACKS_ROOT, DEFAULT_TOPICS_ROOT, FUNDAMENTALS_EXPECTED, importFundamentals } from './import.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): number {
  const which = arg('track');
  if (!which) throw new Error(`--track is required (${FUND_TRACKS.join(' | ')} | all)`);
  const tracks = which === 'all' ? [...FUND_TRACKS] : [FundTrack.parse(which)];
  const authoringRoot = resolve(arg('authoring') ?? DEFAULT_AUTHORING_ROOT);
  const topicsRoot = resolve(arg('topics') ?? DEFAULT_TOPICS_ROOT);
  const packsRoot = resolve(arg('packs') ?? DEFAULT_PACKS_ROOT);
  for (const track of tracks) {
    const r = importFundamentals({ track, authoringRoot, topicsRoot, packsRoot, expected: FUNDAMENTALS_EXPECTED[track], recordGit: true });
    const g = r.topicsManifest.importedFrom;
    console.log(`[seed:import:fundamentals] ${track}: git HEAD ${g.gitHead ?? '(none)'}${g.dirty ? ' + uncommitted authoring changes' : ''}`);
    console.log(`  topics ${r.counts.topics} · quiz ${r.counts.quiz} · flashcards ${r.counts.flashcards} · drills ${r.counts.drills} === expected ${JSON.stringify(FUNDAMENTALS_EXPECTED[track])}`);
    console.log(`  wrote ${r.written.join(', ')}${r.removed.length ? `; removed stale ${r.removed.join(', ')}` : ''}`);
    if (r.packManifest) console.log(`  next: npm run seed:validate -- --source fund-${track}`);
  }
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`[seed:import:fundamentals] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
