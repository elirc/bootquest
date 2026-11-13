-- 022_learner_setting: the learner's day-shape choices beyond the per-track drill sets (rv wave, stream C;
-- REVIEW Wave 1b row 3, owner decisions D3/D5). Append-only, one row per change, never edited, in the
-- 017 slate_setting style: a day reads, per key, the latest row with effective_day <= that day.
--   primary_language  'js' | 'csharp' | 'java'  the hero's Fundamentals ladder and the slate's Fundamentals
--                                               step (no row = 'js'; the one-time picker writes the first row)
--   campaign_step     'on' | 'off'              the campaign-step slot (no row = off: the Fundamentals step
--                                               replaced it on the default slate)
--   senior_rep        'on' | 'off'              the rotating senior-rep slot (no row = on)
-- The service writes effective_day = tomorrow, except the FIRST primary_language pick, which may take
-- effect today (api/settings-service.ts says when).
CREATE TABLE learner_setting (
  id             INTEGER PRIMARY KEY,
  key            TEXT NOT NULL CHECK (key IN ('primary_language', 'campaign_step', 'senior_rep')),
  value          TEXT NOT NULL CHECK (
                   (key = 'primary_language' AND value IN ('js', 'csharp', 'java')) OR
                   (key IN ('campaign_step', 'senior_rep') AND value IN ('on', 'off'))),
  effective_day  TEXT NOT NULL CHECK (effective_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at     INTEGER NOT NULL
);
CREATE INDEX learner_setting_key_day ON learner_setting(key, effective_day, id);

CREATE TRIGGER learner_setting_no_update BEFORE UPDATE ON learner_setting
BEGIN SELECT RAISE(ABORT, 'append-only: learner_setting rows cannot be updated'); END;
CREATE TRIGGER learner_setting_no_delete BEFORE DELETE ON learner_setting
BEGIN SELECT RAISE(ABORT, 'append-only: learner_setting rows cannot be deleted'); END;
CREATE TRIGGER learner_setting_no_replace BEFORE INSERT ON learner_setting
WHEN EXISTS (SELECT 1 FROM learner_setting WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'append-only: learner_setting rows cannot be replaced'); END;

-- R4-18: the skill tree tables were never written (store/campaign.ts only deleted from skill_node) and the
-- client's Tree view rendered the campaign list payload; both are gone.
DROP TABLE skill_node_prereq;
DROP TABLE skill_node;
