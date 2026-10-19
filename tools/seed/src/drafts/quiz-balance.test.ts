import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedItem } from '@bootquest/shared';
import { describe, expect, it } from 'vitest';
import {
  BALANCE_GUARDS,
  balanceGuard,
  balanceQuizzes,
  colonLed,
  FORMAT_STRATEGIES,
  QUIZ_BALANCE_EXEMPT,
  QUIZ_BALANCE_MIN_QUIZZES,
  quizBalanceProblems,
  type BalanceGuard,
  type BalanceQuiz,
  type SlotQuiz,
} from '../factory/guards.ts';

/**
 * Answer-leak guard for quest quizzes (campaign 2 act-3 review; release wave factory-3 rewrite
 * after campaign 2 review F1/F2; moved into the stamp path 2026-10-19).
 *
 * The guards (longest / shortest / median-ratio / rank / format / slots) live in factory/guards.ts:
 * writeSeedPack refuses to stamp, and seed:check / --restamp FAIL, a stamped quest pack that trips
 * one over ALL its quizzes (QUIZ_BALANCE_EXEMPT there: pack -> the guards it fails today). This
 * suite runs the SAME functions two ways:
 *   - per hand draft (content/seed-drafts/quests): only the draft's own quizzes, the authoring
 *     contract (every draft >= 10 quizzes; DRAFT_EXEMPT below, draft -> guards it fails today);
 *   - per stamped quest pack: what seed:check judges.
 * An exempt guard must still fail (the maps only shrink) and an unlisted guard must pass. Do NOT
 * raise a threshold or add an exemption to admit a draft; rewrite its choices.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const DRAFTS = join(ROOT, 'content', 'seed-drafts', 'quests');
const QUESTS = join(ROOT, 'content', 'seed', 'quests');

/** draft -> the guards its OWN quizzes currently fail. Empty: every hand draft passes. */
const DRAFT_EXEMPT: Record<string, BalanceGuard[]> = {};

interface DraftQuiz extends BalanceQuiz {
  kind: 'quiz';
}

const quizzes = (draft: string): DraftQuiz[] => {
  const d = JSON.parse(readFileSync(join(DRAFTS, `${draft}.json`), 'utf8')) as { items: Array<{ kind: string }> };
  return d.items.filter((i): i is DraftQuiz => i.kind === 'quiz');
};
const packItems = (pack: string): SeedItem[] => (JSON.parse(readFileSync(join(QUESTS, pack, 'items.json'), 'utf8')) as { items: SeedItem[] }).items;
/** the stamped pack's quizzes as slots (the drafts path writes its pack to content/seed/quests/<draft>) */
const packSlots = (pack: string): SlotQuiz[] => balanceQuizzes(packItems(pack)).slots;

/** Every draft with at least one quiz. */
const ALL_DRAFTS = readdirSync(DRAFTS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -'.json'.length))
  .filter((d) => quizzes(d).length > 0)
  .sort();

const ALL_PACKS = readdirSync(QUESTS)
  .filter((d) => existsSync(join(QUESTS, d, 'items.json')))
  .sort();

describe('the EXEMPT maps are well-formed', () => {
  it('DRAFT_EXEMPT names only real drafts with quizzes and real guards, each at most once, never an empty list', () => {
    for (const [draft, guards] of Object.entries(DRAFT_EXEMPT)) {
      expect(ALL_DRAFTS, `${draft} is not a draft with quizzes`).toContain(draft);
      expect(guards.length, draft).toBeGreaterThan(0);
      expect(new Set(guards).size, `${draft} lists a guard twice`).toBe(guards.length);
      for (const g of guards) expect(BALANCE_GUARDS, `${draft}: unknown guard ${g}`).toContain(g);
    }
  });

  it('QUIZ_BALANCE_EXEMPT names only real stamped packs and real guards, each at most once, never an empty list', () => {
    for (const [pack, guards] of Object.entries(QUIZ_BALANCE_EXEMPT)) {
      expect(ALL_PACKS, `${pack} is not a stamped quest pack`).toContain(pack);
      expect(guards.length, pack).toBeGreaterThan(0);
      expect(new Set(guards).size, `${pack} lists a guard twice`).toBe(guards.length);
      for (const g of guards) expect(BALANCE_GUARDS, `${pack}: unknown guard ${g}`).toContain(g);
    }
  });

  it('every draft has a quiz pack big enough to judge', () => {
    expect(ALL_DRAFTS.length).toBeGreaterThan(0);
    for (const d of ALL_DRAFTS) expect(quizzes(d).length, d).toBeGreaterThanOrEqual(QUIZ_BALANCE_MIN_QUIZZES);
  });
});

describe('hand-authored quiz drafts do not leak the key by length, rank, format or position', () => {
  for (const draft of ALL_DRAFTS) {
    const exempt = new Set(DRAFT_EXEMPT[draft] ?? []);
    for (const guard of BALANCE_GUARDS) {
      const why = () => balanceGuard(guard, quizzes(draft), guard === 'slots' ? packSlots(draft) : []);
      if (exempt.has(guard)) {
        it(`${draft}: still fails ${guard} (remove it from DRAFT_EXEMPT once fixed)`, () => {
          expect(why(), `${draft} now passes ${guard}: delete that exemption`).not.toBeNull();
        });
      } else {
        it(`${draft}: ${guard}`, () => {
          expect(why()).toBeNull();
        });
      }
    }
  }
});

describe('stamped quest packs pass quiz-balance over ALL their quizzes (what seed:check judges)', () => {
  for (const pack of ALL_PACKS) {
    const { quizzes: qs, slots } = balanceQuizzes(packItems(pack));
    if (qs.length < QUIZ_BALANCE_MIN_QUIZZES) continue;
    it(`${pack}${QUIZ_BALANCE_EXEMPT[pack] ? ` (exempt: ${QUIZ_BALANCE_EXEMPT[pack]!.join(', ')})` : ''}`, () => {
      expect(quizBalanceProblems(pack, qs, slots)).toEqual([]);
    });
  }
});

describe('format-tell strategies detect the tells they name', () => {
  const mk = (answer: string, distractors: string[]): BalanceQuiz => ({ id: 'x', answer, distractors });
  const score = (name: string, qs: BalanceQuiz[]): number => {
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
    expect(quizBalanceProblems('planted', leaky, [])).toContainEqual(expect.stringMatching(/^quiz-balance format: format strategies beat chance/));
  });

  it('scores a uniformly framed draft at chance', () => {
    for (const [name] of FORMAT_STRATEGIES) expect(score(name, uniform)).toBeCloseTo(0.25);
  });

  it('does not read a colon inside a code object literal as a verdict frame', () => {
    expect(colonLed('Status 200 with { data: deletedTask }')).toBe(false);
    expect(colonLed('Nowhere: it is defined but never used')).toBe(true);
  });

  it('an exemption is policed: an exempt guard that now passes is a problem', () => {
    expect(quizBalanceProblems('p', uniform, [], { p: ['format'] })).toContain('quiz-balance format: p now passes; delete its QUIZ_BALANCE_EXEMPT entry');
    expect(quizBalanceProblems('p', leaky, [], { p: ['format', 'longest'] }).some((s) => s.startsWith('quiz-balance format'))).toBe(false);
  });
});
