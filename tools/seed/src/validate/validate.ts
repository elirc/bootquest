import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  countPackUnits,
  PACK_FORMAT,
  PackCourseFile,
  PackManifest,
  PackQuarantine,
  type PackCounts,
  type PackOriginType,
  type PackUnit,
} from '@bootquest/shared';
import type { CanonicalRunResult, UnitContentEntry } from '@bootquest/shared/api';
import { normalizeOutput, runSnippet } from '@bootquest/server/grade-core';
import { drillJsRunner, gradeDeterministic } from '@bootquest/server/runners';
import { appendJournal, readJournal, type JournalEntry, type JournalVerdict } from './journal.ts';

/**
 * seed:validate — the import gate (spec §3.1/§7): every imported reference
 * solution is executed under BootQuest's OWN runners; failures are quarantined
 * (never shipped, never "fixed" by weakening tests).
 *   drill-js       reference solution through the server's drill-js runner
 *                  adapter (the exact code path POST /submit uses) must pass;
 *                  a timeout flake is retried once; formatted exercises'
 *                  starters must FAIL (BootForge validate.mjs rule)
 *   quiz           single-keyed: the key passes the deterministic grader and
 *                  every other choice fails
 *   predict-output the expected output passes the grader, a perturbed one
 *                  fails, and re-running the snippet reproduces it exactly
 *   written        schema-validated only: counted carve-out (no check exists)
 * Counts: importer (manifest) === pack (course files) === validated (journal),
 * and on a full run also === the expected census. Quarantine ceiling: 1% of
 * executable exercises in the run's scope.
 */

export const QUARANTINE_CEILING = 0.01;

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
/** Journal entries are bound to the grader + validator bytes: changing either re-validates. */
const FINGERPRINT_FILES = [
  join(REPO, 'server', 'src', 'runners', 'js', 'grade-core.mjs'),
  join(REPO, 'server', 'src', 'runners', 'js', 'index.ts'),
  join(REPO, 'server', 'src', 'api', 'runners.ts'),
  join(REPO, 'tools', 'seed', 'src', 'validate', 'validate.ts'),
];
export const DEFAULT_JOURNAL_DIR = join(REPO, '.seed-journal');

let fingerprintCache: string | null = null;
export function graderFingerprint(): string {
  fingerprintCache ??= createHash('sha256')
    .update(FINGERPRINT_FILES.map((f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).join('\u0000'))
    .digest('hex');
  return fingerprintCache;
}

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
    if (pu.origin.format !== undefined) {
      const starter = await grade(content.starter ?? '');
      if (starter.pass) reasons.push(`starter of a ${pu.origin.format} exercise passes its own tests (must fail)`);
    }
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
  };

  let manifest: PackManifest;
  try {
    manifest = PackManifest.parse(JSON.parse(readFileSync(join(opts.packDir, 'manifest.json'), 'utf8')));
  } catch (err) {
    problems.push(`manifest.json unreadable/invalid: ${err instanceof Error ? err.message : String(err)}`);
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
      if (reusable) cr.resumed++;
      else work.push({ pu, content, hash });
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
  writeQuarantine(opts.packDir, manifest.source, scope.map((c) => c.id), report.quarantined);
  report.ok = problems.length === 0;
  return report;
}

/**
 * Update quarantine.json + QUARANTINE.md in the pack dir: entries for the
 * courses in this run's scope are replaced; other courses' entries are kept.
 * Both files are removed when nothing is quarantined.
 */
export function writeQuarantine(packDir: string, source: string, scopeCourses: readonly string[], entries: readonly QuarantineEntry[]): void {
  const jsonPath = join(packDir, 'quarantine.json');
  const mdPath = join(packDir, 'QUARANTINE.md');
  const inScope = new Set(scopeCourses);
  let kept: { key: string; course: string; reason: string }[] = [];
  if (existsSync(jsonPath)) {
    try {
      kept = PackQuarantine.parse(JSON.parse(readFileSync(jsonPath, 'utf8'))).entries.filter((e) => !inScope.has(e.course));
    } catch {
      kept = [];
    }
  }
  const all = [...kept, ...entries.map(({ key, course, reason }) => ({ key, course, reason }))].sort((a, b) => a.key.localeCompare(b.key));
  if (all.length === 0) {
    rmSync(jsonPath, { force: true });
    rmSync(mdPath, { force: true });
    return;
  }
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
    '',
  ];
  writeFileSync(mdPath, lines.join('\n'));
}

export function formatCounts(c: PackCounts): string {
  return fmt(c);
}
