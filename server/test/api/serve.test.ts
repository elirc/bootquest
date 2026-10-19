import { EventEmitter } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SyncReport } from '@bootquest/shared/sync';
import type { Db } from '../../src/db/database.ts';
import type { SyncService } from '../../src/sync/service.ts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunResponse, SubmitResponse } from '@bootquest/shared/api';
import { assertPortFree, installShutdown, PortBusyError, PortConfigError, resolvePort, startServer } from '../../src/api/serve.ts';
import { DbPathError } from '../../src/db/database.ts';
import { defaultWorkParent, removeWorkParent } from '../../src/runners/node-test-file/index.ts';
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

  it('F12: a normal close removes this process\'s (empty) bq-ntf-<pid> workspace parent', async () => {
    const parent = defaultWorkParent();
    expect(parent).toBe(join(tmpdir(), `bq-ntf-${process.pid}`));
    mkdirSync(parent, { recursive: true }); // as the node-test-file runner leaves it after its last run
    const running = await startServer({ env: { BOOTQUEST_DB: join(dir, 'ntf.db'), BOOTQUEST_PORT: String(await freePort()) } });
    await running.close();
    expect(existsSync(parent)).toBe(false);
  });

  it('F12: removeWorkParent only removes an EMPTY parent (a run in flight is never pulled away)', async () => {
    const parent = join(dir, 'bq-ntf-parent');
    mkdirSync(join(parent, 'bq-ntf-inflight'), { recursive: true });
    expect(await removeWorkParent(parent)).toBe(false);
    expect(existsSync(join(parent, 'bq-ntf-inflight'))).toBe(true);
    rmSync(join(parent, 'bq-ntf-inflight'), { recursive: true });
    expect(await removeWorkParent(parent)).toBe(true);
    expect(existsSync(parent)).toBe(false);
    expect(await removeWorkParent(parent)).toBe(false); // already gone: nothing to do
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

describe('serve.ts: a sync that commits, then fails the ladder re-link (afterSync)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bootquest-relink-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  const AUTHORED = fileURLToPath(new URL('../../../content/units/agentic.json', import.meta.url));
  const KEY = 'agentic/g3-live-delegation';

  it('500 SYNC_RELINK_FAILED names the cause + the startup backup; the ladder load rolled back; the API keeps serving; a restart refuses until restored', async () => {
    const dbPath = join(dir, 'bq.db');
    const env = (port: number) => ({ BOOTQUEST_DB: dbPath, BOOTQUEST_PORT: String(port), BOOTQUEST_AUTHORED_UNITS: AUTHORED });
    // first boot creates + migrates the DB (no backup: nothing to back up yet)
    const first = await startServer({ env: env(await freePort()), runners: {} });
    expect(first.backup.status).toBe('skipped');
    await first.close();

    // a "sync" that commits a change the ladder loader then refuses (the authored unit moved track)
    const sync = {
      paths: {},
      github: {},
      cache: {},
      run: async (db: Db): Promise<SyncReport> => {
        db.run(`UPDATE unit SET track_id = 'js' WHERE key = ?`, KEY);
        return { syncId: 41, offline: false, ok: true, repos: [] };
      },
    } as unknown as SyncService;
    const port = await freePort();
    const running = await startServer({ env: env(port), runners: {}, sync });
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(' ')));
    try {
      expect(running.backup.status).toBe('created');
      const backupPath = running.backup.path!;
      const r = await fetch(`http://127.0.0.1:${port}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(r.status).toBe(500);
      const body = (await r.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('SYNC_RELINK_FAILED');
      expect(body.error.message).toMatch(/^sync 41 COMMITTED \(no repos\)/);
      expect(body.error.message).toContain(`authored unit ${KEY} changed kind/track; refusing`);
      expect(body.error.message).toContain(`restore ${backupPath} over ${running.db.path}`);
      expect(errors.some((e) => e.includes('sync 41 COMMITTED'))).toBe(true);
      // the sync's own write stuck; the API still answers
      expect(running.db.get<{ track_id: string }>('SELECT track_id FROM unit WHERE key = ?', KEY)!.track_id).toBe('js');
      expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    } finally {
      spy.mockRestore();
      await running.close();
    }

    // exactly what the message warned: the next start re-runs the ladder load and refuses
    await expect(startServer({ env: env(await freePort()), runners: {} })).rejects.toThrow(/changed kind\/track; refusing/);
    // ... and the startup backup brings back a DB that starts
    const backups = readdirSync(join(dir, 'backups')).sort();
    for (const side of ['-wal', '-shm']) rmSync(`${dbPath}${side}`, { force: true });
    copyFileSync(join(dir, 'backups', backups[0]!), dbPath);
    const restored = await startServer({ env: env(await freePort()), runners: {} });
    try {
      expect(restored.db.get<{ track_id: string }>('SELECT track_id FROM unit WHERE key = ?', KEY)!.track_id).toBe('agentic');
    } finally {
      await restored.close();
    }
  }, 120_000);
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
