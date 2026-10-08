import type { CheckSpec, CompetencyId, XpKind } from '@bootquest/shared';
import {
  toPublicCheck,
  type CanonicalRunResult,
  type DashboardResponse,
  type RevealResponse,
  type SubmitResponse,
  type UnitDetailResponse,
  type UnitLockState,
  type UnitSummary,
} from '@bootquest/shared/api';
import type { Db } from '../db/database.ts';
import { isRevealed, recordAttempt, revealSolution } from '../engines/attempts.ts';
import { addDays, nowMs, type Clock } from '../engines/clock.ts';
import { recordEvidence } from '../engines/evidence.ts';
import { dueCount, review } from '../engines/fsrs.ts';
import type { RatingChange } from '../engines/evidence.ts';
import { levelProgress } from '../engines/level.ts';
import { closeElapsedDays, composeSlate, DRILL_SET_SIZE, markSlateItem, streakStatus } from '../engines/streak.ts';
import { awardXp, dailyXp, totalXp } from '../engines/xp.ts';
import { recordRun } from '../store/content.ts';
import {
  competencyTable,
  getTrack,
  getUnit,
  listTracks,
  passedUnitIds,
  passedUnitsInWindow,
  prerequisiteMap,
  primaryCheck,
  reviewItemExists,
  revealedUnitIds,
  slateStatuses,
  unitCompetencies,
  unitPrerequisites,
  unitsForTrack,
  type CheckRecord,
  type TrackRecord,
  type UnitRecord,
} from '../store/queries.ts';
import type { UnitContentStore } from './content-store.ts';
import { HttpError } from './http.ts';
import { gradeDeterministic, SubmissionShapeError, UnsupportedCheckError, type LearnerSubmission, type RunnerRegistry } from './runners.ts';

/**
 * API service layer: orchestrates the W1a engines. No XP / streak / FSRS /
 * evidence rule is re-implemented here — the engines own those rules.
 */
export interface ServiceDeps {
  db: Db;
  clock: Clock;
  runners: RunnerRegistry;
  content: UnitContentStore;
}

export const HEATMAP_DAYS = 120;

// ---------------------------------------------------------------- lookups

function requireUnit(db: Db, id: number): UnitRecord {
  const unit = getUnit(db, id);
  if (!unit) throw new HttpError(404, 'NOT_FOUND', `unit ${id} not found`);
  return unit;
}

function requireCheck(db: Db, unit: UnitRecord): CheckRecord {
  const check = primaryCheck(db, unit.id);
  if (!check) throw new HttpError(409, 'NO_CHECK', `unit ${unit.id} has no check`);
  return check;
}

function lockStateFor(
  unit: UnitRecord,
  trackLocked: boolean,
  passed: Set<number>,
  prereqs: Map<number, number[]>,
): UnitLockState {
  if (trackLocked) return 'locked';
  if (passed.has(unit.id)) return 'done';
  return (prereqs.get(unit.id) ?? []).every((p) => passed.has(p)) ? 'available' : 'locked';
}

function summarize(
  unit: UnitRecord,
  trackLocked: boolean,
  passed: Set<number>,
  revealed: Set<number>,
  prereqs: Map<number, number[]>,
): UnitSummary {
  return {
    id: unit.id,
    key: unit.key,
    trackId: unit.trackId,
    kind: unit.kind,
    title: unit.title,
    difficulty: unit.difficulty,
    state: lockStateFor(unit, trackLocked, passed, prereqs),
    revealed: revealed.has(unit.id),
    prerequisites: prereqs.get(unit.id) ?? [],
  };
}

function trackSummary(db: Db, t: TrackRecord, passed: Set<number>) {
  const units = unitsForTrack(db, t.id);
  return {
    id: t.id,
    name: t.name,
    locked: t.locked,
    unitCount: units.length,
    doneCount: t.locked ? 0 : units.filter((u) => passed.has(u.id)).length,
  };
}

// ---------------------------------------------------------------- tracks + units

export function getTracks(deps: ServiceDeps) {
  const passed = passedUnitIds(deps.db);
  return { tracks: listTracks(deps.db).map((t) => trackSummary(deps.db, t, passed)) };
}

export function getTrackUnits(deps: ServiceDeps, trackId: string) {
  const track = getTrack(deps.db, trackId);
  if (!track) throw new HttpError(404, 'NOT_FOUND', `track ${trackId} not found`);
  const passed = passedUnitIds(deps.db);
  const revealed = revealedUnitIds(deps.db);
  const prereqs = prerequisiteMap(deps.db);
  return {
    track: trackSummary(deps.db, track, passed),
    units: unitsForTrack(deps.db, track.id).map((u) => summarize(u, track.locked, passed, revealed, prereqs)),
  };
}

export function getUnitDetail(deps: ServiceDeps, unitId: number): UnitDetailResponse {
  const { db } = deps;
  const unit = requireUnit(db, unitId);
  const track = getTrack(db, unit.trackId);
  const check = primaryCheck(db, unit.id);
  const summary = summarize(unit, track?.locked ?? true, passedUnitIds(db), revealedUnitIds(db), new Map([[unit.id, unitPrerequisites(db, unit.id)]]));
  return {
    unit: { ...summary, code: unit.code, competencies: unitCompetencies(db, unit.id), variationOfUnitId: unit.variationOfUnitId },
    // PUBLIC projection only — the full spec never leaves the server
    check: check ? { id: check.id, threshold: check.threshold, spec: toPublicCheck(check.spec) } : null,
    starter: deps.content.get(unit.key)?.starter ?? null,
  };
}

// ---------------------------------------------------------------- grading

async function grade(deps: ServiceDeps, spec: CheckSpec, submission: LearnerSubmission): Promise<CanonicalRunResult> {
  try {
    const builtIn = gradeDeterministic(spec, submission);
    if (builtIn) return builtIn;
    const runner = deps.runners[spec.type];
    if (!runner) throw new UnsupportedCheckError(`no runner registered for check type "${spec.type}"`);
    return await runner(spec, submission);
  } catch (err) {
    if (err instanceof UnsupportedCheckError) throw new HttpError(501, 'RUNNER_UNAVAILABLE', err.message);
    if (err instanceof SubmissionShapeError) {
      throw new HttpError(400, 'VALIDATION', err.message, [{ path: 'body', message: err.message }]);
    }
    throw err;
  }
}

function assertTrackOpen(db: Db, unit: UnitRecord): void {
  if (getTrack(db, unit.trackId)?.locked) throw new HttpError(403, 'TRACK_LOCKED', `track ${unit.trackId} is locked`);
}

/** POST /run — free, unlimited, NOT logged: grades and returns; writes nothing. */
export async function runUnit(deps: ServiceDeps, unitId: number, submission: LearnerSubmission): Promise<CanonicalRunResult> {
  const unit = requireUnit(deps.db, unitId);
  assertTrackOpen(deps.db, unit);
  const check = requireCheck(deps.db, unit);
  return grade(deps, check.spec, submission);
}

function xpKindFor(type: CheckSpec['type']): XpKind {
  if (type === 'quiz') return 'quiz';
  if (type === 'predict-output') return 'predict';
  return 'code';
}

/** Local-day window [start, end) containing `ms` (calendar arithmetic, DST-safe). */
function dayWindow(ms: number): [number, number] {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return [start, end];
}

/**
 * POST /submit — same grading as run, then (one transaction): append-only
 * attempt + run rows, XP via the xp engine on pass (reveal / once-per-unit
 * rules live there), an evidence row per declared competency, slate update.
 */
export async function submitUnit(
  deps: ServiceDeps,
  unitId: number,
  submission: LearnerSubmission & { selfAssisted: boolean },
): Promise<SubmitResponse> {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertTrackOpen(db, unit);
  const check = requireCheck(db, unit);
  const result = await grade(deps, check.spec, submission);
  const verdict = result.pass ? 'pass' : 'fail';

  return db.tx(() => {
    closeElapsedDays(db, clock);
    const attempt = recordAttempt(
      db,
      {
        unitId: unit.id,
        checkId: check.id,
        outcome: verdict,
        selfAssisted: submission.selfAssisted,
        score: result.pass ? 1 : 0,
        answer: submission.code !== undefined ? { code: submission.code } : { answer: submission.answer },
      },
      clock,
    );
    const runId = recordRun(db, { kind: 'submit', result, attemptId: attempt.id, checkId: check.id, unitId: unit.id }, clock);

    let xp: SubmitResponse['xp'] = null;
    if (result.pass) {
      const kind = xpKindFor(check.type);
      const award = awardXp(
        db,
        { kind, unitId: unit.id, attemptId: attempt.id, trackId: unit.trackId, ...(kind === 'code' ? { difficulty: unit.difficulty ?? 1 } : {}) },
        clock,
      );
      xp = { id: award.id, amount: award.amount, reason: award.reason };
    }

    const evidenceIds = unitCompetencies(db, unit.id).map(
      (competency: CompetencyId) =>
        recordEvidence(
          db,
          {
            competency,
            kind: 'submit',
            intention: `submit ${unit.key} (${check.type})`,
            observation: result.pass ? 'check passed' : `check failed (${result.failures.length} failing)`,
            assessor: 'pipeline',
            verified: result.pass,
            score: result.pass ? 1 : 0,
            attemptId: attempt.id,
          },
          clock,
        ).id,
    );

    if (result.pass) {
      const slate = composeSlate(db, clock);
      const slot = `drill:${unit.trackId}` as const;
      const item = slate.items.find((i) => i.slot === slot);
      if (item && !item.done) {
        const [from, to] = dayWindow(nowMs(clock));
        if (passedUnitsInWindow(db, unit.trackId, from, to) >= DRILL_SET_SIZE) markSlateItem(db, slot, clock);
      }
    }

    return {
      result,
      verdict,
      attempt: { id: attempt.id, mode: attempt.mode, outcome: attempt.outcome },
      runId,
      xp,
      evidenceIds,
    };
  });
}

// ---------------------------------------------------------------- reveal

function solutionFor(deps: ServiceDeps, unit: UnitRecord, check: CheckRecord): RevealResponse['solution'] | null {
  const spec = check.spec;
  if (spec.type === 'quiz') {
    const choice = typeof spec.answerKey === 'number' ? (spec.choices?.[spec.answerKey] ?? null) : null;
    return { kind: 'answer', answer: spec.answerKey, choice };
  }
  if (spec.type === 'predict-output') return { kind: 'output', expected: spec.expected };
  const code = deps.content.get(unit.key)?.solution;
  return code === undefined ? null : { kind: 'code', code };
}

function latestRevealAttempt(db: Db, unitId: number): { id: number; variationUnitId: number | null } {
  const row = db.get<{ id: number; variationUnitId: number | null }>(
    `SELECT id, variation_unit_id AS variationUnitId FROM attempt
      WHERE unit_id = ? AND assistance_source = 'reveal' AND outcome = 'revealed' ORDER BY id DESC LIMIT 1`,
    unitId,
  );
  if (!row) throw new HttpError(403, 'NOT_REVEALED', `unit ${unitId} has not been revealed`);
  return row;
}

/**
 * POST /reveal — writes the guided 'revealed' attempt (engine: XP zeroed
 * forever on this unit) and returns the reference solution ONLY after that
 * row is committed. Idempotent: a second reveal returns the same solution.
 * Refuses (before writing anything) when no solution is available.
 */
export function revealUnit(deps: ServiceDeps, unitId: number): RevealResponse {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertTrackOpen(db, unit);
  const check = requireCheck(db, unit);
  const solution = solutionFor(deps, unit, check);
  if (!solution) throw new HttpError(404, 'NO_SOLUTION', `unit ${unit.id} has no reference solution in the content store`);
  if (!isRevealed(db, unit.id)) revealSolution(db, unit.id, clock); // autocommit: durable before we answer
  const row = latestRevealAttempt(db, unit.id); // re-read from the DB: proves the row exists
  return { attemptId: row.id, variationUnitId: row.variationUnitId, solution };
}

/** GET /solution — 403 until the reveal attempt row exists (server-enforced honesty). */
export function getRevealedSolution(deps: ServiceDeps, unitId: number): RevealResponse {
  const { db } = deps;
  const unit = requireUnit(db, unitId);
  const row = latestRevealAttempt(db, unit.id);
  const check = requireCheck(db, unit);
  const solution = solutionFor(deps, unit, check);
  if (!solution) throw new HttpError(404, 'NO_SOLUTION', `unit ${unit.id} has no reference solution in the content store`);
  return { attemptId: row.id, variationUnitId: row.variationUnitId, solution };
}

// ---------------------------------------------------------------- reviews

export function gradeReview(deps: ServiceDeps, itemId: number, gradeValue: 'again' | 'hard' | 'good' | 'easy') {
  const { db, clock } = deps;
  if (!reviewItemExists(db, itemId)) throw new HttpError(404, 'NOT_FOUND', `review item ${itemId} not found`);
  return db.tx(() => {
    const demotions: RatingChange[] = [];
    const outcome = review(db, itemId, gradeValue, clock, { onDemotion: (c) => demotions.push(c) });
    const remainingDue = dueCount(db, clock);
    if (remainingDue === 0) {
      const slate = composeSlate(db, clock);
      if (slate.items.some((i) => i.slot === 'review' && !i.done)) markSlateItem(db, 'review', clock);
    }
    return {
      itemId,
      grade: gradeValue,
      prevDueAt: outcome.prevDueAt,
      nextDueAt: outcome.nextDueAt,
      xp: { id: outcome.xp.id, amount: outcome.xp.amount, reason: outcome.xp.reason },
      demotion: demotions[0] ?? outcome.demotion,
      remainingDue,
    };
  });
}

// ---------------------------------------------------------------- dashboard

export function getDashboard(deps: ServiceDeps): DashboardResponse {
  const { db, clock } = deps;
  return db.tx(() => {
    const streak = streakStatus(db, clock); // closes elapsed days first
    const today = streak.today;
    const from = addDays(today, -(HEATMAP_DAYS - 1));
    const xpByDay = new Map(dailyXp(db, from, today).map((r) => [r.day, r.xp]));
    const statuses = slateStatuses(db, from, today);
    const heatmap: DashboardResponse['heatmap'] = [];
    for (let i = 0; i < HEATMAP_DAYS; i++) {
      const day = addDays(from, i);
      heatmap.push({ day, xp: xpByDay.get(day) ?? 0, status: (statuses.get(day) ?? 'none') as DashboardResponse['heatmap'][number]['status'] });
    }
    const slate = composeSlate(db, clock);
    const lp = levelProgress(totalXp(db));

    const passed = passedUnitIds(db);
    const prereqs = prerequisiteMap(db);
    const nextUp = listTracks(db)
      .filter((t) => !t.locked)
      .map((t) => {
        const next = unitsForTrack(db, t.id).find((u) => lockStateFor(u, false, passed, prereqs) === 'available');
        return { trackId: t.id, unit: next ? { id: next.id, key: next.key, title: next.title, kind: next.kind } : null };
      });

    return {
      today,
      streak: {
        current: streak.display,
        longest: streak.longest,
        tokens: streak.tokens,
        slateDaysBanked: streak.slateDaysBanked,
        todayComplete: streak.todayComplete,
      },
      heatmap,
      xp: { total: lp.xp, level: lp.level, intoLevel: lp.intoLevel, levelSpan: lp.levelSpan, nextAt: lp.nextAt },
      competencies: competencyTable(db),
      slate: { day: slate.day, status: slate.status, items: slate.items },
      reviewQueue: { due: dueCount(db, clock) },
      nextUp,
    };
  });
}
