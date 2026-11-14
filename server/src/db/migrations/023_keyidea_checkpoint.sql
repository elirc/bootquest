-- 023_keyidea_checkpoint: the key-ideas layer's retrieval checkpoints (rv2 stream S1; PLAN §2.1 items 2-3, F1).
-- One row per finished section recap ('recap', once per section: it pays a flat 20 XP, xp_event_id) and per
-- finished spaced re-check ('recheck-14', 'recheck-45': 14 and 45 days after the recap, five prompts drawn from
-- the section's shakiest ideas; its card's review XP is linked by review_log, not here). `items` keeps what the
-- learner did, answer first: [{ideaId, recall (the typed free recall, >= 8 words), mark: got|partly|missed}].
-- A checkpoint is NOT evidence: no evidence row, no ladder leg, no practice_log row, no unlock. The section id is a
-- side-file id (content/keyideas/<section>.json), not a foreign key: a section that leaves the side files keeps
-- its history. Append-only.
CREATE TABLE keyidea_checkpoint (
  id           INTEGER PRIMARY KEY,
  section      TEXT NOT NULL CHECK (length(section) BETWEEN 1 AND 80),
  kind         TEXT NOT NULL CHECK (kind IN ('recap', 'recheck-14', 'recheck-45')),
  items        TEXT NOT NULL CHECK (json_valid(items) AND json_type(items) = 'array'),
  xp_event_id  INTEGER REFERENCES xp_event(id),
  created_at   INTEGER NOT NULL,
  CHECK (kind = 'recap' OR xp_event_id IS NULL),
  UNIQUE (section, kind)
);

CREATE TRIGGER keyidea_checkpoint_no_update BEFORE UPDATE ON keyidea_checkpoint
BEGIN SELECT RAISE(ABORT, 'append-only: keyidea_checkpoint rows cannot be updated'); END;
CREATE TRIGGER keyidea_checkpoint_no_delete BEFORE DELETE ON keyidea_checkpoint
BEGIN SELECT RAISE(ABORT, 'append-only: keyidea_checkpoint rows cannot be deleted'); END;
CREATE TRIGGER keyidea_checkpoint_no_replace BEFORE INSERT ON keyidea_checkpoint
WHEN EXISTS (SELECT 1 FROM keyidea_checkpoint WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: keyidea_checkpoint rows cannot be replaced'); END;
