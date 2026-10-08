-- 006_github_sync: W4 GitHub curriculum sync (spec §3.2, BUILD-PLAN W4).
--
-- Curriculum TEXT is still never stored: these tables hold pointers, hashes
-- and bookkeeping only. Markdown is served from the per-SHA disk caches.

-- ---------------------------------------------------------------- sync runs

CREATE TABLE sync_run (
  id           INTEGER PRIMARY KEY,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  offline      INTEGER NOT NULL DEFAULT 0 CHECK (offline IN (0, 1)),
  ok           INTEGER CHECK (ok IS NULL OR ok IN (0, 1)),
  report       TEXT CHECK (report IS NULL OR json_valid(report))   -- SyncReport JSON (counts/shas, no curriculum text)
);

-- the last sha each source was synced at (offline fallback + change detection)
ALTER TABLE source ADD COLUMN last_synced_sha TEXT;
ALTER TABLE source ADD COLUMN last_sync_id INTEGER REFERENCES sync_run(id);

CREATE INDEX content_ref_repo_path ON content_ref(repo, path);
CREATE INDEX content_ref_source ON content_ref(source_id);

-- ---------------------------------------------------------------- seed queue

-- New stable_keys detected by a sync, waiting for the next seed session
-- (spec §3.2 "sync detects new guides and queues them"). One row per
-- content_ref ever queued; 'initial' = found by the first sync of its repo,
-- 'new' = absent from every earlier sync of that repo.
CREATE TABLE seed_queue (
  id              INTEGER PRIMARY KEY,
  content_ref_id  INTEGER NOT NULL UNIQUE REFERENCES content_ref(id),
  reason          TEXT NOT NULL CHECK (reason IN ('initial', 'new')),
  sync_id         INTEGER NOT NULL REFERENCES sync_run(id),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'seeded')),
  created_at      INTEGER NOT NULL,
  seeded_at       INTEGER
);
CREATE INDEX seed_queue_status ON seed_queue(status, id);

-- ---------------------------------------------------------------- unit <-> refs

-- A curriculum unit links the refs it renders from: its program.json
-- milestone ('program') and its lesson guide ('guide').
CREATE TABLE unit_ref (
  unit_id         INTEGER NOT NULL REFERENCES unit(id),
  content_ref_id  INTEGER NOT NULL REFERENCES content_ref(id),
  role            TEXT NOT NULL CHECK (role IN ('program', 'guide')),
  PRIMARY KEY (unit_id, role)
);

-- ---------------------------------------------------------------- competency aliases

-- signalpost program.json v2 declares 24 free-text competencies (2 per
-- milestone, 1-2 per ticket). Each maps onto exactly one of the seven ladder
-- competencies (spec §6.2). Decision record: docs/recon (W4 report).
INSERT OR IGNORE INTO competency_alias (alias, competency_id) VALUES
  ('programming fundamentals',              'language-fluency'),
  ('tool fluency',                          'language-fluency'),
  ('typed domain modeling',                 'language-fluency'),
  ('algorithmic reasoning',                 'language-fluency'),
  ('problem decomposition',                 'feature-delivery'),
  ('frontend state modeling',               'feature-delivery'),
  ('accessible interaction',                'feature-delivery'),
  ('feature ownership',                     'feature-delivery'),
  ('failure-aware design',                  'feature-delivery'),
  ('system design judgment',                'feature-delivery'),
  ('sustained engineering ownership',       'feature-delivery'),
  ('HTTP API design',                       'data-http'),
  ('boundary validation',                   'data-http'),
  ('relational data modeling',              'data-http'),
  ('transactional reasoning',               'data-http'),
  ('authorization design',                  'data-http'),
  ('behavioral testing',                    'testing-verification'),
  ('performance investigation',             'testing-verification'),
  ('systematic debugging',                  'code-reading'),
  ('maintainability and review',            'code-reading'),
  ('operational diagnosis',                 'code-reading'),
  ('collaborative delivery',                'communication'),
  ('risk and scope management',             'communication'),
  ('technical communication and mentoring', 'communication');
