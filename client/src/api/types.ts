// BootQuest client <-> API contract (W1b binds the real Express API to this).
//
// The string-literal unions below mirror shared/src/enums.ts verbatim. They are
// duplicated here only so the P5 prototype stays self-contained; on transplant,
// W1b may replace them with `import type { TrackId, ... } from '@bootquest/shared'`.
//
// Conventions:
// - Dates are ISO `YYYY-MM-DD` strings in the owner's local day (slate day = streak day).
// - Timestamps are ISO-8601 strings.
// - The server computes every number (XP, level, streak); the client never derives them.

export type TrackId = 'js' | 'csharp' | 'java' | 'agentic';

export type CompetencyId =
  | 'language-fluency'
  | 'feature-delivery'
  | 'data-http'
  | 'testing-verification'
  | 'agentic-engineering'
  | 'code-reading'
  | 'communication';

export type UnitKind =
  | 'drill'
  | 'quiz'
  | 'predict-output'
  | 'guided-project'
  | 'http-lab'
  | 'repo-task'
  | 'study'
  | 'reading'
  | 'explain-back'
  | 'patch-kata'
  | 'review'
  | 'program-unit'
  | 'retest';

export type RunVerdict = 'pass' | 'fail' | 'todo' | 'crashed' | 'timeout' | 'error';
export type Assistance = 'none' | 'self' | 'reveal';
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';
export type XpZeroReason = 'revealed' | 'daily-cap' | 'already-awarded';
export type EvidenceKind =
  | 'artifact'
  | 'explain-back'
  | 'retest'
  | 'review'
  | 'kata'
  | 'submit'
  | 'self-assessment'
  | 'promotion'
  | 'demotion';

// ---------------------------------------------------------------- dashboard

/** One calendar day. `status` is the streak engine's verdict for that day. */
export type DayStatus =
  | 'slate' // full daily slate cleared (counts toward freeze-token credit)
  | 'partial' // 20+ XP: keeps the streak, no token credit
  | 'freeze' // missed, streak saved by an auto-spent freeze token
  | 'none'; // nothing / below 20 XP

export interface HeatmapDay {
  date: string;
  xp: number;
  status: DayStatus;
}

export interface StreakSummary {
  current: number;
  longest: number;
  /** Banked freeze tokens (spec: max 2, auto-spent). */
  freezeTokens: number;
  freezeTokensMax: number;
  /** Slate-days still needed to earn the next token (7 per token). */
  slateDaysToNextToken: number;
  /** Whether today already counts (slate or partial). */
  todayCounts: boolean;
}

export interface LevelSummary {
  level: number;
  xpTotal: number;
  /** XP earned since reaching `level`. */
  xpIntoLevel: number;
  /** XP span between `level` and `level + 1` (curve 150·n^1.6, server-computed). */
  xpLevelSpan: number;
  xpToday: number;
}

export type PromotionLegState = 'done' | 'pending' | 'scheduled' | 'failed';

export interface PromotionProgress {
  targetRating: number;
  artifact: PromotionLegState;
  explainBack: PromotionLegState;
  /** Explain-back key-point coverage, 0..1 (needs ≥ 0.8). */
  explainBackCoverage: number | null;
  retest: PromotionLegState;
  /** When the changed-example retest becomes available (≥ 2 days after the artifact). */
  retestDueAt: string | null;
}

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  at: string;
  summary: string;
  assessor: 'pipeline' | 'self';
  assisted: boolean;
}

export interface CompetencyRow {
  id: CompetencyId;
  label: string;
  /** 1..5, never averaged. null = not yet rated. */
  rating: number | null;
  promotion: PromotionProgress | null;
  /** null = evidence missing (the dashboard flags it). */
  lastEvidence: EvidenceRef | null;
}

export type SlateItemKind = 'drill-set' | 'campaign-step' | 'review-queue';

export interface SlateItem {
  id: string;
  kind: SlateItemKind;
  trackId: TrackId | null;
  label: string;
  done: number;
  total: number;
  /** Client route to continue this item. */
  href: string;
}

export interface NextUp {
  trackId: TrackId;
  unitId: string;
  title: string;
  kind: UnitKind;
  actTitle: string;
  href: string;
}

export interface Dashboard {
  today: string;
  streak: StreakSummary;
  level: LevelSummary;
  heatmap: HeatmapDay[];
  competencies: CompetencyRow[];
  slate: SlateItem[];
  reviewDue: number;
  nextUp: NextUp[];
}

// ---------------------------------------------------------------- tracks / campaign

export interface Track {
  id: TrackId;
  name: string;
  short: string;
  status: 'active' | 'locked';
  lockedReason: string | null;
  unitsDone: number;
  unitsTotal: number;
}

export type NodeState = 'locked' | 'available' | 'in-progress' | 'complete';

export interface CampaignStep {
  id: string;
  unitId: string | null;
  title: string;
  kind: UnitKind;
  state: NodeState;
  xp: number;
  /** Repo the step is anchored to (upskillorder campaign), if any. */
  repo: string | null;
}

export interface CampaignAct {
  id: string;
  ordinal: number;
  title: string;
  summary: string;
  state: NodeState;
  /** Human-readable gate shown on a locked act. */
  unlockHint: string | null;
  steps: CampaignStep[];
}

export interface Campaign {
  trackId: TrackId;
  acts: CampaignAct[];
}

// ---------------------------------------------------------------- exercise player

export type ExerciseLanguage = 'javascript' | 'typescript' | 'csharp';

export interface Exercise {
  id: string;
  trackId: TrackId;
  title: string;
  kind: UnitKind;
  difficulty: number;
  xp: number;
  language: ExerciseLanguage;
  competencies: CompetencyId[];
  /** Instruction paragraphs (plain text; markdown rendering lands with W2/W4). */
  instructions: string[];
  starterCode: string;
  /** Present for quiz / predict-output units; the answer key never ships to the client. */
  quiz: { prompt: string; choices: string[] } | null;
  /** Course/act breadcrumb for the header. */
  breadcrumb: string[];
}

export type TestStatus = 'pass' | 'fail' | 'todo' | 'error';

export interface TestCaseResult {
  name: string;
  status: TestStatus;
  message: string | null;
  expected: string | null;
  actual: string | null;
}

export interface RunResult {
  verdict: RunVerdict;
  durationMs: number;
  tests: TestCaseResult[];
  stdout: string;
  stderr: string;
}

export interface SubmitResult {
  attemptId: string;
  run: RunResult;
  xpAwarded: number;
  xpZeroReason: XpZeroReason | null;
}

export interface QuizAnswerResult {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  xpAwarded: number;
}

// ---------------------------------------------------------------- review

export interface ReviewCard {
  id: string;
  trackId: TrackId;
  competency: CompetencyId;
  front: string;
  back: string;
  source: string;
}

export interface ReviewQueueCount {
  due: number;
  /** New cards introduced today (FSRS daily new limit). */
  newToday: number;
}

export interface ReviewGradeResult {
  cardId: string;
  grade: ReviewGrade;
  nextDueAt: string;
  xpAwarded: number;
}

// ---------------------------------------------------------------- the client interface

/**
 * The whole surface the shell needs. Every function returns a Promise so the
 * mock and the HTTP implementation are interchangeable.
 */
export interface BootQuestApi {
  getDashboard(): Promise<Dashboard>;
  getTracks(): Promise<Track[]>;
  getCampaign(trackId: TrackId): Promise<Campaign>;
  getExercise(unitId: string): Promise<Exercise>;
  /** Run checks without recording an attempt. */
  runExercise(unitId: string, code: string): Promise<RunResult>;
  /** Run checks AND record an immutable attempt + evidence row. */
  submitAttempt(unitId: string, code: string, assistance: Assistance): Promise<SubmitResult>;
  submitQuizAnswer(unitId: string, choiceIndex: number): Promise<QuizAnswerResult>;
  getReviewQueueCount(): Promise<ReviewQueueCount>;
  getReviewQueue(): Promise<ReviewCard[]>;
  gradeReview(cardId: string, grade: ReviewGrade): Promise<ReviewGradeResult>;
}

/** Thrown by any implementation for a 404-shaped miss. */
export class ApiNotFoundError extends Error {
  constructor(what: string) {
    super(`Not found: ${what}`);
    this.name = 'ApiNotFoundError';
  }
}
