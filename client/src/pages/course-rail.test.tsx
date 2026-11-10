// f52 wave B (app ruling 4): the course rail under the header of a Fundamentals unit, the shared
// ladder read behind it (lib/useFundLadder), and the completion panel after a pass.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import { fundStudyFixtures } from '../api/fixtures/fundamentals';
import type { BootQuestApi, FundamentalsResponseExt, UnitDetail, UnitSummary } from '../api/types';
import { renderApp } from '../test/render';

const T1 = 207;
const FX1 = fundStudyFixtures[String(T1)]!;
const DRILL = 102; // the js groupBy drill, re-homed below as a Fundamentals drill
const TOPIC = '01-values-types-and-coercion';
const PASSING = 'export const groupBy = (xs, f) => xs.reduce((a, x) => a, {{});';

type User = ReturnType<typeof renderApp>['user'];
type State = UnitSummary['state'];

const summary = (id: number, key: string, title: string, state: State, over: Partial<UnitSummary> = {}): UnitSummary => ({
  id,
  key,
  trackId: 'js',
  kind: key.startsWith('fund/') ? 'study' : 'drill',
  title,
  difficulty: 1,
  state,
  revealed: false,
  prerequisites: [],
  ...over,
});

/**
 * A two-topic ladder whose topic 1 has the given drills. The states are LIVE: `passed` units read
 * "done", and topic 2 unlocks with topic 1's gate, like the server.
 */
function ladderApi(opts: { gate: State; drills: [number, string, State, number?][] }) {
  const base = createMockApi();
  const passed = new Set<number>();
  let reads = 0;
  const live = (id: number, s: State): State => (passed.has(id) ? 'done' : s);
  const api: BootQuestApi = {
    ...base,
    getUnit: async (u) => {
      const d: UnitDetail = await base.getUnit(u);
      return u === DRILL ? { ...d, unit: { ...d.unit, key: `fund-js/${TOPIC}/01-first` } } : d;
    },
    submitUnit: async (id, s) => {
      const r = await base.submitUnit(id, s);
      if (r.verdict === 'pass') passed.add(id);
      return r;
    },
    getFundamentals: async (): Promise<FundamentalsResponseExt> => {
      reads++;
      const gate = live(T1, opts.gate);
      return {
        trackId: 'js',
        topics: [
          {
            id: TOPIC,
            order: 1,
            title: 'Values, types & coercion',
            level: 'beginner',
            summary: '',
            quizQuestions: 5,
            passPct: 80,
            flashcards: 3,
            unit: summary(T1, `fund/js/${TOPIC}`, '01 · Values, types & coercion', gate),
            drills: opts.drills.map(([id, title, state, difficulty], i) =>
              summary(id, `fund-js/${TOPIC}/0${i + 1}-d`, title, live(id, state), { difficulty: difficulty ?? 1 }),
            ),
          },
          {
            id: '02-functions-and-closures',
            order: 2,
            title: 'Functions & closures',
            level: 'beginner',
            summary: '',
            quizQuestions: 1,
            passPct: 80,
            flashcards: 2,
            unit: summary(208, 'fund/js/02-functions-and-closures', '02 · Functions & closures', gate === 'done' ? 'available' : 'locked'),
            drills: [],
          },
        ],
      };
    },
  };
  return { api, reads: () => reads };
}

const step = (rail: HTMLElement, id: string) => rail.querySelector<HTMLElement>(`[data-step="${id}"]`)!;
const stepIds = (rail: HTMLElement) => [...rail.querySelectorAll<HTMLElement>('[data-step]')].map((s) => s.dataset.step);

async function passGate(user: User) {
  await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
  for (const k of FX1.keys) await user.keyboard(`${k + 1}{Enter}`);
  await user.click(screen.getByRole('button', { name: /Submit answers/ }));
  expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
}

async function passDrill(user: User) {
  const editor = (await screen.findByRole('textbox', { name: /Code editor/ })) as HTMLTextAreaElement;
  await user.clear(editor);
  await user.type(editor, PASSING);
  await user.click(screen.getByRole('button', { name: /Submit/ }));
  await within(screen.getByTestId('results')).findByText('All checks passed');
}

describe('the course rail', () => {
  it('a topic page: "JS/TS Fundamentals · Topic 1/2", Lesson → Gate → Next topic, under the header', async () => {
    renderApp(`/play/${T1}`);
    const rail = await screen.findByTestId('course-rail');
    expect(within(rail).getByTestId('rail-where')).toHaveTextContent('JS/TS Fundamentals · Topic 1/2');
    expect(stepIds(rail)).toEqual(['lesson', 'gate', 'next']);
    expect(step(rail, 'lesson')).toHaveTextContent('Lesson ≈10 min');
    expect(step(rail, 'gate')).toHaveAttribute('data-current', 'true');
    expect(step(rail, 'gate').querySelector('[aria-current="step"]')).not.toBeNull();
    // this page's own steps are text; the locked next topic is text with the rule as its tooltip
    expect(within(rail).queryAllByRole('link')).toHaveLength(0);
    expect(step(rail, 'next').querySelector('[title]')).toHaveAttribute('title', "Unlocks when you pass this topic's quiz gate");
    expect(rail.querySelectorAll('[data-done="true"]')).toHaveLength(0);
    // under the header, above the player
    const header = document.querySelector('h1')!;
    expect(header.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rail.compareDocumentPosition(document.querySelector('.player')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a drill page: ticks on Lesson and Gate, the drill is current, the other steps are links with estimates', async () => {
    const { api } = ladderApi({ gate: 'done', drills: [[DRILL, 'First drill', 'available'], [901, 'Second drill', 'available', 3]] });
    renderApp(`/play/${DRILL}`, api);
    const rail = await screen.findByTestId('course-rail');
    expect(stepIds(rail)).toEqual(['lesson', 'gate', 'drill-1', 'drill-2', 'next']);
    expect(step(rail, 'lesson')).toHaveAttribute('data-done', 'true');
    expect(step(rail, 'gate')).toHaveAttribute('data-done', 'true');
    expect(within(step(rail, 'gate')).getByRole('link')).toHaveAttribute('href', `/play/${T1}`);
    expect(step(rail, 'drill-1')).toHaveAttribute('data-current', 'true');
    expect(within(step(rail, 'drill-1')).queryByRole('link')).toBeNull();
    expect(step(rail, 'drill-1')).toHaveTextContent('Drill 1 ≈5 min');
    expect(within(step(rail, 'drill-2')).getByRole('link')).toHaveAttribute('href', '/play/901');
    expect(step(rail, 'drill-2')).toHaveTextContent('Drill 2 ≈15 min');
    expect(within(step(rail, 'next')).getByRole('link', { name: 'Next topic' })).toHaveAttribute('href', '/play/208');
  });

  it('no rail (and no ladder read) on a unit that is not on a Fundamentals ladder; none when the ladder cannot be read', async () => {
    const { api, reads } = ladderApi({ gate: 'done', drills: [] });
    const plain = renderApp('/play/103', api);
    await screen.findByRole('heading', { name: 'What does this print?' });
    expect(screen.queryByTestId('course-rail')).toBeNull();
    expect(reads()).toBe(0);
    plain.unmount();
    renderApp(`/play/${T1}`, { ...createMockApi(), getFundamentals: async () => Promise.reject(new Error('boom')) });
    await screen.findByRole('heading', { name: 'Lesson' });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('course-rail')).toBeNull();
  });

  it('one shared ladder read feeds the rail and the next step: once on load, once after each submit; the rail ticks the pass', async () => {
    const { api, reads } = ladderApi({ gate: 'done', drills: [[DRILL, 'First drill', 'available'], [901, 'Second drill', 'available']] });
    const { user } = renderApp(`/play/${DRILL}`, api);
    const rail = await screen.findByTestId('course-rail');
    expect(reads()).toBe(1);
    expect(step(rail, 'drill-1')).toHaveAttribute('data-done', 'false');
    await passDrill(user);
    const next = await screen.findByTestId('next-unit');
    expect(within(next).getByTestId('next-primary')).toHaveTextContent('Practise: Second drill');
    await waitFor(() => expect(step(screen.getByTestId('course-rail'), 'drill-1')).toHaveAttribute('data-done', 'true'));
    expect(reads()).toBe(2);
  });
});

describe('the completion panel', () => {
  it('a gate pass on a topic without drills completes it: title, XP, flashcards enrolled, the focused primary button', async () => {
    const { user } = renderApp(`/play/${T1}`);
    await passGate(user);
    const panel = await screen.findByTestId('completion-panel');
    expect(panel).toHaveAttribute('data-complete', 'true');
    expect(within(panel).getByTestId('completion-title')).toHaveTextContent('Topic 1 of 2 complete');
    // no count-up in tests: the final amount is there at once, and it is the submit's XP
    const xp = within(panel).getByTestId('completion-xp');
    expect(xp.textContent).toMatch(/^\+[1-9]\d* XP$/);
    expect(screen.getByTestId('study-result').querySelector('.verdict-xp')!.textContent).toContain(xp.textContent!);
    expect(within(panel).getByTestId('completion-flashcards')).toHaveTextContent('3 flashcards enrolled in your reviews (first due tomorrow).');
    expect(within(panel).queryByTestId('completion-todo')).toBeNull();
    const primary = within(panel).getByTestId('next-primary');
    expect(primary).toHaveTextContent('Next topic: 02 Functions & closures');
    await waitFor(() => expect(primary).toHaveFocus());
    // the rail followed the pass
    const rail = screen.getByTestId('course-rail');
    await waitFor(() => expect(step(rail, 'gate')).toHaveAttribute('data-done', 'true'));
    expect(within(step(rail, 'next')).getByRole('link')).toHaveAttribute('href', '/play/208');
  }, 60_000);

  it('a gate pass on a topic with drills: "quiz gate passed", primary "Practise: <drill>", a muted "Skip to next topic" link', async () => {
    const { api } = ladderApi({ gate: 'available', drills: [[950, 'Defaults that keep `0`', 'available']] });
    const { user } = renderApp(`/play/${T1}`, api);
    await passGate(user);
    const panel = await screen.findByTestId('completion-panel');
    expect(panel).toHaveAttribute('data-complete', 'false');
    expect(within(panel).getByTestId('completion-title')).toHaveTextContent('Topic 1 of 2 · quiz gate passed');
    expect(within(panel).getByTestId('completion-todo')).toHaveTextContent('Pass one drill to complete this one.');
    const primary = within(panel).getByTestId('next-primary');
    expect(primary).toHaveTextContent('Practise: Defaults that keep 0');
    expect(primary).toHaveAttribute('href', '/play/950');
    await waitFor(() => expect(primary).toHaveFocus());
    const skip = within(panel).getByTestId('next-topic');
    expect(skip).toHaveTextContent('Skip to next topic');
    expect(skip).toHaveClass('muted');
    expect(skip).not.toHaveClass('btn');
    expect(skip).toHaveAttribute('href', '/play/208');
  }, 60_000);

  it('the drill pass that completes a topic shows the panel; a later drill of a complete topic does not', async () => {
    const first = ladderApi({ gate: 'done', drills: [[DRILL, 'First drill', 'available'], [901, 'Second drill', 'available']] });
    const a = renderApp(`/play/${DRILL}`, first.api);
    await passDrill(a.user);
    const panel = await screen.findByTestId('completion-panel');
    expect(within(panel).getByTestId('completion-title')).toHaveTextContent('Topic 1 of 2 complete');
    expect(within(panel).getByTestId('completion-xp').textContent).toMatch(/^\+[1-9]\d* XP$/);
    expect(within(panel).queryByTestId('completion-flashcards')).toBeNull();
    expect(within(panel).getByTestId('next-primary')).toHaveTextContent('Practise: Second drill');
    expect(within(panel).getByTestId('next-topic')).toHaveTextContent('Next topic: 02 Functions & closures');
    a.unmount();
    localStorage.clear();

    const second = ladderApi({ gate: 'done', drills: [[DRILL, 'First drill', 'available'], [901, 'Second drill', 'done']] });
    const b = renderApp(`/play/${DRILL}`, second.api);
    await passDrill(b.user);
    const next = await screen.findByTestId('next-unit');
    expect(within(next).getByTestId('next-primary')).toHaveTextContent('Next topic: 02 Functions & closures');
    expect(screen.queryByTestId('completion-panel')).toBeNull();
  }, 60_000);

  it('a drill passed before its gate completes nothing yet: the gate is the next step, no panel', async () => {
    const { api } = ladderApi({ gate: 'available', drills: [[DRILL, 'First drill', 'available']] });
    const { user } = renderApp(`/play/${DRILL}`, api);
    await passDrill(user);
    const next = await screen.findByTestId('next-unit');
    expect(within(next).getByTestId('next-primary')).toHaveTextContent('Quiz gate: 01 Values, types & coercion');
    expect(screen.queryByTestId('completion-panel')).toBeNull();
  }, 60_000);

  it('a unit off the ladder keeps the plain next-unit line', async () => {
    const { user } = renderApp(`/play/${DRILL}`);
    await passDrill(user);
    expect(within(await screen.findByTestId('next-unit')).getByRole('link', { name: /Next unit: signalpost U04/ })).toHaveAttribute('href', '/play/107');
    expect(screen.queryByTestId('completion-panel')).toBeNull();
  }, 60_000);
});
