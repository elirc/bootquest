-- 005_unit_retired: W2b/F2. A pack unit quarantined by seed:validate AFTER it
-- was loaded must be withdrawn, but attempts / runs / XP / evidence rows that
-- reference it are append-only history and must keep their FK target. So the
-- loader RETIRES the unit instead of deleting it: retired_at is the load time
-- (ms) it was withdrawn, NULL = live. Read queries (track lists, next-up,
-- unit detail and every unit-scoped endpoint) only see live units; a unit
-- that leaves the quarantine (fixed upstream, re-imported, re-validated) is
-- un-retired by the next load.
ALTER TABLE unit ADD COLUMN retired_at INTEGER;
CREATE INDEX unit_retired ON unit(retired_at);
