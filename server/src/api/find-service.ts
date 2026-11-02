import type { TrackId } from '@bootquest/shared';
import type { DrillNextResponse, UnitSearchHit, UnitSearchResponse } from '@bootquest/shared/api-ext';
import type { Db } from '../db/database.ts';
import { campaignState, type ActState } from '../engines/campaign.ts';
import { DAY_MS, dayKey, nowMs, type Clock } from '../engines/clock.ts';
import type { SlateItem } from '../engines/streak.ts';
import { getTrack, listTracks, passedUnitIds, prerequisiteMap, revealedUnitIds, searchUnitRows, unitsForTrack } from '../store/queries.ts';
import { lockStateFor } from './service.ts';

/**
 * ab S4 "find things": unit search, the dashboard's slate link targets and the mixed drill rotation.
 * Read-only: nothing here writes a row. Every lock is the one the unit page applies
 * (service.ts lockStateFor + the campaign act gate), so a link or a hit never opens a locked unit.
 */

/** The ledger reads the finders share (one read each per request). */
export interface FindCtx {
  db: Db;
  passed: Set<number>;
  revealed: Set<number>;
  prereqs: Map<number, number[]>;
}

export function findCtx(db: Db, passed: Set<number> = passedUnitIds(db), prereqs: Map<number, number[]> = prerequisiteMap(db)): FindCtx {
  return { db, passed, revealed: revealedUnitIds(db), prereqs };
}

export interface DrillPick {
  id: number;
  key: string;
  trackId: TrackId;
  title: string;
  difficulty: number | null;
}

/**
 * The first passable drill of a track in served order: kind 'drill', not passed, never revealed
 * (a pass after a reveal is guided, 0 XP) and available (track open, prerequisites passed).
 * null = an unknown or locked track, or no such drill left.
 */
export function firstOpenDrill(ctx: FindCtx, trackId: string): DrillPick | null {
  const track = getTrack(ctx.db, trackId);
  if (!track || track.locked) return null;
  const u = unitsForTrack(ctx.db, track.id).find(
    (x) => x.kind === 'drill' && !ctx.revealed.has(x.id) && lockStateFor(x, false, ctx.passed, ctx.prereqs) === 'available',
  );
  return u ? { id: u.id, key: u.key, trackId: u.trackId, title: u.title, difficulty: u.difficulty } : null;
}

/**
 * The campaign step's unit: the first track (server order) with an available quest in an unlocked
 * act; within it the in-progress quest, else the first available one. This is the rule the
 * dashboard client used to apply itself over five GET /tracks/:id/campaign calls.
 */
export function campaignTarget(acts: readonly ActState[]): number | null {
  for (const trackId of [...new Set(acts.map((a) => a.trackId))]) {
    const open = acts
      .filter((a) => a.trackId === trackId && a.unlocked)
      .flatMap((a) => a.quests.filter((q) => q.state === 'available' && q.unitId !== null));
    const pick = open.find((q) => q.started && !q.done) ?? open[0];
    if (pick && pick.unitId !== null) return pick.unitId;
  }
  return null;
}

export type SlateItemWithTarget = SlateItem & { targetUnitId?: number | null };

/**
 * GET /dashboard response mapping: a COPY of each slate item plus the unit its row links to. The
 * stored slate (daily_slate.items, frozen in closed days) is never touched: targetUnitId exists
 * in the response only. The review slot gets no target (it links to the review queue).
 */
export function withSlateTargets(ctx: FindCtx, items: readonly SlateItem[]): SlateItemWithTarget[] {
  let campaign: number | null | undefined;
  return items.map((item): SlateItemWithTarget => {
    if (item.kind === 'drill-set') return { ...item, targetUnitId: firstOpenDrill(ctx, item.track)?.id ?? null };
    if (item.kind === 'campaign-step') {
      if (campaign === undefined) campaign = campaignTarget(campaignState(ctx.db));
      return { ...item, targetUnitId: campaign };
    }
    return { ...item };
  });
}

// ---------------------------------------------------------------- GET /units/search

const MAX_TOKENS = 8;

/** Lower-case whitespace tokens of a query (duplicates dropped, at most 8). */
export function searchTokens(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/\s+/).filter((t) => t !== ''))].slice(0, MAX_TOKENS);
}

/** 0 = title equals the query, 1 = title starts with it, 2 = title contains it, 3 = key contains it, 4 = tokens apart. */
function rankOf(hit: { key: string; title: string }, phrase: string): number {
  const t = hit.title.toLowerCase();
  if (t === phrase) return 0;
  if (t.startsWith(phrase)) return 1;
  if (t.includes(phrase)) return 2;
  return hit.key.toLowerCase().includes(phrase) ? 3 : 4;
}

/**
 * Quest unit id -> is ANY act holding it unlocked: the act gate getUnitDetail applies
 * (engines/campaign.ts questUnitUnlocked), for every quest unit from ONE campaign build.
 */
function questUnitOpen(db: Db): Map<number, boolean> {
  const open = new Map<number, boolean>();
  for (const a of campaignState(db)) {
    for (const q of a.quests) if (q.unitId !== null) open.set(q.unitId, (open.get(q.unitId) ?? false) || a.unlocked);
  }
  return open;
}

/**
 * Every live unit whose key or title contains every query token, best match first (rank, then id),
 * campaign quest units included with their act lock. Titles, keys and states only: no seed-item
 * text is read (store/queries.ts searchUnitRows), so nothing a unit withholds can leak here.
 */
export function searchUnits(db: Db, q: string, limit: number): UnitSearchResponse {
  const tokens = searchTokens(q);
  const rows = searchUnitRows(db, tokens);
  if (rows.length === 0) return { q, total: 0, items: [] };
  const trackLocked = new Map<string, boolean>(listTracks(db).map((t) => [t.id, Boolean(t.locked)]));
  const passed = passedUnitIds(db);
  const prereqs = prerequisiteMap(db);
  const questOpen = questUnitOpen(db);
  const phrase = tokens.join(' ');
  const hits = rows.map((r) => {
    let state = lockStateFor(r, trackLocked.get(r.trackId) ?? true, passed, prereqs);
    // a quest unit whose every act is locked: title + locked (a pass stays done, like the unit page)
    if (questOpen.get(r.id) === false && state !== 'done') state = 'locked';
    const hit: UnitSearchHit = { id: r.id, key: r.key, trackId: r.trackId, kind: r.kind, title: r.title, state, campaign: r.key.startsWith('campaign/') };
    return { hit, rank: rankOf(r, phrase) };
  });
  hits.sort((a, b) => a.rank - b.rank || a.hit.id - b.hit.id);
  return { q, total: hits.length, items: hits.slice(0, limit).map((h) => h.hit) };
}

// ---------------------------------------------------------------- GET /drills/next?mode=mixed

/** Whole days since 1970-01-01 of a 'YYYY-MM-DD' day key. */
const dayNumber = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

/**
 * Mixed (interleaved) drill practice. The rotation starts at (today's day number + drills already
 * passed on these tracks) mod n and takes the first track, round-robin from there, that still has a
 * passable drill (firstOpenDrill). Deterministic: the same ledger on the same day answers the same
 * unit, and each new drill pass moves the start one track on. No randomness.
 */
export function nextMixedDrill(db: Db, clock: Clock, tracks: readonly TrackId[]): DrillNextResponse {
  const ctx = findCtx(db);
  const passedDrills = tracks.reduce((n, t) => n + unitsForTrack(db, t).filter((u) => u.kind === 'drill' && ctx.passed.has(u.id)).length, 0);
  const startIndex = (dayNumber(dayKey(nowMs(clock))) + passedDrills) % tracks.length;
  for (let i = 0; i < tracks.length; i++) {
    const unit = firstOpenDrill(ctx, tracks[(startIndex + i) % tracks.length]!);
    if (unit) return { mode: 'mixed', tracks: [...tracks], startIndex, unit };
  }
  return { mode: 'mixed', tracks: [...tracks], startIndex, unit: null };
}
