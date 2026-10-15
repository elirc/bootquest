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
 *      untouched starter template is refused (422); afterwards both are served.
 * Cheap: one temp DB, a stand-in drill runner that applies the mock fixture's own pass rule, no
 * real grader. The client modules are loaded dynamically (they are typechecked by the client
 * workspace, not by this server program).
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.ts';
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
interface ContractApi {
  getUnit(id: number): Promise<{ rubric: unknown; written?: { answered: boolean } }>;
  answerWritten(id: number, body: { answer: string; selfAssisted: boolean }): Promise<unknown>;
  getModelAnswer(id: number): Promise<{ answer: string; modelAnswer: string; rubric: { id: string; label: string }[] }>;
  revealUnit(id: number): Promise<{ solution: unknown }>;
  submitUnit(id: number, body: { code: string; selfAssisted: boolean }): Promise<SubmitLike>;
  getPassRates(): Promise<{ overall: RateLike; byTrack: (RateLike & { trackId: string })[]; byCheckType: (RateLike & { checkType: string })[] }>;
}
interface DrillFixture {
  starter?: string;
  check: { spec: { type: string; language: string; tests: { name: string }[] } };
  private: { passWhenIncludes?: string; solution?: { code?: string } };
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
let server: Server;
let tmp: TempDb;
const ids = { mock: { drill: DRILL, written: WRITTEN }, server: { drill: 0, written: 0 } };
const apis: Record<'mock' | 'server', () => ContractApi> = { mock: () => createMockApi({ passRateHistory: 'empty' }), server: () => httpApi };
let httpApi: ContractApi;

beforeAll(async () => {
  ({ createMockApi } = (await import(CLIENT_API + 'mock.ts')) as { createMockApi: typeof createMockApi });
  const { createHttpApi } = (await import(CLIENT_API + 'http.ts')) as { createHttpApi: (base: string) => ContractApi };
  const details = ((await import(CLIENT_API + 'fixtures/unit-details.json')) as { default: Record<string, DrillFixture> }).default;
  const units = ((await import(CLIENT_API + 'fixtures/units.json')) as { default: Record<string, { id: number; key: string; title: string; difficulty: number }[]> }).default;
  const { writtenFixtures } = (await import(CLIENT_API + 'fixtures/written.ts')) as { writtenFixtures: Record<string, WrittenFixture> };
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
  // stand-in grader applying the mock fixture's own pass rule (the contract is about honesty rules, not grading)
  const rule = drill.private.passWhenIncludes!;
  const stand: Runner = async (_spec, sub) =>
    (sub.code ?? '').includes(rule) && !(sub.code ?? '').includes('TODO')
      ? { pass: true, output: '', failures: [], durationMs: 1 }
      : { pass: false, output: '', failures: [{ name: 'stand-in', message: 'fails' }], durationMs: 1 };
  const content = mapContentStore({
    [drillUnit.key]: { ...(drill.starter ? { starter: drill.starter } : {}), solution: drill.private.solution!.code! },
    [written.unit.key]: { instructions: written.instructions, starter: written.starter!, solution: written.modelAnswer, rubric: written.rubric },
  });
  const app = createApp({ db: tmp.db, clock, runners: { 'drill-js': stand }, content });
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
});
