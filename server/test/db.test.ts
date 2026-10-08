import { deepStrictEqual } from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECK_TYPES, COMPETENCY_IDS, XP_KINDS } from '@bootquest/shared';
import { DbPathError, openDb, resolveDbPath } from '../src/db/database.ts';
import { cleanRow, toNumber, toParam } from '../src/db/hygiene.ts';
import { migrate, schemaVersion } from '../src/db/migrate.ts';
import { recordAttempt } from '../src/engines/attempts.ts';
import { awardXp } from '../src/engines/xp.ts';
import { recordEvidence } from '../src/engines/evidence.ts';
import { addReviewItem, review } from '../src/engines/fsrs.ts';
import { insertCheck, insertContentRef, recordRun } from '../src/store/content.ts';
import { localNoon, makeTempDb, makeUnit, useTempDb } from './helpers.ts';
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
      expect(first.map((r) => r.version)).toEqual([1, 2]);
      tmp.db.close();

      const again = openDb({ path: tmp.path, env: {} });
      try {
        expect(migrate(again)).toEqual([]); // third pass, explicit
        expect(schemaVersion(again)).toBe(2);
        expect(again.get<{ n: number }>('SELECT COUNT(*) AS n FROM schema_version')!.n).toBe(2);
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

  it('seeds tracks js, csharp, java (locked), agentic', () => {
    const tracks = ctx.db.all<{ id: string; locked: boolean }>('SELECT id, locked FROM track ORDER BY sort_order');
    expect(tracks).toEqual([
      { id: 'js', locked: false },
      { id: 'csharp', locked: false },
      { id: 'java', locked: true },
      { id: 'agentic', locked: false },
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
    deepStrictEqual(clean, { id: 'java', locked: true }); // would throw on a null-prototype row
    expect(JSON.parse(JSON.stringify(clean))).toEqual({ id: 'java', locked: true });
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
    const a = recordAttempt(ctx.db, { unitId, outcome: 'pass' }, ctx.clock);
    expect(a.assisted).toBe(false);
    const b = recordAttempt(ctx.db, { unitId, outcome: 'pass', selfAssisted: true }, ctx.clock);
    expect(b.assisted).toBe(true);
  });
});

describe('append-only enforcement (SQL triggers)', () => {
  const ctx = useTempDb();

  function seedOneOfEach() {
    const unitId = makeUnit(ctx.db, ctx.clock);
    const attempt = recordAttempt(ctx.db, { unitId, outcome: 'pass' }, ctx.clock);
    const runId = recordRun(
      ctx.db,
      { kind: 'submit', attemptId: attempt.id, unitId, result: { pass: true, output: '', failures: [], durationMs: 5 } },
      ctx.clock,
    );
    const ev = recordEvidence(
      ctx.db,
      { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', assessor: 'pipeline', verified: true, attemptId: attempt.id },
      ctx.clock,
    );
    const xp = awardXp(ctx.db, { kind: 'code', difficulty: 2, unitId }, ctx.clock);
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
  }

  it('xp_event ledger rejects an UPDATE of the amount (the W1a XP case)', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    const xp = awardXp(ctx.db, { kind: 'quiz', unitId }, ctx.clock);
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
  });

  it('attempt.variation_unit_id is nullable', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    const a = recordAttempt(ctx.db, { unitId, outcome: 'fail' }, ctx.clock);
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
