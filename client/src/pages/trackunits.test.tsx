// Track unit browser ("Practice units") on the Campaign page: primary on campaign-less tracks,
// collapsed secondary below the acts on campaign tracks, absent on locked tracks.
// Grouping / filtering math: lib/trackunits.test.ts.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mock';
import { ApiError, type BootQuestApi, type TrackId, type UnitSummary } from '../api/types';
import { renderApp } from '../test/render';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/** Records every API method called. */
function spyApi(base: BootQuestApi = createMockApi()): { api: BootQuestApi; calls: string[] } {
  const calls: string[] = [];
  const api = Object.fromEntries(
    Object.entries(base).map(([k, fn]) => [k, (...a: unknown[]) => (calls.push(k), (fn as (...x: unknown[]) => unknown)(...a))]),
  ) as unknown as BootQuestApi;
  return { api, calls };
}

/** The mock API, with `units` served for `trackId` (every other track keeps the fixture payload). */
function withUnits(trackId: TrackId, units: UnitSummary[], base: BootQuestApi = createMockApi()): BootQuestApi {
  return {
    ...base,
    getTrackUnits: async (t) => {
      const res = await base.getTrackUnits(t);
      return t === trackId ? { ...res, units } : res;
    },
  };
}

const section = () => screen.findByTestId('track-units');
const row = (id: number) => document.querySelector<HTMLElement>(`[data-unit="${id}"]`);
const rows = () => document.querySelectorAll<HTMLElement>('[data-unit]');

const MODULES = ['01-estimation', '02-caching', '03-queues', '04-sharding', '05-replication', '06-consistency', '07-rate-limiting', '08-storage', '09-search', '10-observability'];
const LOCKED_DRILL = 1001;
const REVEALED_DRILL = 1002;
const BAZAAR_A = 2000;
const BAZAAR_B = 2001;

/** A sysdesign-sized payload: 78 drills over 10 modules + 58 explain-backs over 29 repos (2 each). */
function generated(): UnitSummary[] {
  const drills: UnitSummary[] = Array.from({ length: 78 }, (_, i) => ({
    id: 1000 + i,
    key: `sysdrills/${MODULES[i % 10]}/${String(i).padStart(2, '0')}-drill`,
    trackId: 'sysdesign',
    kind: 'drill',
    title: `Drill ${i}`,
    difficulty: (i % 3) + 1,
    state: 1000 + i === LOCKED_DRILL ? 'locked' : i % 5 === 0 ? 'done' : 'available',
    revealed: 1000 + i === REVEALED_DRILL,
    prerequisites: [],
  }));
  const repos = ['bazaar', ...Array.from({ length: 28 }, (_, i) => `repo${String(i + 1).padStart(2, '0')}`)];
  const ebs: UnitSummary[] = repos.flatMap((repo, r) =>
    [0, 1].map((s) => ({
      id: 2000 + r * 2 + s,
      key: `ladder/explain-back/${repo}/h${r}${s}`,
      trackId: 'sysdesign' as const,
      kind: 'explain-back' as const,
      title:
        repo === 'bazaar'
          ? s === 0
            ? 'DESIGN IT: bazaar — cache coherence across layers for a storefront'
            : 'DESIGN IT: bazaar — personalized pricing on a cached storefront (set B)'
          : `DESIGN IT: ${repo} — topic ${s}`,
      difficulty: null,
      state: 2000 + r * 2 + s === BAZAAR_A ? ('done' as const) : ('available' as const),
      revealed: false,
      prerequisites: [],
    })),
  );
  return [...drills, ...ebs];
}
// 16 drills (i % 5 === 0) + the bazaar primary
const GENERATED_DONE = 17;

describe('track units: campaign-less track (primary)', () => {
  it('/campaign/sysdesign keeps campaign-empty and lists the alt-set units under their repo', async () => {
    renderApp('/campaign/sysdesign');
    const empty = await screen.findByTestId('campaign-empty');
    expect(empty).toHaveTextContent('No campaign acts are seeded for this track yet.');
    expect(empty).toHaveTextContent('Every practice unit on this track is browsable below.');
    const sec = await section();
    expect(within(sec).getByRole('heading', { level: 2, name: 'Practice units' })).toBeInTheDocument();
    await waitFor(() => expect(row(501)).not.toBeNull());
    expect(within(sec).getByRole('heading', { level: 3, name: 'opusorganize (0/2)' })).toBeInTheDocument();
    expect(row(501)!.tagName).toBe('A');
    expect(row(501)).toHaveAttribute('href', '/play/501');
    expect(row(502)).toHaveAttribute('href', '/play/502');
    expect(within(row(502)!).getByText(/\(set B\)$/)).toBeInTheDocument();
    // the browser sits inside the campaign map, below the empty note
    expect(empty.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sec.closest('.campaign')).not.toBeNull();
  });

  describe('136-unit payload (78 drills / 10 modules + 58 explain-backs / 29 repos)', () => {
    // role queries over 136 rows are slow in jsdom: scope them to the small toolbar
    async function open136() {
      const r = renderApp('/campaign/sysdesign', withUnits('sysdesign', generated()));
      const sec = await section();
      const count = await within(sec).findByTestId('track-units-count');
      const toolbar = within(sec.querySelector<HTMLElement>('.tu-toolbar')!);
      const kinds = within(toolbar.getByRole('group', { name: 'Filter by kind' }));
      const groupHeads = () => [...sec.querySelectorAll('h3')].map((h) => h.textContent);
      return { ...r, sec, count, toolbar, kinds, groupHeads };
    }

    it('count line, kind-button counts, 136 [data-unit] rows, done/revealed chips, locked row is a non-link', async () => {
      const { count, kinds, groupHeads } = await open136();
      expect(count).toHaveTextContent(`Showing 136 of 136 units · ${GENERATED_DONE} done`);
      expect(rows()).toHaveLength(136);
      expect(groupHeads()).toHaveLength(10 + 29);
      expect(kinds.getByRole('button', { name: 'All (136)' })).toHaveAttribute('aria-pressed', 'true');
      expect(kinds.getByRole('button', { name: 'Drills (78)' })).toHaveAttribute('aria-pressed', 'false');
      expect(kinds.getByRole('button', { name: 'Explain-backs (58)' })).toBeInTheDocument();
      expect(kinds.queryByRole('button', { name: /^Other/ })).toBeNull();

      expect(within(row(1000)!).getByText('done')).toBeInTheDocument();
      expect(within(row(REVEALED_DRILL)!).getByText('revealed')).toBeInTheDocument();
      expect(row(1003)!.tagName).toBe('A');
      expect(row(1003)).toHaveAttribute('href', '/play/1003');
      const locked = row(LOCKED_DRILL)!;
      expect(locked.tagName).toBe('DIV');
      expect(locked).not.toHaveAttribute('href');
      expect(locked).toHaveAttribute('aria-disabled', 'true');
      expect(locked).toHaveAttribute('data-state', 'locked');
      expect(locked).toHaveTextContent(', Locked');
      expect(document.querySelector(`a[href="/play/${LOCKED_DRILL}"]`)).toBeNull();
    });

    it('pressing Drills hides every explain-back group; All restores them', async () => {
      const { user, count, kinds, groupHeads } = await open136();
      const drills = kinds.getByRole('button', { name: 'Drills (78)' });
      await user.click(drills);
      expect(drills).toHaveAttribute('aria-pressed', 'true');
      expect(count).toHaveTextContent(`Showing 78 of 136 units · ${GENERATED_DONE} done`);
      expect(rows()).toHaveLength(78);
      expect(groupHeads()).toHaveLength(10);
      expect(groupHeads().some((h) => h?.startsWith('bazaar'))).toBe(false);
      expect(groupHeads().some((h) => h?.startsWith('estimation'))).toBe(true);
      await user.click(kinds.getByRole('button', { name: 'All (136)' }));
      expect(rows()).toHaveLength(136);
    });

    it('typing bazaar narrows the list to the bazaar repo', async () => {
      const { user, count, toolbar, groupHeads } = await open136();
      await user.type(toolbar.getByRole('searchbox', { name: 'Filter units' }), 'bazaar');
      expect(count).toHaveTextContent(`Showing 2 of 136 units · ${GENERATED_DONE} done`);
      expect([...rows()].map((r) => r.dataset.unit)).toEqual([String(BAZAAR_A), String(BAZAAR_B)]);
      expect(groupHeads()).toEqual(['bazaar (1/2)']);
      expect(within(row(BAZAAR_B)!).getByText(/\(set B\)$/)).toBeInTheDocument();
    });

    it('Hide done removes every data-state="done" row; a no-match filter offers Clear filters', async () => {
      const { user, sec, count, toolbar } = await open136();
      const hide = toolbar.getByRole('button', { name: 'Hide done' });
      await user.click(hide);
      expect(hide).toHaveAttribute('aria-pressed', 'true');
      expect(count).toHaveTextContent(`Showing ${136 - GENERATED_DONE} of 136 units · ${GENERATED_DONE} done`);
      expect(document.querySelectorAll('[data-unit][data-state="done"]')).toHaveLength(0);
      expect(rows()).toHaveLength(136 - GENERATED_DONE);

      await user.type(toolbar.getByRole('searchbox', { name: 'Filter units' }), 'qqq');
      const nomatch = within(sec).getByTestId('track-units-nomatch');
      expect(nomatch).toHaveTextContent('No units match.');
      expect(rows()).toHaveLength(0);
      expect(count).toHaveTextContent(`Showing 0 of 136 units · ${GENERATED_DONE} done`);
      await user.click(within(nomatch).getByRole('button', { name: 'Clear filters' }));
      expect(rows()).toHaveLength(136);
      expect(hide).toHaveAttribute('aria-pressed', 'false');
      expect(count).toHaveTextContent(`Showing 136 of 136 units · ${GENERATED_DONE} done`);
    });
  });

  it('keyboard: j focuses the first available row, and rows are anchors', async () => {
    const units: UnitSummary[] = [
      { id: 901, key: 'ladder/explain-back/aaa/h1', trackId: 'sysdesign', kind: 'explain-back', title: 'First (done)', difficulty: null, state: 'done', revealed: false, prerequisites: [] },
      { id: 902, key: 'ladder/explain-back/aaa/h2', trackId: 'sysdesign', kind: 'explain-back', title: 'Second (available)', difficulty: null, state: 'available', revealed: false, prerequisites: [] },
      { id: 903, key: 'ladder/explain-back/bbb/h3', trackId: 'sysdesign', kind: 'explain-back', title: 'Third', difficulty: null, state: 'available', revealed: false, prerequisites: [] },
    ];
    const { user } = renderApp('/campaign/sysdesign', withUnits('sysdesign', units));
    await section();
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.keyboard('j');
    expect(document.activeElement).toBe(row(902));
    expect(row(902)!.tagName).toBe('A');
    expect(row(902)).toHaveAttribute('href', '/play/902');
    await user.keyboard('j');
    expect(document.activeElement).toBe(row(903));
    await user.keyboard('k');
    await user.keyboard('k');
    expect(document.activeElement).toBe(row(901));
    expect(row(901)!.tagName).toBe('A');
  });

  it('a failed load shows an alert with Retry, and Retry renders the list', async () => {
    const base = createMockApi();
    let failures = 1;
    const api: BootQuestApi = {
      ...base,
      getTrackUnits: (t) => (failures-- > 0 ? Promise.reject(new ApiError(500, 'INTERNAL', 'boom')) : base.getTrackUnits(t)),
    };
    const { user } = renderApp('/campaign/sysdesign', api);
    const sec = await section();
    const alert = await within(sec).findByRole('alert');
    expect(rows()).toHaveLength(0);
    // the campaign-empty note is unaffected by the browser's failure
    expect(screen.getByTestId('campaign-empty')).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(row(501)).not.toBeNull());
    expect(within(sec).queryByRole('alert')).toBeNull();
    expect(row(501)).toHaveAttribute('href', '/play/501');
  });

  it('a locked track renders no unit browser and never fetches its units', async () => {
    const { api, calls } = spyApi(createMockApi({ lockedTracks: ['sysdesign'] }));
    renderApp('/campaign/sysdesign', api);
    expect(await screen.findByText(/is locked\./)).toBeInTheDocument();
    await waitFor(() => expect(calls).toContain('getCampaign'));
    expect(screen.queryByTestId('track-units')).toBeNull();
    expect(rows()).toHaveLength(0);
    expect(calls).not.toContain('getTrackUnits');
  });
});

describe('track units: campaign track (collapsed secondary)', () => {
  it('/campaign/js keeps the acts and adds a collapsed Practice units section after them', async () => {
    const probe = createMockApi();
    const n = (await probe.getTrackUnits('js')).units.length;
    const { acts } = await probe.getCampaign('js');
    const questCount = acts.reduce((s, a) => s + a.quests.length, 0);
    expect(n).toBeGreaterThan(0);

    const { user } = renderApp('/campaign/js');
    const panel = await screen.findByRole('tabpanel', { name: 'Campaign acts' });
    expect(panel.querySelectorAll('[data-act]')).toHaveLength(acts.length);
    expect(panel.querySelectorAll('[data-quest]')).toHaveLength(questCount);
    expect(screen.queryByTestId('campaign-empty')).toBeNull();

    const sec = await section();
    expect(panel.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sec.closest('.campaign')).not.toBeNull();
    const toggle = await within(sec).findByRole('button', { name: `Practice units (${n})` });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(rows()).toHaveLength(0);
    expect(within(sec).queryByTestId('track-units-count')).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(rows()).toHaveLength(n);
    expect(within(sec).getByTestId('track-units-count')).toHaveTextContent(`of ${n} units`);
    // the acts are untouched by the expanded browser
    expect(panel.querySelectorAll('[data-quest]')).toHaveLength(questCount);

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(rows()).toHaveLength(0);
  });
});

describe('track units: honesty', () => {
  it('the list renders from the units payload alone and never fetches a unit detail', async () => {
    const { api, calls } = spyApi();
    const { unmount } = renderApp('/campaign/sysdesign', api);
    await waitFor(() => expect(row(501)).not.toBeNull());
    expect(calls).toContain('getTrackUnits');
    expect(calls).not.toContain('getUnit');
    unmount();

    const js = spyApi();
    const r = renderApp('/campaign/js', js.api);
    const sec = await section();
    await r.user.click(await within(sec).findByRole('button', { name: /^Practice units \(\d+\)$/ }));
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(js.calls).toContain('getTrackUnits');
    expect(js.calls).not.toContain('getUnit');
    r.unmount();
  });
});
