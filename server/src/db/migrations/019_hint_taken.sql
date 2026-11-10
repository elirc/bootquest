-- 019_hint_taken: progressive hints served to the learner (f52 wave, stream S; U13, council ruling 6).
-- One row per hint taken, never edited: `idx` is the 1-based authored position of the hint served.
-- Hints are servable only on drill / code-check units, only after >= 1 failed graded submit and
-- never after a verified pass (api/hints-service.ts). A hint taken at or before an attempt's
-- created_at cuts that attempt's pass XP by 25% per hint (floor 50%, engines/xp.ts) and keeps the
-- attempt out of unassisted promotion evidence (engines/hints.ts HINT_FREE_SQL). Append-only.
CREATE TABLE hint_taken (
  id          INTEGER PRIMARY KEY,
  unit_id     INTEGER NOT NULL REFERENCES unit(id),
  idx         INTEGER NOT NULL CHECK (idx >= 1),
  created_at  INTEGER NOT NULL,
  UNIQUE (unit_id, idx)
);
CREATE INDEX hint_taken_unit_time ON hint_taken(unit_id, created_at);

CREATE TRIGGER hint_taken_no_update BEFORE UPDATE ON hint_taken
BEGIN SELECT RAISE(ABORT, 'append-only: hint_taken rows cannot be updated'); END;
CREATE TRIGGER hint_taken_no_delete BEFORE DELETE ON hint_taken
BEGIN SELECT RAISE(ABORT, 'append-only: hint_taken rows cannot be deleted'); END;
CREATE TRIGGER hint_taken_no_replace BEFORE INSERT ON hint_taken
WHEN EXISTS (SELECT 1 FROM hint_taken WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: hint_taken rows cannot be replaced'); END;
