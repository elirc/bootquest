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
  fundamentalsLengthRows,
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
