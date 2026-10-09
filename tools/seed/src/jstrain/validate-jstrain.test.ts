import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackValidationStamp } from '@bootquest/shared';
import { readPack } from '@bootquest/server/packs';
import { graderFingerprint } from '@bootquest/server/grader-fingerprint';
import { readJournal } from '../validate/journal.ts';
import { runValidate } from '../validate/validate.ts';
import { importJstrain } from './import.ts';
import type { QuizCapture } from './quiz.ts';

// A tiny jstrain-shaped mirror -> real importer -> real seed:validate (real self-run runner + tsc).

const header = (n: string, name: string, sol: boolean, ts = false) => `// ─────────────────────────────────────────────────────────────────────────
//  ${n} · ${name}${sol ? ' — SOLUTION' : ''}                                    ★☆☆ warm-up
${sol ? '' : '//  concepts: arithmetic\n'}//  run: node ${ts ? '../run.js exercises/' : ''}${n}-${name}.${ts ? 'ts' : 'js'}
// ─────────────────────────────────────────────────────────────────────────
//
${sol ? '//  Walkthrough: multiply.' : '//  Return n doubled.'}
`;
const tests = (divider = 'tests') => `// ──────────────────────────── ${divider} ──────────────────────────────────────

test('doubles', () => {
  eq(double(2), 4);
});

test('doubles zero', () => {
  eq(double(0), 0);
});
`;
const js = (n: string, name: string, impl: string, sol: boolean) =>
  `${header(n, name, sol)}\nimport { test, eq } from '../../_lib/check.js';\n\nexport function double(n) {\n  ${impl}\n}\n\n${tests()}`;
const ts = (n: string, name: string, impl: string, sol: boolean) =>
  `${header(n, name, sol, true)}\nimport { test, eq } from '../../_lib/check.ts';\n\nexport function double(n: number): number {\n  ${impl}\n}\n\n${tests('runtime tests')}`;

const quiz = (answer: string) => `# 01 · Core — basics

---

### Q1 — order

What does this print?

\`\`\`js
process.nextTick(() => console.log('tick'));
Promise.resolve().then(() => console.log('promise'));
console.log('sync');
\`\`\`

<details><summary>Answer</summary>

**${answer}** — CommonJS main: nextTick runs before promise jobs.
</details>

---

### Q2 — explain

Explain the event loop.

<details><summary>Answer</summary>

**It runs tasks.** More.
</details>
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bq-jstrain-val-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

function writeTree(root: string, files: Record<string, string>): string {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, ...rel.split('/'));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

/** capture via the REAL script runner semantics is exercised by the validator; the importer capture is faked */
const capture: QuizCapture = async () => ({ stdout: 'sync\ntick\npromise\n', stderr: '', exitCode: 0, timedOut: false });

async function buildPack(opts: { badSolution?: boolean; huntStarterPasses?: boolean; quizKey?: string; noTs?: boolean } = {}): Promise<string> {
  const src = writeTree(join(dir, 'src'), {
    'bootcamp/01-core/exercises/01-double.js': js('01', 'double', "throw new Error('TODO');", false),
    'bootcamp/01-core/solutions/01-double.js': js('01', 'double', opts.badSolution ? 'return n + 2;' : 'return n * 2;', true),
    'bootcamp/01-core/exercises/02-twice.js': js('02', 'twice', "throw new Error('TODO');", false),
    'bootcamp/01-core/solutions/02-twice.js': js('02', 'twice', 'return n + n;', true),
    'bootcamp/24-debug-hunts/exercises/01-double.js': js('01', 'double', opts.huntStarterPasses ? 'return n * 2;' : 'return n * 2 + (n === 0 ? 1 : 0);', false),
    'bootcamp/24-debug-hunts/solutions/01-double.js': js('01', 'double', 'return n * 2;', true),
    ...(opts.noTs
      ? { 'tsbootcamp/README.md': '# TS\n' }
      : {
          'tsbootcamp/01-types/exercises/01-double.ts': ts('01', 'double', "throw new Error('TODO');", false),
          'tsbootcamp/01-types/solutions/01-double.ts': ts('01', 'double', 'return n * 2;', true),
        }),
    'quizzes/01-core.md': quiz(opts.quizKey ?? '`sync`, `tick`, `promise`'),
  });
  const out = join(dir, 'pack');
  await importJstrain({ sourceDir: src, outDir: out, expected: null, gitHead: null, dirty: null, capture });
  return out;
}

describe('seed:validate on a jstrain pack (selfrun grader kind, real runner + tsc)', () => {
  it('clean pack: every reference passes, starters meet their contract, written = carve-out, stamp bound to selfrun; journal resumes', async () => {
    const pack = await buildPack();
    const journalPath = join(dir, 'journal.jsonl');
    const r = await runValidate({ packDir: pack, journalPath, concurrency: 2 });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.graderKind).toBe('selfrun');
    expect(r.totals.validated).toEqual(r.totals.pack);
    expect(r.totals.pack).toEqual({ total: 6, code: 4, quiz: 0, output: 1, written: 1 });
    expect(r.carveOut).toBe(1);
    expect(r.quarantined).toEqual([]);
    const stamp = PackValidationStamp.parse(JSON.parse(readFileSync(join(pack, 'validation.json'), 'utf8')));
    expect(stamp.graderKind).toBe('selfrun');
    expect(stamp.graderFingerprint).toBe(graderFingerprint('selfrun'));
    expect(stamp.toolchain.typescript).toBe('5.9.3');
    expect(stamp.toolchain.tsx).toMatch(/^\d+\.\d+\.\d+$/);
    // the server's loader accepts the stamped pack (no allowUnstamped)
    expect(readPack(pack).stamp?.passed).toBe(5);
    // journal compat: same schema as the other packs; a re-run resumes everything
    const j = readJournal(journalPath);
    expect(j.skipped).toBe(0);
    expect([...j.entries.values()].map((e) => e.type).sort()).toEqual(['code', 'code', 'code', 'code', 'output', 'written']);
    const again = await runValidate({ packDir: pack, journalPath, concurrency: 2 });
    expect(again.ok).toBe(true);
    expect(again.courses.reduce((n, c) => n + c.executedNow, 0)).toBe(0);
    expect(again.audit.sampled).toBe(5); // every journaled pass re-executed (min 20 sample)
  }, 300_000);

  it('PLANTED-BAD: wrong reference, a hunt starter that already passes, a key contradicting the captured output -> quarantined with reasons, no stamp', async () => {
    const pack = await buildPack({ badSolution: true, huntStarterPasses: true, quizKey: '`sync`, `promise`, `tick`', noTs: true });
    const r = await runValidate({ packDir: pack, journalPath: join(dir, 'journal.jsonl'), concurrency: 2 });
    expect(r.ok).toBe(false);
    expect(existsSync(join(pack, 'validation.json'))).toBe(false);
    const reasons = Object.fromEntries(r.quarantined.map((q) => [q.key, q.reason]));
    expect(Object.keys(reasons).sort()).toEqual(['jstrain/01-core/01-double', 'jstrain/24-debug-hunts/01-double', 'jstrain/quiz-01-core/q01']);
    expect(reasons['jstrain/01-core/01-double']).toMatch(/reference solution fails under the self-run runner/);
    expect(reasons['jstrain/24-debug-hunts/01-double']).toMatch(/vacuous-check/);
    expect(reasons['jstrain/quiz-01-core/q01']).toMatch(/ambiguous-key/);
    expect(r.problems.join('\n')).toMatch(/ceiling/);
  }, 300_000);
});
