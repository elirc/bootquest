import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from './api/mock';
import { ApiError, type BootQuestApi } from './api/types';
import { renderApp } from './test/render';

const title = () => screen.getByRole('heading', { level: 1 });
const PASSING = 'export const groupBy = (xs, f) => xs.reduce((a, x) => a, {{});';

/** A mock with some methods overridden (e.g. to inject a server error). */
const withOverrides = (o: Partial<BootQuestApi>): BootQuestApi => ({ ...createMockApi(), ...o });

describe('routing + global keyboard navigation', () => {
  it('renders the dashboard with all required sections from the server shape', async () => {
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
    expect(screen.getByText('+64 today')).toBeInTheDocument(); // today's heatmap row
    expect(screen.getByRole('link', { name: /Clear the review queue/ })).toHaveAttribute('href', '/review');
    expect(screen.getByRole('link', { name: /signalpost U04/ })).toHaveAttribute('href', '/play/107');
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
    const { user, path } = renderApp('/play/102');
    const editor = await screen.findByRole('textbox', { name: /Code editor/ });
    await user.keyboard('r');
    expect(path()).toBe('/play/102');
    await user.click(editor);
    await user.keyboard('gd');
    expect(path()).toBe('/play/102');
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

  it('sidebar shows Java greyed out and the review badge (count from /reviews/queue)', async () => {
    renderApp('/stats');
    const sidebar = screen.getByRole('complementary', { name: 'Primary' });
    const java = await within(sidebar).findByRole('link', { name: /Java/ });
    expect(java).toHaveClass('track-locked');
    expect(within(java).getByRole('img', { name: 'Locked' })).toBeInTheDocument();
    expect(await within(sidebar).findByLabelText('12 due')).toBeInTheDocument();
  });
});

describe('campaign map (bound to GET /tracks/:id/campaign)', () => {
  it('renders acts in order with unlock state, core progress and content-pending badges; j/k walk from the first available quest', async () => {
    const { user } = renderApp('/campaign/js');
    await screen.findByRole('heading', { level: 2, name: 'Act 1: Foundations' });
    const acts = within(screen.getByRole('tabpanel', { name: 'Campaign acts' }))
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(acts).toEqual(['Act 1: Foundations', 'Act 2: APIs and data']);
    expect(screen.getByText('Language core, async, the event loop')).toBeInTheDocument();
    expect(screen.getByText('core 1/3')).toBeInTheDocument();
    expect(screen.getByText(/Unlocks at 80% of the previous act's core quests and level 4/)).toBeInTheDocument();
    expect(screen.getAllByText('content pending')).toHaveLength(2);
    // a quest in a locked act is never a link
    expect(screen.queryByRole('link', { name: /HTTP lab: idempotent POST/ })).not.toBeInTheDocument();
    await user.keyboard('j');
    expect(document.activeElement).toHaveTextContent('Group records with reduce');
    expect(document.activeElement).toHaveAttribute('href', '/play/102');
    await user.keyboard('j');
    expect(document.activeElement).toHaveTextContent('signalpost guides');
    await user.keyboard('k');
    expect(document.activeElement).toHaveTextContent('Group records with reduce');
  });

  it('a track with no seeded acts shows a clear empty state', async () => {
    renderApp('/campaign/agentic');
    expect(await screen.findByTestId('campaign-empty')).toHaveTextContent('No campaign acts are seeded');
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

describe('exercise player: code drills', () => {
  it('Ctrl+Enter runs and shows canonical failures; Ctrl+Shift+Enter submits', async () => {
    const { user } = renderApp('/play/102');
    const editor = await screen.findByRole('textbox', { name: /Code editor/ });
    await user.click(editor);
    await user.keyboard('{Control>}{Enter}{/Control}');
    const results = screen.getByTestId('results');
    await within(results).findByText('Checks failed');
    expect(within(results).getByText(/practice run/)).toBeInTheDocument();
    expect(within(results).getByText('{ odd: [1, 3], even: [2] }')).toBeInTheDocument();
    expect(within(results).getAllByText('expected')).toHaveLength(2);

    await user.clear(editor);
    await user.type(editor, PASSING);
    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}');
    await within(results).findByText('All checks passed');
    expect(within(results).getByText(/\+20 XP/)).toBeInTheDocument();
    expect(within(results).getByText(/solo attempt/)).toBeInTheDocument();
  });

  it('"I had help" submits selfAssisted:true and the attempt is recorded as assisted', async () => {
    const seen: unknown[] = [];
    const base = createMockApi();
    const api: BootQuestApi = {
      ...base,
      submitUnit: (id, s) => {
        seen.push(s);
        return base.submitUnit(id, s);
      },
    };
    const { user } = renderApp('/play/102', api);
    const editor = await screen.findByRole('textbox', { name: /Code editor/ });
    await user.clear(editor);
    await user.type(editor, PASSING);
    await user.click(screen.getByRole('checkbox', { name: 'I had help' }));
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await within(screen.getByTestId('results')).findByText(/assisted attempt/);
    expect(seen).toEqual([{ code: PASSING.replace('{{', '{'), selfAssisted: true }]);
  });

  it('renders string instructions (tolerant prose) and the language from the check spec', async () => {
    renderApp('/play/202');
    expect(await screen.findByText(/Complete TotalsByCustomer/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Code editor (C#)' })).toBeInTheDocument();
  });

  it('surfaces server error envelopes (TRACK_LOCKED) instead of crashing', async () => {
    const api = withOverrides({ submitUnit: () => Promise.reject(new ApiError(403, 'TRACK_LOCKED', 'track js is locked')) });
    const { user } = renderApp('/play/102', api);
    await screen.findByRole('textbox', { name: /Code editor/ });
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This track is locked. (TRACK_LOCKED)');
  });

  it('unknown or malformed unit ids show an error state, not a crash', async () => {
    renderApp('/play/does-not-exist');
    expect(await screen.findByRole('alert')).toHaveTextContent('NOT_FOUND');
  });

  it('a numeric id the server does not know shows NOT_FOUND', async () => {
    renderApp('/play/9999');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found. (NOT_FOUND)');
  });
});

describe('exercise player: quiz + predict-output are submit-only', () => {
  it('quiz: no Run button; a wrong answer shows Incorrect WITHOUT marking the right choice', async () => {
    const { user } = renderApp('/play/103');
    await screen.findByRole('heading', { name: 'What does this print?' });
    expect(screen.queryByRole('button', { name: /Run/ })).not.toBeInTheDocument();

    await user.keyboard('1'); // "A B C D" is wrong
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Incorrect')).toBeInTheDocument();
    expect(document.querySelector('.choice-right')).toBeNull();
    expect(screen.getByRole('radio', { name: /A B C D/ }).closest('label')).toHaveClass('choice-wrong');
    expect(screen.getByText(/^0 XP · solo attempt/)).toBeInTheDocument();

    await user.keyboard('2');
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('Correct')).toBeInTheDocument();
    expect(screen.getByText(/\+2 XP/)).toBeInTheDocument();
  });

  it('quiz: the UI never calls run (the mock would 409 RUN_NOT_AVAILABLE)', async () => {
    let runs = 0;
    const api = withOverrides({
      runUnit: () => {
        runs++;
        return Promise.reject(new ApiError(409, 'RUN_NOT_AVAILABLE', 'submit-only'));
      },
    });
    const { user } = renderApp('/play/103', api);
    await screen.findByRole('heading', { name: 'What does this print?' });
    await user.keyboard('{Control>}{Enter}{/Control}');
    await user.keyboard('2{Enter}');
    await screen.findByText('Correct');
    expect(runs).toBe(0);
  });

  it('predict-output: no Run button, tolerant missing prompt, wrong answer leaks no expected output', async () => {
    const { user } = renderApp('/play/203');
    await screen.findByRole('heading', { name: 'Predict the output' });
    expect(screen.queryByRole('button', { name: /Run/ })).not.toBeInTheDocument();
    expect(screen.getByText('No written instructions are served for this unit yet.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Predicted output' }), '10,20');
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    expect(await screen.findByText('Incorrect')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('10,20,30');
  });
});

describe('exercise player: reveal goes through POST /reveal with a 0-XP confirm', () => {
  it('Cancel keeps the unit unrevealed; confirming shows the solution, the guided badge, and 0 XP on submit', async () => {
    let reveals = 0;
    const base = createMockApi();
    const api: BootQuestApi = {
      ...base,
      revealUnit: (id) => {
        reveals++;
        return base.revealUnit(id);
      },
    };
    const { user } = renderApp('/play/102', api);
    await screen.findByRole('textbox', { name: /Code editor/ });
    expect(screen.queryByTestId('zero-xp-badge')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Reveal solution/ }));
    const dialog = screen.getByRole('alertdialog', { name: 'Reveal the solution?' });
    expect(dialog).toHaveTextContent('0 XP forever');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(reveals).toBe(0);
    expect(screen.queryByTestId('solution')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Reveal solution/ }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Reveal \(0 XP forever\)/ }));
    expect(await screen.findByTestId('solution')).toHaveTextContent('acc[keyFn(x)]');
    expect(reveals).toBe(1);
    expect(screen.getByTestId('zero-xp-badge')).toHaveTextContent('Guided · 0 XP');

    const editor = screen.getByRole('textbox', { name: /Code editor/ });
    await user.clear(editor);
    await user.type(editor, PASSING);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    const results = screen.getByTestId('results');
    await within(results).findByText('All checks passed');
    expect(within(results).getByText(/0 XP \(revealed\)/)).toBeInTheDocument();
    expect(within(results).getByText(/guided attempt/)).toBeInTheDocument();
  });

  it('an already-revealed unit loads in its guided state and fetches the solution via GET /solution', async () => {
    const api = createMockApi();
    await api.revealUnit(103);
    const { user } = renderApp('/play/103', api);
    expect(await screen.findByTestId('zero-xp-badge')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reveal solution/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show revealed solution' }));
    expect(await screen.findByTestId('solution')).toHaveTextContent('A D C B');
    // The right choice may be marked only now, because it came from the reveal.
    expect(screen.getByRole('radio', { name: /A D C B/ }).closest('label')).toHaveClass('choice-right');
  });
});

describe('exercise player: reading self-attest', () => {
  it('Mark as read works once', async () => {
    const { user } = renderApp('/play/104');
    expect(await screen.findByText(/Read the jstrain M05 notes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reveal solution/ })).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Mark as read/ });
    await user.click(button);
    expect(await screen.findByText('+5 XP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Marked as read/ })).toBeDisabled();
  });

  it('a done reading unit loads as already attested', async () => {
    const api = createMockApi();
    await api.selfAttest(104);
    renderApp('/play/104', api);
    expect(await screen.findByTestId('already-attested')).toHaveTextContent('Already marked as read.');
    expect(screen.getByRole('button', { name: /Marked as read/ })).toBeDisabled();
  });

  it('a 409 ALREADY_ATTESTED from the server shows the attested state, not an error', async () => {
    const api = withOverrides({ selfAttest: () => Promise.reject(new ApiError(409, 'ALREADY_ATTESTED', 'already')) });
    const { user } = renderApp('/play/104', api);
    await user.click(await screen.findByRole('button', { name: /Mark as read/ }));
    expect(await screen.findByTestId('already-attested')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

  it('a NOT_DUE grade shows the message and moves on', async () => {
    const api = withOverrides({ gradeReview: () => Promise.reject(new ApiError(409, 'NOT_DUE', 'not due')) });
    const { user } = renderApp('/review', api);
    await screen.findByText(/Card/);
    await user.keyboard(' ');
    await user.keyboard('3');
    expect(await screen.findByRole('alert')).toHaveTextContent('This card is not due yet. (NOT_DUE)');
    expect(screen.getByText('2', { selector: 'strong' })).toBeInTheDocument();
  });
});
