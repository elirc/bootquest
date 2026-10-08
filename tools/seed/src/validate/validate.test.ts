import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackCourseFile, PackManifest, PackValidationStamp, type PackUnit } from '@bootquest/shared';
import { readPack } from '@bootquest/server/packs';
import type { UnitContentEntry } from '@bootquest/shared/api';
import { bfCourse, codeEx, outputEx, quizEx, sqlEx, writeBfSource, writtenEx } from '../bootforge/fixtures.ts';
import { importBootforge } from '../bootforge/import.ts';
import { appendJournal, readJournal } from './journal.ts';
import { exerciseHash, graderFingerprint, realValidator, runValidate, type UnitValidator } from './validate.ts';

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
    // 3 unjournaled exercises execute; the 2 journaled passes are re-executed by the full-scope audit (F4)
    expect(second.calls).toHaveLength(5);
    expect(new Set(second.calls).size).toBe(5);
    expect(r2.audit).toEqual({ sampled: 2, mismatches: [] });
    expect(r2.ok).toBe(true);
    expect(r2.journalSkippedLines).toBe(1);
    expect(r2.courses[0]).toMatchObject({ resumed: 2, executedNow: 3, passed: 4, carveOut: 1, failed: 0 });
    // the torn line did not swallow the next append
    expect(readJournal(journalPath).entries.size).toBe(5);

    // a complete journal: only the audit sample re-executes (all 4 journaled passes: min 20), counts asserted from the journal
    const third = counting();
    const r3 = await runValidate({ packDir: pack, journalPath, validator: third.validator });
    expect(r3.courses[0]).toMatchObject({ executedNow: 0, resumed: 5 });
    expect(third.calls.sort()).toEqual(['q1', 'q2', 'q3', 'q4'].map((q) => `bootforge/js-fundamentals/m1/l1/${q}`));
    expect(r3.audit).toEqual({ sampled: 4, mismatches: [] });
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
    const r = await runValidate({ packDir: pack, journalPath, validator: again.validator, concurrency: 1 });
    expect(again.calls[0]).toBe(key); // re-validated (then the audit re-executes the 3 other journaled passes)
    expect(r.courses[0]).toMatchObject({ executedNow: 1, resumed: 4 });
    expect(r.audit.sampled).toBe(3);
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
    // F1: quarantine.json persists when empty (a missing file means "never validated" to the loader)
    expect(JSON.parse(readFileSync(join(pack, 'quarantine.json'), 'utf8')).entries).toEqual([]);
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

describe('F3: starter-must-fail on EVERY code drill (vacuous checks are quarantined)', () => {
  it('a plain (unformatted) drill whose untouched starter passes its own tests -> vacuous-check; a normal drill passes', async () => {
    const solution = 'export function add(a, b) {\n  return a + b;\n}';
    const pack = await buildPack([
      bfCourse('js-fundamentals', 1, [
        codeEx('js-fundamentals/m1/l1/normal'),
        // the upstream defect shape (ts-fix-annotations / fetch-unknown): the starter already satisfies every test
        codeEx('js-fundamentals/m1/l1/vacuous', { starter: solution }),
      ]),
    ]);
    const r = await runValidate({ packDir: pack, journalPath: join(dir, 'j.jsonl') });
    expect(r.quarantined.map((q) => q.key)).toEqual(['bootforge/js-fundamentals/m1/l1/vacuous']);
    expect(r.quarantined[0]!.reason).toMatch(/^vacuous-check: the starter of a code exercise passes its own tests \(must fail\)$/);
    expect(r.courses[0]).toMatchObject({ passed: 1, failed: 1 });
  }, 60000);
});

describe('F1: the validation.json stamp (only a clean full-scope run writes it) + the server loader honoring it', () => {
  it('clean full run -> stamp the server loader accepts; a --course run removes it; a failed run leaves none', async () => {
    const pack = await buildPack(fastCourses());
    const journalPath = join(dir, 'j.jsonl');
    const stampPath = join(pack, 'validation.json');
    expect(() => readPack(pack)).toThrow(/no quarantine\.json|no validation stamp/); // never validated -> refused

    const r = await runValidate({ packDir: pack, journalPath });
    expect(r.ok).toBe(true);
    expect(r.stampPath).toBe(stampPath);
    const stamp = PackValidationStamp.parse(JSON.parse(readFileSync(stampPath, 'utf8')));
    expect(stamp).toMatchObject({
      source: 'bootforge',
      manifestSha256: createHash('sha256').update(readFileSync(join(pack, 'manifest.json'))).digest('hex'),
      graderFingerprint: graderFingerprint(),
      toolchain: { node: process.version },
      counts: { total: 5, code: 0, quiz: 4, output: 0, written: 1 },
      executable: 4,
      passed: 4,
      carveOut: 1,
      quarantinedKeys: [],
    });
    expect(readPack(pack).stamp).toEqual(stamp); // the real loader accepts it

    // a --course run never stamps (and removes the old stamp): the loader refuses again
    const rc = await runValidate({ packDir: pack, journalPath, course: 'js-fundamentals' });
    expect(rc.ok).toBe(true);
    expect(rc.stampPath).toBeNull();
    expect(existsSync(stampPath)).toBe(false);
    expect(() => readPack(pack)).toThrow(/no validation stamp/);

    // a failing full run leaves no stamp
    const failing: UnitValidator = async () => ({ verdict: 'fail', reasons: ['planted'], attempts: 1, durationMs: 0 });
    const rf = await runValidate({ packDir: pack, journalPath: join(dir, 'other.jsonl'), validator: failing });
    expect(rf.ok).toBe(false);
    expect(existsSync(stampPath)).toBe(false);
  });

  it('quarantined keys under the ceiling are recorded in the stamp; the loader accepts and withholds them', async () => {
    const quizzes = Array.from({ length: 110 }, (_, i) => quizEx(`js-fundamentals/m1/l1/q${i}`));
    const pack = await buildPack([
      bfCourse('js-fundamentals', 1, [...quizzes, codeEx('js-fundamentals/m1/l1/vacuous', { starter: 'export function add(a, b) { return a + b; }' })]),
    ]);
    const r = await runValidate({ packDir: pack, journalPath: join(dir, 'j.jsonl') });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    const key = 'bootforge/js-fundamentals/m1/l1/vacuous';
    const loaded = readPack(pack);
    expect(loaded.stamp!.quarantinedKeys).toEqual([key]);
    expect([...loaded.quarantined.keys()]).toEqual([key]);
  }, 60000);
});

describe('F4: a forged journal is caught by the gating run', () => {
  it('forged pass lines with correctly computed hashes -> the audit re-executes them, journal distrusted, exit nonzero, no stamp', async () => {
    const pack = await buildPack([
      bfCourse('js-fundamentals', 1, [
        codeEx('js-fundamentals/m1/l1/good'),
        // the reference solution is WRONG: a real run quarantines it
        codeEx('js-fundamentals/m1/l1/broken', { solution: 'export function add(a, b) {\n  return a - b;\n}' }),
        quizEx('js-fundamentals/m1/l1/q'),
      ]),
    ]);
    const journalPath = join(dir, 'forged.jsonl');
    const file = PackCourseFile.parse(JSON.parse(readFileSync(join(pack, 'js-fundamentals.json'), 'utf8')));
    for (const pu of file.units) {
      appendJournal(journalPath, {
        key: pu.unit.key,
        course: 'js-fundamentals',
        type: pu.origin.type,
        hash: exerciseHash(pu, file.content[pu.unit.key]!, graderFingerprint()),
        verdict: 'pass',
        reasons: [],
        attempts: 1,
        durationMs: 1,
        at: '2026-10-07T00:00:00.000Z',
      });
    }
    const r = await runValidate({ packDir: pack, journalPath });
    expect(r.courses[0]).toMatchObject({ executedNow: 0, resumed: 3 });
    expect(r.audit.sampled).toBe(3); // fewer than 20 journaled passes: all of them
    expect(r.audit.mismatches).toEqual(['bootforge/js-fundamentals/m1/l1/broken']);
    expect(r.problems.join('\n')).toMatch(/journal distrusted: 1 of 3 re-executed journaled passes did not pass/);
    expect(r.ok).toBe(false);
    expect(existsSync(join(pack, 'validation.json'))).toBe(false);
    // the real verdict now supersedes the forged line
    expect(readJournal(journalPath).entries.get('bootforge/js-fundamentals/m1/l1/broken')!.verdict).toBe('fail');
  }, 60000);
});

describe('F8: a malformed quarantine.json is a hard error, never silently reset', () => {
  it('a --course run (and a full run) refuses and leaves the file byte-identical', async () => {
    const pack = await buildPack(fastCourses());
    const qPath = join(pack, 'quarantine.json');
    const conflicted = '<<<<<<< HEAD\n{"format":"bootquest-pack@1","source":"bootforge","entries":[{"key":"bootforge/other/m/l/x","course":"other","reason":"r"}]}\n=======\n';
    writeFileSync(qPath, conflicted);
    for (const course of ['js-fundamentals', undefined]) {
      const r = await runValidate({ packDir: pack, journalPath: join(dir, 'j.jsonl'), ...(course ? { course } : {}) });
      expect(r.ok).toBe(false);
      expect(r.problems.join('\n')).toMatch(/quarantine\.json is malformed.*refusing to rewrite it/);
      expect(readFileSync(qPath, 'utf8')).toBe(conflicted);
      expect(existsSync(join(pack, 'validation.json'))).toBe(false);
    }
  });
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
