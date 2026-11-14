import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fundStudyFixtures } from '../api/fixtures/fundamentals';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, CalibrationResponse } from '../api/types';
import { renderApp } from '../test/render';
import { PRETEST_KEY_PREFIX } from './StudyQuestPane';

// rv2 S3 F9 (stretch): "How sure?" on a graded quiz gate / explain-back answer, filed after the attempt exists and
// before the result matters; the calibration panel on Stats.

const SLOW = { timeout: 15_000 };
const T1 = 207;
const FX1 = fundStudyFixtures[String(T1)]!;
beforeEach(() => window.localStorage.clear());

describe('confidence tag on graded answers', () => {
  it('quiz gate: picked on the review screen, filed with the new attempt id; never in practice', async () => {
    const base = createMockApi();
    const tagConfidence = vi.fn(base.tagConfidence);
    const submitUnit = vi.fn(base.submitUnit);
    window.localStorage.setItem(`${PRETEST_KEY_PREFIX}${T1}`, '1');
    const { user } = renderApp(`/play/${T1}`, { ...base, tagConfidence, submitUnit });
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }, SLOW));
    for (const [qi, ci] of FX1.keys.entries()) {
      await user.click(screen.getByRole('radio', { name: `Q${qi + 1} choice ${ci + 1}` }));
      await user.click(screen.getByRole('button', { name: qi === FX1.keys.length - 1 ? /Review answers/ : /^Next/ }));
    }
    const pick = screen.getByTestId('confidence-pick');
    await user.click(within(pick).getByRole('radio', { name: 'Confidence: Sure' }));
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    const attemptId = (await submitUnit.mock.results[0]!.value).attempt.id as number;
    expect(tagConfidence).toHaveBeenCalledWith(attemptId, 'sure');
    expect(screen.queryByTestId('confidence-pick')).toBeNull(); // gone with the open gate
  });

  it('explain-back: tagged right after the answer is stored, before the key; untagged = no call', async () => {
    const base = createMockApi();
    const calls: string[] = [];
    const api: BootQuestApi = {
      ...base,
      answerExplainBack: async (...a) => (calls.push('answer'), base.answerExplainBack(...a)),
      tagConfidence: async (...a) => (calls.push('tag'), base.tagConfidence(...a)),
      getExplainBackKey: async (...a) => (calls.push('key'), base.getExplainBackKey(...a)),
    };
    const { user } = renderApp('/play/105', api);
    await screen.findByText('What does a closure capture, and when is that binding read?', {}, SLOW);
    for (let i = 1; i <= 3; i++) await user.type(screen.getByRole('textbox', { name: `Answer ${i}` }), 'x');
    await user.click(within(screen.getByTestId('confidence-pick')).getByRole('radio', { name: 'Confidence: Guessing' }));
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    await user.click(screen.getByRole('button', { name: /Store answers/ }));
    await screen.findByRole('heading', { name: /Key points/ }, SLOW);
    const answered = calls.indexOf('answer');
    expect(calls.indexOf('tag')).toBeGreaterThan(answered);
    expect(calls.slice(answered).indexOf('key')).toBeGreaterThan(calls.slice(answered).indexOf('tag'));
  });
});

describe('rv3 W10a: confidence tag on Player drill and quiz submits', () => {
  it('drill: picked before Submit, filed with the new attempt id, then cleared; an untagged submit files nothing', async () => {
    const base = createMockApi();
    const tagConfidence = vi.fn(base.tagConfidence);
    const submitUnit = vi.fn(base.submitUnit);
    const { user } = renderApp('/play/102', { ...base, tagConfidence, submitUnit });
    await screen.findByRole('textbox', { name: /Code editor/ }, SLOW);
    const pick = screen.getByTestId('confidence-pick');
    await user.click(within(pick).getByRole('radio', { name: 'Confidence: Unsure' }));
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await vi.waitFor(() => expect(submitUnit).toHaveBeenCalledTimes(1));
    const attemptId = (await submitUnit.mock.results[0]!.value).attempt.id as number;
    await vi.waitFor(() => expect(tagConfidence).toHaveBeenCalledWith(attemptId, 'unsure'));
    // one tag per graded try: the pick is cleared, and a second submit with no pick files nothing more
    expect(within(screen.getByTestId('confidence-pick')).getByRole('radio', { name: 'Confidence: Unsure' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await vi.waitFor(() => expect(submitUnit).toHaveBeenCalledTimes(2));
    expect(tagConfidence).toHaveBeenCalledTimes(1);
  });

  it('quiz: picked before Check answer, filed with the attempt; gone once passed', async () => {
    const base = createMockApi();
    const tagConfidence = vi.fn(base.tagConfidence);
    const submitUnit = vi.fn(base.submitUnit);
    const { user } = renderApp('/play/103', { ...base, tagConfidence, submitUnit });
    await screen.findByRole('heading', { name: 'What does this print?' }, SLOW);
    await user.click(screen.getByRole('radio', { name: /A D C B/ }));
    await user.click(within(screen.getByTestId('confidence-pick')).getByRole('radio', { name: 'Confidence: Sure' }));
    await user.click(screen.getByRole('button', { name: /Check answer/ }));
    await vi.waitFor(() => expect(submitUnit).toHaveBeenCalledTimes(1));
    const attemptId = (await submitUnit.mock.results[0]!.value).attempt.id as number;
    await vi.waitFor(() => expect(tagConfidence).toHaveBeenCalledWith(attemptId, 'sure'));
    await vi.waitFor(() => expect(screen.queryByTestId('confidence-pick')).toBeNull());
  });
});

describe('Stats: calibration', () => {
  it('per level answers and passes; "sure but failed" named; empty text before any graded tag', async () => {
    const data: CalibrationResponse = {
      levels: [
        { confidence: 'sure', answers: 4, passed: 3, passRate: 0.75 },
        { confidence: 'unsure', answers: 2, passed: 1, passRate: 0.5 },
        { confidence: 'guess', answers: 0, passed: 0, passRate: null },
      ],
      pending: 1,
      sureButFailed: 1,
    };
    const first = renderApp('/stats', { ...createMockApi(), getCalibration: async () => data });
    const panel = await screen.findByTestId('calibration', {}, SLOW);
    expect(panel.querySelector('[data-confidence="sure"]')).toHaveTextContent('Sure43 (75%)');
    expect(panel.querySelector('[data-confidence="guess"]')).toHaveTextContent('Guessing0');
    expect(within(panel).getByTestId('calibration-sure-failed')).toHaveTextContent('1 answer you were sure of did not pass');
    expect(panel).toHaveTextContent('1 tagged explain-back answer not self-scored yet.');
    first.unmount();
    renderApp('/stats');
    expect(await screen.findByTestId('calibration-empty', {}, SLOW)).toHaveTextContent('No tagged answer graded yet.');
  });
});
