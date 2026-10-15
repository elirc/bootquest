import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerPositionReport, answerPositionRow, choiceAnswerKeys, formatAnswerPositionReport } from './answer-positions.ts';

const quiz = (answerKey: number, grading = 'choice') => ({ kind: 'quiz', check: { type: 'quiz', itemKey: 'k', grading, answerKey, choices: ['a', 'b', 'c', 'd'] } });

describe('answerPositionRow (pure)', () => {
  it('flags > 70% at one index with >= 6 quizzes; exactly 70% or < 6 quizzes is not degenerate', () => {
    expect(answerPositionRow('p', [0, 0, 0, 0, 0, 0])).toMatchObject({ quizzes: 6, dominantIndex: 0, dominantShare: 1, degenerate: true });
    expect(answerPositionRow('p', [0, 0, 0, 0, 0])).toMatchObject({ degenerate: false }); // too few to judge
    expect(answerPositionRow('p', [1, 1, 1, 1, 1, 1, 1, 0, 2, 3])).toMatchObject({ dominantIndex: 1, dominantShare: 0.7, degenerate: false });
    expect(answerPositionRow('p', [1, 1, 1, 1, 1, 1, 1, 1, 2, 3])).toMatchObject({ dominantShare: 0.8, degenerate: true });
    expect(answerPositionRow('p', [0, 1, 2, 3, 0, 1, 2, 3])).toMatchObject({ histogram: { 0: 2, 1: 2, 2: 2, 3: 2 }, degenerate: false });
    expect(answerPositionRow('p', [])).toMatchObject({ quizzes: 0, dominantIndex: null, degenerate: false });
  });

  it('thresholds are configurable', () => {
    expect(answerPositionRow('p', [0, 0, 0, 1], { maxShare: 0.5, minQuizzes: 4 }).degenerate).toBe(true);
  });

  it('choiceAnswerKeys finds choice-graded quiz checks anywhere, skipping exact / self grading', () => {
    const doc = { units: [{ unit: { checks: [{ spec: quiz(2).check }] } }, { unit: { checks: [{ spec: quiz(0, 'exact').check }] } }, { deep: [{ x: quiz(3).check }] }] };
    expect(choiceAnswerKeys(doc)).toEqual([2, 3]);
  });
});

describe('answerPositionReport over an estate on disk', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bq-answer-lint-'));
    const pack = (repo: string, items: unknown[]) => {
      mkdirSync(join(root, 'seed', 'quests', repo), { recursive: true });
      writeFileSync(join(root, 'seed', 'quests', repo, 'items.json'), JSON.stringify({ items }));
    };
    pack('zeros', [0, 0, 0, 0, 0, 0, 0].map((k) => quiz(k)));
    pack('balanced', [0, 1, 2, 3, 1, 2].map((k) => quiz(k)));
    pack('small', [0, 0, 0].map((k) => quiz(k)));
    pack('flash-only', [{ kind: 'flashcard', front: 'f', back: 'b' }]);
    mkdirSync(join(root, 'packs', 'src1'), { recursive: true });
    writeFileSync(join(root, 'packs', 'src1', 'manifest.json'), '{}');
    writeFileSync(join(root, 'packs', 'src1', 'c1.json'), JSON.stringify({ units: [1, 1, 1, 1, 1, 1].map((k) => ({ unit: { checks: [{ spec: quiz(k).check }] } })) }));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reports the degenerate quest + code packs only, with a RESULT line', () => {
    const r = answerPositionReport({ seedDir: join(root, 'seed'), packsDir: join(root, 'packs') });
    expect(r.rows.map((x) => x.pack)).toEqual(['quests/balanced', 'quests/flash-only', 'quests/small', 'quests/zeros', 'packs/src1']);
    expect(r.offenders.map((x) => x.pack)).toEqual(['quests/zeros', 'packs/src1']);
    const lines = formatAnswerPositionReport(r);
    expect(lines.at(-1)).toBe('RESULT DEGENERATE');
    expect(lines.filter((l) => l.startsWith('DEGENERATE'))).toHaveLength(2);
  });

  it('a clean estate prints RESULT OK', () => {
    const r = answerPositionReport({ seedDir: join(root, 'nothing-here') });
    expect(r.rows).toEqual([]);
    expect(formatAnswerPositionReport(r).at(-1)).toBe('RESULT OK');
  });
});

describe('the real estate', () => {
  // content-independent: the estate may be re-seeded, so the expectation is recomputed from the
  // bytes instead of naming today's offenders (csharp-tut / csharp-interview / dotnet-snapshot)
  it('flags exactly the quest packs whose >= 6 choice keys sit > 70% at one index', () => {
    const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
    const quests = join(REPO, 'content', 'seed', 'quests');
    const expected = readdirSync(quests)
      .filter((n) => existsSync(join(quests, n, 'items.json')))
      .filter((n) => {
        const keys = (JSON.parse(readFileSync(join(quests, n, 'items.json'), 'utf8')) as { items: { kind: string; check?: { grading?: string; answerKey?: unknown } }[] }).items
          .filter((i) => i.kind === 'quiz' && i.check?.grading === 'choice' && typeof i.check.answerKey === 'number')
          .map((i) => i.check!.answerKey as number);
        const top = Math.max(0, ...[...new Set(keys)].map((k) => keys.filter((x) => x === k).length));
        return keys.length >= 6 && top / keys.length > 0.7;
      })
      .map((n) => `quests/${n}`)
      .sort();
    const r = answerPositionReport({ seedDir: join(REPO, 'content', 'seed') });
    expect(r.offenders.map((o) => o.pack).sort()).toEqual(expected);
  });

  // the GATE (campaign 2 factory-2): `npm run seed:lint:answers` must print RESULT OK, so a re-seed
  // that piles keys at one index again fails the tools/seed suite instead of only being reported.
  it('GATE: no committed quest or code pack is degenerate (seed:lint:answers RESULT OK)', () => {
    const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
    const r = answerPositionReport({ seedDir: join(REPO, 'content', 'seed'), packsDir: join(REPO, 'content', 'packs') });
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.offenders.map((o) => `${o.pack} top ${o.dominantIndex} @ ${Math.round(o.dominantShare * 100)}%`)).toEqual([]);
    expect(formatAnswerPositionReport(r).at(-1)).toBe('RESULT OK');
  });
});
