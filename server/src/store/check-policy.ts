import { CheckSpec, type CheckSpecInput } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { nowMs, type Clock } from '../engines/clock.ts';
import { insertCheck } from './content.ts';

/**
 * THE RE-SEED POLICY for checks (one policy, referenced by every loader that registers checks:
 * store/packs.ts, store/study-quests.ts, store/ladder.ts, sync/job.ts).
 *
 * Content is re-seeded routinely: a content wave can change a quiz's choices / key, drop or add
 * a study-quiz item, or move a recorded check spec. The DB holds append-only history (attempt,
 * run, evidence, xp_event, review_log; SQL triggers). Rule:
 *
 *   A check that any attempt or run row references is FROZEN: its unit_id / type / spec /
 *   threshold / inverted / timeout_ms are the frame that history was graded in, and they never
 *   change (enforced in SQL by migration 012's check_referenced_frame_frozen trigger). So when a
 *   loader wants a different check for a unit:
 *     - nothing references the current check   -> update it in place (nothing was graded by it);
 *     - history references it                  -> RETIRE-AND-REPLACE (the default): set
 *       "check".retired_at, insert a fresh live check. Old attempts keep their FK target and
 *       their original frame; new attempts bind to the new live check. A loader never refuses to
 *       start over this, and never needs a DB reset (which would wipe history).
 *     - PIN (the one sanctioned variant, sync/job.ts registerProgram only): the referenced check
 *       stays the live one and the drift is reported; GET /units surfaces the pin as an honest
 *       carve-out (sync/carve-outs.ts). Same invariant — the referenced row is never rebound —
 *       but the learner keeps being graded by the pinned recorded spec until the owner decides.
 *   A type change (drill-js -> quiz, ...) is a kind-level re-seed decision, not a re-seed of the
 *   same check: loaders refuse (packs) or report (sync) it as before.
 *
 * Coarser variant, same idea: when the unit KEY itself encodes the content (ladder standalone
 * study units, studyUnitKey = repo + item-key hash), a re-seed retires the whole UNIT
 * (unit.retired_at) and inserts a new one (store/ladder.ts).
 *
 * Readers: "the unit's check" = the lowest-id LIVE check (retired_at IS NULL; queries.ts
 * primaryCheck); one live check per unit is what every loader asserts. History reads go through
 * attempt.check_id / run.check_id and see retired rows exactly as they were. A new attempt or
 * free run is never recorded against a retired check (engines/attempts.ts, store/content.ts).
 *
 * Seeded review cards follow the same retire-never-delete rule (store/review-cards.ts).
 */

/** SQL predicate for a live check row (alias-free; prefix with the alias where needed). */
export const LIVE_CHECK_SQL = 'retired_at IS NULL';

/** A check is referenced once any attempt or run row points at it (both tables are append-only). */
export function checkReferenced(db: Db, checkId: number): boolean {
  return db.get('SELECT 1 AS x FROM attempt WHERE check_id = ? UNION ALL SELECT 1 AS x FROM run WHERE check_id = ? LIMIT 1', checkId, checkId) !== undefined;
}

export interface LiveCheckRow {
  id: number;
  type: string;
  spec: string;
  threshold: number | null;
}

/** The unit's live checks, lowest id first (retired rows are history, not the unit's check). */
export function liveChecks(db: Db, unitId: number, type?: string): LiveCheckRow[] {
  return type === undefined
    ? db.all<LiveCheckRow>(`SELECT id, type, spec, threshold FROM "check" WHERE unit_id = ? AND ${LIVE_CHECK_SQL} ORDER BY id`, unitId)
    : db.all<LiveCheckRow>(`SELECT id, type, spec, threshold FROM "check" WHERE unit_id = ? AND type = ? AND ${LIVE_CHECK_SQL} ORDER BY id`, unitId, type);
}

/** Canonical JSON (sorted keys): two specs are the same check iff their canonical forms match. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Semantic spec equality: both sides schema-parsed (defaults applied) and key-order-free, so a
 * row stored by an older writer (different key order) is never mistaken for a re-seed — a false
 * "change" on a referenced check would retire it for nothing.
 */
export function sameCheckSpec(storedSpec: string, want: CheckSpecInput): boolean {
  let have: unknown;
  try {
    have = CheckSpec.parse(JSON.parse(storedSpec));
  } catch {
    return false;
  }
  return canonical(have) === canonical(CheckSpec.parse(want));
}

export interface WantedCheck {
  spec: CheckSpecInput;
  /** null/undefined = no threshold */
  threshold?: number | null;
  contentRefId?: number;
}

export type ReconcileOutcome =
  | { outcome: 'unchanged'; checkId: number }
  | { outcome: 'updated'; checkId: number }
  | { outcome: 'replaced'; checkId: number; retiredId: number };

/**
 * Bring ONE existing live check in line with what the loader wants, under the policy above:
 * unchanged / updated in place (unreferenced) / retired-and-replaced (referenced).
 * The caller owns type-change decisions and the transaction.
 */
export function reconcileCheck(db: Db, unitId: number, current: LiveCheckRow, want: WantedCheck, clock: Clock): ReconcileOutcome {
  const threshold = want.threshold ?? null;
  if (sameCheckSpec(current.spec, want.spec) && current.threshold === threshold) return { outcome: 'unchanged', checkId: current.id };
  if (!checkReferenced(db, current.id)) {
    const s = CheckSpec.parse(want.spec);
    db.run(
      'UPDATE "check" SET type = ?, spec = ?, threshold = ?, inverted = ?, timeout_ms = ? WHERE id = ?',
      s.type,
      JSON.stringify(s),
      threshold,
      s.type === 'self-run' ? s.inverted : false,
      'timeoutMs' in s ? (s.timeoutMs ?? null) : null,
      current.id,
    );
    return { outcome: 'updated', checkId: current.id };
  }
  // the replacement keeps the retired check's content_ref unless the loader names one
  const contentRefId = want.contentRefId ?? db.get<{ r: number | null }>('SELECT content_ref_id AS r FROM "check" WHERE id = ?', current.id)?.r ?? null;
  db.run('UPDATE "check" SET retired_at = ? WHERE id = ?', nowMs(clock), current.id);
  const checkId = insertCheck(db, unitId, want.spec, clock, {
    ...(threshold !== null ? { threshold } : {}),
    ...(contentRefId !== null ? { contentRefId } : {}),
  });
  return { outcome: 'replaced', checkId, retiredId: current.id };
}
