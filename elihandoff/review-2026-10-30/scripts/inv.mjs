import fs from 'node:fs';
import path from 'node:path';
const root = 'C:/Users/Owner/Desktop/selfboot/content/seed/explainback';
const rows = [];
for (const d of fs.readdirSync(root).sort()) {
  const dir = path.join(root, d);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const it = JSON.parse(fs.readFileSync(path.join(dir, 'items.json'), 'utf8'));
  const rq = JSON.parse(fs.readFileSync(path.join(dir, 'review-queue.json'), 'utf8'));
  for (const item of it.items) {
    const kind = d.startsWith('sysdesign--') ? 'DESIGN' : d.startsWith('g2-brief--') ? 'G2' : 'CLASSIC';
    const qs = item.questions || [];
    const kps = qs.map(q => q.keyPoints.length);
    const weights = qs.map(q => q.keyPoints.map(k => k.weight ?? (k.text.match(/\[w(\d)\]/)?.[1] ?? '-')).join(''));
    const prompt0 = (qs[0]?.prompt || '').slice(0, 90).replace(/\s+/g, ' ');
    rows.push({ pack: d, kind, repo: item.provenance.repo, path: item.provenance.path, set: item.set || 'A', nQ: qs.length, kps: kps.join('/'), weights: weights.join('|'), cites: (item.citations||[]).length, rq: Array.isArray(rq) ? rq.length : (rq.items?.length ?? 0), title: item.title || '', prompt0 });
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify(rows, null, 1));
const by = {};
for (const r of rows) by[r.kind] = (by[r.kind]||0)+1;
console.log(by, rows.length);
// item keys sample
console.log(Object.keys(rows[0]));
