import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SeedExplainBackItem, SeedItem, SeedQuizItem } from '@bootquest/shared';
import { findPacks } from './check/check.ts';
import { plantedToken } from './demo/plant.ts';
import { Exclusions } from './exclusions.ts';
import {
  EB_LEAK_EXEMPT,
  ebSiblingGroupKey,
  ebSiblingIndex,
  explainBackSiblingProblems,
  explainBackKeyLeaks,
  explainBackLeakId,
  explainBackLeakProblems,
  packGuardProblems,
  shippedSecretProblems,
  type KeyedQuiz,
} from './guards.ts';
import { includesAtBoundary, leakMatch } from './leak.ts';
import { replaceRefusal } from './pack.ts';
import { singleKeyedProblems } from './quests/validate.ts';
import { leakLintCounts, leakLintReport } from '../ops/leak-lint.ts';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const SEED = join(REPO, 'content', 'seed');
const tmp = mkdtempSync(join(tmpdir(), 'bq-guards-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const ex = Exclusions.load();

const quiz = (key: string, choices: string[], answerKey: number, over: Partial<SeedQuizItem> = {}): SeedQuizItem => ({
  kind: 'quiz',
  key: `seed:quests:r/quiz/${key}`,
  provenance: { repo: 'r', sha: 'a'.repeat(40), path: 'g.md', lines: { start: 1, end: 9 } },
  citations: [],
  variety: 'concept',
  prompt: `Question ${key}?`,
  choices: choices.map((text, i) => ({ text, evidence: i === answerKey ? ['src/a.ts'] : [] })),
  check: { type: 'quiz', itemKey: `seed:quests:r/quiz/${key}`, grading: 'choice', answerKey, choices },
  explanation: 'Because the guide says so.',
  ...over,
});
const eb = (points: string[]): SeedExplainBackItem => ({
  kind: 'explain-back',
  key: 'seed:explainback:r/explain-back/abc',
  provenance: { repo: 'r', sha: 'a'.repeat(40), path: 'g.md', lines: { start: 1, end: 9 } },
  citations: [],
  questions: [{ prompt: 'Explain it', keyPoints: points.map((text) => ({ text, quote: 'a quote from the guide' })) }],
});

describe('leak primitives', () => {
  it('includesAtBoundary: a quote must not end or start inside a word', () => {
    expect(includesAtBoundary('const MAX = 30;', 'MAX = 3')).toBe(false);
    expect(includesAtBoundary('const MAX = 3;', 'MAX = 3')).toBe(true);
    expect(includesAtBoundary('the MAX = 30 and MAX = 3 here', 'MAX = 3')).toBe(true);
    expect(includesAtBoundary('xMAX = 3', 'MAX = 3')).toBe(false);
    expect(includesAtBoundary('| F7 | M', '| F7 |')).toBe(true);
  });

  it('leakMatch: token-boundary containment, then token-Jaccard over sentences / answer-sized windows; size floors', () => {
    expect(leakMatch('Three weights give 334, 333, 333.', '334, 333, 333', 0.5)).toMatchObject({ kind: 'contains' });
    expect(leakMatch('A total of 1334 cents, 3333 cents.', '334, 333, 333', 0.5)).toBeNull();
    expect(leakMatch('It takes the write lock before the document is read, so two processes cannot both read.', 'It takes the write lock before the read, so two processes cannot both read and then write', 0.5)).toMatchObject({ kind: 'overlap' });
    // short keys: one shared token scores high, so the explain-back floors skip them
    expect(leakMatch('if multiple tasks throw, await surfaces the first', 'throw;', 0.5)).toMatchObject({ kind: 'contains' });
    expect(leakMatch('July 10 through July 12 includes July 12', 'July 12-14', 0.5)).toMatchObject({ kind: 'overlap', score: 0.5 });
    expect(leakMatch('July 10 through July 12 includes July 12', 'July 12-14', 0.5, { minContainTokens: 3, minOverlapTokens: 4 })).toBeNull();
    expect(leakMatch('if multiple tasks throw, await surfaces the first', 'throw;', 0.5, { minContainTokens: 3, minOverlapTokens: 4 })).toBeNull();
  });
});

describe('secret scan over shipped text', () => {
  it('finds a secret pattern in any shipped string (never echoing the match) and passes clean items', () => {
    const dirty = quiz('k1', ['a', 'b', 'c'], 0, { explanation: `use ${plantedToken()} here` });
    expect(shippedSecretProblems(ex, [quiz('k0', ['a', 'b', 'c'], 0), dirty])).toEqual([`secret-scan: ${dirty.key} ships text matching secret pattern(s) shopify-token (redact/revoke at the source; a shipped item may never carry one)`]);
    expect(shippedSecretProblems(ex, [quiz('k0', ['a', 'b', 'c'], 0)])).toEqual([]);
  });

  it('GATE: no committed seed pack ships a secret-pattern string', () => {
    const bad = findPacks(SEED).flatMap((d) => shippedSecretProblems(ex, (JSON.parse(readFileSync(join(d, 'items.json'), 'utf8')) as { items: SeedItem[] }).items));
    expect(bad).toEqual([]);
  });
});

describe('explain-back key points vs same-repo quiz keys', () => {
  const keys: KeyedQuiz[] = [
    { pack: 'r', key: 'seed:quests:r/quiz/q1', answer: 'A learner lying to themselves, so progress claims stay true' },
    { pack: 'r', key: 'seed:quests:r/quiz/q2', answer: '404' },
  ];
  it('flags a key point that restates a keyed answer, not one that merely shares a short key token', () => {
    const leaks = explainBackKeyLeaks(eb(['The threat model is a learner lying to themselves, so progress claims stay true.', 'A missing row answers 404 to the caller.', 'Unrelated point about caching layers.']), keys);
    expect(leaks.map((l) => [l.where, l.quiz, l.kind])).toEqual([['q1.kp1', 'seed:quests:r/quiz/q1', 'contains']]);
  });

  it('exemptions are exact and shrink-only: an exempt leak passes, a new one fails, a stale one fails', () => {
    const leaks = explainBackKeyLeaks(eb(['The threat model is a learner lying to themselves, so progress claims stay true.']), keys);
    const id = explainBackLeakId(leaks[0]!);
    expect(id).toBe('q1.kp1 r/q1');
    expect(explainBackLeakProblems('p', leaks, { p: [id] })).toEqual([]);
    expect(explainBackLeakProblems('p', leaks, {})[0]).toMatch(/^eb-leak: q1\.kp1 contains the keyed answer of quests\/r quiz q1/);
    expect(explainBackLeakProblems('p', [], { p: [id] })).toEqual(['eb-leak: EB_LEAK_EXEMPT names "q1.kp1 r/q1" for p but it no longer leaks (delete it)']);
  });

  it('packGuardProblems judges an explain-back pack against <seedRoot>/quests packs of the SAME repo only', () => {
    const root = join(tmp, 'seed');
    const qd = join(root, 'quests', 'rq');
    mkdirSync(qd, { recursive: true });
    writeFileSync(join(qd, 'manifest.json'), JSON.stringify({ source: { repo: 'r' } }));
    const q1 = quiz('q1', ['A learner lying to themselves, so progress claims stay true', 'Nobody at all', 'An attacker on the network'], 0);
    writeFileSync(join(qd, 'items.json'), JSON.stringify({ items: [q1] }));
    const item = eb(['The threat model is a learner lying to themselves, so progress claims stay true.']);
    expect(packGuardProblems({ generator: 'explainback', name: 'x', repo: 'r', items: [item], ex, seedRoot: root })[0]).toMatch(/^eb-leak: q1\.kp1 contains the keyed answer of quests\/rq quiz q1/);
    expect(packGuardProblems({ generator: 'explainback', name: 'x', repo: 'other', items: [item], ex, seedRoot: root })).toEqual([]);
  });

  it('GATE: the estate ships exactly the EB_LEAK_EXEMPT leaks (seed:lint:leaks lists them; none new, none stale)', () => {
    const r = leakLintReport(SEED);
    expect(r.scanned).toBeGreaterThan(50);
    const c = leakLintCounts(r);
    expect(r.rows.flatMap((x) => x.leaks.filter((l) => !l.exempt).map((l) => `${x.pack}: ${l.id}`))).toEqual([]);
    expect(c.stale).toBe(0);
    expect(c.leaks).toBe(Object.values(EB_LEAK_EXEMPT).reduce((n, ids) => n + ids.length, 0));
  });
});

describe('explain-back sibling (alternate) sets: eb-sibling', () => {
  const set = (key: string, prompts: string[], points: string[][], over: Partial<SeedExplainBackItem> = {}): SeedExplainBackItem => ({
    kind: 'explain-back',
    key: `seed:explainback:r/explain-back/${key}`,
    provenance: { repo: 'r', sha: 'a'.repeat(40), path: 'guide/backpressure.md', lines: { start: 1, end: 9 } },
    citations: [],
    questions: prompts.map((prompt, qi) => ({ prompt, keyPoints: points[qi]!.map((text) => ({ text, quote: `quoted source line about ${text.toLowerCase()}` })) })),
    ...over,
  });
  const PRIMARY = set(
    'primary',
    ['Why does the queue shed load instead of growing without bound?', 'What does the timeout budget protect downstream?', 'How is retry amplification kept in check?'],
    [
      ['Unbounded queues turn overload into latency for everyone', 'Shedding early keeps the healthy requests fast'],
      ['A per-hop budget stops one slow call eating the whole deadline', 'Callers give up before the user does'],
      ['Retries multiply traffic exactly when capacity is lowest', 'A retry budget caps the extra load at a fixed fraction'],
    ],
  );
  const SET_B = set(
    'draft-b',
    ['Capacity just doubled overnight: which limits would you move first, and which stay put?', 'A dependency starts timing out at p99: walk through what the caller sees.', 'Design a retry policy for a payment call that must not double-charge.'],
    [
      ['Admission limits follow measured headroom rather than raw instance count', 'Per-tenant quotas stay fixed so a noisy tenant cannot claim the new room'],
      ['Tail latency eats the remaining deadline before the error surfaces', 'Hedged requests trade extra load for lower tail latency'],
      ['Idempotency keys make the second attempt a lookup instead of a charge', 'Jittered backoff spreads synchronized clients apart'],
    ],
    { set: 'b' },
  );
  const OTHER_PATH = set('other', PRIMARY.questions.map((q) => q.prompt), PRIMARY.questions.map((q) => q.keyPoints.map((k) => k.text)), {
    provenance: { ...PRIMARY.provenance, path: 'guide/other.md' },
  });
  const estate = (packs: Record<string, SeedExplainBackItem[]>): string => {
    const root = mkdtempSync(join(tmp, 'eb-sib-'));
    for (const [name, items] of Object.entries(packs)) {
      mkdirSync(join(root, 'explainback', name), { recursive: true });
      writeFileSync(join(root, 'explainback', name, 'items.json'), JSON.stringify({ items }));
    }
    return root;
  };

  it('ebSiblingIndex groups explain-back items by (repo, path) across packs', () => {
    const idx = ebSiblingIndex(estate({ p: [PRIMARY], 'p--set-b': [SET_B], o: [OTHER_PATH] }));
    expect(idx.get(ebSiblingGroupKey(PRIMARY))!.map((e) => [e.pack, e.item.key])).toEqual([
      ['p', PRIMARY.key],
      ['p--set-b', SET_B.key],
    ]);
    expect(idx.get(ebSiblingGroupKey(OTHER_PATH))!.map((e) => e.pack)).toEqual(['o']);
  });

  it('a rephrased set (fresh prompts, fresh key points) passes; a different (repo, path) is never a sibling, even verbatim', () => {
    const idx = ebSiblingIndex(estate({ p: [PRIMARY], 'p--set-b': [SET_B], o: [OTHER_PATH] }));
    expect(explainBackSiblingProblems([SET_B], idx)).toEqual([]);
    expect(explainBackSiblingProblems([PRIMARY], idx)).toEqual([]);
    expect(explainBackSiblingProblems([OTHER_PATH], idx)).toEqual([]);
  });

  it('a prompt that near-duplicates a sibling prompt FAILS', () => {
    const idx = ebSiblingIndex(estate({ p: [PRIMARY] }));
    const bad = structuredClone(SET_B);
    bad.questions[1]!.prompt = 'What does the timeout budget protect downstream?';
    const probs = explainBackSiblingProblems([bad], idx, 'p--set-b');
    expect(probs).toHaveLength(1);
    expect(probs[0]).toMatch(/^eb-sibling: q2 prompt near-duplicates the q2 prompt of sibling p \(primary set\)/);
  });

  it('a key point (text or quote) that near-duplicates a sibling key point FAILS', () => {
    const idx = ebSiblingIndex(estate({ p: [PRIMARY] }));
    const byText = structuredClone(SET_B);
    byText.questions[2]!.keyPoints[0]!.text = 'Retries multiply traffic exactly when capacity is lowest!';
    expect(explainBackSiblingProblems([byText], idx)[0]).toMatch(/^eb-sibling: q3\.kp1 near-duplicates q3\.kp1 of sibling p \(primary set\)/);
    const byQuote = structuredClone(SET_B);
    byQuote.questions[0]!.keyPoints[1]!.quote = PRIMARY.questions[1]!.keyPoints[0]!.quote!;
    expect(explainBackSiblingProblems([byQuote], idx)[0]).toMatch(/^eb-sibling: q1\.kp2\.quote near-duplicates q2\.kp1(\.quote)? of sibling p/);
    // and in the other direction: the primary re-checked against an offending set (seed:check judges every pack)
    const idx2 = ebSiblingIndex(estate({ p: [PRIMARY], b: [byText] }));
    expect(explainBackSiblingProblems([PRIMARY], idx2)[0]).toMatch(/^eb-sibling: q3\.kp1 near-duplicates q3\.kp1 of sibling b \(set b\)/);
  });

  it('two PRIMARY sets of one unit (draft + deterministic scaffold, the W7 pattern) are not compared: only pairs with an alternate set are', () => {
    const scaffold = { ...structuredClone(PRIMARY), key: 'seed:explainback:r/explain-back/scaffold' };
    const idx = ebSiblingIndex(estate({ p: [PRIMARY], s: [scaffold] }));
    expect(explainBackSiblingProblems([scaffold], idx)).toEqual([]);
    // ...but the same content as an alternate set of that unit fails
    expect(explainBackSiblingProblems([{ ...scaffold, set: 'c' }], idx).length).toBeGreaterThan(0);
  });

  it('packGuardProblems runs it for explain-back packs: lazily from seedRoot (the writer path) or from a prebuilt index (seed:check)', () => {
    const bad = structuredClone(SET_B);
    bad.questions[0]!.prompt = PRIMARY.questions[0]!.prompt;
    const root = estate({ p: [PRIMARY], 'p--set-b': [bad] });
    const lazy = packGuardProblems({ generator: 'explainback', name: 'p--set-b', repo: 'r', items: [bad], ex, seedRoot: root });
    expect(lazy.filter((p) => p.startsWith('eb-sibling:'))).toHaveLength(1);
    const prebuilt = packGuardProblems({ generator: 'explainback', name: 'p--set-b', repo: 'r', items: [bad], ex, seedRoot: null, ebIndex: ebSiblingIndex(root) });
    expect(prebuilt).toEqual(lazy);
    expect(packGuardProblems({ generator: 'explainback', name: 'p--set-b', repo: 'r', items: [SET_B], ex, seedRoot: estate({ p: [PRIMARY] }) }).filter((p) => p.startsWith('eb-sibling:'))).toEqual([]);
  });

  it('GATE: the estate ships no eb-sibling problem', () => {
    const idx = ebSiblingIndex(SEED);
    expect([...idx.values()].reduce((n, l) => n + l.length, 0)).toBeGreaterThan(50);
    const bad = [...idx.values()].flatMap((entries) => entries.flatMap((e) => explainBackSiblingProblems([e.item], idx, e.pack).map((p) => `${e.pack}: ${p}`)));
    expect(bad).toEqual([]);
  });
});

describe('pack guards on a quest pack', () => {
  it('a pack whose key is always the longest, colon-led choice fails blind-pass and quiz-balance', () => {
    const items = Array.from({ length: 12 }, (_, i) => quiz(`t${i}`, ['Refused: the guard throws before the body is parsed at all', 'Accepted', 'Ignored', 'Retried'], 0));
    const probs = packGuardProblems({ generator: 'quests', name: 'planted', repo: 'r', items, ex, seedRoot: null });
    expect(probs.some((p) => p.startsWith('blind-pass: strategy'))).toBe(true);
    expect(probs.some((p) => p.startsWith('quiz-balance longest:'))).toBe(true);
  });

  it('explanation-lint runs per pack: a generator-label explanation fails it', () => {
    const items = [quiz('e1', ['Alpha answer here', 'Beta answer here', 'Gamma answer here'], 1, { explanation: '3 (inline list item)' })];
    expect(packGuardProblems({ generator: 'quests', name: 'p', repo: 'r', items, ex, seedRoot: null })).toContain('explanation-lint: 1 quiz explanation(s) are generator label artifacts: seed:quests:r/quiz/e1');
  });
});

describe('multi-keyable applicability is explicit (never an empty array passing by default)', () => {
  const ev = (q: SeedQuizItem, evidence: string[][]): SeedQuizItem => ({ ...q, choices: q.choices.map((c, i) => ({ ...c, evidence: evidence[i]! })) });
  const base = quiz('m', ['Alpha answer here', 'Beta answer here', 'Gamma answer here'], 0);
  it('applies when every choice carries evidence', () => {
    expect(singleKeyedProblems(ev({ ...base, variety: 'goal-check' }, [['a.ts'], ['a.ts'], ['c.ts']]))).toContain('multi-keyable: choice 1 shares evidence with the key (a.ts)');
  });
  it('does not apply to a hand concept quiz with evidence on the key only, nor to a quiz with no evidence at all', () => {
    expect(singleKeyedProblems(ev(base, [['a.ts'], [], []]))).toEqual([]);
    expect(singleKeyedProblems(ev({ ...base, variety: 'goal-check' }, [[], [], []]))).toEqual([]);
  });
  it('refuses evidence on some distractors only, and key-only evidence on a non-concept quiz', () => {
    expect(singleKeyedProblems(ev(base, [['a.ts'], ['b.ts'], []]))[0]).toMatch(/multi-keyable cannot be judged: 2\/3 choices carry evidence/);
    expect(singleKeyedProblems(ev({ ...base, variety: 'goal-check' }, [['a.ts'], [], []]))[0]).toMatch(/multi-keyable cannot be judged: 1\/3/);
  });
});

describe('replaceRefusal (three quest writers, one dir)', () => {
  const pack = (name: string, inputs: string[], generator = 'quests') => {
    const d = join(tmp, 'replace', name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'manifest.json'), JSON.stringify({ generator, name, source: { inputs } }));
    return d;
  };
  it('allows the same source, refuses another kind or draft, and a different generator', () => {
    const drafts = pack('r1', ['a.md', 'draft:r1.json']);
    expect(replaceRefusal(drafts, 'quests', 'r1', ['a.md', 'b.md', 'draft:r1.json'])).toBeNull();
    expect(replaceRefusal(drafts, 'quests', 'r1', ['a.md'])).toMatch(/its source is draft:r1\.json, this run's is generator-only \(no draft\)/);
    expect(replaceRefusal(drafts, 'quests', 'r1', ['a.md', 'draft:r1.authored.json'])).toMatch(/this run's is draft:r1\.authored\.json/);
    const gen = pack('r2', ['a.md']);
    expect(replaceRefusal(gen, 'quests', 'r2', ['a.md', 'draft:r2.json'])).toMatch(/its source is generator-only \(no draft\), this run's is draft:r2\.json/);
    expect(replaceRefusal(pack('r3', ['a.md'], 'notes'), 'quests', 'r3', ['a.md'])).toMatch(/written by seed:notes/);
    expect(replaceRefusal(join(tmp, 'replace', 'none'), 'quests', 'x', [])).toBeNull();
  });
});
