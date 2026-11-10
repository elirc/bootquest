// f52 wave B (app ruling 2): the gate shuffle's mapping back to served indices, and the cooldown.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GATE_COOLDOWN_MS,
  IDENTITY_RANDOM,
  afterGateFail,
  clearGateFails,
  cooldownLeft,
  displayIndexOf,
  fmtCountdown,
  identityOrder,
  makeGateOrder,
  permutation,
  readGateFails,
  recordGateFail,
  servedAnswers,
  servedPick,
  type GateOrder,
} from './gate';

/** a small deterministic generator (mulberry32) */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isPermutation = (p: number[], n: number) => p.length === n && [...p].sort((a, b) => a - b).every((v, i) => v === i);

describe('permutation', () => {
  it('is always a permutation of 0..n-1, for any random source (also the extremes 0 and ~1)', () => {
    for (const n of [0, 1, 2, 3, 4, 8, 12]) {
      for (let seed = 1; seed <= 50; seed++) expect(isPermutation(permutation(n, seeded(seed)), n)).toBe(true);
      expect(isPermutation(permutation(n, () => 0), n)).toBe(true);
      expect(isPermutation(permutation(n, () => 1), n)).toBe(true); // out of contract: still clamped
    }
  });

  it('the identity source keeps the served order; a real source moves things', () => {
    expect(permutation(5, IDENTITY_RANDOM)).toEqual([0, 1, 2, 3, 4]);
    const orders = new Set(Array.from({ length: 30 }, (_, s) => permutation(8, seeded(s + 1)).join()));
    expect(orders.size).toBeGreaterThan(20);
    expect(orders.has('0,1,2,3,4,5,6,7')).toBe(false);
  });
});

describe('makeGateOrder', () => {
  it('permutes the questions and, per served question, its own number of choices', () => {
    const counts = [4, 3, 4, 2, 4, 4, 4, 4];
    for (let seed = 1; seed <= 100; seed++) {
      const o = makeGateOrder(counts, seeded(seed));
      expect(isPermutation(o.questions, counts.length)).toBe(true);
      counts.forEach((n, qi) => expect(isPermutation(o.choices[qi]!, n)).toBe(true));
    }
    expect(identityOrder([3, 2])).toEqual({ questions: [0, 1], choices: [[0, 1, 2], [0, 1]] });
  });

  it('two tries get different orders', () => {
    const r = seeded(7);
    const a = makeGateOrder([4, 4, 4, 4, 4, 4, 4, 4], r);
    const b = makeGateOrder([4, 4, 4, 4, 4, 4, 4, 4], r);
    expect(a).not.toEqual(b);
  });
});

describe('mapping picks back to served indices', () => {
  // a gate as the server serves it: question i has distinct choice texts; `keys[i]` is its keyed index
  const served = Array.from({ length: 10 }, (_, qi) => ({
    prompt: `question ${qi}`,
    choices: Array.from({ length: qi % 3 === 0 ? 3 : 4 }, (_, ci) => `q${qi}-choice-${ci}`),
  }));
  const keys = served.map((q, qi) => (qi * 7 + 3) % q.choices.length);
  const counts = served.map((q) => q.choices.length);

  /** what the learner sees: display question d -> prompt + choice texts in display order */
  const screenOf = (o: GateOrder) => o.questions.map((qi) => ({ prompt: served[qi]!.prompt, choices: o.choices[qi]!.map((ci) => served[qi]!.choices[ci]!) }));

  it('a learner who picks by TEXT posts exactly what an unshuffled UI would post (500 shuffles, right and wrong picks)', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const rnd = seeded(seed);
      const o = makeGateOrder(counts, seeded(seed * 31));
      const shown = screenOf(o);
      // the learner's intent in served terms: some keyed, some wrong, some left open
      const intent = served.map((q, qi) => {
        const roll = rnd();
        return roll < 0.1 ? null : roll < 0.6 ? keys[qi]! : Math.floor(rnd() * q.choices.length);
      });
      // ...carried out on the shuffled screen, by finding the wanted text
      const picks = shown.map((sq) => {
        const qi = served.findIndex((q) => q.prompt === sq.prompt);
        const want = intent[qi]!;
        return want === null ? null : sq.choices.indexOf(served[qi]!.choices[want]!);
      });
      expect(servedAnswers(o, picks)).toEqual(intent);
      // and an unshuffled UI: the picks ARE the answers
      expect(servedAnswers(identityOrder(counts), intent)).toEqual(intent);
    }
  });

  it('servedPick agrees with the screen for every cell; displayIndexOf inverts the question order', () => {
    const o = makeGateOrder(counts, seeded(99));
    const shown = screenOf(o);
    shown.forEach((sq, d) => {
      sq.choices.forEach((text, c) => {
        const s = servedPick(o, d, c)!;
        expect(served[s.question]!.prompt).toBe(sq.prompt);
        expect(served[s.question]!.choices[s.choice]).toBe(text);
      });
      expect(displayIndexOf(o, servedPick(o, d, 0)!.question)).toBe(d);
    });
    // every served cell is reachable exactly once
    const cells = shown.flatMap((sq, d) => sq.choices.map((_, c) => `${servedPick(o, d, c)!.question}:${servedPick(o, d, c)!.choice}`));
    expect(new Set(cells).size).toBe(counts.reduce((a, b) => a + b, 0));
  });

  it('out-of-range picks map to nothing', () => {
    const o = identityOrder([3, 3]);
    expect(servedPick(o, 2, 0)).toBeNull();
    expect(servedPick(o, 0, 3)).toBeNull();
    expect(servedPick(o, -1, 0)).toBeNull();
    expect(servedAnswers(o, [5, null])).toEqual([null, null]);
  });
});

describe('gate cooldown', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  const T0 = 1_800_000_000_000;

  it('the first fail is free; from the second consecutive fail the next try opens 3 minutes later', () => {
    const one = afterGateFail({ fails: 0, until: 0 }, T0);
    expect(one).toEqual({ fails: 1, until: 0 });
    expect(cooldownLeft(one, T0)).toBe(0);
    const two = afterGateFail(one, T0);
    expect(two).toEqual({ fails: 2, until: T0 + GATE_COOLDOWN_MS });
    expect(GATE_COOLDOWN_MS).toBe(180_000);
    expect(cooldownLeft(two, T0)).toBe(180_000);
    expect(cooldownLeft(two, T0 + 179_999)).toBe(1);
    expect(cooldownLeft(two, T0 + 180_000)).toBe(0);
    expect(afterGateFail(two, T0 + 200_000)).toEqual({ fails: 3, until: T0 + 200_000 + GATE_COOLDOWN_MS });
  });

  it('is stored per unit; a pass clears it', () => {
    expect(readGateFails(7)).toEqual({ fails: 0, until: 0 });
    expect(recordGateFail(7, T0)).toEqual({ fails: 1, until: 0 });
    expect(recordGateFail(7, T0 + 5)).toEqual({ fails: 2, until: T0 + 5 + GATE_COOLDOWN_MS });
    expect(readGateFails(7)).toEqual({ fails: 2, until: T0 + 5 + GATE_COOLDOWN_MS });
    expect(readGateFails(8)).toEqual({ fails: 0, until: 0 });
    clearGateFails(7);
    expect(readGateFails(7)).toEqual({ fails: 0, until: 0 });
    expect(recordGateFail(7, T0)).toEqual({ fails: 1, until: 0 });
  });

  it('a stored time further away than one cooldown, or garbage, is not honoured', () => {
    expect(cooldownLeft({ fails: 2, until: T0 + GATE_COOLDOWN_MS + 1 }, T0)).toBe(0);
    localStorage.setItem('bq:gate-fails:v1:7', '{nope');
    expect(readGateFails(7)).toEqual({ fails: 0, until: 0 });
    localStorage.setItem('bq:gate-fails:v1:7', JSON.stringify({ fails: 'x', until: 5 }));
    expect(readGateFails(7)).toEqual({ fails: 0, until: 0 });
  });

  it('a blocked localStorage never throws: the fail still counts for this page', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readGateFails(7)).toEqual({ fails: 0, until: 0 });
    expect(recordGateFail(7, T0)).toEqual({ fails: 1, until: 0 });
    expect(() => clearGateFails(7)).not.toThrow();
  });

  it('fmtCountdown', () => {
    expect(fmtCountdown(180_000)).toBe('3:00');
    expect(fmtCountdown(179_001)).toBe('3:00');
    expect(fmtCountdown(61_000)).toBe('1:01');
    expect(fmtCountdown(999)).toBe('0:01');
    expect(fmtCountdown(0)).toBe('0:00');
  });
});
