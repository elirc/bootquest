// f52 fix pass 2: while a Fundamentals quiz gate is open (a retake after a pass included) nothing
// that an earlier pass released can be read: no per-question "Learn more", and the header
// "Learn more" button and its `i` key are off.
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fundStudyFixtures } from '../api/fixtures/fundamentals';
import { renderApp } from '../test/render';

const T1 = 207;
const FX1 = fundStudyFixtures[String(T1)]!;
type User = ReturnType<typeof renderApp>['user'];

async function answerAll(user: User, picks: readonly number[]) {
  for (const [qi, ci] of picks.entries()) {
    await user.click(screen.getByRole('radio', { name: `Q${qi + 1} choice ${ci + 1}` }));
    await user.click(screen.getByRole('button', { name: qi === picks.length - 1 ? /Review answers/ : /^Next/ }));
  }
  expect(screen.getByTestId('gate-review')).toBeInTheDocument();
}
const header = () => screen.getByRole('button', { name: 'Learn more' });
const perQuestion = () => document.querySelectorAll('[data-testid^="learn-more-q"]');

describe('a Fundamentals gate is closed-book while it is open', () => {
  it('the header "Learn more" and `i` are off from Start to submit, and on a retake after a pass; per-question links only after the submit', async () => {
    const { user } = renderApp(`/play/${T1}`);
    const start = await screen.findByRole('button', { name: /Start quiz/ });
    expect(header()).toBeEnabled();

    await user.click(start);
    expect(header()).toBeDisabled();
    expect(header()).toHaveAttribute('title', 'Not available while the quiz gate is open');
    await user.keyboard('i');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await answerAll(user, FX1.keys);
    expect(perQuestion()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    // the gate is closed: explanations are released and readable
    await waitFor(() => expect(perQuestion().length).toBeGreaterThan(0));
    expect(header()).toBeEnabled();

    // a retake after the pass: the released explanations exist, and are out of reach again
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(header()).toBeDisabled();
    await answerAll(user, FX1.keys);
    expect(perQuestion()).toHaveLength(0);
    await user.keyboard('i');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Every non-empty string is truthy');
  }, 90_000);

  it('a campaign study quest keeps its "Learn more" while its gate is open (open-book)', async () => {
    const { user } = renderApp('/play/206');
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    expect(header()).toBeEnabled();
  });
});
