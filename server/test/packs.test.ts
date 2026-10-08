import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countPackUnits, PACK_FORMAT, type PackCounts } from '@bootquest/shared';
import { createApp } from '../src/api/app.ts';
import { entriesContentStore } from '../src/api/content-store.ts';
import { defaultRunners } from '../src/api/runners.ts';
import { startServer } from '../src/api/serve.ts';
import { Db } from '../src/db/database.ts';
import { migrate } from '../src/db/migrate.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { loadPackIntoDb, packContentEntries, PackLoadError, readPack } from '../src/store/packs.ts';
import { localNoon, makeTempDb, makeUnit, submit, type TempDb } from './helpers.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const BOOTFORGE = join(REPO, 'content', 'packs', 'bootforge');
const MIGRATIONS = fileURLToPath(new URL('../src/db/migrations/', import.meta.url));
const clock = fixedClock(localNoon(2026, 10, 1));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------- synthetic pack builder

interface SynthUnit {
  slug: string;
  type: 'quiz' | 'written';
  prerequisites?: string[];
}

const keyOf = (course: string, slug: string) => `synth/${course}/m/l/${slug}`;

function synthCourse(course: string, units: SynthUnit[]) {
  return {
    format: PACK_FORMAT,
    source: 'synth',
    course: { id: course, order: 1, title: 'Synthetic', description: '', prerequisites: [] },
    modules: [{ id: 'm', title: 'M', lessons: [{ id: 'l', title: 'L', explanation: 'x' }] }],
    units: units.map((u, i) => ({
      unit: {
        key: keyOf(course, u.slug),
        track: 'js',
        kind: u.type === 'quiz' ? 'quiz' : 'written',
        title: u.slug,
        phase: course,
        difficulty: 1,
        xp: 5,
        competencies: ['language-fluency'],
        prerequisites: (u.prerequisites ?? []).map((p) => keyOf(course, p)),
        checks:
          u.type === 'quiz'
            ? [{ spec: { type: 'quiz', itemKey: keyOf(course, u.slug), grading: 'choice', answerKey: 1, choices: ['a', 'b', 'c'] } }]
            : [],
      },
      origin: { id: `${course}/m/l/${u.slug}`, type: u.type, module: 'm', lesson: 'l', position: i, skills: [] },
    })),
    content: Object.fromEntries(
      units.map((u) => [keyOf(course, u.slug), u.type === 'quiz' ? { instructions: `Q ${u.slug}?` } : { instructions: 'Write', solution: 'model', rubric: [{ id: 'a', label: 'A' }] }]),
    ),
  };
}

/** Write a one-course synthetic pack; `countsOverride` plants a manifest/count mismatch. */
function writeSynthPack(dir: string, units: SynthUnit[], opts: { countsOverride?: PackCounts } = {}) {
  mkdirSync(dir, { recursive: true });
  const course = synthCourse('c1', units);
  const bytes = `${JSON.stringify(course, null, 1)}\n`;
  writeFileSync(join(dir, 'c1.json'), bytes);
  const counts = opts.countsOverride ?? countPackUnits(course.units as { origin: { type: 'quiz' | 'written' } }[]);
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      format: PACK_FORMAT,
      source: 'synth',
      track: 'js',
      importedFrom: { repo: 'local/synth', originKind: 'local', subpath: '', path: dir.replace(/\\/g, '/'), gitHead: null, dirty: null },
      expected: null,
      totals: counts,
      courses: [{ id: 'c1', order: 1, file: 'c1.json', sha256: sha(bytes), counts }],
    }),
  );
}

const unitCount = (db: Db) => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM unit')!.n;

// ---------------------------------------------------------------- migration 004

describe('migration 004 (written unit kind, FK-off table rebuild)', () => {
  it('preserves existing units and their FK-referencing rows, and accepts kind written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootquest-mig4-'));
    const partial = join(dir, 'migs');
    mkdirSync(partial);
    for (const f of readdirSync(MIGRATIONS).filter((f) => /^00[123]_/.test(f))) copyFileSync(join(MIGRATIONS, f), join(partial, f));
    const db = new Db(join(dir, 'm.db'));
    try {
      expect(migrate(db, partial)).toEqual([1, 2, 3]);
      const unitId = makeUnit(db, clock, { key: 'pre-004' });
      const attempt = submit(db, clock, unitId);
      const before = db.get('SELECT * FROM unit WHERE id = ?', unitId);

      expect(migrate(db)).toEqual([4]);
      expect(db.get('SELECT * FROM unit WHERE id = ?', unitId)).toEqual(before);
      expect(db.get<{ unit_id: number }>('SELECT unit_id FROM attempt WHERE id = ?', attempt.id)!.unit_id).toBe(unitId);
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      expect(db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')!.foreign_keys).toBe(1);
      // FKs still enforced against the rebuilt table
      expect(() => db.run('INSERT INTO unit_competency (unit_id, competency_id) VALUES (999999, ?)', 'language-fluency')).toThrow();

      const written = makeUnit(db, clock, { key: 'w1', kind: 'written', noCheck: true });
      expect(db.get<{ kind: string }>('SELECT kind FROM unit WHERE id = ?', written)!.kind).toBe('written');
      expect(() => db.run(`INSERT INTO unit (key, track_id, kind, title, created_at) VALUES ('bad', 'js', 'not-a-kind', 't', 0)`)).toThrow();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------- loader

describe('pack loader', () => {
  let tmp: TempDb;
  let dir: string;
  beforeEach(() => {
    tmp = makeTempDb();
    dir = mkdtempSync(join(tmpdir(), 'bootquest-pack-'));
  });
  afterEach(() => {
    tmp.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a real BootForge course pack: loaded === built, and a second load is a no-op (idempotent)', () => {
    const pack = readPack(BOOTFORGE, { courses: ['js-fundamentals'] });
    const built = pack.manifest.courses.find((c) => c.id === 'js-fundamentals')!.counts;
    const first = loadPackIntoDb(tmp.db, pack, clock);
    expect(first).toMatchObject({ source: 'bootforge', inserted: built.total, updated: 0, unchanged: 0, built: built.total, loaded: built.total });
    expect(first.checks).toBe(built.total - built.written);
    expect(first.contentEntries).toBe(built.total);
    const ids1 = tmp.db.all<{ id: number; key: string }>('SELECT id, key FROM unit ORDER BY id');
    const checks1 = tmp.db.all('SELECT id, unit_id, spec FROM "check" ORDER BY id');

    const second = loadPackIntoDb(tmp.db, readPack(BOOTFORGE, { courses: ['js-fundamentals'] }), clock);
    expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: built.total, built: built.total, loaded: built.total });
    expect(tmp.db.all('SELECT id, key FROM unit ORDER BY id')).toEqual(ids1);
    expect(tmp.db.all('SELECT id, unit_id, spec FROM "check" ORDER BY id')).toEqual(checks1);
    expect(tmp.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM source WHERE key = 'bootforge'`)!.n).toBe(1);
    // upstream order preserved: unit ids follow pack order
    const file = pack.courses[0]!;
    expect(ids1.map((r) => r.key)).toEqual(file.units.map((u) => u.unit.key));
  });

  it('serves a loaded BootForge drill: public instructions/starter, no solution, reference solution grades pass', async () => {
    const pack = readPack(BOOTFORGE, { courses: ['js-fundamentals'] });
    loadPackIntoDb(tmp.db, pack, clock);
    const app = createApp({ db: tmp.db, clock, runners: defaultRunners(), content: entriesContentStore(packContentEntries(pack)) });
    const pu = pack.courses[0]!.units.find((u) => u.origin.type === 'code')!;
    const content = pack.courses[0]!.content[pu.unit.key]!;
    const id = tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', pu.unit.key)!.id;
    const detail = await request(app).get(`/api/units/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.instructions).toBe(content.instructions);
    expect(detail.body.starter).toBe(content.starter);
    expect(detail.text).not.toContain(JSON.stringify(content.solution).slice(1, -1));
    expect(detail.body.check.spec.tests.every((t: object) => Object.keys(t).join() === 'name')).toBe(true);
    const sub = await request(app).post(`/api/units/${id}/submit`).send({ code: content.solution });
    expect(sub.status).toBe(200);
    expect(sub.body.verdict).toBe('pass');
    expect(sub.body.xp.amount).toBe(10 * pu.unit.difficulty!);
  }, 30000);

  it('refuses a pack whose manifest count differs from the course file (loaded !== built)', () => {
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz' }, { slug: 'b', type: 'quiz' }], {
      countsOverride: { total: 3, code: 0, quiz: 3, output: 0, written: 0 },
    });
    expect(() => readPack(dir)).toThrow(PackLoadError);
    expect(() => readPack(dir)).toThrow(/units count/);
  });

  it('refuses a course file edited after import (sha256 mismatch)', () => {
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz' }]);
    const f = join(dir, 'c1.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('"Q a?"', '"Q tampered?"'));
    expect(() => readPack(dir)).toThrow(/sha256/);
  });

  it('refuses (and rolls back) when the DB holds a unit of the course that the pack does not build', () => {
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz' }, { slug: 'w', type: 'written' }]);
    const pack = readPack(dir);
    loadPackIntoDb(tmp.db, pack, clock);
    // a stale row under the same source + course prefix (e.g. an exercise removed upstream)
    const src = tmp.db.get<{ id: number }>(`SELECT id FROM source WHERE key = 'synth'`)!.id;
    tmp.db.run(
      `INSERT INTO unit (key, track_id, kind, title, source_id, created_at) VALUES (?, 'js', 'written', 'stale', ?, 0)`,
      keyOf('c1', 'gone'),
      src,
    );
    const before = unitCount(tmp.db);
    expect(() => loadPackIntoDb(tmp.db, readPack(dir), clock)).toThrow(/loaded !== built.*not in the pack/);
    expect(unitCount(tmp.db)).toBe(before);
  });

  it('refuses a unit whose kind changed upstream (attempts reference it)', () => {
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz' }]);
    loadPackIntoDb(tmp.db, readPack(dir), clock);
    rmSync(dir, { recursive: true, force: true });
    writeSynthPack(dir, [{ slug: 'a', type: 'written' }]);
    expect(() => loadPackIntoDb(tmp.db, readPack(dir), clock)).toThrow(/changed kind/);
  });

  it('withholds quarantined units: never loaded, no content served, built shrinks accordingly', () => {
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz' }, { slug: 'b', type: 'quiz' }, { slug: 'w', type: 'written' }]);
    writeFileSync(
      join(dir, 'quarantine.json'),
      JSON.stringify({ format: PACK_FORMAT, source: 'synth', entries: [{ key: keyOf('c1', 'b'), course: 'c1', reason: 'reference fails' }] }),
    );
    const pack = readPack(dir);
    const stats = loadPackIntoDb(tmp.db, pack, clock);
    expect(stats).toMatchObject({ built: 2, loaded: 2, withheld: 1, checks: 1, contentEntries: 2 });
    expect(tmp.db.get('SELECT id FROM unit WHERE key = ?', keyOf('c1', 'b'))).toBeUndefined();
    expect(packContentEntries(pack).has(keyOf('c1', 'b'))).toBe(false);
  });

  it('wires prerequisite edges from the pack (second pass), idempotently', () => {
    writeSynthPack(dir, [{ slug: 'b', type: 'quiz', prerequisites: ['a'] }, { slug: 'a', type: 'quiz' }]);
    loadPackIntoDb(tmp.db, readPack(dir), clock);
    const id = (s: string) => tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', keyOf('c1', s))!.id;
    const edges = () => tmp.db.all('SELECT unit_id, prereq_unit_id FROM unit_prerequisite');
    expect(edges()).toEqual([{ unit_id: id('b'), prereq_unit_id: id('a') }]);
    const again = loadPackIntoDb(tmp.db, readPack(dir), clock);
    expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect(edges()).toEqual([{ unit_id: id('b'), prereq_unit_id: id('a') }]);
  });
});

// ---------------------------------------------------------------- startup refusal

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => ok(port));
    });
  });
}

describe('server startup with packs', () => {
  it('refuses to start when a pack count mismatches, and starts (loaded === built) when it matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootquest-packstart-'));
    try {
      const bad = join(dir, 'bad');
      writeSynthPack(bad, [{ slug: 'a', type: 'quiz' }], { countsOverride: { total: 2, code: 0, quiz: 2, output: 0, written: 0 } });
      const env = { BOOTQUEST_DB: join(dir, 'a.db'), BOOTQUEST_PORT: String(await freePort()), BOOTQUEST_PACKS: bad };
      await expect(startServer({ env, clock })).rejects.toThrow(PackLoadError);

      const good = join(dir, 'good');
      writeSynthPack(good, [{ slug: 'a', type: 'quiz' }, { slug: 'w', type: 'written' }]);
      const running = await startServer({ env: { ...env, BOOTQUEST_DB: join(dir, 'b.db'), BOOTQUEST_PACKS: good }, clock });
      try {
        expect(running.packs).toEqual([expect.objectContaining({ source: 'synth', built: 2, loaded: 2, checks: 1 })]);
        const res = await fetch(`http://127.0.0.1:${running.port}/api/health`);
        expect(((await res.json()) as { counts: { units: number } }).counts.units).toBe(2);
      } finally {
        await running.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('BOOTQUEST_PACK_COURSES restricts the load to the named courses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootquest-packcourse-'));
    try {
      const port = await freePort();
      const running = await startServer({
        env: { BOOTQUEST_DB: join(dir, 'c.db'), BOOTQUEST_PORT: String(port), BOOTQUEST_PACKS: BOOTFORGE, BOOTQUEST_PACK_COURSES: 'engineering-practice' },
        clock,
      });
      try {
        expect(running.packs).toEqual([expect.objectContaining({ source: 'bootforge', courses: ['engineering-practice'], built: 12, loaded: 12, checks: 6 })]);
      } finally {
        await running.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe('fresh DB (openDb migrates through 004)', () => {
  it('accepts written units straight away', () => {
    const t = makeTempDb();
    try {
      expect(() => makeUnit(t.db, clock, { key: 'w', kind: 'written', noCheck: true })).not.toThrow();
    } finally {
      t.cleanup();
    }
  });
});
