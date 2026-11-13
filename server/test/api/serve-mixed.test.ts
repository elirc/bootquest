import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { explainStartupError, mixedCheckoutRoot } from '../../src/api/serve.ts';

/** R4-19: a checkout whose node_modules resolve into another clone gets a "mixed checkouts" message, never "restamp". */
describe('serve.ts mixed-checkout startup message (R4-19)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const fixture = (mixed: boolean): { root: string; other: string } => {
    const base = mkdtempSync(join(tmpdir(), 'bq-mixed-'));
    dirs.push(base);
    const root = join(base, 'here');
    const other = join(base, 'there');
    mkdirSync(join(root, 'shared'), { recursive: true });
    mkdirSync(join(other, 'shared'), { recursive: true });
    mkdirSync(join(root, 'node_modules', '@bootquest'), { recursive: true });
    symlinkSync(mixed ? join(other, 'shared') : join(root, 'shared'), join(root, 'node_modules', '@bootquest', 'shared'), 'junction');
    return { root, other };
  };
  const refusal = new Error('fingerprint: IMPORT_GATE_FILES names x.ts, which no grader file list binds — run `npm run seed:check -- --restamp` (re-validates every item first)');

  it('mixed: names both roots, says nothing is stale, and drops the restamp advice', () => {
    const { root, other } = fixture(true);
    expect(mixedCheckoutRoot(root)?.toLowerCase()).toBe(other.toLowerCase());
    const msg = (explainStartupError(refusal, root) as Error).message;
    expect(msg).toMatch(/^mixed checkouts: /);
    expect(msg).toContain('do NOT restamp');
    expect(msg).not.toContain('seed:check -- --restamp');
  });

  it('a normal checkout, or any other error, passes through unchanged', () => {
    const { root } = fixture(false);
    expect(mixedCheckoutRoot(root)).toBeNull();
    expect(explainStartupError(refusal, root)).toBe(refusal);
    const other = new Error('port busy');
    expect(explainStartupError(other, fixture(true).root)).toBe(other);
  });
});
