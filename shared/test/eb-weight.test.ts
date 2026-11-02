import { describe, expect, it } from 'vitest';
import { isWeightedSet, kpWeight, stripKpWeight } from '../src/eb-weight.ts';

describe('eb-weight', () => {
  it('reads a leading [w1]/[w2]/[w3] prefix', () => {
    expect(kpWeight('[w3] Pages are keyset, not offset')).toBe(3);
    expect(kpWeight('[w2]x')).toBe(2);
    expect(kpWeight('[w1] a')).toBe(1);
  });
  it('ignores a prefix that is not at the start, and out-of-range weights', () => {
    expect(kpWeight('suggested pass: 70% with every [w3] hit')).toBeNull();
    expect(kpWeight(' [w3] leading space')).toBeNull();
    expect(kpWeight('[w4] no')).toBeNull();
    expect(kpWeight('plain key point')).toBeNull();
  });
  it('strips only the prefix', () => {
    expect(stripKpWeight('[w3] Pages are keyset')).toBe('Pages are keyset');
    expect(stripKpWeight('no prefix [w3] here')).toBe('no prefix [w3] here');
  });
  it('a set is weighted only when every key point is', () => {
    expect(isWeightedSet(['[w3] a', '[w1] b'])).toBe(true);
    expect(isWeightedSet(['[w3] a', 'b'])).toBe(false);
    expect(isWeightedSet([])).toBe(false);
  });
});
