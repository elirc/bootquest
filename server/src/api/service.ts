import type { CheckSpec, CompetencyId } from '@bootquest/shared';
import {
  toPublicCheck,
  type CanonicalRunResult,
  type DashboardResponse,
  type ModelAnswerResponse,
  type RevealResponse,
  type SelfAttestResponse,
  type SubmitResponse,
  type UnitDetailResponse,
  type UnitLockState,
  type UnitSummary,
  type WrittenAnswerResponse,
} from '@bootquest/shared/api';
import type { Db } from '../db/database.ts';
import { HonestyRuleError, isRevealed, recordAttempt, recordSubmission, revealSolution, selfAttestReading } from '../engines/attempts.ts';
import { addDays, type Clock } from '../engines/clock.ts';
import { recordEvidence } from '../engines/evidence.ts';
import { dueCount, review } from '../engines/fsrs.ts';
import type { RatingChange } from '../engines/evidence.ts';
import { levelProgress } from '../engines/level.ts';
import { closeElapsedDays, composeSlate, streakStatus } from '../engines/streak.ts';
import { awardXp, dailyXp, totalXp, xpKindForCheck } from '../engines/xp.ts';
import {
  competencyTable,
  getTrack,
  getUnit,
  listTracks,
  passedUnitIds,
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
  const entry = deps.content.get(unit.key);
  return {
    unit: { ...summary, code: unit.code, competencies: unitCompetencies(db, unit.id), variationOfUnitId: unit.variationOfUnitId },
    // PUBLIC projection only — the full spec never leaves the server
    check: check ? { id: check.id, threshold: check.threshold, spec: toPublicCheck(check.spec) } : null,
    // PUBLIC content fields only (whitelist); solution / explanation / hints stay server-side
    instructions: entry?.instructions ?? null,
    starter: entry?.starter ?? null,
    snippet: entry?.snippet ?? null,
    rubric: entry?.rubric ?? null,
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

/** Map an engine honesty refusal to its HTTP shape; anything else propagates. */
function withHonesty<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof HonestyRuleError) {
      switch (err.code) {
        case 'NOT_DUE':
          throw new HttpError(409, 'NOT_DUE', err.message);
        case 'WRONG_UNIT_KIND':
          throw new HttpError(409, 'WRONG_UNIT_KIND', err.message);
        case 'ALREADY_ATTESTED':
          throw new HttpError(409, 'ALREADY_ATTESTED', err.message);
        default:
          break; // any other honesty refusal here is a server bug: 500
      }
    }
    throw err;
  }
}

/**
 * Check types whose free run would be an answer oracle (a 3-choice quiz is
 * solved in 3 unrecorded runs, then submitted for full XP): submit only.
 */
const SUBMIT_ONLY_CHECKS: ReadonlySet<CheckSpec['type']> = new Set<CheckSpec['type']>(['quiz', 'predict-output']);

/** POST /run — free, unlimited, NOT logged: grades and returns; writes nothing. Not for quiz / predict-output. */
export async function runUnit(deps: ServiceDeps, unitId: number, submission: LearnerSubmission): Promise<CanonicalRunResult> {
  const unit = requireUnit(deps.db, unitId);
  assertTrackOpen(deps.db, unit);
  const check = requireCheck(deps.db, unit);
  if (SUBMIT_ONLY_CHECKS.has(check.type)) {
    throw new HttpError(409, 'RUN_NOT_AVAILABLE', `${check.type} checks are submit-only (a free run would reveal the answer)`);
  }
  return grade(deps, check.spec, submission);
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

  return db.tx(() => {
    closeElapsedDays(db, clock);
    // attempt outcome is derived from the verdict; the submit run is written with it
    const { attempt, runId, verdict } = recordSubmission(
      db,
      {
        unitId: unit.id,
        checkId: check.id,
        selfAssisted: submission.selfAssisted,
        result,
        answer: submission.code !== undefined ? { code: submission.code } : { answer: submission.answer },
      },
      clock,
    );

    let xp: SubmitResponse['xp'] = null;
    const kind = xpKindForCheck(check.type);
    if (verdict === 'pass' && kind !== null) {
      // the engine re-verifies the attempt and reads difficulty/track from the unit row
      const award = awardXp(db, { kind, attemptId: attempt.id }, clock);
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
            attemptId: attempt.id,
          },
          clock,
        ).id,
    );

    composeSlate(db, clock); // slots are derived from the ledger; this only opens today's row

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

// ---------------------------------------------------------------- reading self-attest

/**
 * POST /self-attest — reading units only (spec §4 study-quest reading steps,
 * §6.1 "reading self-attest 5"): once per unit, writes a solo attempt with the
 * self-attest marker, then 5 XP through the xp engine (which re-verifies it).
 */
export function selfAttestUnit(deps: ServiceDeps, unitId: number): SelfAttestResponse {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertTrackOpen(db, unit);
  return withHonesty(() =>
    db.tx(() => {
      closeElapsedDays(db, clock);
      const attempt = selfAttestReading(db, unit.id, clock);
      const award = awardXp(db, { kind: 'reading', attemptId: attempt.id }, clock);
      composeSlate(db, clock);
      return { attemptId: attempt.id, xp: { id: award.id, amount: award.amount, reason: award.reason } };
    }),
  );
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

// ---------------------------------------------------------------- written units (answer first)

function requireWritten(unit: UnitRecord): void {
  if (unit.kind !== 'written') {
    throw new HttpError(409, 'WRONG_UNIT_KIND', `unit ${unit.id} is ${unit.kind}; written answers / model answers are for written units only`);
  }
}

/**
 * POST /answer — written units only. Stores the learner's answer IMMUTABLY as an
 * ungraded 'submitted' attempt through the engine's recordAttempt (append-only;
 * mode/assistance derived there). No grading, no XP, no evidence in this wave.
 */
export function answerWrittenUnit(deps: ServiceDeps, unitId: number, body: { answer: string; selfAssisted: boolean }): WrittenAnswerResponse {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertTrackOpen(db, unit);
  requireWritten(unit);
  const attempt = recordAttempt(db, { unitId: unit.id, selfAssisted: body.selfAssisted, answer: { text: body.answer } }, clock);
  return { attemptId: attempt.id, mode: attempt.mode, outcome: 'submitted' };
}

/** The learner's FIRST recorded non-empty written answer on this unit, if any. */
function firstWrittenAnswer(db: Db, unitId: number): number | null {
  const row = db.get<{ id: number }>(
    `SELECT id FROM attempt
      WHERE unit_id = ? AND outcome = 'submitted' AND check_id IS NULL
        AND length(trim(json_extract(answer, '$.text'), ' ' || char(9, 10, 13))) > 0
      ORDER BY id LIMIT 1`,
    unitId,
  );
  return row?.id ?? null;
}

/**
 * GET /model-answer — 403 NOT_ANSWERED until the learner's own answer row is
 * committed (server-enforced answer-first), then the model answer + rubric for
 * self-assessment.
 */
export function getModelAnswer(deps: ServiceDeps, unitId: number): ModelAnswerResponse {
  const { db } = deps;
  const unit = requireUnit(db, unitId);
  requireWritten(unit);
  const attemptId = firstWrittenAnswer(db, unit.id);
  if (attemptId === null) throw new HttpError(403, 'NOT_ANSWERED', `unit ${unit.id}: record your own answer first (POST /api/units/${unit.id}/answer)`);
  const entry = deps.content.get(unit.key);
  if (!entry?.solution) throw new HttpError(404, 'NO_SOLUTION', `unit ${unit.id} has no model answer in the content store`);
  return { attemptId, modelAnswer: entry.solution, rubric: entry.rubric ?? [] };
}

// ---------------------------------------------------------------- reviews

export function gradeReview(deps: ServiceDeps, itemId: number, gradeValue: 'again' | 'hard' | 'good' | 'easy') {
  const { db, clock } = deps;
  if (!reviewItemExists(db, itemId)) throw new HttpError(404, 'NOT_FOUND', `review item ${itemId} not found`);
  return withHonesty(() => db.tx(() => {
    const demotions: RatingChange[] = [];
    const outcome = review(db, itemId, gradeValue, clock, { onDemotion: (c) => demotions.push(c) });
    const remainingDue = dueCount(db, clock);
    composeSlate(db, clock); // the review slot is derived from review_log
    return {
      itemId,
      grade: gradeValue,
      prevDueAt: outcome.prevDueAt,
      nextDueAt: outcome.nextDueAt,
      xp: { id: outcome.xp.id, amount: outcome.xp.amount, reason: outcome.xp.reason },
      demotion: demotions[0] ?? outcome.demotion,
      remainingDue,
    };
  }));
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
        // written units have no check (self-assessed carve-out): never "next up"
        const next = unitsForTrack(db, t.id).find((u) => u.kind !== 'written' && lockStateFor(u, false, passed, prereqs) === 'available');
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
