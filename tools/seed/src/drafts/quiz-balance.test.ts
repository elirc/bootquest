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
/** Typical key length vs. its longest rival: outside this band, "pick the longest/shortest" still wins on average. */
const MEDIAN_RATIO_BAND = [0.8, 1.2] as const;

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

    it(`${repo}: the key is typically as long as its longest rival`, () => {
      const ratios = quizzes(repo).map((q) => q.answer.length / Math.max(...q.distractors.map((d) => d.length))).sort((a, b) => a - b);
      const mid = ratios.length >> 1;
      const median = ratios.length % 2 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
      expect(median).toBeGreaterThanOrEqual(MEDIAN_RATIO_BAND[0]);
      expect(median).toBeLessThanOrEqual(MEDIAN_RATIO_BAND[1]);
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
