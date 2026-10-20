import {
  CompetencyId,
  evaluateMutation,
  floorPctFor,
  PROJECT_UNIT_KINDS,
  type MutationFileStat,
  type MutationTool,
  type MutationVerdict,
} from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { findVariation, getAttempt, HonestyRuleError, revealedInVariationChain, VERIFIED_PASS_SQL } from './attempts.ts';
import { nowMs, type Clock } from './clock.ts';
import { evaluatePromotion, isVariationOf, lastRatingChangeAt, PROMOTION_MIN_COVERAGE, RETEST_MIN_DELAY_MS } from './evidence.ts';

/**
 * W6 competency-ladder flow helpers on top of the W1a/W1c engines:
 *  - changed-example retest SCHEDULING (spec §6.2 leg (c)): a passing explain-back
 *    self-score writes a review_item of kind 'retest' due >= 2 days after the later
 *    of the artifact and explain-back attempts. Retest items are not FSRS cards
 *    (fsrs.ts / queries exclude them); they are "done" once the retest unit has a
 *    verified solo pass at/after the due time (derived, never stored);
 *  - the retest GATE: a submit on a retest unit whose schedule is not due yet is
 *    refused before anything is graded or recorded (the engine's 48h rule on
 *    attempt.created_at stays the truth either way);
 *  - PromotionProgress: the three legs as the dashboard shows them, derived from
 *    evaluatePromotion (never stored);
 *  - the MUTATION gate evidence (spec §5): re-evaluated server-side from the
 *    report counts, linked to the unit's latest verified-pass attempt.
 */

const PROJECT_KINDS_SQL = PROJECT_UNIT_KINDS.map((k) => `'${k}'`).join(', ');
const PROJECT_KIND_SET: ReadonlySet<string> = new Set(PROJECT_UNIT_KINDS);

// ---------------------------------------------------------------- retest scheduling

export interface RetestSchedule {
  reviewItemId: number;
  /** the retest (variation) unit to submit */
  unitId: number;
  title: string;
  /** the project unit whose artifact this retest re-checks */
  artifactUnitId: number;
  explainBackAttemptId: number;
  dueAt: number;
  createdAt: number;
}

interface RetestMarker {
  retest: { artifactUnitId: number; explainBackAttemptId: number };
}

function unitKind(db: Db, unitId: number): string {
  const row = db.get<{ kind: string }>('SELECT kind FROM unit WHERE id = ?', unitId);
  if (!row) throw new Error(`unit ${unitId} not found`);
  return row.kind;
}

/** Project units an explain-back unit explains: itself (when project-kind) or its project-kind prerequisites. */
export function explainedArtifactUnits(db: Db, explainBackUnitId: number): number[] {
  if (PROJECT_KIND_SET.has(unitKind(db, explainBackUnitId))) return [explainBackUnitId];
  return db
    .all<{ id: number }>(
      `SELECT u.id AS id FROM unit_prerequisite p JOIN unit u ON u.id = p.prereq_unit_id
        WHERE p.unit_id = ? AND u.kind IN (${PROJECT_KINDS_SQL}) ORDER BY u.id`,
      explainBackUnitId,
    )
    .map((r) => r.id);
}

/** Latest verified, solo pass on a unit attempted at or before `t`, or null. */
function latestSoloPassAtOrBefore(db: Db, unitId: number, t: number): number | null {
  return (
    db.get<{ t: number | null }>(
      `SELECT MAX(a.created_at) AS t FROM attempt a WHERE a.unit_id = ? AND a.mode = 'solo' AND a.created_at <= ? AND ${VERIFIED_PASS_SQL}`,
      unitId,
      t,
    )?.t ?? null
  );
}

export interface PendingArtifact {
  unitId: number;
  title: string;
}

/**
 * Ladder dead end #2 (w6-audit #5 scenario 1): the artifact units whose promotion leg (b) an
 * answer on this explain-back unit WOULD anchor, but that have no verified solo pass yet. An
 * answer now would burn leg (b) for good — the answer is once per question set and leg (b)
 * needs it at/after the artifact attempt (evidence.ts) — so the answer is refused until this
 * list is empty.
 *
 * Exactly the evaluator's linkage: only an 'explain-back'-kind unit links to its project-kind
 * prerequisites. Standalone sets (no project prerequisite: G2 rubrics, the javabootcamp design
 * sets, quest-linked sets with no artifact) are never gated. A prerequisite that can never be
 * passed solo is not waited on (that would be a new dead end): a retired unit, a unit with no
 * LIVE check (a re-seed retired its only check), or a unit whose solution was revealed on it
 * OR anywhere up its variation_of chain (server review F6: deriveMode makes every later attempt
 * on such a unit guided, exactly revealedInVariationChain).
 */
export function artifactsAwaitingSoloPass(db: Db, explainBackUnitId: number): PendingArtifact[] {
  if (unitKind(db, explainBackUnitId) !== 'explain-back') return [];
  return db
    .all<PendingArtifact>(
      `SELECT u.id AS unitId, u.title AS title FROM unit_prerequisite p JOIN unit u ON u.id = p.prereq_unit_id
        WHERE p.unit_id = ? AND u.kind IN (${PROJECT_KINDS_SQL}) AND u.retired_at IS NULL
          AND EXISTS (SELECT 1 FROM "check" c WHERE c.unit_id = u.id AND c.retired_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM attempt a WHERE a.unit_id = u.id AND a.mode = 'solo' AND ${VERIFIED_PASS_SQL})
        ORDER BY u.id`,
      explainBackUnitId,
    )
    .filter((p) => !revealedInVariationChain(db, p.unitId));
}

/**
 * Schedule the changed-example retest of every artifact unit this explain-back
 * explains (one review_item per artifact unit with a live seeded variation;
 * none seeded = graceful degrade, nothing scheduled). Only an artifact with a
 * verified solo pass at/before the explain-back ANSWER can pair with it as
 * leg (a) (leg (b) must come at/after the artifact attempt), so an artifact
 * without one gets no schedule — a retest there could never complete a chain
 * (w6-audit #5). Due = later of that pass and the explain-back answer, + 2 days.
 */
export function scheduleRetests(db: Db, explainBackAttemptId: number, now: Clock): RetestSchedule[] {
  const t = nowMs(now);
  return db.tx(() => {
    const eb = getAttempt(db, explainBackAttemptId);
    const out: RetestSchedule[] = [];
    for (const artifactUnitId of explainedArtifactUnits(db, eb.unit_id)) {
      const variation = findVariation(db, artifactUnitId);
      if (variation === null) continue;
      const passAt = latestSoloPassAtOrBefore(db, artifactUnitId, eb.created_at);
      if (passAt === null) continue;
      const anchor = Math.max(passAt, eb.created_at);
      const dueAt = anchor + RETEST_MIN_DELAY_MS;
      const marker: RetestMarker = { retest: { artifactUnitId, explainBackAttemptId } };
      const { lastInsertRowid } = db.run(
        `INSERT INTO review_item (card_key, kind, unit_id, content_ref_id, competency_id, fsrs_state, due_at, created_at, updated_at)
         VALUES (?, 'retest', ?, NULL, NULL, ?, ?, ?, ?)`,
        `retest:u${variation}:eb${explainBackAttemptId}`,
        variation,
        JSON.stringify(marker),
        dueAt,
        t,
        t,
      );
      out.push(getRetest(db, lastInsertRowid));
    }
    return out;
  });
}

const RETEST_COLUMNS = `ri.id AS reviewItemId, ri.unit_id AS unitId, u.title AS title,
  json_extract(ri.fsrs_state, '$.retest.artifactUnitId') AS artifactUnitId,
  json_extract(ri.fsrs_state, '$.retest.explainBackAttemptId') AS explainBackAttemptId,
  ri.due_at AS dueAt, ri.created_at AS createdAt`;

function getRetest(db: Db, reviewItemId: number): RetestSchedule {
  const row = db.get<RetestSchedule>(`SELECT ${RETEST_COLUMNS} FROM review_item ri JOIN unit u ON u.id = ri.unit_id WHERE ri.id = ?`, reviewItemId);
  if (!row) throw new Error(`retest ${reviewItemId} not found`);
  return row;
}

/** A schedule is done once its retest unit has a verified SOLO pass attempted at/after the due time. */
const RETEST_DONE_SQL = `EXISTS (SELECT 1 FROM attempt a WHERE a.unit_id = ri.unit_id AND a.mode = 'solo'
  AND a.created_at >= ri.due_at AND ${VERIFIED_PASS_SQL})`;

/** Open (not yet passed) retest schedules, earliest due first. */
export function openRetests(db: Db, now: Clock): (RetestSchedule & { due: boolean })[] {
  const t = nowMs(now);
  return db
    .all<RetestSchedule>(
      `SELECT ${RETEST_COLUMNS} FROM review_item ri JOIN unit u ON u.id = ri.unit_id
        WHERE ri.kind = 'retest' AND NOT ${RETEST_DONE_SQL} ORDER BY ri.due_at, ri.id`,
    )
    .map((r) => ({ ...r, due: r.dueAt <= t }));
}

export interface RetestGateView {
  open: boolean;
  /**
   *   due           a schedule for this unit is due (the real leg (c) path)
   *   practice      the unit or its artifact (variation_of chain) was revealed: guided
   *                 practice only — every attempt is auto-flagged, never a leg
   *   not-scheduled no schedule exists yet (artifact + explain-back >= 80% schedule it)
   *   not-due       a schedule exists and opens at opensAt
   */
  reason: 'due' | 'practice' | 'not-scheduled' | 'not-due';
  opensAt: number | null;
}

/**
 * W7 (audit #1): the retest GATE covers run, submit AND the unit's instructions. A
 * changed-example retest is closed until one of its schedules is due, so the >= 2-day
 * delay measures retention, not the paste of a day-0 solution found with free graded runs.
 * When any open schedule is still not due, the gate follows THAT one (the newest cycle),
 * never an older schedule that happens to be due. The reveal carve-out keeps the
 * reveal -> variation practice path (spec §4) open: such attempts are guided by
 * construction (deriveMode walks the variation chain), so they can never feed leg (c).
 */
export function retestGate(db: Db, retestUnitId: number, now: Clock): RetestGateView {
  if (revealedInVariationChain(db, retestUnitId)) return { open: true, reason: 'practice', opensAt: null };
  const open = openRetests(db, now).filter((r) => r.unitId === retestUnitId);
  if (open.length === 0) return { open: false, reason: 'not-scheduled', opensAt: null };
  const notDue = open.filter((r) => !r.due);
  if (notDue.length > 0) return { open: false, reason: 'not-due', opensAt: Math.max(...notDue.map((r) => r.dueAt)) };
  return { open: true, reason: 'due', opensAt: null };
}

/** Throws (HonestyRuleError NOT_DUE / NOT_VERIFIED) unless the retest gate is open. */
export function assertRetestOpen(db: Db, retestUnitId: number, now: Clock): RetestGateView {
  const g = retestGate(db, retestUnitId, now);
  if (g.open) return g;
  if (g.reason === 'not-due') {
    throw new HonestyRuleError(
      'NOT_DUE',
      `this changed-example retest opens at ${new Date(g.opensAt!).toISOString()} (>= 2 days after the artifact and its explain-back); until then it can be neither run nor submitted`,
    );
  }
  throw new HonestyRuleError(
    'NOT_VERIFIED',
    'this changed-example retest is not scheduled: pass its artifact unit solo, then its explain-back with >= 80% coverage; the retest opens >= 2 days later',
  );
}

// ---------------------------------------------------------------- promotion progress (dashboard)

export type LegState = 'done' | 'pending' | 'scheduled' | 'failed';

export interface PromotionProgressView {
  targetRating: number | null;
  eligible: boolean;
  artifact: { state: LegState; evidenceId: number | null; unitId: number | null };
  explainBack: { state: LegState; evidenceId: number | null; coverage: number | null };
  retest: { state: LegState; evidenceId: number | null; dueAt: number | null; unitId: number | null };
  missing: string[];
}

/** The three legs of one competency as the dashboard shows them (all derived from the evaluator). */
export function promotionProgress(db: Db, competency: CompetencyId, now: Clock): PromotionProgressView {
  CompetencyId.parse(competency);
  const t = nowMs(now);
  const ev = evaluatePromotion(db, competency, now);
  const since = lastRatingChangeAt(db, competency, t);
  const evRow = (id: number | null) =>
    id === null ? undefined : db.get<{ unitId: number | null; score: number | null }>('SELECT unit_id AS unitId, score FROM evidence WHERE id = ?', id);

  const artifactUnitId = evRow(ev.legs.artifact)?.unitId ?? null;
  const artifact = { state: (ev.legs.artifact === null ? 'pending' : 'done') as LegState, evidenceId: ev.legs.artifact, unitId: artifactUnitId };

  let explainBack: PromotionProgressView['explainBack'];
  if (ev.legs.explainBack !== null) {
    explainBack = { state: 'done', evidenceId: ev.legs.explainBack, coverage: evRow(ev.legs.explainBack)?.score ?? null };
  } else {
    // the newest explain-back in the window: a sub-80% self-score is a visible "failed" leg
    const last = db.get<{ id: number; score: number | null }>(
      `SELECT id, score FROM evidence WHERE competency_id = ? AND kind = 'explain-back' AND created_at > ? AND created_at <= ?
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      competency,
      since,
      t,
    );
    explainBack =
      last && (last.score ?? 0) < PROMOTION_MIN_COVERAGE
        ? { state: 'failed', evidenceId: last.id, coverage: last.score }
        : { state: 'pending', evidenceId: null, coverage: null };
  }

  let retest: PromotionProgressView['retest'] = { state: 'pending', evidenceId: null, dueAt: null, unitId: null };
  if (ev.legs.retest !== null) {
    retest = { state: 'done', evidenceId: ev.legs.retest, dueAt: null, unitId: evRow(ev.legs.retest)?.unitId ?? null };
  } else if (artifactUnitId !== null && ev.legs.explainBack !== null) {
    const sched = openRetests(db, now).find((r) => r.createdAt > since && (r.artifactUnitId === artifactUnitId || isVariationOf(db, r.unitId, artifactUnitId)));
    if (sched) retest = { state: 'scheduled', evidenceId: null, dueAt: sched.dueAt, unitId: sched.unitId };
  }

  return {
    targetRating: ev.rating >= 5 ? null : ev.rating + 1,
    eligible: ev.eligible,
    artifact,
    explainBack,
    retest,
    missing: ev.missing,
  };
}

// ---------------------------------------------------------------- mutation gate evidence

export class MutationGateError extends Error {
  readonly verdict: MutationVerdict;
  constructor(verdict: MutationVerdict) {
    super(`mutation gate failed: ${verdict.failures.join('; ')}`);
    this.name = 'MutationGateError';
    this.verdict = verdict;
  }
}

export interface MutationMarkerInput {
  unitId: number;
  attemptId?: number;
  tool: MutationTool;
  toolVersion: string;
  durationMs: number;
  files: MutationFileStat[];
}

/**
 * Record the mutation-gate marker (spec §5, mid tier, solo-project units only):
 * the per-file floor (check.threshold, default 40%) and the overall break (60%)
 * are re-evaluated HERE from the report counts; on pass, one verified pipeline
 * 'mutation' evidence row per declared competency, linked to the unit's LATEST
 * verified-pass attempt (the code whose tests were mutated). Fails closed:
 * non-project unit, no verified pass, a stale attempt, or a floor/break miss.
 */
export function recordMutationEvidence(
  db: Db,
  input: MutationMarkerInput,
  now: Clock,
): { attemptId: number; verdict: MutationVerdict; evidenceIds: number[] } {
  const t = nowMs(now);
  return db.tx(() => {
    const kind = unitKind(db, input.unitId);
    if (!PROJECT_KIND_SET.has(kind)) {
      throw new HonestyRuleError('WRONG_UNIT_KIND', `the mutation gate applies to solo-project units (${PROJECT_UNIT_KINDS.join('/')}), not ${kind}`);
    }
    const latest = db.get<{ id: number }>(
      `SELECT a.id AS id FROM attempt a WHERE a.unit_id = ? AND ${VERIFIED_PASS_SQL} ORDER BY a.created_at DESC, a.id DESC LIMIT 1`,
      input.unitId,
    );
    if (!latest) throw new HonestyRuleError('NOT_VERIFIED', `unit ${input.unitId} has no verified passing submit yet: submit the project first, then mutate`);
    if (input.attemptId !== undefined) {
      const a = getAttempt(db, input.attemptId);
      if (a.unit_id !== input.unitId) throw new HonestyRuleError('MISMATCH', `attempt ${a.id} is on unit ${a.unit_id}, not ${input.unitId}`);
      if (a.id !== latest.id) {
        throw new HonestyRuleError('MISMATCH', `attempt ${a.id} is not the latest verified pass on unit ${input.unitId} (#${latest.id}): mutate the code you last submitted`);
      }
    }
    const attempt = getAttempt(db, latest.id);
    const threshold = db.get<{ threshold: number | null }>('SELECT threshold FROM "check" WHERE unit_id = ? AND retired_at IS NULL ORDER BY id LIMIT 1', input.unitId)?.threshold;
    const verdict = evaluateMutation(input.files, { floorPct: floorPctFor(threshold) });
    if (!verdict.pass) throw new MutationGateError(verdict);

    const scored = verdict.files.filter((f) => f.scorePct !== null);
    const minFile = scored.reduce((m, f) => Math.min(m, f.scorePct!), Infinity);
    const observation =
      `${input.tool} ${input.toolVersion}: overall ${verdict.overallPct}% (break ${verdict.breakPct}%), ` +
      `${scored.length} scored file(s), lowest ${Number.isFinite(minFile) ? minFile : 'n/a'}% (per-file floor ${verdict.floorPct}%), ` +
      `${Math.round(input.durationMs / 1000)}s (counts self-reported by bootquest mutate; floor + break re-evaluated by the server)`;
    const competencies = db
      .all<{ c: CompetencyId }>('SELECT competency_id AS c FROM unit_competency WHERE unit_id = ? ORDER BY competency_id', input.unitId)
      .map((r) => r.c);
    const evidenceIds = competencies.map(
      (c) =>
        db.run(
          `INSERT INTO evidence (competency_id, attempt_id, unit_id, kind, intention, observation, assistance, assessor, rating, verified, score, created_at)
           VALUES (?, ?, ?, 'mutation', ?, ?, ?, 'pipeline', NULL, 1, ?, ?)`,
          c,
          attempt.id,
          input.unitId,
          'mutation gate: the project tests must kill mutants (per-file floor + overall break)',
          observation,
          attempt.assistance_source,
          (verdict.overallPct ?? 0) / 100,
          t,
        ).lastInsertRowid,
    );
    return { attemptId: attempt.id, verdict, evidenceIds };
  });
}
