import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../factory/report.ts';

const CLI = join(REPO_ROOT, 'tools', 'seed', 'src', 'ops', 'leak-lint-cli.ts');
const tmp = mkdtempSync(join(tmpdir(), 'bq-leaklint-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
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

  it('the plain lint still runs (an empty estate: no leak, exit 0)', () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/0 explain-back pack\(s\) scanned: 0 leak\(s\)/);
  }, 120_000);
});
