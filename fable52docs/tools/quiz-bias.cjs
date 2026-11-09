// Read-only content probe: how often is the keyed answer of a multiple-choice item the single
// longest choice? Chance for 4 choices is ~25%. Run from the repo root:
//   node fable52docs/tools/quiz-bias.cjs            (scans content/)
//   node fable52docs/tools/quiz-bias.cjs <dir>      (scans another folder, e.g. tools/seed/authoring)
//   node fable52docs/tools/quiz-bias.cjs content --list 20   (also prints 20 offending items)
const fs = require('fs');
const path = require('path');

const root = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'content';
const listAt = process.argv.indexOf('--list');
const listN = listAt > 0 ? Number(process.argv[listAt + 1] || 20) : 0;

const stats = {};
const seen = new Set();
const offenders = [];

function answerIndex(o, choices) {
  if (typeof o.answerKey === 'number') return o.answerKey;
  if (typeof o.answer === 'number') return o.answer;
  if (o.check && typeof o.check.answerKey === 'number') return o.check.answerKey;
  if (o.check && typeof o.check.answer === 'number') return o.check.answer;
  return choices.findIndex((c) => c && typeof c === 'object' && c.correct === true);
}

function walk(o, file) {
  if (Array.isArray(o)) return o.forEach((x) => walk(x, file));
  if (!o || typeof o !== 'object') return;
  const ch = o.choices || o.options;
  if (Array.isArray(ch) && ch.length >= 2) {
    const texts = ch.map((c) => (typeof c === 'string' ? c : String(c?.text ?? c?.label ?? '')));
    const ai = answerIndex(o, ch);
    const id = (o.itemKey || o.key || o.prompt || '') + '|' + texts.join('|');
    if (!seen.has(id)) {
      seen.add(id);
      const group = file.split(path.sep).slice(1, 3).join('/');
      const s = (stats[group] ??= { items: 0, keyed: 0, longest: 0, shortest: 0, twoChoice: 0, pos: [0, 0, 0, 0, 0, 0] });
      s.items++;
      if (ch.length === 2) s.twoChoice++;
      if (ai >= 0 && ai < texts.length) {
        s.keyed++;
        s.pos[ai]++;
        const L = texts.map((t) => t.length);
        const max = Math.max(...L);
        const min = Math.min(...L);
        if (L[ai] === max && L.filter((v) => v === max).length === 1) {
          s.longest++;
          // "badly" biased: the key is at least 1.5x the next longest choice
          const next = Math.max(...L.filter((_, i) => i !== ai));
          if (L[ai] >= 1.5 * next) offenders.push({ file, key: o.itemKey || o.key || (o.prompt || '').slice(0, 60), keyLen: L[ai], nextLen: next });
        }
        if (L[ai] === min && L.filter((v) => v === min).length === 1) s.shortest++;
      }
    }
  }
  for (const v of Object.values(o)) walk(v, file);
}

function files(d) {
  for (const f of fs.readdirSync(d)) {
    const q = path.join(d, f);
    const st = fs.statSync(q);
    if (st.isDirectory()) files(q);
    else if (f.endsWith('.json') && st.size < 80e6) {
      try {
        walk(JSON.parse(fs.readFileSync(q, 'utf8')), q);
      } catch {
        /* not JSON we understand */
      }
    }
  }
}

files(root);
const rows = Object.entries(stats)
  .filter(([, s]) => s.keyed >= 10)
  .map(([group, s]) => ({
    group,
    items: s.items,
    keyed: s.keyed,
    'key is longest %': Math.round((100 * s.longest) / s.keyed),
    'key is shortest %': Math.round((100 * s.shortest) / s.keyed),
    twoChoice: s.twoChoice,
    'key position 0..': s.pos.filter((_, i) => i < 4).join('/'),
  }))
  .sort((a, b) => b.keyed - a.keyed);
console.table(rows);
let K = 0;
let L = 0;
for (const s of Object.values(stats)) {
  K += s.keyed;
  L += s.longest;
}
console.log(`total keyed items ${K}; key is the single longest choice in ${L} (${Math.round((100 * L) / K)}%); badly biased (key >= 1.5x next) ${offenders.length}`);
if (listN) for (const o of offenders.sort((a, b) => b.keyLen / b.nextLen - a.keyLen / a.nextLen).slice(0, listN)) console.log(`${o.keyLen}/${o.nextLen}  ${o.key}  (${o.file})`);
