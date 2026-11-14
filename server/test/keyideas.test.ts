/**
 * rv2 S1 task 2 (PLAN F1 acceptance + ruling 6): key-concept cards.
 *   - passing the source of a single-source idea enrols exactly ONE card keyidea:<section>/<id>, kind 'concept',
 *     due +1 day; a multi-source idea waits for its last source (every source passed = met);
 *   - at most 4 new key-idea cards become due per local day (the rest +2, +3 ... days);
 *   - a removed idea retires its card (startup reconcile), a returning one restores it; a retired card is not served
 *     and grading it is refused (409, never a 500);
 *   - cards and their grades write no evidence row and no practice_log row, and never lock a graded try (ruling 6);
 *   - an unknown key warns once and the server serves; no content/keyideas/ = no ideas, every route still answers;
 *   - GET /keyideas omits prompt / answer / why until the idea is met (API response, not only the UI).
 */
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyIdeasResponse } from '@bootquest/shared/api-ext';
import { createApp } from '../src/api/app.ts';
import { DAY_MS, dayKey, fixedClock, nowMs } from '../src/engines/clock.ts';
import { syncKeyIdeaCards } from '../src/engines/keyideas.ts';
import { lastPracticeAt } from '../src/api/practice-service.ts';
import { makeKeyIdeas, readKeyIdeas, setKeyIdeas } from '../src/store/keyideas.ts';
import { makeRouting, setRouting } from '../src/store/routing.ts';
import { reconcileSeededReviewCards } from '../src/store/review-cards.ts';
import { emptySeedItemStore } from '../src/store/seed-items.ts';
import { localNoon, makeTempDb, makeUnit, submit, type TempDb } from './helpers.ts';

const FIX = join(import.meta.dirname, 'fixtures', 'keyideas');
const CONTENT = join(FIX, 'content');
const EMPTY = join(FIX, 'empty');

const count = (db: TempDb['db'], sql: string, ...p: (string | number)[]): number => db.get<{ n: number }>(sql, ...p)!.n;
const keyideaCards = (db: TempDb['db']) =>
  db.all<{ key: string; due: number; kind: string; unit: number | null; competency: string | null }>(
    "SELECT card_key AS key, due_at AS due, kind, unit_id AS unit, competency_id AS competency FROM review_item WHERE card_key LIKE 'keyidea:%' ORDER BY id",
  );

describe('key-concept cards (F1)', () => {
  let tmp: TempDb;
  let app: Express;
  const clock = fixedClock(localNoon(2026, 11, 14));
  const ids: Record<string, number> = {};
  beforeEach(() => {
    tmp = makeTempDb();
    clock.set(localNoon(2026, 11, 14));
    setRouting(makeRouting(['kx/arch/']));
    setKeyIdeas(readKeyIdeas(CONTENT));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const k of ['kx/a/01', 'kx/a/02', 'kx/b/01', 'kx/b/02', 'kx/b/03', 'kx/arch/01']) ids[k] = makeUnit(tmp.db, clock, { key: k, kind: 'quiz', competencies: ['language-fluency'] });
    for (const k of ['kx/a/drill-1', 'kx/a/drill-2', 'kx/a/drill-3']) ids[k] = makeUnit(tmp.db, clock, { key: k, competencies: ['language-fluency'] });
    app = createApp({ db: tmp.db, clock });
  }, 60_000);
  /** the served index of a fixture quiz choice (choices are served in a stable per-unit permutation) */
  const served = async (unitId: number, text: string): Promise<number> => ((await request(app).get(`/api/units/${unitId}`)).body.check.spec.choices as string[]).indexOf(text);
  afterEach(() => {
    tmp.cleanup();
    setKeyIdeas(null);
    setRouting(null);
    vi.restoreAllMocks();
  });

  it('passing a single-source idea\'s source enrols exactly one concept card, due +1 day; a multi-source idea waits for its last source', async () => {
    const t0 = nowMs(clock);
    submit(tmp.db, clock, ids['kx/a/01']!);
    syncKeyIdeaCards(tmp.db, clock);
    syncKeyIdeaCards(tmp.db, clock); // idempotent
    expect(keyideaCards(tmp.db)).toEqual([{ key: 'keyidea:fx-alpha/idempotent-write', due: t0 + DAY_MS, kind: 'concept', unit: ids['kx/a/01'], competency: null }]);
    // the API path: a passing submit enrols through the route hook
    const s = await request(app).post(`/api/units/${ids['kx/a/02']}/submit`).send({ answer: await served(ids['kx/a/02']!, 'a') });
    expect(s.body.verdict).toBe('pass');
    expect(keyideaCards(tmp.db).map((c) => c.key)).toEqual(['keyidea:fx-alpha/idempotent-write', 'keyidea:fx-alpha/keyset-pagination']);
    // a failed submit enrols nothing
    expect((await request(app).post(`/api/units/${ids['kx/b/01']}/submit`).send({ answer: await served(ids['kx/b/01']!, 'b') })).body.verdict).toBe('fail');
    expect(keyideaCards(tmp.db)).toHaveLength(2);
    // archived-only and unknown-only ideas are never met
    for (const k of ['kx/arch/01']) submit(tmp.db, clock, ids[k]!);
    syncKeyIdeaCards(tmp.db, clock);
    expect(keyideaCards(tmp.db).some((c) => /archived-only|unknown-only/.test(c.key))).toBe(false);
  });

  it('at most 4 new key-idea cards become due per local day (flood: 10 passes in one day)', () => {
    const file = {
      format: 'bootquest-keyideas@1',
      section: 'fx-flood',
      title: 'Flood',
      track: 'js',
      scope: ['kx/c/'],
      ideas: Array.from({ length: 10 }, (_, n) => ({ id: `idea-${n + 1}`, idea: 'i', why: 'w', prompt: 'p?', answer: 'a', tags: ['t'], sources: [`kx/c/${n + 1}`], siblings: [] })),
    };
    setKeyIdeas(makeKeyIdeas([file]));
    for (let n = 1; n <= 10; n++) submit(tmp.db, clock, makeUnit(tmp.db, clock, { key: `kx/c/${n}`, kind: 'quiz' }));
    syncKeyIdeaCards(tmp.db, clock);
    const perDay = new Map<string, number>();
    for (const c of keyideaCards(tmp.db)) perDay.set(dayKey(c.due), (perDay.get(dayKey(c.due)) ?? 0) + 1);
    expect([...perDay.entries()]).toEqual([
      ['2026-11-15', 4],
      ['2026-11-16', 4],
      ['2026-11-17', 2],
    ]);
  });

  it('a removed idea retires its card at startup; it returns restored; a retired card is neither served nor gradeable', async () => {
    submit(tmp.db, clock, ids['kx/a/01']!);
    syncKeyIdeaCards(tmp.db, clock);
    const id = tmp.db.get<{ id: number }>("SELECT id FROM review_item WHERE card_key = 'keyidea:fx-alpha/idempotent-write'")!.id;
    const full = readKeyIdeas(CONTENT);
    const alpha = full.sections.get('fx-alpha')!;
    setKeyIdeas(makeKeyIdeas([{ ...alpha, ideas: alpha.ideas.filter((i) => i.id !== 'idempotent-write') }, full.sections.get('fx-beta')!]));
    const r1 = reconcileSeededReviewCards(tmp.db, emptySeedItemStore, clock);
    expect(r1.retired).toEqual(['keyidea:fx-alpha/idempotent-write']);
    clock.advance(DAY_MS + 1);
    expect((await request(app).get('/api/reviews/queue')).body.count).toBe(0);
    const g = await request(app).post(`/api/reviews/${id}/grade`).send({ grade: 'good' });
    // refused like every retired card (store/queries.ts reviewItemExists): nothing written
    expect(g.status).toBe(404);
    expect(count(tmp.db, 'SELECT COUNT(*) AS n FROM review_log')).toBe(0);
    setKeyIdeas(full);
    expect(reconcileSeededReviewCards(tmp.db, emptySeedItemStore, clock).restored).toEqual(['keyidea:fx-alpha/idempotent-write']);
    const q = await request(app).get('/api/reviews/queue');
    expect(q.body.count).toBe(1);
    expect(q.body.items[0].card.front).toBe(alpha.ideas[0]!.prompt);
    expect(q.body.items[0].card.back).toContain(alpha.ideas[0]!.answer);
  });

  it('ruling 6 + honesty: enrolment and grading write no evidence row, no practice_log row and never lock a graded try', async () => {
    submit(tmp.db, clock, ids['kx/a/01']!);
    const ev0 = count(tmp.db, 'SELECT COUNT(*) AS n FROM evidence');
    syncKeyIdeaCards(tmp.db, clock);
    clock.advance(DAY_MS + 1);
    const q = await request(app).get('/api/reviews/queue');
    const card = q.body.items.find((i: { cardKey: string }) => i.cardKey.startsWith('keyidea:'));
    for (const grade of ['again', 'again', 'good']) await request(app).post(`/api/reviews/${card.id}/grade`).send({ grade });
    expect(count(tmp.db, 'SELECT COUNT(*) AS n FROM evidence')).toBe(ev0);
    expect(count(tmp.db, 'SELECT COUNT(*) AS n FROM practice_log')).toBe(0);
    // review XP once per card per day (B): three grades, one paid
    expect(count(tmp.db, "SELECT COALESCE(SUM(amount), 0) AS n FROM xp_event WHERE kind = 'review'")).toBe(1);
    for (const k of Object.keys(ids)) expect(lastPracticeAt(tmp.db, ids[k]!)).toBeNull();
    // a graded try of the source and of an unpassed unit is open (no practice lock)
    for (const u of [ids['kx/a/01']!, ids['kx/b/02']!]) {
      const gs = await request(app).get(`/api/units/${u}/gate-status`);
      expect(gs.body.reason).not.toBe('practice');
      expect((await request(app).post(`/api/units/${u}/submit`).send({ answer: await served(u, 'a') })).status).toBe(200);
    }
  });

  it('GET /keyideas: prompt, answer and why are absent from the response until every source is passed', async () => {
    submit(tmp.db, clock, ids['kx/a/01']!);
    const r = await request(app).get('/api/keyideas');
    expect(r.status).toBe(200);
    const body = KeyIdeasResponse.parse(r.body);
    const alpha = body.sections.find((s) => s.section === 'fx-alpha')!;
    const met = alpha.ideas.find((i) => i.id === 'idempotent-write')!;
    const waiting = alpha.ideas.find((i) => i.id === 'keyset-pagination')!;
    expect(met.answer).toBeDefined();
    expect(met.status).toBe('shaky');
    expect(waiting).toMatchObject({ status: 'not-met' });
    expect('answer' in waiting || 'prompt' in waiting || 'why' in waiting).toBe(false);
    const src = readKeyIdeas(CONTENT).sections.get('fx-alpha')!.ideas.find((i) => i.id === 'keyset-pagination')!;
    expect(r.text).not.toContain(src.answer);
    expect(r.text).not.toContain(src.prompt);
    expect(body.tiles.find((t) => t.track === 'js')).toEqual({ track: 'js', owned: 0, shaky: 1, notMet: 4 });
    expect(body.tiles.find((t) => t.track === 'sysdesign')).toEqual({ track: 'sysdesign', owned: 0, shaky: 0, notMet: 3 });
    // ?unit= narrows the sections to those that contain the unit
    expect(((await request(app).get('/api/keyideas').query({ unit: 'kx/b/02' })).body as KeyIdeasResponse).sections.map((s) => s.section)).toEqual(['fx-beta']);
  });

  it('an unknown key warns once and the routes answer; no content/keyideas/ = no ideas, nothing breaks', async () => {
    const warn = vi.mocked(console.warn);
    warn.mockClear();
    await request(app).get('/api/keyideas');
    await request(app).get('/api/keyideas');
    const unknown = warn.mock.calls.filter((c) => String(c[0]).includes('kx/does-not-exist'));
    expect(unknown).toHaveLength(1);
    setKeyIdeas(readKeyIdeas(EMPTY));
    const r = await request(app).get('/api/keyideas');
    expect(r.body).toEqual({ sections: [], tiles: [], recapsOpen: [], dueCards: 0 });
    expect((await request(app).get('/api/keyideas/queue')).body).toEqual({ count: 0, items: [], tags: [] });
    expect((await request(app).get('/api/reviews/queue')).status).toBe(200);
    expect((await request(app).get('/api/dashboard')).status).toBe(200);
  });
});
