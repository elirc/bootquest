import { PROJECT_UNIT_KINDS, type TrackId } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { EB_PASS_SQL } from '../engines/eb-score.ts';
import { fundKeyParts, FUND_SENIOR_TOPICS, type SeniorRep } from '../engines/streak.ts';
import { listTracks, unitsForTrack, type UnitRecord } from '../store/queries.ts';
import { archivedUnitIds, resolvePath, routing } from '../store/routing.ts';
import type { FindCtx } from './find-service.ts';
import { lockStateFor } from './service.ts';

/**
 * rv wave C: "what to do next" on the server (R4-10, R3-08, R5-03), shared by GET /dashboard nextUp (the
 * CLI prints it; the web dashboard no longer has a Next up panel) and the slate's link targets.
 *
 *   - Archived units (content/archive.json) are never a next step.
 *   - A track with a path (content/paths/<track>.json) walks it in order: the first open unit on the
 *     path. Only when the path is exhausted does the track fall back to its served order.
 *   - A Fundamentals track (js / csharp / java) offers its ladder step first: the first topic gate not
 *     passed (null when that topic is still locked), else that topic's first open drill.
 *   - f52 C8, narrowed: an explain-back / kata (answered from memory) is offered when it is ON a path;
 *     off a path it is offered only when nothing else is open.
 *   - G3 / G4 (project kinds) are never a fallback next step: they are reached only through the agentic
 *     path, after its G2 briefs and katas (G4 is archived, so never).
 * "Done" for a self-scored unit (explain-back, kata) is a self-score on record (passing for an EB);
 * everything else uses the shared lock state (verified pass / reading self-attest).
 */

const ANSWER_FROM_MEMORY_KINDS: ReadonlySet<string> = new Set(['explain-back', 'patch-kata']);
const PROJECT_KIND_SET: ReadonlySet<string> = new Set(PROJECT_UNIT_KINDS);

/** Explain-back units with a passing self-score and kata units with a self-score (never practice / reveal). */
export function selfScoredUnitIds(db: Db): Set<number> {
  return new Set(
    db
      .all<{ u: number }>(
        `SELECT DISTINCT e.unit_id AS u FROM evidence e
          WHERE e.unit_id IS NOT NULL AND e.assistance NOT IN ('reveal', 'practice')
            AND ((e.kind = 'explain-back' AND ${EB_PASS_SQL}) OR e.kind = 'kata')`,
      )
      .map((r) => r.u),
  );
}

export interface NextCtx extends FindCtx {
  selfScored: Set<number>;
  archived: Set<number>;
}

export function nextCtx(ctx: FindCtx): NextCtx {
  return { ...ctx, selfScored: selfScoredUnitIds(ctx.db), archived: archivedUnitIds(ctx.db) };
}

/** Open = not archived, not revealed, available by the shared lock rule, and not self-scored (EB / kata). */
function isOpen(ctx: NextCtx, u: UnitRecord): boolean {
  if (ctx.archived.has(u.id) || ctx.revealed.has(u.id) || u.kind === 'written') return false;
  if (ANSWER_FROM_MEMORY_KINDS.has(u.kind) && ctx.selfScored.has(u.id)) return false;
  return lockStateFor(u, false, ctx.passed, ctx.prereqs) === 'available';
}

/** The track's Fundamentals ladder step (gate, else its topic's first open drill); null = none / locked / finished. */
export function fundamentalsStep(ctx: NextCtx, units: readonly UnitRecord[], track: string, minTopic = 0, maxTopic = 99): UnitRecord | null {
  const ladder = units.flatMap((u) => {
    const p = fundKeyParts(u.key);
    return p && p.track === track && p.topicNo >= minTopic && p.topicNo <= maxTopic ? [{ u, p }] : [];
  });
  const gates = ladder.filter((x) => x.u.key === x.p.gateKey).sort((a, b) => a.u.key.localeCompare(b.u.key));
  for (const g of gates) {
    if (!ctx.passed.has(g.u.id)) return lockStateFor(g.u, false, ctx.passed, ctx.prereqs) === 'available' ? g.u : null;
    const drill = ladder.find((x) => x.u.kind === 'drill' && x.p.gateKey === g.u.key && isOpen(ctx, x.u));
    if (drill) return drill.u;
  }
  return null;
}

/** The first open unit on a track's path (null = no path, or nothing open on it). */
export function pathStep(ctx: NextCtx, trackId: string, filter: (u: UnitRecord) => boolean = () => true): UnitRecord | null {
  const steps = resolvePath(ctx.db, trackId, routing());
  if (!steps) return null;
  const byId = new Map(unitsForTrack(ctx.db, trackId).map((u) => [u.id, u]));
  for (const s of steps) {
    for (const id of s.unitIds) {
      const u = byId.get(id);
      if (u && filter(u) && isOpen(ctx, u)) return u;
    }
  }
  return null;
}

/** One track's next step (see the header). */
export function nextUpUnit(ctx: NextCtx, trackId: string): UnitRecord | null {
  const units = unitsForTrack(ctx.db, trackId);
  const fund = fundamentalsStep(ctx, units, trackId);
  if (fund) return fund;
  const onPath = pathStep(ctx, trackId);
  if (onPath) return onPath;
  const open = units.filter((u) => isOpen(ctx, u) && !PROJECT_KIND_SET.has(u.kind));
  return open.find((u) => !ANSWER_FROM_MEMORY_KINDS.has(u.kind)) ?? open[0] ?? null;
}

export function nextUpList(ctx: NextCtx): { trackId: TrackId; unit: { id: number; key: string; title: string; kind: UnitRecord['kind'] } | null }[] {
  return listTracks(ctx.db)
    .filter((t) => !t.locked)
    .map((t) => {
      const next = nextUpUnit(ctx, t.id);
      return { trackId: t.id, unit: next ? { id: next.id, key: next.key, title: next.title, kind: next.kind } : null };
    });
}

/** The slate's Fundamentals-step link: the primary ladder's step. */
export function fundStepTarget(ctx: NextCtx, track: string): number | null {
  return fundamentalsStep(ctx, unitsForTrack(ctx.db, track), track)?.id ?? null;
}

/** The slate's senior-rep link for the day's suggested kind. */
export function seniorRepTarget(ctx: NextCtx, rep: SeniorRep): number | null {
  if (rep === 'fund-senior') {
    return fundamentalsStep(ctx, unitsForTrack(ctx.db, FUND_SENIOR_TOPICS.track), FUND_SENIOR_TOPICS.track, FUND_SENIOR_TOPICS.from, FUND_SENIOR_TOPICS.to)?.id ?? null;
  }
  const track = rep === 'design' ? 'sysdesign' : 'agentic';
  const kind = rep === 'design' ? 'explain-back' : 'patch-kata';
  const fromPath = pathStep(ctx, track, (u) => u.kind === kind);
  if (fromPath) return fromPath.id;
  return unitsForTrack(ctx.db, track).find((u) => u.kind === kind && isOpen(ctx, u))?.id ?? null;
}
