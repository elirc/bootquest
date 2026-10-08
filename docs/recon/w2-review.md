# W2 fresh-context review: BootForge import, content loader, seed:validate

Reviewer: fresh-context Opus, read-only (no npm). Scope: working tree vs c762032.
Ground truth: bootquest-final-prompt.md §3.1, §5, §6.2, §7; opusboot2/content/build/*.json.
At review time `.seed-journal/bootforge.jsonl` held 136 entries, all js-fundamentals,
all `pass`. There is no `quarantine.json`, so 2,435 of 2,571 units are not validated yet.

## Verdict

- **Mapping fidelity: CLEAN.** I compared all 2,571 exercises field by field, not just a sample.
  The only differences are 3 intentional ones (F6).
- **Blockers: 1** (F1). **Majors: 2** (F2, F3). Minors: 6. The validator does use the server's
  real grader path, and the migration and leak surfaces are clean.

## Findings

### F1. BLOCKER: the loader cannot tell a validated pack from one never validated
- **What:** `readPack` treats a missing `quarantine.json` as "nothing quarantined" (packs.ts:84-90).
  `seed:validate` deletes that file when a run is clean (validate.ts:395-398). So
  "validated, 0 failures" and "never validated" look the same on disk. Nothing ties a pack to a
  completed `seed:validate` run (no stamp, no hash, no count check).
- **Scenario:** This is the state of the tree right now: 136 of 2,571 units are journaled and there
  is no quarantine file. `npm run serve` defaults `BOOTQUEST_PACKS` to every dir under
  content/packs (serve.ts:176). It would load all 2,571 units, including any whose reference
  solution fails, into the owner's real DB. The same thing happens after any re-import: the new
  bytes are not validated, but the old quarantine (or no quarantine file) is trusted. §3.1 says
  failures are "never shipped", and that guarantee currently depends on operators running steps
  in the right order.
- **Fix:**
  - On an OK full run, have seed:validate write `validation.json` containing
    `{manifestSha256, graderFingerprint, counts, quarantinedKeys}`.
  - `readPack` should refuse a pack with no stamp, or whose stamp's manifest sha differs from the
    current manifest. Allow `BOOTQUEST_ALLOW_UNVALIDATED=1` for tests and smoke runs only.
  - Keep `quarantine.json` even when it is empty (`entries: []`) so a missing file is an error.

### F2. MAJOR: quarantining a unit after it was loaded does not withdraw it
- **What:** Quarantined keys are skipped on upsert (packs.ts:261-264). The loaded===built count
  then filters them out of the DB rows (packs.ts:296 `live = rows.filter(!quarantined)`), so a
  row that is already in the DB is hidden from the check, not removed.
- **Scenario:** The server loads the pack before the sweep finishes (see F1). Later seed:validate
  quarantines unit X and the server restarts. X stays in `unit` together with its `check` row.
  It is listed on the track, can be submitted, and is graded by its broken tests. It now has no
  content entry, so it has no instructions and reveal returns 404.
- **Test gap:** packs.test.ts:214 only covers quarantine *before* the first load.
- **Fix:** If a quarantined key already exists in the DB, either refuse to start (loaded !== built
  because of a stale live unit) or mark it retired (a `unit.retired_at` column or a
  `unit_quarantine` table) and filter it out of list, run and submit. Add the
  load → quarantine → reload test.

### F3. MAJOR: vacuous checks pass the gate and ship (both reported cases confirmed)
- **What:** The "starter must FAIL" rule only applies to exercises with a `format` field
  (validate.ts:119-122). Plain code drills whose starter already passes are graded `pass`.
- **Confirmed by reading the pack entries:**
  - `ts-basics/.../ts-fix-annotations`: the starter declares `qty: string` and returns a string
    from a function typed `number`. esbuild strips types without checking them, so at runtime
    `'mug', 3, 450` gives `'mug: $13.50'`. All 3 tests pass on the unmodified starter.
  - `react-state/.../fetch-unknown`: the only test is the `default: return state` path, which the
    starter already has. The starter passes.
- **Scenario:** The learner submits the untouched starter, gets a `pass`, +10×difficulty XP, and
  an evidence row. That is an honesty hole (§0), and §3.1 says broken checks are quarantined.
- **Fix:** Run starter-must-fail on every code drill. Quarantine any drill whose starter passes,
  with the reason "vacuous check: starter passes". The two known cases are 2/2,565 executable
  units, well under the 1% ceiling. Do not add a test to make them pass "properly"; fix upstream.

### F4. MINOR: a forged journal makes units count as validated without being run
- **What:** The hash is `sha256(JSON{u,c,g})`, and every input is public (validate.ts:57-59).
  Reuse only requires that the hash matches (validate.ts:300-303), and the final no-`--course`
  run executes nothing.
- **Scenario:** A seeding session (or a script) appends `verdict:"pass"` lines with correctly
  computed hashes. The full run then reports OK with zero executions. Forged `carve-out`
  verdicts are caught by validate.ts:351, but forged `pass` verdicts are not.
- **Fix:** For the gating run (the full sweep that writes the F1 stamp), re-execute a random
  sample of journaled passes (for example 5%, minimum 1 per course) and fail if any disagree.
  Alternatively, record a digest of each runner output in the journal and re-check sampled ones.

### F5. MINOR: the grader fingerprint misses toolchain inputs
- **What:** The fingerprint covers grade-core.mjs, index.ts, runners.ts and validate.ts
  (validate.ts:41-46). It does not cover the esbuild version (server/package.json pins 0.24.2),
  `process.version` (node:sqlite behaviour), or `language.ts`.
- **Scenario:** Upgrading esbuild or Node changes how code is transpiled or run, but old journal
  verdicts stay valid.
- **Fix:** Add `esbuild.version` and `process.version` to the fingerprint.

### F6. MINOR: `reviewOf` changes meaning when mapped to a hard prerequisite
- **What:** import.ts:121-128. Upstream, `reviewOf` is a ranking hint for scheduling a spaced
  review (opusboot2 server/learning.ts:28, score +100). It does not lock anything.
- **Effect:** 3 of the 6 reviewOf exercises (the code ones) now lock behind their originals. The
  3 that point at `written` originals get no edge (written units can't be passed). These are the
  only 3 differences my fidelity script found.
- **Better fit:** BootQuest already has the concept: `unit.variation_of_unit_id` (a changed-example
  variant). Map `reviewOf` there instead of a prerequisite, or record the decision in LEARNING.md.

### F7. MINOR: a misspelled `BOOTQUEST_PACK_COURSES` value silently loads nothing
- **What:** serve.ts:125 filters the requested course ids by `packHasCourse` *before* calling
  `readPack`. A misspelled id is dropped. If every id is misspelled, `readPack(dir,{courses:[]})`
  loads zero courses and 0 === 0 passes the count check.
- **Fix:** After looping over all packs, error on any requested id that no pack provided.

### F8. MINOR: a malformed quarantine.json is silently reset on a `--course` run
- **What:** validate.ts:387-393 `catch { kept = [] }`. A corrupt or merge-conflicted
  quarantine.json causes a `--course X` run to rewrite the file with only X's entries. Every other
  course's quarantined units are then un-quarantined and ship.
- **Note:** The loader (packs.ts:87) does throw on a malformed file, so only the validator is
  lenient.
- **Fix:** Push a problem and refuse to rewrite the file; never drop entries silently.

### F9. MINOR: written units are inert and their model answer can never be reached
- **What:** Reveal and solution go through `requireCheck`, which returns 409 NO_CHECK
  (service.ts:65-67, 329). A written unit has no check, so its `solution` (the model answer) is
  unreachable. It also has no submit or self-assess path.
- **Scope:** These are the 6 engineering-practice units (pr-review, incident, project). The
  carve-out count is honest, but the content is dead.
- **Fix:** Add a written-unit flow: answer first, stored immutably, then reveal the model answer
  and self-score against the rubric (the same pattern as explain-back). Or document this as a
  deferred task (W4/W5).

### Informational (no action needed for W2)
- **i1.** Vite dev server: `server.fs.allow` defaults to the workspace root, so
  `/@fs/<repo>/content/packs/bootforge/*.json` (which contains solutions) is fetchable from
  localhost:5173 in dev. Setting `fs.deny: ['**/content/packs/**']` costs nothing. The production
  Express app serves no static files from content/, and the client does not import the packs.
- **i2.** Drill test *names* are public and often include the expected value
  (`fetchReducer(...) → {"status":"loading"}`). BootForge does the same, and test code and
  `input` stay private. Predict-output snippets are public by nature, so a learner can run them.
- **i3.** The manifest records `dirty: true`, so the import is not reproducible from `gitHead`
  alone. Consider recording the sha256 of each upstream file in `importedFrom`.
- **i4.** The 1% ceiling is computed over the run's scope. A `--course engineering-practice` run
  (6 executable units) fails on one quarantine (16%) even if the full sweep would be under 1%.
  This is conservative; just be aware that per-course exit 1 is not fatal by itself.
- **i5.** BootForge difficulty 1-3 is stored as-is on BootQuest's 1-5 scale. XP is 10×difficulty
  (spec), so BootForge drills top out at 30.
- **i6.** The census is 2,571 / 16 courses, not §3.1's 2,559 / 15. This was reconciled in R1 and is
  enforced by both the importer and the validator (import.ts:43, import.test.ts:177).

## Areas verified clean (and how)

1. **Mapping fidelity, all 2,571 exercises across all 16 courses.** I wrote a scratchpad node
   script that walks every upstream module, lesson and exercise in order and checks each against
   the pack. Per exercise it compares:
   - unit key, upstream position/order (pack array index === upstream index), module, lesson
   - title, difficulty, xp, prompt → instructions, explanation, hints, skills, format, reviewOf
   - code: language, starter, solution, tests (deep-equal including `input` on 1,078 drills; same
     count)
   - quiz: options → choices, answerIndex → answerKey; no solution or starter leaked into content
   - output: code → snippet, expected (exact bytes); upstream has no `language`
   - written: solution, rubric, starter; no check
   - per course: course title, description and order; module and lesson ids, titles and
     explanations

   Result: 0 drops, 0 truncations, 0 changes to test code or solutions. The only differences are
   the 3 intentional reviewOf→written cases in F6. Upstream keys are a closed set: the strict Zod
   schemas in source.ts reject any unknown field, so a new upstream field would fail the import
   rather than be dropped. Spot checks: sql-data drills are JS modules whose tests open
   `node:sqlite` (146 drills); TS-course outputs are detected as `ts` (36), all others `js`.
2. **Same grader path as submit.** `realValidator` calls `drillJsRunner` (validate.ts:110). That is
   the function `defaultRunners()` registers, and submit reaches it through `grade()`
   (service.ts:153-160). Quiz and predict use the same `gradeDeterministic`. The spec comes from
   the parsed pack, and the server reads it from the DB after `CheckSpec.parse` + a JSON round
   trip, which gives the same JSON. Upstream predict grading also uses `normalizeOutput` equality
   (opusboot2 server/index.ts:202), so `normalize:true` is faithful.
3. **Planted-bad test is real.** It spawns the actual CLI with the real validator (no stub) on a
   pack built by the real importer, and a twin test proves the corrected pack exits 0
   (validate.test.ts:153-200).
4. **Hash gaps and typos.**
   - Edited bytes invalidate journal entries, because the hash covers unit + content + fingerprint.
   - A `--course` typo reports "unknown course" and fails.
   - A course file missing, sha-mismatched or failing the schema is reported as a problem.
   - When the importer, pack and validated counts disagree, or the full run differs from the
     census, the run fails.
   - Ceiling denominator = code+quiz+output in scope (validate.ts:366), which is correct.
5. **Leaks.**
   - Unit detail returns only `instructions`, `starter`, `snippet` and `rubric` (service.ts:143-147).
   - `UnitDetailResponse` is `.strict()`.
   - `toPublicCheck` projects quiz to type/itemKey/grading/choices and predict to
     type/language/normalize, and drill tests to `name` only.
   - Run on quiz/predict returns 409; submit failures for them are generic with no echo
     (runners.ts:83-93); the runner drops `input`.
   - Nothing serves content/ statically, apart from the dev-only i1.
6. **Loader.** Upsert is keyed on the unique key plus a source-ownership check. Changes to kind,
   track or check type are refused, and so are DB check rows a pack doesn't have. The second load
   was tested as a no-op. A count mismatch throws inside `db.tx` (rollback), and serve.ts exits 1.
7. **Migration 004.** I compared it column by column with 001's `unit` (types, CHECKs, FKs, and
   the self-FK on `variation_of_unit_id`): only `'written'` is added. Indexes `unit_track` and
   `unit_variation_of` are recreated, plus a new `unit_source`. I grepped 001/003: no triggers or
   views reference `unit`. The append-only triggers live on attempt, run, evidence, xp_event and
   review_log, which are not dropped. `foreign_key_check` must come back empty before commit.
8. **FK-off marker.** It must be the exact first line, and only applies to migrations not yet
   applied. It is set outside the tx, `finally` turns FKs back ON, and already-applied migrations
   never take that path. Called inside an outer tx, the pragma is a no-op and DROP fails safely
   with FKs on.
9. **Competency map vs §6.2.** All ids exist in the 7-row enum. JS/TS/React → language-fluency.
   HTTP, Express and SQL → data-http. React and full-stack → feature-delivery. Engineering-practice
   is mapped by format: debugging/incident → code-reading (+communication for incident), pr-review
   → code-reading+communication, test-writing → testing-verification, schema-migration →
   data-http, project → feature-delivery. agentic-engineering is correctly unused. An
   engineering-practice exercise without a format throws. Reasonable; I found no mismaps.
10. **Existing tests not weakened.** db.test.ts only bumps the schema version 3→4. The api.test.ts
    changes add deep-whitelist assertions.
