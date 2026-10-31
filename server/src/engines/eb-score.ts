import { PROMOTION_MIN_COVERAGE } from '@bootquest/shared';
import { isWeightedSet, kpWeight } from '@bootquest/shared/eb-weight';
import type { Db } from '../db/database.ts';
import { HonestyRuleError } from './attempts.ts';
import { nowMs, type Clock } from './clock.ts';

/**
 * Explain-back scoring and the ONE pass predicate (ab wave, A5). Authored key points may carry a
 * `[w1]`/`[w2]`/`[w3]` prefix (derived at runtime by `kpWeight`; seed text is never rewritten).
 *  - WEIGHTED set (every key point of the set carries a prefix, `isWeightedSet`): the score of
 *    record is Σ weight(covered) / Σ weight(all), and the set passes only when that score reaches
 *    the floor AND no `[w3]` key point is marked missed.
 *  - LEGACY set (no prefix, or a mixed set): plain covered / total, exactly as before A5.
 * `evidence.score` stores the score of record; `eb_score_detail` (migration 018) stores how it was
 * computed, one row per explain-back evidence row. Evidence written before A5 has no detail row and
 * keeps its plain-coverage meaning (no w3 rule: `NOT EXISTS` is true).
 *
 * Every place that decides an explain-back pass uses `ebPasses` (TS) or `EB_PASS_SQL` (SQL):
 * the self-score / practice-score `passed`, promotion leg (b) (evidence.ts), the leg display
 * (ladder.ts) and the XP verification (xp.ts), so they cannot disagree.
 */

export interface EbKeyPoint {
  id: string;
  text: string;
}

export interface EbScore {
  covered: number;
  total: number;
  /** covered / total */
  plain: number;
  /** Σ weight(covered) / Σ weight(all) for a weighted set; equals `plain` otherwise */
  weighted: number;
  weightedSet: boolean;
  /** the score of record (`evidence.score`): weighted for a weighted set, plain otherwise */
  score: number;
  /** key point ids marked missed, in key order */
  missed: string[];
  /** the `[w3]` key point ids marked missed (always empty for a legacy set) */
  w3Missed: string[];
}

/** Score one self-assessment. `marks` must cover every key point (callers check with assertExactMarks). */
export function ebScore(keyPoints: readonly EbKeyPoint[], marks: Readonly<Record<string, 'covered' | 'missed'>>): EbScore {
  if (keyPoints.length === 0) throw new Error('an explain-back set has at least one key point');
  const weightedSet = isWeightedSet(keyPoints.map((k) => k.text));
  const missed = keyPoints.filter((k) => marks[k.id] === 'missed').map((k) => k.id);
  const total = keyPoints.length;
  const covered = total - missed.length;
  const plain = covered / total;
  let weighted = plain;
  let w3Missed: string[] = [];
  if (weightedSet) {
    let all = 0;
    let hit = 0;
    for (const k of keyPoints) {
      const w = kpWeight(k.text)!;
      all += w;
      if (marks[k.id] !== 'missed') hit += w;
    }
    weighted = hit / all;
    w3Missed = keyPoints.filter((k) => marks[k.id] === 'missed' && kpWeight(k.text) === 3).map((k) => k.id);
  }
  return { covered, total, plain, weighted, weightedSet, score: weightedSet ? weighted : plain, missed, w3Missed };
}

/**
 * THE explain-back pass predicate: the score of record reaches the mark (the promotion floor unless a
 * stricter unit mark is passed) and no `[w3]` key point was missed. A null score never passes.
 */
export function ebPasses(score: number | null, w3Missed: number, minCoverage: number = PROMOTION_MIN_COVERAGE): boolean {
  return (score ?? 0) >= Math.max(minCoverage, PROMOTION_MIN_COVERAGE) && w3Missed === 0;
}

/**
 * SQL form of `ebPasses` at the promotion floor, for an `evidence` row aliased `e` (the alias is
 * part of the contract). Pre-A5 evidence has no detail row, so only its score decides.
 */
export const EB_PASS_SQL = `(e.score >= ${PROMOTION_MIN_COVERAGE} AND NOT EXISTS (SELECT 1 FROM eb_score_detail d WHERE d.evidence_id = e.id AND d.w3_missed > 0))`;

/** One `eb_score_detail` row for an explain-back evidence row (append-only; written in the self-score tx). */
export function recordEbScoreDetail(db: Db, evidenceId: number, s: EbScore, now: Clock): void {
  const ev = db.get<{ kind: string; score: number | null }>('SELECT kind, score FROM evidence WHERE id = ?', evidenceId);
  if (!ev || ev.kind !== 'explain-back') throw new HonestyRuleError('MISMATCH', `evidence ${evidenceId} is not explain-back evidence`);
  if (ev.score !== s.score) throw new HonestyRuleError('MISMATCH', `evidence ${evidenceId} score ${ev.score} is not the computed score ${s.score}`);
  db.run(
    'INSERT INTO eb_score_detail (evidence_id, plain, weighted, w3_missed, missed_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    evidenceId,
    s.plain,
    s.weighted,
    s.w3Missed.length,
    JSON.stringify(s.missed),
    nowMs(now),
  );
}

/** Observation text of a self-score; a legacy set keeps the exact pre-A5 wording. */
export function ebObservation(s: EbScore): string {
  const pct = (x: number): number => Math.round(x * 1000) / 10;
  const head = `${s.covered}/${s.total} key points covered (${pct(s.plain)}%)`;
  const weighted = s.weightedSet ? `; weighted ${pct(s.weighted)}%` : '';
  const missed = s.missed.length ? `; missed ${s.missed.join(', ')}` : '';
  const w3 = s.w3Missed.length ? `; [w3] missed ${s.w3Missed.join(', ')}` : '';
  return `${head}${weighted}${missed}${w3}`;
}
