import {
  SLATE_SIZE_MAX,
  SLATE_SIZE_MIN,
  type SlateSettingsBody,
  type SlateSettingsResponse,
  type SlateTrackSettingInput,
} from '@bootquest/shared/api-ext';
import type { Db } from '../db/database.ts';
import { addDays, dayKey, nowMs, type Clock } from '../engines/clock.ts';
import { DEFAULT_DRILL_SET_SIZE, DRILL_SET_SIZE, slateShape, type SlateTrackShape } from '../engines/streak.ts';
import { HttpError } from './http.ts';

/**
 * Slate settings (ab wave A1): the learner chooses which tracks give a daily drill set and how many
 * drills each asks for. Every change APPENDS slate_setting rows (migration 017, append-only triggers)
 * with effective_day = tomorrow (local day), so today's open slate and every closed day stay as they
 * were; engines/streak.ts slateShape reads the rows as of each day. track.slate_drills is never
 * written here: it stays the capability flag ("this track has a drill slot at all").
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
  };
}

/**
 * Append the rows a PUT asks for, effective tomorrow. Refused (400, nothing written): a track that is
 * not slate-capable (locked, or no drill slot), a track listed twice, or a result with every track off.
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
      const size = body.preset === 'full' ? DRILL_SET_SIZE : null;
      rows = next.map((s) => ({ trackId: s.trackId, enabled: true, size }));
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
    const after = new Map(next.map((s) => [s.trackId, s.enabled]));
    for (const r of rows) after.set(r.trackId, r.enabled);
    if (rows.length === 0 || ![...after.values()].some(Boolean)) {
      const message = 'at least one track must stay on the daily slate';
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
