import { z } from 'zod';
import { CheckSpec } from './check.ts';
import {
  Assistance,
  AttemptMode,
  AttemptOutcome,
  CompetencyId,
  ContentRefKind,
  ContentRefOrigin,
  ContentRefProvenance,
  ContentRefStatus,
  EvidenceKind,
  RunVerdict,
  TrackId,
  UnitKind,
  XpKind,
  XpZeroReason,
} from './enums.ts';

// ---------------------------------------------------------------- content_ref

/**
 * Pointer into an owner repo. Curriculum TEXT is never part of this record —
 * lesson pages fetch markdown at render time (cached per SHA on disk).
 */
export const ContentRef = z
  .object({
    repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'owner/name'),
    path: z.string().min(1),
    sha: z.string().regex(/^[0-9a-f]{7,40}$/),
    anchor: z.string().min(1).nullable().default(null),
    title: z.string().min(1),
    summary: z.string().max(280).nullable().default(null),
    stableKey: z.string().min(1),
    stableKeyAlgo: z.number().int().positive().default(1),
    lineStart: z.number().int().positive().nullable().default(null),
    lineEnd: z.number().int().positive().nullable().default(null),
    kind: ContentRefKind,
    provenance: ContentRefProvenance,
    origin: ContentRefOrigin.nullable().default(null),
    status: ContentRefStatus.default('ok'),
    family: z.string().nullable().default(null),
  })
  .strict()
  .refine((r) => r.lineEnd === null || (r.lineStart !== null && r.lineEnd >= r.lineStart), {
    message: 'lineEnd requires lineStart and must be >= lineStart',
    path: ['lineEnd'],
  });
export type ContentRef = z.infer<typeof ContentRef>;

// ---------------------------------------------------------------- exercise / lesson spec

/** A unit as authored in content/ (seed output) — validated before it reaches the DB. */
export const LessonSpec = z
  .object({
    key: z.string().min(1),
    track: TrackId,
    kind: UnitKind,
    title: z.string().min(1),
    code: z.string().optional(),
    phase: z.string().min(1).optional(),
    difficulty: z.number().int().min(1).max(5).optional(),
    /** informational (signalpost program.json); engines compute awards themselves */
    xp: z.number().int().nonnegative().optional(),
    targetLevel: z.number().int().min(1).max(5).optional(),
    competencies: z.array(CompetencyId).default([]),
    prerequisites: z.array(z.string().min(1)).default([]),
    /**
     * The content_ref this unit renders from, if any. Addressed by (repo,
     * stableKey) because stable keys are unique per repo only: twin repos and
     * template families share heading text (estate contract §6).
     */
    contentRef: z
      .object({ repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'owner/name'), stableKey: z.string().min(1) })
      .strict()
      .optional(),
    /** key of the unit this one is a changed-example variant of */
    variationOf: z.string().min(1).optional(),
    checks: z
      .array(
        z.object({
          spec: CheckSpec,
          threshold: z.number().min(0).max(1).optional(),
        }),
      )
      .default([]),
  })
  .strict()
  .superRefine((u, ctx) => {
    if (u.kind === 'drill' && u.difficulty === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'drills need a difficulty (code XP = 10 x difficulty)', path: ['difficulty'] });
    }
    if (u.prerequisites.includes(u.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'unit cannot be its own prerequisite', path: ['prerequisites'] });
    }
  });
export type LessonSpec = z.infer<typeof LessonSpec>;
/** Alias: an exercise is a lesson spec with at least one machine check. */
export const ExerciseSpec = LessonSpec.refine((u) => u.checks.length > 0, { message: 'exercise needs at least one check', path: ['checks'] });
export type ExerciseSpec = z.infer<typeof ExerciseSpec>;

// ---------------------------------------------------------------- runner result

export const RunnerFailure = z.object({
  name: z.string(),
  message: z.string(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
});

/** Common runner interface result (spec §5): run(exercise, submission) -> RunnerResult. */
export const RunnerResult = z
  .object({
    pass: z.boolean(),
    output: z.string(),
    failures: z.array(RunnerFailure),
    durationMs: z.number().nonnegative(),
    /** optional richer verdict; `todo` is neither pass nor fail */
    verdict: RunVerdict.optional(),
    counts: z
      .object({ passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), todo: z.number().int().nonnegative() })
      .optional(),
  })
  .superRefine((r, ctx) => {
    if (r.verdict !== undefined && (r.verdict === 'pass') !== r.pass) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'pass must agree with verdict', path: ['pass'] });
    }
    if (r.pass && r.failures.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a passing result cannot carry failures', path: ['failures'] });
    }
  });
export type RunnerResult = z.infer<typeof RunnerResult>;

// ---------------------------------------------------------------- xp event

/**
 * An XP claim. Every non-review award is anchored on a recorded attempt: the
 * engine verifies that attempt (passing run, or completed explain-back / kata,
 * or reading self-attest) and reads unit, track and difficulty from the DB.
 * Difficulty, track and amount are never caller-supplied. Review XP is paid
 * only by the FSRS engine's review(), never through this input.
 */
export const XpAwardInput = z
  .object({
    kind: XpKind.exclude(['review']),
    attemptId: z.number().int().positive(),
    /** optional cross-check: must equal the attempt's unit */
    unitId: z.number().int().positive().optional(),
  })
  .strict();
export type XpAwardInput = z.input<typeof XpAwardInput>;

export const XpEvent = z.object({
  id: z.number().int().positive(),
  kind: XpKind,
  amount: z.number().int().nonnegative(),
  reason: XpZeroReason.nullable(),
  unitId: z.number().int().positive().nullable(),
  attemptId: z.number().int().positive().nullable(),
  trackId: TrackId.nullable(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createdAt: z.number().int(),
});
export type XpEvent = z.infer<typeof XpEvent>;

// ---------------------------------------------------------------- attempt + evidence

/**
 * An ungraded answer attempt (outcome 'submitted'): the explain-back transcript
 * or kata findings, stored immutably BEFORE the key is shown. Graded outcomes
 * (pass/fail/todo/error) are never caller-chosen: they come only from
 * recordSubmission(), which derives the outcome from the runner verdict and
 * writes the run row in the same transaction.
 */
export const AttemptInput = z
  .object({
    unitId: z.number().int().positive(),
    checkId: z.number().int().positive().optional(),
    /** honor-system self flag: "I had help on this" */
    selfAssisted: z.boolean().default(false),
    answer: z.unknown().refine((a) => a !== undefined && a !== null, { message: 'answer is required' }),
  })
  .strict();
export type AttemptInput = z.input<typeof AttemptInput>;

export const Attempt = z.object({
  id: z.number().int().positive(),
  unitId: z.number().int().positive(),
  mode: AttemptMode,
  assisted: z.boolean(),
  assistanceSource: Assistance,
  outcome: AttemptOutcome,
  variationUnitId: z.number().int().positive().nullable(),
  createdAt: z.number().int(),
});
export type Attempt = z.infer<typeof Attempt>;

/** Evidence kinds that must be anchored on a recorded attempt. */
export const ATTEMPT_LINKED_EVIDENCE_KINDS = ['artifact', 'retest', 'submit', 'explain-back', 'kata'] as const;

/**
 * Evidence a caller may record. `verified`, `assessor` and `assistance` are NOT
 * inputs: the engine derives them from the linked attempt and its run
 * (pipeline-verified only when a passing submit run exists). `score` is the
 * self-scored explain-back coverage / kata catch rate, and is accepted only
 * for those kinds. `rating` is accepted only for self-assessment. Promotion,
 * demotion and review evidence are written by the engines alone.
 */
export const EvidenceInput = z
  .object({
    competency: CompetencyId,
    kind: EvidenceKind.exclude(['promotion', 'demotion', 'review']),
    intention: z.string().min(1),
    observation: z.string().min(1),
    rating: z.number().int().min(1).max(5).optional(),
    /** explain-back coverage / kata catch rate, 0..1 (self-scored after the key is revealed) */
    score: z.number().min(0).max(1).optional(),
    attemptId: z.number().int().positive().optional(),
    unitId: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    const linked = (ATTEMPT_LINKED_EVIDENCE_KINDS as readonly string[]).includes(e.kind);
    if (linked && e.attemptId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${e.kind} evidence needs an attemptId`, path: ['attemptId'] });
    }
    const scored = e.kind === 'explain-back' || e.kind === 'kata';
    if (scored && e.score === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${e.kind} evidence needs a score`, path: ['score'] });
    }
    if (!scored && e.score !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `score is derived for ${e.kind} evidence`, path: ['score'] });
    }
    if (e.rating !== undefined && e.kind !== 'self-assessment') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'rating is only accepted on self-assessment', path: ['rating'] });
    }
  });
export type EvidenceInput = z.input<typeof EvidenceInput>;
