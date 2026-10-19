import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SeedPatchKataItem } from '@bootquest/shared';
import { FACTORY_JAVA_SCRATCH_ENV, factoryHarness, factoryJavaScratchDir, failsAsVerdict } from '../harness/harness.ts';
import { loadSeedPack } from '../pack.ts';
import { REPO_ROOT } from '../report.ts';
import { applyInTemp, diffTargets, sliceLines } from './patches.ts';
import { runPatches } from './run.ts';

/** a usable .NET SDK on PATH (`dotnet --list-sdks` exits 0 and lists at least one SDK) */
const HAVE_DOTNET_SDK = (() => {
  const r = spawnSync('dotnet', ['--list-sdks'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  return r.status === 0 && /\d+\.\d+/.test(r.stdout ?? '');
})();

/** a JDK on PATH (`javac -version` exits 0) */
const HAVE_JDK = (() => {
  const r = spawnSync('javac', ['-version'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  return r.status === 0 && /javac \d+/.test(`${r.stdout ?? ''}${r.stderr ?? ''}`);
})();

const FX = join(import.meta.dirname, '..', 'fixtures');
const D = join(FX, 'drafts');
const WW6 = '09751ceaee909a30e5c4b5ff5cdde99880b9a3e5';
const tmp = mkdtempSync(join(tmpdir(), 'bq-kata-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const out = (n: string) => join(tmp, n);
const run = (draft: string, name: string) => runPatches({ draft: join(D, draft), checkout: join(FX, 'ww6'), sha: WW6, repo: 'ww6', out: out(name) });

describe('seed:patches', () => {
  it('real-finding katas (ww6 F9 adapted + verbatim engine file with mixed CRLF/LF) validate and stamp', async () => {
    const r = await run('patches-ww6.json', 'good');
    expect(r.lines).toContain('RESULT OK');
    const items = loadSeedPack(out('good'), { requireStamp: true }).items as SeedPatchKataItem[];
    expect(items).toHaveLength(2);
    const verbatim = items.find((i) => i.contextFiles[0]!.origin.kind === 'verbatim')!;
    // the factory copied the context from the checkout, byte for byte (CRLF kept)
    expect(verbatim.contextFiles[0]!.content).toBe(readFileSync(join(FX, 'ww6', 'src/services/allocationEngineService.ts'), 'utf8'));
    expect(verbatim.contextFiles[0]!.content).toContain('\r\n');
    const tested = items.find((i) => i.test)!;
    expect(tested.seededDefectKey.map((d) => d.evidence.in)).toEqual(['patched', 'repo']);
    expect(r.outcome!.executions).toBe(2); // clean context passes + defective version fails, really executed
  }, 120_000);

  const planted: Array<[string, RegExp]> = [
    ['planted-patches-empty-key.json', /seeded-defect key is empty/],
    ['planted-patches-no-apply.json', /diff does not apply cleanly to the context: .*patch does not apply/s],
    ['planted-patches-test-passes-defect.json', /the test PASSES on the defective version \(it must fail there\)/],
    ['planted-patches-bad-evidence.json', /defect 1 evidence src\/services\/allocationEngineService.ts:400-401 \(repo\) -> line-out-of-range/],
  ];
  for (const [file, reason] of planted) {
    it(`REJECTS ${file}`, async () => {
      const r = await run(file, file);
      expect(r.ok).toBe(false);
      expect(r.write!.manifest).toMatchObject({ quarantined: 1, counts: { total: 0 } });
      expect(r.lines.join('\n')).toMatch(reason);
    }, 120_000);
  }

  it('git apply runs in an isolated temp dir (a parent repo can never capture it) and is cleaned up', () => {
    const ctx = [{ path: 'a/x.txt', content: 'one\ntwo\n' }];
    const diff = 'diff --git a/a/x.txt b/a/x.txt\n--- a/a/x.txt\n+++ b/a/x.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n';
    const ok = applyInTemp(ctx, diff);
    try {
      expect(ok.ok).toBe(true);
      expect(readFileSync(join(ok.dir, 'a/x.txt'), 'utf8')).toBe('one\nTWO\n');
    } finally {
      rmSync(ok.dir, { recursive: true, force: true });
    }
    const bad = applyInTemp(ctx, diff.replace(' one', ' uno'));
    rmSync(bad.dir, { recursive: true, force: true });
    expect(bad.ok).toBe(false);
    expect(existsSync(bad.dir)).toBe(false);
  });

  // campaign 2 (OPS review): this block compiles C# through the warm runner, so it needs a working
  // .NET SDK; on a machine without one it is SKIPPED (reported as skipped, never silently passed).
  describe.skipIf(!HAVE_DOTNET_SDK)('drill-cs kata tests run through the factory harness (warm C# runner, own scratch dir)', () => {
    // a dedicated, persistent scratch dir: warm after the first run, never shared with seed:validate or the CLIs
    const managed = factoryHarness({ csScratch: join(REPO_ROOT, '.cache', 'factory-csharp-test') });
    afterAll(() => managed.shutdown(), 120_000);
    const MODULE = 'kata/Summary.Testable.cs';
    const clean = 'public static class Summary\n{\n    public static int Matched(int[] rules) => rules.Count(r => r > 0);\n}\n';
    const diffTo = (line: string) =>
      `diff --git a/${MODULE} b/${MODULE}\n--- a/${MODULE}\n+++ b/${MODULE}\n@@ -1,4 +1,4 @@\n public static class Summary\n {\n-    public static int Matched(int[] rules) => rules.Count(r => r > 0);\n+${line}\n }\n`;
    const draft = (name: string, patchedLine: string) => {
      const file = join(tmp, `${name}.json`);
      writeFileSync(
        file,
        JSON.stringify({
          name,
          katas: [
            {
              id: 'zero-weight-counts',
              title: 'Count zero-weight rules as matched',
              provenance: { path: 'astraupskill/06-SOLUTIONS-AND-REVIEW.md', lines: { start: 30, end: 30 } },
              diff: diffTo(patchedLine),
              contextFiles: [{ path: MODULE, content: clean, origin: { kind: 'adapted', repoPath: 'src/services/allocationEngineService.ts' } }],
              seededDefectKey: [
                { scenario: 'a rule with weight 0', evidence: { path: MODULE, lineStart: 3, lineEnd: 3, in: 'patched' }, consequence: 'it is counted as matched' },
              ],
              test: {
                module: MODULE,
                check: {
                  type: 'drill-cs',
                  shape: 'xunit',
                  files: { tests: 'public class SummaryTests\n{\n    [Fact(DisplayName = "zero-weight rules are not matched")]\n    public void ZeroWeight() => Assert.Equal(1, Summary.Matched(new[] { 0, 2 }));\n}\n', tail: '' },
                  timeoutMs: 60_000,
                },
              },
            },
          ],
        }),
      );
      return file;
    };
    const runCs = (name: string, patchedLine: string) =>
      runPatches({ draft: draft(name, patchedLine), checkout: join(FX, 'ww6'), sha: WW6, repo: 'ww6', out: out(name), harness: managed.harness });

    it('registers drill-js, drill-cs AND drill-java', () => {
      expect(Object.keys(managed.harness.runners).sort()).toEqual(['drill-cs', 'drill-java', 'drill-js']);
      // drill-cs non-verdicts: no TRX results / edited frozen scaffolding never count as a named-test failure
      for (const name of ['(compile)', '(timeout)', '(runner)', '(scaffolding)']) {
        expect(failsAsVerdict({ pass: false, output: '', failures: [{ name, message: 'x' }], durationMs: 0 }).ok).toBe(false);
      }
    });

    it('clean context PASSES and the defective version FAILS a named xunit test -> stamped', async () => {
      const r = await runCs('cs-good', '    public static int Matched(int[] rules) => rules.Count(r => r >= 0);');
      expect(r.lines.join('\n')).toContain('RESULT OK');
      expect(r.outcome!.executions).toBe(2);
      expect(loadSeedPack(out('cs-good'), { requireStamp: true }).items).toHaveLength(1);
    }, 600_000);

    it('REJECTS a defective version that does not compile: a compile error is not a test verdict', async () => {
      const r = await runCs('cs-nocompile', '    public static int Matched(int[] rules) => rules.Count(r => r >>> );');
      expect(r.ok).toBe(false);
      expect(r.lines.join('\n')).toMatch(/the defective version fails only without a test verdict \(\(compile\)\)/);
    }, 600_000);
  });

  it('drill-java registration: own scratch dir (env override), lazy (no javac/java until the first execution)', async () => {
    expect(factoryJavaScratchDir({})).toBe(join(REPO_ROOT, '.cache', 'factory-java'));
    expect(factoryJavaScratchDir({ [FACTORY_JAVA_SCRATCH_ENV]: '  D:/elsewhere/java  ' })).toBe('D:/elsewhere/java');
    // never the import gate's scratch (seed:validate: BOOTQUEST_JAVA_SCRATCH / .cache/seed-java)
    expect(factoryJavaScratchDir({ BOOTQUEST_JAVA_SCRATCH: 'D:/gate' })).toBe(join(REPO_ROOT, '.cache', 'factory-java'));
    const scratch = join(tmp, 'lazy-java');
    const m = factoryHarness({ csScratch: join(tmp, 'lazy-cs'), javaScratch: scratch });
    expect(Object.keys(m.harness.runners).sort()).toEqual(['drill-cs', 'drill-java', 'drill-js']);
    await m.shutdown();
    expect(existsSync(scratch)).toBe(false); // nothing compiled, nothing spawned
    // drill-java non-verdicts: an early report() (incomplete run) or a crash never counts as a named-test failure
    for (const name of ['(compile)', '(timeout)', '(program)', '(format)', '(incomplete)']) {
      expect(failsAsVerdict({ pass: false, output: '', failures: [{ name, message: 'x' }], durationMs: 0 }).ok).toBe(false);
    }
    // a todo stub (drill-java / drill-cs) or a NotExecuted xunit test is a named entry but NOT a failed assertion
    for (const message of ['not implemented yet (todo)', 'skipped / not executed']) {
      const v = failsAsVerdict({ pass: false, output: '', failures: [{ name: 'boundary', message }], durationMs: 0 });
      expect(v).toEqual({ ok: false, why: expect.stringMatching(/^fails only as todo \/ not executed \(boundary\)/) });
    }
    // ... but a real failure beside a todo still counts
    expect(failsAsVerdict({ pass: false, output: '', failures: [{ name: 'a', message: 'not implemented yet (todo)' }, { name: 'b', message: 'values differ' }], durationMs: 0 }).ok).toBe(true);
  });

  // JDK 17 on PATH: the block compiles Java through the server's real Java runner; without a JDK it is
  // SKIPPED (reported as skipped, never silently passed). Two compiles + runs in all (a few seconds).
  describe.skipIf(!HAVE_JDK)('drill-java kata tests run through the factory harness (Java runner, own scratch dir)', () => {
    const managed = factoryHarness({ csScratch: join(REPO_ROOT, '.cache', 'factory-csharp-test'), javaScratch: join(REPO_ROOT, '.cache', 'factory-java-test') });
    afterAll(() => managed.shutdown(), 120_000);
    const MODULE = 'kata/Summary.Testable.java';
    const clean = 'import java.util.Arrays;\n\nfinal class Summary {\n    static long matched(int[] rules) { return Arrays.stream(rules).filter(r -> r > 0).count(); }\n}\n';
    const patched = clean.replace('r -> r > 0', 'r -> r >= 0');
    const diff = `diff --git a/${MODULE} b/${MODULE}\n--- a/${MODULE}\n+++ b/${MODULE}\n@@ -3,3 +3,3 @@\n final class Summary {\n-${clean.split('\n')[3]}\n+${patched.split('\n')[3]}\n }\n`;
    const tests =
      '// ─── tests ───\nclass KataTest {\n    public static void main(String[] args) {\n' +
      '        bootcamp.Check.test("zero-weight rules are not matched", () -> bootcamp.Check.eq(Summary.matched(new int[] { 0, 2 }), 1L));\n' +
      '        System.exit(bootcamp.Check.report());\n    }\n}\n// ─── end tests ───\n';
    const file = join(tmp, 'java-good.json');
    writeFileSync(
      file,
      JSON.stringify({
        name: 'java-good',
        katas: [
          {
            id: 'zero-weight-counts-java',
            title: 'Count zero-weight rules as matched (Java)',
            provenance: { path: 'astraupskill/06-SOLUTIONS-AND-REVIEW.md', lines: { start: 30, end: 30 } },
            diff,
            contextFiles: [{ path: MODULE, content: clean, origin: { kind: 'adapted', repoPath: 'src/services/allocationEngineService.ts' } }],
            seededDefectKey: [{ scenario: 'a rule with weight 0', evidence: { path: MODULE, lineStart: 4, lineEnd: 4, in: 'patched' }, consequence: 'it is counted as matched' }],
            test: { module: MODULE, check: { type: 'drill-java', files: { tests, tail: '' }, className: 'KataTest', timeoutMs: 30_000 } },
          },
        ],
      }),
    );

    it('clean context PASSES and the defective version FAILS a named Check test -> stamped (2 real executions)', async () => {
      const r = await runPatches({ draft: file, checkout: join(FX, 'ww6'), sha: WW6, repo: 'ww6', out: out('java-good'), harness: managed.harness });
      expect(r.lines.join('\n')).toContain('runners: drill-js, drill-cs, drill-java');
      expect(r.lines.join('\n')).toContain('RESULT OK');
      expect(r.outcome!.executions).toBe(2);
      const items = loadSeedPack(out('java-good'), { requireStamp: true }).items as SeedPatchKataItem[];
      expect(items).toHaveLength(1);
      expect(items[0]!.test!.check.type).toBe('drill-java');
    }, 300_000);

    it('REJECTS a defective version that only "fails" as a TODO stub (todo is not a failed assertion; real runner)', async () => {
      const stub = clean.replace('return Arrays.stream(rules).filter(r -> r > 0).count();', 'throw new UnsupportedOperationException("TODO");');
      const stubDiff = `diff --git a/${MODULE} b/${MODULE}\n--- a/${MODULE}\n+++ b/${MODULE}\n@@ -3,3 +3,3 @@\n final class Summary {\n-${clean.split('\n')[3]}\n+${stub.split('\n')[3]}\n }\n`;
      const draft = JSON.parse(readFileSync(file, 'utf8')) as { name: string; katas: Array<{ diff: string; id: string }> };
      draft.name = 'java-todo';
      draft.katas[0]!.id = 'todo-stub-java';
      draft.katas[0]!.diff = stubDiff;
      const f = join(tmp, 'java-todo.json');
      writeFileSync(f, JSON.stringify(draft));
      const before = managed.harness.executions; // the harness is shared by this block: count this run only
      const r = await runPatches({ draft: f, checkout: join(FX, 'ww6'), sha: WW6, repo: 'ww6', out: out('java-todo'), harness: managed.harness });
      expect(r.ok).toBe(false);
      expect(managed.harness.executions - before).toBe(2); // really executed on both versions
      expect(r.lines.join('\n')).toMatch(/the defective version fails only as todo \/ not executed \(zero-weight rules are not matched\)/);
    }, 300_000);
  });

  it('helpers: diff targets, line slicing that keeps each line terminator', () => {
    expect(diffTargets('--- a/x.ts\n+++ b/x.ts\n@@\n--- a/gone.ts\n+++ /dev/null\n')).toEqual(['gone.ts', 'x.ts']);
    expect(sliceLines('a\r\nb\nc', 2, 3)).toBe('b\nc');
  });
});
