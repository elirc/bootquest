// fund wave: the Campaign page's Fundamentals ladder and a Fundamentals topic in the player
// (mock fixtures: api/fixtures/fundamentals.ts — JS topics 207 (available) and 208 (locked behind 207)).
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mock';
import { FUND_EXPANDED_KEY } from './Fundamentals';
import { fundStudyFixtures } from '../api/fixtures/fundamentals';
import type { BootQuestApi } from '../api/types';
import { renderApp } from '../test/render';

const T1 = 207;
const FX1 = fundStudyFixtures[String(T1)]!;

describe('Fundamentals section (Campaign page)', () => {
  it('compact card: progress, the current topic in full, a locked next topic on one line; Start points at the first open topic', async () => {
    renderApp('/campaign/js');
    const section = await screen.findByTestId('fundamentals');
    expect(within(section).getByRole('heading', { name: 'Fundamentals' })).toBeInTheDocument();
    expect(within(section).getByTestId('fund-progress')).toHaveTextContent('0/2 topics passed');
    expect(within(section).getByRole('progressbar', { name: 'Fundamentals topics passed' })).toBeInTheDocument();
    const topics = section.querySelectorAll<HTMLElement>('[data-topic]');
    expect([...topics].map((t) => t.dataset.topic)).toEqual(['01-values-types-and-coercion', '02-functions-and-closures']);
    expect(within(topics[0]!).getByRole('link', { name: /01\s*Values, types & coercion/ })).toHaveAttribute('href', `/play/${T1}`);
    expect(topics[0]).toHaveTextContent('Lesson + quiz gate · 5 questions · 3 flashcards');
    // f52 U10: a locked topic is one line (no summary / meta), never a link; the rule is its tooltip
    expect(within(topics[1]!).queryByRole('link')).toBeNull();
    expect(topics[1]).toHaveTextContent(/Locked/);
    expect(topics[1]).toHaveClass('fund-line');
    expect(topics[1]!.querySelector('.fund-summary, .fund-meta')).toBeNull();
    expect(topics[1]!.querySelector('[title]')).toHaveAttribute('title', "Unlocks when you pass the previous topic's quiz");
    expect(within(section).getByTestId('fund-continue')).toHaveAttribute('href', `/play/${T1}`);
    expect(within(section).getByTestId('fund-continue')).toHaveTextContent('Start: 01 Values, types & coercion');
  });

  it('a 20-topic ladder: the compact card shows the current topic and the next two; "Show all 20" is remembered', async () => {
    const base = createMockApi();
    const real = await base.getFundamentals('js');
    const t0 = real.topics[0]!;
    const topics = Array.from({ length: 20 }, (_, i) => ({
      ...t0,
      id: `${String(i + 1).padStart(2, '0')}-topic-${i + 1}`,
      order: i + 1,
      title: `Topic ${i + 1}`,
      unit: { ...t0.unit, id: 7000 + i, state: i < 3 ? ('done' as const) : i === 3 ? ('available' as const) : ('locked' as const) },
      drills: [],
    }));
    const api: BootQuestApi = { ...base, getFundamentals: async () => ({ trackId: 'js', topics }) };
    const first = renderApp('/campaign/js', api);
    let section = await screen.findByTestId('fundamentals');
    expect(within(section).getByTestId('fund-progress')).toHaveTextContent('3/20 topics passed');
    expect(within(section).getByTestId('fund-continue')).toHaveTextContent('Continue: 04 Topic 4');
    const shown = () => [...section.querySelectorAll<HTMLElement>('[data-topic]')].map((t) => t.dataset.topic);
    expect(shown()).toEqual(['04-topic-4', '05-topic-5', '06-topic-6']);
    expect(section.querySelectorAll('.fund-line')).toHaveLength(2); // the two locked ones are one line each
    const toggle = within(section).getByTestId('fund-toggle');
    expect(toggle).toHaveTextContent('Show all 20');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await first.user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Show less');
    expect(shown()).toHaveLength(20);
    expect(section.querySelectorAll('.fund-line')).toHaveLength(16); // locked topics 05-20
    expect(window.localStorage.getItem(FUND_EXPANDED_KEY)).toBe('1');
    first.unmount();

    // a second visit opens expanded; collapsing again is remembered too
    const second = renderApp('/campaign/js', api);
    section = await screen.findByTestId('fundamentals');
    expect(shown()).toHaveLength(20);
    await second.user.click(within(section).getByTestId('fund-toggle'));
    expect(shown()).toEqual(['04-topic-4', '05-topic-5', '06-topic-6']);
    expect(window.localStorage.getItem(FUND_EXPANDED_KEY)).toBe('0');
  });

  it('a blocked localStorage still renders the compact card and toggles in memory', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const { user } = renderApp('/campaign/js');
      const section = await screen.findByTestId('fundamentals');
      const toggle = within(section).getByTestId('fund-toggle');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('the campaign acts follow the compact card directly (the first act is not pushed below a 20-topic list)', async () => {
    renderApp('/campaign/js');
    const section = await screen.findByTestId('fundamentals');
    const acts = await screen.findByRole('tabpanel', { name: 'Campaign acts' });
    expect(section.compareDocumentPosition(acts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(section).getByTestId('fund-all')).not.toBeVisible();
  });

  it('renders nothing on a track without a ladder', async () => {
    renderApp('/campaign/csharp');
    await screen.findByRole('heading', { level: 1 });
    // let the fundamentals fetch settle
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('fundamentals')).not.toBeInTheDocument();
  });

  it('a failed fetch shows a retry, never a broken list', async () => {
    const base = createMockApi();
    let fail = true;
    const api: BootQuestApi = {
      ...base,
      getFundamentals: async (t) => {
        if (fail) throw new Error('boom');
        return base.getFundamentals(t);
      },
    };
    const { user } = renderApp('/campaign/js', api);
    const section = await screen.findByTestId('fundamentals');
    expect(within(section).getByRole('alert')).toBeInTheDocument();
    fail = false;
    await user.click(within(section).getByRole('button', { name: /retry/i }));
    expect(await within(await screen.findByTestId('fundamentals')).findByTestId('fund-progress')).toHaveTextContent('0/2');
  });
});

describe('a Fundamentals topic in the player', () => {
  it('shows the lesson (with headings) beside the quiz gate; no repo reading list', async () => {
    renderApp(`/play/${T1}`);
    expect(await screen.findByRole('heading', { name: 'Lesson' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The seven primitives' }).tagName).toBe('H3');
    expect(screen.getByRole('heading', { name: 'Quiz gate' })).toBeInTheDocument();
    expect(screen.getByTestId('fund-gate-intro')).toHaveTextContent('5 questions, pass mark 80%');
    expect(screen.getByTestId('fund-gate-intro')).toHaveTextContent("enrols this topic's 3 flashcards");
    expect(screen.queryByTestId('reading-list')).not.toBeInTheDocument();
    expect(screen.queryByText(/Reading list/)).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Fundamentals');
  });

  it('passing the gate marks the topic passed and unlocks the next topic on the ladder', async () => {
    const api = createMockApi();
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    for (const [qi, ci] of FX1.keys.entries()) await user.click(screen.getByRole('radio', { name: `Q${qi + 1} choice ${ci + 1}` }));
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(screen.getByTestId('quest-done')).toHaveTextContent('topic passed');
    const ladder = await api.getFundamentals('js');
    expect(ladder.topics.map((t) => t.unit.state)).toEqual(['done', 'available']);
  });
});
