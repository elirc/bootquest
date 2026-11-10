// f52 wave B (app ruling 3): a topic is COMPLETE on gate + one own drill passed (gate alone without
// drills); progress reads "3 complete · 5 gates passed" on the Campaign card and in the dashboard
// hero's context; the hero and lib/nextstep.ts share one drillOpen rule (a revealed, unpassed drill
// is never a next step).
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, Dashboard, FundTopicDto, FundamentalsResponse, UnitSummary } from '../api/types';
import { pickFundNext } from '../lib/nextstep';
import { renderApp } from '../test/render';
import { fundamentalsStep, pickHero } from './Dashboard';

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
const topic = (order: number, gate: UnitSummary['state'], drills: Partial<UnitSummary>[] = []): FundTopicDto => {
  const id = `${String(order).padStart(2, '0')}-topic`;
  return {
    id,
    order,
    title: `Topic ${order} title`,
    level: 'beginner',
    summary: `Summary ${order}`,
    quizQuestions: 10,
    passPct: 80,
    flashcards: 8,
    unit: unit(order * 100, gate, { key: `fund/js/${id}` }),
    drills: drills.map((d, i) => unit(order * 100 + i + 1, 'available', { kind: 'drill', key: `fund-js/${id}/d${i + 1}`, title: `Drill ${order}.${i + 1}`, ...d })),
  };
};
const ladder = (...topics: FundTopicDto[]): FundamentalsResponse => ({ trackId: 'js', topics });

// 1 complete with a drill, 2 complete without drills, 3 + 4 gate only, 5 open, 6 locked
const MIXED = ladder(
  topic(1, 'done', [{ state: 'done' }, {}]),
  topic(2, 'done'),
  topic(3, 'done', [{}, {}]),
  topic(4, 'done', [{ revealed: true }]),
  topic(5, 'available', [{}]),
  topic(6, 'locked'),
);

describe('the shared drillOpen rule (dashboard hero and nextstep)', () => {
  it('the hero offers the first OPEN drill of the first unfinished topic: done, revealed and locked drills are skipped', () => {
    // topic 1: drill 1 done, drill 2 open -> that drill
    expect(fundamentalsStep(MIXED)).toMatchObject({ kind: 'drill', unitId: 102, order: 1, drill: { at: 2, of: 2 } });
    // a revealed, unpassed drill is never the step: the next open one is
    const revealedFirst = ladder(topic(1, 'done', [{ revealed: true }, { state: 'locked' }, {}]), topic(2, 'available'));
    expect(fundamentalsStep(revealedFirst)).toMatchObject({ kind: 'drill', unitId: 103, drill: { at: 3, of: 3 } });
    // nothing open in the topic: on to the next topic's gate
    const onlyRevealed = ladder(topic(1, 'done', [{ revealed: true }]), topic(2, 'available'));
    expect(fundamentalsStep(onlyRevealed)).toMatchObject({ kind: 'topic', unitId: 200, order: 2 });
  });

  it('nextstep agrees on the same ladders', () => {
    const revealedFirst = ladder(topic(1, 'done', [{ revealed: true }, { state: 'locked' }, {}]), topic(2, 'available'));
    expect(pickFundNext(revealedFirst, revealedFirst.topics[0]!.unit).primary).toMatchObject({ kind: 'drill', unit: { id: 103 } });
    const onlyRevealed = ladder(topic(1, 'done', [{ revealed: true }]), topic(2, 'available'));
    expect(pickFundNext(onlyRevealed, onlyRevealed.topics[0]!.unit).primary).toMatchObject({ kind: 'topic', unit: { id: 200 } });
  });

  it('the step carries the ladder progress, and the hero context reads "N complete · M gates passed"', async () => {
    const step = fundamentalsStep(MIXED)!;
    expect(step.progress).toEqual({ complete: 2, gates: 4, total: 6 });
    const d: Dashboard = { ...(await createMockApi().getDashboard()), reviewQueue: { due: 0 } };
    expect(pickHero(d, step).context).toContain('Fundamentals · JS/TS · Topic 1 of 6 · drill 2 of 2');
    expect(pickHero(d, step).context).toContain('2 complete · 4 gates passed');
    // nothing passed yet: no progress noise
    const fresh = fundamentalsStep(ladder(topic(1, 'available'), topic(2, 'locked')))!;
    expect(pickHero(d, fresh).context).not.toContain('gates passed');
  });
});

describe('Campaign Fundamentals card', () => {
  const api = (l: FundamentalsResponse): BootQuestApi => ({ ...createMockApi(), getFundamentals: async () => l });

  it('progress reads "2 complete · 4 gates passed"; the bar counts complete topics', async () => {
    renderApp('/campaign/js', api(MIXED));
    const section = await screen.findByTestId('fundamentals');
    expect(within(section).getByTestId('fund-progress')).toHaveTextContent('2 complete · 4 gates passed · 6 topics');
    const bar = within(section).getByRole('progressbar', { name: 'Fundamentals topics complete' });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '6');
    // gates passed is what decides Start / Continue, and the open topic is the target
    expect(within(section).getByTestId('fund-continue')).toHaveTextContent('Continue: 05 Topic 5 title');
  });

  it('a topic row says "complete" or "gate passed"', async () => {
    localStorage.setItem('bootquest:fund-expanded', '1');
    renderApp('/campaign/js', api(MIXED));
    const section = await screen.findByTestId('fundamentals');
    const row = (id: string) => section.querySelector<HTMLElement>(`[data-topic="${id}"]`)!;
    expect(within(row('01-topic')).getByText('complete')).toBeInTheDocument();
    expect(within(row('02-topic')).getByText('complete')).toBeInTheDocument();
    expect(within(row('03-topic')).getByText('gate passed')).toBeInTheDocument();
    expect(within(row('03-topic')).queryByText('complete')).toBeNull();
    expect(within(row('04-topic')).getByText('gate passed')).toBeInTheDocument();
    expect(within(row('05-topic')).queryByText(/complete|gate passed/)).toBeNull();
  });

  it('the hero on the dashboard shows the same progress text', async () => {
    const base = createMockApi();
    renderApp('/', { ...base, getFundamentals: async () => MIXED, getDashboard: async () => ({ ...(await base.getDashboard()), reviewQueue: { due: 0 } }) });
    const go = await screen.findByTestId('hero-go', {}, { timeout: 15_000 });
    expect(go).toHaveAttribute('href', '/play/102');
    expect(screen.getByTestId('hero-context')).toHaveTextContent('2 complete · 4 gates passed');
  });
});
