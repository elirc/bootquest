import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunResponse, SubmitResponse } from '@bootquest/shared/api';
import { assertPortFree, installShutdown, PortBusyError, PortConfigError, resolvePort, startServer } from '../../src/api/serve.ts';
import { DbPathError } from '../../src/db/database.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
import { fixture, useApi } from './harness.ts';

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return port;
}

describe('serve.ts guards', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bootquest-serve-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  it('refuses to start without BOOTQUEST_DB', async () => {
    await expect(startServer({ env: { BOOTQUEST_PORT: String(await freePort()) } })).rejects.toBeInstanceOf(DbPathError);
    await expect(startServer({ env: { BOOTQUEST_DB: '   ' } })).rejects.toThrow(/BOOTQUEST_DB/);
  });

  it('busy-port pre-check fails with a clear error before opening the DB', async () => {
    const blocker: Server = createServer();
    const port = await freePort();
    await new Promise<void>((ok) => blocker.listen(port, '127.0.0.1', ok));
    try {
      await expect(assertPortFree(port)).rejects.toBeInstanceOf(PortBusyError);
      const err = await startServer({ env: { BOOTQUEST_DB: join(dir, 'x.db'), BOOTQUEST_PORT: String(port) } }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PortBusyError);
      expect((err as Error).message).toMatch(new RegExp(`port ${port} .*already in use`));
    } finally {
      await new Promise<void>((ok) => blocker.close(() => ok()));
    }
  });

  it('validates BOOTQUEST_PORT and defaults to 4178', () => {
    expect(resolvePort({})).toBe(4178);
    expect(resolvePort({ BOOTQUEST_PORT: '5000' })).toBe(5000);
    for (const bad of ['0', '70000', 'abc', '-1']) expect(() => resolvePort({ BOOTQUEST_PORT: bad })).toThrow(PortConfigError);
  });

  it('starts on a temp DB in WAL mode, serves health, and frees the port on close', async () => {
    const port = await freePort();
    const running = await startServer({ env: { BOOTQUEST_DB: join(dir, 'live.db'), BOOTQUEST_PORT: String(port) } });
    try {
      expect(running.db.get<{ journal_mode: string }>('PRAGMA journal_mode')!.journal_mode).toBe('wal');
      expect(running.db.get<{ timeout: number }>('PRAGMA busy_timeout')!.timeout).toBe(5000);
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    } finally {
      await running.close();
    }
    await expect(assertPortFree(port)).resolves.toBeUndefined();
  });

  it('SIGINT/SIGTERM trigger one graceful close then exit(0)', async () => {
    const proc = Object.assign(new EventEmitter(), { exit: vi.fn() });
    const close = vi.fn(() => Promise.resolve());
    installShutdown({ close }, proc, () => {});
    proc.emit('SIGTERM');
    proc.emit('SIGINT');
    await new Promise((r) => setTimeout(r, 10));
    expect(close).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(0);
  });
});

describe('real drill-js runner through the API', () => {
  const ctx = useApi({ realRunners: true });

  it('run grades via the runner registry and writes nothing; submit awards code XP', async () => {
    const id = ctx.id('fixture:drill-add');
    const before = ledgerCounts(ctx.db);
    const bad = RunResponse.parse((await request(ctx.app).post(`/api/units/${id}/run`).send({ code: fixture.submissions.addWrong })).body);
    expect(bad.result.pass).toBe(false);
    expect(bad.result.failures[0]).toMatchObject({ name: 'adds positives', expected: '5', actual: '-1' });
    expect(Object.keys(bad.result).sort()).toEqual(['durationMs', 'failures', 'output', 'pass']);
    expect(ledgerCounts(ctx.db)).toEqual(before);

    const ok = SubmitResponse.parse((await request(ctx.app).post(`/api/units/${id}/submit`).send({ code: fixture.submissions.addRight })).body);
    expect(ok.verdict).toBe('pass');
    expect(ok.xp).toMatchObject({ amount: 20 });
    const raw = ctx.db.get<{ raw: string }>('SELECT raw FROM run WHERE id = ?', ok.runId)!;
    expect(JSON.parse(raw.raw)).toMatchObject({ pass: true, failures: [] });
  }, 60000);
});
