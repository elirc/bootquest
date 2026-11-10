import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANSWER_LENGTH_BASELINE_FORMAT,
  answerLengthFails,
  answerLengthReport,
  answerLengthRow,
  DEFAULT_ANSWER_LENGTH_BASELINE,
  DEFAULT_TOPIC_LENGTH_OPTIONS,
  fundamentalsLengthRows,
  fundamentalsTopicLengthRows,
  keyedChoiceChecks,
  keyLengthClass,
  readAnswerLengthBaseline,
  type AnswerLengthBaseline,
  type KeyedChoices,
} from './answer-length.ts';

const longKey: KeyedChoices = { choices: ['a', 'bb', 'the much longer keyed answer', 'cc'], key: 2 };
const shortKey: KeyedChoices = { choices: ['x', 'longer one', 'longer two', 'longer three'], key: 0 };
const balanced: KeyedChoices = { choices: ['same', 'size', 'four', 'char'], key: 1 };
const many = (n: number, item: KeyedChoices) => Array.from({ length: n }, () => item);
const baseline = (entries: AnswerLengthBaseline['entries']): AnswerLengthBaseline => ({ format: ANSWER_LENGTH_BASELINE_FORMAT, entries });

describe('answer-length lint (f52 C2)', () => {
  it('classifies the single longest / shortest key; ties are neither', () => {
    expect(keyLengthClass(longKey)).toEqual({ longest: true, shortest: false });
    expect(keyLengthClass(shortKey)).toEqual({ longest: false, shortest: true });
    expect(keyLengthClass(balanced)).toEqual({ longest: false, shortest: false });
    expect(keyLengthClass({ choices: ['  pad  ', 'pad'], key: 0 })).toEqual({ longest: false, shortest: false }); // trimmed
  });

  it('a pack fails above 40% on either metric, only with >= minItems keyed items', () => {
    const over = answerLengthRow('p', [...many(5, longKey), ...many(5, balanced)]);
    expect(over.longestShare).toBe(0.5);
    expect(over.exceeds).toEqual(['longest']);
    expect(answerLengthRow('p', [...many(4, longKey), ...many(6, balanced)]).exceeds).toEqual([]); // exactly 40% passes
    expect(answerLengthRow('p', [...many(5, shortKey), ...many(5, balanced)]).exceeds).toEqual(['shortest']);
    expect(answerLengthRow('p', many(9, longKey)).exceeds).toEqual([]); // too small to judge
  });

  it('finds choice checks with choices in any document; reads Fundamentals topics.json per track', () => {
    expect(keyedChoiceChecks({ units: [{ checks: [{ spec: { type: 'quiz', grading: 'choice', answerKey: 1, choices: ['a', 'b'] } }, { spec: { type: 'quiz', grading: 'exact', answerKey: 'x' } }] }] })).toEqual([
      { choices: ['a', 'b'], key: 1 },
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'bq-alen-'));
    try {
      mkdirSync(join(dir, 'js'));
      const quiz = many(10, { choices: ['short', 'a keyed answer that is far longer', 'mid one', 'tiny'], answer: 1 } as never);
      writeFileSync(join(dir, 'js', 'topics.json'), JSON.stringify({ track: 'js', topics: [{ quiz }] }));
      const [row] = fundamentalsLengthRows(dir);
      expect(row).toMatchObject({ pack: 'fundamentals/js', keyed: 10, longest: 10, exceeds: ['longest'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('per-topic Fundamentals rows: a topic with >= 8 keyed items fails at more than 3 of 8 single-longest keys', () => {
    const long = { choices: ['short', 'a keyed answer that is far longer', 'mid one', 'tiny'], answer: 1 };
    const even = { choices: ['same', 'size', 'four', 'char'], answer: 2 };
    const dir = mkdtempSync(join(tmpdir(), 'bq-alen-topic-'));
    try {
      mkdirSync(join(dir, 'js'));
      const topics = [
        { id: '01-three', quiz: [...many(3, long as never), ...many(5, even as never)] }, // 3/8 = 37.5%: passes
        { id: '02-four', quiz: [...many(4, long as never), ...many(4, even as never)] }, // 4/8 = 50%: fails
        { id: '03-small', quiz: many(7, long as never) }, // 7 keyed: too small to judge
        { quiz: [...many(5, long as never), ...many(5, even as never)] }, // id-less: named by position
      ];
      writeFileSync(join(dir, 'js', 'topics.json'), JSON.stringify({ track: 'js', topics }));
      const rows = fundamentalsTopicLengthRows(dir);
      expect(rows.map((r) => [r.pack, r.keyed, r.longest, r.exceeds])).toEqual([
        ['fundamentals/js/01-three', 8, 3, []],
        ['fundamentals/js/02-four', 8, 4, ['longest']],
        ['fundamentals/js/03-small', 7, 7, []],
        ['fundamentals/js/#4', 10, 5, ['longest']],
      ]);
      expect(DEFAULT_TOPIC_LENGTH_OPTIONS).toEqual({ maxShare: 0.4, minItems: 8 });
      // the track row still pools every topic (33 keyed, 19 longest)
      expect(fundamentalsLengthRows(dir)[0]).toMatchObject({ pack: 'fundamentals/js', keyed: 33, longest: 19 });
      // a fresh topic over the limit fails the lint (never baselined)
      expect(answerLengthReport(rows, baseline([])).fresh.map((f) => f.row.pack)).toEqual(['fundamentals/js/02-four', 'fundamentals/js/#4']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ratchet: a share below the baselined entry is stale-high and fails until the entry is lowered', () => {
    const row = answerLengthRow('packs/x', [...many(6, longKey), ...many(4, balanced)]); // 60%
    const entry = { pack: 'packs/x', metric: 'longest' as const, keyed: 10, hits: 7, why: 't' }; // baselined 70%
    const high = answerLengthReport([row], baseline([entry]));
    expect(high.staleHigh).toHaveLength(1);
    expect(high.staleHigh[0]).toContain('lower the entry to hits 6, keyed 10');
    expect(high.known).toEqual([]);
    expect(answerLengthFails(high)).toBe(true);
    // lowered to the new share: passes again (same share on a different keyed count counts as equal)
    expect(answerLengthFails(answerLengthReport([row], baseline([{ ...entry, hits: 6 }])))).toBe(false);
    expect(answerLengthFails(answerLengthReport([row], baseline([{ ...entry, keyed: 20, hits: 12 }])))).toBe(false);
  });

  it('shrink-only baseline: known passes, a rise fails, a pack back under the limit is stale, new offenders fail', () => {
    const row = answerLengthRow('packs/x', [...many(6, longKey), ...many(4, balanced)]); // 60%
    const entry = { pack: 'packs/x', metric: 'longest' as const, keyed: 10, hits: 6, why: 't' };
    expect(answerLengthFails(answerLengthReport([row], baseline([entry])))).toBe(false);
    expect(answerLengthFails(answerLengthReport([row], baseline([])))).toBe(true);
    const worse = answerLengthReport([row], baseline([{ ...entry, hits: 5 }]));
    expect(worse.worse).toHaveLength(1);
    const fixed = answerLengthRow('packs/x', many(10, balanced));
    expect(answerLengthReport([fixed], baseline([entry])).stale).toHaveLength(1);
    expect(answerLengthReport([], baseline([entry])).stale).toHaveLength(1);
    expect(answerLengthReport([row], baseline([entry, entry])).duplicates).toEqual(['packs/x:longest']);
  });

  it('the committed baseline parses and carries a reason per entry', () => {
    const b = readAnswerLengthBaseline(DEFAULT_ANSWER_LENGTH_BASELINE);
    expect(b.entries.length).toBeGreaterThan(0);
    for (const e of b.entries) expect(e.why.length).toBeGreaterThan(10);
  });
});
