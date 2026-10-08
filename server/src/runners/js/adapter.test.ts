import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, type JsExercise } from './index';
import { gradeCode } from './grade-core.mjs';

const addExercise: JsExercise = {
  id: 'add',
  language: 'js',
  tests: [
    { name: 'adds positives', input: [2, 3], code: 'assert.equal(mod.add(2, 3), 5);' },
    { name: 'adds negatives', input: [-1, -1], code: 'assert.equal(mod.add(-1, -1), -2);' },
  ],
};

/** PIDs of running node.exe processes, via tasklist (Windows) — direct exec, no shell. */
function nodePids(): Set<number> {
  const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq node.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  const pids = new Set<number>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^"node\.exe","(\d+)"/i.exec(line.trim());
    if (m) pids.add(Number(m[1]));
  }
  return pids;
}

describe('js runner adapter', () => {
  it('passes a correct submission', async () => {
    const r = await run(addExercise, { code: 'export function add(a, b) { console.log("hi"); return a + b; }' });
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.output).toContain('hi');
    expect(r.durationMs).toBeGreaterThan(0);
  });

  it('reports structured failures with expected/actual', async () => {
    const r = await run(addExercise, { code: 'export function add(a, b) { return a - b; }' });
    expect(r.pass).toBe(false);
    expect(r.failures).toHaveLength(2);
    expect(r.failures[0]).toMatchObject({ name: 'adds positives', expected: '5', actual: '-1', input: '[ 2, 3 ]' });
    expect(r.failures[0].message).toBeTruthy();
    expect(r.failures[1]).toMatchObject({ name: 'adds negatives', expected: '-2', actual: '0' });
  });

  it('transpiles and grades a TypeScript submission', async () => {
    const ex: JsExercise = {
      language: 'ts',
      tests: [{ name: 'typed sum', code: 'assert.equal(mod.sum([1, 2, 3]), 6);' }],
    };
    const ok = await run(ex, { code: 'interface Bag { n: number }\nexport function sum(xs: number[]): number { return xs.reduce((a: number, b: number) => a + b, 0); }' });
    expect(ok.pass).toBe(true);
    const bad = await run(ex, { code: 'export function sum(xs: number[]): number { return xs.length; }' });
    expect(bad.pass).toBe(false);
    expect(bad.failures[0]).toMatchObject({ name: 'typed sum', expected: '6', actual: '3' });
    const broken = await run(ex, { code: 'const x: = 5' });
    expect(broken.pass).toBe(false);
    expect(broken.failures[0].name).toBe('TypeScript compiles');
  });

  it('kills an infinite loop on timeout, reports failure, leaves no zombie node process', async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-p1-adapter-'));
    const infoFile = path.join(scratch, 'child.json').replace(/\\/g, '/');
    try {
      const before = nodePids();
      const code = `import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(infoFile)}, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
while (true) {}
export const never = 1;`;
      const r = await run({ language: 'js', tests: [{ name: 'x', code: 'assert.ok(true);' }] }, { code });
      expect(r.pass).toBe(false);
      expect(r.failures).toHaveLength(1);
      expect(r.failures[0].name).toBe('finishes in time');
      expect(r.failures[0].message).toMatch(/Timed out/);
      expect(r.durationMs).toBeGreaterThanOrEqual(7000);

      const child = JSON.parse(fs.readFileSync(infoFile, 'utf8')) as { pid: number; cwd: string };
      // Give Windows a moment to reap the terminated process.
      await new Promise((res) => setTimeout(res, 500));
      const after = nodePids();
      expect(before.has(child.pid)).toBe(false); // it really was a new child
      expect(after.has(child.pid)).toBe(false); // ...and it is gone now
      expect(fs.existsSync(child.cwd)).toBe(false); // grader temp dir cleaned up
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }, 30000);

  it('ignores ExperimentalWarning-style stderr when deciding pass/fail', async () => {
    const ex: JsExercise = {
      language: 'js',
      tests: [{
        name: 'sqlite query',
        code: `const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1), (2);');
const rows = db.prepare(mod.query).all().map((r) => ({ ...r }));
assert.deepStrictEqual(rows, [{ total: 3 }]);`,
      }],
    };
    // Real node:sqlite use: the warning is suppressed by the child flag and the test passes.
    const real = await run(ex, { code: "export const query = 'SELECT SUM(n) AS total FROM t';" });
    expect(real.pass).toBe(true);
    const raw = await gradeCode("export const query = 'SELECT SUM(n) AS total FROM t';", 'js', ex.tests);
    expect(raw.pass).toBe(true);
    expect(raw.stderr ?? '').not.toMatch(/ExperimentalWarning/);

    // Learner code writing the warning text to stderr must not change pass/fail either way.
    const noisy = "console.error('(node:1234) ExperimentalWarning: SQLite is an experimental feature and might change at any time');\n";
    const passNoisy = await run(ex, { code: noisy + "export const query = 'SELECT SUM(n) AS total FROM t';" });
    expect(passNoisy.pass).toBe(true);
    expect(passNoisy.failures).toEqual([]);
    const failNoisy = await run(ex, { code: noisy + "export const query = 'SELECT COUNT(n) AS total FROM t';" });
    expect(failNoisy.pass).toBe(false);
    expect(failNoisy.failures[0]).toMatchObject({ name: 'sqlite query' });
  });
});
