// Campaign 2 B2: Stats page charts (render tests), honest empty states, and ui-audit #26
// (sidebar track % = the server's shared TrackProgress, explained in a tooltip, agreeing with the campaign page).
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, PassRatesResponse, ReviewStatsResponse, TracksResponse, XpStatsResponse } from '../api/types';
import { renderApp } from '../test/render';

/** the page mounts its panels after the dashboard load; give findBy room under multi-agent CPU load (no assertion is timing-based) */
const SLOW = { timeout: 15_000 };

const zeroTrack = { js: 0, csharp: 0, java: 0, agentic: 0, none: 0 };

function emptyStatsApi(): BootQuestApi {
  const base = createMockApi();
  const days = Array.from({ length: 90 }, (_, i) => ({ day: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`, total: 0, byTrack: zeroTrack }));
  const xp: XpStatsResponse = { today: '2026-10-07', days, weeks: [], totals: { allTime: 0, lastDays: 0, events: 0 } };
  const rate = { attempts: 0, passes: 0, guidedPasses: 0, passRate: null, units: 0, firstTryPasses: 0, firstTryRate: null };
  const pass: PassRatesResponse = { overall: rate, byTrack: [], byCheckType: [] };
  const reviews: ReviewStatsResponse = {
    today: '2026-10-07',
    cards: 0,
    dueNow: 0,
    overdue: 0,
    later: 0,
    forecast: Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(7 + i).padStart(2, '0')}`, due: 0 })),
    retention: { window: { reviews: 0, recalled: 0, rate: null }, allTime: { reviews: 0, recalled: 0, rate: null } },
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
  };
  return { ...base, getXpStats: async () => xp, getPassRates: async () => pass, getReviewStats: async () => reviews };
}

describe('Stats: XP over time', () => {
  it('draws 90 daily stacked bars to scale with a legend, a readout and a data table; the toggle switches to all-time weeks', async () => {
    const api = createMockApi();
    const xp = await api.getXpStats();
    const { user } = renderApp('/stats', api);
    const chart = await screen.findByTestId('xp-chart-days', {}, SLOW);
    const bars = chart.querySelectorAll('[data-bar]');
    expect(bars).toHaveLength(90);
    // every bar carries the server total; the top tick is a nice ceiling of the largest one (scale math: lib/chart.test.ts)
    const maxTotal = Math.max(...xp.days.map((d) => d.total));
    const ticks = [...chart.querySelectorAll('.chart-grid text')].map((t) => Number(t.textContent!.replace(/,/g, '')));
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(maxTotal);
    expect(Math.max(...ticks)).toBeLessThan(maxTotal * 2);
    const totals = [...bars].map((b) => Number(b.getAttribute('data-total')));
    expect(totals).toEqual(xp.days.map((d) => d.total));
    // legend names each series present (identity is never colour alone)
    const legend = within(chart).getByRole('list', { name: 'Legend' });
    expect(within(legend).getByText('JS/TS')).toBeInTheDocument();
    expect(within(legend).getByText('Reviews & other')).toBeInTheDocument();
    // keyboard readout
    const svg = within(chart).getByRole('img');
    svg.focus();
    await user.keyboard('{End}');
    const last = xp.days.at(-1)!;
    expect(chart.querySelector('.chart-readout')!.textContent).toMatch(new RegExp(last.total === 0 ? 'no XP' : `${last.total} XP`));
    // data table exists for exact values
    expect(within(chart).getByText('Data table')).toBeInTheDocument();
    // all-time weekly
    await user.click(screen.getByRole('button', { name: 'All time (weekly)' }));
    const weekly = await screen.findByTestId('xp-chart-weeks', {}, SLOW);
    expect(weekly.querySelectorAll('[data-bar]')).toHaveLength(xp.weeks.length);
    expect(screen.getByRole('button', { name: 'All time (weekly)' })).toHaveAttribute('aria-pressed', 'true');
    // weekly table rows carry the year (all-time history can span years)
    const firstWeek = xp.weeks[0]!.weekStart;
    const rowHeader = within(weekly).getAllByRole('row')[1]!;
    expect(rowHeader.textContent).toContain(firstWeek.slice(0, 4));
  });

  it('every bar segment stays inside the plot (labels and marks within bounds)', async () => {
    renderApp('/stats');
    const chart = await screen.findByTestId('xp-chart-days', {}, SLOW);
    const svg = chart.querySelector('svg')!;
    const w = Number(svg.getAttribute('width'));
    const h = Number(svg.getAttribute('height'));
    for (const r of svg.querySelectorAll('rect.chart-bar')) {
      const x = Number(r.getAttribute('x'));
      const y = Number(r.getAttribute('y'));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + Number(r.getAttribute('width'))).toBeLessThanOrEqual(w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + Number(r.getAttribute('height'))).toBeLessThanOrEqual(h);
    }
    for (const t of svg.querySelectorAll('text')) {
      const x = Number(t.getAttribute('x'));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(w);
    }
  });
});

describe('Stats: pass rates, reviews, campaign progress', () => {
  it('pass rates per track and per check type with values as text', async () => {
    renderApp('/stats');
    const panel = await screen.findByTestId('pass-rates', {}, SLOW);
    expect(panel.querySelectorAll('[data-row]')).toHaveLength(2 + 5);
    const js = panel.querySelector('[data-row="js"]')!;
    expect(js.textContent).toContain('80% · 35/44'); // 35/44 = 79.5% -> 80%
    expect(panel.textContent).toContain('First try, solo');
    // passes after a reveal are surfaced as NOT counted, and the legend says so
    expect(screen.getByTestId('pass-guided')).toHaveTextContent('4 passes after a reveal not counted');
    expect(panel.textContent).toContain('Pass rate (passes without a reveal / graded submits)');
    expect(within(panel).getByRole('columnheader', { name: 'Passed after reveal (not counted)' })).toBeInTheDocument();
  });

  it('a group whose only passes came after a reveal shows 0%, never 100%', async () => {
    const base = createMockApi();
    const guidedOnly = { attempts: 1, passes: 0, guidedPasses: 1, passRate: 0, units: 1, firstTryPasses: 0, firstTryRate: 0 };
    const pass: PassRatesResponse = { overall: guidedOnly, byTrack: [{ trackId: 'js', ...guidedOnly }], byCheckType: [{ checkType: 'drill-js', ...guidedOnly }] };
    renderApp('/stats', { ...base, getPassRates: async () => pass });
    const panel = await screen.findByTestId('pass-rates', {}, SLOW);
    expect(panel.querySelector('[data-row="drill-js"]')!.textContent).toContain('0% · 0/1');
    expect(panel.querySelector('[data-row="drill-js"] rect.series-pass')).toBeNull(); // no bar for 0%
    expect(screen.getByTestId('pass-guided')).toHaveTextContent('1 pass after a reveal not counted');
  });

  it('review forecast: 14 day bars labelled from Today, retention and grades', async () => {
    renderApp('/stats');
    const panel = await screen.findByTestId('review-stats', {}, SLOW);
    expect(panel.querySelectorAll('[data-bar]')).toHaveLength(14);
    expect(within(panel).getByText('Today')).toBeInTheDocument();
    expect(within(panel).getByText('85%')).toBeInTheDocument(); // 41/48
    expect(within(panel).getByRole('img', { name: /Review grades: Again 22/ })).toBeInTheDocument();
  });

  it('campaign progress: the shared % per track and the per-act core counts of the campaign map', async () => {
    const api = createMockApi();
    const camp = await api.getCampaign('js');
    renderApp('/stats', api);
    const panel = await screen.findByTestId('campaign-progress', {}, SLOW);
    const js = within(panel).getByRole('region', { name: 'JS/TS + React progress' });
    for (const a of camp.acts) expect(js.textContent).toContain(`${a.progress.coreDone}/${a.progress.coreTotal}`);
    expect(within(panel).getByRole('region', { name: 'Java progress' }).textContent).toContain('Locked');
  });

  it('honest empty states: no fake zero charts, no 0% rates', async () => {
    renderApp('/stats', emptyStatsApi());
    expect(await screen.findByTestId('xp-empty', {}, SLOW)).toHaveTextContent('No XP earned yet.');
    expect(await screen.findByTestId('pass-empty', {}, SLOW)).toHaveTextContent('No graded attempts yet.');
    expect(await screen.findByTestId('review-empty', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByTestId('retention-empty')).toBeInTheDocument();
    const review = screen.getByTestId('review-stats');
    expect(within(review).getAllByText('—')).toHaveLength(2); // retention null, not 0%
    expect(screen.queryByText('Not charted yet: planned for the stats wave.')).not.toBeInTheDocument();
  });
});

describe('ui-audit #26: sidebar track % = campaign core progress, explained in a tooltip', () => {
  it('the sidebar % equals the campaign page line and the act sums; the tooltip states the definition', async () => {
    const api = createMockApi();
    const tracks = await api.getTracks();
    const js = tracks.tracks.find((t) => t.id === 'js')!;
    const camp = await api.getCampaign('js');
    const sum = camp.acts.reduce((s, a) => ({ d: s.d + a.progress.coreDone, t: s.t + a.progress.coreTotal }), { d: 0, t: 0 });
    expect([js.progress.coreDone, js.progress.coreTotal]).toEqual([sum.d, sum.t]);
    expect(js.progress.basis).toBe('campaign-core');

    renderApp('/campaign/js', api);
    const pct = await screen.findByTestId('track-pct-js', {}, SLOW);
    const expected = js.progress.pct === 0 && js.progress.coreDone > 0 ? '<1%' : `${js.progress.pct}%`;
    expect(pct).toHaveTextContent(expected);
    const link = pct.closest('a')!;
    expect(link.getAttribute('title')).toMatch(/campaign core quests done/);
    expect(link.getAttribute('title')).toContain(`${sum.d}/${sum.t}`);
    const line = await screen.findByTestId('track-progress', {}, SLOW);
    await waitFor(() => expect(line).toHaveTextContent(expected), SLOW);
    expect(line).toHaveTextContent(`${sum.d}/${sum.t} core quests, all acts`);
    expect(within(line).getByText(expected).getAttribute('title')).toBe(link.getAttribute('title'));
  });

  it('a plain navigation never re-reads the slow /tracks endpoint; only opening the campaign re-validates (W10 policy)', async () => {
    const base = createMockApi();
    let calls = 0;
    const api: BootQuestApi = { ...base, getTracks: async () => (calls++, base.getTracks()) };
    const { user, path } = renderApp('/campaign/js', api);
    expect(await screen.findByTestId('track-pct-js', {}, SLOW)).toBeInTheDocument();
    expect(calls).toBe(1);
    const nav = within(screen.getByRole('complementary', { name: 'Primary' }));
    await user.click(nav.getByRole('link', { name: /^Stats/ }));
    await screen.findByTestId('pass-rates', {}, SLOW);
    await user.click(nav.getByRole('link', { name: /^Dashboard/ }));
    await user.click(nav.getByRole('link', { name: /^Review/ }));
    expect(calls).toBe(1); // stats, dashboard and review never re-read /tracks
    await user.click(nav.getByRole('link', { name: /^Campaign/ }));
    await waitFor(() => expect(path()).toBe('/campaign/js'), SLOW);
    expect(await screen.findByTestId('track-progress', {}, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(calls).toBe(2), SLOW); // the campaign mount re-validates exactly once
    expect(document.querySelectorAll('.track-skel')).toHaveLength(0);
  });

  it('after Mark as read succeeds, the sidebar % moves in place (one background re-read), never flashing placeholders', async () => {
    const base = createMockApi();
    let pct = 0;
    let calls = 0;
    const api: BootQuestApi = {
      ...base,
      getTracks: async (): Promise<TracksResponse> => {
        calls++;
        const t = await base.getTracks();
        return { tracks: t.tracks.map((x) => (x.id === 'js' ? { ...x, progress: { ...x.progress, basis: 'campaign-core', pct, coreDone: pct ? 1 : 0 } } : x)) };
      },
      selfAttest: async (id) => {
        const r = await base.selfAttest(id);
        pct = 25; // the server-side progress moved
        return r;
      },
    };
    const { user } = renderApp('/play/104', api);
    expect(await screen.findByTestId('track-pct-js', {}, SLOW)).toHaveTextContent('0%');
    await user.click(await screen.findByRole('button', { name: /Mark as read/ }, SLOW));
    expect(await screen.findByText('+5 XP', {}, SLOW)).toBeInTheDocument();
    // the recorded attest refreshes /tracks in the background: the % moves without navigating
    await waitFor(() => expect(screen.getByTestId('track-pct-js')).toHaveTextContent('25%'), SLOW);
    expect(calls).toBe(2);
    expect(document.querySelectorAll('.track-skel')).toHaveLength(0);
    await user.click(screen.getByRole('link', { name: /Stats/ }));
    expect(screen.getByTestId('track-pct-js')).toHaveTextContent('25%');
    // plain navigations after it cost nothing
    await user.click(screen.getByRole('link', { name: /Dashboard/ }));
    expect(calls).toBe(2);
  });

  it('a rejected progress mutation does not mark the list stale', async () => {
    const base = createMockApi();
    let calls = 0;
    const api: BootQuestApi = {
      ...base,
      getTracks: async () => (calls++, base.getTracks()),
      selfAttest: () => Promise.reject(new Error('boom')),
    };
    const { user } = renderApp('/play/104', api);
    await user.click(await screen.findByRole('button', { name: /Mark as read/ }, SLOW));
    await user.click(screen.getByRole('link', { name: /Stats/ }));
    await screen.findByTestId('pass-rates', {}, SLOW);
    expect(calls).toBe(1);
  });

  it('a track without campaign core quests uses practice units; locked java shows the lock, not a %', async () => {
    renderApp('/stats');
    const ag = await screen.findByTestId('track-pct-agentic', {}, SLOW);
    expect(ag.closest('a')!.getAttribute('title')).toMatch(/practice units done|No progress counted/);
    expect(screen.queryByTestId('track-pct-java')).not.toBeInTheDocument();
  });
});
