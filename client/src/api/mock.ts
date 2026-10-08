// Fixture-backed implementation of BootQuestApi. No network, deterministic.
// State (graded cards, awarded attempts) lives per instance, so tests can make a fresh one.

import campaignsJson from './fixtures/campaigns.json';
import competenciesJson from './fixtures/competencies.json';
import dashboardJson from './fixtures/dashboard.json';
import exercisesJson from './fixtures/exercises.json';
import heatmapJson from './fixtures/heatmap.json';
import reviewQueueJson from './fixtures/review-queue.json';
import tracksJson from './fixtures/tracks.json';
import { toRoman } from '../lib/format';
import {
  ApiNotFoundError,
  type Assistance,
  type BootQuestApi,
  type Campaign,
  type CampaignStep,
  type CompetencyRow,
  type Dashboard,
  type Exercise,
  type ExerciseLanguage,
  type HeatmapDay,
  type ReviewCard,
  type ReviewGrade,
  type RunResult,
  type Track,
  type TrackId,
} from './types';

/** Fixture-only fields that never cross the API boundary. */
interface ExerciseFixture extends Exercise {
  mock?: { passWhenIncludes: string; failRun: RunResult; passRun: RunResult };
  answer?: { correctIndex: number; explanation: string };
}

type DashboardBase = Omit<Dashboard, 'heatmap' | 'competencies' | 'reviewDue'>;

// JSON imports widen string unions to `string`; the fixture contract test pins their shape.
const fx = {
  dashboard: dashboardJson as unknown as DashboardBase,
  heatmap: heatmapJson as unknown as HeatmapDay[],
  competencies: competenciesJson as unknown as CompetencyRow[],
  tracks: tracksJson as unknown as Track[],
  campaigns: campaignsJson as unknown as Record<TrackId, Campaign>,
  exercises: exercisesJson as unknown as ExerciseFixture[],
  reviewQueue: reviewQueueJson as unknown as ReviewCard[],
};

export const fixtures = fx;

const clone = <T>(v: T): T => structuredClone(v);
const DAY_MS = 86_400_000;
const GRADE_DAYS: Record<ReviewGrade, number> = { again: 0, hard: 1, good: 3, easy: 7 };
const LANG: Record<TrackId, ExerciseLanguage> = {
  js: 'typescript',
  csharp: 'csharp',
  java: 'javascript',
  agentic: 'typescript',
};

function findStep(unitId: string): { step: CampaignStep; trackId: TrackId; act: string } | null {
  for (const campaign of Object.values(fx.campaigns)) {
    for (const act of campaign.acts) {
      const step = act.steps.find((s) => s.unitId === unitId);
      if (step) return { step, trackId: campaign.trackId, act: `Act ${toRoman(act.ordinal)} · ${act.title}` };
    }
  }
  return null;
}

/** Campaign steps without a hand-written fixture get a generic shell so every link resolves. */
function synthesize(unitId: string): ExerciseFixture | null {
  const hit = findStep(unitId);
  if (!hit) return null;
  const track = fx.tracks.find((t) => t.id === hit.trackId);
  return {
    id: unitId,
    trackId: hit.trackId,
    title: hit.step.title,
    kind: hit.step.kind,
    difficulty: 2,
    xp: hit.step.xp,
    language: LANG[hit.trackId],
    competencies: ['feature-delivery'],
    breadcrumb: [track?.name ?? hit.trackId, hit.act],
    instructions: [
      `Mock unit — the real instructions for “${hit.step.title}” are rendered from the source repo once W4 sync lands.`,
      hit.step.repo ? `Source: ${hit.step.repo}` : 'Source: seeded campaign content.',
    ],
    starterCode: '// Write your solution here.\n',
    quiz: null,
  };
}

function strip(e: ExerciseFixture): Exercise {
  const { mock: _mock, answer: _answer, ...pub } = e;
  return clone(pub);
}

export interface MockApiOptions {
  /** Artificial latency per call (ms). 0 = resolve on the next microtask. */
  latencyMs?: number;
}

export function createMockApi(opts: MockApiOptions = {}): BootQuestApi {
  const latency = opts.latencyMs ?? 0;
  const graded = new Set<string>();
  const awarded = new Set<string>();

  const respond = <T>(value: T): Promise<T> =>
    latency > 0
      ? new Promise((resolve) => setTimeout(() => resolve(clone(value)), latency))
      : Promise.resolve(clone(value));
  const fail = (what: string): Promise<never> => Promise.reject(new ApiNotFoundError(what));

  const exercise = (unitId: string): ExerciseFixture | null =>
    fx.exercises.find((e) => e.id === unitId) ?? synthesize(unitId);

  const run = (e: ExerciseFixture, code: string): RunResult => {
    if (e.mock) return code.includes(e.mock.passWhenIncludes) && !code.includes('TODO') ? e.mock.passRun : e.mock.failRun;
    const empty = code.trim() === '' || code.trim() === e.starterCode.trim();
    return {
      verdict: empty ? 'todo' : 'pass',
      durationMs: 120,
      tests: [
        {
          name: 'mock check: solution differs from starter',
          status: empty ? 'todo' : 'pass',
          message: empty ? 'No changes from the starter code yet.' : null,
          expected: null,
          actual: null,
        },
      ],
      stdout: '',
      stderr: '',
    };
  };

  const queue = () => fx.reviewQueue.filter((c) => !graded.has(c.id));

  return {
    getDashboard() {
      const d: Dashboard = {
        ...fx.dashboard,
        heatmap: fx.heatmap,
        competencies: fx.competencies,
        reviewDue: queue().length,
      };
      return respond(d);
    },
    getTracks: () => respond(fx.tracks),
    getCampaign(trackId) {
      const c = fx.campaigns[trackId];
      return c ? respond(c) : fail(`campaign ${trackId}`);
    },
    getExercise(unitId) {
      const e = exercise(unitId);
      return e ? respond(strip(e)) : fail(`unit ${unitId}`);
    },
    runExercise(unitId, code) {
      const e = exercise(unitId);
      return e ? respond(run(e, code)) : fail(`unit ${unitId}`);
    },
    submitAttempt(unitId: string, code: string, assistance: Assistance) {
      const e = exercise(unitId);
      if (!e) return fail(`unit ${unitId}`);
      const result = run(e, code);
      const passed = result.verdict === 'pass';
      let xpAwarded = 0;
      let xpZeroReason: 'revealed' | 'already-awarded' | null = null;
      if (assistance === 'reveal') xpZeroReason = 'revealed';
      else if (passed && awarded.has(unitId)) xpZeroReason = 'already-awarded';
      else if (passed) {
        xpAwarded = e.xp;
        awarded.add(unitId);
      }
      return respond({ attemptId: `att-mock-${Date.now().toString(36)}`, run: result, xpAwarded, xpZeroReason });
    },
    submitQuizAnswer(unitId, choiceIndex) {
      const e = exercise(unitId);
      if (!e?.answer) return fail(`quiz ${unitId}`);
      const correct = choiceIndex === e.answer.correctIndex;
      return respond({
        correct,
        correctIndex: e.answer.correctIndex,
        explanation: e.answer.explanation,
        xpAwarded: correct ? e.xp : 0,
      });
    },
    getReviewQueueCount: () => respond({ due: queue().length, newToday: 3 }),
    getReviewQueue: () => respond(queue()),
    gradeReview(cardId, grade) {
      if (!fx.reviewQueue.some((c) => c.id === cardId)) return fail(`card ${cardId}`);
      graded.add(cardId);
      const today = Date.parse(`${fx.dashboard.today}T12:00:00Z`);
      const nextDueAt = new Date(today + GRADE_DAYS[grade] * DAY_MS).toISOString();
      return respond({ cardId, grade, nextDueAt, xpAwarded: 1 });
    },
  };
}

export const mockApi: BootQuestApi = createMockApi();
