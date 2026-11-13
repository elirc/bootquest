-- 020_practice_log: practice-mode tries of a quiz gate or quick check (rv wave, stream B; REVIEW Q3).
-- POST /units/:id/practice grades a full answer set and returns every item's verdict + explanation,
-- and records NOTHING else: no attempt, no run, no XP, no evidence, no slate slot, no unlock, no card.
-- This table is the one fact it leaves behind: WHEN the unit was practised. A graded (evidence)
-- submit of that same unit is refused for 2 days after its latest practice (api/practice-service.ts),
-- because practising the same items leaks the graded gate until a fresh set exists. Append-only.
CREATE TABLE practice_log (
  id          INTEGER PRIMARY KEY,
  unit_id     INTEGER NOT NULL REFERENCES unit(id),
  check_id    INTEGER NOT NULL REFERENCES "check"(id),
  correct     INTEGER NOT NULL CHECK (correct >= 0),
  total       INTEGER NOT NULL CHECK (total >= 1 AND correct <= total),
  created_at  INTEGER NOT NULL
);
CREATE INDEX practice_log_unit_time ON practice_log(unit_id, created_at);

CREATE TRIGGER practice_log_no_update BEFORE UPDATE ON practice_log
BEGIN SELECT RAISE(ABORT, 'append-only: practice_log rows cannot be updated'); END;
CREATE TRIGGER practice_log_no_delete BEFORE DELETE ON practice_log
BEGIN SELECT RAISE(ABORT, 'append-only: practice_log rows cannot be deleted'); END;
CREATE TRIGGER practice_log_no_replace BEFORE INSERT ON practice_log
WHEN EXISTS (SELECT 1 FROM practice_log WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: practice_log rows cannot be replaced'); END;
