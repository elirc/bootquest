-- 027_answer_confidence: how sure the learner was of a graded answer, tagged before its result (rv2 stream S3;
-- PLAN F9, stretch). One row per graded attempt at most: a quiz gate / quick check submit or an explain-back answer
-- of record (never a practice try). The client asks while the answer is being written and files it right after the
-- attempt row exists (POST /attempts/:id/confidence, within CONFIDENCE_WINDOW_MS of the attempt). It feeds the
-- calibration panel on Stats and nothing else: no XP, no evidence, no grade, no unlock. Append-only.
CREATE TABLE answer_confidence (
  attempt_id  INTEGER PRIMARY KEY REFERENCES attempt(id),
  confidence  TEXT NOT NULL CHECK (confidence IN ('sure', 'unsure', 'guess')),
  created_at  INTEGER NOT NULL
);

CREATE TRIGGER answer_confidence_no_update BEFORE UPDATE ON answer_confidence
BEGIN SELECT RAISE(ABORT, 'append-only: answer_confidence rows cannot be updated'); END;
CREATE TRIGGER answer_confidence_no_delete BEFORE DELETE ON answer_confidence
BEGIN SELECT RAISE(ABORT, 'append-only: answer_confidence rows cannot be deleted'); END;
CREATE TRIGGER answer_confidence_no_replace BEFORE INSERT ON answer_confidence
WHEN EXISTS (SELECT 1 FROM answer_confidence WHERE attempt_id = NEW.attempt_id)
BEGIN SELECT RAISE(ABORT, 'append-only: answer_confidence rows cannot be replaced'); END;
