import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckSpec, type JsonShape } from '@bootquest/shared';
import { startTasksServer, type RunningFixture, type TasksVariant } from '../../../test/fixtures/tasks-server.ts';
import lessons from '../../../test/fixtures/check-lessons.json' with { type: 'json' };
import { headerMatches, pickLoopbackHost, runHttpCheck, targetUrl, type HttpCheckSpec } from './index.ts';
import { matchShape } from './shape.ts';

// spawns git / sockets / child servers: generous timeouts, the suites share the CPU with other process-spawning tests
vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const lessonSpec = CheckSpec.parse(lessons.units.find((u) => u.key === 'fixture:http-tasks-api')!.checks[0]!.spec) as HttpCheckSpec;

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

async function fixture(variant: TasksVariant, host?: string): Promise<RunningFixture> {
  const f = await startTasksServer(variant, host);
  open.push(f);
  return f;
}

/** A raw node:http server for edge cases; closed after each test. */
async function rawServer(handler: Parameters<typeof createServer>[1], host = '127.0.0.1'): Promise<number> {
  const s: Server = createServer(handler);
  await new Promise<void>((ok) => s.listen(0, host, () => ok()));
  open.push({ close: () => new Promise<void>((done) => (s.closeAllConnections(), s.close(() => done()))) });
  return (s.address() as AddressInfo).port;
}

async function deadPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => ok()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return port;
}

const spec = (requests: unknown[], over: object = {}) => CheckSpec.parse({ type: 'http', requests, ...over }) as HttpCheckSpec;

describe('matchShape (the small JSON-shape grammar)', () => {
  const cases: [JsonShape, unknown, string | null][] = [
    ['any', { x: 1 }, null],
    ['string', 'x', null],
    ['string', 1, '$: expected string, got 1 (number)'],
    ['integer', 2, null],
    ['integer', 2.5, '$: expected integer, got 2.5 (number)'],
    ['null', null, null],
    ['array', [], null],
    ['object', [], '$: expected object, got array of 0'],
    [{ equals: 'done' }, 'done', null],
    [{ equals: false }, 0, '$: expected false, got 0 (number)'],
    [{ object: { id: 'integer' } }, { id: 1, extra: true }, null],
    [{ object: { id: 'integer' } }, { ID: 1 }, '$.id: expected present, got missing'],
    [{ object: { 'a-b': 'string' } }, { 'a-b': 3 }, '$["a-b"]: expected string, got 3 (number)'],
    [{ object: { items: { array: { object: { id: 'integer' } } } } }, { items: [{ id: 1 }, { id: '2' }] }, '$.items[1].id: expected integer, got "2" (string)'],
    [{ array: 'string', minItems: 2 }, ['a'], '$: expected at least 2 items, got 1 item'],
    [{ object: { o: { object: {} } } }, { o: null }, '$.o: expected object, got null'],
  ];
  it.each(cases)('%j vs %j', (shape, value, want) => {
    const m = matchShape(shape, value);
    expect(m ? `${m.path}: expected ${m.expected}, got ${m.actual}` : null).toBe(want);
  });
});

describe('headerMatches', () => {
  it('exact, or media type ignoring parameters', () => {
    expect(headerMatches('application/json', 'application/json')).toBe(true);
    expect(headerMatches('application/json', 'application/json; charset=utf-8')).toBe(true);
    expect(headerMatches('application/json', 'text/html; charset=utf-8')).toBe(false);
    expect(headerMatches('no-store', 'no-store, private')).toBe(false);
  });
});

describe('http runner against the fixture lesson', () => {
  it('good server: every request is a passing named test', async () => {
    const f = await fixture('good');
    const r = await runHttpCheck(lessonSpec, f.port);
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.output).toContain(`target http://127.0.0.1:${f.port}`);
    expect(r.output).toMatch(/PASS health check answers ok - GET \/health -> 200/);
    expect(r.output).toMatch(/PASS create a task - POST \/api\/tasks -> 201/);
    expect(r.output).toMatch(/PASS list tasks - GET \/api\/tasks -> 200/);
  });

  it('wrong shape: fails exactly the shape requests, with the mismatch path as expected/actual', async () => {
    const f = await fixture('wrong-shape');
    const r = await runHttpCheck(lessonSpec, f.port);
    expect(r.pass).toBe(false);
    expect(r.failures.map((x) => x.name)).toEqual(['create a task', 'list tasks']);
    expect(r.failures[0]).toMatchObject({ message: 'body $.id: expected integer, got "1" (string)', expected: '$.id: integer', actual: '$.id: "1" (string)' });
    expect(r.failures[1]).toMatchObject({ message: 'body $: expected object, got array of 1', expected: '$: object' });
  });

  it('wrong status: status mismatch carries expected/actual numbers', async () => {
    const f = await fixture('wrong-status');
    const r = await runHttpCheck(lessonSpec, f.port);
    expect(r.failures).toEqual([{ name: 'create a task', message: 'status: expected 201, got 200', expected: 201, actual: 200 }]);
  });

  it('non-JSON body where a shape is expected', async () => {
    const f = await fixture('no-json');
    const r = await runHttpCheck(lessonSpec, f.port);
    expect(r.failures.map((x) => x.name)).toEqual(['health check answers ok']);
    expect(r.failures[0]!.message).toBe('body: not JSON ("ok")');
  });

  it('nothing listening: every request fails with the network error verbatim (no retries)', async () => {
    const port = await deadPort();
    const r = await runHttpCheck(lessonSpec, port);
    expect(r.pass).toBe(false);
    expect(r.failures).toHaveLength(3);
    for (const f of r.failures) expect(f.message).toMatch(new RegExp(`^request failed: .*ECONNREFUSED.*${port}`));
  });
});

describe('http runner edge cases', () => {
  it('missing / mismatched headers are reported per header', async () => {
    const port = await rawServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<p>hi</p>');
    });
    const r = await runHttpCheck(spec([{ name: 'h', method: 'GET', path: '/', expect: { status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': 'abc' } } }]), port);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.message).toBe('header content-type: expected "application/json", got "text/html"\nheader x-request-id: missing (expected "abc")');
    expect(r.failures[0]).toMatchObject({ expected: 'content-type: application/json', actual: 'content-type: text/html' });
  });

  it('sends spec headers + JSON body; method and path as written', async () => {
    let seen: { method?: string; url?: string; ct?: string; auth?: string; body?: string } = {};
    const port = await rawServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        seen = { method: req.method, url: req.url, ct: req.headers['content-type'], auth: req.headers.authorization, body: b };
        res.writeHead(204);
        res.end();
      });
    });
    const r = await runHttpCheck(spec([{ name: 'p', method: 'PATCH', path: '/api/tasks/1?x=1', headers: { authorization: 'Bearer t' }, body: { done: true }, expect: { status: 204 } }]), port);
    expect(r.pass).toBe(true);
    expect(seen).toEqual({ method: 'PATCH', url: '/api/tasks/1?x=1', ct: 'application/json', auth: 'Bearer t', body: '{"done":true}' });
  });

  it('redirects are NOT followed: the 3xx itself is asserted (never chased off loopback)', async () => {
    let hits = 0;
    const port = await rawServer((_req, res) => {
      hits++;
      res.writeHead(302, { location: 'http://example.invalid/elsewhere' });
      res.end();
    });
    const ok = await runHttpCheck(spec([{ name: 'r', method: 'GET', path: '/old', expect: { status: 302, headers: { location: 'http://example.invalid/elsewhere' } } }]), port);
    expect(ok.failures).toEqual([]);
    const bad = await runHttpCheck(spec([{ name: 'r', method: 'GET', path: '/old', expect: { status: 200 } }]), port);
    expect(bad.failures[0]).toMatchObject({ expected: 200, actual: 302 });
    expect(hits).toBe(2);
  });

  it('per-request timeout, then the total cap: later requests fail unsent', async () => {
    const port = await rawServer(() => {
      /* never answers */
    });
    const names = ['a', 'b', 'c', 'd', 'e'];
    const reqs = names.map((name) => ({ name, method: 'GET', path: '/slow', expect: { status: 200 } }));
    const r = await runHttpCheck(spec(reqs, { timeoutMs: 300, totalTimeoutMs: 700 }), port);
    expect(r.failures.map((f) => f.name)).toEqual(names);
    expect(r.failures[0]!.message).toBe('no response within 300ms (timed out)');
    // timing-robust: a prefix timed out (each <= 300ms, the last one clipped to what was left), the rest were never sent
    const msgs = r.failures.map((f) => f.message);
    const firstUnsent = msgs.findIndex((m) => m.startsWith('not sent'));
    expect(firstUnsent).toBeGreaterThan(0);
    for (const m of msgs.slice(0, firstUnsent)) expect(m).toMatch(/^no response within ([1-9]|[1-9]\d|[12]\d\d|300)ms \(timed out\)$/);
    for (const m of msgs.slice(firstUnsent)) expect(m).toBe("not sent: the check's total time cap (700ms) was reached");
    expect(r.durationMs).toBeLessThan(5000); // 700ms cap + loopback probe; generous for a loaded box
  }, 10_000);

  it('falls back to [::1] when only the IPv6 loopback listens (dev servers bound to "localhost")', async (ctx) => {
    let port: number;
    try {
      port = await rawServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      }, '::1');
    } catch {
      ctx.skip(); // no IPv6 loopback on this machine
      return;
    }
    expect(await pickLoopbackHost(port, 1000)).toBe('::1');
    const r = await runHttpCheck(spec([{ name: 'v6', method: 'GET', path: '/health', expect: { status: 200, jsonShape: { object: { ok: { equals: true } } } } }]), port);
    expect(r.failures).toEqual([]);
    expect(r.output).toContain(`target http://[::1]:${port}`);
  });

  it('only loopback URLs are ever requested (host fixed by construction)', async () => {
    const urls: string[] = [];
    const fakeFetch = (async (u: URL | string) => {
      urls.push(String(u));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const r = await runHttpCheck(spec([{ name: 'a', method: 'GET', path: '/a?next=http://evil.example', expect: { status: 200 } }]), 9, { fetch: fakeFetch });
    expect(r.pass).toBe(true);
    expect(urls).toEqual(['http://127.0.0.1:9/a?next=http://evil.example']);
    // defense in depth under the Zod path rule: a path that would change the authority throws
    expect(() => targetUrl('127.0.0.1', 3000, '@evil.example/')).toThrow(/does not stay on/);
    expect(targetUrl('127.0.0.1', 3000, '//evil.example/x').host).toBe('127.0.0.1:3000');
    expect(targetUrl('::1', 3000, '/x').href).toBe('http://[::1]:3000/x');
  });
});
