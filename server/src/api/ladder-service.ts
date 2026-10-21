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
  type ExplainBackPracticeBody,
  type ExplainBackPracticeScoreBody,
  type ExplainBackPublic,
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
import { artifactsAwaitingSoloPass, EB_SET_MIN_GAP_MS, MutationGateError, openRetests, promotionProgress, recordMutationEvidence, scheduleRetests } from '../engines/ladder.ts';
import { closeElapsedDays, composeSlate } from '../engines/streak.ts';
import { awardXp } from '../engines/xp.ts';
import { competencyTable, getTrack, getUnit, primaryCheck, unitCompetencies, type CheckRecord, type UnitRecord } from '../store/queries.ts';
import { explainBackKey, explainBackQuestions, kataKey, kataPublic, seedItemHash, type SeedItemStore } from '../store/seed-items.ts';
import type { SeedExplainBackItem, SeedPatchKataItem } from '@bootquest/shared';
import { HttpError } from './http.ts';
import { questUnitUnlocked } from '../engines/campaign.ts';
import { nowMs, type Clock } from '../engines/clock.ts';
import { ebSetGroup, explainBackUnitKey } from '../store/ladder.ts';

/**
 * W6 competency-ladder endpoints (spec §4 explain-back + patch-review kata rows,
 * §5 mutation gate, §6.2 promotion, §8 G1). The CONTRACT (immutable answer first):
 *   1. GET /units/:id serves the PUBLIC half only (questions; diff + context);
 *   2. POST .../answers | .../findings writes the learner's answer as an
 *      append-only attempt (mode/assistance derived; a second answer to the same item
 *      version is 403; an explain-back that is leg (b) of an artifact is 409 until that
 *      artifact has a solo pass; a re-seeded item version takes one fresh answer);
 *   3. only AFTER that row exists does GET .../key release the private half;
 *   4. POST .../self-score files the self-assessment as EVIDENCE on that attempt
 *      (assessor self; no filing window — legs time on the answer row), never as an
 *      edit of the answer.
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
        // F7c: on a self-score 'STALE' can only mean evidence predating its answer attempt (no filing
        // window since dead end #1): the server clock reads earlier than the answer row. Not an
        // internal error: a 409 the client can explain; nothing was recorded (the tx rolled back).
        case 'STALE':
          throw new HttpError(409, 'EVIDENCE_PREDATES_ATTEMPT', `${err.message}: the server clock reads earlier than the recorded answer (was the clock moved back?); nothing was recorded`);
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
const ITEM_SHA_PATH: Readonly<Record<AnswerMarker, string>> = { explainBack: '$.explainBack.itemSha', kata: '$.kata.itemSha' };
type SeedAnswerItem = SeedExplainBackItem | SeedPatchKataItem;

/**
 * The learner's FIRST recorded answer to this SEED ITEM KEY in any version - across ALL units
 * (W7, audit #3). Only used where the item itself is not loaded (content pending).
 */
function firstAnswer(db: Db, marker: AnswerMarker, itemKey: string): AttemptRow | undefined {
  return db.get<AttemptRow>(
    `SELECT * FROM attempt WHERE outcome = 'submitted' AND json_extract(answer, '${ITEM_KEY_PATH[marker]}') = ?
      ORDER BY id LIMIT 1`,
    itemKey,
  );
}

/**
 * The learner's answer OF RECORD to the seed item AS NOW LOADED - across ALL units (W7, audit
 * #3: answer-before-key is per question set / kata, never per unit, so reading S's key through
 * unit A can never precede a "fresh" answer to S on unit B): the FIRST submitted answer whose
 * stored item hash is the loaded item's hash. Answers recorded before W7 carry no hash and stay
 * the answer of record, as before.
 *
 * Ladder dead end #3 (campaign2-review F11): an answer whose stored hash DIFFERS was recorded
 * against an earlier version of the item (a re-seed under the same key). It is SUPERSEDED -
 * derived from the immutable rows, never written: no attempt is updated, the old row, its
 * evidence and its XP stay exactly as they were. Its key no longer matches (key-point / defect
 * ids are positional, audit #8), so it is never keyed or scored against the new content; instead
 * the new version takes ONE fresh answer of its own (this predicate finds it from then on).
 * A hash change is a re-seed of the stamped pack - which on this single-user install the learner
 * runs themselves - so a re-seed must never reopen a BLIND answer: the earlier answer unlocked
 * the earlier key (key reads are not recorded, so every superseded answer counts as exposure),
 * and the fresh answer is recorded as ASSISTED (assistance 'prior-key', server review F2): it
 * never satisfies promotion leg (b) and never counts as solo for G1 (kataStats also counts each
 * kata key once, by its earliest ANSWER). (Were an old version re-loaded, its own first answer
 * is its record again.)
 */
function currentAnswer(db: Db, marker: AnswerMarker, item: SeedAnswerItem): AttemptRow | undefined {
  return db.get<AttemptRow>(
    `SELECT * FROM attempt WHERE outcome = 'submitted' AND json_extract(answer, '${ITEM_KEY_PATH[marker]}') = ?
        AND (json_extract(answer, '${ITEM_SHA_PATH[marker]}') IS NULL OR json_extract(answer, '${ITEM_SHA_PATH[marker]}') = ?)
      ORDER BY id LIMIT 1`,
    item.key,
    seedItemHash(item),
  );
}

/** Answers to this item key recorded against an EARLIER version (superseded, see currentAnswer). */
function supersededAnswerIds(db: Db, marker: AnswerMarker, item: SeedAnswerItem): number[] {
  return db
    .all<{ id: number }>(
      `SELECT id FROM attempt WHERE outcome = 'submitted' AND json_extract(answer, '${ITEM_KEY_PATH[marker]}') = ?
          AND json_extract(answer, '${ITEM_SHA_PATH[marker]}') IS NOT NULL AND json_extract(answer, '${ITEM_SHA_PATH[marker]}') <> ?
        ORDER BY id`,
      item.key,
      seedItemHash(item),
    )
    .map((r) => r.id);
}

/** 403 NOT_ANSWERED for the loaded version, naming any superseded earlier answer. */
function notAnswered(db: Db, marker: AnswerMarker, item: SeedAnswerItem, unit: UnitRecord, what: string): HttpError {
  const old = supersededAnswerIds(db, marker, item);
  const path = marker === 'explainBack' ? 'explain-back/answers' : 'kata/findings';
  const superseded = old.length
    ? `your earlier ${marker === 'explainBack' ? 'answer' : 'findings'} ${old.map((id) => `#${id}`).join(', ')} answered an earlier version of ${item.key} (re-seeded since) and ${old.length === 1 ? 'is' : 'are'} superseded; `
    : '';
  return new HttpError(403, 'NOT_ANSWERED', `unit ${unit.id}: ${superseded}record your ${what} first (POST /api/units/${unit.id}/${path}) — the key is shown only after`);
}

interface StoredAnswer {
  explainBack?: { questionSetKey?: string; itemSha?: string; answers?: unknown };
  kata?: { kataKey?: string; itemSha?: string; defectCount?: number; findings?: KataKeyResponse['findings'] };
}

const storedAnswer = (a: AttemptRow): StoredAnswer => JSON.parse(a.answer ?? '{}') as StoredAnswer;

/**
 * The answer must live on THIS unit for a self-score (evidence binds the answer's unit and its
 * competencies) - unless that unit was RETIRED (a re-seed / re-link moved the item to a new live
 * unit; retired units 404 everywhere): the stranded answer is then self-scored from the live unit
 * that carries the same item (ladder dead end #3). The evidence still binds the answer's own
 * attempt / unit, so nothing is re-labelled.
 */
function assertAnsweredHere(db: Db, unit: UnitRecord, attempt: AttemptRow): void {
  if (attempt.unit_id === unit.id || getUnit(db, attempt.unit_id) === undefined) return;
  throw new HttpError(403, 'ALREADY_ANSWERED', `this item was answered on unit ${attempt.unit_id} (answer #${attempt.id}); self-score it there`);
}

/** ALREADY_ANSWERED for a second answer to the same item version. */
function alreadyAnswered(db: Db, prior: AttemptRow, unit: UnitRecord, item: SeedAnswerItem, noun: string): HttpError {
  if (prior.unit_id === unit.id) {
    return new HttpError(403, 'ALREADY_ANSWERED', `unit ${unit.id}: your ${noun} #${prior.id} ${noun === 'findings' ? 'are' : 'is'} recorded and immutable; open the key instead`);
  }
  if (getUnit(db, prior.unit_id) === undefined) {
    return new HttpError(
      403,
      'ALREADY_ANSWERED',
      `${item.key} was already answered on unit ${prior.unit_id} (${noun} #${prior.id}), since retired; open its key and self-score it here on unit ${unit.id}`,
    );
  }
  return new HttpError(
    403,
    'ALREADY_ANSWERED',
    `${item.key} was already answered on unit ${prior.unit_id} (${noun} #${prior.id}); its key may have been read, so it cannot be answered again`,
  );
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

/** The competencies of the unit the ANSWER lives on (evidence binds that unit). */
function requireCompetencies(db: Db, unitId: number): CompetencyId[] {
  const cs = unitCompetencies(db, unitId);
  if (cs.length === 0) throw new HttpError(409, 'CONTENT_PENDING', `unit ${unitId} declares no competency, so a self-score has nothing to evidence`);
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

// ---------------------------------------------------------------- explain-back retakes

/**
 * PRACTICE retakes of the LOADED item version (newest last): the voluntary re-answers recorded
 * after the answer of record was self-scored (`$.explainBack.practice` = true; assistance
 * 'practice'). currentAnswer / supersededAnswerIds / firstAnswer need no predicate change: a
 * practice row can only be recorded after a scored answer of record for the same key + sha, so it
 * always has a LATER id and `ORDER BY id LIMIT 1` still returns the answer of record (and, after a
 * re-seed, practice rows of the earlier version are superseded exactly like that version's answer).
 */
function practiceAttempts(db: Db, item: SeedExplainBackItem): AttemptRow[] {
  return db.all<AttemptRow>(
    `SELECT * FROM attempt WHERE outcome = 'submitted' AND json_extract(answer, '$.explainBack.questionSetKey') = ?
        AND json_extract(answer, '$.explainBack.itemSha') = ? AND json_extract(answer, '$.explainBack.practice') = 1
      ORDER BY id`,
    item.key,
    seedItemHash(item),
  );
}

/** The alternate-set label of an item: 'A' for the primary set (no `set` field), else the set id upper-cased. */
const setLabel = (it: SeedExplainBackItem): string => (it.set === undefined ? 'A' : it.set.toUpperCase());

/** Loaded sibling sets of an explain-back item (same provenance repo + path; itself included), in load order. */
function ebSiblings(seedItems: SeedItemStore, item: SeedExplainBackItem): SeedExplainBackItem[] {
  return seedItems.explainBackItems().filter((s) => s.provenance.repo === item.provenance.repo && s.provenance.path === item.provenance.path);
}

/**
 * The alternate-set rotation gate for a FRESH (non-practice) answer to `item`: open when its group
 * has fewer than 2 loaded siblings or no fresh answer yet; else it opens EB_SET_MIN_GAP_MS after
 * the newest fresh answer to ANY sibling (any item version: the key exposure is what is spaced).
 */
function ebSetGate(db: Db, seedItems: SeedItemStore, item: SeedExplainBackItem, clock: Clock): { open: boolean; opensAt: number | null } {
  const sibs = ebSiblings(seedItems, item);
  if (sibs.length < 2) return { open: true, opensAt: null };
  const keys = sibs.map((s) => s.key);
  const last = db.get<{ at: number | null }>(
    `SELECT MAX(created_at) AS at FROM attempt WHERE outcome = 'submitted'
        AND json_extract(answer, '$.explainBack.questionSetKey') IN (${keys.map(() => '?').join(', ')})
        AND json_extract(answer, '$.explainBack.practice') IS NULL`,
    ...keys,
  )?.at;
  if (last === null || last === undefined) return { open: true, opensAt: null };
  const opensAt = last + EB_SET_MIN_GAP_MS;
  return { open: nowMs(clock) >= opensAt, opensAt };
}

/** `altSets` for the unit detail: present only when the group has >= 2 loaded siblings. */
function altSetsFor(db: Db, seedItems: SeedItemStore, item: SeedExplainBackItem, clock: Clock): ExplainBackPublic['altSets'] {
  const sibs = ebSiblings(seedItems, item);
  if (sibs.length < 2) return undefined;
  const siblings = sibs.flatMap((s) => {
    const row = db.get<{ id: number }>('SELECT id FROM unit WHERE key = ? AND retired_at IS NULL', explainBackUnitKey(s));
    if (!row) return [];
    const rec = currentAnswer(db, 'explainBack', s);
    return [{ unitId: row.id, label: setLabel(s), answered: rec !== undefined, scored: rec !== undefined && scoredOn(db, rec.id, 'explain-back') !== null }];
  });
  return { group: ebSetGroup(item), label: setLabel(item), siblings, gate: ebSetGate(db, seedItems, item, clock) };
}

/** `practice` for the unit detail: available once the answer of record exists AND is self-scored. */
function practiceStateFor(db: Db, item: SeedExplainBackItem): NonNullable<ExplainBackPublic['practice']> {
  const rec = currentAnswer(db, 'explainBack', item);
  const rows = practiceAttempts(db, item);
  const latest = rows[rows.length - 1];
  return {
    available: rec !== undefined && scoredOn(db, rec.id, 'explain-back') !== null,
    count: rows.length,
    latestUnscoredAttemptId: latest && scoredOn(db, latest.id, 'explain-back') === null ? latest.id : null,
  };
}

/** Public half for GET /units/:id (null = content pending). */
export function explainBackPublicFor(seedItems: SeedItemStore, spec: CheckSpec, db?: Db, unitId?: number, clock?: Clock) {
  if (spec.type !== 'explain-back') return undefined;
  const item = seedItems.explainBack(spec.questionSetKey);
  if (!item) return null;
  const pub = { questions: explainBackQuestions(item), minCoveragePct: pct(effectiveMinCoverage(spec)) };
  if (!db) return pub;
  // W9 (ui-audit #10): same predicate as GET .../explain-back/key (the loaded version's answer of record)
  const answered = {
    ...pub,
    answered: currentAnswer(db, 'explainBack', item) !== undefined,
    // F7e: structured form of the NOT_ANSWERED "superseded" prose
    supersededAnswerIds: supersededAnswerIds(db, 'explainBack', item),
    // retakes: the same predicates POST .../explain-back/practice enforces
    practice: practiceStateFor(db, item),
  };
  if (unitId === undefined) return answered;
  // dead end #2: the same predicate POST .../answers enforces (409 ARTIFACT_REQUIRED)
  const withArtifacts = { ...answered, artifactRequired: artifactsAwaitingSoloPass(db, unitId) };
  // alternate sets: the same gate POST .../answers enforces (409 NOT_DUE)
  const altSets = clock ? altSetsFor(db, seedItems, item, clock) : undefined;
  return altSets ? { ...withArtifacts, altSets } : withArtifacts;
}

export function kataPublicFor(seedItems: SeedItemStore, spec: CheckSpec, db?: Db) {
  if (spec.type !== 'patch-kata') return undefined;
  const item = seedItems.kata(spec.kataKey);
  if (!item) return null;
  // W9 (ui-audit #10): same predicate as GET .../kata/key
  return db
    ? { ...kataPublic(item), answered: currentAnswer(db, 'kata', item) !== undefined, supersededAnswerIds: supersededAnswerIds(db, 'kata', item) }
    : kataPublic(item);
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
    // one answer per question set VERSION (a superseded earlier-version answer leaves room for one fresh answer)
    const prior = currentAnswer(db, 'explainBack', item);
    if (prior) throw alreadyAnswered(db, prior, unit, item, 'explain-back answer');
    // dead end #2: an answer before the linked artifact's solo pass would burn leg (b) for good
    const pending = artifactsAwaitingSoloPass(db, unit.id);
    if (pending.length > 0) {
      throw new HttpError(
        409,
        'ARTIFACT_REQUIRED',
        `unit ${unit.id}: this explain-back is promotion leg (b) of ${pending.map((p) => `unit ${p.unitId} "${p.title}"`).join(', ')}; ` +
          `pass ${pending.length === 1 ? 'that unit' : 'those units'} solo first (verified submit), then answer — ` +
          'an answer recorded before the artifact can never count, and the set can only be answered once',
      );
    }
    // alternate sets: fresh sets of one question-set group are spaced >= EB_SET_MIN_GAP_MS apart
    const gate = ebSetGate(db, deps.seedItems, item, clock);
    if (!gate.open) {
      throw new HttpError(
        409,
        'NOT_DUE',
        `unit ${unit.id}: alternate set ${setLabel(item)} of this question set opens at ${new Date(gate.opensAt!).toISOString()} ` +
          '(>= 2 days after your last answer in this set group — spaced repetition, not same-day re-reads)',
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
      // server review F2: an earlier version's answer unlocked its key; this one cannot be blind
      { priorKey: supersededAnswerIds(db, 'explainBack', item).length > 0 },
    );
    return { attemptId: attempt.id, mode: attempt.mode, outcome: 'submitted' };
  });
}

/** GET /units/:id/explain-back/key — 403 NOT_ANSWERED until the answer row exists. */
export function getExplainBackKey(deps: LadderDeps, unitId: number): ExplainBackKeyResponse {
  const { db } = deps;
  const unit = requireUnit(db, unitId);
  const check = requireCheckType(db, unit, 'explain-back', 'the explain-back key');
  const item = deps.seedItems.explainBack(check.spec.questionSetKey);
  if (!item) {
    if (!firstAnswer(db, 'explainBack', check.spec.questionSetKey)) {
      throw new HttpError(403, 'NOT_ANSWERED', `unit ${unit.id}: record your answers first (POST /api/units/${unit.id}/explain-back/answers) — the key is shown only after`);
    }
    throw new HttpError(409, 'CONTENT_PENDING', `question set ${check.spec.questionSetKey} is not loaded on this server`);
  }
  // the key of the item AS ANSWERED only: the answer of record matches the loaded hash by construction (audit #8)
  const attempt = currentAnswer(db, 'explainBack', item);
  if (!attempt) throw notAnswered(db, 'explainBack', item, unit, 'answers');
  const stored = storedAnswer(attempt);
  const answers = Array.isArray(stored.explainBack?.answers) ? stored.explainBack.answers.map(String) : [];
  return {
    attemptId: attempt.id,
    answeredAt: attempt.created_at,
    answers,
    questions: explainBackKey(item),
    scored: scoredOn(db, attempt.id, 'explain-back'),
    practice: practiceAttempts(db, item).map((p) => {
      const s = storedAnswer(p);
      return {
        attemptId: p.id,
        answeredAt: p.created_at,
        answers: Array.isArray(s.explainBack?.answers) ? s.explainBack.answers.map(String) : [],
        scored: scoredOn(db, p.id, 'explain-back'),
      };
    }),
  };
}

/**
 * POST /units/:id/explain-back/self-score — per-key-point covered|missed -> coverage,
 * filed as explain-back evidence (assessor self, no filing window); >= 80% pays 20 XP once
 * and schedules the changed-example retest (>= 2 days out); then the promotion rule runs.
 */
export function selfScoreExplainBack(deps: LadderDeps, unitId: number, body: { perKeyPoint: Record<string, 'covered' | 'missed'> }): ExplainBackScoreResponse {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertOpen(db, unit);
  const { check, item } = requireExplainBack(deps, unit, 'explain-back self-score');
  const attempt = currentAnswer(db, 'explainBack', item);
  if (!attempt) throw notAnswered(db, 'explainBack', item, unit, 'answers');
  assertAnsweredHere(db, unit, attempt);
  const competencies = requireCompetencies(db, attempt.unit_id);
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

/**
 * POST /units/:id/explain-back/practice — a voluntary PRACTICE retake of the loaded version.
 * Allowed only once the answer of record exists (403 NOT_ANSWERED) and is self-scored (409
 * NOT_VERIFIED), one unscored practice attempt at a time (403 ALREADY_ANSWERED). Recorded
 * append-only as an ASSISTED attempt (assistance 'practice', a server-side fact): the key of this
 * very version was already read. It never touches the answer of record, the alternate-set gate,
 * XP, retests, promotion, streak or slate.
 */
export function practiceExplainBack(deps: LadderDeps, unitId: number, body: ExplainBackPracticeBody): AnswerRecordedResponse {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertOpen(db, unit);
  const { check, item } = requireExplainBack(deps, unit, 'explain-back practice');
  if (body.answers.length !== item.questions.length) {
    throw new HttpError(400, 'VALIDATION', `this set has ${item.questions.length} questions; send exactly one answer per question`, [
      { path: 'body.answers', message: `expected ${item.questions.length} answers, got ${body.answers.length}` },
    ]);
  }
  return db.tx(() => {
    const rec = currentAnswer(db, 'explainBack', item);
    if (!rec) throw notAnswered(db, 'explainBack', item, unit, 'answers');
    if (scoredOn(db, rec.id, 'explain-back') === null) {
      throw new HttpError(409, 'NOT_VERIFIED', `unit ${unit.id}: self-score your answer of record #${rec.id} first — practice opens after the first scored answer`);
    }
    const rows = practiceAttempts(db, item);
    const latest = rows[rows.length - 1];
    if (latest && scoredOn(db, latest.id, 'explain-back') === null) {
      throw new HttpError(403, 'ALREADY_ANSWERED', `unit ${unit.id}: practice attempt #${latest.id} is recorded and unscored; score it first`);
    }
    const attempt = recordAttempt(
      db,
      {
        unitId: unit.id,
        checkId: check.id,
        selfAssisted: false,
        answer: { explainBack: { questionSetKey: item.key, itemSha: seedItemHash(item), answers: body.answers, practice: true } },
      },
      clock,
      { practiceKey: true },
    );
    return { attemptId: attempt.id, mode: attempt.mode, outcome: 'submitted' };
  });
}

/**
 * POST /units/:id/explain-back/practice-score — self-score ONE practice attempt of the loaded
 * version: explain-back evidence per competency (assessor self, assistance 'practice' inherited
 * from the attempt). Feedback only: never awardXp (no xp_event row at all), never
 * scheduleRetests, never promotion, never streak/slate (the reveal analog).
 */
export function practiceScoreExplainBack(deps: LadderDeps, unitId: number, body: ExplainBackPracticeScoreBody): ExplainBackScoreResponse {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertOpen(db, unit);
  const { check, item } = requireExplainBack(deps, unit, 'explain-back practice self-score');
  const attempt = db.get<AttemptRow>('SELECT * FROM attempt WHERE id = ?', body.attemptId);
  if (!attempt) throw new HttpError(404, 'NOT_FOUND', `attempt ${body.attemptId} not found`);
  const stored = storedAnswer(attempt).explainBack as (StoredAnswer['explainBack'] & { practice?: unknown }) | undefined;
  if (
    attempt.outcome !== 'submitted' ||
    stored?.practice !== true ||
    attempt.unit_id !== unit.id ||
    stored.questionSetKey !== item.key ||
    stored.itemSha !== seedItemHash(item)
  ) {
    throw new HttpError(409, 'NOT_VERIFIED', `attempt ${attempt.id} is not a practice attempt of the question set loaded on unit ${unit.id}`);
  }
  const competencies = requireCompetencies(db, attempt.unit_id);
  const ids = explainBackKey(item).flatMap((q) => q.keyPoints.map((k) => k.id));
  assertExactMarks(ids, body.perKeyPoint, 'perKeyPoint');
  const missed = ids.filter((id) => body.perKeyPoint[id] === 'missed');
  const covered = ids.length - missed.length;
  const coverage = covered / ids.length;
  const minCoverage = effectiveMinCoverage(check.spec);

  return honest(() =>
    db.tx(() => {
      if (scoredOn(db, attempt.id, 'explain-back')) {
        throw new HttpError(409, 'ALREADY_SCORED', `practice attempt #${attempt.id} is already self-scored (evidence is append-only)`);
      }
      const evidenceIds = competencies.map(
        (competency) =>
          recordEvidence(
            db,
            {
              competency,
              kind: 'explain-back',
              intention: 'explain-back PRACTICE retake: the key was already seen; scored for feedback only',
              observation: `${covered}/${ids.length} key points covered (${pct(coverage)}%)${missed.length ? `; missed ${missed.join(', ')}` : ''}`,
              score: coverage,
              attemptId: attempt.id,
            },
            clock,
          ).id,
      );
      return {
        attemptId: attempt.id,
        covered,
        total: ids.length,
        coverage,
        minCoveragePct: pct(minCoverage),
        passed: coverage >= minCoverage,
        missed,
        evidenceIds,
        xp: null,
        retests: [],
        promotions: [],
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
    const prior = currentAnswer(db, 'kata', item);
    if (prior) throw alreadyAnswered(db, prior, unit, item, 'findings');
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
      // server review F2: an earlier version's findings unlocked its key; these cannot be blind
      { priorKey: supersededAnswerIds(db, 'kata', item).length > 0 },
    );
    return { attemptId: attempt.id, mode: attempt.mode, outcome: 'submitted' };
  });
}

export function getKataKey(deps: LadderDeps, unitId: number): KataKeyResponse {
  const { db } = deps;
  const unit = requireUnit(db, unitId);
  const check = requireCheckType(db, unit, 'patch-kata', 'the kata key');
  const item = deps.seedItems.kata(check.spec.kataKey);
  if (!item) {
    if (!firstAnswer(db, 'kata', check.spec.kataKey)) {
      throw new HttpError(403, 'NOT_ANSWERED', `unit ${unit.id}: record your findings first (POST /api/units/${unit.id}/kata/findings) — the seeded-defect key is shown only after`);
    }
    throw new HttpError(409, 'CONTENT_PENDING', `kata ${check.spec.kataKey} is not loaded on this server`);
  }
  const attempt = currentAnswer(db, 'kata', item);
  if (!attempt) throw notAnswered(db, 'kata', item, unit, 'findings');
  const stored = storedAnswer(attempt);
  return { attemptId: attempt.id, answeredAt: attempt.created_at, findings: stored.kata?.findings ?? [], defects: kataKey(item), scored: scoredOn(db, attempt.id, 'kata') };
}

/** POST /units/:id/kata/self-score — per-defect caught|missed -> catch rate as kata evidence + 15 XP once. */
export function selfScoreKata(deps: LadderDeps, unitId: number, body: { perDefect: Record<string, 'caught' | 'missed'> }): KataScoreResponse {
  const { db, clock } = deps;
  const unit = requireUnit(db, unitId);
  assertOpen(db, unit);
  const { item } = requireKata(deps, unit, 'kata self-score');
  const attempt = currentAnswer(db, 'kata', item);
  if (!attempt) throw notAnswered(db, 'kata', item, unit, 'findings');
  assertAnsweredHere(db, unit, attempt);
  const competencies = requireCompetencies(db, attempt.unit_id);
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
 * defect total is the count stored WITH the answer (as answered), not the current key; each
 * kata key counts once - its earliest ANSWER, whatever re-seeds followed (an earliest answer
 * that is not scored yet counts nothing yet; a later version never stands in for it).
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
  // dead end #3: a re-seeded kata takes one fresh answer, but G1 counts each kata ONCE - its
  // earliest ANSWER (server review F2: not its earliest SCORED one). A later version answered
  // after the earlier answer unlocked the earlier key is not blind; letting it stand in for an
  // unscored earlier answer, or counting both, would let a re-seed rewrite the G1 history.
  const earliest = new Map<string, number>(
    db
      .all<{ k: string; id: number }>(
        `SELECT json_extract(answer, '$.kata.kataKey') AS k, MIN(id) AS id FROM attempt
          WHERE outcome = 'submitted' AND json_extract(answer, '$.kata.kataKey') IS NOT NULL GROUP BY k`,
      )
      .map((r) => [r.k, r.id]),
  );
  for (const r of rows) {
    const kataKey = (JSON.parse(r.answer ?? '{}') as StoredAnswer).kata?.kataKey;
    if (kataKey !== undefined && earliest.get(kataKey) !== r.attemptId) continue;
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

/** GET /competencies — the 8 ratings, each with its three-leg progress, plus open retests. */
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
