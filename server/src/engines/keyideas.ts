import { State } from 'ts-fsrs';
import type { Db } from '../db/database.ts';
import { keyIdeas, warnOnce, DEFAULT_RECAP_AFTER, type KeyIdea, type KeyIdeasFile, type KeyIdeasStore } from '../store/keyideas.ts';
import { isArchivedKey, routing, type Routing } from '../store/routing.ts';
import { READING_ATTEST_SQL, VERIFIED_PASS_SQL } from './attempts.ts';
import { DAY_MS, dayKey, nowMs, type Clock } from './clock.ts';
import { EB_PASS_SQL } from './eb-score.ts';
import { addReviewItem, deserializeCard } from './fsrs.ts';
import { dayBounds } from './streak.ts';

/**
 * rv2 S1 (PLAN §2.1 items 1, 4; F1): key-concept cards.
 *
 * An idea is MET once every live (non-archived, known) unit in its `sources` is passed. "Passed" is a unit's
 * first graded pass with any assistance (passTimes below): a verified pass or a reading self-attest, a passing
 * explain-back self-score (EB_PASS_SQL, answer of record only), or a kata self-score that caught a defect.
 * ALL sources, not any: the xleak rule lets an idea's answer restate the keyed answer of an item in any of its
 * sources, so showing the answer after only one of them would open another source's gate key (PLAN §5.3).
 *
 * When an idea is met, `keyidea:<section>/<id>` (review_item kind 'concept', reused: never written before rv2)
 * is enrolled, due one day after the enrolment, at most NEW_KEYIDEA_CARDS_PER_DAY new key-idea cards becoming
 * due on one local day (the next ones land on the day after, and so on). The card text is resolved from the
 * side file at read time (api/keyideas-service.ts); a card whose idea left the side file is retired at startup
 * (store/review-cards.ts) and restored if it returns. Cards are self-rated in the ordinary review queue (B's
 * review XP rule: one paid grade per card per day) and are NEVER evidence: no competency (fsrs.ts writes review
 * evidence only for a competency-linked card), no ladder leg, no practice_log row, no unlock.
 */

export const KEYIDEA_PREFIX = 'keyidea:';
export const REDO_PREFIX = 'redo:';
export const EBMISS_PREFIX = 'ebmiss:';
export const RECHECK_PREFIX = 'recheck:';
export const NOTE_PREFIX = 'note:';

export const NEW_KEYIDEA_CARDS_PER_DAY = 4;

export interface SourceRef {
  key: string;
  unitId: number | null;
  title: string | null;
  kind: string | null;
}

export interface ResolvedIdea {
  section: string;
  sectionTitle: string;
  track: string;
  idea: KeyIdea;
  /** every source key; unitId null = unknown on this server (warned once); archived ones are dropped */
  sources: SourceRef[];
  /** live sibling drills (unknown / archived dropped) */
  siblings: SourceRef[];
}

export interface ResolvedSection {
  file: KeyIdeasFile;
  /** live, non-archived scope unit ids (prefix keys expanded) */
  scopeIds: number[];
  ideas: ResolvedIdea[];
}

interface UnitRow {
  id: number;
  key: string;
  kind: string;
  title: string;
}

export const cardKeyOf = (prefix: string, section: string, ideaId: string): string => `${prefix}${section}/${ideaId}`;

/** "<prefix><section>/<id>" -> {section, id}, or null. */
export function parseIdeaCardKey(cardKey: string, prefix: string): { section: string; id: string } | null {
  if (!cardKey.startsWith(prefix)) return null;
  const rest = cardKey.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { section: rest.slice(0, slash), id: rest.slice(slash + 1) };
}

/**
 * rv3 MF-6: the resolution is memoised per Db until the side-file store, the routing (archive) or the unit table
 * changes. The unit table's signature is one aggregate row (count, max id, retired count / sum, title lengths): a
 * new, retired, restored or renamed unit changes it. Before this, /reviews/queue resolved every section (all units,
 * every prefix) once per concept card.
 */
const UNIT_SIGNATURE_SQL = 'SELECT COUNT(*) AS n, MAX(id) AS m, COUNT(retired_at) AS rc, TOTAL(retired_at) AS rt, TOTAL(length(title)) AS tl, TOTAL(length(kind)) AS kl FROM unit';
const resolved = new WeakMap<Db, { store: KeyIdeasStore; routing: Routing; sig: string; sections: ResolvedSection[] }>();

/** Resolve every section's keys against the live units (unknown keys warned once, archived keys skipped). Memoised (above). */
export function resolveSections(db: Db, store: KeyIdeasStore = keyIdeas()): ResolvedSection[] {
  if (store.sections.size === 0) return [];
  const r = routing();
  const sig = JSON.stringify(db.get(UNIT_SIGNATURE_SQL));
  const hit = resolved.get(db);
  if (hit && hit.store === store && hit.routing === r && hit.sig === sig) return hit.sections;
  const sections = resolveSectionsUncached(db, store);
  resolved.set(db, { store, routing: r, sig, sections });
  return sections;
}

function resolveSectionsUncached(db: Db, store: KeyIdeasStore): ResolvedSection[] {
  const units = db.all<UnitRow>('SELECT id, key, kind, title FROM unit WHERE retired_at IS NULL ORDER BY id');
  const byKey = new Map(units.map((u) => [u.key, u]));
  const warn = (section: string, field: string, key: string): void => {
    if (units.length > 0) warnOnce(`${section}:${field}:${key}`, `${section}: ${field} key ${key} matches no live unit (skipped)`);
  };
  const ref = (key: string): SourceRef => {
    const u = byKey.get(key);
    return { key, unitId: u?.id ?? null, title: u?.title ?? null, kind: u?.kind ?? null };
  };
  const out: ResolvedSection[] = [];
  for (const file of store.sections.values()) {
    const scope = new Set<number>();
    for (const k of file.scope) {
      const hits = k.endsWith('/') ? units.filter((u) => u.key.startsWith(k)) : byKey.has(k) ? [byKey.get(k)!] : [];
      if (hits.length === 0) warn(file.section, 'scope', k);
      for (const u of hits) if (!isArchivedKey(u.key)) scope.add(u.id);
    }
    const ideas = file.ideas.map((idea): ResolvedIdea => {
      const sources = idea.sources.filter((k) => !isArchivedKey(k)).map(ref);
      for (const s of sources) if (s.unitId === null) warn(file.section, 'source', s.key);
      const siblings = idea.siblings.filter((k) => !isArchivedKey(k)).map(ref);
      for (const s of siblings) if (s.unitId === null) warn(file.section, 'sibling', s.key);
      return { section: file.section, sectionTitle: file.title, track: file.track, idea, sources, siblings: siblings.filter((s) => s.unitId !== null) };
    });
    out.push({ file, scopeIds: [...scope], ideas });
  }
  return out;
}

/**
 * The first pass time of every passed unit (any assistance): a verified pass or reading self-attest; a passing
 * explain-back self-score on the answer of record (practice retakes never count); a kata self-score that caught
 * at least one defect.
 */
export function passTimes(db: Db): Map<number, number> {
  const rows = db.all<{ u: number; t: number }>(
    `SELECT u, MIN(t) AS t FROM (
       SELECT a.unit_id AS u, a.created_at AS t FROM attempt a JOIN unit u ON u.id = a.unit_id WHERE ${VERIFIED_PASS_SQL} OR ${READING_ATTEST_SQL}
       UNION ALL
       SELECT a.unit_id AS u, e.created_at AS t FROM evidence e JOIN attempt a ON a.id = e.attempt_id
        WHERE e.kind = 'explain-back' AND ${EB_PASS_SQL} AND json_extract(a.answer, '$.explainBack.practice') IS NULL
       UNION ALL
       SELECT a.unit_id AS u, e.created_at AS t FROM evidence e JOIN attempt a ON a.id = e.attempt_id
        WHERE e.kind = 'kata' AND e.score > 0
     ) GROUP BY u`,
  );
  return new Map(rows.map((r) => [r.u, r.t]));
}

/** Live (known) sources of an idea. */
export const liveSources = (i: ResolvedIdea): SourceRef[] => i.sources.filter((s) => s.unitId !== null);

/** When the idea was met (its last live source's first pass), or null (not met; an idea with no live source never is). */
export function metAt(i: ResolvedIdea, passed: ReadonlyMap<number, number>): number | null {
  const live = liveSources(i);
  if (live.length === 0) return null;
  let t = 0;
  for (const s of live) {
    const p = passed.get(s.unitId!);
    if (p === undefined) return null;
    t = Math.max(t, p);
  }
  return t;
}

function cardExists(db: Db, cardKey: string): boolean {
  return db.get('SELECT 1 AS x FROM review_item WHERE card_key = ?', cardKey) !== undefined;
}

/**
 * The first due time of a NEW key-idea card enrolled at `t`: one day later, moved on by whole days while that
 * local day already has NEW_KEYIDEA_CARDS_PER_DAY never-reviewed live key-idea cards due on it.
 */
export function cappedKeyIdeaDue(db: Db, t: number): number {
  let due = t + DAY_MS;
  for (let i = 0; i < 366; i++) {
    const [s, e] = dayBounds(dayKey(due));
    const n = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM review_item ri
        WHERE substr(ri.card_key, 1, ${KEYIDEA_PREFIX.length}) = '${KEYIDEA_PREFIX}' AND ri.retired_at IS NULL
          AND ri.due_at >= ? AND ri.due_at < ?
          AND NOT EXISTS (SELECT 1 FROM review_log rl WHERE rl.review_item_id = ri.id)`,
      s,
      e,
    )!.n;
    if (n < NEW_KEYIDEA_CARDS_PER_DAY) return due;
    due += DAY_MS;
  }
  return due;
}

export interface SyncResult {
  enrolled: string[];
  redo: string[];
}

/**
 * Enrol the cards of every met idea that has none yet (idempotent; one transaction). Called after any pass
 * (api/app.ts: submit, self-attest, explain-back / kata self-score) and on the key-idea / review reads, so an
 * idea met before its side file existed is enrolled on the next read. A card that exists (live or retired) is
 * never touched here: retire / restore is store/review-cards.ts, re-enrolment is the recap's.
 */
export function syncKeyIdeaCards(db: Db, now: Clock, store: KeyIdeasStore = keyIdeas(), redoEnrol?: (i: ResolvedIdea, passed: ReadonlyMap<number, number>) => string | null): SyncResult {
  const result: SyncResult = { enrolled: [], redo: [] };
  if (store.sections.size === 0) return result;
  return db.tx(() => {
    const sections = resolveSections(db, store);
    const passed = passTimes(db);
    const t = nowMs(now);
    for (const s of sections) {
      for (const i of s.ideas) {
        const met = metAt(i, passed);
        if (met === null) continue;
        const key = cardKeyOf(KEYIDEA_PREFIX, i.section, i.idea.id);
        if (!cardExists(db, key)) {
          // the card's unit: the source passed last (the one that completed the idea)
          const last = liveSources(i).reduce((a, b) => ((passed.get(b.unitId!) ?? 0) > (passed.get(a.unitId!) ?? 0) ? b : a));
          addReviewItem(db, { cardKey: key, kind: 'concept', unitId: last.unitId!, dueAt: cappedKeyIdeaDue(db, t) }, now);
          result.enrolled.push(key);
        }
        const r = redoEnrol?.(i, passed);
        if (r) result.redo.push(r);
      }
    }
    return result;
  });
}

// ---------------------------------------------------------------- status (tile, fold)

export type IdeaStatus = 'owned' | 'shaky' | 'not-met';

/**
 * not-met: a live source is not passed yet. owned: the idea's card is in FSRS Review state and its latest grade
 * was Good or Easy. shaky: everything else that is met (new, learning, relearning, last graded Again/Hard, or
 * retired).
 */
export function ideaStatuses(db: Db, sections: readonly ResolvedSection[], passed: ReadonlyMap<number, number>): Map<string, IdeaStatus> {
  const out = new Map<string, IdeaStatus>();
  const cards = new Map(
    db
      .all<{ key: string; state: string; retired: number | null; last: string | null }>(
        `SELECT ri.card_key AS key, ri.fsrs_state AS state, ri.retired_at AS retired,
                (SELECT rl.rating FROM review_log rl WHERE rl.review_item_id = ri.id ORDER BY rl.reviewed_at DESC, rl.id DESC LIMIT 1) AS last
           FROM review_item ri WHERE substr(ri.card_key, 1, ${KEYIDEA_PREFIX.length}) = '${KEYIDEA_PREFIX}'`,
      )
      .map((r) => [r.key, r]),
  );
  for (const s of sections) {
    for (const i of s.ideas) {
      const key = cardKeyOf(KEYIDEA_PREFIX, i.section, i.idea.id);
      if (metAt(i, passed) === null) {
        out.set(key, 'not-met');
        continue;
      }
      const c = cards.get(key);
      const owned = c !== undefined && c.retired === null && deserializeCard(c.state).state === State.Review && (c.last === 'good' || c.last === 'easy');
      out.set(key, owned ? 'owned' : 'shaky');
    }
  }
  return out;
}

// ---------------------------------------------------------------- recap gate

export interface RecapProgress {
  passed: number;
  total: number;
  /** passed scope units needed to open the recap */
  needed: number;
  open: boolean;
}

/**
 * rv3 MF-1 (ruling 8): a recap also needs at least RECAP_MIN_MET_IDEAS met ideas, or every live idea of the section
 * when it has fewer (an idea with no live source can never be met, so it does not count). Without this a recap
 * opened on one met idea, paid its XP and closed the section for good.
 */
export const RECAP_MIN_MET_IDEAS = 3;

/** Met ideas a section's recap needs: min(RECAP_MIN_MET_IDEAS, live ideas), at least 1. */
export function recapIdeasNeeded(s: ResolvedSection): number {
  const live = s.ideas.filter((i) => liveSources(i).length > 0).length;
  return Math.max(1, Math.min(RECAP_MIN_MET_IDEAS, live));
}

/** recapAfter <= 1: that fraction of the live scope units (ceil); > 1: that many passed scope units (capped at the total). */
export function recapProgress(s: ResolvedSection, passed: ReadonlyMap<number, number>): RecapProgress {
  const total = s.scopeIds.length;
  const n = s.scopeIds.filter((id) => passed.has(id)).length;
  const after = s.file.recapAfter ?? DEFAULT_RECAP_AFTER;
  const needed = total === 0 ? 0 : after <= 1 ? Math.max(1, Math.ceil(after * total - 1e-9)) : Math.min(after, total);
  return { passed: n, total, needed, open: total > 0 && n >= needed };
}
