/**
 * ab wave API extensions. NOT fingerprinted: `index.ts`, `pack.ts` and every seed generator must never
 * import this module (checked by `npm run restamp:all -- --dry-run` showing 0 stale stamps and by
 * `tools/seed/src/factory/fingerprint.test.ts` passing unchanged). `api.ts` stays byte-identical; new
 * endpoints get new schemas here, and an existing strict response that gains a field is re-declared here
 * with `.extend()`, then the server parses and the client types against the extended schema.
 *
 * One section per stream. Append inside your own section only; the hub resolves merges.
 */
import { z } from 'zod';
import * as api from './api.ts';

void z;
void api;

// ---- S1 slate + first run -------------------------------------------------------------------------
// GET/PUT /settings/slate: the learner's daily slate shape (append-only slate_setting rows, migration
// 017). A PUT always takes effect TOMORROW (local day): today's open slate and closed days never move.

const SlateTrackIdS1 = api.TrackIdParams.shape.id;
const SlateDayS1 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Bounds of a per-track drill-set size (migration 017 CHECK; server engines/streak.ts). */
export const SLATE_SIZE_MIN = 1;
export const SLATE_SIZE_MAX = 10;
/** `default` = every slate track on, unconfigured default size (1); `full` = every slate track on, 5 drills each. */
export const SLATE_PRESETS = ['default', 'full'] as const;
export const SlatePreset = z.enum(SLATE_PRESETS);
export type SlatePreset = z.infer<typeof SlatePreset>;

export const SlateTrackSettingInput = z
  .object({
    trackId: SlateTrackIdS1,
    enabled: z.boolean(),
    /** omitted = the engine default size */
    size: z.number().int().min(SLATE_SIZE_MIN).max(SLATE_SIZE_MAX).optional(),
  })
  .strict();
export type SlateTrackSettingInput = z.infer<typeof SlateTrackSettingInput>;

/** `{ preset }` or `{ tracks }` (listed tracks only; an unlisted track keeps tomorrow's shape). */
export const SlateSettingsBody = z.union([
  z.object({ preset: SlatePreset }).strict(),
  z.object({ tracks: z.array(SlateTrackSettingInput).min(1).max(16) }).strict(),
]);
export type SlateSettingsBody = z.infer<typeof SlateSettingsBody>;

export const SlateTrackShape = z
  .object({
    trackId: SlateTrackIdS1,
    name: z.string(),
    enabled: z.boolean(),
    size: z.number().int(),
    /** a saved setting decides this track (false = the unconfigured default) */
    configured: z.boolean(),
  })
  .strict();
export type SlateTrackShape = z.infer<typeof SlateTrackShape>;

export const SlateSettingsResponse = z
  .object({
    /** at least one slate setting was ever saved (the dashboard's "Choose your focus" card hides then) */
    configured: z.boolean(),
    today: SlateDayS1,
    /** the day a PUT now takes effect (tomorrow) */
    effectiveDay: SlateDayS1,
    defaultSize: z.number().int(),
    fullSize: z.number().int(),
    minSize: z.number().int(),
    maxSize: z.number().int(),
    /** today's shape (slate-capable tracks: unlocked with a drill slot) */
    todayTracks: z.array(SlateTrackShape),
    /** tomorrow's shape, including today's saved changes */
    tomorrowTracks: z.array(SlateTrackShape),
  })
  .strict();
export type SlateSettingsResponse = z.infer<typeof SlateSettingsResponse>;

// ---- S2 truth layer (review cards, demotion) --------------------------------------------------------

// ---- S3 weak spots + due now --------------------------------------------------------------------------

// ---- S4 find things (search, dashboard targets, mixed drills) -----------------------------------------

// ---- S5 explain-back weights + score detail -------------------------------------------------------------
