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
import { normCompare } from './util.ts';

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

/** A text tokenized once (it is matched against many keys). */
export interface LeakText {
  text: string;
  /** ` tok tok ... ` (the containment haystack) */
  padded: string;
  segs: Array<{ seg: string; tokens: string[] }>;
}
/** A key tokenized once. */
export interface LeakKey {
  tokens: string[];
  /** ` tok tok ... ` */
  padded: string;
  set: ReadonlySet<string>;
}

export const prepareLeakText = (text: string): LeakText => ({
  text,
  padded: ` ${leakTokens(text).join(' ')} `,
  segs: leakSegments(text).map((seg) => ({ seg, tokens: leakTokens(seg) })),
});
export const prepareLeakKey = (key: string): LeakKey => {
  const tokens = leakTokens(key);
  return { tokens, padded: ` ${tokens.join(' ')} `, set: new Set(tokens) };
};

/** util.ts tokenJaccard over already-normalized token lists (same value; no re-normalizing per window). */
function jaccard(a: readonly string[], kb: ReadonlySet<string>): number {
  const ta = new Set(a);
  if (ta.size === 0 && kb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (kb.has(t)) inter++;
  return inter / (ta.size + kb.size - inter);
}

/** The worst token-Jaccard of one segment against the key, over the whole segment and its answer-sized windows. */
function segmentOverlap(st: readonly string[], k: LeakKey): number {
  const n = k.tokens.length;
  let worst = jaccard(st, k.set);
  for (const w of [n, n + 2]) {
    if (st.length <= w) continue;
    worst = Math.max(worst, slidingWorst(st, w, k.set));
  }
  return worst;
}

/** max over every w-token window of jaccard(window, kb), maintained incrementally (O(len)). */
function slidingWorst(st: readonly string[], w: number, kb: ReadonlySet<string>): number {
  const counts = new Map<string, number>();
  let inter = 0;
  const add = (t: string) => {
    const c = counts.get(t) ?? 0;
    counts.set(t, c + 1);
    if (c === 0 && kb.has(t)) inter++;
  };
  const drop = (t: string) => {
    const c = counts.get(t)!;
    if (c === 1) {
      counts.delete(t);
      if (kb.has(t)) inter--;
    } else counts.set(t, c - 1);
  };
  let best = 0;
  for (let i = 0; i < st.length; i++) {
    add(st[i]!);
    if (i >= w) drop(st[i - w]!);
    if (i >= w - 1) best = Math.max(best, inter / (counts.size + kb.size - inter));
  }
  return best;
}

const contains = (t: LeakText, k: LeakKey, o: LeakMatchOptions): boolean => k.tokens.length >= (o.minContainTokens ?? 1) && t.padded.includes(k.padded);

/** leakMatch over prepared inputs (callers matching many texts x keys prepare each once). */
export function leakMatchPrepared(t: LeakText, k: LeakKey, threshold: number, o: LeakMatchOptions = {}): LeakMatch | null {
  if (k.tokens.length === 0) return null;
  if (contains(t, k, o)) return { kind: 'contains', score: 1, segment: t.text };
  if (k.tokens.length < (o.minOverlapTokens ?? 1)) return null;
  for (const s of t.segs) {
    const worst = segmentOverlap(s.tokens, k);
    if (worst >= threshold) return { kind: 'overlap', score: worst, segment: s.seg };
  }
  return null;
}

/** First way `text` gives `key` away, or null. */
export function leakMatch(text: string, key: string, threshold: number, o: LeakMatchOptions = {}): LeakMatch | null {
  return leakMatchPrepared(prepareLeakText(text), prepareLeakKey(key), threshold, o);
}

/** Highest leak score of `text` against `key` (0..1; 1 = contained), for reports and threshold tuning. */
export function leakScore(text: string, key: string, o: LeakMatchOptions = {}): number {
  const k = prepareLeakKey(key);
  const t = prepareLeakText(text);
  if (k.tokens.length === 0) return 0;
  if (contains(t, k, o)) return 1;
  if (k.tokens.length < (o.minOverlapTokens ?? 1)) return 0;
  return Math.max(0, ...t.segs.map((s) => segmentOverlap(s.tokens, k)));
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
