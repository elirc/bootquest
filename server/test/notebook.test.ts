/**
 * rv2 S1 task 6 (PLAN F6 acceptance): the error notebook.
 *   - optional, never blocks: a failed submit answers the same with or without a note; nothing waits on one;
 *   - 0 XP for writing; no evidence; error_note is append-only (migration 024);
 *   - the entry becomes the concept card note:<id>, due the next day, whose FRONT is the learner's own line;
 *   - GET /notebook lists entries newest first with category counts; bad bodies are refused (400), nothing written.
 */
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorNoteResponse, NotebookResponse } from '@bootquest/shared/api-ext';
import { createApp } from '../src/api/app.ts';
import { DAY_MS, fixedClock, nowMs } from '../src/engines/clock.ts';
import { reconcileSeededReviewCards } from '../src/store/review-cards.ts';
import { emptySeedItemStore } from '../src/store/seed-items.ts';
import { localNoon, makeTempDb, makeUnit, submit, type TempDb } from './helpers.ts';

const n = (db: TempDb['db'], sql: string): number => db.get<{ n: number }>(sql)!.n;

describe('error notebook (F6)', () => {
  let tmp: TempDb;
  let app: Express;
  const clock = fixedClock(localNoon(2026, 11, 14));
  let unit = 0;
  beforeEach(() => {
    tmp = makeTempDb();
    clock.set(localNoon(2026, 11, 14));
    unit = makeUnit(tmp.db, clock, { kind: 'quiz', competencies: ['language-fluency'] });
    app = createApp({ db: tmp.db, clock });
  }, 60_000);
  afterEach(() => tmp.cleanup());

  it('one line + category becomes note:<id>, due tomorrow, front = the learner line; 0 XP, no evidence', async () => {
    const failed = submit(tmp.db, clock, unit, { pass: false });
    const xp0 = n(tmp.db, 'SELECT COUNT(*) AS n FROM xp_event');
    const ev0 = n(tmp.db, 'SELECT COUNT(*) AS n FROM evidence');
    const line = 'I compared with == and forgot typeof null is object';
    const r = await request(app).post('/api/notebook').send({ unitId: unit, attemptId: failed.id, line, category: 'concept-gap' });
    expect(r.status).toBe(200);
    const body = ErrorNoteResponse.parse(r.body);
    expect(body.note).toMatchObject({ unitId: unit, attemptId: failed.id, line, category: 'concept-gap', cardKey: `note:${body.note.id}` });
    expect(body.cardDueAt).toBe(nowMs(clock) + DAY_MS);
    expect(n(tmp.db, 'SELECT COUNT(*) AS n FROM xp_event')).toBe(xp0);
    expect(n(tmp.db, 'SELECT COUNT(*) AS n FROM evidence')).toBe(ev0);
    expect(tmp.db.get<{ kind: string; competency: string | null }>("SELECT kind, competency_id AS competency FROM review_item WHERE card_key LIKE 'note:%'")).toEqual({ kind: 'concept', competency: null });
    // not due today; tomorrow the card front is the learner's own line
    expect((await request(app).get('/api/reviews/queue')).body.count).toBe(0);
    clock.advance(DAY_MS);
    const q = await request(app).get('/api/reviews/queue');
    expect(q.body.items[0]).toMatchObject({ cardKey: `note:${body.note.id}`, kind: 'concept', card: { front: line } });
    // a restart never retires a note card
    expect(reconcileSeededReviewCards(tmp.db, emptySeedItemStore, clock).retired).toEqual([]);
    expect(() => tmp.db.run('DELETE FROM error_note')).toThrow(/append-only/);
  });

  it('never blocks and refuses bad bodies without writing; GET /notebook lists entries and category counts', async () => {
    // the next graded try does not wait on a note
    expect((await request(app).post(`/api/units/${unit}/submit`).send({ answer: 1 })).status).toBe(200);
    for (const bad of [
      { unitId: unit, line: 'x', category: 'slip' },
      { unitId: unit, line: 'a real line here', category: 'nope' },
      { unitId: unit, line: 'y'.repeat(201), category: 'slip' },
      { unitId: unit, line: 'a real line here', category: 'slip', xp: 5 },
      { unitId: 999_999, line: 'a real line here', category: 'slip' },
    ]) {
      expect((await request(app).post('/api/notebook').send(bad)).status).toBeGreaterThanOrEqual(400);
    }
    expect(n(tmp.db, 'SELECT COUNT(*) AS n FROM error_note')).toBe(0);
    await request(app).post('/api/notebook').send({ unitId: unit, line: 'misread the prompt: it asked for the index', category: 'misread' });
    clock.advance(1000);
    await request(app).post('/api/notebook').send({ unitId: unit, line: 'forgot the empty array case', category: 'edge-case' });
    clock.advance(1000);
    await request(app).post('/api/notebook').send({ unitId: unit, line: 'forgot the null case again', category: 'edge-case' });
    const nb = NotebookResponse.parse((await request(app).get('/api/notebook')).body);
    expect(nb.entries.map((e) => e.line)).toEqual(['forgot the null case again', 'forgot the empty array case', 'misread the prompt: it asked for the index']);
    expect(nb.categories).toEqual([
      { category: 'edge-case', count: 2 },
      { category: 'misread', count: 1 },
    ]);
  });
});
