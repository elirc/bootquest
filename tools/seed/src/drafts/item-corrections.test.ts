import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression pins for hand-draft items that were factually WRONG against their
 * cited source and were corrected in the rebalance-2 fix pass. The balance
 * guard (quiz-balance.test.ts) only sees lengths; these pin the facts, so a
 * later rebalance cannot quietly reintroduce the false claim.
 *
 * The draft-level assertions always run. The source-level assertions read the
 * pinned checkout (BOOTQUEST_CHECKOUTS, else <repo>/.cache/checkouts) and are
 * skipped only when that checkout is absent from this machine.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const CHECKOUTS = process.env.BOOTQUEST_CHECKOUTS ?? join(ROOT, '.cache', 'checkouts');

interface Cite { path: string; lineStart: number; lineEnd: number }
interface DraftQuiz { id: string; kind: string; answer: string; distractors: string[]; cites: Cite[]; explanation: string }
interface Draft { repo: string; sha: string; items: DraftQuiz[] }

const draft = (repo: string): Draft =>
  JSON.parse(readFileSync(join(ROOT, 'content', 'seed-drafts', 'quests', `${repo}.json`), 'utf8')) as Draft;
const item = (d: Draft, id: string): DraftQuiz => {
  const it = d.items.find((i) => i.id === id);
  if (!it) throw new Error(`${d.repo}: item ${id} missing`);
  return it;
};
const checkout = (d: Draft): string => join(CHECKOUTS, `${d.repo}@${d.sha}`);
const lines = (d: Draft, path: string, start: number, end: number): string =>
  readFileSync(join(checkout(d), path), 'utf8').split(/\r?\n/).slice(start - 1, end).join('\n');
const cites = (q: DraftQuiz, path: string, start: number, end: number): boolean =>
  q.cites.some((c) => c.path === path && c.lineStart <= start && c.lineEnd >= end);

describe('organized-dotnet-pastebin corrected items', () => {
  const d = draft('organized-dotnet-pastebin');
  const q10 = item(d, 'q10-search-minimum');
  const q06 = item(d, 'q06-slug-case-insensitive');
  const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  it('q10: the key says the store guard still answers 200 [] and cites that guard', () => {
    expect(q10.answer).toMatch(/^400 /);
    expect(q10.answer).toContain('200 []');
    expect(q10.answer).not.toMatch(/scan/i);
    expect(cites(q10, 'backend/Data/PasteStore.cs', 158, 162)).toBe(true);
    // The old false key is now a distractor; it must not be the answer.
    expect(q10.distractors.some((x) => /scans every unexpired public paste/.test(x))).toBe(true);
  });

  it('q06: example slugs only use characters RandomToken can produce', () => {
    const slugs = [q06.answer, ...q06.distractors].join(' ').match(/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{8}\b/g) ?? [];
    expect(slugs.length).toBeGreaterThanOrEqual(2);
    for (const s of slugs) for (const ch of s) expect(ALPHABET.includes(ch), `${s} has '${ch}'`).toBe(true);
  });

  it.skipIf(!existsSync(checkout(d)))('source: PasteStore guards short queries and the alphabet matches', () => {
    const guard = lines(d, 'backend/Data/PasteStore.cs', 158, 162);
    expect(guard).toContain('trimmedQuery.Length < 2');
    expect(guard).toContain('return [];');
    expect(lines(d, 'backend/Data/PasteStore.cs', 244, 244)).toContain(`"${ALPHABET}"`);
  });
});

describe('organized-build-gum corrected items', () => {
  const d = draft('organized-build-gum');
  const q08 = item(d, 'q08-style-drift');

  it('q08: the key keeps the neutral .pill look and cites the generic rule', () => {
    expect(q08.answer).toContain('.pill');
    expect(q08.answer).not.toMatch(/no CSS rule matches|loses styling/);
    expect(cites(q08, 'src/style.css', 792, 795)).toBe(true);
  });

  it.skipIf(!existsSync(checkout(d)))('source: a generic .pill rule exists and no .pill.archived rule does', () => {
    expect(lines(d, 'src/style.css', 792, 795)).toMatch(/^\.pill \{[\s\S]*background:/);
    expect(readFileSync(join(checkout(d), 'src/style.css'), 'utf8')).not.toMatch(/\.pill\.archived/);
  });
});
