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
  SubmitResponse,
  TrackSummary as TrackSummarySchema,
  TracksResponse as TracksResponseSchema,
  TrackUnitsResponse as TrackUnitsResponseSchema,
  UnitDetailResponse,
  UnitLockState,
  UnitSummary,
  XpOutcome as XpOutcomeSchema,
} from '@bootquest/shared/api';

// ---------------------------------------------------------------- re-exported wire types

export type {
  ApiErrorBody,
  ApiErrorCode,
  CanonicalRunResult,
  DashboardResponse,
  PublicCheck,
  RevealResponse,
  SelfAttestResponse,
  SubmitResponse,
  UnitDetailResponse,
  UnitLockState,
  UnitSummary,
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
 * Body of POST /units/:id/submit. Exactly one of `code` / `answer`. There is deliberately
 * NO `assistance` field: the client may only declare the honor-system "I had help" boolean.
 * Reveal-assistance is derived server-side from the reveal row, never declared (W-16b).
 */
export type Submission =
  | { code: string; answer?: never; selfAssisted: boolean }
  | { answer: string | number; code?: never; selfAssisted: boolean };

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
  /** GET /api/tracks/:id/units — the campaign page derives its view from this (no /campaign route). */
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
  /** GET /api/reviews/queue[?limit=n] — `count` is the total due regardless of limit. */
  getReviewQueue(limit?: number): Promise<ReviewQueueResponse>;
  /** POST /api/reviews/:itemId/grade — 409 NOT_DUE for a card that is not due yet. */
  gradeReview(itemId: number, grade: ReviewGrade): Promise<GradeResponse>;
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
