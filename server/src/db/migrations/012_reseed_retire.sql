-- 012_reseed_retire: one re-seed policy for checks and seeded review cards
-- (store/check-policy.ts holds the policy text every loader references).
--
--  1. "check".retired_at: a check that history references is never rebound. When a
--     re-seed changes the spec a loader wants for a unit, the referenced check is
--     RETIRED (retired_at = load time, ms) and a fresh live check is inserted; attempts
--     and runs keep their FK target AND the exact spec / threshold they were graded by.
--     Live = retired_at IS NULL; every "the unit's check" read filters on it, history
--     reads (attempt.check_id) do not.
--  2. A referenced check's grading frame is frozen in SQL too: once any attempt or run
--     row points at a check, its unit_id / type / spec / threshold / inverted /
--     timeout_ms cannot change (retiring it, or re-pointing content_ref_id, still can).
--  3. review_item.retired_at: a seeded card (quiz-miss:<key> / flashcard:<key>) whose
--     source item a re-seed removed has no text to show; it is retired at startup
--     (never deleted: review_log rows keep their FK target) so it neither shows in the
--     queue nor blocks the slate's review-clear slot. It is un-retired if the item
--     returns. review_item is mutable FSRS state, not part of the append-only ledger.

ALTER TABLE "check" ADD COLUMN retired_at INTEGER;
CREATE INDEX check_unit_live ON "check"(unit_id, retired_at);

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

ALTER TABLE review_item ADD COLUMN retired_at INTEGER;
