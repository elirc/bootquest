/**
 * rv2 S1 task 4 (PLAN §2.1 items 2-3, F1): the end-of-section recap and the spaced re-check.
 *   - the recap opens when recapAfter of the section's live scope units are passed (fraction, or a whole count);
 *   - answer-first: >= 8 typed words before an answer is shown (reveal) and on the final submit;
 *   - the recap pays a flat 20 XP ONCE per section and writes one keyidea_checkpoint row; a replay is refused;
 *     partly / missed ideas are re-enrolled due tomorrow; no evidence row, no practice_log row;
 *   - 14 and 45 days later the section appears once in the reviews queue as a re-check (five shakiest ideas);
 *     a bare self-rating of it is refused; done = checkpoint row + the card's review XP, then never due again.
 */
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecapSubmitResponse } from '@bootquest/shared/api-ext';
import { createApp } from '../src/api/app.ts';
import { DAY_MS, fixedClock, nowMs } from '../src/engines/clock.ts';
import { makeKeyIdeas, readKeyIdeas, setKeyIdeas } from '../src/store/keyideas.ts';
import { makeRouting, setRouting } from '../src/store/routing.ts';
import { reconcileSeededReviewCards } from '../src/store/review-cards.ts';
import { emptySeedItemStore } from '../src/store/seed-items.ts';
import { localNoon, makeTempDb, makeUnit, submit, type TempDb } from './helpers.ts';

const CONTENT = join(import.meta.dirname, 'fixtures', 'keyideas', 'content');
const RECALL = 'I think the write path must update or delete the cached entry and a time limit heals it';
const n = (db: TempDb['db'], sql: string, ...p: (string | number)[]): number => db.get<{ n: number }>(sql, ...p)!.n;

describe('section recap + re-check', () => {
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
    for (const k of ['kx/a/01', 'kx/a/02', 'kx/b/01', 'kx/b/02', 'kx/b/03']) ids[k] = makeUnit(tmp.db, clock, { key: k, kind: 'quiz' });
    for (const k of ['kx/a/drill-1', 'kx/a/drill-2', 'kx/a/drill-3']) ids[k] = makeUnit(tmp.db, clock, { key: k });
    app = createApp({ db: tmp.db, clock });
  }, 60_000);
  afterEach(() => {
    tmp.cleanup();
    setKeyIdeas(null);
    setRouting(null);
    vi.restoreAllMocks();
  });

  const recapState = async (section: string) => ((await request(app).get('/api/keyideas')).body.sections as { section: string; recap: { state: string; needed: number; total: number } }[]).find((s) => s.section === section)!.recap;

  it('opens at recapAfter (a whole count: 2 of 3; a fraction: ceil(0.8 x 5) = 4)', async () => {
    expect(await recapState('fx-beta')).toMatchObject({ state: 'locked', needed: 2, total: 3 });
    submit(tmp.db, clock, ids['kx/b/01']!);
    expect((await recapState('fx-beta')).state).toBe('locked');
    expect((await request(app).get('/api/keyideas/recap/fx-beta')).status).toBe(409);
    submit(tmp.db, clock, ids['kx/b/02']!);
    submit(tmp.db, clock, ids['kx/b/03']!);
    expect((await recapState('fx-beta')).state).toBe('open');
    expect((await request(app).get('/api/keyideas')).body.recapsOpen).toEqual([{ section: 'fx-beta', title: 'Fixture beta: reads' }]);
    // fx-alpha: scope kx/a/ = 5 live units (the archived / unknown keys are not in it)
    expect(await recapState('fx-alpha')).toMatchObject({ state: 'locked', needed: 4, total: 5 });
  });

  it('rv3 MF-1 (ruling 8): the recap needs min(3, live ideas) met ideas besides the unit threshold (1, 2 and 3 met)', async () => {
    // fx-beta: recapAfter 2 of 3 units, 3 live ideas (one source each)
    submit(tmp.db, clock, ids['kx/b/01']!);
    expect((await recapState('fx-beta')).state).toBe('locked'); // 1 met, 1 of 2 units
    submit(tmp.db, clock, ids['kx/b/02']!);
    // 2 of 3 units passed (threshold reached) but only 2 ideas met: still locked, and no prompt is served
    expect(await recapState('fx-beta')).toMatchObject({ state: 'locked', passed: 2, needed: 2 });
    const locked = await request(app).get('/api/keyideas/recap/fx-beta');
    expect(locked.status).toBe(409);
    expect(JSON.stringify(locked.body)).toMatch(/3 of its ideas are met .*2 so far/);
    const items2 = ['cache-invalidate', 'stampede'].map((ideaId) => ({ ideaId, recall: RECALL, mark: 'got' }));
    expect((await request(app).post('/api/keyideas/recap/fx-beta').send({ items: items2 })).status).toBe(409);
    expect(n(tmp.db, "SELECT COALESCE(SUM(amount), 0) AS n FROM xp_event WHERE kind = 'study-quest'")).toBe(0);
    expect(n(tmp.db, 'SELECT COUNT(*) AS n FROM keyidea_checkpoint')).toBe(0);
    submit(tmp.db, clock, ids['kx/b/03']!);
    expect((await recapState('fx-beta')).state).toBe('open'); // 3 met
    expect((await request(app).get('/api/keyideas/recap/fx-beta')).body.prompts).toHaveLength(3);
    // a section with only 2 live ideas opens once BOTH are met ("or all of them"); an idea with no live source does not count
    const idea = (id: string, src: string) => ({ id, idea: 'i', why: 'w', prompt: `${id}?`, answer: 'a', tags: ['t'], sources: [src], siblings: [] });
    const two = { format: 'bootquest-keyideas@1', section: 'fx-two', title: 'Two', track: 'js', scope: ['kx/b/'], recapAfter: 1, ideas: [idea('one', 'kx/b/01'), idea('two', 'kx/b/02'), idea('never', 'kx/does-not-exist')] };
    setKeyIdeas(makeKeyIdeas([two]));
    expect((await recapState('fx-two')).state).toBe('open');
    expect((await request(app).get('/api/keyideas/recap/fx-two')).body.prompts.map((x: { ideaId: string }) => x.ideaId)).toEqual(['one', 'two']);
  });

  it('answer-first, 20 XP once, one checkpoint row, partly/missed re-enrolled tomorrow, no evidence, no practice_log', async () => {
    submit(tmp.db, clock, ids['kx/b/01']!);
    submit(tmp.db, clock, ids['kx/b/02']!);
    submit(tmp.db, clock, ids['kx/b/03']!);
    const p = await request(app).get('/api/keyideas/recap/fx-beta');
    expect(p.status).toBe(200);
    expect(p.body.prompts.map((x: { ideaId: string }) => x.ideaId)).toEqual(['cache-invalidate', 'stampede', 'idempotent-consumer']);
    const beta = readKeyIdeas(CONTENT).sections.get('fx-beta')!;
    for (const i of beta.ideas) expect(p.text).not.toContain(i.answer);
    // the reveal needs >= 8 typed words; an unmet idea is refused
    expect((await request(app).post('/api/keyideas/sections/fx-beta/reveal').send({ ideaId: 'stampede', recall: 'a lock' })).status).toBe(400);
    expect((await request(app).post('/api/keyideas/sections/fx-alpha/reveal').send({ ideaId: 'keyset-pagination', recall: RECALL })).status).toBe(403);
    const rv = await request(app).post('/api/keyideas/sections/fx-beta/reveal').send({ ideaId: 'stampede', recall: RECALL });
    expect(rv.body.answer).toBe(beta.ideas[1]!.answer);
    const ev0 = n(tmp.db, 'SELECT COUNT(*) AS n FROM evidence');
    const xp0 = n(tmp.db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM xp_event');
    // a short recall in the final submit is refused too
    const short = await request(app).post('/api/keyideas/recap/fx-beta').send({ items: [{ ideaId: 'cache-invalidate', recall: 'ttl', mark: 'got' }, { ideaId: 'stampede', recall: RECALL, mark: 'got' }, { ideaId: 'idempotent-consumer', recall: RECALL, mark: 'got' }] });
    expect(short.status).toBe(400);
    const sub = await request(app)
      .post('/api/keyideas/recap/fx-beta')
      .send({ items: [{ ideaId: 'cache-invalidate', recall: RECALL, mark: 'got' }, { ideaId: 'stampede', recall: RECALL, mark: 'missed' }, { ideaId: 'idempotent-consumer', recall: RECALL, mark: 'got' }] });
    expect(sub.status).toBe(200);
    const body = RecapSubmitResponse.parse(sub.body);
    expect(body.xp).toMatchObject({ amount: 20, reason: null });
    expect(body.reenrolled).toEqual(['keyidea:fx-beta/stampede']);
    const t = nowMs(clock);
    expect(body.recheckDueAt).toEqual([t + 14 * DAY_MS, t + 45 * DAY_MS]);
    expect(n(tmp.db, "SELECT COUNT(*) AS n FROM keyidea_checkpoint WHERE section = 'fx-beta' AND kind = 'recap'")).toBe(1);
    expect(tmp.db.get<{ due: number }>("SELECT due_at AS due FROM review_item WHERE card_key = 'keyidea:fx-beta/stampede'")!.due).toBeLessThanOrEqual(t + DAY_MS);
    expect(n(tmp.db, 'SELECT COUNT(*) AS n FROM evidence')).toBe(ev0);
    expect(n(tmp.db, 'SELECT COUNT(*) AS n FROM practice_log')).toBe(0);
    // replay: refused, nothing paid twice (farming)
    for (let k = 0; k < 3; k++) {
      const again = await request(app).post('/api/keyideas/recap/fx-beta').send({ items: [{ ideaId: 'cache-invalidate', recall: RECALL, mark: 'got' }, { ideaId: 'stampede', recall: RECALL, mark: 'got' }, { ideaId: 'idempotent-consumer', recall: RECALL, mark: 'got' }] });
      expect(again.status).toBe(409);
    }
    expect(n(tmp.db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM xp_event')).toBe(xp0 + 20);
    expect((await recapState('fx-beta')).state).toBe('done');
    // the checkpoint is append-only
    expect(() => tmp.db.run("UPDATE keyidea_checkpoint SET section = 'x'")).toThrow(/append-only/);
  });

  it('the 14-day re-check appears once in the reviews queue, is graded by its prompts, then is never due again', async () => {
    submit(tmp.db, clock, ids['kx/b/01']!);
    submit(tmp.db, clock, ids['kx/b/02']!);
    submit(tmp.db, clock, ids['kx/b/03']!);
    await request(app).get('/api/keyideas'); // enrols the met ideas' cards
    const items = [{ ideaId: 'cache-invalidate', recall: RECALL, mark: 'got' }, { ideaId: 'stampede', recall: RECALL, mark: 'got' }, { ideaId: 'idempotent-consumer', recall: RECALL, mark: 'got' }];
    expect((await request(app).post('/api/keyideas/recap/fx-beta').send({ items })).status).toBe(200);
    clock.advance(14 * DAY_MS + 1);
    const q = await request(app).get('/api/reviews/queue');
    const rc = q.body.items.find((i: { cardKey: string }) => i.cardKey === 'recheck:fx-beta/14');
    expect(rc).toBeDefined();
    expect(rc.card.front).toContain('Re-check');
    expect(q.body.items.some((i: { cardKey: string }) => i.cardKey === 'recheck:fx-beta/45')).toBe(false);
    expect((await request(app).post(`/api/reviews/${rc.id}/grade`).send({ grade: 'good' })).status).toBe(409);
    const pr = await request(app).get(`/api/keyideas/recheck/${rc.id}`);
    expect(pr.body).toMatchObject({ section: 'fx-beta', kind: 'recheck-14' });
    expect(pr.body.prompts).toHaveLength(3); // min(5, met ideas)
    const ev0 = n(tmp.db, 'SELECT COUNT(*) AS n FROM evidence');
    const done = await request(app).post(`/api/keyideas/recheck/${rc.id}`).send({ items: [{ ...items[0], mark: 'partly' }, items[1], items[2]] });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ kind: 'recheck-14', xp: null, reviewXp: { amount: 1 }, reenrolled: ['keyidea:fx-beta/cache-invalidate'] });
    expect(n(tmp.db, 'SELECT COUNT(*) AS n FROM evidence')).toBe(ev0);
    expect((await request(app).get(`/api/keyideas/recheck/${rc.id}`)).status).toBe(409);
    const q2 = await request(app).get('/api/reviews/queue');
    expect(q2.body.items.some((i: { cardKey: string }) => i.cardKey.startsWith('recheck:'))).toBe(false);
    // a restart does not bring a finished re-check back
    expect(reconcileSeededReviewCards(tmp.db, emptySeedItemStore, clock).restored).toEqual([]);
    // day 45: the second re-check
    clock.advance(31 * DAY_MS);
    expect((await request(app).get('/api/reviews/queue')).body.items.some((i: { cardKey: string }) => i.cardKey === 'recheck:fx-beta/45')).toBe(true);
  });
});
