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
import { TRACK_IDS, TrackId, UnitKind } from './enums.ts';

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

/** GET /stats/weak: at most this many groups are listed (`totalGroups` counts all of them). */
export const WEAK_SPOTS_MAX_GROUPS = 10;
/** Newest distinct examples per group. */
export const WEAK_SPOTS_MAX_EXAMPLES = 3;
/** Recency weight of one signal: 0.5 ** (age in days / this half-life). */
export const WEAK_SPOTS_HALF_LIFE_DAYS = 14;

/**
 * Where a weak-spot signal comes from:
 *   quiz-miss  a missed study-quiz question whose review card is released (due, reviewed, or the quiz passed)
 *   again      an Again grade in the review queue (quiz-miss and flashcard cards)
 *   fail       a failed graded submit of a drill / quick check / predict-output / retest with no later pass
 *   eb-missed  an explain-back key point the learner marked missed in their own self-score
 */
export const WeakSignalKind = z.enum(['quiz-miss', 'again', 'fail', 'eb-missed']);
export type WeakSignalKind = z.infer<typeof WeakSignalKind>;

export const WeakExampleDto = z
  .object({
    kind: WeakSignalKind,
    unitId: z.number().int().positive(),
    unitTitle: z.string(),
    /** the quiz / flashcard item key or the key-point id; null for a failed submit */
    ref: z.string().nullable(),
    /** released text only (the card front, the key point without its [wN] prefix); null when unknown */
    label: z.string().nullable(),
    at: z.number().int(),
  })
  .strict();
export type WeakExampleDto = z.infer<typeof WeakExampleDto>;

export const WeakGroupDto = z
  .object({
    /** a repo name (quest packs, explain-backs) or `<bank>/<module>` (drill banks) */
    group: z.string(),
    scope: z.enum(['repo', 'module']),
    /** the track of the newest signal's unit */
    trackId: TrackId,
    count: z.number().int().positive(),
    /** recency-weighted count (the sort key) */
    weight: z.number().nonnegative(),
    lastAt: z.number().int(),
    bySource: z
      .object({ quizMiss: z.number().int().nonnegative(), again: z.number().int().nonnegative(), fail: z.number().int().nonnegative(), ebMissed: z.number().int().nonnegative() })
      .strict(),
    examples: z.array(WeakExampleDto).max(WEAK_SPOTS_MAX_EXAMPLES),
  })
  .strict();
export type WeakGroupDto = z.infer<typeof WeakGroupDto>;

export const WeakSpotsResponse = z
  .object({ today: z.string(), totalGroups: z.number().int().nonnegative(), groups: z.array(WeakGroupDto).max(WEAK_SPOTS_MAX_GROUPS) })
  .strict();
export type WeakSpotsResponse = z.infer<typeof WeakSpotsResponse>;

/** An alternate explain-back set whose rotation gate has opened (a sibling set was answered >= 2 days ago). */
export const AltSetDueDto = z
  .object({ unitId: z.number().int().positive(), title: z.string(), label: z.string(), group: z.string(), openedAt: z.number().int() })
  .strict();
export type AltSetDueDto = z.infer<typeof AltSetDueDto>;

/** GET /due: what is due beyond the review queue. */
export const DueResponse = z
  .object({
    /** the open changed-example retests (exactly GET /competencies `retests`) */
    retests: z.array(api.RetestListItemDto),
    /** unanswered alternate sets whose gate is open, oldest opening first */
    altSets: z.array(AltSetDueDto),
    /** when the next alternate set opens (a touched group still inside its gap), else null */
    nextAltSetAt: z.number().int().nullable(),
  })
  .strict();
export type DueResponse = z.infer<typeof DueResponse>;

// ---- S4 find things (search, dashboard targets, mixed drills) -----------------------------------------

/**
 * GET /dashboard: every slate item may carry `targetUnitId`, the unit its row links to (a drill set: the
 * first passable, unrevealed drill of its track; the campaign step: the quest unit to take next; null =
 * nothing to link). Computed in the response mapping only: it is NEVER part of the stored `SlateItem`
 * (`daily_slate.items`, frozen in closed days). Absent on the review slot and on older servers.
 */
export const SlateItemDtoExt = api.SlateItemDto.extend({ targetUnitId: z.number().int().positive().nullable().optional() }).strict();
export type SlateItemDtoExt = z.infer<typeof SlateItemDtoExt>;

export const DashboardResponseExt = api.DashboardResponse.extend({
  slate: z.object({ day: z.string(), status: z.string(), items: z.array(SlateItemDtoExt) }).strict(),
}).strict();
export type DashboardResponseExt = z.infer<typeof DashboardResponseExt>;

/** GET /units/search?q=&limit= — `q` is matched against unit key + title only (never seed-item text). */
export const UNIT_SEARCH_MAX_QUERY = 100;
export const UNIT_SEARCH_DEFAULT_LIMIT = 30;
export const UNIT_SEARCH_MAX_LIMIT = 50;

export const UnitSearchQuery = z
  .object({
    q: z.string().trim().min(1).max(UNIT_SEARCH_MAX_QUERY),
    limit: z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(UNIT_SEARCH_MAX_LIMIT))
      .optional(),
  })
  .strict();

export const UnitSearchHit = z
  .object({
    id: z.number(),
    key: z.string(),
    trackId: TrackId,
    kind: UnitKind,
    title: z.string(),
    /** the same lock the unit page applies: a quest unit whose every act is locked is `locked` (not done) */
    state: api.UnitLockState,
    /** a campaign quest unit (key `campaign/...`): listed on the campaign map, not in the track's unit list */
    campaign: z.boolean(),
  })
  .strict();
export type UnitSearchHit = z.infer<typeof UnitSearchHit>;

export const UnitSearchResponse = z
  .object({
    q: z.string(),
    /** every match, before `limit` */
    total: z.number().int().nonnegative(),
    items: z.array(UnitSearchHit),
  })
  .strict();
export type UnitSearchResponse = z.infer<typeof UnitSearchResponse>;

/** GET /drills/next?tracks=js,java&mode=mixed — a comma list of distinct track ids (1..5). */
export const DrillNextQuery = z
  .object({
    tracks: z
      .string()
      .max(64)
      .transform((s) => s.split(','))
      .pipe(z.array(TrackId).min(1).max(TRACK_IDS.length))
      .refine((ids) => new Set(ids).size === ids.length, 'tracks must be distinct'),
    mode: z.enum(['mixed']).optional(),
  })
  .strict();

export const DrillNextResponse = z
  .object({
    mode: z.literal('mixed'),
    /** the tracks rotated over, as requested (locked tracks included: they simply never have a drill) */
    tracks: z.array(TrackId),
    /** index into `tracks` the rotation started from: (day number + passed drills on these tracks) mod n */
    startIndex: z.number().int().nonnegative(),
    /** the next unpassed, unrevealed, available drill; null when none of the tracks has one */
    unit: z
      .object({ id: z.number(), key: z.string(), trackId: TrackId, title: z.string(), difficulty: z.number().nullable() })
      .strict()
      .nullable(),
  })
  .strict();
export type DrillNextResponse = z.infer<typeof DrillNextResponse>;


// ---- S5 explain-back weights + score detail -------------------------------------------------------------
