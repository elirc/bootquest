import { CHECK_TYPES, TRACK_IDS, type CheckType, type TrackId } from '@bootquest/shared';
import {
  REVIEW_FORECAST_DAYS,
  REVIEW_RETENTION_WINDOW_DAYS,
  XP_STATS_DAYS,
  type CampaignProgressResponse,
  type PassRatesResponse,
  type ReviewStatsResponse,
  type TrackProgress,
  type XpStatsResponse,
} from '@bootquest/shared/api';
import type { Db } from '../db/database.ts';
import { VERIFIED_PASS_SQL } from '../engines/attempts.ts';
import { campaignState, type ActState } from '../engines/campaign.ts';
import { addDays, dayKey, nowMs, type Clock } from '../engines/clock.ts';
import {
  dailyBuckets,
  forecastBuckets,
  passRate,
  passRatesBy,
  retention,
  trackProgress,
  weeklyBuckets,
  type GradedAttemptRow,
  type XpDayRow,
} from '../engines/stats.ts';
import { listTracks, passedUnitIds, unitsForTrack, type TrackRecord } from '../store/queries.ts';

/**
 * Campaign 2 B2: read-only stats over the append-only ledgers. Nothing here writes;
 * every bucket rule lives in engines/stats.ts (pure, unit-tested).
 */
export interface StatsDeps {
  db: Db;
  clock: Clock;
}

const today = (clock: Clock) => dayKey(nowMs(clock));

// ---------------------------------------------------------------- XP over time

export function xpStats({ db, clock }: StatsDeps): XpStatsResponse {
  const t = today(clock);
  const rows = db.all<XpDayRow>(
    // zero-amount ledger rows (revealed / daily cap / already awarded) earn nothing: a day+track whose
    // rows sum to 0 is not "XP", so it neither appears as a bucket row nor starts the all-time weeks
    `SELECT day, track_id AS trackId, SUM(amount) AS xp FROM xp_event GROUP BY day, track_id HAVING SUM(amount) <> 0 ORDER BY day`,
  );
  // events = ledger rows that EARNED XP (amount > 0); zero-amount rows are not counted
  const events = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM xp_event WHERE amount > 0`)?.n ?? 0;
  const days = dailyBuckets(rows, t, XP_STATS_DAYS);
  return {
    today: t,
    days,
    weeks: weeklyBuckets(rows, t),
    totals: {
      allTime: rows.reduce((s, r) => s + r.xp, 0),
      lastDays: days.reduce((s, d) => s + d.total, 0),
      events,
    },
  };
}

// ---------------------------------------------------------------- pass rates

export function passRates({ db }: StatsDeps): PassRatesResponse {
  const rows = db
    .all<Omit<GradedAttemptRow, 'verified'> & { verified: number | boolean }>(
      `SELECT a.id, a.unit_id AS unitId, u.track_id AS trackId, c.type AS checkType, a.mode, a.created_at AS createdAt,
              ${VERIFIED_PASS_SQL} AS verified
         FROM attempt a
         JOIN unit u ON u.id = a.unit_id
         JOIN "check" c ON c.id = a.check_id
        WHERE EXISTS (SELECT 1 FROM run r WHERE r.attempt_id = a.id AND r.kind = 'submit')
        ORDER BY a.created_at, a.id`,
    )
    .map((r) => ({ ...r, verified: r.verified === true || r.verified === 1 }));
  const strip = <T extends { key: string }>({ key: _key, ...rest }: T) => rest;
  return {
    overall: passRate(rows),
    byTrack: passRatesBy<TrackId>(rows, (r) => r.trackId, TRACK_IDS).map((g) => ({ trackId: g.key, ...strip(g) })),
    byCheckType: passRatesBy<CheckType>(rows, (r) => r.checkType, CHECK_TYPES).map((g) => ({ checkType: g.key, ...strip(g) })),
  };
}

// ---------------------------------------------------------------- reviews

export function reviewStats({ db, clock }: StatsDeps): ReviewStatsResponse {
  const now = nowMs(clock);
  const t = dayKey(now);
  const dueAts = db.all<{ dueAt: number }>(`SELECT due_at AS dueAt FROM review_item WHERE kind <> 'retest'`).map((r) => r.dueAt);
  const logs = db.all<{ rating: string; day: number }>(
    `SELECT l.rating, l.reviewed_at AS day FROM review_log l JOIN review_item i ON i.id = l.review_item_id WHERE i.kind <> 'retest'`,
  );
  const windowStart = addDays(t, -(REVIEW_RETENTION_WINDOW_DAYS - 1));
  const inWindow = logs.filter((l) => {
    const k = dayKey(l.day);
    return k >= windowStart && k <= t;
  });
  const { forecast, overdue, later } = forecastBuckets(dueAts, t, REVIEW_FORECAST_DAYS);
  const count = (r: string) => logs.filter((l) => l.rating === r).length;
  return {
    today: t,
    cards: dueAts.length,
    dueNow: dueAts.filter((d) => d <= now).length,
    overdue,
    later,
    forecast,
    retention: { window: retention(inWindow.map((l) => l.rating)), allTime: retention(logs.map((l) => l.rating)) },
    ratings: { again: count('again'), hard: count('hard'), good: count('good'), easy: count('easy') },
  };
}

// ---------------------------------------------------------------- track progress (shared with GET /tracks)

/** Per-track summed campaign core counts from the derived campaign state. */
export function coreCountsByTrack(acts: readonly ActState[]): Map<string, { coreDone: number; coreTotal: number }> {
  const out = new Map<string, { coreDone: number; coreTotal: number }>();
  for (const a of acts) {
    const c = out.get(a.trackId) ?? { coreDone: 0, coreTotal: 0 };
    c.coreDone += a.coreDone;
    c.coreTotal += a.coreTotal;
    out.set(a.trackId, c);
  }
  return out;
}

/**
 * The practice counts + the shared TrackProgress for one track (GET /tracks, GET /tracks/:id/units and
 * GET /stats/campaign all go through here, so the sidebar, the campaign page and the stats page agree).
 */
export function trackCounts(
  db: Db,
  t: TrackRecord,
  passed: ReadonlySet<number>,
  core: ReadonlyMap<string, { coreDone: number; coreTotal: number }>,
): { unitCount: number; doneCount: number; progress: TrackProgress } {
  const units = unitsForTrack(db, t.id);
  const doneCount = t.locked ? 0 : units.filter((u) => passed.has(u.id)).length;
  const c = core.get(t.id) ?? { coreDone: 0, coreTotal: 0 };
  return {
    unitCount: units.length,
    doneCount,
    progress: trackProgress({ locked: t.locked, coreDone: c.coreDone, coreTotal: c.coreTotal, practiceDone: doneCount, practiceTotal: units.length }),
  };
}

export function campaignProgress({ db }: StatsDeps): CampaignProgressResponse {
  const acts = campaignState(db);
  const core = coreCountsByTrack(acts);
  const passed = passedUnitIds(db);
  return {
    tracks: listTracks(db).map((t) => ({
      trackId: t.id,
      name: t.name,
      locked: t.locked,
      progress: trackCounts(db, t, passed, core).progress,
      acts: acts
        .filter((a) => a.trackId === t.id)
        .map((a) => {
          const reading = a.quests.filter((q) => q.kind === 'reading');
          return {
            actNo: a.actNo,
            title: a.title,
            unlocked: a.unlocked,
            coreDone: a.coreDone,
            coreTotal: a.coreTotal,
            corePending: a.quests.filter((q) => q.core && q.contentPending && !q.done).length,
            readingDone: reading.filter((q) => q.done).length,
            readingTotal: reading.length,
          };
        }),
    })),
  };
}
