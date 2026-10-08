-- 001_init: BootQuest core schema (spec §9 + estate-contract §6).
--
-- Conventions
--   * Timestamps are INTEGER epoch milliseconds, always supplied by the caller's
--     injected clock (never DEFAULT CURRENT_TIMESTAMP).
--   * Day keys ('YYYY-MM-DD') are LOCAL calendar days computed by engines/clock.ts.
--   * Booleans are INTEGER 0/1 with CHECK constraints; db/hygiene.ts converts them.
--   * JSON columns are TEXT with CHECK (json_valid(...)).
--   * Curriculum TEXT is never stored: content lives in the owner's repos and is
--     referenced through content_ref (repo, path, sha, anchor, stable_key).
--   * attempt, run, evidence, xp_event and review_log are APPEND-ONLY, enforced
--     by triggers at the bottom of this file. Corrections are new rows.

-- ---------------------------------------------------------------- vocabulary

CREATE TABLE track (
  id            TEXT PRIMARY KEY CHECK (id IN ('js', 'csharp', 'java', 'agentic')),
  name          TEXT NOT NULL,
  locked        INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  -- 1 when the track contributes a "drill set" slot to the daily slate (§6.1)
  slate_drills  INTEGER NOT NULL DEFAULT 0 CHECK (slate_drills IN (0, 1)),
  sort_order    INTEGER NOT NULL
);

CREATE TABLE competency (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);

-- Free-text competency names found in sources (e.g. signalpost's 24-name
-- vocabulary) mapped onto the seven ladder competencies. Seeded in W1.5.
CREATE TABLE competency_alias (
  alias          TEXT PRIMARY KEY,
  competency_id  TEXT NOT NULL REFERENCES competency(id)
);

-- ---------------------------------------------------------------- content

CREATE TABLE source (
  id                INTEGER PRIMARY KEY,
  key               TEXT NOT NULL UNIQUE,          -- e.g. 'csbootcamp', 'jstrain2.2/csbootcamp'
  repo              TEXT NOT NULL,                 -- owner/name, case-sensitive, never slugged
  subpath           TEXT NOT NULL DEFAULT '',      -- pack root inside the repo ('' = repo root)
  role              TEXT NOT NULL CHECK (role IN ('curriculum', 'reference', 'corpus', 'pack')),
  origin_kind       TEXT NOT NULL CHECK (origin_kind IN ('github', 'local-mirror', 'local')),
  default_branch    TEXT,                          -- resolved, never assumed (vgslop = master)
  pinned_sha        TEXT,
  local_cache_path  TEXT,
  read_only         INTEGER NOT NULL DEFAULT 1 CHECK (read_only IN (0, 1)),
  created_at        INTEGER NOT NULL
);

CREATE TABLE content_ref (
  id               INTEGER PRIMARY KEY,
  source_id        INTEGER REFERENCES source(id),
  repo             TEXT NOT NULL,
  path             TEXT NOT NULL,
  sha              TEXT NOT NULL,
  anchor           TEXT,                           -- heading slug, F1/R21 label, or JSON-pointer-ish
  title            TEXT NOT NULL,
  summary          TEXT,                           -- one-line, seed-authored; never the curriculum body
  stable_key       TEXT NOT NULL,
  stable_key_algo  INTEGER NOT NULL DEFAULT 1,
  line_start       INTEGER CHECK (line_start IS NULL OR line_start >= 1),
  line_end         INTEGER CHECK (line_end IS NULL OR (line_start IS NOT NULL AND line_end >= line_start)),
  kind             TEXT NOT NULL CHECK (kind IN ('guide', 'exercise', 'finding', 'quiz', 'program-unit', 'check-file', 'reading')),
  -- how stable_key was derived; 'json-pointer' covers program.json field anchors
  provenance       TEXT NOT NULL CHECK (provenance IN ('frontmatter', 'heading-hash', 'json-pointer')),
  -- honesty distinction for findings/exercises (estate rule 3); nullable for plain guides
  origin           TEXT CHECK (origin IS NULL OR origin IN ('observed', 'read-derived', 'author-recorded')),
  status           TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'quarantined', 'stale-anchor', 'missing-at-sha')),
  family           TEXT,
  twin_of_id       INTEGER REFERENCES content_ref(id),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (repo, stable_key)
);

CREATE TABLE unit (
  id                    INTEGER PRIMARY KEY,
  key                   TEXT NOT NULL UNIQUE,      -- stable seed key, e.g. 'bootforge:js-basics:yes-no'
  track_id              TEXT NOT NULL REFERENCES track(id),
  kind                  TEXT NOT NULL CHECK (kind IN (
                          'drill', 'quiz', 'predict-output', 'guided-project', 'http-lab',
                          'repo-task', 'study', 'reading', 'explain-back', 'patch-kata',
                          'review', 'program-unit', 'retest')),
  title                 TEXT NOT NULL,
  code                  TEXT,                      -- e.g. signalpost 'U02'
  phase                 TEXT,
  difficulty            INTEGER CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5),
  xp                    INTEGER CHECK (xp IS NULL OR xp >= 0),  -- informational; engines compute awards
  target_level          INTEGER CHECK (target_level IS NULL OR target_level BETWEEN 1 AND 5),
  source_id             INTEGER REFERENCES source(id),
  content_ref_id        INTEGER REFERENCES content_ref(id),
  -- a changed-example variant points at the unit it varies (reveal / retest scheduling)
  variation_of_unit_id  INTEGER REFERENCES unit(id),
  created_at            INTEGER NOT NULL
);
CREATE INDEX unit_track ON unit(track_id);
CREATE INDEX unit_variation_of ON unit(variation_of_unit_id);

-- unit.competencies[] (spec §9) as a join table
CREATE TABLE unit_competency (
  unit_id        INTEGER NOT NULL REFERENCES unit(id),
  competency_id  TEXT NOT NULL REFERENCES competency(id),
  PRIMARY KEY (unit_id, competency_id)
);

-- unit.prerequisites[] (spec §9) as a join table
CREATE TABLE unit_prerequisite (
  unit_id         INTEGER NOT NULL REFERENCES unit(id),
  prereq_unit_id  INTEGER NOT NULL REFERENCES unit(id),
  PRIMARY KEY (unit_id, prereq_unit_id),
  CHECK (unit_id <> prereq_unit_id)
);

-- signalpost program.json tickets (estate-contract §6). Text (acceptance[],
-- done[], context) stays in the repo, reachable via content_ref.
CREATE TABLE ticket (
  id              INTEGER PRIMARY KEY,
  unit_id         INTEGER NOT NULL REFERENCES unit(id),
  ticket_code     TEXT NOT NULL UNIQUE,            -- 'U02-01'
  title           TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('SOLO', 'PAIR')),
  step            TEXT NOT NULL,
  estimate_lo     REAL,
  estimate_hi     REAL,
  dependencies    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dependencies)),
  content_ref_id  INTEGER REFERENCES content_ref(id)
);

CREATE TABLE "check" (
  id              INTEGER PRIMARY KEY,
  unit_id         INTEGER NOT NULL REFERENCES unit(id),
  type            TEXT NOT NULL CHECK (type IN (
                    'drill-js', 'drill-cs', 'quiz', 'predict-output', 'guided-step', 'http',
                    'repo', 'study-quiz', 'explain-back', 'patch-kata', 'review',
                    'node-test-file', 'self-run', 'vitest-project')),
  spec            TEXT NOT NULL CHECK (json_valid(spec)),   -- validated by @bootquest/shared CheckSpec
  threshold       REAL CHECK (threshold IS NULL OR (threshold >= 0 AND threshold <= 1)),
  -- inverted: the module is expected to FAIL (jstrain *-debug / *-hunts)
  inverted        INTEGER NOT NULL DEFAULT 0 CHECK (inverted IN (0, 1)),
  timeout_ms      INTEGER CHECK (timeout_ms IS NULL OR timeout_ms > 0),
  content_ref_id  INTEGER REFERENCES content_ref(id),
  created_at      INTEGER NOT NULL,
  CHECK (inverted = 0 OR type = 'self-run')
);
CREATE INDEX check_unit ON "check"(unit_id);

-- ---------------------------------------------------------------- campaign

CREATE TABLE campaign_act (
  id            INTEGER PRIMARY KEY,
  track_id      TEXT NOT NULL REFERENCES track(id),
  act_no        INTEGER NOT NULL CHECK (act_no BETWEEN 1 AND 5),
  title         TEXT NOT NULL,
  unlock_pct    REAL NOT NULL DEFAULT 0.8 CHECK (unlock_pct >= 0 AND unlock_pct <= 1),
  unlock_level  INTEGER NOT NULL DEFAULT 1 CHECK (unlock_level >= 1),
  locked        INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  UNIQUE (track_id, act_no)
);

CREATE TABLE quest (
  id           INTEGER PRIMARY KEY,
  act_id       INTEGER NOT NULL REFERENCES campaign_act(id),
  unit_id      INTEGER REFERENCES unit(id),
  repo         TEXT NOT NULL,
  index_rank   INTEGER NOT NULL,
  verdict      TEXT NOT NULL CHECK (verdict IN ('study', 'skim')),   -- 'skip' repos are absent
  confidence   TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'med', 'low')),
  difficulty   INTEGER CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5),
  richness     INTEGER CHECK (richness IS NULL OR richness BETWEEN 0 AND 5),
  stack        TEXT,
  kind         TEXT,
  core         INTEGER NOT NULL DEFAULT 1 CHECK (core IN (0, 1)),
  family       TEXT,
  family_pick  INTEGER NOT NULL DEFAULT 0 CHECK (family_pick IN (0, 1)),
  UNIQUE (act_id, repo)
);

CREATE TABLE skill_node (
  id        INTEGER PRIMARY KEY,
  key       TEXT NOT NULL UNIQUE,
  track_id  TEXT NOT NULL REFERENCES track(id),
  title     TEXT NOT NULL,
  unit_id   INTEGER REFERENCES unit(id),
  act_id    INTEGER REFERENCES campaign_act(id)
);

CREATE TABLE skill_node_prereq (
  node_id         INTEGER NOT NULL REFERENCES skill_node(id),
  prereq_node_id  INTEGER NOT NULL REFERENCES skill_node(id),
  PRIMARY KEY (node_id, prereq_node_id),
  CHECK (node_id <> prereq_node_id)
);

-- ---------------------------------------------------------------- honesty ledger (append-only)

CREATE TABLE attempt (
  id                 INTEGER PRIMARY KEY,
  unit_id            INTEGER NOT NULL REFERENCES unit(id),
  check_id           INTEGER REFERENCES "check"(id),
  mode               TEXT NOT NULL CHECK (mode IN ('solo', 'assisted', 'guided')),
  assisted           INTEGER NOT NULL CHECK (assisted IN (0, 1)),
  assistance_source  TEXT NOT NULL CHECK (assistance_source IN ('none', 'self', 'reveal')),
  -- 'revealed' = the reveal-solution event itself (an attempt row, mode guided)
  outcome            TEXT NOT NULL CHECK (outcome IN ('pass', 'fail', 'todo', 'error', 'revealed', 'submitted')),
  score              REAL CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  -- the learner's own immutable answer (explain-back transcript, kata findings); not curriculum text
  answer             TEXT CHECK (answer IS NULL OR json_valid(answer)),
  -- reveal schedules a pre-seeded variation; NULL when none is seeded yet (degrades gracefully)
  variation_unit_id  INTEGER REFERENCES unit(id),
  created_at         INTEGER NOT NULL,
  CHECK ((mode = 'solo' AND assisted = 0 AND assistance_source = 'none')
      OR (mode = 'assisted' AND assisted = 1 AND assistance_source = 'self')
      OR (mode = 'guided' AND assisted = 1 AND assistance_source = 'reveal'))
);
CREATE INDEX attempt_unit ON attempt(unit_id, created_at);

CREATE TABLE run (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('run', 'submit')),   -- run is free; submit is logged with an attempt
  attempt_id   INTEGER REFERENCES attempt(id),
  check_id     INTEGER REFERENCES "check"(id),
  unit_id      INTEGER REFERENCES unit(id),
  verdict      TEXT NOT NULL CHECK (verdict IN ('pass', 'fail', 'todo', 'crashed', 'timeout', 'error')),
  passed       INTEGER,
  failed       INTEGER,
  todo         INTEGER,
  duration_ms  INTEGER,
  raw          TEXT NOT NULL CHECK (json_valid(raw)),   -- raw runner verdict JSON, kept forever
  created_at   INTEGER NOT NULL,
  CHECK (kind = 'run' OR attempt_id IS NOT NULL)
);
CREATE INDEX run_attempt ON run(attempt_id);

CREATE TABLE evidence (
  id             INTEGER PRIMARY KEY,
  competency_id  TEXT NOT NULL REFERENCES competency(id),
  attempt_id     INTEGER REFERENCES attempt(id),
  unit_id        INTEGER REFERENCES unit(id),
  kind           TEXT NOT NULL CHECK (kind IN (
                   'artifact', 'explain-back', 'retest', 'review', 'kata', 'submit',
                   'self-assessment', 'promotion', 'demotion')),
  intention      TEXT NOT NULL,
  observation    TEXT NOT NULL,
  assistance     TEXT NOT NULL CHECK (assistance IN ('none', 'self', 'reveal')),
  assessor       TEXT NOT NULL CHECK (assessor IN ('pipeline', 'self')),
  rating         INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  verified       INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  score          REAL CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  created_at     INTEGER NOT NULL
);
CREATE INDEX evidence_competency ON evidence(competency_id, created_at);

CREATE TABLE xp_event (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN (
                'code', 'quiz', 'predict', 'study-quest', 'reading', 'explain-back',
                'patch-kata', 'review')),
  amount      INTEGER NOT NULL CHECK (amount >= 0),
  -- why an award was zero: revealed solution, daily review cap, or already awarded
  reason      TEXT CHECK (reason IS NULL OR reason IN ('revealed', 'daily-cap', 'already-awarded')),
  unit_id     INTEGER REFERENCES unit(id),
  attempt_id  INTEGER REFERENCES attempt(id),
  track_id    TEXT REFERENCES track(id),
  day         TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  CHECK (reason IS NULL OR amount = 0)
);
CREATE INDEX xp_event_day ON xp_event(day);
CREATE INDEX xp_event_unit ON xp_event(unit_id);

-- ---------------------------------------------------------------- competency + review state (mutable)

CREATE TABLE competency_rating (
  competency_id     TEXT PRIMARY KEY REFERENCES competency(id),
  rating            INTEGER NOT NULL DEFAULT 1 CHECK (rating BETWEEN 1 AND 5),
  last_evidence_id  INTEGER REFERENCES evidence(id),
  updated_at        INTEGER NOT NULL
);

CREATE TABLE review_item (
  id              INTEGER PRIMARY KEY,
  card_key        TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL CHECK (kind IN ('card', 'finding', 'quiz-miss', 'concept')),
  unit_id         INTEGER REFERENCES unit(id),
  content_ref_id  INTEGER REFERENCES content_ref(id),
  competency_id   TEXT REFERENCES competency(id),
  fsrs_state      TEXT NOT NULL CHECK (json_valid(fsrs_state)),
  due_at          INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX review_item_due ON review_item(due_at);

-- review history (append-only) — review_item holds only the current FSRS state
CREATE TABLE review_log (
  id               INTEGER PRIMARY KEY,
  review_item_id   INTEGER NOT NULL REFERENCES review_item(id),
  rating           TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  prev_due_at      INTEGER NOT NULL,
  next_due_at      INTEGER NOT NULL,
  xp_event_id      INTEGER REFERENCES xp_event(id),
  demotion_evidence_id INTEGER REFERENCES evidence(id),
  reviewed_at      INTEGER NOT NULL
);

-- ---------------------------------------------------------------- slate + streak (mutable)

CREATE TABLE daily_slate (
  day         TEXT PRIMARY KEY,                     -- local 'YYYY-MM-DD'
  items       TEXT NOT NULL CHECK (json_valid(items)),
  -- open: today/in progress; slate: completed slate-day; partial: 20+ XP without slate;
  -- frozen: gap covered by a freeze token; missed: gap that broke the streak
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'slate', 'partial', 'frozen', 'missed')),
  xp_total    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER
);

CREATE TABLE streak (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  current             INTEGER NOT NULL DEFAULT 0 CHECK (current >= 0),
  longest             INTEGER NOT NULL DEFAULT 0 CHECK (longest >= 0),
  tokens              INTEGER NOT NULL DEFAULT 0 CHECK (tokens BETWEEN 0 AND 2),
  slate_days_banked   INTEGER NOT NULL DEFAULT 0 CHECK (slate_days_banked BETWEEN 0 AND 6),
  last_closed_day     TEXT,
  updated_at          INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- append-only enforcement

CREATE TRIGGER attempt_no_update BEFORE UPDATE ON attempt
BEGIN SELECT RAISE(ABORT, 'append-only: attempt rows cannot be updated'); END;
CREATE TRIGGER attempt_no_delete BEFORE DELETE ON attempt
BEGIN SELECT RAISE(ABORT, 'append-only: attempt rows cannot be deleted'); END;

CREATE TRIGGER run_no_update BEFORE UPDATE ON run
BEGIN SELECT RAISE(ABORT, 'append-only: run rows cannot be updated'); END;
CREATE TRIGGER run_no_delete BEFORE DELETE ON run
BEGIN SELECT RAISE(ABORT, 'append-only: run rows cannot be deleted'); END;

CREATE TRIGGER evidence_no_update BEFORE UPDATE ON evidence
BEGIN SELECT RAISE(ABORT, 'append-only: evidence rows cannot be updated'); END;
CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence
BEGIN SELECT RAISE(ABORT, 'append-only: evidence rows cannot be deleted'); END;

CREATE TRIGGER xp_event_no_update BEFORE UPDATE ON xp_event
BEGIN SELECT RAISE(ABORT, 'append-only: xp_event rows cannot be updated'); END;
CREATE TRIGGER xp_event_no_delete BEFORE DELETE ON xp_event
BEGIN SELECT RAISE(ABORT, 'append-only: xp_event rows cannot be deleted'); END;

CREATE TRIGGER review_log_no_update BEFORE UPDATE ON review_log
BEGIN SELECT RAISE(ABORT, 'append-only: review_log rows cannot be updated'); END;
CREATE TRIGGER review_log_no_delete BEFORE DELETE ON review_log
BEGIN SELECT RAISE(ABORT, 'append-only: review_log rows cannot be deleted'); END;
