import { describe, expect, it } from 'vitest';
import { createMockApi, fixtures } from './mock';

const DAY = 86_400_000;

describe('fixture contract (shapes the real API must also satisfy)', () => {
  it('heatmap: 90 contiguous days ending today, with gaps and freezes', () => {
    const h = fixtures.heatmap;
    expect(h).toHaveLength(90);
    expect(h[h.length - 1]!.date).toBe(fixtures.dashboard.today);
    for (let i = 1; i < h.length; i++) {
      expect(Date.parse(h[i]!.date) - Date.parse(h[i - 1]!.date)).toBe(DAY);
    }
    expect(h.filter((d) => d.status === 'none').length).toBeGreaterThanOrEqual(10);
    expect(h.some((d) => d.status === 'freeze')).toBe(true);
    for (const d of h) expect(['slate', 'partial', 'freeze', 'none']).toContain(d.status);
  });

  it('competencies: 7 rows, varied ratings, one mid-promotion, exactly one evidence-missing', () => {
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
    expect(new Set(c.map((r) => r.rating)).size).toBeGreaterThanOrEqual(3);
    expect(c.filter((r) => r.lastEvidence === null)).toHaveLength(1);
    expect(c.some((r) => r.promotion?.retest === 'scheduled' && r.promotion.retestDueAt)).toBe(true);
  });

  it('js campaign: 3 acts with mixed lock states; java track locked', () => {
    const js = fixtures.campaigns.js;
    expect(js.acts).toHaveLength(3);
    expect(js.acts.map((a) => a.state)).toEqual(['complete', 'in-progress', 'locked']);
    const stepStates = new Set(js.acts.flatMap((a) => a.steps.map((s) => s.state)));
    expect(stepStates).toEqual(new Set(['complete', 'in-progress', 'available', 'locked']));
    expect(fixtures.tracks.find((t) => t.id === 'java')?.status).toBe('locked');
  });

  it('review queue has 12 cards with unique ids', () => {
    expect(fixtures.reviewQueue).toHaveLength(12);
    expect(new Set(fixtures.reviewQueue.map((c) => c.id)).size).toBe(12);
  });

  it('every dashboard and campaign link resolves to a unit', async () => {
    const api = createMockApi();
    const unitIds = [
      ...fixtures.dashboard.nextUp.map((n) => n.unitId),
      ...fixtures.dashboard.slate.filter((s) => s.href.startsWith('/play/')).map((s) => s.href.slice(6)),
      ...Object.values(fixtures.campaigns).flatMap((c) => c.acts.flatMap((a) => a.steps.map((s) => s.unitId))),
    ].filter((id): id is string => id !== null);
    for (const id of unitIds) await expect(api.getExercise(id)).resolves.toMatchObject({ id });
  });
});

describe('mock behaviour', () => {
  it('never leaks answer keys or grader fixtures to the client', async () => {
    const api = createMockApi();
    const quiz = await api.getExercise('js-quiz-event-loop');
    expect(quiz).not.toHaveProperty('answer');
    expect(await api.getExercise('js-reduce-groupby')).not.toHaveProperty('mock');
  });

  it('awards XP once for a passing submit, zero on reveal', async () => {
    const api = createMockApi();
    const code = 'export const groupBy = (xs, f) => xs.reduce((acc, x) => acc, {});';
    const first = await api.submitAttempt('js-reduce-groupby', code, 'none');
    expect(first).toMatchObject({ xpAwarded: 20, xpZeroReason: null, run: { verdict: 'pass' } });
    const again = await api.submitAttempt('js-reduce-groupby', code, 'none');
    expect(again).toMatchObject({ xpAwarded: 0, xpZeroReason: 'already-awarded' });
    const revealed = await createMockApi().submitAttempt('js-reduce-groupby', code, 'reveal');
    expect(revealed).toMatchObject({ xpAwarded: 0, xpZeroReason: 'revealed' });
  });

  it('grading shrinks the queue and the dashboard count follows', async () => {
    const api = createMockApi();
    await api.gradeReview('rc-js-001', 'good');
    expect(await api.getReviewQueueCount()).toMatchObject({ due: 11 });
    expect((await api.getDashboard()).reviewDue).toBe(11);
    await expect(api.gradeReview('nope', 'good')).rejects.toThrow(/Not found/);
  });

  it('returns copies, so callers cannot mutate fixtures', async () => {
    const api = createMockApi();
    const d = await api.getDashboard();
    d.competencies[0]!.rating = 99;
    expect((await api.getDashboard()).competencies[0]!.rating).toBe(3);
  });
});
