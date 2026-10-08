import { AttemptInput, type AttemptMode, type Assistance } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { nowMs, type Clock } from './clock.ts';

export interface AttemptRow {
  id: number;
  unit_id: number;
  check_id: number | null;
  mode: AttemptMode;
  assisted: boolean;
  assistance_source: Assistance;
  outcome: string;
  score: number | null;
  answer: string | null;
  variation_unit_id: number | null;
  created_at: number;
}

/** True once a solution for this unit has ever been revealed (forever). */
export function isRevealed(db: Db, unitId: number): boolean {
  return (
    db.get(`SELECT 1 AS x FROM attempt WHERE unit_id = ? AND assistance_source = 'reveal' LIMIT 1`, unitId) !== undefined
  );
}

/**
 * Mode derivation (assistance propagation, spec §4/§6.2):
 *  - any prior reveal on the unit  -> guided (auto-flag, 'reveal')
 *  - honor-system self flag         -> assisted ('self')
 *  - otherwise                      -> solo ('none')
 */
export function deriveMode(db: Db, unitId: number, selfAssisted: boolean): { mode: AttemptMode; source: Assistance } {
  if (isRevealed(db, unitId)) return { mode: 'guided', source: 'reveal' };
  if (selfAssisted) return { mode: 'assisted', source: 'self' };
  return { mode: 'solo', source: 'none' };
}

/** Append an attempt row. Mode/assistance are derived, never caller-chosen. */
export function recordAttempt(db: Db, input: AttemptInput, now: Clock): AttemptRow {
  const a = AttemptInput.parse(input);
  const { mode, source } = deriveMode(db, a.unitId, a.selfAssisted);
  const { lastInsertRowid } = db.run(
    `INSERT INTO attempt (unit_id, check_id, mode, assisted, assistance_source, outcome, score, answer, variation_unit_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    a.unitId,
    a.checkId,
    mode,
    mode !== 'solo',
    source,
    a.outcome,
    a.score,
    a.answer === undefined ? null : JSON.stringify(a.answer),
    nowMs(now),
  );
  return getAttempt(db, lastInsertRowid);
}

/** First pre-seeded changed-example variant of a unit, or null when none is seeded yet. */
export function findVariation(db: Db, unitId: number): number | null {
  const row = db.get<{ id: number }>('SELECT id FROM unit WHERE variation_of_unit_id = ? ORDER BY id LIMIT 1', unitId);
  return row?.id ?? null;
}

/**
 * Reveal-solution: writes a guided attempt with outcome 'revealed'. From now on
 * the unit earns 0 XP forever (xp.ts) and every later attempt on it is guided.
 * Schedules a pre-seeded variation when one exists; degrades to null otherwise.
 */
export function revealSolution(db: Db, unitId: number, now: Clock): { attempt: AttemptRow; variationUnitId: number | null } {
  const variationUnitId = findVariation(db, unitId);
  const { lastInsertRowid } = db.run(
    `INSERT INTO attempt (unit_id, check_id, mode, assisted, assistance_source, outcome, score, answer, variation_unit_id, created_at)
     VALUES (?, NULL, 'guided', 1, 'reveal', 'revealed', NULL, NULL, ?, ?)`,
    unitId,
    variationUnitId,
    nowMs(now),
  );
  return { attempt: getAttempt(db, lastInsertRowid), variationUnitId };
}

export function getAttempt(db: Db, id: number): AttemptRow {
  const row = db.get<AttemptRow>('SELECT * FROM attempt WHERE id = ?', id);
  if (!row) throw new Error(`attempt ${id} not found`);
  return row;
}
