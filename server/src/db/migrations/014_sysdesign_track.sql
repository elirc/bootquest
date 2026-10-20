-- bootquest:foreign-keys-off
-- 014_sysdesign_track: a fifth, campaign-less track 'sysdesign' ("System design")
-- and a matching ladder competency 'system-design'. The javabootcamp DESIGN IT
-- explain-back sets (system-design rubrics: sizing, data model, replication,
-- consistency trade-offs) were loaded on the java track with the
-- language-fluency competency, which fits them poorly; store/ladder.ts now
-- routes any explain-back set whose first prompt starts "DESIGN IT" here, with
-- competencies system-design + communication and no campaign quest link.
--
--  1. track.id's CHECK grows. SQLite cannot alter a CHECK constraint in place,
--     so this is the documented 12-step table rebuild
--     (https://sqlite.org/lang_altertable.html#otheralter), as in 004 / 010: the
--     marker on line 1 makes migrate() run it with foreign_keys OFF (unit,
--     campaign_act, skill_node and xp_event reference track(id)) and then
--     require an empty PRAGMA foreign_key_check before committing. Column list,
--     types, defaults and CHECKs are unchanged from 001; only the id IN (...)
--     list grows. No trigger or index is ON track or names it in its body, and
--     the PRIMARY KEY index is rebuilt with the table, so nothing else needs
--     re-creating.
--  2. Vocabulary rows, in the 002 shape. The track is unlocked and contributes
--     no slate drill slot (no drill pack); it has no campaign (the campaign
--     tracks stay js / csharp / java). The competency_rating row is the seed
--     shape 003's guarded-insert trigger allows (rating 1, no evidence, once):
--     it is inserted only when absent, since that trigger would ABORT (not be
--     ignored by OR IGNORE) on a second insert.
--  3. Data fix for DBs that already loaded the six javabootcamp DESIGN IT units:
--     the ladder loader refuses a track change on an existing unit key (it would
--     refuse startup), so their track moves here. Every live ladder explain-back
--     unit of javabootcamp is a DESIGN IT set (its one G2 rubric is keyed
--     ladder/g2/..., not matched). Their unit_competency rows need no fix here:
--     the loader re-derives a ladder unit's competencies on every startup
--     (upsertUnit deletes and re-inserts them). xp_event rows already paid on
--     the java track are append-only history and stay as they are.

CREATE TABLE track_new (
  id            TEXT PRIMARY KEY CHECK (id IN ('js', 'csharp', 'java', 'agentic', 'sysdesign')),
  name          TEXT NOT NULL,
  locked        INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  -- 1 when the track contributes a "drill set" slot to the daily slate (§6.1)
  slate_drills  INTEGER NOT NULL DEFAULT 0 CHECK (slate_drills IN (0, 1)),
  sort_order    INTEGER NOT NULL
);

INSERT INTO track_new (id, name, locked, slate_drills, sort_order)
  SELECT id, name, locked, slate_drills, sort_order FROM track;

DROP TABLE track;
ALTER TABLE track_new RENAME TO track;

-- ---------------------------------------------------------------- 2. vocabulary

INSERT OR IGNORE INTO track (id, name, locked, slate_drills, sort_order) VALUES
  ('sysdesign', 'System design',          0, 0, 5);

INSERT OR IGNORE INTO competency (id, name, sort_order) VALUES
  ('system-design',        'System design',                 8);

INSERT INTO competency_rating (competency_id, rating, last_evidence_id, updated_at)
  SELECT 'system-design', 1, NULL, 0
   WHERE NOT EXISTS (SELECT 1 FROM competency_rating WHERE competency_id = 'system-design');

-- ---------------------------------------------------------------- 3. DESIGN IT units

UPDATE unit SET track_id = 'sysdesign' WHERE key LIKE 'ladder/explain-back/javabootcamp/%';
