import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { ApiErrorBody, CompetenciesResponse, ExplainBackScoreResponse, UnitDetailResponse } from '@bootquest/shared/api';
import type { SeedExplainBackItem } from '@bootquest/shared';
import { createApp } from '../src/api/app.ts';
import type { Runner } from '../src/api/runners.ts';
import { loadSeedDerivedContent } from '../src/api/serve.ts';
import { DAY_MS, fixedClock } from '../src/engines/clock.ts';
import { evaluatePromotion } from '../src/engines/evidence.ts';
import { EB_SET_MIN_GAP_MS } from '../src/engines/ladder.ts';
import { insertContentRef, insertUnit } from '../src/store/content.ts';
import { assertUniqueSeedItemRefs, ebSetGroup, explainBackUnitKey, ladderUnits } from '../src/store/ladder.ts';
import { mapSeedItemStore } from '../src/store/seed-items.ts';
import { localNoon, makeTempDb, type TempDb } from './helpers.ts';
import fixture from './fixtures/ladder-fixture.json' with { type: 'json' };

/**
 * Explain-back ALTERNATE SETS (retakes, decision: sibling units with derived linkage): one sibling
 * pack per alternate set — its own item key (origin draft-<set>), unit and answer-before-key
 * discipline — grouped by the seed provenance (repo, path), never by a stored column. A FRESH
 * answer to any sibling opens >= EB_SET_MIN_GAP_MS after the newest fresh answer in the group;
 * each set pays its own 20 XP and any first-time set can anchor promotion leg (b).
 */

const BASE = fixture.seedItems.find((i) => i.kind === 'explain-back') as unknown as SeedExplainBackItem;
const REPO = 'setsrepo';
const PATH = 'docs/learning/backpressure.md';

function setItem(origin: string, set?: string): SeedExplainBackItem {
  const it = structuredClone(BASE);
  const tag = set ? `set ${set}` : 'primary';
  return {
    ...it,
    key: `seed:explainback:${REPO}/explain-back/${origin}`,
    provenance: { ...it.provenance, repo: REPO, path: PATH },
    questions: it.questions.map((q, i) => ({ ...q, prompt: `[${tag}] ${i + 1}. ${q.prompt}` })),
    ...(set ? { set } : {}),
  };
}

const A = setItem('draft');
const B = setItem('draft-b', 'b');
const IDS = A.questions.flatMap((q, qi) => q.keyPoints.map((_, ki) => `q${qi + 1}k${ki + 1}`));
const all = (m: 'covered' | 'missed') => Object.fromEntries(IDS.map((id) => [id, m]));
const ANSWERS = ['one', 'two', 'three'];
const GOOD_PORT = 4000;
const fakeHttp: Runner = async (_spec, sub) =>
  sub.port === GOOD_PORT
    ? { pass: true, output: '', failures: [], durationMs: 1 }
    : { pass: false, output: '', failures: [{ name: 'health answers ok', message: 'connection refused' }], durationMs: 1 };
const PROJECT_SPEC = fixture.units.find((u) => u.key === 'fixture:ladder/project-api')!.checks[0]!.spec;

function expectError(res: request.Response, status: number, code: string): void {
  expect(res.status, res.text).toBe(status);
  expect(ApiErrorBody.parse(res.body).error.code).toBe(code);
}

describe('explain-back alternate sets (sibling units, derived grouping, spaced rotation)', () => {
  let tmp: TempDb;
  let clock: ReturnType<typeof fixedClock>;
  let project: number;
  let app: Express;
  const unitId = (it: SeedExplainBackItem) => tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', explainBackUnitKey(it))!.id;
  const detail = async (id: number) => UnitDetailResponse.parse((await request(app).get(`/api/units/${id}`)).body).explainBack;
  const answer = (id: number) => request(app).post(`/api/units/${id}/explain-back/answers`).send({ answers: ANSWERS });

  beforeEach(() => {
    tmp = makeTempDb();
    clock = fixedClock(localNoon(2026, 10, 1));
    // the project artifact the set explains: its lesson guide ref is the set's source file (artifactUnitsFor)
    project = insertUnit(tmp.db, { key: 'fixture:sets/project', track: 'js', kind: 'http-lab', title: '[fixture] backpressure project', competencies: ['data-http'], checks: [{ spec: PROJECT_SPEC }] }, clock);
    const ref = insertContentRef(
      tmp.db,
      { repo: `elirc/${REPO}`, path: PATH, sha: 'abcdef1', title: 'Backpressure', stableKey: 'guide:backpressure', kind: 'guide', provenance: 'frontmatter' },
      clock,
    );
    tmp.db.run(`INSERT INTO unit_ref (unit_id, content_ref_id, role) VALUES (?, ?, 'guide')`, project, ref);
    loadSeedDerivedContent(tmp.db, { seedItems: mapSeedItemStore([A, B]), authored: null }, clock);
    app = createApp({ db: tmp.db, clock, runners: { http: fakeHttp }, seedItems: mapSeedItemStore([A, B]) });
  });
  afterEach(() => tmp.cleanup());

  it('loads two live units (keys from distinct origins), set titles, the SAME prerequisites and competencies; unique item refs hold', () => {
    expect(A.key).not.toBe(B.key);
    expect(ebSetGroup(A)).toBe(ebSetGroup(B));
    const rows = new Map(ladderUnits(tmp.db).map((u) => [u.key, u]));
    const a = rows.get(explainBackUnitKey(A))!;
    const b = rows.get(explainBackUnitKey(B))!;
    expect(a.title).toBe(`Explain back: ${REPO} — backpressure.md`);
    expect(b.title).toBe(`Explain back: ${REPO} — backpressure.md (set B)`);
    expect(a.prerequisites).toEqual([project]);
    expect(b.prerequisites).toEqual([project]);
    const comps = (id: number) => tmp.db.all<{ c: string }>('SELECT competency_id AS c FROM unit_competency WHERE unit_id = ? ORDER BY c', id).map((r) => r.c);
    expect(comps(a.id)).toEqual(['data-http', 'language-fluency']);
    expect(comps(b.id)).toEqual(comps(a.id));
    expect(() => assertUniqueSeedItemRefs(tmp.db)).not.toThrow();
  });

  it('detail: altSets (group, label, siblings in load order, gate) only when the group has >= 2 loaded siblings', async () => {
    const a = unitId(A);
    const b = unitId(B);
    expect((await detail(a))?.altSets).toEqual({
      group: ebSetGroup(A),
      label: 'A',
      siblings: [
        { unitId: a, label: 'A', answered: false, scored: false },
        { unitId: b, label: 'B', answered: false, scored: false },
      ],
      gate: { open: true, opensAt: null },
    });
    expect((await detail(b))?.altSets?.label).toBe('B');
    // a lone set has no altSets at all
    const solo = createApp({ db: tmp.db, clock, runners: {}, seedItems: mapSeedItemStore([A]) });
    expect(UnitDetailResponse.parse((await request(solo).get(`/api/units/${a}`)).body).explainBack?.altSets).toBeUndefined();
  });

  it('rotation: set B first (leg (b) anchored by the first-time set), then set A refused 409 NOT_DUE until >= 2 days later, then 200 solo; each set pays its full 20 XP', async () => {
    const a = unitId(A);
    const b = unitId(B);
    // dead end #2 still applies to every sibling (shared prerequisites)
    expectError(await answer(b), 409, 'ARTIFACT_REQUIRED');
    await request(app).post(`/api/units/${project}/submit`).send({ port: GOOD_PORT }).expect(200);
    clock.advance(60_000);
    const bAns = await answer(b);
    expect(bAns.status, bAns.text).toBe(200);
    expect(bAns.body.mode).toBe('solo');
    const bAt = clock().getTime();
    const bScore = ExplainBackScoreResponse.parse((await request(app).post(`/api/units/${b}/explain-back/self-score`).send({ perKeyPoint: all('covered') })).body);
    expect(bScore).toMatchObject({ passed: true, xp: { amount: 20, reason: null } });
    // leg (b) is anchored by set B — no special-casing: same prerequisites, solo, unassisted
    const legB = evaluatePromotion(tmp.db, 'data-http', clock).legs.explainBack;
    expect(bScore.evidenceIds).toContain(legB);
    expect(tmp.db.get<{ a: number }>('SELECT attempt_id AS a FROM evidence WHERE id = ?', legB)!.a).toBe(bAns.body.attemptId);
    const legs = CompetenciesResponse.parse((await request(app).get('/api/competencies')).body).competencies.find((c) => c.id === 'data-http')!.promotion;
    expect(legs.explainBack.state).toBe('done');

    // set A within the window: refused, nothing recorded, the detail names when it opens
    const d = await detail(a);
    expect(d?.altSets?.gate).toEqual({ open: false, opensAt: bAt + EB_SET_MIN_GAP_MS });
    expect(d?.altSets?.siblings.find((s) => s.unitId === b)).toEqual({ unitId: b, label: 'B', answered: true, scored: true });
    expect(EB_SET_MIN_GAP_MS).toBe(2 * DAY_MS);
    const before = tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt')!.n;
    const early = await answer(a);
    expectError(early, 409, 'NOT_DUE');
    expect(early.body.error.message).toContain('alternate set A of this question set opens at');
    expect(early.body.error.message).toContain(new Date(bAt + EB_SET_MIN_GAP_MS).toISOString());
    clock.set(bAt + EB_SET_MIN_GAP_MS - 1);
    expectError(await answer(a), 409, 'NOT_DUE');
    expect(tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt')!.n).toBe(before);

    // practice on set B never moves the gate (only fresh answers are spaced)
    const p = await request(app).post(`/api/units/${b}/explain-back/practice`).send({ answers: ANSWERS });
    expect(p.status, p.text).toBe(200);
    expect((await detail(a))?.altSets?.gate).toEqual({ open: false, opensAt: bAt + EB_SET_MIN_GAP_MS });

    clock.set(bAt + EB_SET_MIN_GAP_MS);
    expect((await detail(a))?.altSets?.gate).toEqual({ open: true, opensAt: bAt + EB_SET_MIN_GAP_MS });
    const aAns = await answer(a);
    expect(aAns.status, aAns.text).toBe(200);
    expect(aAns.body.mode).toBe('solo');
    const aScore = ExplainBackScoreResponse.parse((await request(app).post(`/api/units/${a}/explain-back/self-score`).send({ perKeyPoint: all('covered') })).body);
    expect(aScore.xp).toMatchObject({ amount: 20, reason: null }); // per-unit dedupe: each sibling is its own unit
    expect(tmp.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM xp_event WHERE kind = 'explain-back' AND amount = 20`)!.n).toBe(2);
    // the one-shot rule is per set: set A cannot be answered again
    expectError(await answer(a), 403, 'ALREADY_ANSWERED');
  });

  it('a retired alternate pack retires ITS unit only; the primary stays live and loses altSets', async () => {
    const a = unitId(A);
    const b = unitId(B);
    const { ladder } = loadSeedDerivedContent(tmp.db, { seedItems: mapSeedItemStore([A]), authored: null }, clock);
    expect(ladder.retired).toBe(1);
    expect(ladder.explainBack).toMatchObject({ built: 1, loaded: 1 });
    expect(tmp.db.get<{ r: number | null }>('SELECT retired_at AS r FROM unit WHERE id = ?', b)!.r).not.toBeNull();
    expect(tmp.db.get<{ r: number | null }>('SELECT retired_at AS r FROM unit WHERE id = ?', a)!.r).toBeNull();
    const solo = createApp({ db: tmp.db, clock, runners: {}, seedItems: mapSeedItemStore([A]) });
    expect(UnitDetailResponse.parse((await request(solo).get(`/api/units/${a}`)).body).explainBack?.altSets).toBeUndefined();
    expect(() => assertUniqueSeedItemRefs(tmp.db)).not.toThrow();
  });
});
