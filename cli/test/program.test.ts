import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SERVER } from '../src/client.ts';
import { EXIT, MAX_CODE_CHARS, runCli } from '../src/program.ts';
import { captureIo, dashboard, drillDetail, fakeFetch, httpDetail, quizDetail, repoDetail, submitResp } from './helpers.ts';

let proj: string;
beforeEach(() => {
  proj = mkdtempSync(join(tmpdir(), 'bq-cli-prog-'));
  writeFileSync(join(proj, '.bootquest.json'), JSON.stringify({ unitId: 12, file: 'src/swap.js' }));
  mkdirSync(join(proj, 'src'));
  writeFileSync(join(proj, 'src', 'swap.js'), 'export function swap(a, b) { return [b, a]; }\n');
});
afterEach(() => {
  rmSync(proj, { recursive: true, force: true });
});

const baseRoutes = () => ({
  'GET /api/units/12': { status: 200, body: drillDetail() },
  'GET /api/units/3': { status: 200, body: quizDetail() },
  'GET /api/units/21': { status: 200, body: httpDetail() },
  'GET /api/units/22': { status: 200, body: repoDetail() },
  'POST /api/units/21/run': { status: 200, body: { result: { pass: true, output: 'PASS health', failures: [], durationMs: 9 } } },
  'POST /api/units/21/submit': {
    status: 200,
    body: submitResp({
      verdict: 'fail',
      result: { pass: false, output: '', failures: [{ name: 'create', message: 'status: expected 201, got 200', expected: 201, actual: 200 }], durationMs: 9 },
      attempt: { id: 8, mode: 'solo', outcome: 'fail' },
      xp: null,
    }),
  },
  'POST /api/units/22/run': { status: 200, body: { result: { pass: true, output: '', failures: [], durationMs: 9 } } },
  'POST /api/units/22/submit': { status: 200, body: submitResp() },
  'GET /api/dashboard': { status: 200, body: dashboard() },
  'POST /api/units/12/run': { status: 200, body: { result: { pass: true, output: '', failures: [], durationMs: 3 } } },
  'POST /api/units/12/submit': { status: 200, body: submitResp() },
});

describe('arg parsing', () => {
  it('no args prints help and exits 0 without touching the network', async () => {
    const { fetch, calls } = fakeFetch({});
    const io = captureIo(proj, fetch);
    expect(await runCli([], io)).toBe(EXIT.OK);
    expect(io.stdout.join('\n')).toMatch(/Usage: bootquest/);
    expect(calls).toHaveLength(0);
  });

  it('--version exits 0', async () => {
    const io = captureIo(proj, fakeFetch({}).fetch);
    expect(await runCli(['--version'], io)).toBe(EXIT.OK);
    expect(io.stdout.join('')).toContain('0.1.0');
  });

  it('sync --help documents that GitHub sync is W4', async () => {
    const io = captureIo(proj, fakeFetch({}).fetch);
    expect(await runCli(['sync', '--help'], io)).toBe(EXIT.OK);
    expect(io.stdout.join('\n')).toMatch(/W4/);
  });

  it('unknown command / unknown option are usage errors (exit 2)', async () => {
    const io = captureIo(proj, fakeFetch({}).fetch);
    expect(await runCli(['frobnicate'], io)).toBe(EXIT.ERROR);
    expect(await runCli(['submit', '--nope'], io)).toBe(EXIT.ERROR);
    expect(io.stderr.join('\n')).toMatch(/unknown/);
  });

  it('server defaults to 127.0.0.1:4178', async () => {
    const { fetch, calls } = fakeFetch(baseRoutes());
    await runCli(['run'], captureIo(proj, fetch));
    expect(calls[0]?.url).toBe(`${DEFAULT_SERVER}/api/units/12`);
  });

  it('BOOTQUEST_SERVER env overrides the default; --server overrides the env (before or after the command)', async () => {
    const a = fakeFetch(baseRoutes());
    await runCli(['run'], captureIo(proj, a.fetch, { BOOTQUEST_SERVER: 'http://localhost:5000/' }));
    expect(a.calls[0]?.url).toBe('http://localhost:5000/api/units/12');

    const b = fakeFetch(baseRoutes());
    await runCli(['--server', 'http://127.0.0.1:6001', 'run'], captureIo(proj, b.fetch, { BOOTQUEST_SERVER: 'http://localhost:5000' }));
    expect(b.calls[0]?.url).toBe('http://127.0.0.1:6001/api/units/12');

    const c = fakeFetch(baseRoutes());
    await runCli(['run', '--server', 'http://127.0.0.1:6002'], captureIo(proj, c.fetch));
    expect(c.calls[0]?.url).toBe('http://127.0.0.1:6002/api/units/12');
  });

  it('a non-http --server is a usage error (exit 2)', async () => {
    const io = captureIo(proj, fakeFetch(baseRoutes()).fetch);
    expect(await runCli(['status', '--server', 'ftp://x'], io)).toBe(EXIT.ERROR);
    expect(io.stderr.join('\n')).toMatch(/must be http/);
  });

  it('submit sends selfAssisted=false by default and true with --assisted', async () => {
    const a = fakeFetch(baseRoutes());
    await runCli(['submit'], captureIo(proj, a.fetch));
    expect(a.calls.at(-1)?.body).toEqual({ code: 'export function swap(a, b) { return [b, a]; }\n', selfAssisted: false });

    const b = fakeFetch(baseRoutes());
    await runCli(['submit', '--assisted'], captureIo(proj, b.fetch));
    expect(b.calls.at(-1)?.body).toMatchObject({ selfAssisted: true });
  });

  it('run sends only {code} (no selfAssisted) and a path argument wins over config "file"', async () => {
    writeFileSync(join(proj, 'src', 'alt.js'), 'export const alt = 1;\n');
    const { fetch, calls } = fakeFetch(baseRoutes());
    expect(await runCli(['run', 'alt.js'], captureIo(join(proj, 'src'), fetch))).toBe(EXIT.OK);
    expect(calls.at(-1)?.body).toEqual({ code: 'export const alt = 1;\n' });
  });
});

describe('exit codes and refusals', () => {
  it('submit pass -> 0; fail -> 1 (and the failed attempt is reported as recorded)', async () => {
    const pass = captureIo(proj, fakeFetch(baseRoutes()).fetch);
    expect(await runCli(['submit'], pass)).toBe(EXIT.OK);

    const routes = {
      ...baseRoutes(),
      'POST /api/units/12/submit': {
        status: 200,
        body: submitResp({
          verdict: 'fail',
          result: { pass: false, output: '', failures: [{ name: 'a', message: 'boom' }], durationMs: 4 },
          attempt: { id: 6, mode: 'solo', outcome: 'fail' },
          xp: null,
        }),
      },
    };
    const fail = captureIo(proj, fakeFetch(routes).fetch);
    expect(await runCli(['submit'], fail)).toBe(EXIT.NOT_PASSED);
    expect(fail.stdout.join('\n')).toMatch(/Attempt #6 recorded/);
  });

  it('missing .bootquest.json -> exit 2 with guidance', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'bq-cli-none-'));
    try {
      const io = captureIo(empty, fakeFetch(baseRoutes()).fetch, {});
      // only meaningful when no ancestor of the temp dir carries a config
      const code = await runCli(['submit'], io);
      expect(code).toBe(EXIT.ERROR);
      expect(io.stderr.join('\n')).toMatch(/no \.bootquest\.json found|Config problem/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('missing file -> exit 2, nothing submitted', async () => {
    writeFileSync(join(proj, '.bootquest.json'), JSON.stringify({ unitId: 12, file: 'src/gone.js' }));
    const { fetch, calls } = fakeFetch(baseRoutes());
    const io = captureIo(proj, fetch);
    expect(await runCli(['submit'], io)).toBe(EXIT.ERROR);
    expect(io.stderr.join('\n')).toMatch(/file not found/);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('oversized file -> exit 2 before any POST', async () => {
    writeFileSync(join(proj, 'src', 'swap.js'), 'x'.repeat(MAX_CODE_CHARS + 1));
    const { fetch, calls } = fakeFetch(baseRoutes());
    const io = captureIo(proj, fetch);
    expect(await runCli(['submit'], io)).toBe(EXIT.ERROR);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('quiz unit: run and submit are refused locally (exit 2, nothing POSTed)', async () => {
    writeFileSync(join(proj, '.bootquest.json'), JSON.stringify({ unitId: 3, file: 'src/swap.js' }));
    for (const cmd of ['run', 'submit']) {
      const { fetch, calls } = fakeFetch(baseRoutes());
      const io = captureIo(proj, fetch);
      expect(await runCli([cmd], io)).toBe(EXIT.ERROR);
      expect(io.stderr.join('\n')).toMatch(/browser material/);
      if (cmd === 'run') expect(io.stderr.join('\n')).toMatch(/RUN_NOT_AVAILABLE/);
      expect(calls.some((c) => c.method === 'POST')).toBe(false);
    }
  });

  it('server error envelope is rendered friendly (exit 2)', async () => {
    const routes = {
      ...baseRoutes(),
      'POST /api/units/12/run': { status: 409, body: { error: { code: 'RUN_NOT_AVAILABLE', message: 'quiz checks are submit-only' } } },
    };
    const io = captureIo(proj, fakeFetch(routes).fetch);
    expect(await runCli(['run'], io)).toBe(EXIT.ERROR);
    expect(io.stderr.join('\n')).toMatch(/Server refused \(RUN_NOT_AVAILABLE, HTTP 409\): quiz checks are submit-only/);
  });

  it('non-JSON answer (wrong server on that port) -> exit 2', async () => {
    const io = captureIo(proj, fakeFetch({ 'GET /api/dashboard': { status: 200, body: '<html>hi</html>' } }).fetch);
    expect(await runCli(['status'], io)).toBe(EXIT.ERROR);
    expect(io.stderr.join('\n')).toMatch(/non-JSON/);
  });

  it('connection failure -> friendly message, exit 2', async () => {
    const io = captureIo(proj, async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    expect(await runCli(['status'], io)).toBe(EXIT.ERROR);
    expect(io.stderr.join('\n')).toMatch(/Cannot reach the BootQuest server at http:\/\/127\.0\.0\.1:4178 \(ECONNREFUSED\)/);
    expect(io.stderr.join('\n')).not.toMatch(/at .*\.ts:\d+/); // no stack trace
  });
});

describe('W3c: http and repo units', () => {
  const useUnit = (unitId: number) => writeFileSync(join(proj, '.bootquest.json'), JSON.stringify({ unitId }));

  it('http submit --port sends {port, selfAssisted}; output names the target and counts requests', async () => {
    useUnit(21);
    const { fetch, calls } = fakeFetch(baseRoutes());
    const io = captureIo(proj, fetch);
    expect(await runCli(['submit', '--port', '4000'], io)).toBe(EXIT.NOT_PASSED);
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { port: 4000, selfAssisted: false } });
    const out = io.stdout.join('\n');
    expect(out).toMatch(/^Target: localhost:4000 \(the BootQuest server sends the requests over loopback\)$/m);
    expect(out).toMatch(/Verdict: FAIL \(1\/2 requests passing\)/);
    expect(out).toMatch(/Failures \(1 of 2 requests\):\n {2}1\. create\n {7}status: expected 201, got 200\n {7}expected: 201\n {7}actual: {3}200/);
  });

  it('http run without --port uses the public port hint (and says so); no hint -> usage error, nothing sent', async () => {
    useUnit(21);
    const a = fakeFetch(baseRoutes());
    const io = captureIo(proj, a.fetch);
    expect(await runCli(['run'], io)).toBe(EXIT.OK);
    expect(a.calls.at(-1)?.body).toEqual({ port: 3000 });
    expect(io.stdout.join('\n')).toMatch(/Target: localhost:3000 .*port from the unit hint; override with --port/);
    expect(io.stdout.join('\n')).toMatch(/Result: PASS \(2\/2 requests\)/);

    const b = fakeFetch({ ...baseRoutes(), 'GET /api/units/21': { status: 200, body: httpDetail({}) } });
    const io2 = captureIo(proj, b.fetch);
    expect(await runCli(['run'], io2)).toBe(EXIT.ERROR);
    expect(io2.stderr.join('\n')).toMatch(/pass --port <n>, the port your server listens on/);
    expect(b.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('http: bad --port, a file path or --repo are usage errors before any POST', async () => {
    useUnit(21);
    for (const args of [['submit', '--port', '0'], ['submit', '--port', '70000'], ['submit', '--port', 'abc'], ['submit', 'src/swap.js'], ['run', '--repo', '.']]) {
      const { fetch, calls } = fakeFetch(baseRoutes());
      const io = captureIo(proj, fetch);
      expect(await runCli(args, io), args.join(' ')).toBe(EXIT.ERROR);
      expect(calls.some((c) => c.method === 'POST'), args.join(' ')).toBe(false);
    }
  });

  it('repo submit defaults to the directory holding .bootquest.json (absolute); --repo resolves against the cwd', async () => {
    useUnit(22);
    const a = fakeFetch(baseRoutes());
    const io = captureIo(join(proj, 'src'), a.fetch);
    expect(await runCli(['submit', '--assisted'], io)).toBe(EXIT.OK);
    expect(a.calls.at(-1)?.body).toEqual({ repoPath: proj, selfAssisted: true });
    expect(io.stdout.join('\n')).toMatch(/Verdict: PASS \(3\/3 predicates passing\)/);

    const b = fakeFetch(baseRoutes());
    expect(await runCli(['run', '--repo', 'src'], captureIo(proj, b.fetch))).toBe(EXIT.OK);
    expect(b.calls.at(-1)?.body).toEqual({ repoPath: join(proj, 'src') });
  });

  it('repo: missing --repo dir, --port, or a file path are usage errors before any POST', async () => {
    useUnit(22);
    for (const args of [['submit', '--repo', 'nope'], ['submit', '--port', '3000'], ['run', 'src/swap.js']]) {
      const { fetch, calls } = fakeFetch(baseRoutes());
      const io = captureIo(proj, fetch);
      expect(await runCli(args, io), args.join(' ')).toBe(EXIT.ERROR);
      expect(calls.some((c) => c.method === 'POST'), args.join(' ')).toBe(false);
    }
  });

  it('code units refuse --port / --repo', async () => {
    for (const args of [['submit', '--port', '3000'], ['run', '--repo', '.']]) {
      const { fetch, calls } = fakeFetch(baseRoutes());
      const io = captureIo(proj, fetch);
      expect(await runCli(args, io)).toBe(EXIT.ERROR);
      expect(io.stderr.join('\n')).toMatch(/send a file/);
      expect(calls.some((c) => c.method === 'POST')).toBe(false);
    }
  });

  it('status describes how to deliver http / repo units', async () => {
    useUnit(21);
    const io = captureIo(proj, fakeFetch(baseRoutes()).fetch);
    expect(await runCli(['status'], io)).toBe(EXIT.OK);
    expect(io.stdout.join('\n')).toMatch(/Check: +http \(2 requests\), port hint 3000/);
    expect(io.stdout.join('\n')).toMatch(/CLI: +run \/ submit --port <n> while your server is running \(default 3000\)/);
    useUnit(22);
    const io2 = captureIo(proj, fakeFetch(baseRoutes()).fetch);
    expect(await runCli(['status'], io2)).toBe(EXIT.OK);
    expect(io2.stdout.join('\n')).toMatch(/Check: +repo \(3 predicates\)/);
    expect(io2.stdout.join('\n')).toMatch(/CLI: +run \/ submit \[--repo <dir>\] \(default /);
  });
});

describe('status', () => {
  it('prints the dashboard and the configured unit state', async () => {
    const io = captureIo(proj, fakeFetch(baseRoutes()).fetch);
    expect(await runCli(['status'], io)).toBe(EXIT.OK);
    const out = io.stdout.join('\n');
    expect(out).toMatch(/Streak: 3 days \(longest 5/);
    expect(out).toMatch(/XP: 120 total - level 2/);
    expect(out).toMatch(/Reviews due: 4/);
    expect(out).toMatch(/js +Swap two values \[drill\] id 12/);
    expect(out).toMatch(/csharp +\(nothing available\)/);
    expect(out).toMatch(/Unit: +Swap two values/);
    expect(out).toMatch(/Check: +drill-js \(3 tests\)/);
    expect(out).toMatch(/File: +src[\\/]swap\.js$/m);
  });

  it('a malformed .bootquest.json still shows the dashboard, then exits 2', async () => {
    writeFileSync(join(proj, '.bootquest.json'), '{ broken');
    const io = captureIo(proj, fakeFetch(baseRoutes()).fetch);
    expect(await runCli(['status'], io)).toBe(EXIT.ERROR);
    expect(io.stdout.join('\n')).toMatch(/Streak:/);
    expect(io.stderr.join('\n')).toMatch(/Config problem: .*not valid JSON/);
  });
});

describe('reset (W7): delegates to the server-side guarded reset', () => {
  it('forwards --yes-really only when given, prints both streams and returns the guard exit code; never touches the network', async () => {
    const { fetch, calls } = fakeFetch({});
    const seen: string[][] = [];
    const io = {
      ...captureIo(proj, fetch),
      runReset: (args: string[]) => {
        seen.push(args);
        return args.includes('--yes-really') ? { code: 0, out: ['bootquest reset: fresh database'], err: [] } : { code: 2, out: [], err: ['bootquest reset: REFUSED'] };
      },
    };
    expect(await runCli(['reset'], io)).toBe(2);
    expect(await runCli(['reset', '--yes-really'], io)).toBe(0);
    expect(seen).toEqual([[], ['--yes-really']]);
    expect(io.stderr.join('\n')).toMatch(/REFUSED/);
    expect(io.stdout.join('\n')).toMatch(/fresh database/);
    expect(calls).toHaveLength(0);
  });

  it('the real child-process path refuses without BOOTQUEST_DB (exit 2) and touches nothing', async () => {
    const { spawnReset } = await import('../src/program.ts');
    const env = { ...process.env };
    delete env.BOOTQUEST_DB;
    const r = spawnReset(['--yes-really'], env);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toMatch(/BOOTQUEST_DB is not set/);
  });
});

describe('today (B4): read-only daily summary, always exit 0', () => {
  const slateDash = () => ({
    ...dashboard(),
    streak: { current: 1, longest: 5, tokens: 2, slateDaysBanked: 0, todayComplete: true },
    slate: {
      day: '2026-10-07',
      status: 'partial',
      items: [
        { slot: 'drills:js', kind: 'drill-set' as const, track: 'js', size: 5, done: true },
        { slot: 'campaign', kind: 'campaign-step' as const, done: false },
        { slot: 'reviews', kind: 'review-clear' as const, done: true },
      ],
    },
  });

  it('prints the slate with done state, reviews due, streak, tokens and next up per track from ONE GET', async () => {
    const { fetch, calls } = fakeFetch({ 'GET /api/dashboard': { status: 200, body: slateDash() } });
    const io = captureIo(proj, fetch);
    expect(await runCli(['today'], io)).toBe(EXIT.OK);
    expect(io.stderr).toEqual([]);
    const out = io.stdout.join('\n');
    expect(out).toContain(`BootQuest today: 2026-10-07  (${DEFAULT_SERVER})`);
    expect(out).toContain('Slate: 2/3 done (partial)');
    expect(out).toContain('  [x] js drill set (5 drills)');
    expect(out).toContain('  [ ] campaign step');
    expect(out).toContain('  [x] clear the review queue');
    expect(out).toContain('Reviews due: 4');
    expect(out).toContain('Streak: 1 day (longest 5) - today complete');
    expect(out).toContain('Freeze tokens: 2');
    expect(out).toMatch(/Next up:\n {2}js {8}Swap two values \[drill\] id 12\n {2}csharp {4}\(nothing available\)/);
    // read-only: exactly one request, a GET, no body
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['GET /api/dashboard']);
    expect(calls[0]!.body).toBeUndefined();
  });

  it('works without a .bootquest.json and with an empty slate / no next-up', async () => {
    const empty = { ...dashboard(), slate: { day: '2026-10-07', status: 'open', items: [] }, nextUp: [] };
    const { fetch } = fakeFetch({ 'GET /api/dashboard': { status: 200, body: empty } });
    const bare = mkdtempSync(join(tmpdir(), 'bq-cli-today-'));
    try {
      const io = captureIo(bare, fetch);
      expect(await runCli(['today'], io)).toBe(EXIT.OK);
      const out = io.stdout.join('\n');
      expect(out).toContain('Slate: 0/0 done (open)');
      expect(out).toContain('  (no slate slots today)');
      expect(out).toMatch(/Next up:\n {2}\(nothing\)/);
      expect(out).toContain('Streak: 3 days (longest 5) - today not complete yet');
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('server down: honest message, exit 0, no stack trace', async () => {
    const io = captureIo(proj, (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as never);
    expect(await runCli(['today'], io)).toBe(EXIT.OK);
    expect(io.stdout.join('\n')).toMatch(/Today: unavailable - the server could not be read/);
    expect(io.stdout.join('\n')).not.toMatch(/Slate:|Streak:/);
    expect(io.stderr.join('\n')).toMatch(/Cannot reach the BootQuest server at http:\/\/127\.0\.0\.1:4178 \(ECONNREFUSED\)/);
    expect(io.stderr.join('\n')).not.toMatch(/\n\s+at /);
  });

  it('a refusing / non-BootQuest server or a bad --server URL also exits 0 with the reason', async () => {
    const refusing = captureIo(proj, fakeFetch({ 'GET /api/dashboard': { status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } } }).fetch);
    expect(await runCli(['today'], refusing)).toBe(EXIT.OK);
    expect(refusing.stderr.join('\n')).toMatch(/Server refused \(INTERNAL, HTTP 500\): boom/);
    const html = captureIo(proj, fakeFetch({ 'GET /api/dashboard': { status: 200, body: '<html>' } }).fetch);
    expect(await runCli(['today'], html)).toBe(EXIT.OK);
    expect(html.stderr.join('\n')).toMatch(/non-JSON/);
    const { fetch, calls } = fakeFetch({});
    const badUrl = captureIo(proj, fetch);
    expect(await runCli(['today', '--server', 'ftp://x'], badUrl)).toBe(EXIT.OK);
    expect(badUrl.stderr.join('\n')).toMatch(/must be http\(s\)/);
    expect(calls).toHaveLength(0);
  });
});
