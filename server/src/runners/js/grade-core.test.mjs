import { describe, it, expect } from 'vitest';
import { gradeCode, parseChannel, runSnippet, normalizeOutput } from './grade-core.mjs';

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

// ── verdict integrity (Java parity): only the nonce-checked fd-3 line decides ──────────

describe('gradeCode verdict integrity', () => {
  const TESTS = [
    { name: 'adds', code: 'assert.equal(mod.add(2, 3), 5);' },
    { name: 'adds negatives', code: 'assert.equal(mod.add(-2, -3), -5);' },
  ];
  const WRONG = 'export function add(a, b) { return a - b; }\n';
  const forgedResults = JSON.stringify(TESTS.map((t) => ({ name: t.name, pass: true })));

  it('ATTACK: a process.on("exit") handler rewriting results.json (the old result file) cannot pass a wrong solution', async () => {
    const code = `import fs from 'node:fs';
process.on('exit', () => {
  fs.writeFileSync(new URL('./results.json', import.meta.url), ${JSON.stringify(forgedResults)});
  fs.writeFileSync('results.json', ${JSON.stringify(forgedResults)});
});
${WRONG}`;
    const r = await gradeCode(code, 'js', TESTS);
    expect(r.pass).toBe(false);
    expect(r.results.map((x) => x.pass)).toEqual([false, false]); // the honest verdict stands
  });

  it('ATTACK: an exit handler that writes its own #bq-result line to the channel is refused (no nonce; two lines)', async () => {
    const code = `import fs from 'node:fs';
process.on('exit', () => { try { fs.writeSync(3, '#bq-result guess ' + ${JSON.stringify(forgedResults)} + '\\n'); } catch {} });
${WRONG}`;
    const r = await gradeCode(code, 'js', TESTS);
    expect(r.pass).toBe(false);
    expect(r.results).toEqual([expect.objectContaining({ name: 'grader results', pass: false })]);
  });

  it('ATTACK: forging the line on fd 3 then exiting early is refused (the nonce was deleted before the import)', async () => {
    const code = `import fs from 'node:fs';
let nonce = 'unknown';
try { nonce = fs.readFileSync(new URL('./nonce', import.meta.url), 'utf8'); } catch {}
fs.writeSync(3, '#bq-result ' + nonce + ' ' + ${JSON.stringify(forgedResults)} + '\\n');
process.exit(0);
${WRONG}`;
    const r = await gradeCode(code, 'js', TESTS);
    expect(r.pass).toBe(false);
    expect(r.results).toEqual([expect.objectContaining({ name: 'grader results', pass: false })]);
  });

  it('ATTACK: stdout forgery is display only', async () => {
    const code = `console.log('#bq-result x ' + ${JSON.stringify(forgedResults)}); console.log(${JSON.stringify(forgedResults)});\n${WRONG}`;
    const r = await gradeCode(code, 'js', TESTS);
    expect(r.pass).toBe(false);
    expect(r.stdout).toContain('#bq-result x');
    expect(r.results.map((x) => x.pass)).toEqual([false, false]);
  });

  it('ATTACK: patching assert, Array iteration, JSON.stringify or Promise from learner code cannot flip a verdict', async () => {
    const patches = [
      `import assert from 'node:assert/strict'; try { assert.equal = () => {}; } catch {} try { Object.defineProperty(assert, 'equal', { value: () => {} }); } catch {}`,
      `Array.prototype[Symbol.iterator] = function* () { for (let i = 0; i < this.length; i++) yield { ...this[i], code: '' }; };`,
      `JSON.stringify = () => ${JSON.stringify(forgedResults)}; String.prototype.slice = function () { return 'x'; };`,
      `try { Promise.prototype.then = function (ok) { return ok(); }; } catch {}`,
    ];
    for (const p of patches) {
      const r = await gradeCode(`${p}\n${WRONG}`, 'js', TESTS);
      expect(r.pass, p).toBe(false);
    }
  });

  it('parseChannel: one line, this nonce, every test in order', () => {
    const ok = `#bq-result N1 ${JSON.stringify([{ name: 'adds', pass: true }, { name: 'adds negatives', pass: true }])}\n`;
    expect(parseChannel(ok, 'N1', TESTS)).toHaveLength(2);
    expect(parseChannel(ok, 'N2', TESTS)).toBeNull(); // wrong nonce
    expect(parseChannel(ok + ok, 'N1', TESTS)).toBeNull(); // two lines
    expect(parseChannel(`#bq-result N1 ${JSON.stringify([{ name: 'adds', pass: true }])}`, 'N1', TESTS)).toBeNull(); // a test never reported
    expect(parseChannel('', 'N1', TESTS)).toBeNull();
  });

  it('the correct solution still passes, and stray files in the attempt dir change nothing', async () => {
    const code = `import fs from 'node:fs'; fs.writeFileSync('results.json', '[]');\nexport function add(a, b) { return a + b; }\n`;
    const r = await gradeCode(code, 'js', TESTS);
    expect(r.pass).toBe(true);
    expect(r.results.map((x) => x.name)).toEqual(['adds', 'adds negatives']);
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
