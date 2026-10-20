import { z } from 'zod';

// Every enum here mirrors a CHECK constraint in server/src/db/migrations/001_init.sql.
// server/test/enum-sync.test.ts asserts they stay in sync with the SQL.

export const TRACK_IDS = ['js', 'csharp', 'java', 'agentic', 'sysdesign'] as const;
export const TrackId = z.enum(TRACK_IDS);
export type TrackId = z.infer<typeof TrackId>;

export const COMPETENCY_IDS = [
  'language-fluency',
  'feature-delivery',
  'data-http',
  'testing-verification',
  'agentic-engineering',
  'code-reading',
  'communication',
  'system-design',
] as const;
export const CompetencyId = z.enum(COMPETENCY_IDS);
export type CompetencyId = z.infer<typeof CompetencyId>;

export const CHECK_TYPES = [
  'drill-js',
  'drill-cs',
  'drill-java',
  'quiz',
  'predict-output',
  'guided-step',
  'http',
  'repo',
  'study-quiz',
  'explain-back',
  'patch-kata',
  'review',
  'node-test-file',
  'self-run',
  'vitest-project',
] as const;
export const CheckType = z.enum(CHECK_TYPES);
export type CheckType = z.infer<typeof CheckType>;

export const UNIT_KINDS = [
  'drill',
  'quiz',
  'predict-output',
  'guided-project',
  'http-lab',
  'repo-task',
  'study',
  'reading',
  'explain-back',
  'patch-kata',
  'review',
  'program-unit',
  'retest',
  /**
   * Imported self-assessed written exercise (BootForge `written`: model answer +
   * rubric). Has NO check: never a pass target, never quarantined — a counted
   * carve-out of the import gate (LEARNING.md R1). Added by migration 004.
   */
  'written',
] as const;
export const UnitKind = z.enum(UNIT_KINDS);
export type UnitKind = z.infer<typeof UnitKind>;

/**
 * Unit kinds whose verified, unassisted pass counts as promotion leg (a), the
 * "independent artifact passes verification (CLI-verified project)" of spec §6.2.
 * These are exactly the §4 "Own editor + CLI" types (guided project, HTTP check,
 * repo check) plus signalpost program units. Browser practice (drill, quiz,
 * predict-output, study, reading, kata, review), explain-back and retest units
 * can never anchor a promotion. The G2 delegation brief (§8) is not a separate
 * unit kind: it maps to `explain-back`.
 */
export const PROJECT_UNIT_KINDS = ['guided-project', 'http-lab', 'repo-task', 'program-unit'] as const satisfies readonly UnitKind[];
export type ProjectUnitKind = (typeof PROJECT_UNIT_KINDS)[number];

export const ATTEMPT_MODES = ['solo', 'assisted', 'guided'] as const;
export const AttemptMode = z.enum(ATTEMPT_MODES);
export type AttemptMode = z.infer<typeof AttemptMode>;

/**
 * Where an attempt's help came from: none (solo), self (honor-system flag), reveal
 * (solution revealed, guided), prior-key (server review F2: a fresh answer to a
 * re-seeded explain-back / kata item after the learner answered an earlier version,
 * whose key that answer unlocked; mode 'assisted').
 */
export const ASSISTANCE = ['none', 'self', 'reveal', 'prior-key'] as const;
export const Assistance = z.enum(ASSISTANCE);
export type Assistance = z.infer<typeof Assistance>;

export const ATTEMPT_OUTCOMES = ['pass', 'fail', 'todo', 'error', 'revealed', 'submitted'] as const;
export const AttemptOutcome = z.enum(ATTEMPT_OUTCOMES);
export type AttemptOutcome = z.infer<typeof AttemptOutcome>;

/** Runner verdicts. `todo` is a distinct non-pass, non-fail state (jstrain protocol). */
export const RUN_VERDICTS = ['pass', 'fail', 'todo', 'crashed', 'timeout', 'error'] as const;
export const RunVerdict = z.enum(RUN_VERDICTS);
export type RunVerdict = z.infer<typeof RunVerdict>;

export const XP_KINDS = [
  'code',
  'quiz',
  'predict',
  'study-quest',
  'reading',
  'explain-back',
  'patch-kata',
  'review',
] as const;
export const XpKind = z.enum(XP_KINDS);
export type XpKind = z.infer<typeof XpKind>;

export const XP_ZERO_REASONS = ['revealed', 'daily-cap', 'already-awarded'] as const;
export const XpZeroReason = z.enum(XP_ZERO_REASONS);
export type XpZeroReason = z.infer<typeof XpZeroReason>;

export const EVIDENCE_KINDS = [
  'artifact',
  'explain-back',
  'retest',
  'review',
  'kata',
  'submit',
  'self-assessment',
  'promotion',
  'demotion',
  /** W6 mutation gate (spec §5): verified pipeline evidence that the project's tests survived Stryker's per-file floor */
  'mutation',
] as const;
export const EvidenceKind = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const ASSESSORS = ['pipeline', 'self'] as const;
export const Assessor = z.enum(ASSESSORS);
export type Assessor = z.infer<typeof Assessor>;

export const CONTENT_REF_KINDS = ['guide', 'exercise', 'finding', 'quiz', 'program-unit', 'check-file', 'reading'] as const;
export const ContentRefKind = z.enum(CONTENT_REF_KINDS);

export const CONTENT_REF_PROVENANCE = ['frontmatter', 'heading-hash', 'json-pointer'] as const;
export const ContentRefProvenance = z.enum(CONTENT_REF_PROVENANCE);

export const CONTENT_REF_ORIGINS = ['observed', 'read-derived', 'author-recorded'] as const;
export const ContentRefOrigin = z.enum(CONTENT_REF_ORIGINS);

export const CONTENT_REF_STATUS = ['ok', 'quarantined', 'stale-anchor', 'missing-at-sha'] as const;
export const ContentRefStatus = z.enum(CONTENT_REF_STATUS);

export const REVIEW_GRADES = ['again', 'hard', 'good', 'easy'] as const;
export const ReviewGrade = z.enum(REVIEW_GRADES);
export type ReviewGrade = z.infer<typeof ReviewGrade>;
