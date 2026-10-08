import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackManifest, type PackUnit } from '@bootquest/shared';
import type { UnitContentEntry } from '@bootquest/shared/api';
import { bfCourse, codeEx, outputEx, quizEx, sqlEx, writeBfSource, writtenEx } from '../bootforge/fixtures.ts';
import { importBootforge } from '../bootforge/import.ts';
import { appendJournal, readJournal } from './journal.ts';
import { realValidator, runValidate, type UnitValidator } from './validate.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
const CLI = join(REPO, 'tools', 'seed', 'src', 'validate', 'cli.ts');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bq-validate-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

/** Build a pack through the real importer from BootForge-format fixtures. */
async function buildPack(courses: Record<string, unknown>[]): Promise<string> {
  writeBfSource(join(dir, 'src'), courses);
  const out = join(dir, 'pack');
  await importBootforge({ sourceDir: join(dir, 'src'), outDir: out, expected: null });
  return out;
}

/** Fast, process-free courses: quizzes + a written carve-out. */
const fastCourses = () => [
  bfCourse('js-fundamentals', 1, [
    quizEx('js-fundamentals/m1/l1/q1'),
    quizEx('js-fundamentals/m1/l1/q2', { answerIndex: 0 }),
    quizEx('js-fundamentals/m1/l1/q3', { answerIndex: 2 }),
    writtenEx('js-fundamentals/m1/l1/w1'),
    quizEx('js-fundamentals/m1/l1/q4'),
  ]),
];

function counting(): { validator: UnitValidator; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    validator: async (pu: PackUnit, c: UnitContentEntry) => {
      calls.push(pu.unit.key);
      return realValidator(pu, c);
    },
  };
}

describe('seed:validate journal (resumable sweep)', () => {
  it('an interrupted sweep resumes from the journal: only unjournaled exercises run again', async () => {
    const pack = await buildPack(fastCourses());
    const journalPath = join(dir, 'j', 'journal.jsonl');
    const first = counting();
    const r1 = await runValidate({ packDir: pack, journalPath, validator: first.validator, concurrency: 1 });
    expect(r1.ok).toBe(true);
    expect(first.calls).toHaveLength(5);

    // simulate a kill mid-sweep: keep 2 complete lines + a torn third line
    const lines = readFileSync(journalPath, 'utf8').trim().split('\n');
    writeFileSync(journalPath, `${lines[0]}\n${lines[1]}\n${lines[2]!.slice(0, 25)}`);
    expect(readJournal(journalPath).entries.size).toBe(2);

    const second = counting();
    const r2 = await runValidate({ packDir: pack, journalPath, validator: second.validator, concurrency: 1 });
    expect(second.calls).toHaveLength(3);
    expect(r2.ok).toBe(true);
    expect(r2.journalSkippedLines).toBe(1);
    expect(r2.courses[0]).toMatchObject({ resumed: 2, executedNow: 3, passed: 4, carveOut: 1, failed: 0 });
    // the torn line did not swallow the next append
    expect(readJournal(journalPath).entries.size).toBe(5);

    // a complete journal: nothing runs, counts still asserted from the journal
    const third = counting();
    const r3 = await runValidate({ packDir: pack, journalPath, validator: third.validator });
    expect(third.calls).toEqual([]);
    expect(r3.ok).toBe(true);
    expect(r3.totals.validated).toEqual({ total: 5, code: 0, quiz: 4, output: 0, written: 1 });
  });

  it('a journal entry whose exercise bytes changed is re-validated (hash-bound)', async () => {
    const pack = await buildPack(fastCourses());
    const journalPath = join(dir, 'journal.jsonl');
    await runValidate({ packDir: pack, journalPath });
    const j = readJournal(journalPath).entries;
    const key = 'bootforge/js-fundamentals/m1/l1/q2';
    // forge a stale entry for q2 claiming 'fail' under an old hash: it must not count
    appendJournal(journalPath, { ...j.get(key)!, hash: 'f'.repeat(64), verdict: 'fail', reasons: ['stale'] });
    const again = counting();
    const r = await runValidate({ packDir: pack, journalPath, validator: again.validator });
    expect(again.calls).toEqual([key]);
    expect(r.ok).toBe(true);
  });

  it('--retry-failed re-runs journaled failures; --fresh ignores the journal', async () => {
    const pack = await buildPack(fastCourses());
    const journalPath = join(dir, 'journal.jsonl');
    const failing: UnitValidator = async () => ({ verdict: 'fail', reasons: ['planted'], attempts: 1, durationMs: 0 });
    const r1 = await runValidate({ packDir: pack, journalPath, validator: failing });
    expect(r1.ok).toBe(false);
    expect(r1.quarantined).toHaveLength(5);
    const plain = counting();
    await runValidate({ packDir: pack, journalPath, validator: plain.validator });
    expect(plain.calls).toEqual([]); // failures are final unless asked
    const retry = counting();
    const r2 = await runValidate({ packDir: pack, journalPath, validator: retry.validator, retryFailed: true });
    expect(retry.calls).toHaveLength(5);
    expect(r2.ok).toBe(true);
    expect(existsSync(join(pack, 'quarantine.json'))).toBe(false); // cleared once nothing is quarantined
    const fresh = counting();
    await runValidate({ packDir: pack, journalPath, validator: fresh.validator, fresh: true });
    expect(fresh.calls).toHaveLength(5);
  });
});

describe('seed:validate real validator (BootQuest runners)', () => {
  it('passes a correct pack of every type: drill (incl. SQL via node:sqlite), quiz, predict (js + ts), written carve-out', async () => {
    const pack = await buildPack([
      bfCourse('js-fundamentals', 1, [
        codeEx('js-fundamentals/m1/l1/add'),
        sqlEx('js-fundamentals/m1/l1/sql'),
        quizEx('js-fundamentals/m1/l1/q'),
        outputEx('js-fundamentals/m1/l1/o', 'for (const x of [1, 2]) console.log(x * 10);', '10\n20'),
        outputEx('js-fundamentals/m1/l1/ots', 'const s: string = "ts";\nconsole.log(s.toUpperCase());', 'TS'),
        writtenEx('js-fundamentals/m1/l1/w'),
      ]),
    ]);
    const r = await runValidate({ packDir: pack, journalPath: join(dir, 'j.jsonl') });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.courses[0]).toMatchObject({ passed: 5, carveOut: 1, failed: 0 });
    expect(r.executable).toBe(5);
  }, 60000);

  it('quarantines a wrong predicted output, a multi-keyed quiz and a formatted exercise whose starter already passes', async () => {
    const pack = await buildPack([
      bfCourse('js-fundamentals', 1, [
        outputEx('js-fundamentals/m1/l1/o-wrong', 'console.log(2 + 2);', '5'),
        codeEx('js-fundamentals/m1/l1/starter-passes', { format: 'debugging', starter: 'export function add(a, b) { return a + b; }' }),
      ]),
    ]);
    const r = await runValidate({ packDir: pack, journalPath: join(dir, 'j.jsonl') });
    expect(r.ok).toBe(false);
    const reasons = Object.fromEntries(r.quarantined.map((q) => [q.key.split('/').pop(), q.reason]));
    expect(reasons['o-wrong']).toMatch(/does not reproduce the expected output/);
    expect(reasons['starter-passes']).toMatch(/starter of a debugging exercise passes/);
  }, 60000);
});

describe('PLANTED-BAD negative test: the seed:validate CLI exits nonzero with the right reasons', () => {
  it('wrong reference solution + mismatched manifest count → exit 1, reasons reported, QUARANTINE.md written', async () => {
    const pack = await buildPack([
      bfCourse('js-fundamentals', 1, [
        codeEx('js-fundamentals/m1/l1/good'),
        // PLANTED: the reference solution subtracts
        codeEx('js-fundamentals/m1/l1/planted-wrong', { solution: 'export function add(a, b) {\n  return a - b;\n}' }),
        quizEx('js-fundamentals/m1/l1/q'),
      ]),
    ]);
    // PLANTED: the manifest claims one more code exercise than the pack file holds
    const mPath = join(pack, 'manifest.json');
    const m = PackManifest.parse(JSON.parse(readFileSync(mPath, 'utf8')));
    m.courses[0]!.counts = { ...m.courses[0]!.counts, total: 4, code: 3 };
    m.totals = { ...m.courses[0]!.counts };
    writeFileSync(mPath, JSON.stringify(m, null, 1));

    const journal = join(dir, 'journal.jsonl');
    const res = spawnSync(process.execPath, ['--import', 'tsx', CLI, '--pack', pack, '--journal', journal], {
      cwd: REPO,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
    });
    const out = `${res.stdout}\n${res.stderr}`;
    expect(res.status, out).toBe(1);
    expect(out).toMatch(/QUARANTINED bootforge\/js-fundamentals\/m1\/l1\/planted-wrong \[code\]: reference solution fails under the drill-js runner: add\(2, 3\) → 5/);
    expect(out).toMatch(/PROBLEM js-fundamentals: count mismatch — importer\/manifest 4 \(code 3 .* vs pack file 3 \(code 2/);
    expect(out).toMatch(/PROBLEM counts disagree: importer 4 .* \/ pack 3 .* \/ validated 3/);
    expect(out).toMatch(/PROBLEM quarantined 1\/3 executable = 33\.33% > ceiling 1%/);
    expect(out).toMatch(/RESULT FAIL/);
    expect(out).not.toMatch(/QUARANTINED .*\/good/);
    const md = readFileSync(join(pack, 'QUARANTINE.md'), 'utf8');
    expect(md).toContain('bootforge/js-fundamentals/m1/l1/planted-wrong');
    expect(JSON.parse(readFileSync(join(pack, 'quarantine.json'), 'utf8')).entries).toHaveLength(1);
  }, 120000);

  it('the same CLI exits 0 on the corrected pack (the negative test is not vacuous)', async () => {
    const pack = await buildPack([bfCourse('js-fundamentals', 1, [codeEx('js-fundamentals/m1/l1/good'), quizEx('js-fundamentals/m1/l1/q')])]);
    const res = spawnSync(process.execPath, ['--import', 'tsx', CLI, '--pack', pack, '--journal', join(dir, 'j.jsonl')], {
      cwd: REPO,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
    });
    expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
    expect(res.stdout).toMatch(/RESULT OK/);
  }, 120000);

  it('a pack file edited after import is reported (sha256 mismatch)', async () => {
    const pack = await buildPack(fastCourses());
    const f = join(pack, 'js-fundamentals.json');
    appendFileSync(f, ' ');
    const r = await runValidate({ packDir: pack, journalPath: join(dir, 'j.jsonl') });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/sha256 .* != manifest/);
    expect(createHash('sha256').update(readFileSync(f)).digest('hex')).not.toBe(PackManifest.parse(JSON.parse(readFileSync(join(pack, 'manifest.json'), 'utf8'))).courses[0]!.sha256);
  });
});
