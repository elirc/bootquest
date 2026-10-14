import { PROJECT_UNIT_KINDS, type CheckSpec, type CompetencyId } from '@bootquest/shared';
import {
  toPublicCheck,
  type CampaignResponse,
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
import { campaignState, currentLevel, questUnitUnlocked } from '../engines/campaign.ts';
import { addDays, type Clock } from '../engines/clock.ts';
import { promoteIfEligible, recordEvidence } from '../engines/evidence.ts';
import { retestGate, type RetestGateView } from '../engines/ladder.ts';
import { dueCount, review } from '../engines/fsrs.ts';
import type { RatingChange } from '../engines/evidence.ts';
import { levelProgress } from '../engines/level.ts';
import { closeElapsedDays, composeSlate, streakStatus } from '../engines/streak.ts';
import { awardXp, dailyXp, totalXp, xpKindForCheck } from '../engines/xp.ts';
import { enrollFlashcards, queueQuizMisses } from '../engines/study-quest.ts';
import { gradeStudySubmission, studyQuestPublicFor, type StudyGradeResult } from './study-service.ts';
import {
  getTrack,
  getUnit,
  getUnitByKey,
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
import { competencyRowsWithPromotion, explainBackPublicFor, kataPublicFor } from './ladder-service.ts';
import type { SeedItemStore } from '../store/seed-items.ts';
import { HttpError } from './http.ts';
import { CheckRefusedError, gradeDeterministic, SubmissionShapeError, UnsupportedCheckError, type LearnerSubmission, type RunnerRegistry } from './runners.ts';
import type { SyncService } from '../sync/service.ts';
import { CacheMissError, CachePathError } from '../sync/cache.ts';
import { NetworkUnavailableError } from '../sync/github.ts';
import type { RefContentResponse, RefLink } from '@bootquest/shared/sync';

/**
 * API service layer: orchestrates the W1a engines. No XP / streak / FSRS /
 * evidence rule is re-implemented here — the engines own those rules.
 */
export interface ServiceDeps {
  db: Db;
  clock: Clock;
  runners: RunnerRegistry;
  content: UnitContentStore;
  /** W4 GitHub sync + per-SHA caches; null = this server has no sync configured */
  sync: SyncService | null;
  /** W6 seed items (explain-back question sets, patch katas) — public/private halves split server-side */
  seedItems: SeedItemStore;
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
  // W9 (ui-audit #1): a campaign quest unit whose every act is still locked serves NOTHING
  // playable (mirrors the closed-retest withhold below, but total): no check, prose, starter,
  // study-quest reading list / questions, explain-back / kata halves or refs. Writes refuse
  // with 403 ACT_LOCKED regardless (assertTrackOpen); this keeps a direct URL from reading or
  // pre-solving locked-act content.
  if (questUnitUnlocked(db, unit.id) === false) {
    return {
      actGate: { locked: true },
      unit: {
        ...summary,
        state: summary.state === 'done' ? 'done' : 'locked',
        code: unit.code,
        competencies: unitCompetencies(db, unit.id),
        variationOfUnitId: unit.variationOfUnitId,
      },
      check: null,
      instructions: null,
      starter: null,
      snippet: null,
      rubric: null,
      refs: [],
    };
  }
  const entry = deps.content.get(unit.key);
  // W6: PUBLIC halves only (questions; diff + context) — key points / defect keys never leave here
  // W9 (ui-audit #10): `answered` lets the client skip the on-mount key probe (no expected 403)
  const explainBack = check ? explainBackPublicFor(deps.seedItems, check.spec, db) : undefined;
  const kata = check ? kataPublicFor(deps.seedItems, check.spec, db) : undefined;
  // W8: reading list + questions with choices (never keys); null = the quest pack is not loaded
  const studyQuest = check ? studyQuestPublicFor(deps.seedItems, check.spec) : undefined;
  // W7 (audit #1): a closed changed-example retest withholds its task (no day-0 pre-solving)
  const gate = unit.kind === 'retest' ? retestGate(db, unit.id, deps.clock) : null;
  const withhold = gate !== null && !gate.open;
  return {
    ...(explainBack !== undefined ? { explainBack } : {}),
    ...(kata !== undefined ? { kata } : {}),
    ...(studyQuest !== undefined ? { studyQuest } : {}),
    ...(gate ? { retestGate: gate } : {}),
    unit: { ...summary, code: unit.code, competencies: unitCompetencies(db, unit.id), variationOfUnitId: unit.variationOfUnitId },
    // PUBLIC projection only — the full spec never leaves the server (and a closed retest shows none)
    check: check && !withhold ? { id: check.id, threshold: check.threshold, spec: toPublicCheck(check.spec) } : null,
    // PUBLIC content fields only (whitelist); solution / explanation / hints stay server-side
    instructions: withhold ? null : (entry?.instructions ?? null),
    starter: withhold ? null : (entry?.starter ?? null),
    snippet: withhold ? null : (entry?.snippet ?? null),
    rubric: entry?.rubric ?? null,
    refs: unitRefs(db, unit.id),
  };
}

/** GET /units/by-key/:key — same shape as /units/:id (one round trip for key-configured CLI projects). */
export function getUnitDetailByKey(deps: ServiceDeps, key: string): UnitDetailResponse {
  const unit = getUnitByKey(deps.db, key);
  if (!unit) throw new HttpError(404, 'NOT_FOUND', `no unit with key "${key}"`);
  return getUnitDetail(deps, unit.id);
}

// ---------------------------------------------------------------- GitHub content refs (W4)

interface RefDbRow {
  id: number;
  repo: string;
  path: string;
  sha: string;
  anchor: string | null;
  title: string;
  kind: RefLink['kind'];
  status: RefLink['status'];
  lineStart: number | null;
  lineEnd: number | null;
}

const REF_COLUMNS = `r.id, r.repo, r.path, r.sha, r.anchor, r.title, r.kind, r.status, r.line_start AS lineStart, r.line_end AS lineEnd`;

function isRenderable(row: Pick<RefDbRow, 'path' | 'status'>): boolean {
  return /\.(md|markdown)$/i.test(row.path) && row.status !== 'quarantined';
}

function toRefLink(row: RefDbRow, role: string): RefLink {
  return { ...row, role, contentUrl: isRenderable(row) ? `/api/refs/${row.id}/content` : null };
}

/** The refs a unit renders from (unit_ref: program milestone + lesson guide). */
export function unitRefs(db: Db, unitId: number): RefLink[] {
  return db
    .all<RefDbRow & { role: string }>(
      `SELECT ${REF_COLUMNS}, ur.role FROM unit_ref ur JOIN content_ref r ON r.id = ur.content_ref_id
        WHERE ur.unit_id = ? ORDER BY CASE ur.role WHEN 'program' THEN 0 ELSE 1 END`,
      unitId,
    )
    .map(({ role, ...row }) => toRefLink(row, role));
}

/**
 * GET /refs/:id/content: the markdown of ONE registered content_ref, read from
 * the per-SHA disk caches (tarball tree, else blob cache, else one first-view
 * blob fetch). The path comes from the DB row, never from the request, so only
 * registered refs are servable; quarantined and non-markdown refs are refused.
 */
export async function getRefContent(deps: ServiceDeps, refId: number): Promise<RefContentResponse> {
  const row = deps.db.get<RefDbRow>(`SELECT ${REF_COLUMNS} FROM content_ref r WHERE r.id = ?`, refId);
  if (!row) throw new HttpError(404, 'NOT_FOUND', `content ref ${refId} not found`);
  if (!isRenderable(row)) {
    throw new HttpError(409, 'NOT_RENDERABLE', `content ref ${refId} (${row.kind}, ${row.status}) is not renderable markdown`);
  }
  if (!deps.sync) throw new HttpError(501, 'SYNC_UNAVAILABLE', 'this server has no GitHub cache configured');
  let blob: Awaited<ReturnType<SyncService['cache']['readBlob']>>;
  try {
    blob = await deps.sync.cache.readBlob(row.repo, row.sha, row.path);
  } catch (err) {
    if (err instanceof NetworkUnavailableError) {
      throw new HttpError(503, 'UNAVAILABLE_OFFLINE', `${row.repo}@${row.sha.slice(0, 7)}:${row.path} is not cached and the network is unavailable`);
    }
    if (err instanceof CacheMissError) throw new HttpError(404, 'NOT_FOUND', err.message);
    if (err instanceof CachePathError) throw new HttpError(409, 'NOT_RENDERABLE', err.message);
    throw err;
  }
  const lines = blob.bytes.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const from = row.lineStart ?? 1;
  const to = row.lineEnd ?? lines.length;
  return { ref: toRefLink(row, 'self'), markdown: lines.slice(from - 1, to).join('\n'), servedFrom: blob.servedFrom };
}

// ---------------------------------------------------------------- campaign (W5b)

/**
 * GET /tracks/:id/campaign — acts in order with the derived unlock state and
 * core progress, quests in INDEX-rank order with their derived state. Read-only:
 * nothing is stored as "unlocked" (engines/campaign.ts owns the rule).
 */
export function getCampaign(deps: ServiceDeps, trackId: string): CampaignResponse {
  const { db } = deps;
  const track = getTrack(db, trackId);
  if (!track) throw new HttpError(404, 'NOT_FOUND', `track ${trackId} not found`);
  const level = currentLevel(db);
  return {
    track: { id: track.id, name: track.name, locked: track.locked },
    level,
    acts: campaignState(db, track.id, level).map((a) => ({
      id: a.id,
      title: a.title,
      theme: a.theme,
      ordinal: a.actNo,
      unlocked: a.unlocked,
      unlockRule: { previousCorePct: Math.round(a.unlockPct * 100), level: a.unlockLevel, staticLock: a.staticLock },
      progress: { coreDone: a.coreDone, coreTotal: a.coreTotal },
      quests: a.quests.map((q) => ({
        id: q.id,
        kind: q.kind,
        title: q.title,
        repo: q.repo,
        rank: q.rank,
        ...(q.unitId === null ? {} : { unitId: q.unitId }),
        state: q.state,
        core: q.core,
        contentPending: q.contentPending,
        twinRepo: q.twinRepo,
      })),
    })),
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
    if (err instanceof CheckRefusedError) throw new HttpError(409, 'CHECK_INTEGRITY', err.message);
    if (err instanceof SubmissionShapeError) {
      throw new HttpError(400, 'VALIDATION', err.message, [{ path: 'body', message: err.message }]);
    }
    throw err;
  }
}

function assertTrackOpen(db: Db, unit: UnitRecord): void {
  if (getTrack(db, unit.trackId)?.locked) throw new HttpError(403, 'TRACK_LOCKED', `track ${unit.trackId} is locked`);
  // W5b: a campaign quest's unit is playable only once its act is unlocked (derived, engines/campaign.ts)
  if (questUnitUnlocked(db, unit.id) === false) {
    throw new HttpError(403, 'ACT_LOCKED', `unit ${unit.id} belongs to a campaign act that is not unlocked yet`);
  }
}

/** W7 (audit #1): run AND submit on a changed-example retest need an open gate. */
function assertRetestGate(deps: ServiceDeps, unit: UnitRecord): RetestGateView | null {
  if (unit.kind !== 'retest') return null;
  const g = retestGate(deps.db, unit.id, deps.clock);
  if (g.open) return g;
  if (g.reason === 'not-due') {
    throw new HttpError(
      409,
      'NOT_DUE',
      `this changed-example retest opens at ${new Date(g.opensAt!).toISOString()} (>= 2 days after the artifact and its explain-back); until then it can be neither run nor submitted`,
    );
  }
  throw new HttpError(
    409,
    'RETEST_NOT_OPEN',
    `unit ${unit.id} is a changed-example retest with no schedule: pass its artifact unit solo, then that artifact's explain-back with >= 80% coverage; the retest opens >= 2 days later`,
  );
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
const SUBMIT_ONLY_CHECKS: ReadonlySet<CheckSpec['type']> = new Set<CheckSpec['type']>(['quiz', 'predict-output', 'study-quiz']);

/** W6: answer-first units are never run/submitted: they have their own immutable-answer endpoints. */
const ANSWER_FIRST_CHECKS: ReadonlyMap<CheckSpec['type'], string> = new Map<CheckSpec['type'], string>([
  ['explain-back', 'explain-back/answers'],
  ['patch-kata', 'kata/findings'],
]);

function refuseAnswerFirst(unit: UnitRecord, check: CheckRecord): void {
  const route = ANSWER_FIRST_CHECKS.get(check.type);
  if (route) {
    throw new HttpError(409, 'WRONG_UNIT_KIND', `${check.type} units are answered first, then self-scored: POST /api/units/${unit.id}/${route}`);
  }
}

const PROJECT_KIND_SET: ReadonlySet<string> = new Set(PROJECT_UNIT_KINDS);

/**
 * The evidence kind a graded submit writes (W6): a project unit's submit IS the
 * promotion leg (a) artifact; a changed-example retest unit's submit IS leg (c);
 * everything else is plain 'submit' evidence. The engine still re-verifies all
 * of it (verified pass, solo, timing) before a leg counts.
 */
function submitEvidenceKind(unit: UnitRecord): 'artifact' | 'retest' | 'submit' {
  if (PROJECT_KIND_SET.has(unit.kind)) return 'artifact';
  if (unit.kind === 'retest' && unit.variationOfUnitId !== null) return 'retest';
  return 'submit';
}

/**
 * What the API hands the service: the runner shape plus (W8) the study-quiz answer set. Kept
 * out of runners.ts on purpose: that file is part of the JS grader fingerprint (every stamped
 * JS pack binds its bytes).
 */
export type ServiceSubmission = LearnerSubmission & { answers?: (string | number)[] };

/** POST /run — free, unlimited, NOT logged: grades and returns; writes nothing. Not for quiz / predict-output / study-quiz. */
export async function runUnit(deps: ServiceDeps, unitId: number, submission: ServiceSubmission): Promise<CanonicalRunResult> {
  const unit = requireUnit(deps.db, unitId);
  assertTrackOpen(deps.db, unit);
  const check = requireCheck(deps.db, unit);
  refuseAnswerFirst(unit, check);
  assertRetestGate(deps, unit);
  if (SUBMIT_ONLY_CHECKS.has(check.type)) {
    throw new HttpError(409, 'RUN_NOT_AVAILABLE', `${check.type} checks are submit-only (a free run would reveal the answer)`);
  }
  return grade(deps, check.spec, submission);
}

/** What the attempt row stores as the learner's submission (exactly one shape was sent). */
function recordedAnswer(s: ServiceSubmission): Record<string, unknown> {
  if (s.code !== undefined) return { code: s.code };
  if (s.port !== undefined) return { port: s.port };
  if (s.repoPath !== undefined) return { repoPath: s.repoPath };
  if (s.answers !== undefined) return { answers: s.answers };
  return { answer: s.answer };
}

/**
 * POST /submit — same grading as run, then (one transaction): append-only
 * attempt + run rows, XP via the xp engine on pass (reveal / once-per-unit
 * rules live there), an evidence row per declared competency, slate update.
 */
export async function submitUnit(
  deps: ServiceDeps,
  unitId: number,
  submission: ServiceSubmission & { selfAssisted: boolean },
): Promise<SubmitResponse> {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertTrackOpen(db, unit);
  const check = requireCheck(db, unit);
  refuseAnswerFirst(unit, check);
  // W6/W7: a changed-example retest opens >= 2 days after artifact + explain-back (or as guided
  // practice after a reveal); before that nothing is graded or recorded (the engine's 48h rule
  // on attempt time stays the truth either way)
  assertRetestGate(deps, unit);
  // W8: a study-quiz gate is graded HERE from the stamped quest pack (full answer set, >= 80%);
  // a registered 'study-quiz' runner (test stand-in) still takes precedence for `answer` bodies
  let study: StudyGradeResult | null = null;
  let result: CanonicalRunResult;
  if (check.spec.type === 'study-quiz' && (submission.answers !== undefined || !deps.runners['study-quiz'])) {
    study = gradeStudySubmission(deps.seedItems, check.spec, submission.answers);
    result = study.result;
  } else {
    result = await grade(deps, check.spec, submission);
  }

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
        answer: recordedAnswer(submission),
        ...(study ? { score: study.grade.score } : {}),
      },
      clock,
    );

    // W8: misses become FSRS cards (due tomorrow, deduped); the first pass enrolls the quest's flashcards
    let studyQuiz: SubmitResponse['studyQuiz'];
    if (study && check.spec.type === 'study-quiz') {
      const cards = queueQuizMisses(db, unit.id, study.grade.missed, clock);
      const flashcardsEnrolled = verdict === 'pass' ? enrollFlashcards(db, unit.id, study.flashcardKeys, clock) : 0;
      studyQuiz = {
        correct: study.grade.correct,
        total: study.grade.total,
        score: study.grade.score,
        passPct: Math.round(check.spec.passPct * 100),
        passed: verdict === 'pass',
        items: study.grade.items,
        reviewCards: cards,
        flashcardsEnrolled,
      };
    }

    let xp: SubmitResponse['xp'] = null;
    const kind = xpKindForCheck(check.type);
    if (verdict === 'pass' && kind !== null) {
      // the engine re-verifies the attempt and reads difficulty/track from the unit row
      const award = awardXp(db, { kind, attemptId: attempt.id }, clock);
      xp = { id: award.id, amount: award.amount, reason: award.reason };
    }

    const evidenceKind = submitEvidenceKind(unit);
    const competencies = unitCompetencies(db, unit.id);
    const evidenceIds = competencies.map(
      (competency: CompetencyId) =>
        recordEvidence(
          db,
          {
            competency,
            kind: evidenceKind,
            intention: `${evidenceKind === 'submit' ? 'submit' : evidenceKind === 'artifact' ? 'project artifact' : 'changed-example retest'} ${unit.key} (${check.type})`,
            observation: study
              ? `study quiz ${study.grade.correct}/${study.grade.total} (${Math.floor(study.grade.score * 100)}%) ${result.pass ? 'passed' : 'below the pass mark'}`
              : result.pass
                ? 'check passed'
                : `check failed (${result.failures.length} failing)`,
            attemptId: attempt.id,
          },
          clock,
        ).id,
    );

    // W6: a passing artifact / retest may complete a linked three-leg chain (engine decides)
    const promotions = verdict === 'pass' ? competencies.flatMap((c) => promoteIfEligible(db, c, clock) ?? []) : [];

    composeSlate(db, clock); // slots are derived from the ledger; this only opens today's row

    return {
      result,
      verdict,
      attempt: { id: attempt.id, mode: attempt.mode, outcome: attempt.outcome },
      runId,
      xp,
      evidenceIds,
      promotions,
      ...(studyQuiz ? { studyQuiz } : {}),
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
      competencies: competencyRowsWithPromotion(db, clock),
      slate: { day: slate.day, status: slate.status, items: slate.items },
      reviewQueue: { due: dueCount(db, clock) },
      nextUp,
    };
  });
}
