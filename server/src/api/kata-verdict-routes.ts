import type { Router } from 'express';
import { AnswerRecordedResponse, EmptyQuery, UnitIdParams } from '@bootquest/shared/api';
import { KataApproveBody, KataReviewResponse, KataVerdictScoreBody, KataVerdictScoreResponse } from '@bootquest/shared/api-ext';
import { asyncRoute, sendJson, validate } from './http.ts';
import { syncKeyIdeas } from './keyideas-service.ts';
import { approveKata, getKataReview, verdictScoreKata, type LadderDeps } from './ladder-service.ts';

/**
 * rv3 S5 (PLAN W9 / F10): the kata verdict routes (ladder-service.ts "kata precision" has the rules).
 *   GET  /units/:id/kata/review        does this kata ask for approve / block; after the answer, the flags' key
 *   POST /units/:id/kata/approve       the approve verdict (no findings), immutable, before any key
 *   POST /units/:id/kata/verdict-score a flagged kata's score: kata evidence + 15 XP once
 * The block verdict is the existing POST /units/:id/kata/findings.
 */
export function registerKataVerdictRoutes(router: Router, ladder: LadderDeps): void {
  router.get('/units/:id/kata/review', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, KataReviewResponse.parse(getKataReview(ladder, id)));
  }));

  router.post('/units/:id/kata/approve', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(KataApproveBody, req.body, 'body');
    sendJson(res, 200, AnswerRecordedResponse.parse(approveKata(ladder, id, body)));
  }));

  router.post('/units/:id/kata/verdict-score', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(KataVerdictScoreBody, req.body, 'body');
    const out = KataVerdictScoreResponse.parse(verdictScoreKata(ladder, id, body));
    syncKeyIdeas(ladder);
    sendJson(res, 200, out);
  }));
}
