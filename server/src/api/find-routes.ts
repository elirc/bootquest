import type { Router } from 'express';
import { DrillNextQuery, DrillNextResponse, UNIT_SEARCH_DEFAULT_LIMIT, UnitSearchQuery, UnitSearchResponse } from '@bootquest/shared/api-ext';
import { nextMixedDrill, searchUnits } from './find-service.ts';
import { asyncRoute, sendJson, validate } from './http.ts';
import type { ServiceDeps } from './service.ts';

/**
 * ab S4 "find things" routes (read-only, strict response parse). Registered BEFORE `/units/:id`
 * so `/units/search` is not read as a unit id.
 */
export function registerFindRoutes(router: Router, deps: ServiceDeps): void {
  // key + title search over every live unit (campaign quest units included, with their act lock)
  router.get('/units/search', asyncRoute((req, res) => {
    const q = validate(UnitSearchQuery, req.query, 'query');
    sendJson(res, 200, UnitSearchResponse.parse(searchUnits(deps.db, q.q, q.limit ?? UNIT_SEARCH_DEFAULT_LIMIT)));
  }));

  // mixed drill practice: the next passable drill, rotating deterministically over the given tracks
  router.get('/drills/next', asyncRoute((req, res) => {
    const q = validate(DrillNextQuery, req.query, 'query');
    sendJson(res, 200, DrillNextResponse.parse(nextMixedDrill(deps.db, deps.clock, q.tracks)));
  }));
}
