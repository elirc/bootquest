import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SeedVariantItem } from '@bootquest/shared';
import { defaultHarness, withRunner } from '../harness/harness.ts';
import { loadSeedPack } from '../pack.ts';
import { runVariants } from './run.ts';

const FX = join(import.meta.dirname, '..', 'fixtures');
const D = join(FX, 'drafts');
const tmp = mkdtempSync(join(tmpdir(), 'bq-var-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const out = (n: string) => join(tmp, n);

describe('seed:variants — the wrong-solution filter through the REAL drill-js runner', () => {
  it('signalpost U01 transfer variants: reference passes, wrong fails, provenance verified at the pinned sha', async () => {
    const r = await runVariants({ draft: join(D, 'variants-signalpost-U01.json'), checkout: join(FX, 'signalpost-swe-bootcamp'), out: out('u01') });
    expect(r.lines).toContain('RESULT OK');
    expect(r.outcome!.executions).toBeGreaterThanOrEqual(4); // ref + wrong per item, really executed
    const pack = loadSeedPack(out('u01'), { requireStamp: true });
    expect(pack.items).toHaveLength(2);
    const v = pack.items[0] as SeedVariantItem;
    expect(v.provenance).toEqual({ repo: 'signalpost-swe-bootcamp', sha: 'ff8446042a16d0aaef1687b34932b4f9137e6e0d', path: 'docs/curriculum/program.json', lines: { start: 35, end: 35 } });
    expect(pack.manifest.source.pin).toBe('caller-asserted');
    expect(Object.keys(pack.manifest.blobs)).toEqual(['docs/curriculum/program.json']);
    const stamp = JSON.parse(readFileSync(join(out('u01'), 'validation.json'), 'utf8'));
    expect(stamp).toMatchObject({ fingerprintKind: 'seed:variants', executions: r.outcome!.executions });
    expect(stamp.toolchain.esbuild).toBeTruthy();
  }, 120_000);

  it('signalpost U02 (search fails only at the last item): off-by-one wrong solution is caught', async () => {
    const r = await runVariants({ draft: join(D, 'variants-signalpost-U02.json'), out: out('u02') });
    expect(r.ok).toBe(true);
    expect(r.lines).toContain('[seed:variants] no --checkout: provenance recorded as caller-asserted (not resolved)');
  }, 120_000);

  const planted: Array<[string, RegExp]> = [
    ['planted-variants-wrong-passes.json', /wrong-solution filter: the deliberately wrong solution PASSES the test/],
    ['planted-variants-ref-fails.json', /the test does not PASS the reference solution under the real runner: a title exactly minLength long does not count/],
    ['planted-variants-wrong-crashes.json', /fails only without a test verdict \(code loads without errors\)/],
    ['planted-variants-no-runner.json', /reference not executed: no runner registered for drill-cs \(no execution = no emission\)/],
  ];
  for (const [file, reason] of planted) {
    it(`DISCARDS ${file} with its reason`, async () => {
      const r = await runVariants({ draft: join(D, file), out: out(file) });
      expect(r.ok).toBe(false);
      expect(r.write!.manifest).toMatchObject({ quarantined: 1, counts: { total: 0 } });
      expect(JSON.parse(readFileSync(join(out(file), 'items.json'), 'utf8')).items).toEqual([]);
      expect(r.lines.join('\n')).toMatch(reason);
    }, 120_000);
  }

  it('drill-cs plugs into the same harness registry (a registered runner is actually invoked)', async () => {
    const calls: string[] = [];
    const h = withRunner(defaultHarness(), 'drill-cs', async (_spec, sub) => {
      calls.push(sub.code ?? '');
      const ok = !(sub.code ?? '').includes('>=');
      return { pass: ok, output: '', failures: ok ? [] : [{ name: 'boundary', message: 'expected abcde' }], durationMs: 1 };
    });
    const r = await runVariants({ draft: join(D, 'planted-variants-no-runner.json'), harness: h, out: out('cs') });
    expect(calls).toHaveLength(2);
    expect(r.ok).toBe(true);
  });

  it('drill-java without a registered runner is a discard reason, never a pass (no execution = no emission)', async () => {
    // defaultHarness() registers drill-js only: the drill-java item is never executed and never emitted
    const r = await runVariants({ draft: join(D, 'variants-java-signalpost-U01.json'), out: out('java-no-runner') });
    expect(r.ok).toBe(false);
    expect(r.write!.manifest).toMatchObject({ quarantined: 1, counts: { total: 0 } });
    expect(r.lines.join('\n')).toMatch(/reference not executed: no runner registered for drill-java \(no execution = no emission\)/);
  });

  it('drill-java plugs into the same harness registry (a registered runner is actually invoked)', async () => {
    const calls: string[] = [];
    const h = withRunner(defaultHarness(), 'drill-java', async (spec, sub) => {
      expect(spec.type).toBe('drill-java');
      calls.push(sub.code ?? '');
      const ok = !(sub.code ?? '').includes('>=');
      return { pass: ok, output: '', failures: ok ? [] : [{ name: 'boundary: a title exactly minLength long does not count', message: 'values differ' }], durationMs: 1 };
    });
    const r = await runVariants({ draft: join(D, 'variants-java-signalpost-U01.json'), harness: h, out: out('java-injected') });
    expect(calls).toHaveLength(2);
    expect(r.ok).toBe(true);
  });

  it('a provenance that does not hold at the pinned sha is refused', async () => {
    const r = await runVariants({ draft: join(D, 'variants-signalpost-U01.json'), checkout: join(FX, 'ww6'), out: out('wrongco') });
    expect(r.refused).toMatch(/provenance does not hold at the pinned sha/);
  });
});
