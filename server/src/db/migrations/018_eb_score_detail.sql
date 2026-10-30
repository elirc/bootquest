-- 018_eb_score_detail: how an explain-back self-score was computed (ab wave, stream S5).
-- One row per explain-back evidence row written from now on; older evidence has none and
-- keeps its plain-coverage meaning. `weighted` equals `plain` for a set whose key points carry
-- no [wN] prefix. `missed_ids` is a JSON array of the key-point ids marked missed; it feeds
-- the weak-spots view (stream S3). Append-only like evidence.
CREATE TABLE eb_score_detail (
  evidence_id  INTEGER PRIMARY KEY REFERENCES evidence(id),
  plain        REAL NOT NULL CHECK (plain >= 0 AND plain <= 1),
  weighted     REAL NOT NULL CHECK (weighted >= 0 AND weighted <= 1),
  w3_missed    INTEGER NOT NULL CHECK (w3_missed >= 0),
  missed_ids   TEXT NOT NULL CHECK (json_valid(missed_ids) AND json_type(missed_ids) = 'array'),
  created_at   INTEGER NOT NULL
);

CREATE TRIGGER eb_score_detail_no_update BEFORE UPDATE ON eb_score_detail
BEGIN SELECT RAISE(ABORT, 'append-only: eb_score_detail rows cannot be updated'); END;
CREATE TRIGGER eb_score_detail_no_delete BEFORE DELETE ON eb_score_detail
BEGIN SELECT RAISE(ABORT, 'append-only: eb_score_detail rows cannot be deleted'); END;
CREATE TRIGGER eb_score_detail_no_replace BEFORE INSERT ON eb_score_detail
WHEN EXISTS (SELECT 1 FROM eb_score_detail WHERE evidence_id = NEW.evidence_id)
BEGIN SELECT RAISE(ABORT, 'append-only: eb_score_detail rows cannot be replaced'); END;
