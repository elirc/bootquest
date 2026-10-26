import { describe, expect, it } from 'vitest';
import type { UnitKind, UnitSummary } from '../api/types';
import { NO_FILTER, SECTION_LABEL, groupLabelOf, groupTotals, groupUnits, sectionCounts, sectionOf, type UnitFilter } from './trackunits';

let nextId = 9000;
function unit(over: Partial<UnitSummary> = {}): UnitSummary {
  const id = over.id ?? nextId++;
  return {
    id,
    key: `misc/${id}`,
    trackId: 'sysdesign',
    kind: 'drill',
    title: `Unit ${id}`,
    difficulty: null,
    state: 'available',
    revealed: false,
    prerequisites: [],
    ...over,
  };
}

const filter = (over: Partial<UnitFilter> = {}): UnitFilter => ({ ...NO_FILTER, ...over });

describe('sectionOf', () => {
  it('buckets every unit kind', () => {
    const all: Record<UnitKind, string> = {
      drill: 'drill',
      'explain-back': 'explain-back',
      quiz: 'other',
      'predict-output': 'other',
      'guided-project': 'other',
      'http-lab': 'other',
      'repo-task': 'other',
      study: 'other',
      reading: 'other',
      'patch-kata': 'other',
      review: 'other',
      'program-unit': 'other',
      retest: 'other',
      written: 'other',
    };
    for (const [kind, section] of Object.entries(all)) expect(sectionOf(kind as UnitKind), kind).toBe(section);
  });

  it('labels each section', () => {
    expect(SECTION_LABEL).toEqual({ drill: 'Drills', 'explain-back': 'Explain-backs', other: 'Other' });
  });
});

describe('groupLabelOf', () => {
  it('ladder keys group by repo (third segment)', () => {
    expect(groupLabelOf({ key: 'ladder/explain-back/bazaar/abc123', kind: 'explain-back' })).toBe('bazaar');
    expect(groupLabelOf({ key: 'ladder/explain-back/opusorganize/b10x', kind: 'explain-back' })).toBe('opusorganize');
  });

  it('a ladder key with no repo segment falls back to the kind label', () => {
    expect(groupLabelOf({ key: 'ladder/explain-back', kind: 'explain-back' })).toBe('Explain-backs');
    expect(groupLabelOf({ key: 'ladder/explain-back//x', kind: 'explain-back' })).toBe('Explain-backs');
  });

  it('module keys group by the prettified second segment', () => {
    expect(groupLabelOf({ key: 'sysdrills/01-estimation/01-qps', kind: 'drill' })).toBe('estimation');
    expect(groupLabelOf({ key: 'bootforge/js-fundamentals/values/q1', kind: 'drill' })).toBe('js fundamentals');
    expect(groupLabelOf({ key: 'jstrain/03_async_flow/p2', kind: 'drill' })).toBe('async flow');
    expect(groupLabelOf({ key: 'sysdrills/07/x', kind: 'drill' })).toBe('Drills'); // nothing left after the ordinal
  });

  it('gh: keys group by repo name', () => {
    expect(groupLabelOf({ key: 'gh:elirc/signalpost-swe-bootcamp:U01', kind: 'program-unit' })).toBe('signalpost-swe-bootcamp');
  });

  it('short keys fall back to the kind label', () => {
    expect(groupLabelOf({ key: 'js/m01-m04', kind: 'drill' })).toBe('Drills');
    expect(groupLabelOf({ key: 'agentic/harness-u01', kind: 'program-unit' })).toBe('Other');
    expect(groupLabelOf({ key: 'solo', kind: 'explain-back' })).toBe('Explain-backs');
  });
});

const units = [
  unit({ id: 1, key: 'ladder/explain-back/zeta/h1', kind: 'explain-back', title: 'Explain back: zeta — a', state: 'done' }),
  unit({ id: 2, key: 'sysdrills/02-caching/01-ttl', kind: 'drill', title: 'TTL math', difficulty: 2 }),
  unit({ id: 3, key: 'ladder/explain-back/bazaar/h2', kind: 'explain-back', title: 'DESIGN IT: bazaar — cache coherence across layers for a storefront' }),
  unit({ id: 4, key: 'sysdrills/02-caching/02-hit', kind: 'drill', title: 'Hit ratio', state: 'done' }),
  unit({ id: 5, key: 'ladder/explain-back/bazaar/h3', kind: 'explain-back', title: 'DESIGN IT: bazaar — personalized pricing (set B)', state: 'locked' }),
  unit({ id: 6, key: 'agentic/harness-u01', kind: 'program-unit', title: 'Agent harness U01' }),
];

/** A 136-unit track: 78 drills in 10 modules (20 done) + 58 EBs over 29 repos (12 done). */
function bigTrack(): UnitSummary[] {
  const big: UnitSummary[] = [];
  for (let i = 0; i < 78; i++) {
    const m = i % 10;
    big.push(
      unit({
        key: `sysdrills/${String(m + 1).padStart(2, '0')}-module-${m}/${String(i).padStart(2, '0')}-drill`,
        kind: 'drill',
        title: `Drill ${i}`,
        difficulty: 1 + (i % 3),
        state: i % 4 === 0 ? 'done' : 'available',
      }),
    );
  }
  for (let i = 0; i < 58; i++) {
    const r = i % 29;
    big.push(
      unit({
        key: `ladder/explain-back/repo-${String(r).padStart(2, '0')}/h${i}`,
        kind: 'explain-back',
        title: `DESIGN IT: repo-${r} — topic ${i}${i >= 29 ? ' (set B)' : ''}`,
        state: i % 5 === 0 ? 'done' : i % 7 === 0 ? 'locked' : 'available',
      }),
    );
  }
  return big;
}

describe('groupUnits', () => {
  it('groups by label, sorted, keeping served unit order and counting done', () => {
    const groups = groupUnits(units, NO_FILTER);
    expect(groups.map((g) => g.label)).toEqual(['bazaar', 'caching', 'Other', 'zeta']);
    expect(groups.map((g) => g.units.map((u) => u.id))).toEqual([[3, 5], [2, 4], [6], [1]]);
    expect(groups.map((g) => g.done)).toEqual([0, 1, 0, 1]);
  });

  it('filters by section', () => {
    expect(groupUnits(units, filter({ section: 'drill' })).map((g) => g.label)).toEqual(['caching']);
    expect(groupUnits(units, filter({ section: 'explain-back' })).map((g) => g.label)).toEqual(['bazaar', 'zeta']);
    expect(groupUnits(units, filter({ section: 'other' })).flatMap((g) => g.units.map((u) => u.id))).toEqual([6]);
  });

  it('hides done units (and the groups they empty)', () => {
    const groups = groupUnits(units, filter({ hideDone: true }));
    expect(groups.map((g) => g.label)).toEqual(['bazaar', 'caching', 'Other']);
    expect(groups.flatMap((g) => g.units).some((u) => u.state === 'done')).toBe(false);
    expect(groups.every((g) => g.done === 0)).toBe(true);
  });

  it('query matches title, group label or key, case-insensitively, trimmed', () => {
    expect(groupUnits(units, filter({ query: '  BAZAAR ' })).flatMap((g) => g.units.map((u) => u.id))).toEqual([3, 5]); // label
    expect(groupUnits(units, filter({ query: 'hit ratio' })).flatMap((g) => g.units.map((u) => u.id))).toEqual([4]); // title
    expect(groupUnits(units, filter({ query: '01-ttl' })).flatMap((g) => g.units.map((u) => u.id))).toEqual([2]); // key
    expect(groupUnits(units, filter({ query: 'set b' })).flatMap((g) => g.units.map((u) => u.id))).toEqual([5]);
    expect(groupUnits(units, filter({ query: 'nothing-like-this' }))).toEqual([]);
  });

  it('combines filters', () => {
    const groups = groupUnits(units, filter({ section: 'drill', hideDone: true, query: 'caching' }));
    expect(groups.flatMap((g) => g.units.map((u) => u.id))).toEqual([2]);
  });

  it('empty input -> no groups', () => {
    expect(groupUnits([], NO_FILTER)).toEqual([]);
  });

  it('sectionCounts counts every unit, unfiltered', () => {
    expect(sectionCounts(units)).toEqual({ all: 6, drill: 2, 'explain-back': 3, other: 1 });
  });

  it('a 136-unit track (78 drills in 10 modules + 58 EBs over 29 repos) totals correctly', () => {
    const big = bigTrack();
    expect(sectionCounts(big)).toEqual({ all: 136, drill: 78, 'explain-back': 58, other: 0 });

    const groups = groupUnits(big, NO_FILTER);
    expect(groups).toHaveLength(39);
    expect(groups.reduce((n, g) => n + g.units.length, 0)).toBe(136);
    const drillGroups = groups.filter((g) => g.label.startsWith('module'));
    const ebGroups = groups.filter((g) => g.label.startsWith('repo-'));
    expect(drillGroups).toHaveLength(10);
    expect(ebGroups).toHaveLength(29);
    expect(drillGroups.reduce((n, g) => n + g.units.length, 0)).toBe(78);
    expect(ebGroups.every((g) => g.units.length === 2)).toBe(true);
    const doneTotal = big.filter((u) => u.state === 'done').length;
    expect(groups.reduce((n, g) => n + g.done, 0)).toBe(doneTotal);
    expect(doneTotal).toBe(20 + 12);
    // sorted by label
    const labels = groups.map((g) => g.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en')));

    expect(groupUnits(big, filter({ section: 'drill' })).reduce((n, g) => n + g.units.length, 0)).toBe(78);
    expect(groupUnits(big, filter({ hideDone: true })).reduce((n, g) => n + g.units.length, 0)).toBe(136 - 32);
    const repo3 = groupUnits(big, filter({ query: 'repo-03' }));
    expect(repo3.map((g) => g.label)).toEqual(['repo-03']);
    expect(repo3[0]?.units).toHaveLength(2);
  });
});

describe('groupTotals', () => {
  it('per-group done/total over the unfiltered list, keyed by the groupUnits label', () => {
    const totals = groupTotals(units);
    expect(Object.fromEntries(totals)).toEqual({
      zeta: { done: 1, total: 1 },
      caching: { done: 1, total: 2 },
      bazaar: { done: 0, total: 2 },
      Other: { done: 0, total: 1 },
    });
    // every label a filtered grouping can produce has a total (the page's safe `!`)
    for (const g of groupUnits(units, filter({ hideDone: true, query: 'a' }))) expect(totals.has(g.label), g.label).toBe(true);
  });

  it('sums to the whole track on the 136-unit fixture (136 units, 32 done)', () => {
    const totals = [...groupTotals(bigTrack()).values()];
    expect(totals).toHaveLength(39);
    expect(totals.reduce((n, t) => n + t.total, 0)).toBe(136);
    expect(totals.reduce((n, t) => n + t.done, 0)).toBe(32);
  });

  it('empty input -> no totals', () => {
    expect(groupTotals([]).size).toBe(0);
  });
});
