import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Answer-leak guard for hand-authored quest drafts (campaign 2 act-3 review).
 *
 * Hash-seeded choice order fixes WHERE the key sits, but not a length tell:
 * if the keyed answer is usually the longest choice, "pick the longest" clears
 * the 80% study-quest gate without reading the guides. The same goes for an
 * answer that is usually the shortest, and for a key that is typically much
 * longer or shorter than its rivals (median answer/longest-distractor ratio). This guard covers the drafts that were
 * rebalanced; the older hand packs still carry the pattern (see transplant
 * notes), so the guarded list grows as packs are rebalanced. Do NOT raise the
 * thresholds to admit a pack; rewrite its choices.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const GUARDED = [
  'signalpost-swe-bootcamp',
  'astraboot1',
  'bootlocalopusv2',
  'gitvg-astra',
  'organized-app-grouphelpdesk',
  'organized-build-crmpyjs',
  'lucasrouter',
  '3buildagentteachgem',
  '3buildanalytics',
  'elihyper2',
  'fableopusrecallv2',
  // campaign 2 final wave, REBALANCE-1: hand drafts whose key was the longest
  // choice in 83-100% of quizzes before the rewrite.
  '1jstrain2.2v2',
  'andie',
  'buildgum',
  'buildsubbox',
  'devdeck',
  'dotnet-snapshot1',
  'eliapplybot-extension',
  'finance-dashboard',
  'grok-build-ecommerce',
  'grok-js',
  'grokjs-csharp-learning-lab',
  'grokjs-dotnet-learning-lab',
  'grokjs-grokbuildjs',
  'grokjs-javascript-learning-lab',
  'groktuts-web-dev-upskilling-lab',
  // campaign 2 final wave, rebalance-2 (key was the longest choice in 83-100% of these)
  'jobtrack',
  'js1',
  'jsdrillv2',
  'jsprojectlearn',
  'jstrain2.2',
  'master',
  'masterrnative',
  'mobiletagalog',
  'nettodo',
  'newcodexjs',
  'organized-app-job-track',
  'organized-build-gum',
  'organized-build-subbox',
  'organized-dotnet-pastebin',
  'organized-dotnet-trello',
  // campaign 2 final wave, rebalance-3: these hand drafts keyed the longest choice in 83-100% of quizzes
  'organized-js-training-jsdrill_sync_20260223_125137',
  'organized-js-training-jstrain2',
  'organized-js-training-jstrain2.2',
  'organized-js-training-jstrain2.3',
  'organized-js-training-jstrain3',
  'organized-js-training-react',
  'organized-js-training-trainjs',
  'react',
  'recipegen-app',
  'recipeweb',
  'relay-app',
  'ship-it',
  'trainjs',
  'unionboot',
];
const MAX_LONGEST_SHARE = 0.35;
const MAX_SHORTEST_SHARE = 0.4;
/** Median of answer length / longest-distractor length must sit in this band. */
const MEDIAN_RATIO_MIN = 0.8;
const MEDIAN_RATIO_MAX = 1.2;
/**
 * No single length rank may dominate: if the key is (say) the second-longest choice in most quizzes,
 * "pick the second-longest" becomes the tell (rebalance-3 review: 58% in react and jsdrill_sync).
 * Rank = 1 + number of distractors strictly longer than the key, so ties never count against the guard's author.
 */
const MAX_RANK_SHARE = 0.5;
/**
 * campaign 2 integration (campaign2c): the rebalance-1/-2 drafts were written before the
 * rebalance-3 rank guard existed and fail it on merge. Owned by the release wave.
 * Shrink this list as they are rewritten; never grow it (an entry that passes fails the suite).
 */
const RANK_UNGUARDED = new Set([
  '1jstrain2.2v2',
  'buildgum',
  'finance-dashboard',
  'grokjs-dotnet-learning-lab',
  'grokjs-grokbuildjs',
  'grokjs-javascript-learning-lab',
  'jsdrillv2',
  'master',
  'masterrnative',
]);

/**
 * Format tells (REBALANCE-1 fix pass). A key written as "Verdict: reason" next
 * to distractors written as "Verdict, because reason" leaks just like length
 * does. Each blind strategy below keeps only the choices that have (or lack) a
 * surface feature and guesses among them; its expected score over a draft must
 * stay near chance (0.25 for four choices). An item where every choice, or no
 * choice, has the feature gives the strategy nothing, so it scores 1/n there.
 */
const MAX_FORMAT_SHARE = 0.35;
/**
 * Act-3 GUARDED drafts that still carry a format tell (each beats 0.35 on at
 * least one strategy below); they predate this guard and are out of the
 * REBALANCE-1 scope. Shrink this list as they are rewritten; never grow it.
 */
const FORMAT_UNGUARDED = new Set([
  'signalpost-swe-bootcamp',
  'bootlocalopusv2',
  'gitvg-astra',
  'organized-build-crmpyjs',
  'lucasrouter',
  '3buildagentteachgem',
  '3buildanalytics',
  'elihyper2',
  'fableopusrecallv2',
  // campaign 2 integration (campaign2c): the rebalance-2/-3 drafts were written before the
  // REBALANCE-1 format guard existed and fail it on merge. Owned by the release wave.
  'jobtrack',
  'js1',
  'jsdrillv2',
  'jsprojectlearn',
  'jstrain2.2',
  'master',
  'masterrnative',
  'mobiletagalog',
  'nettodo',
  'newcodexjs',
  'organized-app-job-track',
  'organized-build-gum',
  'organized-dotnet-pastebin',
  'organized-dotnet-trello',
  'organized-js-training-jstrain2',
  'organized-js-training-jstrain2.2',
  'organized-js-training-jstrain2.3',
  'organized-js-training-react',
  'organized-js-training-trainjs',
  'recipegen-app',
  'recipeweb',
  'relay-app',
  'ship-it',
  'trainjs',
]);
/** "Verdict: reason": a colon + space early in the choice, outside code braces/brackets. */
const colonLed = (s: string): boolean => /^[^{[]{1,60}?:\s/.test(s);
const causal = (s: string): boolean => /\b(because|since)\b/i.test(s);
const absolute = (s: string): boolean =>
  /\b(always|never|only|all|every|none|no|any|must|cannot|entirely|completely|whole)\b/i.test(s);
const semicolon = (s: string): boolean => s.includes(';');

/** Expected score of "guess uniformly among the choices that pass `keep`". */
const keepScore = (q: DraftQuiz, keep: (s: string) => boolean): number => {
  const choices = [q.answer, ...q.distractors];
  let pool = choices.filter(keep);
  if (pool.length === 0) pool = choices;
  return pool.includes(q.answer) ? 1 / pool.length : 0;
};
/** The reviewer's combined strategy: drop because/since choices, then prefer colon-led ones. */
const comboScore = (q: DraftQuiz): number => {
  const choices = [q.answer, ...q.distractors];
  let pool = choices.filter((c) => !causal(c));
  if (pool.length === 0) pool = choices;
  const colon = pool.filter(colonLed);
  if (colon.length > 0) pool = colon;
  return pool.includes(q.answer) ? 1 / pool.length : 0;
};
const FORMAT_STRATEGIES: Array<[string, (q: DraftQuiz) => number]> = [];
for (const [name, f] of [['colon-led', colonLed], ['because/since', causal], ['absolute-word', absolute], ['semicolon', semicolon]] as const) {
  FORMAT_STRATEGIES.push([`prefer ${name}`, (q) => keepScore(q, f)]);
  FORMAT_STRATEGIES.push([`eliminate ${name}`, (q) => keepScore(q, (s) => !f(s))]);
}
FORMAT_STRATEGIES.push(['drop because/since then prefer colon-led', comboScore]);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface DraftQuiz { id: string; kind: 'quiz'; answer: string; distractors: string[] }
interface PackQuiz { kind: string; label?: string; check: { answerKey: number }; choices: unknown[] }

const quizzes = (repo: string): DraftQuiz[] => {
  const d = JSON.parse(readFileSync(join(ROOT, 'content', 'seed-drafts', 'quests', `${repo}.json`), 'utf8')) as { items: Array<{ kind: string }> };
  return d.items.filter((i): i is DraftQuiz => i.kind === 'quiz');
};

describe('hand-authored quiz drafts do not leak the key by length or position', () => {
  for (const repo of GUARDED) {
    it(`${repo}: answer is rarely the strictly longest or shortest choice`, () => {
      const qs = quizzes(repo);
      expect(qs.length).toBeGreaterThanOrEqual(10);
      const longest = qs.filter((q) => q.answer.length > Math.max(...q.distractors.map((d) => d.length)));
      const shortest = qs.filter((q) => q.answer.length < Math.min(...q.distractors.map((d) => d.length)));
      expect(longest.length / qs.length, `longest: ${longest.map((q) => q.id).join(', ')}`).toBeLessThanOrEqual(MAX_LONGEST_SHARE);
      expect(shortest.length / qs.length, `shortest: ${shortest.map((q) => q.id).join(', ')}`).toBeLessThanOrEqual(MAX_SHORTEST_SHARE);
    });

    it(`${repo}: the key is about as long as its longest distractor (median ratio)`, () => {
      const ratios = quizzes(repo).map((q) => q.answer.length / Math.max(...q.distractors.map((d) => d.length)));
      const m = median(ratios);
      expect(m).toBeGreaterThanOrEqual(MEDIAN_RATIO_MIN);
      expect(m).toBeLessThanOrEqual(MEDIAN_RATIO_MAX);
    });

    const formatWorst = (): number => {
      const qs = quizzes(repo);
      return Math.max(...FORMAT_STRATEGIES.map(([, score]) => qs.reduce((acc, q) => acc + score(q), 0) / qs.length));
    };
    if (FORMAT_UNGUARDED.has(repo)) {
      it(`${repo}: still carries its known format tell (remove it from FORMAT_UNGUARDED once fixed)`, () => {
        expect(formatWorst()).toBeGreaterThan(MAX_FORMAT_SHARE);
      });
    }
    if (!FORMAT_UNGUARDED.has(repo)) {
      it(`${repo}: no phrasing or format tell beats chance (colon / because / absolute / semicolon)`, () => {
        const qs = quizzes(repo);
        for (const [name, score] of FORMAT_STRATEGIES) {
          const s = qs.reduce((acc, q) => acc + score(q), 0) / qs.length;
          expect(s, `strategy "${name}" scores ${s.toFixed(2)}`).toBeLessThanOrEqual(MAX_FORMAT_SHARE);
        }
      });
    }

    const rankShare = (): number => {
      const qs = quizzes(repo);
      const byRank = new Map<number, number>();
      for (const q of qs) {
        const rank = 1 + q.distractors.filter((d) => d.length > q.answer.length).length;
        byRank.set(rank, (byRank.get(rank) ?? 0) + 1);
      }
      return Math.max(...byRank.values()) / qs.length;
    };
    if (!RANK_UNGUARDED.has(repo)) {
      it(`${repo}: no single key-length rank holds most quizzes`, () => {
        const qs = quizzes(repo);
        const byRank = new Map<number, string[]>();
        for (const q of qs) {
          const rank = 1 + q.distractors.filter((d) => d.length > q.answer.length).length;
          byRank.set(rank, [...(byRank.get(rank) ?? []), q.id]);
        }
        for (const [rank, ids] of byRank) {
          expect(ids.length / qs.length, `key is length rank ${rank} in: ${ids.join(', ')}`).toBeLessThanOrEqual(MAX_RANK_SHARE);
        }
      });
    } else {
      it(`${repo}: still carries its known rank tell (remove it from RANK_UNGUARDED once fixed)`, () => {
        expect(rankShare()).toBeGreaterThan(MAX_RANK_SHARE);
      });
    }

    it(`${repo}: the stamped pack uses every answer slot`, () => {
      const pack = JSON.parse(readFileSync(join(ROOT, 'content', 'seed', 'quests', repo, 'items.json'), 'utf8')) as { items: PackQuiz[] };
      const qs = pack.items.filter((i) => i.kind === 'quiz');
      const width = Math.min(...qs.map((q) => q.choices.length));
      const used = new Set(qs.map((q) => q.check.answerKey));
      for (let slot = 0; slot < width; slot++) expect(used.has(slot), `slot ${slot} never keyed`).toBe(true);
    });
  }
});

describe('format-tell strategies detect the tells they name', () => {
  const mk = (answer: string, distractors: string[]): DraftQuiz => ({ id: 'x', kind: 'quiz', answer, distractors });
  const score = (name: string, qs: DraftQuiz[]): number => {
    const s = FORMAT_STRATEGIES.find(([n]) => n === name);
    if (!s) throw new Error(`no strategy ${name}`);
    return qs.reduce((acc, q) => acc + s[1](q), 0) / qs.length;
  };
  // The REBALANCE-1 review's shape: "Verdict: reason" keys, "Verdict, because reason" distractors.
  const leaky = Array.from({ length: 10 }, () =>
    mk('400 Validation failed: PUT parses with the create schema', [
      '200 with the task updated, since PUT accepts partial bodies',
      '404 Task not found, because the service swallows the error',
      '500 Failed to update task, because the column is unknown',
    ]),
  );
  const uniform = Array.from({ length: 10 }, () =>
    mk('400 Validation failed: PUT parses with the create schema', [
      '200 with the task updated: PUT accepts partial bodies',
      '404 Task not found: the service swallows the error',
      '500 Failed to update task: the column is unknown',
    ]),
  );

  it('scores a colon-key / because-distractor draft far above the cap', () => {
    expect(score('prefer colon-led', leaky)).toBe(1);
    expect(score('eliminate because/since', leaky)).toBe(1);
    expect(score('drop because/since then prefer colon-led', leaky)).toBe(1);
  });

  it('scores a uniformly framed draft at chance', () => {
    for (const [name] of FORMAT_STRATEGIES) expect(score(name, uniform)).toBeCloseTo(0.25);
  });

  it('does not read a colon inside a code object literal as a verdict frame', () => {
    expect(colonLed('Status 200 with { data: deletedTask }')).toBe(false);
    expect(colonLed('Nowhere: it is defined but never used')).toBe(true);
  });
});
