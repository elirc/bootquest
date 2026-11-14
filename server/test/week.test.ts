/**
 * rv2 S3 (PLAN F7): GET /week and POST /week/reflection on a seeded fixture. Every number on the page equals a
 * direct SQL count over the week's local-midnight range (Monday..Sunday), activity outside the week is ignored,
 * and the reflection save is 0 XP, append-only, newest-wins, never for a future week.
 */
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEEK_REFLECTION_QUESTIONS } from '@bootquest/shared/api-ext';
import { createApp } from '../src/api/app.ts';
import { sittings, weekStart } from '../src/api/week-service.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { addReviewItem } from '../src/engines/fsrs.ts';
import { makeKeyIdeas, setKeyIdeas } from '../src/store/keyideas.ts';
import { makeRouting, setRouting } from '../src/store/routing.ts';
import { localNoon, makeTempDb, makeUnit, submit, type TempDb } from './helpers.ts';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m, 0, 0).getTime(); // November 2026, local
const MON = at(9, 0);
const NEXT_MON = at(16, 0);
const n = (db: TempDb['db'], sql: string, ...p: (string | number)[]): number => db.get<{ n: number }>(sql, ...p)!.n;

describe('weekStart / sittings', () => {
  it('Monday of the week (Sunday belongs to the week before it); events < 15 min apart are one sitting', () => {
    expect(weekStart('2026-11-09')).toBe('2026-11-09'); // Monday
    expect(weekStart('2026-11-14')).toBe('2026-11-09'); // Saturday
    expect(weekStart('2026-11-15')).toBe('2026-11-09'); // Sunday
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
    expect(weekStart('2027-01-01')).toBe('2026-12-28'); // across a year
    const m = 60_000;
    expect(sittings([0, 5 * m, 19 * m, 40 * m])).toEqual([{ from: 0, to: 19 * m }, { from: 40 * m, to: 40 * m }]);
    expect(sittings([])).toEqual([]);
  });
});

describe('GET /week on a seeded fixture (F7)', () => {
  let tmp: TempDb;
  let app: Express;
  const clock = fixedClock(localNoon(2026, 11, 4));
  beforeEach(() => {
    tmp = makeTempDb();
    setRouting(makeRouting([]));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setKeyIdeas(
      makeKeyIdeas([
        {
          format: 'bootquest-keyideas@1',
          section: 'fx-week',
          title: 'Week fixture',
          track: 'js',
          scope: ['wk/'],
          ideas: ['k1', 'k2'].map((id) => ({ id, idea: `Idea ${id}.`, why: 'w', prompt: `Prompt ${id}?`, answer: `Answer ${id}.`, tags: ['t'], sources: ['wk/a'], siblings: [] })),
        },
      ]),
    );
    app = createApp({ db: tmp.db, clock });
  }, 60_000);
  afterEach(() => {
    tmp.cleanup();
    setKeyIdeas(null);
    setRouting(null);
    vi.restoreAllMocks();
  });

  const grade = async (itemId: number, g: string) => expect((await request(app).post(`/api/reviews/${itemId}/grade`).send({ grade: g })).status).toBe(200);
  const note = async (unitId: number, category: string) => expect((await request(app).post('/api/notebook').send({ unitId, line: 'a line in my words', category })).status).toBe(200);

  it('every number equals a direct SQL count over the week; outside activity is ignored; the reflection is newest-wins', async () => {
    const a = makeUnit(tmp.db, clock, { key: 'wk/a' });
    const b = makeUnit(tmp.db, clock, { key: 'wk/b' });
    const c = makeUnit(tmp.db, clock, { key: 'wk/c' });
    // last week: A passes for the first time, one note
    submit(tmp.db, clock, a);
    await note(a, 'misread');
    // this week, Tuesday: a sitting of three events (A again, B first time, C fails), then one an hour later
    clock.set(at(10, 10, 0));
    submit(tmp.db, clock, a);
    clock.set(at(10, 10, 5));
    submit(tmp.db, clock, b);
    clock.set(at(10, 10, 10));
    submit(tmp.db, clock, c, { pass: false });
    clock.set(at(10, 11, 30));
    await note(c, 'edge-case');
    // Wednesday: key-idea card k1 rated again, Thursday again (shaky); k2 again once; a plain card good
    clock.set(at(11, 12));
    const k1 = addReviewItem(tmp.db, { cardKey: 'keyidea:fx-week/k1', kind: 'concept', unitId: a, dueAt: at(11, 12) }, clock).id;
    const k2 = addReviewItem(tmp.db, { cardKey: 'keyidea:fx-week/k2', kind: 'concept', unitId: a, dueAt: at(11, 12) }, clock).id;
    const plain = addReviewItem(tmp.db, { cardKey: 'test:card-1', kind: 'card', unitId: a, dueAt: at(11, 12) }, clock).id;
    await grade(k1, 'again');
    await grade(k2, 'again');
    await grade(plain, 'good');
    clock.set(at(12, 20));
    await grade(k1, 'again');
    await note(b, 'edge-case');
    await note(b, 'slip');
    // next week: a pass and a note that must not count
    clock.set(at(17, 9));
    submit(tmp.db, clock, c);
    await note(c, 'other');
    clock.set(at(14, 18)); // Saturday of the week under review

    const w = (await request(app).get('/api/week')).body;
    expect(w).toMatchObject({ start: '2026-11-09', end: '2026-11-15', today: '2026-11-14' });

    // ---- direct SQL over [Monday 00:00, next Monday 00:00)
    const passUnits = n(
      tmp.db,
      `SELECT COUNT(DISTINCT a.unit_id) AS n FROM attempt a WHERE a.created_at >= ? AND a.created_at < ? AND a.outcome = 'pass'
         AND EXISTS (SELECT 1 FROM run r WHERE r.attempt_id = a.id AND r.kind = 'submit' AND r.verdict = 'pass')`,
      MON,
      NEXT_MON,
    );
    const xp = n(tmp.db, `SELECT COALESCE(SUM(amount), 0) AS n FROM xp_event WHERE day BETWEEN '2026-11-09' AND '2026-11-15'`);
    const graded = n(tmp.db, 'SELECT COUNT(*) AS n FROM review_log WHERE reviewed_at >= ? AND reviewed_at < ?', MON, NEXT_MON);
    const again = n(tmp.db, `SELECT COUNT(*) AS n FROM review_log WHERE rating = 'again' AND reviewed_at >= ? AND reviewed_at < ?`, MON, NEXT_MON);
    const notes = n(tmp.db, 'SELECT COUNT(*) AS n FROM error_note WHERE created_at >= ? AND created_at < ?', MON, NEXT_MON);
    const days = n(
      tmp.db,
      `SELECT COUNT(DISTINCT date(t / 1000, 'unixepoch', 'localtime')) AS n FROM (
         SELECT created_at AS t FROM attempt UNION ALL SELECT reviewed_at FROM review_log UNION ALL SELECT created_at FROM error_note) WHERE t >= ? AND t < ?`,
      MON,
      NEXT_MON,
    );

    expect(w.passes).toEqual({ units: passUnits, firstTime: 1, byKind: [{ kind: 'drill', units: passUnits }], selfScored: 0 });
    expect(passUnits).toBe(2);
    expect(w.xp).toBe(xp);
    expect(w.reviews).toEqual({ graded, again });
    expect([graded, again]).toEqual([4, 3]);
    expect(w.notebook.entries).toBe(notes);
    expect(w.notebook.topCategories).toEqual([{ category: 'edge-case', count: 2 }, { category: 'slip', count: 1 }]);
    expect(w.shakyIdeas).toEqual([{ cardKey: 'keyidea:fx-week/k1', section: 'fx-week', ideaId: 'k1', idea: 'Idea k1.', again: 2 }]);
    expect(w.time.activeDays).toBe(days);
    expect(days).toBe(3);
    // Tue 10:00-10:10 (3 attempts), Tue 11:30 (note), Wed 12:00 (3 grades), Thu 20:00 (grade + 2 notes)
    expect(w.time.sittings).toBe(4);
    expect(w.time.estMinutes).toBe(10 + 4 * 5);
    expect(w.reflection).toEqual({ questions: [...WEEK_REFLECTION_QUESTIONS], answers: null, savedAt: null });

    // ---- reflection: 0 XP, newest wins, history kept, not for a future week
    const xpBefore = n(tmp.db, 'SELECT COUNT(*) AS n FROM xp_event');
    expect((await request(app).post('/api/week/reflection').send({ start: '2026-11-12', answers: ['Keyset pagination.', '', ''] })).body).toMatchObject({ start: '2026-11-09' });
    clock.advance(60_000);
    expect((await request(app).post('/api/week/reflection').send({ start: '2026-11-09', answers: ['Keyset pagination with a tie-breaker.', 'Lost updates.', 'Read the plan first.'] })).status).toBe(200);
    expect((await request(app).post('/api/week/reflection').send({ start: '2026-11-16', answers: ['x', '', ''] })).status).toBe(400);
    expect((await request(app).post('/api/week/reflection').send({ start: '2026-11-09', answers: ['', ' ', ''] })).status).toBe(400);
    expect((await request(app).post('/api/week/reflection').send({ start: '2026-11-09', answers: ['only two', ''] })).status).toBe(400);
    expect(n(tmp.db, 'SELECT COUNT(*) AS n FROM xp_event')).toBe(xpBefore);
    expect(n(tmp.db, 'SELECT COUNT(*) AS n FROM week_reflection')).toBe(2);
    const after = (await request(app).get('/api/week?start=2026-11-15')).body;
    expect(after.reflection.answers).toEqual(['Keyset pagination with a tie-breaker.', 'Lost updates.', 'Read the plan first.']);
    expect(after.time.sittings).toBe(5); // the two saves on Saturday are one more sitting

    // ---- another week: last week has A's first pass and one note; nothing from this week
    const last = (await request(app).get('/api/week?start=2026-11-04')).body;
    expect(last).toMatchObject({ start: '2026-11-02', end: '2026-11-08', passes: { units: 1, firstTime: 1 }, notebook: { entries: 1 }, reviews: { graded: 0, again: 0 }, shakyIdeas: [] });
    expect((await request(app).get('/api/week?start=nope')).status).toBe(400);
  });
});
