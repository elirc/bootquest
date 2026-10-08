import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatFailures, formatWarnings, validateGuide, validateGuides, validateGuideText } from './report.ts';

const FX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const repo = (name: string) => path.join(FX, name);

describe('real claiufe fixtures resolve (see fixtures/PROVENANCE.md)', () => {
  it('ww6 F-table: 30 citations, all ok, incl. suffix + continuations; 2 inherit warnings', () => {
    const r = validateGuide(repo('ww6'), 'astraupskill/06-SOLUTIONS-AND-REVIEW.md');
    expect(formatFailures(r)).toEqual([]);
    expect(r.summary).toEqual({ total: 30, ok: 30, failed: 0, skipped: 0, warnings: 2 });

    const by = (raw: string) => r.results.filter((x) => x.citation.raw === raw).map((x) => x.verdict);
    // F1: range + comma list
    expect(by('src/lib/http/client.ts:7,31')).toMatchObject([
      { status: 'ok', file: 'src/lib/http/client.ts', lineStart: 7, via: 'root' },
      { status: 'ok', file: 'src/lib/http/client.ts', lineStart: 31, via: 'root' },
    ]);
    // F2: bare filename by unique suffix, then `:12` continuation inherits it
    expect(by('budgetService.ts:18')).toMatchObject([{ status: 'ok', file: 'src/services/budgetService.ts', via: 'suffix' }]);
    expect(by(':12')).toMatchObject([{ status: 'ok', file: 'src/services/budgetService.ts', lineStart: 12 }]);
    // F7: three-entry list
    expect(by('src/services/allocationEngineService.ts:56,79,91')).toHaveLength(3);
    // F13: continuation `:24` on the full-path route.ts
    expect(by(':24')).toMatchObject([{ status: 'ok', file: 'src/app/api/budgets/route.ts', lineStart: 24 }]);

    // F4 `:106-112` is the known misbinding risk: resolves, but is flagged for review
    const warn = formatWarnings(r);
    expect(warn).toHaveLength(2);
    expect(warn.join('\n')).toContain('`:106-112` bound to src/repositories/allocationRunRepository.ts');
  });

  it('j1 numbered prose findings: bare Java names + "line N" continuations, CRLF guide and sources', () => {
    const r = validateGuide(repo('j1'), 'astraupskill/06-SOLUTIONS-AND-REVIEW.md');
    expect(formatFailures(r)).toEqual([]);
    expect(r.summary).toMatchObject({ total: 14, ok: 14, failed: 0 });
    const prose = r.results.filter((x) => x.citation.form === 'prose-line');
    expect(prose.map((x) => [x.citation.raw, x.verdict.status === 'ok' && x.verdict.file, x.citation.lineStart])).toEqual([
      ['line 53', 'src/todo/repository/TaskRepository.java', 53],
      ['line 47', 'src/todo/repository/TaskRepository.java', 47],
    ]);
    // source location points into the guide excerpt (guide line 7 = original line 65)
    expect(prose[0]!.citation.source).toMatchObject({ file: 'astraupskill/06-SOLUTIONS-AND-REVIEW.md', line: 7 });
  });

  it('zz8 answer table: mixed comma+range lists; row-less "line 271" refs dropped as notes', () => {
    const r = validateGuide(repo('zz8'), 'docs/learning/guided-reading-path.md');
    expect(formatFailures(r)).toEqual([]);
    expect(r.summary).toMatchObject({ total: 13, ok: 13, failed: 0 });
    const mixed = r.results.filter((x) => x.citation.raw === 'session.ts:17,22-24');
    expect(mixed.map((x) => x.verdict)).toMatchObject([
      { status: 'ok', file: 'src/lib/auth/session.ts', lineStart: 17, lineEnd: 17, via: 'suffix' },
      { status: 'ok', file: 'src/lib/auth/session.ts', lineStart: 22, lineEnd: 24, via: 'suffix' },
    ]);
    expect(r.notes.map((n) => n.raw)).toEqual(['line 271', 'line 282', 'line 191']);
  });

  it('validateGuides shares one index and sums the summary', () => {
    const { reports, summary } = validateGuides(repo('ww6'), ['astraupskill/06-SOLUTIONS-AND-REVIEW.md', 'astraupskill/CORRUPTED-REVIEW.md']);
    expect(reports).toHaveLength(2);
    expect(summary).toEqual({ total: 38, ok: 32, failed: 6, skipped: 0, warnings: 2 });
  });
});

describe('deliberately corrupted fixture fails', () => {
  it('reports every broken citation with guide location and reason', () => {
    const r = validateGuide(repo('ww6'), path.join(repo('ww6'), 'astraupskill', 'CORRUPTED-REVIEW.md'));
    expect(r.guide).toBe('astraupskill/CORRUPTED-REVIEW.md');
    expect(r.summary).toEqual({ total: 8, ok: 2, failed: 6, skipped: 0, warnings: 0 });
    const fails = formatFailures(r);
    expect(fails[0]).toBe(
      'astraupskill/CORRUPTED-REVIEW.md:7:20 `src/lib/auth/session.ts:13-99` -> line-out-of-range: src/lib/auth/session.ts has 32 lines; cited 13-99',
    );
    expect(fails.filter((f) => f.includes('missing-file'))).toHaveLength(3);
    expect(fails.find((f) => f.includes('ambiguous-suffix'))).toContain('[src/app/api/budgets/route.ts, src/app/api/cost-line-items/route.ts]');
    expect(fails.at(-1)).toMatch(/^astraupskill\/CORRUPTED-REVIEW\.md:10:\d+ `:24` -> orphan-continuation/);
  });
});

describe('report options', () => {
  const text = 'Runtime db `prisma/dev.db` and `src/lib/auth/session.ts`, `src/lib/auth/session.ts:1`.';

  it('ignore whitelist marks citations skipped (not counted in total)', () => {
    const r = validateGuideText(repo('ww6'), 'x.md', text, { ignore: ['dev.db'] });
    expect(r.summary).toEqual({ total: 2, ok: 2, failed: 0, skipped: 1, warnings: 0 });
    const r2 = validateGuideText(repo('ww6'), 'x.md', text, { ignore: [/\.db$/] });
    expect(r2.summary.skipped).toBe(1);
  });

  it('pathOnly: skip leaves only line citations in the gate', () => {
    const r = validateGuideText(repo('ww6'), 'x.md', text, { pathOnly: 'skip' });
    expect(r.summary).toEqual({ total: 1, ok: 1, failed: 0, skipped: 2, warnings: 0 });
  });

  it('without a whitelist the runtime file fails the gate', () => {
    const r = validateGuideText(repo('ww6'), 'x.md', text);
    expect(r.summary).toMatchObject({ total: 3, failed: 1 });
  });
});
