// f52 wave B (app ruling 6): session shape on the dashboard — static time estimates in the hero
// context, the "Done for today" hero state (rv wave C: only on a complete slate), and "12 / 20 XP today" on the streak
// tile until the streak is safe.
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, Dashboard, FundTopicDto, FundamentalsResponse, UnitSummary } from '../api/types';
import { renderApp } from '../test/render';
import { DONE_XP, doneForToday, fundamentalsStep, pickHero, xpTodayOf } from './Dashboard';

const unit = (id: number, state: UnitSummary['state'], over: Partial<UnitSummary> = {}): UnitSummary => ({
  id,
  key: `fund/js/${String(id).padStart(2, '0')}-t`,
  trackId: 'js',
  kind: 'study',
  title: `Unit ${id}`,
  difficulty: 1,
  state,
  revealed: false,
  prerequisites: [],
  ...over,
});
const topic = (order: number, gate: UnitSummary['state'], drillDifficulty: (number | null)[] = []): FundTopicDto => ({
  id: `${String(order).padStart(2, '0')}-topic`,
  order,
  title: `Topic ${order} title`,
  level: 'beginner',
  summary: '',
  quizQuestions: 10,
  passPct: 80,
  flashcards: 8,
  unit: unit(order * 100, gate),
  drills: drillDifficulty.map((difficulty, i) => unit(order * 100 + i + 1, 'available', { kind: 'drill', key: `fund-js/x/${order}-${i}`, title: `Drill ${order}.${i + 1}`, difficulty })),
});
const ladder = (...topics: FundTopicDto[]): FundamentalsResponse => ({ trackId: 'js', topics });

/** the mock dashboard with today's XP, the review count and the slate flag set */
async function dash(o: { xp?: number; due?: number; complete?: boolean; allSlateDone?: boolean } = {}): Promise<Dashboard> {
  const d = await createMockApi().getDashboard();
  return {
    ...d,
    reviewQueue: { due: o.due ?? 0 },
    streak: { ...d.streak, todayComplete: o.complete ?? false },
    heatmap: d.heatmap.map((h) => (h.day === d.today ? { ...h, xp: o.xp ?? 0 } : h)),
    slate: o.allSlateDone ? { ...d.slate, items: d.slate.items.map((s) => ({ ...s, done: true })) } : d.slate,
  };
}
const apiWith = (d: Dashboard, fund?: FundamentalsResponse): BootQuestApi => ({
  ...createMockApi(),
  getDashboard: async () => d,
  ...(fund ? { getFundamentals: async () => fund } : {}),
});
const heroReady = () => screen.findByTestId('hero-go', {}, { timeout: 15_000 });

describe('static estimates in the hero context', () => {
  it('reviews: about 10 seconds a card', async () => {
    expect(pickHero(await dash({ due: 4 }), null).context).toBe('Reviews first: these cards are due today · ≈40 s');
    expect(pickHero(await dash({ due: 30 }), null).context).toBe('Reviews first: these cards are due today · ≈5 min');
  });

  it('a Fundamentals topic is about 10 minutes; a drill 5 / 10 / 15 by difficulty', async () => {
    const d = await dash();
    const topicStep = fundamentalsStep(ladder(topic(1, 'available'), topic(2, 'locked')))!;
    expect(topicStep.minutes).toBe(10);
    expect(pickHero(d, topicStep).context).toBe('Fundamentals · JS/TS · Topic 1 of 2 · ≈10 min');
    for (const [difficulty, min] of [[1, 5], [2, 10], [3, 15], [null, 10]] as const) {
      const step = fundamentalsStep(ladder(topic(1, 'done', [difficulty]), topic(2, 'available')))!;
      expect(step.minutes).toBe(min);
      expect(pickHero(d, step).context).toBe(`Fundamentals · JS/TS · Topic 1 of 2 · drill 1 of 1 · ≈${min} min · 0 complete · 1 gate passed`);
    }
  });

  it('slate and Next-up steps carry no invented estimate', async () => {
    expect(pickHero(await dash(), null).context).not.toContain('≈');
  });
});

describe('doneForToday', () => {
  it("rv wave C (R4-05): exactly the streak rule — today's slate complete (server todayComplete); XP alone never", async () => {
    expect(DONE_XP).toBe(50); // the pre-rv number, kept for imports; it decides nothing now
    expect(doneForToday(await dash({ xp: 50 }))).toBe(false);
    expect(doneForToday(await dash({ xp: 500 }))).toBe(false);
    expect(doneForToday(await dash({ xp: 0, complete: true }))).toBe(true);
    expect(doneForToday(await dash({ xp: 0, allSlateDone: true }))).toBe(false); // only the server's todayComplete counts
    expect(doneForToday(await dash({ xp: 500, complete: true, due: 1 }))).toBe(true); // the streak tile says the same
    expect(xpTodayOf(await dash({ xp: 37 }))).toBe(37);
  });
});

describe('the hero when the day is done', () => {
  it('says "Done for today ✓ · the streak grows" and keeps the next step as a secondary button', async () => {
    renderApp('/', apiWith(await dash({ xp: 60, complete: true })));
    const go = await heroReady();
    const box = screen.getByTestId('dash-hero');
    expect(box).toHaveAttribute('data-done', 'true');
    expect(within(box).getByTestId('hero-done')).toHaveTextContent('Done for today ✓ · the streak grows');
    expect(within(box).getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    // the next step is still there (Fundamentals topic 1 in the mock), but no longer the primary button
    expect(box).toHaveAttribute('data-kind', 'fundamentals');
    expect(go).toHaveAttribute('href', '/play/207');
    expect(go).toHaveClass('btn');
    expect(go).not.toHaveClass('btn-primary');
    expect(screen.getByTestId('hero-context')).toHaveTextContent('≈10 min');
  });

  it('not done: the usual primary "Next step" button, no done line', async () => {
    renderApp('/', apiWith(await dash({ xp: 49 })));
    const go = await heroReady();
    const box = screen.getByTestId('dash-hero');
    expect(box).toHaveAttribute('data-done', 'false');
    expect(within(box).queryByTestId('hero-done')).toBeNull();
    expect(within(box).getByRole('heading', { name: 'Next step' })).toBeInTheDocument();
    expect(go).toHaveClass('btn-primary');
  });

  it('reviews due on an incomplete day: not done, whatever the XP; reviews first', async () => {
    renderApp('/', apiWith(await dash({ xp: 300, due: 2 })));
    const go = await heroReady();
    expect(go).toHaveAttribute('href', '/review');
    expect(go).toHaveClass('btn-primary');
    expect(screen.queryByTestId('hero-done')).toBeNull();
    expect(screen.getByTestId('hero-context')).toHaveTextContent('≈20 s');
  });
});

describe('the streak tile until the streak is safe', () => {
  const tile = () => document.querySelector<HTMLElement>('section[aria-labelledby="t-streak"]')!;

  it('"12 / 20 XP today" below 20 XP with an open slate', async () => {
    renderApp('/', apiWith(await dash({ xp: 12 })));
    await heroReady();
    expect(within(tile()).getByTestId('streak-progress')).toHaveTextContent('12 / 20 XP today');
    expect(within(tile()).queryByTestId('streak-safe')).toBeNull();
  });

  it('at 20 XP the streak is kept (not grown); with the slate complete the day counts', async () => {
    const a = renderApp('/', apiWith(await dash({ xp: 20 })));
    await heroReady();
    expect(within(tile()).getByTestId('streak-kept')).toBeInTheDocument();
    expect(within(tile()).queryByTestId('streak-safe')).toBeNull();
    expect(within(tile()).queryByTestId('streak-progress')).toBeNull();
    a.unmount();
    renderApp('/', apiWith(await dash({ xp: 0, complete: true })));
    await heroReady();
    expect(within(tile()).getByTestId('streak-safe')).toBeInTheDocument();
    expect(within(tile()).queryByTestId('streak-progress')).toBeNull();
  });
});
