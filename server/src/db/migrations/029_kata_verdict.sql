-- 029_kata_verdict: kata precision (rv3 S5, PLAN W9 / F10, ruling 6). A kata listed in content/seed/kata-flags.json
-- as `clean` (the PR has no defect) or with `decoys` (nit-only lines) asks for a verdict: approve (no findings) or
-- block (findings). Katas that are not flagged are untouched: no row here, the G1 rule of rv B (021) as before.
--
-- kata_verdict: the verdict, written in the SAME transaction as the answer attempt (before any key is readable), one
-- row per answer at most. Append-only.
CREATE TABLE kata_verdict (
  attempt_id  INTEGER PRIMARY KEY REFERENCES attempt(id),
  verdict     TEXT NOT NULL CHECK (verdict IN ('approve', 'block')),
  created_at  INTEGER NOT NULL
);

CREATE TRIGGER kata_verdict_no_update BEFORE UPDATE ON kata_verdict
BEGIN SELECT RAISE(ABORT, 'append-only: kata_verdict rows cannot be updated'); END;
CREATE TRIGGER kata_verdict_no_delete BEFORE DELETE ON kata_verdict
BEGIN SELECT RAISE(ABORT, 'append-only: kata_verdict rows cannot be deleted'); END;
CREATE TRIGGER kata_verdict_no_replace BEFORE INSERT ON kata_verdict
WHEN EXISTS (SELECT 1 FROM kata_verdict WHERE attempt_id = NEW.attempt_id)
BEGIN SELECT RAISE(ABORT, 'append-only: kata_verdict rows cannot be replaced'); END;

-- kata_precision: how a flagged kata's self-score counts toward G1, one row per kata evidence row, written in the
-- self-score transaction with the counts AS SCORED (a re-seed or a flags edit never moves them). GET /stats/katas
-- uses g1_total / g1_caught for these rows instead of kata_score_detail:
--   clean kata   g1_total = 1, g1_caught = 1 when the verdict was approve, else 0 (a finding on a clean PR fails);
--   decoy kata   g1_total = patched-line defects + decoy lines flagged (each is a false positive),
--                g1_caught = patched-line defects caught (0 on an approve: nothing was found).
-- passed: clean = the verdict was approve; decoys = blocked, no decoy flagged, catch rate >= the G1 target.
CREATE TABLE kata_precision (
  id              INTEGER PRIMARY KEY,
  evidence_id     INTEGER NOT NULL UNIQUE REFERENCES evidence(id),
  verdict         TEXT NOT NULL CHECK (verdict IN ('approve', 'block')),
  clean           INTEGER NOT NULL CHECK (clean IN (0, 1)),
  passed          INTEGER NOT NULL CHECK (passed IN (0, 1)),
  decoys_total    INTEGER NOT NULL CHECK (decoys_total >= 0),
  decoys_flagged  INTEGER NOT NULL CHECK (decoys_flagged >= 0 AND decoys_flagged <= decoys_total),
  g1_total        INTEGER NOT NULL CHECK (g1_total >= 0),
  g1_caught       INTEGER NOT NULL CHECK (g1_caught >= 0 AND g1_caught <= g1_total),
  created_at      INTEGER NOT NULL
);

CREATE TRIGGER kata_precision_no_update BEFORE UPDATE ON kata_precision
BEGIN SELECT RAISE(ABORT, 'append-only: kata_precision rows cannot be updated'); END;
CREATE TRIGGER kata_precision_no_delete BEFORE DELETE ON kata_precision
BEGIN SELECT RAISE(ABORT, 'append-only: kata_precision rows cannot be deleted'); END;
CREATE TRIGGER kata_precision_no_replace BEFORE INSERT ON kata_precision
WHEN EXISTS (SELECT 1 FROM kata_precision WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: kata_precision rows cannot be replaced'); END;
