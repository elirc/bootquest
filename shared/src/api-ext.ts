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
import { TrackId } from './enums.ts';

void z;
void api;

// ---- S1 slate + first run -------------------------------------------------------------------------

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

// ---- S5 explain-back weights + score detail -------------------------------------------------------------
