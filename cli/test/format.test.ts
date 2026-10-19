import { XP_ZERO_REASONS } from '@bootquest/shared';
import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError, BadResponseError, DEFAULT_TIMEOUT_MS, type FetchLike, GRADE_TIMEOUT_MS, ServerTimeoutError, ServerUnreachableError, UsageError } from '../src/client.ts';
import { ConfigError } from '../src/config.ts';
import { describeValue, formatDashboard, formatError, formatFailures, formatRun, formatSubmit, formatXp, XP_ZERO_EXPLANATIONS } from '../src/format.ts';
import { dashboard, drillDetail, submitResp } from './helpers.ts';

describe('formatFailures', () => {
  it('numbers failures, shows message headline + expected/actual, and counts against total tests', () => {
    const text = formatFailures(
      [
        // the real drill runner shape: inspect strings + a multi-line assert diff
        { name: 'swap(1, 2)', message: 'Expected values to be strictly deep-equal:\n+ actual - expected\n\n+ undefined', expected: '[ 2, 1 ]', actual: 'undefined' },
        { name: 'swap("x", "y")', message: 'swap("x", "y")', expected: ['y', 'x'], actual: ['x', 'y'] },
      ],
      3,
    );
    expect(text).toBe(
      [
        'Failures (2 of 3 tests):',
        '  1. swap(1, 2)',
        '       Expected values to be strictly deep-equal:',
        '       expected: [ 2, 1 ]',
        '       actual:   undefined',
        '  2. swap("x", "y")',
        '       expected: ["y","x"]',
        '       actual:   ["x","y"]',
      ].join('\n'),
    );
  });

  it('is empty for no failures; total-less header otherwise', () => {
    expect(formatFailures([])).toBe('');
    expect(formatFailures([{ name: 'n', message: 'm' }])).toMatch(/^Failures \(1\):/);
  });

  it('indents multi-line messages and truncates huge values', () => {
    const text = formatFailures([{ name: 'n', message: 'line1\nline2' }]);
    expect(text).toContain('       line1\n       line2');
    expect(formatFailures([{ name: 'n', message: 'm', actual: 'z'.repeat(500) }])).toContain(`actual:   ${'z'.repeat(197)}...`);
    expect(describeValue('z'.repeat(500)).length).toBe(200);
    expect(describeValue(undefined)).toBe('undefined');
  });
});

describe('formatXp', () => {
  it('positive award', () => {
    expect(formatXp({ verdict: 'pass', xp: { id: 1, amount: 10, reason: null } })).toBe('XP: +10');
  });

  it.each(XP_ZERO_REASONS.map((r) => [r]))('zero reason "%s" is printed verbatim with a gloss', (reason) => {
    const line = formatXp({ verdict: 'pass', xp: { id: 1, amount: 0, reason } });
    expect(line.startsWith(`XP: +0 (reason: ${reason})`)).toBe(true);
    expect(XP_ZERO_EXPLANATIONS[reason]).toBeTruthy();
    expect(line).toContain(XP_ZERO_EXPLANATIONS[reason]!);
  });

  it('failed submit: no XP, says it cost nothing and was recorded', () => {
    expect(formatXp({ verdict: 'fail', xp: null })).toMatch(/none \(failed submits cost nothing and earn nothing; the attempt is recorded\)/);
  });
});

describe('formatSubmit / formatRun', () => {
  it('pass with XP', () => {
    const text = formatSubmit(drillDetail(), submitResp(), 'src/swap.js');
    expect(text).toContain('Submit: Swap two values (bootforge/js-fundamentals/values/variables/swap)');
    expect(text).toContain('Verdict: PASS (3/3 tests passing)');
    expect(text).toContain('Attempt #5 recorded (mode: solo, outcome: pass, 12ms)');
    expect(text).toContain('XP: +10');
  });

  it('assisted mode is spelled out', () => {
    const text = formatSubmit(drillDetail(), submitResp({ attempt: { id: 5, mode: 'assisted', outcome: 'pass' } }), 'f.js');
    expect(text).toContain('mode: assisted (you reported help)');
  });

  it('run output is shown, capped at 40 lines', () => {
    const output = Array.from({ length: 45 }, (_, i) => `log ${i}`).join('\n');
    const text = formatRun(drillDetail(), { pass: false, output, failures: [{ name: 'a', message: 'x' }], durationMs: 1 }, 'f.js');
    expect(text).toContain('Run (free, not recorded)');
    expect(text).toContain('Result: FAIL (2/3 tests passing)');
    expect(text).toContain('  log 39');
    expect(text).not.toContain('  log 40');
    expect(text).toContain('... (5 more lines)');
  });
});

describe('formatDashboard', () => {
  it('singular streak day', () => {
    const d = dashboard();
    d.streak.current = 1;
    expect(formatDashboard(d, 'http://x')).toMatch(/Streak: 1 day \(/);
  });
});

describe('formatError', () => {
  it('renders every error class without stack traces', () => {
    expect(formatError(new ServerUnreachableError('http://h:1', 'ECONNREFUSED'))).toMatch(/^Cannot reach the BootQuest server at http:\/\/h:1 \(ECONNREFUSED\)\.\nStart it/);
    const api = formatError(new ApiError(400, 'VALIDATION', 'invalid request body', [{ path: 'body.code', message: 'too long' }]));
    expect(api).toBe('Server refused (VALIDATION, HTTP 400): invalid request body\n  - body.code: too long');
    expect(formatError(new ApiError(403, 'TRACK_LOCKED', 'track java is locked'))).toMatch(/track java is locked\nThis track is locked/);
    expect(formatError(new ConfigError('bad'))).toBe('Config problem: bad');
    expect(formatError(new UsageError('use it right'))).toBe('use it right');
    expect(formatError(new BadResponseError('not json'))).toBe('not json');
    expect(formatError(new Error('weird'))).toBe('Unexpected error: weird');
  });
});

describe('timeouts are not "cannot reach the server"', () => {
  const timeoutErr = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const failing = (mk: () => Error): FetchLike => async () => {
    throw mk();
  };
  const body = { code: 'x' } as never;

  it('submit waits GRADE_TIMEOUT_MS (15 min) and a timeout says the server may still be grading -> run status first', async () => {
    expect(GRADE_TIMEOUT_MS).toBe(15 * 60_000);
    const c = new ApiClient('http://h:1', failing(timeoutErr));
    const err = await c.submit(21, body).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerTimeoutError);
    expect(err).not.toBeInstanceOf(ServerUnreachableError);
    expect(err).toMatchObject({ seconds: 900, recorded: true, method: 'POST', path: '/api/units/21/submit' });
    const text = formatError(err);
    expect(text).toMatch(/^No answer from the BootQuest server at http:\/\/h:1 within 900s \(POST \/api\/units\/21\/submit\)\./);
    expect(text).toMatch(/may still be grading.*run `bootquest status` before retrying/);
    expect(text).not.toMatch(/Cannot reach/);
  });

  it('run gets the long grade timeout too but records nothing; GETs keep the 120s default', async () => {
    const c = new ApiClient('http://h:1', failing(timeoutErr));
    const run = await c.run(21, body).catch((e: unknown) => e);
    expect(run).toMatchObject({ seconds: 900, recorded: false });
    expect(formatError(run)).toMatch(/nothing is recorded by this request, so it is safe to retry/);
    expect(await c.dashboard().catch((e: unknown) => e)).toMatchObject({ seconds: DEFAULT_TIMEOUT_MS / 1000, recorded: false, method: 'GET' });
  });

  it('a real AbortSignal deadline maps to ServerTimeoutError (headers or body)', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(init.signal!.reason as Error)));
    expect(await new ApiClient('http://h:1', hang, 30).health().catch((e: unknown) => e)).toBeInstanceOf(ServerTimeoutError);
    const slowBody: FetchLike = async (_url, init) => ({
      status: 200,
      ok: true,
      text: () => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(init.signal!.reason as Error))),
    });
    expect(await new ApiClient('http://h:1', slowBody, 30).health().catch((e: unknown) => e)).toBeInstanceOf(ServerTimeoutError);
  });

  it('connection refused keeps the "cannot reach" message (start the server)', async () => {
    const err = await new ApiClient('http://h:1', failing(refused)).submit(21, body).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerUnreachableError);
    expect(formatError(err)).toMatch(/^Cannot reach the BootQuest server at http:\/\/h:1 \(ECONNREFUSED\)\.\nStart it/);
  });
});
