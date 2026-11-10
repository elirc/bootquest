import { describe, expect, it } from 'vitest';
import type { FundamentalsResponse, FundTopicDto, UnitSummary } from '../api/types';
import { fundStepLabel, fundTrackOf, pickFundNext } from './nextstep';

function unit(id: number, key: string, over: Partial<UnitSummary> = {}): UnitSummary {
  return { id, key, trackId: 'js', kind: key.startsWith('fund/') ? 'study' : 'drill', title: `Unit ${id}`, difficulty: 1, state: 'available', revealed: false, prerequisites: [], ...over };
}

function topic(order: number, slug: string, gate: Partial<UnitSummary>, drills: Partial<UnitSummary>[]): FundTopicDto {
  const id = `${String(order).padStart(2, '0')}-${slug}`;
  return {
    id,
    order,
    title: `Topic ${order}`,
    level: 'beginner',
    summary: '',
    quizQuestions: 10,
    passPct: 80,
    flashcards: 8,
    unit: unit(order * 100, `fund/js/${id}`, gate),
    drills: drills.map((d, i) => unit(order * 100 + i + 1, `fund-js/${id}/d${i + 1}`, { title: `Drill ${order}.${i + 1}`, ...d })),
  };
}

const ladder = (...topics: FundTopicDto[]): FundamentalsResponse => ({ trackId: 'js', topics });

describe('fundTrackOf', () => {
  it('reads the track of a topic key and of a drill key, and nothing else', () => {
    expect(fundTrackOf('fund/js/01-values')).toBe('js');
    expect(fundTrackOf('fund-csharp/02-types/01-sum')).toBe('csharp');
    expect(fundTrackOf('fund-java/02-types/01-sum')).toBe('java');
    expect(fundTrackOf('bootforge/js-fundamentals/values/quiz')).toBeNull();
    expect(fundTrackOf('fundamentals/js/x')).toBeNull();
  });
});

describe('pickFundNext (U4 / U5)', () => {
  it('after drill 1 with the gate passed: drill 2 of the same topic', () => {
    const l = ladder(topic(1, 'a', { state: 'done' }, [{}, {}]), topic(2, 'b', {}, [{}]));
    const next = pickFundNext(l, l.topics[0]!.drills[0]!);
    expect(next.primary).toMatchObject({ kind: 'drill', unit: { id: 102 } });
    expect(next.nextTopic).toMatchObject({ kind: 'topic', unit: { id: 200 } });
  });

  it('the quiz gate comes first while it is not passed', () => {
    const l = ladder(topic(1, 'a', {}, [{}, {}]), topic(2, 'b', { state: 'locked' }, []));
    const next = pickFundNext(l, l.topics[0]!.drills[0]!);
    expect(next.primary).toMatchObject({ kind: 'gate', unit: { id: 100 } });
    // the next topic is locked behind this gate: nothing to offer beside it
    expect(next.nextTopic).toBeNull();
  });

  it('after the last drill: the next topic; done, locked and revealed drills are skipped', () => {
    const l = ladder(topic(1, 'a', { state: 'done' }, [{ state: 'done' }, { revealed: true }, { state: 'locked' }, {}]), topic(2, 'b', {}, []));
    const next = pickFundNext(l, l.topics[0]!.drills[3]!);
    expect(next.primary).toMatchObject({ kind: 'topic', unit: { id: 200 } });
    expect(next.nextTopic).toBeNull();
  });

  it('an earlier open drill is offered once the later ones are done', () => {
    const l = ladder(topic(1, 'a', { state: 'done' }, [{}, {}, { state: 'done' }]));
    expect(pickFundNext(l, l.topics[0]!.drills[1]!).primary).toMatchObject({ kind: 'drill', unit: { id: 101 } });
  });

  it('after a passed gate: practise the first open drill, with the next topic as the second link', () => {
    // the payload may predate the pass: the gate reads "available" and topic 2 "locked"
    const l = ladder(topic(1, 'a', {}, [{}, {}]), topic(2, 'b', { state: 'locked' }, []));
    const next = pickFundNext(l, l.topics[0]!.unit);
    expect(next.primary).toMatchObject({ kind: 'drill', unit: { id: 101 } });
    expect(next.nextTopic).toMatchObject({ kind: 'topic', unit: { id: 200 } });
    expect(fundStepLabel(next.primary!)).toEqual({ lead: 'Practise', title: 'Drill 1.1' });
    expect(fundStepLabel(next.nextTopic!)).toEqual({ lead: 'Next topic', title: '02 Topic 2' });
  });

  it('a topic without drills goes straight to the next topic; a finished ladder offers nothing', () => {
    const l = ladder(topic(1, 'a', {}, []), topic(2, 'b', { state: 'locked' }, []));
    expect(pickFundNext(l, l.topics[0]!.unit)).toMatchObject({ primary: { kind: 'topic', unit: { id: 200 } }, nextTopic: null });
    const done = ladder(topic(1, 'a', { state: 'done' }, [{ state: 'done' }]), topic(2, 'b', { state: 'done' }, []));
    expect(pickFundNext(done, done.topics[1]!.unit)).toEqual({ primary: null, nextTopic: null });
  });

  it('a unit that is not on this ladder gets nothing (the caller falls back to Next up)', () => {
    const l = ladder(topic(1, 'a', {}, [{}]));
    expect(pickFundNext(l, { id: 5, key: 'bootforge/x/y' })).toEqual({ primary: null, nextTopic: null });
    expect(pickFundNext(l, { id: 5, key: 'fund-js/09-gone/01-x' })).toEqual({ primary: null, nextTopic: null });
  });
});
