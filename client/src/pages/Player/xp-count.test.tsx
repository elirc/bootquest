// f52 fix pass 6: the XP count-up never spams the results' aria-live region. The animated number
// is aria-hidden; the final amount is rendered once as visually-hidden text and never changes.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

let frame = 0;
vi.mock('../../lib/countup', () => ({ useCountUp: () => frame }));

import { XpCount } from './NextStep';

describe('XpCount', () => {
  it('mid-animation: the moving number is hidden from assistive technology, the final value is stated once', () => {
    frame = 7;
    const { rerender } = render(<XpCount amount={50} />);
    const moving = screen.getByTestId('completion-xp');
    expect(moving).toHaveTextContent('+7 XP');
    expect(moving).toHaveAttribute('aria-hidden', 'true');
    expect(moving).not.toHaveAttribute('aria-label');
    const final = screen.getByTestId('completion-xp-text');
    expect(final).toHaveTextContent('+50 XP');
    expect(final).toHaveClass('sr-only');
    expect(final).not.toHaveAttribute('aria-hidden');
    const text = final.firstChild;

    // later frames change only the hidden number: the announced text node is untouched
    frame = 31;
    rerender(<XpCount amount={50} />);
    expect(screen.getByTestId('completion-xp')).toHaveTextContent('+31 XP');
    expect(screen.getByTestId('completion-xp-text')).toHaveTextContent('+50 XP');
    expect(screen.getByTestId('completion-xp-text').firstChild).toBe(text);
    // exactly one accessible statement of the amount
    expect(screen.getAllByText('+50 XP')).toHaveLength(1);
  });
});
