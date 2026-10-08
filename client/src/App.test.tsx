import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from './test/render';

const title = () => screen.getByRole('heading', { level: 1 });

describe('routing + global keyboard navigation', () => {
  it('renders the dashboard with all required sections', async () => {
    renderApp('/');
    await screen.findByRole('table');
    expect(title()).toHaveTextContent('Dashboard');
    for (const name of ['Streak', 'Level', 'Review queue', "Today's slate", 'Activity', 'Competencies', 'Next up']) {
      expect(screen.getAllByRole('heading', { name: new RegExp(name) }).length).toBeGreaterThan(0);
    }
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(8); // header + 7 competencies
    expect(screen.getByText('Evidence missing')).toBeInTheDocument();
    expect(screen.getByLabelText('1 of 2 freeze tokens banked')).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: /Activity over the last 90 days/ })).toBeInTheDocument();
  });

  it('g-chords move between screens', async () => {
    const { user, path } = renderApp('/');
    await screen.findByRole('table');
    await user.keyboard('gc');
    await waitFor(() => expect(path()).toBe('/campaign/js'));
    await user.keyboard('gr');
    await waitFor(() => expect(path()).toBe('/review'));
    await user.keyboard('gs');
    await waitFor(() => expect(path()).toBe('/stats'));
    await user.keyboard('gd');
    await waitFor(() => expect(path()).toBe('/'));
  });

  it('a lone letter does nothing, and chords are ignored while typing', async () => {
    const { user, path } = renderApp('/play/js-reduce-groupby');
    const editor = await screen.findByRole('textbox', { name: /Code editor/ });
    await user.keyboard('r');
    expect(path()).toBe('/play/js-reduce-groupby');
    await user.click(editor);
    await user.keyboard('gd');
    expect(path()).toBe('/play/js-reduce-groupby');
    expect((editor as HTMLTextAreaElement).value).toContain('gd');
  });

  it('? toggles the shortcut help and Escape closes it', async () => {
    const { user } = renderApp('/');
    await screen.findByRole('table');
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('unknown routes render a 404 inside the shell', async () => {
    renderApp('/nope');
    expect(title()).toHaveTextContent('Nothing here');
    const sidebar = screen.getByRole('complementary', { name: 'Primary' });
    expect(await within(sidebar).findByLabelText('12 due')).toBeInTheDocument();
  });

  it('sidebar shows Java greyed out and the review badge', async () => {
    renderApp('/stats');
    const sidebar = screen.getByRole('complementary', { name: 'Primary' });
    const java = await within(sidebar).findByRole('link', { name: /Java/ });
    expect(java).toHaveClass('track-locked');
    expect(within(java).getByRole('img', { name: 'Locked' })).toBeInTheDocument();
    expect(await within(sidebar).findByLabelText('12 due')).toBeInTheDocument();
  });
});

describe('campaign map', () => {
  it('shows 3 acts with lock states and j focuses the current step', async () => {
    const { user } = renderApp('/campaign/js');
    const acts = await screen.findAllByRole('heading', { level: 2, name: /^Act / });
    expect(acts.map((a) => a.textContent)).toEqual([
      'Act I · Language & tooling',
      'Act II · Shipping HTTP features',
      'Act III · React clients that hold up',
    ]);
    expect(screen.getByText(/Unlocks when:/)).toBeInTheDocument();
    await user.keyboard('j');
    expect(document.activeElement).toHaveTextContent('signalpost U04');
    await user.keyboard('j');
    expect(document.activeElement).toHaveTextContent('HTTP lab');
    await user.keyboard('k');
    expect(document.activeElement).toHaveTextContent('signalpost U04');
  });

  it('arrow keys switch track tabs; Java renders locked', async () => {
    const { user, path } = renderApp('/campaign/agentic');
    const tab = await screen.findByRole('tab', { name: /Agentic engineering/ });
    tab.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(path()).toBe('/campaign/java'));
    expect(await screen.findByRole('note')).toHaveTextContent('Java is locked.');
    expect(screen.getByRole('tab', { name: /Java/ })).toHaveClass('tab-locked');
  });
});

describe('exercise player shell', () => {
  it('Ctrl+Enter runs and shows structured failures; Ctrl+Shift+Enter submits', async () => {
    const { user } = renderApp('/play/js-reduce-groupby');
    const editor = await screen.findByRole('textbox', { name: /Code editor/ });
    await user.click(editor);
    await user.keyboard('{Control>}{Enter}{/Control}');
    const results = screen.getByTestId('results');
    await within(results).findByText('Checks failed');
    expect(within(results).getByText(/practice run/)).toBeInTheDocument();
    expect(within(results).getByText('{ odd: [1, 3], even: [2] }')).toBeInTheDocument();
    expect(within(results).getAllByText('expected')).toHaveLength(2);

    await user.clear(editor);
    await user.type(editor, 'export const groupBy = (xs, f) => xs.reduce((a, x) => a, {{});');
    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}');
    await within(results).findByText('All checks passed');
    expect(within(results).getByText(/\+20 XP/)).toBeInTheDocument();
  });

  it('quiz units take 1–4 then Enter', async () => {
    const { user } = renderApp('/play/js-quiz-event-loop');
    await screen.findByRole('heading', { name: 'What does this print?' });
    await user.keyboard('2');
    expect(screen.getByRole('radio', { name: /A D C B/ })).toBeChecked();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Correct')).toBeInTheDocument();
  });

  it('unknown unit shows an error state, not a crash', async () => {
    renderApp('/play/does-not-exist');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found');
  });
});

describe('review session keyboard', () => {
  it('Space reveals, 1–4 grade only after reveal, finishing clears the queue', async () => {
    const { user } = renderApp('/review');
    await screen.findByText(/Card/);
    expect(screen.getByText('1', { selector: 'strong' })).toBeInTheDocument();

    await user.keyboard('3'); // ignored: not revealed yet
    expect(screen.queryByTestId('card-back')).not.toBeInTheDocument();
    expect(screen.getByText('1', { selector: 'strong' })).toBeInTheDocument();

    await user.keyboard(' ');
    expect(screen.getByTestId('card-back')).toBeInTheDocument();
    await user.keyboard('3');
    await screen.findByText('2', { selector: 'strong' });
    expect(screen.queryByTestId('card-back')).not.toBeInTheDocument();

    for (let i = 0; i < 11; i++) {
      await user.keyboard(' ');
      await user.keyboard(String((i % 4) + 1));
    }
    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent('Queue cleared');
    expect(done).toHaveTextContent('+12 XP');
  });
});
