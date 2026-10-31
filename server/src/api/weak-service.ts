import type { TrackId } from '@bootquest/shared';
import {
  WEAK_SPOTS_HALF_LIFE_DAYS,
  WEAK_SPOTS_MAX_EXAMPLES,
  WEAK_SPOTS_MAX_GROUPS,
  type WeakExampleDto,
  type WeakGroupDto,
  type WeakSignalKind,
  type WeakSpotsResponse,
} from '@bootquest/shared/api-ext';
import { stripKpWeight } from '@bootquest/shared/eb-weight';
import type { Db } from '../db/database.ts';
import { VERIFIED_PASS_SQL } from '../engines/attempts.ts';
import { DAY_MS, dayKey, nowMs, type Clock } from '../engines/clock.ts';
import { FLASHCARD_CARD_PREFIX, QUIZ_MISS_CARD_PREFIX } from '../engines/study-quest.ts';
import { explainBackKey, seedItemHash, type SeedItemStore } from '../store/seed-items.ts';
import { explanationRelease } from './notes-service.ts';

/**
 * ab wave S3: GET /stats/weak, "what do I keep getting wrong". READ-ONLY over the append-only
 * ledgers (nothing here writes). Four signal sources, each shown only once its key is already
 * released to the learner (answer-before-key holds: this view is never an oracle):
 *   quiz-miss  a live 'quiz-miss:<item>' card whose explanation is released by the SAME rule as
 *              "Learn more" (notes-service explanationRelease: the card is due or reviewed, or a
 *              gate holding the question was passed). A miss whose card is not due yet is hidden.
 *   again      an Again grade (review_log): the learner saw the card's back to grade it.
 *   fail       a failed graded submit of a drill / quick check / predict-output / retest unit with
 *              no LATER verified pass of that unit (the unit link reveals nothing).
 *   eb-missed  a key point marked missed in an explain-back self-score (eb_score_detail.missed_ids,
 *              migration 018): the learner read the key to score it. One detail row per ATTEMPT
 *              counts (evidence is written once per competency, so a set can carry several rows).
 * Grouping is by the unit key alone: `campaign/<track>/<repo>` and `ladder/<family>/<repo>/..` ->
 * the repo; `gh:<owner>/<name>:..` -> name; `<bank>/<module>/<slug>` (drill banks) -> bank/module.
 * Groups sort by a recency-weighted count (half-life WEAK_SPOTS_HALF_LIFE_DAYS), capped.
 */
export interface WeakDeps {
  db: Db;
  clock: Clock;
  seedItems: SeedItemStore;
}

/** practice unit kinds whose failed graded submit is a weakness signal */
const FAIL_KINDS_SQL = `'drill', 'predict-output', 'quiz', 'retest'`;
const LABEL_MAX = 140;

export interface WeakSignal {
  kind: WeakSignalKind;
  unitId: number;
  unitKey: string;
  unitTitle: string;
  trackId: TrackId;
  ref: string | null;
  label: string | null;
  at: number;
}

interface UnitCols {
  unitId: number;
  unitKey: string;
  unitTitle: string;
  trackId: TrackId;
}
const UNIT_COLS = `u.id AS unitId, u.key AS unitKey, u.title AS unitTitle, u.track_id AS trackId`;

/** The weak-spot group of a unit, from its key alone (see the header). */
export function weakGroupOf(unitKey: string): { group: string; scope: 'repo' | 'module' } {
  const parts = unitKey.split('/');
  if ((parts[0] === 'ladder' || parts[0] === 'campaign') && parts[2]) return { group: parts[2], scope: 'repo' };
  const gh = /^gh:[^/:]+\/([^/:]+):/.exec(unitKey);
  if (gh?.[1]) return { group: gh[1], scope: 'repo' };
  if (parts.length >= 3) return { group: `${parts[0]}/${parts[1]}`, scope: 'module' };
  const colon = unitKey.split(':');
  if (colon.length >= 3) return { group: `${colon[0]}/${colon[1]}`, scope: 'module' };
  return { group: unitKey, scope: 'module' };
}

const clip = (s: string): string => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > LABEL_MAX ? `${one.slice(0, LABEL_MAX - 1)}…` : one;
};

/** The card front (already released wherever this is called), or null when the item is not loaded. */
function cardLabel(seedItems: SeedItemStore, cardKey: string): string | null {
  if (cardKey.startsWith(QUIZ_MISS_CARD_PREFIX)) {
    const q = seedItems.quiz(cardKey.slice(QUIZ_MISS_CARD_PREFIX.length));
    return q ? clip(q.prompt) : null;
  }
  if (cardKey.startsWith(FLASHCARD_CARD_PREFIX)) {
    const f = seedItems.flashcard(cardKey.slice(FLASHCARD_CARD_PREFIX.length));
    return f ? clip(f.front) : null;
  }
  return null;
}

const cardRef = (cardKey: string): string =>
  cardKey.startsWith(QUIZ_MISS_CARD_PREFIX)
    ? cardKey.slice(QUIZ_MISS_CARD_PREFIX.length)
    : cardKey.startsWith(FLASHCARD_CARD_PREFIX)
      ? cardKey.slice(FLASHCARD_CARD_PREFIX.length)
      : cardKey;

function quizMissSignals({ db, seedItems }: WeakDeps, now: number): WeakSignal[] {
  const rows = db.all<UnitCols & { cardKey: string; at: number }>(
    `SELECT ri.card_key AS cardKey, ri.created_at AS at, ${UNIT_COLS}
       FROM review_item ri JOIN unit u ON u.id = ri.unit_id
      WHERE ri.kind = 'quiz-miss' AND ri.retired_at IS NULL AND u.retired_at IS NULL
      ORDER BY ri.id`,
  );
  return rows.flatMap((r) => {
    const itemKey = r.cardKey.slice(QUIZ_MISS_CARD_PREFIX.length);
    // honesty: a missed question whose card is not due (and never reviewed) keeps its key hidden
    if (!r.cardKey.startsWith(QUIZ_MISS_CARD_PREFIX) || !explanationRelease(db, itemKey, now).released) return [];
    const { cardKey: _c, ...unit } = r;
    return [{ ...unit, kind: 'quiz-miss' as const, ref: itemKey, label: cardLabel(seedItems, r.cardKey), at: r.at }];
  });
}

function againSignals({ db, seedItems }: WeakDeps): WeakSignal[] {
  const rows = db.all<UnitCols & { cardKey: string; at: number }>(
    `SELECT ri.card_key AS cardKey, l.reviewed_at AS at, ${UNIT_COLS}
       FROM review_log l JOIN review_item ri ON ri.id = l.review_item_id JOIN unit u ON u.id = ri.unit_id
      WHERE l.rating = 'again' AND ri.kind <> 'retest' AND ri.retired_at IS NULL AND u.retired_at IS NULL
      ORDER BY l.id`,
  );
  return rows.map(({ cardKey, at, ...unit }) => ({ ...unit, kind: 'again' as const, ref: cardRef(cardKey), label: cardLabel(seedItems, cardKey), at }));
}

function failSignals({ db }: WeakDeps): WeakSignal[] {
  const rows = db.all<UnitCols & { at: number }>(
    `SELECT f.created_at AS at, ${UNIT_COLS}
       FROM attempt f JOIN unit u ON u.id = f.unit_id
      WHERE u.kind IN (${FAIL_KINDS_SQL}) AND u.retired_at IS NULL AND f.outcome = 'fail'
        AND EXISTS (SELECT 1 FROM run r WHERE r.attempt_id = f.id AND r.kind = 'submit')
        AND NOT EXISTS (SELECT 1 FROM attempt a WHERE a.unit_id = f.unit_id AND a.id > f.id AND ${VERIFIED_PASS_SQL})
      ORDER BY f.id`,
  );
  return rows.map(({ at, ...unit }) => ({ ...unit, kind: 'fail' as const, ref: null, label: null, at }));
}

interface StoredEbAnswer {
  explainBack?: { questionSetKey?: string; itemSha?: string };
}

function ebMissedSignals({ db, seedItems }: WeakDeps): WeakSignal[] {
  const rows = db.all<UnitCols & { attemptId: number | null; evidenceId: number; missed: string; answer: string | null; at: number }>(
    `SELECT d.evidence_id AS evidenceId, d.missed_ids AS missed, d.created_at AS at, e.attempt_id AS attemptId, a.answer AS answer, ${UNIT_COLS}
       FROM eb_score_detail d JOIN evidence e ON e.id = d.evidence_id JOIN unit u ON u.id = e.unit_id
       LEFT JOIN attempt a ON a.id = e.attempt_id
      WHERE u.retired_at IS NULL
      ORDER BY d.evidence_id`,
  );
  const seen = new Set<string>();
  const out: WeakSignal[] = [];
  for (const r of rows) {
    // one self-score files one evidence row per competency: count its missed key points once
    const once = r.attemptId === null ? `e${r.evidenceId}` : `a${r.attemptId}`;
    if (seen.has(once)) continue;
    seen.add(once);
    const ids = (JSON.parse(r.missed) as unknown[]).filter((x): x is string => typeof x === 'string');
    // labels only for the version the learner scored (key-point ids are positional)
    const stored = r.answer ? (JSON.parse(r.answer) as StoredEbAnswer).explainBack : undefined;
    const item = stored?.questionSetKey ? seedItems.explainBack(stored.questionSetKey) : undefined;
    const sameVersion = item !== undefined && (stored?.itemSha === undefined || stored.itemSha === seedItemHash(item));
    const texts = new Map(sameVersion ? explainBackKey(item).flatMap((q) => q.keyPoints.map((k) => [k.id, k.text] as const)) : []);
    const { attemptId: _a, evidenceId: _e, missed: _m, answer: _x, at, ...unit } = r;
    for (const id of ids) {
      const text = texts.get(id);
      out.push({ ...unit, kind: 'eb-missed', ref: id, label: text === undefined ? null : clip(stripKpWeight(text)), at });
    }
  }
  return out;
}

const SOURCE_FIELD: Readonly<Record<WeakSignalKind, keyof WeakGroupDto['bySource']>> = {
  'quiz-miss': 'quizMiss',
  again: 'again',
  fail: 'fail',
  'eb-missed': 'ebMissed',
};

/** PURE: group, weight, sort and cap the signals (exported for the unit test). */
export function rankWeakSpots(signals: readonly WeakSignal[], now: number): { totalGroups: number; groups: WeakGroupDto[] } {
  const byGroup = new Map<string, { scope: 'repo' | 'module'; signals: WeakSignal[] }>();
  for (const s of signals) {
    const { group, scope } = weakGroupOf(s.unitKey);
    const g = byGroup.get(group) ?? { scope, signals: [] };
    g.signals.push(s);
    byGroup.set(group, g);
  }
  const groups: WeakGroupDto[] = [...byGroup.entries()].map(([group, g]) => {
    const newest = [...g.signals].sort((a, b) => b.at - a.at || b.unitId - a.unitId);
    const bySource = { quizMiss: 0, again: 0, fail: 0, ebMissed: 0 };
    for (const s of g.signals) bySource[SOURCE_FIELD[s.kind]]++;
    const examples: WeakExampleDto[] = [];
    const shown = new Set<string>();
    for (const s of newest) {
      if (examples.length >= WEAK_SPOTS_MAX_EXAMPLES) break;
      const id = `${s.kind}\u0000${s.unitId}\u0000${s.ref ?? ''}`;
      if (shown.has(id)) continue;
      shown.add(id);
      examples.push({ kind: s.kind, unitId: s.unitId, unitTitle: s.unitTitle, ref: s.ref, label: s.label, at: s.at });
    }
    const weight = g.signals.reduce((sum, s) => sum + 0.5 ** (Math.max(0, now - s.at) / DAY_MS / WEAK_SPOTS_HALF_LIFE_DAYS), 0);
    return { group, scope: g.scope, trackId: newest[0]!.trackId, count: g.signals.length, weight, lastAt: newest[0]!.at, bySource, examples };
  });
  groups.sort((a, b) => b.weight - a.weight || b.lastAt - a.lastAt || (a.group < b.group ? -1 : a.group > b.group ? 1 : 0));
  return { totalGroups: groups.length, groups: groups.slice(0, WEAK_SPOTS_MAX_GROUPS) };
}

/** GET /stats/weak */
export function weakSpots(deps: WeakDeps): WeakSpotsResponse {
  const now = nowMs(deps.clock);
  const signals = [...quizMissSignals(deps, now), ...againSignals(deps), ...failSignals(deps), ...ebMissedSignals(deps)];
  return { today: dayKey(now), ...rankWeakSpots(signals, now) };
}
