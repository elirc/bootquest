import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SeedExplainBackItem } from '@bootquest/shared';
import { openCheckout } from '../checkout.ts';
import { plantAndie } from '../demo/plant.ts';
import { Exclusions } from '../exclusions.ts';
import { loadSeedPack } from '../pack.ts';
import { buildExplainBackItem, scaffoldQuestions, sentences, validateExplainBack } from './explainback.ts';
import { runExplainBack } from './run.ts';

const FX = join(import.meta.dirname, '..', 'fixtures');
const D = join(FX, 'drafts');
const WW6 = '09751ceaee909a30e5c4b5ff5cdde99880b9a3e5';
const UNIT = 'docs/learning/testing-rationale.md';
const tmp = mkdtempSync(join(tmpdir(), 'bq-eb-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const out = (n: string) => join(tmp, n);
const run = (draft: string | null, name: string) =>
  runExplainBack({ unit: UNIT, checkout: join(FX, 'ww6'), sha: WW6, repo: 'ww6', ...(draft ? { draft: join(D, draft) } : {}), out: out(name) });

describe('seed:explainback', () => {
  it('an LLM-style draft whose key points quote / cite the real unit passes; the pack is stamped', () => {
    const r = run('explainback-ww6-testing-rationale.json', 'good');
    expect(r.lines).toContain('RESULT OK');
    const item = loadSeedPack(out('good'), { requireStamp: true }).items[0] as SeedExplainBackItem;
    expect(item.questions).toHaveLength(3);
    expect(item.questions.map((q) => q.keyPoints.length)).toEqual([5, 6, 5]);
    expect(item.questions[1]!.keyPoints[4]!.cite).toEqual({ path: 'src/services/allocationRunService.ts', lineStart: 102, lineEnd: 113 });
    expect(item.provenance).toEqual({ repo: 'ww6', sha: WW6, path: UNIT, lines: { start: 1, end: 56 } });
  });

  it('stores every cite at its RESOLVED repo-root path; an unresolvable or directory cite is refused', () => {
    const co = openCheckout({ root: join(FX, 'ww6'), sha: WW6, repo: 'ww6' });
    const ex = Exclusions.load();
    const text = readFileSync(join(FX, 'ww6', UNIT), 'utf8');
    const draft = JSON.parse(readFileSync(join(D, 'explainback-ww6-testing-rationale.json'), 'utf8')) as { questions: Array<{ prompt: string; keyPoints: Array<{ text: string; quote?: string; cite?: { path: string; lineStart: number; lineEnd: number } }> }>; lines: { start: number; end: number } };
    const withCite = (path: string) => {
      const d = structuredClone(draft);
      d.questions[1]!.keyPoints[4]!.cite = { path, lineStart: 102, lineEnd: 113 };
      return buildExplainBackItem(co, UNIT, d.questions, d.lines, 'draft');
    };
    // a unique-suffix cite (as an author would write it) ships at the path the client can open
    const v = validateExplainBack(co, ex, text, withCite('services/allocationRunService.ts'));
    expect(v.verdict).toBe('accept');
    const item = (v as { item: SeedExplainBackItem }).item;
    expect(item.questions[1]!.keyPoints[4]!.cite).toEqual({ path: 'src/services/allocationRunService.ts', lineStart: 102, lineEnd: 113 });
    // idempotent: the stored (resolved) item re-validates byte-identically (what seed:check compares)
    expect(validateExplainBack(co, ex, text, item)).toEqual({ verdict: 'accept', item });
    const missing = validateExplainBack(co, ex, text, withCite('src/services/nope.ts'));
    expect(missing).toMatchObject({ verdict: 'reject' });
    expect((missing as { reason: string }).reason).toMatch(/q2\.kp5 cite src\/services\/nope\.ts:102-113 -> missing-file/);
  });

  it('the deterministic scaffold (no draft) quotes the source verbatim and is identical on a rerun', () => {
    const a = run(null, 'scaf-a');
    const b = run(null, 'scaf-b');
    expect(a.lines).toContain('RESULT OK');
    expect(readFileSync(join(out('scaf-b'), 'items.json'), 'utf8')).toBe(readFileSync(join(out('scaf-a'), 'items.json'), 'utf8'));
    expect(b.ok).toBe(true);
    const item = loadSeedPack(out('scaf-a')).items[0] as SeedExplainBackItem;
    for (const q of item.questions) {
      expect(q.keyPoints.length).toBeGreaterThanOrEqual(5);
      expect(q.keyPoints.length).toBeLessThanOrEqual(8);
      for (const kp of q.keyPoints) expect(kp.quote).toBeDefined();
    }
  });

  it('scaffold refuses thin sources; sentence splitting keeps code spans intact', () => {
    expect(scaffoldQuestions('# T\n\n## A\n\nOne short line.\n')).toBeNull();
    expect(sentences('Call `a.b()` first. Then `c`. Done')).toEqual(['Call `a.b()` first.', 'Then `c`.', 'Done']);
  });

  const planted: Array<[string, RegExp]> = [
    ['planted-explainback-quotes-nothing.json', /q1\.kp2 quote is not in the source \(whitespace-normalized\)/],
    ['planted-explainback-no-evidence.json', /q3\.kp1 neither quotes nor cites the source/],
    ['planted-explainback-wrong-counts.json', /needs exactly 3 questions, got 2 ; question 2 has 4 key points \(needs 5-8\)/],
    ['planted-explainback-duplicate-points.json', /duplicate key points: q1\.kp1 ~ q3\.kp5/],
    ['planted-explainback-bad-cite.json', /q2\.kp5 cite src\/services\/allocationRunService\.ts:900-910 -> line-out-of-range/],
  ];
  for (const [file, reason] of planted) {
    it(`REJECTS ${file}`, () => {
      const r = run(file, file);
      expect(r.ok).toBe(false);
      expect(r.write!.manifest).toMatchObject({ quarantined: 1, counts: { total: 0 } });
      expect(r.lines.join('\n')).toMatch(reason);
      expect(r.lines.join('\n')).toMatch(/STAMP none/);
    });
  }

  it('whitespace-normalized quoting: line breaks in the source do not defeat a real quote', () => {
    const co = openCheckout({ root: join(FX, 'ww6'), sha: WW6, repo: 'ww6' });
    const src = readFileSync(join(FX, 'ww6', UNIT), 'utf8');
    const draft = JSON.parse(readFileSync(join(D, 'explainback-ww6-testing-rationale.json'), 'utf8'));
    draft.questions[0].keyPoints[0].quote = 'This verifies   that read-only roles\ncannot trigger mutating, high-impact workflows';
    const item = buildExplainBackItem(co, UNIT, draft.questions, draft.lines, 'draft');
    expect(validateExplainBack(co, Exclusions.load(), src, item).verdict).toBe('accept');
  });

  it('a cite into an excluded file drops the set (counted); an excluded unit source is refused', () => {
    const root = mkdtempSync(join(tmpdir(), 'bq-eb-andie-'));
    try {
      const andie = plantAndie(root, 'andie');
      const ex = Exclusions.load();
      const co = openCheckout({ root: andie, sha: 'deadbeefcafe', repo: 'andie' });
      const kp = (n: number) => ({ text: `point ${n} about the cart total being trusted`, quote: 'sums prices client-side and the server trusts the submitted total' });
      const q = (p: string) => ({ prompt: p, keyPoints: [1, 2, 3, 4, 5].map((n) => ({ ...kp(n), text: `${p} distinct point number ${n} ${'x'.repeat(n * 7)}` })) });
      const questions = [q('Why is the cart total unsafe'), q('Where do credentials leak'), q('What should the server recompute')];
      questions[1]!.keyPoints[0] = { text: 'the verification log carries a token', cite: { path: 'astraupskill/VERIFICATION.md', lineStart: 3, lineEnd: 3 } } as never;
      const item = buildExplainBackItem(co, 'astraupskill/05-PRACTICE.md', questions, { start: 1, end: 9 }, 'draft');
      const v = validateExplainBack(co, ex, readFileSync(join(andie, 'astraupskill', '05-PRACTICE.md'), 'utf8'), item);
      expect(v).toMatchObject({ verdict: 'drop' });
      expect(v.verdict === 'drop' && v.reason).toMatch(/cites astraupskill\/VERIFICATION.md: excluded:andie-verification-token/);
      const r = runExplainBack({ unit: 'astraupskill/VERIFICATION.md', checkout: andie, sha: 'deadbeefcafe', repo: 'andie', out: out('andie') });
      expect(r.refused).toMatch(/unit source astraupskill\/VERIFICATION.md is excluded:andie-verification-token \(leaked-secret\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
