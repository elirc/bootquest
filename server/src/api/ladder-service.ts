import type { CheckSpec, CompetencyId, EvidenceKind } from '@bootquest/shared';
import {
  G1_MIN_DEFECTS,
  G1_TARGET_RATE,
  type AnswerRecordedResponse,
  type AttemptDetailResponse,
  type CompetenciesResponse,
  type EvidenceListResponse,
  type ExplainBackAnswersBody,
  type ExplainBackKeyResponse,
  type ExplainBackScoreResponse,
  type KataFindingsBody,
  type KataKeyResponse,
  type KataScoreResponse,
  type KataStatsResponse,
  type MutationMarkerBody,
  type MutationMarkerResponse,
  type RatingChangeDto,
} from '@bootquest/shared/api';
import type { Db } from '../db/database.ts';
import { HonestyRuleError, recordAttempt, type AttemptRow } from '../engines/attempts.ts';
import { PROMOTION_MIN_COVERAGE, promoteIfEligible, recordEvidence } from '../engines/evidence.ts';
import { MutationGateError, openRetests, promotionProgress, recordMutationEvidence, scheduleRetests } from '../engines/ladder.ts';
import { closeElapsedDays, composeSlate } from '../engines/streak.ts';
import { awardXp } from '../engines/xp.ts';
import { competencyTable, getTrack, getUnit, primaryCheck, unitCompetencies, type CheckRecord, type UnitRecord } from '../store/queries.ts';
import { explainBackKey, explainBackQuestions, kataKey, kataPublic, seedItemHash, type SeedItemStore } from '../store/seed-items.ts';
import type { SeedExplainBackItem, SeedPatchKataItem } from '@bootquest/shared';
import { HttpError } from './http.ts';
import { questUnitUnlocked } from '../engines/campaign.ts';
import type { Clock } from '../engines/clock.ts';

/**
 * W6 competency-ladder endpoints (spec §4 explain-back + patch-review kata rows,
 * §5 mutation gate, §6.2 promotion, §8 G1). The CONTRACT (immutable answer first):
 *   1. GET /units/:id serves the PUBLIC half only (questions; diff + context);
 *   2. POST .../answers | .../findings writes the learner's answer as an
 *      append-only attempt (mode/assistance derived; a second answer is 403);
 *   3. only AFTER that row exists does GET .../key release the private half;
 *   4. POST .../self-score files the self-assessment as EVIDENCE on that attempt
 *      (assessor self, same-sitting window), never as an edit of the answer.
 * Every rule the engines own (coverage threshold, legs, XP verification,
 * windows) stays in the engines; this layer orchestrates and maps errors.
 */
export interface LadderDeps {
  db: Db;
  clock: Clock;
  seedItems: SeedItemStore;
}

// ---------------------------------------------------------------- shared helpers

function requireUnit(db: Db, id: number): UnitRecord {
  const unit = getUnit(db, id);
  if (!unit) throw new HttpError(404, 'NOT_FOUND', `unit ${id} not found`);
  return unit;
}

function assertOpen(db: Db, unit: UnitRecord): void {
  if (getTrack(db, unit.trackId)?.locked) throw new HttpError(403, 'TRACK_LOCKED', `track ${unit.trackId} is locked`);
  if (questUnitUnlocked(db, unit.id) === false) {
    throw new HttpError(403, 'ACT_LOCKED', `unit ${unit.id} belongs to a campaign act that is not unlocked yet`);
  }
}

type Typed<T extends CheckSpec['type']> = CheckRecord & { spec: Extract<CheckSpec, { type: T }> };

function requireCheckType<T extends CheckSpec['type']>(db: Db, unit: UnitRecord, type: T, endpoint: string): Typed<T> {
  const check = primaryCheck(db, unit.id);
  if (!check || check.spec.type !== type) {
    throw new HttpError(409, 'WRONG_UNIT_KIND', `unit ${unit.id} is not a ${type} unit (${check?.type ?? 'no check'}); ${endpoint} is for ${type} units only`);
  }
  return check as Typed<T>;
}

/** Map an engine honesty refusal to its HTTP shape; anything else propagates (500). */
function honest<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof MutationGateError) {
      throw new HttpError(409, 'MUTATION_BELOW_THRESHOLD', err.message);
    }
    if (err instanceof HonestyRuleError) {
      switch (err.code) {
        case 'STALE':
          throw new HttpError(409, 'SCORE_WINDOW_CLOSED', err.message);
        case 'NOT_VERIFIED':
        case 'MISMATCH':
          throw new HttpError(409, 'NOT_VERIFIED', err.message);
        case 'WRONG_UNIT_KIND':
          throw new HttpError(409, 'WRONG_UNIT_KIND', err.message);
        case 'NOT_DUE':
          throw new HttpError(409, 'NOT_DUE', err.message);
        default:
          break;
      }
    }
    throw err;
  }
}

type AnswerMarker = 'explainBack' | 'kata';
const ITEM_KEY_PATH: Readonly<Record<AnswerMarker, string>> = { explainBack: '$.explainBack.questionSetKey', kata: '$.kata.kataKey' };

/**
 * The learner's FIRST (and only) recorded answer to this SEED ITEM - across ALL units
 * (W7, audit #3): answer-before-key is enforced per question set / kata, not per unit, so
 * reading item S's key through unit A can never precede a "fresh" answer to S on unit B.
 */
function firstAnswer(db: Db, marker: AnswerMarker, itemKey: string): AttemptRow | undefined {
  return db.get<AttemptRow>(
    `SELECT * FROM attempt WHERE outcome = 'submitted' AND json_extract(answer, '${ITEM_KEY_PATH[marker]}') = ?
      ORDER BY id LIMIT 1`,
    itemKey,
  );
}

interface StoredAnswer {
  explainBack?: { questionSetKey?: string; itemSha?: string; answers?: unknown };
  kata?: { kataKey?: string; itemSha?: string; defectCount?: number; findings?: KataKeyResponse['findings'] };
}

const storedAnswer = (a: AttemptRow): StoredAnswer => JSON.parse(a.answer ?? '{}') as StoredAnswer;

/**
 * W7 (audit #8): the key / self-score of an answer is the key of the item AS ANSWERED. Ids
 * are positional, so a re-seeded item would silently re-label them: refuse instead.
 * (Answers recorded before W7 carry no hash and are accepted as before.)
 */
function assertSameContent(stored: string | undefined, item: SeedExplainBackItem | SeedPatchKataItem, attemptId: number): void {
  if (stored !== undefined && stored !== seedItemHash(item)) {
    throw new HttpError(
      409,
      'CONTENT_CHANGED',
      `answer #${attemptId} was recorded against an earlier version of ${item.key}; the loaded item was re-seeded since, so its key no longer matches your answer`,
    );
  }
}

/** The answer must live on THIS unit for a self-score (evidence binds the unit's competencies). */
function assertAnsweredHere(unit: UnitRecord, attempt: AttemptRow): void {
  if (attempt.unit_id !== unit.id) {
    throw new HttpError(403, 'ALREADY_ANSWERED', `this item was answered on unit ${attempt.unit_id} (answer #${attempt.id}); self-score it there`);
  }
}

function scoredOn(db: Db, attemptId: number, kind: 'explain-back' | 'kata'): { score: number; evidenceIds: number[]; at: number } | null {
  const rows = db.all<{ id: number; score: number | null; at: number }>(
    'SELECT id, score, created_at AS at FROM evidence WHERE attempt_id = ? AND kind = ? ORDER BY id',
    attemptId,
    kind,
  );
  if (rows.length === 0) return null;
  return { score: rows[0]!.score ?? 0, evidenceIds: rows.map((r) => r.id), at: rows[0]!.at };
}

function promoteAll(db: Db, competencies: readonly CompetencyId[], clock: Clock): RatingChangeDto[] {
  return competencies.flatMap((c) => {
    const ch = promoteIfEligible(db, c, clock);
    return ch ? [ch] : [];
  });
}

function requireCompetencies(db: Db, unit: UnitRecord): CompetencyId[] {
  const cs = unitCompetencies(db, unit.id);
  if (cs.length === 0) throw new HttpError(409, 'CONTENT_PENDING', `unit ${unit.id} declares no competency, so a self-score has nothing to evidence`);
  return cs;
}

/** Every listed id marked exactly once, nothing extra (400 with per-id issues otherwise). */
function assertExactMarks(expected: readonly string[], got: Record<string, string>, field: string): void {
  const want = new Set(expected);
  const issues = [
    ...expected.filter((id) => !(id in got)).map((id) => ({ path: `body.${field}.${id}`, message: 'not marked' })),
    ...Object.keys(got)
      .filter((id) => !want.has(id))
      .map((id) => ({ path: `body.${field}.${id}`, message: 'no such id in the key' })),
  ];
  if (issues.length) throw new HttpError(400, 'VALIDATION', `mark every ${field === 'perKeyPoint' ? 'key point' : 'defect'} exactly once`, issues);
}

const pct = (x: number): number => Math.round(x * 1000) / 10;

// ---------------------------------------------------------------- explain-back

function requireExplainBack(deps: LadderDeps, unit: UnitRecord, endpoint: string) {
  const check = requireCheckType(deps.db, unit, 'explain-back', endpoint);
  const item = deps.seedItems.explainBack(check.spec.questionSetKey);
  if (!item) throw new HttpError(409, 'CONTENT_PENDING', `question set ${check.spec.questionSetKey} is not loaded on this server (seed it with seed:explainback)`);
  return { check, item };
}

/**
 * W7 (audit #12e): the pass mark this unit shows AND enforces - the check's own minCoverage,
 * never below the promotion floor (a unit can be stricter than 80%, never laxer).
 */
export function effectiveMinCoverage(spec: CheckSpec): number {
  return spec.type === 'explain-back' ? Math.max(spec.minCoverage, PROMOTION_MIN_COVERAGE) : PROMOTION_MIN_COVERAGE;
}

/** Public half for GET /units/:id (null = content pending). */
export function explainBackPublicFor(seedItems: SeedItemStore, spec: CheckSpec) {
  if (spec.type !== 'explain-back') return undefined;
  const item = seedItems.explainBack(spec.questionSetKey);
  return item ? { questions: explainBackQuestions(item), minCoveragePct: pct(effectiveMinCoverage(spec)) } : null;
}

export function kataPublicFor(seedItems: SeedItemStore, spec: CheckSpec) {
  if (spec.type !== 'patch-kata') return undefined;
  const item = seedItems.kata(spec.kataKey);
  return item ? kataPublic(item) : null;
}

/** POST /units/:id/explain-back/answers — the immutable answer, BEFORE any key point is readable. */
export function answerExplainBack(deps: LadderDeps, unitId: number, body: ExplainBackAnswersBody): AnswerRecordedResponse {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertOpen(db, unit);
  const { check, item } = requireExplainBack(deps, unit, 'explain-back answers');
  if (body.answers.length !== item.questions.length) {
    throw new HttpError(400, 'VALIDATION', `this set has ${item.questions.length} questions; send exactly one answer per question`, [
      { path: 'body.answers', message: `expected ${item.questions.length} answers, got ${body.answers.length}` },
    ]);
  }
  return db.tx(() => {
    const prior = firstAnswer(db, 'explainBack', item.key);
    if (prior) {
      throw new HttpError(
        403,
        'ALREADY_ANSWERED',
        prior.unit_id === unit.id
          ? `unit ${unit.id}: your explain-back answer #${prior.id} is recorded and immutable; open its key instead`
          : `question set ${item.key} was already answered on unit ${prior.unit_id} (answer #${prior.id}); its key may have been read, so it cannot be answered again`,
      );
    }
    const attempt = recordAttempt(
      db,
      {
        unitId: unit.id,
        checkId: check.id,
        selfAssisted: body.selfAssisted,
        answer: { explainBack: { questionSetKey: item.key, itemSha: seedItemHash(item), answers: body.answers } },
      },
      clock,
    );
    return { attemptId: attempt.id, mode: attempt.mode, outcome: 'submitted' };
  });
}

/** GET /units/:id/explain-back/key — 403 NOT_ANSWERED until the answer row exists. */
export function getExplainBackKey(deps: LadderDeps, unitId: number): ExplainBackKeyResponse {
  const { db } = deps;
  const unit = requireUnit(db, unitId);
  const check = requireCheckType(db, unit, 'explain-back', 'the explain-back key');
  const attempt = firstAnswer(db, 'explainBack', check.spec.questionSetKey);
  if (!attempt) {
    throw new HttpError(403, 'NOT_ANSWERED', `unit ${unit.id}: record your answers first (POST /api/units/${unit.id}/explain-back/answers) — the key is shown only after`);
  }
  const item = deps.seedItems.explainBack(check.spec.questionSetKey);
  if (!item) throw new HttpError(409, 'CONTENT_PENDING', `question set ${check.spec.questionSetKey} is not loaded on this server`);
  const stored = storedAnswer(attempt);
  assertSameContent(stored.explainBack?.itemSha, item, attempt.id);
  const answers = Array.isArray(stored.explainBack?.answers) ? stored.explainBack.answers.map(String) : [];
  return { attemptId: attempt.id, answeredAt: attempt.created_at, answers, questions: explainBackKey(item), scored: scoredOn(db, attempt.id, 'explain-back') };
}

/**
 * POST /units/:id/explain-back/self-score — per-key-point covered|missed -> coverage,
 * filed as explain-back evidence (assessor self, engine window); >= 80% pays 20 XP once
 * and schedules the changed-example retest (>= 2 days out); then the promotion rule runs.
 */
export function selfScoreExplainBack(deps: LadderDeps, unitId: number, body: { perKeyPoint: Record<string, 'covered' | 'missed'> }): ExplainBackScoreResponse {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertOpen(db, unit);
  const { check, item } = requireExplainBack(deps, unit, 'explain-back self-score');
  const attempt = firstAnswer(db, 'explainBack', item.key);
  if (!attempt) throw new HttpError(403, 'NOT_ANSWERED', `unit ${unit.id}: record your answers before self-scoring`);
  assertAnsweredHere(unit, attempt);
  assertSameContent(storedAnswer(attempt).explainBack?.itemSha, item, attempt.id);
  const competencies = requireCompetencies(db, unit);
  const ids = explainBackKey(item).flatMap((q) => q.keyPoints.map((k) => k.id));
  assertExactMarks(ids, body.perKeyPoint, 'perKeyPoint');
  const missed = ids.filter((id) => body.perKeyPoint[id] === 'missed');
  const covered = ids.length - missed.length;
  const coverage = covered / ids.length;
  const minCoverage = effectiveMinCoverage(check.spec);
  const passed = coverage >= minCoverage;

  return honest(() =>
    db.tx(() => {
      if (scoredOn(db, attempt.id, 'explain-back')) {
        throw new HttpError(409, 'ALREADY_SCORED', `answer #${attempt.id} is already self-scored (evidence is append-only)`);
      }
      closeElapsedDays(db, clock);
      const evidenceIds = competencies.map(
        (competency) =>
          recordEvidence(
            db,
            {
              competency,
              kind: 'explain-back',
              intention: 'explain-back with the code hidden: answers stored first, then self-scored against the key points',
              observation: `${covered}/${ids.length} key points covered (${pct(coverage)}%)${missed.length ? `; missed ${missed.join(', ')}` : ''}`,
              score: coverage,
              attemptId: attempt.id,
            },
            clock,
          ).id,
      );
      const award = passed ? awardXp(db, { kind: 'explain-back', attemptId: attempt.id }, clock) : null;
      const retests = passed ? scheduleRetests(db, attempt.id, clock) : [];
      const promotions = promoteAll(db, competencies, clock);
      composeSlate(db, clock);
      return {
        attemptId: attempt.id,
        covered,
        total: ids.length,
        coverage,
        minCoveragePct: pct(minCoverage),
        passed,
        missed,
        evidenceIds,
        xp: award ? { id: award.id, amount: award.amount, reason: award.reason } : null,
        retests: retests.map((r) => ({ reviewItemId: r.reviewItemId, unitId: r.unitId, title: r.title, dueAt: r.dueAt, artifactUnitId: r.artifactUnitId })),
        promotions,
      };
    }),
  );
}

// ---------------------------------------------------------------- patch-review kata

function requireKata(deps: LadderDeps, unit: UnitRecord, endpoint: string) {
  const check = requireCheckType(deps.db, unit, 'patch-kata', endpoint);
  const item = deps.seedItems.kata(check.spec.kataKey);
  if (!item) throw new HttpError(409, 'CONTENT_PENDING', `kata ${check.spec.kataKey} is not loaded on this server (seed it with seed:patches)`);
  return { check, item };
}

/** POST /units/:id/kata/findings — {scenario, evidence, consequence}[] stored immutably before the key. */
export function submitKataFindings(deps: LadderDeps, unitId: number, body: KataFindingsBody): AnswerRecordedResponse {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertOpen(db, unit);
  const { check, item } = requireKata(deps, unit, 'kata findings');
  return db.tx(() => {
    const prior = firstAnswer(db, 'kata', item.key);
    if (prior) {
      throw new HttpError(
        403,
        'ALREADY_ANSWERED',
        prior.unit_id === unit.id
          ? `unit ${unit.id}: your findings #${prior.id} are recorded and immutable; open the key instead`
          : `kata ${item.key} was already answered on unit ${prior.unit_id} (findings #${prior.id}); it cannot be answered again`,
      );
    }
    const attempt = recordAttempt(
      db,
      {
        unitId: unit.id,
        checkId: check.id,
        selfAssisted: body.selfAssisted,
        // the defect count AS ANSWERED is stored with the findings: G1 totals never move on a re-seed (audit #8)
        answer: { kata: { kataKey: item.key, itemSha: seedItemHash(item), defectCount: item.seededDefectKey.length, findings: body.findings } },
      },
      clock,
    );
    return { attemptId: attempt.id, mode: attempt.mode, outcome: 'submitted' };
  });
}

export function getKataKey(deps: LadderDeps, unitId: number): KataKeyResponse {
  const { db } = deps;
  const unit = requireUnit(db, unitId);
  const check = requireCheckType(db, unit, 'patch-kata', 'the kata key');
  const attempt = firstAnswer(db, 'kata', check.spec.kataKey);
  if (!attempt) {
    throw new HttpError(403, 'NOT_ANSWERED', `unit ${unit.id}: record your findings first (POST /api/units/${unit.id}/kata/findings) — the seeded-defect key is shown only after`);
  }
  const item = deps.seedItems.kata(check.spec.kataKey);
  if (!item) throw new HttpError(409, 'CONTENT_PENDING', `kata ${check.spec.kataKey} is not loaded on this server`);
  const stored = storedAnswer(attempt);
  assertSameContent(stored.kata?.itemSha, item, attempt.id);
  return { attemptId: attempt.id, answeredAt: attempt.created_at, findings: stored.kata?.findings ?? [], defects: kataKey(item), scored: scoredOn(db, attempt.id, 'kata') };
}

/** POST /units/:id/kata/self-score — per-defect caught|missed -> catch rate as kata evidence + 15 XP once. */
export function selfScoreKata(deps: LadderDeps, unitId: number, body: { perDefect: Record<string, 'caught' | 'missed'> }): KataScoreResponse {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertOpen(db, unit);
  const { item } = requireKata(deps, unit, 'kata self-score');
  const attempt = firstAnswer(db, 'kata', item.key);
  if (!attempt) throw new HttpError(403, 'NOT_ANSWERED', `unit ${unit.id}: record your findings before self-scoring`);
  assertAnsweredHere(unit, attempt);
  assertSameContent(storedAnswer(attempt).kata?.itemSha, item, attempt.id);
  const competencies = requireCompetencies(db, unit);
  const ids = kataKey(item).map((d) => d.id);
  assertExactMarks(ids, body.perDefect, 'perDefect');
  const missed = ids.filter((id) => body.perDefect[id] === 'missed');
  const caught = ids.length - missed.length;
  const catchRate = caught / ids.length;
  return honest(() =>
    db.tx(() => {
      if (scoredOn(db, attempt.id, 'kata')) throw new HttpError(409, 'ALREADY_SCORED', `findings #${attempt.id} are already self-scored (evidence is append-only)`);
      closeElapsedDays(db, clock);
      const evidenceIds = competencies.map(
        (competency) =>
          recordEvidence(
            db,
            {
              competency,
              kind: 'kata',
              intention: 'patch-review kata: findings stored first, then self-scored against the seeded-defect key',
              observation: `caught ${caught}/${ids.length} seeded defects (${pct(catchRate)}%)${missed.length ? `; missed ${missed.join(', ')}` : ''}`,
              score: catchRate,
              attemptId: attempt.id,
            },
            clock,
          ).id,
      );
      const award = awardXp(db, { kind: 'patch-kata', attemptId: attempt.id }, clock);
      composeSlate(db, clock);
      return {
        attemptId: attempt.id,
        caught,
        total: ids.length,
        catchRate,
        missed,
        evidenceIds,
        xp: { id: award.id, amount: award.amount, reason: award.reason },
      };
    }),
  );
}

/**
 * GET /stats/katas - the G1 aggregate: seeded defects caught across every scored SOLO kata.
 * W7 (audit #2): self-flagged assisted and reveal-guided answers never count toward the
 * core-skill gate; they are reported separately as assistedCount. W7 (audit #8): the
 * defect total is the count stored WITH the answer (as answered), not the current key.
 */
export function kataStats(deps: LadderDeps): KataStatsResponse {
  const { db } = deps;
  const rows = db.all<{ attemptId: number; unitId: number; score: number; mode: string; assisted: number; answer: string | null }>(
    `SELECT e.attempt_id AS attemptId, a.unit_id AS unitId, MIN(e.score) AS score, a.mode AS mode,
            MAX(CASE WHEN e.assistance <> 'none' THEN 1 ELSE 0 END) AS assisted, a.answer AS answer
       FROM evidence e JOIN attempt a ON a.id = e.attempt_id
      WHERE e.kind = 'kata' GROUP BY e.attempt_id ORDER BY e.attempt_id`,
  );
  let caught = 0;
  let total = 0;
  let katas = 0;
  let assistedCount = 0;
  for (const r of rows) {
    if (r.mode !== 'solo' || r.assisted) {
      assistedCount += 1;
      continue;
    }
    const storedCount = (JSON.parse(r.answer ?? '{}') as StoredAnswer).kata?.defectCount;
    let n: number;
    if (typeof storedCount === 'number' && storedCount > 0) {
      n = storedCount;
    } else {
      // pre-W7 answers carry no count: fall back to the loaded key; unloaded content cannot be counted honestly
      const check = primaryCheck(db, r.unitId);
      const item = check?.spec.type === 'patch-kata' ? deps.seedItems.kata(check.spec.kataKey) : undefined;
      if (!item) continue;
      n = item.seededDefectKey.length;
    }
    katas += 1;
    total += n;
    caught += Math.round(r.score * n);
  }
  const rate = total === 0 ? null : caught / total;
  return {
    katasScored: katas,
    assistedCount,
    defectsCaught: caught,
    defectsTotal: total,
    catchRate: rate,
    gate: {
      targetRate: G1_TARGET_RATE,
      minDefects: G1_MIN_DEFECTS,
      met: rate !== null && total >= G1_MIN_DEFECTS && rate >= G1_TARGET_RATE,
      rule: `G1: catch >= ${G1_TARGET_RATE * 10}/10 seeded defects (scenario + evidence + consequence) across at least ${G1_MIN_DEFECTS} seeded defects`,
    },
  };
}

// ---------------------------------------------------------------- mutation gate marker

/** POST /units/:id/mutation — server re-evaluates the floor/break; records verified pipeline evidence. */
export function recordMutationMarker(deps: LadderDeps, unitId: number, body: MutationMarkerBody): MutationMarkerResponse {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertOpen(db, unit);
  const r = honest(() =>
    recordMutationEvidence(
      db,
      {
        unitId: unit.id,
        ...(body.attemptId !== undefined ? { attemptId: body.attemptId } : {}),
        tool: body.tool,
        toolVersion: body.toolVersion,
        durationMs: body.durationMs,
        files: body.files,
      },
      clock,
    ),
  );
  return { unitId: unit.id, attemptId: r.attemptId, verdict: r.verdict, evidenceIds: r.evidenceIds };
}

// ---------------------------------------------------------------- promotion visibility + evidence browser

export function competencyRowsWithPromotion(db: Db, clock: Clock) {
  return competencyTable(db).map((r) => ({ ...r, promotion: promotionProgress(db, r.id, clock) }));
}

/** GET /competencies — the 7 ratings, each with its three-leg progress, plus open retests. */
export function getCompetencies(deps: LadderDeps): CompetenciesResponse {
  const { db, clock } = deps;
  return {
    competencies: competencyRowsWithPromotion(db, clock),
    retests: openRetests(db, clock).map((r) => ({
      reviewItemId: r.reviewItemId,
      unitId: r.unitId,
      title: r.title,
      dueAt: r.dueAt,
      artifactUnitId: r.artifactUnitId,
      due: r.due,
    })),
  };
}

export const DEFAULT_EVIDENCE_LIMIT = 200;

/** GET /evidence?competency=&kind=&limit= — newest first. */
export function listEvidence(deps: LadderDeps, q: { competency?: CompetencyId; kind?: EvidenceKind; limit?: number }): EvidenceListResponse {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q.competency) {
    where.push('e.competency_id = ?');
    params.push(q.competency);
  }
  if (q.kind) {
    where.push('e.kind = ?');
    params.push(q.kind);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = deps.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM evidence e ${w}`, ...params)?.n ?? 0;
  const items = deps.db.all<EvidenceListResponse['items'][number]>(
    `SELECT e.id AS id, e.competency_id AS competency, e.kind AS kind, e.intention AS intention, e.observation AS observation,
            e.assistance AS assistance, e.assessor AS assessor, e.rating AS rating, e.verified AS verified, e.score AS score,
            e.attempt_id AS attemptId, e.unit_id AS unitId, u.title AS unitTitle, e.created_at AS createdAt
       FROM evidence e LEFT JOIN unit u ON u.id = e.unit_id ${w}
      ORDER BY e.id DESC LIMIT ?`,
    ...params,
    q.limit ?? DEFAULT_EVIDENCE_LIMIT,
  );
  return { total, items: items.map((i) => ({ ...i, verified: Boolean(i.verified) })) };
}

/** GET /attempts/:id — one ledger attempt (the learner's own answer + its submit runs). */
export function getAttemptDetail(deps: LadderDeps, attemptId: number): AttemptDetailResponse {
  const { db } = deps;
  const a = db.get<{ id: number; unitId: number; unitTitle: string; unitKind: AttemptDetailResponse['unitKind']; mode: AttemptDetailResponse['mode']; outcome: string; answer: string | null; createdAt: number }>(
    `SELECT a.id AS id, a.unit_id AS unitId, u.title AS unitTitle, u.kind AS unitKind, a.mode AS mode, a.outcome AS outcome,
            a.answer AS answer, a.created_at AS createdAt
       FROM attempt a JOIN unit u ON u.id = a.unit_id WHERE a.id = ?`,
    attemptId,
  );
  if (!a) throw new HttpError(404, 'NOT_FOUND', `attempt ${attemptId} not found`);
  const runs = db.all<AttemptDetailResponse['runs'][number]>(
    `SELECT id, verdict, duration_ms AS durationMs, created_at AS createdAt FROM run WHERE attempt_id = ? AND kind = 'submit' ORDER BY id`,
    attemptId,
  );
  const evidenceIds = db.all<{ id: number }>('SELECT id FROM evidence WHERE attempt_id = ? ORDER BY id', attemptId).map((r) => r.id);
  return { ...a, answer: a.answer === null ? null : (JSON.parse(a.answer) as unknown), runs, evidenceIds };
}
