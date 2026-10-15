import type { CheckSpec, SeedNoteItem } from '@bootquest/shared';
import type { NoteDto, UnitNotesResponse } from '@bootquest/shared/api';
import type { Db } from '../db/database.ts';
import { isRevealed, VERIFIED_PASS_SQL } from '../engines/attempts.ts';
import { questUnitUnlocked } from '../engines/campaign.ts';
import { nowMs } from '../engines/clock.ts';
import { retestGate } from '../engines/ladder.ts';
import { QUIZ_MISS_CARD_PREFIX } from '../engines/study-quest.ts';
import { getTrack, getUnit, primaryCheck, type UnitRecord } from '../store/queries.ts';
import type { QuestPackItems } from '../store/seed-items.ts';
import { HttpError } from './http.ts';
import { getRevealedSolution, unitRefs, type ServiceDeps } from './service.ts';
import { repoLink } from './study-service.ts';

/**
 * GET /units/:id/notes — the "Learn more" panel. READ-ONLY (no attempt, run, XP or review row
 * is ever written here) and never an answer oracle:
 *   - locked track / campaign act: 403 TRACK_LOCKED / ACT_LOCKED, exactly like the unit's writes;
 *   - readings ('before' notes) are always served for an open study unit: seed:notes proved
 *     none contains, or heavily overlaps, a keyed answer of the quest pack;
 *   - an explanation ('after' note of ONE quiz) needs a recorded, graded study-quiz submit that
 *     covered that quiz (never /run: it is refused for study quizzes and writes nothing), AND one of:
 *       (a) a verified pass of a study-quiz gate containing it,
 *       (b) the quiz was never missed (a miss always queues its 'quiz-miss:<key>' review card in
 *           the same transaction, so answered + no card = answered right),
 *       (c) its missed-question review card is due or has been reviewed: the moment the card
 *           itself shows the keyed answer. Until then a missed question's key stays hidden (no
 *           free retry with the key in hand: a fail lists missed question NUMBERS only);
 *     withheld explanations are counted, never titled (a title can hint at the key);
 *   - any other unit: its registered refs; the post-solve `explanation` after a verified pass or
 *     a reveal; the solution only after a reveal (what GET /solution already serves). Explain-back
 *     and patch-kata keys stay behind their own answer-first endpoints, a written unit's model
 *     answer behind /model-answer, a closed retest serves nothing extra.
 */

function requireOpenUnit(db: Db, id: number): UnitRecord {
  const unit = getUnit(db, id);
  if (!unit) throw new HttpError(404, 'NOT_FOUND', `unit ${id} not found`);
  if (getTrack(db, unit.trackId)?.locked) throw new HttpError(403, 'TRACK_LOCKED', `track ${unit.trackId} is locked`);
  if (questUnitUnlocked(db, unit.id) === false) throw new HttpError(403, 'ACT_LOCKED', `unit ${unit.id} belongs to a campaign act that is not unlocked yet`);
  return unit;
}

/** a registered content_ref for this exact repo/path/sha, so a link can open in the /refs viewer */
function refIdFor(db: Db, repo: string, sha: string, path: string): number | null {
  const row = db.get<{ id: number }>(
    `SELECT id FROM content_ref WHERE repo = ? AND path = ? AND sha = ? AND status <> 'quarantined' ORDER BY (line_start IS NULL) DESC, id LIMIT 1`,
    repo,
    path,
    sha,
  );
  return row?.id ?? null;
}

function noteDto(db: Db, n: SeedNoteItem, kinds: ReadonlyMap<string, NoteDto['targetKind']>): NoteDto {
  const { repo, sha } = n.provenance;
  return {
    key: n.key,
    id: n.noteId,
    phase: n.phase,
    target: n.target,
    targetKind: n.target === 'pack' ? 'pack' : (kinds.get(n.target) ?? 'pack'),
    title: n.title,
    body: n.body,
    excerpts: n.excerpts.map((e) => ({
      path: e.path,
      lineStart: e.lineStart,
      lineEnd: e.lineEnd,
      quote: e.quote,
      url: repoLink(repo, sha, e.path, { start: e.lineStart, end: e.lineEnd }),
      refId: refIdFor(db, repo, sha, e.path),
    })),
    readMore: n.readMore.map((r) => ({
      path: r.path,
      lineStart: r.lineStart,
      lineEnd: r.lineEnd,
      why: r.why,
      url: repoLink(repo, sha, r.path, r.lineStart !== null && r.lineEnd !== null ? { start: r.lineStart, end: r.lineEnd } : undefined),
      refId: refIdFor(db, repo, sha, r.path),
    })),
  };
}

/** graded study-quiz submits covering this quiz item (any unit; /run never writes one) */
function quizAnswered(db: Db, quizKey: string): { answered: boolean; passed: boolean } {
  const row = db.get<{ answered: number; passed: number }>(
    `SELECT COUNT(*) AS answered, COALESCE(SUM(${VERIFIED_PASS_SQL}), 0) AS passed
       FROM attempt a JOIN "check" c ON c.id = a.check_id
      WHERE c.type = 'study-quiz' AND a.outcome IN ('pass', 'fail')
        AND EXISTS (SELECT 1 FROM run r WHERE r.attempt_id = a.id AND r.kind = 'submit')
        AND EXISTS (SELECT 1 FROM json_each(c.spec, '$.itemKeys') j WHERE j.value = ?)`,
    quizKey,
  );
  return { answered: (row?.answered ?? 0) > 0, passed: (row?.passed ?? 0) > 0 };
}

type Release = { released: true } | { released: false; reason: 'unanswered' | 'missed'; at: number | null };

function explanationRelease(db: Db, quizKey: string, now: number): Release {
  const a = quizAnswered(db, quizKey);
  if (!a.answered) return { released: false, reason: 'unanswered', at: null };
  if (a.passed) return { released: true };
  const card = db.get<{ id: number; due: number }>('SELECT id, due_at AS due FROM review_item WHERE card_key = ?', `${QUIZ_MISS_CARD_PREFIX}${quizKey}`);
  if (!card) return { released: true };
  if (card.due <= now || db.get('SELECT 1 AS x FROM review_log WHERE review_item_id = ? LIMIT 1', card.id)) return { released: true };
  return { released: false, reason: 'missed', at: card.due };
}

function packFor(deps: ServiceDeps, spec: Extract<CheckSpec, { type: 'study-quiz' }>): QuestPackItems | undefined {
  const first = deps.seedItems.quiz(spec.itemKeys[0]!);
  return first ? deps.seedItems.questPacks().get(first.provenance.repo) : undefined;
}

const NO_EXPLANATIONS = { state: 'none' as const, message: 'This unit has no written explanations yet.', released: [], withheld: 0, nextAt: null };

/** Units whose own answer-first endpoints already release their key: nothing extra here. */
const OWN_KEY_FLOW: ReadonlySet<CheckSpec['type']> = new Set<CheckSpec['type']>(['explain-back', 'patch-kata']);

export function getUnitNotes(deps: ServiceDeps, unitId: number): UnitNotesResponse {
  const { db } = deps;
  const unit = requireOpenUnit(db, unitId);
  const check = primaryCheck(db, unit.id);
  const refs = unitRefs(db, unit.id);

  if (check && check.spec.type === 'study-quiz') {
    const pack = packFor(deps, check.spec);
    const notes = pack ? deps.seedItems.notes(pack.repo) : [];
    const kinds = new Map<string, NoteDto['targetKind']>();
    for (const q of pack?.quizzes ?? []) kinds.set(q.key, 'quiz');
    for (const f of pack?.flashcards ?? []) kinds.set(f.key, 'flashcard');
    for (const r of pack?.readingSteps ?? []) kinds.set(r.key, 'reading-step');
    // only notes about THIS gate's items (or the whole pack)
    const inGate = new Set(check.spec.itemKeys);
    const order = new Map([...(pack?.readingSteps ?? []), ...(pack?.quizzes ?? []), ...(pack?.flashcards ?? [])].map((i, n) => [i.key, n]));
    const rank = (n: SeedNoteItem) => (n.target === 'pack' ? -1 : (order.get(n.target) ?? 1e9));
    const sorted = [...notes].sort((a, b) => rank(a) - rank(b) || (a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0));
    const readings = sorted.filter((n) => n.phase === 'before').map((n) => noteDto(db, n, kinds));
    const after = sorted.filter((n) => n.phase === 'after' && inGate.has(n.target));
    const now = nowMs(deps.clock);
    const released: NoteDto[] = [];
    let withheld = 0;
    let unanswered = 0;
    let nextAt: number | null = null;
    for (const n of after) {
      const r = explanationRelease(db, n.target, now);
      if (r.released) released.push(noteDto(db, n, kinds));
      else {
        withheld++;
        if (r.reason === 'unanswered') unanswered++;
        if (r.at !== null) nextAt = nextAt === null ? r.at : Math.min(nextAt, r.at);
      }
    }
    const state = after.length === 0 ? 'none' : withheld === 0 ? 'released' : released.length === 0 ? 'locked' : 'partial';
    const message =
      state === 'none'
        ? 'No written explanations for this quest yet.'
        : state === 'released'
          ? 'Explanations for every question.'
          : unanswered > 0
            ? 'Explanations unlock after you answer: submit the quiz first.'
            : `Explanations for the questions you missed unlock when their review cards are due${state === 'partial' ? '; the ones you answered right are below' : ''}.`;
    return {
      unitId: unit.id,
      source: pack ? { repo: pack.repo, sha: pack.sha } : null,
      readings,
      explanations: { state, message, released, withheld, nextAt },
      refs,
      explanation: null,
      solution: null,
    };
  }

  // ---- every other unit: refs always; post-solve explanation after a verified pass or a reveal
  const closedRetest = unit.kind === 'retest' && !retestGate(db, unit.id, deps.clock).open;
  const ownKey = check !== undefined && OWN_KEY_FLOW.has(check.spec.type);
  const revealed = isRevealed(db, unit.id);
  const passed =
    db.get(`SELECT 1 AS x FROM attempt a WHERE a.unit_id = ? AND ${VERIFIED_PASS_SQL} LIMIT 1`, unit.id) !== undefined;
  const entry = deps.content.get(unit.key);
  const canExplain = !closedRetest && !ownKey && unit.kind !== 'written' && (passed || revealed);
  const explanation = canExplain && entry?.explanation ? entry.explanation : null;
  let solution: UnitNotesResponse['solution'] = null;
  if (!closedRetest && !ownKey && revealed && check) {
    try {
      solution = getRevealedSolution(deps, unit.id).solution;
    } catch (err) {
      if (!(err instanceof HttpError)) throw err; // NO_SOLUTION / NOT_REVEALED: nothing to add
    }
  }
  const hasAny = Boolean(entry?.explanation) && !ownKey && unit.kind !== 'written';
  const explanations =
    !hasAny
      ? NO_EXPLANATIONS
      : explanation
        ? { state: 'released' as const, message: 'Explanation of the solution.', released: [], withheld: 0, nextAt: null }
        : { state: 'locked' as const, message: 'The explanation unlocks after you pass (or reveal the solution).', released: [], withheld: 1, nextAt: null };
  return { unitId: unit.id, source: null, readings: [], explanations, refs, explanation, solution };
}
