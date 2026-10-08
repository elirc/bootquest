-- bootquest:foreign-keys-off
-- 008_competency_ladder: W6 (spec §5 mutation gate, §6.2 promotion flow).
--
--  1. evidence.kind gains 'mutation': the mutation-gate marker (`bootquest
--     mutate`), verified pipeline evidence linked to the solo-project attempt
--     whose tests survived the per-file floor + overall break.
--  2. review_item.kind gains 'retest': the changed-example retest a passing
--     explain-back self-score schedules (due >= 2 days after the artifact and
--     explain-back attempts). Retest items are NOT FSRS cards: the FSRS queue,
--     due counts and grading exclude them (engines/fsrs.ts, store/queries.ts).
--
-- SQLite cannot alter a CHECK constraint in place: documented 12-step table
-- rebuilds (see 004). Column lists, defaults, FKs and indexes are unchanged;
-- only the kind IN (...) lists grow. Every trigger that is ON evidence, or
-- whose body names evidence (competency_rating_guarded_update), is dropped
-- first and re-created verbatim afterwards — ALTER TABLE RENAME refuses to run
-- while a trigger references a dropped table.

-- ---------------------------------------------------------------- 1. evidence

DROP TRIGGER evidence_no_update;
DROP TRIGGER evidence_no_delete;
DROP TRIGGER evidence_no_replace;
DROP TRIGGER evidence_rating_change_consistent;
DROP TRIGGER competency_rating_guarded_update;

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
  assistance     TEXT NOT NULL CHECK (assistance IN ('none', 'self', 'reveal')),
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

-- ---------------------------------------------------------------- 2. review_item

CREATE TABLE review_item_new (
  id              INTEGER PRIMARY KEY,
  card_key        TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL CHECK (kind IN ('card', 'finding', 'quiz-miss', 'concept', 'retest')),
  unit_id         INTEGER REFERENCES unit(id),
  content_ref_id  INTEGER REFERENCES content_ref(id),
  competency_id   TEXT REFERENCES competency(id),
  fsrs_state      TEXT NOT NULL CHECK (json_valid(fsrs_state)),
  due_at          INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

INSERT INTO review_item_new (id, card_key, kind, unit_id, content_ref_id, competency_id, fsrs_state, due_at, created_at, updated_at)
  SELECT id, card_key, kind, unit_id, content_ref_id, competency_id, fsrs_state, due_at, created_at, updated_at
    FROM review_item;

DROP TABLE review_item;
ALTER TABLE review_item_new RENAME TO review_item;

CREATE INDEX review_item_due ON review_item(due_at);
