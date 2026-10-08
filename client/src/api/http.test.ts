import { describe, expect, it } from 'vitest';
import { errorText } from './errors';
import { createHttpApi } from './http';
import { ApiError } from './types';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** A fetch double that records requests and answers from a route table. */
function fakeFetch(answer: (c: Call) => { status: number; body: unknown; raw?: boolean }) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const a = answer(call);
    const text = a.raw ? String(a.body) : JSON.stringify(a.body);
    return new Response(text, { status: a.status, headers: { 'content-type': a.raw ? 'text/html' : 'application/json' } });
  }) as typeof fetch;
  return { calls, impl };
}

const ok = (body: unknown = {}) => ({ status: 200, body });

describe('http client: real routes', () => {
  it('hits exactly the server route list', async () => {
    const { calls, impl } = fakeFetch(() => ok({ result: {}, solution: {} }));
    const api = createHttpApi('/api', impl);
    await api.getHealth();
    await api.getDashboard();
    await api.getTracks();
    await api.getTrackUnits('js');
    await api.getUnit(7);
    await api.runUnit(7, { code: 'x' });
    await api.submitUnit(7, { code: 'x', selfAssisted: false });
    await api.revealUnit(7);
    await api.getSolution(7);
    await api.selfAttest(7);
    await api.getReviewQueue();
    await api.getReviewQueue(1);
    await api.gradeReview(3, 'good');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/health',
      'GET /api/dashboard',
      'GET /api/tracks',
      'GET /api/tracks/js/units',
      'GET /api/units/7',
      'POST /api/units/7/run',
      'POST /api/units/7/submit',
      'POST /api/units/7/reveal',
      'GET /api/units/7/solution',
      'POST /api/units/7/self-attest',
      'GET /api/reviews/queue',
      'GET /api/reviews/queue?limit=1',
      'POST /api/reviews/3/grade',
    ]);
    // Strict bodies: reveal / self-attest send {}, grade sends {grade}.
    expect(calls[7]!.body).toEqual({});
    expect(calls[9]!.body).toEqual({});
    expect(calls[12]!.body).toEqual({ grade: 'good' });
  });

  it('hits the W6 ladder routes with whitelisted bodies', async () => {
    const { calls, impl } = fakeFetch(() => ok({}));
    const api = createHttpApi('/api', impl);
    await api.getCampaign('js');
    await api.answerExplainBack(5, { answers: ['a', 'b', 'c'], selfAssisted: false, extra: 1 } as never);
    await api.getExplainBackKey(5);
    await api.selfScoreExplainBack(5, { perKeyPoint: { q1k1: 'covered' } });
    await api.submitKataFindings(6, { findings: [{ scenario: 's', evidence: 'e', consequence: 'c', x: 1 } as never], selfAssisted: true });
    await api.getKataKey(6);
    await api.selfScoreKata(6, { perDefect: { d1: 'caught' } });
    await api.getCompetencies();
    await api.listEvidence({ competency: 'data-http', limit: 5 });
    await api.listEvidence();
    await api.getAttempt(9);
    await api.getKataStats();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/tracks/js/campaign',
      'POST /api/units/5/explain-back/answers',
      'GET /api/units/5/explain-back/key',
      'POST /api/units/5/explain-back/self-score',
      'POST /api/units/6/kata/findings',
      'GET /api/units/6/kata/key',
      'POST /api/units/6/kata/self-score',
      'GET /api/competencies',
      'GET /api/evidence?competency=data-http&limit=5',
      'GET /api/evidence',
      'GET /api/attempts/9',
      'GET /api/stats/katas',
    ]);
    expect(calls[1]!.body).toEqual({ answers: ['a', 'b', 'c'], selfAssisted: false });
    expect(calls[4]!.body).toEqual({ findings: [{ scenario: 's', evidence: 'e', consequence: 'c' }], selfAssisted: true });
  });

  it('submit sends only code|answer + boolean selfAssisted — never an assistance string', async () => {
    const { calls, impl } = fakeFetch(() => ok());
    const api = createHttpApi('/api', impl);
    await api.submitUnit(1, { code: 'c', selfAssisted: true });
    await api.submitUnit(2, { answer: 3, selfAssisted: false });
    // Even if a caller smuggles extra keys past the type system, the body is whitelisted.
    await api.submitUnit(3, { code: 'c', selfAssisted: false, assistance: 'none' } as never);
    expect(calls.map((c) => c.body)).toEqual([
      { code: 'c', selfAssisted: true },
      { answer: 3, selfAssisted: false },
      { code: 'c', selfAssisted: false },
    ]);
    for (const c of calls) expect(JSON.stringify(c.body)).not.toContain('assistance');
  });

  it('run sends only {code} or {answer}', async () => {
    const { calls, impl } = fakeFetch(() => ok({ result: {} }));
    const api = createHttpApi('/api', impl);
    await api.runUnit(1, { code: 'c' });
    expect(calls[0]!.body).toEqual({ code: 'c' });
  });
});

describe('http client: JSON error envelope', () => {
  const envelope = (status: number, code: string, message = 'msg') => ({ status, body: { error: { code, message } } });

  it.each([
    [409, 'RUN_NOT_AVAILABLE'],
    [403, 'TRACK_LOCKED'],
    [409, 'NOT_DUE'],
    [409, 'ALREADY_ATTESTED'],
    [404, 'NO_SOLUTION'],
    [404, 'NOT_FOUND'],
  ])('%d %s surfaces as ApiError with that code', async (status, code) => {
    const { impl } = fakeFetch(() => envelope(status, code));
    const err = await createHttpApi('/api', impl)
      .getUnit(1)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status, code, message: 'msg' });
  });

  it('a 404 NOT_FOUND and a 404 NO_SOLUTION are distinguishable (W-3)', async () => {
    const { impl } = fakeFetch((c) => (c.url.endsWith('/solution') ? envelope(404, 'NO_SOLUTION') : envelope(404, 'NOT_FOUND')));
    const api = createHttpApi('/api', impl);
    await expect(api.getSolution(1)).rejects.toMatchObject({ code: 'NO_SOLUTION' });
    await expect(api.getUnit(1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps validation issues', async () => {
    const { impl } = fakeFetch(() => ({ status: 400, body: { error: { code: 'VALIDATION', message: 'bad', issues: [{ path: 'body', message: 'x' }] } } }));
    await expect(createHttpApi('/api', impl).submitUnit(1, { code: '', selfAssisted: false })).rejects.toMatchObject({
      code: 'VALIDATION',
      issues: [{ path: 'body', message: 'x' }],
    });
  });

  it('a non-JSON error body (proxy page) becomes BAD_RESPONSE, a network failure NETWORK', async () => {
    const { impl } = fakeFetch(() => ({ status: 502, body: '<html>Bad gateway</html>', raw: true }));
    await expect(createHttpApi('/api', impl).getDashboard()).rejects.toMatchObject({ status: 502, code: 'BAD_RESPONSE' });
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(createHttpApi('/api', down).getDashboard()).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('errorText gives friendly text for the surfaced codes', () => {
    expect(errorText(new ApiError(409, 'RUN_NOT_AVAILABLE', 'quiz checks are submit-only'))).toMatch(/Submit instead.*RUN_NOT_AVAILABLE/);
    expect(errorText(new ApiError(403, 'TRACK_LOCKED', 'x'))).toMatch(/track is locked/);
    expect(errorText(new ApiError(409, 'NOT_DUE', 'x'))).toMatch(/not due/);
    expect(errorText(new ApiError(409, 'ALREADY_ATTESTED', 'x'))).toMatch(/Already marked as read/);
    expect(errorText(new ApiError(500, 'INTERNAL', 'boom'))).toBe('boom (INTERNAL)');
  });
});
