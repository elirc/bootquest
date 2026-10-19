import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedItem } from '@bootquest/shared';
import { describe, expect, it } from 'vitest';
import { BLIND_PASS_EXEMPT, blindPassProblem, blindQuizzes, MAX_BLIND_PASS, PASS_PCT, passProbability, worstBlindPass } from '../factory/guards.ts';

/**
 * Blind-pass guard (release wave, after the campaign 2 content reviews).
 *
 * quiz-balance caps per-draft SHARES (key longest <= 35%, ...). The release reviews found tells it
 * does not measure (the key has the most clause marks, the only comma or "and", the only digit,
 * ...), and each share cap is noisy at ~12 quizzes. So this guard asks the question the honesty
 * rule actually cares about, per STAMPED quest pack (drafted, authored or generated): for every
 * blind strategy, what is the exact probability that a learner who answers each quiz by that
 * strategy alone clears the pack's 80% study-quest gate?
 *
 * The math lives in factory/guards.ts (blindPassProblem): writeSeedPack refuses to stamp and
 * seed:check / --restamp FAIL a pack that trips it. This suite proves the machinery and runs the
 * same call over the committed estate. BLIND_PASS_EXEMPT (in guards.ts): pack -> ceiling.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const QUESTS = join(ROOT, 'content', 'seed', 'quests');

const packItems = (pack: string): SeedItem[] => (JSON.parse(readFileSync(join(QUESTS, pack, 'items.json'), 'utf8')) as { items: SeedItem[] }).items;

const PACKS = readdirSync(QUESTS)
  .filter((d) => existsSync(join(QUESTS, d, 'items.json')))
  .filter((d) => blindQuizzes(packItems(d)).length > 0)
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
    expect(blindPassProblem('planted', clauses)).toMatch(/^blind-pass: strategy ".+" clears the 80% gate with probability/);
    const rank2 = Array.from({ length: 12 }, () => mk('a medium answer', ['the longest answer of all', 'short', 'tiny']));
    expect(worstBlindPass(rank2)).toMatchObject({ p: 1 });
    const balanced = Array.from({ length: 12 }, (_, i) => {
      const c = ['Alpha answer here', 'Beta answer here', 'Gamma answer here', 'Delta answer here'];
      return { choices: c, key: i % 4 };
    });
    expect(worstBlindPass(balanced).p).toBeLessThan(MAX_BLIND_PASS);
    expect(blindPassProblem('balanced', balanced)).toBeNull();
  });

  it('an exemption is policed: it must still fail, within its ceiling', () => {
    const mk = (key: string, ds: string[]) => ({ choices: [key, ...ds], key: 0 });
    const leaky = Array.from({ length: 12 }, () => mk('a medium answer', ['the longest answer of all', 'short', 'tiny']));
    const balanced = Array.from({ length: 12 }, (_, i) => ({ choices: ['Alpha answer here', 'Beta answer here', 'Gamma answer here', 'Delta answer here'], key: i % 4 }));
    expect(blindPassProblem('p', leaky, { p: 1 })).toBeNull();
    expect(blindPassProblem('p', leaky, { p: 0.5 })).toMatch(/worse than its BLIND_PASS_EXEMPT ceiling/);
    expect(blindPassProblem('p', balanced, { p: 0.5 })).toMatch(/delete its BLIND_PASS_EXEMPT entry/);
  });

  it('EXEMPT names only real packs with a ceiling in (MAX_BLIND_PASS, 1]', () => {
    for (const [pack, ceiling] of Object.entries(BLIND_PASS_EXEMPT)) {
      expect(PACKS, pack).toContain(pack);
      expect(ceiling, pack).toBeGreaterThan(MAX_BLIND_PASS);
      expect(ceiling, pack).toBeLessThanOrEqual(1);
    }
  });
});

describe(`no blind strategy clears a stamped quest pack's ${PASS_PCT}% gate with probability > ${MAX_BLIND_PASS}`, () => {
  it('there are packs to judge', () => expect(PACKS.length).toBeGreaterThan(50));
  for (const pack of PACKS) {
    const ceiling = BLIND_PASS_EXEMPT[pack];
    it(ceiling === undefined ? pack : `${pack} (exempt, ceiling ${ceiling})`, () => {
      expect(blindPassProblem(pack, blindQuizzes(packItems(pack)))).toBeNull();
    });
  }
});
