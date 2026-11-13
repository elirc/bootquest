/**
 * rv B (Wave 1b row 5; R4-07, R3-05): explain-back grading repairs.
 *   - a minimum real answer: an answer of record with < 15 words in any question is refused (400) before any key
 *     point is readable, and records nothing ("x, x, x" passed 18/18 and filed evidence);
 *   - GET /units/:id/source: the pinned repo tree of an explain-back / kata (seed provenance); G2 briefs are
 *     open-book, other sets are not; non-ladder units 404.
 */
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnitSourceResponse } from '@bootquest/shared/api-ext';
import { answerWords, EB_MIN_ANSWER_WORDS } from '@bootquest/shared/eb-weight';
import type { SeedExplainBackItem, SeedPatchKataItem } from '@bootquest/shared';
import { createApp } from '../../src/api/app.ts';
import type { Runner } from '../../src/api/runners.ts';
import { fixedClock } from '../../src/engines/clock.ts';
import { insertUnit } from '../../src/store/content.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
import { mapSeedItemStore } from '../../src/store/seed-items.ts';
import { localNoon, makeTempDb, makeUnit, type TempDb } from '../helpers.ts';
import fixture from '../fixtures/ladder-fixture.json' with { type: 'json' };

const EB = fixture.seedItems.find((i) => i.kind === 'explain-back') as unknown as SeedExplainBackItem;
const KATA = fixture.seedItems.find((i) => i.kind === 'patch-kata') as unknown as SeedPatchKataItem;
/** a G2 delegation brief: same shape, a "G2 BRIEF" prompt prefix (store/ladder.ts isG2) */
const G2: SeedExplainBackItem = {
  ...structuredClone(EB),
  key: 'seed:explainback:ww6/explain-back/g2-brief-fixture',
  questions: EB.questions.map((q, i) => ({ ...q, prompt: i === 0 ? `G2 BRIEF ${q.prompt}` : q.prompt })),
};
const GOOD_PORT = 4000;
const fakeHttp: Runner = async (_spec, sub) =>
  sub.port === GOOD_PORT ? { pass: true, output: '', failures: [], durationMs: 1 } : { pass: false, output: '', failures: [{ name: 'down', message: 'refused' }], durationMs: 1 };

describe('rv B explain-back + source', () => {
  let tmp: TempDb;
  let app: Express;
  const ids = new Map<string, number>();
  const clock = fixedClock(localNoon(2026, 11, 12));

  beforeEach(() => {
    tmp = makeTempDb();
    for (const u of fixture.units) ids.set(u.key, insertUnit(tmp.db, u, clock));
    ids.set('g2', insertUnit(tmp.db, { key: 'ladder/g2/ww6/fixture', track: 'js', kind: 'explain-back', title: 'G2 brief', competencies: ['agentic-engineering'], checks: [{ spec: { type: 'explain-back', questionSetKey: G2.key } }] }, clock));
    app = createApp({ db: tmp.db, clock, runners: { http: fakeHttp }, seedItems: mapSeedItemStore([...fixture.seedItems, G2] as never) });
  }, 60_000);
  afterEach(() => tmp.cleanup());
  const id = (k: string) => ids.get(k)!;

  it('answerWords counts letter/digit runs; "x, x, x" is 3 words', () => {
    expect(answerWords('x, x, x')).toBe(3);
    expect(answerWords("don't retry p99 O(n) — ever")).toBe(6); // O(n): two runs
    expect(EB_MIN_ANSWER_WORDS).toBe(15);
  });

  it('R4-07: an answer of record with fewer than 15 words in a question is refused before the key, recording nothing', async () => {
    await request(app).post(`/api/units/${id('fixture:ladder/project-api')}/submit`).send({ port: GOOD_PORT }).expect(200);
    const eb = id('fixture:ladder/explain-api');
    const before = ledgerCounts(tmp.db);
    const long = 'the guard rejects a viewer token on every write route, so the repository is never called and nothing changes';
    const res = await request(app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: ['x', long, 'x, x, x'] });
    expect(res.status, res.text).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/at least 15 words per answer.*Q1 has 1, Q3 has 3/);
    expect(res.body.error.issues.map((i: { path: string }) => i.path)).toEqual(['body.answers.0', 'body.answers.2']);
    expect(ledgerCounts(tmp.db)).toEqual(before);
    expect((await request(app).get(`/api/units/${eb}/explain-back/key`)).status).toBe(403);
    // a real answer goes through
    expect((await request(app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: [long, long, long] })).status).toBe(200);
  });

  it('R3-05: GET /units/:id/source serves the pinned tree; G2 briefs are open-book, other sets and katas are not', async () => {
    const g2 = UnitSourceResponse.parse((await request(app).get(`/api/units/${id('g2')}/source`)).body);
    expect(g2).toEqual({
      unitId: id('g2'),
      repo: G2.provenance.repo,
      sha: G2.provenance.sha,
      url: `https://github.com/elirc/${G2.provenance.repo}/tree/${G2.provenance.sha}`,
      openBook: true,
    });
    expect(UnitSourceResponse.parse((await request(app).get(`/api/units/${id('fixture:ladder/explain-api')}/source`)).body).openBook).toBe(false);
    const kata = UnitSourceResponse.parse((await request(app).get(`/api/units/${id('fixture:ladder/kata-1')}/source`)).body);
    expect(kata).toMatchObject({ repo: KATA.provenance.repo, sha: KATA.provenance.sha, openBook: false });
    const drill = makeUnit(tmp.db, clock);
    expect((await request(app).get(`/api/units/${drill}/source`)).status).toBe(404);
    expect((await request(app).get('/api/units/999999/source')).status).toBe(404);
  });
});
