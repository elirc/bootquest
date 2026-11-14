import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fundLessonAidFixtures, fundStudyFixtures } from '../api/fixtures/fundamentals';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, NoteDto } from '../api/types';
import { renderApp } from '../test/render';
import { PRETEST_KEY_PREFIX, pretestChecks } from './StudyQuestPane';

// rv2 S3 F4: the pretest before a Fundamentals lesson (answer-first, unscored, skippable, never a gate item) and the
// one merged "explanation + learn more" panel after a graded (passed) gate.

const T1 = 207; // mock topic 01 (available), 2 check cards, 5 gate questions
const FX1 = fundStudyFixtures[String(T1)]!;
const CHECKS = fundLessonAidFixtures[String(T1)]!.checks;
type User = ReturnType<typeof renderApp>['user'];

beforeEach(() => window.localStorage.clear());

/** Records every API method called (reads and writes). */
function spyApi(over: Partial<BootQuestApi> = {}): { api: BootQuestApi; calls: string[] } {
  const base = { ...createMockApi(), ...over };
  const calls: string[] = [];
  const api = Object.fromEntries(
    Object.entries(base).map(([k, fn]) => [k, (...a: unknown[]) => (calls.push(k), (fn as (...x: unknown[]) => unknown)(...a))]),
  ) as unknown as BootQuestApi;
  return { api, calls };
}

async function answerAll(user: User, picks: readonly number[]) {
  for (const [qi, ci] of picks.entries()) {
    await user.click(screen.getByRole('radio', { name: `Q${qi + 1} choice ${ci + 1}` }));
    await user.click(screen.getByRole('button', { name: qi === picks.length - 1 ? /Review answers/ : /^Next/ }));
  }
}

describe('F4 pretest: "what do you already know?" before the lesson', () => {
  it('offered above the lesson; taken, it stands in for the lesson: guess first, then the answer; nothing is sent; done is remembered', async () => {
    const { api, calls } = spyApi();
    const { user, unmount } = renderApp(`/play/${T1}`, api);
    const offer = await screen.findByTestId('pretest-offer', {}, { timeout: 15_000 });
    expect(offer).toHaveTextContent('2 questions from this lesson before you read it. Not graded');
    expect(document.getElementById('ins-title')).not.toBeNull(); // the lesson is still there under the offer
    expect(screen.queryByTestId('pretest-card')).toBeNull(); // no card text before it is taken

    await user.click(within(offer).getByRole('button', { name: 'Take the pretest' }));
    const pretest = screen.getByTestId('pretest');
    expect(screen.queryByTestId('pretest-offer')).toBeNull();
    expect(document.getElementById('ins-title')).toBeNull(); // the lesson waits
    const cards = within(pretest).getAllByTestId('pretest-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent(CHECKS[0]!.prompt.replace(/`/g, ''));
    // answer-first: no answer on screen, "Show the answer" needs a guess
    expect(pretest).not.toHaveTextContent('one of the seven primitive types');
    const show = within(cards[0]!).getByRole('button', { name: 'Show the answer' });
    expect(show).toBeDisabled();
    await user.type(within(cards[0]!).getByRole('textbox', { name: 'Your guess 1 (not sent)' }), 'a bigint');
    await user.click(show);
    expect(within(cards[0]!).getByTestId('pretest-answer')).toHaveTextContent('one of the seven primitive types');
    expect(within(pretest).getByTestId('pretest-skip')).toBeInTheDocument();
    await user.click(within(cards[1]!).getByRole('button', { name: /I don.t know yet/ }));
    expect(within(cards[1]!).getByTestId('pretest-answer')).toBeInTheDocument();
    // the gate is never previewed: none of its five questions is on screen
    for (const q of FX1.public.questions) expect(pretest).not.toHaveTextContent(q.prompt.replace(/`/g, ''));

    await user.click(within(pretest).getByTestId('pretest-done'));
    expect(screen.queryByTestId('pretest')).toBeNull();
    expect(document.getElementById('ins-title')).not.toBeNull();
    // unscored: nothing but reads went to the server
    const writes = calls.filter((c) => !/^get|^list/.test(c));
    expect(writes).toEqual([]);
    expect(window.localStorage.getItem(`${PRETEST_KEY_PREFIX}${T1}`)).toBe('1');
    unmount();
    renderApp(`/play/${T1}`, api);
    await screen.findByRole('button', { name: /Start quiz/ }, { timeout: 15_000 });
    expect(screen.queryByTestId('pretest-offer')).toBeNull();
  });

  it('skippable twice over: "Not now" on the offer, "Skip to the lesson" inside it', async () => {
    const first = renderApp(`/play/${T1}`);
    await first.user.click(await screen.findByTestId('pretest-decline', {}, { timeout: 15_000 }));
    expect(screen.queryByTestId('pretest-offer')).toBeNull();
    expect(document.getElementById('ins-title')).not.toBeNull();
    first.unmount();
    window.localStorage.clear();
    const second = renderApp(`/play/${T1}`);
    await second.user.click(await screen.findByTestId('pretest-take', {}, { timeout: 15_000 }));
    await second.user.click(screen.getByTestId('pretest-skip'));
    expect(screen.queryByTestId('pretest')).toBeNull();
    expect(document.getElementById('ins-title')).not.toBeNull();
  });

  it('never a gate item: a check that repeats a gate question is dropped; no cards = no offer; a passed topic has none', async () => {
    const gate = FX1.public.questions.map((q) => q.prompt);
    expect(pretestChecks([{ heading: 'x', prompt: `  ${gate[0]!.toUpperCase()} `, answer: 'a' }, CHECKS[0]!], gate)).toEqual([CHECKS[0]]);
    const base = createMockApi();
    const leaky: BootQuestApi = { ...base, getLessonAids: async () => ({ gate: {}, checks: [{ heading: 'x', prompt: gate[1]!, answer: 'the key' }] }) };
    renderApp(`/play/${T1}`, leaky);
    await screen.findByRole('button', { name: /Start quiz/ }, { timeout: 15_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('pretest-offer')).toBeNull();
  });

  it('not while the gate is open: starting the quiz removes the offer', async () => {
    const { user } = renderApp(`/play/${T1}`);
    await screen.findByTestId('pretest-offer', {}, { timeout: 15_000 });
    await user.click(screen.getByRole('button', { name: /Start quiz/ }));
    expect(screen.queryByTestId('pretest-offer')).toBeNull();
    expect(screen.queryByTestId('pretest')).toBeNull();
  });
});

describe('F4: one merged explanation + learn-more panel after a graded item', () => {
  it('a pass shows ONE panel per question: keyed answer, explanation, its readings and the drawer button; none in the question', async () => {
    const base = createMockApi();
    const q1 = FX1.public.questions[0]!.itemKey;
    const reading: NoteDto = { key: 'n-r1', id: 'r1', phase: 'before', target: q1, targetKind: 'quiz', title: 'Why typeof null is object', body: 'A historical tag bug.', excerpts: [], readMore: [] };
    const api: BootQuestApi = { ...base, getUnitNotes: async (id) => { const n = await base.getUnitNotes(id); return { ...n, readings: [...n.readings, reading] }; } };
    window.localStorage.setItem(`${PRETEST_KEY_PREFIX}${T1}`, '1');
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }, { timeout: 15_000 }));
    await answerAll(user, FX1.keys);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll('[data-testid^="explain-"][data-merged="true"]').length).toBe(5));
    for (let n = 1; n <= 5; n++) {
      const panel = screen.getByTestId(`explain-${n}`);
      const fieldset = screen.getByTestId(`question-${n}`);
      // the drawer button lives in the panel (outside the disabled fieldset), never in the question
      expect(within(panel).getByTestId(`learn-more-q${n}`)).toBeInTheDocument();
      expect(within(panel).getByRole('button', { name: `All notes: Q${n}` })).toBeEnabled();
      expect(fieldset.querySelector('[data-testid^="learn-more-q"]')).toBeNull();
      expect(panel).toHaveTextContent('Answer:');
    }
    // the readings about Q1 sit in Q1's panel (folded), and nowhere else
    const q1Num = [...document.querySelectorAll<HTMLElement>('fieldset[data-testid^="question-"]')].findIndex((f) => f.textContent?.includes(FX1.public.questions[0]!.prompt.replace(/`/g, '').slice(0, 12))) + 1;
    expect(q1Num).toBeGreaterThan(0);
    expect(screen.getByTestId(`explain-${q1Num}-readings`)).toHaveTextContent('Why typeof null is object');
    expect(document.querySelectorAll('[data-testid$="-readings"]')).toHaveLength(1);
    await user.click(within(screen.getByTestId(`explain-${q1Num}`)).getByRole('button', { name: `All notes: Q${q1Num}` }));
    expect(await screen.findByRole('dialog', { name: /Learn more/ })).toBeInTheDocument();
  });
});
