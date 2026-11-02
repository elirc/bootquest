-- 017_slate_settings: the learner chooses the daily slate's shape (ab wave, stream S1).
-- Append-only: one row per change, never edited. The slate for a day reads, per track, the
-- latest row whose effective_day <= that day; a track with no row keeps track.slate_drills
-- and the engine default size. The service always writes effective_day = the day AFTER the
-- change, so today's open slate and every closed day are unaffected by it.
CREATE TABLE slate_setting (
  id             INTEGER PRIMARY KEY,
  track_id       TEXT NOT NULL REFERENCES track(id),
  enabled        INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  size           INTEGER CHECK (size IS NULL OR size BETWEEN 1 AND 10),  -- NULL = engine default
  effective_day  TEXT NOT NULL CHECK (effective_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at     INTEGER NOT NULL
);
CREATE INDEX slate_setting_track_day ON slate_setting(track_id, effective_day, id);

CREATE TRIGGER slate_setting_no_update BEFORE UPDATE ON slate_setting
BEGIN SELECT RAISE(ABORT, 'append-only: slate_setting rows cannot be updated'); END;
CREATE TRIGGER slate_setting_no_delete BEFORE DELETE ON slate_setting
BEGIN SELECT RAISE(ABORT, 'append-only: slate_setting rows cannot be deleted'); END;
CREATE TRIGGER slate_setting_no_replace BEFORE INSERT ON slate_setting
WHEN EXISTS (SELECT 1 FROM slate_setting WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: slate_setting rows cannot be replaced'); END;
