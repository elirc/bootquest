-- 025_eb_attempt_meta: how an explain-back answer of record was written (rv2 stream S3; PLAN F5).
-- One row per DESIGN IT answer taken in interview mode S: the client's timer (elapsed from "Start the interview"
-- to the stored answer), the time box it ran against, and whether blind mode stayed on. Filed right after the
-- answer row exists and before it is self-scored (api/ladder-service.ts recordInterviewMeta); a scored answer
-- takes no meta. It is NOT evidence and changes no grade: no XP, no evidence row, no ladder leg, no unlock.
-- Append-only like the attempt it describes.
CREATE TABLE eb_attempt_meta (
  attempt_id   INTEGER PRIMARY KEY REFERENCES attempt(id),
  mode         TEXT NOT NULL CHECK (mode IN ('interview')),
  elapsed_ms   INTEGER NOT NULL CHECK (elapsed_ms >= 0 AND elapsed_ms <= 86400000),
  time_box_ms  INTEGER NOT NULL CHECK (time_box_ms > 0 AND time_box_ms <= 86400000),
  blind        INTEGER NOT NULL CHECK (blind IN (0, 1)),
  created_at   INTEGER NOT NULL
);

CREATE TRIGGER eb_attempt_meta_no_update BEFORE UPDATE ON eb_attempt_meta
BEGIN SELECT RAISE(ABORT, 'append-only: eb_attempt_meta rows cannot be updated'); END;
CREATE TRIGGER eb_attempt_meta_no_delete BEFORE DELETE ON eb_attempt_meta
BEGIN SELECT RAISE(ABORT, 'append-only: eb_attempt_meta rows cannot be deleted'); END;
CREATE TRIGGER eb_attempt_meta_no_replace BEFORE INSERT ON eb_attempt_meta
WHEN EXISTS (SELECT 1 FROM eb_attempt_meta WHERE attempt_id = NEW.attempt_id)
BEGIN SELECT RAISE(ABORT, 'append-only: eb_attempt_meta rows cannot be replaced'); END;
