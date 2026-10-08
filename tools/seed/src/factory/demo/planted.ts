// npm run seed:demo:planted
// Runs every seed generator's REAL CLI against planted-bad inputs and asserts each
// exits nonzero with the right reason (plus positive controls that must exit 0).
// Planted secret-bearing files are materialized only in temp dirs, from a pattern
// assembled at runtime — no token-shaped string is ever committed.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from '../report.ts';
import { FIXTURES as FX, plantAndie } from './plant.ts';

const D = join(FX, 'drafts');
const WW6_SHA = '09751ceaee909a30e5c4b5ff5cdde99880b9a3e5';
const CLI = (g: string) => join(REPO_ROOT, 'tools', 'seed', 'src', 'factory', g, 'cli.ts');

interface Case {
  id: string;
  what: string;
  gen: string;
  args: string[];
  /** expected exit: 'nonzero' for planted-bad, 0 for positive controls */
  exit: 'nonzero' | 0;
  /** every substring must appear in the output */
  expect: string[];
}

function run(c: Case): { code: number; out: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', CLI(c.gen), ...c.args], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

async function main(): Promise<number> {
  const tmp = mkdtempSync(join(tmpdir(), 'bq-planted-'));
  const out = (n: string) => join(tmp, 'out', n);
  try {
    const andie = plantAndie(tmp, 'andie');
    const notAndie = plantAndie(tmp, 'notandie');
    // a stamped good pack + a checkout for the seed:check cases
    const seedDir = join(tmp, 'seed');
    const checkouts = join(tmp, 'checkouts');
    mkdirSync(checkouts, { recursive: true });
    cpSync(join(FX, 'ww6'), join(checkouts, `ww6@${WW6_SHA}`), { recursive: true });
    const goodPack = join(seedDir, 'quests', 'ww6');
    const tampered = join(tmp, 'seed-tampered');
    const forged = join(tmp, 'seed-forged');

    const quests = (args: string[]) => args;
    const cases: Case[] = [
      { id: 'Q1', what: 'quests: unresolvable citations (P4 CORRUPTED-REVIEW.md)', gen: 'quests', args: quests([join(REPO_ROOT, 'tools/seed/src/citations/fixtures/ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--guides', 'astraupskill/CORRUPTED-REVIEW.md', '--out', out('q1')]), exit: 'nonzero', expect: ['QUARANTINED', '-> line-out-of-range', '-> missing-file', '-> ambiguous-suffix', 'STAMP none'] },
      { id: 'Q2', what: 'quests: multi-keyed quiz (two exercises share a Check)', gen: 'quests', args: [join(FX, 'planted', 'multikey'), '--sha', 'deadbeefcafe', '--repo', 'planted-multikey', '--out', out('q2')], exit: 'nonzero', expect: ['ambiguous: choices', '(near-)duplicates'] },
      { id: 'Q3', what: 'quests: explicit ingestion of andie VERIFICATION.md (registry: leaked-secret)', gen: 'quests', args: [andie, '--sha', 'deadbeefcafe', '--guides', 'astraupskill/VERIFICATION.md', '--out', out('q3')], exit: 'nonzero', expect: ['REFUSED requested guide astraupskill/VERIFICATION.md is excluded:andie-verification-token (leaked-secret)'] },
      { id: 'Q4', what: 'quests: same token file in an UNREGISTERED repo', gen: 'quests', args: [notAndie, '--sha', 'deadbeefcafe', '--out', out('q4')], exit: 'nonzero', expect: ['UNREGISTERED SECRET', 'shopify-token', 'astraupskill/VERIFICATION.md'] },
      { id: 'Q5', what: 'quests: whole-repo exclusion (z8 date-bounded, not cleared)', gen: 'quests', args: [join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'z8', '--out', out('q5')], exit: 'nonzero', expect: ['REFUSED repo z8 is excluded:z8-test-time-bomb (expiring-tests)'] },
      { id: 'Q+', what: 'quests: andie discovery run (positive control: file skipped, citing item dropped, both counted)', gen: 'quests', args: [andie, '--sha', 'deadbeefcafe', '--out', out('qpos')], exit: 0, expect: ['SKIP astraupskill/VERIFICATION.md: excluded:andie-verification-token (leaked-secret)', 'DROPPED', 'cites astraupskill/VERIFICATION.md: excluded:andie-verification-token', 'RESULT OK'] },
      { id: 'E1', what: 'explainback: key point quoting nothing', gen: 'explainback', args: ['docs/learning/testing-rationale.md', '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--draft', join(D, 'planted-explainback-quotes-nothing.json'), '--out', out('e1')], exit: 'nonzero', expect: ['q1.kp2 quote is not in the source'] },
      { id: 'E2', what: 'explainback: key point with neither quote nor cite', gen: 'explainback', args: ['docs/learning/testing-rationale.md', '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--draft', join(D, 'planted-explainback-no-evidence.json'), '--out', out('e2')], exit: 'nonzero', expect: ['q3.kp1 neither quotes nor cites the source'] },
      { id: 'E3', what: 'explainback: wrong counts (2 questions, 4 points)', gen: 'explainback', args: ['docs/learning/testing-rationale.md', '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--draft', join(D, 'planted-explainback-wrong-counts.json'), '--out', out('e3')], exit: 'nonzero', expect: ['needs exactly 3 questions, got 2', 'question 2 has 4 key points'] },
      { id: 'E4', what: 'explainback: duplicate key points', gen: 'explainback', args: ['docs/learning/testing-rationale.md', '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--draft', join(D, 'planted-explainback-duplicate-points.json'), '--out', out('e4')], exit: 'nonzero', expect: ['duplicate key points: q1.kp1 ~ q3.kp5'] },
      { id: 'E5', what: 'explainback: cite past end of file', gen: 'explainback', args: ['docs/learning/testing-rationale.md', '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--draft', join(D, 'planted-explainback-bad-cite.json'), '--out', out('e5')], exit: 'nonzero', expect: ['q2.kp5 cite src/services/allocationRunService.ts:900-910 -> line-out-of-range'] },
      { id: 'V1', what: 'variants: deliberately wrong solution that PASSES', gen: 'variants', args: [join(D, 'planted-variants-wrong-passes.json'), '--out', out('v1')], exit: 'nonzero', expect: ['wrong-solution filter: the deliberately wrong solution PASSES the test'] },
      { id: 'V2', what: 'variants: reference that fails its own test', gen: 'variants', args: [join(D, 'planted-variants-ref-fails.json'), '--out', out('v2')], exit: 'nonzero', expect: ['the test does not PASS the reference solution under the real runner'] },
      { id: 'V3', what: 'variants: wrong solution that only fails by not loading', gen: 'variants', args: [join(D, 'planted-variants-wrong-crashes.json'), '--out', out('v3')], exit: 'nonzero', expect: ['fails only without a test verdict (code loads without errors)'] },
      { id: 'V4', what: 'variants: drill-cs item with no runner registered', gen: 'variants', args: [join(D, 'planted-variants-no-runner.json'), '--out', out('v4')], exit: 'nonzero', expect: ['no runner registered for drill-cs (no execution = no emission)'] },
      { id: 'P1', what: 'patches: kata with an empty defect key', gen: 'patches', args: [join(D, 'planted-patches-empty-key.json'), '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--out', out('p1')], exit: 'nonzero', expect: ['seeded-defect key is empty'] },
      { id: 'P2', what: 'patches: diff that does not apply', gen: 'patches', args: [join(D, 'planted-patches-no-apply.json'), '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--out', out('p2')], exit: 'nonzero', expect: ['diff does not apply cleanly to the context'] },
      { id: 'P3', what: 'patches: test that passes on the defective version', gen: 'patches', args: [join(D, 'planted-patches-test-passes-defect.json'), '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--out', out('p3')], exit: 'nonzero', expect: ['the test PASSES on the defective version'] },
      { id: 'P4', what: 'patches: defect evidence past end of file', gen: 'patches', args: [join(D, 'planted-patches-bad-evidence.json'), '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--out', out('p4')], exit: 'nonzero', expect: ['evidence src/services/allocationEngineService.ts:400-401 (repo) -> line-out-of-range'] },
      { id: 'C0', what: 'seed:quests writes a good pack for the seed:check cases (positive control)', gen: 'quests', args: [join(checkouts, `ww6@${WW6_SHA}`), '--sha', WW6_SHA, '--guides', 'astraupskill/05-PRACTICE.md,astraupskill/06-SOLUTIONS-AND-REVIEW.md', '--out', goodPack], exit: 0, expect: ['STAMP written', 'RESULT OK'] },
    ];

    let failed = 0;
    const record = (c: Case, code: number, outText: string) => {
      const exitOk = c.exit === 'nonzero' ? code !== 0 : code === 0;
      const missing = c.expect.filter((e) => !outText.includes(e));
      const ok = exitOk && missing.length === 0;
      if (!ok) failed++;
      const reason = outText.split('\n').find((l) => c.expect[0] && l.includes(c.expect[0])) ?? '';
      console.log(`[${ok ? 'PASS' : 'FAIL'}] ${c.id} ${c.what} -> exit ${code}${c.exit === 'nonzero' ? ' (want nonzero)' : ' (want 0)'}`);
      console.log(`       reason: ${reason.trim().slice(0, 300)}`);
      if (!ok) {
        if (missing.length) console.log(`       MISSING: ${missing.join(' | ')}`);
        console.log(outText.split('\n').slice(-15).map((l) => `       > ${l}`).join('\n'));
      }
    };
    for (const c of cases) {
      const r = run(c);
      record(c, r.code, r.out);
    }

    // seed:check: clean (exit 0), tampered items (nonzero), forged stamp (nonzero)
    const check = (id: string, what: string, dir: string, exit: 'nonzero' | 0, expect: string[]) => {
      const r = spawnSync(process.execPath, ['--import', 'tsx', CLI('check'), '--dir', dir, '--checkouts', checkouts], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true, timeout: 180000 });
      record({ id, what, gen: 'check', args: [], exit, expect }, r.status ?? -1, `${r.stdout ?? ''}${r.stderr ?? ''}`);
    };
    check('K0', 'seed:check over the good pack (positive control)', seedDir, 0, ['OK ', 'RESULT OK']);
    cpSync(seedDir, tampered, { recursive: true });
    const itemsPath = join(tampered, 'quests', 'ww6', 'items.json');
    writeFileSync(itemsPath, readFileSync(itemsPath, 'utf8').replace('"back": "', '"back": "EDITED '));
    check('K1', 'seed:check: items.json edited after stamping', tampered, 'nonzero', ['items.json sha256 != manifest', 'RESULT FAIL']);
    cpSync(seedDir, forged, { recursive: true });
    const stampPath = join(forged, 'quests', 'ww6', 'validation.json');
    writeFileSync(stampPath, readFileSync(stampPath, 'utf8').replace(/"fingerprint": "[0-9a-f]{64}"/, `"fingerprint": "${'0'.repeat(64)}"`));
    check('K2', 'seed:check: stamp from another validator/fingerprint', forged, 'nonzero', ['stale/invalid stamp', 'seed fingerprint 000000000000', 'RESULT FAIL']);

    const total = cases.length + 3;
    console.log(`[seed:demo:planted] ${total - failed}/${total} cases behaved as required`);
    console.log(`RESULT ${failed === 0 ? 'OK' : 'FAIL'}`);
    return failed === 0 ? 0 : 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(
  (c) => process.exit(c),
  (err: unknown) => {
    console.error(`[seed:demo:planted] CRASHED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  },
);
