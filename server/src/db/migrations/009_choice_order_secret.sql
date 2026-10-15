-- 009_choice_order_secret: campaign 2 (ui-audit #24, HONESTY). Multiple-choice
-- questions used to be served in their AUTHORED order, so a pack whose keys sit
-- at one index (csharp-tut / csharp-interview / dotnet-snapshot key every
-- question at choice 0; BootForge quiz units key ~66% at choice 1) passed its
-- gate on "always pick the same position". The API now serves every choice
-- list in a deterministic per-(unit, item) permutation keyed by this per-DB
-- random secret (server/src/api/choice-order.ts) and maps submitted indexes
-- back to the stored order before grading.
--
-- The secret is generated ONCE, here, by SQLite's CSPRNG, and never changes:
-- a changed secret would reshuffle every question the learner is looking at
-- (and re-key the served frame of every recorded answer), so UPDATE / DELETE
-- / a second row are refused. A reset starts a fresh DB, and with it a fresh
-- secret (nothing to keep stable for).
CREATE TABLE server_secret (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  secret  TEXT NOT NULL CHECK (length(secret) = 64)
);

INSERT INTO server_secret (id, secret) VALUES (1, lower(hex(randomblob(32))));

CREATE TRIGGER server_secret_no_update BEFORE UPDATE ON server_secret
BEGIN
  SELECT RAISE(ABORT, 'server_secret is immutable (it fixes the served choice order)');
END;

CREATE TRIGGER server_secret_no_delete BEFORE DELETE ON server_secret
BEGIN
  SELECT RAISE(ABORT, 'server_secret is immutable (it fixes the served choice order)');
END;
