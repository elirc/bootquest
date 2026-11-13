import type { TrackId } from '@bootquest/shared';
import type { DrillNextResponse, UnitSearchHit, UnitSearchResponse } from '@bootquest/shared/api-ext';
import { fundPackSource, fundTopicUnitKey, type FundTrack } from '@bootquest/shared/fundamentals';
import type { Db } from '../db/database.ts';
import { campaignState, type ActState } from '../engines/campaign.ts';
import { DAY_MS, dayKey, nowMs, type Clock } from '../engines/clock.ts';
import type { SlateItem } from '../engines/streak.ts';
import { getTrack, listTracks, passedUnitIds, prerequisiteMap, revealedUnitIds, searchUnitRows, unitsForTrack } from '../store/queries.ts';
import { lockStateFor } from './service.ts';
import { isArchivedKey } from '../store/routing.ts';
import { fundStepTarget, nextCtx, seniorRepTarget, type NextCtx } from './nextstep-service.ts';

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
    // rv wave C: an archived drill (content/archive.json) is never handed out
    (x) => x.kind === 'drill' && !ctx.revealed.has(x.id) && !isArchivedKey(x.key) && lockStateFor(x, false, ctx.passed, ctx.prereqs) === 'available',
  );
  return u ? { id: u.id, key: u.key, trackId: u.trackId, title: u.title, difficulty: u.difficulty } : null;
}

/** The Fundamentals view of one track: its drill-key prefix, topic of a key, and each topic's gate state. */
interface FundView {
  prefix: string;
  topicOf: (key: string) => string;
  /** the topic's lesson is open: its study (gate) unit is not locked, or is not loaded */
  topicOpen: (topic: string) => boolean;
  /** the topic's gate unit has a verified pass */
  topicPassed: (topic: string) => boolean;
}

/** null = the track has no Fundamentals units (`fund-<track>/` drills). */
function fundView(ctx: FindCtx, trackId: TrackId, units: ReturnType<typeof unitsForTrack>): FundView | null {
  const prefix = `${fundPackSource(trackId as FundTrack)}/`;
  if (!units.some((u) => u.key.startsWith(prefix))) return null;
  const byKey = new Map(units.map((u) => [u.key, u]));
  const gateOf = (topic: string) => byKey.get(fundTopicUnitKey(trackId as FundTrack, topic));
  return {
    prefix,
    topicOf: (key) => key.slice(prefix.length).split('/')[0] ?? '',
    topicOpen: (topic) => {
      const gate = gateOf(topic);
      return gate === undefined || lockStateFor(gate, false, ctx.passed, ctx.prereqs) !== 'locked';
    },
    topicPassed: (topic) => {
      const gate = gateOf(topic);
      return gate !== undefined && ctx.passed.has(gate.id);
    },
  };
}

const pickOf = (u: { id: number; key: string; trackId: TrackId; title: string; difficulty: number | null }): DrillPick => ({
  id: u.id,
  key: u.key,
  trackId: u.trackId,
  title: u.title,
  difficulty: u.difficulty,
});

/**
 * f52 U6 (W3.9): the slate's drill-set link for a language track prefers the Fundamentals ladder. Candidates
 * are the passable Fundamentals drills (`fund-<track>/<NN-topic>/<slug>`, same rule as firstOpenDrill: kind
 * 'drill', not passed, never revealed, available), in served order within a topic:
 *   - once ANY topic gate is passed: a drill of the HIGHEST-numbered topic whose gate is passed and that still
 *     has one (practice what was just learned); none left there = null;
 *   - no gate passed yet: a drill of the lowest topic whose lesson is open (its study unit
 *     `fund/<track>/<topic>` is not locked; a drill whose topic unit is not loaded counts as open).
 * null = no such drill (the caller falls back to firstOpenSlateDrill). Never a study (gate) unit. Used for
 * the slate link only: firstOpenDrill and /drills/next stay as they are.
 */
export function firstFundamentalsDrill(ctx: FindCtx, trackId: string): DrillPick | null {
  const track = getTrack(ctx.db, trackId);
  if (!track || track.locked) return null;
  const units = unitsForTrack(ctx.db, track.id);
  const fv = fundView(ctx, track.id, units);
  if (!fv) return null;
  const candidates = units.filter(
    (x) => x.kind === 'drill' && x.key.startsWith(fv.prefix) && !ctx.revealed.has(x.id) && lockStateFor(x, false, ctx.passed, ctx.prereqs) === 'available',
  );
  const byTopic = (dir: 1 | -1) => (a: (typeof units)[number], b: (typeof units)[number]) => {
    const ta = fv.topicOf(a.key);
    const tb = fv.topicOf(b.key);
    return ta < tb ? -dir : ta > tb ? dir : a.id - b.id;
  };
  const gatePrefix = fundTopicUnitKey(track.id as FundTrack, '');
  const anyPassed = units.some((u) => u.kind === 'study' && u.key.startsWith(gatePrefix) && ctx.passed.has(u.id));
  const u = anyPassed
    ? candidates.filter((x) => fv.topicPassed(fv.topicOf(x.key))).sort(byTopic(-1))[0]
    : candidates.filter((x) => fv.topicOpen(fv.topicOf(x.key))).sort(byTopic(1))[0];
  return u ? pickOf(u) : null;
}

/**
 * The slate's fallback drill-set link: firstOpenDrill's rule, except that a `fund-<track>/` drill whose
 * topic is LOCKED (its lesson is behind an unpassed earlier gate) is never picked. /drills/next keeps
 * firstOpenDrill unchanged.
 */
export function firstOpenSlateDrill(ctx: FindCtx, trackId: string): DrillPick | null {
  const track = getTrack(ctx.db, trackId);
  if (!track || track.locked) return null;
  const units = unitsForTrack(ctx.db, track.id);
  const fv = fundView(ctx, track.id, units);
  const u = units.find(
    (x) =>
      x.kind === 'drill' &&
      !ctx.revealed.has(x.id) &&
      !isArchivedKey(x.key) &&
      lockStateFor(x, false, ctx.passed, ctx.prereqs) === 'available' &&
      (fv === null || !x.key.startsWith(fv.prefix) || fv.topicOpen(fv.topicOf(x.key))),
  );
  return u ? pickOf(u) : null;
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
      .flatMap((a) => a.quests.filter((q) => q.state === 'available' && q.unitId !== null && !q.archived));
    const pick = open.find((q) => q.started && !q.done) ?? open[0];
    if (pick && pick.unitId !== null) return pick.unitId;
  }
  return null;
}

export type SlateItemWithTarget = SlateItem & { targetUnitId?: number | null };

/**
 * GET /dashboard response mapping: a COPY of each slate item plus the unit its row links to (a drill set:
 * the next Fundamentals drill of the track when it has one, else its first open drill outside a locked
 * Fundamentals topic). The
 * stored slate (daily_slate.items, frozen in closed days) is never touched: targetUnitId exists
 * in the response only. The review slot gets no target (it links to the review queue).
 */
export function withSlateTargets(ctx: FindCtx | NextCtx, items: readonly SlateItem[]): SlateItemWithTarget[] {
  let campaign: number | null | undefined;
  const nctx = 'selfScored' in ctx ? ctx : nextCtx(ctx);
  return items.map((item): SlateItemWithTarget => {
    // rv wave C: the Fundamentals step -> the primary ladder's step; the senior rep -> the day's suggested rep
    if (item.kind === 'fund-step') return { ...item, targetUnitId: fundStepTarget(nctx, item.track) };
    if (item.kind === 'senior-rep') return { ...item, targetUnitId: seniorRepTarget(nctx, item.rep) };
    // f52 U6: a language track's drill set links to its next Fundamentals drill first
    if (item.kind === 'drill-set') return { ...item, targetUnitId: (firstFundamentalsDrill(ctx, item.track) ?? firstOpenSlateDrill(ctx, item.track))?.id ?? null };
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
