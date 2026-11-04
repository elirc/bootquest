// fund wave: the Campaign page's Fundamentals ladder and a Fundamentals topic in the player
// (mock fixtures: api/fixtures/fundamentals.ts — JS topics 207 (available) and 208 (locked behind 207)).
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import { fundStudyFixtures } from '../api/fixtures/fundamentals';
import type { BootQuestApi } from '../api/types';
import { renderApp } from '../test/render';

const T1 = 207;
const FX1 = fundStudyFixtures[String(T1)]!;

describe('Fundamentals section (Campaign page)', () => {
  it('lists the ladder in order: an available topic is a link, a locked one is not, Start points at the first open topic', async () => {
    renderApp('/campaign/js');
    const section = await screen.findByTestId('fundamentals');
    expect(within(section).getByRole('heading', { name: 'Fundamentals' })).toBeInTheDocument();
    expect(within(section).getByTestId('fund-progress')).toHaveTextContent('0/2 topics passed');
    const topics = section.querySelectorAll<HTMLElement>('[data-topic]');
    expect([...topics].map((t) => t.dataset.topic)).toEqual(['01-values-types-and-coercion', '02-functions-and-closures']);
    expect(within(topics[0]!).getByRole('link', { name: /01\s*Values, types & coercion/ })).toHaveAttribute('href', `/play/${T1}`);
    expect(topics[0]).toHaveTextContent('Lesson + quiz gate · 5 questions · 3 flashcards');
    expect(within(topics[1]!).queryByRole('link')).toBeNull();
    expect(topics[1]).toHaveTextContent(/Locked/);
    expect(topics[1]).toHaveTextContent("unlocks when you pass the previous topic's quiz");
    expect(within(section).getByTestId('fund-continue')).toHaveAttribute('href', `/play/${T1}`);
    expect(within(section).getByTestId('fund-continue')).toHaveTextContent('Start: 01 Values, types & coercion');
  });

  it('collapses and expands', async () => {
    const { user } = renderApp('/campaign/js');
    const section = await screen.findByTestId('fundamentals');
    const toggle = within(section).getByRole('button', { name: 'Fundamentals' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(section.querySelector('.fund-topics')).not.toBeVisible();
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
