import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Answer-leak guard for hand-authored quest drafts (campaign 2 act-3 review).
 *
 * Hash-seeded choice order fixes WHERE the key sits, but not a length tell:
 * if the keyed answer is usually the longest choice, "pick the longest" clears
 * the 80% study-quest gate without reading the guides. The same goes for an
 * answer that is usually the shortest. This guard covers the drafts that were
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
];
const MAX_LONGEST_SHARE = 0.35;
const MAX_SHORTEST_SHARE = 0.4;
/** Median of answer length / longest-distractor length must sit in this band. */
const MEDIAN_RATIO_MIN = 0.8;
const MEDIAN_RATIO_MAX = 1.2;

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

    it(`${repo}: the stamped pack uses every answer slot`, () => {
      const pack = JSON.parse(readFileSync(join(ROOT, 'content', 'seed', 'quests', repo, 'items.json'), 'utf8')) as { items: PackQuiz[] };
      const qs = pack.items.filter((i) => i.kind === 'quiz');
      const width = Math.min(...qs.map((q) => q.choices.length));
      const used = new Set(qs.map((q) => q.check.answerKey));
      for (let slot = 0; slot < width; slot++) expect(used.has(slot), `slot ${slot} never keyed`).toBe(true);
    });
  }
});
