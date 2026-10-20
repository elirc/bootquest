/**
 * Pack-level answer-tell, leak and secret guards — IN THE STAMP PATH.
 *
 * Until the stamp-guards fix these lived only in vitest (ops/blind-pass.test.ts,
 * drafts/quiz-balance.test.ts) or in a manual lint (seed:lint:answers), so a re-seeded pack with
 * a tell could be stamped and served whenever `npm test` was skipped. Now ONE implementation
 * runs from:
 *   - writeSeedPack (every generator): a failure is a stamp blocker (no validation.json);
 *   - seed:check and seed:check --restamp (restamp:all): a failure is a pack problem (FAIL, no
 *     restamp);
 *   - the vitest suites (they import these functions instead of carrying their own math);
 *   - seed:lint:leaks (the explain-back key-point leak lint over the whole estate).
 * This file sits at the top of tools/seed/src/factory, so it is part of EVERY seed fingerprint:
 * changing a guard makes every stamp stale, exactly like changing a validator.
 *
 * Guards per pack (generator):
 *   quests      blind-pass (no blind strategy clears the 80% study-quest gate with p > 0.02),
 *               quiz-balance (length / rank / format / slot tells over the pack's quizzes),
 *               explanation-lint (no generator-label artifact as a quiz explanation);
 *   explainback no key point (text or quote) leaks a keyed answer of a same-repo quest pack;
 *   every pack  secret scan over ALL shipped text (every string in every item, the registry's
 *               secretPatterns — the same scanner every generator runs over its inputs).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedExplainBackItem, SeedGenerator, SeedItem, SeedQuizItem } from '@bootquest/shared';
import type { Exclusions } from './exclusions.ts';
import { leakMatchPrepared, prepareLeakKey, prepareLeakText, type LeakMatchOptions, type LeakText } from './leak.ts';

// =====================================================================================
// blind-pass (moved from ops/blind-pass.test.ts; that suite now calls these)
// =====================================================================================

/**
 * For every blind strategy: the exact probability that a learner who answers each quiz by that
 * strategy alone (guessing uniformly among the choices it keeps) clears the pack's 80% gate. It
 * must stay <= MAX_BLIND_PASS. Measured at introduction over the 107 stamped packs: with the real
 * keys 12 packs exceeded it; with the same choices and RANDOM keys (5 seeds) at most 1 pack
 * exceeded even 0.01, so a failure is a real tell, not small-sample noise. The served choice order
 * is shuffled per database, so position is not a strategy here.
 */
/** The study-quest gate (server/src/store/study-quests.ts: passPct 0.8; integer rule of meetsCorePct). */
export const PASS_PCT = 80;
export const MAX_BLIND_PASS = 0.02;

/**
 * pack -> ceiling on its current worst probability. An exempt pack must still exceed the cap
 * (delete the entry once fixed) and must not get worse than its ceiling. Do NOT raise
 * MAX_BLIND_PASS or a ceiling to admit a pack; rewrite its choices.
 */
export const BLIND_PASS_EXEMPT: Readonly<Record<string, number>> = {};

export interface BlindQuiz {
  choices: readonly string[];
  key: number;
}
type Strategy = (choices: readonly string[], key: number) => number;

const words = (s: string): number => s.trim().split(/\s+/).length;
export const BLIND_FEATURES: Readonly<Record<string, (s: string) => boolean>> = {
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
const F = BLIND_FEATURES as Record<string, (s: string) => boolean>;

/** The indices `keep` keeps (all of them when it keeps none). */
const pool = (choices: readonly string[], keep: (s: string) => boolean): number[] => {
  const kept = choices.map((_, i) => i).filter((i) => keep(choices[i]!));
  return kept.length > 0 ? kept : choices.map((_, i) => i);
};
const guess = (idx: number[], key: number): number => (idx.includes(key) ? 1 / idx.length : 0);
/** Guess among the choices that maximise `metric`. */
const maxBy =
  (metric: (s: string) => number): Strategy =>
  (choices, key) => {
    const v = choices.map(metric);
    const top = Math.max(...v);
    return guess(
      v.map((_, i) => i).filter((i) => v[i] === top),
      key,
    );
  };

export const BLIND_STRATEGIES: Readonly<Record<string, Strategy>> = (() => {
  const s: Record<string, Strategy> = {
    'longest (chars)': maxBy((x) => x.length),
    'shortest (chars)': maxBy((x) => -x.length),
    'most words': maxBy(words),
    'fewest words': maxBy((x) => -words(x)),
    'most clause marks': maxBy((x) => (x.match(/[,:;]/g) ?? []).length),
    'drop because/since, then prefer colon-led': (c, k) => {
      const a = pool(c, (x) => !F['because/since']!(x));
      const b = a.filter((i) => F['colon-led']!(c[i]!));
      return guess(b.length > 0 ? b : a, k);
    },
    'drop because/since, then prefer comma': (c, k) => {
      const a = pool(c, (x) => !F['because/since']!(x));
      const b = a.filter((i) => F.comma!(c[i]!));
      return guess(b.length > 0 ? b : a, k);
    },
    'prefer comma, then most words': (c, k) => {
      const a = pool(c, F.comma!);
      const top = Math.max(...a.map((i) => words(c[i]!)));
      return guess(
        a.filter((i) => words(c[i]!) === top),
        k,
      );
    },
  };
  /** "Pick the choice at length rank r" (rank = 1 + choices strictly longer; ties share a rank). */
  for (const rank of [2, 3]) {
    s[`length rank ${rank}`] = (c, k) => {
      const rankOf = (x: number) => 1 + c.filter((y) => y.length > x).length;
      return guess(
        c.map((_, i) => i).filter((i) => rankOf(c[i]!.length) === rank),
        k,
      );
    };
  }
  for (const [name, f] of Object.entries(F)) {
    s[`prefer ${name}`] = (c, k) => guess(pool(c, f), k);
    s[`eliminate ${name}`] = (c, k) => guess(pool(c, (x) => !f(x)), k);
  }
  return s;
})();

/** Exact P(at least `need` correct) for independent per-quiz success probabilities. */
export function passProbability(ps: readonly number[], pct = PASS_PCT): number {
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
}

/** The pack's worst blind strategy and its probability of clearing the gate. */
export function worstBlindPass(qs: readonly BlindQuiz[]): { strategy: string; p: number } {
  let worst = { strategy: 'none', p: 0 };
  for (const [name, s] of Object.entries(BLIND_STRATEGIES)) {
    const p = passProbability(qs.map((q) => s(q.choices, q.key)));
    if (p > worst.p) worst = { strategy: name, p };
  }
  return worst;
}

/** Choice-graded quizzes of a pack's items (the choices the learner is served, the keyed index). */
export function blindQuizzes(items: readonly SeedItem[]): BlindQuiz[] {
  return items
    .filter((i): i is SeedQuizItem => i.kind === 'quiz')
    .filter((q) => Array.isArray(q.check.choices) && typeof q.check.answerKey === 'number')
    .map((q) => ({ choices: q.check.choices!, key: q.check.answerKey as number }));
}

/** null when the pack passes (or is a still-failing exempt pack within its ceiling), else why not. */
export function blindPassProblem(pack: string, qs: readonly BlindQuiz[], exempt: Readonly<Record<string, number>> = BLIND_PASS_EXEMPT): string | null {
  if (qs.length === 0) return Object.hasOwn(exempt, pack) ? `blind-pass: ${pack} is BLIND_PASS_EXEMPT but has no choice quizzes (delete the entry)` : null;
  const w = worstBlindPass(qs);
  const why = `blind-pass: strategy "${w.strategy}" clears the ${PASS_PCT}% gate with probability ${w.p.toFixed(4)}`;
  const ceiling = exempt[pack];
  if (ceiling === undefined) return w.p <= MAX_BLIND_PASS ? null : `${why} (> ${MAX_BLIND_PASS}; rewrite the choices)`;
  if (w.p <= MAX_BLIND_PASS) return `${why}: it now passes, delete its BLIND_PASS_EXEMPT entry`;
  if (w.p > ceiling) return `${why}: worse than its BLIND_PASS_EXEMPT ceiling ${ceiling}`;
  return null;
}

// =====================================================================================
// quiz-balance (moved from drafts/quiz-balance.test.ts; that suite now calls these)
// =====================================================================================

/**
 * Hash-seeded choice order fixes WHERE the key sits, but not a length tell: if the keyed answer
 * is usually the longest choice, "pick the longest" clears the gate without reading the guides.
 * The same goes for the shortest, a key typically much longer / shorter than its rivals (median
 * answer / longest-distractor ratio), a key that keeps the same length RANK, a phrasing / format
 * frame only the key uses, and a pack that never keys some answer slot.
 */
export const MAX_LONGEST_SHARE = 0.35;
/** campaign 2 review F2: the shortest-choice tell (ankijs 0.42, ...) is guarded too. */
export const MAX_SHORTEST_SHARE = 0.4;
/** Median of answer length / longest-distractor length must sit in this band. */
export const MEDIAN_RATIO_MIN = 0.8;
export const MEDIAN_RATIO_MAX = 1.2;
/** No single length rank may dominate (rank = 1 + distractors strictly longer than the key). */
export const MAX_RANK_SHARE = 0.5;
/** Each format strategy's expected score must stay near chance (0.25 for four choices). */
export const MAX_FORMAT_SHARE = 0.35;
/**
 * The share caps are noisy on a handful of quizzes (the draft suite requires >= 10 per draft), so
 * the pack-level guard judges only packs with at least this many quizzes; blind-pass, whose exact
 * probability needs no sample-size floor, covers every pack.
 */
export const QUIZ_BALANCE_MIN_QUIZZES = 10;

export const BALANCE_GUARDS = ['longest', 'shortest', 'median-ratio', 'rank', 'format', 'slots'] as const;
export type BalanceGuard = (typeof BALANCE_GUARDS)[number];

/**
 * STAMPED quest pack -> the guards it currently FAILS when judged over ALL its quizzes (what the
 * learner is served: generator + hand-authored). An exempt guard must still fail (so the map can
 * only shrink) and a guard not listed must pass. Do NOT raise a threshold or add an exemption to
 * admit a pack; rewrite its choices and re-seed.
 *
 * Seeded 2026-10-19 when the guard moved into the stamp path: before that quiz-balance judged only
 * the HAND quizzes of content/seed-drafts/quests drafts, so the six `quests-authored.ts` packs
 * (borrowbox, csbootcamp, csharp-interview, csharp-tut, ...) were never balance-checked at all, and
 * a drafts pack whose generator quizzes skew the mix (gitjira, nettrello, react, ...) passed on its
 * hand quizzes alone. The ten packs seeded here (borrowbox, csbootcamp, csharp-interview,
 * csharp-tut, gitjira, nettrello, organized-experiment-support-hub, organized-study-atlas-fulfillment,
 * organized-study-support-desk-crm, react) were fixed the same day by the fix/content-leaks pass:
 * their hand-authored DISTRACTORS were rewritten (length, rank parity, format frames; no keyed answer
 * changed) and each pack re-seeded. Keep it empty.
 */
export const QUIZ_BALANCE_EXEMPT: Readonly<Record<string, readonly BalanceGuard[]>> = {};

export interface BalanceQuiz {
  id: string;
  answer: string;
  distractors: readonly string[];
}
/** A quiz as stored in a pack: its choice count and keyed slot (the `slots` guard). */
export interface SlotQuiz {
  width: number;
  answerKey: number;
}

/** "Verdict: reason": a colon + space early in the choice, outside code braces/brackets. */
export const colonLed = (s: string): boolean => F['colon-led']!(s);
const causal = F['because/since']!;
const absolute = F['absolute-word']!;
const semicolon = F.semicolon!;

/** Expected score of "guess uniformly among the choices that pass `keep`". */
const keepScore = (q: BalanceQuiz, keep: (s: string) => boolean): number => {
  const choices = [q.answer, ...q.distractors];
  let p = choices.filter(keep);
  if (p.length === 0) p = choices;
  return p.includes(q.answer) ? 1 / p.length : 0;
};
/** The reviewer's combined strategy: drop because/since choices, then prefer colon-led ones. */
const comboScore = (q: BalanceQuiz): number => {
  const choices = [q.answer, ...q.distractors];
  let p = choices.filter((c) => !causal(c));
  if (p.length === 0) p = choices;
  const colon = p.filter(colonLed);
  if (colon.length > 0) p = colon;
  return p.includes(q.answer) ? 1 / p.length : 0;
};
export const FORMAT_STRATEGIES: ReadonlyArray<readonly [string, (q: BalanceQuiz) => number]> = (() => {
  const out: Array<readonly [string, (q: BalanceQuiz) => number]> = [];
  for (const [name, f] of [['colon-led', colonLed], ['because/since', causal], ['absolute-word', absolute], ['semicolon', semicolon]] as const) {
    out.push([`prefer ${name}`, (q) => keepScore(q, f)]);
    out.push([`eliminate ${name}`, (q) => keepScore(q, (s) => !f(s))]);
  }
  out.push(['drop because/since then prefer colon-led', comboScore]);
  return out;
})();

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pct = (x: number) => x.toFixed(2);
const keyRank = (q: BalanceQuiz) => 1 + q.distractors.filter((d) => d.length > q.answer.length).length;

/** Each guard: null when the quizzes pass, else why they fail. `slots` judges the stored packs' quizzes. */
export function balanceGuard(guard: BalanceGuard, qs: readonly BalanceQuiz[], slots: readonly SlotQuiz[]): string | null {
  switch (guard) {
    case 'longest': {
      const hit = qs.filter((q) => q.answer.length > Math.max(...q.distractors.map((d) => d.length)));
      const share = hit.length / qs.length;
      return share <= MAX_LONGEST_SHARE ? null : `key strictly longest in ${hit.length}/${qs.length} (${pct(share)} > ${MAX_LONGEST_SHARE}): ${hit.map((q) => q.id).join(', ')}`;
    }
    case 'shortest': {
      const hit = qs.filter((q) => q.answer.length < Math.min(...q.distractors.map((d) => d.length)));
      const share = hit.length / qs.length;
      return share <= MAX_SHORTEST_SHARE ? null : `key strictly shortest in ${hit.length}/${qs.length} (${pct(share)} > ${MAX_SHORTEST_SHARE}): ${hit.map((q) => q.id).join(', ')}`;
    }
    case 'median-ratio': {
      const m = median(qs.map((q) => q.answer.length / Math.max(...q.distractors.map((d) => d.length))));
      return m >= MEDIAN_RATIO_MIN && m <= MEDIAN_RATIO_MAX ? null : `median key/longest-distractor ratio ${pct(m)} outside [${MEDIAN_RATIO_MIN}, ${MEDIAN_RATIO_MAX}]`;
    }
    case 'rank': {
      const byRank = new Map<number, string[]>();
      for (const q of qs) byRank.set(keyRank(q), [...(byRank.get(keyRank(q)) ?? []), q.id]);
      const [rank, ids] = [...byRank].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0]!;
      return ids.length / qs.length <= MAX_RANK_SHARE ? null : `key is length rank ${rank} in ${ids.length}/${qs.length} (> ${MAX_RANK_SHARE}): ${ids.join(', ')}`;
    }
    case 'format': {
      const bad = FORMAT_STRATEGIES.map(([name, score]) => [name, qs.reduce((acc, q) => acc + score(q), 0) / qs.length] as const).filter(([, s]) => s > MAX_FORMAT_SHARE);
      return bad.length === 0 ? null : `format strategies beat chance: ${bad.map(([n, s]) => `"${n}" ${pct(s)}`).join(', ')} (> ${MAX_FORMAT_SHARE})`;
    }
    case 'slots': {
      if (slots.length === 0) return null;
      const width = Math.min(...slots.map((q) => q.width));
      const used = new Set(slots.map((q) => q.answerKey));
      const missing = Array.from({ length: width }, (_, s) => s).filter((s) => !used.has(s));
      return missing.length === 0 ? null : `stamped pack never keys answer slot(s) ${missing.join(', ')}`;
    }
  }
}

/** A pack's quizzes in balance form (key text vs distractor texts) and slot form. */
export function balanceQuizzes(items: readonly SeedItem[]): { quizzes: BalanceQuiz[]; slots: SlotQuiz[] } {
  const qs = items
    .filter((i): i is SeedQuizItem => i.kind === 'quiz')
    .filter((q) => Array.isArray(q.check.choices) && typeof q.check.answerKey === 'number');
  return {
    quizzes: qs.map((q) => {
      const k = q.check.answerKey as number;
      return { id: q.key.split('/').pop()!, answer: q.check.choices![k]!, distractors: q.check.choices!.filter((_, i) => i !== k) };
    }),
    slots: qs.map((q) => ({ width: q.check.choices!.length, answerKey: q.check.answerKey as number })),
  };
}

/** Every quiz-balance problem of one pack / draft, honouring (and policing) its exemptions. */
export function quizBalanceProblems(name: string, qs: readonly BalanceQuiz[], slots: readonly SlotQuiz[], exempt: Readonly<Record<string, readonly BalanceGuard[]>> = QUIZ_BALANCE_EXEMPT): string[] {
  const ex = new Set(exempt[name] ?? []);
  const out: string[] = [];
  for (const g of BALANCE_GUARDS) {
    const why = balanceGuard(g, qs, slots);
    if (ex.has(g) && why === null) out.push(`quiz-balance ${g}: ${name} now passes; delete its QUIZ_BALANCE_EXEMPT entry`);
    else if (!ex.has(g) && why !== null) out.push(`quiz-balance ${g}: ${why}`);
  }
  return out;
}

// =====================================================================================
// explanation-lint (campaign 2 review F5; moved from ops/explanation-lint.ts, which re-exports it)
// =====================================================================================

/** The F5 shape (`^\d+ \(.*item\)$`), its two sibling label leaks, and a bare finding number ("3"). */
export const ARTIFACT_EXPLANATION_PATTERNS: readonly RegExp[] = [/^\d+ \(.*item\)$/, /^- \(.*item\)$/, /^goal \d+$/i, /^\d+$/];

/** quest pack name -> why it is exempt for now. Empty: no pack carries an artifact explanation. */
export const EXPLANATION_LINT_EXEMPT: Readonly<Record<string, string>> = {};

export const isArtifactExplanation = (s: string | undefined): boolean => ARTIFACT_EXPLANATION_PATTERNS.some((re) => re.test((s ?? '').trim()));

/** quiz keys whose explanation is a generator-label artifact */
export const artifactExplanationKeys = (items: readonly { kind?: string; key?: string; explanation?: string }[]): string[] =>
  items.filter((i) => i.kind === 'quiz' && isArtifactExplanation(i.explanation)).map((i) => i.key ?? '?');

export function explanationLintProblem(pack: string, items: readonly SeedItem[], exempt: Readonly<Record<string, string>> = EXPLANATION_LINT_EXEMPT): string | null {
  const keys = artifactExplanationKeys(items as readonly { kind?: string; key?: string; explanation?: string }[]);
  const isExempt = Object.hasOwn(exempt, pack);
  if (keys.length && !isExempt) return `explanation-lint: ${keys.length} quiz explanation(s) are generator label artifacts: ${keys.join(', ')}`;
  if (!keys.length && isExempt) return `explanation-lint: ${pack} is EXPLANATION_LINT_EXEMPT but has no artifact explanation left (delete the entry)`;
  return null;
}

// =====================================================================================
// secret scan over shipped text
// =====================================================================================

/** Every string in a value (object keys included), depth-first. */
export function shippedStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) shippedStrings(x, out);
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      shippedStrings(x, out);
    }
  }
  return out;
}

/** "<item key>: <pattern ids>" for every shipped item whose text matches a secret pattern (never the match itself). */
export function shippedSecretProblems(ex: Exclusions, items: readonly SeedItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const ids = [...new Set(shippedStrings(it).flatMap((s) => ex.scan(s)))].sort();
    if (ids.length) out.push(`secret-scan: ${it.key} ships text matching secret pattern(s) ${ids.join(', ')} (redact/revoke at the source; a shipped item may never carry one)`);
  }
  return out;
}

// =====================================================================================
// explain-back key points vs same-repo quiz keys
// =====================================================================================

/**
 * An explain-back key point (and its quote) is shown after the explain-back answer; a key point
 * that restates a same-repo quiz's KEYED answer hands that quiz to anyone who opens the explain-back
 * first. Same token rules as noteLeaks (leak.ts). Threshold tuned on the 2026-10-19 estate scan:
 * 0.6 (the review's first guess) misses evident restatements at 0.50-0.57 (ww35 "midnight reads as
 * 00", finance-dashboard "shallow copy would mutate", andie "re-exports both stores"), so it is the
 * notes rule's 0.5. Key-size floors (the one deviation from noteLeaks, which judges a reading
 * against EVERY key at any size): `contains` needs a key of >= 3 tokens and the Jaccard rule a key
 * of >= 4, because on 1-3 token keys a single shared token already scores 0.5-1.0 ("throw;" vs a
 * quote about tasks that throw, "July 12-14" vs "July 10 through July 12"). Short keys stay a
 * human-review item (a quote "200 for an identical replay" vs the key "200" is not caught).
 */
export const EB_LEAK_JACCARD = 0.5;
export const EB_LEAK_OPTIONS: LeakMatchOptions = { minContainTokens: 3, minOverlapTokens: 4 };

export interface KeyedQuiz {
  /** quest pack name */
  pack: string;
  key: string;
  answer: string;
}

export interface ExplainBackLeak {
  item: string;
  /** q<i>.kp<j> (text) or q<i>.kp<j>.quote */
  where: string;
  pack: string;
  quiz: string;
  kind: 'contains' | 'overlap';
  score: number;
  text: string;
  answer: string;
}

export function explainBackKeyLeaks(item: SeedExplainBackItem, quizzes: readonly KeyedQuiz[]): ExplainBackLeak[] {
  const out: ExplainBackLeak[] = [];
  const keys = quizzes.map((z) => prepareLeakKey(z.answer));
  item.questions.forEach((q, qi) =>
    q.keyPoints.forEach((kp, ki) => {
      const fields: Array<[string, string, LeakText]> = [[`q${qi + 1}.kp${ki + 1}`, kp.text, prepareLeakText(kp.text)]];
      if (kp.quote !== undefined) fields.push([`q${qi + 1}.kp${ki + 1}.quote`, kp.quote, prepareLeakText(kp.quote)]);
      for (const [zi, z] of quizzes.entries()) {
        for (const [where, text, prepared] of fields) {
          const m = leakMatchPrepared(prepared, keys[zi]!, EB_LEAK_JACCARD, EB_LEAK_OPTIONS);
          if (m) {
            out.push({ item: item.key, where, pack: z.pack, quiz: z.key, kind: m.kind, score: m.score, text, answer: z.answer });
            break;
          }
        }
      }
    }),
  );
  return out;
}

/** The id an exemption names: "<q.kp[.quote]> <quest pack>/<quiz short key>". */
export const explainBackLeakId = (l: Pick<ExplainBackLeak, 'where' | 'pack' | 'quiz'>): string => `${l.where} ${l.pack}/${l.quiz.split('/').pop()}`;

export const formatExplainBackLeak = (l: ExplainBackLeak): string =>
  `eb-leak: ${l.where} ${l.kind === 'contains' ? 'contains' : `overlaps (token-Jaccard ${l.score.toFixed(2)} >= ${EB_LEAK_JACCARD})`} the keyed answer of quests/${l.pack} quiz ${l.quiz.split('/').pop()}: "${l.text.slice(0, 80)}" ~ "${l.answer.slice(0, 80)}"`;

/**
 * explain-back pack -> the leak ids (explainBackLeakId) it ships TODAY. seed:check tolerates exactly
 * these (so the estate still restamps while a content agent rewrites them) and FAILS on any other
 * leak and on an exemption that no longer fires (the map only shrinks). `npm run seed:lint:leaks`
 * lists every leak, exempt or not. Do NOT add an entry to admit a new leak; rewrite the key point.
 */
export const EB_LEAK_EXEMPT: Readonly<Record<string, readonly string[]>> = {
  // seeded 2026-10-19 with 24 leaks in 16 packs when the guard landed; emptied the same day by the
  // fix/content-leaks content pass (each key point rewritten in its draft and the pack re-seeded).
};

/** A pack's explain-back leak problems, honouring (and policing) EB_LEAK_EXEMPT. */
export function explainBackLeakProblems(pack: string, leaks: readonly ExplainBackLeak[], exempt: Readonly<Record<string, readonly string[]>> = EB_LEAK_EXEMPT): string[] {
  const allowed = new Set(exempt[pack] ?? []);
  const seen = new Set(leaks.map(explainBackLeakId));
  return [
    ...leaks.filter((l) => !allowed.has(explainBackLeakId(l))).map(formatExplainBackLeak),
    ...[...allowed].filter((id) => !seen.has(id)).map((id) => `eb-leak: EB_LEAK_EXEMPT names "${id}" for ${pack} but it no longer leaks (delete it)`),
  ];
}

/**
 * repo -> keyed answers of every quest pack under <seedDir>/quests (one parse of the estate; seed:check
 * and seed:lint:leaks build it once per run and judge every explain-back pack against it).
 */
export function keyedQuizIndex(seedDir: string): Map<string, KeyedQuiz[]> {
  const dir = join(seedDir, 'quests');
  if (!existsSync(dir)) return new Map();
  const packs = readdirSync(dir)
    .sort()
    .map((name) => ({ name, pd: join(dir, name) }))
    .filter(({ pd }) => statSync(pd).isDirectory() && existsSync(join(pd, 'manifest.json')) && existsSync(join(pd, 'items.json')));
  const byRepo = new Map<string, KeyedQuiz[]>();
  for (const { name, pd } of packs) {
    const repo = (JSON.parse(readFileSync(join(pd, 'manifest.json'), 'utf8')) as { source?: { repo?: string } }).source?.repo;
    if (!repo) continue;
    const items = (JSON.parse(readFileSync(join(pd, 'items.json'), 'utf8')) as { items?: SeedItem[] }).items ?? [];
    const out = byRepo.get(repo) ?? [];
    for (const q of items) {
      if (q.kind !== 'quiz') continue;
      const choices = q.check.choices ?? q.choices.map((c) => c.text);
      const answer = typeof q.check.answerKey === 'number' ? choices[q.check.answerKey] : q.check.answerKey;
      if (answer) out.push({ pack: name, key: q.key, answer });
    }
    byRepo.set(repo, out);
  }
  return byRepo;
}

/** The keyed answers of every quest pack under <seedDir>/quests whose manifest source.repo is `repo`. */
export function sameRepoKeyedQuizzes(seedDir: string, repo: string): KeyedQuiz[] {
  return keyedQuizIndex(seedDir).get(repo) ?? [];
}

// =====================================================================================
// the per-pack entry point (writeSeedPack + seed:check)
// =====================================================================================

export interface PackGuardInput {
  generator: SeedGenerator;
  name: string;
  /** manifest source.repo */
  repo: string;
  items: readonly SeedItem[];
  ex: Exclusions;
  /**
   * The seed root (content/seed) the pack belongs to: explain-back packs are judged against the
   * quest packs under <seedRoot>/quests with the same source repo. null: no estate to compare
   * against (the explain-back leak guard then has nothing to check).
   */
  seedRoot: string | null;
  /** a prebuilt keyedQuizIndex(seedRoot) (seed:check builds one per run); default: built here */
  questIndex?: ReadonlyMap<string, readonly KeyedQuiz[]>;
}

/** Every guard failure of one pack, each prefixed with the guard's name. Empty = the guards vouch for it. */
export function packGuardProblems(p: PackGuardInput): string[] {
  const out: string[] = [...shippedSecretProblems(p.ex, p.items)];
  if (p.generator === 'quests') {
    const bp = blindPassProblem(p.name, blindQuizzes(p.items));
    if (bp) out.push(bp);
    const { quizzes, slots } = balanceQuizzes(p.items);
    if (quizzes.length >= QUIZ_BALANCE_MIN_QUIZZES) out.push(...quizBalanceProblems(p.name, quizzes, slots));
    else if (Object.hasOwn(QUIZ_BALANCE_EXEMPT, p.name)) out.push(`quiz-balance: ${p.name} is QUIZ_BALANCE_EXEMPT but has fewer than ${QUIZ_BALANCE_MIN_QUIZZES} quizzes (delete the entry)`);
    const el = explanationLintProblem(p.name, p.items);
    if (el) out.push(el);
  }
  if (p.generator === 'explainback') {
    const quizzes = p.questIndex?.get(p.repo) ?? (p.seedRoot !== null && !p.questIndex ? sameRepoKeyedQuizzes(p.seedRoot, p.repo) : []);
    const leaks = p.items.flatMap((it) => (it.kind === 'explain-back' ? explainBackKeyLeaks(it, quizzes) : []));
    out.push(...explainBackLeakProblems(p.name, leaks));
  }
  return out;
}
