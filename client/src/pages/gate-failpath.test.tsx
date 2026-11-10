// f52 wave B (app ruling 2): the Fundamentals gate's fail path in the player — the per-try shuffle
// (display only: the submit posts served indices), the "Re-read" line, and the cooldown from the
// second consecutive fail. Mock topic 207: 5 questions, keys [1, 1, 0, 1, 0].
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mock';
import { fundStudyFixtures } from '../api/fixtures/fundamentals';
import type { BootQuestApi, Submission } from '../api/types';
import { GATE_COOLDOWN_MS, gateShuffle } from '../lib/gate';
import { renderApp } from '../test/render';

const T1 = 207;
const FX = fundStudyFixtures[String(T1)]!;
const QUESTIONS = FX.public.questions;
const plain = (s: string) => s.replace(/`/g, '');
const FAILS_KEY = `bq:gate-fails:v1:${T1}`;

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
    expect(screen.getByTestId('reread')).toHaveTextContent('Re-read: The seven primitives');
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
    const { user } = renderApp(`/play/${T1}`, { ...api, getLessonAids: async () => ({ gate: {}, checks: [] }) });
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

describe('the cooldown from the second consecutive fail', () => {
  it('the second fail in a row locks "Try again" for 3 minutes with a countdown; one earlier fail is on record', async () => {
    localStorage.setItem(FAILS_KEY, JSON.stringify({ fails: 1, until: 0 }));
    const { api } = recorded();
    const { user } = renderApp(`/play/${T1}`, api);
    // one fail on record is no cooldown
    const start = await screen.findByRole('button', { name: /Start quiz/ });
    expect(start).toBeEnabled();
    await user.click(start);
    await takeGate(user, wrong, 'keys');
    const before = Date.now();
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
    const retry = screen.getByTestId('gate-retry');
    expect(retry).toBeDisabled();
    expect(retry.textContent).toMatch(/^Try again in (3:00|2:5\d)$/);
    expect(screen.getByTestId('gate-cooldown')).toHaveTextContent(/The next try opens in (3:00|2:5\d)\./);
    const stored = JSON.parse(localStorage.getItem(FAILS_KEY)!) as { fails: number; until: number };
    expect(stored.fails).toBe(2);
    expect(stored.until).toBeGreaterThanOrEqual(before + GATE_COOLDOWN_MS);
    expect(stored.until).toBeLessThanOrEqual(Date.now() + GATE_COOLDOWN_MS);
    // a click on the locked button starts nothing
    fireEvent.click(retry);
    expect(screen.queryByTestId('gate-step')).toBeNull();
  }, 60_000);

  it('a pass clears the record', async () => {
    localStorage.setItem(FAILS_KEY, JSON.stringify({ fails: 1, until: 0 }));
    const { api } = recorded();
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    await takeGate(user, keyed, 'keys');
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(localStorage.getItem(FAILS_KEY)).toBeNull();
    expect(screen.queryByTestId('gate-cooldown')).toBeNull();
  }, 60_000);

  it('survives a reload: "Start quiz" counts down and opens when the 3 minutes are over (fake timers)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem(FAILS_KEY, JSON.stringify({ fails: 2, until: Date.now() + GATE_COOLDOWN_MS }));
    renderApp(`/play/${T1}`);
    const start = await screen.findByRole('button', { name: /Start quiz in/ });
    expect(start).toBeDisabled();
    expect(start.textContent).toMatch(/Start quiz in (3:00|2:5\d)/);
    expect(screen.getByTestId('gate-cooldown')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(start).toBeDisabled();
    expect(start.textContent).toMatch(/Start quiz in (1:00|0:5\d)/);

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByRole('button', { name: 'Start quiz' })).toBeEnabled();
    expect(screen.queryByTestId('gate-cooldown')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    expect(screen.getByTestId('gate-step')).toBeInTheDocument();
  }, 60_000);

  it('a blocked localStorage never breaks the gate', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const { api } = recorded();
      const { user } = renderApp(`/play/${T1}`, api);
      await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
      await takeGate(user, wrong, 'keys');
      await user.click(screen.getByRole('button', { name: /Submit answers/ }));
      expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  }, 60_000);

  it('a campaign study quest has no cooldown and keeps its per-question marks after a fail', async () => {
    const { user } = renderApp('/play/206');
    for (let round = 0; round < 2; round++) {
      await user.click(await screen.findByRole('button', { name: round === 0 ? /Start quiz/ : 'Try again' }));
      for (let q = 1; q <= 5; q++) await user.click(screen.getByRole('radio', { name: `Q${q} choice 3` }));
      await user.click(screen.getByRole('button', { name: /Submit answers/ }));
      expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
      expect(screen.getByTestId('mark-1')).toBeInTheDocument();
    }
    expect(screen.queryByTestId('gate-cooldown')).toBeNull();
    expect(screen.queryByTestId('reread')).toBeNull();
  }, 60_000);
});
