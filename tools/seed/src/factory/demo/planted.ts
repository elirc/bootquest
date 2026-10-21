// npm run seed:demo:planted
// Runs every seed generator's REAL CLI against planted-bad inputs and asserts each
// exits nonzero with the right reason (plus positive controls that must exit 0).
// Planted secret-bearing files are materialized only in temp dirs, from a pattern
// assembled at runtime — no token-shaped string is ever committed.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { SEED_PACK_FORMAT, SeedPackManifest, SeedValidationStamp, type SeedItem, type SeedQuizItem } from '@bootquest/shared';
import { packRunners, seedFingerprint, seedToolchain } from '../fingerprint.ts';
import { REPO_ROOT } from '../report.ts';
import { sha256, stableJson } from '../util.ts';
import { FIXTURES as FX, plantAndie, plantedToken } from './plant.ts';

const D = join(FX, 'drafts');
const WW6_SHA = '09751ceaee909a30e5c4b5ff5cdde99880b9a3e5';
const CLI = (g: string) => join(REPO_ROOT, 'tools', 'seed', 'src', 'factory', g, 'cli.ts');
const DRAFTS_CLI = join(REPO_ROOT, 'tools', 'seed', 'src', 'drafts', 'cli.ts');

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

/**
 * The fixture checkouts have no git mirror (pin caller-asserted): the demo's CLIs run with the writers'
 * explicit fixtures escape hatch, except the U1 case that proves the hatch is needed.
 */
const FIXTURE_ENV: NodeJS.ProcessEnv = { ...process.env, BOOTQUEST_SEED_ALLOW_UNVERIFIED_PIN: '1' };
const STRICT_ENV: NodeJS.ProcessEnv = (() => {
  const e = { ...process.env };
  delete e.BOOTQUEST_SEED_ALLOW_UNVERIFIED_PIN;
  return e;
})();

function run(c: Case, env: NodeJS.ProcessEnv = FIXTURE_ENV): { code: number; out: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', CLI(c.gen), ...c.args], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true, timeout: 180000, env });
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
    const notes = (draft: string, o: string) => [join(checkouts, `ww6@${WW6_SHA}`), '--draft', join(D, draft), '--quests', join(seedDir, 'quests'), '--out', o];
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
      // V4: the CLI registers the C# runner since campaign 2 (41b858c), so "no runner registered" is
      // unreachable here; that refusal is unit-tested with an injected harness (variants.test.ts). Through
      // the CLI the same planted item (a JS reference under drill-cs) must still be executed, fail, and emit nothing.
      { id: 'V4', what: 'variants: drill-cs item whose reference cannot pass under the real C# runner', gen: 'variants', args: [join(D, 'planted-variants-no-runner.json'), '--out', out('v4')], exit: 'nonzero', expect: ['runners: drill-js, drill-cs, drill-java', 'the test does not PASS the reference solution under the real runner', 'STAMP none'] },
      // drill-java (the Java runner, javabootcamp harness, .cache/factory-java): the same filter, really executed
      { id: 'V5', what: 'variants: drill-java item whose deliberately wrong solution PASSES (the test never probes the boundary)', gen: 'variants', args: [join(D, 'planted-variants-java-wrong-passes.json'), '--out', out('v5')], exit: 'nonzero', expect: ['wrong-solution filter: the deliberately wrong solution PASSES the test', 'runners: drill-js, drill-cs, drill-java', 'STAMP none'] },
      // review java-harness E1: an UnsupportedOperationException("TODO") stub is reported as todo, not a failed assertion
      { id: 'V6', what: 'variants: drill-java "wrong solution" that is the untouched TODO stub (fails only as todo)', gen: 'variants', args: [join(D, 'planted-variants-java-todo-stub.json'), '--out', out('v6')], exit: 'nonzero', expect: ['wrong-solution filter: the wrong solution fails only as todo / not executed', 'runners: drill-js, drill-cs, drill-java', 'STAMP none'] },
      { id: 'VJ+', what: 'variants: drill-java reference passes, wrong solution fails a named test (positive control)', gen: 'variants', args: [join(D, 'variants-java-signalpost-U01.json'), '--out', out('vjpos')], exit: 0, expect: ['STAMP written', 'runners: drill-js, drill-cs, drill-java', 'RESULT OK'] },
      { id: 'P1', what: 'patches: kata with an empty defect key', gen: 'patches', args: [join(D, 'planted-patches-empty-key.json'), '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--out', out('p1')], exit: 'nonzero', expect: ['seeded-defect key is empty'] },
      { id: 'P2', what: 'patches: diff that does not apply', gen: 'patches', args: [join(D, 'planted-patches-no-apply.json'), '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--out', out('p2')], exit: 'nonzero', expect: ['diff does not apply cleanly to the context'] },
      { id: 'P3', what: 'patches: test that passes on the defective version', gen: 'patches', args: [join(D, 'planted-patches-test-passes-defect.json'), '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--out', out('p3')], exit: 'nonzero', expect: ['the test PASSES on the defective version'] },
      { id: 'P4', what: 'patches: defect evidence past end of file', gen: 'patches', args: [join(D, 'planted-patches-bad-evidence.json'), '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--out', out('p4')], exit: 'nonzero', expect: ['evidence src/services/allocationEngineService.ts:400-401 (repo) -> line-out-of-range'] },
      { id: 'P5', what: 'patches: drill-java kata test that PASSES on the defective version (real Java runner)', gen: 'patches', args: [join(D, 'planted-patches-java-test-passes-defect.json'), '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--out', out('p5')], exit: 'nonzero', expect: ['the test PASSES on the defective version', 'runners: drill-js, drill-cs, drill-java', 'STAMP none'] },
      { id: 'PJ+', what: 'patches: drill-java kata test passes on the context, fails a named test on the defect (positive control)', gen: 'patches', args: [join(D, 'patches-java-ww6.json'), '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--out', out('pjpos')], exit: 0, expect: ['STAMP written', 'runners: drill-js, drill-cs, drill-java', 'RESULT OK'] },
      { id: 'C0', what: 'seed:quests writes a good pack for the seed:check cases (positive control)', gen: 'quests', args: [join(checkouts, `ww6@${WW6_SHA}`), '--sha', WW6_SHA, '--guides', 'astraupskill/05-PRACTICE.md,astraupskill/06-SOLUTIONS-AND-REVIEW.md', '--out', goodPack], exit: 0, expect: ['STAMP written', 'RESULT OK'] },
      // seed:notes against the C0 quest pack (the notes validator reads the quest pack's quiz keys)
      { id: 'N1', what: 'notes: excerpt quote that is not in its cited lines', gen: 'notes', args: notes('planted-notes-bad-quote.json', out('n1')), exit: 'nonzero', expect: ['quote is not verbatim in those lines', 'STAMP none'] },
      { id: 'N2', what: 'notes: excerpt line range past end of file', gen: 'notes', args: notes('planted-notes-line-out-of-range.json', out('n2')), exit: 'nonzero', expect: ['docs/learning/testing-rationale.md:900-902): line out of range', 'STAMP none'] },
      { id: 'N3', what: 'notes: before-note (reading) that leaks a keyed quiz answer', gen: 'notes', args: notes('planted-notes-leaky-before.json', out('n3')), exit: 'nonzero', expect: ['leaks an answer: body contains the keyed answer of quiz c6a7224a750a4855', 'STAMP none'] },
      { id: 'N4', what: 'notes: after-note (explanation) targeting a flashcard, not a quiz', gen: 'notes', args: notes('planted-notes-after-on-flashcard.json', out('n4')), exit: 'nonzero', expect: ['an after note must target a quiz', 'COVERAGE coverage: 1 quiz(zes) without an accepted after note', 'STAMP none'] },
      { id: 'N+', what: 'notes: full-coverage draft (positive control; K0 re-verifies it with the quest pack binding)', gen: 'notes', args: notes('notes-ww6.json', join(seedDir, 'notes', 'ww6')), exit: 0, expect: ['shipped 20 (note 20)', 'STAMP written', 'RESULT OK'] },
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
    // ---- the writers' trust gates (fix/tooling-review): no stamp for an unverified pin, a
    //      non-committed exclusions registry, or an explain-back pack with no quest pack to leak-check
    const permissive = join(tmp, 'permissive-exclusions.json');
    const committedEx = JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'seed', 'exclusions.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(permissive, JSON.stringify({ ...committedEx, entries: [], secretPatterns: [{ id: 'never', regex: 'NEVERMATCHES_[0-9]{40}' }] }));
    const ww6Quests = [join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--guides', 'astraupskill/05-PRACTICE.md,astraupskill/06-SOLUTIONS-AND-REVIEW.md'];
    const gates: Array<[Case, NodeJS.ProcessEnv]> = [
      [{ id: 'U1', what: 'quests over a mirror-less checkout WITHOUT the fixtures hatch: written, NOT stamped (pin caller-asserted + blobs)', gen: 'quests', args: [...ww6Quests, '--out', out('u1')], exit: 'nonzero', expect: ['STAMP none: pin caller-asserted with', 'no mirror verified the checkout against git', 'RESULT FAIL'] }, STRICT_ENV],
      [{ id: 'X1', what: 'quests under a permissive --exclusions registry: written, NOT stamped', gen: 'quests', args: [...ww6Quests, '--exclusions', permissive, '--out', out('x1')], exit: 'nonzero', expect: ['STAMP none: exclusions: the registry in use is not the committed tools/seed/exclusions.json', 'RESULT FAIL'] }, FIXTURE_ENV],
      [{ id: 'EB0', what: 'explainback --out outside the estate (no same-repo quest pack): NOT stamped', gen: 'explainback', args: ['docs/learning/testing-rationale.md', '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--draft', join(D, 'explainback-ww6-testing-rationale.json'), '--out', out('eb0')], exit: 'nonzero', expect: ['STAMP none: guard eb-leak: no quest pack of repo ww6', 'RESULT FAIL'] }, FIXTURE_ENV],
      [{ id: 'EB+', what: 'explainback --allow-no-quests (positive control)', gen: 'explainback', args: ['docs/learning/testing-rationale.md', '--checkout', join(FX, 'ww6'), '--sha', WW6_SHA, '--repo', 'ww6', '--draft', join(D, 'explainback-ww6-testing-rationale.json'), '--out', out('ebpos'), '--allow-no-quests'], exit: 0, expect: ['STAMP written', 'RESULT OK'] }, FIXTURE_ENV],
    ];
    for (const [c, env] of gates) {
      const r = run(c, env);
      record(c, r.code, r.out);
    }

    // seed:check: clean (exit 0), tampered items (nonzero), forged stamp (nonzero)
    const check = (id: string, what: string, dir: string, exit: 'nonzero' | 0, expect: string[]) => {
      const r = spawnSync(process.execPath, ['--import', 'tsx', CLI('check'), '--dir', dir, '--checkouts', checkouts], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true, timeout: 180000, env: FIXTURE_ENV });
      record({ id, what, gen: 'check', args: [], exit, expect }, r.status ?? -1, `${r.stdout ?? ''}${r.stderr ?? ''}`);
    };
    check('K0', 'seed:check over the good packs: quests + notes (positive control)', seedDir, 0, ['OK ', `notes${sep}ww6: 20 item(s) re-validated`, 'RESULT OK']);
    cpSync(seedDir, tampered, { recursive: true });
    const itemsPath = join(tampered, 'quests', 'ww6', 'items.json');
    writeFileSync(itemsPath, readFileSync(itemsPath, 'utf8').replace('"back": "', '"back": "EDITED '));
    check('K1', 'seed:check: items.json edited after stamping', tampered, 'nonzero', ['items.json sha256 != manifest', 'RESULT FAIL']);
    cpSync(seedDir, forged, { recursive: true });
    const stampPath = join(forged, 'quests', 'ww6', 'validation.json');
    writeFileSync(stampPath, readFileSync(stampPath, 'utf8').replace(/"fingerprint": "[0-9a-f]{64}"/, `"fingerprint": "${'0'.repeat(64)}"`));
    check('K2', 'seed:check: stamp from another validator/fingerprint', forged, 'nonzero', ['stale/invalid stamp', 'seed fingerprint 000000000000', 'RESULT FAIL']);

    // ---- the pack-level guards (factory/guards.ts) in the stamp path: generators refuse to stamp,
    //      seed:check / --restamp refuse a pack that carries a tell even when its stamp is valid
    const runCli = (cli: string, args: string[]) => {
      const r = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true, timeout: 180000, env: FIXTURE_ENV });
      return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    };
    let extra = 0;
    const g = (id: string, what: string, cli: string, args: string[], exit: 'nonzero' | 0, expect: string[]) => {
      extra++;
      const r = runCli(cli, args);
      record({ id, what, gen: 'guard', args, exit, expect }, r.code, r.out);
    };
    // G1: 80 hand quizzes whose key is always the longest, colon-led choice (a planted tell)
    const tellDraft = join(tmp, 'tell.draft.json');
    writeFileSync(tellDraft, JSON.stringify(plantedTellDraft()));
    const tellRoot = join(tmp, 'seed-tell');
    const tellPack = join(tellRoot, 'quests', 'ww6');
    g('G1', 'quests:drafts: a draft whose key is always the longest, colon-led choice is written but NOT stamped (guard blind-pass + quiz-balance)', DRAFTS_CLI, [join(checkouts, `ww6@${WW6_SHA}`), '--draft', tellDraft, '--out', tellPack], 'nonzero', [
      'STAMP none',
      'guard blind-pass: strategy',
      'guard quiz-balance longest: key strictly longest',
      'RESULT FAIL',
    ]);
    // K3: the same pack with a valid stamp (as a pre-guard pipeline would have written it): seed:check FAILS it
    stampAsIfPreGuard(tellPack, null);
    g('K3', 'seed:check: a stamped quest pack with a blind-pass tell (stamp otherwise valid) is refused', CLI('check'), ['--dir', tellRoot, '--checkouts', checkouts], 'nonzero', ['PROBLEM guard blind-pass: strategy', 'PROBLEM guard quiz-balance', 'RESULT FAIL']);
    // K4: ... and seed:check --restamp refuses to restamp it once its fingerprint is stale
    stampAsIfPreGuard(tellPack, '0'.repeat(64));
    g('K4', 'seed:check --restamp: a stale-fingerprint pack with a tell is NOT restamped', CLI('check'), ['--dir', tellRoot, '--checkouts', checkouts, '--restamp'], 'nonzero', ['PROBLEM guard blind-pass', 'stale seed fingerprint NOT restamped', '0 restamped', 'RESULT FAIL']);
    // K5: a shipped string carrying a secret (bytes + stamp re-bound, as if stamped before the scan existed)
    const secretRoot = join(tmp, 'seed-secret');
    cpSync(join(seedDir, 'quests'), join(secretRoot, 'quests'), { recursive: true });
    plantShippedSecret(join(secretRoot, 'quests', 'ww6'));
    g('K5', 'seed:check: a stamped pack whose shipped text carries a secret pattern is refused', CLI('check'), ['--dir', secretRoot, '--checkouts', checkouts], 'nonzero', ['PROBLEM guard secret-scan:', 'shopify-token', 'RESULT FAIL']);
    // G2: an explain-back key point that restates a keyed answer of the same-repo quest pack
    const ebRoot = join(tmp, 'seed-eb');
    cpSync(join(seedDir, 'quests'), join(ebRoot, 'quests'), { recursive: true });
    const ebDraft = join(tmp, 'eb-leak.draft.json');
    writeFileSync(ebDraft, JSON.stringify(plantedLeakyExplainBack(join(seedDir, 'quests', 'ww6'))));
    g('G2', 'explainback: a key point restating a same-repo quiz key is written but NOT stamped (guard eb-leak)', CLI('explainback'), ['docs/learning/testing-rationale.md', '--checkout', join(checkouts, `ww6@${WW6_SHA}`), '--sha', WW6_SHA, '--repo', 'ww6', '--draft', ebDraft, '--out', join(ebRoot, 'explainback', 'ww6-leak')], 'nonzero', [
      'STAMP none',
      'guard eb-leak: q1.kp1 contains the keyed answer of quests/ww6 quiz',
      'RESULT FAIL',
    ]);
    // G4/S+: explain-back ALTERNATE sets (retakes) — the eb-sibling guard. Each estate first gets the
    // primary set; then an alternate set (--set b) whose q1 prompt near-duplicates the primary's is
    // written but NOT stamped, and a genuinely rephrased set stamps (positive control).
    const ebArgs = (draft: string, o: string, ...more: string[]) => [
      'docs/learning/testing-rationale.md',
      '--checkout',
      join(checkouts, `ww6@${WW6_SHA}`),
      '--sha',
      WW6_SHA,
      '--repo',
      'ww6',
      '--draft',
      join(D, draft),
      '--out',
      o,
      '--allow-no-quests',
      ...more,
    ];
    const setsBad = join(tmp, 'seed-sets-bad');
    const setsGood = join(tmp, 'seed-sets-good');
    for (const root of [setsBad, setsGood]) {
      g('S0', `explainback: the primary set of the sibling group (${root.split(sep).pop()}; positive control)`, CLI('explainback'), ebArgs('explainback-ww6-testing-rationale.json', join(root, 'explainback', 'ww6-tr')), 0, ['STAMP written', 'RESULT OK']);
    }
    g('G4', 'explainback --set b: an alternate set whose q1 prompt near-duplicates its primary is written but NOT stamped (guard eb-sibling)', CLI('explainback'), ebArgs('planted-explainback-sibling-dup-prompt.json', join(setsBad, 'explainback', 'ww6-tr--set-b'), '--set', 'b'), 'nonzero', [
      'STAMP none',
      'guard eb-sibling: q1 prompt near-duplicates the q1 prompt of sibling ww6-tr (primary set)',
      'RESULT FAIL',
    ]);
    g('G5', 'explainback --set without --draft is refused (an alternate set is an authored draft)', CLI('explainback'), ['docs/learning/testing-rationale.md', '--checkout', join(checkouts, `ww6@${WW6_SHA}`), '--sha', WW6_SHA, '--repo', 'ww6', '--set', 'b', '--out', out('g5'), '--allow-no-quests'], 'nonzero', [
      'REFUSED --set b needs --draft',
    ]);
    g('S+', 'explainback --set b: a rephrased alternate set stamps beside its primary (positive control)', CLI('explainback'), ebArgs('explainback-ww6-testing-rationale--set-b.json', join(setsGood, 'explainback', 'ww6-tr--set-b'), '--set', 'b'), 0, [
      'alternate set b',
      'STAMP written',
      'RESULT OK',
    ]);
    // G3: the plain generator over a drafts-built repo dir is refused (it would replace every hand item)
    g('G3', 'quests: the generator over a pack seed:quests:drafts built is refused (no silent replace of hand items)', CLI('quests'), [join(checkouts, `ww6@${WW6_SHA}`), '--sha', WW6_SHA, '--guides', 'astraupskill/05-PRACTICE.md', '--out', tellPack], 'nonzero', [
      'REFUSED refusing to replace',
      'its source is draft:tell.draft.json, this run\'s is generator-only (no draft)',
      '--force-replace',
    ]);

    const total = cases.length + gates.length + 3 + extra;
    console.log(`[seed:demo:planted] ${total - failed}/${total} cases behaved as required`);
    console.log(`RESULT ${failed === 0 ? 'OK' : 'FAIL'}`);
    return failed === 0 ? 0 : 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const SRC = { path: 'src/services/allocationRunService.ts', lines: { start: 20, end: 33 } };
const CITE = [{ path: 'src/services/allocationRunService.ts', lineStart: 20, lineEnd: 25 }];

/**
 * 80 hand quizzes, every key the longest choice and the only colon-led one. Next to the fixture
 * guides' 18 generator quizzes, "pick the longest" alone clears the 80% gate (80 of 98 sure).
 */
function plantedTellDraft(): unknown {
  const items = Array.from({ length: 80 }, (_, i) => ({
    id: `tell-${String(i + 1).padStart(2, '0')}`,
    kind: 'quiz',
    source: SRC,
    cites: CITE,
    prompt: `Planted tell ${i + 1}: a worker asks for transition number ${i + 1} out of PENDING. What happens?`,
    answer: `Refused ${i + 1}: assertValidRunTransition throws because only RUNNING and FAILED may follow PENDING`,
    distractors: ['It is accepted', 'Nothing at all', 'A retry is queued'],
    explanation: 'VALID_RUN_TRANSITIONS lists only RUNNING and FAILED after PENDING.',
  }));
  return { format: 'bootquest-quest-drafts@1', repo: 'ww6', sha: WW6_SHA, guides: ['astraupskill/05-PRACTICE.md', 'astraupskill/06-SOLUTIONS-AND-REVIEW.md'], items };
}

/**
 * Write validation.json the way writeSeedPack does, WITHOUT the pack-level guards: what a pack stamped
 * before the guards landed looks like (`fingerprint` null = the current one; else a stale one).
 */
function stampAsIfPreGuard(dir: string, fingerprint: string | null): void {
  const manifestBytes = readFileSync(join(dir, 'manifest.json'), 'utf8');
  const itemsBytes = readFileSync(join(dir, 'items.json'), 'utf8');
  const m = SeedPackManifest.parse(JSON.parse(manifestBytes));
  const q = JSON.parse(readFileSync(join(dir, 'quarantine.json'), 'utf8')) as { entries: { key: string }[] };
  const rq = JSON.parse(readFileSync(join(dir, 'review-queue.json'), 'utf8')) as { entries: { key: string; item: SeedItem }[] };
  const items = JSON.parse(itemsBytes) as { items: SeedItem[] };
  const runners = packRunners([...items.items, ...rq.entries.map((e) => e.item)]);
  const stamp = SeedValidationStamp.parse({
    format: SEED_PACK_FORMAT,
    source: `${m.generator}/${m.name}`,
    fingerprintKind: `seed:${m.generator}`,
    fingerprint: fingerprint ?? seedFingerprint(m.generator, runners),
    toolchain: seedToolchain(m.generator, runners),
    manifestSha256: sha256(manifestBytes),
    itemsSha256: sha256(itemsBytes),
    counts: m.counts,
    quarantinedKeys: q.entries.map((e) => e.key).sort(),
    reviewKeys: rq.entries.map((e) => e.key).sort(),
    executions: 0,
  });
  writeFileSync(join(dir, 'validation.json'), stableJson(stamp));
}

/** Put a planted (runtime-assembled) token into one shipped explanation, re-bind manifest + stamp. */
function plantShippedSecret(dir: string): void {
  const items = JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8')) as { items: Array<{ kind: string; explanation?: string }> };
  const quiz = items.items.find((i) => i.kind === 'quiz')!;
  quiz.explanation = `${quiz.explanation ?? ''} (debug token ${plantedToken()})`;
  const itemsBytes = stableJson(items);
  writeFileSync(join(dir, 'items.json'), itemsBytes);
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { items: { sha256: string } };
  m.items.sha256 = sha256(itemsBytes);
  writeFileSync(join(dir, 'manifest.json'), stableJson(m));
  stampAsIfPreGuard(dir, null);
}

/** The committed ww6 explain-back fixture with q1.kp1's text replaced by a keyed answer of the ww6 quest pack. */
function plantedLeakyExplainBack(questPack: string): unknown {
  const d = JSON.parse(readFileSync(join(D, 'explainback-ww6-testing-rationale.json'), 'utf8')) as { questions: Array<{ keyPoints: Array<{ text: string }> }> };
  const items = (JSON.parse(readFileSync(join(questPack, 'items.json'), 'utf8')) as { items: SeedItem[] }).items;
  const key = items
    .filter((i): i is SeedQuizItem => i.kind === 'quiz')
    .map((q) => q.check.choices![q.check.answerKey as number]!)
    .find((a) => a.split(/\s+/).length >= 4);
  if (!key) throw new Error('the ww6 quest pack has no keyed answer of >= 4 words to plant');
  d.questions[0]!.keyPoints[0]!.text = `In short: ${key}`;
  return d;
}

main().then(
  (c) => process.exit(c),
  (err: unknown) => {
    console.error(`[seed:demo:planted] CRASHED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  },
);
