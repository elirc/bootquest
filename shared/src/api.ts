import { z } from 'zod';
import type { CheckSpec } from './check.ts';
import { CompetencyId, ReviewGrade, RunVerdict, TrackId, UnitKind, XpZeroReason, type CheckType as CheckTypeT } from './enums.ts';
import { RunnerFailure } from './schemas.ts';

/**
 * HTTP API contract (W1b). Every request body / params / query is validated
 * with one of these schemas; response schemas double as the client contract.
 * Import via '@bootquest/shared/api'.
 */

// ---------------------------------------------------------------- errors

export const API_ERROR_CODES = [
  'VALIDATION',
  'BAD_JSON',
  'PAYLOAD_TOO_LARGE',
  'NOT_FOUND',
  'NO_CHECK',
  'RUNNER_UNAVAILABLE',
  'NO_SOLUTION',
  'NOT_REVEALED',
  'TRACK_LOCKED',
  /** quiz / predict-output: free runs would be an answer oracle — submit only */
  'RUN_NOT_AVAILABLE',
  /** review grade on a card that is not due yet */
  'NOT_DUE',
  /** endpoint not valid for this unit's kind (e.g. self-attest on a non-reading unit) */
  'WRONG_UNIT_KIND',
  /** reading self-attest is once per unit */
  'ALREADY_ATTESTED',
  'INTERNAL',
] as const;
export const ApiErrorCode = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiErrorBody = z
  .object({
    error: z
      .object({
        code: ApiErrorCode,
        message: z.string(),
        issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
      })
      .strict(),
  })
  .strict();
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

// ---------------------------------------------------------------- request schemas

const positiveIdString = z
  .string()
  .regex(/^[1-9]\d{0,14}$/, 'must be a positive integer id')
  .transform(Number);

export const UnitIdParams = z.object({ id: positiveIdString }).strict();
export const TrackIdParams = z.object({ id: TrackId }).strict();
export const ReviewItemParams = z.object({ itemId: positiveIdString }).strict();

/** Routes without query parameters reject any query string (no silent ignores). */
export const EmptyQuery = z.object({}).strict();
export const EmptyBody = z.object({}).strict();

export const ReviewQueueQuery = z
  .object({
    limit: z
      .string()
      .regex(/^\d{1,4}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(1000))
      .optional(),
  })
  .strict();

export const MAX_CODE_CHARS = 100_000;
export const MAX_ANSWER_CHARS = 10_000;

/**
 * Body of POST /api/units/:id/run and /submit. Exactly one of:
 *  - `code`   for drill-js (learner source)
 *  - `answer` for quiz (choice index or exact text) / predict-output (predicted stdout)
 * `selfAssisted` is the honor-system "I had help" flag (submit only; ignored by run).
 */
export const SubmissionBody = z
  .object({
    code: z.string().max(MAX_CODE_CHARS).optional(),
    answer: z.union([z.string().max(MAX_ANSWER_CHARS), z.number().int().nonnegative()]).optional(),
    selfAssisted: z.boolean().default(false),
  })
  .strict()
  .refine((b) => (b.code === undefined) !== (b.answer === undefined), {
    message: 'provide exactly one of `code` or `answer`',
  });
export type SubmissionBody = z.infer<typeof SubmissionBody>;
export type SubmissionBodyInput = z.input<typeof SubmissionBody>;

export const GradeBody = z.object({ grade: ReviewGrade }).strict();
export type GradeBody = z.infer<typeof GradeBody>;

// ---------------------------------------------------------------- check-spec public/private split

/**
 * The public/private split of a check spec. check.spec JSON in the DB is the
 * FULL (private) spec; the API only ever serializes `toPublicCheck(spec)`,
 * which is a WHITELIST projection: a field reaches the client only if it is
 * listed here. Everything else is private by default, notably:
 *   drill-js       tests[].code, tests[].input   (test bodies encode expected values)
 *   quiz           answerKey
 *   predict-output expected
 *   drill-cs       testFile
 *   http           requests[].expect, body, headers
 *   node-test-file checkPath, checkSha256
 *   self-run       fixtures
 *   vitest-project testFile, env
 * Reference solutions are never part of check.spec at all: they live in the
 * content store (seed output under content/) and are served only by
 * POST /api/units/:id/reveal after the reveal attempt row is written.
 */
export const PUBLIC_CHECK_FIELDS: Readonly<Record<CheckTypeT, readonly string[]>> = {
  'drill-js': ['type', 'language', 'tests', 'timeoutMs'],
  'drill-cs': ['type', 'shape', 'timeoutMs'],
  quiz: ['type', 'itemKey', 'grading', 'choices'],
  'predict-output': ['type', 'language', 'normalize'],
  'guided-step': ['type', 'step', 'runner', 'timeoutMs'],
  http: ['type', 'port', 'requests', 'timeoutMs'],
  repo: ['type', 'predicates'],
  'study-quiz': ['type', 'itemKeys', 'passPct'],
  'explain-back': ['type', 'questionSetKey', 'questionCount', 'minCoverage'],
  'patch-kata': ['type', 'kataKey', 'defectCount'],
  review: ['type', 'cardKey'],
  'node-test-file': ['type', 'learnerPath', 'sha', 'tsx', 'timeoutMs'],
  'self-run': ['type', 'language', 'file', 'tsc', 'inverted', 'timeoutMs'],
  'vitest-project': ['type', 'project', 'timeoutMs'],
};

/** Field names that must never appear anywhere in a serialized public payload. */
export const PRIVATE_FIELD_NAMES: readonly string[] = [
  'answerKey',
  'expected',
  'solution',
  'reference',
  'referenceSolution',
  'code',
  'expect',
  'testFile',
  'checkPath',
  'checkSha256',
  'fixtures',
  'env',
];

/** Per-type projection of nested public fields (arrays of objects get their own whitelist). */
function projectNested(type: CheckTypeT, key: string, value: unknown): unknown {
  if (type === 'drill-js' && key === 'tests' && Array.isArray(value)) {
    return value.map((t: { name: string }) => ({ name: t.name }));
  }
  if (type === 'http' && key === 'requests' && Array.isArray(value)) {
    return value.map((r: { method: string; path: string }) => ({ method: r.method, path: r.path }));
  }
  return value;
}

/** Whitelist projection of a full check spec to its public part. */
export function toPublicCheck(spec: CheckSpec): PublicCheck {
  const type = spec.type;
  const allowed = PUBLIC_CHECK_FIELDS[type];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = (spec as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = projectNested(type, key, value);
  }
  return PublicCheck.parse(out);
}

/** Public check: strict per-type shapes — parsing fails if a private key slips in. */
export const PublicCheck = z.discriminatedUnion('type', [
  z.object({ type: z.literal('drill-js'), language: z.enum(['js', 'ts', 'sql']), tests: z.array(z.object({ name: z.string() }).strict()), timeoutMs: z.number() }).strict(),
  z.object({ type: z.literal('drill-cs'), shape: z.enum(['console', 'xunit']), timeoutMs: z.number() }).strict(),
  z.object({ type: z.literal('quiz'), itemKey: z.string(), grading: z.enum(['exact', 'choice', 'self']), choices: z.array(z.string()).optional() }).strict(),
  z.object({ type: z.literal('predict-output'), language: z.enum(['js', 'ts', 'cs']), normalize: z.boolean() }).strict(),
  z.object({ type: z.literal('guided-step'), step: z.number(), runner: z.string(), timeoutMs: z.number() }).strict(),
  z.object({ type: z.literal('http'), port: z.number().optional(), requests: z.array(z.object({ method: z.string(), path: z.string() }).strict()), timeoutMs: z.number() }).strict(),
  z.object({ type: z.literal('repo'), predicates: z.array(z.record(z.unknown())) }).strict(),
  z.object({ type: z.literal('study-quiz'), itemKeys: z.array(z.string()), passPct: z.number() }).strict(),
  z.object({ type: z.literal('explain-back'), questionSetKey: z.string(), questionCount: z.number(), minCoverage: z.number() }).strict(),
  z.object({ type: z.literal('patch-kata'), kataKey: z.string(), defectCount: z.number() }).strict(),
  z.object({ type: z.literal('review'), cardKey: z.string() }).strict(),
  z.object({ type: z.literal('node-test-file'), learnerPath: z.string(), sha: z.string(), tsx: z.boolean(), timeoutMs: z.number() }).strict(),
  z.object({ type: z.literal('self-run'), language: z.enum(['js', 'ts', 'cs']), file: z.string(), tsc: z.boolean(), inverted: z.boolean(), timeoutMs: z.number() }).strict(),
  z.object({ type: z.literal('vitest-project'), project: z.string(), timeoutMs: z.number() }).strict(),
]);
export type PublicCheck = z.infer<typeof PublicCheck>;

// ---------------------------------------------------------------- unit content store (seed output)

/**
 * Per-unit content that lives in content/ (never in the DB): starter code is
 * public, the reference solution is private (served only after reveal).
 * File format: { "<unit key>": { "starter"?: string, "solution"?: string } }.
 */
export const UnitContentEntry = z.object({ starter: z.string().optional(), solution: z.string().optional() }).strict();
export const UnitContentFile = z.record(z.string().min(1), UnitContentEntry);
export type UnitContentEntry = z.infer<typeof UnitContentEntry>;

// ---------------------------------------------------------------- response schemas

export const CanonicalRunResult = z
  .object({
    pass: z.boolean(),
    output: z.string(),
    failures: z.array(RunnerFailure),
    durationMs: z.number().nonnegative(),
  })
  .strict();
export type CanonicalRunResult = z.infer<typeof CanonicalRunResult>;

export const HealthResponse = z
  .object({ ok: z.literal(true), version: z.string(), counts: z.object({ units: z.number(), checks: z.number() }).strict() })
  .strict();

export const UnitLockState = z.enum(['locked', 'available', 'done']);
export type UnitLockState = z.infer<typeof UnitLockState>;

export const UnitSummary = z
  .object({
    id: z.number(),
    key: z.string(),
    trackId: TrackId,
    kind: UnitKind,
    title: z.string(),
    difficulty: z.number().nullable(),
    state: UnitLockState,
    revealed: z.boolean(),
    prerequisites: z.array(z.number()),
  })
  .strict();
export type UnitSummary = z.infer<typeof UnitSummary>;

export const TrackSummary = z
  .object({ id: TrackId, name: z.string(), locked: z.boolean(), unitCount: z.number(), doneCount: z.number() })
  .strict();

export const TracksResponse = z.object({ tracks: z.array(TrackSummary) }).strict();
export const TrackUnitsResponse = z.object({ track: TrackSummary, units: z.array(UnitSummary) }).strict();

export const UnitDetailResponse = z
  .object({
    unit: UnitSummary.extend({ code: z.string().nullable(), competencies: z.array(CompetencyId), variationOfUnitId: z.number().nullable() }).strict(),
    check: z.object({ id: z.number(), threshold: z.number().nullable(), spec: PublicCheck }).strict().nullable(),
    starter: z.string().nullable(),
  })
  .strict();
export type UnitDetailResponse = z.infer<typeof UnitDetailResponse>;

export const RunResponse = z.object({ result: CanonicalRunResult }).strict();

export const XpOutcome = z.object({ id: z.number(), amount: z.number(), reason: XpZeroReason.nullable() }).strict();

export const SubmitResponse = z
  .object({
    result: CanonicalRunResult,
    verdict: RunVerdict,
    attempt: z.object({ id: z.number(), mode: z.enum(['solo', 'assisted', 'guided']), outcome: z.string() }).strict(),
    runId: z.number(),
    /** null when the submit failed (failed submits cost nothing and earn nothing) */
    xp: XpOutcome.nullable(),
    evidenceIds: z.array(z.number()),
  })
  .strict();
export type SubmitResponse = z.infer<typeof SubmitResponse>;

export const RevealResponse = z
  .object({
    attemptId: z.number(),
    variationUnitId: z.number().nullable(),
    solution: z.union([
      z.object({ kind: z.literal('code'), code: z.string() }).strict(),
      z.object({ kind: z.literal('answer'), answer: z.union([z.string(), z.number()]), choice: z.string().nullable() }).strict(),
      z.object({ kind: z.literal('output'), expected: z.string() }).strict(),
    ]),
  })
  .strict();
export type RevealResponse = z.infer<typeof RevealResponse>;

export const ReviewQueueItem = z
  .object({
    id: z.number(),
    cardKey: z.string(),
    kind: z.enum(['card', 'finding', 'quiz-miss', 'concept']),
    unitId: z.number().nullable(),
    competencyId: CompetencyId.nullable(),
    dueAt: z.number(),
  })
  .strict();
export const ReviewQueueResponse = z.object({ count: z.number(), items: z.array(ReviewQueueItem) }).strict();

/** POST /api/units/:id/self-attest — reading units only, once per unit, 5 XP (spec §6.1). */
export const SelfAttestResponse = z
  .object({ attemptId: z.number(), xp: XpOutcome })
  .strict();
export type SelfAttestResponse = z.infer<typeof SelfAttestResponse>;

export const GradeResponse = z
  .object({
    itemId: z.number(),
    grade: ReviewGrade,
    prevDueAt: z.number(),
    nextDueAt: z.number(),
    xp: XpOutcome,
    demotion: z.object({ competency: CompetencyId, from: z.number(), to: z.number(), evidenceId: z.number() }).strict().nullable(),
    remainingDue: z.number(),
  })
  .strict();

export const SlateItemDto = z
  .object({ slot: z.string(), kind: z.enum(['drill-set', 'campaign-step', 'review-clear']), track: z.string().optional(), size: z.number().optional(), done: z.boolean() })
  .strict();

export const DashboardResponse = z
  .object({
    today: z.string(),
    streak: z.object({ current: z.number(), longest: z.number(), tokens: z.number(), slateDaysBanked: z.number(), todayComplete: z.boolean() }).strict(),
    heatmap: z.array(z.object({ day: z.string(), xp: z.number(), status: z.enum(['open', 'slate', 'partial', 'frozen', 'missed', 'none']) }).strict()),
    xp: z.object({ total: z.number(), level: z.number(), intoLevel: z.number(), levelSpan: z.number(), nextAt: z.number() }).strict(),
    competencies: z.array(
      z
        .object({
          id: CompetencyId,
          name: z.string(),
          rating: z.number(),
          lastEvidence: z.object({ id: z.number(), kind: z.string(), createdAt: z.number() }).strict().nullable(),
        })
        .strict(),
    ),
    slate: z.object({ day: z.string(), status: z.string(), items: z.array(SlateItemDto) }).strict(),
    reviewQueue: z.object({ due: z.number() }).strict(),
    nextUp: z.array(
      z
        .object({ trackId: TrackId, unit: z.object({ id: z.number(), key: z.string(), title: z.string(), kind: UnitKind }).strict().nullable() })
        .strict(),
    ),
  })
  .strict();
export type DashboardResponse = z.infer<typeof DashboardResponse>;
