-- bootquest:foreign-keys-off
-- 004_written_unit_kind: W2 adds the 'written' unit kind (BootForge `written`
-- exercises: model answer + self-assessed rubric, NO check — a counted
-- carve-out of the import gate, never a pass target).
--
-- SQLite cannot alter a CHECK constraint in place, so this is the documented
-- 12-step table rebuild (https://sqlite.org/lang_altertable.html#otheralter):
-- the marker on line 1 makes migrate() run it with foreign_keys OFF (outside
-- the transaction, where the pragma is honored) and then require an empty
-- PRAGMA foreign_key_check before committing. Column list, types, defaults,
-- FKs and indexes are unchanged from 001; only the kind IN (...) list grows.
-- No triggers reference unit, so none need re-creating.

CREATE TABLE unit_new (
  id                    INTEGER PRIMARY KEY,
  key                   TEXT NOT NULL UNIQUE,
  track_id              TEXT NOT NULL REFERENCES track(id),
  kind                  TEXT NOT NULL CHECK (kind IN (
                          'drill', 'quiz', 'predict-output', 'guided-project', 'http-lab',
                          'repo-task', 'study', 'reading', 'explain-back', 'patch-kata',
                          'review', 'program-unit', 'retest', 'written')),
  title                 TEXT NOT NULL,
  code                  TEXT,
  phase                 TEXT,
  difficulty            INTEGER CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5),
  xp                    INTEGER CHECK (xp IS NULL OR xp >= 0),
  target_level          INTEGER CHECK (target_level IS NULL OR target_level BETWEEN 1 AND 5),
  source_id             INTEGER REFERENCES source(id),
  content_ref_id        INTEGER REFERENCES content_ref(id),
  variation_of_unit_id  INTEGER REFERENCES unit(id),
  created_at            INTEGER NOT NULL
);

INSERT INTO unit_new (id, key, track_id, kind, title, code, phase, difficulty, xp, target_level,
                      source_id, content_ref_id, variation_of_unit_id, created_at)
  SELECT id, key, track_id, kind, title, code, phase, difficulty, xp, target_level,
         source_id, content_ref_id, variation_of_unit_id, created_at
    FROM unit;

DROP TABLE unit;
ALTER TABLE unit_new RENAME TO unit;

CREATE INDEX unit_track ON unit(track_id);
CREATE INDEX unit_variation_of ON unit(variation_of_unit_id);
-- imported packs upsert by (source, key); key is already globally UNIQUE
CREATE INDEX unit_source ON unit(source_id);
