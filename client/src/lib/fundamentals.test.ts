// f52 wave B: ladder helpers (app rulings 3 and 5) and the static estimates (ruling 6).
import { describe, expect, it } from 'vitest';
import type { UnitSummary } from '../api/types';
import { drillMinutes, fmtMinutes, fmtSeconds, reviewEstimate } from './estimates';
import { drillOpen, fundPlace, fundProgress, fundProgressText, gatePassed, orderRelated, topicComplete } from './fundamentals';

const u = (id: number, state: UnitSummary['state'], over: Partial<UnitSummary> = {}): UnitSummary => ({
  id,
  key: `k/${id}`,
  trackId: 'js',
  kind: 'drill',
  title: `Unit ${id}`,
  difficulty: 1,
  state,
  revealed: false,
  prerequisites: [],
  ...over,
});
const topic = (id: string, gate: UnitSummary['state'], drills: UnitSummary[] = []) => ({ id, unit: u(1, gate), drills });

describe('drillOpen (the one "is this drill a next step" rule)', () => {
  it('open and untouched only: never done, locked, or revealed', () => {
    expect(drillOpen(u(1, 'available'))).toBe(true);
    expect(drillOpen(u(1, 'done'))).toBe(false);
    expect(drillOpen(u(1, 'locked'))).toBe(false);
    expect(drillOpen(u(1, 'available', { revealed: true }))).toBe(false);
    expect(drillOpen(u(1, 'done', { revealed: true }))).toBe(false);
  });
});

describe('topicComplete (ruling 3)', () => {
  it('gate + at least one own drill passed; the gate alone when the topic has no drill', () => {
    expect(topicComplete(topic('01-a', 'done', []))).toBe(true);
    expect(topicComplete(topic('01-a', 'available', []))).toBe(false);
    expect(topicComplete(topic('01-a', 'done', [u(2, 'available'), u(3, 'available')]))).toBe(false);
    expect(topicComplete(topic('01-a', 'done', [u(2, 'available'), u(3, 'done')]))).toBe(true);
    // a drill passed before the gate does not complete the topic
    expect(topicComplete(topic('01-a', 'available', [u(2, 'done')]))).toBe(false);
    expect(gatePassed(topic('01-a', 'done', [u(2, 'available')]))).toBe(true);
  });

  it('progress counts both, and reads "3 complete · 5 gates passed"', () => {
    const topics = [
      topic('01-a', 'done', [u(2, 'done')]),
      topic('02-b', 'done', []),
      topic('03-c', 'done', [u(3, 'done'), u(4, 'available')]),
      topic('04-d', 'done', [u(5, 'available')]),
      topic('05-e', 'done', [u(6, 'available', { revealed: true })]),
      topic('06-f', 'available', [u(7, 'available')]),
      topic('07-g', 'locked', []),
    ];
    expect(fundProgress(topics)).toEqual({ complete: 3, gates: 5, total: 7 });
    expect(fundProgressText(fundProgress(topics))).toBe('3 complete · 5 gates passed');
    expect(fundProgressText({ complete: 0, gates: 1 })).toBe('0 complete · 1 gate passed');
    expect(fundProgressText(fundProgress([]))).toBe('0 complete · 0 gates passed');
  });
});

describe('fundPlace', () => {
  const ladder = { topics: [topic('01-a', 'done'), topic('02-b', 'available'), topic('03-c', 'locked')] };
  it('finds the topic of a topic key and of a drill key, with its position and the next topic', () => {
    expect(fundPlace(ladder, 'fund/js/02-b')).toMatchObject({ index: 1, total: 3, topic: { id: '02-b' }, next: { id: '03-c' } });
    expect(fundPlace(ladder, 'fund-js/03-c/01-x')).toMatchObject({ index: 2, total: 3, next: null });
    expect(fundPlace(ladder, 'fund/js/09-gone')).toBeNull();
    expect(fundPlace(ladder, 'bootforge/x')).toBeNull();
  });
});

describe('orderRelated (ruling 5)', () => {
  it('undone first, then difficulty ascending (unrated last); ties keep the given order', () => {
    const related = [
      u(1, 'done', { difficulty: 1 }),
      u(2, 'available', { difficulty: 3 }),
      u(3, 'available', { difficulty: null }),
      u(4, 'available', { difficulty: 1 }),
      u(5, 'locked', { difficulty: 2 }),
      u(6, 'done', { difficulty: null }),
      u(7, 'available', { difficulty: 1 }),
      u(8, 'done', { difficulty: 2 }),
    ];
    expect(orderRelated(related).map((x) => x.id)).toEqual([4, 7, 5, 2, 3, 1, 8, 6]);
    // pure: the input is not reordered
    expect(related.map((x) => x.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(orderRelated([])).toEqual([]);
  });
});

describe('static estimates (ruling 6)', () => {
  it('a drill is 5 / 10 / 15 minutes by difficulty', () => {
    expect([1, 2, 3, 4, 5].map(drillMinutes)).toEqual([5, 10, 15, 15, 15]);
    expect(drillMinutes(0)).toBe(5);
    expect(drillMinutes(null)).toBe(10);
    expect(fmtMinutes(10)).toBe('≈10 min');
  });

  it('reviews are 10 seconds a card: seconds under a minute, then whole minutes rounded up', () => {
    expect(reviewEstimate(1)).toBe('≈10 s');
    expect(reviewEstimate(5)).toBe('≈50 s');
    expect(reviewEstimate(6)).toBe('≈1 min');
    expect(reviewEstimate(7)).toBe('≈2 min');
    expect(reviewEstimate(30)).toBe('≈5 min');
    expect(fmtSeconds(59)).toBe('≈59 s');
  });
});
