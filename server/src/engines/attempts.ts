import { AttemptInput, type AttemptMode, type Assistance, type RunVerdict } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { runVerdict } from '../store/content.ts';
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

/**
 * A rule the honesty core refuses to bend. `code` is stable so the API layer
 * can map it to an HTTP status without string-matching messages.
 */
export class HonestyRuleError extends Error {
  readonly code: 'WRONG_UNIT_KIND' | 'ALREADY_ATTESTED' | 'NOT_DUE' | 'NOT_VERIFIED' | 'MISMATCH' | 'STALE';
  constructor(code: HonestyRuleError['code'], message: string) {
    super(message);
    this.name = 'HonestyRuleError';
    this.code = code;
  }
}

/**
 * SQL predicate (alias `a` = attempt): the attempt is a VERIFIED pass — its
 * outcome is 'pass' AND a submit run with verdict 'pass' is recorded for it.
 * Attempt outcomes are only ever derived from the run (recordSubmission), but
 * every honesty query re-checks the run so a raw 'pass' row proves nothing.
 */
export const VERIFIED_PASS_SQL = `(a.outcome = 'pass' AND EXISTS (
  SELECT 1 FROM run rv WHERE rv.attempt_id = a.id AND rv.kind = 'submit' AND rv.verdict = 'pass'))`;

/** True once a solution for this unit has ever been revealed (forever). */
export function isRevealed(db: Db, unitId: number): boolean {
  return (
    db.get(`SELECT 1 AS x FROM attempt WHERE unit_id = ? AND assistance_source = 'reveal' LIMIT 1`, unitId) !== undefined
  );
}

/**
 * W7 (audit #6): true when this unit OR any unit up its variation_of chain (the artifact a
 * changed-example retest re-checks) has ever been revealed. A retest of a revealed artifact
 * is practice, never unassisted evidence.
 */
export function revealedInVariationChain(db: Db, unitId: number): boolean {
  const row = db.get<{ x: number }>(
    `WITH RECURSIVE chain(id, depth) AS (
       SELECT ?, 0
       UNION ALL
       SELECT u.variation_of_unit_id, c.depth + 1 FROM unit u JOIN chain c ON u.id = c.id
        WHERE u.variation_of_unit_id IS NOT NULL AND c.depth < 16
     )
     SELECT 1 AS x FROM attempt a JOIN chain c ON a.unit_id = c.id WHERE a.assistance_source = 'reveal' LIMIT 1`,
    unitId,
  );
  return row !== undefined;
}

/**
 * Mode derivation (assistance propagation, spec §4/§6.2):
 *  - any prior reveal on the unit, or on its variation_of chain (W7 audit #6: the
 *    artifact a retest re-checks) -> guided (auto-flag, 'reveal')
 *  - honor-system self flag         -> assisted ('self')
 *  - otherwise                      -> solo ('none')
 */
export function deriveMode(db: Db, unitId: number, selfAssisted: boolean): { mode: AttemptMode; source: Assistance } {
  if (revealedInVariationChain(db, unitId)) return { mode: 'guided', source: 'reveal' };
  if (selfAssisted) return { mode: 'assisted', source: 'self' };
  return { mode: 'solo', source: 'none' };
}

function requireUnitKind(db: Db, unitId: number): string {
  const row = db.get<{ kind: string }>('SELECT kind FROM unit WHERE id = ?', unitId);
  if (!row) throw new Error(`unit ${unitId} not found`);
  return row.kind;
}

function assertCheckOfUnit(db: Db, checkId: number, unitId: number): void {
  // SELECT *: the migration tests build history on pre-012 schemas (no retired_at column = live)
  const row = db.get<{ unit_id: number; retired_at?: number | null }>('SELECT * FROM "check" WHERE id = ?', checkId);
  if (!row) throw new Error(`check ${checkId} not found`);
  if (row.unit_id !== unitId) throw new HonestyRuleError('MISMATCH', `check ${checkId} does not belong to unit ${unitId}`);
  // store/check-policy.ts: a retired check is history only; new attempts bind to the unit's live check
  if (row.retired_at != null) throw new HonestyRuleError('MISMATCH', `check ${checkId} was retired by a re-seed; record against the unit's live check`);
}

function insertAttempt(
  db: Db,
  a: { unitId: number; checkId?: number | null; mode: AttemptMode; source: Assistance; outcome: string; score?: number | null; answer?: unknown; variationUnitId?: number | null },
  t: number,
): number {
  return db.run(
    `INSERT INTO attempt (unit_id, check_id, mode, assisted, assistance_source, outcome, score, answer, variation_unit_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    a.unitId,
    a.checkId ?? null,
    a.mode,
    a.mode !== 'solo',
    a.source,
    a.outcome,
    a.score ?? null,
    a.answer === undefined ? null : JSON.stringify(a.answer),
    a.variationUnitId ?? null,
    t,
  ).lastInsertRowid;
}

/**
 * Append an UNGRADED answer attempt (outcome 'submitted'): the explain-back
 * transcript or kata findings, stored immutably before the key is revealed.
 * Mode/assistance are derived, never caller-chosen.
 */
export function recordAttempt(db: Db, input: AttemptInput, now: Clock): AttemptRow {
  const a = AttemptInput.parse(input);
  return db.tx(() => {
    requireUnitKind(db, a.unitId);
    if (a.checkId !== undefined) assertCheckOfUnit(db, a.checkId, a.unitId);
    const { mode, source } = deriveMode(db, a.unitId, a.selfAssisted);
    const id = insertAttempt(db, { unitId: a.unitId, checkId: a.checkId, mode, source, outcome: 'submitted', answer: a.answer }, nowMs(now));
    return getAttempt(db, id);
  });
}

const OUTCOME_FOR_VERDICT: Readonly<Record<RunVerdict, 'pass' | 'fail' | 'todo' | 'error'>> = {
  pass: 'pass',
  fail: 'fail',
  todo: 'todo',
  crashed: 'error',
  timeout: 'error',
  error: 'error',
};

export interface SubmissionInput {
  unitId: number;
  checkId: number;
  selfAssisted?: boolean;
  /** the runner's verdict JSON (validated as RunnerResult) */
  result: unknown;
  /** the learner's own submission (code / answer), stored on the attempt */
  answer?: unknown;
  /** W8: graded fraction 0..1 (study-quiz); default 1 for a pass, 0 otherwise */
  score?: number;
}

/**
 * Record a graded submit: ONE transaction writes the attempt — whose outcome
 * is DERIVED from the runner verdict — and the submit run row that proves it.
 * This is the only path that produces pass/fail/todo/error attempts.
 * Learner submissions are judged by the verdict as-is: `inverted` checks only
 * change what the shipped STARTER must do (starterMeetsContract), never how a
 * learner's fixed module is judged.
 */
export function recordSubmission(
  db: Db,
  input: SubmissionInput,
  now: Clock,
): { attempt: AttemptRow; runId: number; verdict: RunVerdict } {
  const { result, verdict } = runVerdict(input.result);
  const t = nowMs(now);
  return db.tx(() => {
    requireUnitKind(db, input.unitId);
    assertCheckOfUnit(db, input.checkId, input.unitId);
    const { mode, source } = deriveMode(db, input.unitId, input.selfAssisted ?? false);
    const attemptId = insertAttempt(
      db,
      {
        unitId: input.unitId,
        checkId: input.checkId,
        mode,
        source,
        outcome: OUTCOME_FOR_VERDICT[verdict],
        score: input.score !== undefined && Number.isFinite(input.score) && input.score >= 0 && input.score <= 1 ? input.score : verdict === 'pass' ? 1 : 0,
        answer: input.answer,
      },
      t,
    );
    const runId = db.run(
      `INSERT INTO run (kind, attempt_id, check_id, unit_id, verdict, passed, failed, todo, duration_ms, raw, created_at)
       VALUES ('submit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      attemptId,
      input.checkId,
      input.unitId,
      verdict,
      result.counts?.passed,
      result.counts?.failed,
      result.counts?.todo,
      Math.round(result.durationMs),
      JSON.stringify(result),
      t,
    ).lastInsertRowid;
    return { attempt: getAttempt(db, attemptId), runId, verdict };
  });
}

/** True when the attempt is a verified pass (outcome pass + passing submit run). */
export function isVerifiedPass(db: Db, attemptId: number): boolean {
  return db.get(`SELECT 1 AS x FROM attempt a WHERE a.id = ? AND ${VERIFIED_PASS_SQL}`, attemptId) !== undefined;
}

export const READING_ATTEST_ANSWER = { selfAttest: 'reading' } as const;

/** SQL predicate (alias `a`, unit alias `u`): a reading self-attest attempt. */
export const READING_ATTEST_SQL = `(u.kind = 'reading' AND a.check_id IS NULL AND a.outcome = 'pass'
  AND json_extract(a.answer, '$.selfAttest') = 'reading')`;

/**
 * Reading self-attest (spec §4 study quest reading steps, §6.1 "reading
 * self-attest 5"): valid ONLY on reading-kind units and only once per unit.
 * Writes a solo attempt with outcome 'pass' and no check / run — the honor
 * system is explicit in the answer marker, and VERIFIED_PASS_SQL never
 * matches it (no run), so it cannot feed drill slots, artifacts or retests.
 * XP is paid separately by awardXp({kind:'reading'}), which re-verifies this.
 */
export function selfAttestReading(db: Db, unitId: number, now: Clock): AttemptRow {
  return db.tx(() => {
    const kind = requireUnitKind(db, unitId);
    if (kind !== 'reading') {
      throw new HonestyRuleError('WRONG_UNIT_KIND', `self-attest is only valid on reading units (unit ${unitId} is ${kind})`);
    }
    const prior = db.get(
      `SELECT 1 AS x FROM attempt a JOIN unit u ON u.id = a.unit_id WHERE a.unit_id = ? AND ${READING_ATTEST_SQL}`,
      unitId,
    );
    if (prior) throw new HonestyRuleError('ALREADY_ATTESTED', `reading unit ${unitId} was already self-attested`);
    const id = insertAttempt(
      db,
      { unitId, checkId: null, mode: 'solo', source: 'none', outcome: 'pass', answer: READING_ATTEST_ANSWER },
      nowMs(now),
    );
    return getAttempt(db, id);
  });
}

/** First pre-seeded LIVE changed-example variant of a unit, or null when none is seeded yet. */
export function findVariation(db: Db, unitId: number): number | null {
  const row = db.get<{ id: number }>('SELECT id FROM unit WHERE variation_of_unit_id = ? AND retired_at IS NULL ORDER BY id LIMIT 1', unitId);
  return row?.id ?? null;
}

/**
 * Reveal-solution: writes a guided attempt with outcome 'revealed'. From now on
 * the unit earns 0 XP forever (xp.ts) and every later attempt on it is guided.
 * Schedules a pre-seeded variation when one exists; degrades to null otherwise.
 */
export function revealSolution(db: Db, unitId: number, now: Clock): { attempt: AttemptRow; variationUnitId: number | null } {
  const variationUnitId = findVariation(db, unitId);
  const id = insertAttempt(
    db,
    { unitId, checkId: null, mode: 'guided', source: 'reveal', outcome: 'revealed', variationUnitId },
    nowMs(now),
  );
  return { attempt: getAttempt(db, id), variationUnitId };
}

export function getAttempt(db: Db, id: number): AttemptRow {
  const row = db.get<AttemptRow>('SELECT * FROM attempt WHERE id = ?', id);
  if (!row) throw new Error(`attempt ${id} not found`);
  return row;
}
