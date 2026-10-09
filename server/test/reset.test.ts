import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.ts';
import { runReset } from '../src/db/reset.ts';

/** W7 (spec §11 M7): the guarded reset — never a default path, never without --yes-really, never while held. */
describe('bootquest reset guards', () => {
  let dir: string;
  let out: string[];
  let err: string[];
  let port: number;
  const deps = (env: Record<string, string | undefined>) => ({
    env,
    now: () => new Date(Date.UTC(2026, 9, 8, 12, 0, 0)),
    out: (l: string) => out.push(l),
    err: (l: string) => err.push(l),
  });
  const freePort = (): Promise<number> =>
    new Promise((ok) => {
      const s = createServer();
      s.listen(0, '127.0.0.1', () => {
        const a = s.address();
        s.close(() => ok(typeof a === 'object' && a ? a.port : 0));
      });
    });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bq-reset-'));
    out = [];
    err = [];
    port = await freePort();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  const seeded = () => {
    const path = join(dir, 'owner.db');
    const db = openDb({ path, env: {} });
    db.run(`INSERT INTO unit (key, track_id, kind, title, created_at) VALUES ('x', 'js', 'drill', 'x', 1)`);
    db.close();
    return path;
  };
  const units = (path: string) => {
    const db = openDb({ path, env: {} });
    try {
      return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM unit')!.n;
    } finally {
      db.close();
    }
  };

  it('refuses without BOOTQUEST_DB (exit 2), whatever the flag', async () => {
    expect(await runReset(['--yes-really'], deps({ BOOTQUEST_PORT: String(port) }))).toBe(2);
    expect(await runReset(['--yes-really'], deps({ BOOTQUEST_DB: '  ', BOOTQUEST_PORT: String(port) }))).toBe(2);
    expect(err.join('\n')).toMatch(/BOOTQUEST_DB is not set/);
  });

  it('refuses without --yes-really and touches nothing (exit 2)', async () => {
    const path = seeded();
    expect(await runReset([], deps({ BOOTQUEST_DB: path, BOOTQUEST_PORT: String(port) }))).toBe(2);
    expect(err.join('\n')).toMatch(/--yes-really/);
    expect(units(path)).toBe(1);
    expect(readdirSync(dir).some((f) => f.includes('.reset-'))).toBe(false);
  });

  it('refuses unknown arguments (exit 2)', async () => {
    expect(await runReset(['--yes'], deps({ BOOTQUEST_DB: seeded(), BOOTQUEST_PORT: String(port) }))).toBe(2);
  });

  it('refuses while something listens on the port (exit 1), DB untouched', async () => {
    const path = seeded();
    const holder: Server = createServer();
    await new Promise<void>((ok) => holder.listen({ port, host: '127.0.0.1' }, ok));
    try {
      expect(await runReset(['--yes-really'], deps({ BOOTQUEST_DB: path, BOOTQUEST_PORT: String(port) }))).toBe(1);
      expect(err.join('\n')).toMatch(/listening on port/);
      expect(units(path)).toBe(1);
    } finally {
      await new Promise<void>((ok) => holder.close(() => ok()));
    }
  });

  it.skipIf(process.platform !== 'win32')('refuses while another connection holds the DB file open (exit 1), rolled back', async () => {
    const path = seeded();
    const held = openDb({ path, env: {} });
    try {
      expect(await runReset(['--yes-really'], deps({ BOOTQUEST_DB: path, BOOTQUEST_PORT: String(port) }))).toBe(1);
      expect(err.join('\n')).toMatch(/in use/);
      expect(existsSync(path)).toBe(true);
    } finally {
      held.close();
    }
    expect(units(path)).toBe(1);
  });

  it('with --yes-really: renames (never deletes) the DB to *.reset-<stamp>.bak and creates a fresh migrated one', async () => {
    const path = seeded();
    expect(await runReset(['--yes-really'], deps({ BOOTQUEST_DB: path, BOOTQUEST_PORT: String(port) }))).toBe(0);
    const bak = `${path}.reset-20261008T120000Z.bak`;
    expect(existsSync(bak)).toBe(true);
    expect(units(bak)).toBe(1); // the history is kept
    expect(units(path)).toBe(0); // fresh
    expect(out.join('\n')).toMatch(/fresh database/);
  });
});
