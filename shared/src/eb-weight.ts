/**
 * Explain-back key-point weights (ab wave). Authored key points may start with a `[w1]`, `[w2]` or `[w3]`
 * prefix (SEEDING §3 explain-back convention). The prefix stays in the stored and served text, so seed
 * items stay byte-identical; the weight is derived at runtime here. NOT fingerprinted: `index.ts`,
 * `pack.ts` and the seed generators must never import this module (zod-free, so the client may import it
 * at runtime). Only a prefix at the very start counts: prompts mention "[w3]" in prose.
 */
export type KpWeight = 1 | 2 | 3;

const PREFIX = /^\[w([123])\]\s*/;

/** The authored weight of a key point, or null when it carries no `[wN]` prefix. */
export function kpWeight(text: string): KpWeight | null {
  const m = PREFIX.exec(text);
  return m ? (Number(m[1]) as KpWeight) : null;
}

/** The key-point text without its `[wN]` prefix (display only; never store the stripped text). */
export function stripKpWeight(text: string): string {
  return text.replace(PREFIX, '');
}

/** True when every key point of the set carries a weight (a "weighted set"). An empty set is not weighted. */
export function isWeightedSet(keyPoints: readonly string[]): boolean {
  return keyPoints.length > 0 && keyPoints.every((k) => kpWeight(k) !== null);
}

/**
 * rv B (D4, R3-01): a weighted set passes with at most this many `[w3]` key points missed (and the weighted
 * floor met). It was 0: with ~49% of design key points tagged `[w3]`, "every [w3]" passed ~12% of sets at 80%
 * per-point recall. The 80% floor itself stays in `thresholds.ts` (bound to the seed stamps).
 */
export const EB_MAX_W3_MISSED = 1;

/**
 * rv B (R4-07): the minimum real answer of an explain-back answer of record, per question. "x, x, x" passed and
 * filed evidence; below this many words the answer is refused before any key point is shown.
 */
export const EB_MIN_ANSWER_WORDS = 15;

/** Words in an answer: runs of letters or digits (`don't` and `p99` count once each; `O(n)` counts twice). */
export function answerWords(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu) ?? []).length;
}
