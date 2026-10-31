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

// ---- S2 truth layer (review cards, demotion) --------------------------------------------------------

// ---- S3 weak spots + due now --------------------------------------------------------------------------

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
