// fund wave: the Campaign page's Fundamentals ladder and a Fundamentals topic in the player
// (mock fixtures: api/fixtures/fundamentals.ts — JS topics 207 (available) and 208 (locked behind 207)).
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import { fundStudyFixtures } from '../api/fixtures/fundamentals';
import type { BootQuestApi, Submission } from '../api/types';
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

type User = ReturnType<typeof renderApp>['user'];

/** Answer every gate question (0-based choice per question) and stop where "Submit answers" is offered. */
async function answerAll(user: User, picks: readonly number[]) {
  for (const [qi, ci] of picks.entries()) await user.click(screen.getByRole('radio', { name: `Q${qi + 1} choice ${ci + 1}` }));
}

describe('a Fundamentals topic in the player', () => {
  it('shows the lesson (with headings) above the quiz gate in one reading column; no repo reading list', async () => {
    renderApp(`/play/${T1}`);
    expect(await screen.findByRole('heading', { name: 'Lesson' })).toBeInTheDocument();
    // U9: one centred reading column, the lesson first and the gate after it
    expect(document.querySelector('.player')).toHaveAttribute('data-layout', 'reading');
    const lesson = document.querySelector('.player-instructions')!;
    const gate = screen.getByRole('region', { name: 'Quiz gate' });
    expect(lesson.compareDocumentPosition(gate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The seven primitives' }).tagName).toBe('H3');
    expect(screen.getByRole('heading', { name: 'Quiz gate' })).toBeInTheDocument();
    expect(screen.getByTestId('fund-gate-intro')).toHaveTextContent('5 questions, pass mark 80%');
    expect(screen.getByTestId('fund-gate-intro')).toHaveTextContent("enrols this topic's 3 flashcards");
    expect(screen.queryByTestId('reading-list')).not.toBeInTheDocument();
    expect(screen.queryByText(/Reading list/)).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Fundamentals');
  });

  // U2 (ruling 2): the gate is closed-book
  it('hides the lesson while the gate is open; "Show lesson" brings it back and marks the try as assisted; a retry hides it again', async () => {
    const base = createMockApi();
    const sent: Submission[] = [];
    const api: BootQuestApi = {
      ...base,
      submitUnit: async (id, s) => {
        sent.push(s);
        return base.submitUnit(id, s);
      },
    };
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    // no lesson text anywhere in the DOM
    expect(screen.queryByRole('heading', { name: 'Lesson' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'The seven primitives' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Array.isArray(value)`');
    expect(document.body.textContent).not.toContain('seven primitive types');
    expect(screen.getByTestId('lesson-hidden')).toHaveTextContent('Lesson hidden while you answer');

    await user.click(screen.getByRole('button', { name: 'Show lesson' }));
    expect(screen.getByRole('heading', { name: 'The seven primitives' })).toBeInTheDocument();
    expect(screen.queryByTestId('lesson-hidden')).not.toBeInTheDocument();
    expect(screen.getByTestId('lesson-shown')).toHaveTextContent('I had help');
    await answerAll(user, FX1.keys.map((k) => (k + 1) % 3)); // all wrong
    const help = screen.getByRole('checkbox', { name: 'I had help' });
    expect(help).toBeChecked();
    expect(help).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
    expect(sent[0]).toMatchObject({ selfAssisted: true });
    // the try is over: the lesson is there to re-read
    expect(screen.getByRole('heading', { name: 'The seven primitives' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByRole('heading', { name: 'The seven primitives' })).not.toBeInTheDocument();
    expect(screen.getByTestId('lesson-hidden')).toBeInTheDocument();
    await answerAll(user, FX1.keys);
    expect(screen.getByRole('checkbox', { name: 'I had help' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'I had help' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(sent[1]).toMatchObject({ selfAssisted: false });
  });

  it('passing the gate marks the topic passed and unlocks the next topic on the ladder', async () => {
    const api = createMockApi();
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    await answerAll(user, FX1.keys);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(screen.getByTestId('quest-done')).toHaveTextContent('topic passed');
    const ladder = await api.getFundamentals('js');
    expect(ladder.topics.map((t) => t.unit.state)).toEqual(['done', 'available']);
  });
});
