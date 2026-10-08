import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  ApiErrorBody,
  DashboardResponse,
  GradeResponse,
  HealthResponse,
  ReviewQueueResponse,
  RevealResponse,
  RunResponse,
  SubmitResponse,
  TrackUnitsResponse,
  TracksResponse,
  UnitDetailResponse,
} from '@bootquest/shared/api';
import { DAY_MS } from '../../src/engines/clock.ts';
import { addReviewItem } from '../../src/engines/fsrs.ts';
import { toPlain } from '../../src/api/http.ts';
import { insertUnit } from '../../src/store/content.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
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

  it('grades quiz / predict deterministically and writes no rows', async () => {
    const before = ledgerCounts(ctx.db);
    const quiz = ctx.id('fixture:quiz-typeof');
    const right = RunResponse.parse((await request(ctx.app).post(`/api/units/${quiz}/run`).send({ answer: 1 })).body);
    expect(right.result).toEqual({ pass: true, output: '', failures: [], durationMs: 0 });
    const wrong = RunResponse.parse((await request(ctx.app).post(`/api/units/${quiz}/run`).send({ answer: 0 })).body);
    expect(wrong.result.pass).toBe(false);

    const predict = ctx.id('fixture:predict-log');
    const p = await request(ctx.app).post(`/api/units/${predict}/run`).send({ answer: 'nope' });
    expect(RunResponse.parse(p.body).result.pass).toBe(false);
    for (const marker of fixture.markers) expect(p.text).not.toContain(marker); // failures never echo the expected output
    const pOk = await request(ctx.app).post(`/api/units/${predict}/run`).send({ answer: 'EXPECTED_MARKER_out  \r\n42\n' });
    expect(RunResponse.parse(pOk.body).result.pass).toBe(true); // CRLF + trailing-space normalization

    const exact = await request(ctx.app).post(`/api/units/${ctx.id('fixture:quiz-exact')}/run`).send({ answer: 'guess' });
    expect(exact.text).not.toContain('ANSWERKEY_MARKER_q2');

    expect(ledgerCounts(ctx.db)).toEqual(before);
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM daily_slate')!.n).toBe(0);
  });

  it('validates the body: exactly one of code/answer, strict keys, no client-supplied grading fields', async () => {
    const id = ctx.id('fixture:quiz-typeof');
    for (const body of [{}, { code: 'x', answer: 1 }, { answer: 1, verified: true }, { answer: 1, xp: 99 }, { answer: 1, difficulty: 5 }, { answer: -1 }]) {
      expectApiError(await request(ctx.app).post(`/api/units/${id}/run`).send(body), 400, 'VALIDATION');
    }
    // wrong shape for the check type
    expectApiError(await request(ctx.app).post(`/api/units/${id}/run`).send({ code: 'export const x = 1' }), 400, 'VALIDATION');
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

  it('five passes on a track tick the slate drill-set slot (derived from attempts)', async () => {
    for (let i = 0; i < 5; i++) {
      const id = insertUnit(
        ctx.db,
        { key: `slate:q${i}`, track: 'csharp', kind: 'quiz', title: `q${i}`, checks: [{ spec: { type: 'quiz', itemKey: `s${i}`, grading: 'choice', answerKey: 0, choices: ['a', 'b'] } }] },
        ctx.clock,
      );
      await request(ctx.app).post(`/api/units/${id}/submit`).send({ answer: 0 });
    }
    const dash = DashboardResponse.parse((await request(ctx.app).get('/api/dashboard')).body);
    expect(dash.slate.items.find((i) => i.slot === 'drill:csharp')!.done).toBe(true);
    expect(dash.slate.items.find((i) => i.slot === 'drill:js')!.done).toBe(false);
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

  it('failed review on a competency-linked item triggers the demotion hook', async () => {
    const item = addReviewItem(ctx.db, { cardKey: 'card:demote', competencyId: 'data-http' }, ctx.clock);
    ctx.db.exec(`UPDATE competency_rating SET rating = 3 WHERE competency_id = 'data-http'`);
    const g = GradeResponse.parse((await request(ctx.app).post(`/api/reviews/${item.id}/grade`).send({ grade: 'again' })).body);
    expect(g.demotion).toMatchObject({ competency: 'data-http', from: 3, to: 2 });
    expect(ctx.db.get<{ kind: string }>('SELECT kind FROM evidence WHERE id = ?', g.demotion!.evidenceId)!.kind).toBe('demotion');
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
    expect(d.slate.items.map((i) => i.slot)).toEqual(['drill:js', 'drill:csharp', 'campaign', 'review']);
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
});
