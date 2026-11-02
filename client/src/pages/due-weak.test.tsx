import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import { ApiError, type BootQuestApi, type DueResponse, type RetestListItemDto, type WeakGroupDto, type WeakSpotsResponse } from '../api/types';
import { sourceSummary, TEASER_GROUPS } from '../components/WeakSpots';
import { fmtShortDate, fmtWhen } from '../lib/format';
import { renderApp } from '../test/render';

// ab wave S3: the dashboard "Due now" panel on GET /due (retests + alternate explain-back sets whose
// gate opened), the Stats "Weak spots" panel and the dashboard teaser (GET /stats/weak, hidden when empty).

const SLOW = { timeout: 15_000 };
const NOW = Date.now();
const DAY = 86_400_000;

const retests: RetestListItemDto[] = [
  { reviewItemId: 9, unitId: 777, title: 'Changed example: later one', dueAt: NOW + 2 * DAY, artifactUnitId: 106, due: false },
  { reviewItemId: 8, unitId: 102, title: 'Changed example: group records by key length', dueAt: NOW - 3_600_000, artifactUnitId: 106, due: true },
];

function withDue(due: Partial<DueResponse>, base = createMockApi()): BootQuestApi {
  return { ...base, getDue: async () => ({ ...(await base.getDue()), ...due }) };
}

/** the Due-now section once GET /due has landed (a row or the empty text is rendered) */
async function dueSection(): Promise<HTMLElement> {
  const panel = await screen.findByTestId('due-now', {}, SLOW);
  await waitFor(() => expect(panel.querySelector('.due-row, [data-testid="due-empty"]')).not.toBeNull(), SLOW);
  return panel.closest('section')!;
}

describe('Due now (GET /due: retests + alternate sets whose gate opened)', () => {
  it('open retests first, then open alternate sets, then later retests; each links its unit; legs still come from /competencies', async () => {
    const base = createMockApi();
    const api: BootQuestApi = {
      ...withDue({ retests, altSets: [{ unitId: 555, title: 'Explain back: the router', label: 'B', group: 'r:docs/router.md', openedAt: NOW - DAY }], nextAltSetAt: NOW + 3 * DAY }, base),
      getCompetencies: async () => ({ ...(await base.getCompetencies()), retests }),
    };
    renderApp('/', api);
    const section = await dueSection();
    const panel = within(section).getByTestId('due-now');
    expect(section).toHaveClass('due-now-hot');
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('Due now · 1 retest open · 1 alternate set open');
    expect(section).toHaveTextContent('retests and alternate sets are not in the review queue');
    expect(section).not.toHaveTextContent('not listed here');

    const rows = [...panel.querySelectorAll<HTMLElement>('.due-row')];
    expect(rows.map((r) => r.getAttribute('data-retest') ?? `alt:${r.getAttribute('data-altset')}`)).toEqual(['102', 'alt:555', '777']);
    expect(within(rows[0]!).getByText('open now')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link', { name: /Take the retest/ })).toHaveAttribute('href', '/play/102');
    expect(within(rows[0]!).getByRole('link', { name: 'artifact unit #106' })).toHaveAttribute('href', '/play/106');
    expect(within(rows[1]!).getByRole('link', { name: 'Alternate set: Explain back: the router' })).toHaveAttribute('href', '/play/555');
    expect(rows[1]).toHaveTextContent('set B');
    expect(rows[1]).toHaveTextContent(`opened ${fmtWhen(NOW - DAY)}`);
    expect(within(rows[2]!).getByRole('link', { name: /Retest: Changed example: later one/ })).toHaveAttribute('href', '/play/777');
    expect(rows[2]).toHaveTextContent(`opens ${fmtShortDate(NOW + 2 * DAY)}`);
    expect(within(panel).getByTestId('due-next-alt')).toHaveTextContent(`Next alternate set opens ${fmtWhen(NOW + 3 * DAY)}`);

    // the competency legs: artifact + retest chips are links; the due retest says so
    const lf = screen.getByRole('table').querySelector<HTMLElement>('[data-competency="language-fluency"]')!;
    expect(within(lf.querySelector<HTMLElement>('[data-leg="artifact"]')!).getByRole('link')).toHaveAttribute('href', '/play/106');
    const retestLeg = lf.querySelector<HTMLElement>('[data-leg="retest"]')!;
    expect(within(retestLeg).getByRole('link')).toHaveAttribute('href', '/play/102');
    expect(retestLeg).toHaveTextContent('open now');
  });

  it('an alternate set alone makes the panel hot', async () => {
    renderApp('/', withDue({ altSets: [{ unitId: 556, title: 'Explain back: caching', label: 'C', group: 'g', openedAt: NOW - 1000 }] }));
    const section = await dueSection();
    expect(section).toHaveClass('due-now-hot');
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('Due now · 1 alternate set open');
    expect(within(section).queryByTestId('due-next-alt')).toBeNull();
  });

  it('nothing due: names both mechanisms and, when a group is inside its gap, when the next set opens', async () => {
    renderApp('/');
    const empty = await screen.findByTestId('due-empty', {}, SLOW);
    expect(empty).toHaveTextContent('Nothing due.');
    expect(empty).toHaveTextContent('on an artifact with a seeded changed example schedules a retest at least 2 days later');
    expect(empty).toHaveTextContent('units without a seeded variation rotate alternate question sets instead');
    expect(empty).toHaveTextContent('listed here once 2 days have passed');
    expect(empty).not.toHaveTextContent('next alternate set opens');
    expect(screen.getByTestId('due-now').closest('section')).not.toHaveClass('due-now-hot');
  });

  it('nothing open yet but a set inside its gap: the empty text says when it opens', async () => {
    renderApp('/', withDue({ nextAltSetAt: NOW + DAY }));
    const empty = await screen.findByTestId('due-empty', {}, SLOW);
    expect(empty).toHaveTextContent(`The next alternate set opens ${fmtWhen(NOW + DAY)}.`);
  });

  it('a failed /due read has its own Retry; the rest of the dashboard stays mounted and is not refetched', async () => {
    const base = createMockApi();
    let fail = true;
    let release: () => void = () => {};
    let compCalls = 0;
    const api: BootQuestApi = {
      ...base,
      getDue: () =>
        fail
          ? Promise.reject(new ApiError(500, 'INTERNAL', 'boom'))
          : new Promise((resolve, reject) => {
              release = () => void base.getDue().then(resolve, reject);
            }),
      getCompetencies: () => {
        compCalls++;
        return base.getCompetencies();
      },
    };
    const { user, container } = renderApp('/', api);
    const due = await within(container).findByTestId('due-now', {}, SLOW);
    await waitFor(() => expect(within(due).getByRole('alert')).toHaveTextContent('boom'), SLOW);
    const table = within(container).getByRole('table');
    const calls = compCalls;
    fail = false;
    await user.click(within(due).getByRole('button', { name: 'Retry' }));
    // mid-reload: same nodes, and the panel never claims "nothing due" while unknown
    expect(within(container).getByTestId('due-now')).toBe(due);
    expect(within(due).queryByTestId('due-empty')).toBeNull();
    release();
    expect(await within(due).findByTestId('due-empty', {}, SLOW)).toBeInTheDocument();
    expect(table).toBeInTheDocument();
    expect(compCalls).toBe(calls);
  });
});

// ---------------------------------------------------------------- weak spots

const TODAY = new Date(NOW).toISOString().slice(0, 10);

function group(n: number, over: Partial<WeakGroupDto> = {}): WeakGroupDto {
  return {
    group: `repo-${n}`,
    scope: 'repo',
    trackId: 'js',
    count: 3,
    weight: 10 - n,
    lastAt: NOW - n * 60_000,
    bySource: { quizMiss: 1, again: 0, fail: 2, ebMissed: 0 },
    examples: [
      { kind: 'quiz-miss', unitId: 100 + n, unitTitle: `Quest ${n}`, ref: `seed:q${n}`, label: `Why does ${n} fail?`, at: NOW - n * 60_000 },
      { kind: 'fail', unitId: 200 + n, unitTitle: `Drill ${n}`, ref: null, label: null, at: NOW - n * 60_000 - 1 },
    ],
    ...over,
  };
}

function withWeak(data: Partial<WeakSpotsResponse> | 'fail', base = createMockApi()): BootQuestApi {
  return {
    ...base,
    getWeakSpots: async () => {
      if (data === 'fail') throw new ApiError(500, 'INTERNAL', 'weak down');
      return { ...(await base.getWeakSpots()), today: TODAY, ...data };
    },
  };
}

describe('Weak spots (GET /stats/weak)', () => {
  it('sourceSummary lists only the non-zero sources, in a fixed order', () => {
    expect(sourceSummary(group(1))).toBe('1 missed question · 2 failed submits');
    expect(sourceSummary(group(1, { bySource: { quizMiss: 0, again: 2, fail: 0, ebMissed: 1 } }))).toBe('2 Again grades · 1 missed key point');
  });

  it('Stats: an empty ledger says what will gather here (never "no weak spots")', async () => {
    renderApp('/stats');
    const empty = await screen.findByTestId('weak-empty', {}, SLOW);
    expect(empty).toHaveTextContent('Nothing collected yet.');
    expect(empty).toHaveTextContent('grouped by repo or drill module');
  });

  it('Stats: every listed group in server order, with its sources and examples linking their units; the overflow is counted', async () => {
    renderApp('/stats', withWeak({ totalGroups: 6, groups: [group(1), group(2, { scope: 'module', group: 'jsdrills/arrays', trackId: 'java' })] }));
    const panel = await screen.findByTestId('weak-spots', {}, SLOW);
    const rows = [...panel.querySelectorAll<HTMLElement>('[data-weak-group]')];
    expect(rows.map((r) => r.getAttribute('data-weak-group'))).toEqual(['repo-1', 'jsdrills/arrays']);
    expect(rows[0]).toHaveTextContent('1 missed question · 2 failed submits · last ');
    expect(within(rows[0]!).getByRole('link', { name: 'Why does 1 fail?' })).toHaveAttribute('href', '/play/101');
    // no released label (a failed submit): the unit title is the link text
    expect(within(rows[0]!).getByRole('link', { name: 'Drill 1' })).toHaveAttribute('href', '/play/201');
    expect(rows[1]!.querySelector('.track-badge')).toHaveTextContent('JV');
    expect(panel).toHaveTextContent('4 more groups with fewer recent misses not shown.');
  });

  it('Dashboard teaser: absent with no data and on an error (no false "all clear")', async () => {
    const first = renderApp('/');
    await within(first.container).findByTestId('due-now', {}, SLOW);
    expect(within(first.container).queryByTestId('weak-teaser')).toBeNull();
    expect(within(first.container).queryByRole('heading', { name: 'Weak spots' })).toBeNull();
    first.unmount();

    const second = renderApp('/', withWeak('fail'));
    await within(second.container).findByTestId('due-now', {}, SLOW);
    expect(within(second.container).queryByTestId('weak-teaser')).toBeNull();
    expect(within(second.container).queryByRole('alert')).toBeNull();
  });

  it(`Dashboard teaser: the top ${TEASER_GROUPS} groups with their newest example, linking to the Stats panel`, async () => {
    renderApp('/', withWeak({ totalGroups: 4, groups: [group(1), group(2), group(3), group(4)] }));
    const teaser = await screen.findByTestId('weak-teaser', {}, SLOW);
    const section = teaser.closest('section')!;
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('Weak spots');
    expect([...teaser.querySelectorAll('[data-weak-group]')].map((r) => r.getAttribute('data-weak-group'))).toEqual(['repo-1', 'repo-2', 'repo-3']);
    expect(teaser.querySelectorAll('[data-weak-kind]')).toHaveLength(3);
    expect(within(section).getByRole('link', { name: /All weak spots/ })).toHaveAttribute('href', '/stats#weak-spots');
  });
});
