// f52 wave B (app ruling 7): "check yourself" cards in a Fundamentals lesson (mock: topic 207).
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, LessonCheck } from '../api/types';
import { parseProse } from '../lib/prose';
import { renderApp } from '../test/render';
import { placeChecks } from './Player/LessonAids';

const T1 = 207;

describe('placeChecks', () => {
  const blocks = parseProse('intro\n\n## One\n\na\n\n## Two\n\nb\n\n```js\nx\n```', { headings: true });
  const check = (heading: string, prompt = 'p'): LessonCheck => ({ heading, prompt, answer: 'a' });

  it('splits at headings and hangs each check on the section its heading names, in authored order', () => {
    const s = placeChecks(blocks, [check('Two', 'first'), check('One'), check(' Two ', 'second')]);
    expect(s.map((x) => x.blocks.map((b) => b.kind))).toEqual([['p'], ['heading', 'p'], ['heading', 'p', 'code']]);
    expect(s.map((x) => x.checks.map((c) => c.prompt))).toEqual([[], ['p'], ['first', 'second']]);
  });

  it('a check whose heading is not in the lesson goes after the last section; no checks changes nothing', () => {
    expect(placeChecks(blocks, [check('Gone')]).map((x) => x.checks.length)).toEqual([0, 0, 1]);
    expect(placeChecks(blocks, []).flatMap((x) => x.blocks)).toEqual(blocks);
    expect(placeChecks([], [])).toEqual([]);
    expect(placeChecks([], [check('x')])).toHaveLength(1);
  });
});

describe('check-yourself cards in the lesson', () => {
  it('each card follows the section of its heading: prompt, then Reveal shows the answer; nothing is sent', async () => {
    const base = createMockApi();
    const calls: string[] = [];
    const api: BootQuestApi = {
      ...base,
      submitUnit: async (id, s) => {
        calls.push('submit');
        return base.submitUnit(id, s);
      },
    };
    const { user } = renderApp(`/play/${T1}`, api);
    const cards = await screen.findAllByTestId('lesson-check');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Check yourself');
    expect(cards[0]).toHaveTextContent('Is 42n a primitive?');
    expect(cards[1]).toHaveTextContent('What does typeof function () {} report?');
    // order in the lesson: heading 1, card 1, heading 2, its text, card 2
    const lesson = document.querySelector('.player-instructions .prose')!;
    const marks = [
      screen.getByRole('heading', { name: 'The seven primitives' }),
      cards[0]!,
      screen.getByRole('heading', { name: 'typeof surprises' }),
      screen.getByText(/Test arrays with/),
      cards[1]!,
    ];
    for (const m of marks) expect(lesson.contains(m)).toBe(true);
    for (let i = 1; i < marks.length; i++) expect(marks[i - 1]!.compareDocumentPosition(marks[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // the answer is not in the DOM until Reveal
    expect(document.body.textContent).not.toContain('although a function is an object');
    expect(screen.queryByTestId('lesson-check-answer')).toBeNull();
    await user.click(within(cards[1]!).getByRole('button', { name: 'Reveal' }));
    expect(within(cards[1]!).getByTestId('lesson-check-answer')).toHaveTextContent("'function', although a function is an object.");
    expect(within(cards[1]!).queryByRole('button', { name: 'Reveal' })).toBeNull();
    expect(cards[0]).toHaveAttribute('data-revealed', 'false');
    expect(cards[1]).toHaveTextContent('Not graded: no XP, no attempt.');
    expect(calls).toEqual([]);
  });

  it('no card while the gate is open, not even after "Show lesson"', async () => {
    const { user } = renderApp(`/play/${T1}`);
    await screen.findAllByTestId('lesson-check');
    await user.click(screen.getByRole('button', { name: /Start quiz/ }));
    expect(screen.queryByTestId('lesson-check')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show lesson' }));
    expect(screen.getByRole('heading', { name: 'The seven primitives' })).toBeInTheDocument();
    expect(screen.queryByTestId('lesson-check')).toBeNull();
    expect(document.body.textContent).not.toContain('Check yourself');
  });

  it('a topic without aids (or a failed read) renders the plain lesson', async () => {
    const base = createMockApi();
    let asked = 0;
    renderApp(`/play/${T1}`, {
      ...base,
      getLessonAids: async () => {
        asked++;
        throw new Error('boom');
      },
    });
    expect(await screen.findByRole('heading', { name: 'The seven primitives' })).toBeInTheDocument();
    await waitFor(() => expect(asked).toBe(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('lesson-check')).toBeNull();
  });
});
