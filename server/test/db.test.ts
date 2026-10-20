import { deepStrictEqual } from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECK_TYPES, COMPETENCY_IDS, XP_KINDS } from '@bootquest/shared';
import { DbPathError, openDb, resolveDbPath } from '../src/db/database.ts';
import { cleanRow, toNumber, toParam } from '../src/db/hygiene.ts';
import { Db } from '../src/db/database.ts';
import { migrate, MigrationChecksumError, schemaVersion } from '../src/db/migrate.ts';
import { recordAttempt } from '../src/engines/attempts.ts';
import { awardXp } from '../src/engines/xp.ts';
import { recordEvidence } from '../src/engines/evidence.ts';
import { addReviewItem, review } from '../src/engines/fsrs.ts';
import { insertCheck, insertContentRef, insertUnit, recordRun } from '../src/store/content.ts';
import { localNoon, makeTempDb, makeUnit, submit, useTempDb } from './helpers.ts';
import { fixedClock } from '../src/engines/clock.ts';

describe('DB path resolution', () => {
  it('refuses to open with no path and no BOOTQUEST_DB', () => {
    expect(() => openDb({ env: {} })).toThrow(DbPathError);
    expect(() => resolveDbPath({ env: { BOOTQUEST_DB: '   ' } })).toThrow(DbPathError);
  });

  it('uses BOOTQUEST_DB when no explicit path is given, explicit path wins', () => {
    expect(resolveDbPath({ env: { BOOTQUEST_DB: 'C:/x/env.db' } })).toBe('C:/x/env.db');
    expect(resolveDbPath({ path: 'C:/x/arg.db', env: { BOOTQUEST_DB: 'C:/x/env.db' } })).toBe('C:/x/arg.db');
  });

  it('opens from BOOTQUEST_DB in a temp dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootquest-env-'));
    const path = join(dir, 'env.db');
    const db = openDb({ env: { BOOTQUEST_DB: path } });
    try {
      expect(existsSync(path)).toBe(true);
      expect(db.path).toBe(path);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('migrations', () => {
  it('are idempotent: opening twice applies nothing new and seeds no duplicates', () => {
    const tmp = makeTempDb();
    try {
      const first = tmp.db.all<{ version: number }>('SELECT version FROM schema_version ORDER BY version');
      expect(first.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
      tmp.db.close();

      const again = openDb({ path: tmp.path, env: {} });
      try {
        expect(migrate(again)).toEqual([]); // third pass, explicit
        expect(schemaVersion(again)).toBe(13);
        expect(again.get<{ n: number }>('SELECT COUNT(*) AS n FROM schema_version')!.n).toBe(13);
        // 009: exactly one choice-order secret, and re-opening never regenerates it
        expect(again.all<{ secret: string }>('SELECT secret FROM server_secret')).toHaveLength(1);
        expect(again.all<{ checksum: string }>('SELECT checksum FROM schema_version').every((r) => /^[0-9a-f]{64}$/.test(r.checksum))).toBe(true);
        expect(again.get<{ n: number }>('SELECT COUNT(*) AS n FROM track')!.n).toBe(4);
        expect(again.get<{ n: number }>('SELECT COUNT(*) AS n FROM competency')!.n).toBe(7);
        expect(again.get<{ n: number }>('SELECT COUNT(*) AS n FROM competency_rating')!.n).toBe(7);
        expect(again.get<{ n: number }>('SELECT COUNT(*) AS n FROM streak')!.n).toBe(1);
      } finally {
        again.close();
      }
    } finally {
      tmp.cleanup();
    }
  });

  it('an applied migration that is later edited fails loudly (sha256 checksum)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootquest-mig-'));
    const db = new Db(join(dir, 'm.db'));
    try {
      writeFileSync(join(dir, '001_one.sql'), 'CREATE TABLE t1 (x INTEGER);\n');
      expect(migrate(db, dir)).toEqual([1]);
      writeFileSync(join(dir, '001_one.sql'), 'CREATE TABLE t1 (x INTEGER);\r\n'); // CRLF checkout: same checksum
      expect(migrate(db, dir)).toEqual([]);
      writeFileSync(join(dir, '001_one.sql'), 'CREATE TABLE t1 (x INTEGER, y TEXT);\n');
      expect(() => migrate(db, dir)).toThrow(MigrationChecksumError);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('every connection runs with recursive_triggers ON (REPLACE fires delete triggers)', () => {
    const tmp = makeTempDb();
    try {
      expect(tmp.db.get<{ recursive_triggers: number }>('PRAGMA recursive_triggers')!.recursive_triggers).toBe(1);
    } finally {
      tmp.cleanup();
    }
  });

  it('creates every spec §9 table', () => {
    const tmp = makeTempDb();
    try {
      const names = new Set(
        tmp.db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((r) => r.name),
      );
      for (const t of [
        'source', 'content_ref', 'track', 'unit', 'check', 'campaign_act', 'quest', 'attempt', 'run',
        'evidence', 'competency_rating', 'review_item', 'xp_event', 'skill_node', 'daily_slate', 'streak',
      ]) {
        expect(names.has(t), t).toBe(true);
      }
    } finally {
      tmp.cleanup();
    }
  });
});

describe('seed rows', () => {
  const ctx = useTempDb();

  it('seeds tracks js, csharp, java, agentic; 011 unlocks java with a slate drill slot like csharp', () => {
    const tracks = ctx.db.all<{ id: string; locked: boolean; slate_drills: boolean }>('SELECT id, locked, slate_drills FROM track ORDER BY sort_order');
    expect(tracks).toEqual([
      { id: 'js', locked: false, slate_drills: true },
      { id: 'csharp', locked: false, slate_drills: true },
      { id: 'java', locked: false, slate_drills: true },
      { id: 'agentic', locked: false, slate_drills: false },
    ]);
  });

  it('seeds exactly the seven §6.2 competencies, each rated 1', () => {
    const rows = ctx.db.all<{ competency_id: string; rating: number }>(
      'SELECT competency_id, rating FROM competency_rating ORDER BY competency_id',
    );
    expect(rows.map((r) => r.competency_id).sort()).toEqual([...COMPETENCY_IDS].sort());
    expect(rows.every((r) => r.rating === 1)).toBe(true);
  });
});

describe('row hygiene', () => {
  const ctx = useTempDb();

  it('raw node:sqlite rows have a null prototype; Db rows are plain objects', () => {
    const raw = ctx.db.raw.prepare(`SELECT id, locked FROM track WHERE id = 'java'`).get();
    expect(Object.getPrototypeOf(raw)).toBe(null);
    const clean = ctx.db.get(`SELECT id, locked FROM track WHERE id = 'java'`);
    expect(Object.getPrototypeOf(clean)).toBe(Object.prototype);
    deepStrictEqual(clean, { id: 'java', locked: false }); // would throw on a null-prototype row
    expect(JSON.parse(JSON.stringify(clean))).toEqual({ id: 'java', locked: false });
  });

  it('converts BigInt values (readBigInts) and insert ids to numbers', () => {
    const stmt = ctx.db.raw.prepare(`SELECT 42 AS n, sort_order FROM track WHERE id = 'js'`);
    stmt.setReadBigInts(true);
    const raw = stmt.get() as Record<string, unknown>;
    expect(typeof raw.n).toBe('bigint');
    const clean = cleanRow<{ n: number; sort_order: number }>(raw);
    expect(clean).toEqual({ n: 42, sort_order: 1 });
    expect(toNumber(7n)).toBe(7);
    expect(() => toNumber(2n ** 60n)).toThrow(RangeError);

    const unitId = makeUnit(ctx.db, ctx.clock);
    expect(typeof unitId).toBe('number');
    const res = ctx.db.run('UPDATE track SET name = name WHERE id = ?', 'js');
    expect(res).toEqual({ changes: 1, lastInsertRowid: expect.any(Number) });
  });

  it('exposes 0/1 boolean columns as booleans and binds booleans as 0/1', () => {
    expect(toParam(true)).toBe(1);
    expect(toParam(false)).toBe(0);
    expect(toParam(undefined)).toBe(null);
    const unitId = makeUnit(ctx.db, ctx.clock);
    const a = submit(ctx.db, ctx.clock, unitId);
    expect(a.assisted).toBe(false);
    const b = recordAttempt(ctx.db, { unitId, answer: { a: 1 }, selfAssisted: true }, ctx.clock);
    expect(b.assisted).toBe(true);
  });
});

describe('append-only enforcement (SQL triggers)', () => {
  const ctx = useTempDb();

  function seedOneOfEach() {
    const unitId = makeUnit(ctx.db, ctx.clock, { kind: 'guided-project', competencies: ['feature-delivery'] });
    const attempt = submit(ctx.db, ctx.clock, unitId);
    const runId = ctx.db.get<{ id: number }>('SELECT id FROM run WHERE attempt_id = ?', attempt.id)!.id;
    const ev = recordEvidence(
      ctx.db,
      { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', attemptId: attempt.id },
      ctx.clock,
    );
    const xp = awardXp(ctx.db, { kind: 'code', attemptId: attempt.id }, ctx.clock);
    const item = addReviewItem(ctx.db, { cardKey: 'k1' }, ctx.clock);
    review(ctx.db, item.id, 'good', ctx.clock);
    const logId = ctx.db.get<{ id: number }>('SELECT id FROM review_log')!.id;
    return { attempt: attempt.id, run: runId, evidence: ev.id, xp_event: xp.id, review_log: logId };
  }

  for (const table of ['attempt', 'run', 'evidence', 'xp_event', 'review_log'] as const) {
    it(`${table}: UPDATE raises`, () => {
      const ids = seedOneOfEach();
      const col = table === 'review_log' ? 'reviewed_at' : 'created_at';
      expect(() => ctx.db.run(`UPDATE ${table} SET ${col} = ${col} + 1 WHERE id = ?`, ids[table])).toThrow(/append-only/);
    });
    it(`${table}: DELETE raises`, () => {
      const ids = seedOneOfEach();
      expect(() => ctx.db.run(`DELETE FROM ${table} WHERE id = ?`, ids[table])).toThrow(/append-only/);
      expect(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n).toBeGreaterThan(0);
    });
    it(`${table}: INSERT OR REPLACE / REPLACE INTO an existing id raises (W1a audit #1)`, () => {
      const ids = seedOneOfEach();
      const before = JSON.stringify(ctx.db.get(`SELECT * FROM ${table} WHERE id = ?`, ids[table]));
      const cols = ctx.db.all<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, table).map((c) => c.name);
      const list = cols.join(', ');
      for (const verb of ['INSERT OR REPLACE INTO', 'REPLACE INTO']) {
        expect(() => ctx.db.run(`${verb} ${table} (${list}) SELECT ${list} FROM ${table} WHERE id = ?`, ids[table])).toThrow(/append-only/);
      }
      expect(JSON.stringify(ctx.db.get(`SELECT * FROM ${table} WHERE id = ?`, ids[table]))).toBe(before);
    });
  }

  it('the probe attacks from the audit are blocked: xp amount rewrite and evidence laundering via REPLACE', () => {
    const ids = seedOneOfEach();
    const xp = ctx.db.get<{ kind: string; day: string; created_at: number }>('SELECT kind, day, created_at FROM xp_event WHERE id = ?', ids.xp_event)!;
    expect(() =>
      ctx.db.run(`INSERT OR REPLACE INTO xp_event (id, kind, amount, day, created_at) VALUES (?, ?, 999, ?, ?)`, ids.xp_event, xp.kind, xp.day, xp.created_at),
    ).toThrow(/append-only/);
    expect(() =>
      ctx.db.run(
        `REPLACE INTO evidence (id, competency_id, kind, intention, observation, assistance, assessor, verified, created_at)
         VALUES (?, 'feature-delivery', 'artifact', 'i', 'o', 'none', 'pipeline', 1, 0)`,
        ids.evidence,
      ),
    ).toThrow(/append-only/);
    // upsert goes through the UPDATE trigger
    expect(() =>
      ctx.db.run(`INSERT INTO xp_event (id, kind, amount, day, created_at) VALUES (?, 'code', 1, '2026-10-01', 0) ON CONFLICT(id) DO UPDATE SET amount = 999`, ids.xp_event),
    ).toThrow(/append-only/);
    expect(ctx.db.get<{ amount: number }>('SELECT amount FROM xp_event WHERE id = ?', ids.xp_event)!.amount).toBe(20);
  });

  it('xp_event ledger rejects an UPDATE of the amount (the W1a XP case)', () => {
    const unitId = makeUnit(ctx.db, ctx.clock, { kind: 'quiz' });
    const xp = awardXp(ctx.db, { kind: 'quiz', attemptId: submit(ctx.db, ctx.clock, unitId).id }, ctx.clock);
    expect(() => ctx.db.run('UPDATE xp_event SET amount = 999 WHERE id = ?', xp.id)).toThrow(/append-only/);
    expect(ctx.db.get<{ amount: number }>('SELECT amount FROM xp_event WHERE id = ?', xp.id)!.amount).toBe(2);
  });
});

describe('schema constraints', () => {
  const ctx = useTempDb();

  it('check.type accepts every shared CheckType and rejects unknown types', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    for (const type of CHECK_TYPES) {
      ctx.db.run(
        `INSERT INTO "check" (unit_id, type, spec, created_at) VALUES (?, ?, ?, 0)`,
        unitId,
        type,
        JSON.stringify({ type }),
      );
    }
    expect(() =>
      ctx.db.run(`INSERT INTO "check" (unit_id, type, spec, created_at) VALUES (?, 'bogus', '{}', 0)`, unitId),
    ).toThrow();
  });

  it('xp_event.kind accepts every shared XpKind', () => {
    for (const kind of XP_KINDS) {
      ctx.db.run(`INSERT INTO xp_event (kind, amount, day, created_at) VALUES (?, 0, '2026-10-01', 0)`, kind);
    }
  });

  it('inverted flag is only legal on self-run checks; todo is a distinct run verdict', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    const hunt = insertCheck(ctx.db, unitId, { type: 'self-run', language: 'js', file: 'bootcamp/24-debug-hunts/exercises/01-x.js', inverted: true }, ctx.clock);
    expect(ctx.db.get<{ inverted: boolean }>('SELECT inverted FROM "check" WHERE id = ?', hunt)!.inverted).toBe(true);
    expect(() =>
      ctx.db.run(`INSERT INTO "check" (unit_id, type, spec, inverted, created_at) VALUES (?, 'quiz', '{}', 1, 0)`, unitId),
    ).toThrow();
    const runId = recordRun(
      ctx.db,
      { kind: 'run', unitId, result: { pass: false, output: '#done passed=3 failed=0 todo=2', failures: [], durationMs: 10, verdict: 'todo', counts: { passed: 3, failed: 0, todo: 2 } } },
      ctx.clock,
    );
    expect(ctx.db.get('SELECT verdict, passed, failed, todo FROM run WHERE id = ?', runId)).toEqual({ verdict: 'todo', passed: 3, failed: 0, todo: 2 });
  });

  it('attempt mode/assisted/assistance_source must agree', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    expect(() =>
      ctx.db.run(
        `INSERT INTO attempt (unit_id, mode, assisted, assistance_source, outcome, created_at) VALUES (?, 'solo', 1, 'self', 'pass', 0)`,
        unitId,
      ),
    ).toThrow();
    expect(() =>
      ctx.db.run(
        `INSERT INTO attempt (unit_id, mode, assisted, assistance_source, outcome, created_at) VALUES (?, 'guided', 1, 'self', 'pass', 0)`,
        unitId,
      ),
    ).toThrow();
    // 013: 'prior-key' is an ASSISTED source only
    for (const bad of [`'solo', 0, 'prior-key'`, `'guided', 1, 'prior-key'`, `'assisted', 0, 'prior-key'`]) {
      expect(() => ctx.db.run(`INSERT INTO attempt (unit_id, mode, assisted, assistance_source, outcome, created_at) VALUES (?, ${bad}, 'submitted', 0)`, unitId), bad).toThrow();
    }
    ctx.db.run(`INSERT INTO attempt (unit_id, mode, assisted, assistance_source, outcome, created_at) VALUES (?, 'assisted', 1, 'prior-key', 'submitted', 0)`, unitId);
  });

  it('migration 013 (prior-key) rebuilds attempt + evidence on a DB WITH history: rows, FKs, append-only triggers and the frozen-check trigger all survive', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootquest-m013-'));
    const migDir = join(dir, 'migrations');
    const all = join(import.meta.dirname, '..', 'src', 'db', 'migrations');
    try {
      // a DB at schema 12 with history
      mkdirSync(migDir);
      for (const f of readdirSync(all).filter((f) => /^0(0\d|1[0-2])_/.test(f))) copyFileSync(join(all, f), join(migDir, f));
      const db = new Db(join(dir, 'm.db'));
      try {
        migrate(db, migDir);
        expect(schemaVersion(db)).toBe(12);
        const clock = fixedClock(localNoon(2026, 10, 1));
        const unitId = makeUnit(db, clock, { kind: 'drill', competencies: ['language-fluency'] });
        const a = submit(db, clock, unitId);
        const ev = recordEvidence(db, { competency: 'language-fluency', kind: 'submit', intention: 'i', observation: 'o', attemptId: a.id }, clock);
        const before = {
          attempt: db.all('SELECT * FROM attempt ORDER BY id'),
          evidence: db.all('SELECT * FROM evidence ORDER BY id'),
          run: db.all('SELECT * FROM run ORDER BY id'),
        };
        expect(() => db.run(`INSERT INTO attempt (unit_id, mode, assisted, assistance_source, outcome, created_at) VALUES (?, 'assisted', 1, 'prior-key', 'submitted', 0)`, unitId)).toThrow();
        // now the real migration set (013 included)
        expect(migrate(db)).toEqual([13]);
        expect({ attempt: db.all('SELECT * FROM attempt ORDER BY id'), evidence: db.all('SELECT * FROM evidence ORDER BY id'), run: db.all('SELECT * FROM run ORDER BY id') }).toEqual(before);
        expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
        expect(() => db.run('UPDATE attempt SET score = 0 WHERE id = ?', a.id)).toThrow(/append-only/);
        expect(() => db.run('DELETE FROM evidence WHERE id = ?', ev.id)).toThrow(/append-only/);
        expect(() => db.run(`UPDATE "check" SET spec = json_set(spec, '$.timeoutMs', 1) WHERE unit_id = ?`, unitId)).toThrow(/frozen/);
        db.run(`INSERT INTO attempt (unit_id, mode, assisted, assistance_source, outcome, created_at) VALUES (?, 'assisted', 1, 'prior-key', 'submitted', 0)`, unitId);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('attempt.variation_unit_id is nullable', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    const a = submit(ctx.db, ctx.clock, unitId, { pass: false });
    expect(a.variation_unit_id).toBe(null);
  });

  it('content_ref.stable_key is unique per repo, not globally (twins share headings)', () => {
    const base = {
      path: 'docs/guide.md', sha: 'abc1234', title: 'Exercise 1', stableKey: 'h:exercise-1',
      kind: 'guide', provenance: 'heading-hash',
    } as const;
    insertContentRef(ctx.db, { ...base, repo: 'elirc/ww12' }, ctx.clock);
    insertContentRef(ctx.db, { ...base, repo: 'elirc/organized-experiment-ww12' }, ctx.clock);
    expect(() => insertContentRef(ctx.db, { ...base, repo: 'elirc/ww12', path: 'moved/guide.md' }, ctx.clock)).toThrow(
      /UNIQUE/,
    );
  });

  it('insertUnit links content_ref by (repo, stable_key): twin repos with the same key resolve correctly (audit #9)', () => {
    const base = {
      path: 'docs/guide.md', sha: 'abc1234', title: 'Exercise 1', stableKey: 'h:exercise-1',
      kind: 'guide', provenance: 'heading-hash',
    } as const;
    const a = insertContentRef(ctx.db, { ...base, repo: 'elirc/ww12' }, ctx.clock);
    const b = insertContentRef(ctx.db, { ...base, repo: 'elirc/organized-experiment-ww12' }, ctx.clock);
    const unit = (key: string, repo: string) =>
      insertUnit(ctx.db, { key, track: 'js', kind: 'reading', title: key, contentRef: { repo, stableKey: 'h:exercise-1' } }, ctx.clock);
    const ref = (id: number) => ctx.db.get<{ r: number }>('SELECT content_ref_id AS r FROM unit WHERE id = ?', id)!.r;
    expect(ref(unit('u:twin', 'elirc/organized-experiment-ww12'))).toBe(b);
    expect(ref(unit('u:orig', 'elirc/ww12'))).toBe(a);
    expect(() => unit('u:none', 'elirc/other')).toThrow(/unknown content_ref/);
    expect(() =>
      insertUnit(ctx.db, { key: 'u:bare', track: 'js', kind: 'reading', title: 't', contentRef: 'h:exercise-1' }, ctx.clock),
    ).toThrow(); // a bare stable key is ambiguous across twins: rejected by the schema
  });

  it('insertUnit stores phase, xp and target level losslessly (audit #15)', () => {
    const id = insertUnit(ctx.db, { key: 'sp:U02', track: 'js', kind: 'program-unit', title: 'U02', code: 'U02', phase: 'P1', xp: 120, targetLevel: 3 }, ctx.clock);
    expect(ctx.db.get('SELECT code, phase, xp, target_level FROM unit WHERE id = ?', id)).toEqual({ code: 'U02', phase: 'P1', xp: 120, target_level: 3 });
  });

  it('check.type / inverted must agree with the spec JSON; summary is <= 280 chars in SQL (audit #14, #18)', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    expect(() =>
      ctx.db.run(`INSERT INTO "check" (unit_id, type, spec, created_at) VALUES (?, 'quiz', ?, 0)`, unitId, JSON.stringify({ type: 'drill-js' })),
    ).toThrow(/must match/);
    expect(() =>
      ctx.db.run(
        `INSERT INTO "check" (unit_id, type, spec, inverted, created_at) VALUES (?, 'self-run', ?, 0, 0)`,
        unitId,
        JSON.stringify({ type: 'self-run', inverted: true }),
      ),
    ).toThrow(/must match/);
    expect(() =>
      ctx.db.run(
        `INSERT INTO content_ref (repo, path, sha, title, summary, stable_key, kind, provenance, created_at, updated_at)
         VALUES ('elirc/x', 'a.md', 'abc1234', 't', ?, 'k', 'guide', 'heading-hash', 0, 0)`,
        'x'.repeat(281),
      ),
    ).toThrow(/280/);
  });

  it('recordRun stores free runs only; pass flags that contradict self-run counts are rejected (audit #12)', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    expect(() =>
      recordRun(ctx.db, { kind: 'submit', unitId, result: { pass: true, output: '', failures: [], durationMs: 1 } } as never, ctx.clock),
    ).toThrow(/free runs only/);
    const runId = recordRun(
      ctx.db,
      { kind: 'run', unitId, result: { pass: false, output: '', failures: [], durationMs: 1, counts: { passed: 2, failed: 0, todo: 1 } } },
      ctx.clock,
    );
    expect(ctx.db.get<{ verdict: string }>('SELECT verdict FROM run WHERE id = ?', runId)!.verdict).toBe('todo');
    expect(() =>
      recordRun(ctx.db, { kind: 'run', unitId, result: { pass: true, output: '', failures: [], durationMs: 1, counts: { passed: 2, failed: 0, todo: 1 } } }, ctx.clock),
    ).toThrow(/contradicts/);
  });

  it('content_ref rejects curriculum text (strict schema) and no table has a text-body column', () => {
    expect(() =>
      insertContentRef(
        ctx.db,
        { repo: 'elirc/x', path: 'a.md', sha: 'abc1234', title: 't', stableKey: 'k', kind: 'guide', provenance: 'heading-hash', body: '# whole lesson' },
        ctx.clock,
      ),
    ).toThrow();
    const tables = ctx.db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`);
    for (const { name } of tables) {
      const cols = ctx.db.all<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, name);
      for (const c of cols) expect(c.name, `${name}.${c.name}`).not.toMatch(/^(body|text|content|markdown|md|lesson|prompt.*)$/);
    }
  });
});

describe('temp DB isolation', () => {
  it('fixed clocks are deterministic', () => {
    const c = fixedClock(localNoon(2026, 1, 2));
    expect(c().getTime()).toBe(c().getTime());
  });
});
