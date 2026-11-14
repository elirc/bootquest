// BootQuest client <-> API contract.
//
// The SERVER contract in shared/src/api.ts is canonical: every wire type below is a
// re-export (or a z.infer of a schema) from '@bootquest/shared/api'. The client never
// redeclares a wire shape. Only view-model helpers (NodeState, the tolerant prose
// fields another wave is adding, the error class) live here.
//
// Conventions (server-owned):
// - ids are positive integers; timestamps are epoch ms; days are 'YYYY-MM-DD' (owner's local day).
// - run results are the canonical { pass, output, failures[], durationMs }.
// - the server computes every number (XP, level, streak); the client never derives them.

import type { z } from 'zod';
// ab S1: slate settings (the learner's daily slate shape; shared/src/api-ext.ts S1 section)
import type { SlateSettingsBody, SlateSettingsResponse, SlateTrackShape } from '@bootquest/shared/api-ext';
export type { SlateSettingsBody, SlateSettingsResponse, SlateTrackShape };
// rv wave C: learner settings (primary language, campaign step, senior rep) + the archive/paths routing
import type { LearnerSettingsBody, LearnerShapeDto, PrimaryLanguage, RoutingResponse, SeniorRepKind } from '@bootquest/shared/api-ext';
export type { LearnerSettingsBody, LearnerShapeDto, PrimaryLanguage, RoutingResponse, SeniorRepKind };
import type {
  AnswerRecordedResponse,
  AttemptDetailResponse,
  TrackProgress,
  XpStatsResponse,
  ReviewStatsResponse,
  PassRatesResponse,
  CampaignProgressResponse,
  CampaignActDto,
  CampaignQuestDto,
  CampaignResponse,
  CompetenciesResponse,
  EvidenceListResponse,
  EvidenceRowDto,
  ExplainBackKeyResponse,
  ExplainBackPracticeBody,
  ExplainBackPracticeScoreBody,
  ExplainBackPublic,
  ExplainBackScoreResponse,
  KataDefectDto,
  KataFinding,
  KataKeyResponse,
  KataPublic,
  KataScoreResponse,
  KataStatsResponse,
  KeyPointDto,
  ModelAnswerResponse,
  PracticeAttemptDto,
  PromotionLegState,
  PromotionProgress,
  QuestState,
  RatingChangeDto,
  RetestListItemDto,
  ScheduledRetestDto,
  ApiErrorBody,
  ApiErrorCode,
  CanonicalRunResult,
  DashboardResponse,
  GradeBody,
  GradeResponse as GradeResponseSchema,
  HealthResponse as HealthResponseSchema,
  PublicCheck,
  ReviewQueueItem as ReviewQueueItemSchema,
  ReviewQueueResponse as ReviewQueueResponseSchema,
  RevealResponse,
  RunResponse as RunResponseSchema,
  SelfAttestResponse,
  StudyQuestPublic,
  StudyQuizOutcome,
  SubmitResponse,
  TrackSummary as TrackSummarySchema,
  TracksResponse as TracksResponseSchema,
  TrackUnitsResponse as TrackUnitsResponseSchema,
  UnitDetailResponse,
  UnitLockState,
  UnitNotesResponse,
  NoteDto,
  RefContentResponse,
  UnitSummary,
  WrittenAnswerResponse,
  XpOutcome as XpOutcomeSchema,
} from '@bootquest/shared/api';
// ab wave S3: weak spots + due now (shared/src/api-ext.ts, types only)
import type { AltSetDueDto, DueResponse, WeakExampleDto, WeakGroupDto, WeakSignalKind, WeakSpotsResponse } from '@bootquest/shared/api-ext';
// ab S4: the dashboard's slate items carry targetUnitId; unit search + mixed drills (api-ext)
import type { DashboardResponseExt, DrillNextResponse, SlateItemDtoExt, UnitSearchHit, UnitSearchResponse } from '@bootquest/shared/api-ext';
// fund wave: the Fundamentals ladder (GET /tracks/:id/fundamentals)
import type { FundamentalsResponse, FundTopicDto } from '@bootquest/shared/api-ext';
export type { FundamentalsResponse, FundTopicDto };
// f52 S: each topic may carry `related` ("More practice": existing drills of the track's other banks)
import type { FundamentalsResponseExt, FundTopicDtoExt } from '@bootquest/shared/api-ext';
export type { FundamentalsResponseExt, FundTopicDtoExt };
// f52 S: progressive hints (GET /units/:id/hints, POST /units/:id/hint)
import type { HintLockReason, HintsResponse, HintTakenResponse } from '@bootquest/shared/api-ext';
export type { HintLockReason, HintsResponse, HintTakenResponse };
// rv B: practice vs evidence, gate status, pinned source, hinted evidence (shared/src/api-ext.ts rv B section)
import type { EvidenceRowDtoExt, GateStatusResponse, PracticeBody, PracticeItemDto, PracticeResponse, UnitSourceResponse } from '@bootquest/shared/api-ext';
export type { EvidenceRowDtoExt, GateStatusResponse, PracticeBody, PracticeItemDto, PracticeResponse, UnitSourceResponse };
// rv2 S1: key ideas, recap / re-check, redo runs, the error notebook (shared/src/api-ext.ts rv2 S1 section)
import type {
  ConceptCardResponse,
  ErrorNoteBody,
  ErrorNoteDto,
  ErrorNoteResponse,
  KeyIdeaDto,
  KeyIdeaQueueItem,
  KeyIdeaQueueResponse,
  KeyIdeaRefDto,
  KeyIdeaSectionDto,
  KeyIdeaSourceDto,
  KeyIdeasResponse,
  KeyIdeaStatus,
  KeyIdeaTileDto,
  NoteCategory,
  NotebookResponse,
  RecapKind,
  RecapMark,
  RecapPromptsResponse,
  RecapRevealResponse,
  RecapSubmitBody,
  RecapSubmitResponse,
  RedoRunResponse,
} from '@bootquest/shared/api-ext';
export type {
  ConceptCardResponse,
  ErrorNoteBody,
  ErrorNoteDto,
  ErrorNoteResponse,
  KeyIdeaDto,
  KeyIdeaQueueItem,
  KeyIdeaQueueResponse,
  KeyIdeaRefDto,
  KeyIdeaSectionDto,
  KeyIdeaSourceDto,
  KeyIdeasResponse,
  KeyIdeaStatus,
  KeyIdeaTileDto,
  NoteCategory,
  NotebookResponse,
  RecapKind,
  RecapMark,
  RecapPromptsResponse,
  RecapRevealResponse,
  RecapSubmitBody,
  RecapSubmitResponse,
  RedoRunResponse,
};
// rv2 S3: interview mode S + the DESIGN IT dimension profile (shared/src/api-ext.ts rv2 S3 section)
import type { DesignDimension, DesignDimensionDto, DesignProfileResponse, InterviewMetaBody, InterviewMetaResponse } from '@bootquest/shared/api-ext';
export type { DesignDimension, DesignDimensionDto, DesignProfileResponse, InterviewMetaBody, InterviewMetaResponse };

/**
 * f52 wave B (app ruling 7): lesson aids of a Fundamentals topic (GET /units/:id/lesson-aids). Declared
 * here, in the client, while the server half lands in parallel (its DTO goes to shared/src/api-ext.ts).
 *   gate    1-based SERVED question number -> the lesson heading that teaches it (the "Re-read" line)
 *   checks  ungraded "check yourself" reveal cards, each placed after its lesson heading
 */
export interface LessonCheck {
  heading: string;
  prompt: string;
  answer: string;
}
export interface LessonAids {
  gate: Record<string, string>;
  checks: LessonCheck[];
}
export const NO_LESSON_AIDS: LessonAids = { gate: {}, checks: [] };

// ---------------------------------------------------------------- re-exported wire types

export type {
  UnitNotesResponse,
  NoteDto,
  RefContentResponse,
  AnswerRecordedResponse,
  AttemptDetailResponse,
  TrackProgress,
  XpStatsResponse,
  ReviewStatsResponse,
  PassRatesResponse,
  CampaignProgressResponse,
  CampaignActDto,
  CampaignQuestDto,
  CampaignResponse,
  CompetenciesResponse,
  EvidenceListResponse,
  EvidenceRowDto,
  ExplainBackKeyResponse,
  ExplainBackPracticeBody,
  ExplainBackPracticeScoreBody,
  ExplainBackPublic,
  ExplainBackScoreResponse,
  KataDefectDto,
  KataFinding,
  KataKeyResponse,
  KataPublic,
  KataScoreResponse,
  KataStatsResponse,
  KeyPointDto,
  ModelAnswerResponse,
  PromotionLegState,
  PromotionProgress,
  QuestState,
  RatingChangeDto,
  RetestListItemDto,
  ScheduledRetestDto,
  ApiErrorBody,
  ApiErrorCode,
  CanonicalRunResult,
  DashboardResponse,
  PublicCheck,
  RevealResponse,
  SelfAttestResponse,
  StudyQuestPublic,
  StudyQuizOutcome,
  SubmitResponse,
  UnitDetailResponse,
  UnitLockState,
  UnitSummary,
  WrittenAnswerResponse,
  DrillNextResponse,
  UnitSearchHit,
  UnitSearchResponse,
};
export type { AltSetDueDto, DueResponse, WeakExampleDto, WeakGroupDto, WeakSignalKind, WeakSpotsResponse };

// shared/src/api.ts exports these schemas without a sibling type alias; infer them here.
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type TrackSummary = z.infer<typeof TrackSummarySchema>;
export type TracksResponse = z.infer<typeof TracksResponseSchema>;
export type TrackUnitsResponse = z.infer<typeof TrackUnitsResponseSchema>;
export type RunResponse = z.infer<typeof RunResponseSchema>;
export type XpOutcome = z.infer<typeof XpOutcomeSchema>;
export type ReviewQueueItem = z.infer<typeof ReviewQueueItemSchema>;
export type ReviewQueueResponse = z.infer<typeof ReviewQueueResponseSchema>;
export type GradeResponse = z.infer<typeof GradeResponseSchema>;
export type SlateItem = SlateItemDtoExt;
/** explain-back retakes: one practice attempt (the key was already read; 0 XP; feedback only) */
export type PracticeAttempt = z.infer<typeof PracticeAttemptDto>;
/** explain-back retakes: the practice state of the loaded version (unit detail) */
export type ExplainBackPracticeState = NonNullable<ExplainBackPublic['practice']>;
/** explain-back alternate sets: the sibling group of this unit (unit detail) */
export type ExplainBackAltSets = NonNullable<ExplainBackPublic['altSets']>;
export type ExplainBackAltSibling = ExplainBackAltSets['siblings'][number];

// Enums, derived from the contract so they can never drift from shared/src/enums.ts.
export type TrackId = TrackSummary['id'];
export type UnitKind = UnitSummary['kind'];
export type CompetencyId = UnitDetailResponse['unit']['competencies'][number];
export type ReviewGrade = z.infer<typeof GradeBody>['grade'];
export type RunVerdict = SubmitResponse['verdict'];
export type AttemptMode = SubmitResponse['attempt']['mode'];
export type XpZeroReason = NonNullable<XpOutcome['reason']>;
export type CheckType = PublicCheck['type'];
export type RunFailure = CanonicalRunResult['failures'][number];

// Dashboard parts.
export type Dashboard = DashboardResponseExt;
export type HeatmapDay = DashboardResponse['heatmap'][number];
export type DayStatus = HeatmapDay['status'];
export type CompetencyRow = DashboardResponse['competencies'][number];
export type NextUp = DashboardResponse['nextUp'][number];
export type SlateItemKind = SlateItem['kind'];
export type EvidenceKind = EvidenceRowDto['kind'];

// ---------------------------------------------------------------- client view types

/** Campaign node state: exactly the server's per-unit lock state (acts arrive in W5). */
export type NodeState = UnitLockState;

/**
 * Prose fields another wave is adding server-side (W-14e). The client renders them when
 * present and must not crash when they are absent; they are deliberately optional and loose.
 */
export interface TolerantUnitProse {
  instructions?: string | string[] | null;
  prompt?: string | null;
}

/**
 * fix/client-review: the explain-back / kata public halves gain `supersededAnswerIds` (the
 * learner's answers to an EARLIER version of the item, re-seeded since) in a parallel server
 * change. Optional and tolerant: absent on older servers, where the client falls back to reading
 * the NOT_ANSWERED message.
 */
export interface TolerantSuperseded {
  supersededAnswerIds?: number[];
}

/** GET /api/units/:id as the client reads it: the canonical response plus tolerant prose. */
export type UnitDetail = Omit<UnitDetailResponse, 'unit'> & { unit: UnitDetailResponse['unit'] & TolerantUnitProse };

/**
 * Body of POST /units/:id/submit. Exactly one of `code` / `answer` / `answers` (W8 study-quiz:
 * the full answer set, one choice index per question in served order). There is deliberately
 * NO `assistance` field: the client may only declare the honor-system "I had help" boolean.
 * Reveal-assistance is derived server-side from the reveal row, never declared (W-16b).
 */
export type Submission =
  | { code: string; answer?: never; answers?: never; selfAssisted: boolean }
  | { answer: string | number; code?: never; answers?: never; selfAssisted: boolean }
  | { answers: number[]; code?: never; answer?: never; selfAssisted: boolean };

/** Body of POST /units/:id/run (drill types only; quiz/predict are submit-only). */
export type RunInput = { code: string; answer?: never } | { answer: string | number; code?: never };

// ---------------------------------------------------------------- the client interface

/**
 * The whole surface the shell needs, one method per server route. The mock and the HTTP
 * implementation are interchangeable and share these semantics, including the error codes.
 */
export interface BootQuestApi {
  /** GET /api/health */
  getHealth(): Promise<HealthResponse>;
  /** GET /api/dashboard */
  getDashboard(): Promise<Dashboard>;
  /** GET /api/tracks */
  getTracks(): Promise<TracksResponse>;
  /** GET /api/tracks/:id/units — the track's units (the campaign map itself is getCampaign). */
  getTrackUnits(trackId: TrackId): Promise<TrackUnitsResponse>;
  /** fund wave: GET /api/tracks/:id/fundamentals — the track's Fundamentals ladder (topics in order; empty when none; f52: optional `related` per topic). */
  getFundamentals(trackId: TrackId): Promise<FundamentalsResponseExt>;
  /** GET /api/units/:id */
  getUnit(unitId: number): Promise<UnitDetail>;
  /** POST /api/units/:id/run — free, writes nothing. 409 RUN_NOT_AVAILABLE for quiz / predict-output. */
  runUnit(unitId: number, input: RunInput): Promise<RunResponse>;
  /** POST /api/units/:id/submit — records an immutable attempt. */
  submitUnit(unitId: number, submission: Submission): Promise<SubmitResponse>;
  /** POST /api/units/:id/reveal — writes the guided reveal row (0 XP forever), then returns the solution. */
  revealUnit(unitId: number): Promise<RevealResponse>;
  /** GET /api/units/:id/solution — 403 NOT_REVEALED until a reveal row exists. */
  getSolution(unitId: number): Promise<RevealResponse>;
  /** POST /api/units/:id/self-attest — reading units only, once (409 ALREADY_ATTESTED). */
  selfAttest(unitId: number): Promise<SelfAttestResponse>;
  /**
   * POST /api/units/:id/answer — written units only: stores the learner's answer IMMUTABLY
   * (ungraded, no XP). Only `answer` + the boolean `selfAssisted` ever leave the client.
   */
  answerWritten(unitId: number, body: { answer: string; selfAssisted: boolean }): Promise<WrittenAnswerResponse>;
  /** GET /api/units/:id/model-answer — 403 NOT_ANSWERED until the learner's own answer row exists. */
  getModelAnswer(unitId: number): Promise<ModelAnswerResponse>;
  /** GET /api/reviews/queue[?limit=n] — `count` is the total due regardless of limit. */
  getReviewQueue(limit?: number): Promise<ReviewQueueResponse>;
  /** POST /api/reviews/:itemId/grade — 409 NOT_DUE for a card that is not due yet. */
  gradeReview(itemId: number, grade: ReviewGrade): Promise<GradeResponse>;

  // ---- W6 competency ladder (immutable answer FIRST, then the key, then the self-score)
  /** GET /api/tracks/:id/campaign — acts, unlock rules, quests (W5b). */
  getCampaign(trackId: TrackId): Promise<CampaignResponse>;
  /** POST /api/units/:id/explain-back/answers — immutable; 403 ALREADY_ANSWERED on a second answer. */
  answerExplainBack(unitId: number, body: { answers: string[]; selfAssisted: boolean }): Promise<AnswerRecordedResponse>;
  /** GET /api/units/:id/explain-back/key — 403 NOT_ANSWERED until the answer row exists. */
  getExplainBackKey(unitId: number): Promise<ExplainBackKeyResponse>;
  /** POST /api/units/:id/explain-back/self-score — 409 ALREADY_SCORED on a second score. */
  selfScoreExplainBack(unitId: number, body: { perKeyPoint: Record<string, 'covered' | 'missed'> }): Promise<ExplainBackScoreResponse>;
  /**
   * POST /api/units/:id/explain-back/practice — a PRACTICE retake once the answer of record is
   * self-scored (403 NOT_ANSWERED before it, 409 NOT_VERIFIED before its self-score, 403
   * ALREADY_ANSWERED while a practice attempt is unscored). Recorded assisted; 0 XP; never a leg.
   */
  practiceExplainBack(unitId: number, body: ExplainBackPracticeBody): Promise<AnswerRecordedResponse>;
  /**
   * POST /api/units/:id/explain-back/practice-score — self-score ONE practice attempt (feedback
   * only: xp null, no retests, no promotions; 409 ALREADY_SCORED on a second score).
   */
  practiceScoreExplainBack(unitId: number, body: ExplainBackPracticeScoreBody): Promise<ExplainBackScoreResponse>;
  /** POST /api/units/:id/kata/findings — immutable; 403 ALREADY_ANSWERED on a second submit. */
  submitKataFindings(unitId: number, body: { findings: KataFinding[]; selfAssisted: boolean }): Promise<AnswerRecordedResponse>;
  /** GET /api/units/:id/kata/key — 403 NOT_ANSWERED until the findings row exists. */
  getKataKey(unitId: number): Promise<KataKeyResponse>;
  /** POST /api/units/:id/kata/self-score */
  selfScoreKata(unitId: number, body: { perDefect: Record<string, 'caught' | 'missed'> }): Promise<KataScoreResponse>;
  /** GET /api/competencies — ratings + three-leg promotion progress + open retests. */
  getCompetencies(): Promise<CompetenciesResponse>;
  /** GET /api/evidence[?competency&kind&limit] — newest first. */
  listEvidence(q?: { competency?: CompetencyId; kind?: EvidenceKind; limit?: number }): Promise<EvidenceListResponse>;
  /** GET /api/attempts/:id */
  getAttempt(attemptId: number): Promise<AttemptDetailResponse>;
  /** GET /api/stats/katas — the G1 aggregate. */
  getKataStats(): Promise<KataStatsResponse>;
  // ---- campaign 2 B2: read-only stats charts
  /** GET /api/stats/xp — 90 local days + all-time Monday weeks, split by track. */
  getXpStats(): Promise<XpStatsResponse>;
  /** GET /api/stats/pass-rates — graded attempts per track / check type, honest first-try. */
  getPassRates(): Promise<PassRatesResponse>;
  /** GET /api/stats/reviews — 14-day due forecast + retention. */
  getReviewStats(): Promise<ReviewStatsResponse>;
  /** GET /api/stats/campaign — per track the shared TrackProgress + per-act counts. */
  getCampaignProgress(): Promise<CampaignProgressResponse>;
  // ---- "Learn more" (read-only)
  /**
   * GET /api/units/:id/notes — readings (always, for an open unit) + explanations (only after
   * the learner's recorded answer covers them; withheld ones are a COUNT). 403 TRACK_LOCKED /
   * ACT_LOCKED for a locked unit.
   */
  getUnitNotes(unitId: number): Promise<UnitNotesResponse>;
  /** GET /api/refs/:id/content — the markdown of ONE registered ref (the refs viewer). */
  getRefContent(refId: number): Promise<RefContentResponse>;
  // ---- ab S1: slate settings
  /** GET /api/settings/slate — today's and tomorrow's slate shape; `configured` once any choice was saved. */
  getSlateSettings(): Promise<SlateSettingsResponse>;
  /**
   * PUT /api/settings/slate — appends the learner's choice, effective TOMORROW (today's slate never
   * moves). 400 VALIDATION for a track with no drill slot, a duplicate, a size outside 1-10, or every track off.
   */
  putSlateSettings(body: SlateSettingsBody): Promise<SlateSettingsResponse>;
  /** rv wave C: PUT /api/settings/learner — primary language / campaign step / senior rep (effective tomorrow; the first language pick applies today). */
  putLearnerSettings(body: LearnerSettingsBody): Promise<SlateSettingsResponse>;
  /** rv wave C: GET /api/routing — archived unit ids + the sysdesign / agentic paths as unit ids. */
  getRouting(): Promise<RoutingResponse>;
  // ---- ab wave S3: weak spots + due now (read-only)
  /** GET /api/stats/weak — per repo / drill module, released keys only, recency-weighted, capped. */
  getWeakSpots(): Promise<WeakSpotsResponse>;
  /** GET /api/due — open retests + alternate explain-back sets whose rotation gate has opened. */
  getDue(): Promise<DueResponse>;

  // ---- ab S4 find things (read-only)
  /**
   * GET /api/units/search?q=&limit= — every live unit (campaign quest units included) matched on key +
   * title only; a unit behind a locked act comes back `locked` (its page still enforces the act gate).
   */
  searchUnits(q: string, limit?: number): Promise<UnitSearchResponse>;
  /** GET /api/drills/next?tracks=a,b&mode=mixed — the next passable drill, rotating deterministically over the tracks. */
  getNextDrill(tracks: readonly TrackId[]): Promise<DrillNextResponse>;

  // ---- f52 S: progressive hints (drill / code-check units; never the last authored hint)
  /** GET /api/units/:id/hints — servable count, the texts already taken, whether the next one is open (and why not). */
  getHints(unitId: number): Promise<HintsResponse>;
  /**
   * POST /api/units/:id/hint — records and returns the next hint. Refusals: 409 NOT_ANSWERED (no failed submit
   * yet), 409 ALREADY_ANSWERED (already passed), 404 NOT_FOUND (every hint taken), 409 WRONG_UNIT_KIND (no
   * hints on this unit), 403 TRACK_LOCKED / ACT_LOCKED. Each hint cuts the eventual pass XP by 25% (floor 50%).
   */
  takeHint(unitId: number): Promise<HintTakenResponse>;

  // ---- f52 wave B: lesson aids (read-only; no XP, no attempt)
  /**
   * GET /api/units/:id/lesson-aids — never rejects: a unit without aids, an older server (404) or any
   * other failure is `{ gate: {}, checks: [] }`.
   */
  getLessonAids(unitId: number): Promise<LessonAids>;

  // ---- rv B: practice vs evidence (quiz gates, quick checks) + pinned source
  /**
   * GET /api/units/:id/gate-status — this unit's try number, the retry budget, the practice lock and what the
   * latest failed gate try should re-read. Never rejects: an older server (404) or any failure is null.
   */
  getGateStatus(unitId: number): Promise<GateStatusResponse | null>;
  /**
   * POST /api/units/:id/practice — grades and explains every item and records NOTHING but the practice time:
   * no attempt, XP, slot, evidence or unlock. A graded try of that unit then waits 2 days (409 NOT_DUE).
   */
  practiceUnit(unitId: number, body: PracticeBody): Promise<PracticeResponse>;
  /** GET /api/units/:id/source — the pinned repo tree of an explain-back / kata (G2: open-book). Null when none. */
  getUnitSource(unitId: number): Promise<UnitSourceResponse | null>;

  // ---- rv2 S1: key ideas (none of these is evidence; nothing here locks or unlocks a unit)
  /** GET /api/keyideas[?track&unit] — sections + ideas (prompt / answer / why only once met), tiles, open recaps. */
  getKeyIdeas(q?: { track?: string; unit?: string }): Promise<KeyIdeasResponse>;
  /** GET /api/keyideas/queue[?tag&limit] — due key-idea cards, interleaved across sections (cap 12). */
  getKeyIdeaQueue(q?: { tag?: string; limit?: number }): Promise<KeyIdeaQueueResponse>;
  /** GET /api/keyideas/cards/:itemId — what a concept card is about (source links, the redo drill). */
  getConceptCard(itemId: number): Promise<ConceptCardResponse>;
  /** GET /api/keyideas/recap/:section — 409 NOT_DUE before it opens, 409 ALREADY_SCORED once done. */
  getRecap(section: string): Promise<RecapPromptsResponse>;
  /** GET /api/keyideas/recheck/:itemId — a due re-check card's prompts. */
  getRecheck(itemId: number): Promise<RecapPromptsResponse>;
  /** POST /api/keyideas/sections/:section/reveal — >= 8 typed words, then one met idea's answer (400 / 403 otherwise). */
  revealIdea(section: string, body: { ideaId: string; recall: string }): Promise<RecapRevealResponse>;
  /** POST /api/keyideas/recap/:section — 20 XP once; partly / missed re-enrolled due tomorrow. */
  submitRecap(section: string, body: RecapSubmitBody): Promise<RecapSubmitResponse>;
  /** POST /api/keyideas/recheck/:itemId — the re-check card's review grade, then it is done. */
  submitRecheck(itemId: number, body: RecapSubmitBody): Promise<RecapSubmitResponse>;
  /** POST /api/redo/:itemId/run — a practice run of the redo drill: grades only the card (Good / Again). */
  runRedo(itemId: number, code: string): Promise<RedoRunResponse>;
  // ---- rv2 S1: the error notebook (optional, 0 XP)
  /** POST /api/notebook — one line + a category; becomes the card note:<id>, due tomorrow. */
  addNote(body: ErrorNoteBody): Promise<ErrorNoteResponse>;
  /** GET /api/notebook — entries newest first + category counts. */
  getNotebook(): Promise<NotebookResponse>;
  // ---- rv2 S3: interview mode S (never evidence) + the dimension profile (read-only)
  /** POST /api/units/:id/explain-back/interview — the timer of a DESIGN IT answer of record, filed before its self-score. */
  recordInterviewMeta(unitId: number, body: InterviewMetaBody): Promise<InterviewMetaResponse>;
  /** GET /api/stats/design-profile — covered / missed key points per headlines.json dimension. */
  getDesignProfile(): Promise<DesignProfileResponse>;
}

/** Codes the client can raise itself on top of the server's envelope codes. */
export type ClientErrorCode = ApiErrorCode | 'NETWORK' | 'BAD_RESPONSE';

/**
 * Every implementation rejects with this. `code` comes from the server's JSON error
 * envelope `{error:{code,message,issues?}}`, so a 404 NOT_FOUND and a 404 NO_SOLUTION
 * are distinguishable (W-3).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isApiError = (e: unknown, code?: ClientErrorCode): e is ApiError =>
  e instanceof ApiError && (code === undefined || e.code === code);
