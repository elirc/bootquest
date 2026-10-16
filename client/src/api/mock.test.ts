import { describe, expect, it } from 'vitest';
import { createMockApi, fixtures } from './mock';
import { ApiError, type BootQuestApi } from './types';

const DAY = 86_400_000;
const DRILL = 102; // js groupBy drill
const QUIZ = 103; // js event-loop quiz (answerKey 1)
const READING = 104;
const PREDICT = 203; // cs deferred-execution predict-output
const PASSING = 'export const groupBy = (xs, f) => xs.reduce((acc, x) => acc, {});';

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return (e as ApiError).code;
  }
  throw new Error('expected rejection');
};

describe('fixture contract (server shapes: numeric ids, epoch ms, server enums)', () => {
  it('heatmap: 90 contiguous days ending today, server day statuses', () => {
    const h = fixtures.heatmap;
    expect(h).toHaveLength(90);
    expect(h[h.length - 1]!.day).toBe(fixtures.dashboard.today);
    expect(h[h.length - 1]!.status).toBe('open');
    for (let i = 1; i < h.length; i++) {
      expect(Date.parse(h[i]!.day) - Date.parse(h[i - 1]!.day)).toBe(DAY);
    }
    for (const d of h) expect(['open', 'slate', 'partial', 'frozen', 'missed', 'none']).toContain(d.status);
    expect(h.some((d) => d.status === 'frozen')).toBe(true);
    expect(h.filter((d) => d.status === 'missed').length).toBeGreaterThanOrEqual(10);
  });

  it('competencies: 7 rows with name, numeric rating, epoch-ms evidence; exactly one evidence-missing', () => {
    const c = fixtures.competencies;
    expect(c.map((r) => r.id)).toEqual([
      'language-fluency',
      'feature-delivery',
      'data-http',
      'testing-verification',
      'agentic-engineering',
      'code-reading',
      'communication',
    ]);
    for (const r of c) {
      expect(typeof r.name).toBe('string');
      expect(typeof r.rating).toBe('number');
      if (r.lastEvidence) {
        expect(Number.isInteger(r.lastEvidence.id)).toBe(true);
        expect(Number.isInteger(r.lastEvidence.createdAt)).toBe(true);
      }
    }
    expect(c.filter((r) => r.lastEvidence === null)).toHaveLength(1);
  });

  it('slate uses the server kinds and slots', () => {
    const items = fixtures.dashboard.slate.items;
    expect(new Set(items.map((s) => s.kind))).toEqual(new Set(['drill-set', 'campaign-step', 'review-clear']));
    expect(items.map((s) => s.slot)).toContain('drill:js');
    for (const s of items) expect(typeof s.done).toBe('boolean');
  });

  it('tracks are wrapped in {tracks}; every track ships unlocked (java since 011); unit ids are positive integers', () => {
    expect(fixtures.tracks.tracks.every((t) => !t.locked)).toBe(true);
    for (const u of Object.values(fixtures.units).flat()) {
      expect(Number.isInteger(u.id) && u.id > 0).toBe(true);
      expect(['locked', 'available', 'done']).toContain(u.state);
    }
  });

  it('review queue has 12 items with numeric ids and epoch-ms dueAt', () => {
    expect(fixtures.reviewQueue).toHaveLength(12);
    expect(new Set(fixtures.reviewQueue.map((c) => c.id)).size).toBe(12);
    for (const c of fixtures.reviewQueue) expect(Number.isInteger(c.dueAt)).toBe(true);
  });

  it('every dashboard and campaign link resolves to a unit', async () => {
    const api = createMockApi();
    const ids = [
      ...fixtures.dashboard.nextUp.flatMap((n) => (n.unit ? [n.unit.id] : [])),
      ...Object.values(fixtures.units).flat().map((u) => u.id),
    ];
    for (const id of ids) await expect(api.getUnit(id)).resolves.toMatchObject({ unit: { id } });
  });
});

describe('mock semantics = server semantics', () => {
  it('never leaks answer keys, expected output, solutions or grader fixtures', async () => {
    const api = createMockApi();
    for (const id of [DRILL, QUIZ, PREDICT, READING]) {
      const json = JSON.stringify(await api.getUnit(id));
      for (const banned of ['answerKey', '"expected"', 'solution', 'passWhenIncludes', 'private']) expect(json).not.toContain(banned);
    }
  });

  it('run is 409 RUN_NOT_AVAILABLE for quiz and predict-output (no answer oracle)', async () => {
    const api = createMockApi();
    expect(await codeOf(api.runUnit(QUIZ, { answer: 1 }))).toBe('RUN_NOT_AVAILABLE');
    expect(await codeOf(api.runUnit(PREDICT, { answer: '10,20,30' }))).toBe('RUN_NOT_AVAILABLE');
    await expect(api.runUnit(DRILL, { code: PASSING })).resolves.toMatchObject({ result: { pass: true } });
  });

  it('a wrong quiz submit says incorrect and carries no key', async () => {
    const api = createMockApi();
    const wrong = await api.submitUnit(QUIZ, { answer: 0, selfAssisted: false });
    expect(wrong).toMatchObject({ verdict: 'fail', xp: null, result: { pass: false } });
    const json = JSON.stringify(wrong);
    expect(json).not.toContain('correctIndex');
    expect(json).not.toContain('A D C B');
    expect(wrong.result.failures.every((f) => f.expected === undefined)).toBe(true);
    const right = await api.submitUnit(QUIZ, { answer: 1, selfAssisted: false });
    expect(right).toMatchObject({ verdict: 'pass', xp: { amount: 2, reason: null }, attempt: { mode: 'solo' } });
  });

  it('awards XP once; selfAssisted -> assisted mode; reveal -> guided with 0 XP forever', async () => {
    const api = createMockApi();
    const first = await api.submitUnit(DRILL, { code: PASSING, selfAssisted: true });
    expect(first).toMatchObject({ verdict: 'pass', attempt: { mode: 'assisted' }, xp: { amount: 20, reason: null } });
    const again = await api.submitUnit(DRILL, { code: PASSING, selfAssisted: false });
    expect(again.xp).toMatchObject({ amount: 0, reason: 'already-awarded' });

    const fresh = createMockApi();
    expect(await codeOf(fresh.getSolution(DRILL))).toBe('NOT_REVEALED');
    const revealed = await fresh.revealUnit(DRILL);
    expect(revealed.solution.kind).toBe('code');
    await expect(fresh.getSolution(DRILL)).resolves.toMatchObject({ attemptId: revealed.attemptId });
    expect((await fresh.getUnit(DRILL)).unit.revealed).toBe(true);
    const guided = await fresh.submitUnit(DRILL, { code: PASSING, selfAssisted: false });
    expect(guided).toMatchObject({ attempt: { mode: 'guided' }, xp: { amount: 0, reason: 'revealed' } });
  });

  it('rejects a client-declared assistance field (strict body, like the server)', async () => {
    const api = createMockApi();
    const smuggled = { code: PASSING, selfAssisted: false, assistance: 'none' } as unknown as Parameters<BootQuestApi['submitUnit']>[1];
    expect(await codeOf(api.submitUnit(DRILL, smuggled))).toBe('VALIDATION');
  });

  it('self-attest: reading units only, once', async () => {
    const api = createMockApi();
    expect(await codeOf(api.selfAttest(DRILL))).toBe('WRONG_UNIT_KIND');
    await expect(api.selfAttest(READING)).resolves.toMatchObject({ xp: { amount: 5 } });
    expect(await codeOf(api.selfAttest(READING))).toBe('ALREADY_ATTESTED');
    expect((await api.getUnit(READING)).unit.state).toBe('done');
  });

  it('grading shrinks the queue, the dashboard count follows, re-grading is NOT_DUE', async () => {
    const api = createMockApi();
    const r = await api.gradeReview(1, 'good');
    expect(r).toMatchObject({ itemId: 1, grade: 'good', remainingDue: 11, xp: { amount: 1 } });
    expect(typeof r.nextDueAt).toBe('number');
    expect((await api.getReviewQueue(1)).count).toBe(11);
    expect((await api.getReviewQueue(1)).items).toHaveLength(1);
    expect((await api.getDashboard()).reviewQueue.due).toBe(11);
    expect(await codeOf(api.gradeReview(1, 'good'))).toBe('NOT_DUE');
    expect(await codeOf(api.gradeReview(999, 'good'))).toBe('NOT_FOUND');
  });

  it('unknown unit is NOT_FOUND; a check-less unit cannot be run', async () => {
    const api = createMockApi();
    expect(await codeOf(api.getUnit(9999))).toBe('NOT_FOUND');
    expect(await codeOf(api.runUnit(107, { code: 'x' }))).toBe('NO_CHECK');
  });

  it('returns copies, so callers cannot mutate fixtures', async () => {
    const api = createMockApi();
    const d = await api.getDashboard();
    d.competencies[0]!.rating = 99;
    expect((await api.getDashboard()).competencies[0]!.rating).toBe(3);
  });
});
