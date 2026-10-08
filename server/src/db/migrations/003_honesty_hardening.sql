-- 003_honesty_hardening: W1c fixes for the W1a audit (docs/recon/w1a-audit.md).
--
--  #1  REPLACE / INSERT OR REPLACE bypassed the append-only UPDATE/DELETE
--      triggers (SQLite's REPLACE deletes without firing DELETE triggers unless
--      recursive_triggers is ON). Two layers now: the Db wrapper sets
--      PRAGMA recursive_triggers = ON (so the conflict-delete fires *_no_delete),
--      and these BEFORE INSERT triggers refuse any insert that reuses an
--      existing id, whatever the connection's pragmas.
--  #8  competency_rating may only change through promote/demote: every UPDATE
--      must point last_evidence_id at the NEWEST promotion/demotion evidence
--      row for that competency, whose rating equals NEW.rating, and the move
--      must be exactly one notch (promotion +1, demotion -1 floored at 1).
--  #5  defence in depth: at most one paying xp_event per (unit, kind).
--  #14 "check".type / inverted must agree with the spec JSON.
--  #18 content_ref.summary is limited to 280 chars in SQL too.

-- ---------------------------------------------------------------- #1 append-only: no id reuse

CREATE TRIGGER attempt_no_replace BEFORE INSERT ON attempt
WHEN EXISTS (SELECT 1 FROM attempt WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: attempt rows cannot be replaced'); END;

CREATE TRIGGER run_no_replace BEFORE INSERT ON run
WHEN EXISTS (SELECT 1 FROM run WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: run rows cannot be replaced'); END;

CREATE TRIGGER evidence_no_replace BEFORE INSERT ON evidence
WHEN EXISTS (SELECT 1 FROM evidence WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: evidence rows cannot be replaced'); END;

CREATE TRIGGER xp_event_no_replace BEFORE INSERT ON xp_event
WHEN EXISTS (SELECT 1 FROM xp_event WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: xp_event rows cannot be replaced'); END;

CREATE TRIGGER review_log_no_replace BEFORE INSERT ON review_log
WHEN EXISTS (SELECT 1 FROM review_log WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: review_log rows cannot be replaced'); END;

-- ---------------------------------------------------------------- #8 rating integrity

-- A promotion/demotion evidence row must carry the rating it moves TO, one
-- notch from the current rating (promotion capped at 5, demotion floored at 1).
CREATE TRIGGER evidence_rating_change_consistent BEFORE INSERT ON evidence
WHEN NEW.kind IN ('promotion', 'demotion')
 AND NEW.rating IS NOT (
   SELECT CASE NEW.kind
            WHEN 'promotion' THEN CASE WHEN r.rating < 5 THEN r.rating + 1 ELSE NULL END
            ELSE MAX(1, r.rating - 1)
          END
     FROM competency_rating r WHERE r.competency_id = NEW.competency_id)
BEGIN SELECT RAISE(ABORT, 'rating integrity: promotion/demotion evidence must move exactly one notch'); END;

CREATE TRIGGER competency_rating_guarded_update BEFORE UPDATE ON competency_rating
WHEN NEW.competency_id IS NOT OLD.competency_id
  OR NEW.last_evidence_id IS NULL
  OR NEW.last_evidence_id IS OLD.last_evidence_id
  OR NOT EXISTS (
    SELECT 1 FROM evidence e
     WHERE e.id = NEW.last_evidence_id
       AND e.competency_id = NEW.competency_id
       AND e.kind IN ('promotion', 'demotion')
       AND e.rating = NEW.rating
       AND e.id = (SELECT MAX(id) FROM evidence
                    WHERE competency_id = NEW.competency_id AND kind IN ('promotion', 'demotion'))
       AND NEW.rating = CASE e.kind WHEN 'promotion' THEN OLD.rating + 1 ELSE MAX(1, OLD.rating - 1) END)
BEGIN SELECT RAISE(ABORT, 'rating integrity: competency_rating changes only via promotion/demotion evidence'); END;

CREATE TRIGGER competency_rating_no_delete BEFORE DELETE ON competency_rating
BEGIN SELECT RAISE(ABORT, 'rating integrity: competency_rating rows cannot be deleted'); END;

-- only the seed shape (rating 1, no evidence) may be inserted, and never twice
CREATE TRIGGER competency_rating_guarded_insert BEFORE INSERT ON competency_rating
WHEN NEW.rating <> 1 OR NEW.last_evidence_id IS NOT NULL
  OR EXISTS (SELECT 1 FROM competency_rating WHERE competency_id = NEW.competency_id)
BEGIN SELECT RAISE(ABORT, 'rating integrity: competency_rating rows are seeded once at rating 1'); END;

-- ---------------------------------------------------------------- #5 one paying award per unit and kind

CREATE UNIQUE INDEX xp_event_pays_once ON xp_event(unit_id, kind)
  WHERE amount > 0 AND kind <> 'review' AND unit_id IS NOT NULL;

-- ---------------------------------------------------------------- #14 check spec agreement

CREATE TRIGGER check_spec_type_agrees BEFORE INSERT ON "check"
WHEN json_extract(NEW.spec, '$.type') IS NOT NEW.type
  OR NEW.inverted <> COALESCE(json_extract(NEW.spec, '$.inverted'), 0)
BEGIN SELECT RAISE(ABORT, 'check: type/inverted must match the spec JSON'); END;

CREATE TRIGGER check_spec_type_agrees_update BEFORE UPDATE ON "check"
WHEN json_extract(NEW.spec, '$.type') IS NOT NEW.type
  OR NEW.inverted <> COALESCE(json_extract(NEW.spec, '$.inverted'), 0)
BEGIN SELECT RAISE(ABORT, 'check: type/inverted must match the spec JSON'); END;

-- ---------------------------------------------------------------- #18 summary length

CREATE TRIGGER content_ref_summary_len BEFORE INSERT ON content_ref
WHEN length(NEW.summary) > 280
BEGIN SELECT RAISE(ABORT, 'content_ref: summary is one line (<= 280 chars), never curriculum text'); END;

CREATE TRIGGER content_ref_summary_len_update BEFORE UPDATE ON content_ref
WHEN length(NEW.summary) > 280
BEGIN SELECT RAISE(ABORT, 'content_ref: summary is one line (<= 280 chars), never curriculum text'); END;
