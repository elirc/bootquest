// Copy pinned repo mirrors + checkouts from selfboot into an existing clone.
// Usage: node addrepos.mjs <clone-dir> <repo1,repo2,...>
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'C:\\Users\\Owner\\Desktop\\selfboot';
const [dst, list] = process.argv.slice(2);
if (!dst || !list) { console.error('usage: node addrepos.mjs <clone-dir> <repo1,repo2,...>'); process.exit(1); }
function robo(s, d) {
  const r = spawnSync('robocopy', [s, d, '/E', '/MT:16', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'inherit' });
  if (r.status === null || r.status > 7) throw new Error(`robocopy ${s} -> ${d} failed with ${r.status}`);
}
const cos = readdirSync(join(SRC, '.cache', 'checkouts'));
for (const r of list.split(',').filter(Boolean)) {
  const m = join(SRC, '.cache', 'repos', r);
  if (existsSync(m)) robo(m, join(dst, '.cache', 'repos', r)); else console.log(`[warn] no mirror for ${r}`);
  const hits = cos.filter((d) => d === r || d.startsWith(r + '@'));
  if (!hits.length) console.log(`[warn] no checkout for ${r}`);
  for (const c of hits) robo(join(SRC, '.cache', 'checkouts', c), join(dst, '.cache', 'checkouts', c));
}
console.log('[done]');
