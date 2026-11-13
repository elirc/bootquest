// rv B (R5-07, R3-09): the drill player folds "Why it works" until the first failed submit or a pass; (Q3) a
// quick check can be practised: the keyed answer + explanation at once, nothing recorded.
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi } from '../api/types';
import { splitWhyItWorks } from './Player/WhyItWorks';
import { renderApp } from '../test/render';

const DRILL = 102;
const QUIZ = 103;
const INSTRUCTIONS = [
  '**Interview prompt.** "How many requests per second does a day of traffic make?"',
  '',
  '**Why it works.** Average QPS spreads the day evenly: total requests ÷ 86,400 seconds.',
  '',
  '**Your task.** Implement `avgQps(dau, perUser)`.',
  '',
  '**Worked example.** `avgQps(86400, 1)` is `1`.',
].join('\n');

function withWhy(): BootQuestApi {
  const base = createMockApi();
  return { ...base, getUnit: async (id) => {
    const d = await base.getUnit(id);
    return id === DRILL ? { ...d, instructions: INSTRUCTIONS } : d;
  } };
}

describe('"Why it works" fold', () => {
  it('splitWhyItWorks cuts the section up to the next bold-lead paragraph', () => {
    const s = splitWhyItWorks(INSTRUCTIONS)!;
    expect(s.why).toBe('**Why it works.** Average QPS spreads the day evenly: total requests ÷ 86,400 seconds.');
    expect(s.before).toContain('Interview prompt');
    expect(s.after.startsWith('**Your task.**')).toBe(true);
    expect(splitWhyItWorks('**Your task.** no model here')).toBeNull();
  });

  it('is folded until the first graded submit, then opens (and stays open in this browser)', async () => {
    const api = withWhy();
    const { user, unmount } = renderApp(`/play/${DRILL}`, api);
    expect(await screen.findByTestId('why-fold')).toHaveTextContent('opens after your first failed submit');
    expect(document.body.textContent).not.toContain('total requests ÷ 86,400 seconds');
    expect(document.body.textContent).toContain('Implement avgQps');
    // a free run never opens it; a submit (here: the unchanged starter, a fail) does
    await user.click(screen.getByRole('button', { name: /^Submit/ }));
    await waitFor(() => expect(screen.queryByTestId('why-fold')).toBeNull());
    expect(document.body.textContent).toContain('total requests ÷ 86,400 seconds');
    unmount();
    renderApp(`/play/${DRILL}`, api);
    await screen.findByRole('heading', { name: 'Instructions' });
    expect(screen.queryByTestId('why-fold')).toBeNull();
  });
});

describe('quick-check practice', () => {
  it('shows the keyed answer and records nothing; the graded check is then refused for 2 days', async () => {
    const api = createMockApi();
    const { user } = renderApp(`/play/${QUIZ}`, api);
    await screen.findByRole('heading', { name: 'What does this print?' });
    await user.keyboard('1');
    await user.click(screen.getByTestId('quiz-practice'));
    const r = await screen.findByTestId('quiz-practice-result');
    expect(r).toHaveTextContent('Practice: incorrect');
    expect(r).toHaveTextContent('nothing recorded · 0 XP');
    expect(r).toHaveTextContent('Answer:');
    expect(r).toHaveTextContent('The graded check opens');
    expect((await api.getGateStatus(QUIZ))?.tries).toBe(0);
    await user.click(screen.getByRole('button', { name: /Check answer/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/practised/);
  });
});
