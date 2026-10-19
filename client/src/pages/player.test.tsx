import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mock';
import type { AttemptDetailResponse, BootQuestApi, Submission, SubmitResponse, UnitDetail } from '../api/types';
import { renderApp } from '../test/render';

// fix/client-player: drafts + dirty guard, the shared Enter gate, the editor's Tab, the reveal
// consequences on promotion-chain units, promotions in the results and the next unit after a pass.

const DRILL = 102; // js drill: groupBy (mock: next up on js is 107 "signalpost U04 ...")
const QUIZ = 103; // js quiz: "What does this print?" (choice 2 "A D C B" is right)
const PASSING = 'export const groupBy = (xs, f) => xs.reduce((a, x) => a, {{});';
const PASSING_CODE = PASSING.replace('{{', '{');

afterEach(() => {
  vi.restoreAllMocks();
});

const editorBox = async () => (await screen.findByRole('textbox', { name: /Code editor/ })) as HTMLTextAreaElement;
const quizReady = () => screen.findByRole('heading', { name: 'What does this print?' });

/** A mock whose unit `id` detail is rewritten by `patch` (kind, competencies, retest gate, ...). */
function withUnit(id: number, patch: (d: UnitDetail) => UnitDetail, base: BootQuestApi = createMockApi()): BootQuestApi {
  return { ...base, getUnit: async (u) => (u === id ? patch(await base.getUnit(u)) : base.getUnit(u)) };
}

/** A mock that counts recorded submits (and keeps the code of each, served back by GET /attempts/:id like the server). */
function recording(base: BootQuestApi = createMockApi()) {
  const calls: Submission[] = [];
  const codeByAttempt = new Map<number, string>();
  const api: BootQuestApi = {
    ...base,
    submitUnit: async (id, s) => {
      calls.push(s);
      const r = await base.submitUnit(id, s);
      if (s.code !== undefined) codeByAttempt.set(r.attempt.id, s.code);
      return r;
    },
    getAttempt: async (attemptId): Promise<AttemptDetailResponse> => {
      const code = codeByAttempt.get(attemptId);
      if (code === undefined) return base.getAttempt(attemptId);
      return { id: attemptId, unitId: DRILL, unitTitle: 'groupBy', unitKind: 'drill', mode: 'solo', outcome: 'pass', answer: { code }, createdAt: 0, runs: [], evidenceIds: [] };
    },
  };
  return { api, calls };
}

const beforeUnloadCancelled = () => {
  const ev = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
};

describe('code drafts', () => {
  it('an edit survives a remount (refresh / misclick) and says so; Reset to starter can be undone', async () => {
    const api = createMockApi();
    const first = renderApp(`/play/${DRILL}`, api);
    const editor = await editorBox();
    const starter = editor.value;
    await first.user.click(editor);
    await first.user.keyboard('// my work');
    expect(editor.value).toContain('// my work');
    // storage works: the draft is safe, so leaving asks nothing
    expect(beforeUnloadCancelled()).toBe(false);
    first.unmount();

    const second = renderApp(`/play/${DRILL}`, api);
    const again = await editorBox();
    expect(again.value).toBe(editor.value);
    expect(screen.getByTestId('draft-restored')).toHaveTextContent('Restored your unsubmitted draft');
    await second.user.click(screen.getByRole('button', { name: 'Reset to starter' }));
    expect(again.value).toBe(starter);
    await second.user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(again.value).toContain('// my work');
  });

  it('a re-seed (new starter / check) invalidates the old draft and says so', async () => {
    const base = createMockApi();
    const first = renderApp(`/play/${DRILL}`, base);
    await first.user.click(await editorBox());
    await first.user.keyboard('// old work');
    first.unmount();

    const reseeded = withUnit(DRILL, (d) => ({ ...d, starter: '// re-seeded starter\n' }), base);
    renderApp(`/play/${DRILL}`, reseeded);
    const editor = await editorBox();
    expect(editor.value).toBe('// re-seeded starter\n');
    expect(screen.getByTestId('draft-stale')).toHaveTextContent('was discarded');
    expect(screen.queryByTestId('draft-restored')).not.toBeInTheDocument();
  });

  it('a verified pass clears the draft; a revisit offers the LAST SUBMITTED code (GET /attempts/:id)', async () => {
    const { api } = recording();
    const first = renderApp(`/play/${DRILL}`, api);
    const editor = await editorBox();
    const starter = editor.value;
    await first.user.clear(editor);
    await first.user.type(editor, PASSING);
    await first.user.click(screen.getByRole('button', { name: /Submit/ }));
    await within(screen.getByTestId('results')).findByText('All checks passed');
    first.unmount();

    const second = renderApp(`/play/${DRILL}`, api);
    const again = await editorBox();
    expect(again.value).toBe(starter); // the draft is gone after the pass
    expect(screen.queryByTestId('draft-restored')).not.toBeInTheDocument();
    await second.user.click(screen.getByRole('button', { name: /Load my last submitted code \(attempt #\d+\)/ }));
    await waitFor(() => expect(again.value).toBe(PASSING_CODE));
    expect(screen.getByTestId('draft-undo')).toHaveTextContent(/Loaded your code from attempt #\d+/);
  });

  it('dirty guard: with storage refusing drafts, unsaved edits arm beforeunload and an in-app navigation confirm', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user, path } = renderApp(`/play/${DRILL}`);
    const editor = await editorBox();
    expect(beforeUnloadCancelled()).toBe(false); // nothing to lose yet
    await user.click(editor);
    await user.keyboard('x');
    expect(screen.getByTestId('draft-unsaved')).toHaveTextContent('not saving drafts');
    expect(beforeUnloadCancelled()).toBe(true);

    const dashboard = within(screen.getByRole('complementary', { name: 'Primary' })).getByRole('link', { name: /Dashboard/ });
    await user.click(dashboard);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(path()).toBe(`/play/${DRILL}`); // declined: still here, work intact
    expect(editor.value).toContain('x');

    confirm.mockReturnValue(true);
    await user.click(dashboard);
    await waitFor(() => expect(path()).toBe('/'));
    expect(beforeUnloadCancelled()).toBe(false); // the guard is gone with the page
  });
});

describe('the shared Enter gate', () => {
  it('Enter on a focused button or link is that control\'s Enter, never a recorded attempt', async () => {
    const { api, calls } = recording();
    const { user } = renderApp(`/play/${QUIZ}`, api);
    await quizReady();
    await user.keyboard('2'); // a choice is picked, so Enter from the radio WOULD submit
    screen.getByRole('button', { name: /Learn more/ }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('learn-more')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    screen.getByRole('checkbox', { name: 'I had help' }).focus();
    await user.keyboard('{Enter}');
    screen.getByRole('link', { name: 'Back to campaign' }).focus();
    await user.keyboard('{Enter}');
    expect(calls).toHaveLength(0);
  });

  it('with the reveal confirm or the shortcut help open, Enter and digits never reach the quiz', async () => {
    const { api, calls } = recording();
    const { user } = renderApp(`/play/${QUIZ}`, api);
    await quizReady();
    await user.keyboard('2');
    await user.click(screen.getByRole('button', { name: /Reveal solution/ }));
    const cancel = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    await user.keyboard('{Enter}'); // the focused Cancel acts: the confirm closes, nothing is submitted
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);

    screen.getByRole('radio', { name: /A D C B/ }).focus();
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await user.keyboard('1');
    await user.keyboard('{Enter}');
    expect(calls).toHaveLength(0);
    expect(screen.getByRole('radio', { name: /A B C D/ })).not.toBeChecked(); // "1" stopped at the overlay
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a held Enter (auto-repeat) records one attempt, not one per repeat', async () => {
    const { api, calls } = recording();
    const { user } = renderApp(`/play/${QUIZ}`, api);
    await quizReady();
    await user.keyboard('1'); // wrong
    const radio = screen.getByRole('radio', { name: /A B C D/ });
    fireEvent.keyDown(radio, { key: 'Enter' });
    expect(await screen.findByText('Incorrect')).toBeInTheDocument();
    for (let i = 0; i < 5; i++) fireEvent.keyDown(radio, { key: 'Enter', repeat: true });
    await Promise.resolve();
    expect(calls).toHaveLength(1);
  });

  it('free-text quiz: Enter in the answer field checks it, as the button hint says', async () => {
    const base = createMockApi();
    const freeText = withUnit(
      QUIZ,
      (d) => {
        if (d.check?.spec.type !== 'quiz') return d;
        const { choices: _dropped, ...spec } = d.check.spec;
        return { ...d, check: { ...d.check, spec } };
      },
      base,
    );
    const calls: Submission[] = [];
    const api: BootQuestApi = {
      ...freeText,
      submitUnit: (id, s) => {
        calls.push(s);
        return base.submitUnit(id, { answer: 1, selfAssisted: false });
      },
    };
    const { user } = renderApp(`/play/${QUIZ}`, api);
    const input = await screen.findByRole('textbox', { name: 'Your answer' });
    expect(screen.getByText(/press Enter to check it/)).toBeInTheDocument();
    await user.click(input);
    await user.keyboard('{Enter}'); // empty: nothing to check
    expect(calls).toHaveLength(0);
    await user.type(input, 'A D C B{Enter}');
    expect(await screen.findByText('Correct')).toBeInTheDocument();
    expect(calls).toEqual([{ answer: 'A D C B', selfAssisted: false }]);
  });
});

describe('the code editor', () => {
  it('Tab / Shift+Tab indent and outdent; Esc then Tab leaves the editor (no keyboard trap)', async () => {
    const { user } = renderApp(`/play/${DRILL}`);
    const editor = await editorBox();
    expect(screen.queryByText(/Editor stub/)).not.toBeInTheDocument();
    expect(editor).toHaveAccessibleDescription(/Tab indents/);
    await user.clear(editor);
    await user.type(editor, 'x{Enter}y');
    editor.setSelectionRange(0, editor.value.length);
    await user.keyboard('{Tab}');
    expect(editor.value).toBe('  x\n  y');
    expect(editor).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(editor.value).toBe('x\ny');
    editor.setSelectionRange(1, 1);
    await user.keyboard('{Tab}');
    expect(editor.value).toBe('x  \ny');
    expect(editor.selectionStart).toBe(3);
    await user.keyboard('{Escape}{Tab}');
    expect(editor).not.toHaveFocus();
    expect(editor.value).toBe('x  \ny');
  });

  it('C# indents by four spaces', async () => {
    const { user } = renderApp('/play/202');
    const editor = (await screen.findByRole('textbox', { name: 'Code editor (C#)' })) as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, 'a');
    await user.keyboard('{Tab}');
    expect(editor.value).toBe('a    ');
  });
});

describe('reveal on promotion-chain units', () => {
  const asArtifact = (d: UnitDetail): UnitDetail => ({ ...d, unit: { ...d.unit, kind: 'program-unit', competencies: ['feature-delivery', 'testing-verification'] } });
  const asRetest = (gate: NonNullable<UnitDetail['retestGate']>) => (d: UnitDetail): UnitDetail => ({
    ...d,
    unit: { ...d.unit, kind: 'retest', variationOfUnitId: 101, competencies: ['language-fluency'] },
    retestGate: gate,
  });

  it('an artifact unit: the confirm states that the promotion leg is forfeited forever', async () => {
    const { user } = renderApp(`/play/${DRILL}`, withUnit(DRILL, asArtifact));
    await editorBox();
    await user.click(screen.getByRole('button', { name: /Reveal solution/ }));
    const dialog = screen.getByRole('alertdialog', { name: 'Reveal the solution?' });
    expect(within(dialog).getByTestId('reveal-leg')).toHaveTextContent('promotion artifact for Feature delivery and Testing & verification');
    expect(dialog).toHaveAccessibleDescription(/0 XP forever.*can never promote them\s+and its changed-example retest becomes practice only\. This cannot be undone\./);
    expect(within(dialog).getByRole('button', { name: 'Reveal (0 XP forever, promotion leg forfeited)' })).toBeInTheDocument();
  });

  it('an open changed-example retest: the confirm states the retest leg is lost; a practice retest has no leg left', async () => {
    const due = renderApp(`/play/${DRILL}`, withUnit(DRILL, asRetest({ open: true, reason: 'due', opensAt: null })));
    await editorBox();
    await due.user.click(screen.getByRole('button', { name: /Reveal solution/ }));
    expect(screen.getByTestId('reveal-leg')).toHaveTextContent('changed-example retest leg of a promotion for Language fluency');
    due.unmount();

    const practice = renderApp(`/play/${DRILL}`, withUnit(DRILL, asRetest({ open: true, reason: 'practice', opensAt: null })));
    await editorBox();
    await practice.user.click(screen.getByRole('button', { name: /Reveal solution/ }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('0 XP forever');
    expect(screen.queryByTestId('reveal-leg')).not.toBeInTheDocument();
  });

  it('a closed retest offers no reveal (the server refuses it)', async () => {
    renderApp(`/play/${DRILL}`, withUnit(DRILL, asRetest({ open: false, reason: 'not-due', opensAt: Date.now() + 86_400_000 })));
    expect(await screen.findByTestId('retest-closed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reveal solution/ })).not.toBeInTheDocument();
  });

  it('a plain drill keeps the plain copy; after the reveal its changed example is linked as practice', async () => {
    const base = createMockApi();
    const api: BootQuestApi = { ...base, revealUnit: async (id) => ({ ...(await base.revealUnit(id)), variationUnitId: 107 }) };
    const { user } = renderApp(`/play/${DRILL}`, api);
    await editorBox();
    await user.click(screen.getByRole('button', { name: /Reveal solution/ }));
    expect(screen.queryByTestId('reveal-leg')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reveal (0 XP forever)' }));
    expect(await screen.findByTestId('solution')).toBeInTheDocument();
    expect(within(screen.getByTestId('variation-link')).getByRole('link', { name: 'practice the changed example' })).toHaveAttribute('href', '/play/107');
  });
});

describe('after a submit', () => {
  it('renders the promotions the server returned: competency, old → new notch, a link to Stats', async () => {
    const base = createMockApi();
    const api: BootQuestApi = {
      ...base,
      submitUnit: async (id, s): Promise<SubmitResponse> => ({
        ...(await base.submitUnit(id, s)),
        promotions: [{ competency: 'language-fluency', from: 2, to: 3, evidenceId: 91 }],
      }),
    };
    const { user } = renderApp(`/play/${DRILL}`, api);
    const editor = await editorBox();
    await user.clear(editor);
    await user.type(editor, PASSING);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    const promos = await screen.findByTestId('promotions');
    expect(promos).toHaveTextContent('Competency promoted');
    const row = within(promos).getByTestId('promotion-language-fluency');
    expect(row).toHaveTextContent('Language fluency 2 → 3');
    expect(within(row).getByRole('link', { name: 'See the evidence on Stats' })).toHaveAttribute('href', '/stats?competency=language-fluency#evidence');
  });

  it('a verified pass offers the next unit on the track (the dashboard\'s Next up); a failed submit does not', async () => {
    const { user } = renderApp(`/play/${DRILL}`);
    const editor = await editorBox();
    await user.click(screen.getByRole('button', { name: /Submit/ })); // the starter fails
    await within(screen.getByTestId('results')).findByText('Checks failed');
    expect(screen.queryByTestId('next-unit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('promotions')).not.toBeInTheDocument();

    await user.clear(editor);
    await user.type(editor, PASSING);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    const next = await screen.findByTestId('next-unit');
    expect(within(next).getByRole('link', { name: /Next unit: signalpost U04/ })).toHaveAttribute('href', '/play/107');
  });

  it('a quiz pass offers the next unit too', async () => {
    const { user } = renderApp(`/play/${QUIZ}`);
    await quizReady();
    await user.keyboard('2{Enter}');
    expect(await screen.findByText('Correct')).toBeInTheDocument();
    expect(within(await screen.findByTestId('next-unit')).getByRole('link', { name: /Next unit/ })).toHaveAttribute('href', '/play/107');
  });
});
