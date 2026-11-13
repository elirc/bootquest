import type { Db } from '../db/database.ts';
import { READING_ATTEST_SQL, VERIFIED_PASS_SQL } from './attempts.ts';
import { isArchivedKey } from '../store/routing.ts';
import { campaignStepAvailable } from './campaign.ts';
import { EB_PASS_SQL } from './eb-score.ts';
import { addDays, dayKey, nowMs, type Clock } from './clock.ts';
import { fundMissHeldSql } from './fund-review-hold.ts';
import { xpOnDay } from './xp.ts';

/**
 * Daily slate + streak engine (spec §6.1).
 *
 * Slate composition: at most one drill set per active track (track.locked=0 AND
 * track.slate_drills=1) that the learner has not switched off and that still
 * has drills to give (see "Drill-slot size"), one campaign step ONLY when a
 * campaign step can actually be taken that day (W5b: an actionable,
 * not-yet-done quest in an UNLOCKED act — engines/campaign.ts — or the step was
 * already taken that day; a slot nothing can complete would make the streak
 * impossible again, W1b review), and "clear the review queue" once the learner
 * has review cards (see "Review slot").
 *
 * One finishable day (rv wave C; REVIEW Wave 1b row 3, owner decisions D3/D5, R4-05/R4-22/R5-03):
 * the DEFAULT slate is reviews + the hero's Fundamentals step + one senior rep. Every per-track drill
 * set is OFF unless a slate_setting row turns it on (one setting away), and the campaign step is off
 * unless learner_setting campaign_step = 'on' (migration 022).
 *   fund   — the Fundamentals step on the learner's primary language (learner_setting
 *            primary_language, no row = 'js'): done by the FIRST-EVER unguided verified pass of any
 *            unit of that ladder (a topic gate `fund/<t>/...` or a Fundamentals drill `fund-<t>/...`)
 *            on the day. Shown while the ladder has a unit not passed before the day started; once
 *            the ladder is finished (or not loaded) it gives way to the primary language's drill set.
 *   senior — one senior rep (R5 §7 loop), its suggested kind rotating by weekday: Mon/Thu/Sun a
 *            DESIGN IT set, Tue/Fri a review kata, Wed/Sat a Fundamentals JS 21-33 unit; a kind with
 *            nothing open at day start falls through (design, kata, fund-senior); none open drops the
 *            slot. The suggestion is stored in the slot (`rep`) and kept for the day once the row
 *            exists. The slot is done by ANY senior rep that day, so no day is lost to the rotation:
 *            the first passing self-score of a sysdesign explain-back (EB_PASS_SQL), the first kata
 *            self-score of a patch kata, or the first-ever unguided verified pass of a Fundamentals
 *            JS 21-33 unit; reveal and practice evidence never count. Off when senior_rep = 'off'.
 *
 * Slate settings (ab wave A1, migration 017): the learner's choice of tracks
 * and set size is an append-only ledger (slate_setting). slateShape(db, day)
 * reads, per track, the latest row with effective_day <= day; a track with no
 * row is on the slate (when track.slate_drills = 1) with the unconfigured
 * default size DEFAULT_DRILL_SET_SIZE = 1, so day one asks for one drill per
 * track. The settings service always writes effective_day = tomorrow, so a
 * change never reshapes today's open slate or any closed day, and the size never
 * ramps on its own (no hidden growth when the learner starts passing drills).
 * track.slate_drills stays the capability flag (the track gives drill slots at
 * all) and is never changed by a setting.
 *
 * Review slot: shown only when some non-retest review_item was created before
 * the day STARTED (review_item.created_at is never rewritten), so a learner
 * with no cards is not shown a vacuously ticked "nothing due" slot, and the slot
 * cannot appear mid-day.
 *
 * Drill-slot size (fix/slate): a track's set asks for
 * min(size, R) drills (size from slateShape), where R = drillUnitsRemaining(track, day) is
 * the number of live drill units with no verified pass and no reveal before the
 * day STARTS. R = 0 drops the slot. Without this, a track whose content ran out
 * (~112 C# / ~104 Java drills at 5 a day: about three weeks) left a slot
 * nothing could complete, so no day could be a slate-day again: the streak froze
 * and freeze tokens were never earned again — the same trap the campaign slot
 * guards against above. R counts units first passed TODAY (they were unpassed at
 * day start), so the size never shrinks as the learner works through the set,
 * and passing all R units always completes it (unless the learner reveals one
 * of them today, which makes its pass guided: their choice, not a dead slot).
 *   R is judged from data that does not move under a past day: the append-only
 * attempt ledger (passes, reveals before day start), unit.created_at (< day end,
 * so drills seeded later never reach back) and unit.retired_at (retired after
 * the day ended still counts as live that day; the one lossy case is a unit
 * retired and then un-retired, whose retired_at is cleared). The review slot
 * follows the same as-of rule (dueAsOf: review_item.retired_at after the moment
 * judged = live then), with the same lossy case (a card retired, then restored
 * when its item returns, store/review-cards.ts, reads as live throughout).
 *   Runner availability is deliberately NOT part of the rule. Whether a JDK or
 * the C# runner was installed on a past day is recorded nowhere, so a rule that
 * used it could not be re-derived for a closed day, and it would hand out free
 * slate-days on a machine whose runner is broken. A track whose runner is
 * missing should be taken off the slate explicitly (track.slate_drills = 0 or
 * locked), which is a recorded state, not a probe.
 *
 * Closed-day determinism: closeElapsedDays derives a day from its STORED slot
 * list (slot + size) whenever a row exists, so content growing or shrinking
 * after the day never changes it. Every service path that can tick a slot
 * (submit, reading self-attest, review grade; also the explain-back / kata
 * self-scores and the dashboard) calls composeSlate in the same transaction,
 * so every day the learner touched has a stored row. A day with NO row had no submit, self-attest or review, so none
 * of its drill / campaign / review-only slots can be done whatever list
 * slateStructure re-derives for it: its status is decided by XP alone, which
 * the slot list cannot change. While a day is open its row is refreshed, but a
 * drill set that is already done keeps its size, and a day whose slate is
 * already COMPLETE never gains a new slot (server review F5: a track whose
 * drills were exhausted getting content mid-day, or a campaign step becoming
 * available, waits for tomorrow). Content seeded mid-day never un-does a day.
 *   Review-only slates: a slate with no drill set and no campaign step (every
 * track exhausted, nothing actionable in the campaign) would otherwise complete
 * on an idle day just because the queue happened to be empty. Its review slot
 * therefore needs a review that day after which the queue was empty; with
 * nothing due all day, the day can at best be partial.
 *
 * Slot completion is DERIVED from the ledger, never marked by a caller (W1a
 * audit #6, W1b review): there is no markSlateItem.
 *   drill:<track> — >= `size` distinct kind='drill' units on the track whose
 *                   FIRST verified pass ever (outcome pass + passing submit run)
 *                   is on this day and was not guided: re-passing an old unit,
 *                   quizzes, and post-reveal passes never tick it;
 *   campaign      — the FIRST-EVER verified pass (or the reading self-attest) of
 *                   a unit a campaign quest points at falls on this day and was
 *                   not guided: re-passing an old quest unit never ticks it
 *                   (same anti-gaming rule as the drill slot);
 *   review        — the due queue was empty right after some review this day,
 *                   or is empty at evaluation time (now for today, end of day
 *                   for a closed day; not on a review-only slate, above). Past
 *                   queue states are rebuilt from the append-only review_log,
 *                   so nothing can be pre-marked.
 *
 * Day classification, applied when a day is CLOSED (i.e. once it has passed):
 *   slate   — every slate item done      -> streak +1, +1 toward a freeze token
 *   partial — not a slate-day, >= 20 XP  -> streak kept (not incremented), no token credit
 *   gap     — neither                    -> auto-spend a banked freeze token
 *                                           ('frozen', streak kept), else the streak
 *                                           breaks ('missed', streak = 0)
 * Freeze tokens: every 7 slate-days earn 1 token, at most 2 banked (credit
 * beyond the cap is lost). A gap while the streak is already 0 spends nothing.
 * The 7-slate-day counter is cumulative across partial/frozen days and resets
 * only when the streak breaks.
 */

/** Per-track drill-set size of the `full` preset (the pre-ab default: 5 drills per track). */
export const DRILL_SET_SIZE = 5;
/** Per-track drill-set size with no slate_setting row (or a row with size NULL): day one is small. */
export const DEFAULT_DRILL_SET_SIZE = 1;
export const PARTIAL_DAY_XP = 20;
export const SLATE_DAYS_PER_TOKEN = 7;
export const MAX_TOKENS = 2;

/** The senior rep kinds (rv wave C). */
export const SENIOR_REPS = ['design', 'kata', 'fund-senior'] as const;
export type SeniorRep = (typeof SENIOR_REPS)[number];
/** Fundamentals JS topics that count as a senior rep (R5 §7: fund-js 21-33). */
export const FUND_SENIOR_TOPICS = { track: 'js', from: 21, to: 33 } as const;
/** The primary-language choices (the Fundamentals ladders). */
export const PRIMARY_LANGUAGES = ['js', 'csharp', 'java'] as const;
export type PrimaryLanguage = (typeof PRIMARY_LANGUAGES)[number];
export const DEFAULT_PRIMARY_LANGUAGE: PrimaryLanguage = 'js';

export type SlateItem =
  | { slot: `drill:${string}`; kind: 'drill-set'; track: string; size: number; done: boolean }
  | { slot: 'fund'; kind: 'fund-step'; track: string; done: boolean }
  | { slot: 'senior'; kind: 'senior-rep'; rep: SeniorRep; done: boolean }
  | { slot: 'campaign'; kind: 'campaign-step'; done: boolean }
  | { slot: 'review'; kind: 'review-clear'; done: boolean };

export type DayStatus = 'open' | 'slate' | 'partial' | 'frozen' | 'missed';

export interface SlateRow {
  day: string;
  items: SlateItem[];
  status: DayStatus;
  xp_total: number;
  created_at: number;
  closed_at: number | null;
}

export interface StreakRow {
  current: number;
  longest: number;
  tokens: number;
  slate_days_banked: number;
  last_closed_day: string | null;
}

function readSlate(db: Db, day: string): SlateRow | undefined {
  const row = db.get<Omit<SlateRow, 'items'> & { items: string }>('SELECT * FROM daily_slate WHERE day = ?', day);
  return row ? { ...row, items: JSON.parse(row.items) as SlateItem[] } : undefined;
}

export function isSlateComplete(items: readonly SlateItem[]): boolean {
  return items.length > 0 && items.every((i) => i.done);
}

/** [start, end) epoch ms of a local calendar day (calendar arithmetic, DST-safe). */
export function dayBounds(day: string): [number, number] {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()];
}

/**
 * Drill units on a track that could still give a FIRST-EVER unguided verified
 * pass on `day`, judged as of the day's start (see the header, "Drill-slot size"):
 *   - kind 'drill' on the track, created before the day ENDS (units seeded during
 *     the day count; units seeded on a later day never reach back);
 *   - live during the day: not retired, or retired only after the day ended;
 *   - no verified pass before the day starts (the same "first-ever" test as
 *     newDrillPasses, so a unit passed TODAY still counts and the size does not
 *     shrink while the learner works through the set);
 *   - not revealed before the day starts, itself or up its variation_of chain
 *     (every later attempt on such a unit is guided, which never ticks the slot).
 */
export function drillUnitsRemaining(db: Db, trackId: string, day: string): number {
  const [start, end] = dayBounds(day);
  return (
    db.get<{ n: number }>(
      `WITH RECURSIVE tainted(id) AS (
         SELECT a.unit_id FROM attempt a WHERE a.assistance_source = 'reveal' AND a.created_at < ?
         UNION
         SELECT v.id FROM unit v JOIN tainted t ON v.variation_of_unit_id = t.id
       )
       SELECT COUNT(*) AS n FROM unit u
        WHERE u.track_id = ? AND u.kind = 'drill' AND u.created_at < ?
          AND (u.retired_at IS NULL OR u.retired_at >= ?)
          AND u.id NOT IN (SELECT id FROM tainted)
          AND NOT EXISTS (SELECT 1 FROM attempt a WHERE a.unit_id = u.id AND ${VERIFIED_PASS_SQL} AND a.created_at < ?)`,
      start,
      trackId,
      end,
      end,
      start,
    )?.n ?? 0
  );
}

/** One slate track's chosen shape as of a day (see the header, "Slate settings"). */
export interface SlateTrackShape {
  trackId: string;
  name: string;
  /** on the slate that day (a learner choice; the track must also be unlocked with slate_drills = 1) */
  enabled: boolean;
  /** drills asked for before the R cap (DEFAULT_DRILL_SET_SIZE when unset) */
  size: number;
  /** a slate_setting row decides this track (false = the unconfigured default) */
  configured: boolean;
}

/**
 * The slate shape as of `day`, one entry per slate-capable track (unlocked, slate_drills = 1) in sort
 * order: the latest slate_setting row with effective_day <= day, else OFF (rv wave C) with the default size.
 */
export function slateShape(db: Db, day: string): SlateTrackShape[] {
  return db
    .all<{ id: string; name: string; enabled: boolean | null; size: number | null }>(
      `SELECT t.id, t.name, s.enabled, s.size FROM track t
         LEFT JOIN slate_setting s ON s.id = (
           SELECT s2.id FROM slate_setting s2 WHERE s2.track_id = t.id AND s2.effective_day <= ?
            ORDER BY s2.effective_day DESC, s2.id DESC LIMIT 1)
        WHERE t.locked = 0 AND t.slate_drills = 1
        ORDER BY t.sort_order`,
      day,
    )
    .map((r) => ({
      trackId: r.id,
      name: r.name,
      // rv wave C (D3): an unconfigured track is OFF; the default day is the Fundamentals step + a senior rep
      enabled: r.enabled ?? false, // db/hygiene.ts maps the 0/1 `enabled` column to a boolean
      size: r.size ?? DEFAULT_DRILL_SET_SIZE,
      configured: r.enabled !== null,
    }));
}

/** The learner's day-shape choices as of a day (migration 022, append-only; see the header). */
export interface LearnerShape {
  primaryLanguage: PrimaryLanguage;
  /** a primary_language row is in force (the one-time picker was answered) */
  primaryChosen: boolean;
  campaignStep: boolean;
  seniorRep: boolean;
}

export function learnerShape(db: Db, day: string): LearnerShape {
  const latest = (key: string): string | null =>
    db.get<{ value: string }>(
      'SELECT value FROM learner_setting WHERE key = ? AND effective_day <= ? ORDER BY effective_day DESC, id DESC LIMIT 1',
      key,
      day,
    )?.value ?? null;
  const lang = latest('primary_language');
  return {
    primaryLanguage: (PRIMARY_LANGUAGES as readonly string[]).includes(lang ?? '') ? (lang as PrimaryLanguage) : DEFAULT_PRIMARY_LANGUAGE,
    primaryChosen: lang !== null,
    campaignStep: latest('campaign_step') === 'on',
    seniorRep: latest('senior_rep') !== 'off',
  };
}

/** A Fundamentals ladder unit key -> { track, topic number, gate key }, else null. */
export function fundKeyParts(key: string): { track: string; topicNo: number; gateKey: string } | null {
  const m = /^fund(?:\/|-)(js|csharp|java)\/((\d\d)[^/]*)/.exec(key);
  return m ? { track: m[1]!, topicNo: Number(m[3]), gateKey: `fund/${m[1]}/${m[2]}` } : null;
}

interface LadderUnit {
  id: number;
  key: string;
  parts: { track: string; topicNo: number; gateKey: string };
}

/** Ladder units live during `day` (created before it ends, not retired before it ends), optionally of one track. */
function ladderUnits(db: Db, day: string, track?: string): LadderUnit[] {
  const [, end] = dayBounds(day);
  return db
    .all<{ id: number; key: string }>(
      `SELECT id, key FROM unit WHERE (key LIKE 'fund/%' OR key LIKE 'fund-%') AND created_at < ? AND (retired_at IS NULL OR retired_at >= ?) ORDER BY id`,
      end,
      end,
    )
    .flatMap((u) => {
      const parts = fundKeyParts(u.key);
      return parts && (track === undefined || parts.track === track) ? [{ ...u, parts }] : [];
    });
}

/** Unit ids among `ids` with a verified pass before `t`. */
function passedBefore(db: Db, ids: readonly number[], t: number): Set<number> {
  if (ids.length === 0) return new Set();
  return new Set(
    db
      .all<{ u: number }>(`SELECT DISTINCT a.unit_id AS u FROM attempt a WHERE a.unit_id IN (${ids.join(',')}) AND ${VERIFIED_PASS_SQL} AND a.created_at < ?`, t)
      .map((r) => r.u),
  );
}

/** Ladder units of a track with no verified pass before the day started (live during the day). */
export function fundUnitsRemaining(db: Db, track: string, day: string): number {
  const units = ladderUnits(db, day, track);
  const passed = passedBefore(db, units.map((u) => u.id), dayBounds(day)[0]);
  return units.filter((u) => !passed.has(u.id)).length;
}

/** Distinct units among `ids` whose FIRST-EVER verified pass is in [from, to) and was not guided. */
function newFirstPassesIn(db: Db, ids: readonly number[], from: number, to: number): number {
  if (ids.length === 0) return 0;
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM unit u
        WHERE u.id IN (${ids.join(',')})
          AND EXISTS (SELECT 1 FROM attempt a WHERE a.unit_id = u.id AND ${VERIFIED_PASS_SQL}
                        AND a.mode <> 'guided' AND a.created_at >= ? AND a.created_at < ?)
          AND NOT EXISTS (SELECT 1 FROM attempt a WHERE a.unit_id = u.id AND ${VERIFIED_PASS_SQL} AND a.created_at < ?)`,
      from,
      to,
      from,
    )?.n ?? 0
  );
}

const isFundSenior = (u: LadderUnit): boolean =>
  u.parts.track === FUND_SENIOR_TOPICS.track && u.parts.topicNo >= FUND_SENIOR_TOPICS.from && u.parts.topicNo <= FUND_SENIOR_TOPICS.to;

/** SQL (alias `e` = evidence): self-scored evidence that may count (never a reveal or a practice retake). */
const SELF_SCORED_OK = `e.assistance NOT IN ('reveal', 'practice')`;
/** SQL (aliases `e`, `u`): a passing DESIGN IT self-score or a kata self-score. */
const SENIOR_EVIDENCE_SQL = `((e.kind = 'explain-back' AND ${EB_PASS_SQL} AND u.track_id = 'sysdesign' AND u.kind = 'explain-back')
                               OR (e.kind = 'kata' AND u.kind = 'patch-kata'))`;

/** Some senior rep (any kind) was FIRST completed in [from, to): see the header ("senior"). */
export function seniorRepDone(db: Db, from: number, to: number, day?: string): boolean {
  const firsts = db.all<{ unit: number; first: number }>(
    `SELECT e.unit_id AS unit, MIN(e.created_at) AS first FROM evidence e JOIN unit u ON u.id = e.unit_id
      WHERE ${SENIOR_EVIDENCE_SQL} AND ${SELF_SCORED_OK} AND e.created_at < ?
      GROUP BY e.unit_id`,
    to,
  );
  if (firsts.some((r) => r.first >= from)) return true;
  const units = ladderUnits(db, day ?? dayKeyOf(from)).filter(isFundSenior);
  return newFirstPassesIn(db, units.map((u) => u.id), from, to) > 0;
}

const dayKeyOf = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A senior rep of this kind can still be taken on `day` (judged at day start; archived units never count). */
export function seniorRepAvailable(db: Db, rep: SeniorRep, day: string): boolean {
  const [start, end] = dayBounds(day);
  if (rep === 'fund-senior') {
    // a Fundamentals JS 21-33 unit not passed before day start whose topic is open (its gate's prerequisites passed)
    const all = ladderUnits(db, day, FUND_SENIOR_TOPICS.track);
    const senior = all.filter(isFundSenior);
    const gateId = new Map(all.filter((u) => u.key === u.parts.gateKey).map((u) => [u.key, u.id]));
    const prereq = new Map<number, number[]>();
    for (const r of db.all<{ u: number; p: number }>('SELECT unit_id AS u, prereq_unit_id AS p FROM unit_prerequisite')) prereq.set(r.u, [...(prereq.get(r.u) ?? []), r.p]);
    const passed = passedBefore(db, all.map((u) => u.id), start);
    return senior.some((u) => {
      if (passed.has(u.id)) return false;
      const g = gateId.get(u.parts.gateKey);
      return g === undefined || (prereq.get(g) ?? []).every((p) => passed.has(p));
    });
  }
  const where = rep === 'design' ? `u.track_id = 'sysdesign' AND u.kind = 'explain-back'` : `u.kind = 'patch-kata'`;
  const evidence = rep === 'design' ? `e.kind = 'explain-back' AND ${EB_PASS_SQL}` : `e.kind = 'kata'`;
  return db
    .all<{ key: string }>(
      `SELECT u.key FROM unit u JOIN track t ON t.id = u.track_id
        WHERE ${where} AND t.locked = 0 AND u.created_at < ? AND (u.retired_at IS NULL OR u.retired_at >= ?)
          AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.unit_id = u.id AND ${evidence} AND ${SELF_SCORED_OK} AND e.created_at < ?)`,
      end,
      end,
      start,
    )
    .some((r) => !isArchivedKey(r.key));
}

/** The weekday's preferred senior rep (Mon/Thu/Sun design, Tue/Fri kata, Wed/Sat fund-senior), then the fall-through order. */
export function seniorRepOrder(day: string): SeniorRep[] {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const wd = new Date(y, m - 1, d).getDay(); // 0 = Sunday
  const first: SeniorRep = wd === 2 || wd === 5 ? 'kata' : wd === 3 || wd === 6 ? 'fund-senior' : 'design';
  return [first, ...SENIOR_REPS.filter((r) => r !== first)];
}

/** The learner had a (non-retest) review card before `dayStart` ms: only then is the review slot on the slate. */
export function reviewSlotShown(db: Db, dayStart: number): boolean {
  return db.get(`SELECT 1 AS x FROM review_item WHERE kind <> 'retest' AND created_at < ? LIMIT 1`, dayStart) !== undefined;
}

/** The slot list for `day` (done flags unset), from the slate settings, the drill ledger, campaign state and the cards. */
function slateStructure(db: Db, day: string): SlateItem[] {
  const [start, end] = dayBounds(day);
  const learner = learnerShape(db, day);
  const hasCampaign = learner.campaignStep && (campaignStepAvailable(db) || campaignStepDone(db, start, end));
  const items: SlateItem[] = [];
  const fundLeft = fundUnitsRemaining(db, learner.primaryLanguage, day) > 0;
  if (fundLeft) items.push({ slot: 'fund', kind: 'fund-step', track: learner.primaryLanguage, done: false });
  for (const tr of slateShape(db, day)) {
    // a finished (or absent) primary ladder gives way to that language's drill set (default size), unless the
    // learner switched that set off explicitly
    if (!tr.enabled && !(tr.trackId === learner.primaryLanguage && !fundLeft && !tr.configured)) continue;
    // an exhausted track drops its slot; a nearly-exhausted one asks only for what is left
    const size = Math.min(tr.size, drillUnitsRemaining(db, tr.trackId, day));
    if (size > 0) items.push({ slot: `drill:${tr.trackId}`, kind: 'drill-set', track: tr.trackId, size, done: false });
  }
  if (learner.seniorRep) {
    const rep = seniorRepOrder(day).find((r) => seniorRepAvailable(db, r, day));
    if (rep) items.push({ slot: 'senior', kind: 'senior-rep', rep, done: false });
  }
  if (hasCampaign) items.push({ slot: 'campaign', kind: 'campaign-step', done: false });
  if (reviewSlotShown(db, start)) items.push({ slot: 'review', kind: 'review-clear', done: false });
  return items;
}

/** Distinct drill units on a track whose first-ever verified pass falls in [from, to) and was not guided. */
export function newDrillPasses(db: Db, trackId: string, from: number, to: number): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM unit u
        WHERE u.track_id = ? AND u.kind = 'drill'
          AND EXISTS (SELECT 1 FROM attempt a WHERE a.unit_id = u.id AND ${VERIFIED_PASS_SQL}
                        AND a.mode <> 'guided' AND a.created_at >= ? AND a.created_at < ?)
          AND NOT EXISTS (SELECT 1 FROM attempt a WHERE a.unit_id = u.id AND ${VERIFIED_PASS_SQL} AND a.created_at < ?)`,
      trackId,
      from,
      to,
      from,
    )?.n ?? 0
  );
}

/** A quest unit's first-ever completion (verified pass or reading self-attest) is in [from, to) and was not guided. */
export function campaignStepDone(db: Db, from: number, to: number): boolean {
  return (
    db.get(
      `SELECT 1 AS x FROM (
         SELECT a.unit_id AS unit_id, MIN(a.created_at) AS first_at FROM attempt a JOIN unit u ON u.id = a.unit_id
          WHERE a.unit_id IN (SELECT unit_id FROM quest WHERE unit_id IS NOT NULL)
            AND (${VERIFIED_PASS_SQL} OR ${READING_ATTEST_SQL})
          GROUP BY a.unit_id) f
        WHERE f.first_at >= ? AND f.first_at < ?
          AND EXISTS (SELECT 1 FROM attempt a JOIN unit u ON u.id = a.unit_id
                       WHERE a.unit_id = f.unit_id AND a.created_at = f.first_at AND a.mode <> 'guided'
                         AND (${VERIFIED_PASS_SQL} OR ${READING_ATTEST_SQL}))
        LIMIT 1`,
      from,
      to,
    ) !== undefined
  );
}

/**
 * Review items due as of moment T, rebuilt from review_log (reviews after T are undone).
 * Retirement is judged AS OF T too (server review F4): a card retired after T was live at T,
 * so retiring it later (a re-seed removed its item) never rewrites a past day's review-clear.
 * A held Fundamentals quiz-miss card (engines/fund-review-hold.ts) is judged as of T as well: it
 * counts only once its gate unit had a verified pass at/before T.
 */
export function dueAsOf(db: Db, T: number): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM review_item ri
        WHERE ri.created_at <= ? AND ri.kind <> 'retest' AND (ri.retired_at IS NULL OR ri.retired_at > ?)
          AND NOT ${fundMissHeldSql('ri', '?')}
          AND COALESCE((SELECT rl.prev_due_at FROM review_log rl
                         WHERE rl.review_item_id = ri.id AND rl.reviewed_at > ?
                         ORDER BY rl.reviewed_at, rl.id LIMIT 1), ri.due_at) <= ?`,
      T,
      T,
      T,
      T,
      T,
    )?.n ?? 0
  );
}

/**
 * The due queue was empty right after some review in [from, at], or (unless
 * `requireReview`) is simply empty at `at`.
 */
function reviewCleared(db: Db, from: number, at: number, requireReview: boolean): boolean {
  if (!requireReview && dueAsOf(db, at) === 0) return true;
  const moments = db.all<{ t: number }>(
    'SELECT DISTINCT reviewed_at AS t FROM review_log WHERE reviewed_at >= ? AND reviewed_at <= ? ORDER BY reviewed_at',
    from,
    at,
  );
  return moments.some((m) => dueAsOf(db, m.t) === 0);
}

/**
 * Derive every slot's `done` for `day` from the ledger as of `atMs`
 * (capped at the end of that day).
 */
export function deriveSlate(db: Db, day: string, items: readonly SlateItem[], atMs: number): SlateItem[] {
  const [start, end] = dayBounds(day);
  const cutoff = Math.min(end, atMs + 1); // attempts strictly before cutoff count
  const at = cutoff - 1;
  // a slate with no drill set and no campaign step must not complete itself on an idle
  // day: its review slot then needs a review that day that left the queue empty
  const reviewOnly = !items.some((i) => i.kind !== 'review-clear');
  return items.map((item): SlateItem => {
    if (item.kind === 'review-clear') return { ...item, done: reviewCleared(db, start, at, reviewOnly) };
    if (item.kind === 'campaign-step') return { ...item, done: campaignStepDone(db, start, cutoff) };
    if (item.kind === 'fund-step') return { ...item, done: newFirstPassesIn(db, ladderUnits(db, day, item.track).map((u) => u.id), start, cutoff) > 0 };
    if (item.kind === 'senior-rep') return { ...item, done: seniorRepDone(db, start, cutoff, day) };
    return { ...item, done: newDrillPasses(db, item.track, start, cutoff) >= item.size };
  });
}

/**
 * Compose today's slate. The slot list is refreshed from the current tracks
 * and quests while the day is open, and every `done` flag is derived from the
 * ledger at `now`. Idempotent per day; done flags are persisted only as a
 * snapshot when the day is closed. A drill set that is already done keeps
 * its size on refresh, and a complete slate gains no new slot, so content
 * seeded mid-day never un-does a set or the day (not-done slots may still grow).
 */
export function composeSlate(db: Db, now: Clock): SlateRow {
  const t = nowMs(now);
  const day = dayKey(t);
  const structure = slateStructure(db, day);
  const existing = readSlate(db, day);
  if (!existing) {
    db.run(
      `INSERT INTO daily_slate (day, items, status, xp_total, created_at, closed_at) VALUES (?, ?, 'open', 0, ?, NULL)`,
      day,
      JSON.stringify(structure),
      t,
    );
  } else if (existing.status === 'open') {
    const before = deriveSlate(db, day, existing.items, t);
    // F5: a day that is already complete never gains a slot (it would flip back to incomplete)
    const complete = isSlateComplete(before);
    const had = new Set(existing.items.map((i) => i.slot));
    const refreshed = structure.filter((item) => !complete || had.has(item.slot)).map((item): SlateItem => {
      // the day's senior rep suggestion is fixed once the row exists
      if (item.kind === 'senior-rep') {
        const prev = existing.items.find((b) => b.kind === 'senior-rep');
        return prev?.kind === 'senior-rep' ? { ...item, rep: prev.rep } : item;
      }
      if (item.kind !== 'drill-set') return item;
      const prev = before.find((b) => b.slot === item.slot);
      return prev?.kind === 'drill-set' && prev.done && prev.size < item.size ? { ...item, size: prev.size } : item;
    });
    db.run('UPDATE daily_slate SET items = ? WHERE day = ?', JSON.stringify(refreshed), day);
  }
  const row = readSlate(db, day)!;
  return { ...row, items: row.status === 'open' ? deriveSlate(db, day, row.items, t) : row.items };
}

function readStreak(db: Db): StreakRow {
  return db.get<StreakRow>(
    'SELECT current, longest, tokens, slate_days_banked, last_closed_day FROM streak WHERE id = 1',
  )!;
}

function firstActivityDay(db: Db): string | null {
  const row = db.get<{ d: string | null }>(
    'SELECT MIN(d) AS d FROM (SELECT MIN(day) AS d FROM daily_slate UNION ALL SELECT MIN(day) FROM xp_event)',
  );
  return row?.d ?? null;
}

export interface ClosedDay {
  day: string;
  status: Exclude<DayStatus, 'open'>;
  xp: number;
}

/** Close every fully-elapsed day (< today) not yet closed. Returns what was closed. */
export function closeElapsedDays(db: Db, now: Clock): ClosedDay[] {
  const t = nowMs(now);
  const today = dayKey(t);
  return db.tx(() => {
    const s = readStreak(db);
    let day = s.last_closed_day ? addDays(s.last_closed_day, 1) : firstActivityDay(db);
    const closed: ClosedDay[] = [];
    if (day === null) return closed;
    let { current, longest, tokens, slate_days_banked: banked } = s;
    let lastClosed = s.last_closed_day;

    while (day < today) {
      const slate = readSlate(db, day);
      const xp = xpOnDay(db, day);
      const [, dayEnd] = dayBounds(day);
      // derived at end of day from the ledger; the stored row only supplies the slot list
      const items = deriveSlate(db, day, slate ? slate.items : slateStructure(db, day), dayEnd - 1);
      let status: ClosedDay['status'];
      if (isSlateComplete(items)) {
        status = 'slate';
        current += 1;
        banked += 1;
        if (banked >= SLATE_DAYS_PER_TOKEN) {
          banked = 0;
          tokens = Math.min(MAX_TOKENS, tokens + 1);
        }
      } else if (xp >= PARTIAL_DAY_XP) {
        status = 'partial';
      } else if (current > 0 && tokens > 0) {
        status = 'frozen';
        tokens -= 1;
      } else {
        status = 'missed';
        current = 0;
        banked = 0;
      }
      longest = Math.max(longest, current);
      if (slate) {
        db.run(
          'UPDATE daily_slate SET items = ?, status = ?, xp_total = ?, closed_at = ? WHERE day = ?',
          JSON.stringify(items),
          status,
          xp,
          t,
          day,
        );
      } else {
        db.run(
          `INSERT INTO daily_slate (day, items, status, xp_total, created_at, closed_at) VALUES (?, ?, ?, ?, ?, ?)`,
          day,
          JSON.stringify(items),
          status,
          xp,
          t,
          t,
        );
      }
      closed.push({ day, status, xp });
      lastClosed = day;
      day = addDays(day, 1);
    }

    db.run(
      `UPDATE streak SET current = ?, longest = ?, tokens = ?, slate_days_banked = ?, last_closed_day = ?, updated_at = ? WHERE id = 1`,
      current,
      longest,
      tokens,
      banked,
      lastClosed,
      t,
    );
    return closed;
  });
}

export interface StreakStatus {
  /** streak through yesterday (closed days) */
  current: number;
  /** current + 1 if today's slate is already complete */
  display: number;
  longest: number;
  tokens: number;
  slateDaysBanked: number;
  todayComplete: boolean;
  today: string;
}

export function streakStatus(db: Db, now: Clock): StreakStatus {
  closeElapsedDays(db, now);
  const s = readStreak(db);
  const t = nowMs(now);
  const today = dayKey(t);
  const slate = readSlate(db, today);
  const todayComplete = isSlateComplete(deriveSlate(db, today, slate ? slate.items : slateStructure(db, today), t));
  return {
    current: s.current,
    display: s.current + (todayComplete ? 1 : 0),
    longest: Math.max(s.longest, s.current + (todayComplete ? 1 : 0)),
    tokens: s.tokens,
    slateDaysBanked: s.slate_days_banked,
    todayComplete,
    today,
  };
}

/** The stored slate row for a day (for closed days: the derived end-of-day snapshot). */
export function getSlate(db: Db, day: string): SlateRow | undefined {
  return readSlate(db, day);
}
