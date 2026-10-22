// Fixture-backed implementation of BootQuestApi. No network, deterministic.
// It mirrors the SERVER's semantics, not just its shapes:
//  - run on quiz / predict-output -> 409 RUN_NOT_AVAILABLE (a free run would be an answer oracle)
//  - a wrong quiz / predict submit never reveals the key; only POST /reveal does
//  - reveal is recorded per unit; afterwards every submit is mode 'guided' with 0 XP ('revealed')
//  - GET /solution -> 403 NOT_REVEALED until revealed
//  - self-attest: reading units only (409 WRONG_UNIT_KIND), once (409 ALREADY_ATTESTED)
//  - submit bodies are strict: exactly one of code/answer + boolean selfAssisted (anything else -> 400 VALIDATION)
//  - written units (B4): POST /answer stores the answer immutably (no XP); GET /model-answer is
//    403 NOT_ANSWERED until then; the detail's rubric is null until answered (it can quote the key)
//  - explain-back / kata answers are per item VERSION: reseedItem(unitId) (mock-only) stands in for
//    a re-seed; the old answer is then superseded (answered reads false, NOT_ANSWERED names it) and
//    the new version takes one fresh answer - no row changes, like the server
//  - an explain-back that is leg (b) of a project unit refuses an answer (409 ARTIFACT_REQUIRED)
//    and lists the artifact in detail.explainBack.artifactRequired until it has a solo verified pass
//  - explain-back retakes: a PRACTICE re-answer opens once the answer of record is self-scored
//    (403 NOT_ANSWERED / 409 NOT_VERIFIED before; one unscored practice at a time, 403
//    ALREADY_ANSWERED), recorded assisted; its practice-score files 'practice' evidence, 0 XP, no
//    retests; ALTERNATE sets (fixtures sharing altSet.group) rotate: a fresh answer to a sibling
//    opens >= 2 days after the newest fresh answer in the group (409 NOT_DUE; the mock clock is
//    fixed, so once one sibling is answered the others stay closed)
// State lives per instance, so tests can make a fresh one.

import competenciesJson from './fixtures/competencies.json';
import dashboardJson from './fixtures/dashboard.json';
import heatmapJson from './fixtures/heatmap.json';
import reviewQueueJson from './fixtures/review-queue.json';
import tracksJson from './fixtures/tracks.json';
import unitDetailsJson from './fixtures/unit-details.json';
import unitsJson from './fixtures/units.json';
import { notesFixtures, type NoteFixture } from './fixtures/notes';
import {
  altSetLadderUnits,
  campaignFixtures,
  emptyPromotion,
  lockedCampaignFixtures,
  evidenceFixtures,
  explainBackFixtures,
  gatedArtifactFixture,
  gatedLadderUnits,
  GATED_ARTIFACT_ID,
  kataFixtures,
  promotionFixtures,
  studyQuestFixtures,
} from './fixtures/ladder';
import { writtenFixtures } from './fixtures/written';
import {
  ApiError,
  type BootQuestApi,
  type CanonicalRunResult,
  type CompetencyId,
  type ExplainBackPublic,
  type KataPublic,
  type TolerantSuperseded,
  type Dashboard,
  type GradeResponse,
  type HeatmapDay,
  type PublicCheck,
  type RevealResponse,
  type ReviewGrade,
  type ReviewQueueItem,
  type TrackId,
  type CheckType,
  type TracksResponse,
  type UnitDetail,
  type UnitNotesResponse,
  type NoteDto,
  type RefContentResponse,
  type UnitSummary,
  type AttemptDetailResponse,
  type EvidenceRowDto,
  type KataFinding,
  type SubmitResponse,
  type CampaignActDto,
  type CampaignResponse,
  type CampaignProgressResponse,
  type PassRatesResponse,
  type ReviewStatsResponse,
  type TrackProgress,
  type XpStatsResponse,
} from './types';
import type { XpByTrack } from '@bootquest/shared/api';
import { G1_MIN_DEFECTS, G1_TARGET_RATE, PROMOTION_MIN_COVERAGE } from '@bootquest/shared/thresholds';

/** Private, fixture-only grading material. Never crosses the API boundary. */
interface PrivateFixture {
  passWhenIncludes?: string;
  failResult?: CanonicalRunResult;
  passResult?: CanonicalRunResult;
  answerKey?: number | string;
  expected?: string;
  solution?: RevealResponse['solution'];
  /** post-solve explanation (released by GET /notes after a verified pass or a reveal) */
  explanation?: string;
}

interface DetailFixture {
  code: string | null;
  competencies: CompetencyId[];
  instructions?: string | string[];
  prompt?: string;
  check: { id: number; threshold: number | null; spec: PublicCheck } | null;
  starter: string | null;
  private: PrivateFixture;
}

type DashboardBase = Omit<Dashboard, 'heatmap' | 'competencies' | 'reviewQueue'>;

// JSON imports widen string unions to `string`; the fixture contract test pins their shape.
const fx = {
  dashboard: dashboardJson as unknown as DashboardBase,
  heatmap: heatmapJson as unknown as HeatmapDay[],
  competencies: competenciesJson as unknown as Dashboard['competencies'],
  tracks: tracksJson as unknown as TracksResponse,
  units: unitsJson as unknown as Record<TrackId, UnitSummary[]>,
  details: unitDetailsJson as unknown as Record<string, DetailFixture>,
  reviewQueue: reviewQueueJson as unknown as ReviewQueueItem[],
};

export const fixtures = fx;

const clone = <T>(v: T): T => structuredClone(v);
const DAY_MS = 86_400_000;
const GRADE_DAYS: Record<ReviewGrade, number> = { again: 0, hard: 1, good: 3, easy: 7 };
/** Mock "now": end of the fixture's today, so every fixture card is due. */
const NOW = Date.parse(`${fx.dashboard.today}T23:00:00Z`);
const READING_XP = 5;
const SUBMIT_KEYS = new Set(['code', 'answer', 'answers', 'selfAssisted']);

const err = (status: number, code: ApiError['code'], message: string) => new ApiError(status, code, message);

export interface MockApiOptions {
  /** Artificial latency per call (ms). 0 = resolve on the next microtask. */
  latencyMs?: number;
  /**
   * Graded-submit history the pass rates start from. 'fixture' (default): a deterministic
   * synthetic history so dev:mock shows populated stats; 'empty': none, like a fresh server DB
   * (the F17 mock/server contract). Either way every submit made through this instance is
   * recorded and the rates are DERIVED from the rows by the server's rule (passRateOf below).
   */
  passRateHistory?: 'fixture' | 'empty';
  /**
   * Tracks served as LOCKED (track.locked, like the server's `track.locked = 1`). Every track
   * ships unlocked; tests of the lock rendering lock one here. A locked track's campaign is
   * `lockedCampaignFixtures[id]` when one exists (a statically locked act, inert quests).
   */
  lockedTracks?: readonly TrackId[];
}

// ---- pass rates: mirrors server/src/engines/stats.ts passRate / passRatesBy and the
// server's group order (shared/src/enums.ts TRACK_IDS / CHECK_TYPES); the F17 contract test
// (server/test/api/mock-contract.test.ts) asserts both sides return the same numbers.
interface GradedRow {
  id: number;
  unitId: number;
  trackId: TrackId;
  checkType: CheckType;
  mode: 'solo' | 'assisted' | 'guided';
  verified: boolean;
  createdAt: number;
}
const RATE_TRACK_ORDER: readonly TrackId[] = ['js', 'csharp', 'java', 'agentic', 'sysdesign'];
const RATE_CHECK_ORDER: readonly CheckType[] = [
  'drill-js', 'drill-cs', 'drill-java', 'quiz', 'predict-output', 'guided-step', 'http', 'repo', 'study-quiz',
  'explain-back', 'patch-kata', 'review', 'node-test-file', 'self-run', 'vitest-project',
];
type Rate = PassRatesResponse['overall'];
/** A guided pass (after a reveal) stays in the denominator but is never a pass: reported as guidedPasses. */
function passRateOf(rows: readonly GradedRow[]): Rate {
  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  const first = new Map<number, GradedRow>();
  for (const r of sorted) if (!first.has(r.unitId)) first.set(r.unitId, r);
  const passes = rows.filter((r) => r.verified && r.mode !== 'guided').length;
  const firstTryPasses = [...first.values()].filter((r) => r.verified && r.mode === 'solo').length;
  return {
    attempts: rows.length,
    passes,
    guidedPasses: rows.filter((r) => r.verified && r.mode === 'guided').length,
    passRate: rows.length === 0 ? null : passes / rows.length,
    units: first.size,
    firstTryPasses,
    firstTryRate: first.size === 0 ? null : firstTryPasses / first.size,
  };
}
function ratesBy<K extends string>(rows: readonly GradedRow[], keyOf: (r: GradedRow) => K, order: readonly K[]): { key: K; rate: Rate }[] {
  return order.flatMap((k) => {
    const g = rows.filter((r) => keyOf(r) === k);
    return g.length > 0 ? [{ key: k, rate: passRateOf(g) }] : [];
  });
}
/** The synthetic dev:mock history: per (track, check type) [attempts, passes, units, firstTryPasses, guidedPasses].
 *  Derives overall 47/62 with 4 guided passes, JS/TS 35/44, C# 12/18 (the numbers the Stats page tests read). */
const HISTORY: [TrackId, CheckType, number, number, number, number, number][] = [
  ['js', 'drill-js', 24, 20, 14, 12, 2],
  ['js', 'quiz', 14, 11, 11, 9, 1],
  ['js', 'predict-output', 6, 4, 4, 2, 0],
  ['csharp', 'drill-cs', 14, 9, 8, 5, 1],
  ['csharp', 'study-quiz', 4, 3, 2, 1, 0],
];
function fixtureHistory(): GradedRow[] {
  const rows: GradedRow[] = [];
  let id = 1;
  let unitId = -1;
  for (const [trackId, checkType, attempts, passes, unitsN, first, guided] of HISTORY) {
    const retryPasses = passes - first;
    if (retryPasses < 0 || retryPasses + guided > attempts - unitsN) throw new Error(`mock pass-rate history ${trackId}/${checkType} is inconsistent`);
    const unitIds: number[] = [];
    // one first attempt per unit (the first `first` pass solo), then retries on those units
    for (let k = 0; k < unitsN; k++) {
      unitIds.push(unitId);
      rows.push({ id, unitId: unitId--, trackId, checkType, mode: 'solo', verified: k < first, createdAt: NOW - 1e9 + id });
      id++;
    }
    for (let k = 0; k < attempts - unitsN; k++) {
      const mode = k >= retryPasses && k < retryPasses + guided ? 'guided' : 'solo';
      rows.push({ id, unitId: unitIds[k % unitIds.length]!, trackId, checkType, mode, verified: k < retryPasses + guided, createdAt: NOW - 1e9 + id });
      id++;
    }
  }
  return rows;
}

/** shared/src/enums.ts PROJECT_UNIT_KINDS (restated: the client imports no runtime code from shared's index) */
const PROJECT_UNIT_KINDS: ReadonlySet<UnitSummary['kind']> = new Set<UnitSummary['kind']>(['guided-project', 'http-lab', 'repo-task', 'program-unit']);

/** One recorded explain-back / kata answer, stamped with the item VERSION it answered (the server's itemSha). */
interface StoredAnswer<T> {
  attemptId: number;
  at: number;
  version: number;
  body: T;
}

/** The mock API plus a dev/test-only hook the HTTP client does not have. */
export type MockApi = BootQuestApi & {
  /**
   * Stand-in for re-seeding an explain-back / kata item under the same key: bumps the item's
   * version, so the earlier answer is SUPERSEDED (never keyed against the new version) and the
   * unit takes one fresh answer. Mock only; nothing in the app calls it.
   */
  reseedItem(unitId: number): void;
};

export function createMockApi(opts: MockApiOptions = {}): MockApi {
  const latency = opts.latencyMs ?? 0;
  const units = clone(fx.units);
  // ladder dead end #2: the gated explain-back and its artifact (agentic track)
  for (const u of gatedLadderUnits) units[u.trackId] = [...(units[u.trackId] ?? []), clone(u)];
  // explain-back alternate sets: two sibling sets of one DESIGN IT question set (sysdesign track)
  for (const u of altSetLadderUnits) units[u.trackId] = [...(units[u.trackId] ?? []), clone(u)];
  // W8: the study-quest fixture units (csharp borrowbox quest)
  for (const sq of Object.values(studyQuestFixtures)) units[sq.unit.trackId] = [...(units[sq.unit.trackId] ?? []), clone(sq.unit)];
  // B4: the written-unit fixtures (answer first, then the model answer)
  for (const w of Object.values(writtenFixtures)) units[w.unit.trackId] = [...(units[w.unit.trackId] ?? []), clone(w.unit)];
  const writtenAnswers = new Map<number, { attemptId: number; answer: string; at: number }>();
  const studyMissCards = new Set<string>();
  const studyPassed = new Set<number>();
  // "Learn more": units with a graded study-quiz submit, and code units with a verified pass
  const studyAnswered = new Set<number>();
  const passedUnits = new Set<number>();
  // a SOLO verified pass (the artifact predicate of ARTIFACT_REQUIRED)
  const soloPassedUnits = new Set<number>();
  const graded = new Set<number>();
  const awarded = new Set<number>();
  const revealed = new Map<number, number>(); // unitId -> reveal attemptId
  const attested = new Set<number>();
  let nextId = 5000;
  // W6 answer-first state: unitId -> every recorded answer (append-only, oldest first); attemptId -> self-score
  const ebAnswers = new Map<number, StoredAnswer<string[]>[]>();
  const kataAnswers = new Map<number, StoredAnswer<KataFinding[]>[]>();
  // explain-back PRACTICE retakes: unitId -> practice attempts (append-only, oldest first; never answers of record)
  const ebPractice = new Map<number, StoredAnswer<string[]>[]>();
  // item version per unit (1 until reseedItem): an answer counts only for the version it answered
  const itemVersion = new Map<number, number>();
  const versionOf = (unitId: number) => itemVersion.get(unitId) ?? 1;
  const scores = new Map<number, { score: number; evidenceIds: number[]; at: number }>();
  const kataXpPaid = new Set<number>();
  const ebXpPaid = new Set<number>();
  const evidence: EvidenceRowDto[] = clone(evidenceFixtures);
  const attempts = new Map<number, AttemptDetailResponse>();
  // graded submits the pass rates derive from (seed history + every submit through this instance)
  const gradedRows: GradedRow[] = opts.passRateHistory === 'empty' ? [] : fixtureHistory();
  const recordGraded = (u: UnitSummary, checkType: CheckType, attemptId: number, mode: GradedRow['mode'], pass: boolean) =>
    gradedRows.push({ id: attemptId, unitId: u.id, trackId: u.trackId, checkType, mode, verified: pass, createdAt: NOW });

  const respond = <T>(value: T): Promise<T> =>
    latency > 0
      ? new Promise((resolve) => setTimeout(() => resolve(clone(value)), latency))
      : Promise.resolve(clone(value));
  const reject = (e: ApiError): Promise<never> =>
    latency > 0 ? new Promise((_, rej) => setTimeout(() => rej(e), latency)) : Promise.reject(e);

  const allUnits = () => Object.values(units).flat();
  const findUnit = (id: number) => allUnits().find((u) => u.id === id) ?? null;
  const lockedTracks = new Set(opts.lockedTracks ?? []);
  const trackList = fx.tracks.tracks.map((t) => (lockedTracks.has(t.id) ? { ...t, locked: true } : t));
  const campaigns: Partial<Record<TrackId, Omit<CampaignResponse, 'level'>>> = { ...campaignFixtures };
  for (const id of lockedTracks) {
    const c = lockedCampaignFixtures[id] ?? campaignFixtures[id];
    if (c) campaigns[id] = { ...c, track: { ...c.track, locked: true } };
  }
  const trackOf = (id: TrackId) => trackList.find((t) => t.id === id)!;

  // W8: a passed study quest is done, and its act's core progress follows (derived, like the server)
  function campaignActs(trackId: TrackId): CampaignActDto[] {
    const c = campaigns[trackId];
    if (!c) return [];
    return c.acts.map((a) => {
      const quests = a.quests.map((q) => (q.unitId !== undefined && studyPassed.has(q.unitId) ? { ...q, state: 'done' as const, inProgress: false } : q));
      const bump = quests.filter((q, i) => q.core && q.state === 'done' && a.quests[i]!.state !== 'done').length;
      return { ...a, quests, progress: { ...a.progress, coreDone: a.progress.coreDone + bump } };
    });
  }

  /** Mirrors the server's ONE track-progress rule (server/src/engines/stats.ts trackProgress). */
  function trackCounts(id: TrackId, locked: boolean): { unitCount: number; doneCount: number; progress: TrackProgress } {
    const list = units[id] ?? [];
    const unitCount = list.length;
    const doneCount = locked ? 0 : list.filter((u) => u.state === 'done').length;
    const acts = campaignActs(id);
    const coreDone = acts.reduce((n, a) => n + a.progress.coreDone, 0);
    const coreTotal = acts.reduce((n, a) => n + a.progress.coreTotal, 0);
    const counts = { coreDone, coreTotal, practiceDone: doneCount, practiceTotal: unitCount };
    const pct = (d: number, t: number) => Math.min(100, Math.floor((d * 100) / t));
    const progress: TrackProgress = locked
      ? { pct: 0, basis: 'none', ...counts }
      : coreTotal > 0
        ? { pct: pct(coreDone, coreTotal), basis: 'campaign-core', ...counts }
        : unitCount > 0
          ? { pct: pct(doneCount, unitCount), basis: 'practice', ...counts }
          : { pct: 0, basis: 'none', ...counts };
    return { unitCount, doneCount, progress };
  }

  function detail(u: UnitSummary): DetailFixture {
    const sq = studyQuestFixtures[String(u.id)];
    if (sq) {
      return {
        code: null,
        competencies: ['code-reading'],
        check: { id: 9000 + u.id, threshold: 0.8, spec: { type: 'study-quiz', itemKeys: sq.public.questions.map((q) => q.itemKey), passPct: 0.8 } },
        starter: null,
        private: {},
      };
    }
    const w = writtenFixtures[String(u.id)];
    if (w) return { code: w.code, competencies: w.competencies, instructions: w.instructions, check: null, starter: w.starter, private: {} };
    const eb = explainBackFixtures[String(u.id)];
    if (eb) {
      return {
        code: null,
        competencies: eb.competencies,
        check: { id: 9000 + u.id, threshold: null, spec: { type: 'explain-back', questionSetKey: `seed:explain-back:mock-${u.id}`, questionCount: 3, minCoverage: PROMOTION_MIN_COVERAGE } },
        starter: null,
        private: {},
      };
    }
    if (u.id === GATED_ARTIFACT_ID) {
      return {
        code: 'AG-H-01',
        competencies: gatedArtifactFixture.competencies,
        instructions: gatedArtifactFixture.instructions,
        check: { id: 9000 + u.id, threshold: null, spec: { type: 'drill-js', language: 'js', tests: [{ name: 'stops on a final answer' }, { name: 'feeds tool results back' }], timeoutMs: 5000 } },
        starter: gatedArtifactFixture.starter,
        private: { solution: { kind: 'code', code: gatedArtifactFixture.solution } },
      };
    }
    if (u.kind === 'patch-kata') {
      const k = kataFixtures[String(u.id)];
      return {
        code: null,
        competencies: k?.competencies ?? ['code-reading'],
        check: { id: 9000 + u.id, threshold: null, spec: { type: 'patch-kata', kataKey: `seed:patch-kata:mock-${u.id}` } },
        starter: null,
        private: {},
      };
    }
    return (
      fx.details[String(u.id)] ?? {
        code: null,
        competencies: ['feature-delivery'],
        check: null,
        starter: null,
        private: {},
      }
    );
  }

  /** Common guards, in the server's order: 404 unit, 403 locked track, 409 no check. */
  function guard(id: number, { needCheck }: { needCheck: boolean }) {
    const u = findUnit(id);
    if (!u) throw err(404, 'NOT_FOUND', `unit ${id} not found`);
    if (trackOf(u.trackId).locked) throw err(403, 'TRACK_LOCKED', `track ${u.trackId} is locked`);
    const d = detail(u);
    if (needCheck && !d.check) throw err(409, 'NO_CHECK', `unit ${id} has no check`);
    return { u, d, spec: d.check?.spec ?? null };
  }

  function grade(d: DetailFixture, spec: PublicCheck, input: { code?: string; answer?: string | number }): CanonicalRunResult {
    const p = d.private;
    if (spec.type === 'quiz' || spec.type === 'predict-output') {
      const key = spec.type === 'quiz' ? p.answerKey : p.expected;
      const given = typeof input.answer === 'string' ? input.answer.trim() : input.answer;
      const pass = given !== undefined && String(given) === String(key);
      // A wrong answer says "incorrect" and nothing else: no key, no expected output.
      return { pass, output: '', failures: pass ? [] : [{ name: 'answer', message: 'Incorrect answer' }], durationMs: 3 };
    }
    const code = input.code ?? '';
    if (p.passWhenIncludes && p.passResult && p.failResult) {
      return code.includes(p.passWhenIncludes) && !code.includes('TODO') ? p.passResult : p.failResult;
    }
    const empty = code.trim() === '' || code.trim() === (d.starter ?? '').trim();
    return empty
      ? { pass: false, output: '', failures: [{ name: 'mock check', message: 'No changes from the starter code yet.' }], durationMs: 120 }
      : { pass: true, output: 'mock check passed', failures: [], durationMs: 120 };
  }

  function validateSubmission(body: unknown): { code?: string; answer?: string | number; answers?: number[]; selfAssisted: boolean } {
    const b = (body ?? {}) as Record<string, unknown>;
    const extra = Object.keys(b).filter((k) => !SUBMIT_KEYS.has(k));
    if (extra.length) throw err(400, 'VALIDATION', `unrecognized key(s): ${extra.join(', ')}`);
    if ([b.code, b.answer, b.answers].filter((v) => v !== undefined).length !== 1) throw err(400, 'VALIDATION', 'provide exactly one of `code`, `answer` or `answers`');
    if (b.answers !== undefined && (!Array.isArray(b.answers) || b.answers.some((a) => !Number.isInteger(a) || (a as number) < 0))) {
      throw err(400, 'VALIDATION', 'answers must be choice indexes');
    }
    if (b.selfAssisted !== undefined && typeof b.selfAssisted !== 'boolean') throw err(400, 'VALIDATION', 'selfAssisted must be boolean');
    return { code: b.code as string | undefined, answer: b.answer as string | number | undefined, answers: b.answers as number[] | undefined, selfAssisted: b.selfAssisted === true };
  }

  /** What the server's attempt row stores as the submission (service.ts recordedAnswer: exactly one shape was sent). */
  function recordedAnswer(b: { code?: string; answer?: string | number; answers?: number[] }): Record<string, unknown> {
    if (b.code !== undefined) return { code: b.code };
    if (b.answers !== undefined) return { answers: b.answers };
    return { answer: b.answer };
  }

  const xpFor = (u: UnitSummary, spec: PublicCheck): number =>
    spec.type === 'quiz' ? 2 : spec.type === 'predict-output' ? 4 : 10 * (u.difficulty ?? 1);

  const queue = () => fx.reviewQueue.filter((c) => !graded.has(c.id) && c.dueAt <= NOW);

  const wrap = <T>(fn: () => T): Promise<T> => {
    try {
      return respond(fn());
    } catch (e) {
      return reject(e instanceof ApiError ? e : err(500, 'INTERNAL', String(e)));
    }
  };


  // ---------------------------------------------------------------- W6 helpers

  function requireType(id: number, type: 'explain-back' | 'patch-kata') {
    const { u, d } = guard(id, { needCheck: true });
    if (d.check?.spec.type !== type) throw err(409, 'WRONG_UNIT_KIND', `unit ${id} is not a ${type} unit`);
    return { u, d };
  }

  function recordAttempt(u: UnitSummary, answer: unknown, selfAssisted: boolean): number {
    const attemptId = nextId++;
    attempts.set(attemptId, {
      id: attemptId,
      unitId: u.id,
      unitTitle: u.title,
      unitKind: u.kind,
      mode: revealed.has(u.id) ? 'guided' : selfAssisted ? 'assisted' : 'solo',
      outcome: 'submitted',
      answer,
      createdAt: NOW,
      runs: [],
      evidenceIds: [],
    });
    return attemptId;
  }

  function fileEvidence(
    u: UnitSummary,
    attemptId: number,
    kind: 'explain-back' | 'kata',
    score: number,
    observation: string,
    competencies: CompetencyId[],
    /** derived from the attempt's mode unless given (a practice attempt is assisted with source 'practice') */
    assistance?: EvidenceRowDto['assistance'],
  ): number[] {
    const a = attempts.get(attemptId)!;
    const ids = competencies.map((competency) => {
      const id = nextId++;
      evidence.unshift({
        id,
        competency,
        kind,
        intention:
          kind === 'kata'
            ? 'patch-review kata: findings first, then self-score'
            : assistance === 'practice'
              ? 'explain-back PRACTICE retake: the key was already seen; scored for feedback only'
              : 'explain-back with the code hidden',
        observation,
        assistance: assistance ?? (a.mode === 'solo' ? 'none' : a.mode === 'assisted' ? 'self' : 'reveal'),
        assessor: 'self',
        rating: null,
        verified: false,
        score,
        attemptId,
        unitId: u.id,
        unitTitle: u.title,
        createdAt: NOW,
      });
      return id;
    });
    a.evidenceIds.push(...ids);
    return ids;
  }

  function exactMarks(expected: string[], got: Record<string, string>) {
    const missing = expected.filter((k) => !(k in got));
    const extra = Object.keys(got).filter((k) => !expected.includes(k));
    if (missing.length || extra.length) {
      throw err(400, 'VALIDATION', `mark every id exactly once (missing: ${missing.join(',')}; extra: ${extra.join(',')})`);
    }
  }

  /** W8: mirrors the server's study-quiz submit — full answer set, >= 80%, misses -> review cards (deduped), keys never echoed. */
  function studySubmit(u: UnitSummary, body: { answers?: number[]; selfAssisted: boolean }): SubmitResponse {
    const sq = studyQuestFixtures[String(u.id)]!;
    const answers = body.answers;
    if (answers === undefined) throw err(400, 'VALIDATION', 'study-quiz checks take `answers`');
    if (answers.length !== sq.keys.length) throw err(400, 'VALIDATION', `send exactly ${sq.keys.length} answers`);
    const items = sq.public.questions.map((q, i) => ({ itemKey: q.itemKey, correct: answers[i] === sq.keys[i] }));
    const correct = items.filter((i) => i.correct).length;
    const passed = correct * 100 >= 80 * items.length;
    let created = 0;
    let alreadyQueued = 0;
    for (const i of items.filter((x) => !x.correct)) {
      if (studyMissCards.has(i.itemKey)) alreadyQueued++;
      else {
        studyMissCards.add(i.itemKey);
        created++;
      }
    }
    const missed = items.map((x, n) => (x.correct ? null : n + 1)).filter((n): n is number => n !== null);
    const firstPass = passed && !studyPassed.has(u.id);
    let xp: SubmitResponse['xp'] = null;
    if (passed) {
      xp = firstPass ? { id: nextId++, amount: 50, reason: null } : { id: nextId++, amount: 0, reason: 'already-awarded' };
      studyPassed.add(u.id);
      u.state = 'done';
    }
    const mode = body.selfAssisted ? ('assisted' as const) : ('solo' as const);
    const attemptId = nextId++;
    studyAnswered.add(u.id);
    recordGraded(u, 'study-quiz', attemptId, mode, passed);
    return {
      result: passed
        ? { pass: true, output: `${correct}/${items.length} correct`, failures: [], durationMs: 0 }
        : { pass: false, output: `${correct}/${items.length} correct`, failures: missed.map((n) => ({ name: `Q${n}`, message: 'incorrect' })), durationMs: 0 },
      verdict: passed ? 'pass' : 'fail',
      attempt: { id: attemptId, mode, outcome: passed ? 'pass' : 'fail' },
      runId: nextId++,
      xp,
      evidenceIds: [nextId++],
      studyQuiz: {
        correct,
        total: items.length,
        score: correct / items.length,
        passPct: 80,
        passed,
        items,
        reviewCards: { created, alreadyQueued, dueAt: missed.length ? NOW + DAY_MS : null },
        flashcardsEnrolled: firstPass ? sq.public.flashcards : 0,
      },
    };
  }

  const ebKeyPoints = (unitId: number) =>
    explainBackFixtures[String(unitId)]!.questions.map((q, qi) => ({
      prompt: q.prompt,
      keyPoints: q.keyPoints.map((kp, ki) => ({ id: `q${qi + 1}k${ki + 1}`, text: kp.text, quote: kp.quote, cite: kp.cite })),
    }));
  const kataDefects = (unitId: number) => kataFixtures[String(unitId)]!.defects.map((d, i) => ({ id: `d${i + 1}`, ...d }));

  // ---- answers per item VERSION (server ladder-service currentAnswer / notAnswered / alreadyAnswered)
  type AnswerKind = 'explainBack' | 'kata';
  const ITEM: Record<AnswerKind, { key: (id: number) => string; noun: string; what: string; path: string }> = {
    explainBack: { key: (id) => `seed:explain-back:mock-${id}`, noun: 'answer', what: 'answers', path: 'explain-back/answers' },
    kata: { key: (id) => `seed:patch-kata:mock-${id}`, noun: 'findings', what: 'findings', path: 'kata/findings' },
  };
  /** The answer OF RECORD for the item as now loaded: the first one stamped with its current version. */
  const currentAnswer = <T>(store: Map<number, StoredAnswer<T>[]>, unitId: number): StoredAnswer<T> | undefined =>
    (store.get(unitId) ?? []).find((a) => a.version === versionOf(unitId));
  const recordAnswer = <T>(store: Map<number, StoredAnswer<T>[]>, unitId: number, a: StoredAnswer<T>) => store.set(unitId, [...(store.get(unitId) ?? []), a]);
  /** Answers recorded against an EARLIER version of the item (server ladder-service supersededAnswerIds). */
  const supersededAnswerIds = <T>(store: Map<number, StoredAnswer<T>[]>, unitId: number): number[] =>
    (store.get(unitId) ?? []).filter((a) => a.version !== versionOf(unitId)).map((a) => a.attemptId);
  /** 403 NOT_ANSWERED for the loaded version, naming any superseded earlier-version answer. */
  function notAnswered<T>(store: Map<number, StoredAnswer<T>[]>, unitId: number, kind: AnswerKind): ApiError {
    const it = ITEM[kind];
    const old = supersededAnswerIds(store, unitId).map((n) => `#${n}`);
    const superseded = old.length
      ? `your earlier ${it.noun} ${old.join(', ')} answered an earlier version of ${it.key(unitId)} (re-seeded since) and ${old.length === 1 ? 'is' : 'are'} superseded; `
      : '';
    return err(403, 'NOT_ANSWERED', `unit ${unitId}: ${superseded}record your ${it.what} first (POST /api/units/${unitId}/${it.path}) — the key is shown only after`);
  }
  const alreadyAnswered = (unitId: number, _prior: { attemptId: number }, kind: AnswerKind) =>
    err(403, 'ALREADY_ANSWERED', `unit ${unitId}: your ${kind === 'kata' ? 'findings' : 'explain-back answer'} ${kind === 'kata' ? 'are' : 'is'} recorded and immutable; open the key instead`);

  /**
   * Ladder dead end #2 (server engines/ladder.ts artifactsAwaitingSoloPass): the explain-back's
   * project-kind prerequisites that have a check, were never revealed, and still lack a SOLO
   * verified pass. Non-empty = the once-only answer is refused (409 ARTIFACT_REQUIRED).
   */
  function artifactsAwaitingSoloPass(unitId: number): { unitId: number; title: string }[] {
    const u = findUnit(unitId);
    if (!u || u.kind !== 'explain-back') return [];
    return u.prerequisites
      .map((id) => findUnit(id))
      .filter((p): p is UnitSummary => p !== null && PROJECT_UNIT_KINDS.has(p.kind) && detail(p).check !== null && !revealed.has(p.id) && !soloPassedUnits.has(p.id))
      .sort((a, b) => a.id - b.id)
      .map((p) => ({ unitId: p.id, title: p.title }));
  }

  // ---- explain-back retakes (server ladder-service practiceAttempts / ebSiblings / ebSetGate)
  /** practice attempts of the item version now loaded */
  const practiceOf = (unitId: number) => (ebPractice.get(unitId) ?? []).filter((p) => p.version === versionOf(unitId));
  function practiceState(unitId: number): NonNullable<ExplainBackPublic['practice']> {
    const rec = currentAnswer(ebAnswers, unitId);
    const rows = practiceOf(unitId);
    const latest = rows[rows.length - 1];
    return {
      available: rec !== undefined && scores.has(rec.attemptId),
      count: rows.length,
      latestUnscoredAttemptId: latest && !scores.has(latest.attemptId) ? latest.attemptId : null,
    };
  }
  const setLabel = (unitId: number) => explainBackFixtures[String(unitId)]?.altSet?.set?.toUpperCase() ?? 'A';
  /** loaded sibling sets (same altSet.group; itself included), in fixture (load) order */
  function ebSiblings(unitId: number): number[] {
    const group = explainBackFixtures[String(unitId)]?.altSet?.group;
    if (group === undefined) return [unitId];
    return Object.entries(explainBackFixtures)
      .filter(([, f]) => f.altSet?.group === group)
      .map(([k]) => Number(k))
      .filter((k) => findUnit(k) !== null);
  }
  /** a FRESH answer opens >= 2 days after the newest fresh (non-practice) answer of any sibling, any version */
  function ebSetGate(unitId: number): { open: boolean; opensAt: number | null } {
    const sibs = ebSiblings(unitId);
    if (sibs.length < 2) return { open: true, opensAt: null };
    const ats = sibs.flatMap((s) => (ebAnswers.get(s) ?? []).map((a) => a.at));
    if (ats.length === 0) return { open: true, opensAt: null };
    const opensAt = Math.max(...ats) + 2 * DAY_MS;
    return { open: NOW >= opensAt, opensAt };
  }
  function altSetsFor(unitId: number): ExplainBackPublic['altSets'] {
    const sibs = ebSiblings(unitId);
    if (sibs.length < 2) return undefined;
    return {
      group: explainBackFixtures[String(unitId)]!.altSet!.group,
      label: setLabel(unitId),
      siblings: sibs.map((s) => {
        const rec = currentAnswer(ebAnswers, s);
        return { unitId: s, label: setLabel(s), answered: rec !== undefined, scored: rec !== undefined && scores.has(rec.attemptId) };
      }),
      gate: ebSetGate(unitId),
    };
  }

  return {
    getHealth: () => wrap(() => ({ ok: true as const, version: 'mock', counts: { units: allUnits().length, checks: Object.values(fx.details).filter((d) => d.check).length } })),

    getDashboard: () =>
      wrap(() => ({
        ...fx.dashboard,
        heatmap: fx.heatmap,
        competencies: fx.competencies.map((c) => ({ ...c, promotion: promotionFixtures[c.id] ?? emptyPromotion(c.rating) })),
        reviewQueue: { due: queue().length },
      })),

    getTracks: () =>
      wrap(() => ({
        tracks: trackList.map((t) => ({ id: t.id, name: t.name, locked: t.locked, ...trackCounts(t.id, t.locked) })),
      })),

    getTrackUnits: (trackId) =>
      wrap(() => {
        const track = trackList.find((t) => t.id === trackId);
        if (!track) throw err(404, 'NOT_FOUND', `track ${trackId} not found`);
        return { track: { id: track.id, name: track.name, locked: track.locked, ...trackCounts(track.id, track.locked) }, units: units[trackId] ?? [] };
      }),

    getUnit: (id) =>
      wrap((): UnitDetail => {
        const u = findUnit(id);
        if (!u) throw err(404, 'NOT_FOUND', `unit ${id} not found`);
        const d = detail(u);
        const unit: UnitDetail['unit'] = { ...u, code: d.code, competencies: d.competencies, variationOfUnitId: null };
        // Server contract (W2): prose lives at the top level; a quiz serves its
        // question as `instructions`. snippet/rubric arrive with real packs.
        const instructions = Array.isArray(d.instructions)
          ? d.instructions.join('\n\n')
          : (d.instructions ?? d.prompt ?? null);
        const out: UnitDetail = { unit, check: d.check, starter: d.starter, instructions, snippet: null, rubric: null };
        // PUBLIC halves only: questions; diff + context (never key points or defect keys)
        if (d.check?.spec.type === 'explain-back') {
          const eb = explainBackFixtures[String(id)];
          // fix/client-review: + supersededAnswerIds (the server's structured field, see TolerantSuperseded)
          const pub: (ExplainBackPublic & TolerantSuperseded) | null = eb
            ? {
                questions: eb.questions.map((q) => ({ prompt: q.prompt })),
                minCoveragePct: PROMOTION_MIN_COVERAGE * 100,
                answered: currentAnswer(ebAnswers, id) !== undefined,
                artifactRequired: artifactsAwaitingSoloPass(id),
                supersededAnswerIds: supersededAnswerIds(ebAnswers, id),
                practice: practiceState(id),
                ...(altSetsFor(id) ? { altSets: altSetsFor(id) } : {}),
              }
            : null;
          out.explainBack = pub;
        }
        if (d.check?.spec.type === 'patch-kata') {
          const k = kataFixtures[String(id)];
          const pub: (KataPublic & TolerantSuperseded) | null = k
            ? { title: k.title, diff: k.diff, contextFiles: k.contextFiles, answered: currentAnswer(kataAnswers, id) !== undefined, supersededAnswerIds: supersededAnswerIds(kataAnswers, id) }
            : null;
          out.kata = pub;
        }
        // W8: reading list + questions with choices only (the keys stay in the fixture)
        if (d.check?.spec.type === 'study-quiz') out.studyQuest = studyQuestFixtures[String(id)]?.public ?? null;
        // B4: the rubric is withheld until the learner's own answer is recorded
        if (u.kind === 'written') {
          const answered = writtenAnswers.has(id);
          out.written = { answered };
          out.rubric = answered ? (writtenFixtures[String(id)]?.rubric ?? null) : null;
        }
        return out;
      }),

    runUnit: (id, input) =>
      wrap(() => {
        const { d, spec } = guard(id, { needCheck: true });
        if (spec!.type === 'quiz' || spec!.type === 'predict-output' || spec!.type === 'study-quiz') {
          throw err(409, 'RUN_NOT_AVAILABLE', `${spec!.type} checks are submit-only (a free run would reveal the answer)`);
        }
        const body = validateSubmission(input);
        return { result: grade(d, spec!, body) };
      }),

    submitUnit: (id, submission) =>
      wrap(() => {
        const { u, d, spec } = guard(id, { needCheck: true });
        const body = validateSubmission(submission);
        // like the server: the attempt row keeps the learner's own submission, served back by GET /attempts/:id
        const keep = (r: SubmitResponse): SubmitResponse => {
          attempts.set(r.attempt.id, {
            id: r.attempt.id,
            unitId: u.id,
            unitTitle: u.title,
            unitKind: u.kind,
            mode: r.attempt.mode,
            outcome: r.attempt.outcome,
            answer: recordedAnswer(body),
            createdAt: NOW,
            runs: [{ id: r.runId, verdict: r.verdict, durationMs: r.result.durationMs, createdAt: NOW }],
            evidenceIds: r.evidenceIds,
          });
          return r;
        };
        if (spec!.type === 'study-quiz') return keep(studySubmit(u, body));
        if (body.answers !== undefined) throw err(400, 'VALIDATION', '`answers` is for study-quiz units');
        const result = grade(d, spec!, body);
        const wasRevealed = revealed.has(id);
        const mode = wasRevealed ? 'guided' : body.selfAssisted ? 'assisted' : 'solo';
        let xp: GradeResponse['xp'] | null = null;
        if (result.pass) {
          if (wasRevealed) xp = { id: nextId++, amount: 0, reason: 'revealed' };
          else if (awarded.has(id)) xp = { id: nextId++, amount: 0, reason: 'already-awarded' };
          else {
            xp = { id: nextId++, amount: xpFor(u, spec!), reason: null };
            awarded.add(id);
          }
          u.state = 'done';
          passedUnits.add(id);
          if (mode === 'solo') soloPassedUnits.add(id);
        }
        const attemptId = nextId++;
        recordGraded(u, spec!.type, attemptId, mode, result.pass);
        return keep({
          result,
          verdict: result.pass ? ('pass' as const) : ('fail' as const),
          attempt: { id: attemptId, mode, outcome: result.pass ? 'pass' : 'fail' },
          runId: nextId++,
          xp,
          evidenceIds: result.pass ? [nextId++] : [],
        });
      }),

    revealUnit: (id) =>
      wrap((): RevealResponse => {
        const { u, d } = guard(id, { needCheck: true });
        const solution = d.private.solution;
        if (!solution) throw err(404, 'NO_SOLUTION', `unit ${id} has no reference solution in the content store`);
        if (!revealed.has(id)) revealed.set(id, nextId++);
        u.revealed = true;
        return { attemptId: revealed.get(id)!, variationUnitId: null, solution };
      }),

    getSolution: (id) =>
      wrap((): RevealResponse => {
        const u = findUnit(id);
        if (!u) throw err(404, 'NOT_FOUND', `unit ${id} not found`);
        const attemptId = revealed.get(id);
        if (attemptId === undefined) throw err(403, 'NOT_REVEALED', `unit ${id} has not been revealed`);
        const solution = detail(u).private.solution;
        if (!solution) throw err(404, 'NO_SOLUTION', `unit ${id} has no reference solution in the content store`);
        return { attemptId, variationUnitId: null, solution };
      }),

    selfAttest: (id) =>
      wrap(() => {
        const { u } = guard(id, { needCheck: false });
        if (u.kind !== 'reading') throw err(409, 'WRONG_UNIT_KIND', `self-attest is for reading units; unit ${id} is ${u.kind}`);
        if (attested.has(id)) throw err(409, 'ALREADY_ATTESTED', `unit ${id} was already attested`);
        attested.add(id);
        u.state = 'done';
        return { attemptId: nextId++, xp: { id: nextId++, amount: READING_XP, reason: null } };
      }),

    answerWritten: (id, body) =>
      wrap(() => {
        const { u } = guard(id, { needCheck: false });
        if (u.kind !== 'written') throw err(409, 'WRONG_UNIT_KIND', `unit ${id} is ${u.kind}; written answers are for written units only`);
        const b = body as unknown as Record<string, unknown>;
        if (Object.keys(b).some((k) => k !== 'answer' && k !== 'selfAssisted')) throw err(400, 'VALIDATION', 'unrecognized key');
        if (typeof body.answer !== 'string' || body.answer.trim() === '') throw err(400, 'VALIDATION', 'answer must not be empty');
        if (typeof body.selfAssisted !== 'boolean') throw err(400, 'VALIDATION', 'selfAssisted must be boolean');
        const starter = writtenFixtures[String(id)]?.starter;
        if (starter && starter.trim() !== '' && body.answer.trim() === starter.trim()) throw err(422, 'UNTOUCHED_TEMPLATE', `unit ${id}: the answer is the unchanged starter template`);
        const attemptId = recordAttempt(u, { text: body.answer }, body.selfAssisted);
        // append-only, like the server: later answers are new rows; the model answer stays anchored on the FIRST
        if (!writtenAnswers.has(id)) writtenAnswers.set(id, { attemptId, answer: body.answer, at: NOW });
        return { attemptId, mode: attempts.get(attemptId)!.mode, outcome: 'submitted' as const };
      }),

    getModelAnswer: (id) =>
      wrap(() => {
        const { u } = guard(id, { needCheck: false });
        if (u.kind !== 'written') throw err(409, 'WRONG_UNIT_KIND', `unit ${id} is ${u.kind}; model answers are for written units only`);
        const a = writtenAnswers.get(id);
        if (!a) throw err(403, 'NOT_ANSWERED', `unit ${id}: record your own answer first`);
        const w = writtenFixtures[String(id)];
        if (!w) throw err(404, 'NO_SOLUTION', `unit ${id} has no model answer in the content store`);
        return { attemptId: a.attemptId, answer: a.answer, answeredAt: a.at, modelAnswer: w.modelAnswer, rubric: w.rubric };
      }),

    getReviewQueue: (limit) =>
      wrap(() => {
        const due = queue();
        return { count: due.length, items: limit === undefined ? due : due.slice(0, limit) };
      }),

    gradeReview: (itemId, g) =>
      wrap((): GradeResponse => {
        const item = fx.reviewQueue.find((c) => c.id === itemId);
        if (!item) throw err(404, 'NOT_FOUND', `review item ${itemId} not found`);
        if (graded.has(itemId) || item.dueAt > NOW) throw err(409, 'NOT_DUE', `review item ${itemId} is not due`);
        graded.add(itemId);
        return {
          itemId,
          grade: g,
          prevDueAt: item.dueAt,
          nextDueAt: NOW + GRADE_DAYS[g] * DAY_MS,
          xp: { id: nextId++, amount: 1, reason: null },
          demotion: null,
          remainingDue: queue().length,
        };
      }),

    getCampaign: (trackId) =>
      wrap(() => {
        const c = campaigns[trackId];
        if (!c) throw err(404, 'NOT_FOUND', `track ${trackId} not found`);
        return { ...c, acts: campaignActs(trackId), level: 3 };
      }),

    answerExplainBack: (id, body) =>
      wrap(() => {
        const { u } = requireType(id, 'explain-back');
        const eb = explainBackFixtures[String(id)];
        if (!eb) throw err(409, 'CONTENT_PENDING', 'question set not loaded');
        const b = body as unknown as Record<string, unknown>;
        if (Object.keys(b).some((k) => k !== 'answers' && k !== 'selfAssisted')) throw err(400, 'VALIDATION', 'unrecognized key');
        if (
          !Array.isArray(body.answers) ||
          body.answers.length !== eb.questions.length ||
          body.answers.some((a) => typeof a !== 'string' || a.trim() === '')
        ) {
          throw err(400, 'VALIDATION', `send exactly ${eb.questions.length} non-empty answers`);
        }
        // one answer per item VERSION (a superseded earlier-version answer leaves room for one fresh answer)
        const prior = currentAnswer(ebAnswers, id);
        if (prior) throw alreadyAnswered(id, prior, 'explainBack');
        // dead end #2: an answer before the linked artifact's solo pass would burn leg (b) for good
        const pending = artifactsAwaitingSoloPass(id);
        if (pending.length > 0) {
          throw err(
            409,
            'ARTIFACT_REQUIRED',
            `unit ${id}: this explain-back is promotion leg (b) of ${pending.map((p) => `unit ${p.unitId} "${p.title}"`).join(', ')}; ` +
              `pass ${pending.length === 1 ? 'that unit' : 'those units'} solo first (verified submit), then answer — ` +
              'an answer recorded before the artifact can never count, and the set can only be answered once',
          );
        }
        // alternate sets: fresh sets of one question-set group are spaced >= 2 days apart
        const gate = ebSetGate(id);
        if (!gate.open) {
          throw err(
            409,
            'NOT_DUE',
            `unit ${id}: alternate set ${setLabel(id)} of this question set opens at ${new Date(gate.opensAt!).toISOString()} ` +
              '(>= 2 days after your last answer in this set group — spaced repetition, not same-day re-reads)',
          );
        }
        const attemptId = recordAttempt(u, { explainBack: { questionSetKey: ITEM.explainBack.key(id), answers: body.answers } }, body.selfAssisted);
        recordAnswer(ebAnswers, id, { attemptId, at: NOW, version: versionOf(id), body: [...body.answers] });
        return { attemptId, mode: attempts.get(attemptId)!.mode, outcome: 'submitted' as const };
      }),

    getExplainBackKey: (id) =>
      wrap(() => {
        requireType(id, 'explain-back');
        const a = currentAnswer(ebAnswers, id);
        if (!a) throw notAnswered(ebAnswers, id, 'explainBack');
        return {
          attemptId: a.attemptId,
          answeredAt: a.at,
          answers: a.body,
          questions: ebKeyPoints(id),
          scored: scores.get(a.attemptId) ?? null,
          practice: practiceOf(id).map((p) => ({ attemptId: p.attemptId, answeredAt: p.at, answers: p.body, scored: scores.get(p.attemptId) ?? null })),
        };
      }),

    selfScoreExplainBack: (id, body) =>
      wrap(() => {
        const { u } = requireType(id, 'explain-back');
        const a = currentAnswer(ebAnswers, id);
        if (!a) throw notAnswered(ebAnswers, id, 'explainBack');
        if (scores.has(a.attemptId)) throw err(409, 'ALREADY_SCORED', 'already self-scored');
        const eb = explainBackFixtures[String(id)]!;
        const ids = ebKeyPoints(id).flatMap((q) => q.keyPoints.map((k) => k.id));
        exactMarks(ids, body.perKeyPoint);
        const missed = ids.filter((k) => body.perKeyPoint[k] === 'missed');
        const covered = ids.length - missed.length;
        const coverage = covered / ids.length;
        const passed = coverage >= PROMOTION_MIN_COVERAGE;
        const evidenceIds = fileEvidence(u, a.attemptId, 'explain-back', coverage, `${covered}/${ids.length} key points covered`, eb.competencies);
        scores.set(a.attemptId, { score: coverage, evidenceIds, at: NOW });
        let xp: { id: number; amount: number; reason: null | 'already-awarded' } | null = null;
        if (passed) {
          xp = ebXpPaid.has(id) ? { id: nextId++, amount: 0, reason: 'already-awarded' } : { id: nextId++, amount: 20, reason: null };
          ebXpPaid.add(id);
        }
        const retests =
          passed && eb.retest
            ? [{ reviewItemId: nextId++, unitId: eb.retest.unitId, title: eb.retest.title, dueAt: NOW + 2 * DAY_MS, artifactUnitId: eb.retest.artifactUnitId }]
            : [];
        return { attemptId: a.attemptId, covered, total: ids.length, coverage, minCoveragePct: PROMOTION_MIN_COVERAGE * 100, passed, missed, evidenceIds, xp, retests, promotions: [] };
      }),

    practiceExplainBack: (id, body) =>
      wrap(() => {
        const { u } = requireType(id, 'explain-back');
        const eb = explainBackFixtures[String(id)];
        if (!eb) throw err(409, 'CONTENT_PENDING', 'question set not loaded');
        const b = body as unknown as Record<string, unknown>;
        if (Object.keys(b).some((k) => k !== 'answers')) throw err(400, 'VALIDATION', 'unrecognized key');
        if (!Array.isArray(body.answers) || body.answers.length !== eb.questions.length || body.answers.some((a) => typeof a !== 'string' || a.trim() === '')) {
          throw err(400, 'VALIDATION', `send exactly ${eb.questions.length} non-empty answers`);
        }
        const rec = currentAnswer(ebAnswers, id);
        if (!rec) throw notAnswered(ebAnswers, id, 'explainBack');
        if (!scores.has(rec.attemptId)) {
          throw err(409, 'NOT_VERIFIED', `unit ${id}: self-score your answer of record first — practice opens after the first scored answer`);
        }
        const rows = practiceOf(id);
        const latest = rows[rows.length - 1];
        if (latest && !scores.has(latest.attemptId)) throw err(403, 'ALREADY_ANSWERED', `unit ${id}: practice attempt ${practiceOf(id).length} is recorded and unscored; score it first`);
        // assisted by construction (the key of this very version was read)
        const attemptId = recordAttempt(u, { explainBack: { questionSetKey: ITEM.explainBack.key(id), answers: body.answers, practice: true } }, true);
        recordAnswer(ebPractice, id, { attemptId, at: NOW, version: versionOf(id), body: [...body.answers] });
        return { attemptId, mode: attempts.get(attemptId)!.mode, outcome: 'submitted' as const };
      }),

    practiceScoreExplainBack: (id, body) =>
      wrap(() => {
        const { u } = requireType(id, 'explain-back');
        const eb = explainBackFixtures[String(id)];
        if (!eb) throw err(409, 'CONTENT_PENDING', 'question set not loaded');
        const b = body as unknown as Record<string, unknown>;
        if (Object.keys(b).some((k) => k !== 'attemptId' && k !== 'perKeyPoint') || !Number.isInteger(body.attemptId) || body.attemptId <= 0) {
          throw err(400, 'VALIDATION', 'send { attemptId, perKeyPoint }');
        }
        if (!attempts.has(body.attemptId)) throw err(404, 'NOT_FOUND', `attempt ${body.attemptId} not found`);
        const p = practiceOf(id).find((x) => x.attemptId === body.attemptId);
        if (!p) throw err(409, 'NOT_VERIFIED', `attempt ${body.attemptId} is not a practice attempt of the question set loaded on unit ${id}`);
        const ids = ebKeyPoints(id).flatMap((q) => q.keyPoints.map((k) => k.id));
        exactMarks(ids, body.perKeyPoint);
        if (scores.has(p.attemptId)) throw err(409, 'ALREADY_SCORED', `practice attempt ${practiceOf(id).findIndex((x) => x.attemptId === body.attemptId) + 1} is already self-scored (evidence is append-only)`);
        const missed = ids.filter((k) => body.perKeyPoint[k] === 'missed');
        const covered = ids.length - missed.length;
        const coverage = covered / ids.length;
        const evidenceIds = fileEvidence(u, p.attemptId, 'explain-back', coverage, `${covered}/${ids.length} key points covered`, eb.competencies, 'practice');
        scores.set(p.attemptId, { score: coverage, evidenceIds, at: NOW });
        // feedback only: never XP, retests or promotions
        return {
          attemptId: p.attemptId,
          covered,
          total: ids.length,
          coverage,
          minCoveragePct: PROMOTION_MIN_COVERAGE * 100,
          passed: coverage >= PROMOTION_MIN_COVERAGE,
          missed,
          evidenceIds,
          xp: null,
          retests: [],
          promotions: [],
        };
      }),

    submitKataFindings: (id, body) =>
      wrap(() => {
        const { u } = requireType(id, 'patch-kata');
        if (!kataFixtures[String(id)]) throw err(409, 'CONTENT_PENDING', 'kata not loaded');
        if (!Array.isArray(body.findings) || body.findings.length === 0) throw err(400, 'VALIDATION', 'at least one finding');
        for (const f of body.findings) {
          if (Object.keys(f).some((k) => !['scenario', 'evidence', 'consequence'].includes(k))) throw err(400, 'VALIDATION', 'unrecognized key');
          if ([f.scenario, f.evidence, f.consequence].some((v) => typeof v !== 'string' || v.trim() === '')) {
            throw err(400, 'VALIDATION', 'scenario, evidence and consequence are all required');
          }
        }
        const prior = currentAnswer(kataAnswers, id);
        if (prior) throw alreadyAnswered(id, prior, 'kata');
        const attemptId = recordAttempt(u, { kata: { kataKey: ITEM.kata.key(id), findings: body.findings } }, body.selfAssisted);
        recordAnswer(kataAnswers, id, { attemptId, at: NOW, version: versionOf(id), body: clone(body.findings) });
        return { attemptId, mode: attempts.get(attemptId)!.mode, outcome: 'submitted' as const };
      }),

    getKataKey: (id) =>
      wrap(() => {
        requireType(id, 'patch-kata');
        const a = currentAnswer(kataAnswers, id);
        if (!a) throw notAnswered(kataAnswers, id, 'kata');
        return { attemptId: a.attemptId, answeredAt: a.at, findings: a.body, defects: kataDefects(id), scored: scores.get(a.attemptId) ?? null };
      }),

    selfScoreKata: (id, body) =>
      wrap(() => {
        const { u } = requireType(id, 'patch-kata');
        const a = currentAnswer(kataAnswers, id);
        if (!a) throw notAnswered(kataAnswers, id, 'kata');
        if (scores.has(a.attemptId)) throw err(409, 'ALREADY_SCORED', 'already self-scored');
        const ids = kataDefects(id).map((d) => d.id);
        exactMarks(ids, body.perDefect);
        const missed = ids.filter((k) => body.perDefect[k] === 'missed');
        const caught = ids.length - missed.length;
        const catchRate = caught / ids.length;
        const evidenceIds = fileEvidence(u, a.attemptId, 'kata', catchRate, `caught ${caught}/${ids.length}`, kataFixtures[String(id)]!.competencies);
        scores.set(a.attemptId, { score: catchRate, evidenceIds, at: NOW });
        const xp = kataXpPaid.has(id) ? { id: nextId++, amount: 0, reason: 'already-awarded' as const } : { id: nextId++, amount: 15, reason: null };
        kataXpPaid.add(id);
        return { attemptId: a.attemptId, caught, total: ids.length, catchRate, missed, evidenceIds, xp };
      }),

    getCompetencies: () =>
      wrap(() => ({
        competencies: fx.competencies.map((c) => ({ ...c, promotion: promotionFixtures[c.id] ?? emptyPromotion(c.rating) })),
        retests: [],
      })),

    listEvidence: (q = {}) =>
      wrap(() => {
        const rows = evidence.filter((e) => (!q.competency || e.competency === q.competency) && (!q.kind || e.kind === q.kind));
        return { total: rows.length, items: rows.slice(0, q.limit ?? 200) };
      }),

    getAttempt: (attemptId) =>
      wrap((): AttemptDetailResponse => {
        const a = attempts.get(attemptId);
        if (a) return a;
        const ev = evidence.find((e) => e.attemptId === attemptId);
        if (!ev || ev.unitId === null) throw err(404, 'NOT_FOUND', `attempt ${attemptId} not found`);
        const u = findUnit(ev.unitId);
        return {
          id: attemptId,
          unitId: ev.unitId,
          unitTitle: ev.unitTitle ?? u?.title ?? '',
          unitKind: u?.kind ?? 'drill',
          mode: ev.assistance === 'none' ? 'solo' : ev.assistance === 'self' ? 'assisted' : 'guided',
          outcome: ev.kind === 'explain-back' ? 'submitted' : 'pass',
          answer: ev.kind === 'explain-back' ? { explainBack: { answers: ['(fixture answer)'] } } : { code: '// fixture submission' },
          createdAt: ev.createdAt,
          runs: ev.verified ? [{ id: attemptId + 1, verdict: 'pass', durationMs: 412, createdAt: ev.createdAt }] : [],
          evidenceIds: evidence.filter((e) => e.attemptId === attemptId).map((e) => e.id),
        };
      }),

    getKataStats: () =>
      wrap(() => {
        let caught = 0;
        let total = 0;
        let katas = 0;
        let assistedCount = 0;
        // every scored answer counts, superseded ones included (their evidence stands, like the server's)
        for (const [unitId, list] of kataAnswers) {
          for (const a of list) {
            const sc = scores.get(a.attemptId);
            if (!sc) continue;
            // W7 (audit #2): only SOLO answers count toward G1
            if (attempts.get(a.attemptId)?.mode !== 'solo') {
              assistedCount += 1;
              continue;
            }
            const n = kataFixtures[String(unitId)]!.defects.length;
            katas += 1;
            total += n;
            caught += Math.round(sc.score * n);
          }
        }
        const catchRate = total === 0 ? null : caught / total;
        return {
          katasScored: katas,
          assistedCount,
          defectsCaught: caught,
          defectsTotal: total,
          catchRate,
          gate: {
            targetRate: G1_TARGET_RATE,
            minDefects: G1_MIN_DEFECTS,
            met: catchRate !== null && total >= G1_MIN_DEFECTS && catchRate >= G1_TARGET_RATE,
            rule: `G1: catch >= ${G1_TARGET_RATE * 10}/10 seeded defects (scenario + evidence + consequence) across at least ${G1_MIN_DEFECTS} seeded defects`,
          },
        };
      }),

    // ---- campaign 2 B2 stats (fixture-derived; the same shapes and empty-state rules as the server)
    getXpStats: () =>
      wrap((): XpStatsResponse => {
        // the heatmap fixture's daily XP, split deterministically across tracks (mock only)
        const split = (xp: number, i: number): XpByTrack => {
          const none = Math.min(xp, i % 3 === 0 ? 12 : 4);
          const rest = xp - none;
          const cs = i % 2 === 0 ? Math.round(rest * 0.35) : Math.round(rest * 0.15);
          const ag = i % 5 === 0 ? Math.round(rest * 0.2) : 0;
          return { js: rest - cs - ag, csharp: cs, java: 0, agentic: ag, sysdesign: 0, none };
        };
        const all = fx.heatmap.map((d, i) => ({ day: d.day, total: d.xp, byTrack: split(d.xp, i) }));
        const days = all.slice(-90);
        const firstXp = all.findIndex((d) => d.total > 0);
        const weeks: XpStatsResponse['weeks'] = [];
        if (firstXp !== -1) {
          for (const d of all.slice(firstXp)) {
            const noon = Date.parse(`${d.day}T12:00:00Z`);
            const dow = (new Date(noon).getUTCDay() + 6) % 7;
            const ws = new Date(noon - dow * DAY_MS).toISOString().slice(0, 10);
            let w = weeks.at(-1);
            if (!w || w.weekStart !== ws) {
              w = { weekStart: ws, total: 0, byTrack: { js: 0, csharp: 0, java: 0, agentic: 0, sysdesign: 0, none: 0 } };
              weeks.push(w);
            }
            w.total += d.total;
            for (const k of Object.keys(w.byTrack) as (keyof XpByTrack)[]) w.byTrack[k] += d.byTrack[k];
          }
        }
        const sum = (l: { total: number }[]) => l.reduce((n, d) => n + d.total, 0);
        return { today: fx.dashboard.today, days, weeks, totals: { allTime: sum(all), lastDays: sum(days), events: all.filter((d) => d.total > 0).length * 4 } };
      }),

    getPassRates: () =>
      wrap((): PassRatesResponse => ({
        // derived from the recorded graded submits by the server's rule (passRateOf)
        overall: passRateOf(gradedRows),
        byTrack: ratesBy(gradedRows, (r) => r.trackId, RATE_TRACK_ORDER).map(({ key, rate }) => ({ trackId: key, ...rate })),
        byCheckType: ratesBy(gradedRows, (r) => r.checkType, RATE_CHECK_ORDER).map(({ key, rate }) => ({ checkType: key, ...rate })),
      })),

    getReviewStats: () =>
      wrap((): ReviewStatsResponse => {
        const due = queue().length;
        const ahead = [3, 5, 2, 0, 4, 1, 0, 6, 2, 0, 1, 3, 0];
        const today = fx.dashboard.today;
        const dayN = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
        return {
          today,
          cards: due + ahead.reduce((a, b) => a + b, 0) + 9,
          dueNow: due,
          overdue: Math.min(due, 4),
          later: 9,
          forecast: [{ day: today, due }, ...ahead.map((n, i) => ({ day: dayN(i + 1), due: n }))],
          retention: { window: { reviews: 48, recalled: 41, rate: 41 / 48 }, allTime: { reviews: 131, recalled: 109, rate: 109 / 131 } },
          ratings: { again: 22, hard: 17, good: 80, easy: 12 },
        };
      }),

    getCampaignProgress: () =>
      wrap((): CampaignProgressResponse => ({
        tracks: trackList.map((t) => ({
          trackId: t.id,
          name: t.name,
          locked: t.locked,
          progress: trackCounts(t.id, t.locked).progress,
          acts: campaignActs(t.id).map((a) => {
            const reading = a.quests.filter((q) => q.kind === 'reading');
            return {
              actNo: a.ordinal,
              title: a.title,
              unlocked: a.unlocked,
              coreDone: a.progress.coreDone,
              coreTotal: a.progress.coreTotal,
              corePending: a.quests.filter((q) => q.core && q.contentPending && q.state !== 'done').length,
              readingDone: reading.filter((q) => q.state === 'done').length,
              readingTotal: reading.length,
            };
          }),
        })),
      })),

    // "Learn more": mirrors server/src/api/notes-service.ts (the mock/server contract test runs both)
    getUnitNotes: (id) =>
      wrap((): UnitNotesResponse => {
        const { u, d, spec } = guard(id, { needCheck: false });
        if (spec?.type === 'study-quiz') {
          const sq = studyQuestFixtures[String(id)];
          const notes = sq ? (notesFixtures[sq.public.repo] ?? []) : [];
          const kinds = new Map<string, NoteDto['targetKind']>([
            ...(sq?.public.questions ?? []).map((q) => [q.itemKey, 'quiz'] as const),
            ...(sq?.public.readingSteps ?? []).map((r) => [r.key, 'reading-step'] as const),
          ]);
          const order = new Map([...(sq?.public.readingSteps ?? []).map((r) => r.key), ...(sq?.public.questions ?? []).map((q) => q.itemKey)].map((k, n) => [k, n]));
          const rank = (n: NoteFixture) => (n.target === 'pack' ? -1 : (order.get(n.target) ?? 1e9));
          const sorted = [...notes].sort((a, b) => rank(a) - rank(b) || (a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0));
          const dto = (n: NoteFixture): NoteDto => noteDto(n, kinds);
          const after = sorted.filter((n) => n.phase === 'after' && kinds.get(n.target) === 'quiz');
          const answered = studyAnswered.has(id);
          const released: NoteDto[] = [];
          let withheld = 0;
          let nextAt: number | null = null;
          for (const n of after) {
            if (answered && (studyPassed.has(id) || !studyMissCards.has(n.target))) released.push(dto(n));
            else {
              withheld++;
              if (answered) nextAt = NOW + DAY_MS; // a missed question's card is due tomorrow
            }
          }
          const state = after.length === 0 ? 'none' : withheld === 0 ? 'released' : released.length === 0 ? 'locked' : 'partial';
          return {
            unitId: id,
            source: sq ? { repo: sq.public.repo, sha: sq.public.sha } : null,
            readings: sorted.filter((n) => n.phase === 'before').map(dto),
            explanations: { state, message: notesMessage(state, !answered), released, withheld, nextAt },
            refs: [],
            explanation: null,
            solution: null,
          };
        }
        const ownKey = spec?.type === 'explain-back' || spec?.type === 'patch-kata';
        const isRevealed = revealed.has(id);
        const can = !ownKey && u.kind !== 'written' && (passedUnits.has(id) || isRevealed);
        const explanation = can ? (d.private.explanation ?? null) : null;
        const hasAny = Boolean(d.private.explanation) && !ownKey && u.kind !== 'written';
        return {
          unitId: id,
          source: null,
          readings: [],
          explanations: !hasAny
            ? { state: 'none', message: 'This unit has no written explanations yet.', released: [], withheld: 0, nextAt: null }
            : explanation
              ? { state: 'released', message: 'Explanation of the solution.', released: [], withheld: 0, nextAt: null }
              : { state: 'locked', message: 'The explanation unlocks after you pass (or reveal the solution).', released: [], withheld: 1, nextAt: null },
          refs: [],
          explanation,
          solution: !ownKey && isRevealed && spec ? (d.private.solution ?? null) : null,
        };
      }),

    getRefContent: (refId) =>
      wrap((): RefContentResponse => {
        throw err(404, 'NOT_FOUND', `content ref ${refId} not found`);
      }),

    reseedItem: (unitId) => {
      itemVersion.set(unitId, versionOf(unitId) + 1);
    },
  };
}

/** the server's explanation messages (server/src/api/notes-service.ts), word for word */
function notesMessage(state: UnitNotesResponse['explanations']['state'], unanswered: boolean): string {
  if (state === 'none') return 'No written explanations for this quest yet.';
  if (state === 'released') return 'Explanations for every question.';
  if (unanswered) return 'Explanations unlock after you answer: submit the quiz first.';
  return `Explanations for the questions you missed unlock when their review cards are due${state === 'partial' ? '; the ones you answered right are below' : ''}.`;
}

const ghLink = (repo: string, sha: string, path: string, a: number | null, b: number | null): string =>
  `https://github.com/elirc/${encodeURIComponent(repo)}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}` +
  (a !== null && b !== null ? (a === b ? `#L${a}` : `#L${a}-L${b}`) : '');

function noteDto(n: NoteFixture, kinds: ReadonlyMap<string, NoteDto['targetKind']>): NoteDto {
  const { repo, sha } = n.provenance;
  return {
    key: n.key,
    id: n.noteId,
    phase: n.phase,
    target: n.target,
    targetKind: n.target === 'pack' ? 'pack' : (kinds.get(n.target) ?? 'pack'),
    title: n.title,
    body: n.body,
    excerpts: n.excerpts.map((e) => ({ ...e, url: ghLink(repo, sha, e.path, e.lineStart, e.lineEnd), refId: null })),
    readMore: n.readMore.map((r) => ({ ...r, url: ghLink(repo, sha, r.path, r.lineStart, r.lineEnd), refId: null })),
  };
}

export const mockApi: BootQuestApi = createMockApi();
