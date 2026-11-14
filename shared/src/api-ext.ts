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
/** `default` = every per-track drill set OFF (rv wave C: the Fundamentals step + a senior rep carry the day); `full` = every slate track on, 5 drills each. */
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
    /** rv wave C (migration 022): the learner's day-shape choices today and from tomorrow (optional for older servers) */
    learner: z.lazy(() => LearnerSettingsDto).optional(),
  })
  .strict();
export type SlateSettingsResponse = z.infer<typeof SlateSettingsResponse>;

// ---- rv wave C: one finishable day (learner settings, slot kinds, routing) -----------------------------

/** The primary-language choices (the Fundamentals ladders; server engines/streak.ts PRIMARY_LANGUAGES). */
export const PRIMARY_LANGUAGES = ['js', 'csharp', 'java'] as const;
export const PrimaryLanguage = z.enum(PRIMARY_LANGUAGES);
export type PrimaryLanguage = z.infer<typeof PrimaryLanguage>;
/** The senior rep kinds the slate's senior slot suggests (rotating by weekday). */
export const SeniorRepKind = z.enum(['design', 'kata', 'fund-senior']);
export type SeniorRepKind = z.infer<typeof SeniorRepKind>;

export const LearnerShapeDto = z
  .object({
    /** the hero's Fundamentals ladder and the slate's Fundamentals step */
    primaryLanguage: PrimaryLanguage,
    /** the one-time "pick your primary language" prompt was answered */
    primaryChosen: z.boolean(),
    /** the campaign-step slot is on (default off) */
    campaignStep: z.boolean(),
    /** the senior-rep slot is on (default on) */
    seniorRep: z.boolean(),
  })
  .strict();
export type LearnerShapeDto = z.infer<typeof LearnerShapeDto>;

export const LearnerSettingsDto = z.object({ today: LearnerShapeDto, tomorrow: LearnerShapeDto }).strict();
export type LearnerSettingsDto = z.infer<typeof LearnerSettingsDto>;

/**
 * PUT /settings/learner: any subset. Takes effect TOMORROW, except the FIRST primary-language pick, which
 * applies today when today's Fundamentals step is not done yet (the one-time picker on day one).
 */
export const LearnerSettingsBody = z
  .object({ primaryLanguage: PrimaryLanguage.optional(), campaignStep: z.boolean().optional(), seniorRep: z.boolean().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type LearnerSettingsBody = z.infer<typeof LearnerSettingsBody>;

/**
 * GET /routing: the archive (content/archive.json) and the paths (content/paths/*.json) resolved to live
 * unit ids. Archived units stay live and searchable; lists hide them behind an "Archived" toggle. A path
 * step lists its units in path order (archived and unknown keys skipped).
 */
export const RoutingResponse = z
  .object({
    archivedUnitIds: z.array(z.number().int().positive()),
    paths: z.record(
      z.string(),
      z.array(z.object({ id: z.string(), title: z.string(), unitIds: z.array(z.number().int().positive()) }).strict()),
    ),
  })
  .strict();
export type RoutingResponse = z.infer<typeof RoutingResponse>;

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
export const SlateItemDtoExt = api.SlateItemDto.extend({
  // rv wave C: the Fundamentals step and the senior rep join the three original slot kinds
  kind: z.enum(['drill-set', 'campaign-step', 'review-clear', 'fund-step', 'senior-rep']),
  rep: z.enum(['design', 'kata', 'fund-senior']).optional(),
  targetUnitId: z.number().int().positive().nullable().optional(),
}).strict();
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

// ---- fund wave: Fundamentals ladder -----------------------------------------------------------------------
// GET /tracks/:id/fundamentals: the track's standalone Fundamentals ladder, in ladder order. Each topic is a
// study unit (lesson = its instructions, quiz gate = its study-quiz check; flashcards enrol on the first pass)
// plus its drill units (content/packs/fund-<track>). A topic unit is locked until the previous topic's quiz
// gate is passed (unit_prerequisite). Topics whose unit is not loaded on this server are omitted.

export const FundTopicDto = z
  .object({
    /** NN-kebab topic id, e.g. 01-values-and-types */
    id: z.string(),
    order: z.number().int().positive(),
    title: z.string(),
    level: z.enum(['beginner', 'intermediate', 'advanced']),
    summary: z.string(),
    /** quiz gate size and pass mark (percent) */
    quizQuestions: z.number().int().nonnegative(),
    passPct: z.number(),
    flashcards: z.number().int().nonnegative(),
    /** the lesson + quiz-gate study unit */
    unit: api.UnitSummary,
    /** the topic's live drill units, in authored order (a quarantined drill is absent) */
    drills: z.array(api.UnitSummary),
  })
  .strict();
export type FundTopicDto = z.infer<typeof FundTopicDto>;

export const FundamentalsResponse = z
  .object({
    trackId: TrackId,
    topics: z.array(FundTopicDto),
  })
  .strict();
export type FundamentalsResponse = z.infer<typeof FundamentalsResponse>;

// ---- f52 S: progressive hints (U13, council ruling 6) -----------------------------------------------------
// GET /units/:id/hints: what the player may show. POST /units/:id/hint (empty body): records and returns
// the next hint. Drill / code-check units only; the servable hints are the authored ones except the last;
// a hint opens only after >= 1 failed graded submit and never after a verified pass. Each hint taken
// before the pass cuts that pass's XP by 25% (floor 50%); a hinted pass is verified but never unassisted
// ladder evidence. Reveal still pays 0 XP.

/**
 * Why no further hint can be taken now (absent when `nextAvailable`):
 *   not-hintable  the unit is not a drill / code-check unit, or it has no servable hint
 *   locked        the unit's track or campaign act is locked
 *   needs-fail    record at least one failed submit first
 *   passed        the unit already has a verified pass
 *   exhausted     every servable hint was taken
 */
export const HINT_LOCK_REASONS = ['not-hintable', 'locked', 'needs-fail', 'passed', 'exhausted'] as const;
export const HintLockReason = z.enum(HINT_LOCK_REASONS);
export type HintLockReason = z.infer<typeof HintLockReason>;

export const HintsResponse = z
  .object({
    unitId: z.number().int().positive(),
    /** servable hints on this unit (the authored ones its bank's policy serves: server engines/hints.ts) */
    total: z.number().int().nonnegative(),
    /** texts of the hints already taken, in order (hint 1 first) */
    taken: z.array(z.string()),
    /** true when POST /units/:id/hint would serve the next hint now */
    nextAvailable: z.boolean(),
    lockedReason: HintLockReason.optional(),
    /** percent of the pass XP a pass submitted now would earn (100, 75 or 50) */
    xpPct: z.number().int().min(0).max(100),
  })
  .strict();
export type HintsResponse = z.infer<typeof HintsResponse>;

export const HintTakenResponse = HintsResponse.extend({
  /** the hint just served: its 1-based position and text (also the last entry of `taken`) */
  hint: z.object({ index: z.number().int().positive(), text: z.string() }).strict(),
}).strict();
export type HintTakenResponse = z.infer<typeof HintTakenResponse>;

// ---- f52 S: Fundamentals "More practice" (C3) -------------------------------------------------------------
// GET /tracks/:id/fundamentals: each topic may carry `related`, existing drill units from other banks that
// practise the same topic (content/fundamentals/related.json; keys that do not resolve are skipped). Absent
// when the topic has no related units on this server.

export const FundTopicDtoExt = FundTopicDto.extend({ related: z.array(api.UnitSummary).optional() }).strict();
export type FundTopicDtoExt = z.infer<typeof FundTopicDtoExt>;

export const FundamentalsResponseExt = FundamentalsResponse.extend({ topics: z.array(FundTopicDtoExt) }).strict();
export type FundamentalsResponseExt = z.infer<typeof FundamentalsResponseExt>;

// ---- f52 S: Fundamentals lesson aids (wave B, app ruling 7) -----------------------------------------------
// GET /units/:id/lesson-aids (read-only): for a Fundamentals topic (study) unit, `gate` maps each 1-based
// quiz question number to the `##`/`###` lesson heading that teaches it (headings only, never an answer:
// the client names the sections to re-read after a failed gate) and `checks` are ungraded, open-book
// reveal cards shown after their heading (content/fundamentals/sections.json; invalid entries are skipped
// at load). Any other unit: { gate: {}, checks: [] }.

export const LessonCheckDto = z
  .object({
    /** the lesson heading the check follows (exact `##`/`###` text) */
    heading: z.string(),
    prompt: z.string(),
    /** open-book answer, shown on Reveal (no XP, no attempt) */
    answer: z.string(),
  })
  .strict();
export type LessonCheckDto = z.infer<typeof LessonCheckDto>;

export const LessonAidsResponse = z
  .object({
    gate: z.record(z.string().regex(/^[1-9]\d*$/, '1-based question number'), z.string()),
    checks: z.array(LessonCheckDto),
  })
  .strict();
export type LessonAidsResponse = z.infer<typeof LessonAidsResponse>;

// ---- rv B: honesty, grading and feedback (REVIEW Q3, Wave 1b rows 1, 2, 5, 6) ------------------------------
// Graded (evidence) gates: a failed study-quiz submit returns the score and the sections to re-read, never a
// per-question mark; a unit takes at most GATE_TRIES_PER_WINDOW graded tries per GATE_TRY_WINDOW_MS (the next
// one is 409 NOT_DUE); a graded submit of a gate or quick check is refused for PRACTICE_LOCK_MS after that
// unit's latest practice try. Practice (POST /units/:id/practice) grades and explains every item and records
// nothing but its timestamp (migration 020).

/** Graded tries of one quiz gate within GATE_TRY_WINDOW_MS (the next one is refused until the oldest ages out). */
export const GATE_TRIES_PER_WINDOW = 2;
export const GATE_TRY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A graded submit of a practised unit opens this long after its latest practice try. */
export const PRACTICE_LOCK_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * GET /units/:id/gate-status: the graded-try budget, the practice lock and the latest graded try of a quiz gate /
 * quick check (read-only). The submit response itself stays the strict `api.ts` shape: a client reads this after
 * a study-quiz submit for the try number, what to re-read and when the next graded try opens.
 */
export const GateStatusResponse = z
  .object({
    unitId: z.number().int().positive(),
    /** POST /units/:id/practice serves this unit (a study-quiz gate or a choice / text quick check) */
    practiceable: z.boolean(),
    /** graded tries recorded on this unit so far (all time) */
    tries: z.number().int().nonnegative(),
    /** graded tries inside the current window, and the window's budget (study-quiz gates; null otherwise) */
    triesInWindow: z.number().int().nonnegative(),
    budget: z.number().int().positive().nullable(),
    /** the next graded try is refused until then (budget spent, or the practice lock); null = open now */
    opensAt: z.number().int().nullable(),
    reason: z.enum(['budget', 'practice']).nullable(),
    lastPracticeAt: z.number().int().nullable(),
    passed: z.boolean(),
    /**
     * The latest graded try: its number on THIS unit (1-based, never the global attempt id) and, when it failed a
     * study-quiz gate, the lesson headings (Fundamentals) or reading-list titles that teach what it missed.
     */
    lastTry: z.object({ number: z.number().int().positive(), passed: z.boolean(), reread: z.array(z.string()) }).strict().nullable(),
  })
  .strict();
export type GateStatusResponse = z.infer<typeof GateStatusResponse>;

/** POST /units/:id/practice: a study-quiz gate takes `answers` (served choice indexes); a quick check `answer`. */
export const PracticeBody = z
  .object({
    answers: z.array(z.number().int().nonnegative()).min(1).max(200).optional(),
    answer: z.union([z.number().int().nonnegative(), z.string().max(4000)]).optional(),
  })
  .strict()
  .refine((b) => (b.answers === undefined) !== (b.answer === undefined), { message: 'send exactly one of `answers` (a quiz gate) or `answer` (a quick check)' });
export type PracticeBody = z.infer<typeof PracticeBody>;

export const PracticeItemDto = z
  .object({
    /** the question's item key (quiz gates); null for a single quick check */
    itemKey: z.string().nullable(),
    correct: z.boolean(),
    /** the keyed choice / answer text (practice is open-book: never evidence) */
    answer: z.string().nullable(),
    explanation: z.string().nullable(),
  })
  .strict();
export type PracticeItemDto = z.infer<typeof PracticeItemDto>;

export const PracticeResponse = z
  .object({
    unitId: z.number().int().positive(),
    correct: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    score: z.number(),
    passPct: z.number(),
    /** would have met the pass mark (nothing is recorded either way) */
    wouldPass: z.boolean(),
    items: z.array(PracticeItemDto),
    /** a graded submit of this unit opens then (PRACTICE_LOCK_MS after this try) */
    gradedOpensAt: z.number().int(),
  })
  .strict();
export type PracticeResponse = z.infer<typeof PracticeResponse>;

/**
 * GET /units/:id/source: the pinned repo tree an explain-back / kata unit was cut from (seed provenance). G2
 * delegation briefs are OPEN-BOOK (a real brief is written with the repo open): `openBook` is true for them
 * and reading the tree there is not assistance. Other explain-backs stay closed-book.
 */
export const UnitSourceResponse = z
  .object({
    unitId: z.number().int().positive(),
    repo: z.string(),
    sha: z.string(),
    /** https://github.com/<owner>/<repo>/tree/<sha> */
    url: z.string(),
    openBook: z.boolean(),
  })
  .strict();
export type UnitSourceResponse = z.infer<typeof UnitSourceResponse>;

/** GET /evidence: a row also says whether a hint was taken at or before its attempt (engines/hints.ts). */
export const EvidenceRowDtoExt = api.EvidenceRowDto.extend({ hinted: z.boolean() }).strict();
export type EvidenceRowDtoExt = z.infer<typeof EvidenceRowDtoExt>;
export const EvidenceListResponseExt = api.EvidenceListResponse.extend({ items: z.array(EvidenceRowDtoExt) }).strict();
export type EvidenceListResponseExt = z.infer<typeof EvidenceListResponseExt>;

// ---- rv2 S1: key ideas, spaced production, error notebook (PLAN §2.1, F1 F2 F3 F6 F8) ------------------------
// Server: api/keyideas-service.ts (+ engines/keyideas.ts, engines/redo.ts), api/notebook-service.ts. Key-idea,
// redo, ebmiss, re-check and note cards are review_item kind 'concept'; none of them is evidence.

/** Typed free recall of a recap / re-check prompt needs at least this many words (the rv B minimum-answer check). */
export const RECAP_MIN_WORDS = 8;
/** A section recap pays this flat XP once per section. */
export const RECAP_XP = 20;
/** The interleaved key-ideas session size, and the 10-minute mode's. */
export const KEYIDEA_SESSION_CAP = 12;
export const KEYIDEA_TEN_MINUTE_CAP = 5;
/** Review page, 10-minute mode: a hard cap on cards served (rv C deferred F8; holds across paging). */
export const TEN_MINUTE_REVIEW_CAP = 20;

export const KeyIdeaStatus = z.enum(['owned', 'shaky', 'not-met']);
export type KeyIdeaStatus = z.infer<typeof KeyIdeaStatus>;

export const KeyIdeaSourceDto = z
  .object({ key: z.string(), unitId: z.number().int().positive().nullable(), title: z.string().nullable(), passed: z.boolean() })
  .strict();
export type KeyIdeaSourceDto = z.infer<typeof KeyIdeaSourceDto>;

/** One idea. `prompt`, `answer` and `why` are present only once the idea is met (every live source passed). */
export const KeyIdeaDto = z
  .object({
    id: z.string(),
    idea: z.string(),
    tags: z.array(z.string()),
    status: KeyIdeaStatus,
    sources: z.array(KeyIdeaSourceDto),
    prompt: z.string().optional(),
    answer: z.string().optional(),
    why: z.string().optional(),
  })
  .strict();
export type KeyIdeaDto = z.infer<typeof KeyIdeaDto>;

export const RecapKind = z.enum(['recap', 'recheck-14', 'recheck-45']);
export type RecapKind = z.infer<typeof RecapKind>;

export const KeyIdeaRecapDto = z
  .object({
    /** locked: not enough scope units passed (or no idea met); open: offered; done: the checkpoint row exists */
    state: z.enum(['locked', 'open', 'done']),
    passed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    needed: z.number().int().nonnegative(),
    doneAt: z.number().int().nullable(),
  })
  .strict();

export const KeyIdeaSectionDto = z
  .object({ section: z.string(), title: z.string(), track: z.string(), recap: KeyIdeaRecapDto, ideas: z.array(KeyIdeaDto) })
  .strict();
export type KeyIdeaSectionDto = z.infer<typeof KeyIdeaSectionDto>;

export const KeyIdeaTileDto = z
  .object({ track: z.string(), owned: z.number().int().nonnegative(), shaky: z.number().int().nonnegative(), notMet: z.number().int().nonnegative() })
  .strict();
export type KeyIdeaTileDto = z.infer<typeof KeyIdeaTileDto>;

/** GET /keyideas[?track=&unit=] */
export const KeyIdeasQuery = z
  .object({ track: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(), unit: z.string().min(1).max(400).optional() })
  .strict();
export const KeyIdeasResponse = z
  .object({
    sections: z.array(KeyIdeaSectionDto),
    /** per track over ALL sections (the query filters only `sections`) */
    tiles: z.array(KeyIdeaTileDto),
    recapsOpen: z.array(z.object({ section: z.string(), title: z.string() }).strict()),
    /** due key-idea cards right now (keyidea: only) */
    dueCards: z.number().int().nonnegative(),
  })
  .strict();
export type KeyIdeasResponse = z.infer<typeof KeyIdeasResponse>;

/** GET /keyideas/queue[?tag=&limit=]: due key-idea cards from every section, interleaved (no two neighbours share a section). */
export const KeyIdeaQueueQuery = z
  .object({
    tag: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
    limit: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(1).max(KEYIDEA_SESSION_CAP)).optional(),
  })
  .strict();
export const KeyIdeaRefDto = z
  .object({ section: z.string(), sectionTitle: z.string(), ideaId: z.string(), tags: z.array(z.string()), sources: z.array(KeyIdeaSourceDto) })
  .strict();
export type KeyIdeaRefDto = z.infer<typeof KeyIdeaRefDto>;
export const KeyIdeaQueueItem = api.ReviewQueueItem.extend({ keyIdea: KeyIdeaRefDto }).strict();
export type KeyIdeaQueueItem = z.infer<typeof KeyIdeaQueueItem>;
export const KeyIdeaQueueResponse = z
  .object({
    /** due key-idea cards matching the tag filter (before the cap) */
    count: z.number().int().nonnegative(),
    items: z.array(KeyIdeaQueueItem),
    /** the concept index: every tag of a due key-idea card, with its count */
    tags: z.array(z.object({ tag: z.string(), count: z.number().int().positive() }).strict()),
  })
  .strict();
export type KeyIdeaQueueResponse = z.infer<typeof KeyIdeaQueueResponse>;

/** GET /keyideas/cards/:itemId: what a concept card is about (links, redo target). Never the answer. */
export const ConceptCardResponse = z
  .object({
    itemId: z.number().int().positive(),
    cardKey: z.string(),
    type: z.enum(['keyidea', 'redo', 'ebmiss', 'recheck', 'note']),
    keyIdea: KeyIdeaRefDto.optional(),
    /** redo: the sibling drill the run must be done on (null: no live sibling) */
    redo: z.object({ unitId: z.number().int().positive(), key: z.string(), title: z.string() }).strict().nullable().optional(),
    /** recheck: the section and the re-check kind */
    recheck: z.object({ section: z.string(), title: z.string(), kind: RecapKind }).strict().optional(),
  })
  .strict();
export type ConceptCardResponse = z.infer<typeof ConceptCardResponse>;

/** GET /keyideas/recap/:section and GET /keyideas/recheck/:itemId: the prompts, never the answers. */
export const RecapPromptsResponse = z
  .object({
    section: z.string(),
    title: z.string(),
    kind: RecapKind,
    prompts: z.array(z.object({ ideaId: z.string(), prompt: z.string() }).strict()),
  })
  .strict();
export type RecapPromptsResponse = z.infer<typeof RecapPromptsResponse>;

export const RecapRevealBody = z.object({ ideaId: z.string().min(1).max(80), recall: z.string().min(1).max(4000) }).strict();
export type RecapRevealBody = z.infer<typeof RecapRevealBody>;
export const RecapRevealResponse = z.object({ ideaId: z.string(), answer: z.string(), why: z.string(), sources: z.array(KeyIdeaSourceDto) }).strict();
export type RecapRevealResponse = z.infer<typeof RecapRevealResponse>;

export const RecapMark = z.enum(['got', 'partly', 'missed']);
export type RecapMark = z.infer<typeof RecapMark>;
export const RecapSubmitBody = z
  .object({ items: z.array(z.object({ ideaId: z.string().min(1).max(80), recall: z.string().min(1).max(4000), mark: RecapMark }).strict()).min(1).max(20) })
  .strict();
export type RecapSubmitBody = z.infer<typeof RecapSubmitBody>;
export const RecapSubmitResponse = z
  .object({
    checkpointId: z.number().int().positive(),
    section: z.string(),
    kind: RecapKind,
    /** the recap's flat XP (null for a re-check: its card's review XP is in `reviewXp`) */
    xp: api.XpOutcome.nullable(),
    reviewXp: api.XpOutcome.nullable(),
    /** key-idea card keys (re)enrolled due tomorrow: the partly / missed ideas */
    reenrolled: z.array(z.string()),
    /** recap: the 14- and 45-day re-check due times */
    recheckDueAt: z.array(z.number().int()),
  })
  .strict();
export type RecapSubmitResponse = z.infer<typeof RecapSubmitResponse>;

/** POST /redo/:itemId/run: a practice-mode run of the redo card's sibling drill; it grades only the card. */
export const RedoRunBody = z.object({ code: z.string().min(1).max(api.MAX_CODE_CHARS) }).strict();
export type RedoRunBody = z.infer<typeof RedoRunBody>;
export const RedoRunResponse = z
  .object({
    itemId: z.number().int().positive(),
    unitId: z.number().int().positive(),
    result: api.CanonicalRunResult,
    grade: z.enum(['good', 'again']),
    xp: api.XpOutcome,
    nextDueAt: z.number().int(),
  })
  .strict();
export type RedoRunResponse = z.infer<typeof RedoRunResponse>;

/** F6 error notebook (migration 024): one line + a category after a failed submit or a missed key point. */
export const NOTE_CATEGORIES = ['misread', 'concept-gap', 'edge-case', 'api-or-syntax', 'slip', 'other'] as const;
export const NoteCategory = z.enum(NOTE_CATEGORIES);
export type NoteCategory = z.infer<typeof NoteCategory>;
export const NOTE_MAX_CHARS = 200;
export const ErrorNoteBody = z
  .object({
    unitId: z.number().int().positive(),
    attemptId: z.number().int().positive().optional(),
    line: z.string().trim().min(3).max(NOTE_MAX_CHARS),
    category: NoteCategory,
  })
  .strict();
export type ErrorNoteBody = z.infer<typeof ErrorNoteBody>;
export const ErrorNoteDto = z
  .object({
    id: z.number().int().positive(),
    unitId: z.number().int().positive(),
    unitTitle: z.string(),
    attemptId: z.number().int().positive().nullable(),
    line: z.string(),
    category: NoteCategory,
    createdAt: z.number().int(),
    cardKey: z.string(),
  })
  .strict();
export type ErrorNoteDto = z.infer<typeof ErrorNoteDto>;
export const ErrorNoteResponse = z.object({ note: ErrorNoteDto, cardDueAt: z.number().int() }).strict();
export type ErrorNoteResponse = z.infer<typeof ErrorNoteResponse>;
export const NotebookResponse = z
  .object({ entries: z.array(ErrorNoteDto), categories: z.array(z.object({ category: NoteCategory, count: z.number().int().positive() }).strict()) })
  .strict();
export type NotebookResponse = z.infer<typeof NotebookResponse>;

// ---- rv2 S3: interview mode S + design profile (F5), the weekly review (F7) ----------------------------------
// Server: api/ladder-service.ts (recordInterviewMeta), store/design-side.ts + api/stats-service.ts (designProfile),
// api/week-service.ts. Nothing here is evidence: interview meta, the profile and the week page change no grade, pay
// no XP, write no ladder leg and unlock nothing (a DESIGN IT answer in interview mode is graded exactly like any).

/** Interview mode S: the time box the client's timer runs against (R5 F9: 45 minutes). */
export const INTERVIEW_TIME_BOX_MS = 45 * 60 * 1000;
/** The six delivery-framework headings shown in interview mode, in order (PLAN §2.2 design-it, R5 F9). */
export const INTERVIEW_FRAMEWORK = [
  'Requirements and numbers',
  'Entities and API',
  'High-level design',
  'Deep dive',
  'Pre-mortem',
  'Trade-offs',
] as const;

/** POST /units/:id/explain-back/interview: the meta of the answer of record just stored (before its self-score). */
export const InterviewMetaBody = z
  .object({
    attemptId: z.number().int().positive(),
    elapsedMs: z.number().int().min(0).max(86_400_000),
    timeBoxMs: z.number().int().positive().max(86_400_000),
    blind: z.boolean(),
  })
  .strict();
export type InterviewMetaBody = z.infer<typeof InterviewMetaBody>;
export const InterviewMetaResponse = z
  .object({
    attemptId: z.number().int().positive(),
    mode: z.literal('interview'),
    elapsedMs: z.number().int(),
    timeBoxMs: z.number().int(),
    blind: z.boolean(),
    overTime: z.boolean(),
  })
  .strict();
export type InterviewMetaResponse = z.infer<typeof InterviewMetaResponse>;

/** The eight key-point dimensions of content/design/headlines.json (S2 C2: a fixed list). */
export const DESIGN_DIMENSIONS = ['requirements', 'data-and-api', 'consistency', 'scaling', 'reliability', 'security', 'operations', 'trade-offs'] as const;
export const DesignDimension = z.enum(DESIGN_DIMENSIONS);
export type DesignDimension = z.infer<typeof DesignDimension>;

const Tally = z.object({ covered: z.number().int().min(0), missed: z.number().int().min(0) }).strict();
export const DesignDimensionDto = Tally.extend({
  id: DesignDimension,
  /** the file's own definition of the dimension, when headlines.json is loaded */
  description: z.string().nullable(),
  /** covered / (covered + missed); null with no marked key point */
  coverage: z.number().min(0).max(1).nullable(),
  /** distinct answers of record that marked a key point of this dimension */
  answers: z.number().int().min(0),
}).strict();
export type DesignDimensionDto = z.infer<typeof DesignDimensionDto>;

/**
 * GET /stats/design-profile: per dimension, the key points the learner marked covered / missed on their self-scored
 * DESIGN IT and G2 answers of record (practice retakes excluded). A key point with no headline (no file, or a set
 * the file does not list) counts under `unclassified`, so a set without headlines still works.
 */
export const DesignProfileResponse = z
  .object({
    /** content/design/headlines.json was found and parsed */
    headlinesLoaded: z.boolean(),
    /** self-scored answers of record counted */
    answers: z.number().int().min(0),
    dimensions: z.array(DesignDimensionDto),
    unclassified: Tally,
    interview: z
      .object({
        answers: z.number().int().min(0),
        medianElapsedMs: z.number().int().nullable(),
        overTime: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();
export type DesignProfileResponse = z.infer<typeof DesignProfileResponse>;

/** F7: the weekly review. A week is Monday..Sunday in the owner's local days. */
export const WEEK_REFLECTION_QUESTIONS = [
  'What did you learn this week that you could explain to a colleague tomorrow?',
  'What tripped you up most, and why?',
  'What will you do differently next week?',
] as const;
export const WEEK_REFLECTION_MAX_CHARS = 1000;
/** Activity events closer than this belong to one sitting (the time estimate's rule). */
export const WEEK_SESSION_GAP_MS = 15 * 60 * 1000;
/** Each sitting also counts this much before its first recorded event. */
export const WEEK_SESSION_LEAD_MS = 5 * 60 * 1000;

const dayKeyStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
/** GET /week[?start=YYYY-MM-DD] (any day of the wanted week; default: this week) */
export const WeekQuery = z.object({ start: dayKeyStr.optional() }).strict();
export type WeekQuery = z.infer<typeof WeekQuery>;

export const WeekResponse = z
  .object({
    /** Monday and Sunday of the week (local day keys) */
    start: dayKeyStr,
    end: dayKeyStr,
    today: dayKeyStr,
    time: z
      .object({
        activeDays: z.number().int().min(0),
        sittings: z.number().int().min(0),
        /** estimated minutes: per sitting (events < WEEK_SESSION_GAP_MS apart) its span + WEEK_SESSION_LEAD_MS */
        estMinutes: z.number().int().min(0),
        rule: z.string(),
      })
      .strict(),
    passes: z
      .object({
        /** distinct units with a verified pass (or a reading attest) this week */
        units: z.number().int().min(0),
        /** of those, units passed for the first time ever this week */
        firstTime: z.number().int().min(0),
        byKind: z.array(z.object({ kind: UnitKind, units: z.number().int().positive() }).strict()),
        /** explain-back / kata answers self-scored this week (distinct attempts) */
        selfScored: z.number().int().min(0),
      })
      .strict(),
    xp: z.number().int().min(0),
    reviews: z.object({ graded: z.number().int().min(0), again: z.number().int().min(0) }).strict(),
    /** key ideas rated "again" at least twice this week (PLAN §2.1) */
    shakyIdeas: z.array(z.object({ cardKey: z.string(), section: z.string(), ideaId: z.string(), idea: z.string().nullable(), again: z.number().int().min(2) }).strict()),
    notebook: z
      .object({
        entries: z.number().int().min(0),
        topCategories: z.array(z.object({ category: NoteCategory, count: z.number().int().positive() }).strict()),
      })
      .strict(),
    reflection: z
      .object({
        questions: z.array(z.string()),
        /** the latest saved answers for this week, null when none */
        answers: z.array(z.string()).nullable(),
        savedAt: z.number().int().nullable(),
      })
      .strict(),
  })
  .strict();
export type WeekResponse = z.infer<typeof WeekResponse>;

/** POST /week/reflection: the three answers for a week (a later save supersedes, history kept; 0 XP). */
export const WeekReflectionBody = z
  .object({
    start: dayKeyStr,
    answers: z.array(z.string().trim().max(WEEK_REFLECTION_MAX_CHARS)).length(WEEK_REFLECTION_QUESTIONS.length),
  })
  .strict()
  .refine((b) => b.answers.some((a) => a.trim() !== ''), { message: 'answer at least one question', path: ['answers'] });
export type WeekReflectionBody = z.infer<typeof WeekReflectionBody>;
export const WeekReflectionResponse = z.object({ start: dayKeyStr, savedAt: z.number().int() }).strict();
export type WeekReflectionResponse = z.infer<typeof WeekReflectionResponse>;
