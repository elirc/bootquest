// fund wave: the Campaign page's Fundamentals ladder and a Fundamentals topic in the player
// (mock fixtures: api/fixtures/fundamentals.ts — JS topics 207 (available) and 208 (locked behind 207)).
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mock';
import { FUND_EXPANDED_KEY } from './Fundamentals';
import { fundStudyFixtures } from '../api/fixtures/fundamentals';
import type { BootQuestApi, Submission } from '../api/types';
import { renderApp } from '../test/render';

const T1 = 207;
const FX1 = fundStudyFixtures[String(T1)]!;

describe('Fundamentals section (Campaign page)', () => {
  it('compact card: progress, the current topic in full, a locked next topic on one line; Start points at the first open topic', async () => {
    renderApp('/campaign/js');
    const section = await screen.findByTestId('fundamentals');
    expect(within(section).getByRole('heading', { name: 'Fundamentals' })).toBeInTheDocument();
    expect(within(section).getByTestId('fund-progress')).toHaveTextContent('0 complete · 0 gates passed · 2 topics');
    expect(within(section).getByRole('progressbar', { name: 'Fundamentals topics complete' })).toBeInTheDocument();
    const topics = section.querySelectorAll<HTMLElement>('[data-topic]');
    expect([...topics].map((t) => t.dataset.topic)).toEqual(['01-values-types-and-coercion', '02-functions-and-closures']);
    expect(within(topics[0]!).getByRole('link', { name: /01\s*Values, types & coercion/ })).toHaveAttribute('href', `/play/${T1}`);
    expect(topics[0]).toHaveTextContent('Lesson + quiz gate · 5 questions · 3 flashcards');
    // f52 U10: a locked topic is one line (no summary / meta), never a link; the rule is its tooltip
    expect(within(topics[1]!).queryByRole('link')).toBeNull();
    expect(topics[1]).toHaveTextContent(/Locked/);
    expect(topics[1]).toHaveClass('fund-line');
    expect(topics[1]!.querySelector('.fund-summary, .fund-meta')).toBeNull();
    expect(topics[1]!.querySelector('[title]')).toHaveAttribute('title', "Unlocks when you pass the previous topic's quiz");
    expect(within(section).getByTestId('fund-continue')).toHaveAttribute('href', `/play/${T1}`);
    expect(within(section).getByTestId('fund-continue')).toHaveTextContent('Start: 01 Values, types & coercion');
  });

  it('a 20-topic ladder: the compact card shows the current topic and the next two; "Show all 20" is remembered', async () => {
    const base = createMockApi();
    const real = await base.getFundamentals('js');
    const t0 = real.topics[0]!;
    const topics = Array.from({ length: 20 }, (_, i) => ({
      ...t0,
      id: `${String(i + 1).padStart(2, '0')}-topic-${i + 1}`,
      order: i + 1,
      title: `Topic ${i + 1}`,
      unit: { ...t0.unit, id: 7000 + i, state: i < 3 ? ('done' as const) : i === 3 ? ('available' as const) : ('locked' as const) },
      drills: [],
    }));
    const api: BootQuestApi = { ...base, getFundamentals: async () => ({ trackId: 'js', topics }) };
    const first = renderApp('/campaign/js', api);
    let section = await screen.findByTestId('fundamentals');
    expect(within(section).getByTestId('fund-progress')).toHaveTextContent('3 complete · 3 gates passed · 20 topics');
    expect(within(section).getByTestId('fund-continue')).toHaveTextContent('Continue: 04 Topic 4');
    const shown = () => [...section.querySelectorAll<HTMLElement>('[data-topic]')].map((t) => t.dataset.topic);
    expect(shown()).toEqual(['04-topic-4', '05-topic-5', '06-topic-6']);
    expect(section.querySelectorAll('.fund-line')).toHaveLength(2); // the two locked ones are one line each
    const toggle = within(section).getByTestId('fund-toggle');
    expect(toggle).toHaveTextContent('Show all 20');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await first.user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Show less');
    expect(shown()).toHaveLength(20);
    expect(section.querySelectorAll('.fund-line')).toHaveLength(16); // locked topics 05-20
    expect(window.localStorage.getItem(FUND_EXPANDED_KEY)).toBe('1');
    first.unmount();

    // a second visit opens expanded; collapsing again is remembered too
    const second = renderApp('/campaign/js', api);
    section = await screen.findByTestId('fundamentals');
    expect(shown()).toHaveLength(20);
    await second.user.click(within(section).getByTestId('fund-toggle'));
    expect(shown()).toEqual(['04-topic-4', '05-topic-5', '06-topic-6']);
    expect(window.localStorage.getItem(FUND_EXPANDED_KEY)).toBe('0');
  });

  it('a blocked localStorage still renders the compact card and toggles in memory', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const { user } = renderApp('/campaign/js');
      const section = await screen.findByTestId('fundamentals');
      const toggle = within(section).getByTestId('fund-toggle');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('the campaign acts follow the compact card directly (the first act is not pushed below a 20-topic list)', async () => {
    renderApp('/campaign/js');
    const section = await screen.findByTestId('fundamentals');
    const acts = await screen.findByRole('list', { name: 'Campaign acts' });
    expect(section.compareDocumentPosition(acts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(section).getByTestId('fund-all')).not.toBeVisible();
  });

  it('renders nothing on a track without a ladder', async () => {
    renderApp('/campaign/csharp');
    await screen.findByRole('heading', { level: 1 });
    // let the fundamentals fetch settle
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('fundamentals')).not.toBeInTheDocument();
  });

  it('a failed fetch shows a retry, never a broken list', async () => {
    const base = createMockApi();
    let fail = true;
    const api: BootQuestApi = {
      ...base,
      getFundamentals: async (t) => {
        if (fail) throw new Error('boom');
        return base.getFundamentals(t);
      },
    };
    const { user } = renderApp('/campaign/js', api);
    const section = await screen.findByTestId('fundamentals');
    expect(within(section).getByRole('alert')).toBeInTheDocument();
    fail = false;
    await user.click(within(section).getByRole('button', { name: /retry/i }));
    expect(await within(await screen.findByTestId('fundamentals')).findByTestId('fund-progress')).toHaveTextContent('0 complete · 0 gates passed');
  });
});

type User = ReturnType<typeof renderApp>['user'];

/**
 * Step through the gate (U15: one question at a time), answering each with a 0-based choice, and
 * stop on the review screen, where "Submit answers" is offered.
 */
async function answerAll(user: User, picks: readonly number[]) {
  for (const [qi, ci] of picks.entries()) {
    await user.click(screen.getByRole('radio', { name: `Q${qi + 1} choice ${ci + 1}` }));
    await user.click(screen.getByRole('button', { name: qi === picks.length - 1 ? /Review answers/ : /^Next/ }));
  }
  expect(screen.getByTestId('gate-review')).toBeInTheDocument();
}

describe('a Fundamentals topic in the player', () => {
  it('shows the lesson (with headings) above the quiz gate in one reading column; no repo reading list', async () => {
    renderApp(`/play/${T1}`);
    expect(await screen.findByRole('heading', { name: 'Lesson' })).toBeInTheDocument();
    // U9: one centred reading column, the lesson first and the gate after it
    expect(document.querySelector('.player')).toHaveAttribute('data-layout', 'reading');
    const lesson = document.querySelector('.player-instructions')!;
    const gate = screen.getByRole('region', { name: 'Quiz gate' });
    expect(lesson.compareDocumentPosition(gate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The seven primitives' }).tagName).toBe('H3');
    expect(screen.getByRole('heading', { name: 'Quiz gate' })).toBeInTheDocument();
    expect(screen.getByTestId('fund-gate-intro')).toHaveTextContent('5 questions, pass mark 80%');
    expect(screen.getByTestId('fund-gate-intro')).toHaveTextContent("enrols this topic's 3 flashcards");
    expect(screen.queryByTestId('reading-list')).not.toBeInTheDocument();
    expect(screen.queryByText(/Reading list/)).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Fundamentals');
  });

  // U2 (ruling 2): the gate is closed-book
  it('hides the lesson while the gate is open; "Show lesson" brings it back and marks the try as assisted; a retry hides it again', async () => {
    const base = createMockApi();
    const sent: Submission[] = [];
    const api: BootQuestApi = {
      ...base,
      submitUnit: async (id, s) => {
        sent.push(s);
        return base.submitUnit(id, s);
      },
    };
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    // no lesson text anywhere in the DOM
    expect(screen.queryByRole('heading', { name: 'Lesson' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'The seven primitives' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Test arrays with');
    expect(document.body.textContent).not.toContain('seven primitive types');
    expect(screen.getByTestId('lesson-hidden')).toHaveTextContent('Lesson hidden while you answer');

    await user.click(screen.getByRole('button', { name: 'Show lesson' }));
    expect(screen.getByRole('heading', { name: 'The seven primitives' })).toBeInTheDocument();
    expect(screen.queryByTestId('lesson-hidden')).not.toBeInTheDocument();
    expect(screen.getByTestId('lesson-shown')).toHaveTextContent('I had help');
    await answerAll(user, FX1.keys.map((k) => (k + 1) % 3)); // all wrong
    const help = screen.getByRole('checkbox', { name: 'I had help' });
    expect(help).toBeChecked();
    expect(help).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
    expect(sent[0]).toMatchObject({ selfAssisted: true });
    // the try is over: the lesson is there to re-read
    expect(screen.getByRole('heading', { name: 'The seven primitives' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByRole('heading', { name: 'The seven primitives' })).not.toBeInTheDocument();
    expect(screen.getByTestId('lesson-hidden')).toBeInTheDocument();
    await answerAll(user, FX1.keys);
    expect(screen.getByRole('checkbox', { name: 'I had help' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'I had help' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(sent[1]).toMatchObject({ selfAssisted: false });
  }, 90_000); // two full passes through the stepper

  it('passing the gate marks the topic passed and unlocks the next topic on the ladder', async () => {
    const api = createMockApi();
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    await answerAll(user, FX1.keys);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(screen.getByTestId('quest-done')).toHaveTextContent('gate passed');
    const ladder = await api.getFundamentals('js');
    expect(ladder.topics.map((t) => t.unit.state)).toEqual(['done', 'available']);
    // U5: a passed gate is not a dead end (this topic has no drills: the next topic is the step)
    const next = await screen.findByTestId('next-unit');
    const primary = within(next).getByTestId('next-primary');
    expect(primary).toHaveTextContent('Next topic: 02 Functions & closures');
    expect(primary).toHaveAttribute('href', '/play/208');
    await waitFor(() => expect(primary).toHaveFocus());
  });

  it('U5: after a passed gate "Practise: <drill>" is the primary link and "Skip to next topic" the second; neither after a fail', async () => {
    const base = createMockApi();
    const api: BootQuestApi = {
      ...base,
      getFundamentals: async (t) => {
        const ladder = await base.getFundamentals(t);
        const drill = { ...ladder.topics[0]!.unit, id: 950, key: 'fund-js/01-values-types-and-coercion/01-defaults', kind: 'drill' as const, title: 'Defaults that keep `0`', state: 'available' as const };
        return { ...ladder, topics: ladder.topics.map((x, i) => (i === 0 ? { ...x, drills: [drill] } : x)) };
      },
    };
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    await answerAll(user, FX1.keys.map((k) => (k + 1) % 3));
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
    expect(screen.queryByTestId('next-unit')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await answerAll(user, FX1.keys);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    const next = await screen.findByTestId('next-unit');
    expect(within(next).getByTestId('next-primary')).toHaveTextContent('Practise: Defaults that keep 0');
    expect(within(next).getByTestId('next-primary')).toHaveAttribute('href', '/play/950');
    // wave B (ruling 4): after a gate pass the next topic is a muted "Skip" link, never a second button
    expect(within(next).getByTestId('next-topic')).toHaveTextContent('Skip to next topic');
    expect(within(next).getByTestId('next-topic')).not.toHaveClass('btn');
    expect(within(next).getByTestId('next-topic')).toHaveAttribute('href', '/play/208');
  });
});

// U15 (ruling 3): the Fundamentals gate is stepped and can be taken without the mouse
describe('the Fundamentals gate stepper', () => {
  const recorded = () => {
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
  };

  it('one question at a time with "n / total"; 1-4 picks, Enter goes on, then the review screen; Enter on Submit submits', async () => {
    const { api, sent } = recorded();
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('1 / 5');
    expect(screen.getByTestId('question-1')).toBeInTheDocument();
    expect(screen.queryByTestId('question-2')).not.toBeInTheDocument();
    // the first choice has focus, so the keyboard is live at once
    expect(screen.getByRole('radio', { name: 'Q1 choice 1' })).toHaveFocus();

    // Enter without a pick does nothing; a digit past the choices does nothing
    await user.keyboard('{Enter}4');
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('1 / 5');
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);

    for (const [qi, ci] of FX1.keys.entries()) {
      expect(screen.getByTestId('gate-progress')).toHaveTextContent(`${qi + 1} / 5`);
      await user.keyboard(String(ci + 1));
      expect(screen.getByRole('radio', { name: `Q${qi + 1} choice ${ci + 1}` })).toBeChecked();
      // nothing says right or wrong before the submit
      expect(document.querySelector('.study-mark, .choice-right, .choice-wrong')).toBeNull();
      await user.keyboard('{Enter}');
    }
    // the review screen: every question, no marks, Submit focused
    expect(screen.getByTestId('gate-review')).toBeInTheDocument();
    for (let n = 1; n <= 5; n++) {
      expect(screen.getByTestId(`question-${n}`)).toBeInTheDocument();
      expect(screen.queryByTestId(`mark-${n}`)).not.toBeInTheDocument();
    }
    expect(sent).toHaveLength(0);
    const submit = screen.getByRole('button', { name: /Submit answers/ });
    expect(submit).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(sent).toEqual([{ answers: FX1.keys, selfAssisted: false }]);
    for (let n = 1; n <= 5; n++) expect(screen.getByTestId(`mark-${n}`)).toHaveTextContent('correct');
  });

  it('Back and Next move freely; the review screen flags an unanswered question and Enter there never submits from a choice', async () => {
    const { api, sent } = recorded();
    const { user } = renderApp(`/play/${T1}`, api);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    await user.keyboard('2{Enter}');
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('2 / 5');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('1 / 5');
    expect(screen.getByRole('radio', { name: 'Q1 choice 2' })).toBeChecked();
    // skip ahead without answering 2..5
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: /^Next/ }));
    await user.click(screen.getByRole('button', { name: /Review answers/ }));
    expect(screen.getByTestId('question-2')).toHaveTextContent('not answered');
    expect(screen.getByTestId('question-1')).not.toHaveTextContent('not answered');
    expect(screen.getByRole('button', { name: /Submit answers/ })).toBeDisabled();

    // answer the rest on the review screen itself; Enter on a choice does not submit
    for (const [qi, ci] of FX1.keys.entries()) await user.click(screen.getByRole('radio', { name: `Q${qi + 1} choice ${ci + 1}` }));
    expect(screen.getByRole('button', { name: /Submit answers/ })).toBeEnabled();
    await user.keyboard('{Enter}');
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(0);
    // "Back to questions" returns to the stepper
    await user.click(screen.getByRole('button', { name: 'Back to questions' }));
    expect(screen.getByTestId('gate-progress')).toHaveTextContent('5 / 5');
    await user.click(screen.getByRole('button', { name: /Review answers/ }));
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(sent).toHaveLength(1);
  });

  it('a campaign study quest keeps the all-at-once form', async () => {
    const { user } = renderApp('/play/206');
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    expect(screen.queryByTestId('gate-step')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gate-progress')).not.toBeInTheDocument();
    expect(screen.getByTestId('question-1')).toBeInTheDocument();
    expect(screen.getByTestId('question-5')).toBeInTheDocument();
  });
});

// U3 (ruling 4): keyed answers + explanations after a PASSED gate; only the misses after a failed one
describe('the Fundamentals gate result', () => {
  const explanations = () => [...document.querySelectorAll('[data-testid^="explain-"]')];

  it('a pass shows the keyed answer and the explanation under every question, the missed ones first', async () => {
    const { user } = renderApp(`/play/${T1}`);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    // Q2 wrong (choice 1 instead of the keyed choice 2): 4/5 = 80% passes
    await answerAll(user, FX1.keys.map((k, i) => (i === 1 ? 0 : k)));
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    const missed = await screen.findByTestId('explain-2');
    expect(missed).toHaveTextContent("Answer: '0'");
    expect(missed).toHaveTextContent('Every non-empty string is truthy');
    expect(missed).toHaveClass('gate-explain-missed');
    expect(explanations()).toHaveLength(5);
    expect(screen.getByTestId('explain-1')).toHaveTextContent("Answer: 'object'");
    expect(screen.getByTestId('explain-1')).not.toHaveClass('gate-explain-missed');
    // missed first, then the rest in question order
    expect([...document.querySelectorAll('fieldset[data-testid^="question-"]')].map((f) => f.getAttribute('data-testid'))).toEqual([
      'question-2',
      'question-1',
      'question-3',
      'question-4',
      'question-5',
    ]);
    // the keyed choice is marked, and the learner's wrong pick
    const q2 = screen.getByTestId('question-2');
    expect(within(q2).getByRole('radio', { name: 'Q2 choice 2' }).closest('label')).toHaveClass('choice-right');
    expect(within(q2).getByRole('radio', { name: 'Q2 choice 1' }).closest('label')).toHaveClass('choice-wrong');
    expect(screen.getByTestId('mark-2')).toHaveTextContent('incorrect');
    expect(screen.getByTestId('miss-cards-notice')).toHaveTextContent('The 1 question you missed is listed first above, with the keyed answer and why');
    expect(screen.getByTestId('miss-cards-notice')).toHaveTextContent('each one is now a review card');
  });

  it('a fail shows the score and what to re-read, and nothing else: no per-question mark, no key, no explanation', async () => {
    const { user, api } = renderApp(`/play/${T1}`);
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    await answerAll(user, FX1.keys.map((k, i) => (i < 2 ? (k + 1) % 3 : k))); // 3/5
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Below the pass mark')).toBeInTheDocument();
    // wave B (ruling 2): a failed gate marks no question at all
    expect(document.querySelector('.study-mark, [data-testid^="mark-"]')).toBeNull();
    expect(screen.getByTestId('study-result')).toHaveTextContent('3/5 correct (60%)');
    // let the notes re-read settle: still nothing
    const notes = await api.getUnitNotes(T1);
    expect(notes.explanations).toMatchObject({ state: 'locked', released: [], withheld: 5 });
    expect(explanations()).toHaveLength(0);
    expect(document.querySelector('.choice-right')).toBeNull();
    expect(document.body.textContent).not.toContain('Every non-empty string is truthy');
    expect(screen.getByTestId('miss-cards-notice')).toHaveTextContent('The answers to the 2 missed questions are not shown here');
    // ...and names the lesson sections of the missed questions (Q1, Q2) from the gate map
    expect(screen.getByTestId('reread')).toHaveTextContent('Re-read: typeof surprises · The seven primitives');
    expect(screen.getByTestId('fail-advice')).toHaveTextContent('A failed try costs nothing and is saved.');
    // question order is untouched
    expect([...document.querySelectorAll('fieldset[data-testid^="question-"]')].map((f) => f.getAttribute('data-testid'))).toEqual(
      [1, 2, 3, 4, 5].map((n) => `question-${n}`),
    );
  });

  it('a campaign study quest shows its released explanations under their questions after a pass (same path), in question order', async () => {
    const { user } = renderApp('/play/206');
    await user.click(await screen.findByRole('button', { name: /Start quiz/ }));
    const keys = [1, 1, 1, 0, 0];
    for (const [qi, ci] of keys.entries()) await user.click(screen.getByRole('radio', { name: `Q${qi + 1} choice ${ci + 1}` }));
    expect(explanations()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(await screen.findByTestId('explain-1')).toHaveTextContent('The lock guards the thing two requests compete for');
    expect([...document.querySelectorAll('fieldset[data-testid^="question-"]')].map((f) => f.getAttribute('data-testid'))).toEqual(
      [1, 2, 3, 4, 5].map((n) => `question-${n}`),
    );
  });
});
