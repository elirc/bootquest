import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi } from '../api/types';
import { renderApp } from '../test/render';

const EB = 105; // explain-back: closures (3 questions, 5 key points)
const KATA = 109; // patch kata: ownership check (2 seeded defects)
const KEY_POINT_TEXT = 'A closure captures the variable binding, not a snapshot of its value.';
const DEFECT_TEXT = 'User A requests /orders/<id of user B>.';

/** Records every API method called, in order. */
function spyApi(): { api: BootQuestApi; calls: string[] } {
  const base = createMockApi();
  const calls: string[] = [];
  const api = Object.fromEntries(
    Object.entries(base).map(([k, fn]) => [k, (...a: unknown[]) => (calls.push(k), (fn as (...x: unknown[]) => unknown)(...a))]),
  ) as unknown as BootQuestApi;
  return { api, calls };
}

describe('explain-back player: immutable answer first, then the key, then the self-score', () => {
  it('shows only the questions with the code hidden; key points appear only after the answers are stored', async () => {
    const { api, calls } = spyApi();
    const { user } = renderApp(`/play/${EB}`, api);
    expect(await screen.findByText('What does a closure capture, and when is that binding read?')).toBeInTheDocument();
    expect(screen.getByTestId('code-hidden')).toHaveTextContent('Code hidden');
    expect(document.body.textContent).not.toContain(KEY_POINT_TEXT);
    expect(screen.queryByRole('button', { name: /Reveal solution/ })).not.toBeInTheDocument();
    expect(document.querySelector('.editor')).toBeNull();

    const submit = screen.getByRole('button', { name: /Submit answers/ });
    expect(submit).toBeDisabled();
    for (let i = 1; i <= 3; i++) await user.type(screen.getByRole('textbox', { name: `Answer ${i}` }), `my answer ${i}`);
    await user.click(submit);
    const dialog = screen.getByRole('alertdialog', { name: 'Submit your answers?' });
    expect(dialog).toHaveTextContent('cannot be edited');
    expect(calls).not.toContain('answerExplainBack');
    await user.click(within(dialog).getByRole('button', { name: /Store answers/ }));

    expect(await screen.findByText(KEY_POINT_TEXT)).toBeInTheDocument();
    expect(screen.getByTestId('stored-answer-1')).toHaveTextContent('my answer 1');
    // order: the answer row is written BEFORE the key is requested successfully
    expect(calls.indexOf('answerExplainBack')).toBeLessThan(calls.lastIndexOf('getExplainBackKey'));

    // mark 4 of 5 covered = 80% -> passes, retest scheduled
    for (const id of ['q1k1', 'q1k2', 'q2k1', 'q2k2']) await user.click(screen.getByRole('radio', { name: `${id} covered` }));
    const scoreBtn = screen.getByRole('button', { name: /Submit self-score/ });
    expect(scoreBtn).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'q3k1 missed' }));
    await user.click(scoreBtn);
    expect(await screen.findByTestId('coverage-result')).toHaveTextContent('Coverage 80% (4/5)');
    expect(screen.getByTestId('coverage-result')).toHaveTextContent('+20 XP');
    expect(screen.getByTestId('retest-notice')).toHaveTextContent('Retest scheduled: Changed example: group records by key length opens');
  });

  it('below 80% coverage: no retest is scheduled', async () => {
    const { user } = renderApp(`/play/${EB}`);
    await screen.findByText('What does a closure capture, and when is that binding read?');
    for (let i = 1; i <= 3; i++) await user.type(screen.getByRole('textbox', { name: `Answer ${i}` }), 'x');
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    await user.click(screen.getByRole('button', { name: /Store answers/ }));
    await screen.findByText(KEY_POINT_TEXT);
    for (const id of ['q1k1', 'q1k2', 'q2k1']) await user.click(screen.getByRole('radio', { name: `${id} covered` }));
    for (const id of ['q2k2', 'q3k1']) await user.click(screen.getByRole('radio', { name: `${id} missed` }));
    await user.click(screen.getByRole('button', { name: /Submit self-score/ }));
    expect(await screen.findByTestId('coverage-result')).toHaveTextContent('Coverage 60% (3/5)');
    expect(screen.getByTestId('retest-notice')).toHaveTextContent('No retest scheduled');
  });

  it('an already-answered unit opens straight on the key flow (answers are immutable)', async () => {
    const api = createMockApi();
    await api.answerExplainBack(EB, { answers: ['a', 'b', 'c'], selfAssisted: false });
    await expect(api.answerExplainBack(EB, { answers: ['a', 'b', 'c'], selfAssisted: false })).rejects.toMatchObject({ code: 'ALREADY_ANSWERED' });
    renderApp(`/play/${EB}`, api);
    expect(await screen.findByText(KEY_POINT_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Answer 1' })).not.toBeInTheDocument();
  });

  it('mock honesty: no key before the answer, no key points in getUnit, no double score', async () => {
    const api = createMockApi();
    expect(JSON.stringify(await api.getUnit(EB))).not.toContain('keyPoints');
    await expect(api.getExplainBackKey(EB)).rejects.toMatchObject({ code: 'NOT_ANSWERED' });
    await api.answerExplainBack(EB, { answers: ['a', 'b', 'c'], selfAssisted: false });
    const all = { q1k1: 'covered', q1k2: 'covered', q2k1: 'covered', q2k2: 'covered', q3k1: 'covered' } as const;
    await api.selfScoreExplainBack(EB, { perKeyPoint: all });
    await expect(api.selfScoreExplainBack(EB, { perKeyPoint: all })).rejects.toMatchObject({ code: 'ALREADY_SCORED' });
  });
});

describe('patch-kata player', () => {
  it('renders the diff with +/- line classes, takes findings, and reveals the key only after', async () => {
    const { user } = renderApp(`/play/${KATA}`);
    const diff = await screen.findByTestId('diff');
    expect(diff.querySelector('.diff-add')).toHaveTextContent('+ // ownership is checked by the gateway');
    expect(diff.querySelector('.diff-del')).toHaveTextContent('- if (order.ownerId');
    expect(diff.querySelector('.diff-hunk')).not.toBeNull();
    expect(document.body.textContent).not.toContain(DEFECT_TEXT);
    expect(screen.queryByRole('button', { name: /Reveal solution/ })).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Finding 1 scenario' }), 'another user id');
    await user.type(screen.getByRole('textbox', { name: 'Finding 1 evidence' }), 'src/orders.js:11');
    await user.type(screen.getByRole('textbox', { name: 'Finding 1 consequence' }), 'IDOR');
    await user.click(screen.getByRole('button', { name: 'Add finding' }));
    expect(screen.getByRole('textbox', { name: 'Finding 2 scenario' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove finding 2' }));
    await user.click(screen.getByRole('button', { name: /Submit findings/ }));

    expect(await screen.findByText(DEFECT_TEXT)).toBeInTheDocument();
    expect(screen.getByTestId('kata-key')).toHaveTextContent('another user id');
    await user.click(screen.getByRole('radio', { name: 'd1 caught' }));
    await user.click(screen.getByRole('radio', { name: 'd2 missed' }));
    await user.click(screen.getByRole('button', { name: /Submit catch score/ }));
    expect(await screen.findByTestId('catch-result')).toHaveTextContent('Caught 1/2 (50%)');
    expect(screen.getByTestId('catch-result')).toHaveTextContent('+15 XP');
  });
});

describe('dashboard promotion legs', () => {
  it('renders the three legs from the evaluator state and tolerates missing promotion', async () => {
    renderApp('/');
    const table = await screen.findByRole('table');
    const lf = table.querySelector('[data-competency="language-fluency"]')!;
    expect(lf.querySelector('[data-leg="artifact"]')).toHaveAttribute('data-state', 'done');
    expect(lf.querySelector('[data-leg="explain"]')).toHaveTextContent('done 88%');
    expect(lf.querySelector('[data-leg="retest"]')).toHaveAttribute('data-state', 'scheduled');
    expect(lf.querySelector('[data-leg="retest"]')).toHaveTextContent('opens Oct 9');
    const dh = table.querySelector('[data-competency="data-http"]')!;
    expect(dh.querySelector('[data-leg="explain"]')).toHaveAttribute('data-state', 'failed');
    expect(dh.querySelector('[data-leg="explain"] .chip')).toHaveClass('chip-danger');
    // fix/client-dash: the artifact / retest leg chips are links too now; this is the evidence one
    expect(within(lf as HTMLElement).getByRole('link', { name: /#412/ })).toHaveAttribute('href', '/stats?competency=language-fluency#evidence-412');

    const base = createMockApi();
    const old: BootQuestApi = {
      ...base,
      getDashboard: async () => {
        const d = await base.getDashboard();
        return { ...d, competencies: d.competencies.map(({ promotion: _p, ...r }) => r) };
      },
    };
    renderApp('/', old);
    await waitFor(() => expect(screen.getAllByRole('table')).toHaveLength(2));
    const second = screen.getAllByRole('table')[1]!;
    expect(second.querySelector('[data-leg]')).toBeNull();
  });
});

describe('stats: G1 catch rate + evidence browser', () => {
  it('filters evidence by competency (synced to ?competency=) and expands an attempt inline', async () => {
    const { user } = renderApp('/stats?competency=language-fluency');
    const list = await screen.findByTestId('evidence-list');
    expect(within(list).getAllByRole('listitem').every((li) => li.getAttribute('data-competency') === 'language-fluency')).toBe(true);
    expect(document.getElementById('evidence-412')).not.toBeNull();
    expect(document.getElementById('evidence-409')).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by competency' }), '');
    await waitFor(() => expect(document.getElementById('evidence-409')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: 'attempt #8811' }));
    expect(await screen.findByTestId('attempt-8811')).toHaveTextContent('signalpost U01');
    expect(screen.getByTestId('attempt-8811')).toHaveTextContent('pass 412ms');
    expect(screen.getByTestId('catch-rate')).toHaveTextContent('No kata self-scored yet.');
    expect(screen.getByTestId('catch-rate')).toHaveTextContent('G1 gate not met');
  });

  it('a scored kata feeds the G1 numbers', async () => {
    const api = createMockApi();
    await api.submitKataFindings(KATA, { findings: [{ scenario: 's', evidence: 'e', consequence: 'c' }], selfAssisted: false });
    await api.selfScoreKata(KATA, { perDefect: { d1: 'caught', d2: 'caught' } });
    renderApp('/stats', api);
    const panel = await screen.findByTestId('catch-rate');
    expect(panel).toHaveTextContent('2/ 2 seeded defects caught');
    expect(panel).toHaveTextContent('100% across 1 kata(s)');
    expect(screen.queryByTestId('kata-assisted')).toBeNull();
  });

  it('W7: a self-flagged assisted kata is shown separately and never feeds the G1 numbers', async () => {
    const api = createMockApi();
    await api.submitKataFindings(KATA, { findings: [{ scenario: 's', evidence: 'e', consequence: 'c' }], selfAssisted: true });
    await api.selfScoreKata(KATA, { perDefect: { d1: 'caught', d2: 'caught' } });
    renderApp('/stats', api);
    const panel = await screen.findByTestId('catch-rate');
    expect(panel).toHaveTextContent('No kata self-scored yet.');
    expect(screen.getByTestId('kata-assisted')).toHaveTextContent('1 assisted / guided kata not counted toward G1');
  });

  it('W7: the kata pane does not announce how many defects are seeded before the findings', async () => {
    renderApp(`/play/${KATA}`);
    await screen.findByText(/Review this patch like a PR/);
    expect(document.body.textContent).not.toMatch(/hides \d+ seeded defect/);
  });
});
