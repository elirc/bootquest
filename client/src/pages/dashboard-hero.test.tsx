// f52 stream D (U6 + U7): the dashboard hero (one next step, council ruling 5: reviews due ->
// Fundamentals -> first undone slate item -> Next up, never an explain-back) and the reordered page.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, Dashboard, FundTopicDto, FundamentalsResponse, SlateSettingsResponse, TrackId, UnitSummary } from '../api/types';
import { renderApp } from '../test/render';
import { firstFundTrack, firstUnfinishedStep, fundamentalsStep, ladderFinished, pickHero } from './Dashboard';

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

describe('firstUnfinishedStep / ladderFinished (fix pass 1)', () => {
  const done = ladder([topic(1, unit(1, 'done'), [drill(11, 'done')])]);
  it('finished = every gate passed and no open drill; empty or locked ladders are not finished', () => {
    expect(ladderFinished(done)).toBe(true);
    expect(ladderFinished(ladder([]))).toBe(false);
    expect(ladderFinished(ladder([topic(1, unit(1, 'done')), topic(2, unit(2, 'locked'))]))).toBe(false);
    expect(ladderFinished(ladder([topic(1, unit(1, 'done'), [drill(11, 'available')])]))).toBe(false);
  });
  it('walks on only past a finished ladder; a locked step or a failed read ends the walk', async () => {
    const asked: TrackId[] = [];
    const read = (m: Partial<Record<TrackId, FundamentalsResponse>>) => async (t: TrackId) => {
      asked.push(t);
      const r = m[t];
      if (!r) throw new Error('boom');
      return r;
    };
    const open = ladder([topic(1, unit(9, 'available'))], 'java');
    expect(await firstUnfinishedStep(['js', 'csharp', 'java'], read({ js: done, csharp: done, java: open }))).toMatchObject({ trackId: 'java', unitId: 9 });
    expect(asked).toEqual(['js', 'csharp', 'java']);
    asked.length = 0;
    expect(await firstUnfinishedStep(['js', 'csharp', 'java'], read({ js: ladder([topic(1, unit(1, 'locked'))]), csharp: open }))).toBeNull();
    expect(asked).toEqual(['js']);
    asked.length = 0;
    expect(await firstUnfinishedStep(['js', 'csharp'], read({ csharp: open }))).toBeNull();
    expect(asked).toEqual(['js']);
    expect(await firstUnfinishedStep([], read({}))).toBeNull();
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
      context: 'Fundamentals · JS/TS · Topic 2 of 3 · ≈10 min · 1 complete · 1 gate passed',
    });
  });

  it('then the first undone slate item (not the review slot), then Next up (rv wave C: the server routes it, explain-backs included)', async () => {
    const d = await dash({ reviewQueue: { due: 0 } });
    // the fixture slate: drill:js done, drill:csharp open (target 202)
    expect(pickHero(d, null)).toMatchObject({ kind: 'slate', href: '/play/202', label: 'Start: C#/.NET drill set (5 drills)' });
    const allDone = { ...d, slate: { ...d.slate, items: d.slate.items.map((s) => ({ ...s, done: s.kind !== 'review-clear' })) } };
    expect(pickHero(allDone, null)).toMatchObject({ kind: 'next', href: '/play/107', context: 'Next up · JS/TS · program-unit' });
    const ebFirst = {
      ...allDone,
      nextUp: [{ trackId: 'agentic' as const, unit: { id: 999, key: 'ladder/g2/x/1', title: 'Explain back: x', kind: 'explain-back' as const } }, ...allDone.nextUp],
    };
    // rv wave C: next-up is server-routed (paths, archive, G3/G4 order), so an explain-back it names is offered
    expect(pickHero(ebFirst, null)).toMatchObject({ kind: 'next', href: '/play/999' });
    // and a senior-rep slot that links to a DESIGN IT set is the point of that slot
    const ebStep = { ...ebFirst, slate: { ...ebFirst.slate, items: [{ slot: 'senior', kind: 'senior-rep' as const, rep: 'design' as const, done: false, targetUnitId: 999 }] } };
    expect(pickHero(ebStep, null)).toMatchObject({ kind: 'slate', href: '/play/999', label: 'Start: Senior rep · DESIGN IT' });
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
    expect(context).toHaveTextContent('Fundamentals · JS/TS · Topic 1 of 2 · drill 2 of 2 · ≈5 min');
  });

  // rv wave C (D3): the hero walks ONE ladder, the primary language (learner settings)
  const primary = (lang: 'js' | 'csharp' | 'java') => (s: SlateSettingsResponse): SlateSettingsResponse => {
    const l = { primaryLanguage: lang, primaryChosen: true, campaignStep: false, seniorRep: true };
    return { ...s, learner: { today: l, tomorrow: l } };
  };

  it('primary C#: only the C# ladder is read; with none there, the first undone slate item', async () => {
    const asked: TrackId[] = [];
    const base = createMockApi();
    renderApp(
      '/',
      api({
        due: 0,
        settings: primary('csharp'),
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

  it('a finished primary ladder is not replaced by another language: the hero moves on to the slate', async () => {
    const asked: TrackId[] = [];
    renderApp(
      '/',
      api({
        due: 0,
        fund: async (t) => {
          asked.push(t);
          return ladder([topic(1, unit(207, 'done'), [drill(301, 'done')])], 'js');
        },
      }),
    );
    const { box } = await hero();
    expect(box).toHaveAttribute('data-kind', 'slate');
    expect(asked).toEqual(['js']);
  });

  it('an unfinished ladder is ONE read', async () => {
    const one: TrackId[] = [];
    renderApp('/', api({ due: 0, fund: async (t) => (one.push(t), ladder([topic(1, unit(207, 'available'))], t)) }));
    await hero();
    expect(one).toEqual(['js']);
  });

  it('a failed ladder read never blocks the hero: it moves on to the slate', async () => {
    renderApp('/', api({ due: 0, fund: () => Promise.reject(new Error('boom')) }));
    const { box } = await hero();
    expect(box).toHaveAttribute('data-kind', 'slate');
  });

  it('layout: hero and slate on top, then tiles, Due now, Activity (rv wave C: no Next up, competencies on Stats, the focus form on /settings)', async () => {
    renderApp('/');
    await hero();
    const order = ['p-hero', 'p-slate', 't-streak', 'p-due', 'p-activity'].map((id) => document.getElementById(id)!);
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `${order[i - 1]!.id} before ${order[i]!.id}`).toBeTruthy();
    }
    const top = document.querySelector('.dash-top')!;
    expect(within(top as HTMLElement).getByRole('heading', { name: "Today's slate" })).toBeInTheDocument();
    expect(document.getElementById('p-next')).toBeNull();
    expect(document.getElementById('p-comp')).toBeNull();
    expect(screen.queryByTestId('slate-focus-summary')).toBeNull();
  });

  it('nothing due: "Due now" is a single line', async () => {
    renderApp('/');
    await waitFor(() => expect(document.querySelector('.due-now')).toHaveClass('due-now-quiet'));
  });
});

// rv wave C (R4-20): the competency table moved to Stats, where the day-one collapse still applies
const compTable = () => document.querySelector<HTMLElement>('table.comp-table');
describe('competencies on day one (f52 U8, on Stats)', () => {
  const fresh = () => api({ dash: (d) => ({ ...d, competencies: d.competencies.map((c) => ({ ...c, rating: 1, lastEvidence: null })) }) });

  it('all at rating 1 with no evidence: a one-line summary; Show opens the table of "Not started" rows', async () => {
    const { user } = renderApp('/stats', fresh());
    const summary = await screen.findByTestId('comp-summary', {}, { timeout: 15_000 });
    expect(summary).toHaveTextContent('8 competencies · not started yet.');
    expect(compTable()).toBeNull();
    const toggle = within(summary).getByRole('button', { name: 'Show' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Hide');
    const table = compTable()!;
    expect(within(table).getAllByText('Not started')).toHaveLength(8);
    expect(table.querySelector('.evidence-cell svg')).toBeNull();
  });

  it('one competency above rating 1 keeps the table open', async () => {
    renderApp('/stats', api({ dash: (d) => ({ ...d, competencies: d.competencies.map((c, i) => ({ ...c, rating: i === 0 ? 2 : 1, lastEvidence: null })) }) }));
    await waitFor(() => expect(compTable()).not.toBeNull(), { timeout: 15_000 });
    expect(screen.queryByTestId('comp-summary')).toBeNull();
  });
});

describe('streak tile (f52 U16)', () => {
  const streakTile = () => document.querySelector<HTMLElement>('section[aria-labelledby="t-streak"]')!;
  const today = (xp: number, complete = false) =>
    api({
      dash: (d) => ({ ...d, streak: { ...d.streak, todayComplete: complete }, heatmap: d.heatmap.map((h) => (h.day === d.today ? { ...h, xp } : h)) }),
    });

  it('20 XP today without the slate: kept, not grown (rv wave C, R4-05)', async () => {
    renderApp('/', today(20));
    await screen.findByTestId('hero-go', {}, { timeout: 15_000 });
    expect(within(streakTile()).getByTestId('streak-kept')).toHaveTextContent('Kept today · finish the slate to grow it');
    expect(within(streakTile()).queryByTestId('streak-safe')).toBeNull();
  });

  it('19 XP and an open slate: not yet; a complete slate with 0 XP: safe', async () => {
    const r = renderApp('/', today(19));
    await screen.findByTestId('hero-go', {}, { timeout: 15_000 });
    expect(within(streakTile()).queryByTestId('streak-safe')).toBeNull();
    expect(within(streakTile()).queryByTestId('streak-kept')).toBeNull();
    r.unmount();
    renderApp('/', today(0, true));
    await screen.findByTestId('hero-go', {}, { timeout: 15_000 });
    expect(within(streakTile()).getByTestId('streak-safe')).toHaveTextContent('Today counts ✓ · +1');
  });
});

describe('layout widths (f52 U19 + U20)', () => {
  it('Dashboard and Campaign render inside the same centred column', async () => {
    const r = renderApp('/');
    await screen.findByTestId('hero-go', {}, { timeout: 15_000 });
    expect(screen.getByRole('heading', { level: 1 }).closest('.page-col')).not.toBeNull();
    expect(document.querySelector('.page-col .dash')).not.toBeNull();
    r.unmount();
    renderApp('/campaign/js');
    await screen.findByRole('list', { name: 'Campaign acts' }, { timeout: 15_000 });
    expect(screen.getByRole('heading', { level: 1 }).closest('.page-col')).not.toBeNull();
    expect(document.querySelector('.page-col .campaign')).not.toBeNull();
  });

  it('dashboard.css: one centred max width; the campaign blocks lose their 820px cap', () => {
    const css = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', f), 'utf8');
    expect(css('dashboard.css')).toMatch(/\.page-col \{\s*max-width: 1080px;\s*margin-inline: auto;/);
    expect(css('dashboard.css')).toMatch(/\.page-col \.acts,\s*\.page-col \.act-empty \{\s*max-width: none;/);
    expect(css('fundamentals.css')).not.toContain('820px');
    expect(css('trackunits.css')).not.toContain('820px');
  });
});

describe('copy (f52 U18): short text, the full rule in a tooltip', () => {
  it('Competencies says "rated 1–5"; the promotion rule is its tooltip (on Stats since rv wave C)', async () => {
    renderApp('/stats');
    const rule = await screen.findByTestId('comp-rule', {}, { timeout: 15_000 });
    expect(rule).toHaveTextContent(/^rated 1–5$/);
    expect(rule).toHaveAttribute('title', expect.stringContaining('an explain-back with at least 80% coverage, and a retest at least 2 days later'));
  });

  it('an empty slate is one short sentence with the reason in its tooltip', async () => {
    renderApp('/', api({ dash: (d) => ({ ...d, slate: { ...d.slate, items: [] } }) }));
    const note = await screen.findByTestId('slate-empty', {}, { timeout: 15_000 });
    expect(note).toHaveTextContent(/^Nothing on today's slate\. Earn 20 XP to keep the streak\.$/);
    expect(note).toHaveAttribute('title', expect.stringContaining('could be scheduled'));
  });
});
