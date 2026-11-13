import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { KeyedChoices } from './answer-length.ts';
import {
  ANSWER_RANK_BASELINE_FORMAT,
  DEFAULT_ANSWER_RANK_BASELINE,
  DEFAULT_TOPIC_RANK_OPTIONS,
  DEFAULT_TRACK_RANK_OPTIONS,
  fundamentalsRankRows,
  fundamentalsTopicRankRows,
  keyLengthRank,
  rankFails,
  rankReport,
  rankRow,
  readRankBaseline,
  type RankBaseline,
} from './answer-rank.ts';

/** a four-choice item whose key has rank r (r choices strictly longer than the key) */
const atRank = (r: number): KeyedChoices => {
  const lens = [10, 20, 30, 40];
  const keyLen = lens[3 - r]!;
  const choices = lens.map((n, i) => (i === 3 - r ? 'k' : String.fromCharCode(97 + i)).repeat(n));
  return { choices, key: choices.findIndex((c) => c.length === keyLen) };
};
const many = (n: number, item: KeyedChoices) => Array.from({ length: n }, () => item);
const spread = (a: number, b: number, c: number, d: number) => [...many(a, atRank(0)), ...many(b, atRank(1)), ...many(c, atRank(2)), ...many(d, atRank(3))];
const baseline = (entries: RankBaseline['entries']): RankBaseline => ({ format: ANSWER_RANK_BASELINE_FORMAT, entries });

describe('answer-rank lint (rv wave, R1-01)', () => {
  it('ranks the key by the number of strictly longer choices (trimmed); only four-choice items are ranked', () => {
    expect([0, 1, 2, 3].map((r) => keyLengthRank(atRank(r)))).toEqual([0, 1, 2, 3]);
    expect(keyLengthRank({ choices: ['same', 'size', 'four', 'char'], key: 2 })).toBe(0); // all tied: nothing is longer
    expect(keyLengthRank({ choices: ['  ab  ', 'abc', 'abcd', 'abcde'], key: 0 })).toBe(3);
    expect(keyLengthRank({ choices: ['a', 'bb', 'ccc'], key: 0 })).toBeNull();
  });

  it('a track fails when one rank holds more than 40%, or the key is not the shortest in more than 90%', () => {
    expect(rankRow('t', spread(3, 3, 2, 2), DEFAULT_TRACK_RANK_OPTIONS).exceeds).toEqual([]); // 30/30/20/20
    expect(rankRow('t', spread(3, 4, 2, 1), DEFAULT_TRACK_RANK_OPTIONS).exceeds).toEqual([]); // 40% and 10% pass
    expect(rankRow('t', spread(3, 5, 1, 1), DEFAULT_TRACK_RANK_OPTIONS).exceeds).toEqual(['rank-over']); // the second-longest cue
    expect(rankRow('t', spread(3, 4, 3, 0), DEFAULT_TRACK_RANK_OPTIONS).exceeds).toEqual(['not-shortest']); // never the shortest
    expect(rankRow('t', spread(9, 0, 0, 0), DEFAULT_TRACK_RANK_OPTIONS).exceeds).toEqual([]); // under 10 ranked: not judged
    const row = rankRow('t', [...spread(1, 5, 1, 1), { choices: ['a', 'b'], key: 0 }], DEFAULT_TRACK_RANK_OPTIONS);
    expect(row).toMatchObject({ ranked: 8, ranks: [1, 5, 1, 1], top: 5, notShortest: 7 });
  });

  it('a topic (from 8 ranked items) judges only the per-rank cap: at most 4 of 10, 3 of 8', () => {
    expect(rankRow('x', spread(2, 4, 4, 0), DEFAULT_TOPIC_RANK_OPTIONS).exceeds).toEqual([]);
    expect(rankRow('x', spread(2, 5, 3, 0), DEFAULT_TOPIC_RANK_OPTIONS).exceeds).toEqual(['rank-over']);
    expect(rankRow('x', spread(2, 3, 3, 0), DEFAULT_TOPIC_RANK_OPTIONS).exceeds).toEqual([]);
    expect(rankRow('x', spread(1, 4, 3, 0), DEFAULT_TOPIC_RANK_OPTIONS).exceeds).toEqual(['rank-over']);
  });

  it('reads Fundamentals topics.json per track and per topic', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bq-arank-'));
    try {
      mkdirSync(join(dir, 'js'));
      const quiz = (items: KeyedChoices[]) => items.map((i) => ({ choices: i.choices, answer: i.key }));
      writeFileSync(join(dir, 'js', 'topics.json'), JSON.stringify({ track: 'js', topics: [{ id: '01-a', quiz: quiz(spread(2, 6, 2, 0)) }, { id: '02-b', quiz: quiz(spread(3, 3, 2, 2)) }] }));
      expect(fundamentalsRankRows(dir)).toMatchObject([{ pack: 'fundamentals/js', ranked: 20, ranks: [5, 9, 4, 2], exceeds: ['rank-over'] }]);
      expect(fundamentalsTopicRankRows(dir).map((r) => [r.pack, r.exceeds])).toEqual([
        ['fundamentals/js/01-a', ['rank-over']],
        ['fundamentals/js/02-b', []],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ratchet baseline: known passes, a rise fails, a fall is stale-high, a row back within the limit is stale, new offenders fail', () => {
    const rows = [rankRow('packs/up', spread(60, 20, 10, 10), { maxRankShare: 0.4, maxNotShortest: 0.9, minItems: 50 })];
    const entry = { pack: 'packs/up', metric: 'rank-over' as const, ranked: 100, hits: 60, why: 'frozen upstream' };
    expect(rankFails(rankReport(rows, baseline([])))).toBe(true);
    expect(rankFails(rankReport(rows, baseline([entry])))).toBe(false);
    expect(rankReport(rows, baseline([{ ...entry, hits: 55 }])).worse).toHaveLength(1);
    expect(rankReport(rows, baseline([{ ...entry, hits: 70 }])).staleHigh).toHaveLength(1);
    expect(rankReport(rows, baseline([entry, { ...entry, metric: 'not-shortest', hits: 90 }])).stale).toHaveLength(1);
    expect(rankReport([], baseline([entry])).stale).toHaveLength(1);
    expect(rankReport(rows, baseline([entry, entry])).duplicates).toHaveLength(1);
  });

  it('the committed baseline parses and carries a reason per entry', () => {
    const b = readRankBaseline(DEFAULT_ANSWER_RANK_BASELINE);
    expect(b.format).toBe(ANSWER_RANK_BASELINE_FORMAT);
    for (const e of b.entries) expect(e.why.length).toBeGreaterThan(10);
  });
});
