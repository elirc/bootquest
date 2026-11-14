import type { Router } from 'express';
import { EmptyQuery } from '@bootquest/shared/api';
import { ErrorNoteBody, ErrorNoteResponse, NotebookResponse, type ErrorNoteDto, type NoteCategory } from '@bootquest/shared/api-ext';
import type { z } from 'zod';
import type { Db } from '../db/database.ts';
import { DAY_MS, nowMs, type Clock } from '../engines/clock.ts';
import { addReviewItem } from '../engines/fsrs.ts';
import { NOTE_PREFIX } from '../engines/keyideas.ts';
import { asyncRoute, HttpError, sendJson, validate } from './http.ts';

/**
 * rv2 S1 (PLAN F6): the error notebook. After a failed submit or a missed key point the learner MAY write one
 * line in their own words and pick a category (POST /notebook). Optional and never blocking: nothing waits on
 * it, it pays 0 XP, and it is not evidence. The entry (error_note, migration 024, append-only) becomes the
 * concept card `note:<id>`, due the next day; its front is the learner's own line, its back the category and
 * the unit it came from. GET /notebook lists the entries (newest first) and the category counts.
 */

export interface NotebookDeps {
  db: Db;
  clock: Clock;
}

const CARD_LABEL: Readonly<Record<NoteCategory, string>> = {
  misread: 'Misread the question',
  'concept-gap': 'Concept gap',
  'edge-case': 'Missed an edge case',
  'api-or-syntax': 'API or syntax',
  slip: 'Careless slip',
  other: 'Other',
};

interface NoteRow {
  id: number;
  unitId: number;
  unitTitle: string;
  attemptId: number | null;
  line: string;
  category: NoteCategory;
  createdAt: number;
}

const NOTE_SELECT = `SELECT n.id, n.unit_id AS unitId, u.title AS unitTitle, n.attempt_id AS attemptId, n.line, n.category, n.created_at AS createdAt
  FROM error_note n JOIN unit u ON u.id = n.unit_id`;

const dto = (r: NoteRow): ErrorNoteDto => ({ ...r, cardKey: `${NOTE_PREFIX}${r.id}` });

/** A note card's text (front = the learner's own line), or undefined when the note is not found. */
export function noteCardText(db: Db, cardKey: string): { front: string; back: string; source: string | null } | undefined {
  const id = Number(cardKey.slice(NOTE_PREFIX.length));
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const r = db.get<NoteRow>(`${NOTE_SELECT} WHERE n.id = ?`, id);
  if (!r) return undefined;
  return { front: r.line, back: `${CARD_LABEL[r.category]} · from ${r.unitTitle}\n\nSay what you would do differently now, then grade how well you recalled it.`, source: `Your notebook · ${new Date(r.createdAt).toISOString().slice(0, 10)}` };
}

export function addNote(deps: NotebookDeps, body: z.infer<typeof ErrorNoteBody>): ErrorNoteResponse {
  const { db, clock } = deps;
  if (!db.get('SELECT 1 AS x FROM unit WHERE id = ?', body.unitId)) throw new HttpError(404, 'NOT_FOUND', `unit ${body.unitId} not found`);
  if (body.attemptId !== undefined && !db.get('SELECT 1 AS x FROM attempt WHERE id = ? AND unit_id = ?', body.attemptId, body.unitId)) {
    throw new HttpError(400, 'VALIDATION', `attempt ${body.attemptId} is not on unit ${body.unitId}`, [{ path: 'body.attemptId', message: 'not an attempt of this unit' }]);
  }
  const t = nowMs(clock);
  return db.tx(() => {
    const id = db.run('INSERT INTO error_note (unit_id, attempt_id, line, category, created_at) VALUES (?, ?, ?, ?, ?)', body.unitId, body.attemptId ?? null, body.line.trim(), body.category, t).lastInsertRowid;
    const card = addReviewItem(db, { cardKey: `${NOTE_PREFIX}${id}`, kind: 'concept', unitId: body.unitId, dueAt: t + DAY_MS }, clock);
    return { note: dto(db.get<NoteRow>(`${NOTE_SELECT} WHERE n.id = ?`, id)!), cardDueAt: card.due_at };
  });
}

export function getNotebook(deps: NotebookDeps): NotebookResponse {
  const entries = deps.db.all<NoteRow>(`${NOTE_SELECT} ORDER BY n.created_at DESC, n.id DESC`).map(dto);
  const counts = new Map<NoteCategory, number>();
  for (const e of entries) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  return { entries, categories: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([category, count]) => ({ category, count })) };
}

export function registerNotebookRoutes(router: Router, deps: NotebookDeps): void {
  router.get('/notebook', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, NotebookResponse.parse(getNotebook(deps)));
  }));
  router.post('/notebook', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    const body = validate(ErrorNoteBody, req.body, 'body');
    sendJson(res, 200, ErrorNoteResponse.parse(addNote(deps, body)));
  }));
}
