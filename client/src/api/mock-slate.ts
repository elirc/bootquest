// ab S1: the mock's slate settings (GET/PUT /api/settings/slate), kept out of mock.ts so the
// streams that share that file do not collide. Mirrors server/src/api/settings-service.ts: rows
// are append-only, a PUT is effective TOMORROW, a day reads the latest row per track with
// effective_day <= day, and a track with no row is on at the default size.

import { ApiError, type SlateSettingsBody, type SlateSettingsResponse, type TrackId } from './types';

/** server: DEFAULT_DRILL_SET_SIZE / DRILL_SET_SIZE (engines/streak.ts), SLATE_SIZE_MIN/MAX (api-ext.ts) */
const DEFAULT_SIZE = 1;
const FULL_SIZE = 5;
const MIN_SIZE = 1;
const MAX_SIZE = 10;

interface Row {
  trackId: TrackId;
  enabled: boolean;
  size: number | null;
  effectiveDay: string;
}

const addDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const invalid = (message: string, path: string) => new ApiError(400, 'VALIDATION', message, [{ path, message }]);

export interface MockSlateOptions {
  today: string;
  /** slate-capable tracks in sort order (unlocked, with a drill slot) */
  tracks: readonly { id: TrackId; name: string }[];
  /**
   * 'full' (default): the fixture learner chose the full preset long ago (the dashboard fixture's
   * 5-drill sets); 'unconfigured': a fresh server DB with no slate_setting row (day one).
   */
  start?: 'full' | 'unconfigured';
}

export function createMockSlateSettings(o: MockSlateOptions) {
  const rows: Row[] = o.start === 'unconfigured' ? [] : o.tracks.map((t) => ({ trackId: t.id, enabled: true, size: FULL_SIZE, effectiveDay: '2000-01-01' }));
  const tomorrow = addDay(o.today);

  const shape = (day: string): SlateSettingsResponse['todayTracks'] =>
    o.tracks.map((t) => {
      const row = rows.filter((r) => r.trackId === t.id && r.effectiveDay <= day).at(-1); // rows are appended in day order
      return { trackId: t.id, name: t.name, enabled: row?.enabled ?? true, size: row?.size ?? DEFAULT_SIZE, configured: row !== undefined };
    });

  const get = (): SlateSettingsResponse => ({
    configured: rows.length > 0,
    today: o.today,
    effectiveDay: tomorrow,
    defaultSize: DEFAULT_SIZE,
    fullSize: FULL_SIZE,
    minSize: MIN_SIZE,
    maxSize: MAX_SIZE,
    todayTracks: shape(o.today),
    tomorrowTracks: shape(tomorrow),
  });

  const put = (body: SlateSettingsBody): SlateSettingsResponse => {
    const next = shape(tomorrow);
    let add: Row[];
    if ('preset' in body) {
      add = next.map((t) => ({ trackId: t.trackId, enabled: true, size: body.preset === 'full' ? FULL_SIZE : null, effectiveDay: tomorrow }));
    } else {
      if (body.tracks.length === 0) throw invalid('tracks must list at least one track', 'body.tracks');
      const seen = new Set<string>();
      add = body.tracks.map((t, i) => {
        const path = `body.tracks.${i}.trackId`;
        if (!next.some((n) => n.trackId === t.trackId)) throw invalid(`track '${t.trackId}' has no daily drill slot`, path);
        if (seen.has(t.trackId)) throw invalid(`track '${t.trackId}' is listed twice`, path);
        seen.add(t.trackId);
        if (t.size !== undefined && !(Number.isInteger(t.size) && t.size >= MIN_SIZE && t.size <= MAX_SIZE)) {
          throw invalid(`size must be an integer ${MIN_SIZE}-${MAX_SIZE}`, `body.tracks.${i}.size`);
        }
        return { trackId: t.trackId, enabled: t.enabled, size: t.size ?? null, effectiveDay: tomorrow };
      });
    }
    const on = new Map(next.map((t) => [t.trackId, t.enabled]));
    for (const r of add) on.set(r.trackId, r.enabled);
    if (![...on.values()].some(Boolean)) throw invalid('at least one track must stay on the daily slate', 'body');
    rows.push(...add);
    return get();
  };

  return { get, put };
}
