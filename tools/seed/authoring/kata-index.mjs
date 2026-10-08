#!/usr/bin/env node
// Builds content/seed/patches/katas-index.json: per shipped kata {key, pack, repo, sha,
// id, title, difficulty, defects, test, findingRef}. Difficulty lives in the authoring
// spec (W5a's PatchesDraft is strict and has no difficulty field). Fails if a shipped
// kata has no spec entry or a spec entry has no shipped kata.
//   node tools/seed/authoring/kata-index.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const packsDir = 'content/seed/patches';
const specsDir = 'tools/seed/authoring/katas';
const specs = new Map();
for (const f of readdirSync(specsDir).filter((f) => f.endsWith('.spec.json')).sort()) {
  const s = JSON.parse(readFileSync(join(specsDir, f), 'utf8'));
  for (const k of s.katas) specs.set(`${s.name}\u0000${k.title}`, { ...k, spec: f });
}
const out = [];
const used = new Set();
for (const name of readdirSync(packsDir).sort()) {
  const items = join(packsDir, name, 'items.json');
  if (!existsSync(items)) continue;
  for (const it of JSON.parse(readFileSync(items, 'utf8')).items) {
    const id = `${name}\u0000${it.title}`;
    const s = specs.get(id);
    if (!s) throw new Error(`no spec entry for shipped kata ${name} :: ${it.title}`);
    used.add(id);
    out.push({
      key: it.key,
      pack: name,
      repo: it.provenance.repo,
      sha: it.provenance.sha,
      id: s.id,
      title: it.title,
      difficulty: s.difficulty,
      defects: it.seededDefectKey.length,
      test: it.test ? 'drill-js' : 'none',
      ...(it.findingRef ? { findingRef: it.findingRef } : {}),
    });
  }
}
for (const id of specs.keys()) if (!used.has(id)) throw new Error(`spec entry without a shipped kata: ${id.replace('\u0000', ' :: ')}`);
const by = out.reduce((a, k) => ((a[k.difficulty] = (a[k.difficulty] ?? 0) + 1), a), {});
writeFileSync(join(packsDir, 'katas-index.json'), `${JSON.stringify({ format: 'bootquest-kata-index@1', counts: { total: out.length, byDifficulty: by, tested: out.filter((k) => k.test !== 'none').length }, katas: out }, null, 1)}\n`);
console.log(`kata-index: ${out.length} katas ${JSON.stringify(by)}, tested ${out.filter((k) => k.test !== 'none').length}`);
