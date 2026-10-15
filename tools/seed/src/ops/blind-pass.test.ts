import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Blind-pass guard (release wave, after the campaign 2 content reviews).
 *
 * quiz-balance.test.ts caps per-draft SHARES (key longest <= 35%, ...). The release reviews
 * found tells it does not measure (the key has the most clause marks, the only comma or "and",
 * the only digit, ...), and each per-draft share cap is noisy at ~12 quizzes: with 17 such
 * strategies at 0.35, ~70 of 100 drafts would fail with RANDOM keys. So this guard asks the
 * question the honesty rule actually cares about, per STAMPED quest pack (drafted, authored or
 * generated, so the csharp campaign packs are covered too):
 *
 *   for every blind strategy, what is the exact probability that a learner who answers each
 *   quiz by that strategy alone (guessing uniformly among the choices it keeps) clears the
 *   pack's 80% study-quest gate?
 *
 * That probability must stay <= MAX_BLIND_PASS. Measured at introduction over the 107 stamped
 * packs: with the real keys 12 packs exceeded it; with the same choices and RANDOM keys (5 seeds)
 * at most 1 pack exceeded even 0.01, so a failure here is a real tell, not small-sample noise.
 * The served choice order is shuffled per database, so position is not a strategy here.
 *
 * EXEMPT: pack -> ceiling on its current worst probability. An exempt pack must still exceed
 * the cap (delete the entry once fixed) and must not get worse than its ceiling. Do NOT raise
 * MAX_BLIND_PASS or a ceiling to admit a pack; rewrite its choices.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const QUESTS = join(ROOT, 'content', 'seed', 'quests');

/** The study-quest gate (server/src/store/study-quests.ts: passPct 0.8; integer rule of meetsCorePct). */
const PASS_PCT = 80;
const MAX_BLIND_PASS = 0.02;

const EXEMPT: Record<string, number> = {
  // most clause marks: 0.0207
  '3buildagentteachgem': 0.021,
  // eliminate starts It/They/The: 0.0864
  '3buildanalytics': 0.087,
  // drop because/since, then prefer comma: 0.0449
  'grokjs-grokbuildjs': 0.045,
  // most clause marks: 0.1667
  'groktuts-web-dev-upskilling-lab': 0.167,
  // prefer digit: 0.0376
  'organized-dotnet-pastebin': 0.038,
  // prefer and: 0.1250
  'organized-dotnet-trello': 0.125,
  // prefer comma, then most words: 0.0625
  'organized-js-training-react': 0.063,
  // prefer and: 0.0313
  'ship-it': 0.032,
};

type Strategy = (choices: readonly string[], key: number) => number;

const words = (s: string): number => s.trim().split(/\s+/).length;
const FEATURES: Record<string, (s: string) => boolean> = {
  'colon-led': (s) => /^[^{[]{1,60}?:\s/.test(s),
  'because/since': (s) => /\b(because|since)\b/i.test(s),
  'absolute-word': (s) => /\b(always|never|only|all|every|none|no|any|must|cannot|entirely|completely|whole)\b/i.test(s),
  semicolon: (s) => s.includes(';'),
  comma: (s) => s.includes(','),
  and: (s) => /\band\b/i.test(s),
  negation: (s) => /\b(not|no|never|nothing|none|without)\b|n't\b/i.test(s),
  digit: (s) => /\d/.test(s),
  'starts It/They/The': (s) => /^(It|They|The)\b/.test(s),
};

/** Expected score of guessing uniformly among the choices `keep` keeps (all of them when it keeps none). */
const pool = (choices: readonly string[], keep: (s: string) => boolean): number[] => {
  const kept = choices.map((_, i) => i).filter((i) => keep(choices[i]!));
  return kept.length > 0 ? kept : choices.map((_, i) => i);
};
const guess = (idx: number[], key: number): number => (idx.includes(key) ? 1 / idx.length : 0);
/** Guess among the choices that maximise `metric`. */
const maxBy = (metric: (s: string) => number): Strategy => (choices, key) => {
  const v = choices.map(metric);
  const top = Math.max(...v);
  return guess(v.map((_, i) => i).filter((i) => v[i] === top), key);
};

const STRATEGIES: Record<string, Strategy> = {
  'longest (chars)': maxBy((s) => s.length),
  'shortest (chars)': maxBy((s) => -s.length),
  'most words': maxBy(words),
  'fewest words': maxBy((s) => -words(s)),
  'most clause marks': maxBy((s) => (s.match(/[,:;]/g) ?? []).length),
  'drop because/since, then prefer colon-led': (c, k) => {
    const a = pool(c, (s) => !FEATURES['because/since']!(s));
    const b = a.filter((i) => FEATURES['colon-led']!(c[i]!));
    return guess(b.length > 0 ? b : a, k);
  },
  'drop because/since, then prefer comma': (c, k) => {
    const a = pool(c, (s) => !FEATURES['because/since']!(s));
    const b = a.filter((i) => FEATURES.comma!(c[i]!));
    return guess(b.length > 0 ? b : a, k);
  },
  'prefer comma, then most words': (c, k) => {
    const a = pool(c, FEATURES.comma!);
    const top = Math.max(...a.map((i) => words(c[i]!)));
    return guess(a.filter((i) => words(c[i]!) === top), k);
  },
};
/** "Pick the choice at length rank r" (rank = 1 + choices strictly longer; ties share a rank). */
for (const rank of [2, 3]) {
  STRATEGIES[`length rank ${rank}`] = (c, k) => {
    const rankOf = (x: number) => 1 + c.filter((s) => s.length > x).length;
    return guess(c.map((_, i) => i).filter((i) => rankOf(c[i]!.length) === rank), k);
  };
}
for (const [name, f] of Object.entries(FEATURES)) {
  STRATEGIES[`prefer ${name}`] = (c, k) => guess(pool(c, f), k);
  STRATEGIES[`eliminate ${name}`] = (c, k) => guess(pool(c, (s) => !f(s)), k);
}

/** Exact P(at least `need` correct) for independent per-quiz success probabilities. */
const passProbability = (ps: readonly number[], pct = PASS_PCT): number => {
  const n = ps.length;
  let need = 0;
  while (need * 100 < pct * n) need++;
  let dp = [1];
  for (const p of ps) {
    const next = new Array<number>(dp.length + 1).fill(0);
    dp.forEach((v, j) => {
      next[j]! += v * (1 - p);
      next[j + 1]! += v * p;
    });
    dp = next;
  }
  return dp.slice(need).reduce((a, b) => a + b, 0);
};

interface PackQuiz { kind: string; key: string; check?: { answerKey?: number; choices?: string[] } }
const packQuizzes = (pack: string): Array<{ choices: string[]; key: number }> =>
  (JSON.parse(readFileSync(join(QUESTS, pack, 'items.json'), 'utf8')) as { items: PackQuiz[] }).items
    .filter((i) => i.kind === 'quiz' && Array.isArray(i.check?.choices) && typeof i.check?.answerKey === 'number')
    .map((i) => ({ choices: i.check!.choices!, key: i.check!.answerKey! }));

/** The pack's worst blind strategy and its probability of clearing the gate. */
const worstBlindPass = (qs: ReadonlyArray<{ choices: readonly string[]; key: number }>): { strategy: string; p: number } => {
  let worst = { strategy: 'none', p: 0 };
  for (const [name, s] of Object.entries(STRATEGIES)) {
    const p = passProbability(qs.map((q) => s(q.choices, q.key)));
    if (p > worst.p) worst = { strategy: name, p };
  }
  return worst;
};

const PACKS = readdirSync(QUESTS)
  .filter((d) => existsSync(join(QUESTS, d, 'items.json')))
  .filter((d) => packQuizzes(d).length > 0)
  .sort();

describe('blind-pass guard machinery', () => {
  it('passProbability uses the integer 80% rule (8/10 passes, 9/12 does not)', () => {
    expect(passProbability(Array(10).fill(1).map((_, i) => (i < 8 ? 1 : 0)))).toBe(1);
    expect(passProbability(Array(12).fill(1).map((_, i) => (i < 9 ? 1 : 0)))).toBe(0);
    expect(passProbability(Array(5).fill(0.25))).toBeCloseTo(5 * 0.25 ** 4 * 0.75 + 0.25 ** 5, 10);
  });

  it('flags the tells the release reviews named, and not a balanced pack', () => {
    const mk = (key: string, ds: string[]) => ({ choices: [key, ...ds], key: 0 });
    const clauses = Array.from({ length: 12 }, () => mk('It retries, then logs: done', ['It retries once', 'It logs nothing', 'It gives up']));
    expect(worstBlindPass(clauses).p).toBeGreaterThan(MAX_BLIND_PASS);
    const rank2 = Array.from({ length: 12 }, () => mk('a medium answer', ['the longest answer of all', 'short', 'tiny']));
    expect(worstBlindPass(rank2)).toMatchObject({ p: 1 });
    const balanced = Array.from({ length: 12 }, (_, i) => {
      const c = ['Alpha answer here', 'Beta answer here', 'Gamma answer here', 'Delta answer here'];
      return { choices: c, key: i % 4 };
    });
    expect(worstBlindPass(balanced).p).toBeLessThan(MAX_BLIND_PASS);
  });

  it('EXEMPT names only real packs with a ceiling in (MAX_BLIND_PASS, 1]', () => {
    for (const [pack, ceiling] of Object.entries(EXEMPT)) {
      expect(PACKS, pack).toContain(pack);
      expect(ceiling, pack).toBeGreaterThan(MAX_BLIND_PASS);
      expect(ceiling, pack).toBeLessThanOrEqual(1);
    }
  });
});

describe(`no blind strategy clears a stamped quest pack's ${PASS_PCT}% gate with probability > ${MAX_BLIND_PASS}`, () => {
  it('there are packs to judge', () => expect(PACKS.length).toBeGreaterThan(50));
  for (const pack of PACKS) {
    const ceiling = EXEMPT[pack];
    it(ceiling === undefined ? pack : `${pack} (exempt, ceiling ${ceiling})`, () => {
      const w = worstBlindPass(packQuizzes(pack));
      const why = `${pack}: "${w.strategy}" clears the gate with probability ${w.p.toFixed(4)}`;
      if (ceiling === undefined) {
        expect(w.p, why).toBeLessThanOrEqual(MAX_BLIND_PASS);
      } else {
        expect(w.p, `${why}; it now passes, delete its EXEMPT entry`).toBeGreaterThan(MAX_BLIND_PASS);
        expect(w.p, `${why}; worse than its ceiling`).toBeLessThanOrEqual(ceiling);
      }
    });
  }
});
