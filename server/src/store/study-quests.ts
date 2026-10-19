import type { CheckSpecInput, TrackId } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import type { Clock } from '../engines/clock.ts';
import { checkReferenced, LIVE_CHECK_SQL, liveChecks, reconcileCheck, sameCheckSpec, type LiveCheckRow } from './check-policy.ts';
import { insertCheck } from './content.ts';
import type { QuestPackItems, SeedItemStore } from './seed-items.ts';

/**
 * W8 study-quest wiring: the campaign's study quests become PLAYABLE from the stamped
 * seed:quests packs (content/seed/quests/<repo>/, full stamp verified by seed-items.ts).
 * Derived at startup like the W7 ladder (store/ladder.ts) — never hand-edited rows:
 *   - for every campaign study quest whose repo has a loaded quest pack with >= 1 quiz item,
 *     the quest's unit (the campaign placeholder, kind 'study', key 'campaign/<track>/<repo>')
 *     gets ONE check: study-quiz {itemKeys: the pack's quiz items in pack order, passPct 0.8},
 *     threshold 0.8, competency code-reading; the quest's content_pending flag is cleared.
 *     The pack's reading steps (the unit's ordered reading list, with repo links) and its
 *     flashcards (FSRS review candidates, enrolled on the first pass) are served from the
 *     in-memory store — curriculum text never enters the DB;
 *   - a study quest whose repo has NO pack stays content-pending (honest): no check, and a
 *     check left by an earlier load is removed when nothing was ever recorded against it
 *     (otherwise it is kept for history and the quest is flagged pending again);
 *   - a pack whose repo is not a campaign study quest is reported (unmatched), never invented
 *     into a quest; the ladder (store/ladder.ts) serves it as a standalone study unit instead.
 * Idempotent upsert under THE re-seed policy (store/check-policy.ts): a changed quiz gate
 * (re-seeded item keys) updates in place while no attempt references it; once attempts do, the
 * old gate is RETIRED (kept, with its original item keys, for the attempts that reference it) and
 * a fresh live gate is inserted on the same unit — never a refusal to start, never a DB reset.
 * One LIVE gate per unit; loaded === built is asserted per track.
 */

export class StudyQuestLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudyQuestLoadError';
  }
}

export const STUDY_QUIZ_PASS_PCT = 0.8;
export const STUDY_COMPETENCY = 'code-reading' as const;

export interface StudyQuestTrackStats {
  track: TrackId;
  /** study quests whose repo has a quest pack */
  built: number;
  /** of those, live units carrying the pack's study-quiz gate with content_pending cleared */
  loaded: number;
  /** study quests (with a unit) whose repo has no pack: still content-pending */
  pending: number;
}

export interface StudyQuestLoadStats {
  tracks: StudyQuestTrackStats[];
  /** quest packs loaded, by repo */
  packs: number;
  /** pack repos that match no campaign study quest (reported, not wired) */
  unmatchedPacks: string[];
  /** quests whose gate was created on this load */
  inserted: number;
  /** quests whose gate changed in place (no attempts yet) */
  updated: number;
  /** quests whose re-seeded gate was retired (attempts reference it) and replaced by a new live gate */
  replaced: string[];
  /** gates removed because their pack left (no attempts) */
  removed: number;
  /** gates kept for history because their pack left after attempts were recorded */
  orphaned: string[];
}

interface QuestRow {
  questId: number;
  questKey: string;
  repo: string;
  track: TrackId;
  unitId: number;
  unitKind: string;
  unitLive: number;
}

function studyQuests(db: Db): QuestRow[] {
  return db.all<QuestRow>(
    `SELECT q.id AS questId, q.key AS questKey, q.repo AS repo, a.track_id AS track, q.unit_id AS unitId,
            u.kind AS unitKind, (u.retired_at IS NULL) AS unitLive
       FROM quest q JOIN campaign_act a ON a.id = q.act_id JOIN unit u ON u.id = q.unit_id
      WHERE q.quest_kind = 'study-quest' AND q.unit_id IS NOT NULL
      ORDER BY a.track_id, a.act_no, q.ordinal`,
  );
}

/** The quiz gate a pack yields (null when it has no quiz items: nothing to gate on, stays pending). */
export function studyQuizSpecFor(pack: QuestPackItems): CheckSpecInput | null {
  if (pack.quizzes.length === 0) return null;
  return { type: 'study-quiz', itemKeys: pack.quizzes.map((q) => q.key), passPct: STUDY_QUIZ_PASS_PCT };
}

/** the unit's LIVE study-quiz gates (retired gates are history: attempts keep pointing at them) */
const studyGates = (db: Db, unitId: number): LiveCheckRow[] => liveChecks(db, unitId, 'study-quiz');

export function loadStudyQuestsIntoDb(db: Db, store: SeedItemStore, clock: Clock): StudyQuestLoadStats {
  const packs = store.questPacks();
  return db.tx(() => {
    const rows = studyQuests(db);
    const stats: StudyQuestLoadStats = { tracks: [], packs: packs.size, unmatchedPacks: [], inserted: 0, updated: 0, replaced: [], removed: 0, orphaned: [] };
    const byTrack = new Map<TrackId, StudyQuestTrackStats>();
    const tstats = (track: TrackId) => {
      let s = byTrack.get(track);
      if (!s) {
        s = { track, built: 0, loaded: 0, pending: 0 };
        byTrack.set(track, s);
      }
      return s;
    };
    const matched = new Set<string>();
    const expected = new Map<number, CheckSpecInput>(); // unit id -> gate it must carry

    for (const q of rows) {
      const ts = tstats(q.track);
      const pack = packs.get(q.repo);
      const want = pack ? studyQuizSpecFor(pack) : null;
      const gates = studyGates(db, q.unitId);
      const other = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "check" WHERE unit_id = ? AND type <> 'study-quiz' AND ${LIVE_CHECK_SQL}`, q.unitId)!.n;
      if (other > 0) throw new StudyQuestLoadError(`study quest ${q.questKey}: its unit carries a non-study-quiz check; refusing`);
      if (gates.length > 1) throw new StudyQuestLoadError(`study quest ${q.questKey}: ${gates.length} live study-quiz checks on one unit; refusing`);

      if (!want) {
        // honest: no pack (or a pack without quiz items) -> no gate, content pending
        ts.pending++;
        const g = gates[0];
        if (g) {
          if (checkReferenced(db, g.id)) {
            stats.orphaned.push(q.questKey);
          } else {
            db.run('DELETE FROM "check" WHERE id = ?', g.id);
            stats.removed++;
          }
        }
        db.run('UPDATE quest SET content_pending = 1 WHERE id = ?', q.questId);
        continue;
      }

      matched.add(q.repo);
      ts.built++;
      if (q.unitKind !== 'study') throw new StudyQuestLoadError(`study quest ${q.questKey}: unit kind ${q.unitKind}, expected study`);
      if (!q.unitLive) throw new StudyQuestLoadError(`study quest ${q.questKey}: its unit is retired`);
      const g = gates[0];
      if (!g) {
        insertCheck(db, q.unitId, want, clock, { threshold: STUDY_QUIZ_PASS_PCT });
        stats.inserted++;
      } else {
        // re-seeded item keys: in place while unattempted; retire-and-replace once attempts reference it
        const r = reconcileCheck(db, q.unitId, g, { spec: want, threshold: STUDY_QUIZ_PASS_PCT }, clock);
        if (r.outcome === 'updated') stats.updated++;
        else if (r.outcome === 'replaced') stats.replaced.push(q.questKey);
      }
      db.run('INSERT OR IGNORE INTO unit_competency (unit_id, competency_id) VALUES (?, ?)', q.unitId, STUDY_COMPETENCY);
      db.run('UPDATE quest SET content_pending = 0 WHERE id = ?', q.questId);
      expected.set(q.unitId, want);
    }

    // ---- loaded === built, per track (re-read from the DB)
    for (const q of rows) {
      const want = expected.get(q.unitId);
      if (!want) continue;
      const g = studyGates(db, q.unitId);
      const pending = db.get<{ p: number }>('SELECT content_pending AS p FROM quest WHERE id = ?', q.questId)!.p;
      if (g.length === 1 && sameCheckSpec(g[0]!.spec, want) && g[0]!.threshold === STUDY_QUIZ_PASS_PCT && pending === 0) tstats(q.track).loaded++;
    }
    stats.tracks = [...byTrack.values()];
    const bad = stats.tracks.filter((s) => s.loaded !== s.built);
    if (bad.length) throw new StudyQuestLoadError(`study quests loaded !== built: ${bad.map((s) => `${s.track} ${s.loaded} vs ${s.built}`).join('; ')}`);
    stats.unmatchedPacks = [...packs.keys()].filter((r) => !matched.has(r)).sort();
    return stats;
  });
}
