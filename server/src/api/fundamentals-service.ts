import type { UnitSummary } from '@bootquest/shared/api';
import type { FundamentalsResponseExt as FundamentalsResponse } from '@bootquest/shared/api-ext';
import { FUND_PASS_PCT, fundTopicUnitKey, type FundTrack } from '@bootquest/shared/fundamentals';
import { getTrack, passedUnitIds, prerequisiteMap, revealedUnitIds, unitsForTrack, type UnitRecord } from '../store/queries.ts';
import { HttpError } from './http.ts';
import { lockStateFor, type ServiceDeps } from './service.ts';

/**
 * fund wave: GET /tracks/:id/fundamentals — the track's Fundamentals ladder in ladder order (topic
 * metadata from the loaded topics.json; unit states from the DB, the same lock rule as every unit
 * listing: track lock, then pass, then prerequisites). Serves only public fields: never a lesson, a
 * question or a key (those arrive through the unit's own detail / study-quiz flow). A topic whose unit
 * is not live on this server is omitted; a drill that is not live (quarantined) is absent. f52 C3: a topic
 * may carry `related` ("More practice": live drills of the same track listed in related.json).
 */
export function getFundamentals(deps: ServiceDeps, trackId: string): FundamentalsResponse {
  const { db } = deps;
  const track = getTrack(db, trackId);
  if (!track) throw new HttpError(404, 'NOT_FOUND', `track ${trackId} not found`);
  const topics = deps.seedItems.fund?.topics(track.id) ?? [];
  if (topics.length === 0) return { trackId: track.id, topics: [] };
  const passed = passedUnitIds(db);
  const revealed = revealedUnitIds(db);
  const prereqs = prerequisiteMap(db);
  const byKey = new Map<string, UnitRecord>(unitsForTrack(db, track.id).map((u) => [u.key, u]));
  const summary = (u: UnitRecord): UnitSummary => ({
    id: u.id,
    key: u.key,
    trackId: u.trackId,
    kind: u.kind,
    title: u.title,
    difficulty: u.difficulty,
    state: lockStateFor(u, track.locked, passed, prereqs),
    revealed: revealed.has(u.id),
    prerequisites: prereqs.get(u.id) ?? [],
  });
  const fund = deps.seedItems.fund;
  const relatedOf = (topicId: string): { related?: UnitSummary[] } => {
    const units = (fund?.related(track.id, topicId) ?? []).flatMap((k) => {
      const d = byKey.get(k);
      return d && d.kind === 'drill' ? [summary(d)] : [];
    });
    return units.length ? { related: units } : {};
  };
  const out: FundamentalsResponse['topics'] = [];
  for (const t of topics) {
    const unit = byKey.get(fundTopicUnitKey(track.id as FundTrack, t.id));
    if (!unit) continue;
    out.push({
      id: t.id,
      order: t.order,
      title: t.title,
      level: t.level,
      summary: t.summary,
      quizQuestions: t.quiz.length,
      passPct: Math.round(FUND_PASS_PCT * 100),
      flashcards: t.flashcards.length,
      unit: summary(unit),
      drills: t.drillKeys.flatMap((k) => {
        const d = byKey.get(k);
        return d ? [summary(d)] : [];
      }),
      // f52 C3: "More practice" = existing drills of this track's other banks (related.json); a key that is
      // not a live drill of this track is skipped (serve.ts warns at startup)
      ...relatedOf(t.id),
    });
  }
  return { trackId: track.id, topics: out };
}
