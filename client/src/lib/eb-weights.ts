// A5 explain-back weights, client side (display + live preview only; the server decides `passed`).
// A set whose every key point starts with `[w1]`/`[w2]`/`[w3]` is a WEIGHTED set: its coverage is
// Σ weight(covered) / Σ weight(all) and it passes only with that >= the mark AND no [w3] missed.
// Any other set is scored by plain covered / total, exactly as before. The prefix stays in the
// served text; the client strips it for display and shows the weight as a chip.

import { isWeightedSet, kpWeight } from '@bootquest/shared/eb-weight';

export { kpWeight, stripKpWeight } from '@bootquest/shared/eb-weight';

export interface EbTally {
  weighted: boolean;
  total: number;
  marked: number;
  covered: number;
  /** Σ weight of the covered key points (= covered for an unweighted set) */
  hitWeight: number;
  /** Σ weight of all key points (= total for an unweighted set) */
  allWeight: number;
  /** coverage of record so far: hitWeight / allWeight */
  coverage: number;
  /** [w3] key point ids marked missed, in key order (empty for an unweighted set) */
  w3Missed: string[];
  /** [w3] key point ids not marked yet */
  w3Unmarked: string[];
}

type Mark = 'covered' | 'missed';

export function ebTally(keyPoints: readonly { id: string; text: string }[], marks: Readonly<Record<string, Mark | undefined>>): EbTally {
  const weighted = isWeightedSet(keyPoints.map((k) => k.text));
  const w = (text: string) => (weighted ? kpWeight(text)! : 1);
  let hitWeight = 0;
  let allWeight = 0;
  for (const k of keyPoints) {
    allWeight += w(k.text);
    if (marks[k.id] === 'covered') hitWeight += w(k.text);
  }
  const w3 = weighted ? keyPoints.filter((k) => kpWeight(k.text) === 3) : [];
  return {
    weighted,
    total: keyPoints.length,
    marked: keyPoints.filter((k) => marks[k.id] !== undefined).length,
    covered: keyPoints.filter((k) => marks[k.id] === 'covered').length,
    hitWeight,
    allWeight,
    coverage: allWeight ? hitWeight / allWeight : 0,
    w3Missed: w3.filter((k) => marks[k.id] === 'missed').map((k) => k.id),
    w3Unmarked: w3.filter((k) => marks[k.id] === undefined).map((k) => k.id),
  };
}

/** Does the tally meet `gatePct` percent? Integer math (4/5 vs 80% is exactly a pass); a weighted set also needs no [w3] missed. */
export function ebMeetsGate(t: EbTally, gatePct: number): boolean {
  return t.allWeight > 0 && t.hitWeight * 100 >= gatePct * t.allWeight && t.w3Missed.length === 0;
}
