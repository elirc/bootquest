import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, WeekResponse } from '../api/types';
import { renderApp } from '../test/render';
import { shiftDay } from './Week';

// rv2 S3 F7: the weekly review page renders the server's numbers, pages by week, saves the reflection (0 XP).

const SLOW = { timeout: 15_000 };
const WEEK: WeekResponse = {
  start: '2026-11-09',
  end: '2026-11-15',
  today: '2026-11-14',
  time: { activeDays: 3, sittings: 4, estMinutes: 95, rule: 'estimated: the rule' },
  passes: { units: 5, firstTime: 4, byKind: [{ kind: 'drill', units: 3 }, { kind: 'study', units: 2 }], selfScored: 1 },
  xp: 140,
  reviews: { graded: 22, again: 5 },
  shakyIdeas: [{ cardKey: 'keyidea:s/idem', section: 's', ideaId: 'idem', idea: 'Store the idempotency key with the result.', again: 3 }],
  notebook: { entries: 3, topCategories: [{ category: 'edge-case', count: 2 }, { category: 'slip', count: 1 }] },
  reflection: { questions: ['Q one?', 'Q two?', 'Q three?'], answers: ['old answer', '', ''], savedAt: Date.UTC(2026, 10, 12) },
};

describe('the weekly review page (/week)', () => {
  it('renders every number of GET /week; previous week re-reads with ?start; no "next" for the current week', async () => {
    const getWeek = vi.fn(async (start?: string) => (start ? { ...WEEK, start: '2026-11-02', end: '2026-11-08' } : WEEK));
    const { user } = renderApp('/week', { ...createMockApi(), getWeek });
    const week = await screen.findByTestId('week', {}, SLOW);
    expect(getWeek).toHaveBeenCalledWith(undefined);
    expect(within(week).getByTestId('week-time')).toHaveTextContent('1 h 35 min');
    expect(within(week).getByTestId('week-time')).toHaveTextContent('4 sittings on 3 days');
    expect(within(week).getByTestId('week-time')).toHaveAttribute('title', 'estimated: the rule');
    expect(within(week).getByTestId('week-passes')).toHaveTextContent('5');
    expect(within(week).getByTestId('week-passes')).toHaveTextContent('4 for the first time · 1 answer self-scored');
    expect(within(week).getByTestId('week-kinds')).toHaveTextContent('3 drill · 2 study');
    expect(within(week).getByTestId('week-xp')).toHaveTextContent('140');
    expect(within(week).getByTestId('week-reviews')).toHaveTextContent('5 rated again');
    expect(within(week).getByTestId('week-shaky')).toHaveTextContent('Store the idempotency key with the result. · rated again 3 times');
    expect(within(week).getByTestId('week-notebook')).toHaveTextContent('3 entries. Most often: Missed an edge case (2), Careless slip (1).');
    expect(within(week).getByRole('textbox', { name: 'Reflection 1' })).toHaveValue('old answer');
    expect(screen.queryByTestId('week-next')).toBeNull();
    await user.click(screen.getByTestId('week-prev'));
    expect(getWeek).toHaveBeenLastCalledWith('2026-11-02');
    expect(await screen.findByTestId('week-next', {}, SLOW)).toBeInTheDocument();
  });

  it('the reflection saves the three answers for the shown week (mock: newest wins) and says so', async () => {
    const base = createMockApi();
    const save = vi.fn(base.saveWeekReflection);
    const api: BootQuestApi = { ...base, saveWeekReflection: save };
    const { user } = renderApp('/week', api);
    await screen.findByTestId('week', {}, SLOW);
    const btn = screen.getByRole('button', { name: 'Save reflection' });
    expect(btn).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Reflection 2' }), 'Lost updates under concurrency.');
    await user.click(btn);
    expect(await screen.findByTestId('week-saved', {}, SLOW)).toHaveTextContent('Saved.');
    const w = await base.getWeek();
    expect(save).toHaveBeenCalledWith({ start: w.start, answers: ['', 'Lost updates under concurrency.', ''] });
    expect(w.reflection.answers).toEqual(['', 'Lost updates under concurrency.', '']);
    // quiet week: the empty texts
    expect(screen.getByTestId('week-shaky-empty')).toBeInTheDocument();
  });

  it('shiftDay crosses months; Stats links here', async () => {
    expect(shiftDay('2026-11-02', -7)).toBe('2026-10-26');
    expect(shiftDay('2026-12-28', 7)).toBe('2027-01-04');
    renderApp('/stats');
    expect(await screen.findByTestId('stats-week-link', {}, SLOW)).toHaveAttribute('href', '/week');
  });
});
