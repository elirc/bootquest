-- bootquest:foreign-keys-off
-- 010_drill_java_check: the Java track gets a real code-exercise pack
-- (javabootcamp), graded by the Java runner (server/src/runners/java) through
-- the new check type 'drill-java'.
--
-- SQLite cannot alter a CHECK constraint in place, so this is the documented
-- 12-step table rebuild (https://sqlite.org/lang_altertable.html#otheralter),
-- as in 004: the marker on line 1 makes migrate() run it with foreign_keys OFF
-- (attempt.check_id and run.check_id reference "check") and then require an
-- empty PRAGMA foreign_key_check before committing. Column list, types,
-- defaults, FKs, the table CHECK and the index are unchanged from 001; only the
-- type IN (...) list grows. DROP TABLE drops the two spec-agreement triggers of
-- 003 (#14), so they are re-created verbatim.

CREATE TABLE check_new (
  id              INTEGER PRIMARY KEY,
  unit_id         INTEGER NOT NULL REFERENCES unit(id),
  type            TEXT NOT NULL CHECK (type IN (
                    'drill-js', 'drill-cs', 'drill-java', 'quiz', 'predict-output', 'guided-step',
                    'http', 'repo', 'study-quiz', 'explain-back', 'patch-kata', 'review',
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

INSERT INTO check_new (id, unit_id, type, spec, threshold, inverted, timeout_ms, content_ref_id, created_at)
  SELECT id, unit_id, type, spec, threshold, inverted, timeout_ms, content_ref_id, created_at
    FROM "check";

DROP TABLE "check";
ALTER TABLE check_new RENAME TO "check";

CREATE INDEX check_unit ON "check"(unit_id);

-- 003 #14: check.type / inverted must agree with the spec JSON
CREATE TRIGGER check_spec_type_agrees BEFORE INSERT ON "check"
WHEN json_extract(NEW.spec, '$.type') IS NOT NEW.type
  OR NEW.inverted <> COALESCE(json_extract(NEW.spec, '$.inverted'), 0)
BEGIN SELECT RAISE(ABORT, 'check: type/inverted must match the spec JSON'); END;

CREATE TRIGGER check_spec_type_agrees_update BEFORE UPDATE ON "check"
WHEN json_extract(NEW.spec, '$.type') IS NOT NEW.type
  OR NEW.inverted <> COALESCE(json_extract(NEW.spec, '$.inverted'), 0)
BEGIN SELECT RAISE(ABORT, 'check: type/inverted must match the spec JSON'); END;
