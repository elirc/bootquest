#!/usr/bin/env node
// Rebuild every kata pack from its committed spec: katagen -> draft -> seed:patches
// (the factory validator decides; a non-OK result fails this script).
//   node tools/seed/authoring/katas-build.mjs [spec-basename ...]
// Checkouts are expected at the spec's `checkout` (.cache/checkouts/<repo>@<sha>).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

const dir = 'tools/seed/authoring/katas';
const only = process.argv.slice(2);
const specs = readdirSync(dir)
  .filter((f) => f.endsWith('.spec.json') && (only.length === 0 || only.includes(f) || only.includes(f.replace('.spec.json', ''))))
  .sort();
let bad = 0;
for (const f of specs) {
  const spec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const draft = join(dir, f.replace('.spec.json', '.draft.json'));
  const m = /^(.+)@([0-9a-f]{40})$/.exec(basename(spec.checkout));
  if (!m) throw new Error(`${f}: checkout must end in <repo>@<sha40>`);
  const [, repo, sha] = m;
  const gen = spawnSync(process.execPath, ['tools/seed/authoring/katagen.mjs', join(dir, f), draft], { encoding: 'utf8' });
  if (gen.status !== 0) {
    bad++;
    console.log(`FAIL ${f}: katagen: ${gen.stderr.trim()}`);
    continue;
  }
  rmSync(join('content/seed/patches', spec.name), { recursive: true, force: true });
  const run = spawnSync('npm', ['run', '-s', 'seed:patches', '--', draft, '--checkout', spec.checkout, '--sha', sha, '--repo', repo], { encoding: 'utf8', shell: process.platform === 'win32' });
  const tail = `${run.stdout}${run.stderr}`.trim().split('\n').filter((l) => /^(COUNTS|EXECUTIONS|RESULT|  QUARANTINED|  DROPPED|REFUSED)/.test(l));
  if (run.status !== 0) bad++;
  console.log(`${run.status === 0 ? 'OK  ' : 'FAIL'} ${spec.name} (${repo}@${sha.slice(0, 7)})\n  ${tail.join('\n  ')}`);
}
console.log(`katas-build: ${specs.length} spec(s), ${bad} failure(s)`);
process.exit(bad ? 1 : 0);
