import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countPackUnits, PACK_FORMAT, PackManifest, type PackCounts } from '@bootquest/shared';
import { createApp } from '../src/api/app.ts';
import { entriesContentStore } from '../src/api/content-store.ts';
import { defaultRunners } from '../src/api/runners.ts';
import { startServer } from '../src/api/serve.ts';
import { Db } from '../src/db/database.ts';
import { migrate } from '../src/db/migrate.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { FINGERPRINT_FILES, IMPORT_GATE, graderFingerprint, graderKindForManifest, graderKindForTrack, toolchainVersions } from '../src/store/grader-fingerprint.ts';
import { ALLOW_UNSTAMPED_ENV, loadPackIntoDb, packContentEntries, PackLoadError, readPack, type ReadPackOptions } from '../src/store/packs.ts';
import { localNoon, makeTempDb, makeUnit, submit, type TempDb } from './helpers.ts';
import { servedQuizAnswer } from './api/harness.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const BOOTFORGE = join(REPO, 'content', 'packs', 'bootforge');
const MIGRATIONS = fileURLToPath(new URL('../src/db/migrations/', import.meta.url));
const clock = fixedClock(localNoon(2026, 10, 1));
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
/** Test-harness opt-out of the import-gate stamp (W2b/F1). The real serve path never sets it. */
const UNSTAMPED = { allowUnstamped: true } as const;
const read = (dir: string, opts: ReadPackOptions = {}) => readPack(dir, { ...UNSTAMPED, ...opts });

// ---------------------------------------------------------------- synthetic pack builder

interface SynthUnit {
  slug: string;
  type: 'quiz' | 'written';
  prerequisites?: string[];
  variationOf?: string;
  /** a quiz's keyed choice frame (default answerKey 1 of a, b, c); a re-seed changes it */
  quiz?: { answerKey: number; choices: string[] };
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
        ...(u.variationOf ? { variationOf: keyOf(course, u.variationOf) } : {}),
        checks:
          u.type === 'quiz'
            ? [{ spec: { type: 'quiz', itemKey: keyOf(course, u.slug), grading: 'choice', answerKey: u.quiz?.answerKey ?? 1, choices: u.quiz?.choices ?? ['a', 'b', 'c'] } }]
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

      // 007 (W5b campaign) and 008 (W6 ladder rebuilds) also apply here; the enumeration was stale since W5b
      expect(migrate(db)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
      // 005 only adds the nullable retired_at column (live by default)
      expect(db.get('SELECT * FROM unit WHERE id = ?', unitId)).toEqual({ ...(before as object), retired_at: null });
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

describe('migration 008 (W6: evidence + review_item rebuilds)', () => {
  it('preserves evidence / ratings / review rows, keeps every append-only + rating trigger, and accepts the new kinds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootquest-mig8-'));
    const partial = join(dir, 'migs');
    mkdirSync(partial);
    for (const f of readdirSync(MIGRATIONS).filter((f) => /^00[1-7]_/.test(f))) copyFileSync(join(MIGRATIONS, f), join(partial, f));
    const db = new Db(join(dir, 'm.db'));
    try {
      expect(migrate(db, partial)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      const unitId = makeUnit(db, clock, { key: 'pre-008', kind: 'guided-project', competencies: ['data-http'] });
      const attempt = submit(db, clock, unitId);
      db.run(
        `INSERT INTO evidence (competency_id, attempt_id, unit_id, kind, intention, observation, assistance, assessor, verified, score, created_at)
         VALUES ('data-http', ?, ?, 'submit', 'i', 'o', 'none', 'pipeline', 1, 1, 0)`,
        attempt.id,
        unitId,
      );
      db.run(
        `INSERT INTO evidence (competency_id, kind, intention, observation, assistance, assessor, rating, verified, created_at)
         VALUES ('data-http', 'demotion', 'i', 'o', 'none', 'pipeline', 1, 1, 0)`,
      );
      db.run(`INSERT INTO review_item (card_key, kind, fsrs_state, due_at, created_at, updated_at) VALUES ('c1', 'card', '{}', 0, 0, 0)`);
      const evBefore = db.all('SELECT * FROM evidence ORDER BY id');
      const riBefore = db.all('SELECT * FROM review_item ORDER BY id');

      expect(migrate(db)).toEqual([8, 9, 10, 11, 12]);
      expect(db.all('SELECT * FROM evidence ORDER BY id')).toEqual(evBefore);
      // 012 only adds the nullable review_item.retired_at (live by default)
      expect(db.all('SELECT * FROM review_item ORDER BY id')).toEqual(riBefore.map((r) => ({ ...(r as object), retired_at: null })));
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      const triggers = db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`).map((t) => t.name);
      for (const t of ['evidence_no_update', 'evidence_no_delete', 'evidence_no_replace', 'evidence_rating_change_consistent', 'competency_rating_guarded_update']) {
        expect(triggers).toContain(t);
      }
      expect(() => db.run('UPDATE evidence SET score = 0 WHERE id = 1')).toThrow(/append-only/);
      expect(() => db.run('DELETE FROM evidence WHERE id = 1')).toThrow(/append-only/);
      expect(() =>
        db.run(`REPLACE INTO evidence (id, competency_id, kind, intention, observation, assistance, assessor, verified, created_at) VALUES (1, 'data-http', 'submit', 'x', 'x', 'none', 'pipeline', 1, 0)`),
      ).toThrow(/append-only/);
      expect(() => db.run(`UPDATE competency_rating SET rating = 3, last_evidence_id = 2 WHERE competency_id = 'data-http'`)).toThrow(/rating integrity/);
      // the new kinds are accepted; unknown kinds still are not
      db.run(`INSERT INTO evidence (competency_id, kind, intention, observation, assistance, assessor, verified, score, created_at) VALUES ('data-http', 'mutation', 'i', 'o', 'none', 'pipeline', 1, 0.9, 0)`);
      db.run(`INSERT INTO review_item (card_key, kind, fsrs_state, due_at, created_at, updated_at) VALUES ('r1', 'retest', '{}', 0, 0, 0)`);
      expect(() => db.run(`INSERT INTO review_item (card_key, kind, fsrs_state, due_at, created_at, updated_at) VALUES ('r2', 'nope', '{}', 0, 0, 0)`)).toThrow();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('migration 010 (drill-java check type, FK-off "check" rebuild)', () => {
  it('preserves checks and their FK-referencing attempts/runs, keeps the spec triggers + index, and accepts drill-java', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootquest-mig10-'));
    const partial = join(dir, 'migs');
    mkdirSync(partial);
    for (const f of readdirSync(MIGRATIONS).filter((f) => /^00\d_/.test(f))) copyFileSync(join(MIGRATIONS, f), join(partial, f));
    const db = new Db(join(dir, 'm.db'));
    try {
      expect(migrate(db, partial)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const unitId = makeUnit(db, clock, { key: 'pre-010' });
      const attempt = submit(db, clock, unitId);
      const checksBefore = db.all('SELECT * FROM "check" ORDER BY id');
      const runsBefore = db.all('SELECT * FROM run ORDER BY id');

      expect(migrate(db)).toEqual([10, 11, 12]);
      // 012 only adds the nullable "check".retired_at (live by default)
      expect(db.all('SELECT * FROM "check" ORDER BY id')).toEqual(checksBefore.map((c) => ({ ...(c as object), retired_at: null })));
      expect(db.all('SELECT * FROM run ORDER BY id')).toEqual(runsBefore);
      expect(db.get<{ check_id: number }>('SELECT check_id FROM attempt WHERE id = ?', attempt.id)!.check_id).toBe((checksBefore[0] as { id: number }).id);
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      expect(db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')!.foreign_keys).toBe(1);
      const names = db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE tbl_name = 'check' ORDER BY name`).map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['check', 'check_spec_type_agrees', 'check_spec_type_agrees_update', 'check_unit']));
      // FKs still enforced against the rebuilt table
      expect(() => db.run(`INSERT INTO "check" (unit_id, type, spec, created_at) VALUES (999999, 'drill-js', '{"type":"drill-js"}', 0)`)).toThrow();
      // the new type is accepted; the spec triggers and unknown types still bite
      db.run(`INSERT INTO "check" (unit_id, type, spec, created_at) VALUES (?, 'drill-java', '{"type":"drill-java"}', 0)`, unitId);
      expect(() => db.run(`INSERT INTO "check" (unit_id, type, spec, created_at) VALUES (?, 'drill-java', '{"type":"drill-cs"}', 0)`, unitId)).toThrow(/must match the spec/);
      expect(() => db.run(`INSERT INTO "check" (unit_id, type, spec, created_at) VALUES (?, 'drill-kotlin', '{"type":"drill-kotlin"}', 0)`, unitId)).toThrow();
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
    const pack = read(BOOTFORGE, { courses: ['js-fundamentals'] });
    const built = pack.manifest.courses.find((c) => c.id === 'js-fundamentals')!.counts;
    const first = loadPackIntoDb(tmp.db, pack, clock);
    expect(first).toMatchObject({ source: 'bootforge', inserted: built.total, updated: 0, unchanged: 0, built: built.total, loaded: built.total });
    expect(first.checks).toBe(built.total - built.written);
    expect(first.contentEntries).toBe(built.total);
    const ids1 = tmp.db.all<{ id: number; key: string }>('SELECT id, key FROM unit ORDER BY id');
    const checks1 = tmp.db.all('SELECT id, unit_id, spec FROM "check" ORDER BY id');

    const second = loadPackIntoDb(tmp.db, read(BOOTFORGE, { courses: ['js-fundamentals'] }), clock);
    expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: built.total, built: built.total, loaded: built.total });
    expect(tmp.db.all('SELECT id, key FROM unit ORDER BY id')).toEqual(ids1);
    expect(tmp.db.all('SELECT id, unit_id, spec FROM "check" ORDER BY id')).toEqual(checks1);
    expect(tmp.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM source WHERE key = 'bootforge'`)!.n).toBe(1);
    // upstream order preserved: unit ids follow pack order
    const file = pack.courses[0]!;
    expect(ids1.map((r) => r.key)).toEqual(file.units.map((u) => u.unit.key));
  });

  it('serves a loaded BootForge drill: public instructions/starter, no solution, reference solution grades pass', async () => {
    const pack = read(BOOTFORGE, { courses: ['js-fundamentals'] });
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
    expect(() => read(dir)).toThrow(PackLoadError);
    expect(() => read(dir)).toThrow(/units count/);
  });

  it('refuses a course file edited after import (sha256 mismatch)', () => {
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz' }]);
    const f = join(dir, 'c1.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('"Q a?"', '"Q tampered?"'));
    expect(() => read(dir)).toThrow(/sha256/);
  });

  it('refuses (and rolls back) when the DB holds a unit of the course that the pack does not build', () => {
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz' }, { slug: 'w', type: 'written' }]);
    const pack = read(dir);
    loadPackIntoDb(tmp.db, pack, clock);
    // a stale row under the same source + course prefix (e.g. an exercise removed upstream)
    const src = tmp.db.get<{ id: number }>(`SELECT id FROM source WHERE key = 'synth'`)!.id;
    tmp.db.run(
      `INSERT INTO unit (key, track_id, kind, title, source_id, created_at) VALUES (?, 'js', 'written', 'stale', ?, 0)`,
      keyOf('c1', 'gone'),
      src,
    );
    const before = unitCount(tmp.db);
    expect(() => loadPackIntoDb(tmp.db, read(dir), clock)).toThrow(/loaded !== built.*not in the pack/);
    expect(unitCount(tmp.db)).toBe(before);
  });

  it('refuses a unit whose kind changed upstream (attempts reference it)', () => {
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz' }]);
    loadPackIntoDb(tmp.db, read(dir), clock);
    rmSync(dir, { recursive: true, force: true });
    writeSynthPack(dir, [{ slug: 'a', type: 'written' }]);
    expect(() => loadPackIntoDb(tmp.db, read(dir), clock)).toThrow(/changed kind/);
  });

  it('re-seed policy (store/check-policy.ts): a changed check is updated in place while unreferenced, RETIRED-AND-REPLACED once attempts reference it; old attempts keep their original frame', async () => {
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz' }, { slug: 'b', type: 'quiz' }]);
    const first = read(dir);
    loadPackIntoDb(tmp.db, first, clock);
    const id = (s: string) => tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', keyOf('c1', s))!.id;
    const checksOf = (s: string) =>
      tmp.db.all<{ id: number; spec: string; retired_at: number | null }>('SELECT id, spec, retired_at FROM "check" WHERE unit_id = ? ORDER BY id', id(s));
    const [aOld] = checksOf('a');
    const [bOld] = checksOf('b');
    // the learner answers a (keyed stored choice 1 = 'b'), b is never attempted
    const app1 = createApp({ db: tmp.db, clock, runners: defaultRunners(), content: entriesContentStore(packContentEntries(first)) });
    const sub1 = await request(app1).post(`/api/units/${id('a')}/submit`).send({ answer: await servedQuizAnswer(app1, tmp.db, id('a'), 1) });
    expect(sub1.body.verdict).toBe('pass');
    const attemptId = sub1.body.attempt.id as number;
    expect(tmp.db.get<{ c: number }>('SELECT check_id AS c FROM attempt WHERE id = ?', attemptId)!.c).toBe(aOld!.id);

    // a content wave re-seeds both quizzes: new choices, new key position
    rmSync(dir, { recursive: true, force: true });
    const reseed = { answerKey: 0, choices: ['x', 'y', 'z'] };
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz', quiz: reseed }, { slug: 'b', type: 'quiz', quiz: reseed }]);
    const second = read(dir);
    const stats = loadPackIntoDb(tmp.db, second, clock); // never a refusal, never a DB reset
    expect(stats).toMatchObject({ built: 2, loaded: 2, checks: 2, updated: 2, checksReplaced: 1 });

    // a: the referenced check is retired with its ORIGINAL frame; the attempt still points at it
    const a = checksOf('a');
    expect(a).toHaveLength(2);
    expect(a[0]).toEqual({ id: aOld!.id, spec: aOld!.spec, retired_at: clock().getTime() });
    expect(JSON.parse(a[0]!.spec)).toMatchObject({ answerKey: 1, choices: ['a', 'b', 'c'] });
    expect(JSON.parse(a[1]!.spec)).toMatchObject({ answerKey: 0, choices: ['x', 'y', 'z'] });
    expect(a[1]!.retired_at).toBeNull();
    expect(tmp.db.get<{ c: number }>('SELECT check_id AS c FROM attempt WHERE id = ?', attemptId)!.c).toBe(aOld!.id);
    expect(tmp.db.all('SELECT check_id FROM run WHERE attempt_id = ?', attemptId)).toEqual([{ check_id: aOld!.id }]);
    // b: unreferenced -> updated in place (same row, nothing retired)
    const b = checksOf('b');
    expect(b).toHaveLength(1);
    expect(b[0]!.id).toBe(bOld!.id);
    expect(JSON.parse(b[0]!.spec)).toMatchObject({ answerKey: 0, choices: ['x', 'y', 'z'] });

    // SQL backstop: a referenced check's frame cannot be rewritten in place
    expect(() => tmp.db.run('UPDATE "check" SET spec = ? WHERE id = ?', a[1]!.spec, aOld!.id)).toThrow(/frozen/);
    expect(() => tmp.db.run('UPDATE "check" SET threshold = 0.5 WHERE id = ?', aOld!.id)).toThrow(/frozen/);

    // the live unit serves the NEW frame and grades against it; new attempts bind to the new check
    const app2 = createApp({ db: tmp.db, clock, runners: defaultRunners(), content: entriesContentStore(packContentEntries(second)) });
    const detail = (await request(app2).get(`/api/units/${id('a')}`)).body as { check: { spec: { choices: string[] } } };
    expect([...detail.check.spec.choices].sort()).toEqual(['x', 'y', 'z']);
    const sub2 = await request(app2).post(`/api/units/${id('a')}/submit`).send({ answer: await servedQuizAnswer(app2, tmp.db, id('a'), 0) });
    expect(sub2.body.verdict).toBe('pass');
    expect(tmp.db.get<{ c: number }>('SELECT check_id AS c FROM attempt WHERE id = ?', sub2.body.attempt.id)!.c).toBe(a[1]!.id);
    // the old attempt still reads back as recorded
    const old = await request(app2).get(`/api/attempts/${attemptId}`);
    expect([old.status, old.body.outcome]).toEqual([200, 'pass']);
    expect((await request(app2).get('/api/health')).body.counts).toEqual({ units: 2, checks: 2 });

    // a further load is a no-op
    expect(loadPackIntoDb(tmp.db, read(dir), clock)).toMatchObject({ unchanged: 2, updated: 0, checksReplaced: 0 });
    expect(checksOf('a')).toHaveLength(2);
  });

  it('withholds quarantined units: never loaded, no content served, built shrinks accordingly', () => {
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz' }, { slug: 'b', type: 'quiz' }, { slug: 'w', type: 'written' }]);
    writeFileSync(
      join(dir, 'quarantine.json'),
      JSON.stringify({ format: PACK_FORMAT, source: 'synth', entries: [{ key: keyOf('c1', 'b'), course: 'c1', reason: 'reference fails' }] }),
    );
    const pack = read(dir);
    const stats = loadPackIntoDb(tmp.db, pack, clock);
    expect(stats).toMatchObject({ built: 2, loaded: 2, withheld: 1, checks: 1, contentEntries: 2 });
    expect(tmp.db.get('SELECT id FROM unit WHERE key = ?', keyOf('c1', 'b'))).toBeUndefined();
    expect(packContentEntries(pack).has(keyOf('c1', 'b'))).toBe(false);
  });

  it('F6: variationOf (BootForge reviewOf) sets variation_of_unit_id, not a prerequisite; reveal schedules the variant', async () => {
    writeSynthPack(dir, [{ slug: 'alt', type: 'quiz', variationOf: 'orig' }, { slug: 'orig', type: 'quiz' }]);
    const pack = read(dir);
    loadPackIntoDb(tmp.db, pack, clock);
    const id = (s: string) => tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', keyOf('c1', s))!.id;
    expect(tmp.db.get<{ v: number | null }>('SELECT variation_of_unit_id AS v FROM unit WHERE id = ?', id('alt'))!.v).toBe(id('orig'));
    expect(tmp.db.all('SELECT * FROM unit_prerequisite')).toEqual([]);
    expect(loadPackIntoDb(tmp.db, read(dir), clock)).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    const app = createApp({ db: tmp.db, clock, runners: defaultRunners(), content: entriesContentStore(packContentEntries(pack)) });
    const units = (await request(app).get('/api/tracks/js/units')).body.units as { key: string; state: string }[];
    expect(units.find((u) => u.key === keyOf('c1', 'alt'))!.state).toBe('available'); // never locked behind its original
    const rev = await request(app).post(`/api/units/${id('orig')}/reveal`).send({});
    expect(rev.status).toBe(200);
    expect(rev.body.variationUnitId).toBe(id('alt'));
  });

  it('F2: load -> quarantine -> reload RETIRES the live unit (history kept), hides it everywhere; leaving quarantine revives it', async () => {
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz' }, { slug: 'b', type: 'quiz' }, { slug: 'w', type: 'written' }]);
    const first = read(dir);
    loadPackIntoDb(tmp.db, first, clock);
    const bId = tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', keyOf('c1', 'b'))!.id;
    // the learner used b before it was quarantined: append-only history must keep its FK target
    const app1 = createApp({ db: tmp.db, clock, runners: defaultRunners(), content: entriesContentStore(packContentEntries(first)) });
    // the keyed stored choice 1, answered where it is SERVED (ui-audit #24)
    expect((await request(app1).post(`/api/units/${bId}/submit`).send({ answer: await servedQuizAnswer(app1, tmp.db, bId, 1) })).body.verdict).toBe('pass');
    const history = tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt WHERE unit_id = ?', bId)!.n;
    expect(history).toBe(1);

    // seed:validate now quarantines b; the server restarts
    writeFileSync(
      join(dir, 'quarantine.json'),
      JSON.stringify({ format: PACK_FORMAT, source: 'synth', entries: [{ key: keyOf('c1', 'b'), course: 'c1', reason: 'vacuous-check: starter passes' }] }),
    );
    const second = read(dir);
    const stats = loadPackIntoDb(tmp.db, second, clock);
    expect(stats).toMatchObject({ built: 2, loaded: 2, withheld: 1, retired: 1, checks: 1, contentEntries: 2 });
    const row = tmp.db.get<{ retired_at: number | null }>('SELECT retired_at FROM unit WHERE id = ?', bId)!;
    expect(row.retired_at).toBe(clock().getTime());
    expect(tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt WHERE unit_id = ?', bId)!.n).toBe(history);

    const app2 = createApp({ db: tmp.db, clock, runners: defaultRunners(), content: entriesContentStore(packContentEntries(second)) });
    const units = (await request(app2).get('/api/tracks/js/units')).body.units as { id: number }[];
    expect(units.map((u) => u.id)).not.toContain(bId);
    const tracks = (await request(app2).get('/api/tracks')).body.tracks as { id: string; unitCount: number }[];
    expect(tracks.find((t) => t.id === 'js')!.unitCount).toBe(2);
    expect((await request(app2).get(`/api/units/${bId}`)).status).toBe(404);
    expect((await request(app2).post(`/api/units/${bId}/submit`).send({ answer: 1 })).status).toBe(404);
    expect((await request(app2).post(`/api/units/${bId}/reveal`).send({})).status).toBe(404);
    expect((await request(app2).get('/api/health')).body.counts).toEqual({ units: 2, checks: 1 });
    const dash = (await request(app2).get('/api/dashboard')).body as { nextUp: { trackId: string; unit: { id: number } | null }[] };
    expect(dash.nextUp.map((n) => n.unit?.id)).not.toContain(bId);
    // a third load is a no-op (already retired)
    expect(loadPackIntoDb(tmp.db, read(dir), clock)).toMatchObject({ retired: 0, withheld: 1, unchanged: 2 });

    // fixed upstream + re-validated: leaves the quarantine -> live again, same row id
    writeFileSync(join(dir, 'quarantine.json'), JSON.stringify({ format: PACK_FORMAT, source: 'synth', entries: [] }));
    expect(loadPackIntoDb(tmp.db, read(dir), clock)).toMatchObject({ built: 3, loaded: 3, updated: 1, retired: 0 });
    expect(tmp.db.get<{ retired_at: number | null }>('SELECT retired_at FROM unit WHERE id = ?', bId)!.retired_at).toBeNull();
  });

  it('wires prerequisite edges from the pack (second pass), idempotently', () => {
    writeSynthPack(dir, [{ slug: 'b', type: 'quiz', prerequisites: ['a'] }, { slug: 'a', type: 'quiz' }]);
    loadPackIntoDb(tmp.db, read(dir), clock);
    const id = (s: string) => tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', keyOf('c1', s))!.id;
    const edges = () => tmp.db.all('SELECT unit_id, prereq_unit_id FROM unit_prerequisite');
    expect(edges()).toEqual([{ unit_id: id('b'), prereq_unit_id: id('a') }]);
    const again = loadPackIntoDb(tmp.db, read(dir), clock);
    expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect(edges()).toEqual([{ unit_id: id('b'), prereq_unit_id: id('a') }]);
  });
});

// ---------------------------------------------------------------- import-gate stamp (F1, F8)

/** What a clean full seed:validate run leaves behind: quarantine.json (even empty) + a matching validation.json. */
function stampPack(dir: string, quarantinedKeys: string[] = []) {
  writeFileSync(
    join(dir, 'quarantine.json'),
    JSON.stringify({ format: PACK_FORMAT, source: 'synth', entries: quarantinedKeys.map((key) => ({ key, course: 'c1', reason: 'x' })) }),
  );
  const bytes = readFileSync(join(dir, 'manifest.json'));
  const m = PackManifest.parse(JSON.parse(bytes.toString('utf8')));
  writeFileSync(
    join(dir, 'validation.json'),
    JSON.stringify({
      format: PACK_FORMAT,
      source: 'synth',
      manifestSha256: sha(bytes),
      graderFingerprint: graderFingerprint(),
      toolchain: toolchainVersions(),
      counts: m.totals,
      executable: m.totals.code + m.totals.quiz + m.totals.output,
      passed: m.totals.code + m.totals.quiz + m.totals.output - quarantinedKeys.length,
      carveOut: m.totals.written,
      quarantinedKeys: [...quarantinedKeys].sort(),
      audit: { sampled: 0, mismatches: 0 },
      completedAt: '2026-10-07T00:00:00.000Z',
    }),
  );
}

describe('import-gate stamp (validation.json): the loader refuses a pack seed:validate has not vouched for', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bootquest-stamp-'));
    writeSynthPack(dir, [{ slug: 'a', type: 'quiz' }, { slug: 'b', type: 'quiz' }, { slug: 'w', type: 'written' }]);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('never validated (no stamp, no quarantine.json) -> refused, naming the command to run', () => {
    expect(() => readPack(dir)).toThrow(PackLoadError);
    expect(() => readPack(dir)).toThrow(/no quarantine\.json.*npm run seed:validate/);
    writeFileSync(join(dir, 'quarantine.json'), JSON.stringify({ format: PACK_FORMAT, source: 'synth', entries: [] }));
    expect(() => readPack(dir)).toThrow(/no validation stamp \(validation\.json\).*npm run seed:validate/);
  });

  it('a matching stamp is accepted (with and without quarantined keys)', () => {
    stampPack(dir);
    expect(readPack(dir).stamp).toMatchObject({ source: 'synth', quarantinedKeys: [] });
    stampPack(dir, [keyOf('c1', 'b')]);
    const pack = readPack(dir);
    expect(pack.stamp!.quarantinedKeys).toEqual([keyOf('c1', 'b')]);
    expect([...pack.quarantined.keys()]).toEqual([keyOf('c1', 'b')]);
  });

  it('a stamp for other manifest bytes (re-imported since validation) is refused', () => {
    stampPack(dir);
    const mPath = join(dir, 'manifest.json');
    writeFileSync(mPath, `${readFileSync(mPath, 'utf8')}\n`);
    expect(() => readPack(dir)).toThrow(/re-imported since validation.*npm run seed:validate/);
  });

  it('a stamp from another grader / toolchain is refused', () => {
    stampPack(dir);
    const sPath = join(dir, 'validation.json');
    writeFileSync(sPath, readFileSync(sPath, 'utf8').replace(graderFingerprint(), 'a'.repeat(64)));
    expect(() => readPack(dir)).toThrow(/grader fingerprint.*npm run seed:validate/);
  });

  it('W3a per-kind binding: a js pack stamped for the csharp grader is refused; kinds never share files', () => {
    stampPack(dir);
    const sPath = join(dir, 'validation.json');
    const stamp = JSON.parse(readFileSync(sPath, 'utf8'));
    writeFileSync(sPath, JSON.stringify({ ...stamp, graderKind: 'csharp' }));
    expect(() => readPack(dir)).toThrow(/stamp is for the csharp grader, but pack synth \(track js\) is graded by js/);
    writeFileSync(sPath, JSON.stringify({ ...stamp, graderKind: 'js' }));
    expect(readPack(dir).stamp?.graderKind).toBe('js');
    // the C# fingerprint covers the C# runner (not the JS grader) and vice versa; only the validator is shared
    const js = new Set(FINGERPRINT_FILES.js);
    const shared = FINGERPRINT_FILES.csharp.filter((f) => js.has(f));
    expect(shared.map((f) => f.replace(/\\/g, '/').split('/').pop())).toEqual(['validate.ts', 'verdicts.ts', 'journal.ts']);
    expect(FINGERPRINT_FILES.csharp.some((f) => /grade-core/.test(f))).toBe(false);
    expect(graderKindForTrack('csharp')).toBe('csharp');
    expect(graderKindForTrack('java')).toBe('java');
    expect(() => graderKindForTrack('agentic')).toThrow(/no grader kind/);
    // the java fingerprint covers the Java runner + its harness + validators, not the JS grader or runners.ts
    const base = (f: string) => f.replace(/\\/g, '/').split('/').pop();
    expect(FINGERPRINT_FILES.java.filter((f) => js.has(f)).map(base)).toEqual(['validate.ts', 'verdicts.ts', 'journal.ts']);
    // the whole import gate binds every kind: the validator, the NOT_A_VERDICT set its starter rule
    // reads (verdicts.ts) and the journal whose entries it trusts (journal.ts)
    for (const k of ['js', 'csharp', 'selfrun', 'java'] as const) {
      for (const f of IMPORT_GATE) expect(FINGERPRINT_FILES[k], `${k} ${base(f)}`).toContain(f);
    }
    expect(FINGERPRINT_FILES.java.some((f) => /runners\.ts$|grade-core/.test(f))).toBe(false);
    expect(FINGERPRINT_FILES.java.map(base)).toEqual(expect.arrayContaining(['Check.java', 'BqMain.java', 'runner-java.ts', 'validate-java.ts', 'scratch.ts']));
  });

  it('W3c: a manifest\'s explicit grader wins over its track (jstrain = track js, grader selfrun); a js stamp is refused for it', () => {
    stampPack(dir);
    expect(graderKindForManifest({ track: 'js' })).toBe('js');
    expect(graderKindForManifest({ track: 'js', grader: 'selfrun' })).toBe('selfrun');
    expect(graderKindForManifest({ track: 'csharp', grader: 'csharp' })).toBe('csharp');
    // selfrun binds the self-run runner + harness copies + tsc/tsx versions; never the C# runner
    const names = FINGERPRINT_FILES.selfrun.map((f) => f.replace(/\\/g, '/'));
    for (const want of ['self-run/index.ts', 'self-run/compose.ts', 'self-run/bq-check.mjs', 'jstrain/bootcamp/_lib/check.js', 'jstrain/tsbootcamp/_lib/check.ts', 'validate/validate.ts']) {
      expect(names.some((n) => n.endsWith(want))).toBe(true);
    }
    expect(names.some((n) => /runners\/csharp\//.test(n))).toBe(false);
    expect(toolchainVersions('selfrun')).toMatchObject({ typescript: '5.9.3' });
    expect(graderFingerprint('selfrun')).not.toBe(graderFingerprint('js'));
    // re-declare the synthetic pack as selfrun-graded: its js stamp no longer vouches for it
    const mPath = join(dir, 'manifest.json');
    const m = JSON.parse(readFileSync(mPath, 'utf8'));
    writeFileSync(mPath, JSON.stringify({ ...m, grader: 'selfrun' }));
    expect(() => readPack(dir)).toThrow(/validation stamp is for manifest|graded by selfrun/);
  });

  it('a quarantine.json edited after validation (keys differ from the stamp) is refused', () => {
    stampPack(dir, [keyOf('c1', 'b')]);
    writeFileSync(join(dir, 'quarantine.json'), JSON.stringify({ format: PACK_FORMAT, source: 'synth', entries: [] }));
    expect(() => readPack(dir)).toThrow(/does not match the validation stamp/);
  });

  it('F8: a malformed quarantine.json is a hard error, even for the unstamped test opt-out', () => {
    stampPack(dir);
    writeFileSync(join(dir, 'quarantine.json'), '<<<<<<< HEAD\n{"entries": []}\n');
    expect(() => readPack(dir)).toThrow(/quarantine\.json is malformed/);
    expect(() => read(dir)).toThrow(/quarantine\.json is malformed/);
  });

  it('startServer refuses an unstamped pack without the opt-out, and loads it stamped', async () => {
    const env = { BOOTQUEST_DB: join(dir, 's.db'), BOOTQUEST_PORT: String(await freePort()), BOOTQUEST_PACKS: dir };
    await expect(startServer({ env, clock })).rejects.toThrow(/no quarantine\.json|no validation stamp/);
    stampPack(dir);
    const running = await startServer({ env: { ...env, BOOTQUEST_DB: join(dir, 's2.db') }, clock });
    try {
      expect(running.packs).toEqual([expect.objectContaining({ source: 'synth', built: 3, loaded: 3 })]);
    } finally {
      await running.close();
    }
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
      const env = { BOOTQUEST_DB: join(dir, 'a.db'), BOOTQUEST_PORT: String(await freePort()), BOOTQUEST_PACKS: bad, [ALLOW_UNSTAMPED_ENV]: '1' };
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
        env: { BOOTQUEST_DB: join(dir, 'c.db'), BOOTQUEST_PORT: String(port), BOOTQUEST_PACKS: BOOTFORGE, BOOTQUEST_PACK_COURSES: 'engineering-practice', [ALLOW_UNSTAMPED_ENV]: '1' },
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

describe('F7: BOOTQUEST_PACK_COURSES typos', () => {
  it('an id no pack provides refuses to start and lists the valid ids', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootquest-packtypo-'));
    try {
      const env = {
        BOOTQUEST_DB: join(dir, 't.db'),
        BOOTQUEST_PORT: String(await freePort()),
        BOOTQUEST_PACKS: BOOTFORGE,
        BOOTQUEST_PACK_COURSES: 'js-fundamentals,engineering-practise',
        [ALLOW_UNSTAMPED_ENV]: '1',
      };
      const err = await startServer({ env, clock }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PackLoadError);
      expect(String((err as Error).message)).toMatch(/no loaded pack provides: engineering-practise\. Valid ids: .*engineering-practice.*js-fundamentals/);
      // all ids misspelled: still a refusal (never "0 loaded === 0 built")
      const err2 = await startServer({ env: { ...env, BOOTQUEST_PACK_COURSES: 'nope' }, clock }).catch((e: unknown) => e);
      expect(String((err2 as Error).message)).toMatch(/no loaded pack provides: nope/);
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
