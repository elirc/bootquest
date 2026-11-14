import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, KeyIdeaSectionDto, KeyIdeasResponse } from '../api/types';
import { renderApp } from '../test/render';

// rv2 S3 task 0 (S1 leftovers): the key-ideas fold on the Fundamentals card and in an open track-browser group,
// and the optional notebook line after an explain-back self-score that missed a key point.

const SLOW = { timeout: 15_000 };
beforeEach(() => window.localStorage.clear());

const section = (id: string): KeyIdeaSectionDto => ({
  section: id,
  title: `Section ${id}`,
  track: 'js',
  recap: { state: 'locked', passed: 0, total: 3, needed: 3, doneAt: null },
  ideas: [{ id: 'one', idea: `The idea of ${id}.`, tags: [], status: 'not-met', sources: [{ key: 'k/x', unitId: 9, title: 'Source X', passed: false }] }],
});
const EMPTY: KeyIdeasResponse = { sections: [], tiles: [], recapsOpen: [], dueCards: 0 };

/** getKeyIdeas answers a `unit` query with one section named after the unit key ('/' -> '_'). */
function withIdeas(base = createMockApi()) {
  const getKeyIdeas = vi.fn(async (q?: { track?: string; unit?: string }): Promise<KeyIdeasResponse> =>
    q?.unit ? { ...EMPTY, sections: [section(q.unit.replace(/\//g, '_'))] } : EMPTY,
  );
  return { api: { ...base, getKeyIdeas } as BootQuestApi, getKeyIdeas };
}

describe('the key-ideas fold (KeyIdeasForUnit) on the Campaign page', () => {
  it('Fundamentals card: the fold of the current topic, closed, with the idea sentence and no answer', async () => {
    const base = createMockApi();
    const { api, getKeyIdeas } = withIdeas(base);
    const current = (await base.getFundamentals('js')).topics.find((t) => t.unit.state !== 'done')!;
    renderApp('/campaign/js', api);
    const fund = await screen.findByTestId('fundamentals', {}, SLOW);
    const fold = await within(fund).findByTestId(`keyidea-fold-${current.unit.key.replace(/\//g, '_')}`, {}, SLOW);
    expect(fold.tagName).toBe('DETAILS');
    expect(fold).not.toHaveAttribute('open');
    expect(fold).toHaveTextContent(`The idea of ${current.unit.key.replace(/\//g, '_')}.`);
    expect(within(fold).getByTestId('keyidea-locked')).toHaveTextContent('Source X');
    expect(getKeyIdeas).toHaveBeenCalledWith({ unit: current.unit.key });
  });

  it('track browser: only an OPEN group reads and shows the fold of its first unit', async () => {
    const { api, getKeyIdeas } = withIdeas();
    const { user } = renderApp('/campaign/js', api);
    const browser = await screen.findByTestId('track-units', {}, SLOW);
    const head = within(browser).queryByRole('button', { name: /^Practice units/ });
    if (head) await user.click(head);
    const groupBtn = await waitFor(() => {
      const b = browser.querySelector<HTMLButtonElement>('.tu-group > .tu-group-head > button');
      expect(b).not.toBeNull();
      return b!;
    }, SLOW);
    const group = groupBtn.closest<HTMLElement>('.tu-group')!;
    const before = getKeyIdeas.mock.calls.length;
    expect(group.querySelector('[data-testid^="keyidea-fold-"]')).toBeNull();
    await user.click(groupBtn);
    const firstRow = await waitFor(() => {
      const r = group.querySelector<HTMLElement>('[data-unit]');
      expect(r).not.toBeNull();
      return r!;
    }, SLOW);
    await waitFor(() => expect(group.querySelector('[data-testid^="keyidea-fold-"]')).not.toBeNull(), SLOW);
    const calls = getKeyIdeas.mock.calls.slice(before).map((c) => c[0]);
    expect(calls).toHaveLength(1);
    const units = await api.getTrackUnits('js');
    const first = units.units.find((u) => String(u.id) === firstRow.dataset.unit)!;
    expect(calls[0]).toEqual({ unit: first.key });
  });
});

const EB = 105; // mock explain-back: closures (3 questions, 5 key points)
const KEY_POINT_TEXT = 'A closure captures the variable binding, not a snapshot of its value.';

async function answerAndScore(user: ReturnType<typeof renderApp>['user'], missed: string[]) {
  await screen.findByText('What does a closure capture, and when is that binding read?', {}, SLOW);
  for (let i = 1; i <= 3; i++) await user.type(screen.getByRole('textbox', { name: `Answer ${i}` }), 'x');
  await user.click(screen.getByRole('button', { name: /Submit answers/ }));
  await user.click(screen.getByRole('button', { name: /Store answers/ }));
  await screen.findByText(KEY_POINT_TEXT, {}, SLOW);
  for (const id of ['q1k1', 'q1k2', 'q2k1', 'q2k2', 'q3k1']) await user.click(screen.getByRole('radio', { name: `${id} ${missed.includes(id) ? 'missed' : 'covered'}` }));
  await user.click(screen.getByRole('button', { name: /Submit self-score/ }));
  await user.click(screen.getByRole('button', { name: 'File self-score' }));
  await screen.findByTestId('coverage-result', {}, SLOW);
}

describe('explain-back: the notebook line after a missed key point', () => {
  it('a missed key point offers the optional line; saving posts the EB attempt id; nothing waits on it', async () => {
    const base = createMockApi();
    const addNote = vi.fn(base.addNote);
    const selfScore = vi.fn(base.selfScoreExplainBack);
    const api: BootQuestApi = { ...base, addNote, selfScoreExplainBack: selfScore };
    const { user } = renderApp(`/play/${EB}`, api);
    await answerAndScore(user, ['q3k1']);
    const attemptId = (await selfScore.mock.results[0]!.value).attemptId as number;
    const line = screen.getByTestId('notebook-line');
    expect(line.tagName).toBe('DETAILS'); // folded: optional, never blocking
    expect(line).not.toHaveAttribute('open');
    await user.click(within(line).getByText(/Note what went wrong/));
    await user.type(within(line).getByLabelText('In your own words'), 'I forgot the loop variable is shared');
    await user.click(within(line).getByRole('button', { name: 'Save to notebook' }));
    expect(await screen.findByTestId('notebook-saved')).toBeInTheDocument();
    expect(addNote).toHaveBeenCalledWith({ unitId: EB, attemptId, line: 'I forgot the loop variable is shared', category: 'concept-gap' });
  });

  it('every key point covered: no notebook line', async () => {
    const { user } = renderApp(`/play/${EB}`);
    await answerAndScore(user, []);
    expect(screen.queryByTestId('notebook-line')).toBeNull();
  });
});
