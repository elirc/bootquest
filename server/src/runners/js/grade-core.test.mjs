import { describe, it, expect } from 'vitest';
import { gradeCode, runSnippet, normalizeOutput } from './grade-core.mjs';

describe('gradeCode', () => {
  it('passes a correct solution', async () => {
    const r = await gradeCode(
      'export function add(a, b) { return a + b; }',
      'js',
      [{ name: 'adds', code: 'assert.equal(mod.add(2, 3), 5);' }]
    );
    expect(r.pass).toBe(true);
    expect(r.results).toHaveLength(1);
  });

  it('fails a wrong solution with the assertion message', async () => {
    const r = await gradeCode(
      'export function add(a, b) { return a - b; }',
      'js',
      [{ name: 'adds', input: [2, 3], code: 'assert.equal(mod.add(2, 3), 5);' }]
    );
    expect(r.pass).toBe(false);
    expect(r.results[0].message).toBeTruthy();
    expect(r.results[0].input).toBe('[ 2, 3 ]');
    expect(r.results[0].expected).toBe('5');
    expect(r.results[0].actual).toBe('-1');
  });

  it('reports syntax errors as a load failure, not a crash', async () => {
    const r = await gradeCode('export function {', 'js', [
      { name: 'x', code: 'assert.ok(true);' },
    ]);
    expect(r.pass).toBe(false);
    expect(r.results[0].name).toMatch(/loads/);
  });

  it('transpiles TypeScript', async () => {
    const r = await gradeCode(
      'export function id<T>(x: T): T { return x; }',
      'ts',
      [{ name: 'identity', code: "assert.equal(mod.id('a'), 'a');" }]
    );
    expect(r.pass).toBe(true);
  });

  it('reports TS syntax errors cleanly', async () => {
    const r = await gradeCode('const x: = 5', 'ts', [{ name: 'x', code: 'assert.ok(true);' }]);
    expect(r.pass).toBe(false);
  });

  it('times out infinite loops', async () => {
    const r = await gradeCode('while (true) {}', 'js', [{ name: 'x', code: 'assert.ok(true);' }]);
    expect(r.pass).toBe(false);
  }, 15000);

  it('supports async tests', async () => {
    const r = await gradeCode(
      'export async function later() { return 7; }',
      'js',
      [{ name: 'awaits', code: 'const v = await mod.later(); assert.equal(v, 7);' }]
    );
    expect(r.pass).toBe(true);
  });

  it('keeps learner output separate from test results', async () => {
    const r = await gradeCode('console.log("__BOOTFORGE_RESULTS__[]"); export const answer = 1;', 'js', [
      { name: 'correct answer', input: { request: 'answer' }, code: 'assert.equal(mod.answer, 2);' },
    ]);
    expect(r.pass).toBe(false);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].input).toContain('answer');
    expect(r.stdout).toContain('__BOOTFORGE_RESULTS__[]');
  });

  it('preserves export identity through aliases, default objects, and return values', async () => {
    const r = await gradeCode('export const a = () => a; export { a as b }; export default { a };', 'js', [
      { name: 'aliases', code: 'assert.strictEqual(mod.a, mod.b); assert.strictEqual(mod.default.a, mod.a); assert.strictEqual(mod.a(), mod.a);' },
    ]);
    expect(r.pass).toBe(true);
  });

  it('does not mistake an early successful exit for completed tests', async () => {
    const r = await gradeCode('process.exit(0);', 'js', [{ name: 'must run', code: 'assert.fail();' }]);
    expect(r.pass).toBe(false);
    expect(r.results[0].message).toContain('before grading finished');
  });

  it('captures circular values without breaking feedback', async () => {
    const r = await gradeCode('export function value() { const x = {}; x.self = x; return x; }', 'js', [
      { name: 'object shape', code: 'assert.deepStrictEqual(mod.value(), {});' },
    ]);
    expect(r.pass).toBe(false);
    expect(r.results[0].actual).toContain('Circular');
    expect(r.results[0].expected).toBe('{}');
  });
});

describe('runSnippet', () => {
  it('captures stdout', async () => {
    const r = await runSnippet("console.log('a'); console.log(1 + 1);");
    expect(normalizeOutput(r.stdout)).toBe('a\n2');
  });
  it('reports nonzero exits without falsely labeling them timeouts', async () => {
    const r = await runSnippet('process.exit(7);');
    expect(r.exitCode).toBe(7);
    expect(r.timedOut).toBe(false);
  });
});

describe('normalizeOutput', () => {
  it('normalizes CRLF and trailing whitespace', () => {
    expect(normalizeOutput('a  \r\nb\r\n\r\n')).toBe('a\nb');
    expect(normalizeOutput('\n\nx\n')).toBe('x');
  });
});
