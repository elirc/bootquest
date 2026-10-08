import {
  CheckSpec,
  ContentRef,
  LessonSpec,
  RunnerResult,
  type CheckSpecInput,
  type RunVerdict,
} from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { nowMs, type Clock } from '../engines/clock.ts';

/**
 * Boundary writers: every row that originates outside the server (seed output,
 * runner verdicts) is Zod-validated with @bootquest/shared before it is stored.
 */

export function insertContentRef(db: Db, input: unknown, now: Clock, sourceId?: number): number {
  const r = ContentRef.parse(input);
  const t = nowMs(now);
  return db.run(
    `INSERT INTO content_ref (source_id, repo, path, sha, anchor, title, summary, stable_key, stable_key_algo,
                              line_start, line_end, kind, provenance, origin, status, family, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sourceId,
    r.repo,
    r.path,
    r.sha,
    r.anchor,
    r.title,
    r.summary,
    r.stableKey,
    r.stableKeyAlgo,
    r.lineStart,
    r.lineEnd,
    r.kind,
    r.provenance,
    r.origin,
    r.status,
    r.family,
    t,
    t,
  ).lastInsertRowid;
}

export function insertCheck(
  db: Db,
  unitId: number,
  spec: CheckSpecInput,
  now: Clock,
  opts: { threshold?: number; contentRefId?: number } = {},
): number {
  const s = CheckSpec.parse(spec);
  const inverted = s.type === 'self-run' ? s.inverted : false;
  const timeout = 'timeoutMs' in s ? s.timeoutMs : undefined;
  return db.run(
    `INSERT INTO "check" (unit_id, type, spec, threshold, inverted, timeout_ms, content_ref_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    unitId,
    s.type,
    JSON.stringify(s),
    opts.threshold,
    inverted,
    timeout,
    opts.contentRefId,
    nowMs(now),
  ).lastInsertRowid;
}

/** Insert a unit (and its competencies, prerequisites, checks) from a validated LessonSpec. */
export function insertUnit(db: Db, input: unknown, now: Clock): number {
  const u = LessonSpec.parse(input);
  const t = nowMs(now);
  return db.tx(() => {
    const unitIdFor = (key: string): number => {
      const row = db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', key);
      if (!row) throw new Error(`unknown unit key ${key}`);
      return row.id;
    };
    // (repo, stable_key) is the uniqueness key: twin repos share heading text (W1a audit #9)
    const contentRefId = u.contentRef
      ? db.get<{ id: number }>(
          'SELECT id FROM content_ref WHERE repo = ? AND stable_key = ?',
          u.contentRef.repo,
          u.contentRef.stableKey,
        )?.id
      : undefined;
    if (u.contentRef && contentRefId === undefined) {
      throw new Error(`unknown content_ref ${u.contentRef.repo}#${u.contentRef.stableKey}`);
    }
    const id = db.run(
      `INSERT INTO unit (key, track_id, kind, title, code, phase, difficulty, xp, target_level, content_ref_id, variation_of_unit_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      u.key,
      u.track,
      u.kind,
      u.title,
      u.code,
      u.phase,
      u.difficulty,
      u.xp,
      u.targetLevel,
      contentRefId,
      u.variationOf ? unitIdFor(u.variationOf) : undefined,
      t,
    ).lastInsertRowid;
    for (const c of u.competencies) db.run('INSERT INTO unit_competency (unit_id, competency_id) VALUES (?, ?)', id, c);
    for (const p of u.prerequisites) {
      db.run('INSERT INTO unit_prerequisite (unit_id, prereq_unit_id) VALUES (?, ?)', id, unitIdFor(p));
    }
    for (const c of u.checks) insertCheck(db, id, c.spec, now, { threshold: c.threshold });
    return id;
  });
}

export interface RecordRunInput {
  /** Only free runs are stored here. Submit runs are written by recordSubmission() with their attempt. */
  kind: 'run';
  result: unknown;
  checkId?: number;
  unitId?: number;
}

/**
 * The stored verdict for a runner result. An explicit verdict wins; otherwise a
 * self-run marker count decides (`todo` is its own verdict, never 'fail'); a
 * result whose pass flag contradicts its counts is rejected (W1a audit #12).
 */
export function runVerdict(input: unknown): { result: RunnerResult; verdict: RunVerdict } {
  const r = RunnerResult.parse(input);
  if (r.verdict !== undefined) return { result: r, verdict: r.verdict };
  if (r.counts) {
    const v = selfRunVerdict(r.counts);
    if ((v === 'pass') !== r.pass) throw new Error(`runner result pass=${r.pass} contradicts its counts (${v})`);
    return { result: r, verdict: v };
  }
  return { result: r, verdict: r.pass ? 'pass' : 'fail' };
}

/** Store a free (unlogged-for-credit) run verdict. Raw JSON kept forever. */
export function recordRun(db: Db, input: RecordRunInput, now: Clock): number {
  if (input.kind !== 'run') throw new Error('recordRun stores free runs only; submits go through recordSubmission()');
  const { result: r, verdict } = runVerdict(input.result);
  if (input.checkId !== undefined && input.unitId !== undefined) {
    const owner = db.get<{ unit_id: number }>('SELECT unit_id FROM "check" WHERE id = ?', input.checkId);
    if (owner?.unit_id !== input.unitId) throw new Error(`check ${input.checkId} does not belong to unit ${input.unitId}`);
  }
  return db.run(
    `INSERT INTO run (kind, attempt_id, check_id, unit_id, verdict, passed, failed, todo, duration_ms, raw, created_at)
     VALUES ('run', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.checkId,
    input.unitId,
    verdict,
    r.counts?.passed,
    r.counts?.failed,
    r.counts?.todo,
    Math.round(r.durationMs),
    JSON.stringify(r),
    nowMs(now),
  ).lastInsertRowid;
}

export interface MarkerCounts {
  passed: number;
  failed: number;
  todo: number;
}

/**
 * Verdict for a learner submission under the self-run (`#done passed= failed= todo=`)
 * protocol: pass iff passed>0 && failed==0 && todo==0; todo>0 with no failures
 * is 'todo' — a distinct state, never a failure.
 */
export function selfRunVerdict(counts: MarkerCounts): RunVerdict {
  if (counts.failed > 0) return 'fail';
  if (counts.todo > 0) return 'todo';
  return counts.passed > 0 ? 'pass' : 'fail';
}

/**
 * Import-gate expectation for the SHIPPED starter of a self-run check (jstrain
 * verify.js / csbootcamp verify.cs contract): a normal starter must be
 * unfinished (failed==0, todo>0); an INVERTED starter (*-debug / *-hunts) must
 * FAIL (failed>0) because it ships a planted bug. Reference solutions are always
 * judged by selfRunVerdict, inverted or not.
 */
export function starterMeetsContract(counts: MarkerCounts, inverted: boolean): boolean {
  return inverted ? counts.failed > 0 : counts.failed === 0 && counts.todo > 0;
}
