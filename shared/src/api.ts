import { z } from 'zod';
import type { CheckSpec } from './check.ts';
import { Assessor, Assistance, CheckType, CompetencyId, EvidenceKind, ReviewGrade, RunVerdict, TrackId, UnitKind, XpZeroReason, type CheckType as CheckTypeT } from './enums.ts';
import { MUTATION_TOOLS } from './mutation.ts';
import { RunnerFailure } from './schemas.ts';
import { RefLink } from './sync.ts';

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
  /** the unit belongs to a campaign quest whose act is not unlocked yet (W5b) */
  'ACT_LOCKED',
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
  /** node-test-file: the pinned check file is missing from the cache or fails its hash pin; nothing ran, nothing recorded */
  'CHECK_INTEGRITY',
  /** GET /refs/:id/content on a ref that is not renderable markdown (or is quarantined) */
  'NOT_RENDERABLE',
  /** the bytes are not cached and the network is unavailable (offline mode or fetch failure) */
  'UNAVAILABLE_OFFLINE',
  /** sync / ref rendering is not configured on this server */
  'SYNC_UNAVAILABLE',
  /** a sync is already running on this server */
  'SYNC_IN_PROGRESS',
  /** W6 explain-back / kata: the immutable answer for this unit is already recorded (append-only, never re-answered) */
  'ALREADY_ANSWERED',
  /** W6 explain-back / kata: this answer attempt already carries its self-score evidence */
  'ALREADY_SCORED',
  /** W6: the self-score was filed outside the same-sitting window (24h after the answer) */
  'SCORE_WINDOW_CLOSED',
  /** W6: the unit's seeded content (question set / kata) is not loaded on this server */
  'CONTENT_PENDING',
  /** W6: the action needs a verified (passing, run-backed) attempt that does not exist */
  'NOT_VERIFIED',
  /** W6 mutation gate: a file is under the per-file floor or the total under the break */
  'MUTATION_BELOW_THRESHOLD',
  /** W7: the seed item this answer was recorded against has been re-seeded since (stored item hash differs) */
  'CONTENT_CHANGED',
  /** W7: a changed-example retest unit is closed until one of its schedules is due (no free pre-solving runs) */
  'RETEST_NOT_OPEN',
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
/** W8: a study-quest quiz gate is answered as one full set (one answer per question, in order) */
export const MAX_STUDY_QUIZ_ANSWERS = 200;

/**
 * Body of POST /api/units/:id/run and /submit. Exactly one of:
 *  - `code`     for drill-js / drill-cs (learner source)
 *  - `answer`   for quiz (choice index or exact text) / predict-output (predicted stdout)
 *  - `answers`  for study-quiz (W8): the FULL answer set, one choice index per question in
 *               the order GET /units/:id serves them (submit only; graded server-side, >= 80%)
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
    answers: z
      .array(z.union([z.number().int().nonnegative(), z.string().max(MAX_ANSWER_CHARS)]))
      .min(1)
      .max(MAX_STUDY_QUIZ_ANSWERS)
      .optional(),
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
  .refine((b) => [b.code, b.answer, b.answers, b.port, b.repoPath].filter((v) => v !== undefined).length === 1, {
    message: 'provide exactly one of `code`, `answer`, `answers`, `port` or `repoPath`',
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
 *   predict-output expected, runAs, keyTokens
 *   drill-cs       files (tests block + types tail)
 *   http           requests[].expect, body, headers (public: name, method, path)
 *   repo           predicates[].branch / path / n / pattern / heading (public: kind, name)
 *   node-test-file checkPath, checkSha256
 *   self-run       fixtures, files (protected tests block, fixture bytes, frozen scaffolding)
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
  // W7 (audit #9): the defect COUNT is not public before the findings are recorded (blind review)
  'patch-kata': ['type', 'kataKey'],
  review: ['type', 'cardKey'],
  'node-test-file': ['type', 'learnerPath', 'sha', 'tsx', 'tscProject', 'timeoutMs'],
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
  z.object({ type: z.literal('patch-kata'), kataKey: z.string() }).strict(),
  z.object({ type: z.literal('review'), cardKey: z.string() }).strict(),
  z.object({ type: z.literal('node-test-file'), learnerPath: z.string(), sha: z.string(), tsx: z.boolean(), tscProject: z.string().optional(), timeoutMs: z.number() }).strict(),
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

/**
 * Campaign 2 B2 (ui-audit #26): ONE server-owned definition of "how far along is this track",
 * shared by the sidebar, the campaign page and the stats page so they can never disagree.
 *   basis 'campaign-core': the track has campaign core quests -> pct = floor(coreDone / coreTotal * 100)
 *                          (the same per-act core counts the campaign map shows, summed over every act;
 *                          content-pending core quests stay in the total: they are not done);
 *   basis 'practice':      no campaign core quests -> pct = floor(practiceDone / practiceTotal * 100)
 *                          (practice = the track's live non-campaign units: doneCount / unitCount);
 *   basis 'none':          locked track, or nothing to count -> pct 0.
 * Floored, so 100 means every counted item is done (99.6% never shows as 100%).
 */
export const TrackProgress = z
  .object({
    pct: z.number().int().min(0).max(100),
    basis: z.enum(['campaign-core', 'practice', 'none']),
    coreDone: z.number().int().min(0),
    coreTotal: z.number().int().min(0),
    practiceDone: z.number().int().min(0),
    practiceTotal: z.number().int().min(0),
  })
  .strict();
export type TrackProgress = z.infer<typeof TrackProgress>;

export const TrackSummary = z
  .object({ id: TrackId, name: z.string(), locked: z.boolean(), unitCount: z.number(), doneCount: z.number(), progress: TrackProgress })
  .strict();

export const TracksResponse = z.object({ tracks: z.array(TrackSummary) }).strict();
export const TrackUnitsResponse = z.object({ track: TrackSummary, units: z.array(UnitSummary) }).strict();

// ---------------------------------------------------------------- W6 competency ladder: public halves

export const ExplainBackPublic = z
  .object({
    questions: z.array(z.object({ prompt: z.string() }).strict()),
    /** promotion leg (b) threshold, percent (engine PROMOTION_MIN_COVERAGE) */
    minCoveragePct: z.number(),
    /**
     * W9 (ui-audit #10): whether the learner's immutable answer row already exists (so
     * GET .../key will succeed). Lets the client skip the on-mount key probe instead of
     * eating an expected 403; absent on older servers (the client then probes as before).
     */
    answered: z.boolean().optional(),
  })
  .strict();
export type ExplainBackPublic = z.infer<typeof ExplainBackPublic>;

export const KataPublic = z
  .object({
    title: z.string(),
    diff: z.string(),
    contextFiles: z.array(z.object({ path: z.string(), content: z.string() }).strict()),
    // W7 (audit #9): no defect count here — "there are exactly N defects" is a search hint; the
    // count arrives with the key, after the findings are recorded
    /** W9 (ui-audit #10): findings already recorded (key readable) — see ExplainBackPublic.answered */
    answered: z.boolean().optional(),
  })
  .strict();
export type KataPublic = z.infer<typeof KataPublic>;

/**
 * W8 study-quest units (spec §4 "Study quest"): the PUBLIC half of the unit's seeded quest
 * pack — the ordered reading list (with a link into the repo at the pack's pinned sha) and
 * the quiz-gate questions with their choices. Answer keys, explanations and flashcard text
 * never appear here: a missed question's key arrives only as an FSRS review card (due the
 * next day), never in the submit response.
 */
export const StudyQuestReadingStepDto = z
  .object({
    key: z.string(),
    title: z.string(),
    headingPath: z.array(z.string()),
    path: z.string(),
    lines: z.object({ start: z.number(), end: z.number() }).strict(),
    /** https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<start>-L<end> */
    url: z.string(),
  })
  .strict();
export const StudyQuestQuestionDto = z
  .object({
    itemKey: z.string(),
    prompt: z.string(),
    choices: z.array(z.string()),
  })
  .strict();
export const StudyQuestPublic = z
  .object({
    repo: z.string(),
    sha: z.string(),
    /** pass mark, percent (spec §4: 80) */
    passPct: z.number(),
    readingSteps: z.array(StudyQuestReadingStepDto),
    questions: z.array(StudyQuestQuestionDto),
    /** flashcards this quest enrolls into the FSRS queue on its first pass (count only) */
    flashcards: z.number(),
  })
  .strict();
export type StudyQuestPublic = z.infer<typeof StudyQuestPublic>;

/** W8: the per-question outcome of a study-quiz submit. NO key, NO correct choice — right/wrong only. */
export const StudyQuizOutcome = z
  .object({
    correct: z.number(),
    total: z.number(),
    /** correct / total, 0..1 */
    score: z.number(),
    passPct: z.number(),
    passed: z.boolean(),
    items: z.array(z.object({ itemKey: z.string(), correct: z.boolean() }).strict()),
    /** misses become FSRS cards (front = question, back = keyed answer + citation), due the next day; deduped */
    reviewCards: z.object({ created: z.number(), alreadyQueued: z.number(), dueAt: z.number().nullable() }).strict(),
    /** flashcards enrolled into the FSRS queue by this submit (first pass only) */
    flashcardsEnrolled: z.number(),
  })
  .strict();
export type StudyQuizOutcome = z.infer<typeof StudyQuizOutcome>;

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
    /** W4: GitHub content_refs this unit renders from (program milestone, lesson guide); optional for older clients */
    refs: z.array(RefLink).optional(),
    /**
     * W6 explain-back units: the QUESTIONS only (never key points - those arrive from
     * GET /units/:id/explain-back/key after the immutable answer row exists). null when the
     * question set is not loaded (content pending); absent on other unit kinds.
     */
    explainBack: ExplainBackPublic.nullable().optional(),
    /** W6 patch-kata units: diff + context only (never the seeded-defect key); null = content pending */
    kata: KataPublic.nullable().optional(),
    /** W8 study-quest units: reading list + quiz-gate questions (public half); null = content pending */
    studyQuest: StudyQuestPublic.nullable().optional(),
    /**
     * W7 (audit #1) retest units only: whether the changed-example retest is open. Closed =
     * instructions / starter / snippet withheld and run/submit refused (409 RETEST_NOT_OPEN),
     * so the >= 2-day delay measures retention, not a pasted day-0 solution.
     *   due          a retest schedule for this unit is due (the real leg (c) path)
     *   practice     the artifact's solution was revealed: guided practice only, never a leg
     *   not-scheduled no schedule exists (pass the artifact + its explain-back >= 80% first)
     *   not-due      a schedule exists and opens at opensAt
     */
    retestGate: z
      .object({ open: z.boolean(), reason: z.enum(['due', 'practice', 'not-scheduled', 'not-due']), opensAt: z.number().nullable() })
      .strict()
      .optional(),
    /**
     * W9 (ui-audit #1) campaign-quest units only: present (locked: true) when every campaign
     * act holding this unit is still locked. A locked unit's detail withholds EVERYTHING
     * playable — check, instructions, starter, snippet, studyQuest / explainBack / kata and
     * refs — so a direct URL can neither read nor pre-solve locked-act content; run / submit
     * and the other write routes refuse with 403 ACT_LOCKED either way.
     */
    actGate: z.object({ locked: z.literal(true) }).strict().optional(),
    /**
     * Program units (gh:<repo>:UNN) only: acceptance legs the recorded check table
     * declares its machine check deliberately does NOT cover (the honest carve-out
     * from content/sync/check-specs.json `uncovered_legs`). Present only when
     * non-empty; absent on every other unit kind and on older servers.
     */
    uncoveredLegs: z.array(z.string()).optional(),
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
    /** W6: competencies this submit promoted (a passing retest can complete leg (c)); optional for older servers */
    promotions: z.array(z.lazy(() => RatingChangeDto)).optional(),
    /** W8: study-quiz submits only — per-question right/wrong (no keys) + the review cards the misses became */
    studyQuiz: StudyQuizOutcome.optional(),
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
    /**
     * W8: the card text for seeded cards (study-quest quiz misses and flashcards), resolved
     * server-side from the stamped quest pack; absent for cards whose text is not served.
     * Only DUE cards are listed, so a missed question's key is never shown the day it was missed.
     */
    card: z.object({ front: z.string(), back: z.string(), source: z.string().nullable() }).strict().optional(),
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
          /** W6: the three-leg promotion progress from the engine's evaluator (optional for older servers) */
          promotion: z.lazy(() => PromotionProgress).optional(),
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

// ---------------------------------------------------------------- W6 competency ladder

export const RatingChangeDto = z.object({ competency: CompetencyId, from: z.number(), to: z.number(), evidenceId: z.number() }).strict();
export type RatingChangeDto = z.infer<typeof RatingChangeDto>;

const nonBlank = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => s.trim().length > 0, { message: 'must not be empty' });

/** Spec §4/§7: an explain-back set is exactly three questions. */
export const EXPLAIN_BACK_QUESTION_COUNT = 3;
export const MAX_EXPLAIN_ANSWER_CHARS = 10_000;

/**
 * POST /api/units/:id/explain-back/answers: the learner's three answers, written with the
 * code hidden, stored IMMUTABLY (append-only attempt) BEFORE any key point can be read.
 * A second answer on the same unit is refused (403 ALREADY_ANSWERED).
 */
export const ExplainBackAnswersBody = z
  .object({
    answers: z.array(nonBlank(MAX_EXPLAIN_ANSWER_CHARS)).length(EXPLAIN_BACK_QUESTION_COUNT),
    selfAssisted: z.boolean().default(false),
  })
  .strict();
export type ExplainBackAnswersBody = z.infer<typeof ExplainBackAnswersBody>;

/** Key point ids are positional: q<question>k<point>, 1-based (q1k1, q3k6). */
export const KEY_POINT_ID_RE = /^q[1-9]\d?k[1-9]\d?$/;
export const COVERAGE_MARKS = ['covered', 'missed'] as const;

/** POST /api/units/:id/explain-back/self-score: EVERY key point marked, nothing else. */
export const ExplainBackSelfScoreBody = z
  .object({ perKeyPoint: z.record(z.string().regex(KEY_POINT_ID_RE, 'key point id like q1k1'), z.enum(COVERAGE_MARKS)) })
  .strict();
export type ExplainBackSelfScoreBody = z.infer<typeof ExplainBackSelfScoreBody>;

export const AnswerRecordedResponse = z
  .object({ attemptId: z.number(), mode: z.enum(['solo', 'assisted', 'guided']), outcome: z.literal('submitted') })
  .strict();
export type AnswerRecordedResponse = z.infer<typeof AnswerRecordedResponse>;

export const KeyPointDto = z
  .object({
    id: z.string(),
    text: z.string(),
    /** the source sentence this key point quotes, when it quotes */
    quote: z.string().nullable(),
    /** or the repo file:line it cites */
    cite: z.object({ path: z.string(), lineStart: z.number(), lineEnd: z.number() }).strict().nullable(),
  })
  .strict();
export type KeyPointDto = z.infer<typeof KeyPointDto>;

export const SelfScoreSummary = z.object({ score: z.number(), evidenceIds: z.array(z.number()), at: z.number() }).strict();

/** GET /api/units/:id/explain-back/key: 403 NOT_ANSWERED until the answer row exists. */
export const ExplainBackKeyResponse = z
  .object({
    attemptId: z.number(),
    answeredAt: z.number(),
    /** the learner's own stored answers, verbatim */
    answers: z.array(z.string()),
    questions: z.array(z.object({ prompt: z.string(), keyPoints: z.array(KeyPointDto) }).strict()),
    /** null until self-scored */
    scored: SelfScoreSummary.nullable(),
  })
  .strict();
export type ExplainBackKeyResponse = z.infer<typeof ExplainBackKeyResponse>;

export const ScheduledRetestDto = z
  .object({ reviewItemId: z.number(), unitId: z.number(), title: z.string(), dueAt: z.number(), artifactUnitId: z.number() })
  .strict();
export type ScheduledRetestDto = z.infer<typeof ScheduledRetestDto>;

export const ExplainBackScoreResponse = z
  .object({
    attemptId: z.number(),
    covered: z.number(),
    total: z.number(),
    /** covered / total, 0..1 */
    coverage: z.number(),
    minCoveragePct: z.number(),
    passed: z.boolean(),
    missed: z.array(z.string()),
    evidenceIds: z.array(z.number()),
    xp: XpOutcome.nullable(),
    /** the changed-example retests this passing self-score scheduled (>= 2 days out) */
    retests: z.array(ScheduledRetestDto),
    promotions: z.array(RatingChangeDto),
  })
  .strict();
export type ExplainBackScoreResponse = z.infer<typeof ExplainBackScoreResponse>;

export const MAX_FINDINGS = 20;
export const MAX_FINDING_CHARS = 4_000;
export const KataFinding = z
  .object({ scenario: nonBlank(MAX_FINDING_CHARS), evidence: nonBlank(MAX_FINDING_CHARS), consequence: nonBlank(MAX_FINDING_CHARS) })
  .strict();
export type KataFinding = z.infer<typeof KataFinding>;

/** POST /api/units/:id/kata/findings: {scenario, evidence, consequence}[] stored immutably before the key. */
export const KataFindingsBody = z
  .object({ findings: z.array(KataFinding).min(1).max(MAX_FINDINGS), selfAssisted: z.boolean().default(false) })
  .strict();
export type KataFindingsBody = z.infer<typeof KataFindingsBody>;

export const DEFECT_ID_RE = /^d[1-9]\d?$/;
export const CATCH_MARKS = ['caught', 'missed'] as const;
export const KataSelfScoreBody = z
  .object({ perDefect: z.record(z.string().regex(DEFECT_ID_RE, 'defect id like d1'), z.enum(CATCH_MARKS)) })
  .strict();
export type KataSelfScoreBody = z.infer<typeof KataSelfScoreBody>;

export const KataDefectDto = z
  .object({
    id: z.string(),
    scenario: z.string(),
    evidence: z.object({ path: z.string(), lineStart: z.number(), lineEnd: z.number(), in: z.enum(['repo', 'patched']) }).strict(),
    consequence: z.string(),
  })
  .strict();
export type KataDefectDto = z.infer<typeof KataDefectDto>;

export const KataKeyResponse = z
  .object({
    attemptId: z.number(),
    answeredAt: z.number(),
    findings: z.array(KataFinding),
    defects: z.array(KataDefectDto),
    scored: SelfScoreSummary.nullable(),
  })
  .strict();
export type KataKeyResponse = z.infer<typeof KataKeyResponse>;

export const KataScoreResponse = z
  .object({
    attemptId: z.number(),
    caught: z.number(),
    total: z.number(),
    catchRate: z.number(),
    missed: z.array(z.string()),
    evidenceIds: z.array(z.number()),
    xp: XpOutcome.nullable(),
  })
  .strict();
export type KataScoreResponse = z.infer<typeof KataScoreResponse>;

/** G1 (spec §8): catch >= 8/10 seeded defects across the kata bank. */
export const G1_TARGET_RATE = 0.8;
export const G1_MIN_DEFECTS = 10;
export const KataStatsResponse = z
  .object({
    katasScored: z.number(),
    /** W7 (audit #2): scored katas NOT counted toward G1 because the answer was assisted / guided */
    assistedCount: z.number(),
    defectsCaught: z.number(),
    defectsTotal: z.number(),
    catchRate: z.number().nullable(),
    gate: z.object({ targetRate: z.number(), minDefects: z.number(), met: z.boolean(), rule: z.string() }).strict(),
  })
  .strict();
export type KataStatsResponse = z.infer<typeof KataStatsResponse>;

/**
 * GET /api/ladder (W7): every live competency-ladder unit the server derived from the stamped
 * seed packs (explain-back sets, G2 brief rubrics, the G1 kata bank, changed-example retests)
 * plus the authored agentic units (G3 / G4), each with its campaign link by repo (display only).
 */
export const LadderUnitDto = z
  .object({
    id: z.number(),
    key: z.string(),
    kind: UnitKind,
    family: z.enum(['explain-back', 'g2', 'kata', 'retest', 'study', 'authored']),
    trackId: TrackId,
    title: z.string(),
    difficulty: z.number().nullable(),
    repo: z.string().nullable(),
    quest: z.object({ id: z.number(), key: z.string(), track: TrackId, actNo: z.number() }).strict().nullable(),
    prerequisites: z.array(z.number()),
    variationOfUnitId: z.number().nullable(),
  })
  .strict();
export type LadderUnitDto = z.infer<typeof LadderUnitDto>;
export const LadderResponse = z
  .object({
    counts: z.object({ explainBack: z.number(), g2: z.number(), katas: z.number(), retests: z.number(), study: z.number(), authored: z.number() }).strict(),
    units: z.array(LadderUnitDto),
  })
  .strict();
export type LadderResponse = z.infer<typeof LadderResponse>;

export const MutationFileStatDto = z
  .object({
    path: z.string().min(1).max(500),
    killed: z.number().int().nonnegative(),
    timeout: z.number().int().nonnegative(),
    survived: z.number().int().nonnegative(),
    noCoverage: z.number().int().nonnegative(),
  })
  .strict();

/**
 * POST /api/units/:id/mutation: the "bootquest mutate" marker. Carries the per-file mutant
 * COUNTS parsed from Stryker's JSON report; the server re-evaluates the floor/break itself
 * (never the CLI's verdict) and records verified pipeline evidence linked to the unit's
 * latest verified-pass attempt (or attemptId, which must be one).
 */
export const MutationMarkerBody = z
  .object({
    attemptId: z.number().int().positive().optional(),
    tool: z.enum(MUTATION_TOOLS),
    toolVersion: z.string().min(1).max(40),
    durationMs: z.number().int().nonnegative(),
    files: z.array(MutationFileStatDto).min(1).max(5000),
  })
  .strict();
export type MutationMarkerBody = z.infer<typeof MutationMarkerBody>;

export const MutationVerdictDto = z
  .object({
    pass: z.boolean(),
    overallPct: z.number().nullable(),
    floorPct: z.number(),
    breakPct: z.number(),
    files: z.array(z.object({ path: z.string(), scorePct: z.number().nullable(), pass: z.boolean() }).strict()),
    failures: z.array(z.string()),
  })
  .strict();

export const MutationMarkerResponse = z
  .object({ unitId: z.number(), attemptId: z.number(), verdict: MutationVerdictDto, evidenceIds: z.array(z.number()) })
  .strict();
export type MutationMarkerResponse = z.infer<typeof MutationMarkerResponse>;

export const PROMOTION_LEG_STATES = ['done', 'pending', 'scheduled', 'failed'] as const;
export const PromotionLegState = z.enum(PROMOTION_LEG_STATES);
export type PromotionLegState = z.infer<typeof PromotionLegState>;

/** The three-leg promotion progress (spec §6.2), derived from evaluatePromotion; never stored. */
export const PromotionProgress = z
  .object({
    /** the rating a promotion would reach; null at the max (5) */
    targetRating: z.number().nullable(),
    eligible: z.boolean(),
    artifact: z.object({ state: PromotionLegState, evidenceId: z.number().nullable(), unitId: z.number().nullable() }).strict(),
    explainBack: z.object({ state: PromotionLegState, evidenceId: z.number().nullable(), coverage: z.number().nullable() }).strict(),
    retest: z
      .object({ state: PromotionLegState, evidenceId: z.number().nullable(), dueAt: z.number().nullable(), unitId: z.number().nullable() })
      .strict(),
    /** the engine's own reasons, verbatim */
    missing: z.array(z.string()),
  })
  .strict();
export type PromotionProgress = z.infer<typeof PromotionProgress>;

export const RetestListItemDto = ScheduledRetestDto.extend({ due: z.boolean() }).strict();
export type RetestListItemDto = z.infer<typeof RetestListItemDto>;

export const CompetenciesResponse = z
  .object({
    competencies: z.array(
      z
        .object({
          id: CompetencyId,
          name: z.string(),
          rating: z.number(),
          lastEvidence: z.object({ id: z.number(), kind: z.string(), createdAt: z.number() }).strict().nullable(),
          promotion: PromotionProgress,
        })
        .strict(),
    ),
    /** changed-example retests scheduled by explain-backs and not yet passed */
    retests: z.array(RetestListItemDto),
  })
  .strict();
export type CompetenciesResponse = z.infer<typeof CompetenciesResponse>;

export const EvidenceQuery = z
  .object({
    competency: CompetencyId.optional(),
    kind: EvidenceKind.optional(),
    limit: z
      .string()
      .regex(/^\d{1,4}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(1000))
      .optional(),
  })
  .strict();

export const EvidenceRowDto = z
  .object({
    id: z.number(),
    competency: CompetencyId,
    kind: EvidenceKind,
    intention: z.string(),
    observation: z.string(),
    assistance: Assistance,
    assessor: Assessor,
    rating: z.number().nullable(),
    verified: z.boolean(),
    score: z.number().nullable(),
    attemptId: z.number().nullable(),
    unitId: z.number().nullable(),
    unitTitle: z.string().nullable(),
    createdAt: z.number(),
  })
  .strict();
export type EvidenceRowDto = z.infer<typeof EvidenceRowDto>;
export const EvidenceListResponse = z.object({ total: z.number(), items: z.array(EvidenceRowDto) }).strict();
export type EvidenceListResponse = z.infer<typeof EvidenceListResponse>;

export const AttemptIdParams = z.object({ id: positiveIdString }).strict();

/** GET /api/attempts/:id: one ledger attempt with its submit runs (the evidence browser's link target). */
export const AttemptDetailResponse = z
  .object({
    id: z.number(),
    unitId: z.number(),
    unitTitle: z.string(),
    unitKind: UnitKind,
    mode: z.enum(['solo', 'assisted', 'guided']),
    outcome: z.string(),
    /** the learner's OWN stored submission/answer (never curriculum or keys) */
    answer: z.unknown().nullable(),
    createdAt: z.number(),
    runs: z.array(z.object({ id: z.number(), verdict: RunVerdict, durationMs: z.number().nullable(), createdAt: z.number() }).strict()),
    evidenceIds: z.array(z.number()),
  })
  .strict();
export type AttemptDetailResponse = z.infer<typeof AttemptDetailResponse>;

// GET /api/tracks/:id/campaign (W5b) — schemas live with the campaign pack format
export { CampaignActDto, CampaignQuestDto, CampaignResponse, QuestState } from './campaign.ts';

// ---------------------------------------------------------------- campaign 2 B2: stats (read-only)
//
// Every number below is computed server-side from the append-only ledgers (xp_event, attempt + run,
// review_item + review_log) and the derived campaign state. Day keys are the owner's LOCAL calendar
// days ('YYYY-MM-DD', the same keys the streak / heatmap use).

const StatsDayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** XP split by track; `none` = XP events without a track (e.g. review XP). */
export const XpByTrack = z
  .object({ js: z.number(), csharp: z.number(), java: z.number(), agentic: z.number(), none: z.number() })
  .strict();
export type XpByTrack = z.infer<typeof XpByTrack>;

export const XP_STATS_DAYS = 90;

/**
 * GET /api/stats/xp.
 *   days:  exactly XP_STATS_DAYS contiguous local days ending `today` (zero days included);
 *   weeks: all-time, Monday-start local weeks, contiguous from the week of the FIRST XP event to the
 *          current week (zero weeks included); empty when the ledger has no XP event at all.
 */
export const XpStatsResponse = z
  .object({
    today: StatsDayKey,
    days: z.array(z.object({ day: StatsDayKey, total: z.number(), byTrack: XpByTrack }).strict()),
    weeks: z.array(z.object({ weekStart: StatsDayKey, total: z.number(), byTrack: XpByTrack }).strict()),
    totals: z.object({ allTime: z.number(), lastDays: z.number(), events: z.number() }).strict(),
  })
  .strict();
export type XpStatsResponse = z.infer<typeof XpStatsResponse>;

/**
 * One pass-rate row. A GRADED attempt is an attempt with a machine submit run (reading self-attests,
 * written answers, explain-back / kata self-scores and the reveal row itself are not graded attempts).
 *   passes:         graded attempts that are a VERIFIED pass (outcome pass + a passing submit run);
 *   units:          distinct units with at least one graded attempt;
 *   firstTryPasses: units whose FIRST graded attempt was a verified pass made SOLO (no self-assist,
 *                   no reveal) — the honest "first-try" number;
 *   rates are null when their denominator is 0 (never a fake 0%).
 */
export const PassRateRow = z
  .object({
    attempts: z.number().int().min(0),
    passes: z.number().int().min(0),
    passRate: z.number().min(0).max(1).nullable(),
    units: z.number().int().min(0),
    firstTryPasses: z.number().int().min(0),
    firstTryRate: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type PassRateRow = z.infer<typeof PassRateRow>;

/** GET /api/stats/pass-rates: groups with zero graded attempts are omitted; order is stable (enum order). */
export const PassRatesResponse = z
  .object({
    overall: PassRateRow,
    byTrack: z.array(PassRateRow.extend({ trackId: TrackId }).strict()),
    byCheckType: z.array(PassRateRow.extend({ checkType: CheckType }).strict()),
  })
  .strict();
export type PassRatesResponse = z.infer<typeof PassRatesResponse>;

export const REVIEW_FORECAST_DAYS = 14;
export const REVIEW_RETENTION_WINDOW_DAYS = 30;

/**
 * GET /api/stats/reviews (review cards only — changed-example retest items are excluded, exactly
 * like the review queue's due count).
 *   forecast: REVIEW_FORECAST_DAYS local days from today; today's bucket includes every overdue card
 *             (`overdue` says how many of them were due before today); `later` = cards due after the window.
 *   retention: share of graded reviews NOT rated 'again' (recalled / reviews), null with no reviews;
 *             `window` covers the last REVIEW_RETENTION_WINDOW_DAYS local days including today.
 */
const RetentionDto = z
  .object({ reviews: z.number().int().min(0), recalled: z.number().int().min(0), rate: z.number().min(0).max(1).nullable() })
  .strict();
export const ReviewStatsResponse = z
  .object({
    today: StatsDayKey,
    cards: z.number().int().min(0),
    dueNow: z.number().int().min(0),
    overdue: z.number().int().min(0),
    later: z.number().int().min(0),
    forecast: z.array(z.object({ day: StatsDayKey, due: z.number().int().min(0) }).strict()),
    retention: z.object({ window: RetentionDto, allTime: RetentionDto }).strict(),
    ratings: z.object({ again: z.number(), hard: z.number(), good: z.number(), easy: z.number() }).strict(),
  })
  .strict();
export type ReviewStatsResponse = z.infer<typeof ReviewStatsResponse>;

/** GET /api/stats/campaign: per track the shared TrackProgress, per act the campaign map's own counts. */
export const CampaignProgressResponse = z
  .object({
    tracks: z.array(
      z
        .object({
          trackId: TrackId,
          name: z.string(),
          locked: z.boolean(),
          progress: TrackProgress,
          acts: z.array(
            z
              .object({
                actNo: z.number().int(),
                title: z.string(),
                unlocked: z.boolean(),
                coreDone: z.number().int().min(0),
                coreTotal: z.number().int().min(0),
                /** core quests whose quiz gate is not seeded yet (cannot be done until content lands) */
                corePending: z.number().int().min(0),
                readingDone: z.number().int().min(0),
                readingTotal: z.number().int().min(0),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type CampaignProgressResponse = z.infer<typeof CampaignProgressResponse>;
