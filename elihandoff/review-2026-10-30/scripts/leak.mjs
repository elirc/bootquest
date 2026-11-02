import fs from 'node:fs';
import path from 'node:path';
const C = 'C:/Users/Owner/Desktop/selfboot/content/seed';
const STOP = new Set('the a an and or of to in on for with that this is are be was were it its as at by from into than then so not no when which who what where while each every one two also only ever never still just more most same other another such into over under before after about against between through during without within because if but out up down off any all both same make made makes making take takes taken use used uses using like than there their they them these those have has had having does did doing done can could would should will may might must shall own very per via how why whether'.split(' '));
const tok = s => new Set(String(s).toLowerCase().replace(/\[w\d\]/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 4 && !STOP.has(w)));
const ebs = [];
for (const d of fs.readdirSync(path.join(C, 'explainback'))) {
  const it = JSON.parse(fs.readFileSync(path.join(C, 'explainback', d, 'items.json'), 'utf8'));
  for (const item of it.items) item.questions.forEach((q, qi) => q.keyPoints.forEach((k, ki) => ebs.push({ pack: d, repo: item.provenance.repo, set: item.set || 'A', id: `q${qi}.kp${ki}`, text: k.text, t: tok(k.text) })));
}
const others = [];
for (const d of fs.readdirSync(path.join(C, 'quests'))) {
  const it = JSON.parse(fs.readFileSync(path.join(C, 'quests', d, 'items.json'), 'utf8'));
  for (const item of it.items) {
    const repo = item.provenance.repo;
    if (item.kind === 'quiz') { const ans = item.choices?.[item.check?.answerKey]?.text ?? ''; others.push({ repo, kind: 'quiz', id: item.key.split('/').pop(), text: ans + ' ' + (item.explanation || ''), t: tok(ans + ' ' + (item.explanation || '')) }); }
    if (item.kind === 'flashcard') others.push({ repo, kind: 'fc', id: item.label || item.key.split('/').pop(), text: item.back, t: tok(item.back) });
  }
}
for (const d of fs.readdirSync(path.join(C, 'notes'))) {
  const it = JSON.parse(fs.readFileSync(path.join(C, 'notes', d, 'items.json'), 'utf8'));
  for (const item of it.items) others.push({ repo: item.provenance.repo, kind: 'note', id: item.noteId, text: item.title + ' ' + item.body, t: tok(item.title + ' ' + item.body) });
}
function inter(a, b) { let n = 0; for (const x of a) if (b.has(x)) n++; return n; }
const byRepoO = {}; for (const o of others) (byRepoO[o.repo] ??= []).push(o);
const byRepoE = {}; for (const e of ebs) (byRepoE[e.repo] ??= []).push(e);
const out = [];
for (const e of ebs) {
  // EB vs EB (other item/set, same repo)
  for (const f of byRepoE[e.repo]) {
    if (f.pack === e.pack) continue;
    if (f.pack < e.pack) continue;
    const n = inter(e.t, f.t); const mn = Math.min(e.t.size, f.t.size);
    if (n >= 7 && n / mn >= 0.5) out.push({ kind: 'EB-EB', score: (n / mn).toFixed(2), n, a: `${e.pack} ${e.id}`, b: `${f.pack} ${f.id}`, at: e.text.slice(0, 160), bt: f.text.slice(0, 160) });
  }
  for (const o of byRepoO[e.repo] || []) {
    const n = inter(e.t, o.t); const mn = Math.min(e.t.size, o.t.size);
    if (n >= 7 && n / mn >= 0.55) out.push({ kind: 'EB-' + o.kind, score: (n / mn).toFixed(2), n, a: `${e.pack} ${e.id}`, b: `${o.kind}:${o.id}`, at: e.text.slice(0, 160), bt: o.text.slice(0, 160) });
  }
}
out.sort((x, y) => y.score - x.score || y.n - x.n);
console.log('EB kps:', ebs.length, 'others:', others.length, 'pairs:', out.length);
const counts = {}; for (const o of out) counts[o.kind] = (counts[o.kind] || 0) + 1; console.log(counts);
for (const o of out.slice(0, 60)) console.log(`\n[${o.kind} ${o.score} n=${o.n}]\n A: ${o.a}\n    ${o.at}\n B: ${o.b}\n    ${o.bt}`);
