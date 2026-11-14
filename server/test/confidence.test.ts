/**
 * rv2 S3 (PLAN F9, stretch): a confidence tag on a graded answer (answer_confidence, migration 027) and the
 * calibration numbers. A tag goes on a graded submit or an explain-back answer of record, once, within the window,
 * and for an explain-back only before its self-score; it writes nothing else. Calibration counts pass / fail per
 * level, keeps unscored explain-backs apart and names "sure but failed".
 */
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeedExplainBackItem } from '@bootquest/shared';
import { CONFIDENCE_WINDOW_MS } from '@bootquest/shared/api-ext';
import { createApp } from '../src/api/app.ts';
import { loadSeedDerivedContent } from '../src/api/serve.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { explainBackUnitKey } from '../src/store/ladder.ts';
import { mapSeedItemStore } from '../src/store/seed-items.ts';
import { localNoon, makeTempDb, makeUnit, submit, type TempDb } from './helpers.ts';
import fixture from './fixtures/ladder-fixture.json' with { type: 'json' };

const BASE = fixture.seedItems.find((i) => i.kind === 'explain-back') as unknown as SeedExplainBackItem;
const EB: SeedExplainBackItem = { ...structuredClone(BASE), key: 'seed:explainback:questrepo/explain-back/conf', provenance: { ...BASE.provenance, repo: 'questrepo', path: 'docs/conf.md' } };
const ANSWER = 'The guard runs before every write, so a viewer never reaches the allocation code and the suite pins that with a forbidden status.';
const n = (db: TempDb['db'], sql: string): number => db.get<{ n: number }>(sql)!.n;

describe('confidence tags + calibration (F9)', () => {
  let tmp: TempDb;
  let app: Express;
  let eb = 0;
  const clock = fixedClock(localNoon(2026, 11, 14));
  beforeEach(() => {
    tmp = makeTempDb();
    clock.set(localNoon(2026, 11, 14));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seedItems = mapSeedItemStore([EB]);
    loadSeedDerivedContent(tmp.db, { seedItems, authored: null }, clock);
    eb = tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', explainBackUnitKey(EB))!.id;
    app = createApp({ db: tmp.db, clock, seedItems });
  }, 60_000);
  afterEach(() => {
    tmp.cleanup();
    vi.restoreAllMocks();
  });

  const tag = (attemptId: number, confidence: string) => request(app).post(`/api/attempts/${attemptId}/confidence`).send({ confidence });
  const cal = async () => (await request(app).get('/api/stats/calibration')).body;
  const ids = () => EB.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => `q${qi + 1}k${ki + 1}`));

  it('graded submits and an explain-back answer take one tag each; calibration per level; nothing else is written', async () => {
    const d1 = makeUnit(tmp.db, clock);
    const d2 = makeUnit(tmp.db, clock);
    const pass = submit(tmp.db, clock, d1);
    const fail = submit(tmp.db, clock, d2, { pass: false });
    const before = { ev: n(tmp.db, 'SELECT COUNT(*) AS n FROM evidence'), xp: n(tmp.db, 'SELECT COUNT(*) AS n FROM xp_event'), att: n(tmp.db, 'SELECT COUNT(*) AS n FROM attempt') };
    expect((await tag(pass.id, 'sure')).body).toEqual({ attemptId: pass.id, confidence: 'sure' });
    expect((await tag(fail.id, 'sure')).status).toBe(200);
    expect({ ev: n(tmp.db, 'SELECT COUNT(*) AS n FROM evidence'), xp: n(tmp.db, 'SELECT COUNT(*) AS n FROM xp_event'), att: n(tmp.db, 'SELECT COUNT(*) AS n FROM attempt') }).toEqual(before);
    expect((await tag(pass.id, 'guess')).body.error.code).toBe('ALREADY_ANSWERED');

    // explain-back: tagged after the answer is stored, before the self-score -> pending until scored
    const ans = await request(app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: EB.questions.map(() => ANSWER), selfAssisted: false });
    expect(ans.status).toBe(200);
    expect((await tag(ans.body.attemptId, 'unsure')).status).toBe(200);
    let c = await cal();
    expect(c).toEqual({
      levels: [
        { confidence: 'sure', answers: 2, passed: 1, passRate: 0.5 },
        { confidence: 'unsure', answers: 0, passed: 0, passRate: null },
        { confidence: 'guess', answers: 0, passed: 0, passRate: null },
      ],
      pending: 1,
      sureButFailed: 1,
    });
    const scored = await request(app).post(`/api/units/${eb}/explain-back/self-score`).send({ perKeyPoint: Object.fromEntries(ids().map((k) => [k, 'covered'])) });
    expect(scored.body.passed).toBe(true);
    c = await cal();
    expect(c.pending).toBe(0);
    expect(c.levels[1]).toEqual({ confidence: 'unsure', answers: 1, passed: 1, passRate: 1 });
  });

  it('refused: an explain-back already self-scored, a late tag, a practice try, an unknown attempt, a bad level', async () => {
    const ans = await request(app).post(`/api/units/${eb}/explain-back/answers`).send({ answers: EB.questions.map(() => ANSWER), selfAssisted: false });
    await request(app).post(`/api/units/${eb}/explain-back/self-score`).send({ perKeyPoint: Object.fromEntries(ids().map((k) => [k, 'covered'])) });
    expect((await tag(ans.body.attemptId, 'sure')).body.error.code).toBe('ALREADY_SCORED');
    const p = await request(app).post(`/api/units/${eb}/explain-back/practice`).send({ answers: EB.questions.map(() => ANSWER) });
    expect(p.status).toBe(200);
    expect((await tag(p.body.attemptId, 'sure')).body.error.code).toBe('WRONG_UNIT_KIND');
    const late = submit(tmp.db, clock, makeUnit(tmp.db, clock));
    clock.advance(CONFIDENCE_WINDOW_MS + 1);
    expect((await tag(late.id, 'sure')).body.error.code).toBe('NOT_DUE');
    expect((await tag(99_999, 'sure')).status).toBe(404);
    expect((await tag(late.id, 'certain')).status).toBe(400);
    expect(n(tmp.db, 'SELECT COUNT(*) AS n FROM answer_confidence')).toBe(0);
  });
});
