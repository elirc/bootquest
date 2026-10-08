#!/usr/bin/env node
// Seed-session authoring helper (NOT part of the fingerprinted factory): turns a
// human/LLM-written kata SPEC into a seed:patches DRAFT with a machine-generated
// unified diff and line numbers located by exact substring (never typed by hand —
// real files mix CRLF/LF, W5a lesson). The factory validator (seed:patches) is
// still the only judge; this tool only removes hand-arithmetic.
//
//   node tools/seed/authoring/katagen.mjs <spec.json> <out-draft.json>
//
// spec: { name, checkout, katas: [{ id, title, difficulty, findingRef?,
//   provenance: { path, find, span? },
//   contextFiles: [{ path, repoPath, kind: 'verbatim', lines?: {start,end} }
//                 | { path, repoPath, kind: 'adapted', content, lines? }],
//   edits: [{ path, find, replace }],              // each find must occur exactly once
//   defects: [{ scenario, consequence, in: 'patched'|'repo', path, find, span? }],
//   test?: { module, check } }] }
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [specPath, outPath] = process.argv.slice(2);
if (!specPath || !outPath) {
  console.error('usage: katagen.mjs <spec.json> <out-draft.json>');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const fail = (m) => {
  console.error(`katagen: ${m}`);
  process.exit(1);
};

const splitKeep = (t) => t.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const slice = (t, a, b) => splitKeep(t).slice(a - 1, b).join('');

function once(hay, needle, where) {
  const i = hay.indexOf(needle);
  if (i < 0) fail(`${where}: text not found: ${JSON.stringify(needle).slice(0, 120)}`);
  if (hay.indexOf(needle, i + 1) >= 0) fail(`${where}: text occurs more than once: ${JSON.stringify(needle).slice(0, 120)}`);
  return i;
}
function lineOf(hay, needle, where, span) {
  const i = once(hay, needle, where);
  const start = hay.slice(0, i).split('\n').length;
  const own = needle.replace(/\n$/, '').split('\n').length;
  return { start, end: start + Math.max(own, span ?? 1) - 1 };
}

/** One-hunk-per-change-region unified diff (3 lines context); lines keep their own bytes (CR included). */
function unified(path, a, b) {
  const A = splitKeep(a);
  const B = splitKeep(b);
  // regions: walk with a simple LCS on lines (files are small)
  const n = A.length;
  const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    // deletions before insertions on ties, so hunks read '-old' then '+new' like git's
    if (i < n && j < m && A[i] === B[j]) {
      ops.push({ t: ' ', s: A[i] });
      i++;
      j++;
    } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) ops.push({ t: '-', s: A[i++] });
    else ops.push({ t: '+', s: B[j++] });
  }
  // annotate positions
  let ai = 1;
  let bj = 1;
  for (const o of ops) {
    o.a = ai;
    o.b = bj;
    if (o.t !== '+') ai++;
    if (o.t !== '-') bj++;
  }
  const C = 3;
  const changes = ops.map((o, x) => (o.t === ' ' ? -1 : x)).filter((x) => x >= 0);
  const groups = [];
  for (const c of changes) {
    const g = groups[groups.length - 1];
    if (g && c - g.last - 1 <= 2 * C) g.last = c;
    else groups.push({ first: c, last: c });
  }
  const hunks = groups.map((g) => ({ start: Math.max(0, g.first - C), end: Math.min(ops.length - 1, g.last + C) }));
  let out = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;
  for (const h of hunks) {
    const seg = ops.slice(h.start, h.end + 1);
    const aLen = seg.filter((o) => o.t !== '+').length;
    const bLen = seg.filter((o) => o.t !== '-').length;
    const aStart = seg[0].a - (aLen === 0 ? 1 : 0);
    const bStart = seg[0].b - (bLen === 0 ? 1 : 0);
    out += `@@ -${aStart},${aLen} +${bStart},${bLen} @@\n`;
    for (const o of seg) {
      out += o.t + o.s;
      if (!o.s.endsWith('\n')) out += '\n\\ No newline at end of file\n';
    }
  }
  return out;
}

const katas = [];
const index = [];
for (const k of spec.katas) {
  const where = `kata ${k.id}`;
  const guide = readFileSync(join(spec.checkout, k.provenance.path), 'utf8');
  const provLines = k.provenance.lines ?? lineOf(guide, k.provenance.find, `${where} provenance`, k.provenance.span);
  const ctx = new Map();
  const contextFiles = k.contextFiles.map((f) => {
    let content;
    if (f.kind === 'verbatim') {
      const t = readFileSync(join(spec.checkout, f.repoPath), 'utf8');
      content = f.lines ? slice(t, f.lines.start, f.lines.end) : t;
    } else content = f.content;
    ctx.set(f.path, content);
    const origin = { kind: f.kind, repoPath: f.repoPath, ...(f.lines ? { lines: f.lines } : {}) };
    return f.kind === 'verbatim' ? { path: f.path, origin } : { path: f.path, content, origin };
  });
  const patched = new Map(ctx);
  for (const e of k.edits) {
    const cur = patched.get(e.path);
    if (cur === undefined) fail(`${where}: edit targets ${e.path}, not a context file`);
    // CRLF files: let edits be written with \n and re-expand when the file is CRLF at that spot
    let find = e.find;
    let replace = e.replace;
    if (!cur.includes(find) && cur.includes(find.replace(/\n/g, '\r\n'))) {
      find = find.replace(/\n/g, '\r\n');
      replace = replace.replace(/\n/g, '\r\n');
    }
    const i = once(cur, find, `${where} edit ${e.path}`);
    patched.set(e.path, cur.slice(0, i) + replace + cur.slice(i + find.length));
  }
  let diff = '';
  for (const [p, before] of ctx) {
    const after = patched.get(p);
    if (after !== before) diff += unified(p, before, after);
  }
  if (!diff) fail(`${where}: edits change nothing`);
  const seededDefectKey = k.defects.map((d, n) => {
    let text;
    if (d.in === 'patched') {
      text = patched.get(d.path);
      if (text === undefined) fail(`${where} defect ${n + 1}: ${d.path} not a context file`);
    } else text = readFileSync(join(spec.checkout, d.path), 'utf8');
    let l;
    if (d.lines) {
      // explicit lines (a repeated snippet): still prove the snippet is on the first line
      const first = splitKeep(text)[d.lines.start - 1] ?? '';
      if (d.find && !first.includes(d.find.split('\n')[0])) fail(`${where} defect ${n + 1}: line ${d.lines.start} of ${d.path} does not contain ${JSON.stringify(d.find).slice(0, 80)}`);
      l = d.lines;
    } else {
      let find = d.find;
      if (!text.includes(find) && text.includes(find.replace(/\n/g, '\r\n'))) find = find.replace(/\n/g, '\r\n');
      l = lineOf(text, find, `${where} defect ${n + 1} (${d.in})`, d.span);
    }
    return { scenario: d.scenario, evidence: { path: d.path, lineStart: l.start, lineEnd: l.end, in: d.in }, consequence: d.consequence };
  });
  katas.push({
    id: k.id,
    title: k.title,
    ...(k.findingRef ? { findingRef: k.findingRef } : {}),
    provenance: { path: k.provenance.path, lines: { start: provLines.start, end: provLines.end } },
    diff,
    contextFiles,
    seededDefectKey,
    ...(k.test ? { test: k.test } : {}),
  });
  index.push({ id: k.id, difficulty: k.difficulty, defects: seededDefectKey.length, test: !!k.test });
}
writeFileSync(outPath, `${JSON.stringify({ name: spec.name, katas }, null, 1)}\n`);
console.log(`katagen: wrote ${katas.length} kata draft(s) to ${outPath}`);
for (const x of index) console.log(`  ${x.id} [${x.difficulty}] defects=${x.defects} test=${x.test}`);
