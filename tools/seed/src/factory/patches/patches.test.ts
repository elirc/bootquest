import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SeedPatchKataItem } from '@bootquest/shared';
import { factoryHarness, failsAsVerdict } from '../harness/harness.ts';
import { loadSeedPack } from '../pack.ts';
import { REPO_ROOT } from '../report.ts';
import { applyInTemp, diffTargets, sliceLines } from './patches.ts';
import { runPatches } from './run.ts';

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

  describe('drill-cs kata tests run through the factory harness (warm C# runner, own scratch dir)', () => {
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

    it('registers drill-js AND drill-cs', () => {
      expect(Object.keys(managed.harness.runners).sort()).toEqual(['drill-cs', 'drill-js']);
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

  it('helpers: diff targets, line slicing that keeps each line terminator', () => {
    expect(diffTargets('--- a/x.ts\n+++ b/x.ts\n@@\n--- a/gone.ts\n+++ /dev/null\n')).toEqual(['gone.ts', 'x.ts']);
    expect(sliceLines('a\r\nb\nc', 2, 3)).toBe('b\nc');
  });
});
