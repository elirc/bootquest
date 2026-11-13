-- 021_kata_score_detail: how a kata self-score splits between the defect and its consequences
-- (rv wave, stream B; R3-04). A seeded defect whose evidence sits in the PATCHED lines is "the
-- defect"; one whose evidence is elsewhere in the repo is a consequence / context narrative. G1
-- (GET /stats/katas) counts patched defects only. One row per kata evidence row, written in the
-- self-score transaction with the counts AS ANSWERED (a re-seed never moves them). Kata evidence
-- written before this migration has no row and keeps counting every defect. Append-only.
CREATE TABLE kata_score_detail (
  id              INTEGER PRIMARY KEY,
  evidence_id     INTEGER NOT NULL UNIQUE REFERENCES evidence(id),
  patched_total   INTEGER NOT NULL CHECK (patched_total >= 0),
  patched_caught  INTEGER NOT NULL CHECK (patched_caught >= 0 AND patched_caught <= patched_total),
  repo_total      INTEGER NOT NULL CHECK (repo_total >= 0),
  repo_caught     INTEGER NOT NULL CHECK (repo_caught >= 0 AND repo_caught <= repo_total),
  created_at      INTEGER NOT NULL
);

CREATE TRIGGER kata_score_detail_no_update BEFORE UPDATE ON kata_score_detail
BEGIN SELECT RAISE(ABORT, 'append-only: kata_score_detail rows cannot be updated'); END;
CREATE TRIGGER kata_score_detail_no_delete BEFORE DELETE ON kata_score_detail
BEGIN SELECT RAISE(ABORT, 'append-only: kata_score_detail rows cannot be deleted'); END;
CREATE TRIGGER kata_score_detail_no_replace BEFORE INSERT ON kata_score_detail
WHEN EXISTS (SELECT 1 FROM kata_score_detail WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: kata_score_detail rows cannot be replaced'); END;
