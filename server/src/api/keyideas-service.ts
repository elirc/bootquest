import type { Router } from 'express';
import { EmptyBody, EmptyQuery, ReviewItemParams } from '@bootquest/shared/api';
import type { ReviewQueueItem as ReviewQueueItemSchema } from '@bootquest/shared/api';
type ReviewQueueItem = z.infer<typeof ReviewQueueItemSchema>;
import {
  ConceptCardResponse,
  KEYIDEA_SESSION_CAP,
  KeyIdeaQueueQuery,
  KeyIdeaQueueResponse,
  KeyIdeasQuery,
  KeyIdeasResponse,
  RECAP_MIN_WORDS,
  RECAP_XP,
  RecapPromptsResponse,
  RecapRevealBody,
  RecapRevealResponse,
  RecapSubmitBody,
  RecapSubmitResponse,
  RedoRunBody,
  RedoRunResponse,
  type KeyIdeaDto,
  type KeyIdeaRefDto,
  type KeyIdeaSourceDto,
  type RecapKind,
  type RecapMark,
} from '@bootquest/shared/api-ext';
import { answerWords, stripKpWeight } from '@bootquest/shared/eb-weight';
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import { DAY_MS, dayKey, nowMs } from '../engines/clock.ts';
import { addReviewItem, deserializeCard, regradeMissedCard, REVIEWABLE_SQL, reviveRetiredCard, type ReviewItemRow } from '../engines/fsrs.ts';
import {
  cardKeyOf,
  ideaStatuses,
  KEYIDEA_PREFIX,
  liveSources,
  metAt,
  NOTE_PREFIX,
  parseIdeaCardKey,
  passTimes,
  RECHECK_PREFIX,
  recapIdeasNeeded,
  recapProgress,
  REDO_PREFIX,
  resolveSections,
  syncKeyIdeaCards,
  type ResolvedIdea,
  type ResolvedSection,
} from '../engines/keyideas.ts';
import { chooseSibling, ebmissHeadline, ebmissTarget, enrolRedo, parkRedo, releaseRedo } from '../engines/redo.ts';
import { EBMISS_PREFIX } from '../engines/keyideas.ts';
import { keyIdeas } from '../store/keyideas.ts';
import type { SeedItemStore } from '../store/seed-items.ts';
import { asyncRoute, HttpError, sendJson, validate } from './http.ts';
import { noteCardText } from './notebook-service.ts';
import { gradeReview, runUnit, type ServiceDeps } from './service.ts';

/**
 * rv2 S1 (PLAN §2.1 items 1-6; F1, F2): the key-ideas layer's API.
 *   GET  /keyideas[?track=&unit=]        sections, ideas (prompt / answer / why ONLY once the idea is met), tiles
 *   GET  /keyideas/queue[?tag=&limit=]   due key-idea cards, interleaved across sections (cap 12; 10-min mode 5)
 *   GET  /keyideas/cards/:itemId         what a concept card is about (source links, the redo drill); no answer
 *   GET  /keyideas/recap/:section        the recap prompts (open recap only)
 *   POST /keyideas/sections/:section/reveal  {ideaId, recall}: >= 8 typed words first, then the answer
 *   POST /keyideas/recap/:section        {items}: one checkpoint row, 20 XP once, partly/missed re-enrolled
 *   GET  /keyideas/recheck/:itemId       a due re-check card's five prompts (the shakiest ideas)
 *   POST /keyideas/recheck/:itemId       {items}: one checkpoint row, the card's review grade, then retired
 *   POST /redo/:itemId/run               {code}: a practice-mode run of the redo drill; grades only the card
 * Nothing here writes evidence, a ladder leg, practice_log or an attempt, and nothing unlocks a unit.
 */

export const RECHECK_DAYS = [14, 45] as const;
export const RECHECK_PROMPTS = 5;

type Deps = ServiceDeps;

/**
 * Enrol what the latest passes earned (key-idea cards, redo cards) and release today's redo card. Called after
 * every pass-making request and on the review reads. Never blocks the request that triggered it: a failure is
 * logged and the next read retries (enrolment is idempotent).
 */
export function syncKeyIdeas(deps: Pick<Deps, 'db' | 'clock'>): void {
  const { db, clock } = deps;
  if (keyIdeas().sections.size === 0) return;
  try {
    syncKeyIdeaCards(db, clock, keyIdeas(), (i, passed) => enrolRedo(db, i, passed, clock));
    releaseRedo(db, clock);
  } catch (err) {
    console.error('[bootquest api] keyideas: card sync failed (retried on the next read):', err);
  }
}

// ---------------------------------------------------------------- card text

const sourceDtos = (i: ResolvedIdea, passed: ReadonlyMap<number, number>): KeyIdeaSourceDto[] =>
  i.sources.map((s) => ({ key: s.key, unitId: s.unitId, title: s.title, passed: s.unitId !== null && passed.has(s.unitId) }));

const refDto = (i: ResolvedIdea, passed: ReadonlyMap<number, number>): KeyIdeaRefDto => ({
  section: i.section,
  sectionTitle: i.sectionTitle,
  ideaId: i.idea.id,
  tags: [...i.idea.tags],
  sources: sourceDtos(i, passed),
});

function findIdea(sections: readonly ResolvedSection[], section: string, id: string): ResolvedIdea | undefined {
  return sections.find((s) => s.file.section === section)?.ideas.find((i) => i.idea.id === id);
}

type CardText = { front: string; back: string; source: string | null };

/** The text of a concept card (keyidea / redo / ebmiss / recheck / note), resolved at read time; undefined = none. */
export function conceptCardText(db: Db, seedItems: SeedItemStore, cardKey: string, sections?: readonly ResolvedSection[]): CardText | undefined {
  if (cardKey.startsWith(NOTE_PREFIX)) return noteCardText(db, cardKey);
  if (cardKey.startsWith(EBMISS_PREFIX)) {
    const t = ebmissTarget(db, seedItems, cardKey);
    if (!t) return undefined;
    return {
      front: `${t.prompt}\n\nThe key point you missed: ${ebmissHeadline(t)}`,
      back: stripKpWeight(t.kpText),
      source: `${t.unit.title} · question ${t.qi}`,
    };
  }
  const all = (): readonly ResolvedSection[] => (sections ??= resolveSections(db));
  const ki = parseIdeaCardKey(cardKey, KEYIDEA_PREFIX);
  if (ki) {
    const i = findIdea(all(), ki.section, ki.id);
    if (!i) return undefined;
    const from = liveSources(i).map((s) => s.title ?? s.key).join(' · ');
    return { front: i.idea.prompt, back: `${i.idea.answer}\n\nWhy it matters: ${i.idea.why}`, source: `Key idea · ${i.sectionTitle}${from ? ` · from ${from}` : ''}` };
  }
  const rd = parseIdeaCardKey(cardKey, REDO_PREFIX);
  if (rd) {
    const i = findIdea(all(), rd.section, rd.id);
    if (!i) return undefined;
    return {
      front: `Redo, in practice mode: ${i.idea.idea}`,
      back: 'Solve the drill again without the solution. A passing run rates this card Good, a failing run rates it Again. Nothing else is recorded.',
      source: `Key idea · ${i.sectionTitle}`,
    };
  }
  const rc = parseIdeaCardKey(cardKey, RECHECK_PREFIX);
  if (rc) {
    const s = all().find((x) => x.file.section === rc.section);
    if (!s) return undefined;
    return {
      front: `Re-check: ${s.file.title} (${rc.id} days after its recap)`,
      back: `${RECHECK_PROMPTS} prompts from this section's shakiest ideas: type your recall first, then mark each one.`,
      source: `Key ideas · ${s.file.title}`,
    };
  }
  return undefined;
}

// ---------------------------------------------------------------- GET /keyideas

function recapRow(db: Db, section: string, kind: RecapKind): { id: number; at: number } | undefined {
  return db.get<{ id: number; at: number }>('SELECT id, created_at AS at FROM keyidea_checkpoint WHERE section = ? AND kind = ?', section, kind);
}

function sectionRecap(db: Db, s: ResolvedSection, passed: ReadonlyMap<number, number>) {
  const p = recapProgress(s, passed);
  const done = recapRow(db, s.file.section, 'recap');
  // rv3 MF-1 (ruling 8): the unit threshold AND at least min(3, live ideas) met ideas
  const met = s.ideas.filter((i) => metAt(i, passed) !== null).length;
  const open = p.open && met >= recapIdeasNeeded(s);
  return { state: done ? ('done' as const) : open ? ('open' as const) : ('locked' as const), passed: p.passed, total: p.total, needed: p.needed, doneAt: done?.at ?? null };
}

/** Why a recap is still locked (the NOT_DUE message). */
function lockedReason(s: ResolvedSection, passed: ReadonlyMap<number, number>, r: { passed: number; total: number; needed: number }): string {
  if (r.passed < r.needed || r.total === 0) return `the ${s.file.title} recap opens after ${r.needed} of its ${r.total} units are passed (${r.passed} so far)`;
  const met = s.ideas.filter((i) => metAt(i, passed) !== null).length;
  return `the ${s.file.title} recap opens once ${recapIdeasNeeded(s)} of its ideas are met (every source of an idea passed; ${met} so far)`;
}

export function getKeyIdeas(deps: Deps, q: z.infer<typeof KeyIdeasQuery>): KeyIdeasResponse {
  const { db, clock } = deps;
  syncKeyIdeas(deps);
  const sections = resolveSections(db);
  const passed = passTimes(db);
  const status = ideaStatuses(db, sections, passed);
  const tiles = new Map<string, { owned: number; shaky: number; notMet: number }>();
  for (const s of sections) {
    const tile = tiles.get(s.file.track) ?? { owned: 0, shaky: 0, notMet: 0 };
    for (const i of s.ideas) {
      const st = status.get(cardKeyOf(KEYIDEA_PREFIX, i.section, i.idea.id))!;
      if (st === 'owned') tile.owned++;
      else if (st === 'shaky') tile.shaky++;
      else tile.notMet++;
    }
    tiles.set(s.file.track, tile);
  }
  const unitId = q.unit ? db.get<{ id: number }>('SELECT id FROM unit WHERE key = ? AND retired_at IS NULL', q.unit)?.id : undefined;
  const shown = sections.filter(
    (s) =>
      (q.track === undefined || s.file.track === q.track) &&
      (q.unit === undefined || (unitId !== undefined && (s.scopeIds.includes(unitId) || s.ideas.some((i) => i.sources.some((x) => x.unitId === unitId))))),
  );
  const recaps = sections.map((s) => ({ s, r: sectionRecap(db, s, passed) }));
  const t = nowMs(clock);
  const dueCards =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM review_item WHERE due_at <= ? AND ${REVIEWABLE_SQL} AND substr(card_key, 1, ${KEYIDEA_PREFIX.length}) = '${KEYIDEA_PREFIX}'`,
      t,
    )?.n ?? 0;
  return {
    sections: shown.map((s) => ({
      section: s.file.section,
      title: s.file.title,
      track: s.file.track,
      recap: recaps.find((r) => r.s === s)!.r,
      ideas: s.ideas.map((i): KeyIdeaDto => {
        const met = metAt(i, passed) !== null;
        const base: KeyIdeaDto = { id: i.idea.id, idea: i.idea.idea, tags: [...i.idea.tags], status: status.get(cardKeyOf(KEYIDEA_PREFIX, i.section, i.idea.id))!, sources: sourceDtos(i, passed) };
        // the leak rule (PLAN §5.3): prompt / answer / why leave the server only once every live source is passed
        return met ? { ...base, prompt: i.idea.prompt, answer: i.idea.answer, why: i.idea.why } : base;
      }),
    })),
    tiles: [...tiles.entries()].map(([track, v]) => ({ track, ...v })),
    recapsOpen: recaps.filter((r) => r.r.state === 'open').map((r) => ({ section: r.s.file.section, title: r.s.file.title })),
    dueCards,
  };
}

// ---------------------------------------------------------------- the interleaved session

/** A tiny deterministic hash (FNV-1a) for the per-day section shuffle. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * Interleave cards so that no two neighbours share a section: greedy, the section with the most cards left that
 * is not the previous one (ties: a per-day shuffled section order). Within a section the input order (due time)
 * is kept. When only the previous card's section has cards left and the input spans >= 2 sections, the session
 * stops short of the cap rather than put two cards of one section side by side. Capped at `cap`.
 */
export function interleave<T extends { section: string }>(items: readonly T[], cap: number, seed: string): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) groups.set(it.section, [...(groups.get(it.section) ?? []), it]);
  const order = [...groups.keys()].sort((a, b) => hash(`${seed}|${a}`) - hash(`${seed}|${b}`) || a.localeCompare(b));
  const multi = groups.size >= 2;
  const out: T[] = [];
  let prev: string | null = null;
  while (out.length < cap) {
    const cands = order.filter((s) => groups.get(s)!.length > 0 && (s !== prev || !multi));
    if (cands.length === 0) break;
    const pick = cands.reduce((a, b) => (groups.get(b)!.length > groups.get(a)!.length ? b : a));
    out.push(groups.get(pick)!.shift()!);
    prev = pick;
  }
  return out;
}

export function keyIdeaQueue(deps: Deps, q: z.infer<typeof KeyIdeaQueueQuery>): KeyIdeaQueueResponse {
  const { db, clock, seedItems } = deps;
  syncKeyIdeas(deps);
  const t = nowMs(clock);
  const sections = resolveSections(db);
  const passed = passTimes(db);
  const rows = db.all<ReviewItemRow>(
    `SELECT * FROM review_item WHERE due_at <= ? AND ${REVIEWABLE_SQL} AND substr(card_key, 1, ${KEYIDEA_PREFIX.length}) = '${KEYIDEA_PREFIX}' ORDER BY due_at, id`,
    t,
  );
  const due = rows.flatMap((r) => {
    const k = parseIdeaCardKey(r.card_key, KEYIDEA_PREFIX);
    const i = k ? findIdea(sections, k.section, k.id) : undefined;
    return i ? [{ section: i.section, row: r, idea: i }] : [];
  });
  const tagCounts = new Map<string, number>();
  for (const d of due) for (const tag of d.idea.idea.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const filtered = q.tag === undefined ? due : due.filter((d) => d.idea.idea.tags.includes(q.tag!));
  const picked = interleave(filtered, q.limit ?? KEYIDEA_SESSION_CAP, dayKey(t));
  return {
    count: filtered.length,
    items: picked.map((d) => {
      const card = conceptCardText(db, seedItems, d.row.card_key, sections)!;
      const item: ReviewQueueItem = { id: d.row.id, cardKey: d.row.card_key, kind: 'concept', unitId: d.row.unit_id, competencyId: d.row.competency_id, dueAt: d.row.due_at, card };
      return { ...item, keyIdea: refDto(d.idea, passed) };
    }),
    tags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count })),
  };
}

// ---------------------------------------------------------------- GET /keyideas/cards/:itemId

function requireItem(db: Db, itemId: number): ReviewItemRow {
  const row = db.get<ReviewItemRow>('SELECT * FROM review_item WHERE id = ?', itemId);
  if (!row) throw new HttpError(404, 'NOT_FOUND', `review item ${itemId} not found`);
  return row;
}

export function conceptCard(deps: Deps, itemId: number): ConceptCardResponse {
  const { db } = deps;
  const row = requireItem(db, itemId);
  const sections = resolveSections(db);
  const passed = passTimes(db);
  const base = { itemId, cardKey: row.card_key };
  for (const [prefix, type] of [[KEYIDEA_PREFIX, 'keyidea'], [REDO_PREFIX, 'redo']] as const) {
    const k = parseIdeaCardKey(row.card_key, prefix);
    if (!k) continue;
    const i = findIdea(sections, k.section, k.id);
    if (!i) throw new HttpError(404, 'NOT_FOUND', `the key idea of ${row.card_key} is not in the side files`);
    return type === 'redo' ? { ...base, type, keyIdea: refDto(i, passed), redo: chooseSibling(db, i) } : { ...base, type, keyIdea: refDto(i, passed) };
  }
  const rc = parseIdeaCardKey(row.card_key, RECHECK_PREFIX);
  if (rc) {
    const s = sections.find((x) => x.file.section === rc.section);
    if (!s) throw new HttpError(404, 'NOT_FOUND', `section ${rc.section} is not in the side files`);
    return { ...base, type: 'recheck', recheck: { section: rc.section, title: s.file.title, kind: `recheck-${rc.id}` as RecapKind } };
  }
  if (row.card_key.startsWith(EBMISS_PREFIX)) return { ...base, type: 'ebmiss' };
  if (row.card_key.startsWith(NOTE_PREFIX)) return { ...base, type: 'note' };
  throw new HttpError(409, 'WRONG_UNIT_KIND', `review item ${itemId} is not a concept card`);
}

// ---------------------------------------------------------------- recap + re-check

function requireSection(db: Db, section: string): { s: ResolvedSection; passed: Map<number, number> } {
  const s = resolveSections(db).find((x) => x.file.section === section);
  if (!s) throw new HttpError(404, 'NOT_FOUND', `no key-ideas section ${section}`);
  return { s, passed: passTimes(db) };
}

const metIdeas = (s: ResolvedSection, passed: ReadonlyMap<number, number>): ResolvedIdea[] => s.ideas.filter((i) => metAt(i, passed) !== null);

function assertRecall(recall: string, path: string): void {
  const n = answerWords(recall);
  if (n < RECAP_MIN_WORDS) {
    throw new HttpError(400, 'VALIDATION', `type your recall first: at least ${RECAP_MIN_WORDS} words, in your own words (${n} so far)`, [{ path, message: `${n} words; at least ${RECAP_MIN_WORDS} needed` }]);
  }
}

export function recapPrompts(deps: Deps, section: string): RecapPromptsResponse {
  const { db } = deps;
  const { s, passed } = requireSection(db, section);
  const r = sectionRecap(db, s, passed);
  if (r.state === 'done') throw new HttpError(409, 'ALREADY_SCORED', `the ${s.file.title} recap is done`);
  if (r.state !== 'open') throw new HttpError(409, 'NOT_DUE', lockedReason(s, passed, r));
  return { section, title: s.file.title, kind: 'recap', prompts: metIdeas(s, passed).map((i) => ({ ideaId: i.idea.id, prompt: i.idea.prompt })) };
}

/** Answer-first: >= 8 typed words, then the answer of ONE met idea of the section (nothing is written). */
export function revealIdea(deps: Deps, section: string, body: z.infer<typeof RecapRevealBody>): RecapRevealResponse {
  const { db } = deps;
  const { s, passed } = requireSection(db, section);
  const i = s.ideas.find((x) => x.idea.id === body.ideaId);
  if (!i) throw new HttpError(404, 'NOT_FOUND', `no idea ${body.ideaId} in ${section}`);
  if (metAt(i, passed) === null) throw new HttpError(403, 'NOT_VERIFIED', 'this idea opens once its source units are passed');
  assertRecall(body.recall, 'body.recall');
  return { ideaId: i.idea.id, answer: i.idea.answer, why: i.idea.why, sources: sourceDtos(i, passed) };
}

/** Partly / missed ideas: their key-idea card re-graded Again, due tomorrow at the latest (created if missing). */
function reenrol(db: Db, i: ResolvedIdea, passed: ReadonlyMap<number, number>, t: number, clock: Deps['clock']): string {
  const key = cardKeyOf(KEYIDEA_PREFIX, i.section, i.idea.id);
  const due = t + DAY_MS;
  if (db.get('SELECT 1 AS x FROM review_item WHERE card_key = ?', key)) {
    reviveRetiredCard(db, key, due, clock);
    regradeMissedCard(db, key, due, clock);
  } else {
    const last = liveSources(i).reduce((a, b) => ((passed.get(b.unitId!) ?? 0) > (passed.get(a.unitId!) ?? 0) ? b : a));
    addReviewItem(db, { cardKey: key, kind: 'concept', unitId: last.unitId!, dueAt: due }, clock);
  }
  return key;
}

function checkItems(ideas: readonly ResolvedIdea[], items: z.infer<typeof RecapSubmitBody>['items']): Map<string, { recall: string; mark: RecapMark }> {
  const want = new Set(ideas.map((i) => i.idea.id));
  const got = new Map<string, { recall: string; mark: RecapMark }>();
  items.forEach((it, n) => {
    if (!want.has(it.ideaId)) throw new HttpError(400, 'VALIDATION', `idea ${it.ideaId} is not one of these prompts`, [{ path: `body.items.${n}.ideaId`, message: 'not a prompt of this checkpoint' }]);
    if (got.has(it.ideaId)) throw new HttpError(400, 'VALIDATION', `idea ${it.ideaId} is listed twice`, [{ path: `body.items.${n}.ideaId`, message: 'duplicate' }]);
    assertRecall(it.recall, `body.items.${n}.recall`);
    got.set(it.ideaId, { recall: it.recall, mark: it.mark });
  });
  const missing = [...want].filter((id) => !got.has(id));
  if (missing.length) throw new HttpError(400, 'VALIDATION', `answer every prompt: ${missing.join(', ')} missing`, [{ path: 'body.items', message: `${missing.length} prompt(s) missing` }]);
  return got;
}

export function submitRecap(deps: Deps, section: string, body: z.infer<typeof RecapSubmitBody>): RecapSubmitResponse {
  const { db, clock } = deps;
  const { s, passed } = requireSection(db, section);
  const r = sectionRecap(db, s, passed);
  if (r.state === 'done') throw new HttpError(409, 'ALREADY_SCORED', `the ${s.file.title} recap is done (it pays once)`);
  if (r.state !== 'open') throw new HttpError(409, 'NOT_DUE', lockedReason(s, passed, r));
  const ideas = metIdeas(s, passed);
  const got = checkItems(ideas, body.items);
  const t = nowMs(clock);
  return db.tx(() => {
    // the flat recap XP: xp_event kind 'study-quest' (XpKind is bound; no new kind), no unit, once per section
    // (keyidea_checkpoint UNIQUE (section, kind) holds it)
    const track = db.get('SELECT 1 AS x FROM track WHERE id = ?', s.file.track) ? s.file.track : null;
    const xp = db.run(
      `INSERT INTO xp_event (kind, amount, reason, unit_id, attempt_id, track_id, day, created_at) VALUES ('study-quest', ?, NULL, NULL, NULL, ?, ?, ?)`,
      RECAP_XP,
      track,
      dayKey(t),
      t,
    ).lastInsertRowid;
    const items = ideas.map((i) => ({ ideaId: i.idea.id, ...got.get(i.idea.id)! }));
    const cp = db.run('INSERT INTO keyidea_checkpoint (section, kind, items, xp_event_id, created_at) VALUES (?, ?, ?, ?, ?)', section, 'recap', JSON.stringify(items), xp, t).lastInsertRowid;
    const reenrolled = ideas.filter((i) => got.get(i.idea.id)!.mark !== 'got').map((i) => reenrol(db, i, passed, t, clock));
    const recheckDueAt = RECHECK_DAYS.map((d) => {
      const key = `${RECHECK_PREFIX}${section}/${d}`;
      const due = t + d * DAY_MS;
      if (!db.get('SELECT 1 AS x FROM review_item WHERE card_key = ?', key)) addReviewItem(db, { cardKey: key, kind: 'concept', dueAt: due }, clock);
      return due;
    });
    return { checkpointId: cp, section, kind: 'recap' as const, xp: { id: xp, amount: RECAP_XP, reason: null }, reviewXp: null, reenrolled, recheckDueAt };
  });
}

function requireRecheck(deps: Deps, itemId: number): { row: ReviewItemRow; s: ResolvedSection; passed: Map<number, number>; kind: RecapKind; ideas: ResolvedIdea[] } {
  const { db, clock } = deps;
  const row = requireItem(db, itemId);
  const rc = parseIdeaCardKey(row.card_key, RECHECK_PREFIX);
  if (!rc || !RECHECK_DAYS.map(String).includes(rc.id)) throw new HttpError(409, 'WRONG_UNIT_KIND', `review item ${itemId} is not a re-check`);
  const kind = `recheck-${rc.id}` as RecapKind;
  if (recapRow(db, rc.section, kind)) throw new HttpError(409, 'ALREADY_SCORED', 'this re-check is done');
  if (row.retired_at !== null) throw new HttpError(409, 'NOT_DUE', 'this re-check was retired (its section left the side files)');
  if (row.due_at > nowMs(clock)) throw new HttpError(409, 'NOT_DUE', `this re-check is due ${new Date(row.due_at).toISOString()}`);
  const { s, passed } = requireSection(db, rc.section);
  return { row, s, passed, kind, ideas: shakiest(db, metIdeas(s, passed)) };
}

/** The RECHECK_PROMPTS met ideas with the worst FSRS state: not in Review state first, then most lapses, lowest stability. */
function shakiest(db: Db, ideas: readonly ResolvedIdea[]): ResolvedIdea[] {
  const score = (i: ResolvedIdea): [number, number, number] => {
    const row = db.get<{ state: string }>('SELECT fsrs_state AS state FROM review_item WHERE card_key = ?', cardKeyOf(KEYIDEA_PREFIX, i.section, i.idea.id));
    if (!row) return [0, 0, 0];
    const c = deserializeCard(row.state);
    return [c.state === 2 ? 1 : 0, -c.lapses, c.stability];
  };
  return ideas
    .map((i, n) => ({ i, n, k: score(i) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.n - b.n)
    .slice(0, RECHECK_PROMPTS)
    .map((x) => x.i);
}

export function recheckPrompts(deps: Deps, itemId: number): RecapPromptsResponse {
  const { s, kind, ideas } = requireRecheck(deps, itemId);
  return { section: s.file.section, title: s.file.title, kind, prompts: ideas.map((i) => ({ ideaId: i.idea.id, prompt: i.idea.prompt })) };
}

export function submitRecheck(deps: Deps, itemId: number, body: z.infer<typeof RecapSubmitBody>): RecapSubmitResponse {
  const { db, clock } = deps;
  const { row, s, passed, kind, ideas } = requireRecheck(deps, itemId);
  const got = checkItems(ideas, body.items);
  const t = nowMs(clock);
  return db.tx(() => {
    const items = ideas.map((i) => ({ ideaId: i.idea.id, ...got.get(i.idea.id)! }));
    const cp = db.run('INSERT INTO keyidea_checkpoint (section, kind, items, xp_event_id, created_at) VALUES (?, ?, ?, NULL, ?)', s.file.section, kind, JSON.stringify(items), t).lastInsertRowid;
    const reenrolled = ideas.filter((i) => got.get(i.idea.id)!.mark !== 'got').map((i) => reenrol(db, i, passed, t, clock));
    const gotN = items.filter((x) => x.mark === 'got').length;
    const g = gotN === items.length ? 'good' : gotN * 2 >= items.length ? 'hard' : 'again';
    // the card's ordinary review grade (B's review XP rule), then it is done: retired, never due again
    const graded = gradeReview(deps, row.id, g);
    db.run('UPDATE review_item SET retired_at = ? WHERE id = ?', t, row.id);
    return { checkpointId: cp, section: s.file.section, kind, xp: null, reviewXp: graded.xp, reenrolled, recheckDueAt: [] };
  });
}

// ---------------------------------------------------------------- redo

export async function runRedo(deps: Deps, itemId: number, body: z.infer<typeof RedoRunBody>): Promise<RedoRunResponse> {
  const { db, clock } = deps;
  const row = requireItem(db, itemId);
  const k = parseIdeaCardKey(row.card_key, REDO_PREFIX);
  if (!k) throw new HttpError(409, 'WRONG_UNIT_KIND', `review item ${itemId} is not a redo card`);
  if (row.retired_at !== null) throw new HttpError(409, 'NOT_DUE', 'this redo card was retired (its key idea left the side files)');
  if (row.due_at > nowMs(clock)) throw new HttpError(409, 'NOT_DUE', 'this redo card is not due today (at most one redo a day)');
  const i = findIdea(resolveSections(db), k.section, k.id);
  const sib = i ? chooseSibling(db, i) : null;
  if (!sib) throw new HttpError(409, 'CONTENT_PENDING', 'no sibling drill of this key idea is loaded on this server');
  // the free grader (POST /units/:id/run semantics): no attempt, no run row, no XP, no evidence, no practice_log
  const result = await runUnit(deps, sib.unitId, { code: body.code });
  const g = result.pass ? 'good' : 'again';
  const graded = db.tx(() => {
    const out = gradeReview(deps, itemId, g);
    parkRedo(db, itemId);
    return out;
  });
  return { itemId, unitId: sib.unitId, result, grade: g, xp: graded.xp, nextDueAt: graded.nextDueAt };
}

// ---------------------------------------------------------------- routes

const SectionParams = z.object({ section: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80) }).strict();

export function registerKeyIdeaRoutes(router: Router, deps: Deps): void {
  router.get('/keyideas', asyncRoute((req, res) => {
    const q = validate(KeyIdeasQuery, req.query, 'query');
    sendJson(res, 200, KeyIdeasResponse.parse(getKeyIdeas(deps, q)));
  }));
  router.get('/keyideas/queue', asyncRoute((req, res) => {
    const q = validate(KeyIdeaQueueQuery, req.query, 'query');
    sendJson(res, 200, KeyIdeaQueueResponse.parse(keyIdeaQueue(deps, q)));
  }));
  router.get('/keyideas/cards/:itemId', asyncRoute((req, res) => {
    const { itemId } = validate(ReviewItemParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, ConceptCardResponse.parse(conceptCard(deps, itemId)));
  }));
  router.get('/keyideas/recap/:section', asyncRoute((req, res) => {
    const { section } = validate(SectionParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, RecapPromptsResponse.parse(recapPrompts(deps, section)));
  }));
  router.post('/keyideas/sections/:section/reveal', asyncRoute((req, res) => {
    const { section } = validate(SectionParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(RecapRevealBody, req.body, 'body');
    sendJson(res, 200, RecapRevealResponse.parse(revealIdea(deps, section, body)));
  }));
  router.post('/keyideas/recap/:section', asyncRoute((req, res) => {
    const { section } = validate(SectionParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(RecapSubmitBody, req.body, 'body');
    sendJson(res, 200, RecapSubmitResponse.parse(submitRecap(deps, section, body)));
  }));
  router.get('/keyideas/recheck/:itemId', asyncRoute((req, res) => {
    const { itemId } = validate(ReviewItemParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, RecapPromptsResponse.parse(recheckPrompts(deps, itemId)));
  }));
  router.post('/keyideas/recheck/:itemId', asyncRoute((req, res) => {
    const { itemId } = validate(ReviewItemParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(RecapSubmitBody, req.body, 'body');
    sendJson(res, 200, RecapSubmitResponse.parse(submitRecheck(deps, itemId, body)));
  }));
  router.post('/redo/:itemId/run', asyncRoute(async (req, res) => {
    const { itemId } = validate(ReviewItemParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(RedoRunBody, req.body, 'body');
    sendJson(res, 200, RedoRunResponse.parse(await runRedo(deps, itemId, body)));
  }));
  void EmptyBody;
}
