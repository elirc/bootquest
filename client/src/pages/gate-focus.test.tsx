// f52 fix pass 5: keyboard focus never falls back to <body> in the Fundamentals gate — the review
// screen, the submit and "Show lesson" each leave it somewhere useful.
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fundStudyFixtures } from '../api/fixtures/fundamentals';
import { renderApp } from '../test/render';

const T1 = 207;
const FX1 = fundStudyFixtures[String(T1)]!;

describe('focus in the Fundamentals gate', () => {
  it('review with a question still open: Submit is disabled, so "Back to questions" takes focus', async () => {
    const { user } = renderApp(`/play/${T1}`);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: /^Next/ }));
    await user.click(screen.getByRole('button', { name: /Review answers/ }));
    expect(screen.getByRole('button', { name: /Submit answers/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back to questions' })).toHaveFocus();
  });

  it('a failed submit moves focus to the result; a complete review still focuses Submit', async () => {
    const { user } = renderApp(`/play/${T1}`);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    for (const k of FX1.keys) await user.keyboard(`${((k + 1) % 3) + 1}{Enter}`); // all wrong
    const submit = screen.getByRole('button', { name: /Submit answers/ });
    expect(submit).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
    const verdict = screen.getByTestId('study-verdict');
    await waitFor(() => expect(verdict).toHaveFocus());
    expect(verdict).toHaveAttribute('tabindex', '-1');
    expect(verdict).toHaveTextContent('Below the pass mark');
  });

  it('a passed submit focuses the result, then the next-step link takes over', async () => {
    const { user } = renderApp(`/play/${T1}`);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    for (const k of FX1.keys) await user.keyboard(`${k + 1}{Enter}`);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    await waitFor(() => expect(screen.getByTestId('next-primary')).toHaveFocus());
  });

  it('"Show lesson" moves focus to the lesson heading', async () => {
    const { user } = renderApp(`/play/${T1}`);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    await user.click(screen.getByRole('button', { name: 'Show lesson' }));
    const heading = screen.getByRole('heading', { name: 'Lesson' });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute('tabindex', '-1');
  });
});
