import type { SeedExplainBackItem } from '@bootquest/shared';
import type { AltSetDueDto, DueResponse } from '@bootquest/shared/api-ext';
import { questUnitUnlocked } from '../engines/campaign.ts';
import { openRetests } from '../engines/ladder.ts';
import { ebSetGroup, explainBackUnitKey } from '../store/ladder.ts';
import { getTrack, getUnitByKey, primaryCheck } from '../store/queries.ts';
import { explainBackPublicFor, type LadderDeps } from './ladder-service.ts';

/**
 * ab wave S3: GET /due, what is due beyond the review queue. READ-ONLY.
 *   retests   the open changed-example retests, exactly as GET /competencies lists them.
 *   altSets   alternate explain-back sets whose rotation gate has OPENED: a sibling of the group
 *             (same seed provenance repo + path) was answered fresh, the >= 2-day gap since the
 *             newest such answer has elapsed, and this set is still unanswered. Every predicate
 *             is the unit detail's own (explainBackPublicFor: the gate POST .../answers enforces,
 *             `answered`, `artifactRequired`), so this list never names a set that would refuse.
 *             A group nobody answered yet lists nothing (its primary set is ordinary work).
 *   nextAltSetAt  the earliest opening among touched groups still inside their gap.
 */

/** Question-set keys with at least one FRESH (non-practice) answer: the only groups whose gate can have moved. */
function freshlyAnsweredKeys(deps: LadderDeps): Set<string> {
  return new Set(
    deps.db
      .all<{ k: string }>(
        `SELECT DISTINCT json_extract(answer, '$.explainBack.questionSetKey') AS k FROM attempt
          WHERE outcome = 'submitted' AND json_extract(answer, '$.explainBack.questionSetKey') IS NOT NULL
            AND json_extract(answer, '$.explainBack.practice') IS NULL`,
      )
      .map((r) => r.k),
  );
}

function altSetsDue(deps: LadderDeps): { altSets: AltSetDueDto[]; nextAltSetAt: number | null } {
  const { db, seedItems, clock } = deps;
  const answered = freshlyAnsweredKeys(deps);
  const groups = new Map<string, SeedExplainBackItem[]>();
  for (const it of seedItems.explainBackItems()) {
    const g = ebSetGroup(it);
    groups.set(g, [...(groups.get(g) ?? []), it]);
  }
  const altSets: AltSetDueDto[] = [];
  let nextAltSetAt: number | null = null;
  for (const [group, sibs] of groups) {
    if (sibs.length < 2 || !sibs.some((s) => answered.has(s.key))) continue;
    for (const s of sibs) {
      const unit = getUnitByKey(db, explainBackUnitKey(s));
      const check = unit ? primaryCheck(db, unit.id) : undefined;
      if (!unit || !check) continue;
      if (getTrack(db, unit.trackId)?.locked || questUnitUnlocked(db, unit.id) === false) continue;
      const pub = explainBackPublicFor(seedItems, check.spec, db, unit.id, clock);
      if (!pub || !('answered' in pub) || pub.answered) continue;
      if ('artifactRequired' in pub && pub.artifactRequired.length > 0) continue;
      const gate = 'altSets' in pub ? pub.altSets?.gate : undefined;
      if (!gate || gate.opensAt === null) continue;
      if (gate.open) altSets.push({ unitId: unit.id, title: unit.title, label: pub.altSets!.label, group, openedAt: gate.opensAt });
      else nextAltSetAt = nextAltSetAt === null ? gate.opensAt : Math.min(nextAltSetAt, gate.opensAt);
    }
  }
  altSets.sort((a, b) => a.openedAt - b.openedAt || a.unitId - b.unitId);
  return { altSets, nextAltSetAt };
}

/** GET /due */
export function getDue(deps: LadderDeps): DueResponse {
  const retests = openRetests(deps.db, deps.clock).map((r) => ({
    reviewItemId: r.reviewItemId,
    unitId: r.unitId,
    title: r.title,
    dueAt: r.dueAt,
    artifactUnitId: r.artifactUnitId,
    due: r.due,
  }));
  return { retests, ...altSetsDue(deps) };
}
