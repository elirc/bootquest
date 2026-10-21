/**
 * campaign 2 release (F17): the client mock (client/src/api/mock.ts) re-implements two server
 * honesty rules. This contract runs ONE scenario, through the client's own API surface, against
 * BOTH the mock and the real server (built from the mock's own fixture units, reached through the
 * client's real fetch binding, client/src/api/http.ts), so the two cannot drift silently:
 *   1. guided passes: a pass after a reveal is mode 'guided' and pays 0 XP ('revealed'); pass
 *      rates never count it as a pass. Both sides DERIVE the rates from the submits they recorded
 *      (the mock is built with passRateHistory 'empty', like the fresh server DB), and the exact
 *      response is asserted identical; the default (fixture-history) mock must move by the same delta;
 *   2. written units: rubric null and model answer 403 until the learner's own answer exists; the
 *      untouched starter template is refused (422); afterwards both are served;
 *   3. "Learn more" (GET /units/:id/notes): readings before answering, explanations withheld as a
 *      count until a recorded answer covers them (a missed question's stays withheld until its
 *      review card is due), all after a pass; a code unit's explanation after a pass, its solution
 *      only after a reveal. The server side loads the mock's OWN study-quest + notes fixtures;
 *   4. explain-back retakes: PRACTICE re-answers (refused before the scored answer of record, one
 *      unscored at a time, assisted, practice evidence, 0 XP) and ALTERNATE-set rotation (altSets on
 *      the detail; a sibling of an answered set is 409 NOT_DUE for 2 days). The server side loads the
 *      mock's OWN explain-back fixtures as seed items (the alternate sets share one provenance).
 * Cheap: one temp DB, a stand-in drill runner that applies the mock fixture's own pass rule, no
 * real grader. The client modules are loaded dynamically (they are typechecked by the client
 * workspace, not by this server program).
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.ts';
import { mapSeedItemStore } from '../../src/store/seed-items.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import type { Runner } from '../../src/api/runners.ts';
import { fixedClock } from '../../src/engines/clock.ts';
import { insertUnit } from '../../src/store/content.ts';
import { explainBackUnitKey } from '../../src/store/ladder.ts';
import type { SeedExplainBackItem } from '@bootquest/shared';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';

const CLIENT_API = fileURLToPath(new URL('../../../client/src/api/', import.meta.url));

interface SubmitLike {
  verdict: string;
  attempt: { mode: string };
  xp: { amount: number; reason: string | null } | null;
}
interface RateLike {
  attempts: number;
  passes: number;
  guidedPasses: number;
  passRate: number | null;
  units: number;
  firstTryPasses: number;
  firstTryRate: number | null;
}
/** The slice of the client's BootQuestApi this contract drives. */
interface NotesLike {
  readings: { id: string }[];
  explanations: { state: string; message: string; released: { id: string; target: string }[]; withheld: number; nextAt: number | null };
  explanation: string | null;
  solution: unknown;
}
interface AltSetsLike {
  label: string;
  siblings: { unitId: number; label: string; answered: boolean; scored: boolean }[];
  gate: { open: boolean; opensAt: number | null };
}
interface EbScoreLike {
  attemptId: number;
  covered: number;
  total: number;
  passed: boolean;
  xp: unknown;
  retests: unknown[];
  promotions: unknown[];
}
interface ContractApi {
  getUnit(id: number): Promise<{
    rubric: unknown;
    written?: { answered: boolean };
    studyQuest?: { questions: { itemKey: string; choices: string[] }[] } | null;
    explainBack?: { practice?: { available: boolean; count: number; latestUnscoredAttemptId: number | null }; altSets?: AltSetsLike } | null;
  }>;
  answerExplainBack(id: number, body: { answers: string[]; selfAssisted: boolean }): Promise<{ attemptId: number; mode: string }>;
  getExplainBackKey(id: number): Promise<{ attemptId: number; answeredAt: number; practice?: { attemptId: number; answers: string[]; scored: { score: number } | null }[] }>;
  selfScoreExplainBack(id: number, body: { perKeyPoint: Record<string, string> }): Promise<EbScoreLike>;
  practiceExplainBack(id: number, body: { answers: string[] }): Promise<{ attemptId: number; mode: string; outcome: string }>;
  practiceScoreExplainBack(id: number, body: { attemptId: number; perKeyPoint: Record<string, string> }): Promise<EbScoreLike>;
  listEvidence(q?: { kind?: string }): Promise<{ items: { attemptId: number | null; assistance: string; kind: string }[] }>;
  getUnitNotes(id: number): Promise<NotesLike>;
  answerWritten(id: number, body: { answer: string; selfAssisted: boolean }): Promise<unknown>;
  getModelAnswer(id: number): Promise<{ answer: string; modelAnswer: string; rubric: { id: string; label: string }[] }>;
  revealUnit(id: number): Promise<{ solution: unknown }>;
  submitUnit(id: number, body: { code: string; selfAssisted: boolean } | { answers: number[]; selfAssisted: boolean }): Promise<SubmitLike>;
  getPassRates(): Promise<{ overall: RateLike; byTrack: (RateLike & { trackId: string })[]; byCheckType: (RateLike & { checkType: string })[] }>;
}
interface DrillFixture {
  starter?: string;
  check: { spec: { type: string; language: string; tests: { name: string }[] } };
  private: { passWhenIncludes?: string; solution?: { code?: string }; explanation?: string };
}
interface StudyFixture {
  unit: { key: string; title: string };
  public: { repo: string; sha: string; readingSteps: { key: string; title: string; headingPath: string[]; path: string; lines: { start: number; end: number } }[]; questions: { itemKey: string; prompt: string; choices: string[] }[] };
  keys: number[];
}
interface EbFixture {
  competencies: string[];
  questions: { prompt: string; keyPoints: { text: string; quote: string | null; cite: { path: string; lineStart: number; lineEnd: number } | null }[] }[];
  altSet?: { group: string; set?: string };
}
interface WrittenFixture {
  unit: { key: string; title: string; difficulty: number };
  competencies: string[];
  instructions: string;
  starter: string | null;
  modelAnswer: string;
  rubric: { id: string; label: string }[];
}

const EMPTY_RATE: RateLike = { attempts: 0, passes: 0, guidedPasses: 0, passRate: null, units: 0, firstTryPasses: 0, firstTryRate: null };
/** the scenario's exact rates (solo pass, reveal, guided pass), the same on both sides */
const AFTER: RateLike = { attempts: 2, passes: 1, guidedPasses: 1, passRate: 0.5, units: 1, firstTryPasses: 1, firstTryRate: 1 };
const DRILL = 102; // mock fixture: js/reduce-groupby (drill-js, revealable, pass rule `reduce(`)
const WRITTEN = 113; // mock fixture: a written review unit with a starter template
const STUDY = 206; // mock fixture: the borrowbox study quest (5 questions) + its notes
const EB = 105; // mock fixture: explain-back "closures" (3 questions, 5 key points)
const ALT_A = 501; // mock fixture: explain-back alternate sets — the primary set A ...
const ALT_B = 502; // ... and its sibling set B (same provenance)

async function errorOf(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { status: number; code: string };
    return { status: err.status, code: err.code };
  }
  throw new Error('expected the call to be refused');
}

let createMockApi: (opts?: { passRateHistory?: 'fixture' | 'empty' }) => ContractApi;
let drill: DrillFixture;
let written: WrittenFixture;
let drillUnit: { key: string; title: string; difficulty: number };
let study: StudyFixture;
let server: Server;
let tmp: TempDb;
const ids = {
  mock: { drill: DRILL, written: WRITTEN, study: STUDY, drill2: DRILL, eb: EB, altA: ALT_A, altB: ALT_B },
  server: { drill: 0, written: 0, study: 0, drill2: 0, eb: 0, altA: 0, altB: 0 },
};
const apis: Record<'mock' | 'server', () => ContractApi> = { mock: () => createMockApi({ passRateHistory: 'empty' }), server: () => httpApi };
let httpApi: ContractApi;

beforeAll(async () => {
  ({ createMockApi } = (await import(CLIENT_API + 'mock.ts')) as { createMockApi: typeof createMockApi });
  const { createHttpApi } = (await import(CLIENT_API + 'http.ts')) as { createHttpApi: (base: string) => ContractApi };
  const details = ((await import(CLIENT_API + 'fixtures/unit-details.json')) as { default: Record<string, DrillFixture> }).default;
  const units = ((await import(CLIENT_API + 'fixtures/units.json')) as { default: Record<string, { id: number; key: string; title: string; difficulty: number }[]> }).default;
  const { writtenFixtures } = (await import(CLIENT_API + 'fixtures/written.ts')) as { writtenFixtures: Record<string, WrittenFixture> };
  const { studyQuestFixtures, explainBackFixtures } = (await import(CLIENT_API + 'fixtures/ladder.ts')) as {
    studyQuestFixtures: Record<string, StudyFixture>;
    explainBackFixtures: Record<string, EbFixture>;
  };
  const { notesFixtures } = (await import(CLIENT_API + 'fixtures/notes.ts')) as { notesFixtures: Record<string, unknown[]> };
  study = studyQuestFixtures[String(STUDY)]!;
  drill = details[String(DRILL)]!;
  drillUnit = Object.values(units).flat().find((u) => u.id === DRILL)!;
  written = writtenFixtures[String(WRITTEN)]!;
  expect(drill.private.passWhenIncludes).toBeTruthy();
  expect(written.starter).toBeTruthy();

  // the real server, built from the SAME fixture units
  tmp = makeTempDb();
  const clock = fixedClock(localNoon(2026, 10, 1));
  ids.server.drill = insertUnit(
    tmp.db,
    {
      key: drillUnit.key,
      track: 'js',
      kind: 'drill',
      title: drillUnit.title,
      difficulty: drillUnit.difficulty,
      competencies: ['language-fluency'],
      checks: [{ spec: { type: 'drill-js', language: 'js', tests: drill.check.spec.tests.map((t) => ({ name: t.name, code: 'assert.ok(true);' })) } }],
    },
    clock,
  );
  ids.server.written = insertUnit(
    tmp.db,
    { key: written.unit.key, track: 'js', kind: 'written', title: written.unit.title, difficulty: written.unit.difficulty, competencies: written.competencies },
    clock,
  );
  // a second copy of the drill (the guided-pass scenario spends the first one's solo pass)
  ids.server.drill2 = insertUnit(
    tmp.db,
    {
      key: `${drillUnit.key}#notes`,
      track: 'js',
      kind: 'drill',
      title: drillUnit.title,
      difficulty: drillUnit.difficulty,
      competencies: ['language-fluency'],
      checks: [{ spec: { type: 'drill-js', language: 'js', tests: drill.check.spec.tests.map((t) => ({ name: t.name, code: 'assert.ok(true);' })) } }],
    },
    clock,
  );
  // the mock's explain-back fixtures as real seed items: the alternate sets share one provenance (their sibling group)
  const ebItem = (fid: number): SeedExplainBackItem => {
    const f = explainBackFixtures[String(fid)]!;
    return {
      kind: 'explain-back',
      key: `seed:explain-back:mock-${fid}`,
      provenance: { repo: 'mockrepo', sha: study.public.sha, path: f.altSet ? `${f.altSet.group}.md` : `docs/eb-${fid}.md`, lines: { start: 1, end: 1 } },
      citations: [],
      questions: f.questions.map((q) => ({
        prompt: q.prompt,
        keyPoints: q.keyPoints.map((k) => ({ text: k.text, ...(k.quote !== null ? { quote: k.quote } : {}), ...(k.cite !== null ? { cite: k.cite } : {}) })),
      })),
      ...(f.altSet?.set !== undefined ? { set: f.altSet.set } : {}),
    };
  };
  ids.server.eb = insertUnit(
    tmp.db,
    { key: 'contract/explain-closures', track: 'js', kind: 'explain-back', title: 'Explain-back: closures', competencies: ['language-fluency'], checks: [{ spec: { type: 'explain-back', questionSetKey: ebItem(EB).key } }] },
    clock,
  );
  // the sibling lookup resolves units by their LADDER key (store/ladder.ts explainBackUnitKey)
  for (const [k, fid] of [['altA', ALT_A], ['altB', ALT_B]] as const) {
    ids.server[k] = insertUnit(
      tmp.db,
      {
        key: explainBackUnitKey(ebItem(fid)),
        track: 'sysdesign',
        kind: 'explain-back',
        title: `alt set ${fid}`,
        competencies: ['system-design', 'communication'],
        checks: [{ spec: { type: 'explain-back', questionSetKey: ebItem(fid).key } }],
      },
      clock,
    );
  }
  // the mock's study-quest fixture as real seed items (+ its notes, in the stamped SeedNoteItem shape)
  const sq = study.public;
  const prov = (path: string, lines = { start: 1, end: 1 }) => ({ repo: sq.repo, sha: sq.sha, path, lines });
  const seedItems = mapSeedItemStore([
    ...sq.questions.map((q, i) => ({
      kind: 'quiz',
      key: q.itemKey,
      provenance: prov('docs/02-CONCEPTS.md'),
      citations: [],
      variety: 'concept',
      prompt: q.prompt,
      choices: q.choices.map((text) => ({ text, evidence: [] })),
      check: { type: 'quiz', itemKey: q.itemKey, grading: 'choice', answerKey: study.keys[i], choices: q.choices },
      explanation: '',
    })),
    ...sq.readingSteps.map((r) => ({ kind: 'reading-step', key: r.key, provenance: prov(r.path, r.lines), citations: [], title: r.title, headingPath: r.headingPath })),
    ...(notesFixtures[sq.repo] ?? []),
    ...[EB, ALT_A, ALT_B].map((fid) => ebItem(fid)),
  ]);
  ids.server.study = insertUnit(
    tmp.db,
    { key: study.unit.key, track: 'js', kind: 'study', title: study.unit.title, difficulty: 2, competencies: ['code-reading'], checks: [{ spec: { type: 'study-quiz', itemKeys: sq.questions.map((q) => q.itemKey), passPct: 0.8 } }] },
    clock,
  );
  // stand-in grader applying the mock fixture's own pass rule (the contract is about honesty rules, not grading)
  const rule = drill.private.passWhenIncludes!;
  const stand: Runner = async (_spec, sub) =>
    (sub.code ?? '').includes(rule) && !(sub.code ?? '').includes('TODO')
      ? { pass: true, output: '', failures: [], durationMs: 1 }
      : { pass: false, output: '', failures: [{ name: 'stand-in', message: 'fails' }], durationMs: 1 };
  const content = mapContentStore({
    [drillUnit.key]: { ...(drill.starter ? { starter: drill.starter } : {}), solution: drill.private.solution!.code! },
    [`${drillUnit.key}#notes`]: { ...(drill.starter ? { starter: drill.starter } : {}), solution: drill.private.solution!.code!, explanation: drill.private.explanation! },
    [written.unit.key]: { instructions: written.instructions, starter: written.starter!, solution: written.modelAnswer, rubric: written.rubric },
  });
  const app = createApp({ db: tmp.db, clock, runners: { 'drill-js': stand }, content, seedItems });
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, '127.0.0.1', () => ok(s));
  });
  httpApi = createHttpApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`);
}, 60_000);

afterAll(async () => {
  await new Promise<void>((ok) => (server ? server.close(() => ok()) : ok()));
  tmp?.cleanup();
});

describe.each(['mock', 'server'] as const)('F17 contract (%s): the same honesty rules on the same fixture', (side) => {
  it('guided pass: a pass after a reveal is mode guided, pays 0 XP (revealed), and is never counted as a pass', async () => {
    const api = apis[side]();
    const id = ids[side].drill;
    const code = drill.private.solution!.code!;
    expect(await api.getPassRates()).toEqual({ overall: { ...EMPTY_RATE }, byTrack: [], byCheckType: [] }); // both start empty
    const solo = await api.submitUnit(id, { code, selfAssisted: false });
    expect(solo).toMatchObject({ verdict: 'pass', attempt: { mode: 'solo' }, xp: { reason: null } });
    expect(solo.xp!.amount).toBeGreaterThan(0);
    await api.revealUnit(id);
    const guided = await api.submitUnit(id, { code, selfAssisted: false });
    expect(guided).toMatchObject({ verdict: 'pass', attempt: { mode: 'guided' }, xp: { amount: 0, reason: 'revealed' } });
    // pass rates, derived on BOTH sides from the two recorded submits: the guided pass stays in the
    // denominator, is reported apart and is never inside `passes`; first try = the solo pass
    const rates = await api.getPassRates();
    expect(rates).toEqual({ overall: AFTER, byTrack: [{ trackId: 'js', ...AFTER }], byCheckType: [{ checkType: 'drill-js', ...AFTER }] });
  });

  if (side === 'mock') {
    it('the default dev:mock instance (fixture history) applies the same rule: the scenario moves it by exactly the same delta', async () => {
      const api = createMockApi();
      const before = (await api.getPassRates()).overall;
      for (const r of [before, ...(await api.getPassRates()).byTrack]) expect(r.passes + r.guidedPasses).toBeLessThanOrEqual(r.attempts);
      const code = drill.private.solution!.code!;
      await api.submitUnit(DRILL, { code, selfAssisted: false });
      await api.revealUnit(DRILL);
      await api.submitUnit(DRILL, { code, selfAssisted: false });
      const after = (await api.getPassRates()).overall;
      expect({
        attempts: after.attempts - before.attempts,
        passes: after.passes - before.passes,
        guidedPasses: after.guidedPasses - before.guidedPasses,
        units: after.units - before.units,
        firstTryPasses: after.firstTryPasses - before.firstTryPasses,
      }).toEqual({ attempts: AFTER.attempts, passes: AFTER.passes, guidedPasses: AFTER.guidedPasses, units: AFTER.units, firstTryPasses: AFTER.firstTryPasses });
    });
  }

  it('written: rubric withheld and model answer 403 until the own answer exists; the untouched template is refused', async () => {
    const api = apis[side]();
    const id = ids[side].written;
    const before = await api.getUnit(id);
    expect(before.rubric).toBeNull();
    expect(before.written).toEqual({ answered: false });
    expect(await errorOf(api.getModelAnswer(id))).toEqual({ status: 403, code: 'NOT_ANSWERED' });
    expect(await errorOf(api.answerWritten(id, { answer: `\n${written.starter!}  `, selfAssisted: false }))).toEqual({ status: 422, code: 'UNTOUCHED_TEMPLATE' });
    expect(await errorOf(api.getModelAnswer(id))).toEqual({ status: 403, code: 'NOT_ANSWERED' }); // the refusal stored nothing
    const text = `${written.starter!}Recommendation: block. Line 4 writes req.body without an org check.`;
    await api.answerWritten(id, { answer: text, selfAssisted: false });
    const after = await api.getUnit(id);
    expect(after.written).toEqual({ answered: true });
    expect(after.rubric).toEqual(written.rubric);
    const model = await api.getModelAnswer(id);
    expect(model).toMatchObject({ answer: text, modelAnswer: written.modelAnswer, rubric: written.rubric });
  });

  it('"Learn more" study quest: readings now; explanations a count until answered; a fail releases only the right answers; a pass releases all', async () => {
    const api = apis[side]();
    const id = ids[side].study;
    const view = (n: NotesLike) => ({
      readings: n.readings.map((r) => r.id),
      state: n.explanations.state,
      message: n.explanations.message,
      released: n.explanations.released.map((r) => r.id).sort(),
      withheld: n.explanations.withheld,
      waiting: n.explanations.nextAt !== null,
    });
    expect(view(await api.getUnitNotes(id))).toEqual({
      readings: ['r01-start-here', 'r02-locking-a-loan'],
      state: 'locked',
      message: 'Explanations unlock after you answer: submit the quiz first.',
      released: [],
      withheld: 5,
      waiting: false,
    });
    // answers in SERVED order (the server permutes choices): the keyed TEXT located per question
    const served = (await api.getUnit(id)).studyQuest!.questions;
    const right = served.map((q) => {
      const i = study.public.questions.findIndex((x) => x.itemKey === q.itemKey);
      return q.choices.indexOf(study.public.questions[i]!.choices[study.keys[i]!]!);
    });
    const missed = new Set([study.public.questions[3]!.itemKey, study.public.questions[4]!.itemKey]);
    const wrong = served.map((q, i) => (missed.has(q.itemKey) ? (right[i]! + 1) % q.choices.length : right[i]!));
    expect((await api.submitUnit(id, { answers: wrong, selfAssisted: false })).verdict).toBe('fail');
    expect(view(await api.getUnitNotes(id))).toEqual({
      readings: ['r01-start-here', 'r02-locking-a-loan'],
      state: 'partial',
      message: 'Explanations for the questions you missed unlock when their review cards are due; the ones you answered right are below.',
      released: ['x-q1', 'x-q2', 'x-q3'],
      withheld: 2,
      waiting: true,
    });
    expect((await api.submitUnit(id, { answers: right, selfAssisted: false })).verdict).toBe('pass');
    expect(view(await api.getUnitNotes(id))).toMatchObject({ state: 'released', released: ['x-q1', 'x-q2', 'x-q3', 'x-q4', 'x-q5'], withheld: 0, waiting: false });
  });

  it('explain-back practice: refused before the SCORED answer of record; assisted, 0 XP, practice evidence; one unscored at a time; the record untouched', async () => {
    const api = apis[side]();
    const id = ids[side].eb;
    const body = { answers: ['a', 'b', 'c'] };
    const marks = Object.fromEntries(['q1k1', 'q1k2', 'q2k1', 'q2k2', 'q3k1'].map((k) => [k, 'covered']));
    expect(await errorOf(api.practiceExplainBack(id, body))).toEqual({ status: 403, code: 'NOT_ANSWERED' });
    const rec = await api.answerExplainBack(id, { ...body, selfAssisted: false });
    expect(await errorOf(api.practiceExplainBack(id, body))).toEqual({ status: 409, code: 'NOT_VERIFIED' });
    await api.selfScoreExplainBack(id, { perKeyPoint: marks });
    expect((await api.getUnit(id)).explainBack?.practice).toEqual({ available: true, count: 0, latestUnscoredAttemptId: null });
    const p = await api.practiceExplainBack(id, body);
    expect(p).toMatchObject({ mode: 'assisted', outcome: 'submitted' });
    expect(await errorOf(api.practiceExplainBack(id, body))).toEqual({ status: 403, code: 'ALREADY_ANSWERED' });
    expect((await api.getUnit(id)).explainBack?.practice).toEqual({ available: true, count: 1, latestUnscoredAttemptId: p.attemptId });
    expect(await errorOf(api.practiceScoreExplainBack(id, { attemptId: rec.attemptId, perKeyPoint: marks }))).toEqual({ status: 409, code: 'NOT_VERIFIED' });
    expect(await errorOf(api.practiceScoreExplainBack(id, { attemptId: 999_999, perKeyPoint: marks }))).toEqual({ status: 404, code: 'NOT_FOUND' });
    const s = await api.practiceScoreExplainBack(id, { attemptId: p.attemptId, perKeyPoint: marks });
    expect(s).toMatchObject({ attemptId: p.attemptId, covered: 5, total: 5, passed: true, xp: null, retests: [], promotions: [] });
    expect(await errorOf(api.practiceScoreExplainBack(id, { attemptId: p.attemptId, perKeyPoint: marks }))).toEqual({ status: 409, code: 'ALREADY_SCORED' });
    const key = await api.getExplainBackKey(id);
    expect(key.attemptId).toBe(rec.attemptId);
    expect(key.practice?.map((x) => ({ attemptId: x.attemptId, answers: x.answers, score: x.scored?.score }))).toEqual([{ attemptId: p.attemptId, answers: body.answers, score: 1 }]);
    const ev = (await api.listEvidence({ kind: 'explain-back' })).items.filter((e) => e.attemptId === p.attemptId);
    expect(ev.map((e) => e.assistance)).toEqual(['practice']);
    expect(await errorOf(api.answerExplainBack(id, { ...body, selfAssisted: false }))).toEqual({ status: 403, code: 'ALREADY_ANSWERED' });
  });

  it('explain-back alternate sets: altSets on the detail; the first answer in a group is never gated, its sibling is then 409 NOT_DUE for 2 days', async () => {
    const api = apis[side]();
    const [a, b] = [ids[side].altA, ids[side].altB];
    const view = (alt: AltSetsLike | undefined) =>
      alt && { label: alt.label, siblings: alt.siblings.map((x) => ({ set: x.unitId === a ? 'unit A' : x.unitId === b ? 'unit B' : x.unitId, label: x.label, answered: x.answered, scored: x.scored })), gate: alt.gate };
    expect(view((await api.getUnit(b)).explainBack?.altSets)).toEqual({
      label: 'B',
      siblings: [
        { set: 'unit A', label: 'A', answered: false, scored: false },
        { set: 'unit B', label: 'B', answered: false, scored: false },
      ],
      gate: { open: true, opensAt: null },
    });
    await api.answerExplainBack(a, { answers: ['a', 'b', 'c'], selfAssisted: false });
    const at = (await api.getExplainBackKey(a)).answeredAt;
    const alt = view((await api.getUnit(b)).explainBack?.altSets);
    expect(alt?.gate).toEqual({ open: false, opensAt: at + 2 * 86_400_000 });
    expect(alt?.siblings[0]).toEqual({ set: 'unit A', label: 'A', answered: true, scored: false });
    expect(await errorOf(api.answerExplainBack(b, { answers: ['a', 'b', 'c'], selfAssisted: false }))).toEqual({ status: 409, code: 'NOT_DUE' });
  });

  it('"Learn more" code unit: explanation locked, released by a pass (no solution), solution only after a reveal', async () => {
    const api = apis[side]();
    const id = ids[side].drill2;
    const n0 = await api.getUnitNotes(id);
    expect({ state: n0.explanations.state, explanation: n0.explanation, solution: n0.solution }).toEqual({ state: 'locked', explanation: null, solution: null });
    await api.submitUnit(id, { code: drill.private.solution!.code!, selfAssisted: false });
    const n1 = await api.getUnitNotes(id);
    expect({ state: n1.explanations.state, explanation: n1.explanation, solution: n1.solution }).toEqual({ state: 'released', explanation: drill.private.explanation, solution: null });
    const rev = await api.revealUnit(id);
    expect((await api.getUnitNotes(id)).solution).toEqual(rev.solution);
  });
});
