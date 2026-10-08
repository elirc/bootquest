-- 006_campaign: W5b campaign map (spec §3.3). Columns the campaign loader
-- (server/src/store/campaign.ts) needs on top of the M1 campaign_act / quest
-- tables. All additive (ALTER TABLE ADD COLUMN); no rebuild.
--
--   quest.key              stable seed key 'campaign/<track>/<repo>' (upsert identity;
--                          a repo may move between acts across re-seeds)
--   quest.quest_kind       'study-quest' (core, quiz gate pending) | 'reading' (skim: one
--                          self-attested reading step, non-core)
--   quest.ordinal          position inside the act (INDEX rank order)
--   quest.content_pending  1 = the quest's quiz gate has not been seeded (seed:quests)
--   quest.title / twin_repo / provenance (assess jsonl file + line, JSON)
--   campaign_act.theme     the spec's act theme line

ALTER TABLE quest ADD COLUMN key TEXT;
ALTER TABLE quest ADD COLUMN quest_kind TEXT CHECK (quest_kind IS NULL OR quest_kind IN ('study-quest', 'reading'));
ALTER TABLE quest ADD COLUMN ordinal INTEGER;
ALTER TABLE quest ADD COLUMN content_pending INTEGER NOT NULL DEFAULT 0 CHECK (content_pending IN (0, 1));
ALTER TABLE quest ADD COLUMN title TEXT;
ALTER TABLE quest ADD COLUMN twin_repo TEXT;
ALTER TABLE quest ADD COLUMN provenance TEXT CHECK (provenance IS NULL OR json_valid(provenance));
CREATE UNIQUE INDEX quest_key ON quest(key) WHERE key IS NOT NULL;
CREATE INDEX quest_unit ON quest(unit_id);

ALTER TABLE campaign_act ADD COLUMN theme TEXT;
