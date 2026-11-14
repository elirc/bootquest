/**
 * rv2 S1 task 3 (PLAN §2.1 item 4, §4 S1.3 check): the interleaved "Key ideas" session.
 *   - GET /keyideas/queue: due key-idea cards from every section, no two neighbours from one section when >= 2
 *     sections are due, capped at 12 (`limit=5` for the 10-minute mode);
 *   - `tag=` filters by an idea tag (the concept index), and `tags` lists every due tag with its count.
 */
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyIdeaQueueResponse } from '@bootquest/shared/api-ext';
import { createApp } from '../src/api/app.ts';
import { interleave } from '../src/api/keyideas-service.ts';
import { DAY_MS, fixedClock } from '../src/engines/clock.ts';
import { makeKeyIdeas, setKeyIdeas } from '../src/store/keyideas.ts';
import { makeRouting, setRouting } from '../src/store/routing.ts';
import { localNoon, makeTempDb, makeUnit, submit, type TempDb } from './helpers.ts';

const section = (id: string, count: number, tag: (n: number) => string[]) => ({
  format: 'bootquest-keyideas@1',
  section: id,
  title: `Section ${id}`,
  track: 'js',
  scope: [`ks/${id}/`],
  ideas: Array.from({ length: count }, (_, n) => ({ id: `i-${n + 1}`, idea: 'i', why: 'w', prompt: `${id} prompt ${n + 1}?`, answer: 'a', tags: tag(n), sources: [`ks/${id}/${n + 1}`], siblings: [] })),
});

describe('interleave (pure)', () => {
  const cards = (spec: Record<string, number>) => Object.entries(spec).flatMap(([s, k]) => Array.from({ length: k }, (_, i) => ({ section: s, i })));
  const noNeighbours = (xs: { section: string }[]) => xs.every((x, i) => i === 0 || xs[i - 1]!.section !== x.section);
  it('never puts two cards of one section side by side when >= 2 sections are due, and caps', () => {
    for (const spec of [{ a: 6, b: 6 }, { a: 9, b: 2, c: 1 }, { a: 1, b: 1 }, { a: 5, b: 4, c: 4, d: 3 }] as Record<string, number>[]) {
      for (const cap of [5, 12]) {
        const out = interleave(cards(spec), cap, '2026-11-14');
        expect(noNeighbours(out)).toBe(true);
        expect(out.length).toBeLessThanOrEqual(cap);
      }
    }
    // a dominant section: stops rather than pairing (a b a c a ... a)
    const dom = interleave(cards({ a: 9, b: 2, c: 1 }), 12, 'x');
    expect(dom.map((x) => x.section).join('')).toBe('abacaba');
    // one section only: served as is, capped
    expect(interleave(cards({ a: 20 }), 12, 'x')).toHaveLength(12);
    // within a section the input (due) order is kept
    expect(interleave(cards({ a: 3, b: 3 }), 12, 'x').filter((x) => x.section === 'a').map((x) => x.i)).toEqual([0, 1, 2]);
  });
});

describe('GET /keyideas/queue', () => {
  let tmp: TempDb;
  let app: Express;
  const clock = fixedClock(localNoon(2026, 11, 14));
  beforeEach(() => {
    tmp = makeTempDb();
    clock.set(localNoon(2026, 11, 14));
    setRouting(makeRouting([]));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setKeyIdeas(makeKeyIdeas([section('alpha', 8, (n) => (n % 2 ? ['caching'] : ['idempotency'])), section('beta', 6, () => ['idempotency']), section('gamma', 2, () => ['pagination'])]));
    for (const s of ['alpha', 'beta', 'gamma']) for (let n = 1; n <= 8; n++) submit(tmp.db, clock, makeUnit(tmp.db, clock, { key: `ks/${s}/${n}`, kind: 'quiz' }));
    app = createApp({ db: tmp.db, clock });
  }, 60_000);
  afterEach(() => {
    tmp.cleanup();
    setKeyIdeas(null);
    setRouting(null);
    vi.restoreAllMocks();
  });

  it('interleaves across sections, caps at 12 (5 in 10-minute mode), filters by tag and lists the tags', async () => {
    await request(app).get('/api/keyideas'); // enrol (16 cards, 4 a day)
    clock.advance(10 * DAY_MS);
    const r = KeyIdeaQueueResponse.parse((await request(app).get('/api/keyideas/queue')).body);
    expect(r.count).toBe(16);
    expect(r.items).toHaveLength(12);
    const secs = r.items.map((i) => i.keyIdea.section);
    expect(secs.every((s, i) => i === 0 || secs[i - 1] !== s)).toBe(true);
    expect(new Set(secs).size).toBe(3);
    expect(r.items.every((i) => i.kind === 'concept' && i.card?.front.endsWith('?'))).toBe(true);
    expect(r.tags).toEqual([
      { tag: 'idempotency', count: 10 },
      { tag: 'caching', count: 4 },
      { tag: 'pagination', count: 2 },
    ]);
    const ten = KeyIdeaQueueResponse.parse((await request(app).get('/api/keyideas/queue?limit=5')).body);
    expect(ten.items).toHaveLength(5);
    const tagged = KeyIdeaQueueResponse.parse((await request(app).get('/api/keyideas/queue?tag=caching')).body);
    expect(tagged.count).toBe(4);
    expect(tagged.items.every((i) => i.keyIdea.tags.includes('caching'))).toBe(true);
    expect((await request(app).get('/api/keyideas/queue?limit=13')).status).toBe(400);
    expect((await request(app).get('/api/keyideas/queue?tag=Bad Tag')).status).toBe(400);
    // the cards are ordinary review items: grading one through /reviews works and it leaves the session queue
    const first = r.items[0]!;
    expect((await request(app).post(`/api/reviews/${first.id}/grade`).send({ grade: 'good' })).status).toBe(200);
    expect(KeyIdeaQueueResponse.parse((await request(app).get('/api/keyideas/queue')).body).count).toBe(15);
  });
});
