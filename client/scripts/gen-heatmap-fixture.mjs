// Regenerates src/api/fixtures/heatmap.json deterministically (90 days ending 2026-10-07),
// in the server's DashboardResponse.heatmap shape: { day, xp, status }.
// Status vocabulary (server streak engine): open (today, not closed yet) | slate | partial |
// frozen (missed, saved by a token) | missed | none (no slate row: before tracking began).
// Usage: node client/scripts/gen-heatmap-fixture.mjs client/src/api/fixtures/heatmap.json
import { writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) throw new Error('usage: gen-heatmap-fixture.mjs <out.json>');
let seed = 20261007;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const end = Date.UTC(2026, 9, 7); // 2026-10-07 = fixture "today"
const days = [];
for (let i = 89; i >= 0; i--) days.push(new Date(end - i * 86400000).toISOString().slice(0, 10));

const before = new Set(['2026-07-10', '2026-07-11']); // tracking began 2026-07-12
const gap = new Set(['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15']); // 5-day trip
const freeze = new Set(['2026-09-04', '2026-09-23']); // streak saved by a token
const low = new Set(['2026-07-19', '2026-07-27', '2026-08-30', '2026-09-13']); // <20 XP: breaks streak
const zero = new Set(['2026-07-12', '2026-07-20', '2026-08-02', '2026-08-31', '2026-09-14']);

const rows = days.map((day, idx) => {
  if (day === '2026-10-07') return { day, xp: 64, status: 'open' }; // today, slate in progress
  if (before.has(day)) return { day, xp: 0, status: 'none' };
  if (gap.has(day) || zero.has(day)) return { day, xp: 0, status: 'missed' };
  if (freeze.has(day)) return { day, xp: 0, status: 'frozen' };
  if (low.has(day)) return { day, xp: 6 + Math.floor(rnd() * 12), status: 'missed' };
  const ramp = idx / 89; // consistency improves over the window
  if (rnd() < 0.28 - ramp * 0.15) return { day, xp: 20 + Math.floor(rnd() * 35), status: 'partial' };
  return { day, xp: 85 + Math.floor(rnd() * 120 + ramp * 60), status: 'slate' };
});

writeFileSync(out, JSON.stringify(rows, null, 2) + '\n');
let streak = 0;
for (let i = rows.length - 2; i >= 0 && rows[i].status !== 'missed' && rows[i].status !== 'none'; i--) streak++;
console.log(`days=${rows.length} first=${rows[0].day} streak=${streak}`);
