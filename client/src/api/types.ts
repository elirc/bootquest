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
  GradeBody,
  GradeResponse as GradeResponseSchema,
  HealthResponse as HealthResponseSchema,
  PublicCheck,
  ReviewQueueItem as ReviewQueueItemSchema,
  ReviewQueueResponse as ReviewQueueResponseSchema,
  RevealResponse,
  RunResponse as RunResponseSchema,
  SelfAttestResponse,
  SlateItemDto,
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
};

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
export type SlateItem = z.infer<typeof SlateItemDto>;

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
export type Dashboard = DashboardResponse;
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
