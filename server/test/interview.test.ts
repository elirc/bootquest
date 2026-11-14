/**
 * rv2 S3 (PLAN F5): DESIGN IT interview mode S and the dimension profile.
 *   meta     POST /units/:id/explain-back/interview files eb_attempt_meta for the answer of record AFTER it is
 *            stored and BEFORE its self-score (no key point is served before the answer row exists); it writes no
 *            evidence, XP, retest or practice_log; a second meta, a scored answer, a non-DESIGN IT set, a foreign
 *            attempt are refused.
 *   profile  GET /stats/design-profile tallies covered / missed key points per headlines.json dimension on the
 *            self-scored answers of record; with no headlines file (or a set it does not list) everything is
 *            `unclassified` and the endpoint still answers.
 */
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeedExplainBackItem } from '@bootquest/shared';
import { DESIGN_DIMENSIONS, INTERVIEW_TIME_BOX_MS } from '@bootquest/shared/api-ext';
import { createApp } from '../src/api/app.ts';
import { loadSeedDerivedContent } from '../src/api/serve.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { designSideFrom, EMPTY_DESIGN_SIDE, readDesignSide, setDesignSide } from '../src/store/design-side.ts';
import { explainBackUnitKey } from '../src/store/ladder.ts';
import { mapSeedItemStore } from '../src/store/seed-items.ts';
import { localNoon, makeTempDb, type TempDb } from './helpers.ts';
import fixture from './fixtures/ladder-fixture.json' with { type: 'json' };

const BASE = fixture.seedItems.find((i) => i.kind === 'explain-back') as unknown as SeedExplainBackItem; // 3 questions: 5 + 6 + 5 key points

function ebItem(repo: string, tag: string, firstPrompt: string): SeedExplainBackItem {
  const it = structuredClone(BASE);
  return { ...it, key: `seed:explainback:${repo}/explain-back/${tag}`, provenance: { ...it.provenance, repo, path: `docs/${tag}.md` }, questions: [{ ...it.questions[0]!, prompt: firstPrompt }, ...it.questions.slice(1)] };
}
const DESIGN = ebItem('javabootcamp', 'design-kv', 'DESIGN IT — Dynamo-style key-value store. Write your design before you look.');
const DESIGN2 = ebItem('javabootcamp', 'design-q', 'DESIGN IT — URL shortener. Sizing, data model, the trade-off you would defend.');
const ORDINARY = ebItem('questrepo', 'plain', 'Why does the suite test that a VIEWER cannot trigger an allocation run?');

const ANSWER = 'I would partition the keys with consistent hashing, replicate each key to three nodes and use quorum reads and writes with hinted handoff.';
const ids = (item: SeedExplainBackItem) => item.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => `q${qi + 1}k${ki + 1}`));
const n = (db: TempDb['db'], sql: string, ...p: (string | number)[]): number => db.get<{ n: number }>(sql, ...p)!.n;

describe('interview mode S (F5)', () => {
  let tmp: TempDb;
  let app: Express;
  const clock = fixedClock(localNoon(2026, 11, 14));
  const unit: Record<string, number> = {};
  beforeEach(() => {
    tmp = makeTempDb();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seedItems = mapSeedItemStore([DESIGN, DESIGN2, ORDINARY]);
    loadSeedDerivedContent(tmp.db, { seedItems, authored: null }, clock);
    for (const [name, it] of [['design', DESIGN], ['design2', DESIGN2], ['ordinary', ORDINARY]] as const) {
      unit[name] = tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', explainBackUnitKey(it))!.id;
    }
    app = createApp({ db: tmp.db, clock, seedItems });
  }, 60_000);
  afterEach(() => {
    tmp.cleanup();
    setDesignSide(null);
    vi.restoreAllMocks();
  });

  const answer = async (u: number) => {
    const r = await request(app).post(`/api/units/${u}/explain-back/answers`).send({ answers: [ANSWER, ANSWER, ANSWER], selfAssisted: false });
    expect(r.status).toBe(200);
    return r.body.attemptId as number;
  };
  const meta = (u: number, attemptId: number, elapsedMs = 30 * 60_000) => request(app).post(`/api/units/${u}/explain-back/interview`).send({ attemptId, elapsedMs, timeBoxMs: INTERVIEW_TIME_BOX_MS, blind: true });
  const score = (u: number, item: SeedExplainBackItem, missed: readonly string[]) =>
    request(app).post(`/api/units/${u}/explain-back/self-score`).send({ perKeyPoint: Object.fromEntries(ids(item).map((k) => [k, missed.includes(k) ? 'missed' : 'covered'])) });

  it('answer stored first (no key before it), then the meta; the meta writes nothing but its row; then the key and an ordinary self-score', async () => {
    const u = unit.design!;
    expect((await request(app).get(`/api/units/${u}/explain-back/key`)).status).toBe(403); // no key point before the answer
    expect((await meta(u, 1)).status).toBe(400); // no answer of record yet
    const attemptId = await answer(u);
    const before = { ev: n(tmp.db, 'SELECT COUNT(*) AS n FROM evidence'), xp: n(tmp.db, 'SELECT COUNT(*) AS n FROM xp_event'), pl: n(tmp.db, 'SELECT COUNT(*) AS n FROM practice_log'), att: n(tmp.db, 'SELECT COUNT(*) AS n FROM attempt') };
    const r = await meta(u, attemptId, INTERVIEW_TIME_BOX_MS + 60_000);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ attemptId, mode: 'interview', elapsedMs: INTERVIEW_TIME_BOX_MS + 60_000, timeBoxMs: INTERVIEW_TIME_BOX_MS, blind: true, overTime: true });
    expect(tmp.db.get('SELECT attempt_id AS a, mode, elapsed_ms AS e, blind FROM eb_attempt_meta')).toEqual({ a: attemptId, mode: 'interview', e: INTERVIEW_TIME_BOX_MS + 60_000, blind: 1 });
    expect({ ev: n(tmp.db, 'SELECT COUNT(*) AS n FROM evidence'), xp: n(tmp.db, 'SELECT COUNT(*) AS n FROM xp_event'), pl: n(tmp.db, 'SELECT COUNT(*) AS n FROM practice_log'), att: n(tmp.db, 'SELECT COUNT(*) AS n FROM attempt') }).toEqual(before);
    expect((await meta(u, attemptId)).body.error.code).toBe('ALREADY_ANSWERED'); // append-only, once
    expect((await request(app).get(`/api/units/${u}/explain-back/key`)).status).toBe(200);
    const s = await score(u, DESIGN, ['q1k1']);
    expect(s.status).toBe(200);
    // the same grade as without interview mode: the same marks on a twin set with no meta
    await answer(unit.design2!);
    const twin = await score(unit.design2!, DESIGN2, ['q1k1']);
    expect({ coverage: s.body.coverage, passed: s.body.passed }).toEqual({ coverage: twin.body.coverage, passed: twin.body.passed });
  });

  it('refused: a scored answer, a foreign attempt, a non-DESIGN IT set', async () => {
    const a1 = await answer(unit.design!);
    expect((await score(unit.design!, DESIGN, [])).status).toBe(200);
    const late = await meta(unit.design!, a1);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ALREADY_SCORED');
    const a2 = await answer(unit.design2!);
    expect((await meta(unit.design!, a2)).status).toBe(400); // an attempt of another unit
    const a3 = await answer(unit.ordinary!);
    const plain = await meta(unit.ordinary!, a3);
    expect(plain.status).toBe(409);
    expect(plain.body.error.code).toBe('WRONG_UNIT_KIND');
    expect(n(tmp.db, 'SELECT COUNT(*) AS n FROM eb_attempt_meta')).toBe(0);
    // body validation: the elapsed time is bounded
    expect((await request(app).post(`/api/units/${unit.design2!}/explain-back/interview`).send({ attemptId: a2, elapsedMs: -1, timeBoxMs: 1, blind: false })).status).toBe(400);
  });

  it('profile: per dimension from headlines.json; a set the file does not list is unclassified; no file still answers', async () => {
    // DESIGN: q1 -> consistency, q2 -> scaling (k1..k6), q3 not listed; DESIGN2: not in the file at all
    setDesignSide(
      designSideFrom({
        format: 'bootquest-headlines@1',
        dimensions: { consistency: 'correctness of state', scaling: 'partitioning and caching' },
        sets: {
          [explainBackUnitKey(DESIGN)]: [
            Array.from({ length: 5 }, () => ({ headline: 'h', dimension: 'consistency', repoSpecific: false })),
            Array.from({ length: 6 }, (_, k) => (k === 5 ? 'a bare headline' : { headline: 'h', dimension: 'scaling', repoSpecific: true })),
          ],
        },
      }),
    );
    const empty = (await request(app).get('/api/stats/design-profile')).body;
    expect(empty).toMatchObject({ headlinesLoaded: true, answers: 0, unclassified: { covered: 0, missed: 0 }, interview: { answers: 0, medianElapsedMs: null, overTime: 0 } });
    expect(empty.dimensions.map((d: { id: string }) => d.id)).toEqual([...DESIGN_DIMENSIONS]);

    const a1 = await answer(unit.design!);
    expect((await meta(unit.design!, a1, 20 * 60_000)).status).toBe(200);
    expect((await score(unit.design!, DESIGN, ['q1k1', 'q1k2', 'q2k1', 'q3k1'])).status).toBe(200);
    await answer(unit.design2!);
    expect((await score(unit.design2!, DESIGN2, ['q1k1'])).status).toBe(200);
    // an ordinary (non-design) set never enters the profile
    await answer(unit.ordinary!);
    expect((await score(unit.ordinary!, ORDINARY, [])).status).toBe(200);

    const p = (await request(app).get('/api/stats/design-profile')).body;
    const dim = (id: string) => p.dimensions.find((d: { id: string }) => d.id === id);
    expect(p.answers).toBe(2);
    expect(dim('consistency')).toEqual({ id: 'consistency', description: 'correctness of state', covered: 3, missed: 2, coverage: 0.6, answers: 1 });
    expect(dim('scaling')).toEqual({ id: 'scaling', description: 'partitioning and caching', covered: 4, missed: 1, coverage: 0.8, answers: 1 });
    expect(dim('security')).toEqual({ id: 'security', description: null, covered: 0, missed: 0, coverage: null, answers: 0 });
    // DESIGN: q2k6 (no dimension) + q3 (5, one missed) = 5 covered / 1 missed; DESIGN2: 16 key points, 1 missed
    expect(p.unclassified).toEqual({ covered: 4 + 1 + 15, missed: 1 + 1 });
    expect(p.interview).toEqual({ answers: 1, medianElapsedMs: 20 * 60_000, overTime: 0 });

    // no headlines file at all: same answers, every key point unclassified, nothing breaks
    setDesignSide(EMPTY_DESIGN_SIDE);
    const none = (await request(app).get('/api/stats/design-profile')).body;
    expect(none).toMatchObject({ headlinesLoaded: false, answers: 2, unclassified: { covered: 12 + 15, missed: 4 + 1 } });
    expect(none.dimensions.every((d: { covered: number; missed: number; coverage: null }) => d.covered === 0 && d.missed === 0 && d.coverage === null)).toBe(true);
    // a missing dir reads as "no file"; a malformed file is a warned problem, never a throw
    expect(readDesignSide('Z:/definitely/not/here')).toEqual(EMPTY_DESIGN_SIDE);
    expect(() => designSideFrom({ format: 'nope' })).toThrow();
  });
});
