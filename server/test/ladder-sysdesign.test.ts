import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SeedExplainBackItem } from '@bootquest/shared';
import { loadSeedDerivedContent } from '../src/api/serve.ts';
import { Db } from '../src/db/database.ts';
import { openDb } from '../src/db/index.ts';
import { migrate, schemaVersion } from '../src/db/migrate.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { insertUnit } from '../src/store/content.ts';
import { DESIGN_TRACK, explainBackUnitKey, isDesignIt, isG2, LADDER_SOURCE_KEY, ladderUnits, LadderLoadError } from '../src/store/ladder.ts';
import { mapSeedItemStore } from '../src/store/seed-items.ts';
import { localNoon, makeTempDb, type TempDb } from './helpers.ts';
import fixture from './fixtures/ladder-fixture.json' with { type: 'json' };

/**
 * Migration 014 + store/ladder.ts DESIGN IT routing: an explain-back set whose FIRST prompt starts
 * "DESIGN IT" loads on the campaign-less sysdesign track with competencies system-design +
 * communication and no campaign quest link; G2 keeps precedence; ordinary sets are untouched.
 */

const BASE = fixture.seedItems.find((i) => i.kind === 'explain-back') as unknown as SeedExplainBackItem;
const MIGRATIONS = fileURLToPath(new URL('../src/db/migrations/', import.meta.url));

function ebItem(repo: string, tag: string, firstPrompt: string): SeedExplainBackItem {
  const it = structuredClone(BASE);
  return {
    ...it,
    key: `seed:explainback:${repo}/explain-back/${tag}`,
    provenance: { ...it.provenance, repo, path: `docs/${tag}.md` },
    questions: [{ ...it.questions[0]!, prompt: firstPrompt }, ...it.questions.slice(1)],
  };
}

const DESIGN = ebItem('javabootcamp', 'design-kv', 'DESIGN IT — Dynamo-style key-value store. Write your design before you look.');
const DESIGN_ON_QUEST_REPO = ebItem('questrepo', 'design-q', 'DESIGN IT — URL shortener. Sizing, data model, the trade-off you would defend.');
const G2 = ebItem('questrepo', 'g2', 'G2 BRIEF — questrepo. Write the delegation brief. (Mentions DESIGN IT later, not as the prefix.)');
const ORDINARY = ebItem('questrepo', 'plain', 'Why does the suite test that a VIEWER cannot trigger an allocation run?');
/** "DESIGN IT" inside the prompt but not as its prefix, and as a non-word-boundary prefix: both ordinary */
const NOT_PREFIX = ebItem('questrepo', 'not-prefix', 'Explain the module. Then DESIGN IT again from scratch.');
const NO_BOUNDARY = ebItem('questrepo', 'no-boundary', 'DESIGN ITEMS are listed in the README: explain two of them.');

const competencies = (db: Db, unitId: number): string[] =>
  db.all<{ c: string }>('SELECT competency_id AS c FROM unit_competency WHERE unit_id = ? ORDER BY competency_id', unitId).map((r) => r.c);
const unitRow = (db: Db, key: string) => db.get<{ id: number; track_id: string }>('SELECT id, track_id FROM unit WHERE key = ?', key);

/** one js campaign act with a study quest on `questrepo` (so the repo HAS a campaign quest link) */
function seedQuest(db: Db): void {
  const act = db.run(`INSERT INTO campaign_act (track_id, act_no, title) VALUES ('js', 1, 'Act 1')`).lastInsertRowid;
  db.run(
    `INSERT INTO quest (act_id, key, quest_kind, title, repo, index_rank, unit_id, core, content_pending, verdict, ordinal)
     VALUES (?, 'campaign/js/questrepo', 'study-quest', 'questrepo', 'questrepo', 1, NULL, 1, 1, 'study', 1)`,
    act,
  );
}

describe('DESIGN IT routing predicate', () => {
  it('matches the DESIGN IT prefix only; G2 keeps precedence', () => {
    expect(isDesignIt(DESIGN)).toBe(true);
    expect(isDesignIt(DESIGN_ON_QUEST_REPO)).toBe(true);
    expect(isG2(DESIGN)).toBe(false);
    expect(isG2(G2)).toBe(true);
    expect(isDesignIt(G2)).toBe(false);
    expect(isDesignIt(ORDINARY)).toBe(false);
    expect(isDesignIt(NOT_PREFIX)).toBe(false);
    expect(isDesignIt(NO_BOUNDARY)).toBe(false);
    // the unit key family is unchanged (still ladder/explain-back/...): migration 014 relies on it
    expect(explainBackUnitKey(DESIGN)).toMatch(/^ladder\/explain-back\/javabootcamp\/[0-9a-f]{12}$/);
  });
});

describe('ladder load: DESIGN IT -> sysdesign', () => {
  let tmp: TempDb;
  const clock = fixedClock(localNoon(2026, 10, 1));
  beforeEach(() => {
    tmp = makeTempDb();
  });
  afterEach(() => tmp.cleanup());

  it('DESIGN IT sets: sysdesign track, system-design + communication, quest null even on a campaign repo; G2 and ordinary sets unaffected', () => {
    seedQuest(tmp.db);
    const items = [DESIGN, DESIGN_ON_QUEST_REPO, G2, ORDINARY, NOT_PREFIX, NO_BOUNDARY];
    const { ladder } = loadSeedDerivedContent(tmp.db, { seedItems: mapSeedItemStore(items), authored: null }, clock);
    expect(ladder.g2).toEqual({ built: 1, loaded: 1 });
    expect(ladder.explainBack).toMatchObject({ built: 5, loaded: 5 });
    // ORDINARY + NOT_PREFIX + NO_BOUNDARY link to questrepo's quest; the design set on questrepo does not
    expect(ladder.explainBack.linkedToQuest).toBe(3);

    const rows = new Map(ladderUnits(tmp.db).map((u) => [u.key, u]));
    for (const it of [DESIGN, DESIGN_ON_QUEST_REPO]) {
      const u = rows.get(explainBackUnitKey(it))!;
      expect(u).toMatchObject({ family: 'explain-back', trackId: DESIGN_TRACK, quest: null, prerequisites: [] });
      expect(competencies(tmp.db, u.id)).toEqual(['communication', 'system-design']);
    }
    const g2 = rows.get(explainBackUnitKey(G2))!;
    expect(g2).toMatchObject({ family: 'g2', trackId: 'agentic' });
    expect(g2.quest).not.toBeNull(); // unchanged behaviour: G2 shows its repo's campaign link
    expect(competencies(tmp.db, g2.id)).toEqual(['agentic-engineering', 'communication']);
    for (const it of [ORDINARY, NOT_PREFIX, NO_BOUNDARY]) {
      const u = rows.get(explainBackUnitKey(it))!;
      expect(u).toMatchObject({ family: 'explain-back', trackId: 'js', quest: { key: 'campaign/js/questrepo', track: 'js', actNo: 1 } });
      expect(competencies(tmp.db, u.id)).toEqual(['language-fluency']);
    }
    // GET /tracks counts the new track's units like any other
    expect(tmp.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM unit WHERE track_id = 'sysdesign' AND retired_at IS NULL`)!.n).toBe(2);
  });

  it('is idempotent: a second load inserts nothing and keeps the routing', () => {
    const inputs = { seedItems: mapSeedItemStore([DESIGN, ORDINARY]), authored: null };
    loadSeedDerivedContent(tmp.db, inputs, clock);
    const again = loadSeedDerivedContent(tmp.db, inputs, clock).ladder;
    expect(again.inserted).toBe(0);
    expect(unitRow(tmp.db, explainBackUnitKey(DESIGN))!.track_id).toBe('sysdesign');
  });
});

describe('migration 014', () => {
  it('fresh DB: track sysdesign (unlocked, no drill slot, sort 5) and competency system-design rated 1 with no evidence', () => {
    const tmp = makeTempDb();
    try {
      expect(schemaVersion(tmp.db)).toBe(14);
      expect(tmp.db.get('SELECT id, name, locked, slate_drills, sort_order FROM track WHERE id = ?', 'sysdesign')).toEqual({
        id: 'sysdesign',
        name: 'System design',
        locked: false,
        slate_drills: false,
        sort_order: 5,
      });
      expect(tmp.db.get('SELECT id, name, sort_order FROM competency WHERE id = ?', 'system-design')).toEqual({ id: 'system-design', name: 'System design', sort_order: 8 });
      expect(tmp.db.get('SELECT rating, last_evidence_id FROM competency_rating WHERE competency_id = ?', 'system-design')).toEqual({ rating: 1, last_evidence_id: null });
      // the rebuilt CHECK still refuses an unknown track id
      expect(() => tmp.db.run(`INSERT INTO track (id, name, locked, slate_drills, sort_order) VALUES ('python', 'Python', 0, 0, 6)`)).toThrow(/CHECK/);
      // child tables' FKs still bind to the rebuilt table
      expect(tmp.db.all('PRAGMA foreign_key_check')).toEqual([]);
      expect(() =>
        tmp.db.run(`INSERT INTO campaign_act (track_id, act_no, title) VALUES ('nope', 1, 'x')`),
      ).toThrow(/FOREIGN KEY/);
    } finally {
      tmp.cleanup();
    }
  });

  it('a pre-014 DB holding a DESIGN IT unit on track java: the old loader shape would refuse, after 014 startup loads it on sysdesign', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootquest-014-'));
    const migDir = join(dir, 'migrations-013');
    const path = join(dir, 'pre014.db');
    const clock = fixedClock(localNoon(2026, 10, 1));
    const key = explainBackUnitKey(DESIGN);
    try {
      // 1. a DB at schema 13, with the unit exactly as the pre-014 loader wrote it (java, language-fluency):
      //    a migrations directory holding 001..013 only (the checksums match the real ones, so the
      //    later openDb verifies them and applies just 014)
      const files = readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) <= 13);
      expect(files).toHaveLength(13);
      mkdirSync(migDir);
      for (const f of files) copyFileSync(join(MIGRATIONS, f), join(migDir, f));
      const old = new Db(path);
      try {
        expect(migrate(old, migDir)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
        expect(old.get('SELECT id FROM track WHERE id = ?', 'sysdesign')).toBeUndefined();
        const src = old.run(
          `INSERT INTO source (key, repo, subpath, role, origin_kind, read_only, created_at) VALUES (?, 'local/content-seed', '', 'pack', 'local', 1, 0)`,
          LADDER_SOURCE_KEY,
        ).lastInsertRowid;
        const id = insertUnit(
          old,
          {
            key,
            track: 'java',
            kind: 'explain-back',
            title: 'Explain back: javabootcamp — design-kv.md',
            competencies: ['language-fluency'],
            checks: [{ spec: { type: 'explain-back', questionSetKey: DESIGN.key, questionCount: DESIGN.questions.length } }],
          },
          clock,
        );
        old.run('UPDATE unit SET source_id = ? WHERE id = ?', src, id);
        // the language-fluency row the old loader wrote, plus a paid xp_event on java
        expect(competencies(old, id)).toEqual(['language-fluency']);
        old.run(`INSERT INTO xp_event (unit_id, track_id, kind, amount, day, created_at) VALUES (?, 'java', 'explain-back', 20, '2026-10-01', 0)`, id);
        // without 014's data fix, today's loader refuses this DB (a track change on an existing key)
        expect(() => loadSeedDerivedContent(old, { seedItems: mapSeedItemStore([DESIGN]), authored: null }, clock)).toThrow(LadderLoadError);
        expect(() => loadSeedDerivedContent(old, { seedItems: mapSeedItemStore([DESIGN]), authored: null }, clock)).toThrow(/changed kind\/track \(explain-back\/java -> explain-back\/sysdesign\)/);
      } finally {
        old.close();
      }

      // 2. startup: openDb applies 014, then the seed-derived content load succeeds
      const db = openDb({ path, env: {} });
      try {
        expect(schemaVersion(db)).toBe(14);
        const before = unitRow(db, key)!;
        expect(before.track_id).toBe('sysdesign'); // moved by 014 itself
        const { ladder } = loadSeedDerivedContent(db, { seedItems: mapSeedItemStore([DESIGN]), authored: null }, clock);
        expect(ladder.inserted).toBe(0);
        expect(ladder.explainBack).toMatchObject({ built: 1, loaded: 1 });
        const after = unitRow(db, key)!;
        expect(after).toEqual({ id: before.id, track_id: 'sysdesign' });
        // unit_competency is re-derived by the loader on every startup (upsertUnit), not by 014
        expect(competencies(db, after.id)).toEqual(['communication', 'system-design']);
        // append-only history is untouched
        expect(db.get<{ t: string }>('SELECT track_id AS t FROM xp_event WHERE unit_id = ?', after.id)!.t).toBe('java');
        expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
        expect(ladderUnits(db).find((u) => u.key === key)).toMatchObject({ trackId: 'sysdesign', quest: null });
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
