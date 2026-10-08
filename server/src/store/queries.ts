import { CheckSpec, type CompetencyId, type TrackId, type UnitKind } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { READING_ATTEST_SQL, VERIFIED_PASS_SQL } from '../engines/attempts.ts';

/**
 * Read-side queries for the HTTP API (W1b). Pure SQL reads mapped to camelCase
 * plain objects; no engine logic is duplicated here. Rows already pass through
 * db/hygiene.ts (null-prototype + BigInt cleanup) via Db.get/all.
 */

export interface UnitRecord {
  id: number;
  key: string;
  trackId: TrackId;
  kind: UnitKind;
  title: string;
  code: string | null;
  difficulty: number | null;
  variationOfUnitId: number | null;
}

export interface CheckRecord {
  id: number;
  unitId: number;
  type: CheckSpec['type'];
  threshold: number | null;
  /** FULL (private) spec — never serialize directly; use toPublicCheck. */
  spec: CheckSpec;
}

const UNIT_COLUMNS = `id, key, track_id AS trackId, kind, title, code, difficulty, variation_of_unit_id AS variationOfUnitId`;

/**
 * A LIVE unit by id. Retired units (quarantined after they were loaded, W2b/F2)
 * are invisible to every unit-scoped endpoint: detail, run, submit, reveal,
 * solution, self-attest and written answers all 404 on them.
 */
export function getUnit(db: Db, id: number): UnitRecord | undefined {
  return db.get<UnitRecord>(`SELECT ${UNIT_COLUMNS} FROM unit WHERE id = ? AND retired_at IS NULL`, id);
}

/** Live unit by its key (unit.key is UNIQUE); retired units are not found, like getUnit. */
export function getUnitByKey(db: Db, key: string): UnitRecord | undefined {
  return db.get<UnitRecord>(`SELECT ${UNIT_COLUMNS} FROM unit WHERE key = ? AND retired_at IS NULL`, key);
}

export function unitCompetencies(db: Db, unitId: number): CompetencyId[] {
  return db
    .all<{ c: CompetencyId }>(
      `SELECT uc.competency_id AS c FROM unit_competency uc JOIN competency k ON k.id = uc.competency_id
        WHERE uc.unit_id = ? ORDER BY k.sort_order`,
      unitId,
    )
    .map((r) => r.c);
}

export function unitPrerequisites(db: Db, unitId: number): number[] {
  return db
    .all<{ p: number }>('SELECT prereq_unit_id AS p FROM unit_prerequisite WHERE unit_id = ? ORDER BY prereq_unit_id', unitId)
    .map((r) => r.p);
}

/** The unit's primary check (lowest id), spec re-validated on the way out of the DB. */
export function primaryCheck(db: Db, unitId: number): CheckRecord | undefined {
  const row = db.get<{ id: number; unitId: number; threshold: number | null; spec: string }>(
    'SELECT id, unit_id AS unitId, threshold, spec FROM "check" WHERE unit_id = ? ORDER BY id LIMIT 1',
    unitId,
  );
  if (!row) return undefined;
  const spec = CheckSpec.parse(JSON.parse(row.spec));
  return { id: row.id, unitId: row.unitId, type: spec.type, threshold: row.threshold, spec };
}

export interface TrackRecord {
  id: TrackId;
  name: string;
  locked: boolean;
}

export function listTracks(db: Db): TrackRecord[] {
  return db.all<TrackRecord>('SELECT id, name, locked FROM track ORDER BY sort_order');
}

export function getTrack(db: Db, id: string): TrackRecord | undefined {
  return db.get<TrackRecord>('SELECT id, name, locked FROM track WHERE id = ?', id);
}

export function unitsForTrack(db: Db, trackId: string): UnitRecord[] {
  return db.all<UnitRecord>(`SELECT ${UNIT_COLUMNS} FROM unit WHERE track_id = ? AND retired_at IS NULL ORDER BY id`, trackId);
}

/** Units with a verified pass (passing submit run, any mode) or, for reading units, a self-attest. */
export function passedUnitIds(db: Db): Set<number> {
  return new Set(
    db
      .all<{ u: number }>(
        `SELECT DISTINCT a.unit_id AS u FROM attempt a JOIN unit u ON u.id = a.unit_id
          WHERE ${VERIFIED_PASS_SQL} OR ${READING_ATTEST_SQL}`,
      )
      .map((r) => r.u),
  );
}

/** Units whose solution has ever been revealed. */
export function revealedUnitIds(db: Db): Set<number> {
  return new Set(
    db.all<{ u: number }>(`SELECT DISTINCT unit_id AS u FROM attempt WHERE assistance_source = 'reveal'`).map((r) => r.u),
  );
}

/** All prerequisite edges as unit -> prereq ids. */
export function prerequisiteMap(db: Db): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const r of db.all<{ u: number; p: number }>('SELECT unit_id AS u, prereq_unit_id AS p FROM unit_prerequisite ORDER BY p')) {
    const list = map.get(r.u) ?? [];
    list.push(r.p);
    map.set(r.u, list);
  }
  return map;
}

/** Live content counts (retired units and their checks are withdrawn, so not counted). */
export function contentCounts(db: Db): { units: number; checks: number } {
  const units = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM unit WHERE retired_at IS NULL')?.n ?? 0;
  const checks = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM "check" c JOIN unit u ON u.id = c.unit_id WHERE u.retired_at IS NULL')?.n ?? 0;
  return { units, checks };
}

export interface CompetencyRow {
  id: CompetencyId;
  name: string;
  rating: number;
  lastEvidence: { id: number; kind: string; createdAt: number } | null;
}

/** The 7-row competency table: current rating + the latest evidence row per competency. */
export function competencyTable(db: Db): CompetencyRow[] {
  const rows = db.all<{ id: CompetencyId; name: string; rating: number; evId: number | null; evKind: string | null; evAt: number | null }>(
    `SELECT c.id AS id, c.name AS name, r.rating AS rating, e.id AS evId, e.kind AS evKind, e.created_at AS evAt
       FROM competency c
       JOIN competency_rating r ON r.competency_id = c.id
       LEFT JOIN evidence e ON e.id = (SELECT MAX(id) FROM evidence WHERE competency_id = c.id)
      ORDER BY c.sort_order`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    rating: r.rating,
    lastEvidence: r.evId === null ? null : { id: r.evId, kind: r.evKind ?? '', createdAt: r.evAt ?? 0 },
  }));
}

/** daily_slate statuses in an inclusive day range (for the heatmap). */
export function slateStatuses(db: Db, fromDay: string, toDay: string): Map<string, string> {
  return new Map(
    db
      .all<{ day: string; status: string }>('SELECT day, status FROM daily_slate WHERE day BETWEEN ? AND ?', fromDay, toDay)
      .map((r) => [r.day, r.status]),
  );
}

export interface ReviewQueueRow {
  id: number;
  cardKey: string;
  kind: 'card' | 'finding' | 'quiz-miss' | 'concept';
  unitId: number | null;
  competencyId: CompetencyId | null;
  dueAt: number;
}

export function reviewQueue(db: Db, atMs: number, limit: number): ReviewQueueRow[] {
  return db.all<ReviewQueueRow>(
    `SELECT id, card_key AS cardKey, kind, unit_id AS unitId, competency_id AS competencyId, due_at AS dueAt
       FROM review_item WHERE due_at <= ? ORDER BY due_at, id LIMIT ?`,
    atMs,
    limit,
  );
}

export function reviewItemExists(db: Db, id: number): boolean {
  return db.get('SELECT 1 AS x FROM review_item WHERE id = ?', id) !== undefined;
}

/** Row counts of the honesty ledger (tests + smoke use this to prove run writes nothing). */
export function ledgerCounts(db: Db): { attempt: number; run: number; xp_event: number; evidence: number } {
  const n = (t: string) => db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0;
  return { attempt: n('attempt'), run: n('run'), xp_event: n('xp_event'), evidence: n('evidence') };
}
