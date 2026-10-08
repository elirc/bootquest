import type { Db } from '../db/database.ts';
import { READING_ATTEST_SQL, VERIFIED_PASS_SQL } from './attempts.ts';
import { levelForXp } from './level.ts';
import { totalXp } from './xp.ts';

/**
 * Campaign act unlocking + quest state (W5b, spec §3.3), derived QUERY-SIDE
 * from the ledger every time — nothing is stored as "unlocked".
 *
 * Rule (pure: actUnlockStates):
 *   act 1 is open (unless statically locked, e.g. the Java placeholder act);
 *   act N+1 is unlocked iff act N is unlocked
 *                       AND coreDone(N) / coreTotal(N) >= unlock_pct(N+1)  (0.8)
 *                       AND level >= unlock_level(N+1).
 * CORE = study quests (verdict study). Reading steps (skims) never count toward
 * the percentage. A core quest is done when its unit has a VERIFIED pass (a
 * passing submit run); a study quest whose quiz gate is not seeded yet cannot
 * be done, so an act whose core is still content-pending holds the next act
 * shut — honest by construction. An act with zero core quests passes the
 * percentage leg vacuously. The percentage compare is integer math
 * (done*100 >= round(pct*100)*total) so 79.99% never rounds up to 80%.
 * The level is the GLOBAL level (engines/level.ts) — there is one XP ledger.
 */

export interface ActGate {
  actNo: number;
  /** fraction of the PREVIOUS act's core quests required to enter this act */
  unlockPct: number;
  /** minimum level to enter this act */
  unlockLevel: number;
  /** static lock (Java placeholder): never unlocked */
  staticLock: boolean;
  coreDone: number;
  coreTotal: number;
}

/** pct leg: done/total >= pct, integer math; an empty core passes. */
export function meetsCorePct(coreDone: number, coreTotal: number, pct: number): boolean {
  if (coreTotal <= 0) return true;
  return coreDone * 100 >= Math.round(pct * 100) * coreTotal;
}

/** PURE: unlocked flag per act (acts in actNo order), given the global level and whether the track is locked. */
export function actUnlockStates(acts: readonly ActGate[], level: number, trackLocked = false): boolean[] {
  const sorted = [...acts].sort((a, b) => a.actNo - b.actNo);
  const out = new Map<number, boolean>();
  let prev: ActGate | null = null;
  let prevUnlocked = true;
  for (const act of sorted) {
    let unlocked = !trackLocked && !act.staticLock && level >= act.unlockLevel;
    if (prev !== null) unlocked = unlocked && prevUnlocked && meetsCorePct(prev.coreDone, prev.coreTotal, act.unlockPct);
    out.set(act.actNo, unlocked);
    prev = act;
    prevUnlocked = unlocked;
  }
  return acts.map((a) => out.get(a.actNo)!);
}

// ---------------------------------------------------------------- ledger-derived state

export type QuestStateName = 'locked' | 'pending' | 'available' | 'done';

export interface QuestState {
  id: number;
  key: string | null;
  kind: 'study-quest' | 'reading';
  title: string;
  repo: string;
  rank: number;
  unitId: number | null;
  core: boolean;
  contentPending: boolean;
  twinRepo: string | null;
  /** a learner can complete it now-or-once-unlocked: live reading unit, or a live unit with a check */
  actionable: boolean;
  done: boolean;
  state: QuestStateName;
}

export interface ActState {
  id: number;
  trackId: string;
  actNo: number;
  title: string;
  theme: string | null;
  unlockPct: number;
  unlockLevel: number;
  staticLock: boolean;
  unlocked: boolean;
  coreDone: number;
  coreTotal: number;
  quests: QuestState[];
}

interface ActRow {
  id: number;
  trackId: string;
  actNo: number;
  title: string;
  theme: string | null;
  unlockPct: number;
  unlockLevel: number;
  locked: number;
  trackLocked: number;
}

interface QuestRow {
  id: number;
  actId: number;
  key: string | null;
  questKind: string | null;
  title: string | null;
  repo: string;
  rank: number;
  ordinal: number | null;
  unitId: number | null;
  core: number;
  contentPending: number;
  twinRepo: string | null;
  verdict: string;
  unitKind: string | null;
  unitLive: number;
  checks: number;
}

/** Units with a verified pass or a reading self-attest (the same predicate as the unit lists). */
function doneUnitIds(db: Db): Set<number> {
  return new Set(
    db
      .all<{ u: number }>(
        `SELECT DISTINCT a.unit_id AS u FROM attempt a JOIN unit u ON u.id = a.unit_id
          WHERE a.unit_id IN (SELECT unit_id FROM quest WHERE unit_id IS NOT NULL)
            AND (${VERIFIED_PASS_SQL} OR ${READING_ATTEST_SQL})`,
      )
      .map((r) => r.u),
  );
}

export function currentLevel(db: Db): number {
  return levelForXp(totalXp(db));
}

/** Every act (with its quests and derived state) of one track, or of all tracks when trackId is omitted. */
export function campaignState(db: Db, trackId?: string, level: number = currentLevel(db)): ActState[] {
  const acts = db.all<ActRow>(
    `SELECT ca.id, ca.track_id AS trackId, ca.act_no AS actNo, ca.title, ca.theme, ca.unlock_pct AS unlockPct,
            ca.unlock_level AS unlockLevel, ca.locked, t.locked AS trackLocked
       FROM campaign_act ca JOIN track t ON t.id = ca.track_id
      ${trackId === undefined ? '' : 'WHERE ca.track_id = ?'}
      ORDER BY t.sort_order, ca.act_no`,
    ...(trackId === undefined ? [] : [trackId]),
  );
  if (acts.length === 0) return [];
  const quests = db.all<QuestRow>(
    `SELECT q.id, q.act_id AS actId, q.key, q.quest_kind AS questKind, q.title, q.repo, q.index_rank AS rank, q.ordinal,
            q.unit_id AS unitId, q.core, q.content_pending AS contentPending, q.twin_repo AS twinRepo, q.verdict,
            u.kind AS unitKind, (u.id IS NOT NULL AND u.retired_at IS NULL) AS unitLive,
            (SELECT COUNT(*) FROM "check" c WHERE c.unit_id = q.unit_id) AS checks
       FROM quest q LEFT JOIN unit u ON u.id = q.unit_id
      ORDER BY q.act_id, COALESCE(q.ordinal, q.index_rank), q.index_rank, q.id`,
  );
  const done = doneUnitIds(db);
  const byAct = new Map<number, QuestRow[]>();
  for (const q of quests) {
    const list = byAct.get(q.actId) ?? [];
    list.push(q);
    byAct.set(q.actId, list);
  }

  const out: ActState[] = [];
  for (const tid of [...new Set(acts.map((a) => a.trackId))]) {
    const trackActs = acts.filter((a) => a.trackId === tid);
    const partial = trackActs.map((a) => {
      const qs = (byAct.get(a.id) ?? []).map((q) => {
        const kind: QuestState['kind'] = q.questKind === 'reading' || (q.questKind === null && q.verdict === 'skim') ? 'reading' : 'study-quest';
        const actionable = Boolean(q.unitLive) && q.unitId !== null && (q.unitKind === 'reading' || q.checks > 0);
        return {
          id: q.id,
          key: q.key,
          kind,
          title: q.title ?? q.repo,
          repo: q.repo,
          rank: q.rank,
          unitId: q.unitId,
          core: Boolean(q.core) && kind === 'study-quest',
          contentPending: Boolean(q.contentPending) || (kind === 'study-quest' && !actionable),
          twinRepo: q.twinRepo,
          actionable,
          done: q.unitId !== null && Boolean(q.unitLive) && done.has(q.unitId),
          state: 'locked' as QuestStateName,
        };
      });
      const core = qs.filter((q) => q.core);
      return { a, qs, coreDone: core.filter((q) => q.done).length, coreTotal: core.length };
    });
    const trackLocked = Boolean(trackActs[0]!.trackLocked);
    const unlocked = actUnlockStates(
      partial.map((p) => ({
        actNo: p.a.actNo,
        unlockPct: p.a.unlockPct,
        unlockLevel: p.a.unlockLevel,
        staticLock: Boolean(p.a.locked),
        coreDone: p.coreDone,
        coreTotal: p.coreTotal,
      })),
      level,
      trackLocked,
    );
    partial.forEach((p, i) => {
      const open = unlocked[i]!;
      for (const q of p.qs) {
        q.state = trackLocked || p.a.locked ? 'locked' : q.done ? 'done' : !open ? 'locked' : q.actionable ? 'available' : 'pending';
      }
      out.push({
        id: p.a.id,
        trackId: p.a.trackId,
        actNo: p.a.actNo,
        title: p.a.title,
        theme: p.a.theme,
        unlockPct: p.a.unlockPct,
        unlockLevel: p.a.unlockLevel,
        staticLock: Boolean(p.a.locked),
        unlocked: open,
        coreDone: p.coreDone,
        coreTotal: p.coreTotal,
        quests: p.qs,
      });
    });
  }
  return out;
}

/**
 * The act gate for a unit-scoped write (run / submit / reveal / self-attest /
 * answer): null when the unit is not a campaign quest unit, else whether ANY
 * act holding it is unlocked.
 */
export function questUnitUnlocked(db: Db, unitId: number): boolean | null {
  const tracks = db.all<{ t: string }>(
    'SELECT DISTINCT ca.track_id AS t FROM quest q JOIN campaign_act ca ON ca.id = q.act_id WHERE q.unit_id = ?',
    unitId,
  );
  if (tracks.length === 0) return null;
  const level = currentLevel(db);
  return tracks.some((t) => campaignState(db, t.t, level).some((a) => a.unlocked && a.quests.some((q) => q.unitId === unitId)));
}

/** Slate: is there a campaign step the learner can actually take today (an actionable, not-done quest in an unlocked act)? */
export function campaignStepAvailable(db: Db): boolean {
  return campaignState(db).some((a) => a.unlocked && a.quests.some((q) => q.actionable && !q.done));
}
