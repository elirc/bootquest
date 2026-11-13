// f52 wave B (app ruling 2): the Fundamentals gate's fail path in the player — the per-try shuffle
// (display only: the submit posts served indices), the "Re-read" line, and the cooldown from the
// second consecutive fail. Mock topic 207: 5 questions, keys [1, 1, 0, 1, 0].
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mock';
import { fundStudyFixtures } from '../api/fixtures/fundamentals';
import type { BootQuestApi, Submission } from '../api/types';
import { gateShuffle } from '../lib/gate';
import { renderApp } from '../test/render';

const T1 = 207;
const FX = fundStudyFixtures[String(T1)]!;
const QUESTIONS = FX.public.questions;
const plain = (s: string) => s.replace(/`/g, '');

type User = ReturnType<typeof renderApp>['user'];

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function recorded() {
  const base = createMockApi();
  const sent: Submission[] = [];
  const api: BootQuestApi = {
    ...base,
    submitUnit: async (id, s) => {
      sent.push(s);
      return base.submitUnit(id, s);
    },
  };
  return { api, sent };
}

/** the served question index of the question on screen at display position d (1-based testid) */
function servedOnScreen(n: number): { qi: number; choiceTexts: string[]; box: HTMLElement } {
  const box = screen.getByTestId(`question-${n}`);
  const legend = box.querySelector('legend')!.textContent ?? '';
  const qi = QUESTIONS.findIndex((q) => legend.includes(plain(q.prompt)));
  expect(qi, `question on screen: ${legend}`).toBeGreaterThanOrEqual(0);
  return { qi, box, choiceTexts: [...box.querySelectorAll('.choice-text')].map((c) => c.textContent ?? '') };
}

/**
 * Take the whole gate the way a learner does: read each question, find the wanted answer BY TEXT
 * and pick it (click, or its on-screen digit). `want(qi)` is the served choice index to pick.
 * Returns the served question order that was on screen.
 */
async function takeGate(user: User, want: (qi: number) => number, how: 'click' | 'keys' = 'click'): Promise<number[]> {
  const seen: number[] = [];
  for (let d = 1; d <= QUESTIONS.length; d++) {
    const { qi, choiceTexts, box } = servedOnScreen(d);
    seen.push(qi);
    const at = choiceTexts.indexOf(QUESTIONS[qi]!.choices[want(qi)]!);
    expect(at).toBeGreaterThanOrEqual(0);
    if (how === 'keys') await user.keyboard(`${at + 1}{Enter}`);
    else {
      await user.click(within(box).getByRole('radio', { name: `Q${d} choice ${at + 1}` }));
      await user.click(screen.getByRole('button', { name: d === QUESTIONS.length ? /Review answers/ : /^Next/ }));
    }
  }
  expect(screen.getByTestId('gate-review')).toBeInTheDocument();
  return seen;
}

const wrong = (qi: number) => (FX.keys[qi]! + 1) % 3;
const keyed = (qi: number) => FX.keys[qi]!;

afterEach(() => {
  vi.useRealTimers();
});

describe('the gate shuffle (display only)', () => {
  it('questions and choices are shuffled, and a learner picking the keyed TEXT posts exactly the served keys', async () => {
    gateShuffle.random = seeded(11);
    const { api, sent } = recorded();
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    const seen = await takeGate(user, keyed);
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(seen).not.toEqual([0, 1, 2, 3, 4]); // this seed does move the questions
    // the review screen keeps the same numbers and the same choice order as the stepper
    expect(servedOnScreen(1).qi).toBe(seen[0]);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    // identical to what an unshuffled gate posts (fundamentals.test.tsx: the stepper test)
    expect(sent).toEqual([{ answers: FX.keys, selfAssisted: false }]);
    // after the pass every question is marked correct under the number it had on screen
    for (let n = 1; n <= 5; n++) expect(screen.getByTestId(`mark-${n}`)).toHaveTextContent('correct');
    expect(document.querySelectorAll('.choice-right')).toHaveLength(5);
    expect(document.querySelector('.choice-wrong')).toBeNull();
  }, 60_000);

  it('the on-screen digits pick the on-screen choice; mixed right and wrong picks post the same served answers', async () => {
    gateShuffle.random = seeded(23);
    const { api, sent } = recorded();
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    // Q2 and Q4 (served) wrong on purpose
    const intent = (qi: number) => (qi === 1 || qi === 3 ? wrong(qi) : keyed(qi));
    await takeGate(user, intent, 'keys');
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
    expect(sent).toEqual([{ answers: [0, 1, 2, 3, 4].map(intent), selfAssisted: false }]);
    expect(screen.getByTestId('study-result')).toHaveTextContent('3/5 correct');
    // the missed ones are served Q2 and Q4, whatever their place on screen
    expect(await screen.findByTestId('reread')).toHaveTextContent('Re-read: The seven primitives');
    expect(document.querySelector('.study-mark, .choice-right, .choice-wrong')).toBeNull();
  }, 60_000);

  it('every try gets a new order; the second try still posts served indices', async () => {
    gateShuffle.random = seeded(5);
    const { api, sent } = recorded();
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    const first = await takeGate(user, wrong, 'keys');
    const firstChoices = servedOnScreen(1).choiceTexts;
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
    // one fail: no cooldown yet
    expect(screen.queryByTestId('gate-cooldown')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const second = await takeGate(user, keyed, 'keys');
    const sameFirstQuestion = first[0] === second[0];
    expect(second.join() !== first.join() || (sameFirstQuestion && servedOnScreen(1).choiceTexts.join() !== firstChoices.join())).toBe(true);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(sent.map((s) => s.answers)).toEqual([[0, 1, 2, 3, 4].map(wrong), FX.keys]);
  }, 90_000);
});

describe('"Re-read" after a failed gate', () => {
  it('without a gate map the generic line stands in', async () => {
    const { api } = recorded();
    // rv B: the server names the sections (gate-status); without a gate map it names none
    const { user } = renderApp(`/play/${T1}`, {
      ...api,
      getGateStatus: async (id) => {
        const s = await api.getGateStatus(id);
        return s && s.lastTry ? { ...s, lastTry: { ...s.lastTry, reread: [] } } : s;
      },
    });
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    await takeGate(user, wrong, 'keys');
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
    expect(screen.queryByTestId('reread')).toBeNull();
    expect(screen.getByTestId('fail-advice')).toHaveTextContent('Re-read the lesson, then try again');
  }, 60_000);

  it('each heading is named once, in question order', async () => {
    const { api } = recorded();
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    await takeGate(user, wrong, 'keys'); // all five missed: two headings
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect((await screen.findByTestId('reread')).textContent).toBe('Re-read: typeof surprises · The seven primitives');
  }, 60_000);
});

describe('rv B: graded tries, practice, and the fail screen', () => {
  it('a failed graded try shows the score, the try number and what to re-read: no question list, no picks, no marks', async () => {
    const { user } = renderApp(`/play/${T1}`);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    await takeGate(user, wrong, 'keys');
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
    expect(await screen.findByTestId('study-try')).toHaveTextContent('try 1');
    expect(screen.getByTestId('study-try')).not.toHaveTextContent('#');
    expect(screen.queryAllByTestId(/^question-/)).toHaveLength(0);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  }, 60_000);

  it('the server budget: after two graded tries in a day "Try again" waits, with the time the next one opens', async () => {
    const { api } = recorded();
    await api.submitUnit(T1, { answers: [0, 0, 1, 0, 1], selfAssisted: false }); // a first fail, outside the UI
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    await takeGate(user, wrong, 'keys');
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('gate-retry')).toBeDisabled());
    expect(screen.getByTestId('gate-cooldown')).toHaveTextContent('Two graded tries per 24 hours: your next graded try opens');
    expect(await screen.findByTestId('study-try')).toHaveTextContent('try 2');
    // a third graded submit is refused by the server too, recording nothing
    await expect(api.submitUnit(T1, { answers: FX.keys, selfAssisted: false })).rejects.toMatchObject({ code: 'NOT_DUE' });
  }, 60_000);

  it('practice: every verdict, keyed answer and explanation at once; nothing recorded; the graded try then waits 2 days', async () => {
    const { api, sent } = recorded();
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByTestId('gate-practice'));
    expect(screen.getByTestId('practice-banner')).toHaveTextContent('nothing is recorded');
    // practice is open-book: the lesson stays on screen
    expect(screen.queryByTestId('lesson-hidden')).toBeNull();
    await takeGate(user, (qi) => (qi === 0 ? wrong(qi) : keyed(qi)), 'keys');
    await user.click(screen.getByRole('button', { name: /Check my practice answers/ }));
    const result = await screen.findByTestId('practice-result');
    expect(result).toHaveTextContent('Practice: 4/5 correct');
    expect(result).toHaveTextContent('nothing recorded · 0 XP');
    expect(within(screen.getByTestId('practice-item-1')).getByText('incorrect')).toBeInTheDocument();
    expect(screen.getByTestId('practice-item-1')).toHaveTextContent("Answer: 'object'");
    expect(screen.getByTestId('practice-item-1')).toHaveTextContent('a bug from the first JavaScript engine');
    expect(sent).toEqual([]); // no graded submit
    expect((await api.getGateStatus(T1))?.tries).toBe(0);
    await waitFor(() => expect(screen.getByTestId('gate-retry')).toBeDisabled());
    expect(screen.getByTestId('gate-cooldown')).toHaveTextContent('You practised this gate');
    // practice again is always open
    expect(screen.getByTestId('gate-practice')).toBeEnabled();
  }, 60_000);

  it('a pass leaves no "Try again"; a missed question carries a "Copy prompt for Claude" button (clipboard only)', async () => {
    // user-event's setup() installs a clipboard stub: read back what the button wrote
    const { user } = renderApp(`/play/${T1}`);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    await takeGate(user, (qi) => (qi === 1 ? wrong(qi) : keyed(qi)), 'keys'); // 4/5: a pass with one miss
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    const copy = await screen.findByRole('button', { name: 'Copy prompt for Claude' });
    await user.click(copy);
    expect(await screen.findByText(/Copied. Paste it into your own Claude session/)).toBeInTheDocument();
    const writes = [await navigator.clipboard.readText()];
    const q = QUESTIONS[1]!;
    expect(writes[0]).toContain(`Question: ${q.prompt}`);
    expect(writes[0]).toContain(`My answer: ${q.choices[wrong(1)]}`);
    expect(writes[0]).toContain(`Keyed answer: ${q.choices[keyed(1)]}`);
    expect(writes[0]).toContain('Lesson section:');
  }, 60_000);

  it('a campaign study quest has no marks after a fail either, and allows a second try', async () => {
    const { user } = renderApp('/play/206');
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    for (let q = 1; q <= 5; q++) await user.click(screen.getByRole('radio', { name: `Q${q} choice 3` }));
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
    expect(screen.queryByTestId('mark-1')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('radio', { name: 'Q1 choice 1' })).not.toBeChecked();
  }, 60_000);
});
