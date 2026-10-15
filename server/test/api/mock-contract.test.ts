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
 *      only after a reveal. The server side loads the mock's OWN study-quest + notes fixtures.
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
interface ContractApi {
  getUnit(id: number): Promise<{ rubric: unknown; written?: { answered: boolean }; studyQuest?: { questions: { itemKey: string; choices: string[] }[] } | null }>;
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
const ids = { mock: { drill: DRILL, written: WRITTEN, study: STUDY, drill2: DRILL }, server: { drill: 0, written: 0, study: 0, drill2: 0 } };
const apis: Record<'mock' | 'server', () => ContractApi> = { mock: () => createMockApi({ passRateHistory: 'empty' }), server: () => httpApi };
let httpApi: ContractApi;

beforeAll(async () => {
  ({ createMockApi } = (await import(CLIENT_API + 'mock.ts')) as { createMockApi: typeof createMockApi });
  const { createHttpApi } = (await import(CLIENT_API + 'http.ts')) as { createHttpApi: (base: string) => ContractApi };
  const details = ((await import(CLIENT_API + 'fixtures/unit-details.json')) as { default: Record<string, DrillFixture> }).default;
  const units = ((await import(CLIENT_API + 'fixtures/units.json')) as { default: Record<string, { id: number; key: string; title: string; difficulty: number }[]> }).default;
  const { writtenFixtures } = (await import(CLIENT_API + 'fixtures/written.ts')) as { writtenFixtures: Record<string, WrittenFixture> };
  const { studyQuestFixtures } = (await import(CLIENT_API + 'fixtures/ladder.ts')) as { studyQuestFixtures: Record<string, StudyFixture> };
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
