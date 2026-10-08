import { z } from 'zod';
import { CheckSpec } from './check.ts';
import {
  Assessor,
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
    difficulty: z.number().int().min(1).max(5).optional(),
    competencies: z.array(CompetencyId).default([]),
    prerequisites: z.array(z.string().min(1)).default([]),
    /** stable_key of the content_ref this unit renders from, if any */
    contentRef: z.string().min(1).optional(),
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

export const XpAwardInput = z
  .object({
    kind: XpKind,
    unitId: z.number().int().positive().optional(),
    attemptId: z.number().int().positive().optional(),
    trackId: TrackId.optional(),
    /** required for kind 'code' (10 x difficulty) */
    difficulty: z.number().int().min(1).max(5).optional(),
  })
  .strict()
  .superRefine((x, ctx) => {
    if (x.kind === 'code' && x.difficulty === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'code XP needs difficulty', path: ['difficulty'] });
    }
  });
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

export const AttemptInput = z
  .object({
    unitId: z.number().int().positive(),
    checkId: z.number().int().positive().optional(),
    outcome: AttemptOutcome.exclude(['revealed']),
    /** honor-system self flag: "I had help on this" */
    selfAssisted: z.boolean().default(false),
    score: z.number().min(0).max(1).optional(),
    answer: z.unknown().optional(),
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

export const EvidenceInput = z
  .object({
    competency: CompetencyId,
    kind: EvidenceKind.exclude(['promotion', 'demotion']),
    intention: z.string().min(1),
    observation: z.string().min(1),
    /** ignored (derived from the attempt) when attemptId is given */
    assistance: Assistance.default('none'),
    assessor: Assessor,
    rating: z.number().int().min(1).max(5).optional(),
    verified: z.boolean().default(false),
    /** explain-back coverage / kata catch rate, 0..1 */
    score: z.number().min(0).max(1).optional(),
    attemptId: z.number().int().positive().optional(),
    unitId: z.number().int().positive().optional(),
  })
  .strict();
export type EvidenceInput = z.input<typeof EvidenceInput>;
