import { createHmac } from 'node:crypto';
import type { Db } from '../db/database.ts';

/**
 * Campaign 2 (ui-audit #24, HONESTY): served multiple-choice order.
 *
 * Choices used to reach the client in their AUTHORED order, so any position bias in a pack
 * became an answer: three quest packs key every question at choice 0 (an all-zeros submit
 * passed the gate) and BootForge quiz units key ~66% at choice 1. The API now serves each
 * choice list in a deterministic permutation of its stored order and maps the learner's
 * served index back to the stored index before grading.
 *
 *   - Deterministic and STABLE: the permutation is a pure function of (per-DB secret, unit
 *     id, item key, choice count), so a re-fetch, a reload or a second tab shows the same
 *     order and a recorded answer keeps meaning the same choice.
 *   - Not derivable client-side: the seed is an HMAC under a per-DB random secret
 *     (migration 009) that never leaves the server, so knowing a pack's stored order (or
 *     its bias) does not tell the client where the key landed. The permutation hides
 *     POSITION only; it is not a key and grading still happens server-side.
 *   - Per unit: the same item gated by two units would shuffle independently (the ladder
 *     loader already refuses that case; this keeps it harmless regardless).
 *
 * Text-based surfaces (review-card backs quote the keyed choice TEXT) need no mapping.
 */

/** order[servedIndex] = storedIndex */
export type ChoiceOrder = readonly number[];

/** Resolves the served order of one item's choices on one unit. */
export type ChoiceOrderer = (itemKey: string, n: number) => ChoiceOrder;

export class ChoiceOrderSecretError extends Error {
  constructor() {
    super('server_secret row is missing (migration 009): refusing to serve choices in authored order');
    this.name = 'ChoiceOrderSecretError';
  }
}

const secrets = new WeakMap<Db, string>();

/** The DB's immutable choice-order secret (cached per Db handle). Fail-closed when absent. */
export function choiceOrderSecret(db: Db): string {
  const cached = secrets.get(db);
  if (cached !== undefined) return cached;
  const row = db.get<{ secret: string }>('SELECT secret FROM server_secret WHERE id = 1');
  if (!row || typeof row.secret !== 'string' || row.secret.length !== 64) throw new ChoiceOrderSecretError();
  secrets.set(db, row.secret);
  return row.secret;
}

/**
 * PURE: a Fisher-Yates permutation of [0, n) driven by HMAC-SHA256(secret, scope || block).
 * Modulo bias over 32-bit draws is < n / 2^32 (irrelevant for choice lists).
 */
export function choicePermutation(secret: string, scope: string, n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  let buf: Buffer = Buffer.alloc(0);
  let off = 0;
  let block = 0;
  const next32 = (): number => {
    if (off + 4 > buf.length) {
      buf = createHmac('sha256', secret).update(`${scope}\u0000${block++}`).digest();
      off = 0;
    }
    const v = buf.readUInt32BE(off);
    off += 4;
    return v;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = next32() % (i + 1);
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }
  return order;
}

/** The orderer for every choice list served on (or graded for) one unit. */
export function choiceOrdererFor(db: Db, unitId: number): ChoiceOrderer {
  const secret = choiceOrderSecret(db);
  return (itemKey, n) => choicePermutation(secret, `unit:${unitId}\u0000item:${itemKey}`, n);
}

/** Stored choices -> served choices. */
export function servedChoices<T>(stored: readonly T[], order: ChoiceOrder): T[] {
  return order.map((s) => stored[s]!);
}

/**
 * A served index -> its stored index. Anything that is not an in-range integer is returned
 * unchanged (it can never match a stored key that indexes into the list, so it grades as
 * wrong exactly as before; strings for exact-graded items pass through).
 */
export function toStoredAnswer<T>(answer: T, order: ChoiceOrder): T | number {
  if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= order.length) return answer;
  return order[answer]!;
}

/** A stored index -> its served index (reveal shows the key where the learner sees it). */
export function toServedIndex(stored: number, order: ChoiceOrder): number {
  const i = order.indexOf(stored);
  return i === -1 ? stored : i;
}
