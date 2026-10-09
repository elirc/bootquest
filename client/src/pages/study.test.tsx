import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import { studyQuestFixtures } from '../api/fixtures/ladder';
import type { BootQuestApi } from '../api/types';
import { renderApp } from '../test/render';

const SQ = 206; // csharp study quest: borrowbox (5 questions, pass mark 80%)
const FX = studyQuestFixtures[String(SQ)]!;

async function answerAll(user: ReturnType<typeof renderApp>['user'], picks: number[]) {
  for (const [qi, ci] of picks.entries()) await user.click(screen.getByRole('radio', { name: `Q${qi + 1} choice ${ci + 1}` }));
}

describe('W8 study-quest pane', () => {
  it('serves the reading list with repo links, then the quiz gate all at once; a miss shows right/wrong only and becomes a review card', async () => {
    const { user } = renderApp(`/play/${SQ}`);
    const list = await screen.findByTestId('reading-list');
    const links = within(list).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(FX.public.readingSteps.map((r) => r.url));
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('button', { name: /Reveal solution/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Start quiz/ }));
    const submit = screen.getByRole('button', { name: /Submit answers/ });
    // 3 of 5 right = 60%: below the pass mark (keys are [1, 1, 1, 0, 0])
    await answerAll(user, [1, 1, 1, 2, 2].slice(0, 4));
    expect(submit).toBeDisabled(); // the full answer set is required
    await user.click(screen.getByRole('radio', { name: 'Q5 choice 3' }));
    await user.click(submit);

    const result = await screen.findByTestId('study-result');
    expect(result).toHaveTextContent('Below the pass mark');
    expect(result).toHaveTextContent('3/5 correct (60%) · pass mark 80%');
    expect(screen.getByTestId('mark-1')).toHaveTextContent('correct');
    expect(screen.getByTestId('mark-4')).toHaveTextContent('incorrect');
    expect(screen.getByTestId('miss-cards-notice')).toHaveTextContent('each one is now a review card');
    expect(screen.getByTestId('miss-cards-notice')).toHaveTextContent('arrives in your review queue tomorrow');
    // the keyed choice of a missed question is never marked or named
    expect(document.querySelector('.choice-right')).toBeNull();
    expect(screen.queryByTestId('quest-done')).not.toBeInTheDocument();

    // retry: 4 of 5 = exactly 80% passes; +50 XP once; the earlier miss card is deduped
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await answerAll(user, [1, 1, 1, 0, 2]);
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    expect(await screen.findByText('Quiz gate passed')).toBeInTheDocument();
    expect(screen.getByTestId('study-result')).toHaveTextContent('4/5 correct (80%)');
    expect(screen.getByTestId('study-result')).toHaveTextContent('+50 XP');
    expect(screen.getByTestId('miss-cards-notice')).toHaveTextContent('1 already queued from an earlier attempt');
    expect(screen.getByTestId('flashcards-notice')).toHaveTextContent('2 flashcards from this quest joined your review queue');
    expect(screen.getByTestId('quest-done')).toHaveTextContent('quest done');
  });

  it('a second pass earns 0 XP (already-awarded)', async () => {
    const api = createMockApi();
    const first = await api.submitUnit(SQ, { answers: FX.keys, selfAssisted: false });
    const again = await api.submitUnit(SQ, { answers: FX.keys, selfAssisted: false });
    expect(first.xp).toMatchObject({ amount: 50, reason: null });
    expect(again.xp).toMatchObject({ amount: 0, reason: 'already-awarded' });
    expect(again.studyQuiz?.flashcardsEnrolled).toBe(0);
  });

  it('mock honesty: the unit detail carries choices but no keys; runs are refused; answers are required', async () => {
    const api = createMockApi();
    const d = await api.getUnit(SQ);
    expect(d.studyQuest?.questions).toHaveLength(5);
    expect(JSON.stringify(d)).not.toMatch(/answerKey|"keys"/);
    await expect(api.runUnit(SQ, { answer: 1 })).rejects.toMatchObject({ code: 'RUN_NOT_AVAILABLE' });
    await expect(api.submitUnit(SQ, { answer: 1, selfAssisted: false })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(api.submitUnit(SQ, { answers: [1, 1], selfAssisted: false })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('content pending: a study unit whose pack is not loaded says so instead of a quiz', async () => {
    const base = createMockApi();
    const api: BootQuestApi = { ...base, getUnit: async (id) => ({ ...(await base.getUnit(id)), studyQuest: null }) };
    renderApp(`/play/${SQ}`, api);
    expect(await screen.findByTestId('study-pending')).toHaveTextContent('Content pending');
  });
});

describe('W8 campaign + review bindings', () => {
  it('a passed study quest shows done on the campaign map and its act progress follows; no content-pending chip', async () => {
    const api = createMockApi();
    await api.submitUnit(SQ, { answers: FX.keys, selfAssisted: false });
    renderApp('/campaign/csharp', api);
    await screen.findByRole('heading', { level: 2, name: 'Act 1: C# foundations' });
    const quest = document.querySelector('[data-quest="32"]') as HTMLElement;
    expect(within(quest).getByText('done')).toBeInTheDocument();
    expect(within(quest).queryByText('content pending')).not.toBeInTheDocument();
    expect(screen.getByText('core 1/2')).toBeInTheDocument();
  });

  it('review cards carry their seeded text: question on the front, keyed answer + source on the back', async () => {
    const base = createMockApi();
    const api: BootQuestApi = {
      ...base,
      getReviewQueue: async () => ({
        count: 1,
        items: [
          {
            id: 77,
            cardKey: 'quiz-miss:seed:quests:borrowbox/quiz/q1',
            kind: 'quiz-miss',
            unitId: SQ,
            competencyId: null,
            dueAt: 0,
            card: { front: 'Which object does LoanService lock on?', back: 'the item being lent', source: 'borrowbox@0123456 docs/02-CONCEPTS.md:50' },
          },
        ],
      }),
    };
    const { user } = renderApp('/review', api);
    expect(await screen.findByTestId('card-front')).toHaveTextContent('Which object does LoanService lock on?');
    expect(screen.queryByText('the item being lent')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show answer/ }));
    expect(screen.getByTestId('card-back')).toHaveTextContent('the item being lent');
    expect(screen.getByTestId('card-back')).toHaveTextContent('Source: borrowbox@0123456 docs/02-CONCEPTS.md:50');
  });
});
