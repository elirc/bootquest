import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiErrorBody, RevealResponse } from '@bootquest/shared/api';
import { isJsonContentType, isLoopbackHost, isLoopbackOrigin } from '../../src/api/guard.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
import { ApiClient } from '../../../cli/src/client.ts';
import { fixture, useApi } from './harness.ts';

function expectRefused(res: request.Response, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(ApiErrorBody.parse(res.body).error.code).toBe(code);
}

describe('local-only guard: pure checks', () => {
  it('Host: loopback names with any port only', () => {
    for (const ok of ['127.0.0.1', '127.0.0.1:4178', 'localhost', 'LOCALHOST:5173', 'localhost:61234', '[::1]', '[::1]:4178']) {
      expect(isLoopbackHost(ok), ok).toBe(true);
    }
    for (const bad of [undefined, '', 'evil.example', 'evil.example:4178', '127.0.0.1.evil.example', 'localhost.evil.example:4178', '127.0.0.2:4178', '0.0.0.0:4178', '::1', '[::1]x', 'localhost:', 'localhost:4178:1', '192.168.1.5:4178']) {
      expect(isLoopbackHost(bad), String(bad)).toBe(false);
    }
  });

  it('Origin: loopback http(s) origins only', () => {
    for (const ok of ['http://localhost:5173', 'http://127.0.0.1:4178', 'http://[::1]:5173', 'https://localhost', 'http://LOCALHOST:5173']) {
      expect(isLoopbackOrigin(ok), ok).toBe(true);
    }
    for (const bad of ['null', '', 'https://evil.example', 'http://localhost.evil.example:5173', 'http://127.0.0.1.evil.example', 'file://', 'chrome-extension://abc', 'http://user@localhost:5173', 'http://localhost:5173/path', 'ws://localhost:5173']) {
      expect(isLoopbackOrigin(bad), bad).toBe(false);
    }
  });

  it('Content-Type: application/json (any parameters) only', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('Application/JSON; charset=utf-8')).toBe(true);
    for (const bad of [undefined, '', 'text/plain', 'text/plain; charset=application/json', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/json-patch+json', 'application/jsonx']) {
      expect(isJsonContentType(bad), String(bad)).toBe(false);
    }
  });
});

describe('local-only guard over HTTP', () => {
  const ctx = useApi();
  let listening: Server | null = null;
  afterEach(async () => {
    if (listening) await new Promise<void>((done) => listening!.close(() => done()));
    listening = null;
  });

  const revealPath = () => `/api/units/${ctx.id('fixture:drill-add')}/reveal`;
  /** the reveal is irreversible: every refusal below must leave the ledger and the solution gate untouched */
  async function expectNotRevealed(): Promise<void> {
    expect(ledgerCounts(ctx.db).attempt).toBe(0);
    expectRefused(await request(ctx.app).get(`/api/units/${ctx.id('fixture:drill-add')}/solution`), 403, 'NOT_REVEALED');
  }

  it('CSRF shapes on POST /reveal are 415 UNSUPPORTED_MEDIA_TYPE and reveal NOTHING', async () => {
    // a body-less POST (fetch mode:no-cors / navigator.sendBeacon without a body): no content-type at all
    expectRefused(await request(ctx.app).post(revealPath()), 415, 'UNSUPPORTED_MEDIA_TYPE');
    // explicit zero-length body, no content-type
    expectRefused(await request(ctx.app).post(revealPath()).set('Content-Length', '0'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    // the HTML-form / no-cors "simple" content types, even carrying valid JSON bytes
    for (const ct of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      expectRefused(await request(ctx.app).post(revealPath()).set('Content-Type', ct).send('{}'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    // same shapes with a cross-site Origin: refused (403 comes first)
    expectRefused(await request(ctx.app).post(revealPath()).set('Origin', 'https://evil.example').set('Content-Type', 'text/plain').send('{}'), 403, 'ORIGIN_NOT_ALLOWED');
    // and even with a loopback Origin, a non-JSON write is refused
    expectRefused(await request(ctx.app).post(revealPath()).set('Origin', 'http://localhost:5173').set('Content-Type', 'text/plain').send('{}'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    await expectNotRevealed();
  });

  it('the other body-less writes (self-attest, sync) refuse the same shapes before any route runs', async () => {
    const reading = ctx.db.get<{ id: number }>(`SELECT id FROM unit WHERE kind = 'reading' LIMIT 1`);
    const attest = reading ? `/api/units/${reading.id}/self-attest` : '/api/units/1/self-attest';
    expectRefused(await request(ctx.app).post(attest), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectRefused(await request(ctx.app).post(attest).set('Content-Type', 'text/plain').send('{}'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    // /sync would otherwise answer 501 SYNC_UNAVAILABLE here: the guard answers first
    expectRefused(await request(ctx.app).post('/api/sync'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectRefused(await request(ctx.app).post('/api/sync').set('Content-Type', 'text/plain').send(''), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(ledgerCounts(ctx.db).attempt).toBe(0);
  });

  it('a foreign Origin is 403 ORIGIN_NOT_ALLOWED on reads and writes (incl. the opaque "null" origin)', async () => {
    const unit = `/api/units/${ctx.id('fixture:drill-add')}`;
    for (const origin of ['https://evil.example', 'http://localhost.evil.example:5173', 'null']) {
      expectRefused(await request(ctx.app).get(unit).set('Origin', origin), 403, 'ORIGIN_NOT_ALLOWED');
      expectRefused(await request(ctx.app).post(`${unit}/run`).set('Origin', origin).send({ code: fixture.submissions.addRight }), 403, 'ORIGIN_NOT_ALLOWED');
      expectRefused(await request(ctx.app).post(revealPath()).set('Origin', origin).send({}), 403, 'ORIGIN_NOT_ALLOWED');
    }
    await expectNotRevealed();
  });

  it('a non-loopback Host (DNS rebinding) is 403 HOST_NOT_ALLOWED: no code run, no ref read, no reveal', async () => {
    const unit = `/api/units/${ctx.id('fixture:drill-add')}`;
    for (const host of ['evil.example', 'evil.example:4178', '127.0.0.1.evil.example:4178', '192.168.1.5:4178']) {
      // a rebound page is SAME-origin: it sends no Origin on a GET and a matching one on POST
      expectRefused(await request(ctx.app).get(unit).set('Host', host), 403, 'HOST_NOT_ALLOWED');
      expectRefused(await request(ctx.app).get('/api/refs/1/content').set('Host', host), 403, 'HOST_NOT_ALLOWED');
      expectRefused(await request(ctx.app).post(`${unit}/run`).set('Host', host).set('Origin', `http://${host}`).send({ code: fixture.submissions.addRight }), 403, 'HOST_NOT_ALLOWED');
      expectRefused(await request(ctx.app).post(revealPath()).set('Host', host).send({}), 403, 'HOST_NOT_ALLOWED');
    }
    await expectNotRevealed();
  });

  it('the browser client through the Vite proxy (Host + Origin localhost:5173, JSON {}) still reveals', async () => {
    const res = await request(ctx.app)
      .post(revealPath())
      .set('Host', 'localhost:5173')
      .set('Origin', 'http://localhost:5173')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    const body = RevealResponse.parse(res.body);
    expect(body.solution).toEqual({ kind: 'code', code: fixture.content['fixture:drill-add']!.solution });
    expect(ledgerCounts(ctx.db).attempt).toBe(1);
    // a same-origin browser GET (no Origin header) on 127.0.0.1 and on [::1] passes too
    expect((await request(ctx.app).get('/api/health').set('Host', '127.0.0.1:4178')).status).toBe(200);
    expect((await request(ctx.app).get('/api/health').set('Host', '[::1]:4178')).status).toBe(200);
  });

  it('the CLI (real ApiClient: no Origin, JSON content-type on every POST) still works end to end', async () => {
    listening = await new Promise<Server>((ok) => {
      const s = ctx.app.listen(0, '127.0.0.1', () => ok(s));
    });
    const { port } = listening.address() as AddressInfo;
    const cli = new ApiClient(`http://127.0.0.1:${port}`, (url, init) => fetch(url, init));
    expect((await cli.health()).ok).toBe(true);
    const id = ctx.id('fixture:drill-add');
    expect((await cli.run(id, { code: fixture.submissions.addRight })).result.pass).toBe(true);
    const sub = await cli.submit(id, { code: fixture.submissions.addRight });
    expect(sub.verdict).toBe('pass');
    // CLI-shaped POST /sync on a server without sync: the ROUTE answers (501), not the guard
    await expect(cli.sync()).rejects.toMatchObject({ status: 501, code: 'SYNC_UNAVAILABLE' });
    // `localhost` as the --server name works too
    const viaName = new ApiClient(`http://localhost:${port}`, (url, init) => fetch(url, init));
    expect((await viaName.health()).ok).toBe(true);
  });
});
