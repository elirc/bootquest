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
  /** written units: the model answer is shown only after the learner's own answer is recorded */
  'NOT_ANSWERED',
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

/**
 * A unit key as stored in unit.key: `<source>/<course>/...` for pack units
 * (e.g. bootforge/js-fundamentals/values/variables/swap), `<ns>:<name>` for
 * fixtures. Sent URL-encoded as ONE path segment:
 * GET /api/units/by-key/bootforge%2Fjs-fundamentals%2F...
 */
export const UNIT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+/-]{0,299}$/;
export const UnitKey = z
  .string()
  .regex(UNIT_KEY_RE, 'must be a unit key like <source>/<course>/<...> (letters, digits, . _ : @ + / -; max 300)')
  .refine((k) => !k.includes('//') && !k.split('/').includes('..') && !k.endsWith('/'), { message: 'must not contain empty or .. segments' });
export const UnitKeyParams = z.object({ key: UnitKey }).strict();
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

export const MAX_REPO_PATH_CHARS = 1024;

/**
 * Body of POST /api/units/:id/run and /submit. Exactly one of:
 *  - `code`     for drill-js / drill-cs (learner source)
 *  - `answer`   for quiz (choice index or exact text) / predict-output (predicted stdout)
 *  - `port`     for http checks: the loopback port the learner's server listens on
 *               (the server only ever targets 127.0.0.1 / ::1 — nothing else is caller-supplied)
 *  - `repoPath` for repo checks: ABSOLUTE path of a local git working tree (its root,
 *               holding .git) on the server's machine
 * `selfAssisted` is the honor-system "I had help" flag (submit only; ignored by run).
 */
export const SubmissionBody = z
  .object({
    code: z.string().max(MAX_CODE_CHARS).optional(),
    answer: z.union([z.string().max(MAX_ANSWER_CHARS), z.number().int().nonnegative()]).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    repoPath: z
      .string()
      .min(1)
      .max(MAX_REPO_PATH_CHARS)
      .refine((p) => !/[\0\r\n]/.test(p), { message: 'must not contain NUL or newlines' })
      .optional(),
    selfAssisted: z.boolean().default(false),
  })
  .strict()
  .refine((b) => [b.code, b.answer, b.port, b.repoPath].filter((v) => v !== undefined).length === 1, {
    message: 'provide exactly one of `code`, `answer`, `port` or `repoPath`',
  });
export type SubmissionBody = z.infer<typeof SubmissionBody>;
export type SubmissionBodyInput = z.input<typeof SubmissionBody>;

export const MAX_WRITTEN_ANSWER_CHARS = 20_000;

/**
 * Body of POST /api/units/:id/answer (written units only): the learner's own
 * answer, stored immutably as an ungraded 'submitted' attempt BEFORE the model
 * answer can be read (the explain-back answer-first pattern, spec §4).
 */
export const WrittenAnswerBody = z
  .object({
    answer: z
      .string()
      .max(MAX_WRITTEN_ANSWER_CHARS)
      .refine((a) => a.trim().length > 0, { message: 'answer must not be empty' }),
    selfAssisted: z.boolean().default(false),
  })
  .strict();
export type WrittenAnswerBody = z.infer<typeof WrittenAnswerBody>;

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
 *   drill-cs       files (tests block + types tail)
 *   http           requests[].expect, body, headers (public: name, method, path)
 *   repo           predicates[].branch / path / n / pattern / heading (public: kind, name)
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
  repo: ['type', 'predicates', 'timeoutMs'],
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
  'body',
  'headers',
  'jsonShape',
  'branch',
  'pattern',
  'heading',
];

/**
 * DEEP whitelist: for every public top-level field whose value holds objects
 * (an object, or an array of objects), the nested keys that may be serialized.
 * A public field holding objects that is NOT listed here makes toPublicCheck
 * throw — nested objects never pass through whole (W1b review: repo.predicates
 * used to). Arrays/values of primitives (e.g. quiz choices) need no entry.
 */
export const PUBLIC_NESTED_FIELDS: Readonly<Partial<Record<CheckTypeT, Readonly<Record<string, readonly string[]>>>>> = {
  'drill-js': { tests: ['name'] },
  http: { requests: ['name', 'method', 'path'] },
  // W3c: predicate NAMES only (the learner-facing task list); branch names,
  // paths, counts, patterns and headings are the grading data -> private
  repo: { predicates: ['kind', 'name'] },
};

export class PublicProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicProjectionError';
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function pickNested(type: CheckTypeT, key: string, obj: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    const v = obj[k];
    if (v === undefined) continue;
    if (typeof v === 'object' && v !== null) {
      // whitelisted nested fields must themselves be primitives (one level deep, by design)
      throw new PublicProjectionError(`${type}.${key}[].${k} holds an object; extend PUBLIC_NESTED_FIELDS deliberately`);
    }
    out[k] = v;
  }
  return out;
}

/** Per-type projection of a public field: objects keep ONLY their whitelisted nested keys. */
function projectNested(type: CheckTypeT, key: string, value: unknown): unknown {
  const nested = PUBLIC_NESTED_FIELDS[type]?.[key];
  if (Array.isArray(value)) {
    const hasObjects = value.some((v) => typeof v === 'object' && v !== null);
    if (!hasObjects) return value;
    if (!nested) throw new PublicProjectionError(`${type}.${key} holds objects but has no nested whitelist`);
    return value.map((v) => {
      if (!isPlainObject(v)) throw new PublicProjectionError(`${type}.${key}[] mixes objects and non-objects`);
      return pickNested(type, key, v, nested);
    });
  }
  if (isPlainObject(value)) {
    if (!nested) throw new PublicProjectionError(`${type}.${key} is an object but has no nested whitelist`);
    return pickNested(type, key, value, nested);
  }
  return value;
}

/** Whitelist projection (deep) of a full check spec to its public part. */
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

const PublicRepoPredicate = z
  .object({
    kind: z.enum(['branch-exists', 'head-on-branch', 'file-exists-at-head', 'clean-worktree', 'min-commits', 'commit-message-matches', 'ci-green', 'pr-has-section']),
    name: z.string(),
  })
  .strict();

/** Public check: strict per-type shapes — parsing fails if a private key slips in. */
export const PublicCheck = z.discriminatedUnion('type', [
  z.object({ type: z.literal('drill-js'), language: z.enum(['js', 'ts', 'sql']), tests: z.array(z.object({ name: z.string() }).strict()), timeoutMs: z.number() }).strict(),
  z.object({ type: z.literal('drill-cs'), shape: z.enum(['console-check', 'xunit']), timeoutMs: z.number() }).strict(),
  z.object({ type: z.literal('quiz'), itemKey: z.string(), grading: z.enum(['exact', 'choice', 'self']), choices: z.array(z.string()).optional() }).strict(),
  z.object({ type: z.literal('predict-output'), language: z.enum(['js', 'ts', 'cs']), normalize: z.boolean() }).strict(),
  z.object({ type: z.literal('guided-step'), step: z.number(), runner: z.string(), timeoutMs: z.number() }).strict(),
  z.object({ type: z.literal('http'), port: z.number().optional(), requests: z.array(z.object({ name: z.string(), method: z.string(), path: z.string() }).strict()), timeoutMs: z.number() }).strict(),
  z.object({ type: z.literal('repo'), predicates: z.array(PublicRepoPredicate), timeoutMs: z.number() }).strict(),
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
 * Per-unit content that lives in content/ (seed output / imported packs, never
 * in the DB). Visibility per field:
 *   PUBLIC  instructions  markdown task statement (BootForge `prompt`; for a
 *                         quiz this IS the question — its choices are in the
 *                         public check spec)
 *           starter       scaffold code
 *           snippet       predict-output: the code the learner reads
 *           rubric        written: self-assessment rubric items
 *   PRIVATE solution      reference solution / model answer (reveal only)
 *           explanation   post-solve explanation (not served yet)
 *           hints         progressive hints (not served yet)
 * Grading data (drill tests, quiz answerKey, predict expected) is NOT here: it
 * lives in the check spec, private by the toPublicCheck whitelist.
 * File format: { "<unit key>": UnitContentEntry }.
 */
export const UnitContentEntry = z
  .object({
    instructions: z.string().optional(),
    starter: z.string().optional(),
    snippet: z.string().optional(),
    rubric: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) }).strict()).optional(),
    solution: z.string().optional(),
    explanation: z.string().optional(),
    hints: z.array(z.string()).optional(),
  })
  .strict();
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
    /** public markdown task statement (quiz: the question) — null when the unit has none */
    instructions: z.string().nullable(),
    starter: z.string().nullable(),
    /** predict-output: the code to read and predict */
    snippet: z.string().nullable(),
    /** written units: self-assessment rubric */
    rubric: z.array(z.object({ id: z.string(), label: z.string() }).strict()).nullable(),
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

/** POST /api/units/:id/answer — the recorded (ungraded, no XP) answer attempt. */
export const WrittenAnswerResponse = z
  .object({
    attemptId: z.number(),
    mode: z.enum(['solo', 'assisted', 'guided']),
    outcome: z.literal('submitted'),
  })
  .strict();
export type WrittenAnswerResponse = z.infer<typeof WrittenAnswerResponse>;

/**
 * GET /api/units/:id/model-answer — 403 NOT_ANSWERED until a non-empty answer
 * attempt is recorded for the written unit; `attemptId` is that first answer.
 */
export const ModelAnswerResponse = z
  .object({
    attemptId: z.number(),
    modelAnswer: z.string(),
    rubric: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
  })
  .strict();
export type ModelAnswerResponse = z.infer<typeof ModelAnswerResponse>;

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
