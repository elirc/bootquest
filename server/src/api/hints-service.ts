import type { ApiErrorCode } from '@bootquest/shared/api';
import type { HintLockReason, HintsResponse, HintTakenResponse } from '@bootquest/shared/api-ext';
import { questUnitUnlocked } from '../engines/campaign.ts';
import { hasFailedSubmit, hasVerifiedPass, hintsTaken, hintXpMultiplier, recordHint, servableHints } from '../engines/hints.ts';
import { xpKindForCheck } from '../engines/xp.ts';
import { getTrack, getUnit, primaryCheck, type UnitRecord } from '../store/queries.ts';
import { HttpError } from './http.ts';
import { assertTrackOpen, type ServiceDeps } from './service.ts';

/**
 * f52 U13 (council ruling 6): GET /units/:id/hints and POST /units/:id/hint. The rules live in
 * engines/hints.ts; this file maps them to the two endpoints. The hint TEXTS stay server-side until
 * taken: GET serves only the texts already taken (recorded in hint_taken), POST records the next one
 * and only then returns it. Nothing here writes XP or evidence: a hint is read back by xp.ts (the pass
 * XP cut) and by the promotion legs (never unassisted evidence).
 */

/** Unit kinds that never serve hints, whatever their check type. */
const NO_HINT_KINDS: ReadonlySet<string> = new Set(['quiz', 'predict-output', 'study', 'reading', 'explain-back', 'patch-kata', 'review', 'retest', 'written']);

function requireUnit(deps: ServiceDeps, id: number): UnitRecord {
  const unit = getUnit(deps.db, id);
  if (!unit) throw new HttpError(404, 'NOT_FOUND', `unit ${id} not found`);
  return unit;
}

/** The unit's servable hints: [] unless it is a drill / code-check unit (live check earning code XP). */
function servableFor(deps: ServiceDeps, unit: UnitRecord): string[] {
  if (NO_HINT_KINDS.has(unit.kind)) return [];
  const check = primaryCheck(deps.db, unit.id);
  if (!check || xpKindForCheck(check.type) !== 'code') return [];
  return servableHints(deps.content.get(unit.key)?.hints);
}

function unitPlayable(deps: ServiceDeps, unit: UnitRecord): boolean {
  if (getTrack(deps.db, unit.trackId)?.locked ?? true) return false;
  return questUnitUnlocked(deps.db, unit.id) !== false;
}

interface HintState {
  servable: string[];
  takenCount: number;
  reason: HintLockReason | null;
}

function hintState(deps: ServiceDeps, unit: UnitRecord): HintState {
  const servable = servableFor(deps, unit);
  const takenCount = Math.min(hintsTaken(deps.db, unit.id).length, servable.length);
  let reason: HintLockReason | null = null;
  if (servable.length === 0) reason = 'not-hintable';
  else if (!unitPlayable(deps, unit)) reason = 'locked';
  else if (hasVerifiedPass(deps.db, unit.id)) reason = 'passed';
  else if (takenCount >= servable.length) reason = 'exhausted';
  else if (!hasFailedSubmit(deps.db, unit.id)) reason = 'needs-fail';
  return { servable, takenCount, reason };
}

function view(unit: UnitRecord, s: HintState): HintsResponse {
  return {
    unitId: unit.id,
    total: s.servable.length,
    taken: s.servable.slice(0, s.takenCount),
    nextAvailable: s.reason === null,
    ...(s.reason !== null ? { lockedReason: s.reason } : {}),
    xpPct: Math.round(hintXpMultiplier(s.takenCount) * 100),
  };
}

/** GET /units/:id/hints — read-only. */
export function getHints(deps: ServiceDeps, unitId: number): HintsResponse {
  const unit = requireUnit(deps, unitId);
  return view(unit, hintState(deps, unit));
}

/**
 * POST refusals, on the existing envelope codes (ApiErrorCode lives in api.ts, which stays byte-identical);
 * the client reads GET `lockedReason` for the why, the message says it in words.
 */
const REFUSALS: Readonly<Record<Exclude<HintLockReason, 'locked'>, { status: number; code: ApiErrorCode; message: (id: number) => string }>> = {
  'not-hintable': { status: 409, code: 'WRONG_UNIT_KIND', message: (id) => `unit ${id} serves no hints (drill / code-check units with more than one authored hint only)` },
  'needs-fail': { status: 409, code: 'NOT_ANSWERED', message: (id) => `unit ${id}: submit an attempt first; a hint opens after one failed submit` },
  passed: { status: 409, code: 'ALREADY_ANSWERED', message: (id) => `unit ${id} already has a verified pass; hints are for getting unstuck` },
  exhausted: { status: 404, code: 'NOT_FOUND', message: (id) => `unit ${id}: every hint was taken; Reveal solution is the next step` },
};

/** POST /units/:id/hint — records the next hint (append-only hint_taken row), then returns it. */
export function takeHint(deps: ServiceDeps, unitId: number): HintTakenResponse {
  const { db } = deps;
  const unit = requireUnit(deps, unitId);
  return db.tx(() => {
    const s = hintState(deps, unit);
    if (s.reason === 'locked') {
      assertTrackOpen(db, unit); // 403 TRACK_LOCKED / ACT_LOCKED
      throw new HttpError(403, 'TRACK_LOCKED', `unit ${unit.id} is not playable`);
    }
    if (s.reason !== null) {
      const r = REFUSALS[s.reason];
      throw new HttpError(r.status, r.code, r.message(unit.id));
    }
    const idx = recordHint(db, unit.id, deps.clock);
    const after = hintState(deps, unit);
    return { ...view(unit, after), hint: { index: idx, text: s.servable[idx - 1]! } };
  });
}
