-- 026_week_reflection: the weekly review's three-question reflection (rv2 stream S3; PLAN F7). One row per save:
-- `week_start` is the Monday (local day key) of the week the answers are about, `answers` the three answers in
-- the order of WEEK_REFLECTION_QUESTIONS (shared/src/api-ext.ts). A later save for the same week supersedes the
-- earlier one on the page (newest row wins); history is kept. 0 XP, not evidence, unlocks nothing. Append-only.
CREATE TABLE week_reflection (
  id          INTEGER PRIMARY KEY,
  week_start  TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  answers     TEXT NOT NULL CHECK (json_valid(answers) AND json_type(answers) = 'array' AND json_array_length(answers) = 3),
  created_at  INTEGER NOT NULL
);
CREATE INDEX week_reflection_week ON week_reflection(week_start, created_at);

CREATE TRIGGER week_reflection_no_update BEFORE UPDATE ON week_reflection
BEGIN SELECT RAISE(ABORT, 'append-only: week_reflection rows cannot be updated'); END;
CREATE TRIGGER week_reflection_no_delete BEFORE DELETE ON week_reflection
BEGIN SELECT RAISE(ABORT, 'append-only: week_reflection rows cannot be deleted'); END;
CREATE TRIGGER week_reflection_no_replace BEFORE INSERT ON week_reflection
WHEN EXISTS (SELECT 1 FROM week_reflection WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: week_reflection rows cannot be replaced'); END;
