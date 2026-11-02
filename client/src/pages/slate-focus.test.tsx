import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';
import { ApiError, type BootQuestApi, type SlateSettingsBody } from '../api/types';
import { renderApp } from '../test/render';

// ab S1 (A1): the daily slate settings: http binding, the mock's ledger, and the dashboard's
// "Choose your focus" card / summary line. A save takes effect TOMORROW; today's slate never moves.

const focusCard = () => screen.findByTestId('slate-focus');
const slateSlots = () => [...document.querySelectorAll<HTMLElement>('.slate [data-slot]')].map((e) => `${e.dataset.slot}:${e.className}`);

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
  it('unconfigured: every drill-slot track on at size 1; a PUT changes tomorrow only; refusals change nothing', async () => {
    const api = createMockApi({ slateSettings: 'unconfigured' });
    const s0 = await api.getSlateSettings();
    expect(s0).toMatchObject({ configured: false, today: '2026-10-07', effectiveDay: '2026-10-08', defaultSize: 1, fullSize: 5 });
    expect(s0.todayTracks.map((t) => [t.trackId, t.enabled, t.size])).toEqual([
      ['js', true, 1],
      ['csharp', true, 1],
      ['java', true, 1],
      ['sysdesign', true, 1],
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
      { tracks: [{ trackId: 'java', enabled: false }, { trackId: 'sysdesign', enabled: false }] },
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

describe('dashboard: Choose your focus (ab A1)', () => {
  it('day one: the card is open; Save sends the choice and says it starts tomorrow; today\'s slate does not move', async () => {
    const { api, puts } = recording();
    const { user } = renderApp('/', api);
    const card = await focusCard();
    expect(within(card).getByRole('heading', { name: 'Choose your focus' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Until you choose, every track gives 1 drill a day.');
    expect(within(card).getAllByRole('checkbox').map((c) => (c as HTMLInputElement).checked)).toEqual([true, true, true, true]);
    expect(within(card).getByTestId('slate-focus-when')).toHaveTextContent("Takes effect tomorrow (Oct 8); today's slate stays as it is.");
    await waitFor(() => expect(slateSlots().length).toBeGreaterThan(0));
    const before = slateSlots();

    await user.click(within(card).getByRole('checkbox', { name: 'JS/TS' }));
    await user.click(within(card).getByRole('checkbox', { name: 'C#/.NET' }));
    expect(within(card).getByRole('combobox', { name: 'JS/TS drills per day' })).toBeDisabled();
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
    expect(slateSlots()).toEqual(before);
  });

  it('every track off: Save is disabled and the card says why; a refused save shows the reason', async () => {
    const base = createMockApi({ slateSettings: 'unconfigured' });
    const api: BootQuestApi = { ...base, putSlateSettings: () => Promise.reject(new ApiError(400, 'VALIDATION', 'at least one track must stay on the daily slate')) };
    const { user } = renderApp('/', api);
    const card = await focusCard();
    for (const name of ['JS/TS', 'C#/.NET', 'Java', 'System design']) await user.click(within(card).getByRole('checkbox', { name }));
    expect(within(card).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(within(card).getByTestId('slate-focus-when')).toHaveTextContent('Keep at least one track on.');
    await user.click(within(card).getByRole('checkbox', { name: 'Java' }));
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('at least one track must stay on the daily slate (VALIDATION)');
    expect(within(card).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('configured: no card, a one-line summary; Change reopens the form with Cancel', async () => {
    const { api, puts } = recording(createMockApi());
    const { user } = renderApp('/', api);
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

  it('a failed settings read never blocks the dashboard: a one-line note with Retry', async () => {
    const base = createMockApi();
    let fail = true;
    const api: BootQuestApi = {
      ...base,
      getSlateSettings: () => (fail ? Promise.reject(new ApiError(0, 'NETWORK', 'down')) : base.getSlateSettings()),
    };
    const { user } = renderApp('/', api);
    const note = await screen.findByTestId('slate-focus-error');
    expect(note).toHaveTextContent('Daily slate settings could not be loaded: Could not reach the BootQuest server. (NETWORK)');
    expect(document.querySelector('.slate')).not.toBeNull();
    fail = false;
    await user.click(within(note).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('slate-focus-summary')).toBeInTheDocument();
  });
});
