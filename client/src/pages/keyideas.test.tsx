import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, GradeResponse, KeyIdeaQueueItem, KeyIdeasResponse, ReviewQueueItem } from '../api/types';
import { renderApp } from '../test/render';

// rv2 S1 (PLAN §2.1, F1, F8): the key-ideas session, the 10-minute cap, redo cards in the queue, the fold and the recap.

const NOW = Date.UTC(2026, 10, 14, 12);
const ref = (section: string, tags: string[]) => ({ section, sectionTitle: `Section ${section}`, ideaId: 'i', tags, sources: [{ key: `k/${section}`, unitId: 7, title: `Source ${section}`, passed: true }] });
const kiCard = (id: number, section: string, tags: string[]): KeyIdeaQueueItem => ({
  id,
  cardKey: `keyidea:${section}/i${id}`,
  kind: 'concept',
  unitId: 7,
  competencyId: null,
  dueAt: NOW - 1000,
  card: { front: `Prompt ${id} of ${section}?`, back: `Answer ${id}`, source: `Key idea · Section ${section}` },
  keyIdea: ref(section, tags),
});
const plain = (id: number): ReviewQueueItem => ({ id, cardKey: `js/c-${id}`, kind: 'card', unitId: 101, competencyId: 'language-fluency', dueAt: NOW - 1000 });
const graded = (itemId: number, remainingDue: number): GradeResponse => ({ itemId, grade: 'good', prevDueAt: NOW, nextDueAt: NOW + 86_400_000, xp: { id: itemId, amount: 1, reason: null }, demotion: null, remainingDue });

describe('Review: the key-ideas session (mode=keyideas)', () => {
  it('serves the interleaved key-idea cards with their source links and the tag chips (the concept index)', async () => {
    const getKeyIdeaQueue = vi.fn(async (q?: { tag?: string; limit?: number }) => ({
      count: 2,
      items: [kiCard(1, 'alpha', ['idempotency']), kiCard(2, 'beta', ['caching'])].filter((c) => !q?.tag || c.keyIdea.tags.includes(q.tag)),
      tags: [
        { tag: 'caching', count: 1 },
        { tag: 'idempotency', count: 1 },
      ],
    }));
    const api: BootQuestApi = { ...createMockApi(), getKeyIdeaQueue, gradeReview: async (id) => graded(id, 1) };
    const { user } = renderApp('/review?mode=keyideas', api);
    expect(await screen.findByRole('heading', { name: 'Key ideas session' })).toBeInTheDocument();
    expect(getKeyIdeaQueue).toHaveBeenCalledWith({});
    const tags = await screen.findByTestId('review-tags');
    expect(within(tags).getByRole('link', { name: /#idempotency 1/ })).toHaveAttribute('href', '/review?mode=keyideas&tag=idempotency');
    expect(screen.getByTestId('card-front')).toHaveTextContent('Prompt 1 of alpha?');
    await user.keyboard(' ');
    expect(screen.getByTestId('card-back')).toHaveTextContent('Answer 1');
    expect(within(screen.getByTestId('keyidea-links')).getByRole('link', { name: 'Source alpha' })).toHaveAttribute('href', '/play/7');
    await user.keyboard('3');
    expect(await screen.findByText('Prompt 2 of beta?')).toBeInTheDocument();
  });

  it('the 10-minute key-ideas session asks for 5 cards', async () => {
    const getKeyIdeaQueue = vi.fn(async () => ({ count: 0, items: [], tags: [] }));
    renderApp('/review?mode=keyideas&ten=1', { ...createMockApi(), getKeyIdeaQueue });
    expect(await screen.findByText('Nothing due')).toBeInTheDocument();
    expect(getKeyIdeaQueue).toHaveBeenCalledWith({ limit: 5 });
  });
});

describe('Review: F8 the 10-minute mode stops at 20 cards, across paging', () => {
  it('pages of 10 with 30 due: card 20 is the last one served, then the cap panel', { timeout: 120_000 }, async () => {
    const due = Array.from({ length: 30 }, (_, i) => plain(9000 + i));
    const api: BootQuestApi = {
      ...createMockApi(),
      getReviewQueue: async (limit) => ({ count: due.length, items: due.slice(0, limit ?? 10) }),
      gradeReview: async (itemId) => {
        due.splice(
          due.findIndex((c) => c.id === itemId),
          1,
        );
        return graded(itemId, due.length);
      },
    };
    const { user } = renderApp('/review?ten=1', api);
    await screen.findByRole('button', { name: /Show answer/ });
    expect(document.querySelector('.review-progress')!.textContent).toContain('of 20');
    for (let i = 0; i < 20; i++) {
      await user.keyboard(' ');
      await user.keyboard('3');
      if (i < 19) await screen.findByText(String(i + 2), { selector: '.review-progress strong' });
    }
    expect(await screen.findByTestId('session-cap')).toHaveTextContent('ends after 20 cards');
    expect(due).toHaveLength(10);
    expect(screen.queryByRole('button', { name: /Review the/ })).toBeNull();
  });
});

describe('Review: a redo card is done in the Player, never self-rated', () => {
  it('links to the sibling drill in practice mode; the grade keys do nothing', async () => {
    const gradeReview = vi.fn(async (id: number) => graded(id, 0));
    const api: BootQuestApi = {
      ...createMockApi(),
      getReviewQueue: async () => ({
        count: 1,
        items: [{ id: 77, cardKey: 'redo:alpha/i', kind: 'concept', unitId: 7, competencyId: null, dueAt: NOW, card: { front: 'Redo, in practice mode: an idea.', back: 'b', source: null } }],
      }),
      getConceptCard: async () => ({ itemId: 77, cardKey: 'redo:alpha/i', type: 'redo', redo: { unitId: 42, key: 'k/s1', title: 'Sibling drill' } }),
      gradeReview,
    };
    const { user } = renderApp('/review', api);
    expect(await screen.findByTestId('redo-open')).toHaveAttribute('href', '/play/42?redo=77');
    await user.keyboard(' ');
    await user.keyboard('3');
    expect(gradeReview).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByText('Session done')).toBeInTheDocument();
  });
});

const IDEAS: KeyIdeasResponse = {
  sections: [
    {
      section: 'fx-beta',
      title: 'Fixture beta',
      track: 'sysdesign',
      recap: { state: 'open', passed: 2, total: 3, needed: 2, doneAt: null },
      ideas: [
        { id: 'met', idea: 'Invalidate on write.', tags: ['caching'], status: 'shaky', sources: [{ key: 'kx/b/01', unitId: 5, title: 'Caching 01', passed: true }], prompt: 'A price is stale. Why?', answer: 'Delete the entry in the write path.', why: 'Stale reads.' },
        { id: 'waiting', idea: 'Guard the stampede.', tags: ['caching'], status: 'not-met', sources: [{ key: 'kx/b/03', unitId: 6, title: 'Caching 03', passed: false }] },
      ],
    },
  ],
  tiles: [{ track: 'sysdesign', owned: 0, shaky: 1, notMet: 1 }],
  recapsOpen: [{ section: 'fx-beta', title: 'Fixture beta' }],
  dueCards: 3,
};

describe('Key ideas page, dashboard tile and the section recap', () => {
  it('the fold lists every idea sentence; the answer only for a met idea; the unmet one names what to pass', async () => {
    renderApp('/keyideas', { ...createMockApi(), getKeyIdeas: async () => IDEAS });
    const fold = await screen.findByTestId('keyidea-fold-fx-beta');
    expect(within(fold).getByTestId('keyidea-met')).toHaveTextContent('Delete the entry in the write path.');
    const waiting = within(fold).getByTestId('keyidea-waiting');
    expect(waiting).toHaveTextContent('Guard the stampede.');
    expect(within(waiting).getByTestId('keyidea-locked')).toHaveTextContent('Caching 03');
    expect(within(fold).getByRole('link', { name: 'Section recap' })).toHaveAttribute('href', '/keyideas?recap=fx-beta');
  });

  it('the dashboard tile shows owned / shaky / not yet met per track and the open recap', async () => {
    renderApp('/', { ...createMockApi(), getKeyIdeas: async () => IDEAS });
    const tile = await screen.findByTestId('keyideas-tile', {}, { timeout: 15_000 });
    expect(within(tile).getByRole('row', { name: /System design 0 1 1/ })).toBeInTheDocument();
    expect(within(tile).getByRole('link', { name: 'Section recap: Fixture beta' })).toHaveAttribute('href', '/keyideas?recap=fx-beta');
    expect(within(tile).getByRole('link', { name: 'Key ideas session (3 due)' })).toHaveAttribute('href', '/review?mode=keyideas');
  });

  it('the recap is answer-first: the answer opens after 8 typed words, then a mark; the submit carries every recall', async () => {
    const revealIdea = vi.fn(async (_s: string, b: { ideaId: string; recall: string }) => ({ ideaId: b.ideaId, answer: 'Delete the entry in the write path.', why: 'Stale reads.', sources: [] }));
    const submitRecap = vi.fn(async (section: string) => ({ checkpointId: 1, section, kind: 'recap' as const, xp: { id: 9, amount: 20, reason: null }, reviewXp: null, reenrolled: ['keyidea:fx-beta/met'], recheckDueAt: [1, 2] }));
    const api: BootQuestApi = {
      ...createMockApi(),
      getKeyIdeas: async () => IDEAS,
      getRecap: async (section) => ({ section, title: 'Fixture beta', kind: 'recap', prompts: [{ ideaId: 'met', prompt: 'A price is stale. Why?' }] }),
      revealIdea,
      submitRecap,
    };
    const { user } = renderApp('/keyideas?recap=fx-beta', api);
    const box = await screen.findByTestId('recap-recall');
    await user.type(box, 'the write path');
    expect(screen.getByTestId('recap-reveal')).toBeDisabled();
    await user.type(box, ' must delete the cached entry every time');
    await user.click(screen.getByTestId('recap-reveal'));
    expect(await screen.findByTestId('recap-answer')).toHaveTextContent('Delete the entry in the write path.');
    expect(revealIdea).toHaveBeenCalledWith('fx-beta', { ideaId: 'met', recall: 'the write path must delete the cached entry every time' });
    await user.click(screen.getByTestId('recap-mark-partly'));
    expect(await screen.findByTestId('recap-done')).toHaveTextContent('+20 XP');
    expect(submitRecap).toHaveBeenCalledWith('fx-beta', { items: [{ ideaId: 'met', recall: 'the write path must delete the cached entry every time', mark: 'partly' }] });
  });
});

describe('Player: the redo entry and the notebook line', () => {
  it('?redo=<itemId> shows the redo bar; "Run as redo" grades only the card', async () => {
    const runRedo = vi.fn(async (itemId: number) => ({ itemId, unitId: 102, result: { pass: true, output: '', failures: [], durationMs: 1 }, grade: 'good' as const, xp: { id: 1, amount: 1, reason: null }, nextDueAt: NOW }));
    const submitUnit = vi.fn();
    const { user } = renderApp('/play/102?redo=77', { ...createMockApi(), runRedo, submitUnit } as BootQuestApi);
    const bar = await screen.findByTestId('redo-bar', {}, { timeout: 15_000 });
    await user.click(within(bar).getByTestId('redo-run'));
    expect(await screen.findByTestId('redo-result')).toHaveTextContent('rated Good');
    expect(runRedo).toHaveBeenCalledWith(77, expect.any(String));
    expect(submitUnit).not.toHaveBeenCalled();
  });

  it('a failed submit offers the optional notebook line; saving it calls POST /notebook with the attempt', async () => {
    const base = createMockApi();
    const addNote = vi.fn(base.addNote);
    const { user } = renderApp('/play/102', { ...base, addNote });
    await user.click(await screen.findByRole('textbox', { name: /Code editor/ }, { timeout: 15_000 }));
    await user.keyboard('// x');
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await within(screen.getByTestId('results')).findByText('Checks failed');
    const nb = screen.getByTestId('notebook-line');
    await user.click(within(nb).getByText(/Note what went wrong/));
    await user.type(within(nb).getByLabelText('In your own words'), 'forgot the empty input case');
    await user.click(within(nb).getByRole('button', { name: 'Save to notebook' }));
    expect(await screen.findByTestId('notebook-saved')).toBeInTheDocument();
    expect(addNote).toHaveBeenCalledWith(expect.objectContaining({ unitId: 102, line: 'forgot the empty input case', category: 'concept-gap', attemptId: expect.any(Number) }));
  });
});
