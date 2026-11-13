import {
  SLATE_SIZE_MAX,
  SLATE_SIZE_MIN,
  type LearnerSettingsBody,
  type LearnerShapeDto,
  type RoutingResponse,
  type SlateSettingsBody,
  type SlateSettingsResponse,
  type SlateTrackSettingInput,
} from '@bootquest/shared/api-ext';
import type { Db } from '../db/database.ts';
import { addDays, dayKey, nowMs, type Clock } from '../engines/clock.ts';
import { DEFAULT_DRILL_SET_SIZE, DRILL_SET_SIZE, composeSlate, learnerShape, slateShape, type LearnerShape, type SlateTrackShape } from '../engines/streak.ts';
import { archivedUnitIds, resolvePath, routing } from '../store/routing.ts';
import { HttpError } from './http.ts';

/**
 * Slate settings (ab wave A1): the learner chooses which tracks give a daily drill set and how many
 * drills each asks for. Every change APPENDS slate_setting rows (migration 017, append-only triggers)
 * with effective_day = tomorrow (local day), so today's open slate and every closed day stay as they
 * were; engines/streak.ts slateShape reads the rows as of each day. track.slate_drills is never
 * written here: it stays the capability flag ("this track has a drill slot at all").
 *
 * rv wave C (D3): every drill set is OFF by default (the Fundamentals step and the senior rep carry the
 * day), so "all tracks off" is a valid choice now. Learner settings (migration 022, PUT /settings/learner)
 * pick the primary language and switch the campaign step / senior rep, also effective tomorrow, except the
 * FIRST primary-language pick: it applies today unless today's Fundamentals step is already done (a
 * day-one choice must reach the hero now, and must never un-do a slot).
 */

export interface SettingsDeps {
  db: Db;
  clock: Clock;
}

function shapeDto(shape: SlateTrackShape[]): SlateSettingsResponse['todayTracks'] {
  return shape.map((t) => ({
    trackId: t.trackId as SlateSettingsResponse['todayTracks'][number]['trackId'],
    name: t.name,
    enabled: t.enabled,
    size: t.size,
    configured: t.configured,
  }));
}

const learnerDto = (l: LearnerShape): LearnerShapeDto => ({ ...l });

export function getSlateSettings(deps: SettingsDeps): SlateSettingsResponse {
  const { db, clock } = deps;
  const today = dayKey(nowMs(clock));
  const tomorrow = addDays(today, 1);
  return {
    configured: db.get('SELECT 1 AS x FROM slate_setting LIMIT 1') !== undefined,
    today,
    effectiveDay: tomorrow,
    defaultSize: DEFAULT_DRILL_SET_SIZE,
    fullSize: DRILL_SET_SIZE,
    minSize: SLATE_SIZE_MIN,
    maxSize: SLATE_SIZE_MAX,
    todayTracks: shapeDto(slateShape(db, today)),
    tomorrowTracks: shapeDto(slateShape(db, tomorrow)),
    learner: { today: learnerDto(learnerShape(db, today)), tomorrow: learnerDto(learnerShape(db, tomorrow)) },
  };
}

/**
 * Append the rows a PUT asks for, effective tomorrow. Refused (400, nothing written): a track that is
 * not slate-capable (locked, or no drill slot) or a track listed twice.
 */
export function putSlateSettings(deps: SettingsDeps, body: SlateSettingsBody): SlateSettingsResponse {
  const { db, clock } = deps;
  const t = nowMs(clock);
  const tomorrow = addDays(dayKey(t), 1);
  return db.tx(() => {
    const next = slateShape(db, tomorrow);
    const capable = new Set(next.map((s) => s.trackId));
    let rows: { trackId: string; enabled: boolean; size: number | null }[];
    if ('preset' in body) {
      // rv wave C: `default` = the default day (every drill set off); `full` = every track on, 5 drills each
      rows = next.map((s) => ({ trackId: s.trackId, enabled: body.preset === 'full', size: body.preset === 'full' ? DRILL_SET_SIZE : null }));
    } else {
      const seen = new Set<string>();
      body.tracks.forEach((tr: SlateTrackSettingInput, i) => {
        const path = `body.tracks.${i}.trackId`;
        if (!capable.has(tr.trackId)) {
          const message = `track '${tr.trackId}' has no daily drill slot (locked or no drills); slate tracks: ${[...capable].join(', ')}`;
          throw new HttpError(400, 'VALIDATION', message, [{ path, message }]);
        }
        if (seen.has(tr.trackId)) {
          const message = `track '${tr.trackId}' is listed twice`;
          throw new HttpError(400, 'VALIDATION', message, [{ path, message }]);
        }
        seen.add(tr.trackId);
      });
      rows = body.tracks.map((tr) => ({ trackId: tr.trackId, enabled: tr.enabled, size: tr.size ?? null }));
    }
    if (rows.length === 0) {
      const message = 'no slate track to set';
      throw new HttpError(400, 'VALIDATION', message, [{ path: 'body', message }]);
    }
    for (const r of rows) {
      db.run(
        'INSERT INTO slate_setting (track_id, enabled, size, effective_day, created_at) VALUES (?, ?, ?, ?, ?)',
        r.trackId,
        r.enabled ? 1 : 0,
        r.size,
        tomorrow,
        t,
      );
    }
    return getSlateSettings(deps);
  });
}

/** PUT /settings/learner (rv wave C): append learner_setting rows; see the header for when they apply. */
export function putLearnerSettings(deps: SettingsDeps, body: LearnerSettingsBody): SlateSettingsResponse {
  const { db, clock } = deps;
  const t = nowMs(clock);
  const today = dayKey(t);
  const tomorrow = addDays(today, 1);
  return db.tx(() => {
    const write = (key: string, value: string, day: string) =>
      db.run('INSERT INTO learner_setting (key, value, effective_day, created_at) VALUES (?, ?, ?, ?)', key, value, day, t);
    if (body.primaryLanguage !== undefined) {
      const firstPick = db.get(`SELECT 1 AS x FROM learner_setting WHERE key = 'primary_language' LIMIT 1`) === undefined;
      const fundDone = composeSlate(db, clock).items.some((i) => i.kind === 'fund-step' && i.done);
      write('primary_language', body.primaryLanguage, firstPick && !fundDone ? today : tomorrow);
    }
    if (body.campaignStep !== undefined) write('campaign_step', body.campaignStep ? 'on' : 'off', tomorrow);
    if (body.seniorRep !== undefined) write('senior_rep', body.seniorRep ? 'on' : 'off', tomorrow);
    composeSlate(db, clock); // a first pick that applies today reshapes today's open slate now
    return getSlateSettings(deps);
  });
}

/** GET /routing (rv wave C): the archive and the paths resolved to live unit ids. */
export function getRouting(deps: SettingsDeps): RoutingResponse {
  const r = routing();
  const paths: RoutingResponse['paths'] = {};
  for (const track of r.paths.keys()) {
    const steps = resolvePath(deps.db, track, r);
    if (steps) paths[track] = steps;
  }
  return { archivedUnitIds: [...archivedUnitIds(deps.db, r)].sort((a, b) => a - b), paths };
}
