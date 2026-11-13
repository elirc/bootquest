import type { Router } from 'express';
import { EmptyQuery, UnitIdParams } from '@bootquest/shared/api';
import {
  GATE_TRIES_PER_WINDOW,
  GATE_TRY_WINDOW_MS,
  GateStatusResponse,
  PRACTICE_LOCK_MS,
  PracticeBody,
  PracticeResponse,
  UnitSourceResponse,
  type PracticeItemDto,
} from '@bootquest/shared/api-ext';
import type { CheckSpec } from '@bootquest/shared';
import { isFundItemKey } from '@bootquest/shared/fundamentals';
import type { Db } from '../db/database.ts';
import { GRADED_SQL, gradedTryTimes, VERIFIED_PASS_SQL } from '../engines/attempts.ts';
import { nowMs } from '../engines/clock.ts';
import { QUIZ_MISS_CARD_PREFIX } from '../engines/study-quest.ts';
import { getUnit, primaryCheck, type CheckRecord, type UnitRecord } from '../store/queries.ts';
import { choiceOrdererFor } from './choice-order.ts';
import { asyncRoute, HttpError, sendJson, validate } from './http.ts';
import { getUnitSource, type LadderDeps } from './ladder-service.ts';
import { assertTrackOpen, grade, storedQuizSubmission, type ServiceDeps } from './service.ts';
import { gateKeyTexts, gradeStudySubmission } from './study-service.ts';

/**
 * rv B (REVIEW Q3, R4-01, R4-round2, R1-round2): the split between PRACTICE and EVIDENCE for quiz gates and
 * quick checks.
 *
 * Practice — POST /units/:id/practice: grades a full answer set (a study-quiz gate) or one answer (a choice /
 * text quick check) exactly as a submit would, and returns every item's verdict, keyed answer and explanation.
 * It records NOTHING but one practice_log row (migration 020, append-only): no attempt, no run, no XP, no
 * evidence, no slate slot, no unlock, no review card — so no pass predicate (VERIFIED_PASS_SQL and every reader
 * of it) can ever see it.
 *
 * Evidence — the graded submit (api/service.ts submitUnit) asks assertGradedTryAllowed first:
 *   - the practice lock: a graded submit of a practised unit opens PRACTICE_LOCK_MS (2 days) after its latest
 *     practice try (practising the same items leaks the gate until a fresh set B exists);
 *   - the retry budget (study-quiz gates): at most GATE_TRIES_PER_WINDOW (2) graded tries per GATE_TRY_WINDOW_MS
 *     (24 h), read from the attempt ledger, so a gate cannot fall to blind guessing (R4-01: 3 submits). The
 *     first fail has no cooldown. Both refusals are 409 NOT_DUE and record nothing.
 * GET /units/:id/gate-status reads the same facts (plus this unit's try number and what to re-read).
 */


function requireUnit(db: Db, id: number): UnitRecord {
  const unit = getUnit(db, id);
  if (!unit) throw new HttpError(404, 'NOT_FOUND', `unit ${id} not found`);
  return unit;
}

/** A unit practice serves: a study-quiz gate, or a choice / text-graded single quick check. Never a retest. */
function practiceable(unit: UnitRecord, check: CheckRecord | undefined): check is CheckRecord & { spec: Extract<CheckSpec, { type: 'study-quiz' | 'quiz' }> } {
  if (!check || unit.kind === 'retest' || unit.variationOfUnitId !== null) return false;
  const spec = check.spec;
  return spec.type === 'study-quiz' || (spec.type === 'quiz' && (spec.grading === 'choice' || spec.grading === 'exact'));
}

export function lastPracticeAt(db: Db, unitId: number): number | null {
  return db.get<{ t: number | null }>('SELECT MAX(created_at) AS t FROM practice_log WHERE unit_id = ?', unitId)?.t ?? null;
}

interface GradedGate {
  opensAt: number | null;
  reason: 'budget' | 'practice' | null;
  triesInWindow: number;
  budget: number | null;
}

/** When the next graded try of this unit opens (null = now), and why. */
function gradedGate(db: Db, unit: UnitRecord, spec: CheckSpec, now: number): GradedGate {
  let opensAt: number | null = null;
  let reason: GradedGate['reason'] = null;
  const lastPractice = lastPracticeAt(db, unit.id);
  if (lastPractice !== null && lastPractice + PRACTICE_LOCK_MS > now) {
    opensAt = lastPractice + PRACTICE_LOCK_MS;
    reason = 'practice';
  }
  let triesInWindow = 0;
  let budget: number | null = null;
  if (spec.type === 'study-quiz') {
    budget = GATE_TRIES_PER_WINDOW;
    const recent = gradedTryTimes(db, unit.id).filter((t) => t > now - GATE_TRY_WINDOW_MS);
    triesInWindow = recent.length;
    if (recent.length >= GATE_TRIES_PER_WINDOW) {
      // the try that must age out before one more fits in the window
      const at = recent[recent.length - GATE_TRIES_PER_WINDOW]! + GATE_TRY_WINDOW_MS;
      if (opensAt === null || at > opensAt) {
        opensAt = at;
        reason = 'budget';
      }
    }
  }
  return { opensAt, reason, triesInWindow, budget };
}

const when = (t: number): string => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/**
 * Called by POST /submit before anything is graded or recorded. Refuses (409 NOT_DUE) a graded try of a
 * practised unit within 2 days of its latest practice, and a study-quiz gate's 3rd graded try within 24 h.
 */
export function assertGradedTryAllowed(deps: Pick<ServiceDeps, 'db' | 'clock'>, unit: UnitRecord, check: CheckRecord): void {
  const g = gradedGate(deps.db, unit, check.spec, nowMs(deps.clock));
  if (g.opensAt === null) return;
  if (g.reason === 'practice') {
    throw new HttpError(
      409,
      'NOT_DUE',
      `you practised unit ${unit.id} recently: its graded try opens at ${when(g.opensAt)} (2 days after your latest practice, so the graded try tests what you remember, not the practice you just saw). Practise again meanwhile, or come back then.`,
    );
  }
  throw new HttpError(
    409,
    'NOT_DUE',
    `unit ${unit.id}: ${GATE_TRIES_PER_WINDOW} graded tries per 24 hours. Your next graded try opens at ${when(g.opensAt)}. Re-read the sections the result named, or use Practice meanwhile (practice never counts and locks the graded try for 2 days).`,
  );
}

/**
 * rv B (R4-01b): a study-quiz submit is recorded `prior-key` (assisted) once any key of THIS gate was already
 * released to the learner: the gate has a verified pass (the pass panel shows every keyed answer), or a missed
 * question's review card was shown — it is due or was reviewed (notes-service rule (c); the card's back is the
 * key). A Fundamentals miss card is held until the gate's pass (engines/fund-review-hold.ts), so for those only
 * the pass counts.
 */
export function studyKeyReleased(db: Db, unitId: number, itemKeys: readonly string[], now: number): boolean {
  if (db.get(`SELECT 1 AS x FROM attempt a WHERE a.unit_id = ? AND ${VERIFIED_PASS_SQL} LIMIT 1`, unitId)) return true;
  const cardKeys = itemKeys.filter((k) => !isFundItemKey(k)).map((k) => `${QUIZ_MISS_CARD_PREFIX}${k}`);
  if (cardKeys.length === 0) return false;
  return (
    db.get(
      `SELECT 1 AS x FROM review_item ri WHERE ri.card_key IN (${cardKeys.map(() => '?').join(', ')})
          AND (ri.due_at <= ? OR EXISTS (SELECT 1 FROM review_log rl WHERE rl.review_item_id = ri.id)) LIMIT 1`,
      ...cardKeys,
      now,
    ) !== undefined
  );
}

/** GET /units/:id/gate-status — read-only. */
export function gateStatus(deps: ServiceDeps, unitId: number): GateStatusResponse {
  const { db } = deps;
  const unit = requireUnit(db, unitId);
  const check = primaryCheck(db, unit.id);
  const now = nowMs(deps.clock);
  const tries = gradedTryTimes(db, unit.id).length;
  const g = check ? gradedGate(db, unit, check.spec, now) : { opensAt: null, reason: null, triesInWindow: 0, budget: null };
  const passed = db.get(`SELECT 1 AS x FROM attempt a WHERE a.unit_id = ? AND ${VERIFIED_PASS_SQL} LIMIT 1`, unit.id) !== undefined;
  let lastTry: GateStatusResponse['lastTry'] = null;
  const last = db.get<{ id: number; answer: string | null; pass: number }>(
    `SELECT a.id AS id, a.answer AS answer, ${VERIFIED_PASS_SQL} AS pass FROM attempt a WHERE a.unit_id = ? AND ${GRADED_SQL} ORDER BY a.id DESC LIMIT 1`,
    unit.id,
  );
  if (last) {
    let reread: string[] = [];
    if (!last.pass && check?.spec.type === 'study-quiz') {
      try {
        const answers = (JSON.parse(last.answer ?? '{}') as { answers?: (number | string)[] }).answers;
        if (Array.isArray(answers)) reread = gradeStudySubmission(deps.seedItems, check.spec, answers, choiceOrdererFor(db, unit.id)).reread;
      } catch {
        reread = []; // the gate changed since (re-seed) or its items are not loaded: nothing honest to name
      }
    }
    lastTry = { number: tries, passed: Boolean(last.pass), reread };
  }
  return {
    unitId: unit.id,
    practiceable: practiceable(unit, check),
    tries,
    triesInWindow: g.triesInWindow,
    budget: g.budget,
    opensAt: g.opensAt,
    reason: g.reason,
    lastPracticeAt: lastPracticeAt(db, unit.id),
    passed,
    lastTry,
  };
}

/** POST /units/:id/practice — grades and explains; writes one practice_log row and nothing else. */
export async function practiceUnit(deps: ServiceDeps, unitId: number, body: PracticeBody): Promise<PracticeResponse> {
  const { db } = deps;
  const unit = requireUnit(db, unitId);
  assertTrackOpen(db, unit);
  const check = primaryCheck(db, unit.id);
  if (!practiceable(unit, check)) {
    throw new HttpError(409, 'WRONG_UNIT_KIND', `unit ${unit.id} has no practice mode (quiz gates and choice / text quick checks only)`);
  }
  const spec = check.spec;
  let items: PracticeItemDto[];
  let passPct: number;
  if (spec.type === 'study-quiz') {
    if (body.answers === undefined) {
      throw new HttpError(400, 'VALIDATION', 'a quiz gate is practised with `answers`: the full answer set, one served choice index per question', [
        { path: 'body.answers', message: 'required for quiz gates' },
      ]);
    }
    const graded = gradeStudySubmission(deps.seedItems, spec, body.answers, choiceOrdererFor(db, unit.id));
    const keys = gateKeyTexts(deps.seedItems, spec);
    items = graded.grade.items.map((it, i) => ({
      itemKey: it.itemKey,
      correct: it.correct,
      answer: keys[i]?.answer ?? null,
      explanation: keys[i]?.explanation ?? null,
    }));
    passPct = Math.round(spec.passPct * 100);
  } else {
    if (body.answer === undefined) {
      throw new HttpError(400, 'VALIDATION', 'a quick check is practised with `answer` (a served choice index, or the text)', [{ path: 'body.answer', message: 'required for quick checks' }]);
    }
    const result = await grade(deps, spec, storedQuizSubmission(db, unit.id, spec, { answer: body.answer }));
    const keyed = typeof spec.answerKey === 'number' ? (spec.choices?.[spec.answerKey] ?? String(spec.answerKey)) : String(spec.answerKey);
    items = [{ itemKey: null, correct: result.pass, answer: keyed, explanation: deps.content.get(unit.key)?.explanation ?? null }];
    passPct = 100;
  }
  const correct = items.filter((i) => i.correct).length;
  const total = items.length;
  const t = nowMs(deps.clock);
  db.run('INSERT INTO practice_log (unit_id, check_id, correct, total, created_at) VALUES (?, ?, ?, ?, ?)', unit.id, check.id, correct, total, t);
  return {
    unitId: unit.id,
    correct,
    total,
    score: correct / total,
    passPct,
    wouldPass: correct * 100 >= passPct * total,
    items,
    gradedOpensAt: t + PRACTICE_LOCK_MS,
  };
}

/** rv B routes: GET /units/:id/gate-status, POST /units/:id/practice, GET /units/:id/source. */
export function registerPracticeRoutes(router: Router, deps: ServiceDeps, ladder: LadderDeps): void {
  router.get('/units/:id/gate-status', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, GateStatusResponse.parse(gateStatus(deps, id)));
  }));

  router.post('/units/:id/practice', asyncRoute(async (req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(PracticeBody, req.body, 'body');
    sendJson(res, 200, PracticeResponse.parse(await practiceUnit(deps, id, body)));
  }));

  // G2 open-book (R3-05): the pinned repo tree an explain-back / kata was cut from
  router.get('/units/:id/source', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, UnitSourceResponse.parse(getUnitSource(ladder, id)));
  }));
}

