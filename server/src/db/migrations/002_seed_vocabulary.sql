-- 002_seed_vocabulary: tracks (§1), the seven ladder competencies (§6.2),
-- initial ratings (1 each), and the singleton streak row.
-- INSERT OR IGNORE keeps this safe even if run against a partially seeded DB.

INSERT OR IGNORE INTO track (id, name, locked, slate_drills, sort_order) VALUES
  ('js',      'JS/TS + React',          0, 1, 1),
  ('csharp',  'C#/.NET',                0, 1, 2),
  ('java',    'Java',                   1, 0, 3),
  ('agentic', 'Agentic engineering',    0, 0, 4);

INSERT OR IGNORE INTO competency (id, name, sort_order) VALUES
  ('language-fluency',     'Language fluency (JS/TS, C#)',  1),
  ('feature-delivery',     'Feature delivery',              2),
  ('data-http',            'Data & HTTP',                   3),
  ('testing-verification', 'Testing & verification',        4),
  ('agentic-engineering',  'Agentic engineering',           5),
  ('code-reading',         'Code reading & maintenance',    6),
  ('communication',        'Communication',                 7);

INSERT OR IGNORE INTO competency_rating (competency_id, rating, last_evidence_id, updated_at)
  SELECT id, 1, NULL, 0 FROM competency;

INSERT OR IGNORE INTO streak (id, current, longest, tokens, slate_days_banked, last_closed_day, updated_at)
  VALUES (1, 0, 0, 0, 0, NULL, 0);
