// usage: node dossier.mjs <selfboot-or-clone-root> <repo> [--cites] [--out <file>] [--grep <regex>] [--keys <W/keys dir>]
//
// Prints EVERYTHING the estate says about one upstream repo, for the T4 hand xleak check (both ages, both directions):
//   - every explain-back item on the repo: classic, set-B/C, sysdesign (DESIGN IT / fundamentals), G2 briefs
//     (each prompt + each key point, with its quote / cite; --cites inlines the cited code from .cache/checkouts)
//   - every quest pack item on the repo: quiz (prompt + KEYED ANSWER), flashcard (front + BACK), reading steps (titles)
//   - every learn-more note on the repo (full body)
//   - every patch kata on the repo (title + seededDefectKey + finding ref)
//   - with --keys <dir>: every in-flight wave keys file whose NAME contains the repo (lines prefixed WAVEKEY:<file>)
// Items are matched by provenance.repo (NOT by folder name: e.g. quest pack relay-app has repo relay-app, G2 relay has repo relay).
// Each line is prefixed with a stable id: EB:<pack>:qX.kpY, QUIZ:<pack>:<hash16>, FC:<pack>:<hash16>, NOTE:<pack>:<noteId>, KATA:<pack>:<hash16>.
// --grep <regex> keeps only lines (case-insensitive) matching the regex, still with their ids — handy for "does anything already say X?".
// Read-only: never writes inside <root>. Default output is stdout; --out writes a file (put it in the scratchpad).
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const out = flag('--out');
const grep = flag('--grep');
const withCites = has('--cites');
const keysDir = flag('--keys');
const [ROOT, repo] = args;
if (!ROOT || !repo) { console.error('usage: node dossier.mjs <selfboot-or-clone-root> <repo> [--cites] [--out <file>] [--grep <regex>] [--keys <W/keys dir>]'); process.exit(2); }
const SEED = path.join(ROOT, 'content/seed');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const itemsOf = (dir) => { const p = path.join(dir, 'items.json'); if (!fs.existsSync(p)) return []; const j = readJson(p); return Array.isArray(j) ? j : (j.items || []); };
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const short = (k) => String(k).split('/').pop();
const lines = [];
const push = (s) => lines.push(s);

function citeText(c, sha) {
  if (!withCites || !c?.path) return '';
  const co = path.join(ROOT, '.cache/checkouts', `${repo}@${sha}`);
  const p = path.join(co, c.path);
  if (!fs.existsSync(p)) return `\n      !! cite file missing at pin: ${c.path}`;
  const L = fs.readFileSync(p, 'utf8').split('\n');
  let s = '';
  if (c.lineEnd > L.length) s += `\n      !! lineEnd ${c.lineEnd} > ${L.length}`;
  for (let i = c.lineStart; i <= Math.min(c.lineEnd, L.length); i++) s += `\n      ${i}: ${L[i - 1]}`;
  return s;
}

// ---- explain-backs (classic, set-B/C, sysdesign, g2)
push(`# DOSSIER ${repo}  (root ${ROOT})`);
push('');
push('## EXPLAIN-BACK / DESIGN IT / G2 items');
const ebRoot = path.join(SEED, 'explainback');
for (const d of fs.readdirSync(ebRoot).sort()) {
  const items = itemsOf(path.join(ebRoot, d)).filter((i) => i.provenance?.repo === repo);
  for (const it of items) {
    push(`### ${d}  (${it.key}; unit ${it.provenance.path}@${String(it.provenance.sha).slice(0, 8)})`);
    (it.questions || []).forEach((q, qi) => {
      push(`EB:${d}:q${qi + 1}.prompt ${flat(q.prompt)}`);
      (q.keyPoints || []).forEach((kp, ki) => {
        let s = `EB:${d}:q${qi + 1}.kp${ki + 1} ${flat(kp.text)}`;
        if (kp.quote) s += `  [quote: "${flat(kp.quote)}"]`;
        if (kp.cite) s += `  [cite ${kp.cite.path}:${kp.cite.lineStart}-${kp.cite.lineEnd}]` + citeText(kp.cite, it.provenance.sha);
        push(s);
      });
    });
    push('');
  }
}

// ---- quest packs (quiz, flashcards, reading steps)
push('## QUEST PACK items (quiz keyed answers, flashcard backs)');
const qRoot = path.join(SEED, 'quests');
for (const d of fs.readdirSync(qRoot).sort()) {
  const items = itemsOf(path.join(qRoot, d)).filter((i) => i.provenance?.repo === repo);
  if (!items.length) continue;
  push(`### quests/${d}`);
  for (const x of items) {
    if (x.kind === 'quiz') {
      const ch = x.check?.choices || (x.choices || []).map((c) => c.text);
      push(`QUIZ:${d}:${short(x.key)} ${flat(x.prompt)}  => ANSWER: ${flat(ch[x.check?.answerKey])}`);
      push(`  (distractors: ${ch.filter((_, i) => i !== x.check?.answerKey).map(flat).join(' | ')})`);
    } else if (x.kind === 'flashcard') {
      push(`FC:${d}:${short(x.key)} ${flat(x.front)}  => BACK: ${flat(typeof x.back === 'string' ? x.back : JSON.stringify(x.back))}`);
    } else if (x.kind === 'reading-step') {
      push(`READ:${d}:${short(x.key)} ${flat(x.title)} (${x.provenance.path})`);
    } else {
      push(`${String(x.kind).toUpperCase()}:${d}:${short(x.key)} ${flat(x.title || x.prompt || x.front || '')}`);
    }
  }
  push('');
}

// ---- notes
push('## NOTES');
const nRoot = path.join(SEED, 'notes');
if (fs.existsSync(nRoot)) for (const d of fs.readdirSync(nRoot).sort()) {
  const items = itemsOf(path.join(nRoot, d)).filter((i) => i.provenance?.repo === repo);
  if (!items.length) continue;
  push(`### notes/${d}`);
  for (const n of items) push(`NOTE:${d}:${n.noteId} [${n.phase}${n.target ? ' -> ' + short(n.target) : ''}] ${flat(n.title)}: ${flat(n.body)}`);
  push('');
}

// ---- patch katas
push('## PATCH KATAS');
const pRoot = path.join(SEED, 'patches');
if (fs.existsSync(pRoot)) for (const d of fs.readdirSync(pRoot).sort()) {
  const full = path.join(pRoot, d);
  if (!fs.statSync(full).isDirectory()) continue;
  const items = itemsOf(full).filter((i) => i.provenance?.repo === repo);
  if (!items.length) continue;
  push(`### patches/${d}`);
  for (const k of items) push(`KATA:${d}:${short(k.key)} ${flat(k.title)}  [defect ${k.seededDefectKey ?? '-'}; finding ${flat(typeof k.findingRef === 'string' ? k.findingRef : JSON.stringify(k.findingRef ?? ''))}]`);
  push('');
}

// ---- in-flight wave keys (other streams' published keys files whose name contains the repo)
if (keysDir && fs.existsSync(keysDir)) {
  push('## IN-FLIGHT WAVE KEYS (' + keysDir + ')');
  for (const f of fs.readdirSync(keysDir).sort().filter((f) => f.includes(repo))) {
    push('### keys/' + f);
    for (const l of fs.readFileSync(path.join(keysDir, f), 'utf8').split(/\r?\n/)) if (l.trim()) push('WAVEKEY:' + f + ' ' + l.trim());
  }
  push('');
}

let text = lines;
if (grep) { const re = new RegExp(grep, 'i'); text = lines.filter((l) => l.startsWith('#') ? false : re.test(l)); }
const body = text.join('\n') + '\n';
if (out) { fs.writeFileSync(out, body); console.error(`wrote ${out} (${text.length} lines)`); } else process.stdout.write(body);
