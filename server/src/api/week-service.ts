import type { Router } from 'express';
import { EmptyQuery } from '@bootquest/shared/api';
import {
  WEEK_REFLECTION_QUESTIONS,
  WEEK_SESSION_GAP_MS,
  WEEK_SESSION_LEAD_MS,
  WeekQuery,
  WeekReflectionBody,
  WeekReflectionResponse,
  WeekResponse,
  type NoteCategory,
} from '@bootquest/shared/api-ext';
import type { UnitKind } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { READING_ATTEST_SQL, VERIFIED_PASS_SQL } from '../engines/attempts.ts';
import { addDays, dayKey, nowMs, type Clock } from '../engines/clock.ts';
import { KEYIDEA_PREFIX } from '../engines/keyideas.ts';
import { keyIdeas } from '../store/keyideas.ts';
import { asyncRoute, HttpError, sendJson, validate } from './http.ts';

/**
 * rv2 S3 (PLAN F7): the weekly review (GET /week, `bootquest week`) and its three-question reflection
 * (POST /week/reflection, week_reflection, migration 026). A week is Monday..Sunday in the owner's local days.
 * Every number is a plain count over the append-only ledgers, bounded by the week's local-midnight range:
 *   time      activity events (attempts, review grades, recap / re-check checkpoints, notebook entries, reflection
 *             saves) grouped into sittings (< WEEK_SESSION_GAP_MS apart); estMinutes = sum of (span + lead)
 *   passes    distinct units with a verified pass or reading attest (passedUnitIds' rule) whose passing attempt
 *             is in the week; firstTime = none before the week; selfScored = distinct explain-back / kata
 *             attempts with an evidence row filed in the week
 *   xp        SUM(xp_event.amount) on the week's day keys
 *   reviews   review_log rows in the week, and how many were rated again
 *   shaky     key-idea cards (keyidea:<section>/<id>) rated again >= 2 times in the week (PLAN §2.1)
 *   notebook  error_note rows in the week, top 3 categories
 * Read-only except the reflection save, which pays 0 XP and is not evidence.
 */

export interface WeekDeps {
  db: Db;
  clock: Clock;
}

/** Local midnight of a day key, epoch ms. */
function midnight(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** The Monday (local) of the week holding `key`. */
export function weekStart(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const dow = new Date(y, m - 1, d, 12).getDay(); // 0 = Sunday
  return addDays(key, -((dow + 6) % 7));
}

/** Sittings of a sorted list of event times: [first, last] per run of events < gap apart. */
export function sittings(times: readonly number[], gap = WEEK_SESSION_GAP_MS): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const t of times) {
    const last = out[out.length - 1];
    if (last && t - last.to < gap) last.to = t;
    else out.push({ from: t, to: t });
  }
  return out;
}

export const TIME_RULE = `estimated: activity events less than ${WEEK_SESSION_GAP_MS / 60_000} minutes apart are one sitting; each sitting counts its span plus ${WEEK_SESSION_LEAD_MS / 60_000} minutes`;

export function getWeek({ db, clock }: WeekDeps, q: { start?: string } = {}): WeekResponse {
  const today = dayKey(nowMs(clock));
  const start = weekStart(q.start ?? today);
  const end = addDays(start, 6);
  const from = midnight(start);
  const to = midnight(addDays(start, 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  // ---- time
  const times = db
    .all<{ t: number }>(
      `SELECT created_at AS t FROM attempt WHERE created_at >= ? AND created_at < ?
       UNION ALL SELECT reviewed_at FROM review_log WHERE reviewed_at >= ? AND reviewed_at < ?
       UNION ALL SELECT created_at FROM keyidea_checkpoint WHERE created_at >= ? AND created_at < ?
       UNION ALL SELECT created_at FROM error_note WHERE created_at >= ? AND created_at < ?
       UNION ALL SELECT created_at FROM week_reflection WHERE created_at >= ? AND created_at < ?
       ORDER BY 1`,
      ...[from, to, from, to, from, to, from, to, from, to],
    )
    .map((r) => r.t);
  const sits = sittings(times);
  const activeDays = new Set(times.map((t) => dayKey(t))).size;
  const estMinutes = Math.round(sits.reduce((s, x) => s + (x.to - x.from) + WEEK_SESSION_LEAD_MS, 0) / 60_000);

  // ---- passes (passedUnitIds' rule, restricted to the week)
  const PASS = `(${VERIFIED_PASS_SQL} OR ${READING_ATTEST_SQL})`;
  const passed = db.all<{ unitId: number; kind: UnitKind; before: number }>(
    `SELECT a.unit_id AS unitId, u.kind AS kind,
            EXISTS (SELECT 1 FROM attempt a2 WHERE a2.unit_id = a.unit_id AND a2.created_at < ? AND ${PASS.replace(/\ba\./g, 'a2.')}) AS before
       FROM attempt a JOIN unit u ON u.id = a.unit_id
      WHERE a.created_at >= ? AND a.created_at < ? AND ${PASS}
      GROUP BY a.unit_id`,
    from,
    from,
    to,
  );
  const byKind = new Map<UnitKind, number>();
  for (const p of passed) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
  const selfScored =
    db.get<{ n: number }>(
      `SELECT COUNT(DISTINCT attempt_id) AS n FROM evidence WHERE kind IN ('explain-back', 'kata') AND attempt_id IS NOT NULL AND created_at >= ? AND created_at < ?`,
      from,
      to,
    )?.n ?? 0;

  // ---- xp, reviews
  const xp = db.get<{ n: number }>(`SELECT COALESCE(SUM(amount), 0) AS n FROM xp_event WHERE day IN (${days.map(() => '?').join(', ')})`, ...days)?.n ?? 0;
  const reviews = db.get<{ graded: number; again: number }>(
    `SELECT COUNT(*) AS graded, COALESCE(SUM(rating = 'again'), 0) AS again FROM review_log WHERE reviewed_at >= ? AND reviewed_at < ?`,
    from,
    to,
  ) ?? { graded: 0, again: 0 };

  // ---- shaky key ideas: rated again >= 2 times this week
  const store = keyIdeas();
  const shakyIdeas = db
    .all<{ cardKey: string; again: number }>(
      `SELECT ri.card_key AS cardKey, COUNT(*) AS again FROM review_log rl JOIN review_item ri ON ri.id = rl.review_item_id
        WHERE ri.card_key LIKE ? AND rl.rating = 'again' AND rl.reviewed_at >= ? AND rl.reviewed_at < ?
        GROUP BY ri.card_key HAVING COUNT(*) >= 2 ORDER BY again DESC, ri.card_key`,
      `${KEYIDEA_PREFIX}%`,
      from,
      to,
    )
    .map((r) => {
      const rest = r.cardKey.slice(KEYIDEA_PREFIX.length);
      const slash = rest.indexOf('/');
      const section = slash === -1 ? rest : rest.slice(0, slash);
      const ideaId = slash === -1 ? '' : rest.slice(slash + 1);
      const idea = store.sections.get(section)?.ideas.find((i) => i.id === ideaId)?.idea ?? null;
      return { cardKey: r.cardKey, section, ideaId, idea, again: r.again };
    });

  // ---- notebook
  const cats = db.all<{ category: NoteCategory; count: number }>(
    `SELECT category, COUNT(*) AS count FROM error_note WHERE created_at >= ? AND created_at < ? GROUP BY category ORDER BY count DESC, category`,
    from,
    to,
  );
  const entries = cats.reduce((s, c) => s + c.count, 0);

  // ---- reflection (newest save for the week wins)
  const refl = db.get<{ answers: string; at: number }>(`SELECT answers, created_at AS at FROM week_reflection WHERE week_start = ? ORDER BY created_at DESC, id DESC LIMIT 1`, start);

  return {
    start,
    end,
    today,
    time: { activeDays, sittings: sits.length, estMinutes, rule: TIME_RULE },
    passes: {
      units: passed.length,
      firstTime: passed.filter((p) => !p.before).length,
      byKind: [...byKind.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([kind, units]) => ({ kind, units })),
      selfScored,
    },
    xp,
    reviews: { graded: reviews.graded, again: reviews.again },
    shakyIdeas,
    notebook: { entries, topCategories: cats.slice(0, 3) },
    reflection: {
      questions: [...WEEK_REFLECTION_QUESTIONS],
      answers: refl ? (JSON.parse(refl.answers) as unknown[]).map(String) : null,
      savedAt: refl?.at ?? null,
    },
  };
}

/** POST /week/reflection: saves the three answers for a week up to this one (a future week is refused). */
export function saveReflection({ db, clock }: WeekDeps, body: { start: string; answers: string[] }): WeekReflectionResponse {
  const t = nowMs(clock);
  const start = weekStart(body.start);
  if (start > weekStart(dayKey(t))) throw new HttpError(400, 'VALIDATION', `week ${start} has not started yet`, [{ path: 'body.start', message: 'a future week' }]);
  db.run('INSERT INTO week_reflection (week_start, answers, created_at) VALUES (?, ?, ?)', start, JSON.stringify(body.answers.map((a) => a.trim())), t);
  return { start, savedAt: t };
}

export function registerWeekRoutes(router: Router, deps: WeekDeps): void {
  router.get('/week', asyncRoute((req, res) => {
    const q = validate(WeekQuery, req.query, 'query');
    sendJson(res, 200, WeekResponse.parse(getWeek(deps, q)));
  }));
  router.post('/week/reflection', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    const body = validate(WeekReflectionBody, req.body, 'body');
    sendJson(res, 200, WeekReflectionResponse.parse(saveReflection(deps, body)));
  }));
}
