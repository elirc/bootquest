// Fixture-backed implementation of BootQuestApi. No network, deterministic.
// It mirrors the SERVER's semantics, not just its shapes:
//  - run on quiz / predict-output -> 409 RUN_NOT_AVAILABLE (a free run would be an answer oracle)
//  - a wrong quiz / predict submit never reveals the key; only POST /reveal does
//  - reveal is recorded per unit; afterwards every submit is mode 'guided' with 0 XP ('revealed')
//  - GET /solution -> 403 NOT_REVEALED until revealed
//  - self-attest: reading units only (409 WRONG_UNIT_KIND), once (409 ALREADY_ATTESTED)
//  - submit bodies are strict: exactly one of code/answer + boolean selfAssisted (anything else -> 400 VALIDATION)
// State lives per instance, so tests can make a fresh one.

import competenciesJson from './fixtures/competencies.json';
import dashboardJson from './fixtures/dashboard.json';
import heatmapJson from './fixtures/heatmap.json';
import reviewQueueJson from './fixtures/review-queue.json';
import tracksJson from './fixtures/tracks.json';
import unitDetailsJson from './fixtures/unit-details.json';
import unitsJson from './fixtures/units.json';
import { campaignFixtures, emptyPromotion, evidenceFixtures, explainBackFixtures, kataFixtures, promotionFixtures, studyQuestFixtures } from './fixtures/ladder';
import {
  ApiError,
  type BootQuestApi,
  type CanonicalRunResult,
  type CompetencyId,
  type Dashboard,
  type GradeResponse,
  type HeatmapDay,
  type PublicCheck,
  type RevealResponse,
  type ReviewGrade,
  type ReviewQueueItem,
  type TrackId,
  type TracksResponse,
  type UnitDetail,
  type UnitSummary,
  type AttemptDetailResponse,
  type EvidenceRowDto,
  type KataFinding,
  type SubmitResponse,
  type CampaignActDto,
  type CampaignProgressResponse,
  type PassRatesResponse,
  type ReviewStatsResponse,
  type TrackProgress,
  type XpStatsResponse,
} from './types';
import type { XpByTrack } from '@bootquest/shared/api';

/** Private, fixture-only grading material. Never crosses the API boundary. */
interface PrivateFixture {
  passWhenIncludes?: string;
  failResult?: CanonicalRunResult;
  passResult?: CanonicalRunResult;
  answerKey?: number | string;
  expected?: string;
  solution?: RevealResponse['solution'];
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
}

export function createMockApi(opts: MockApiOptions = {}): BootQuestApi {
  const latency = opts.latencyMs ?? 0;
  const units = clone(fx.units);
  // W8: the study-quest fixture units (csharp borrowbox quest)
  for (const sq of Object.values(studyQuestFixtures)) units[sq.unit.trackId] = [...(units[sq.unit.trackId] ?? []), clone(sq.unit)];
  const studyMissCards = new Set<string>();
  const studyPassed = new Set<number>();
  const graded = new Set<number>();
  const awarded = new Set<number>();
  const revealed = new Map<number, number>(); // unitId -> reveal attemptId
  const attested = new Set<number>();
  let nextId = 5000;
  // W6 answer-first state: unitId -> recorded answer attempt; attemptId -> self-score
  const ebAnswers = new Map<number, { attemptId: number; answers: string[]; at: number }>();
  const kataAnswers = new Map<number, { attemptId: number; findings: KataFinding[]; at: number }>();
  const scores = new Map<number, { score: number; evidenceIds: number[]; at: number }>();
  const kataXpPaid = new Set<number>();
  const ebXpPaid = new Set<number>();
  const evidence: EvidenceRowDto[] = clone(evidenceFixtures);
  const attempts = new Map<number, AttemptDetailResponse>();

  const respond = <T>(value: T): Promise<T> =>
    latency > 0
      ? new Promise((resolve) => setTimeout(() => resolve(clone(value)), latency))
      : Promise.resolve(clone(value));
  const reject = (e: ApiError): Promise<never> =>
    latency > 0 ? new Promise((_, rej) => setTimeout(() => rej(e), latency)) : Promise.reject(e);

  const allUnits = () => Object.values(units).flat();
  const findUnit = (id: number) => allUnits().find((u) => u.id === id) ?? null;
  const trackOf = (id: TrackId) => fx.tracks.tracks.find((t) => t.id === id)!;

  // W8: a passed study quest is done, and its act's core progress follows (derived, like the server)
  function campaignActs(trackId: TrackId): CampaignActDto[] {
    const c = campaignFixtures[trackId];
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
    const eb = explainBackFixtures[String(u.id)];
    if (eb) {
      return {
        code: null,
        competencies: eb.competencies,
        check: { id: 9000 + u.id, threshold: null, spec: { type: 'explain-back', questionSetKey: `seed:explain-back:mock-${u.id}`, questionCount: 3, minCoverage: 0.8 } },
        starter: null,
        private: {},
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
  ): number[] {
    const a = attempts.get(attemptId)!;
    const ids = competencies.map((competency) => {
      const id = nextId++;
      evidence.unshift({
        id,
        competency,
        kind,
        intention: kind === 'kata' ? 'patch-review kata: findings first, then self-score' : 'explain-back with the code hidden',
        observation,
        assistance: a.mode === 'solo' ? 'none' : a.mode === 'assisted' ? 'self' : 'reveal',
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
    return {
      result: passed
        ? { pass: true, output: `${correct}/${items.length} correct`, failures: [], durationMs: 0 }
        : { pass: false, output: `${correct}/${items.length} correct`, failures: missed.map((n) => ({ name: `Q${n}`, message: 'incorrect' })), durationMs: 0 },
      verdict: passed ? 'pass' : 'fail',
      attempt: { id: nextId++, mode: body.selfAssisted ? 'assisted' : 'solo', outcome: passed ? 'pass' : 'fail' },
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
        tracks: fx.tracks.tracks.map((t) => ({ id: t.id, name: t.name, locked: t.locked, ...trackCounts(t.id, t.locked) })),
      })),

    getTrackUnits: (trackId) =>
      wrap(() => {
        const track = fx.tracks.tracks.find((t) => t.id === trackId);
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
          out.explainBack = eb ? { questions: eb.questions.map((q) => ({ prompt: q.prompt })), minCoveragePct: 80, answered: ebAnswers.has(id) } : null;
        }
        if (d.check?.spec.type === 'patch-kata') {
          const k = kataFixtures[String(id)];
          out.kata = k ? { title: k.title, diff: k.diff, contextFiles: k.contextFiles, answered: kataAnswers.has(id) } : null;
        }
        // W8: reading list + questions with choices only (the keys stay in the fixture)
        if (d.check?.spec.type === 'study-quiz') out.studyQuest = studyQuestFixtures[String(id)]?.public ?? null;
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
        if (spec!.type === 'study-quiz') return studySubmit(u, body);
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
        }
        return {
          result,
          verdict: result.pass ? ('pass' as const) : ('fail' as const),
          attempt: { id: nextId++, mode, outcome: result.pass ? 'pass' : 'fail' },
          runId: nextId++,
          xp,
          evidenceIds: result.pass ? [nextId++] : [],
        };
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
        const c = campaignFixtures[trackId];
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
        const prior = ebAnswers.get(id);
        if (prior) throw err(403, 'ALREADY_ANSWERED', `answer #${prior.attemptId} is recorded and immutable`);
        const attemptId = recordAttempt(u, { explainBack: { answers: body.answers } }, body.selfAssisted);
        ebAnswers.set(id, { attemptId, answers: [...body.answers], at: NOW });
        return { attemptId, mode: attempts.get(attemptId)!.mode, outcome: 'submitted' as const };
      }),

    getExplainBackKey: (id) =>
      wrap(() => {
        requireType(id, 'explain-back');
        const a = ebAnswers.get(id);
        if (!a) throw err(403, 'NOT_ANSWERED', 'record your answers first');
        return { attemptId: a.attemptId, answeredAt: a.at, answers: a.answers, questions: ebKeyPoints(id), scored: scores.get(a.attemptId) ?? null };
      }),

    selfScoreExplainBack: (id, body) =>
      wrap(() => {
        const { u } = requireType(id, 'explain-back');
        const a = ebAnswers.get(id);
        if (!a) throw err(403, 'NOT_ANSWERED', 'record your answers first');
        if (scores.has(a.attemptId)) throw err(409, 'ALREADY_SCORED', 'already self-scored');
        const eb = explainBackFixtures[String(id)]!;
        const ids = ebKeyPoints(id).flatMap((q) => q.keyPoints.map((k) => k.id));
        exactMarks(ids, body.perKeyPoint);
        const missed = ids.filter((k) => body.perKeyPoint[k] === 'missed');
        const covered = ids.length - missed.length;
        const coverage = covered / ids.length;
        const passed = coverage >= 0.8;
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
        return { attemptId: a.attemptId, covered, total: ids.length, coverage, minCoveragePct: 80, passed, missed, evidenceIds, xp, retests, promotions: [] };
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
        const prior = kataAnswers.get(id);
        if (prior) throw err(403, 'ALREADY_ANSWERED', `findings #${prior.attemptId} are recorded and immutable`);
        const attemptId = recordAttempt(u, { kata: { findings: body.findings } }, body.selfAssisted);
        kataAnswers.set(id, { attemptId, findings: clone(body.findings), at: NOW });
        return { attemptId, mode: attempts.get(attemptId)!.mode, outcome: 'submitted' as const };
      }),

    getKataKey: (id) =>
      wrap(() => {
        requireType(id, 'patch-kata');
        const a = kataAnswers.get(id);
        if (!a) throw err(403, 'NOT_ANSWERED', 'record your findings first');
        return { attemptId: a.attemptId, answeredAt: a.at, findings: a.findings, defects: kataDefects(id), scored: scores.get(a.attemptId) ?? null };
      }),

    selfScoreKata: (id, body) =>
      wrap(() => {
        const { u } = requireType(id, 'patch-kata');
        const a = kataAnswers.get(id);
        if (!a) throw err(403, 'NOT_ANSWERED', 'record your findings first');
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
        for (const [unitId, a] of kataAnswers) {
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
        const catchRate = total === 0 ? null : caught / total;
        return {
          katasScored: katas,
          assistedCount,
          defectsCaught: caught,
          defectsTotal: total,
          catchRate,
          gate: {
            targetRate: 0.8,
            minDefects: 10,
            met: catchRate !== null && total >= 10 && catchRate >= 0.8,
            rule: 'G1: catch >= 8/10 seeded defects (scenario + evidence + consequence) across at least 10 seeded defects',
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
          return { js: rest - cs - ag, csharp: cs, java: 0, agentic: ag, none };
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
              w = { weekStart: ws, total: 0, byTrack: { js: 0, csharp: 0, java: 0, agentic: 0, none: 0 } };
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
      wrap((): PassRatesResponse => {
        // same rule as the server: a pass after a reveal (guided) is reported, never counted as a pass
        const row = (attempts: number, passes: number, unitsN: number, first: number, guided = 0) => ({
          attempts,
          passes,
          guidedPasses: guided,
          passRate: attempts ? passes / attempts : null,
          units: unitsN,
          firstTryPasses: first,
          firstTryRate: unitsN ? first / unitsN : null,
        });
        return {
          overall: row(62, 47, 41, 29, 4),
          byTrack: [
            { trackId: 'js', ...row(44, 35, 30, 23, 3) },
            { trackId: 'csharp', ...row(18, 12, 11, 6, 1) },
          ],
          byCheckType: [
            { checkType: 'drill-js', ...row(26, 21, 17, 13, 2) },
            { checkType: 'drill-cs', ...row(12, 8, 7, 4, 1) },
            { checkType: 'quiz', ...row(14, 11, 11, 9, 1) },
            { checkType: 'predict-output', ...row(6, 4, 4, 2) },
            { checkType: 'study-quiz', ...row(4, 3, 2, 1) },
          ],
        };
      }),

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
        tracks: fx.tracks.tracks.map((t) => ({
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
  };
}

export const mockApi: BootQuestApi = createMockApi();
