#!/usr/bin/env node
// rv3 S4 (W7 / F10): builds content/seed/kata-flags.json, the side file that carries the two kata
// fields seed:patches cannot (its draft schema is strict and lives in the bound factory):
//   clean: true   the PR has no defect; the right verdict is "approve". The factory refuses an empty
//                 seeded-defect key (patches.ts), so a clean kata's key holds ONE `in: 'repo'` entry:
//                 the shipped defect the PR fixes, never a defect of the PR. G1 counts patched-line
//                 defects only, so that entry adds nothing to G1 totals.
//   decoys        nit-only lines of the patched files (a rename, a reworded comment, an equivalent
//                 expression): a finding on one of them is a false positive.
// Source of truth: the `clean` / `decoys` fields of tools/seed/authoring/katas/*.spec.json (katagen
// ignores them). Decoy line numbers are located by exact substring in the PATCHED file, like katagen's
// defect lines. Fails if a decoy is not an added line of the diff, overlaps a patched defect, or a flagged
// spec kata has no shipped item.
//   node tools/seed/authoring/katas/kata-flags.mjs [--check]
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const specsDir = 'tools/seed/authoring/katas';
const packsDir = 'content/seed/patches';
const out = 'content/seed/kata-flags.json';
const check = process.argv.includes('--check');
const fail = (m) => {
  console.error(`kata-flags: ${m}`);
  process.exit(1);
};
const h12 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const slug = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '-');
const splitKeep = (t) => t.match(/[^\n]*\n|[^\n]+$/g) ?? [];

function once(hay, needle, where) {
  const i = hay.indexOf(needle);
  if (i < 0) fail(`${where}: text not found: ${JSON.stringify(needle).slice(0, 120)}`);
  if (hay.indexOf(needle, i + 1) >= 0) fail(`${where}: text occurs more than once: ${JSON.stringify(needle).slice(0, 120)}`);
  return i;
}
function lineOf(hay, needle, where) {
  const i = once(hay, needle, where);
  const start = hay.slice(0, i).split('\n').length;
  return { start, end: start + needle.replace(/\n$/, '').split('\n').length - 1 };
}
/** b-side line numbers the diff adds, per file */
function addedLines(diff) {
  const m = new Map();
  let file = null;
  let b = 0;
  for (const l of diff.split('\n')) {
    const f = /^\+\+\+ b\/(.+?)\r?$/.exec(l);
    if (f) {
      file = f[1];
      m.set(file, new Set());
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) {
      b = Number(h[1]);
      continue;
    }
    if (!file || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('\\')) continue;
    if (l.startsWith('+')) m.get(file).add(b++);
    else if (l.startsWith(' ')) b++;
  }
  return m;
}

const flags = {};
let clean = 0;
let decoyKatas = 0;
let decoyLines = 0;
for (const f of readdirSync(specsDir).filter((x) => x.endsWith('.spec.json')).sort()) {
  const spec = JSON.parse(readFileSync(join(specsDir, f), 'utf8'));
  const flagged = spec.katas.filter((k) => k.clean === true || (k.decoys && k.decoys.length));
  if (!flagged.length) continue;
  const itemsPath = join(packsDir, spec.name, 'items.json');
  if (!existsSync(itemsPath)) fail(`${f}: pack ${spec.name} is not built (run katas-build.mjs)`);
  const items = JSON.parse(readFileSync(itemsPath, 'utf8')).items;
  for (const k of flagged) {
    const where = `${f} kata ${k.id}`;
    const it = items.find((x) => x.title === k.title);
    if (!it) fail(`${where}: no shipped item titled ${JSON.stringify(k.title)}`);
    if (k.clean === true && k.decoys?.length) fail(`${where}: a clean kata has no decoys (nothing in it is wrong)`);
    const entry = { unitKey: `ladder/kata/${slug(it.provenance.repo)}/${h12(it.key)}`, pack: spec.name, title: it.title, pattern: k.agentPattern ?? null };
    if (k.clean === true) {
      const patched = it.seededDefectKey.filter((d) => d.evidence.in === 'patched');
      if (patched.length || it.seededDefectKey.length !== 1) fail(`${where}: a clean kata carries exactly one in:'repo' key entry (the defect the PR fixes), found ${it.seededDefectKey.length} entries, ${patched.length} patched`);
      if (it.test) fail(`${where}: a clean kata cannot carry a test (the factory requires it to FAIL on the patched version)`);
      flags[it.key] = { ...entry, clean: true, note: "the one key entry (in: 'repo') is the shipped defect this PR fixes, not a defect of the PR: approve" };
      clean++;
      continue;
    }
    // patched text = shipped context + the spec's edits (the same edits katagen turned into the diff)
    const patched = new Map(it.contextFiles.map((c) => [c.path, c.content]));
    for (const e of k.edits) {
      const cur = patched.get(e.path);
      let find = e.find;
      let replace = e.replace;
      if (!cur.includes(find) && cur.includes(find.replace(/\n/g, '\r\n'))) {
        find = find.replace(/\n/g, '\r\n');
        replace = replace.replace(/\n/g, '\r\n');
      }
      const i = once(cur, find, `${where} edit ${e.path}`);
      patched.set(e.path, cur.slice(0, i) + replace + cur.slice(i + find.length));
    }
    const added = addedLines(it.diff);
    const decoys = k.decoys.map((d, n) => {
      const text = patched.get(d.path);
      if (text === undefined) fail(`${where} decoy ${n + 1}: ${d.path} is not a context file`);
      let find = d.find;
      if (!text.includes(find) && text.includes(find.replace(/\n/g, '\r\n'))) find = find.replace(/\n/g, '\r\n');
      const l = lineOf(text, find, `${where} decoy ${n + 1}`);
      for (let x = l.start; x <= l.end; x++) if (!added.get(d.path)?.has(x)) fail(`${where} decoy ${n + 1}: ${d.path}:${x} is not a line the diff adds`);
      for (const def of it.seededDefectKey) {
        if (def.evidence.in !== 'patched' || def.evidence.path !== d.path) continue;
        if (l.start <= def.evidence.lineEnd && def.evidence.lineStart <= l.end) fail(`${where} decoy ${n + 1}: ${d.path}:${l.start}-${l.end} overlaps a seeded defect (${def.evidence.lineStart}-${def.evidence.lineEnd})`);
      }
      if (splitKeep(text)[l.start - 1] === undefined) fail(`${where} decoy ${n + 1}: line ${l.start} out of range`);
      return { path: d.path, lineStart: l.start, lineEnd: l.end, in: 'patched', why: d.why };
    });
    flags[it.key] = { ...entry, decoys };
    decoyKatas++;
    decoyLines += decoys.length;
  }
}
const body = {
  format: 'bootquest-kata-flags@1',
  _note:
    "rv3 S4 (PLAN §1 ruling 6, W7/W9): kata fields seed:patches cannot carry (its draft schema is strict, factory is bound). Keyed by the seed kata key. clean: the PR has no defect and the right verdict is approve; its one seeded-defect entry is in: 'repo' (the shipped defect the PR fixes), so it adds nothing to G1. decoys: nit-only lines of the patched files; a finding there is a false positive. Built by tools/seed/authoring/katas/kata-flags.mjs from the specs; server-local side file, never stamped. Read by the server only after rv3 S5 W9 lands.",
  counts: { clean, decoyKatas, decoyLines },
  katas: Object.fromEntries(Object.entries(flags).sort(([a], [b]) => a.localeCompare(b))),
};
const text = `${JSON.stringify(body, null, 1)}\n`;
if (check) {
  const cur = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (cur !== text) fail(`${out} is stale: re-run node tools/seed/authoring/katas/kata-flags.mjs`);
  console.log(`kata-flags: ${out} up to date (${clean} clean, ${decoyKatas} decoy kata(s), ${decoyLines} decoy line(s))`);
} else {
  writeFileSync(out, text);
  console.log(`kata-flags: wrote ${out} (${clean} clean, ${decoyKatas} decoy kata(s), ${decoyLines} decoy line(s))`);
}
