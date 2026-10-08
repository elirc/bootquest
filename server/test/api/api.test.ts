import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  ApiErrorBody,
  DashboardResponse,
  GradeResponse,
  HealthResponse,
  ModelAnswerResponse,
  ReviewQueueResponse,
  RevealResponse,
  RunResponse,
  SelfAttestResponse,
  SubmitResponse,
  TrackUnitsResponse,
  TracksResponse,
  UnitDetailResponse,
  WrittenAnswerResponse,
} from '@bootquest/shared/api';
import { createApp } from '../../src/api/app.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import { DAY_MS } from '../../src/engines/clock.ts';
import { getRating } from '../../src/engines/evidence.ts';
import { addReviewItem } from '../../src/engines/fsrs.ts';
import { toPlain } from '../../src/api/http.ts';
import { insertUnit } from '../../src/store/content.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
import { graduate, promoteTo } from '../helpers.ts';
import { fixture, useApi } from './harness.ts';

function expectApiError(res: request.Response, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  const body = ApiErrorBody.parse(res.body);
  expect(body.error.code).toBe(code);
}

describe('GET /api/health', () => {
  const ctx = useApi();

  it('reports ok, version and content counts', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(res.body);
    expect(body.version).toBe('0.1.0');
    expect(body.counts).toEqual({ units: fixture.units.length, checks: fixture.units.length - 1 });
  });

  it('rejects unknown query parameters', async () => {
    expectApiError(await request(ctx.app).get('/api/health?debug=1'), 400, 'VALIDATION');
  });
});

describe('JSON-only errors', () => {
  const ctx = useApi();

  it('unknown routes answer JSON 404, never HTML', async () => {
    const res = await request(ctx.app).get('/nope');
    expectApiError(res, 404, 'NOT_FOUND');
    expect(res.text).not.toMatch(/<html|<!DOCTYPE/i);
    expectApiError(await request(ctx.app).get('/api/nope'), 404, 'NOT_FOUND');
  });

  it('malformed JSON body -> 400 BAD_JSON', async () => {
    const res = await request(ctx.app)
      .post(`/api/units/${ctx.id('fixture:quiz-typeof')}/run`)
      .set('content-type', 'application/json')
      .send('{"answer": ');
    expectApiError(res, 400, 'BAD_JSON');
  });

  it('oversized body -> 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(ctx.app)
      .post(`/api/units/${ctx.id('fixture:drill-add')}/run`)
      .send({ code: 'x'.repeat(300 * 1024) });
    expectApiError(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('toPlain strips null prototypes and BigInt (row hygiene)', () => {
    const row = Object.assign(Object.create(null) as object, { id: 5n, nested: Object.assign(Object.create(null) as object, { n: 2n }) });
    const plain = toPlain({ rows: [row] }) as { rows: { id: number; nested: { n: number } }[] };
    expect(Object.getPrototypeOf(plain.rows[0])).toBe(Object.prototype);
    expect(plain).toEqual({ rows: [{ id: 5, nested: { n: 2 } }] });
    expect(() => toPlain(2n ** 60n)).toThrow(RangeError);
  });
});

describe('tracks', () => {
  const ctx = useApi();

  it('lists all four tracks with Java locked', async () => {
    const res = await request(ctx.app).get('/api/tracks');
    expect(res.status).toBe(200);
    const body = TracksResponse.parse(res.body);
    expect(body.tracks.map((t) => [t.id, t.locked])).toEqual([
      ['js', false],
      ['csharp', false],
      ['java', true],
      ['agentic', false],
    ]);
    expect(body.tracks.find((t) => t.id === 'js')!.unitCount).toBe(5);
  });

  it('track units carry lock states: Java locked, prerequisites gate successors', async () => {
    const java = TrackUnitsResponse.parse((await request(ctx.app).get('/api/tracks/java/units')).body);
    expect(java.units.length).toBe(1);
    expect(java.units.every((u) => u.state === 'locked')).toBe(true);

    const js = TrackUnitsResponse.parse((await request(ctx.app).get('/api/tracks/js/units')).body);
    const mul = js.units.find((u) => u.key === 'fixture:drill-mul')!;
    expect(mul.state).toBe('locked');
    expect(mul.prerequisites).toEqual([ctx.id('fixture:drill-add')]);

    await request(ctx.app).post(`/api/units/${ctx.id('fixture:drill-add')}/submit`).send({ code: fixture.submissions.addRight });
    const after = TrackUnitsResponse.parse((await request(ctx.app).get('/api/tracks/js/units')).body);
    expect(after.units.find((u) => u.key === 'fixture:drill-add')!.state).toBe('done');
    expect(after.units.find((u) => u.key === 'fixture:drill-mul')!.state).toBe('available');
  });

  it('rejects an unknown track id', async () => {
    expectApiError(await request(ctx.app).get('/api/tracks/python/units'), 400, 'VALIDATION');
  });

  it('a locked track refuses submit and run', async () => {
    const id = ctx.id('fixture:java-quiz');
    expectApiError(await request(ctx.app).post(`/api/units/${id}/submit`).send({ answer: 0 }), 403, 'TRACK_LOCKED');
    expectApiError(await request(ctx.app).post(`/api/units/${id}/run`).send({ answer: 0 }), 403, 'TRACK_LOCKED');
  });
});

describe('GET /api/units/:id', () => {
  const ctx = useApi();

  it('returns the unit, its PUBLIC check and starter', async () => {
    const res = await request(ctx.app).get(`/api/units/${ctx.id('fixture:drill-add')}`);
    expect(res.status).toBe(200);
    const body = UnitDetailResponse.parse(res.body);
    expect(body.unit).toMatchObject({ key: 'fixture:drill-add', kind: 'drill', difficulty: 2, state: 'available', revealed: false });
    expect(body.unit.competencies).toEqual(['language-fluency', 'testing-verification']);
    expect(body.check!.spec).toEqual({
      type: 'drill-js',
      language: 'js',
      tests: [{ name: 'adds positives' }, { name: 'adds negatives' }],
      timeoutMs: 8000,
    });
    expect(body.starter).toBe(fixture.content['fixture:drill-add']!.starter);
  });

  it('a unit without a check returns check: null', async () => {
    const body = UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${ctx.id('fixture:no-check')}`)).body);
    expect(body.check).toBeNull();
  });

  it('validates the id and 404s a missing unit', async () => {
    expectApiError(await request(ctx.app).get('/api/units/abc'), 400, 'VALIDATION');
    expectApiError(await request(ctx.app).get('/api/units/0'), 400, 'VALIDATION');
    expectApiError(await request(ctx.app).get('/api/units/99999'), 404, 'NOT_FOUND');
  });

  it('NO-LEAK: no answer key, expected output, test code or solution ever appears before reveal', async () => {
    for (const u of fixture.units) {
      const res = await request(ctx.app).get(`/api/units/${ctx.id(u.key)}`);
      expect(res.status).toBe(200);
      for (const marker of fixture.markers) expect(res.text, `${u.key} leaks ${marker}`).not.toContain(marker);
      const keys = new Set<string>();
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
      };
      walk(res.body);
      for (const k of ['answerKey', 'expected', 'solution', 'input']) expect(keys.has(k), `${u.key} exposes key ${k}`).toBe(false);
      // `code` is the unit's short code (e.g. 'U02') at unit level only — never inside the check
      expect(JSON.stringify(res.body.check ?? {})).not.toMatch(/"code"/);
    }
    // the solution endpoint is closed until the reveal row exists
    expectApiError(await request(ctx.app).get(`/api/units/${ctx.id('fixture:drill-add')}/solution`), 403, 'NOT_REVEALED');
  });
});

describe('POST /api/units/:id/run (free, unlimited, NOT logged)', () => {
  const ctx = useApi();

  it('drills run free and unlogged; quiz / predict-output are submit-only (no answer oracle)', async () => {
    const before = ledgerCounts(ctx.db);
    const drill = ctx.id('fixture:drill-add');
    const ok = RunResponse.parse((await request(ctx.app).post(`/api/units/${drill}/run`).send({ code: fixture.submissions.addRight })).body);
    expect(ok.result.pass).toBe(true);
    const bad = RunResponse.parse((await request(ctx.app).post(`/api/units/${drill}/run`).send({ code: fixture.submissions.addWrong })).body);
    expect(bad.result.pass).toBe(false);

    for (const key of ['fixture:quiz-typeof', 'fixture:quiz-exact', 'fixture:predict-log']) {
      for (const answer of [0, 1, 2, 'guess', 'EXPECTED_MARKER_out\n42']) {
        const res = await request(ctx.app).post(`/api/units/${ctx.id(key)}/run`).send({ answer });
        expectApiError(res, 409, 'RUN_NOT_AVAILABLE');
        for (const marker of fixture.markers) expect(res.text).not.toContain(marker);
      }
    }

    expect(ledgerCounts(ctx.db)).toEqual(before);
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM daily_slate')!.n).toBe(0);
  });

  it('predict-output submit still normalizes CRLF + trailing spaces and never echoes the expected output', async () => {
    const predict = ctx.id('fixture:predict-log');
    const p = await request(ctx.app).post(`/api/units/${predict}/submit`).send({ answer: 'nope' });
    expect(SubmitResponse.parse(p.body).verdict).toBe('fail');
    for (const marker of fixture.markers) expect(p.text).not.toContain(marker);
    const pOk = await request(ctx.app).post(`/api/units/${predict}/submit`).send({ answer: 'EXPECTED_MARKER_out  \r\n42\n' });
    expect(SubmitResponse.parse(pOk.body).verdict).toBe('pass');
  });

  it('validates the body: exactly one of code/answer, strict keys, no client-supplied grading fields', async () => {
    const id = ctx.id('fixture:quiz-typeof');
    for (const body of [{}, { code: 'x', answer: 1 }, { answer: 1, verified: true }, { answer: 1, xp: 99 }, { answer: 1, difficulty: 5 }, { answer: -1 }]) {
      expectApiError(await request(ctx.app).post(`/api/units/${id}/run`).send(body), 400, 'VALIDATION');
      expectApiError(await request(ctx.app).post(`/api/units/${id}/submit`).send(body), 400, 'VALIDATION');
    }
    // wrong shape for the check type (rejected before anything is written)
    const before = ledgerCounts(ctx.db);
    expectApiError(await request(ctx.app).post(`/api/units/${id}/submit`).send({ code: 'export const x = 1' }), 400, 'VALIDATION');
    expect(ledgerCounts(ctx.db)).toEqual(before);
  });

  it('409 NO_CHECK for a unit without a check, 404 for a missing unit', async () => {
    expectApiError(await request(ctx.app).post(`/api/units/${ctx.id('fixture:no-check')}/run`).send({ answer: 'x' }), 409, 'NO_CHECK');
    expectApiError(await request(ctx.app).post('/api/units/4242/run').send({ answer: 'x' }), 404, 'NOT_FOUND');
  });
});

describe('POST /api/units/:id/submit', () => {
  const ctx = useApi();

  it('wrong submit is recorded (attempt + run + evidence) but earns nothing', async () => {
    const id = ctx.id('fixture:quiz-typeof');
    const res = await request(ctx.app).post(`/api/units/${id}/submit`).send({ answer: 2 });
    expect(res.status).toBe(200);
    const body = SubmitResponse.parse(res.body);
    expect(body.verdict).toBe('fail');
    expect(body.xp).toBeNull();
    expect(body.attempt).toMatchObject({ mode: 'solo', outcome: 'fail' });
    expect(ledgerCounts(ctx.db)).toEqual({ attempt: 1, run: 1, xp_event: 0, evidence: 1 });
    const ev = ctx.db.get<{ verified: boolean; assistance: string; kind: string }>('SELECT verified, assistance, kind FROM evidence');
    expect(ev).toEqual({ verified: false, assistance: 'none', kind: 'submit' });
  });

  it('awards XP once, then already-awarded 0', async () => {
    const id = ctx.id('fixture:quiz-typeof');
    const first = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ answer: 1 })).body);
    expect(first.verdict).toBe('pass');
    expect(first.xp).toMatchObject({ amount: 2, reason: null });
    const second = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ answer: 1 })).body);
    expect(second.xp).toMatchObject({ amount: 0, reason: 'already-awarded' });
    const runs = ctx.db.all<{ kind: string; verdict: string }>('SELECT kind, verdict FROM run ORDER BY id');
    expect(runs).toEqual([
      { kind: 'submit', verdict: 'pass' },
      { kind: 'submit', verdict: 'pass' },
    ]);
  });

  it('code XP is 10 x the unit row difficulty (never client-supplied) and evidence is written per competency', async () => {
    const id = ctx.id('fixture:drill-add');
    const body = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ code: fixture.submissions.addRight })).body);
    expect(body.xp).toMatchObject({ amount: 20, reason: null });
    expect(body.evidenceIds).toHaveLength(2);
    const ev = ctx.db.all<{ competency_id: string; verified: boolean; assessor: string }>('SELECT competency_id, verified, assessor FROM evidence ORDER BY id');
    expect(ev).toEqual([
      { competency_id: 'language-fluency', verified: true, assessor: 'pipeline' },
      { competency_id: 'testing-verification', verified: true, assessor: 'pipeline' },
    ]);
  });

  it('self-assist flag only ever downgrades: attempt becomes assisted, evidence carries it', async () => {
    const id = ctx.id('fixture:quiz-typeof');
    const body = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ answer: 1, selfAssisted: true })).body);
    expect(body.attempt.mode).toBe('assisted');
    expect(ctx.db.get<{ assistance: string }>('SELECT assistance FROM evidence')!.assistance).toBe('self');
  });

  it('five first-ever DRILL passes on a track tick its slate slot; five quiz passes do not', async () => {
    for (let i = 0; i < 5; i++) {
      const id = insertUnit(
        ctx.db,
        { key: `slate:q${i}`, track: 'csharp', kind: 'quiz', title: `q${i}`, checks: [{ spec: { type: 'quiz', itemKey: `s${i}`, grading: 'choice', answerKey: 0, choices: ['a', 'b'] } }] },
        ctx.clock,
      );
      expect(SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ answer: 0 })).body).verdict).toBe('pass');
    }
    let dash = DashboardResponse.parse((await request(ctx.app).get('/api/dashboard')).body);
    expect(dash.slate.items.find((i) => i.slot === 'drill:csharp')!.done).toBe(false);

    for (let i = 0; i < 5; i++) {
      const id = insertUnit(
        ctx.db,
        { key: `slate:d${i}`, track: 'csharp', kind: 'drill', title: `d${i}`, difficulty: 1, checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'x' }] } }] },
        ctx.clock,
      );
      await request(ctx.app).post(`/api/units/${id}/submit`).send({ code: 'a + b' });
    }
    dash = DashboardResponse.parse((await request(ctx.app).get('/api/dashboard')).body);
    expect(dash.slate.items.find((i) => i.slot === 'drill:csharp')!.done).toBe(true);
    expect(dash.slate.items.find((i) => i.slot === 'drill:js')!.done).toBe(false);
  });
});

describe('POST /api/units/:id/self-attest (reading units only)', () => {
  const ctx = useApi();

  function readingUnit(): number {
    return insertUnit(ctx.db, { key: 'fixture:reading', track: 'js', kind: 'reading', title: 'read the guide' }, ctx.clock);
  }

  it('pays 5 XP once, writes one solo attempt, then 409 ALREADY_ATTESTED', async () => {
    const id = readingUnit();
    const first = SelfAttestResponse.parse((await request(ctx.app).post(`/api/units/${id}/self-attest`).send()).body);
    expect(first.xp).toMatchObject({ amount: 5, reason: null });
    expect(ctx.db.get('SELECT mode, outcome, check_id FROM attempt WHERE id = ?', first.attemptId)).toEqual({ mode: 'solo', outcome: 'pass', check_id: null });
    const before = ledgerCounts(ctx.db);
    expectApiError(await request(ctx.app).post(`/api/units/${id}/self-attest`).send(), 409, 'ALREADY_ATTESTED');
    expect(ledgerCounts(ctx.db)).toEqual(before);
    const units = TrackUnitsResponse.parse((await request(ctx.app).get('/api/tracks/js/units')).body);
    expect(units.units.find((u) => u.id === id)!.state).toBe('done');
  });

  it('is refused on non-reading units, locked tracks, unknown units, and with any body/query', async () => {
    const before = ledgerCounts(ctx.db);
    expectApiError(await request(ctx.app).post(`/api/units/${ctx.id('fixture:drill-add')}/self-attest`).send(), 409, 'WRONG_UNIT_KIND');
    expectApiError(await request(ctx.app).post(`/api/units/${ctx.id('fixture:java-quiz')}/self-attest`).send(), 403, 'TRACK_LOCKED');
    expectApiError(await request(ctx.app).post('/api/units/4242/self-attest').send(), 404, 'NOT_FOUND');
    const id = readingUnit();
    expectApiError(await request(ctx.app).post(`/api/units/${id}/self-attest`).send({ xp: 50 }), 400, 'VALIDATION');
    expectApiError(await request(ctx.app).post(`/api/units/${id}/self-attest?force=1`).send(), 400, 'VALIDATION');
    expect(ledgerCounts(ctx.db)).toEqual(before);
  });
});

describe('POST /api/units/:id/reveal', () => {
  const ctx = useApi();

  it('reveal writes the guided row, then returns the solution; a later correct submit earns 0 XP', async () => {
    const id = ctx.id('fixture:drill-add');
    expect(ledgerCounts(ctx.db).attempt).toBe(0);
    const res = await request(ctx.app).post(`/api/units/${id}/reveal`).send();
    expect(res.status).toBe(200);
    const body = RevealResponse.parse(res.body);
    expect(body.solution).toEqual({ kind: 'code', code: fixture.content['fixture:drill-add']!.solution });
    const row = ctx.db.get<{ id: number; mode: string; outcome: string; assistance_source: string }>(
      'SELECT id, mode, outcome, assistance_source FROM attempt WHERE unit_id = ?',
      id,
    );
    expect(row).toEqual({ id: body.attemptId, mode: 'guided', outcome: 'revealed', assistance_source: 'reveal' });

    // idempotent + solution endpoint now open
    const again = RevealResponse.parse((await request(ctx.app).post(`/api/units/${id}/reveal`).send()).body);
    expect(again.attemptId).toBe(body.attemptId);
    expect(RevealResponse.parse((await request(ctx.app).get(`/api/units/${id}/solution`)).body).solution).toEqual(body.solution);

    const sub = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ code: fixture.submissions.addRight })).body);
    expect(sub.verdict).toBe('pass');
    expect(sub.attempt.mode).toBe('guided');
    expect(sub.xp).toMatchObject({ amount: 0, reason: 'revealed' });
    const ev = ctx.db.all<{ assistance: string }>('SELECT assistance FROM evidence');
    expect(ev.every((e) => e.assistance === 'reveal')).toBe(true);
    const unit = UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${id}`)).body);
    expect(unit.unit.revealed).toBe(true);
  });

  it('quiz reveal returns the key; no solution in the store -> 404 and NO row written', async () => {
    const quiz = RevealResponse.parse((await request(ctx.app).post(`/api/units/${ctx.id('fixture:quiz-typeof')}/reveal`).send()).body);
    expect(quiz.solution).toEqual({ kind: 'answer', answer: 1, choice: '"object"' });

    const before = ledgerCounts(ctx.db);
    expectApiError(await request(ctx.app).post(`/api/units/${ctx.id('fixture:drill-mul')}/reveal`).send(), 404, 'NO_SOLUTION');
    expect(ledgerCounts(ctx.db)).toEqual(before);
  });

  it('rejects a reveal body with fields', async () => {
    expectApiError(await request(ctx.app).post(`/api/units/${ctx.id('fixture:quiz-typeof')}/reveal`).send({ force: true }), 400, 'VALIDATION');
  });
});

describe('written units: answer first (immutable), THEN the model answer (F9)', () => {
  const ctx = useApi();
  const MODEL = 'MODEL-ANSWER-MARKER: the check-then-act race on stock';

  function writtenApp() {
    const id = insertUnit(ctx.db, { key: 'fixture:written', track: 'js', kind: 'written', title: 'review a patch', competencies: ['code-reading'] }, ctx.clock);
    const app = createApp({
      db: ctx.db,
      clock: ctx.clock,
      runners: {},
      content: mapContentStore({
        ...fixture.content,
        'fixture:written': { instructions: 'Review the patch.', solution: MODEL, rubric: [{ id: 'race', label: 'Names the race' }] },
      }),
    });
    return { app, id };
  }

  it('403 NOT_ANSWERED before any answer; detail never leaks the model answer', async () => {
    const { app, id } = writtenApp();
    expectApiError(await request(app).get(`/api/units/${id}/model-answer`), 403, 'NOT_ANSWERED');
    const detail = await request(app).get(`/api/units/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.check).toBeNull();
    expect(detail.body.rubric).toEqual([{ id: 'race', label: 'Names the race' }]);
    expect(detail.text).not.toContain('MODEL-ANSWER-MARKER');
    // reveal / solution stay closed for written units (no check)
    expectApiError(await request(app).post(`/api/units/${id}/reveal`).send({}), 409, 'NO_CHECK');
    expect(ledgerCounts(ctx.db).attempt).toBe(0);
  });

  it('answer -> immutable submitted attempt (no grading, no XP, no evidence) -> model answer + rubric', async () => {
    const { app, id } = writtenApp();
    const before = ledgerCounts(ctx.db);
    const ans = await request(app).post(`/api/units/${id}/answer`).send({ answer: 'The stock check and decrement race under concurrency.' });
    expect(ans.status).toBe(200);
    const body = WrittenAnswerResponse.parse(ans.body);
    expect(body).toMatchObject({ mode: 'solo', outcome: 'submitted' });
    const after = ledgerCounts(ctx.db);
    expect(after).toEqual({ ...before, attempt: before.attempt + 1 }); // no run, no XP, no evidence
    const row = ctx.db.get<{ outcome: string; check_id: number | null; answer: string }>('SELECT outcome, check_id, answer FROM attempt WHERE id = ?', body.attemptId)!;
    expect(row).toEqual({ outcome: 'submitted', check_id: null, answer: JSON.stringify({ text: 'The stock check and decrement race under concurrency.' }) });
    // append-only: the stored answer cannot be rewritten after the key is seen
    expect(() => ctx.db.run('UPDATE attempt SET answer = ? WHERE id = ?', '{"text":"edited"}', body.attemptId)).toThrow();

    const m = await request(app).get(`/api/units/${id}/model-answer`);
    expect(m.status).toBe(200);
    expect(ModelAnswerResponse.parse(m.body)).toEqual({ attemptId: body.attemptId, modelAnswer: MODEL, rubric: [{ id: 'race', label: 'Names the race' }] });
    // a later answer is a NEW row; the model answer stays anchored on the first one
    const second = await request(app).post(`/api/units/${id}/answer`).send({ answer: 'second try' });
    expect(second.body.attemptId).toBeGreaterThan(body.attemptId);
    expect((await request(app).get(`/api/units/${id}/model-answer`)).body.attemptId).toBe(body.attemptId);
  });

  it('refuses empty / whitespace answers (nothing written), extra fields, non-written units and missing units', async () => {
    const { app, id } = writtenApp();
    for (const bad of [{}, { answer: '' }, { answer: '   \n\t ' }, { answer: 'x', xp: 50 }, { answer: 42 }, { answer: 'x'.repeat(20_001) }]) {
      expectApiError(await request(app).post(`/api/units/${id}/answer`).send(bad), 400, 'VALIDATION');
    }
    expect(ledgerCounts(ctx.db).attempt).toBe(0);
    expectApiError(await request(app).get(`/api/units/${id}/model-answer`), 403, 'NOT_ANSWERED');
    const drill = ctx.id(fixture.units[0]!.key);
    expectApiError(await request(app).post(`/api/units/${drill}/answer`).send({ answer: 'x' }), 409, 'WRONG_UNIT_KIND');
    expectApiError(await request(app).get(`/api/units/${drill}/model-answer`), 409, 'WRONG_UNIT_KIND');
    expectApiError(await request(app).post('/api/units/999999/answer').send({ answer: 'x' }), 404, 'NOT_FOUND');
    expectApiError(await request(app).get('/api/units/999999/model-answer'), 404, 'NOT_FOUND');
    expectApiError(await request(app).get(`/api/units/${id}/model-answer?peek=1`), 400, 'VALIDATION');
  });

  it('a raw empty-text submitted attempt (not via the API) does not unlock the model answer', async () => {
    const { app, id } = writtenApp();
    ctx.db.run(
      `INSERT INTO attempt (unit_id, check_id, mode, assisted, assistance_source, outcome, answer, created_at) VALUES (?, NULL, 'solo', 0, 'none', 'submitted', ?, 0)`,
      id,
      JSON.stringify({ text: '  ' }),
    );
    expectApiError(await request(app).get(`/api/units/${id}/model-answer`), 403, 'NOT_ANSWERED');
  });
});

describe('reviews', () => {
  const ctx = useApi();

  it('queue lists due items; grading moves due_at forward and logs', async () => {
    const item = addReviewItem(ctx.db, { cardKey: 'card:a' }, ctx.clock);
    const q = ReviewQueueResponse.parse((await request(ctx.app).get('/api/reviews/queue')).body);
    expect(q.count).toBe(1);
    expect(q.items[0]).toMatchObject({ id: item.id, cardKey: 'card:a', kind: 'card' });

    const g = GradeResponse.parse((await request(ctx.app).post(`/api/reviews/${item.id}/grade`).send({ grade: 'good' })).body);
    expect(g.nextDueAt).toBeGreaterThan(g.prevDueAt);
    expect(g.xp).toMatchObject({ amount: 1, reason: null });
    expect(g.remainingDue).toBe(0);
    expect(ctx.db.get<{ due_at: number }>('SELECT due_at FROM review_item WHERE id = ?', item.id)!.due_at).toBe(g.nextDueAt);
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_log')!.n).toBe(1);
    expect(ReviewQueueResponse.parse((await request(ctx.app).get('/api/reviews/queue')).body).count).toBe(0);

    // clearing the queue ticks the slate's review slot
    const dash = DashboardResponse.parse((await request(ctx.app).get('/api/dashboard')).body);
    expect(dash.slate.items.find((i) => i.slot === 'review')!.done).toBe(true);
  });

  it('review XP caps at 30/day (clock-injected) and resets the next day', async () => {
    const items = Array.from({ length: 32 }, (_, i) => addReviewItem(ctx.db, { cardKey: `cap:${i}` }, ctx.clock));
    const amounts: number[] = [];
    for (const it of items.slice(0, 31)) {
      const g = GradeResponse.parse((await request(ctx.app).post(`/api/reviews/${it.id}/grade`).send({ grade: 'good' })).body);
      amounts.push(g.xp.amount);
      if (g.xp.amount === 0) expect(g.xp.reason).toBe('daily-cap');
    }
    expect(amounts.slice(0, 30).every((a) => a === 1)).toBe(true);
    expect(amounts[30]).toBe(0);

    ctx.clock.advance(DAY_MS);
    const next = GradeResponse.parse((await request(ctx.app).post(`/api/reviews/${items[31]!.id}/grade`).send({ grade: 'easy' })).body);
    expect(next.xp.amount).toBe(1);
  });

  it('a lapse (Again on a Review-state card) on a competency-linked item triggers the demotion hook', async () => {
    promoteTo(ctx.db, ctx.clock, 'data-http', 3);
    const item = addReviewItem(ctx.db, { cardKey: 'card:demote', competencyId: 'data-http' }, ctx.clock);
    graduate(ctx.db, ctx.clock, item.id);
    const g = GradeResponse.parse((await request(ctx.app).post(`/api/reviews/${item.id}/grade`).send({ grade: 'again' })).body);
    expect(g.demotion).toMatchObject({ competency: 'data-http', from: 3, to: 2 });
    expect(ctx.db.get<{ kind: string }>('SELECT kind FROM evidence WHERE id = ?', g.demotion!.evidenceId)!.kind).toBe('demotion');
  });

  it('Again on a first-sight card does not demote; every linked review writes evidence', async () => {
    promoteTo(ctx.db, ctx.clock, 'data-http', 2);
    const item = addReviewItem(ctx.db, { cardKey: 'card:new', competencyId: 'data-http' }, ctx.clock);
    const g = GradeResponse.parse((await request(ctx.app).post(`/api/reviews/${item.id}/grade`).send({ grade: 'again' })).body);
    expect(g.demotion).toBeNull();
    expect(getRating(ctx.db, 'data-http')).toBe(2);
    expect(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM evidence WHERE kind = 'review' AND competency_id = 'data-http'`)!.n).toBe(1);
  });

  it('grading a card that is not due yet -> 409 NOT_DUE, nothing written', async () => {
    const item = addReviewItem(ctx.db, { cardKey: 'card:early' }, ctx.clock);
    await request(ctx.app).post(`/api/reviews/${item.id}/grade`).send({ grade: 'easy' });
    const before = ledgerCounts(ctx.db);
    expectApiError(await request(ctx.app).post(`/api/reviews/${item.id}/grade`).send({ grade: 'easy' }), 409, 'NOT_DUE');
    expect(ledgerCounts(ctx.db)).toEqual(before);
  });

  it('validates grade, item id and query', async () => {
    const item = addReviewItem(ctx.db, { cardKey: 'card:v' }, ctx.clock);
    expectApiError(await request(ctx.app).post(`/api/reviews/${item.id}/grade`).send({ grade: 'great' }), 400, 'VALIDATION');
    expectApiError(await request(ctx.app).post(`/api/reviews/${item.id}/grade`).send({ grade: 'good', xp: 5 }), 400, 'VALIDATION');
    expectApiError(await request(ctx.app).post('/api/reviews/777/grade').send({ grade: 'good' }), 404, 'NOT_FOUND');
    expectApiError(await request(ctx.app).get('/api/reviews/queue?limit=0'), 400, 'VALIDATION');
    expectApiError(await request(ctx.app).get('/api/reviews/queue?sort=x'), 400, 'VALIDATION');
    const limited = ReviewQueueResponse.parse((await request(ctx.app).get('/api/reviews/queue?limit=1')).body);
    expect(limited.items).toHaveLength(1);
  });
});

describe('GET /api/dashboard', () => {
  const ctx = useApi();

  it('assembles streak, 120-day heatmap, XP/level, 7 competencies, slate, review count, next-up', async () => {
    await request(ctx.app).post(`/api/units/${ctx.id('fixture:drill-add')}/submit`).send({ code: fixture.submissions.addRight });
    addReviewItem(ctx.db, { cardKey: 'card:dash' }, ctx.clock);
    const res = await request(ctx.app).get('/api/dashboard');
    expect(res.status).toBe(200);
    const d = DashboardResponse.parse(res.body);
    expect(d.today).toBe('2026-10-01');
    expect(d.heatmap).toHaveLength(120);
    expect(d.heatmap.at(-1)).toEqual({ day: '2026-10-01', xp: 20, status: 'open' });
    expect(d.heatmap[0]!.day).toBe('2026-06-04');
    expect(d.xp).toEqual({ total: 20, level: 1, intoLevel: 20, levelSpan: 150, nextAt: 150 });
    expect(d.competencies).toHaveLength(7);
    const lf = d.competencies.find((c) => c.id === 'language-fluency')!;
    expect(lf.rating).toBe(1);
    expect(lf.lastEvidence).toMatchObject({ kind: 'submit' });
    expect(d.competencies.find((c) => c.id === 'communication')!.lastEvidence).toBeNull();
    expect(d.reviewQueue.due).toBe(1);
    // no campaign quests are seeded: the campaign slot is absent rather than impossible
    expect(d.slate.items.map((i) => i.slot)).toEqual(['drill:js', 'drill:csharp', 'review']);
    expect(d.nextUp.map((n) => n.trackId)).toEqual(['js', 'csharp', 'agentic']); // Java locked -> absent
    expect(d.nextUp.find((n) => n.trackId === 'js')!.unit!.key).toBe('fixture:quiz-typeof');
    expect(d.streak).toMatchObject({ current: 0, tokens: 0, todayComplete: false });
  });

  it('streak and heatmap close elapsed days under the injected clock', async () => {
    await request(ctx.app).post(`/api/units/${ctx.id('fixture:drill-add')}/submit`).send({ code: fixture.submissions.addRight });
    await request(ctx.app).post(`/api/units/${ctx.id('fixture:drill-mul')}/submit`).send({ code: 'export const mul = (a, b) => a * b;' });
    ctx.clock.advance(DAY_MS);
    const d = DashboardResponse.parse((await request(ctx.app).get('/api/dashboard')).body);
    expect(d.today).toBe('2026-10-02');
    expect(d.heatmap.at(-2)).toEqual({ day: '2026-10-01', xp: 30, status: 'partial' }); // 30 XP, no full slate
    expect(d.streak.current).toBe(0);
  });

  it('a full drill + review day (no campaign seeded) is a slate day: streak 1 the next day', async () => {
    const card = addReviewItem(ctx.db, { cardKey: 'card:streak' }, ctx.clock);
    for (const track of ['js', 'csharp']) {
      for (let i = 0; i < 5; i++) {
        const id = insertUnit(
          ctx.db,
          { key: `streak:${track}:${i}`, track, kind: 'drill', title: `d${i}`, difficulty: 1, checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'x' }] } }] },
          ctx.clock,
        );
        expect(SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ code: 'a + b' })).body).verdict).toBe('pass');
      }
    }
    let d = DashboardResponse.parse((await request(ctx.app).get('/api/dashboard')).body);
    expect(d.streak.todayComplete).toBe(false); // the review queue is not clear yet
    await request(ctx.app).post(`/api/reviews/${card.id}/grade`).send({ grade: 'good' });
    d = DashboardResponse.parse((await request(ctx.app).get('/api/dashboard')).body);
    expect(d.slate.items.every((i) => i.done)).toBe(true);
    expect(d.streak).toMatchObject({ current: 1, todayComplete: true });
    ctx.clock.advance(DAY_MS);
    d = DashboardResponse.parse((await request(ctx.app).get('/api/dashboard')).body);
    expect(d.streak).toMatchObject({ current: 1, todayComplete: false });
    expect(d.heatmap.at(-2)!.status).toBe('slate');
  });
});
