// f52 stream D (U6 + U7): the dashboard hero (one next step, council ruling 5: reviews due ->
// Fundamentals -> first undone slate item -> Next up, never an explain-back) and the reordered page.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, Dashboard, FundTopicDto, FundamentalsResponse, SlateSettingsResponse, TrackId, UnitSummary } from '../api/types';
import { renderApp } from '../test/render';
import { firstFundTrack, fundamentalsStep, pickHero } from './Dashboard';

const unit = (id: number, state: UnitSummary['state'], over: Partial<UnitSummary> = {}): UnitSummary => ({
  id,
  key: `fund/js/${String(id).padStart(2, '0')}-t`,
  trackId: 'js',
  kind: 'study',
  title: `Unit ${id}`,
  difficulty: 1,
  state,
  revealed: false,
  prerequisites: [],
  ...over,
});
const drill = (id: number, state: UnitSummary['state']) => unit(id, state, { kind: 'drill', key: `fund-js/x/${id}`, title: `Drill ${id}` });
const topic = (order: number, u: UnitSummary, drills: UnitSummary[] = []): FundTopicDto => ({
  id: `${String(order).padStart(2, '0')}-topic`,
  order,
  title: `Topic ${order} title`,
  level: 'beginner',
  summary: '',
  quizQuestions: 10,
  passPct: 80,
  flashcards: 8,
  unit: u,
  drills,
});
const ladder = (topics: FundTopicDto[], trackId: TrackId = 'js'): FundamentalsResponse => ({ trackId, topics });

/** the mock with dashboard / ladder / settings overrides */
function api(o: { due?: number; dash?: (d: Dashboard) => Dashboard; fund?: (t: TrackId) => Promise<FundamentalsResponse>; settings?: (s: SlateSettingsResponse) => SlateSettingsResponse } = {}): BootQuestApi {
  const base = createMockApi();
  return {
    ...base,
    getDashboard: async () => {
      const d = await base.getDashboard();
      const withDue = o.due === undefined ? d : { ...d, reviewQueue: { due: o.due } };
      return o.dash ? o.dash(withDue) : withDue;
    },
    ...(o.fund ? { getFundamentals: o.fund } : {}),
    ...(o.settings ? { getSlateSettings: async () => o.settings!(await base.getSlateSettings()) } : {}),
  };
}

const hero = async () => {
  const go = await screen.findByTestId('hero-go', {}, { timeout: 15_000 });
  return { go, box: screen.getByTestId('dash-hero'), context: screen.getByTestId('hero-context') };
};

describe('fundamentalsStep (dashboard-local)', () => {
  it('first topic whose gate is not passed; a passed gate with an undone drill points at that drill', () => {
    expect(fundamentalsStep(ladder([topic(1, unit(1, 'available'), [drill(11, 'available')])]))).toMatchObject({ unitId: 1, kind: 'topic', order: 1, total: 1, fresh: true });
    const s = fundamentalsStep(ladder([topic(1, unit(1, 'done'), [drill(11, 'done'), drill(12, 'available')]), topic(2, unit(2, 'available'))]));
    expect(s).toMatchObject({ unitId: 12, kind: 'drill', title: 'Drill 12', order: 1, total: 2, drill: { at: 2, of: 2 } });
    expect(fundamentalsStep(ladder([topic(1, unit(1, 'done'), [drill(11, 'done')]), topic(2, unit(2, 'available'))]))).toMatchObject({ unitId: 2, kind: 'topic', order: 2, fresh: false });
  });

  it('a finished ladder, an empty one or a locked step is no step', () => {
    expect(fundamentalsStep(ladder([topic(1, unit(1, 'done'), [drill(11, 'done')])]))).toBeNull();
    expect(fundamentalsStep(ladder([]))).toBeNull();
    expect(fundamentalsStep(ladder([topic(1, unit(1, 'locked'))]))).toBeNull();
  });
});

describe('firstFundTrack', () => {
  const settings = (on: string[]): SlateSettingsResponse =>
    ({ todayTracks: ['js', 'csharp', 'java', 'sysdesign'].map((t) => ({ trackId: t, name: t, enabled: on.includes(t), size: 1, configured: true })) }) as unknown as SlateSettingsResponse;
  it('js, csharp, java in that order, per the enabled tracks; a failed read means every track', () => {
    expect(firstFundTrack(settings(['js', 'java']))).toBe('js');
    expect(firstFundTrack(settings(['java', 'csharp']))).toBe('csharp');
    expect(firstFundTrack(settings(['sysdesign']))).toBeNull();
    expect(firstFundTrack(undefined)).toBe('js');
  });
});

describe('pickHero (council ruling 5)', () => {
  async function dash(over: Partial<Dashboard> = {}): Promise<Dashboard> {
    return { ...(await createMockApi().getDashboard()), ...over };
  }
  const step = fundamentalsStep(ladder([topic(1, unit(1, 'done')), topic(2, unit(2, 'available')), topic(3, unit(3, 'locked'))]))!;

  it('reviews due beat everything', async () => {
    expect(pickHero(await dash({ reviewQueue: { due: 3 } }), step)).toMatchObject({ kind: 'review', href: '/review', label: 'Review 3 cards' });
  });

  it('then the Fundamentals step, with one line of context', async () => {
    expect(pickHero(await dash({ reviewQueue: { due: 0 } }), step)).toEqual({
      kind: 'fundamentals',
      label: 'Continue Fundamentals: Topic 2 title',
      href: '/play/2',
      context: 'Fundamentals · JS/TS · Topic 2 of 3',
    });
  });

  it('then the first undone slate item (not the review slot), then Next up; never an explain-back', async () => {
    const d = await dash({ reviewQueue: { due: 0 } });
    // the fixture slate: drill:js done, drill:csharp open (target 202)
    expect(pickHero(d, null)).toMatchObject({ kind: 'slate', href: '/play/202', label: 'Start: C#/.NET drill set (5 drills)' });
    const allDone = { ...d, slate: { ...d.slate, items: d.slate.items.map((s) => ({ ...s, done: s.kind !== 'review-clear' })) } };
    expect(pickHero(allDone, null)).toMatchObject({ kind: 'next', href: '/play/107', context: 'Next up · JS/TS · program-unit' });
    const ebFirst = {
      ...allDone,
      nextUp: [{ trackId: 'agentic' as const, unit: { id: 999, key: 'ladder/g2/x/1', title: 'Explain back: x', kind: 'explain-back' as const } }, ...allDone.nextUp],
    };
    expect(pickHero(ebFirst, null)).toMatchObject({ kind: 'next', href: '/play/107' });
    // a campaign step whose target Next up lists as an explain-back is skipped too
    const ebStep = { ...ebFirst, slate: { ...ebFirst.slate, items: [{ slot: 'campaign', kind: 'campaign-step' as const, done: false, targetUnitId: 999 }] } };
    expect(pickHero(ebStep, null)).toMatchObject({ kind: 'next', href: '/play/107' });
    const nothing = { ...allDone, nextUp: allDone.nextUp.map((n) => ({ ...n, unit: null })) };
    expect(pickHero(nothing, null)).toMatchObject({ kind: 'none', href: '/campaign' });
  });
});

describe('dashboard hero (rendered)', () => {
  it('reviews due: the hero opens the review session', async () => {
    renderApp('/', api({ due: 4 }));
    const { go, box, context } = await hero();
    expect(box).toHaveAttribute('data-kind', 'review');
    expect(go).toHaveAttribute('href', '/review');
    expect(go).toHaveTextContent('Review 4 cards');
    expect(context).toHaveTextContent('Reviews first');
  });

  it('a fresh ladder: the first button opens Fundamentals topic 01 of the first enabled language track', async () => {
    renderApp('/', api({ due: 0 }));
    const { go, box, context } = await hero();
    expect(box).toHaveAttribute('data-kind', 'fundamentals');
    expect(go).toHaveAttribute('href', '/play/207');
    expect(go).toHaveTextContent('Start Fundamentals: Values, types & coercion');
    expect(context).toHaveTextContent('Fundamentals · JS/TS · Topic 1 of 2');
    // the hero is the page's first link after the header
    expect(document.querySelector('.dash a')).toBe(go);
  });

  it('a passed gate with an undone drill: practise that drill', async () => {
    renderApp('/', api({ due: 0, fund: async () => ladder([topic(1, unit(207, 'done'), [drill(301, 'done'), drill(302, 'available')]), topic(2, unit(208, 'available'))]) }));
    const { go, context } = await hero();
    expect(go).toHaveAttribute('href', '/play/302');
    expect(go).toHaveTextContent('Practise: Drill 302');
    expect(context).toHaveTextContent('Fundamentals · JS/TS · Topic 1 of 2 · drill 2 of 2');
  });

  it('JS off the slate: only the C# ladder is read; with none there, the first undone slate item', async () => {
    const asked: TrackId[] = [];
    const base = createMockApi();
    renderApp(
      '/',
      api({
        due: 0,
        settings: (s) => ({ ...s, todayTracks: s.todayTracks.map((t) => (t.trackId === 'js' ? { ...t, enabled: false } : t)) }),
        fund: (t) => {
          asked.push(t);
          return base.getFundamentals(t);
        },
      }),
    );
    const { go, box } = await hero();
    expect(asked).toEqual(['csharp']);
    expect(box).toHaveAttribute('data-kind', 'slate');
    expect(go).toHaveAttribute('href', '/play/202');
  });

  it('a failed ladder read never blocks the hero: it moves on to the slate', async () => {
    renderApp('/', api({ due: 0, fund: () => Promise.reject(new Error('boom')) }));
    const { box } = await hero();
    expect(box).toHaveAttribute('data-kind', 'slate');
  });

  it('layout: hero and slate on top, then tiles, Due now, Next up, Competencies, Activity, the focus line, last', async () => {
    renderApp('/');
    await hero();
    await screen.findByTestId('slate-focus-summary');
    const order = ['p-hero', 'p-slate', 't-streak', 'p-due', 'p-next', 'p-comp', 'p-activity'].map((id) => document.getElementById(id)!);
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `${order[i - 1]!.id} before ${order[i]!.id}`).toBeTruthy();
    }
    const top = document.querySelector('.dash-top')!;
    expect(within(top as HTMLElement).getByRole('heading', { name: "Today's slate" })).toBeInTheDocument();
    expect(order.at(-1)!.compareDocumentPosition(screen.getByTestId('slate-focus-summary')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('nothing due: "Due now" is a single line', async () => {
    renderApp('/');
    await waitFor(() => expect(document.querySelector('.due-now')).toHaveClass('due-now-quiet'));
  });
});

describe('competencies on day one (f52 U8)', () => {
  const fresh = () => api({ dash: (d) => ({ ...d, competencies: d.competencies.map((c) => ({ ...c, rating: 1, lastEvidence: null })) }) });

  it('all at rating 1 with no evidence: a one-line summary; Show opens the table of "Not started" rows', async () => {
    const { user } = renderApp('/', fresh());
    const summary = await screen.findByTestId('comp-summary', {}, { timeout: 15_000 });
    expect(summary).toHaveTextContent('8 competencies · not started yet.');
    expect(screen.queryByRole('table')).toBeNull();
    const toggle = within(summary).getByRole('button', { name: 'Show' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Hide');
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Not started')).toHaveLength(8);
    expect(table.querySelector('.evidence-cell svg')).toBeNull();
  });

  it('one competency above rating 1 keeps the table open', async () => {
    renderApp('/', api({ dash: (d) => ({ ...d, competencies: d.competencies.map((c, i) => ({ ...c, rating: i === 0 ? 2 : 1, lastEvidence: null })) }) }));
    await screen.findByRole('table', {}, { timeout: 15_000 });
    expect(screen.queryByTestId('comp-summary')).toBeNull();
  });
});

describe('streak tile (f52 U16)', () => {
  const streakTile = () => document.querySelector<HTMLElement>('section[aria-labelledby="t-streak"]')!;
  const today = (xp: number, complete = false) =>
    api({
      dash: (d) => ({ ...d, streak: { ...d.streak, todayComplete: complete }, heatmap: d.heatmap.map((h) => (h.day === d.today ? { ...h, xp } : h)) }),
    });

  it('20 XP today: "Streak safe for today"', async () => {
    renderApp('/', today(20));
    await screen.findByTestId('hero-go', {}, { timeout: 15_000 });
    expect(within(streakTile()).getByTestId('streak-safe')).toHaveTextContent('Streak safe for today ✓');
  });

  it('19 XP and an open slate: not yet; a complete slate with 0 XP: safe', async () => {
    const r = renderApp('/', today(19));
    await screen.findByTestId('hero-go', {}, { timeout: 15_000 });
    expect(within(streakTile()).queryByTestId('streak-safe')).toBeNull();
    r.unmount();
    renderApp('/', today(0, true));
    await screen.findByTestId('hero-go', {}, { timeout: 15_000 });
    expect(within(streakTile()).getByTestId('streak-safe')).toBeInTheDocument();
  });
});
