import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import { notesFixtures } from '../api/fixtures/notes';
import { studyQuestFixtures } from '../api/fixtures/ladder';
import type { BootQuestApi, ReviewQueueItem, UnitNotesResponse } from '../api/types';
import { NoteMarkdown } from '../components/LearnMore';
import { renderApp } from '../test/render';
import { render } from '@testing-library/react';
import { seededItemKey } from './Review';

const SQ = 206; // csharp study quest: borrowbox (5 questions, keys [1, 1, 1, 0, 0])
const FX = studyQuestFixtures[String(SQ)]!;
const NOTES = notesFixtures.borrowbox!;
const afterTitle = (q: number) => NOTES.find((n) => n.target === FX.public.questions[q - 1]!.itemKey && n.phase === 'after')!.title;

async function answerAll(user: ReturnType<typeof renderApp>['user'], picks: number[]) {
  for (const [qi, ci] of picks.entries()) await user.click(screen.getByRole('radio', { name: `Q${qi + 1} choice ${ci + 1}` }));
}

describe('"Learn more" drawer', () => {
  it('`i` opens it on a study quest: readings now, explanations "unlock after you answer" (count only), Esc closes', async () => {
    const { user } = renderApp(`/play/${SQ}`);
    await screen.findByTestId('reading-list');
    await user.keyboard('i');
    const drawer = await screen.findByRole('dialog', { name: /Learn more/ });
    expect(await within(drawer).findByTestId('note-r01-start-here')).toHaveTextContent('Start here: loans, items and one lock');
    expect(within(drawer).getByTestId('note-r02-locking-a-loan')).toBeInTheDocument();
    const locked = within(drawer).getByTestId('explanations-locked');
    expect(locked).toHaveTextContent('Explanations unlock after you answer');
    expect(locked).toHaveTextContent('5 waiting');
    for (let q = 1; q <= 5; q++) expect(drawer).not.toHaveTextContent(afterTitle(q));
    // excerpts are quoted with their path:lines and link to the pinned source
    const fig = within(drawer).getAllByRole('figure')[0]!;
    expect(fig).toHaveTextContent('docs/02-CONCEPTS.md:40-44');
    expect(within(fig).getByRole('link')).toHaveAttribute('href', expect.stringContaining('/blob/0123456789abcdef0123456789abcdef01234567/docs/02-CONCEPTS.md#L40-L44'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('traps Tab inside the drawer, returns focus to the opener, and page shortcuts never fire behind it', async () => {
    const { user } = renderApp(`/play/${SQ}`);
    await screen.findByTestId('reading-list');
    const opener = screen.getAllByRole('button', { name: /Learn more/ })[0]!;
    await user.click(opener);
    const drawer = await screen.findByRole('dialog', { name: /Learn more/ });
    await within(drawer).findByTestId('note-r01-start-here');
    for (let i = 0; i < 25; i++) {
      await user.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(drawer.contains(document.activeElement)).toBe(true);
    await user.keyboard('?'); // the global shortcut help must not open behind the drawer
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: /Close/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });

  it('after a FAILED submit: right answers get their explanation button, a missed one stays withheld (its review card comes tomorrow)', async () => {
    const { user } = renderApp(`/play/${SQ}`);
    await screen.findByTestId('reading-list');
    // the reading step a reading targets carries its own button
    expect(within(screen.getByTestId('reading-list')).getAllByRole('button', { name: /Learn more/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /Start quiz/ }));
    expect(screen.queryByTestId('learn-more-q1')).not.toBeInTheDocument(); // nothing about Q1 before answering
    await answerAll(user, [1, 1, 1, 2, 2]); // Q4, Q5 missed: 60%
    await user.click(screen.getByRole('button', { name: /Submit answers/ }));
    await screen.findByTestId('study-result');
    const q1 = await screen.findByTestId('learn-more-q1');
    expect(screen.queryByTestId('learn-more-q4')).not.toBeInTheDocument();
    await user.click(within(q1).getByRole('button'));
    const drawer = await screen.findByRole('dialog', { name: /Learn more/ });
    expect(await within(drawer).findByText(afterTitle(1))).toBeInTheDocument();
    expect(drawer).not.toHaveTextContent(afterTitle(2)); // focused on Q1 until "show all"
    await user.click(within(drawer).getByRole('button', { name: 'Show all notes for this unit' }));
    expect(drawer).toHaveTextContent(afterTitle(3));
    expect(drawer).not.toHaveTextContent(afterTitle(4));
    expect(drawer).not.toHaveTextContent(afterTitle(5));
    expect(within(drawer).getByTestId('explanations-locked')).toHaveTextContent('unlock when their review cards are due');
  });

  it('after a pass every explanation is released', async () => {
    const api = createMockApi();
    await api.submitUnit(SQ, { answers: FX.keys, selfAssisted: false });
    const n = await api.getUnitNotes(SQ);
    expect(n.explanations).toMatchObject({ state: 'released', withheld: 0 });
    expect(n.explanations.released.map((x) => x.id).sort()).toEqual(['x-q1', 'x-q2', 'x-q3', 'x-q4', 'x-q5']);
  });

  it('a code unit: explanation locked before a pass or reveal; after the reveal the explanation and the solution', async () => {
    const { user, api } = renderApp('/play/102');
    await screen.findByRole('heading', { level: 1 });
    await user.keyboard('i');
    let drawer = await screen.findByRole('dialog', { name: /Learn more/ });
    expect(await within(drawer).findByTestId('explanations-locked')).toHaveTextContent('unlocks after you pass');
    expect(within(drawer).queryByTestId('unit-explanation')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await api.revealUnit(102);
    await user.keyboard('i');
    drawer = await screen.findByRole('dialog', { name: /Learn more/ });
    expect(await within(drawer).findByTestId('unit-explanation')).toHaveTextContent('reduce threads one accumulator');
    expect(within(drawer).getByTestId('unit-solution')).toHaveTextContent('items.reduce');
  });

  it('the review card back offers Learn more for a seeded card (only after the answer is shown)', async () => {
    const base = createMockApi();
    const card: ReviewQueueItem = {
      id: 77,
      cardKey: `quiz-miss:${FX.public.questions[0]!.itemKey}`,
      kind: 'quiz-miss',
      unitId: SQ,
      competencyId: 'code-reading',
      dueAt: 0,
      card: { front: FX.public.questions[0]!.prompt, back: 'the item being lent', source: 'borrowbox@0123456 docs/02-CONCEPTS.md:60-62' },
    };
    const released: UnitNotesResponse = { ...(await base.getUnitNotes(SQ)) };
    await base.submitUnit(SQ, { answers: FX.keys, selfAssisted: false });
    const after = await base.getUnitNotes(SQ);
    const api: BootQuestApi = { ...base, getReviewQueue: async () => ({ count: 1, items: [card] }), getUnitNotes: async () => after };
    expect(released.explanations.state).toBe('locked');
    const { user } = renderApp('/review', api);
    await screen.findByTestId('card-front');
    expect(screen.queryByRole('button', { name: /Learn more/ })).not.toBeInTheDocument();
    await user.keyboard(' ');
    await screen.findByTestId('card-back');
    await user.keyboard('i');
    const drawer = await screen.findByRole('dialog', { name: /Learn more/ });
    expect(await within(drawer).findByText(afterTitle(1))).toBeInTheDocument();
    expect(drawer).not.toHaveTextContent(afterTitle(2));
    expect(seededItemKey('flashcard:seed:quests:x/flashcard/1')).toBe('seed:quests:x/flashcard/1');
    expect(seededItemKey('js/card-001')).toBeNull();
  });

  it('a locked unit answers 403: the drawer says it is locked', async () => {
    const base = createMockApi();
    const { ApiError } = await import('../api/types');
    const api: BootQuestApi = { ...base, getUnitNotes: () => Promise.reject(new ApiError(403, 'ACT_LOCKED', 'locked')) };
    const { user } = renderApp('/play/102', api);
    await screen.findByRole('heading', { level: 1 });
    await user.keyboard('i');
    expect(await screen.findByTestId('learn-more-error')).toHaveTextContent('This unit is locked');
  });

  it('`i` goes through the shared shortcut gate: an open alertdialog or a held key never opens the drawer', async () => {
    const { user } = renderApp('/play/102');
    await screen.findByRole('textbox', { name: /Code editor/ });
    // an inline confirm (role=alertdialog) is in front of the page
    await user.click(screen.getByRole('button', { name: /Reveal solution/ }));
    const confirm = screen.getByRole('alertdialog');
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: 'i' });
    expect(screen.queryByRole('dialog', { name: /Learn more/ })).not.toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    (document.activeElement as HTMLElement | null)?.blur();
    // auto-repeat of a held key
    fireEvent.keyDown(window, { key: 'i', repeat: true });
    expect(screen.queryByRole('dialog', { name: /Learn more/ })).not.toBeInTheDocument();
    // a plain press still opens it
    fireEvent.keyDown(window, { key: 'i' });
    expect(await screen.findByRole('dialog', { name: /Learn more/ })).toBeInTheDocument();
  });

  it('renders the notes markdown subset: lists, bold, code, italics; never HTML', () => {
    const { container } = render(<NoteMarkdown text={'Intro **bold** and *soft* with `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n<b>raw</b>'} />);
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('em')).toHaveTextContent('soft');
    expect(container.querySelector('code')).toHaveTextContent('code');
    expect(container.querySelector('b')).toBeNull();
    expect(container).toHaveTextContent('<b>raw</b>');
  });
});
