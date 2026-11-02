import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../factory/report.ts';

const CLI = join(REPO_ROOT, 'tools', 'seed', 'src', 'ops', 'leak-lint-cli.ts');
const tmp = mkdtempSync(join(tmpdir(), 'bq-leaklint-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const emptyBaseline = join(tmp, 'empty-xleak-baseline.json');
writeFileSync(emptyBaseline, JSON.stringify({ format: 'bootquest-xleak-baseline@1', entries: [] }));
const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', CLI, '--seed-dir', tmp, ...args], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

describe('seed:lint:leaks CLI: EB_LEAK_EXEMPT only shrinks', () => {
  it('never prints an exemption literal to paste back in: --exempt-ids is refused', () => {
    const r = run('--exempt-ids');
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/--exempt-ids was removed: EB_LEAK_EXEMPT only shrinks/);
    expect(r.out).not.toContain('EB_LEAK_EXEMPT = {');
  }, 120_000);

  it('the plain lint still runs (an empty estate and an empty xleak baseline: no leak, exit 0)', () => {
    const r = run('--xleak-baseline', emptyBaseline);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/0 explain-back pack\(s\) scanned: 0 leak\(s\)/);
    expect(r.out).toMatch(/0 key point\(s\): 0 pair\(s\), 0 baselined \(baseline 0\), 0 new, 0 stale, 0 unweighted/);
  }, 120_000);
});

describe('seed:lint:leaks CLI runs the xleak lint (ops/xleak-lint.ts)', () => {
  it('a baseline entry the estate does not hold is stale: exit 1', () => {
    const f = join(tmp, 'one-entry.json');
    writeFileSync(f, JSON.stringify({ format: 'bootquest-xleak-baseline@1', entries: [{ kind: 'EB-note', a: 'eb:p q1.kp1', b: 'note:p/x', aHash: '0', bHash: '0', why: 't' }] }));
    const r = run('--xleak-baseline', f);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/STALE {8}xleak-baseline EB-note eb:p q1\.kp1 ~ note:p\/x: eb:p q1\.kp1 is no longer in the estate/);
    expect(r.out).toMatch(/RESULT XLEAKS/);
  }, 120_000);

  it('PLANTED LEAK: a key point verbatim inside a same-repo note body fails the gate', () => {
    const dir = join(tmp, 'planted');
    const kp = 'The consumer writes the receipt row and the ledger entry inside one transaction, so a crash never leaves a receipt behind.';
    const provenance = { repo: 'r', sha: 'a'.repeat(40), path: 'g.md', lines: { start: 1, end: 2 } };
    const put = (kind: string, pack: string, items: unknown[]) => {
      mkdirSync(join(dir, kind, pack), { recursive: true });
      writeFileSync(join(dir, kind, pack, 'manifest.json'), JSON.stringify({ name: pack, source: { repo: 'r' } }));
      writeFileSync(join(dir, kind, pack, 'items.json'), JSON.stringify({ items }));
    };
    put('explainback', 'r--g.md', [{ kind: 'explain-back', key: 'seed:explainback:r/explain-back/1', provenance, citations: [], questions: [{ prompt: 'Explain.', keyPoints: [{ text: kp }] }] }]);
    put('notes', 'r', [{ kind: 'note', noteId: 'x-q1', provenance, title: 'After q1', body: `Why. ${kp}` }]);
    const r = spawnSync(process.execPath, ['--import', 'tsx', CLI, '--seed-dir', dir, '--xleak-baseline', emptyBaseline], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/XLEAK {8}EB-note 1\.00 n=\d+ eb:r--g\.md q1\.kp1 ~ note:r\/x-q1/);
  }, 120_000);
});
