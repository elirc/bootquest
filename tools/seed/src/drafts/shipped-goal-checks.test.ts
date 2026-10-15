/**
 * Content regression guard for generated goal-check quizzes in the SHIPPED quest packs.
 *
 * The goal-check extractor (factory/quests/parse.ts) treats a bare `**Goal**` in prose as a
 * Goal marker, so a guide intro such as
 *   "Each has a **Goal** and a **Check** you can observe."
 * becomes a junk exercise: prompt "Goal: and a", keyed answer "you can observe." — and that
 * fragment then leaks into sibling goal-checks as a distractor. seed:check stays green on
 * such items (they resolve), so this test reads every committed pack and fails on the
 * signatures. Act-3 slice C shipped 11 of these (master3 + organized-study-atlas-fulfillment)
 * before the guides that carry the intro were taken out of the generator inputs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED_DIR } from '../factory/report.ts';

interface PackItem {
  key: string;
  kind: string;
  prompt?: string;
  check?: { choices?: string[] };
}

const QUESTS_DIR = join(DEFAULT_SEED_DIR, 'quests');
const GOAL_CHECK = /^Goal: ([\s\S]*?)\n\nWhich check verifies this goal\?$/;

/** a goal payload that is really the tail of an intro sentence, not an exercise */
export function isPreambleGoal(goal: string): boolean {
  const g = goal.trim();
  return g.length < 12 || /^(\(|and\b|or\b)/i.test(g);
}

/** a check/choice that is really the tail of an intro sentence */
export function isPreambleCheck(choice: string): boolean {
  const c = choice.trim();
  return /^you can observe\.?$/i.test(c) || /^\(a `node:test` file you run/.test(c) || /run it from the repo root with$/.test(c);
}

function shippedItems(): Array<{ pack: string; item: PackItem }> {
  const out: Array<{ pack: string; item: PackItem }> = [];
  for (const pack of readdirSync(QUESTS_DIR)) {
    const f = join(QUESTS_DIR, pack, 'items.json');
    if (!existsSync(f)) continue;
    const doc = JSON.parse(readFileSync(f, 'utf8')) as { items: PackItem[] };
    for (const item of doc.items) out.push({ pack, item });
  }
  return out;
}

describe('shipped goal-check quizzes', () => {
  it('the detectors recognise the known junk shapes and pass real exercises', () => {
    expect(isPreambleGoal('and a')).toBe(true);
    expect(isPreambleGoal('(what to work out by reading code) and a')).toBe(true);
    expect(isPreambleGoal('include the warehouse code in the duplicate check')).toBe(false);
    expect(isPreambleCheck('you can observe.')).toBe(true);
    expect(isPreambleCheck('(a `node:test` file you run to confirm your answer). Checks need no `npm install`: save each one anywhere outside the repo and run it from the repo root with')).toBe(true);
    expect(isPreambleCheck('a second POST returns 409 and the reserved count is unchanged')).toBe(false);
  });

  it('no shipped pack carries an intro-sentence goal-check or a preamble distractor', () => {
    const items = shippedItems();
    expect(items.length).toBeGreaterThan(0);
    const bad: string[] = [];
    let goalChecks = 0;
    for (const { pack, item } of items) {
      if (item.kind !== 'quiz' || !item.prompt) continue;
      const m = GOAL_CHECK.exec(item.prompt);
      if (!m) continue;
      goalChecks++;
      if (isPreambleGoal(m[1]!)) bad.push(`${pack}: ${item.key} goal "${m[1]!.trim()}"`);
      for (const c of item.check?.choices ?? []) if (isPreambleCheck(c)) bad.push(`${pack}: ${item.key} choice "${c.slice(0, 60)}"`);
    }
    expect(goalChecks).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});
