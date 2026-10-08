import { createHash, randomInt } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  countPackUnits,
  PACK_FORMAT,
  PackCourseFile,
  PackManifest,
  PackQuarantine,
  PackValidationStamp,
  type PackCounts,
  type PackOriginType,
  type PackUnit,
} from '@bootquest/shared';
import type { CanonicalRunResult, UnitContentEntry } from '@bootquest/shared/api';
import { normalizeOutput, runSnippet } from '@bootquest/server/grade-core';
import { graderFingerprint, toolchainVersions } from '@bootquest/server/grader-fingerprint';
import { drillJsRunner, gradeDeterministic } from '@bootquest/server/runners';
import { appendJournal, readJournal, type JournalEntry, type JournalVerdict } from './journal.ts';

/**
 * seed:validate — the import gate (spec §3.1/§7): every imported reference
 * solution is executed under BootQuest's OWN runners; failures are quarantined
 * (never shipped, never "fixed" by weakening tests).
 *   drill-js       reference solution through the server's drill-js runner
 *                  adapter (the exact code path POST /submit uses) must pass;
 *                  a timeout flake is retried once; EVERY drill's starter
 *                  must FAIL its own tests: a starter that passes is a
 *                  vacuous check (the untouched starter would earn a pass),
 *                  quarantined with reason 'vacuous-check' (W2b/F3)
 *   quiz           single-keyed: the key passes the deterministic grader and
 *                  every other choice fails
 *   predict-output the expected output passes the grader, a perturbed one
 *                  fails, and re-running the snippet reproduces it exactly
 *   written        schema-validated only: counted carve-out (no check exists)
 * Counts: importer (manifest) === pack (course files) === validated (journal),
 * and on a full run also === the expected census. Quarantine ceiling: 1% of
 * executable exercises in the run's scope.
 * Full-scope (gating) runs also re-execute a random sample of journaled passes
 * (2%, min 20): any disagreement means the journal is distrusted (W2b/F4).
 * Only a full-scope run with zero problems writes the validation.json stamp the
 * server's pack loader requires; every other run removes it (W2b/F1).
 * quarantine.json is always written (even empty); a malformed one is a hard
 * error and is never rewritten (W2b/F8).
 */

export const QUARANTINE_CEILING = 0.01;

export const AUDIT_RATE = 0.02;
export const AUDIT_MIN = 20;

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
export const DEFAULT_JOURNAL_DIR = join(REPO, '.seed-journal');
/**
 * Journal entries + the stamp are bound to the grader + validator bytes AND the
 * node / esbuild versions (F5): changing any of them re-validates everything.
 * Computed by the server so the pack loader checks the very same value.
 */
export { graderFingerprint };

export function exerciseHash(pu: PackUnit, content: UnitContentEntry, fingerprint: string): string {
  return createHash('sha256').update(JSON.stringify({ u: pu, c: content, g: fingerprint })).digest('hex');
}

export interface UnitVerdict {
  verdict: JournalVerdict;
  reasons: string[];
  attempts: number;
  durationMs: number;
}

export type UnitValidator = (pu: PackUnit, content: UnitContentEntry) => Promise<UnitVerdict>;

const isTimeout = (r: CanonicalRunResult): boolean => r.failures.some((f) => f.name === 'finishes in time');
const describeFailures = (r: CanonicalRunResult): string =>
  r.failures
    .map((f) => `${f.name}: ${f.message}`.replace(/\s+/g, ' ').trim())
    .join(' | ')
    .slice(0, 600);

/** The real validator: BootQuest's own runners, no shortcuts. */
export const realValidator: UnitValidator = async (pu, content) => {
  const started = performance.now();
  const reasons: string[] = [];
  let attempts = 0;
  const spec = pu.unit.checks[0]?.spec;
  const done = (verdict: JournalVerdict): UnitVerdict => ({
    verdict,
    reasons,
    attempts,
    durationMs: Math.round(performance.now() - started),
  });

  if (pu.origin.type === 'written') {
    if (spec) reasons.push('written unit must not carry a check');
    if (!content.solution?.trim()) reasons.push('written unit has no model answer');
    if (!content.rubric?.length) reasons.push('written unit has no rubric');
    if (!content.instructions?.trim()) reasons.push('written unit has no instructions');
    return done(reasons.length ? 'fail' : 'carve-out');
  }
  if (!spec) {
    reasons.push(`${pu.origin.type} unit has no check`);
    return done('fail');
  }
  if (!content.instructions?.trim()) reasons.push('no instructions');

  if (spec.type === 'drill-js') {
    if (!content.solution) {
      reasons.push('no reference solution');
      return done('fail');
    }
    const grade = async (code: string): Promise<CanonicalRunResult> => {
      attempts++;
      let r = await drillJsRunner(spec, { code });
      if (!r.pass && isTimeout(r)) {
        attempts++; // timeout flake: retry once before calling it a failure
        r = await drillJsRunner(spec, { code });
      }
      return r;
    };
    const ref = await grade(content.solution);
    if (!ref.pass) reasons.push(`reference solution fails under the drill-js runner: ${describeFailures(ref)}`);
    // F3: starter-must-fail on EVERY code drill (not only formatted ones)
    const starter = await grade(content.starter ?? '');
    if (starter.pass) reasons.push(`vacuous-check: the starter of a ${pu.origin.format ?? 'code'} exercise passes its own tests (must fail)`);
    return done(reasons.length ? 'fail' : 'pass');
  }

  if (spec.type === 'quiz') {
    if (spec.grading !== 'choice' || typeof spec.answerKey !== 'number' || !spec.choices) {
      reasons.push('quiz must be a single-keyed choice item');
      return done('fail');
    }
    if (spec.answerKey >= spec.choices.length) reasons.push(`answerKey ${spec.answerKey} out of range (${spec.choices.length} choices)`);
    if (new Set(spec.choices).size !== spec.choices.length) reasons.push('duplicate choices (not single-keyed)');
    attempts++;
    if (!gradeDeterministic(spec, { answer: spec.answerKey })?.pass) reasons.push('the answer key does not pass the quiz grader');
    const alsoPass = spec.choices.map((_, i) => i).filter((i) => i !== spec.answerKey && gradeDeterministic(spec, { answer: i })?.pass);
    if (alsoPass.length) reasons.push(`choices ${alsoPass.join(',')} also pass (not single-keyed)`);
    return done(reasons.length ? 'fail' : 'pass');
  }

  if (spec.type === 'predict-output') {
    attempts++;
    if (!gradeDeterministic(spec, { answer: spec.expected })?.pass) reasons.push('the expected output does not pass the predict grader');
    if (gradeDeterministic(spec, { answer: `${spec.expected}\n<<perturbed>>` })?.pass) reasons.push('a perturbed prediction passes');
    if (!normalizeOutput(spec.expected)) reasons.push('expected output is empty after normalization');
    if (spec.language === 'cs') {
      reasons.push('no snippet runner for cs');
    } else if (!content.snippet) {
      reasons.push('no snippet');
    } else {
      attempts++;
      let r = await runSnippet(content.snippet, spec.language);
      if (r.timedOut) {
        attempts++;
        r = await runSnippet(content.snippet, spec.language);
      }
      if (r.timedOut) reasons.push('snippet timed out (twice)');
      else if (r.exitCode !== 0) reasons.push(`snippet exited ${String(r.exitCode)}: ${(r.stderr || r.error || '').slice(0, 300)}`);
      else if (normalizeOutput(r.stdout) !== normalizeOutput(spec.expected)) {
        reasons.push(`re-running the snippet does not reproduce the expected output (got ${JSON.stringify(normalizeOutput(r.stdout).slice(0, 200))})`);
      }
    }
    return done(reasons.length ? 'fail' : 'pass');
  }

  reasons.push(`unsupported check type ${spec.type} for an imported pack`);
  return done('fail');
};

export interface CourseReport {
  id: string;
  importer: PackCounts;
  pack: PackCounts | null;
  validated: PackCounts;
  passed: number;
  failed: number;
  carveOut: number;
  executedNow: number;
  resumed: number;
}

export interface QuarantineEntry {
  key: string;
  course: string;
  type: PackOriginType;
  reason: string;
}

export interface ValidateReport {
  ok: boolean;
  scope: 'all' | string;
  problems: string[];
  courses: CourseReport[];
  totals: { importer: PackCounts; pack: PackCounts; validated: PackCounts };
  expected: PackCounts | null;
  executable: number;
  carveOut: number;
  /** quarantined exercises within the run's scope */
  quarantined: QuarantineEntry[];
  journalSkippedLines: number;
  /** F4: journaled passes re-executed by a full-scope run (keys whose verdict disagreed) */
  audit: { sampled: number; mismatches: string[] };
  /** path of the validation.json written by this run (full scope + ok only), else null */
  stampPath: string | null;
}

export interface ValidateOptions {
  packDir: string;
  course?: string;
  journalPath: string;
  concurrency?: number;
  /** re-run journal entries whose verdict was 'fail' */
  retryFailed?: boolean;
  /** ignore the journal (still appends to it) */
  fresh?: boolean;
  validator?: UnitValidator;
  log?: (line: string) => void;
}

const zero = (): PackCounts => ({ total: 0, code: 0, quiz: 0, output: 0, written: 0 });
const add = (a: PackCounts, b: PackCounts): void => {
  for (const k of Object.keys(a) as (keyof PackCounts)[]) a[k] += b[k];
};
const same = (a: PackCounts, b: PackCounts): boolean => JSON.stringify(a) === JSON.stringify(b);
const fmt = (c: PackCounts): string => `${c.total} (code ${c.code} / quiz ${c.quiz} / output ${c.output} / written ${c.written})`;

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function runValidate(opts: ValidateOptions): Promise<ValidateReport> {
  const log = opts.log ?? (() => {});
  const validator = opts.validator ?? realValidator;
  const fingerprint = graderFingerprint();
  const problems: string[] = [];
  const report: ValidateReport = {
    ok: false,
    scope: opts.course ?? 'all',
    problems,
    courses: [],
    totals: { importer: zero(), pack: zero(), validated: zero() },
    expected: null,
    executable: 0,
    carveOut: 0,
    quarantined: [],
    journalSkippedLines: 0,
    audit: { sampled: 0, mismatches: [] },
    stampPath: null,
  };
  const stampFile = join(opts.packDir, 'validation.json');
  // any run that does not end in a fresh stamp leaves NO stamp: the loader then refuses the pack
  rmSync(stampFile, { force: true });

  let manifest: PackManifest;
  let manifestBytes: Buffer;
  try {
    manifestBytes = readFileSync(join(opts.packDir, 'manifest.json'));
    manifest = PackManifest.parse(JSON.parse(manifestBytes.toString('utf8')));
  } catch (err) {
    problems.push(`manifest.json unreadable/invalid: ${err instanceof Error ? err.message : String(err)}`);
    return report;
  }
  // F8: a malformed quarantine.json is a hard error up front, never silently reset
  try {
    readQuarantineFile(opts.packDir);
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
    return report;
  }
  report.expected = manifest.expected;
  const scope = opts.course ? manifest.courses.filter((c) => c.id === opts.course) : [...manifest.courses];
  if (opts.course && scope.length === 0) {
    problems.push(`unknown course ${opts.course} (manifest has ${manifest.courses.map((c) => c.id).join(', ')})`);
    return report;
  }
  scope.sort((a, b) => a.order - b.order);

  const journal = opts.fresh ? { entries: new Map<string, JournalEntry>(), skipped: 0 } : readJournal(opts.journalPath);
  report.journalSkippedLines = journal.skipped;
  /** passes taken from the journal without executing them in this run (F4 audit population) */
  const resumedPasses: { pu: PackUnit; content: UnitContentEntry; hash: string; course: string }[] = [];

  for (const mc of scope) {
    const cr: CourseReport = { id: mc.id, importer: mc.counts, pack: null, validated: zero(), passed: 0, failed: 0, carveOut: 0, executedNow: 0, resumed: 0 };
    report.courses.push(cr);
    add(report.totals.importer, mc.counts);
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(opts.packDir, mc.file));
    } catch {
      problems.push(`${mc.id}: pack file ${mc.file} missing`);
      continue;
    }
    const actualSha = createHash('sha256').update(bytes).digest('hex');
    if (actualSha !== mc.sha256) problems.push(`${mc.id}: pack file sha256 ${actualSha} != manifest ${mc.sha256} (edited after import?)`);
    const parsed = PackCourseFile.safeParse(JSON.parse(bytes.toString('utf8')));
    if (!parsed.success) {
      problems.push(`${mc.id}: pack file fails the pack schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      continue;
    }
    const file = parsed.data;
    cr.pack = countPackUnits(file.units);
    add(report.totals.pack, cr.pack);
    if (!same(cr.pack, mc.counts)) {
      problems.push(`${mc.id}: count mismatch — importer/manifest ${fmt(mc.counts)} vs pack file ${fmt(cr.pack)}`);
    }

    const work: { pu: PackUnit; content: UnitContentEntry; hash: string }[] = [];
    const current = new Map<string, string>();
    for (const pu of file.units) {
      const content = file.content[pu.unit.key]!;
      const hash = exerciseHash(pu, content, fingerprint);
      current.set(pu.unit.key, hash);
      const prior = journal.entries.get(pu.unit.key);
      const reusable = prior && prior.hash === hash && !(opts.retryFailed && prior.verdict === 'fail');
      if (reusable) {
        cr.resumed++;
        if (prior.verdict === 'pass') resumedPasses.push({ pu, content, hash, course: mc.id });
      } else work.push({ pu, content, hash });
    }
    log(`[${mc.id}] ${file.units.length} exercises: ${cr.resumed} already journaled, ${work.length} to run`);

    let doneCount = 0;
    await pool(work, opts.concurrency ?? 4, async ({ pu, content, hash }) => {
      let v: UnitVerdict;
      try {
        v = await validator(pu, content);
      } catch (err) {
        v = { verdict: 'fail', reasons: [`validator crashed: ${err instanceof Error ? err.message : String(err)}`], attempts: 0, durationMs: 0 };
      }
      const entry: JournalEntry = {
        key: pu.unit.key,
        course: mc.id,
        type: pu.origin.type,
        hash,
        verdict: v.verdict,
        reasons: v.reasons,
        attempts: v.attempts,
        durationMs: v.durationMs,
        at: new Date().toISOString(),
      };
      appendJournal(opts.journalPath, entry);
      journal.entries.set(entry.key, entry);
      cr.executedNow++;
      doneCount++;
      if (v.verdict === 'fail') log(`  FAIL ${pu.unit.key}: ${v.reasons.join(' ; ')}`);
      if (doneCount % 50 === 0 || doneCount === work.length) log(`  [${mc.id}] ${doneCount}/${work.length}`);
    });

    // validated counts come from the journal, bound to the current bytes
    for (const pu of file.units) {
      const e = journal.entries.get(pu.unit.key);
      if (!e || e.hash !== current.get(pu.unit.key)) continue;
      cr.validated[pu.origin.type]++;
      cr.validated.total++;
      if (e.verdict === 'pass') cr.passed++;
      else if (e.verdict === 'carve-out') cr.carveOut++;
      else {
        cr.failed++;
        report.quarantined.push({ key: e.key, course: mc.id, type: e.type, reason: e.reasons.join(' ; ') || 'failed' });
      }
    }
    add(report.totals.validated, cr.validated);
    if (!same(cr.validated, cr.pack)) {
      problems.push(`${mc.id}: validated ${fmt(cr.validated)} != pack ${fmt(cr.pack)}`);
    }
    const carveOutsWrong = cr.carveOut !== cr.pack.written;
    if (carveOutsWrong) problems.push(`${mc.id}: carve-outs ${cr.carveOut} != written exercises ${cr.pack.written}`);
  }

  // F4: the gating (full-scope) run re-executes a random sample of journaled passes
  if (!opts.course && resumedPasses.length > 0) {
    const n = Math.min(resumedPasses.length, Math.max(AUDIT_MIN, Math.ceil(AUDIT_RATE * resumedPasses.length)));
    const shuffled = [...resumedPasses];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const sample = shuffled.slice(0, n);
    log(`[audit] re-executing ${n} of ${resumedPasses.length} journaled passes`);
    report.audit.sampled = n;
    await pool(sample, opts.concurrency ?? 4, async ({ pu, content, hash, course }) => {
      let v: UnitVerdict;
      try {
        v = await validator(pu, content);
      } catch (err) {
        v = { verdict: 'fail', reasons: [`validator crashed: ${err instanceof Error ? err.message : String(err)}`], attempts: 0, durationMs: 0 };
      }
      if (v.verdict !== 'pass') {
        report.audit.mismatches.push(pu.unit.key);
        log(`  AUDIT MISMATCH ${pu.unit.key}: journal says pass, re-execution says ${v.verdict}: ${v.reasons.join(' ; ')}`);
        // the real verdict supersedes the untrustworthy line
        appendJournal(opts.journalPath, {
          key: pu.unit.key,
          course,
          type: pu.origin.type,
          hash,
          verdict: v.verdict,
          reasons: v.reasons,
          attempts: v.attempts,
          durationMs: v.durationMs,
          at: new Date().toISOString(),
        });
      }
    });
    if (report.audit.mismatches.length) {
      report.audit.mismatches.sort();
      problems.push(
        `journal distrusted: ${report.audit.mismatches.length} of ${n} re-executed journaled passes did not pass ` +
          `(${report.audit.mismatches.slice(0, 5).join(', ')}); delete the journal and re-run the sweep`,
      );
    }
  }

  const t = report.totals;
  if (!same(t.importer, t.pack) || !same(t.pack, t.validated)) {
    problems.push(`counts disagree: importer ${fmt(t.importer)} / pack ${fmt(t.pack)} / validated ${fmt(t.validated)}`);
  }
  if (!opts.course) {
    if (!same(t.importer, manifest.totals)) problems.push(`scope totals ${fmt(t.importer)} != manifest totals ${fmt(manifest.totals)}`);
    if (manifest.expected && !same(t.validated, manifest.expected)) {
      problems.push(`validated ${fmt(t.validated)} != expected census ${fmt(manifest.expected)}`);
    }
  }
  report.carveOut = t.validated.written;
  report.executable = t.pack.code + t.pack.quiz + t.pack.output;
  if (report.executable > 0 && report.quarantined.length / report.executable > QUARANTINE_CEILING) {
    problems.push(
      `quarantined ${report.quarantined.length}/${report.executable} executable = ${((100 * report.quarantined.length) / report.executable).toFixed(2)}% > ceiling ${QUARANTINE_CEILING * 100}%`,
    );
  }
  try {
    writeQuarantine(opts.packDir, manifest.source, scope.map((c) => c.id), report.quarantined);
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
  }
  report.ok = problems.length === 0;
  // F1: the stamp exists ONLY after a clean full-scope run
  if (report.ok && !opts.course) {
    const q = readQuarantineFile(opts.packDir);
    const stamp = PackValidationStamp.parse({
      format: PACK_FORMAT,
      source: manifest.source,
      manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
      graderFingerprint: fingerprint,
      toolchain: toolchainVersions(),
      counts: t.validated,
      executable: report.executable,
      passed: report.courses.reduce((n, c) => n + c.passed, 0),
      carveOut: report.carveOut,
      quarantinedKeys: (q?.entries ?? []).map((e) => e.key).sort(),
      audit: { sampled: report.audit.sampled, mismatches: report.audit.mismatches.length },
      completedAt: new Date().toISOString(),
    });
    writeFileSync(stampFile, `${JSON.stringify(stamp, null, 1)}\n`);
    report.stampPath = stampFile;
  }
  return report;
}

export class QuarantineFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuarantineFileError';
  }
}

/** Parse quarantine.json (null when absent). Malformed => QuarantineFileError, never a silent reset (F8). */
export function readQuarantineFile(packDir: string): PackQuarantine | null {
  const jsonPath = join(packDir, 'quarantine.json');
  if (!existsSync(jsonPath)) return null;
  try {
    return PackQuarantine.parse(JSON.parse(readFileSync(jsonPath, 'utf8')));
  } catch (err) {
    throw new QuarantineFileError(
      `quarantine.json is malformed (${err instanceof Error ? err.message.slice(0, 200) : String(err)}); refusing to rewrite it: ` +
        'restore it (e.g. from git) or resolve the conflict, then re-run',
    );
  }
}

/**
 * Update quarantine.json + QUARANTINE.md in the pack dir: entries for the
 * courses in this run's scope are replaced; other courses' entries are kept.
 * Both files are ALWAYS written, also when nothing is quarantined (F1: to the
 * loader a missing quarantine.json means "never validated"). A malformed
 * existing file throws QuarantineFileError and is left untouched (F8).
 */
export function writeQuarantine(packDir: string, source: string, scopeCourses: readonly string[], entries: readonly QuarantineEntry[]): void {
  const jsonPath = join(packDir, 'quarantine.json');
  const mdPath = join(packDir, 'QUARANTINE.md');
  const inScope = new Set(scopeCourses);
  const existing = readQuarantineFile(packDir);
  if (existing && existing.source !== source) throw new QuarantineFileError(`quarantine.json is for ${existing.source}, not ${source}; refusing to rewrite it`);
  const kept = (existing?.entries ?? []).filter((e) => !inScope.has(e.course));
  const all = [...kept, ...entries.map(({ key, course, reason }) => ({ key, course, reason }))].sort((a, b) => a.key.localeCompare(b.key));
  writeFileSync(jsonPath, `${JSON.stringify(PackQuarantine.parse({ format: PACK_FORMAT, source, entries: all }), null, 1)}\n`);
  const lines = [
    `# Quarantine — ${source}`,
    '',
    'Written by `npm run seed:validate`. These exercises FAILED the import gate under',
    "BootQuest's own runners and are never shipped (the content loader withholds them).",
    'Never fix them by weakening tests; fix upstream and re-import.',
    '',
    '| exercise | course | reason |',
    '|---|---|---|',
    ...all.map((e) => `| \`${e.key}\` | ${e.course} | ${e.reason.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`),
    ...(all.length === 0 ? ['| _(none: every exercise passed the gate)_ | | |'] : []),
    '',
  ];
  writeFileSync(mdPath, lines.join('\n'));
}

export function formatCounts(c: PackCounts): string {
  return fmt(c);
}
