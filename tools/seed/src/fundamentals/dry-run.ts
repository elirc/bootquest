// npx tsx tools/seed/src/fundamentals/dry-run.ts <track...>: every importer refusal, nothing written (authoring aid)
import { FUND_TRACKS, FundTrack } from '@bootquest/shared/fundamentals';
import { buildTrack, DEFAULT_AUTHORING_ROOT } from './import.ts';

const tracks = process.argv.slice(2).length ? process.argv.slice(2).map((t) => FundTrack.parse(t)) : [...FUND_TRACKS];
let bad = 0;
for (const t of tracks) {
  try {
    const r = buildTrack(t, DEFAULT_AUTHORING_ROOT);
    console.log(`${t}: OK ${JSON.stringify(r.counts)}`);
  } catch (err) {
    bad++;
    console.log(`${t}: REFUSED ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exit(bad ? 1 : 0);
