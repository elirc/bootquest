import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, ExplainBackKeyResponse } from '../api/types';
import { ebMeetsGate, ebTally } from '../lib/eb-weights';
import { renderApp } from '../test/render';
import { blindSplit } from './LadderPanes';

/**
 * A5 explain-back weights in the player: a `[wN]` prefix renders as a chip (text shown without it),
 * the live preview shows weighted coverage and the "every [w3]" rule, and the result names the
 * missed [w3]. A legacy set keeps the old preview (ladder.test.tsx pins its exact wording).
 */

const EB = 105; // explain-back: closures (3 questions, 5 key points)
const KEY_POINT_TEXT = 'A closure captures the variable binding, not a snapshot of its value.';
// total weight 9
const W: Record<string, string> = { q1k1: '[w3] ', q1k2: '[w2] ', q2k1: '[w2] ', q2k2: '[w1] ', q3k1: '[w1] ' };
const SENIOR = '[senior] Design a closure-backed cache. Write your design before you look: 1) scope 2) eviction 3) tests.';

beforeEach(() => window.localStorage.clear());

/** The mock API with EB 105 served as a WEIGHTED set (the server scores it the same way: ebScore). */
function weightedApi(opts: { seniorPrompt?: boolean } = {}): BootQuestApi {
  const base = createMockApi();
  const weigh = (k: ExplainBackKeyResponse): ExplainBackKeyResponse => ({
    ...k,
    questions: k.questions.map((q) => ({ ...q, keyPoints: q.keyPoints.map((kp) => ({ ...kp, text: `${W[kp.id]}${kp.text}` })) })),
  });
  return {
    ...base,
    getUnit: async (id) => {
      const d = await base.getUnit(id);
      if (id !== EB || !opts.seniorPrompt || !d.explainBack) return d;
      return { ...d, explainBack: { ...d.explainBack, questions: d.explainBack.questions.map((q, i) => (i === 0 ? { ...q, prompt: SENIOR } : q)) } };
    },
    getExplainBackKey: async (id) => {
      const k = await base.getExplainBackKey(id);
      return id === EB ? weigh(k) : k;
    },
    selfScoreExplainBack: async (id, body) => {
      const r = await base.selfScoreExplainBack(id, body);
      if (id !== EB) return r;
      const t = ebTally(weigh(await base.getExplainBackKey(id)).questions.flatMap((q) => q.keyPoints), body.perKeyPoint);
      const passed = ebMeetsGate(t, r.minCoveragePct);
      return { ...r, coverage: t.coverage, passed, xp: passed ? r.xp : null, retests: passed ? r.retests : [] };
    },
  };
}

async function answerEb(user: ReturnType<typeof renderApp>['user']) {
  await screen.findByRole('textbox', { name: 'Answer 1' });
  for (let i = 1; i <= 3; i++) await user.type(screen.getByRole('textbox', { name: `Answer ${i}` }), `a${i}`);
  await user.click(screen.getByRole('button', { name: /Submit answers/ }));
  await user.click(screen.getByRole('button', { name: /Store answers/ }));
  await screen.findByText(KEY_POINT_TEXT);
}

async function mark(user: ReturnType<typeof renderApp>['user'], marks: Record<string, 'covered' | 'missed'>) {
  for (const [id, m] of Object.entries(marks)) await user.click(screen.getByRole('radio', { name: `${id} ${m}` }));
}

describe('ebTally / ebMeetsGate (client mirror of the server predicate)', () => {
  const kps = (texts: string[]) => texts.map((text, i) => ({ id: `q1k${i + 1}`, text }));
  it('legacy: plain coverage, integer gate math, no w3 rule', () => {
    const t = ebTally(kps(['a', 'b', 'c', 'd', 'e']), { q1k1: 'covered', q1k2: 'covered', q1k3: 'covered', q1k4: 'covered', q1k5: 'missed' });
    expect(t).toMatchObject({ weighted: false, hitWeight: 4, allWeight: 5, coverage: 0.8, w3Missed: [] });
    expect(ebMeetsGate(t, 80)).toBe(true);
    expect(ebMeetsGate(t, 90)).toBe(false);
  });
  it('weighted: a missed [w3] fails even above the mark; a mixed set is legacy', () => {
    const set = kps(['[w3] a', ...Array.from({ length: 11 }, (_, i) => `[w3] k${i}`)]);
    const marks = Object.fromEntries(set.map((k) => [k.id, k.id === 'q1k1' ? 'missed' : 'covered'])) as Record<string, 'covered' | 'missed'>;
    const t = ebTally(set, marks);
    expect(t.coverage).toBeCloseTo(11 / 12); // 92%
    expect(t.w3Missed).toEqual(['q1k1']);
    expect(ebMeetsGate(t, 80)).toBe(false);
    expect(ebTally(kps(['[w3] a', 'b']), { q1k1: 'missed' })).toMatchObject({ weighted: false, w3Missed: [] });
  });
});

describe('weighted explain-back set in the player', () => {
  it('renders each weight as a chip with the prefix stripped; the preview is weighted and needs every [w3]', async () => {
    const { user } = renderApp(`/play/${EB}`, weightedApi());
    await answerEb(user);
    const chips = screen.getAllByTestId('kp-weight');
    expect(chips.map((c) => c.textContent?.trim())).toEqual(['w3', 'w2', 'w2', 'w1', 'w1']);
    for (const t of document.querySelectorAll('.checklist-text')) expect(t.textContent).not.toMatch(/\[w[123]\]/);

    const preview = screen.getByTestId('score-preview');
    expect(preview).toHaveTextContent('weighted 0/9 = 0% (0/5 key points) — below the 80% promotion gate; every [w3] needed (1 [w3] still unmarked)');
    // plain 80% (4/5) but the [w3] is missed: weighted 6/9, and it fails on the w3 rule
    await mark(user, { q1k1: 'missed', q1k2: 'covered', q2k1: 'covered', q2k2: 'covered', q3k1: 'covered' });
    expect(preview).toHaveTextContent('weighted 6/9 = 66.7% (4/5 key points) — below the 80% promotion gate; [w3] missed: q1k1 (every [w3] is needed to pass)');
    expect(preview).toHaveClass('is-fail');
    // plain 60% but weighted 7/9 = 77.8%: still below
    await mark(user, { q1k1: 'covered', q2k2: 'missed', q3k1: 'missed' });
    expect(preview).toHaveTextContent('weighted 7/9 = 77.8% (3/5 key points) — below the 80% promotion gate; every [w3] covered');
    // plain 80%, weighted 8/9 = 88.9%, every [w3] covered: a pass
    await mark(user, { q2k2: 'covered' });
    expect(preview).toHaveTextContent('weighted 8/9 = 88.9% (4/5 key points) — meets the 80% promotion gate; every [w3] covered');
    expect(preview).toHaveClass('is-pass');

    await user.click(screen.getByRole('button', { name: /Submit self-score/ }));
    expect(screen.getByRole('alertdialog', { name: 'File this self-score?' })).toHaveTextContent(
      'Weighted 8/9 = 88.9% (4/5 key points): meets the 80% promotion gate, every [w3] covered.',
    );
    await user.click(screen.getByRole('button', { name: 'File self-score' }));
    const result = await screen.findByTestId('coverage-result');
    expect(result).toHaveTextContent('Weighted coverage 88.9% (4/5 key points)');
    expect(result).toHaveTextContent('meets the 80% promotion threshold, every [w3] covered');
    expect(screen.queryByTestId('w3-missed')).not.toBeInTheDocument();
  });

  it('a missed [w3]: the confirm says so and the result names the missed [w3] key point (no prefix)', async () => {
    const { user } = renderApp(`/play/${EB}`, weightedApi());
    await answerEb(user);
    await mark(user, { q1k1: 'missed', q1k2: 'covered', q2k1: 'covered', q2k2: 'covered', q3k1: 'covered' });
    await user.click(screen.getByRole('button', { name: /Submit self-score/ }));
    const dialog = screen.getByRole('alertdialog', { name: 'File this self-score?' });
    expect(dialog).toHaveTextContent('[w3] missed: q1k1 (every [w3] is needed)');
    await user.click(within(dialog).getByRole('button', { name: 'File self-score' }));
    const result = await screen.findByTestId('coverage-result');
    expect(result).toHaveClass('verdict-fail');
    expect(result).toHaveTextContent('not a pass: every [w3] key point is needed');
    const w3 = screen.getByTestId('w3-missed');
    expect(w3).toHaveTextContent(`Missed [w3] key point: q1k1 ${KEY_POINT_TEXT}`);
    expect(w3.textContent).not.toContain('[w3] A closure');
    expect(screen.getByTestId('retest-notice')).toHaveTextContent('a [w3] key point was missed');
  });

  it('a legacy (unweighted) set shows no chips and the plain preview', async () => {
    const { user } = renderApp(`/play/${EB}`, createMockApi());
    await answerEb(user);
    expect(screen.queryByTestId('kp-weight')).not.toBeInTheDocument();
    expect(screen.getByTestId('score-preview')).toHaveTextContent('0/5 covered = 0% — below the 80% promotion gate (5 still unmarked)');
  });
});

describe('blind mode for [senior] prompts (client-only, until the answer is stored)', () => {
  it('blindSplit: only a [senior] prompt with the marker sentence splits; others get no toggle', () => {
    expect(blindSplit(SENIOR)).toEqual({ head: '[senior] Design a closure-backed cache. Write your design before you look:', rest: ' 1) scope 2) eviction 3) tests.' });
    expect(blindSplit('[senior] Design a cache. List the sections: 1) scope')).toBeNull();
    expect(blindSplit('Write your design before you look: 1) scope')).toBeNull();
  });

  it('the toggle hides the section list after the marker; prompts without it show no toggle', async () => {
    const { user } = renderApp(`/play/${EB}`, weightedApi({ seniorPrompt: true }));
    const prompt = await screen.findByTestId('eb-prompt-1');
    expect(prompt).toHaveTextContent('1) scope 2) eviction 3) tests.');
    const toggle = screen.getByRole('checkbox', { name: 'Blind mode' });
    expect(toggle).not.toBeChecked(); // off by default
    await user.click(toggle);
    expect(prompt).not.toHaveTextContent('1) scope');
    expect(prompt).toHaveTextContent('Write your design before you look:');
    expect(prompt).toHaveTextContent('sections hidden: blind mode');
    expect(screen.getByTestId('eb-prompt-2')).toHaveTextContent('Why does a var loop counter surprise callbacks?');
    await user.click(toggle);
    expect(prompt).toHaveTextContent('1) scope 2) eviction 3) tests.');
  });

  it('no [senior] marker prompt: no toggle', async () => {
    renderApp(`/play/${EB}`, createMockApi());
    await screen.findByRole('textbox', { name: 'Answer 1' });
    expect(screen.queryByRole('checkbox', { name: 'Blind mode' })).not.toBeInTheDocument();
  });
});
