import type { Router } from 'express';
import { EmptyQuery } from '@bootquest/shared/api';
import { DueResponse, WeakSpotsResponse } from '@bootquest/shared/api-ext';
import { getDue } from './due-service.ts';
import { asyncRoute, sendJson, validate } from './http.ts';
import type { LadderDeps } from './ladder-service.ts';
import { weakSpots } from './weak-service.ts';

/**
 * ab wave S3 routes (read-only; strict response parse like every stats route):
 *   GET /stats/weak  weak spots per repo / drill module, released keys only (weak-service.ts)
 *   GET /due         open retests + alternate explain-back sets whose gate has opened (due-service.ts)
 */
export function registerS3Routes(router: Router, deps: LadderDeps): void {
  router.get('/stats/weak', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, WeakSpotsResponse.parse(weakSpots(deps)));
  }));

  router.get('/due', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, DueResponse.parse(getDue(deps)));
  }));
}
