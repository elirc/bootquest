// f52 wave B (app ruling 1): the hint bar of the code pane.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import { ApiError, type BootQuestApi, type HintsResponse } from '../api/types';
import { renderApp } from '../test/render';
import { hintedXpNote, xpPctAfterNextHint } from './Player/HintBar';

const DRILL = 102; // js drill with 3 authored hints in the mock (2 servable)
const PASSING = 'export const groupBy = (xs, f) => xs.reduce((a, x) => a, {{});';

const editorBox = async () => (await screen.findByRole('textbox', { name: /Code editor/ })) as HTMLTextAreaElement;
const failOnce = async (user: ReturnType<typeof renderApp>['user']) => {
  await user.click(screen.getByRole('button', { name: /Submit/ })); // the starter fails
  await within(screen.getByTestId('results')).findByText('Checks failed');
};

describe('hint copy helpers', () => {
  it('the next hint costs 25 points, never under 50%', () => {
    expect(xpPctAfterNextHint({ xpPct: 100 })).toBe(75);
    expect(xpPctAfterNextHint({ xpPct: 75 })).toBe(50);
    expect(xpPctAfterNextHint({ xpPct: 50 })).toBe(50);
  });

  it('a hinted pass names the share and the hint count; an unhinted one adds nothing', () => {
    expect(hintedXpNote(null)).toBe('');
    expect(hintedXpNote({ xpPct: 100, taken: [] })).toBe('');
    expect(hintedXpNote({ xpPct: 75, taken: ['a'] })).toBe('(75% · 1 hint)');
    expect(hintedXpNote({ xpPct: 50, taken: ['a', 'b'] })).toBe('(50% · 2 hints)');
  });
});

describe('the hint bar (code drills)', () => {
  it('needs a failed Submit first (a Run does not count), then serves hint 1 and 2 without a confirm; the taken hints stay', async () => {
    const { user } = renderApp(`/play/${DRILL}`);
    await editorBox();
    const bar = await screen.findByTestId('hint-bar');
    expect(within(bar).getByTestId('hint-needs-fail')).toHaveTextContent("Hints unlock after one failed Submit. Run doesn't count; a failed Submit costs nothing.");
    expect(within(bar).queryByTestId('hint-take')).toBeNull();
    // the bar sits between the toolbar and the results
    const toolbar = document.querySelector('.player-work .toolbar')!;
    expect(toolbar.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.compareDocumentPosition(screen.getByTestId('results')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^Run/ }));
    await within(screen.getByTestId('results')).findByText('Checks failed');
    expect(screen.getByTestId('hint-needs-fail')).toBeInTheDocument();

    await failOnce(user);
    const take = await screen.findByTestId('hint-take');
    expect(take).toHaveTextContent('Show hint 1 of 2 · pass XP drops to 75%');
    expect(screen.queryByTestId('hint-needs-fail')).toBeNull();

    await user.click(take);
    await waitFor(() => expect(screen.getByTestId('hint-list').querySelectorAll('li')).toHaveLength(1));
    expect(screen.getByTestId('hint-list')).toHaveTextContent('Group first, then count');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('hint-take')).toHaveTextContent('Show hint 2 of 2 · pass XP drops to 50%');

    await user.click(screen.getByTestId('hint-take'));
    expect(await screen.findByTestId('hint-exhausted')).toHaveTextContent('No more hints. Reveal solution is the last resort (0 XP).');
    expect(screen.getByTestId('hint-list').querySelectorAll('li')).toHaveLength(2);
    expect(screen.queryByTestId('hint-take')).toBeNull();
    // the last authored hint is never shown
    expect(document.body.textContent).not.toContain('never served');
  });

  it('a hinted pass says "(75% · 1 hint)" beside its XP and keeps the hint; an unhinted pass says nothing extra', async () => {
    const first = renderApp(`/play/${DRILL}`);
    let editor = await editorBox();
    await failOnce(first.user);
    await first.user.click(await screen.findByTestId('hint-take'));
    await screen.findByTestId('hint-list');
    await first.user.clear(editor);
    await first.user.type(editor, PASSING);
    await first.user.click(screen.getByRole('button', { name: /Submit/ }));
    const results = screen.getByTestId('results');
    expect(await within(results).findByText(/\(75% · 1 hint\)/)).toBeInTheDocument();
    expect(results.querySelector('.verdict-xp')!.textContent).toMatch(/^\+\d+ XP \(75% · 1 hint\) · solo attempt saved$/);
    // passed: no further hint is offered, the one taken stays
    await waitFor(() => expect(screen.getByTestId('hint-bar')).toHaveAttribute('data-state', 'passed'));
    expect(screen.getByTestId('hint-list').querySelectorAll('li')).toHaveLength(1);
    expect(screen.queryByTestId('hint-take')).toBeNull();
    first.unmount();
    localStorage.clear();

    const second = renderApp(`/play/${DRILL}`);
    editor = await editorBox();
    await second.user.clear(editor);
    await second.user.type(editor, PASSING);
    await second.user.click(screen.getByRole('button', { name: /Submit/ }));
    await within(screen.getByTestId('results')).findByText('All checks passed');
    expect(screen.getByTestId('results').querySelector('.verdict-xp')!.textContent).toMatch(/^\+\d+ XP · solo attempt saved$/);
    // passed with no hint taken: the bar is gone
    await waitFor(() => expect(screen.queryByTestId('hint-bar')).toBeNull());
  });

  it('renders nothing for a unit without hints, a locked one, or a state that cannot be read', async () => {
    const base = createMockApi();
    const state = (over: Partial<HintsResponse>): HintsResponse => ({ unitId: DRILL, total: 2, taken: [], nextAvailable: false, xpPct: 100, ...over });
    for (const getHints of [
      async () => state({ total: 0, lockedReason: 'not-hintable' }),
      async () => state({ lockedReason: 'not-hintable' }),
      async () => state({ lockedReason: 'locked' }),
      async () => Promise.reject(new ApiError(500, 'BAD_RESPONSE', 'boom')),
    ] satisfies BootQuestApi['getHints'][]) {
      let asked = 0;
      const r = renderApp(`/play/${DRILL}`, {
        ...base,
        getHints: () => {
          asked++;
          return getHints();
        },
      });
      await editorBox();
      await waitFor(() => expect(asked).toBeGreaterThan(0));
      await new Promise((res) => setTimeout(res, 0));
      expect(screen.queryByTestId('hint-bar')).toBeNull();
      r.unmount();
    }
  });

  it('a refused hint (the state moved) is not an error: the bar re-reads and shows what is true', async () => {
    const base = createMockApi();
    let refused = false;
    const api: BootQuestApi = {
      ...base,
      getHints: async (id) =>
        refused
          ? { unitId: id, total: 2, taken: ['first hint', 'second hint'], nextAvailable: false, lockedReason: 'exhausted', xpPct: 50 }
          : { unitId: id, total: 2, taken: [], nextAvailable: true, xpPct: 100 },
      takeHint: async () => {
        refused = true;
        throw new ApiError(404, 'NOT_FOUND', 'every hint was taken');
      },
    };
    const { user } = renderApp(`/play/${DRILL}`, api);
    await editorBox();
    await user.click(await screen.findByTestId('hint-take'));
    expect(await screen.findByTestId('hint-exhausted')).toBeInTheDocument();
    expect(screen.getByTestId('hint-list').querySelectorAll('li')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the idle results say that a failed Submit costs nothing', async () => {
    renderApp(`/play/${DRILL}`);
    await editorBox();
    expect(screen.getByTestId('results')).toHaveTextContent("Submit saves an attempt you can't change afterwards. A failed Submit costs nothing.");
  });
});
