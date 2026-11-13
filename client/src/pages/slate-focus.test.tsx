import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';
import { ApiError, type BootQuestApi, type SlateSettingsBody } from '../api/types';
import { renderApp } from '../test/render';

// ab S1 (A1): the daily slate settings: http binding, the mock's ledger, and the "Choose your focus" card /
// summary line. A save takes effect TOMORROW; today's slate never moves. rv wave C: the card lives on
// /settings (no longer on the dashboard) and every drill set is off by default.

const focusCard = () => screen.findByTestId('slate-focus');

/** the mock with every PUT body recorded */
function recording(base = createMockApi({ slateSettings: 'unconfigured' })): { api: BootQuestApi; puts: SlateSettingsBody[] } {
  const puts: SlateSettingsBody[] = [];
  return {
    puts,
    api: {
      ...base,
      putSlateSettings: (b) => {
        puts.push(structuredClone(b));
        return base.putSlateSettings(b);
      },
    },
  };
}

describe('http client: /settings/slate', () => {
  it('GET then PUT with a whitelisted body (the preset, or trackId / enabled / size per track)', async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const api = createHttpApi('/api', impl);
    await api.getSlateSettings();
    await api.putSlateSettings({ preset: 'full', extra: 1 } as unknown as SlateSettingsBody);
    await api.putSlateSettings({ tracks: [{ trackId: 'java', enabled: true, size: 3, x: 'y' } as never, { trackId: 'js', enabled: false }] });
    expect(calls).toEqual([
      { method: 'GET', url: '/api/settings/slate', body: undefined },
      { method: 'PUT', url: '/api/settings/slate', body: { preset: 'full' } },
      { method: 'PUT', url: '/api/settings/slate', body: { tracks: [{ trackId: 'java', enabled: true, size: 3 }, { trackId: 'js', enabled: false }] } },
    ]);
  });
});

describe('mock slate settings (mirrors server/src/api/settings-service.ts)', () => {
  it('unconfigured: every drill-slot track OFF at size 1 (rv wave C); a PUT changes tomorrow only; refusals change nothing', async () => {
    const api = createMockApi({ slateSettings: 'unconfigured' });
    const s0 = await api.getSlateSettings();
    expect(s0).toMatchObject({ configured: false, today: '2026-10-07', effectiveDay: '2026-10-08', defaultSize: 1, fullSize: 5 });
    expect(s0.todayTracks.map((t) => [t.trackId, t.enabled, t.size])).toEqual([
      ['js', false, 1],
      ['csharp', false, 1],
      ['java', false, 1],
      ['sysdesign', false, 1],
    ]);
    const s1 = await api.putSlateSettings({
      tracks: [
        { trackId: 'js', enabled: false },
        { trackId: 'csharp', enabled: false },
        { trackId: 'java', enabled: true, size: 3 },
        { trackId: 'sysdesign', enabled: true, size: 3 },
      ],
    });
    expect(s1.configured).toBe(true);
    expect(s1.todayTracks).toEqual(s0.todayTracks);
    expect(s1.tomorrowTracks.map((t) => [t.trackId, t.enabled, t.size])).toEqual([
      ['js', false, 1],
      ['csharp', false, 1],
      ['java', true, 3],
      ['sysdesign', true, 3],
    ]);
    const refusals: SlateSettingsBody[] = [
      { tracks: [{ trackId: 'agentic', enabled: true }] },
      { tracks: [{ trackId: 'java', enabled: true }, { trackId: 'java', enabled: false }] },
      { tracks: [{ trackId: 'java', enabled: true, size: 11 }] },
    ];
    for (const b of refusals) await expect(api.putSlateSettings(b)).rejects.toMatchObject({ status: 400, code: 'VALIDATION' });
    expect(await api.getSlateSettings()).toEqual(s1);
    const full = await api.putSlateSettings({ preset: 'full' });
    expect(full.tomorrowTracks.map((t) => [t.enabled, t.size])).toEqual(Array(4).fill([true, 5]));
  });

  it("the default mock is the fixture learner's full preset (configured, 5 per track)", async () => {
    const s = await createMockApi().getSlateSettings();
    expect(s.configured).toBe(true);
    expect(s.todayTracks.map((t) => t.size)).toEqual([5, 5, 5, 5]);
  });
});

describe('/settings: Choose your focus (ab A1, moved off the dashboard in rv wave C)', () => {
  it('day one: the card is open (every set off); Save sends the choice and says it starts tomorrow', async () => {
    const { api, puts } = recording();
    const { user } = renderApp('/settings', api);
    const card = await focusCard();
    expect(within(card).getByRole('heading', { name: 'Choose your focus' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Until you choose, every drill set is off: the Fundamentals step and the senior rep carry the day.');
    expect(within(card).getAllByRole('checkbox').map((c) => (c as HTMLInputElement).checked)).toEqual([false, false, false, false]);
    expect(within(card).getByRole('combobox', { name: 'JS/TS drills per day' })).toBeDisabled();
    await user.click(within(card).getByRole('checkbox', { name: 'Java' }));
    await user.click(within(card).getByRole('checkbox', { name: 'System design' }));
    expect(within(card).getByTestId('slate-focus-when')).toHaveTextContent("Takes effect tomorrow (Oct 8); today's slate stays as it is.");
    await user.selectOptions(within(card).getByRole('combobox', { name: 'Java drills per day' }), '3');
    await user.selectOptions(within(card).getByRole('combobox', { name: 'System design drills per day' }), '3');
    await user.click(within(card).getByRole('button', { name: 'Save' }));

    const summary = await screen.findByTestId('slate-focus-summary');
    expect(summary).toHaveTextContent('Saved. Daily slate from Oct 8: Java ×3 · System design ×3 Change daily slate');
    expect(screen.queryByTestId('slate-focus')).toBeNull();
    expect(puts).toEqual([
      {
        tracks: [
          { trackId: 'js', enabled: false },
          { trackId: 'csharp', enabled: false },
          { trackId: 'java', enabled: true, size: 3 },
          { trackId: 'sysdesign', enabled: true, size: 3 },
        ],
      },
    ]);
  });

  it('every track off is a valid choice (rv wave C); a refused save shows the reason', async () => {
    const base = createMockApi({ slateSettings: 'unconfigured' });
    const api: BootQuestApi = { ...base, putSlateSettings: () => Promise.reject(new ApiError(400, 'VALIDATION', 'no slate track to set')) };
    const { user } = renderApp('/settings', api);
    const card = await focusCard();
    expect(within(card).getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(within(card).getByTestId('slate-focus-when')).toHaveTextContent('Every drill set off: the Fundamentals step and the senior rep carry the day (from Oct 8).');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('no slate track to set (VALIDATION)');
    expect(within(card).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('configured: no card, a one-line summary; Change reopens the form with Cancel', async () => {
    const { api, puts } = recording(createMockApi());
    const { user } = renderApp('/settings', api);
    const summary = await screen.findByTestId('slate-focus-summary');
    expect(summary).toHaveTextContent('Daily slate from Oct 8: JS/TS ×5 · C#/.NET ×5 · Java ×5 · System design ×5');
    expect(screen.queryByRole('heading', { name: 'Choose your focus' })).toBeNull();
    await user.click(within(summary).getByRole('button', { name: 'Change daily slate' }));
    const card = await focusCard();
    expect(within(card).getByRole('heading', { name: 'Daily slate settings' })).toBeInTheDocument();
    expect((within(card).getByRole('combobox', { name: 'Java drills per day' }) as HTMLSelectElement).value).toBe('5');
    await user.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByTestId('slate-focus-summary')).toBeInTheDocument();
    expect(puts).toEqual([]);
  });

  it('a failed settings read never blocks the dashboard (no prompt, the slate still renders)', async () => {
    const base = createMockApi({ slateSettings: 'unconfigured' });
    const api: BootQuestApi = { ...base, getSlateSettings: () => Promise.reject(new ApiError(0, 'NETWORK', 'down')) };
    renderApp('/', api);
    await screen.findByTestId('hero-go', {}, { timeout: 15_000 });
    expect(document.querySelector('.slate')).not.toBeNull();
    expect(screen.queryByTestId('primary-language')).toBeNull();
  });
});
