import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { INTERVIEW_FRAMEWORK, INTERVIEW_TIME_BOX_MS } from '@bootquest/shared/api-ext';
import { ALT_SET_A_ID } from '../api/fixtures/ladder';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, DesignProfileResponse, InterviewMetaBody } from '../api/types';
import { renderApp } from '../test/render';
import { fmtClock } from './LadderPanes';
import { weakestDimension } from './Stats';

// rv2 S3 F5: DESIGN IT interview mode S (timer, blind, six framework headings, the elapsed time filed with the answer
// before the key is read) and the dimension profile on Stats.

const SLOW = { timeout: 15_000 };
beforeEach(() => window.localStorage.clear());

function spyApi(over: Partial<BootQuestApi> = {}): { api: BootQuestApi; calls: string[]; metas: InterviewMetaBody[] } {
  const base = { ...createMockApi(), ...over };
  const calls: string[] = [];
  const metas: InterviewMetaBody[] = [];
  const api = Object.fromEntries(
    Object.entries(base).map(([k, fn]) => [
      k,
      (...a: unknown[]) => {
        calls.push(k);
        if (k === 'recordInterviewMeta') metas.push(a[1] as InterviewMetaBody);
        return (fn as (...x: unknown[]) => unknown)(...a);
      },
    ]),
  ) as unknown as BootQuestApi;
  return { api, calls, metas };
}

describe('interview mode S on a DESIGN IT set', () => {
  it('offered, then a timer + the six headings; the answer is stored first, its meta next, the key last', async () => {
    const { api, calls, metas } = spyApi();
    const { user } = renderApp(`/play/${ALT_SET_A_ID}`, api);
    const offer = await screen.findByTestId('interview-offer', {}, SLOW);
    expect(offer).toHaveTextContent('45-minute time box, blind, the six framework headings');
    await user.click(within(offer).getByRole('button', { name: 'Start the interview' }));
    const bar = screen.getByTestId('interview-bar');
    expect(within(bar).getByTestId('interview-timer')).toHaveTextContent(`of ${fmtClock(INTERVIEW_TIME_BOX_MS)}`);
    expect([...within(bar).getByTestId('interview-framework').querySelectorAll('li')].map((li) => li.textContent)).toEqual([...INTERVIEW_FRAMEWORK]);
    expect(screen.queryByTestId('interview-offer')).toBeNull();
    const show = screen.queryByRole('button', { name: /Show sections/ });
    if (show) expect(show).toBeDisabled(); // blind stays on while interviewing

    const boxes = screen.getAllByRole('textbox', { name: /^Answer \d+$/ });
    for (const b of boxes) await user.type(b, 'Partition by tenant, cache the hot reads, and keep every retried write idempotent with a key.');
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    await user.click(screen.getByRole('button', { name: /Store answers/ }));
    await screen.findByRole('heading', { name: /Key points/ }, SLOW);
    const ia = calls.indexOf('answerExplainBack');
    const im = calls.indexOf('recordInterviewMeta');
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(im).toBeGreaterThan(ia);
    expect(calls.lastIndexOf('getExplainBackKey')).toBeGreaterThan(im);
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ timeBoxMs: INTERVIEW_TIME_BOX_MS, blind: true });
    expect(metas[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(metas[0]!.attemptId).toBeGreaterThan(0);
  });

  it('a failed meta never blocks the key: a note says the time was not saved', async () => {
    const base = createMockApi();
    const api: BootQuestApi = { ...base, recordInterviewMeta: async () => Promise.reject(new Error('meta down')) };
    const { user } = renderApp(`/play/${ALT_SET_A_ID}`, api);
    await user.click(await screen.findByRole('button', { name: 'Start the interview' }, SLOW));
    for (const b of screen.getAllByRole('textbox', { name: /^Answer \d+$/ })) await user.type(b, 'Shard by tenant id, and make the writes idempotent so retries are safe under load.');
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    await user.click(screen.getByRole('button', { name: /Store answers/ }));
    await screen.findByRole('heading', { name: /Key points/ }, SLOW);
    expect(screen.getByTestId('interview-meta-error')).toHaveTextContent('The interview time was not saved');
  });

  it('not offered on an ordinary explain-back', async () => {
    renderApp('/play/105');
    await screen.findByText('What does a closure capture, and when is that binding read?', {}, SLOW);
    expect(screen.queryByTestId('interview-offer')).toBeNull();
  });
});

const profile = (over: Partial<DesignProfileResponse> = {}): DesignProfileResponse => ({
  headlinesLoaded: true,
  answers: 3,
  dimensions: [
    { id: 'requirements', description: 'scope and numbers', covered: 4, missed: 1, coverage: 0.8, answers: 2 },
    { id: 'data-and-api', description: null, covered: 0, missed: 0, coverage: null, answers: 0 },
    { id: 'consistency', description: null, covered: 2, missed: 3, coverage: 0.4, answers: 2 },
    { id: 'scaling', description: null, covered: 3, missed: 0, coverage: 1, answers: 1 },
    { id: 'reliability', description: null, covered: 0, missed: 0, coverage: null, answers: 0 },
    { id: 'security', description: null, covered: 1, missed: 1, coverage: 0.5, answers: 1 },
    { id: 'operations', description: null, covered: 0, missed: 0, coverage: null, answers: 0 },
    { id: 'trade-offs', description: null, covered: 0, missed: 0, coverage: null, answers: 0 },
  ],
  unclassified: { covered: 5, missed: 2 },
  interview: { answers: 2, medianElapsedMs: 38 * 60_000 + 5_000, overTime: 1 },
  ...over,
});

describe('Stats: the DESIGN IT dimension profile', () => {
  it('one row per dimension, the weakest named (>= 3 marked), unclassified and interview lines', async () => {
    renderApp('/stats', { ...createMockApi(), getDesignProfile: async () => profile() });
    const panel = await screen.findByTestId('design-profile', {}, SLOW);
    expect(panel.querySelectorAll('[data-dimension]')).toHaveLength(8);
    expect(panel.querySelector('[data-dimension="consistency"]')).toHaveTextContent('2/5');
    expect(panel.querySelector('[data-dimension="data-and-api"]')).toHaveTextContent('none yet');
    expect(panel.querySelector('[data-dimension="requirements"]')).toHaveAttribute('title', 'scope and numbers');
    // security (1/2) has too few marks to be named; consistency (40%) is the weakest
    expect(within(panel).getByTestId('design-weakest')).toHaveTextContent('Consistency');
    expect(within(panel).getByTestId('design-unclassified')).toHaveTextContent('7 marked key points from sets without a dimension yet (5 covered)');
    expect(within(panel).getByTestId('design-interview')).toHaveTextContent('Interview mode: 2 answers, median 38:05, 1 over the time box.');
  });

  it('no headlines file: every point unclassified, said so; no answers: the empty text', async () => {
    const none = profile({ headlinesLoaded: false, dimensions: profile().dimensions.map((d) => ({ ...d, covered: 0, missed: 0, coverage: null, answers: 0 })) });
    expect(weakestDimension(none)).toBeNull();
    const first = renderApp('/stats', { ...createMockApi(), getDesignProfile: async () => none });
    expect(await screen.findByTestId('design-unclassified', {}, SLOW)).toHaveTextContent('No headlines file on this server');
    expect(screen.queryByTestId('design-weakest')).toBeNull();
    first.unmount();
    renderApp('/stats');
    const empty = await screen.findByTestId('design-profile-empty', {}, SLOW);
    expect(empty).toHaveTextContent('No DESIGN IT or G2 answer self-scored yet.');
    await waitFor(() => expect(screen.queryByTestId('design-profile')).toBeNull());
  });
});
