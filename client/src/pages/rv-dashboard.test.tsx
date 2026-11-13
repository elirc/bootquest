// rv wave C (REVIEW Wave 1b rows 3 + 8; R4-05, R4-10, R4-20, R4-23, N1): one finishable day on the dashboard.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, Dashboard, SlateSettingsResponse } from '../api/types';
import { renderApp } from '../test/render';
import { doneForToday, enabledFundTracks, partialDay } from './Dashboard';

function api(o: { dash?: (d: Dashboard) => Dashboard; settings?: (s: SlateSettingsResponse) => SlateSettingsResponse } = {}): BootQuestApi {
  const base = createMockApi();
  return {
    ...base,
    getDashboard: async () => (o.dash ? o.dash(await base.getDashboard()) : base.getDashboard()),
    ...(o.settings ? { getSlateSettings: async () => o.settings!(await base.getSlateSettings()) } : {}),
  };
}
const withXp = (d: Dashboard, xp: number, complete: boolean): Dashboard => ({
  ...d,
  reviewQueue: { due: 0 },
  streak: { ...d.streak, todayComplete: complete },
  heatmap: d.heatmap.map((h) => (h.day === d.today ? { ...h, xp } : h)),
});

describe('rv wave C: hero and streak agree (R4-05)', () => {
  it('"done" is the streak rule (a complete slate); 50 XP without it is only a kept (partial) day', async () => {
    const d = await createMockApi().getDashboard();
    expect(doneForToday(withXp(d, 55, false))).toBe(false);
    expect(partialDay(withXp(d, 55, false))).toBe(true);
    expect(doneForToday(withXp(d, 0, true))).toBe(true);
    expect(partialDay(withXp(d, 19, false))).toBe(false);
  });

  it('a partial day: the hero says "kept", the streak tile says kept, never "safe"', async () => {
    renderApp('/', api({ dash: (d) => withXp(d, 55, false) }));
    expect(await screen.findByTestId('hero-partial', {}, { timeout: 15_000 })).toHaveTextContent('Streak kept today. Finish the slate to grow it.');
    expect(screen.queryByTestId('hero-done')).toBeNull();
    expect(screen.getByTestId('streak-kept')).toHaveTextContent('Kept today');
    expect(screen.queryByText(/Streak safe/)).toBeNull();
  });

  it('a complete day: hero and tile both say the day counts', async () => {
    renderApp('/', api({ dash: (d) => withXp(d, 10, true) }));
    expect(await screen.findByTestId('hero-done', {}, { timeout: 15_000 })).toHaveTextContent('Done for today ✓ · the streak grows');
    expect(screen.getByTestId('streak-safe')).toHaveTextContent('Today counts ✓');
  });
});

describe('rv wave C: the dashboard page (R4-10, R4-20, R4 §5 CUT)', () => {
  it('no Next up panel, no competency table, no focus form; Settings is one link away', async () => {
    renderApp('/');
    await screen.findByTestId('hero-go', {}, { timeout: 15_000 });
    expect(screen.queryByRole('heading', { name: 'Next up' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Competencies' })).toBeNull();
    expect(screen.queryByTestId('slate-focus')).toBeNull();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('the 10-minute mode lists reviews capped at 20, one step, then stop', async () => {
    renderApp('/', api({ dash: (d) => ({ ...d, reviewQueue: { due: 35 } }) }));
    fireEvent.click(await screen.findByTestId('ten-minute-btn', {}, { timeout: 15_000 }));
    const plan = screen.getByTestId('ten-minute');
    expect(plan).toHaveTextContent('Review 20 cards');
    expect(plan).toHaveTextContent('(stop after 20)');
    expect(plan).toHaveTextContent("Stop. That was the day's minimum.");
  });
});

describe('rv wave C: the primary language (D3)', () => {
  it('the hero ladder is the primary language; an older server falls back to the enabled language tracks', () => {
    const base = { todayTracks: [], tomorrowTracks: [] } as unknown as SlateSettingsResponse;
    const learner = (lang: 'js' | 'csharp' | 'java') => ({ primaryLanguage: lang, primaryChosen: true, campaignStep: false, seniorRep: true });
    expect(enabledFundTracks({ ...base, learner: { today: learner('java'), tomorrow: learner('java') } })).toEqual(['java']);
    expect(enabledFundTracks(undefined)).toEqual(['js']);
  });

  it('the one-time prompt shows until answered, and saves through PUT /settings/learner', async () => {
    const calls: unknown[] = [];
    const base = createMockApi({ slateSettings: 'unconfigured' });
    const a: BootQuestApi = {
      ...base,
      putLearnerSettings: async (b) => {
        calls.push(b);
        return base.putLearnerSettings(b);
      },
    };
    renderApp('/', a);
    const box = await screen.findByTestId('primary-language', {}, { timeout: 15_000 });
    fireEvent.click(box.querySelectorAll('button')[1]!);
    await waitFor(() => expect(calls).toEqual([{ primaryLanguage: 'csharp' }]));
    // the settings re-read says it was answered: the prompt is gone for good
    await screen.findByTestId('hero-go', {}, { timeout: 15_000 });
    await waitFor(() => expect(screen.queryByTestId('primary-language')).toBeNull());
  });
});
