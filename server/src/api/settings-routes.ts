import type { Router } from 'express';
import { EmptyQuery } from '@bootquest/shared/api';
import { LearnerSettingsBody, RoutingResponse, SlateSettingsBody, SlateSettingsResponse } from '@bootquest/shared/api-ext';
import { asyncRoute, sendJson, validate } from './http.ts';
import { getRouting, getSlateSettings, putLearnerSettings, putSlateSettings, type SettingsDeps } from './settings-service.ts';

/**
 * ab wave A1: GET/PUT /settings/slate (the learner's daily slate shape; a PUT takes effect tomorrow).
 * rv wave C: PUT /settings/learner (primary language, campaign step, senior rep) and GET /routing
 * (the archive + paths resolved to unit ids; read-only).
 */
export function registerSettingsRoutes(router: Router, deps: SettingsDeps): void {
  router.get('/settings/slate', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, SlateSettingsResponse.parse(getSlateSettings(deps)));
  }));

  router.put('/settings/slate', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    const body = validate(SlateSettingsBody, req.body, 'body');
    sendJson(res, 200, SlateSettingsResponse.parse(putSlateSettings(deps, body)));
  }));

  router.put('/settings/learner', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    const body = validate(LearnerSettingsBody, req.body, 'body');
    sendJson(res, 200, SlateSettingsResponse.parse(putLearnerSettings(deps, body)));
  }));

  router.get('/routing', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, RoutingResponse.parse(getRouting(deps)));
  }));
}
