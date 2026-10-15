import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mock';
import { writtenFixtures } from '../api/fixtures/written';
import { isApiError, type BootQuestApi } from '../api/types';
import { renderApp } from '../test/render';
import { draftKey, marksKey } from './WrittenPane';

const SORT = 112; // jstrain-style verbal item: a fenced code block in the question
const REVIEW = 113; // bootforge-style review: numbered listing + starter template
const MODEL_MARK = 'implementation-defined';
const RUBRIC_MARK = 'Names the underlying rule';

/** Records every API method called, in order. */
function spyApi(base: BootQuestApi = createMockApi()): { api: BootQuestApi; calls: string[] } {
  const calls: string[] = [];
  const api = Object.fromEntries(
    Object.entries(base).map(([k, fn]) => [k, (...a: unknown[]) => (calls.push(k), (fn as (...x: unknown[]) => unknown)(...a))]),
  ) as unknown as BootQuestApi;
  return { api, calls };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('written player: immutable answer first, then the model answer + rubric self-check', () => {
  it('shows the question with its code block and NOTHING of the key until the answer is stored', async () => {
    const { api, calls } = spyApi();
    const { user } = renderApp(`/play/${SORT}`, api);
    const pane = await screen.findByRole('region', { name: 'Question' });
    // the fenced code renders as a real code block, not literal backticks
    const code = pane.querySelector('pre.code-block');
    expect(code?.textContent).toBe('items.sort((a, b) => a.score > b.score);');
    expect(pane.textContent).not.toContain('```');
    expect(screen.getByTestId('written-ins')).toHaveTextContent('The question is in the answer pane');
    // no model answer, no rubric, no reveal button; and no expected-403 probe (detail says unanswered)
    expect(document.body.textContent).not.toContain(MODEL_MARK);
    expect(document.body.textContent).not.toContain(RUBRIC_MARK);
    expect(screen.queryByRole('button', { name: /Reveal solution/ })).not.toBeInTheDocument();
    expect(calls).not.toContain('getModelAnswer');

    const submit = screen.getByRole('button', { name: /Submit answer/ });
    expect(submit).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), '   ');
    expect(submit).toBeDisabled(); // whitespace is not an answer
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'It returns a boolean, not a number.');
    await user.click(submit);

    const dialog = screen.getByRole('alertdialog', { name: 'Store your answer?' });
    expect(dialog).toHaveTextContent('cannot be edited');
    expect(calls).not.toContain('answerWritten');
    // Cancel keeps everything local
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls).not.toContain('answerWritten');

    await user.click(submit);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Store answer and show the model answer/ }));

    expect(await screen.findByTestId('model-answer')).toHaveTextContent(MODEL_MARK);
    expect(screen.getByTestId('model-answer').querySelector('pre.code-block')?.textContent).toBe('items.sort((a, b) => a.score - b.score);');
    expect(screen.getByTestId('stored-answer')).toHaveTextContent('It returns a boolean, not a number.');
    // the answer row is written BEFORE the model answer is requested
    expect(calls.indexOf('answerWritten')).toBeGreaterThan(-1);
    expect(calls.indexOf('answerWritten')).toBeLessThan(calls.indexOf('getModelAnswer'));
    // honest: no XP, no score; the rubric is a local self-check only
    expect(screen.getByTestId('no-xp')).toHaveTextContent('not graded · no XP');
    expect(screen.getByTestId('rubric-note')).toHaveTextContent('not recorded, not scored and earn no XP');
    expect(screen.getByRole('region', { name: 'Compare with the model answer' }).textContent).not.toMatch(/\+\d+ XP|\d+%|score:/i);
    expect(screen.getAllByRole('checkbox', { name: /^Rubric:/ })).toHaveLength(writtenFixtures[String(SORT)]!.rubric.length);
  });

  it('rubric ticks persist in this browser only: no API call, keyed to the stored answer', async () => {
    const { api, calls } = spyApi();
    const { user, unmount } = renderApp(`/play/${SORT}`, api);
    await user.type(await screen.findByRole('textbox', { name: 'Your answer' }), 'boolean comparator');
    await user.click(screen.getByRole('button', { name: /Submit answer/ }));
    await user.click(screen.getByRole('button', { name: /Store answer and show the model answer/ }));
    const why = await screen.findByRole('checkbox', { name: /Names the underlying rule/ });
    const before = calls.length;
    await user.click(why);
    expect(why).toBeChecked();
    expect(calls.length).toBe(before); // nothing sent: not evidence, not XP
    const stored = Number(/#(\d+)/.exec(screen.getByTestId('stored-meta').textContent ?? '')![1]);
    expect(JSON.parse(window.localStorage.getItem(marksKey(SORT, stored))!)).toEqual({ why: true });

    // a revisit (same server state) loads the model answer straight away and keeps the ticks
    unmount();
    const again = spyApi(api);
    renderApp(`/play/${SORT}`, again.api);
    expect(await screen.findByTestId('model-answer')).toHaveTextContent(MODEL_MARK);
    expect(again.calls).not.toContain('answerWritten');
    expect(screen.getByRole('checkbox', { name: /Names the underlying rule/ })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /Names the underlying rule/ }));
    expect(window.localStorage.getItem(marksKey(SORT, stored))).toBeNull();
  });

  it('keeps an unsent draft locally across a reload, clears it once the answer is stored', async () => {
    const api = createMockApi();
    const first = renderApp(`/play/${SORT}`, api);
    await first.user.type(await screen.findByRole('textbox', { name: 'Your answer' }), 'half a thought');
    expect(window.localStorage.getItem(draftKey(SORT))).toBe('half a thought');
    first.unmount();

    const second = renderApp(`/play/${SORT}`, api);
    const box = await screen.findByRole('textbox', { name: 'Your answer' });
    expect(box).toHaveValue('half a thought');
    await second.user.type(box, ', finished');
    await second.user.click(screen.getByRole('button', { name: /Submit answer/ }));
    await second.user.click(screen.getByRole('button', { name: /Store answer and show the model answer/ }));
    expect(await screen.findByTestId('stored-answer')).toHaveTextContent('half a thought, finished');
    expect(window.localStorage.getItem(draftKey(SORT))).toBeNull();
  });

  it('works when browser storage throws (private window): no crash, the answer still goes through', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { user } = renderApp(`/play/${SORT}`);
    await user.type(await screen.findByRole('textbox', { name: 'Your answer' }), 'still works');
    await user.click(screen.getByRole('button', { name: /Submit answer/ }));
    await user.click(screen.getByRole('button', { name: /Store answer and show the model answer/ }));
    expect(await screen.findByTestId('model-answer')).toHaveTextContent(MODEL_MARK);
    await user.click(screen.getByRole('checkbox', { name: /Names the underlying rule/ }));
    expect(screen.getByRole('checkbox', { name: /Names the underlying rule/ })).toBeChecked();
  });

  it('a review task: the starter template prefills the answer and the numbered listing renders as code', async () => {
    renderApp(`/play/${REVIEW}`);
    const box = await screen.findByRole('textbox', { name: 'Your answer' });
    expect(box).toHaveValue(writtenFixtures[String(REVIEW)]!.starter);
    // the untouched starter is not saved as a draft
    expect(window.localStorage.getItem(draftKey(REVIEW))).toBeNull();
    const pre = screen.getByRole('region', { name: 'Question' }).querySelector('pre.code-block');
    expect(pre?.textContent).toMatch(/^1 app\.patch[\s\S]*\n6 \}\);$/);
    expect(document.body.textContent).not.toContain('IDOR');
  });
});

describe('mock contract mirrors the server (written units)', () => {
  it('detail withholds the rubric until answered; model answer is 403 NOT_ANSWERED until then', async () => {
    const api = createMockApi();
    const before = await api.getUnit(SORT);
    expect(before.rubric).toBeNull();
    expect(before.written).toEqual({ answered: false });
    expect(before.check).toBeNull();
    expect(JSON.stringify(before)).not.toContain(MODEL_MARK);
    await expect(api.getModelAnswer(SORT)).rejects.toSatisfy((e: unknown) => isApiError(e, 'NOT_ANSWERED'));
    await expect(api.answerWritten(SORT, { answer: '  ', selfAssisted: false })).rejects.toSatisfy((e: unknown) => isApiError(e, 'VALIDATION'));
    await expect(api.answerWritten(101, { answer: 'x', selfAssisted: false })).rejects.toSatisfy((e: unknown) => isApiError(e, 'WRONG_UNIT_KIND'));

    const rec = await api.answerWritten(SORT, { answer: 'first', selfAssisted: true });
    expect(rec).toMatchObject({ mode: 'assisted', outcome: 'submitted' });
    const after = await api.getUnit(SORT);
    expect(after.written).toEqual({ answered: true });
    expect(after.rubric).toEqual(writtenFixtures[String(SORT)]!.rubric);
    // append-only: a later answer is a new row; the model answer stays anchored on the first
    await api.answerWritten(SORT, { answer: 'second', selfAssisted: false });
    const m = await api.getModelAnswer(SORT);
    expect([m.attemptId, m.answer]).toEqual([rec.attemptId, 'first']);
  });
});
