// Seed-session proof printer for patch katas (NOT part of the fingerprinted factory).
//   node --import tsx tools/seed/authoring/kata-proof.ts [content/seed/patches]
// For every shipped kata: re-applies the diff to its context with the factory's own
// applyInTemp (git apply --check + apply in a ceiling-guarded temp dir) and, where the
// kata carries a test, executes it through the factory harness (the server's real
// drill-js grade adapter) on the clean context and on the defective version.
// Prints one verbatim block per kata; exit 1 if anything does not hold.
import { readdirSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { applyInTemp } from '../src/factory/patches/patches.ts';
import { defaultHarness, describeFailures, execute, failsAsVerdict } from '../src/factory/harness/harness.ts';

const root = resolve(process.argv[2] ?? 'content/seed/patches');
const h = defaultHarness();
let bad = 0;
let n = 0;
for (const name of readdirSync(root).sort()) {
  const dir = join(root, name);
  if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'items.json'))) continue;
  const items = JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8')).items as Array<{
    key: string;
    title: string;
    provenance: { repo: string; sha: string };
    diff: string;
    contextFiles: Array<{ path: string; content: string }>;
    seededDefectKey: unknown[];
    test?: { module: string; check: Parameters<typeof execute>[1] };
  }>;
  for (const k of items) {
    if ((k as { kind?: string }).kind !== 'patch-kata') continue;
    n++;
    const files = [...new Set([...k.diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]))];
    const ap = applyInTemp(k.contextFiles, k.diff);
    const lines = [`KATA ${name} :: ${k.title}`, `  key ${k.key} (${k.provenance.repo}@${k.provenance.sha.slice(0, 7)}), ${k.seededDefectKey.length} seeded defect(s)`];
    if (!ap.ok) {
      bad++;
      lines.push(`  APPLY FAILED: ${ap.error}`);
    } else {
      lines.push(`  git apply --check + apply: CLEAN (${files.join(', ')})`);
      if (k.test) {
        const mod = k.test.module;
        const before = k.contextFiles.find((f) => f.path === mod)!.content;
        const after = readFileSync(join(ap.dir, mod), 'utf8');
        const clean = await execute(h, k.test.check, before);
        const defective = await execute(h, k.test.check, after);
        const cleanOk = clean.ok && clean.result.pass;
        const defOk = defective.ok && !defective.result.pass && failsAsVerdict(defective.result).ok;
        lines.push(`  test on clean context: ${clean.ok ? (clean.result.pass ? 'PASS' : `FAIL ${describeFailures(clean.result)}`) : `NOT RUN ${clean.reason}`}`);
        lines.push(`  test on defective version: ${defective.ok ? (defective.result.pass ? 'PASS (should fail!)' : `FAIL -> ${describeFailures(defective.result)}`) : `NOT RUN ${defective.reason}`}`);
        if (!cleanOk || !defOk) bad++;
      } else lines.push('  test: none (no runnable test for this kata)');
    }
    if (ap.dir) rmSync(ap.dir, { recursive: true, force: true });
    console.log(lines.join('\n'));
  }
}
console.log(`kata-proof: ${n} kata(s), ${bad} problem(s), ${h.executions} execution(s)`);
process.exit(bad ? 1 : 0);
