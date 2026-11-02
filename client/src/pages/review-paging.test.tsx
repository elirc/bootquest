import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import { ApiError, type BootQuestApi, type GradeResponse, type ReviewQueueItem } from '../api/types';
import { renderApp } from '../test/render';

// ab wave S2 (REVIEW BUG-2): the queue endpoint serves 200 cards per page; the Review page must
// page through a longer due queue and never claim "Queue cleared" while cards are still due.

const PAGE = 200; // server DEFAULT_QUEUE_LIMIT (server/src/api/app.ts)
const NOW = Date.UTC(2026, 9, 30, 12);

/** A server-faithful fake: `n` due cards, pages of 200 by due order, grading removes a card. */
function longQueue(n: number) {
  const base = createMockApi();
  const due: ReviewQueueItem[] = Array.from({ length: n }, (_, i) => ({
    id: 5000 + i,
    cardKey: `js/long-${i}`,
    kind: 'card',
    unitId: 101,
    competencyId: 'language-fluency',
    dueAt: NOW - (n - i) * 1000,
  }));
  // the Review page's own fetches (the nav badge in AppShell asks with limit 1 on every route)
  const fetches: number[] = [];
  const api: BootQuestApi = {
    ...base,
    getReviewQueue: async (limit) => {
      if (limit === undefined) fetches.push(due.length);
      return { count: due.length, items: due.slice(0, limit ?? PAGE) };
    },
    gradeReview: async (itemId, grade): Promise<GradeResponse> => {
      const at = due.findIndex((c) => c.id === itemId);
      if (at === -1) throw new Error(`card ${itemId} graded twice or never served`);
      const [c] = due.splice(at, 1);
      return { itemId, grade, prevDueAt: c!.dueAt, nextDueAt: NOW + 86_400_000, xp: { id: itemId, amount: 1, reason: null }, demotion: null, remainingDue: due.length };
    },
  };
  return { api, fetches, left: () => due.length };
}

describe('Review paging past the 200-card page (BUG-2)', () => {
  it('grades 250 due cards in one session; "Queue cleared" only after the last one', { timeout: 120_000 }, async () => {
    const q = longQueue(250);
    const { user } = renderApp('/review', q.api);
    await screen.findByRole('button', { name: /Show answer/ });
    const progress = () => document.querySelector('.review-progress')!.textContent!;
    expect(progress()).toContain('Card 1 of 250');
    for (let i = 0; i < 250; i++) {
      await user.keyboard(' ');
      await user.keyboard('3');
      if (i < 249) {
        // the next card (the 201st arrives from the second page) and never an early done panel
        await screen.findByText(String(i + 2), { selector: '.review-progress strong' });
        expect(screen.queryByText('Queue cleared')).toBeNull();
        expect(screen.queryByText('Session done')).toBeNull();
      }
      if (i === 199) expect(progress()).toContain('Card 201 of 250');
    }
    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent('Queue cleared');
    expect(done).toHaveTextContent('250 cards · +250 XP');
    expect(within(done).getByTestId('next-due')).toBeInTheDocument();
    expect(q.left()).toBe(0);
    expect(q.fetches).toEqual([250, 50]); // the first page, then ONE refetch for the rest (no offset)
  });

  it('cards due again at the end (graded Again, short step) end as "Session done" + a button that reviews them; then "Queue cleared"', async () => {
    const q = longQueue(2);
    let again = 0; // the first card comes back due once (an Again card after its learning step)
    const returning: ReviewQueueItem[] = []; // due again after its step: listed by the next fetch
    const backlog: ReviewQueueItem[] = []; // listed and still due
    const api: BootQuestApi = {
      ...q.api,
      gradeReview: async (id, g) => {
        const back = backlog.findIndex((c) => c.id === id);
        if (back !== -1) backlog.splice(back, 1); // the returning card graded again: it leaves the due set
        const r = back !== -1 ? { itemId: id, grade: g, prevDueAt: NOW, nextDueAt: NOW + 86_400_000, xp: { id, amount: 1, reason: null }, demotion: null, remainingDue: 0 } : await q.api.gradeReview(id, g);
        if (id === 5000 && again === 0) {
          again++;
          returning.push({ id: 5000, cardKey: 'js/long-0', kind: 'card', unitId: 101, competencyId: 'language-fluency', dueAt: NOW });
        }
        return { ...r, remainingDue: q.left() + returning.length + backlog.length };
      },
      getReviewQueue: async (limit) => {
        const r = await q.api.getReviewQueue(limit);
        backlog.push(...returning.splice(0));
        return { count: r.count + backlog.length, items: [...r.items, ...backlog] };
      },
    };
    const { user } = renderApp('/review', api);
    await screen.findByRole('button', { name: /Show answer/ });
    for (let i = 0; i < 2; i++) {
      await user.keyboard(' ');
      await user.keyboard(i === 0 ? '1' : '3');
    }
    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent('Session done');
    expect(done).not.toHaveTextContent('Queue cleared');
    expect(within(done).getByTestId('still-due')).toHaveTextContent('1 card is still due');
    await user.click(within(done).getByRole('button', { name: 'Review the 1 due' }));
    await screen.findByText('3', { selector: '.review-progress strong' });
    await user.keyboard(' ');
    await user.keyboard('3');
    expect(await screen.findByRole('status')).toHaveTextContent('Queue cleared');
  });

  it('a refetch that brings back only cards the server refused (NOT_DUE) stops: "Session done", no loop, no button', async () => {
    const base = createMockApi();
    const items = (await base.getReviewQueue()).items.slice(0, 2);
    let calls = 0;
    const api: BootQuestApi = {
      ...base,
      // a page cut short (count 5 > 2 items) whose cards the server then refuses to grade
      getReviewQueue: async (limit) => {
        if (limit === undefined) calls++;
        return { count: 5, items: items.slice(0, limit ?? 2) };
      },
      gradeReview: async (id) => {
        throw new ApiError(409, 'NOT_DUE', `review item ${id} is not due`);
      },
    };
    const { user } = renderApp('/review', api);
    await screen.findByRole('button', { name: /Show answer/ });
    for (let i = 0; i < 2; i++) {
      await user.keyboard(' ');
      await user.keyboard('3');
    }
    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent('Session done');
    expect(done).not.toHaveTextContent('Queue cleared');
    expect(within(done).getByTestId('still-due')).toHaveTextContent('5 cards are still due, but the server would not take a grade');
    expect(within(done).queryByRole('button', { name: /Review the/ })).toBeNull();
    expect(calls).toBe(2);
  });

  it('a failed refetch says so and retries on request', async () => {
    const q = longQueue(3);
    let fail = true;
    const api: BootQuestApi = {
      ...q.api,
      getReviewQueue: async (limit) => {
        const r = await q.api.getReviewQueue(limit);
        if (limit !== undefined) return r; // the nav badge
        if (q.fetches.length === 1) return { count: r.count, items: r.items.slice(0, 2) }; // first page cut short
        if (fail) {
          fail = false;
          throw new Error('offline');
        }
        return r;
      },
    };
    const { user } = renderApp('/review', api);
    await screen.findByRole('button', { name: /Show answer/ });
    for (let i = 0; i < 2; i++) {
      await user.keyboard(' ');
      await user.keyboard('3');
    }
    const retry = await screen.findByRole('button', { name: 'Load the next cards' });
    expect(screen.queryByText('Queue cleared')).toBeNull();
    await user.click(retry);
    await screen.findByText('3', { selector: '.review-progress strong' });
    await user.keyboard(' ');
    await user.keyboard('3');
    expect(await screen.findByRole('status')).toHaveTextContent('Queue cleared');
  });
});
