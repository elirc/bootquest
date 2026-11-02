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
