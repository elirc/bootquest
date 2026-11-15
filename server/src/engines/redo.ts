import { kpWeight } from '@bootquest/shared/eb-weight';
import type { Db } from '../db/database.ts';
import { keyIdeas, type KeyIdeasStore } from '../store/keyideas.ts';
import { isArchivedKey } from '../store/routing.ts';
import { getUnitByKey, primaryCheck, type UnitRecord } from '../store/queries.ts';
import type { SeedItemStore } from '../store/seed-items.ts';
import { VERIFIED_PASS_SQL } from './attempts.ts';
import { DAY_MS, dayKey, nowMs, type Clock } from './clock.ts';
import { addReviewItem, deserializeCard, regradeMissedCard, reviveRetiredCard, serializeCard } from './fsrs.ts';
import { cardKeyOf, EBMISS_PREFIX, KEYIDEA_PREFIX, liveSources, NOTE_PREFIX, parseIdeaCardKey, RECHECK_PREFIX, REDO_PREFIX, type ResolvedIdea } from './keyideas.ts';
import { dayBounds } from './streak.ts';

/**
 * rv2 S1 (PLAN §2.1 items 5-6; F2): spaced production.
 *
 * REDO cards `redo:<section>/<id>` (review_item kind 'concept'). Three days after a DRILL source of an idea is
 * passed (the idea met, its card enrolled) and the idea lists sibling drills, a redo card is enrolled. It opens one
 * sibling the learner has not passed (else the least recently passed) in the Player in PRACTICE mode: the run
 * goes through the free grader (POST /units/:id/run semantics: no attempt, no run row, no XP, no evidence, no
 * practice_log) and only the card is graded, Good on a pass and Again on a fail (api/keyideas-service.ts). So the
 * only things a redo ever writes are the card's FSRS state, its review_log row and the review XP (B's rule: one
 * paid grade per card per day).
 *   At most ONE redo card is served per local day. A redo card is PARKED while it waits: its review_item.due_at
 * is its FSRS due time + REDO_PARK_MS (so no due count, queue, forecast or review-clear slot sees it), its FSRS
 * state keeps the true due time. releaseRedo() un-parks the one with the earliest true due time (due_at = now,
 * never earlier, so every past moment reads exactly as before) when no redo card is out and none was graded
 * today; a graded redo card is parked again at its new FSRS due time.
 *
 * MISSED-KEY-POINT cards `ebmiss:<unit key>#q<i>k<j>` (kind 'concept'). On the answer-of-record self-score of an
 * explain-back / DESIGN IT / G2 unit, each missed [w2]/[w3] key point enrols one card, at most
 * MAX_EBMISS_PER_ATTEMPT per attempt, [w3] first (then question / key-point order); due the next day. A card
 * that already exists is re-graded Again (fsrs.ts regradeMissedCard) and revived if it was retired. Front: the
 * question + the key point's headline from content/design/headlines.json (or "one key point you missed"); back:
 * the key point. Retired at startup when the unit's set no longer has that key point (store/review-cards.ts).
 */

export const REDO_DELAY_DAYS = 3;
export const REDO_PARK_MS = 100 * 365 * DAY_MS;
export const MAX_EBMISS_PER_ATTEMPT = 3;
export const GENERIC_HEADLINE = 'one key point you missed';

/** Every concept-card prefix store/review-cards.ts reconciles (note: cards are the learner's own; never retired). */
export const CONCEPT_PREFIXES: readonly string[] = [KEYIDEA_PREFIX, REDO_PREFIX, EBMISS_PREFIX, RECHECK_PREFIX];

const prefixSql = (p: string, col = 'card_key'): string => `substr(${col}, 1, ${p.length}) = '${p}'`;

// ---------------------------------------------------------------- redo

/** The redo enrolment for a met idea (syncKeyIdeaCards' callback): the new card key, or null. */
export function enrolRedo(db: Db, i: ResolvedIdea, passed: ReadonlyMap<number, number>, now: Clock): string | null {
  if (i.siblings.length === 0) return null;
  const drills = liveSources(i).filter((s) => s.kind === 'drill' && passed.has(s.unitId!));
  if (drills.length === 0) return null;
  const key = cardKeyOf(REDO_PREFIX, i.section, i.idea.id);
  if (db.get('SELECT 1 AS x FROM review_item WHERE card_key = ?', key)) return null;
  const last = drills.reduce((a, b) => (passed.get(b.unitId!)! > passed.get(a.unitId!)! ? b : a));
  const trueDue = Math.max(nowMs(now), passed.get(last.unitId!)! + REDO_DELAY_DAYS * DAY_MS);
  const row = addReviewItem(db, { cardKey: key, kind: 'concept', unitId: last.unitId!, dueAt: trueDue }, now);
  db.run('UPDATE review_item SET due_at = ? WHERE id = ?', trueDue + REDO_PARK_MS, row.id);
  return key;
}

/** True when a redo card is parked (its due_at is the parking offset away). */
export const isParked = (dueAt: number, t: number): boolean => dueAt - t >= REDO_PARK_MS / 2;

/**
 * rv3 MF-3: a redo card can be run only while its idea (still in the side files) lists at least one LIVE sibling: a
 * non-archived key of a unit this server has and has not retired. A card with none could neither be run nor graded.
 */
export function redoSiblingLive(db: Db, cardKey: string, store: KeyIdeasStore = keyIdeas()): boolean {
  const k = parseIdeaCardKey(cardKey, REDO_PREFIX);
  const idea = k ? store.sections.get(k.section)?.ideas.find((i) => i.id === k.id) : undefined;
  if (!idea) return false;
  return idea.siblings.some((key) => !isArchivedKey(key) && db.get('SELECT 1 AS x FROM unit WHERE key = ? AND retired_at IS NULL', key) !== undefined);
}

/**
 * Un-park at most one redo card: only when no live redo card is out (un-parked) and no redo card was graded on
 * today's local day. The candidate is the parked live redo card with the earliest true (FSRS) due time that is
 * <= now. Returns its card key, or null.
 *   rv3 MF-3: a redo card whose idea has no live sibling is skipped: it never blocks the others, is never released,
 * and one that is out is parked again (the startup reconcile retires it; it is restored when a sibling returns).
 */
export function releaseRedo(db: Db, now: Clock, store: KeyIdeasStore = keyIdeas()): string | null {
  const t = nowMs(now);
  const [start, end] = dayBounds(dayKey(t));
  return db.tx(() => {
    const rows = db.all<{ id: number; key: string; due: number; state: string }>(
      `SELECT id, card_key AS key, due_at AS due, fsrs_state AS state FROM review_item WHERE ${prefixSql(REDO_PREFIX)} AND retired_at IS NULL ORDER BY id`,
    );
    const live: typeof rows = [];
    for (const r of rows) {
      if (redoSiblingLive(db, r.key, store)) live.push(r);
      else if (!isParked(r.due, t)) parkRedo(db, r.id);
    }
    if (live.some((r) => !isParked(r.due, t))) return null;
    const gradedToday = db.get(
      `SELECT 1 AS x FROM review_log rl JOIN review_item ri ON ri.id = rl.review_item_id
        WHERE ${prefixSql(REDO_PREFIX, 'ri.card_key')} AND rl.reviewed_at >= ? AND rl.reviewed_at < ? LIMIT 1`,
      start,
      end,
    );
    if (gradedToday) return null;
    const ready = live
      .map((r) => ({ ...r, card: deserializeCard(r.state) }))
      .filter((r) => r.card.due.getTime() <= t)
      .sort((a, b) => a.card.due.getTime() - b.card.due.getTime() || a.id - b.id)[0];
    if (!ready) return null;
    ready.card.due = new Date(t);
    db.run('UPDATE review_item SET due_at = ?, fsrs_state = ?, updated_at = ? WHERE id = ?', t, serializeCard(ready.card), t, ready.id);
    return ready.key;
  });
}

/** Park a redo card again after its grade (its FSRS due time stays in fsrs_state). */
export function parkRedo(db: Db, itemId: number): void {
  const r = db.get<{ state: string }>('SELECT fsrs_state AS state FROM review_item WHERE id = ?', itemId);
  if (!r) return;
  db.run('UPDATE review_item SET due_at = ? WHERE id = ?', deserializeCard(r.state).due.getTime() + REDO_PARK_MS, itemId);
}

/** The sibling a redo card opens: the first one not passed yet (authored order), else the least recently passed. */
export function chooseSibling(db: Db, i: ResolvedIdea): { unitId: number; key: string; title: string } | null {
  if (i.siblings.length === 0) return null;
  const last = (unitId: number): number | null =>
    db.get<{ t: number | null }>(`SELECT MAX(a.created_at) AS t FROM attempt a WHERE a.unit_id = ? AND ${VERIFIED_PASS_SQL}`, unitId)?.t ?? null;
  const withLast = i.siblings.map((s) => ({ s, t: last(s.unitId!) }));
  const pick = withLast.find((x) => x.t === null) ?? withLast.sort((a, b) => a.t! - b.t!)[0]!;
  return { unitId: pick.s.unitId!, key: pick.s.key, title: pick.s.title ?? pick.s.key };
}

// ---------------------------------------------------------------- ebmiss

export interface EbmissTarget {
  unit: UnitRecord;
  setKey: string;
  qi: number;
  ki: number;
  prompt: string;
  kpText: string;
}

const EBMISS_RE = /^ebmiss:(.+)#q(\d+)k(\d+)$/;

/** The unit, question and key point an ebmiss card is about, or null when any of them is gone. */
export function ebmissTarget(db: Db, seedItems: SeedItemStore, cardKey: string): EbmissTarget | null {
  const m = EBMISS_RE.exec(cardKey);
  if (!m) return null;
  const unit = getUnitByKey(db, m[1]!);
  if (!unit) return null;
  const check = primaryCheck(db, unit.id);
  if (!check || check.spec.type !== 'explain-back') return null;
  const item = seedItems.explainBack(check.spec.questionSetKey);
  const qi = Number(m[2]);
  const ki = Number(m[3]);
  const q = item?.questions[qi - 1];
  const kp = q?.keyPoints[ki - 1];
  if (!q || !kp) return null;
  return { unit, setKey: check.spec.questionSetKey, qi, ki, prompt: q.prompt, kpText: kp.text };
}

/** The headline of an ebmiss card's key point (headlines.json by set key, then by unit key), or the generic one. */
export function ebmissHeadline(t: EbmissTarget, store: KeyIdeasStore = keyIdeas()): string {
  const id = `q${t.qi}k${t.ki}`;
  return store.headlines.get(`${t.setKey}#${id}`) ?? store.headlines.get(`${t.unit.key}#${id}`) ?? GENERIC_HEADLINE;
}

/**
 * Enrol the missed [w2]/[w3] key points of one self-scored answer (call inside the self-score transaction).
 * Returns the card keys enrolled or re-graded (<= MAX_EBMISS_PER_ATTEMPT).
 */
export function enrolEbMisses(
  db: Db,
  unit: { id: number; key: string },
  questions: readonly { keyPoints: readonly { id: string; text: string }[] }[],
  perKeyPoint: Readonly<Record<string, 'covered' | 'missed'>>,
  now: Clock,
): string[] {
  const missed = questions
    .flatMap((q, qi) => q.keyPoints.map((kp, ki) => ({ id: kp.id, w: kpWeight(kp.text), qi, ki })))
    .filter((x) => perKeyPoint[x.id] === 'missed' && (x.w === 2 || x.w === 3))
    .sort((a, b) => b.w! - a.w! || a.qi - b.qi || a.ki - b.ki)
    .slice(0, MAX_EBMISS_PER_ATTEMPT);
  const due = nowMs(now) + DAY_MS;
  const out: string[] = [];
  for (const x of missed) {
    const key = `${EBMISS_PREFIX}${unit.key}#q${x.qi + 1}k${x.ki + 1}`;
    if (db.get('SELECT 1 AS x FROM review_item WHERE card_key = ?', key)) {
      reviveRetiredCard(db, key, due, now);
      regradeMissedCard(db, key, due, now);
    } else {
      addReviewItem(db, { cardKey: key, kind: 'concept', unitId: unit.id, dueAt: due }, now);
    }
    out.push(key);
  }
  return out;
}

// ---------------------------------------------------------------- liveness (store/review-cards.ts)

/** True when a recheck card's re-check is already done (a keyidea_checkpoint row of its kind). */
export function recheckDone(db: Db, section: string, days: string): boolean {
  const exists = db.get(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'keyidea_checkpoint'`);
  if (!exists) return false;
  return db.get('SELECT 1 AS x FROM keyidea_checkpoint WHERE section = ? AND kind = ?', section, `recheck-${days}`) !== undefined;
}

/** The one liveness rule of a concept card (retire when false, restore when true). note: cards are always live; redo: cards need a live sibling. */
export function conceptCardLive(db: Db, seedItems: SeedItemStore, cardKey: string, store: KeyIdeasStore = keyIdeas()): boolean {
  if (cardKey.startsWith(NOTE_PREFIX)) return true;
  if (cardKey.startsWith(EBMISS_PREFIX)) return ebmissTarget(db, seedItems, cardKey) !== null;
  const ki = parseIdeaCardKey(cardKey, KEYIDEA_PREFIX);
  if (ki) return store.sections.get(ki.section)?.ideas.some((i) => i.id === ki.id) ?? false;
  // rv3 MF-3: a redo card also needs a live sibling to run
  if (parseIdeaCardKey(cardKey, REDO_PREFIX)) return redoSiblingLive(db, cardKey, store);
  const r = parseIdeaCardKey(cardKey, RECHECK_PREFIX);
  if (r) return store.sections.has(r.section) && !recheckDone(db, r.section, r.id);
  return true;
}
