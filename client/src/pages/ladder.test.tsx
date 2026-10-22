import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALT_SET_A_ID, ALT_SET_B_ID, GATED_ARTIFACT_ID, GATED_EXPLAIN_BACK_ID } from '../api/fixtures/ladder';
import { createMockApi } from '../api/mock';
import { ApiError, type BootQuestApi } from '../api/types';
import { renderApp } from '../test/render';
import { ebDraftKey, kataDraftKey } from './LadderPanes';

const EB = 105; // explain-back: closures (3 questions, 5 key points)
const KATA = 109; // patch kata: ownership check (2 seeded defects)
const GATED_EB = GATED_EXPLAIN_BACK_ID; // explain-back = promotion leg (b) of the program unit 303
const ARTIFACT = GATED_ARTIFACT_ID;
const ARTIFACT_TITLE = 'Agent harness U01: the tool-call loop';

// drafts live in localStorage: every test starts from an empty browser
beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());
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
    await user.click(within(screen.getByRole('alertdialog', { name: 'File this self-score?' })).getByRole('button', { name: 'File self-score' }));
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
    await user.click(screen.getByRole('button', { name: 'File self-score' }));
    expect(await screen.findByTestId('coverage-result')).toHaveTextContent('Coverage 60% (3/5)');
    expect(screen.getByTestId('retest-notice')).toHaveTextContent('No retest scheduled — coverage is below the promotion threshold.');
  });

  it('a passing self-score on an alternate-set unit points at the rotating sets, not a missing variation', async () => {
    const all = { q1k1: 'covered', q1k2: 'covered', q2k1: 'covered', q2k2: 'covered', q3k1: 'covered' } as const;
    /** EB with its seeded retest suppressed; `withAltSets` adds a 2-sibling alternate-set group to getUnit. */
    const apiFor = (withAltSets: boolean): BootQuestApi => {
      const base = createMockApi();
      return {
        ...base,
        getUnit: async (id) => {
          const u = await base.getUnit(id);
          if (id !== EB || !withAltSets || !u.explainBack) return u;
          const altSets = {
            group: 'g-closures',
            label: 'A',
            siblings: [
              { unitId: EB, label: 'A', answered: false, scored: false },
              { unitId: 9_105, label: 'B', answered: false, scored: false },
            ],
            gate: { open: true, opensAt: null },
          };
          return { ...u, explainBack: { ...u.explainBack, altSets } };
        },
        selfScoreExplainBack: async (id, body) => ({ ...(await base.selfScoreExplainBack(id, body)), retests: [] }),
      };
    };
    const scoreAllCovered = async (user: ReturnType<typeof renderApp>['user']) => {
      await answerEb(user);
      for (const id of Object.keys(all)) await user.click(screen.getByRole('radio', { name: `${id} covered` }));
      await user.click(screen.getByRole('button', { name: /Submit self-score/ }));
      await user.click(screen.getByRole('button', { name: 'File self-score' }));
      expect(await screen.findByTestId('coverage-result')).toHaveTextContent('Coverage 100% (5/5)');
      return screen.getByTestId('retest-notice');
    };

    const first = renderApp(`/play/${EB}`, apiFor(true));
    expect(await screen.findByTestId('alt-sets')).toBeInTheDocument();
    const notice = await scoreAllCovered(first.user);
    expect(notice).toHaveTextContent(
      'No changed-example retest for this unit — its spaced repetition is the rotating question sets (see the set pills above): the next fresh set opens at least 2 days after this answer.',
    );
    expect(notice).not.toHaveTextContent('no changed-example variation is seeded');
    first.unmount();
    window.localStorage.clear();

    // counter-case: no alternate sets -> the original "nothing seeded" branch, verbatim
    const second = renderApp(`/play/${EB}`, apiFor(false));
    const plain = await scoreAllCovered(second.user);
    expect(screen.queryByTestId('alt-sets')).not.toBeInTheDocument();
    expect(plain).toHaveTextContent('No retest scheduled (no changed-example variation is seeded for this artifact yet).');
    expect(plain).not.toHaveTextContent('rotating question sets');
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
    await user.click(screen.getByRole('button', { name: 'File catch score' }));
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

/** Store answers to EB 105 through the UI, landing on the key view. */
async function answerEb(user: ReturnType<typeof renderApp>['user']) {
  await screen.findByRole('textbox', { name: 'Answer 1' });
  for (let i = 1; i <= 3; i++) await user.type(screen.getByRole('textbox', { name: `Answer ${i}` }), `a${i}`);
  await user.click(screen.getByRole('button', { name: /Submit answers/ }));
  await user.click(screen.getByRole('button', { name: /Store answers/ }));
  await screen.findByText(KEY_POINT_TEXT);
}

describe('drafts: unsent answers survive a remount (per-browser, per item version)', () => {
  it('explain-back answers + the help flag are restored after an unmount; storing the answer clears the draft', async () => {
    const api = createMockApi();
    const first = renderApp(`/play/${EB}`, api);
    await first.user.type(await screen.findByRole('textbox', { name: 'Answer 1' }), 'binding, not value');
    await first.user.type(screen.getByRole('textbox', { name: 'Answer 2' }), 'var is function scoped');
    await first.user.click(screen.getByRole('checkbox', { name: 'I had help' }));
    const key = ebDraftKey(EB, (await api.getUnit(EB)).explainBack!);
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ answers: ['binding, not value', 'var is function scoped', ''], assisted: true });
    first.unmount();

    const { user } = renderApp(`/play/${EB}`, api);
    expect(await screen.findByRole('textbox', { name: 'Answer 1' })).toHaveValue('binding, not value');
    expect(screen.getByRole('textbox', { name: 'Answer 2' })).toHaveValue('var is function scoped');
    expect(screen.getByRole('checkbox', { name: 'I had help' })).toBeChecked();
    expect(screen.getByTestId('draft-restored')).toHaveTextContent('Restored your unsent draft');

    await user.type(screen.getByRole('textbox', { name: 'Answer 3' }), 'a counter factory');
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    await user.click(screen.getByRole('button', { name: /Store answers/ }));
    expect(await screen.findByText(KEY_POINT_TEXT)).toBeInTheDocument();
    expect(window.localStorage.getItem(key)).toBeNull();
    // the help flag travelled with the draft into the stored attempt
    expect((await api.getAttempt((await api.getExplainBackKey(EB)).attemptId)).mode).toBe('assisted');
  });

  it('kata findings (several rows) are restored after an unmount and cleared once recorded', async () => {
    const api = createMockApi();
    const first = renderApp(`/play/${KATA}`, api);
    await first.user.type(await screen.findByRole('textbox', { name: 'Finding 1 scenario' }), 'another user id');
    await first.user.click(screen.getByRole('button', { name: 'Add finding' }));
    await first.user.type(screen.getByRole('textbox', { name: 'Finding 2 evidence' }), 'src/orders.js:10');
    first.unmount();

    const { user } = renderApp(`/play/${KATA}`, api);
    expect(await screen.findByRole('textbox', { name: 'Finding 1 scenario' })).toHaveValue('another user id');
    expect(screen.getByRole('textbox', { name: 'Finding 2 evidence' })).toHaveValue('src/orders.js:10');
    expect(screen.getByTestId('draft-restored')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove finding 2' }));
    await user.type(screen.getByRole('textbox', { name: 'Finding 1 evidence' }), 'src/orders.js:11');
    await user.type(screen.getByRole('textbox', { name: 'Finding 1 consequence' }), 'IDOR');
    await user.click(screen.getByRole('button', { name: /Submit findings/ }));
    expect(await screen.findByTestId('kata-key')).toBeInTheDocument();
    expect(window.localStorage.getItem(kataDraftKey(KATA, (await api.getUnit(KATA)).kata!.diff))).toBeNull();
  });

  // fix/client-review 2: the guard protects work that exists ONLY in memory (storage refused the
  // draft). A stored draft restores on the next visit, so then leaving asks nothing.
  it('storage working: a dirty draft is stored, so neither a tab close nor an in-app navigation asks', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user, path } = renderApp(`/play/${EB}`);
    const box = await screen.findByRole('textbox', { name: 'Answer 1' });
    await user.type(box, 'x');
    expect(unload()).toBe(false);
    expect(screen.queryByTestId('draft-unsaved')).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('complementary', { name: 'Primary' })).getByRole('link', { name: /Dashboard/ }));
    await waitFor(() => expect(path()).toBe('/'));
    expect(confirm).not.toHaveBeenCalled();
    expect(ebDraftKey(EB, { questions: [{ prompt: 'v1' }] })).not.toBe(ebDraftKey(EB, { questions: [{ prompt: 'v2' }] }));
  });

  it('storage refused: a dirty draft warns in the pane and guards both the tab close and an in-app navigation', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user, path } = renderApp(`/play/${EB}`);
    const box = await screen.findByRole('textbox', { name: 'Answer 1' });
    expect(unload()).toBe(false); // nothing to lose yet
    expect(screen.queryByTestId('draft-unsaved')).not.toBeInTheDocument();
    await user.type(box, 'x');
    expect(screen.getByTestId('draft-unsaved')).toHaveTextContent('leaving this page will lose it');
    expect(unload()).toBe(true);

    const dashboard = within(screen.getByRole('complementary', { name: 'Primary' })).getByRole('link', { name: /Dashboard/ });
    await user.click(dashboard);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(path()).toBe(`/play/${EB}`); // declined: still here, the answer intact
    expect(box).toHaveValue('x');

    await user.clear(box); // empty again: nothing to lose
    expect(unload()).toBe(false);
    expect(screen.queryByTestId('draft-unsaved')).not.toBeInTheDocument();
    await user.click(dashboard);
    await waitFor(() => expect(path()).toBe('/'));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('storage refused on the kata pane: the same warning and in-app guard', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user, path } = renderApp(`/play/${KATA}`);
    await user.type(await screen.findByRole('textbox', { name: 'Finding 1 scenario' }), 'another user id');
    expect(screen.getByTestId('draft-unsaved')).toBeInTheDocument();
    expect(unload()).toBe(true);
    await user.click(within(screen.getByRole('complementary', { name: 'Primary' })).getByRole('link', { name: /Dashboard/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(path()).toBe(`/play/${KATA}`);
  });
});

function unload(): boolean {
  const ev = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

describe('self-score: live preview against the pass mark, then a confirm (permanent)', () => {
  it('explain-back: the coverage preview follows every mark; Cancel files nothing; the confirm states permanence', async () => {
    const { api, calls } = spyApi();
    const { user } = renderApp(`/play/${EB}`, api);
    await answerEb(user);
    const preview = screen.getByTestId('score-preview');
    expect(preview).toHaveTextContent('0/5 covered = 0% — below the 80% promotion gate (5 still unmarked)');
    await user.click(screen.getByRole('radio', { name: 'q1k1 covered' }));
    expect(preview).toHaveTextContent('1/5 covered = 20% — below the 80% promotion gate (4 still unmarked)');
    for (const id of ['q1k2', 'q2k1', 'q2k2']) await user.click(screen.getByRole('radio', { name: `${id} covered` }));
    await user.click(screen.getByRole('radio', { name: 'q3k1 missed' }));
    expect(preview).toHaveTextContent('4/5 covered = 80% — meets the 80% promotion gate');
    expect(preview).toHaveClass('is-pass');
    // one misclick flips it below the gate, and the preview says so before anything is filed
    await user.click(screen.getByRole('radio', { name: 'q2k2 missed' }));
    expect(preview).toHaveTextContent('3/5 covered = 60% — below the 80% promotion gate');
    expect(preview).toHaveClass('is-fail');

    await user.click(screen.getByRole('button', { name: /Submit self-score/ }));
    const dialog = screen.getByRole('alertdialog', { name: 'File this self-score?' });
    expect(dialog).toHaveTextContent('3/5 covered = 60%: below the 80% promotion gate.');
    // fix/client-review 3: the fail branch names this unit's gate only (its gate can sit above the leg's 80% bar)
    expect(dialog).toHaveTextContent("It files a fail against this unit's gate: no XP and no retest.");
    expect(dialog).not.toHaveTextContent('leg (b)');
    expect(dialog).toHaveTextContent('permanent');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'q2k2 covered' })).toBeDisabled(); // marks frozen while confirming
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(calls).not.toContain('selfScoreExplainBack');

    await user.click(screen.getByRole('radio', { name: 'q2k2 covered' }));
    await user.click(screen.getByRole('button', { name: /Submit self-score/ }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('meets the 80% promotion gate');
    // the pass branch is hedged: assisted answers, standalone sets and unpassed artifacts never count
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'It counts toward promotion leg (b) only when this set is linked to an artifact you passed solo and your answers were unassisted.',
    );
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent('schedules the changed-example retest');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls).not.toContain('selfScoreExplainBack');
    await user.click(screen.getByRole('button', { name: /Submit self-score/ }));
    await user.click(screen.getByRole('button', { name: 'File self-score' }));
    expect(await screen.findByTestId('coverage-result')).toHaveTextContent('Coverage 80% (4/5)');
  });

  it('the preview uses the unit\'s own pass mark when it is stricter than the promotion floor', async () => {
    const base = createMockApi();
    const api: BootQuestApi = { ...base, getUnit: async (id) => { const d = await base.getUnit(id); return d.explainBack ? { ...d, explainBack: { ...d.explainBack, minCoveragePct: 90 } } : d; } };
    const { user } = renderApp(`/play/${EB}`, api);
    await answerEb(user);
    for (const id of ['q1k1', 'q1k2', 'q2k1', 'q2k2']) await user.click(screen.getByRole('radio', { name: `${id} covered` }));
    await user.click(screen.getByRole('radio', { name: 'q3k1 missed' }));
    expect(screen.getByTestId('score-preview')).toHaveTextContent('4/5 covered = 80% — below the 90% promotion gate');
  });

  it('kata: the catch-rate preview is measured against the G1 target, and the score needs a confirm', async () => {
    const { api, calls } = spyApi();
    await api.submitKataFindings(KATA, { findings: [{ scenario: 's', evidence: 'e:1', consequence: 'c' }], selfAssisted: false });
    const { user } = renderApp(`/play/${KATA}`, api);
    await screen.findByTestId('kata-key');
    const preview = screen.getByTestId('score-preview');
    await user.click(screen.getByRole('radio', { name: 'd1 caught' }));
    expect(preview).toHaveTextContent('1/2 caught = 50% — below the 80% G1 target (1 still unmarked)');
    await user.click(screen.getByRole('radio', { name: 'd2 caught' }));
    expect(preview).toHaveTextContent('2/2 caught = 100% — meets the 80% G1 target');
    await user.click(screen.getByRole('button', { name: /Submit catch score/ }));
    const dialog = screen.getByRole('alertdialog', { name: 'File this catch score?' });
    expect(dialog).toHaveTextContent('permanent');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(calls).not.toContain('selfScoreKata');
    await user.click(screen.getByRole('button', { name: /Submit catch score/ }));
    await user.click(screen.getByRole('button', { name: 'File catch score' }));
    expect(await screen.findByTestId('catch-result')).toHaveTextContent('Caught 2/2 (100%)');
    expect(screen.getByTestId('catch-result')).toHaveClass('verdict-pass');
  });
});

describe('artifact lock: an explain-back that is leg (b) of an unpassed project is read-only', () => {
  it('shows the questions read-only under a "Pass <artifact> solo first" banner that links to the artifact', async () => {
    const { api, calls } = spyApi();
    renderApp(`/play/${GATED_EB}`, api);
    const banner = await screen.findByTestId('artifact-lock');
    expect(banner).toHaveTextContent(`Pass ${ARTIFACT_TITLE} solo first.`);
    expect(within(banner).getByRole('link', { name: ARTIFACT_TITLE })).toHaveAttribute('href', `/play/${ARTIFACT}`);
    expect(screen.getByText('When does your loop stop, and why is that condition safe?')).toBeInTheDocument();
    for (let i = 1; i <= 3; i++) expect(screen.getByRole('textbox', { name: `Answer ${i}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Submit answers/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'I had help' })).toBeDisabled();
    expect(calls).not.toContain('answerExplainBack');
  });

  it('a solo pass of the artifact opens the answer form', async () => {
    const api = createMockApi();
    await api.submitUnit(ARTIFACT, { code: 'export async function runLoop() { return 1; }', selfAssisted: false });
    const { user } = renderApp(`/play/${GATED_EB}`, api);
    const box = await screen.findByRole('textbox', { name: 'Answer 1' });
    expect(screen.queryByTestId('artifact-lock')).not.toBeInTheDocument();
    expect(box).toBeEnabled();
    await user.type(box, 'x');
    expect(box).toHaveValue('x');
  });

  it('a raced 409 ARTIFACT_REQUIRED turns into the same banner (re-read from the unit), and the draft is kept', async () => {
    const base = createMockApi();
    let served = 0;
    // the page loaded while the artifact looked passed; the server refuses at answer time
    const api: BootQuestApi = {
      ...base,
      getUnit: async (id) => {
        const d = await base.getUnit(id);
        return id === GATED_EB && served++ === 0 ? { ...d, explainBack: { ...d.explainBack!, artifactRequired: [] } } : d;
      },
    };
    const { user } = renderApp(`/play/${GATED_EB}`, api);
    await screen.findByRole('textbox', { name: 'Answer 1' });
    for (let i = 1; i <= 3; i++) await user.type(screen.getByRole('textbox', { name: `Answer ${i}` }), `draft ${i}`);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    await user.click(screen.getByRole('button', { name: /Store answers/ }));
    const banner = await screen.findByTestId('artifact-lock');
    expect(banner).toHaveTextContent(`Pass ${ARTIFACT_TITLE} solo first.`);
    expect(screen.getByRole('textbox', { name: 'Answer 1' })).toHaveValue('draft 1');
    expect(screen.getByRole('textbox', { name: 'Answer 1' })).toBeDisabled();
    await expect(base.getExplainBackKey(GATED_EB)).rejects.toMatchObject({ code: 'NOT_ANSWERED' });
  });

  it('without a fresh lock list the 409 still reads as the friendly message', async () => {
    const base = createMockApi();
    let served = 0;
    const api: BootQuestApi = {
      ...base,
      getUnit: async (id) => {
        if (id === GATED_EB && served++ > 0) throw new ApiError(0, 'NETWORK', 'offline');
        const d = await base.getUnit(id);
        return id === GATED_EB ? { ...d, explainBack: { ...d.explainBack!, artifactRequired: [] } } : d;
      },
    };
    const { user } = renderApp(`/play/${GATED_EB}`, api);
    await screen.findByRole('textbox', { name: 'Answer 1' });
    for (let i = 1; i <= 3; i++) await user.type(screen.getByRole('textbox', { name: `Answer ${i}` }), `d${i}`);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    await user.click(screen.getByRole('button', { name: /Store answers/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pass the linked project unit solo first');
    expect(screen.getByRole('alert')).toHaveTextContent('(ARTIFACT_REQUIRED)');
    expect(screen.getByRole('textbox', { name: 'Answer 1' })).toHaveValue('d1');
  });
});

describe('answered, but the key will not load: Retry, never an empty answer form', () => {
  it('explain-back: a failed key fetch on an answered unit shows Retry and no form; Retry opens the key', async () => {
    const base = createMockApi();
    await base.answerExplainBack(EB, { answers: ['a', 'b', 'c'], selfAssisted: false });
    let fail = true;
    const api: BootQuestApi = {
      ...base,
      getExplainBackKey: (id) => (fail ? Promise.reject(new ApiError(0, 'NETWORK', 'offline')) : base.getExplainBackKey(id)),
    };
    const { user } = renderApp(`/play/${EB}`, api);
    const box = await screen.findByTestId('key-unavailable');
    expect(box).toHaveTextContent('Your answers are recorded, but the key could not be loaded');
    expect(box).toHaveTextContent('(NETWORK)');
    expect(screen.queryByRole('textbox', { name: 'Answer 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit answers/ })).not.toBeInTheDocument();
    fail = false;
    await user.click(within(box).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(KEY_POINT_TEXT)).toBeInTheDocument();
    expect(screen.queryByTestId('key-unavailable')).not.toBeInTheDocument();
  });

  it('kata: findings stored but the key request fails -> Retry state (not the form, not an error under a full form)', async () => {
    const base = createMockApi();
    let fail = true;
    const api: BootQuestApi = { ...base, getKataKey: (id) => (fail ? Promise.reject(new ApiError(500, 'INTERNAL', 'boom')) : base.getKataKey(id)) };
    const { user } = renderApp(`/play/${KATA}`, api);
    await user.type(await screen.findByRole('textbox', { name: 'Finding 1 scenario' }), 's');
    await user.type(screen.getByRole('textbox', { name: 'Finding 1 evidence' }), 'e:1');
    await user.type(screen.getByRole('textbox', { name: 'Finding 1 consequence' }), 'c');
    await user.click(screen.getByRole('button', { name: /Submit findings/ }));
    const box = await screen.findByTestId('key-unavailable');
    expect(box).toHaveTextContent('Your findings are recorded');
    expect(screen.queryByRole('textbox', { name: 'Finding 1 scenario' })).not.toBeInTheDocument();
    fail = false;
    await user.click(within(box).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('kata-key')).toHaveTextContent('Your findings (stored');
    expect(screen.getByTestId('kata-key')).not.toHaveTextContent(/#\d/);
  });

  it('a NOT_ANSWERED probe (older server, no `answered` flag) still means "answer now"', async () => {
    const base = createMockApi();
    const api: BootQuestApi = {
      ...base,
      getUnit: async (id) => {
        const d = await base.getUnit(id);
        if (!d.explainBack) return d;
        const { answered: _a, ...old } = d.explainBack;
        return { ...d, explainBack: old };
      },
    };
    renderApp(`/play/${EB}`, api);
    expect(await screen.findByRole('textbox', { name: 'Answer 1' })).toBeEnabled();
    expect(screen.queryByTestId('key-unavailable')).not.toBeInTheDocument();
  });
});

describe('re-seeded items: the old answer is superseded and the form reappears', () => {
  it('a re-seed after the answer: the unit opens on a fresh form; the new version takes one fresh answer', async () => {
    const api = createMockApi();
    const first = await api.answerExplainBack(EB, { answers: ['old 1', 'old 2', 'old 3'], selfAssisted: false });
    api.reseedItem(EB);
    const { user } = renderApp(`/play/${EB}`, api);
    expect(await screen.findByRole('textbox', { name: 'Answer 1' })).toHaveValue('');
    // fix/client-review 7f: the detail's structured supersededAnswerIds explain the fresh form (no key probe needed)
    const note = screen.getByTestId('superseded-note');
    expect(note).toHaveTextContent(`re-seeded since your earlier answer #${first.attemptId}, so that answer is superseded`);
    await answerEbTyped(user);
    const key = await api.getExplainBackKey(EB);
    expect(key.attemptId).not.toBe(first.attemptId);
    expect(screen.getByTestId('stored-answer-1')).toHaveTextContent('a1');
  });

  it('re-seeded while the key view is open: the self-score\'s NOT_ANSWERED reopens the form with the superseded note', async () => {
    const api = createMockApi();
    const { user } = renderApp(`/play/${EB}`, api);
    await answerEb(user);
    const old = await api.getExplainBackKey(EB);
    api.reseedItem(EB);
    for (const id of ['q1k1', 'q1k2', 'q2k1', 'q2k2', 'q3k1']) await user.click(screen.getByRole('radio', { name: `${id} covered` }));
    await user.click(screen.getByRole('button', { name: /Submit self-score/ }));
    await user.click(screen.getByRole('button', { name: 'File self-score' }));
    const note = await screen.findByTestId('superseded-note');
    expect(note).toHaveTextContent(`#${old.attemptId}`);
    expect(note).toHaveTextContent('superseded');
    expect(screen.getByRole('textbox', { name: 'Answer 1' })).toBeEnabled();
  });

  it('a kata re-seed: the detail names the superseded findings over the fresh table', async () => {
    const api = createMockApi();
    const first = await api.submitKataFindings(KATA, { findings: [{ scenario: 's', evidence: 'e', consequence: 'c' }], selfAssisted: false });
    api.reseedItem(KATA);
    renderApp(`/play/${KATA}`, api);
    expect(await screen.findByRole('textbox', { name: 'Finding 1 scenario' })).toHaveValue('');
    expect(screen.getByTestId('superseded-note')).toHaveTextContent(`#${first.attemptId}`);
  });

  it('no superseded answer: no note, and no note for an empty structured list either', async () => {
    renderApp(`/play/${EB}`);
    await screen.findByRole('textbox', { name: 'Answer 1' });
    expect(screen.queryByTestId('superseded-note')).not.toBeInTheDocument();
  });

  it('an older server (no supersededAnswerIds): the NOT_ANSWERED message of the key probe is the fallback', async () => {
    const base = createMockApi();
    await base.answerExplainBack(EB, { answers: ['old 1', 'old 2', 'old 3'], selfAssisted: false });
    base.reseedItem(EB);
    const api: BootQuestApi = {
      ...base,
      getUnit: async (id) => {
        const d = await base.getUnit(id);
        const eb = d.explainBack;
        if (!eb) return d;
        // the pre-field wire shape: no structured ids, no `answered` flag (so the client probes the key)
        return { ...d, explainBack: { questions: eb.questions, minCoveragePct: eb.minCoveragePct, artifactRequired: eb.artifactRequired } };
      },
    };
    renderApp(`/play/${EB}`, api);
    const note = await screen.findByTestId('superseded-note');
    expect(note).toHaveTextContent('superseded');
    expect(note).toHaveTextContent(/answered an earlier version/); // the server's own text, shown as-is
  });
});

describe('explain-back result', () => {
  it('a promotion names the competency by its label, never the raw id', async () => {
    const base = createMockApi();
    const api: BootQuestApi = {
      ...base,
      selfScoreExplainBack: async (id, body) => ({ ...(await base.selfScoreExplainBack(id, body)), promotions: [{ competency: 'language-fluency', from: 2, to: 3, evidenceId: 77 }] }),
    };
    const { user } = renderApp(`/play/${EB}`, api);
    await answerEb(user);
    for (const id of ['q1k1', 'q1k2', 'q2k1', 'q2k2', 'q3k1']) await user.click(screen.getByRole('radio', { name: `${id} covered` }));
    await user.click(screen.getByRole('button', { name: /Submit self-score/ }));
    await user.click(screen.getByRole('button', { name: 'File self-score' }));
    expect(await screen.findByText(/Promoted Language fluency: 2 → 3/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Promoted language-fluency');
  });
});

/** Fill and store EB 105 when the form is already on screen. */
async function answerEbTyped(user: ReturnType<typeof renderApp>['user']) {
  for (let i = 1; i <= 3; i++) await user.type(screen.getByRole('textbox', { name: `Answer ${i}` }), `a${i}`);
  await user.click(screen.getByRole('button', { name: /Submit answers/ }));
  await user.click(screen.getByRole('button', { name: /Store answers/ }));
  await screen.findByText(KEY_POINT_TEXT);
}

describe('mock parity: the mock enforces the server\'s ladder rules', () => {
  const codeOf = (p: Promise<unknown>) => p.then(() => 'resolved', (e: ApiError) => e.code);

  it('ARTIFACT_REQUIRED: refused (409) with artifactRequired listed until a SOLO verified pass; assisted or revealed passes do not count', async () => {
    const api = createMockApi();
    const body = { answers: ['a', 'b', 'c'], selfAssisted: false };
    expect((await api.getUnit(GATED_EB)).explainBack!.artifactRequired).toEqual([{ unitId: ARTIFACT, title: ARTIFACT_TITLE }]);
    await expect(api.answerExplainBack(GATED_EB, body)).rejects.toMatchObject({ status: 409, code: 'ARTIFACT_REQUIRED' });
    await expect(api.answerExplainBack(GATED_EB, body)).rejects.toThrow(/promotion leg \(b\) of unit 303/);
    // an assisted pass is not the solo artifact
    await api.submitUnit(ARTIFACT, { code: 'done', selfAssisted: true });
    expect(await codeOf(api.answerExplainBack(GATED_EB, body))).toBe('ARTIFACT_REQUIRED');
    await api.submitUnit(ARTIFACT, { code: 'done', selfAssisted: false });
    expect((await api.getUnit(GATED_EB)).explainBack!.artifactRequired).toEqual([]);
    await expect(api.answerExplainBack(GATED_EB, body)).resolves.toMatchObject({ outcome: 'submitted' });
    // ALREADY_ANSWERED is checked first, like the server
    expect(await codeOf(api.answerExplainBack(GATED_EB, body))).toBe('ALREADY_ANSWERED');

    // a project-less explain-back is never gated
    expect((await api.getUnit(EB)).explainBack!.artifactRequired).toEqual([]);
  });

  it('ARTIFACT_REQUIRED: a revealed artifact no longer gates (its leg (a) can never count)', async () => {
    const api = createMockApi();
    expect((await api.getUnit(GATED_EB)).explainBack!.artifactRequired).toHaveLength(1);
    await api.revealUnit(ARTIFACT);
    expect((await api.getUnit(GATED_EB)).explainBack!.artifactRequired).toEqual([]);
    // and a guided pass after the reveal is no solo pass either way
    await expect(api.submitUnit(ARTIFACT, { code: 'done', selfAssisted: false })).resolves.toMatchObject({ attempt: { mode: 'guided' } });
  });

  it('supersession: a re-seed makes `answered` false, NOT_ANSWERED names the old answer, one fresh answer is taken', async () => {
    const api = createMockApi();
    const body = { answers: ['a', 'b', 'c'], selfAssisted: false };
    const old = await api.answerExplainBack(EB, body);
    expect((await api.getUnit(EB)).explainBack!.answered).toBe(true);
    api.reseedItem(EB);
    expect((await api.getUnit(EB)).explainBack!.answered).toBe(false);
    await expect(api.getExplainBackKey(EB)).rejects.toMatchObject({ code: 'NOT_ANSWERED', message: expect.stringContaining(`#${old.attemptId}`) });
    await expect(api.getExplainBackKey(EB)).rejects.toThrow(/superseded/);
    await expect(api.selfScoreExplainBack(EB, { perKeyPoint: {} })).rejects.toMatchObject({ code: 'NOT_ANSWERED' });
    const fresh = await api.answerExplainBack(EB, { ...body, answers: ['x', 'y', 'z'] });
    expect((await api.getExplainBackKey(EB)).answers).toEqual(['x', 'y', 'z']);
    expect(fresh.attemptId).not.toBe(old.attemptId);
    expect(await codeOf(api.answerExplainBack(EB, body))).toBe('ALREADY_ANSWERED');

    // katas too
    await api.submitKataFindings(KATA, { findings: [{ scenario: 's', evidence: 'e', consequence: 'c' }], selfAssisted: false });
    api.reseedItem(KATA);
    expect((await api.getUnit(KATA)).kata!.answered).toBe(false);
    await expect(api.getKataKey(KATA)).rejects.toThrow(/superseded/);
    await expect(api.submitKataFindings(KATA, { findings: [{ scenario: 's2', evidence: 'e2', consequence: 'c2' }], selfAssisted: false })).resolves.toMatchObject({
      outcome: 'submitted',
    });
    expect((await api.getKataKey(KATA)).findings[0]!.scenario).toBe('s2');
  });
});

describe('explain-back retakes: practice attempts + alternate sets', () => {
  const ALT_A = ALT_SET_A_ID;
  const ALT_B = ALT_SET_B_ID;
  const codeOf = (p: Promise<unknown>) => p.then(() => 'resolved', (e: ApiError) => e.code);
  const allCovered = { q1k1: 'covered', q1k2: 'covered', q2k1: 'covered', q2k2: 'covered', q3k1: 'covered' } as const;

  it('no practice before the answer of record is self-scored; afterwards "Practice again" records an assisted 0-XP attempt scored with its own checklist', async () => {
    const api = createMockApi();
    const { user } = renderApp(`/play/${EB}`, api);
    await answerEb(user);
    expect(screen.queryByTestId('practice')).not.toBeInTheDocument();
    for (const id of ['q1k1', 'q1k2', 'q2k1', 'q2k2', 'q3k1']) await user.click(screen.getByRole('radio', { name: `${id} covered` }));
    await user.click(screen.getByRole('button', { name: /Submit self-score/ }));
    await user.click(screen.getByRole('button', { name: 'File self-score' }));
    expect(await screen.findByTestId('coverage-result')).toHaveTextContent('+20 XP');

    expect(await screen.findByTestId('practice-copy')).toHaveTextContent('0 XP, recorded as an assisted practice attempt — never counts toward promotion');
    await user.click(screen.getByRole('button', { name: /Practice again/ }));
    // fresh, empty textareas (no stored draft: practice is repeatable)
    for (let i = 1; i <= 3; i++) expect(screen.getByRole('textbox', { name: `Practice answer ${i}` })).toHaveValue('');
    const store = screen.getByRole('button', { name: /Store practice answers/ });
    expect(store).toBeDisabled();
    for (let i = 1; i <= 3; i++) await user.type(screen.getByRole('textbox', { name: `Practice answer ${i}` }), `retry ${i}`);
    await user.click(store);

    const scorer = await screen.findByTestId(/^practice-scorer-\d+$/);
    const pid = Number(scorer.getAttribute('data-testid')!.split('-').pop());
    expect((await api.getUnit(EB)).explainBack!.practice).toEqual({ available: true, count: 1, latestUnscoredAttemptId: pid });
    expect(within(scorer).getByTestId('practice-answer-1')).toHaveTextContent('retry 1');
    // one unscored practice at a time
    expect(screen.getByRole('button', { name: /Practice again/ })).toBeDisabled();
    expect((await api.getAttempt(pid)).mode).toBe('assisted');

    for (const id of ['q1k1', 'q1k2', 'q2k1']) await user.click(within(scorer).getByRole('radio', { name: `practice ${id} covered` }));
    for (const id of ['q2k2', 'q3k1']) await user.click(within(scorer).getByRole('radio', { name: `practice ${id} missed` }));
    await user.click(within(scorer).getByRole('button', { name: /File practice score/ }));
    const result = await screen.findByTestId('practice-result');
    expect(result).toHaveTextContent('Practice coverage 60% (3/5)');
    expect(result).toHaveTextContent('feedback only: 0 XP, no retest, never a promotion leg');
    expect(result).not.toHaveTextContent('+20 XP');
    await waitFor(() => expect(screen.getByTestId(`practice-${pid}`)).toHaveTextContent('self-scored 60% coverage (practice: 0 XP)'));
    expect(screen.getByRole('button', { name: /Practice again/ })).toBeEnabled();
    // the answer of record is untouched; the practice evidence is assistance 'practice'
    expect(screen.getByTestId('coverage-result')).toHaveTextContent('Coverage 100% (5/5)');
    expect((await api.listEvidence({ kind: 'explain-back' })).items[0]).toMatchObject({ attemptId: pid, assistance: 'practice', score: 0.6 });
    expect((await api.getUnit(EB)).explainBack!.practice).toEqual({ available: true, count: 1, latestUnscoredAttemptId: null });
  });

  it('the key view and practice list show per-unit ordinals and stored times, never global attempt ids', async () => {
    const api = createMockApi();
    const { user } = renderApp(`/play/${EB}`, api);
    await answerEb(user);
    const header = screen.getByText(/Your answer was stored/);
    expect(header).toHaveTextContent('(immutable). Mark each key point your answer covered.');
    expect(header).not.toHaveTextContent(/#\d/);
    for (const id of Object.keys(allCovered)) await user.click(screen.getByRole('radio', { name: `${id} covered` }));
    await user.click(screen.getByRole('button', { name: /Submit self-score/ }));
    await user.click(screen.getByRole('button', { name: 'File self-score' }));
    await screen.findByTestId('practice-copy');

    const storePractice = async (tag: string) => {
      await user.click(screen.getByRole('button', { name: /Practice again/ }));
      for (let i = 1; i <= 3; i++) await user.type(screen.getByRole('textbox', { name: `Practice answer ${i}` }), `${tag} ${i}`);
      await user.click(screen.getByRole('button', { name: /Store practice answers/ }));
      return screen.findByTestId(/^practice-scorer-\d+$/);
    };
    // round 1: store + score
    const s1 = await storePractice('one');
    for (const id of Object.keys(allCovered)) await user.click(within(s1).getByRole('radio', { name: `practice ${id} covered` }));
    await user.click(within(s1).getByRole('button', { name: /File practice score/ }));
    await screen.findByTestId('practice-result');
    await waitFor(() => expect(screen.getByRole('button', { name: /Practice again/ })).toBeEnabled());
    // round 2: stored, left unscored -> the gate hint
    await storePractice('two');

    const history = screen.getByRole('list', { name: 'Practice attempts' });
    const items = within(history).getAllByRole('listitem').filter((li) => li.classList.contains('practice-attempt'));
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/^Practice attempt 1 · stored .+ — self-scored 100% coverage \(practice: 0 XP\)\./);
    expect(items[1]).toHaveTextContent(/^Practice attempt 2 · stored .+ — not scored yet\./);
    // the id-keyed test hooks stay (data-testid / scorer), only the copy changed
    expect(items[0].getAttribute('data-testid')).toMatch(/^practice-\d+$/);
    expect(history).not.toHaveTextContent(/#\d/);
    const again = screen.getByRole('button', { name: /Practice again/ });
    expect(again).toBeDisabled();
    expect(again).toHaveAttribute('title', 'Score your latest practice attempt first.');
    expect(screen.getByText('Score your latest practice attempt first.')).toBeInTheDocument();
    expect(screen.getByTestId('practice')).not.toHaveTextContent(/#\d/);
  });

  it('mock refusals word per-unit practice ordinals like the server, never global attempt ids', async () => {
    const api = createMockApi();
    const body = { answers: ['a', 'b', 'c'] };
    const messageOf = (p: Promise<unknown>) => p.then(() => 'resolved', (e: ApiError) => e.message);
    const rec = await api.answerExplainBack(EB, { ...body, selfAssisted: false });
    const notVerified = await messageOf(api.practiceExplainBack(EB, body));
    expect(notVerified).toBe(`unit ${EB}: self-score your answer of record first — practice opens after the first scored answer`);
    const again = await messageOf(api.answerExplainBack(EB, { ...body, selfAssisted: false }));
    expect(again).toBe(`unit ${EB}: your explain-back answer is recorded and immutable; open the key instead`);
    await api.selfScoreExplainBack(EB, { perKeyPoint: { ...allCovered } });

    const p1 = await api.practiceExplainBack(EB, body);
    expect(await messageOf(api.practiceExplainBack(EB, body))).toBe(`unit ${EB}: practice attempt 1 is recorded and unscored; score it first`);
    await api.practiceScoreExplainBack(EB, { attemptId: p1.attemptId, perKeyPoint: { ...allCovered } });
    const p2 = await api.practiceExplainBack(EB, body);
    expect(await messageOf(api.practiceExplainBack(EB, body))).toBe(`unit ${EB}: practice attempt 2 is recorded and unscored; score it first`);
    await api.practiceScoreExplainBack(EB, { attemptId: p2.attemptId, perKeyPoint: { ...allCovered } });
    // re-scoring the FIRST practice names ordinal 1 (index-based, not "the latest")
    const rescore = await messageOf(api.practiceScoreExplainBack(EB, { attemptId: p1.attemptId, perKeyPoint: { ...allCovered } }));
    expect(rescore).toBe('practice attempt 1 is already self-scored (evidence is append-only)');

    const kataFirst = await api.submitKataFindings(KATA, { findings: [{ scenario: 's', evidence: 'e:1', consequence: 'c' }], selfAssisted: false });
    const kataAgain = await messageOf(api.submitKataFindings(KATA, { findings: [{ scenario: 's', evidence: 'e:1', consequence: 'c' }], selfAssisted: false }));
    expect(kataAgain).toBe(`unit ${KATA}: your findings are recorded and immutable; open the key instead`);
    for (const m of [notVerified, again, rescore, kataAgain]) {
      for (const gid of [rec.attemptId, p1.attemptId, p2.attemptId, kataFirst.attemptId]) expect(m).not.toContain(`#${gid}`);
    }
  });

  it('alternate sets: the sibling strip links the sets; once set A is answered, set B shows the rotation banner and a read-only form', async () => {
    const api = createMockApi();
    const first = renderApp(`/play/${ALT_A}`, api);
    const strip = await screen.findByTestId('alt-sets');
    expect(within(strip).getByTestId('alt-set-A')).toHaveTextContent('Set A · new (this set)');
    expect(within(strip).getByRole('link', { name: 'Set B · new' })).toHaveAttribute('href', `/play/${ALT_B}`);
    expect(screen.queryByTestId('set-gate-lock')).not.toBeInTheDocument();
    first.unmount();

    await api.answerExplainBack(ALT_A, { answers: ['a', 'b', 'c'], selfAssisted: false });
    renderApp(`/play/${ALT_B}`, api);
    const banner = await screen.findByTestId('set-gate-lock');
    expect(banner).toHaveTextContent('Alternate set B opens');
    expect(banner).toHaveTextContent('spaced repetition: fresh sets are at least 2 days apart');
    expect(screen.getByRole('textbox', { name: 'Answer 1' })).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: /Submit answers/ })).toBeDisabled();
    expect(within(screen.getByTestId('alt-sets')).getByRole('link', { name: 'Set A · answered' })).toHaveAttribute('href', `/play/${ALT_A}`);
  });

  it('a raced 409 NOT_DUE on submit (a sibling answered since the page loaded) shows the rotation banner, not an error', async () => {
    const api = createMockApi();
    const { user } = renderApp(`/play/${ALT_B}`, api);
    await screen.findByRole('textbox', { name: 'Answer 1' });
    expect(screen.queryByTestId('set-gate-lock')).not.toBeInTheDocument();
    await api.answerExplainBack(ALT_A, { answers: ['a', 'b', 'c'], selfAssisted: false }); // another tab
    for (let i = 1; i <= 3; i++) await user.type(screen.getByRole('textbox', { name: `Answer ${i}` }), `b${i}`);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    await user.click(screen.getByRole('button', { name: /Store answers/ }));
    expect(await screen.findByTestId('set-gate-lock')).toHaveTextContent('Alternate set B opens');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect((await api.getUnit(ALT_B)).explainBack!.answered).toBe(false);
  });

  it('mock parity: the practice and rotation refusals use the server codes, in its order', async () => {
    const api = createMockApi();
    const body = { answers: ['a', 'b', 'c'] };
    expect(await codeOf(api.practiceExplainBack(EB, body))).toBe('NOT_ANSWERED');
    const rec = await api.answerExplainBack(EB, { ...body, selfAssisted: false });
    expect(await codeOf(api.practiceExplainBack(EB, body))).toBe('NOT_VERIFIED');
    expect(await codeOf(api.practiceExplainBack(EB, { ...body, selfAssisted: false } as never))).toBe('VALIDATION');
    await api.selfScoreExplainBack(EB, { perKeyPoint: { ...allCovered } });
    const p = await api.practiceExplainBack(EB, body);
    expect(p).toMatchObject({ mode: 'assisted', outcome: 'submitted' });
    expect(await codeOf(api.practiceExplainBack(EB, body))).toBe('ALREADY_ANSWERED');
    expect(await codeOf(api.practiceScoreExplainBack(EB, { attemptId: rec.attemptId, perKeyPoint: { ...allCovered } }))).toBe('NOT_VERIFIED');
    expect(await codeOf(api.practiceScoreExplainBack(EB, { attemptId: 999_999, perKeyPoint: { ...allCovered } }))).toBe('NOT_FOUND');
    expect(await codeOf(api.practiceScoreExplainBack(EB, { attemptId: p.attemptId, perKeyPoint: { q1k1: 'covered' } }))).toBe('VALIDATION');
    await expect(api.practiceScoreExplainBack(EB, { attemptId: p.attemptId, perKeyPoint: { ...allCovered } })).resolves.toMatchObject({ passed: true, xp: null, retests: [], promotions: [] });
    expect(await codeOf(api.practiceScoreExplainBack(EB, { attemptId: p.attemptId, perKeyPoint: { ...allCovered } }))).toBe('ALREADY_SCORED');
    const key = await api.getExplainBackKey(EB);
    expect(key.attemptId).toBe(rec.attemptId);
    expect(key.practice).toEqual([{ attemptId: p.attemptId, answeredAt: expect.any(Number), answers: ['a', 'b', 'c'], scored: expect.objectContaining({ score: 1 }) }]);
    // the one-shot answer of record is unchanged
    expect(await codeOf(api.answerExplainBack(EB, { ...body, selfAssisted: false }))).toBe('ALREADY_ANSWERED');

    // rotation: the first answer in a group is never gated; the sibling then is (409 NOT_DUE), practice never moves it
    expect((await api.getUnit(ALT_B)).explainBack!.altSets!.gate).toEqual({ open: true, opensAt: null });
    await api.answerExplainBack(ALT_A, { ...body, selfAssisted: false });
    const gate = (await api.getUnit(ALT_B)).explainBack!.altSets!.gate;
    expect(gate.open).toBe(false);
    expect(gate.opensAt! - (await api.getExplainBackKey(ALT_A)).answeredAt).toBe(2 * 86_400_000);
    await expect(api.answerExplainBack(ALT_B, { ...body, selfAssisted: false })).rejects.toMatchObject({
      status: 409,
      code: 'NOT_DUE',
      message: expect.stringContaining('alternate set B of this question set opens at'),
    });
  });
});
