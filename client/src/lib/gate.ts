// f52 wave B (app ruling 2): the Fundamentals quiz gate's fail path, client-side.
//
// 1. Shuffle. Every try shows the questions, and each question's choices, in a fresh order. The
//    order is DISPLAY ONLY: answers are kept, and posted, in the server's served order (question i,
//    choice index as served), so a shuffled UI posts exactly what an unshuffled one would.
// 2. Cooldown. From the second consecutive failed try the next try opens 3 minutes later. It is a
//    speed bump, not a rule (the server accepts any submit): the state lives in localStorage per
//    unit, and a blocked or cleared store simply means no cooldown.
import { storedGet, storedSet } from './draft';

// ---------------------------------------------------------------- shuffle

export interface GateOrder {
  /** display position -> served question index */
  questions: number[];
  /** per SERVED question index: display position -> served choice index */
  choices: number[][];
}

/**
 * The gate's random source. Tests replace `random` (test/setup.ts pins the identity order, so the
 * suites that step through a gate keep addressing "Q1 choice 2" in served terms).
 */
export const gateShuffle: { random: () => number } = { random: () => Math.random() };

/** A random source that always yields the identity order from `permutation`. */
export const IDENTITY_RANDOM = (): number => 0.999999;

/** Fisher-Yates over 0..n-1 with `random` in [0, 1). */
export function permutation(n: number, random: () => number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A fresh display order for a gate whose served question i has `choiceCounts[i]` choices. */
export function makeGateOrder(choiceCounts: readonly number[], random: () => number = gateShuffle.random): GateOrder {
  return { questions: permutation(choiceCounts.length, random), choices: choiceCounts.map((n) => permutation(n, random)) };
}

export const identityOrder = (choiceCounts: readonly number[]): GateOrder => makeGateOrder(choiceCounts, IDENTITY_RANDOM);

/** The served (question, choice) behind what the learner picked on screen. */
export function servedPick(order: GateOrder, displayQuestion: number, displayChoice: number): { question: number; choice: number } | null {
  const question = order.questions[displayQuestion];
  if (question === undefined) return null;
  const choice = order.choices[question]?.[displayChoice];
  return choice === undefined ? null : { question, choice };
}

/** Where a served question sits on screen (0-based). */
export const displayIndexOf = (order: GateOrder, servedQuestion: number): number => order.questions.indexOf(servedQuestion);

/**
 * The answers to post, in served order, from the learner's on-screen picks (`picks[d]` = the display
 * choice index picked for the question at display position d, or null).
 */
export function servedAnswers(order: GateOrder, picks: readonly (number | null)[]): (number | null)[] {
  const out: (number | null)[] = order.questions.map(() => null);
  picks.forEach((p, d) => {
    if (p === null) return;
    const s = servedPick(order, d, p);
    if (s) out[s.question] = s.choice;
  });
  return out;
}

// ---------------------------------------------------------------- cooldown

export const GATE_COOLDOWN_MS = 3 * 60_000;
/** the cooldown starts with this consecutive fail */
export const GATE_COOLDOWN_FROM = 2;

export interface GateFails {
  /** consecutive failed tries (a pass clears it) */
  fails: number;
  /** epoch ms the next try opens at; 0 = open */
  until: number;
}

const NONE: GateFails = { fails: 0, until: 0 };
const key = (unitId: number): string => `gate-fails:v1:${unitId}`;

export function readGateFails(unitId: number): GateFails {
  const raw = storedGet(key(unitId));
  if (raw === null) return NONE;
  try {
    const v = JSON.parse(raw) as Partial<GateFails> | null;
    const fails = typeof v?.fails === 'number' && Number.isInteger(v.fails) && v.fails > 0 ? v.fails : 0;
    const until = typeof v?.until === 'number' && Number.isFinite(v.until) && v.until > 0 ? v.until : 0;
    return fails === 0 ? NONE : { fails, until };
  } catch {
    return NONE;
  }
}

/** The state after one more failed try at `now` (pure). */
export function afterGateFail(prev: GateFails, now: number): GateFails {
  const fails = prev.fails + 1;
  return { fails, until: fails >= GATE_COOLDOWN_FROM ? now + GATE_COOLDOWN_MS : 0 };
}

/**
 * Record a failed try on top of `prev` (default: what is stored); returns the new state. When storage
 * refuses it the caller's own copy still holds it for this page.
 */
export function recordGateFail(unitId: number, now: number, prev: GateFails = readGateFails(unitId)): GateFails {
  const next = afterGateFail(prev, now);
  storedSet(key(unitId), JSON.stringify(next));
  return next;
}

export function clearGateFails(unitId: number): void {
  storedSet(key(unitId), null);
}

/**
 * ms left before the next try opens (0 = open). A stored time further away than one cooldown (a
 * clock that moved back, a hand-edited value) is not honoured.
 */
export function cooldownLeft(state: GateFails, now: number): number {
  const left = state.until - now;
  return left > 0 && left <= GATE_COOLDOWN_MS ? left : 0;
}

/** "2:59" */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
