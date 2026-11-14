-- 024_error_note: the error notebook (rv2 stream S1; PLAN F6). After a failed submit or a missed key point the
-- learner MAY write one line in their own words and pick a category. Optional, never blocks, 0 XP. Each entry
-- becomes the concept card 'note:<id>' (review_item kind 'concept', due the next day) whose front is the
-- learner's own line. Not evidence. Append-only.
CREATE TABLE error_note (
  id          INTEGER PRIMARY KEY,
  unit_id     INTEGER NOT NULL REFERENCES unit(id),
  attempt_id  INTEGER REFERENCES attempt(id),
  line        TEXT NOT NULL CHECK (length(trim(line)) BETWEEN 3 AND 200),
  category    TEXT NOT NULL CHECK (category IN ('misread', 'concept-gap', 'edge-case', 'api-or-syntax', 'slip', 'other')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX error_note_time ON error_note(created_at);

CREATE TRIGGER error_note_no_update BEFORE UPDATE ON error_note
BEGIN SELECT RAISE(ABORT, 'append-only: error_note rows cannot be updated'); END;
CREATE TRIGGER error_note_no_delete BEFORE DELETE ON error_note
BEGIN SELECT RAISE(ABORT, 'append-only: error_note rows cannot be deleted'); END;
CREATE TRIGGER error_note_no_replace BEFORE INSERT ON error_note
WHEN EXISTS (SELECT 1 FROM error_note WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: error_note rows cannot be replaced'); END;
