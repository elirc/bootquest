// npx tsx tools/seed/src/fundamentals/import-draft.ts <track>: import WITHOUT the census (authoring aid while a wave is
// in progress); the committed outputs always come from `npm run seed:import:fundamentals` (census-bound).
import { FundTrack } from '@bootquest/shared/fundamentals';
import { DEFAULT_AUTHORING_ROOT, DEFAULT_PACKS_ROOT, DEFAULT_TOPICS_ROOT, importFundamentals } from './import.ts';

const track = FundTrack.parse(process.argv[2]);
const r = importFundamentals({ track, authoringRoot: DEFAULT_AUTHORING_ROOT, topicsRoot: DEFAULT_TOPICS_ROOT, packsRoot: DEFAULT_PACKS_ROOT, expected: null });
console.log(`${track}: ${JSON.stringify(r.counts)} (draft import, no census)`);
