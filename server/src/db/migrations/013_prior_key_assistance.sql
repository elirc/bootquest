-- bootquest:foreign-keys-off
-- 013_prior_key_assistance: assistance source 'prior-key' (server review F2).
--
-- A re-seeded explain-back / kata item takes ONE fresh answer per version
-- (api/ladder-service.ts currentAnswer). The learner's answer to the EARLIER version
-- unlocked that version's key, and key reads are not recorded (GET .../key writes
-- nothing), so a fresh answer after a superseded one can never be shown to be blind.
-- It is recorded as an ASSISTED attempt with assistance_source 'prior-key': mode
-- 'assisted', assisted = 1, exactly like an honor-system self flag, so it never
-- satisfies promotion leg (b) and never counts as solo for G1. The evidence filed on
-- it inherits the source.
--
-- SQLite cannot alter a CHECK constraint in place: documented 12-step table rebuilds
-- (see 004 / 008). Column lists, defaults, FKs and indexes are unchanged; only the
-- assistance IN (...) lists and attempt's mode/assisted/source agreement grow. Every
-- trigger that is ON attempt / evidence, or whose body names them
-- (check_referenced_frame_frozen, competency_rating_guarded_update), is dropped first
-- and re-created verbatim afterwards.

DROP TRIGGER attempt_no_update;
DROP TRIGGER attempt_no_delete;
DROP TRIGGER attempt_no_replace;
DROP TRIGGER check_referenced_frame_frozen;
DROP TRIGGER evidence_no_update;
DROP TRIGGER evidence_no_delete;
DROP TRIGGER evidence_no_replace;
DROP TRIGGER evidence_rating_change_consistent;
DROP TRIGGER competency_rating_guarded_update;

-- ---------------------------------------------------------------- 1. attempt

CREATE TABLE attempt_new (
  id                 INTEGER PRIMARY KEY,
  unit_id            INTEGER NOT NULL REFERENCES unit(id),
  check_id           INTEGER REFERENCES "check"(id),
  mode               TEXT NOT NULL CHECK (mode IN ('solo', 'assisted', 'guided')),
  assisted           INTEGER NOT NULL CHECK (assisted IN (0, 1)),
  assistance_source  TEXT NOT NULL CHECK (assistance_source IN ('none', 'self', 'reveal', 'prior-key')),
  -- 'revealed' = the reveal-solution event itself (an attempt row, mode guided)
  outcome            TEXT NOT NULL CHECK (outcome IN ('pass', 'fail', 'todo', 'error', 'revealed', 'submitted')),
  score              REAL CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  -- the learner's own immutable answer (explain-back transcript, kata findings); not curriculum text
  answer             TEXT CHECK (answer IS NULL OR json_valid(answer)),
  -- reveal schedules a pre-seeded variation; NULL when none is seeded yet (degrades gracefully)
  variation_unit_id  INTEGER REFERENCES unit(id),
  created_at         INTEGER NOT NULL,
  CHECK ((mode = 'solo' AND assisted = 0 AND assistance_source = 'none')
      OR (mode = 'assisted' AND assisted = 1 AND assistance_source IN ('self', 'prior-key'))
      OR (mode = 'guided' AND assisted = 1 AND assistance_source = 'reveal'))
);

INSERT INTO attempt_new (id, unit_id, check_id, mode, assisted, assistance_source, outcome, score, answer, variation_unit_id, created_at)
  SELECT id, unit_id, check_id, mode, assisted, assistance_source, outcome, score, answer, variation_unit_id, created_at
    FROM attempt;

DROP TABLE attempt;
ALTER TABLE attempt_new RENAME TO attempt;

CREATE INDEX attempt_unit ON attempt(unit_id, created_at);

-- ---------------------------------------------------------------- 2. evidence

CREATE TABLE evidence_new (
  id             INTEGER PRIMARY KEY,
  competency_id  TEXT NOT NULL REFERENCES competency(id),
  attempt_id     INTEGER REFERENCES attempt(id),
  unit_id        INTEGER REFERENCES unit(id),
  kind           TEXT NOT NULL CHECK (kind IN (
                   'artifact', 'explain-back', 'retest', 'review', 'kata', 'submit',
                   'self-assessment', 'promotion', 'demotion', 'mutation')),
  intention      TEXT NOT NULL,
  observation    TEXT NOT NULL,
  assistance     TEXT NOT NULL CHECK (assistance IN ('none', 'self', 'reveal', 'prior-key')),
  assessor       TEXT NOT NULL CHECK (assessor IN ('pipeline', 'self')),
  rating         INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  verified       INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  score          REAL CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  created_at     INTEGER NOT NULL
);

INSERT INTO evidence_new (id, competency_id, attempt_id, unit_id, kind, intention, observation, assistance,
                          assessor, rating, verified, score, created_at)
  SELECT id, competency_id, attempt_id, unit_id, kind, intention, observation, assistance,
         assessor, rating, verified, score, created_at
    FROM evidence;

DROP TABLE evidence;
ALTER TABLE evidence_new RENAME TO evidence;

CREATE INDEX evidence_competency ON evidence(competency_id, created_at);
CREATE INDEX evidence_attempt ON evidence(attempt_id);

-- ---------------------------------------------------------------- 3. triggers, verbatim

CREATE TRIGGER attempt_no_update BEFORE UPDATE ON attempt
BEGIN SELECT RAISE(ABORT, 'append-only: attempt rows cannot be updated'); END;
CREATE TRIGGER attempt_no_delete BEFORE DELETE ON attempt
BEGIN SELECT RAISE(ABORT, 'append-only: attempt rows cannot be deleted'); END;
CREATE TRIGGER attempt_no_replace BEFORE INSERT ON attempt
WHEN EXISTS (SELECT 1 FROM attempt WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: attempt rows cannot be replaced'); END;

CREATE TRIGGER check_referenced_frame_frozen BEFORE UPDATE ON "check"
WHEN (NEW.unit_id IS NOT OLD.unit_id
   OR NEW.type IS NOT OLD.type
   OR NEW.spec IS NOT OLD.spec
   OR NEW.threshold IS NOT OLD.threshold
   OR NEW.inverted IS NOT OLD.inverted
   OR NEW.timeout_ms IS NOT OLD.timeout_ms)
 AND (EXISTS (SELECT 1 FROM attempt WHERE check_id = OLD.id)
   OR EXISTS (SELECT 1 FROM run WHERE check_id = OLD.id))
BEGIN SELECT RAISE(ABORT, 'check: a check referenced by attempts/runs is frozen (retire it and insert a new one)'); END;

CREATE TRIGGER evidence_no_update BEFORE UPDATE ON evidence
BEGIN SELECT RAISE(ABORT, 'append-only: evidence rows cannot be updated'); END;
CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence
BEGIN SELECT RAISE(ABORT, 'append-only: evidence rows cannot be deleted'); END;

CREATE TRIGGER evidence_no_replace BEFORE INSERT ON evidence
WHEN EXISTS (SELECT 1 FROM evidence WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: evidence rows cannot be replaced'); END;

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
