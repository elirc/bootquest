/**
 * The answer-leak primitive shared by every "does this text give a keyed answer away" rule:
 *   - seed:notes noteLeaks (a `before` reading vs every keyed quiz answer of its pack);
 *   - the explain-back key-point check (guards.ts explainBackKeyLeaks: a key point vs every
 *     keyed quiz answer of a same-repo quest pack).
 * One token rule for both: normCompare tokens; a hit is either the key's token sequence
 * appearing at token boundaries inside the text, or a token-Jaccard >= threshold between the
 * key and a sentence / line of the text or an answer-sized window (n and n+2 tokens) of one,
 * so a long sentence cannot hide a near-verbatim answer inside it.
 */
import { normCompare, tokenJaccard } from './util.ts';

export const leakTokens = (s: string): string[] => normCompare(s).split(' ').filter(Boolean);

/** sentences / lines of a text (the units a leak is measured over) */
export function leakSegments(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?;:])\s+/)
    .map((s) => s.trim())
    .filter((s) => leakTokens(s).length > 0);
}

export interface LeakMatch {
  /** contains: the key's tokens appear verbatim (token boundaries); overlap: token-Jaccard >= threshold */
  kind: 'contains' | 'overlap';
  score: number;
  /** the segment that matched (the whole text for `contains`) */
  segment: string;
}

export interface LeakMatchOptions {
  /** the `contains` rule only fires for keys of at least this many tokens (default 1: any key) */
  minContainTokens?: number;
  /** the token-Jaccard rule only fires for keys of at least this many tokens (default 1: any key) */
  minOverlapTokens?: number;
}

/** The worst token-Jaccard of one segment against the key, over the whole segment and its answer-sized windows. */
function segmentOverlap(seg: string, key: string, n: number): number {
  const st = leakTokens(seg);
  let worst = tokenJaccard(seg, key);
  for (const w of [n, n + 2]) {
    if (st.length <= w) continue;
    for (let i = 0; i + w <= st.length; i++) worst = Math.max(worst, tokenJaccard(st.slice(i, i + w).join(' '), key));
  }
  return worst;
}

const contains = (text: string, kt: readonly string[], o: LeakMatchOptions): boolean =>
  kt.length >= (o.minContainTokens ?? 1) && ` ${leakTokens(text).join(' ')} `.includes(` ${kt.join(' ')} `);

/** First way `text` gives `key` away, or null. */
export function leakMatch(text: string, key: string, threshold: number, o: LeakMatchOptions = {}): LeakMatch | null {
  const kt = leakTokens(key);
  if (kt.length === 0) return null;
  if (contains(text, kt, o)) return { kind: 'contains', score: 1, segment: text };
  if (kt.length < (o.minOverlapTokens ?? 1)) return null;
  for (const seg of leakSegments(text)) {
    const worst = segmentOverlap(seg, key, kt.length);
    if (worst >= threshold) return { kind: 'overlap', score: worst, segment: seg };
  }
  return null;
}

/** Highest leak score of `text` against `key` (0..1; 1 = contained), for reports and threshold tuning. */
export function leakScore(text: string, key: string, o: LeakMatchOptions = {}): number {
  const kt = leakTokens(key);
  if (kt.length === 0) return 0;
  if (contains(text, kt, o)) return 1;
  if (kt.length < (o.minOverlapTokens ?? 1)) return 0;
  return Math.max(0, ...leakSegments(text).map((seg) => segmentOverlap(seg, key, kt.length)));
}

const WORD = /[A-Za-z0-9_]/;

/**
 * `needle` occurs in `hay` at token boundaries: a match whose first (last) char is a word char
 * may not continue a word in `hay` ("MAX = 3" is NOT found in "MAX = 30"; "= 3" not in "x= 3a").
 */
export function includesAtBoundary(hay: string, needle: string): boolean {
  if (needle.length === 0) return true;
  const wordStart = WORD.test(needle[0]!);
  const wordEnd = WORD.test(needle[needle.length - 1]!);
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const before = at > 0 ? hay[at - 1]! : '';
    const after = at + needle.length < hay.length ? hay[at + needle.length]! : '';
    if (wordStart && before && WORD.test(before)) continue;
    if (wordEnd && after && WORD.test(after)) continue;
    return true;
  }
  return false;
}
