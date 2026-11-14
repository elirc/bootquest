import type { Router } from 'express';
import { AttemptIdParams, EmptyQuery } from '@bootquest/shared/api';
import { CalibrationResponse, CONFIDENCE_LEVELS, CONFIDENCE_WINDOW_MS, ConfidenceBody, ConfidenceResponse, type Confidence } from '@bootquest/shared/api-ext';
import type { Db } from '../db/database.ts';
import { VERIFIED_PASS_SQL } from '../engines/attempts.ts';
import { nowMs, type Clock } from '../engines/clock.ts';
import { asyncRoute, HttpError, sendJson, validate } from './http.ts';

/**
 * rv2 S3 (PLAN F9, stretch): the confidence tag on a graded answer and the calibration panel.
 *   POST /attempts/:id/confidence  files answer_confidence (migration 027) for a GRADED attempt: a submit that
 *                                  was graded (pass / fail) or an explain-back answer of record, never a practice
 *                                  try or a reveal, within CONFIDENCE_WINDOW_MS of the attempt, once, and for an
 *                                  explain-back answer only before its self-score (the result must not be known).
 *   GET  /stats/calibration        per level: tagged answers and how many passed.
 * Nothing here pays XP, writes evidence, changes a grade or unlocks anything.
 */

export interface ConfidenceDeps {
  db: Db;
  clock: Clock;
}

interface AttemptBits {
  id: number;
  outcome: string;
  source: string;
  createdAt: number;
  eb: number;
}

export function recordConfidence({ db, clock }: ConfidenceDeps, attemptId: number, confidence: Confidence): ConfidenceResponse {
  const a = db.get<AttemptBits>(
    `SELECT id, outcome, assistance_source AS source, created_at AS createdAt, (json_extract(answer, '$.explainBack') IS NOT NULL) AS eb FROM attempt WHERE id = ?`,
    attemptId,
  );
  if (!a) throw new HttpError(404, 'NOT_FOUND', `attempt ${attemptId} not found`);
  const graded = a.source !== 'practice' && a.source !== 'reveal' && (a.outcome === 'pass' || a.outcome === 'fail' || (a.outcome === 'submitted' && a.eb === 1));
  if (!graded) throw new HttpError(409, 'WRONG_UNIT_KIND', `attempt ${attemptId} is not a graded answer (practice tries and reveals take no confidence tag)`);
  return db.tx(() => {
    if (db.get('SELECT 1 AS x FROM answer_confidence WHERE attempt_id = ?', attemptId)) throw new HttpError(409, 'ALREADY_ANSWERED', `attempt ${attemptId} already has its confidence tag`);
    const t = nowMs(clock);
    if (t - a.createdAt > CONFIDENCE_WINDOW_MS) throw new HttpError(409, 'NOT_DUE', `attempt ${attemptId}: a confidence tag is filed with the answer (within ${CONFIDENCE_WINDOW_MS / 60_000} minutes), not later`);
    if (a.eb === 1 && db.get(`SELECT 1 AS x FROM evidence WHERE attempt_id = ? AND kind = 'explain-back'`, attemptId)) {
      throw new HttpError(409, 'ALREADY_SCORED', `attempt ${attemptId} is already self-scored: its result is known`);
    }
    db.run('INSERT INTO answer_confidence (attempt_id, confidence, created_at) VALUES (?, ?, ?)', attemptId, confidence, t);
    return { attemptId, confidence };
  });
}

export function calibration({ db }: ConfidenceDeps): CalibrationResponse {
  const rows = db.all<{ confidence: Confidence; eb: number; scored: number; ebPassed: number; vpass: number }>(
    `SELECT c.confidence AS confidence,
            (json_extract(a.answer, '$.explainBack') IS NOT NULL) AS eb,
            EXISTS (SELECT 1 FROM evidence e WHERE e.attempt_id = a.id AND e.kind = 'explain-back') AS scored,
            EXISTS (SELECT 1 FROM xp_event x WHERE x.attempt_id = a.id AND x.kind = 'explain-back') AS ebPassed,
            ${VERIFIED_PASS_SQL} AS vpass
       FROM answer_confidence c JOIN attempt a ON a.id = c.attempt_id`,
  );
  let pending = 0;
  let sureButFailed = 0;
  const tally = new Map<Confidence, { answers: number; passed: number }>(CONFIDENCE_LEVELS.map((l) => [l, { answers: 0, passed: 0 }]));
  for (const r of rows) {
    if (r.eb === 1 && r.scored === 0) {
      pending++;
      continue;
    }
    // an explain-back pass is its self-score's pass (the only path that pays explain-back XP); a submit's is verified
    const passed = r.eb === 1 ? r.ebPassed === 1 : r.vpass === 1;
    const t = tally.get(r.confidence)!;
    t.answers++;
    if (passed) t.passed++;
    else if (r.confidence === 'sure') sureButFailed++;
  }
  return {
    levels: CONFIDENCE_LEVELS.map((confidence) => {
      const t = tally.get(confidence)!;
      return { confidence, answers: t.answers, passed: t.passed, passRate: t.answers === 0 ? null : t.passed / t.answers };
    }),
    pending,
    sureButFailed,
  };
}

export function registerConfidenceRoutes(router: Router, deps: ConfidenceDeps): void {
  router.post('/attempts/:id/confidence', asyncRoute((req, res) => {
    const { id } = validate(AttemptIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const { confidence } = validate(ConfidenceBody, req.body, 'body');
    sendJson(res, 200, ConfidenceResponse.parse(recordConfidence(deps, id, confidence)));
  }));
  router.get('/stats/calibration', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, CalibrationResponse.parse(calibration(deps)));
  }));
}
