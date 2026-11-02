// ab S4 "find things": dashboard requests + slate targets, the Mixed drills entry and the Ctrl+K
// unit palette (the collapsed unit browser: trackunits-groups.test.tsx). The server side of the same
// endpoints is server/test/api/find.test.ts; the mock mirrors it (api/mock.ts "ab S4").
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createHttpApi } from '../api/http';
import { createMockApi } from '../api/mock';
import { ApiError, type BootQuestApi, type Dashboard, type SlateItem } from '../api/types';
import { renderApp } from '../test/render';

/** Records every API method called, in order, with its arguments. */
function spyApi(base: BootQuestApi = createMockApi()): { api: BootQuestApi; calls: string[]; args: Record<string, unknown[][]> } {
  const calls: string[] = [];
  const args: Record<string, unknown[][]> = {};
  const api = Object.fromEntries(
    Object.entries(base).map(([k, fn]) => [
      k,
      (...a: unknown[]) => {
        calls.push(k);
        (args[k] ??= []).push(a);
        return (fn as (...x: unknown[]) => unknown)(...a);
      },
    ]),
  ) as unknown as BootQuestApi;
  return { api, calls, args };
}

function withSlate(items: SlateItem[], base = createMockApi()): BootQuestApi {
  return {
    ...base,
    getDashboard: async (): Promise<Dashboard> => {
      const d = await base.getDashboard();
      return { ...d, slate: { ...d.slate, items } };
    },
  };
}

const slateLink = (slot: string) => within(document.querySelector<HTMLElement>(`.slate [data-slot="${slot}"]`)!).getByRole('link');

describe('dashboard: slate targets come with GET /dashboard (no fan-out)', () => {
  it('a mount reads /dashboard, /competencies, the shared /tracks, /due, /stats/weak and /settings/slate (plus the shell badge), never /units or /campaign', async () => {
    const { api, calls } = spyApi();
    renderApp('/', api);
    await screen.findByTestId('due-now');
    await waitFor(() => expect(slateLink('drill:csharp')).toHaveAttribute('href', '/play/202'));
    // the shell's review badge (GET /review/queue?limit=1) is on every page, not the dashboard's
    const page = calls.filter((c) => c !== 'getReviewQueue');
    // merged ab wave: S4's 3 reads + S3's Due now (/due) and Weak spots (/stats/weak) panels + S1's focus card (/settings/slate)
    expect(new Set(page)).toEqual(new Set(['getDashboard', 'getCompetencies', 'getTracks', 'getDue', 'getWeakSpots', 'getSlateSettings']));
    expect(page.length).toBeLessThanOrEqual(6);
    expect(calls.filter((c) => c === 'getReviewQueue')).toHaveLength(1);
    expect(calls).not.toContain('getTrackUnits');
    expect(calls).not.toContain('getCampaign');
    expect(calls).not.toContain('getNextDrill');
  });

  it('rows link straight to targetUnitId; a null or missing target falls back to the track / campaign page', async () => {
    renderApp(
      '/',
      withSlate([
        { slot: 'drill:js', kind: 'drill-set', track: 'js', size: 1, done: false, targetUnitId: 4242 },
        { slot: 'drill:csharp', kind: 'drill-set', track: 'csharp', size: 1, done: false, targetUnitId: null },
        { slot: 'drill:java', kind: 'drill-set', track: 'java', size: 1, done: false },
        { slot: 'campaign', kind: 'campaign-step', done: false, targetUnitId: 777 },
        { slot: 'review', kind: 'review-clear', done: false },
      ]),
    );
    await screen.findByTestId('due-now');
    expect(slateLink('drill:js')).toHaveAttribute('href', '/play/4242');
    expect(slateLink('drill:csharp')).toHaveAttribute('href', '/campaign/csharp');
    expect(slateLink('drill:java')).toHaveAttribute('href', '/campaign/java');
    expect(slateLink('campaign')).toHaveAttribute('href', '/play/777');
    expect(slateLink('review')).toHaveAttribute('href', '/review');
  });

  it('a campaign step without a target opens the campaign page', async () => {
    renderApp('/', withSlate([{ slot: 'campaign', kind: 'campaign-step', done: false, targetUnitId: null }]));
    await screen.findByTestId('due-now');
    expect(slateLink('campaign')).toHaveAttribute('href', '/campaign');
  });
});

describe('dashboard: Mixed drills', () => {
  it('asks GET /drills/next only on click, over today\'s slate drill-set tracks, and opens that drill', async () => {
    const { api, calls, args } = spyApi();
    const r = renderApp('/', api);
    const box = await screen.findByTestId('mixed-drills');
    // the fixture slate holds drill sets for js, csharp and java (ring fix SHOULD-1: the learner's focus)
    expect(box).toHaveTextContent(/rotating JS\/TS · C#\/\.NET · Java$/);
    expect(calls).not.toContain('getNextDrill');
    await r.user.click(within(box).getByRole('button', { name: /Mixed drills/ }));
    await waitFor(() => expect(r.path()).toMatch(/^\/play\/\d+$/));
    expect(args.getNextDrill).toEqual([[['js', 'csharp', 'java']]]);
    const expected = await createMockApi().getNextDrill(['js', 'csharp', 'java']);
    expect(r.path()).toBe(`/play/${expected.unit!.id}`);
  });

  it('locked tracks are left out; nothing open says so; an error says so', async () => {
    const base = createMockApi({ lockedTracks: ['java', 'sysdesign'] });
    let fail = false;
    const api: BootQuestApi = {
      ...base,
      getNextDrill: (tracks) =>
        fail ? Promise.reject(new ApiError(500, 'INTERNAL', 'boom')) : base.getNextDrill(tracks).then((x) => ({ ...x, unit: null })),
    };
    const r = renderApp('/', api);
    const box = await screen.findByTestId('mixed-drills');
    await waitFor(() => expect(box).toHaveTextContent(/rotating JS\/TS · C#\/\.NET$/));
    await r.user.click(within(box).getByRole('button', { name: /Mixed drills/ }));
    expect(await within(box).findByTestId('mixed-note')).toHaveTextContent('No drill is open on these tracks right now.');
    expect(r.path()).toBe('/');
    fail = true;
    await r.user.click(within(box).getByRole('button', { name: /Mixed drills/ }));
    await waitFor(() => expect(within(box).getByTestId('mixed-note')).not.toHaveTextContent('No drill is open'));
  });

  it('ring fix SHOULD-1: a 2-drill-set slate (the chosen focus) is what rotates; under 2 falls back to every unlocked drill track', async () => {
    const focus = spyApi(
      withSlate([
        { slot: 'drill:java', kind: 'drill-set', track: 'java', size: 1, done: false, targetUnitId: null },
        { slot: 'drill:sysdesign', kind: 'drill-set', track: 'sysdesign', size: 1, done: false, targetUnitId: null },
        { slot: 'campaign', kind: 'campaign-step', done: false, targetUnitId: 102 },
      ]),
    );
    const r = renderApp('/', focus.api);
    const box = await screen.findByTestId('mixed-drills');
    expect(box).toHaveTextContent(/rotating Java · System design$/);
    await r.user.click(within(box).getByRole('button', { name: /Mixed drills/ }));
    await waitFor(() => expect(focus.args.getNextDrill).toEqual([[['java', 'sysdesign']]]));
    r.unmount();

    const one = spyApi(withSlate([{ slot: 'drill:java', kind: 'drill-set', track: 'java', size: 1, done: false, targetUnitId: null }]));
    const r2 = renderApp('/', one.api);
    const box2 = await screen.findByTestId('mixed-drills');
    await waitFor(() => expect(box2).toHaveTextContent(/rotating JS\/TS · C#\/\.NET · Java · System design$/));
    await r2.user.click(within(box2).getByRole('button', { name: /Mixed drills/ }));
    await waitFor(() => expect(one.args.getNextDrill).toEqual([[['js', 'csharp', 'java', 'sysdesign']]]));
  });

  it('mock rotation is deterministic: same ledger, same answer; it never picks a revealed or done drill', async () => {
    const api = createMockApi();
    const a = await api.getNextDrill(['js', 'csharp']);
    const b = await api.getNextDrill(['js', 'csharp']);
    expect(a).toEqual(b);
    expect([102, 202]).toContain(a.unit!.id);
    // the start moves with the order of the tracks given (day + passes mod n indexes the list)
    const c = await api.getNextDrill(['csharp', 'js']);
    expect(c.startIndex).toBe(a.startIndex);
    expect(c.unit!.id).not.toBe(a.unit!.id);
  });
});

describe('Ctrl+K unit palette', () => {
  const palette = () => screen.queryByRole('dialog', { name: 'Find a unit' });
  const combo = () => within(palette()!).getByRole('combobox', { name: 'Search units by title or key' });
  const options = () => within(palette()!).queryAllByRole('option');

  it('Ctrl+K opens it with focus in the search box; Esc closes it and returns focus', async () => {
    const r = renderApp('/');
    await screen.findByTestId('due-now');
    const opener = screen.getByTestId('open-palette');
    opener.focus();
    await r.user.keyboard('{Control>}k{/Control}');
    expect(palette()).toBeInTheDocument();
    expect(palette()).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(combo());
    await r.user.keyboard('{Escape}');
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(opener);
    // Cmd+K (macOS) too, and Ctrl+K again closes it
    await r.user.keyboard('{Meta>}k{/Meta}');
    expect(palette()).toBeInTheDocument();
    await r.user.keyboard('{Control>}k{/Control}');
    expect(palette()).toBeNull();
  });

  it('opens from inside a text field too, but never over another dialog', async () => {
    const r = renderApp('/');
    await screen.findByTestId('due-now');
    await r.user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await r.user.keyboard('{Control>}k{/Control}');
    expect(palette()).toBeNull();
    await r.user.keyboard('{Escape}');
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    await r.user.keyboard('{Control>}k{/Control}');
    expect(palette()).toBeInTheDocument();
    input.remove();
  });

  it('the shortcut help lists it', async () => {
    const r = renderApp('/');
    await screen.findByTestId('due-now');
    await r.user.keyboard('?');
    const help = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(help).getByText('Find a unit by title or key').closest('.kb-row')).toHaveTextContent(/CtrlK/);
  });

  it('typing searches; arrows move the active option; Enter opens it and closes the palette', async () => {
    const { api, args } = spyApi();
    const r = renderApp('/', api);
    await screen.findByTestId('due-now');
    await r.user.click(screen.getByTestId('open-palette'));
    await r.user.type(combo(), 'signalpost');
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(args.searchUnits!.at(-1)).toEqual(['signalpost', 30]);
    expect(screen.getByTestId('palette-count')).toHaveTextContent('3 matches');
    const ids = options().map((o) => o.dataset.unit);
    expect(combo()).toHaveAttribute('aria-expanded', 'true');
    expect(combo()).toHaveAttribute('aria-activedescendant', options()[0]!.id);
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    await r.user.keyboard('{ArrowDown}');
    expect(combo()).toHaveAttribute('aria-activedescendant', options()[1]!.id);
    await r.user.keyboard('{ArrowUp}{ArrowUp}'); // wraps to the last
    expect(combo()).toHaveAttribute('aria-activedescendant', options()[2]!.id);
    await r.user.keyboard('{Enter}');
    expect(palette()).toBeNull();
    expect(r.path()).toBe(`/play/${ids[2]}`);
  });

  it('page shortcuts never fire behind it: ? and g-chords type into the box', async () => {
    const r = renderApp('/');
    await screen.findByTestId('due-now');
    await r.user.keyboard('{Control>}k{/Control}');
    await r.user.keyboard('gs?');
    expect(combo()).toHaveValue('gs?');
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    expect(r.path()).toBe('/');
  });

  it('Tab stays inside the dialog', async () => {
    const r = renderApp('/');
    await screen.findByTestId('due-now');
    await r.user.keyboard('{Control>}k{/Control}');
    const close = within(palette()!).getByRole('button', { name: /Close/ });
    expect(document.activeElement).toBe(combo());
    await r.user.tab();
    expect(palette()!.contains(document.activeElement)).toBe(true);
    await r.user.tab();
    expect(palette()!.contains(document.activeElement)).toBe(true);
    close.focus();
    await r.user.tab({ shift: true });
    expect(palette()!.contains(document.activeElement)).toBe(true);
  });

  it('finds campaign study quests the track lists omit; a locked act shows title + locked, and opening it lands on the gated unit page', async () => {
    const r = renderApp('/');
    await screen.findByTestId('due-now');
    await r.user.click(screen.getByTestId('open-palette'));
    await r.user.type(combo(), 'campaign/java');
    await waitFor(() => expect(options()).toHaveLength(4));
    const byId = (id: number) => options().find((o) => o.dataset.unit === String(id))!;
    expect(byId(601)).toHaveTextContent('campaign');
    expect(byId(601)).not.toHaveTextContent('locked');
    expect(byId(603)).toHaveAttribute('data-state', 'locked');
    expect(within(byId(603)).getByText('locked')).toBeInTheDocument();
    // a hit carries title, key, kind and state: nothing else from the unit
    expect(byId(603).textContent).toBe('JVj5campaign/java/j5campaignstudylocked');
    fireEvent.click(byId(603));
    expect(r.path()).toBe('/play/603');
  });

  it('ring fix N1: Enter while the hits are still an older query\'s opens the CURRENT query\'s first hit', async () => {
    const base = createMockApi();
    const quiz = (await base.searchUnits('quiz', 30)).items[0]!;
    const fresh = (await base.searchUnits('signalpost', 30)).items[0]!;
    expect(fresh.id).not.toBe(quiz.id);
    const r = renderApp('/', base);
    await screen.findByTestId('due-now');
    await r.user.click(screen.getByTestId('open-palette'));
    await r.user.type(combo(), 'quiz');
    await waitFor(() => expect(options()[0]).toHaveAttribute('data-unit', String(quiz.id)));
    // replace the query and press Enter at once: the quiz hits are still on screen (debounce running)
    fireEvent.change(combo(), { target: { value: 'signalpost' } });
    fireEvent.keyDown(combo(), { key: 'Enter' });
    expect(r.path()).toBe('/');
    expect(palette()).toBeInTheDocument();
    await waitFor(() => expect(r.path()).toBe(`/play/${fresh.id}`));
    expect(palette()).toBeNull();
  });

  it('ring fix N1: typing after a pending Enter cancels it', async () => {
    const r = renderApp('/');
    await screen.findByTestId('due-now');
    await r.user.click(screen.getByTestId('open-palette'));
    fireEvent.change(combo(), { target: { value: 'signal' } });
    fireEvent.keyDown(combo(), { key: 'Enter' });
    fireEvent.change(combo(), { target: { value: 'signalpost U0' } });
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    expect(r.path()).toBe('/');
    expect(palette()).toBeInTheDocument();
  });

  it('no match and errors are stated; a cleared box shows the prompt', async () => {
    const base = createMockApi();
    const api: BootQuestApi = { ...base, searchUnits: (q, l) => (q === 'boom' ? Promise.reject(new ApiError(500, 'INTERNAL', 'kaput')) : base.searchUnits(q, l)) };
    const r = renderApp('/', api);
    await screen.findByTestId('due-now');
    await r.user.click(screen.getByTestId('open-palette'));
    expect(screen.getByTestId('palette-count')).toHaveTextContent('Type part of a unit title or key.');
    await r.user.type(combo(), 'zzzqqq');
    await waitFor(() => expect(screen.getByTestId('palette-count')).toHaveTextContent('No units match.'));
    expect(combo()).toHaveAttribute('aria-expanded', 'false');
    await r.user.clear(combo());
    await r.user.type(combo(), 'boom');
    await waitFor(() => expect(screen.getByTestId('palette-count')).not.toHaveTextContent(/Searching|No units/));
    expect(options()).toHaveLength(0);
    await r.user.clear(combo());
    expect(screen.getByTestId('palette-count')).toHaveTextContent('Type part of a unit title or key.');
  });
});

describe('http client: ab S4 routes', () => {
  it('GET /units/search?q=&limit= and GET /drills/next?tracks=&mode=mixed, query-encoded', async () => {
    const urls: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const api = createHttpApi('/api', impl);
    await api.searchUnits('a&b c');
    await api.searchUnits('x', 5);
    await api.getNextDrill(['js', 'java', 'sysdesign']);
    expect(urls).toEqual(['/api/units/search?q=a%26b+c', '/api/units/search?q=x&limit=5', '/api/drills/next?tracks=js%2Cjava%2Csysdesign&mode=mixed']);
  });
});
