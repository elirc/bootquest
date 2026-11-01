import type { Router } from 'express';
import { EmptyQuery } from '@bootquest/shared/api';
import { SlateSettingsBody, SlateSettingsResponse } from '@bootquest/shared/api-ext';
import { asyncRoute, sendJson, validate } from './http.ts';
import { getSlateSettings, putSlateSettings, type SettingsDeps } from './settings-service.ts';

/** ab wave A1: GET/PUT /settings/slate (the learner's daily slate shape; a PUT takes effect tomorrow). */
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
}
