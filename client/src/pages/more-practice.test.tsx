// f52 wave B (app ruling 5): "More practice" from a topic's `related[]` — a closed <details> per
// topic row on the Campaign list, and an open block in the next step once the topic's own drills
// are done. Undone first, difficulty ascending; three shown, then "Show all N".
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import { fundStudyFixtures } from '../api/fixtures/fundamentals';
import type { BootQuestApi, FundamentalsResponseExt, UnitSummary } from '../api/types';
import { MorePractice, morePracticeLabel } from '../components/MorePractice';
import { renderApp } from '../test/render';

const T1 = 207;
const FX1 = fundStudyFixtures[String(T1)]!;

const rel = (id: number, state: UnitSummary['state'], difficulty: number | null, title = `Related ${id}`): UnitSummary => ({
  id,
  key: `bootforge/x/${id}`,
  trackId: 'js',
  kind: 'drill',
  title,
  difficulty,
  state,
  revealed: false,
  prerequisites: [],
});

// 6 related drills, 2 done
const RELATED = [rel(801, 'done', 1), rel(802, 'available', 3), rel(803, 'available', 1, 'Sum with `reduce`'), rel(804, 'locked', 2), rel(805, 'done', 2), rel(806, 'available', 2)];
// expected order: undone by difficulty (803, 804, 806, 802), then done (801, 805)
const ORDER = [803, 804, 806, 802, 801, 805];

const ids = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>('li[data-unit]')].map((li) => Number(li.dataset.unit));

function standalone(ui: React.ReactElement) {
  return { user: userEvent.setup(), ...render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>) };
}

describe('MorePractice', () => {
  it('label counts the done ones: "More practice · 2/6 done"', () => {
    expect(morePracticeLabel(RELATED)).toBe('More practice · 2/6 done');
    expect(morePracticeLabel([rel(1, 'available', 1)])).toBe('More practice · 0/1 done');
  });

  it('as details: closed, three rows (undone first, easiest first), then "Show all 6"', async () => {
    const { user } = standalone(<MorePractice related={RELATED} as="details" />);
    const box = screen.getByTestId('more-practice') as HTMLDetailsElement;
    expect(box.tagName).toBe('DETAILS');
    expect(box.open).toBe(false);
    expect(box.querySelector('summary')).toHaveTextContent('More practice · 2/6 done');
    await user.click(box.querySelector('summary')!);
    expect(box.open).toBe(true);
    expect(ids(box)).toEqual(ORDER.slice(0, 3));
    // an open drill is a link with its estimate; a locked one is text; inline code keeps its font
    const first = box.querySelector<HTMLElement>('li[data-unit="803"]')!;
    expect(within(first).getByRole('link', { name: 'Sum with reduce' })).toHaveAttribute('href', '/play/803');
    expect(first.querySelector('code')).toHaveTextContent('reduce');
    expect(first).toHaveTextContent('≈5 min');
    const locked = box.querySelector<HTMLElement>('li[data-unit="804"]')!;
    expect(within(locked).queryByRole('link')).toBeNull();
    expect(locked).toHaveTextContent('Locked');

    const all = within(box).getByTestId('more-practice-all');
    expect(all).toHaveTextContent('Show all 6');
    await user.click(all);
    expect(ids(box)).toEqual(ORDER);
    expect(within(box).queryByTestId('more-practice-all')).toBeNull();
    // done ones come last, marked done
    expect(box.querySelector('li[data-unit="805"]')).toHaveTextContent('done');
  });

  it('three or fewer: no "Show all"; none: nothing at all', () => {
    const few = standalone(<MorePractice related={RELATED.slice(0, 3)} as="block" />);
    expect(ids(screen.getByTestId('more-practice'))).toEqual([803, 802, 801]);
    expect(screen.queryByTestId('more-practice-all')).toBeNull();
    expect(screen.getByTestId('more-practice').tagName).toBe('DIV');
    few.unmount();
    const none = standalone(<MorePractice related={[]} as="details" />);
    expect(screen.queryByTestId('more-practice')).toBeNull();
    none.unmount();
    standalone(<MorePractice related={undefined} as="details" />);
    expect(screen.queryByTestId('more-practice')).toBeNull();
  });
});

/** the mock ladder with `related` on topic 1 (and optionally an own drill there) */
function withRelated(ownDrill?: UnitSummary): BootQuestApi {
  const base = createMockApi();
  return {
    ...base,
    getFundamentals: async (t): Promise<FundamentalsResponseExt> => {
      const l = await base.getFundamentals(t);
      return { ...l, topics: l.topics.map((x, i) => (i === 0 ? { ...x, related: RELATED, drills: ownDrill ? [ownDrill] : x.drills } : x)) };
    },
  };
}

describe('More practice on the Campaign Fundamentals list', () => {
  it('a topic row with related drills has one closed <details>; a topic without has none', async () => {
    const { user } = renderApp('/campaign/js', withRelated());
    const section = await screen.findByTestId('fundamentals');
    const row = section.querySelector<HTMLElement>('[data-topic="01-values-types-and-coercion"]')!;
    const box = within(row).getByTestId('more-practice') as HTMLDetailsElement;
    expect(box.open).toBe(false);
    expect(box.querySelector('summary')).toHaveTextContent('More practice · 2/6 done');
    await user.click(box.querySelector('summary')!);
    expect(ids(box)).toEqual(ORDER.slice(0, 3));
    await user.click(within(box).getByTestId('more-practice-all'));
    expect(ids(box)).toEqual(ORDER);
    // topic 2 (locked, one line) carries none
    expect(within(section).getAllByTestId('more-practice')).toHaveLength(1);
  });

  it('the plain mock ladder (no related[]) renders no More practice', async () => {
    renderApp('/campaign/js');
    const section = await screen.findByTestId('fundamentals');
    expect(within(section).queryByTestId('more-practice')).toBeNull();
  });
});

describe('More practice in the next step', () => {
  async function passGate(user: ReturnType<typeof renderApp>['user']) {
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    for (const k of FX1.keys) await user.keyboard(`${k + 1}{Enter}`);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    return screen.findByTestId('next-unit');
  }

  it("shown once the topic's own drills are done (here: none), after the links, as an open block", async () => {
    const { user } = renderApp(`/play/${T1}`, withRelated());
    const next = await passGate(user);
    expect(within(next).getByTestId('next-primary')).toHaveTextContent('Next topic: 02 Functions & closures');
    const box = await screen.findByTestId('more-practice');
    expect(box.tagName).toBe('DIV');
    expect(box).toHaveTextContent('More practice · 2/6 done');
    expect(ids(box)).toEqual(ORDER.slice(0, 3));
    expect(next.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('completion-panel').contains(box)).toBe(true);
    await user.click(within(box).getByTestId('more-practice-all'));
    expect(ids(box)).toEqual(ORDER);
  }, 60_000);

  it('not shown while an own drill of the topic is still the next step', async () => {
    const own: UnitSummary = { ...rel(950, 'available', 1, 'Own drill'), key: 'fund-js/01-values-types-and-coercion/01-own' };
    const { user } = renderApp(`/play/${T1}`, withRelated(own));
    const next = await passGate(user);
    expect(within(next).getByTestId('next-primary')).toHaveTextContent('Practise: Own drill');
    expect(screen.queryByTestId('more-practice')).toBeNull();
  }, 60_000);
});
