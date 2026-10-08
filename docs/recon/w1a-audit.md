# W1a audit: M1 server foundation (commit 0d6df99) vs spec §4/§5/§6/§9/§13

Auditor: fresh-context Opus, read-only. Scope: `server/src/{db,engines,store}`, `shared/`,
`server/test/`, `shared/test/` (`server/src/api/` ignored). Baseline: one foreground `npm test`,
run before the orchestrator said not to, showed the server workspace green (8 files / 96 tests).
After that I only read code, apart from one plain-node probe on an in-memory DB in my scratchpad
to confirm #1. I judged code and test assertions by what they do, never by test names.

## Findings

### 1. BLOCKER: `INSERT OR REPLACE` / `REPLACE INTO` gets past every append-only trigger
- **What**: The triggers are `BEFORE UPDATE` / `BEFORE DELETE` only, and SQLite's REPLACE
  deletes the old row without firing DELETE triggers unless `recursive_triggers` is ON. The probe
  on `001_init.sql`:
  - `INSERT OR REPLACE` overwrote a 20-XP `xp_event` with 999.
  - `REPLACE INTO evidence` turned `{assistance:'reveal', verified:0}` into
    `{assistance:'none', verified:1}`.
  - With `recursive_triggers = ON`, the same statement is blocked.
- **Where**: `server/src/db/migrations/001_init.sql:335-358`; `server/src/db/database.ts:54-56`.
- **Why it matters**: A single statement rewrites the honesty ledger, despite the "triggers, not
  convention" rule. The tests (`server/test/db.test.ts:171-182`) try only UPDATE and DELETE.
- **Fix**:
  - Add a `BEFORE INSERT ... WHEN EXISTS (SELECT 1 FROM <t> WHERE id = NEW.id)` abort trigger on
    all five tables.
  - Add `PRAGMA recursive_triggers = ON` in `Db`.
  - Add a REPLACE case to the trigger tests.

### 2. BLOCKER: every promotion leg is caller-asserted; nothing ties "verified" to a runner verdict
- **What**:
  - `EvidenceInput` (`shared/src/schemas.ts:183-199`) lets the caller set `verified`, `assessor`,
    `kind`, `score`, and (when there is no `attemptId`) `assistance`.
  - `recordEvidence` (`server/src/engines/evidence.ts:49-75`) derives only assistance, and only
    when an attempt is linked. A row of
    `{kind:'artifact', verified:true, assessor:'pipeline', assistance:'none'}` with no `attemptId`
    is accepted and counts as leg (a).
  - The attempt row is itself caller-asserted: `recordAttempt` stores `outcome:'pass'` with no
    `run` row and no verdict (`server/src/engines/attempts.ts:39-56`).
  - The evidence test fixture models a failed retest as `verified:false`
    (`server/test/evidence.test.ts:84`). An attempt with `outcome:'fail'` plus `verified:true`
    would still promote; no test covers it.
- **Why it matters**: §0.3 and §6.2 say "nothing is marked complete without passing its check",
  and BUILD-PLAN says honesty is server-enforced. As written, the truth layer trusts whatever W1b
  or W6 code passes in. That is "honest by convention", which the plan explicitly rejects.
- **Fix**:
  - For kinds `artifact`, `retest`, `explain-back` and `kata`, require `attemptId`. Derive
    `verified` inside `recordEvidence`: true only when a `run` with `kind='submit'`,
    `verdict='pass'` and `attempt_id` = that attempt exists (taking `check.inverted` into
    account), and `attempt.outcome='pass'`. Allow `assessor='pipeline'` only in that case.
  - For explain-back, take `score` from `attempt.score`, and require `attempt.answer IS NOT NULL`
    and `outcome='submitted'` (the immutable answer is stored before the key is shown).
  - Remove `verified` from the public input. Later, derive `attempt.outcome` from the run.

### 3. BLOCKER: the ≥2-day retest gate can be met by back-filling evidence on an old attempt
- **What**: Leg (c) times the retest by `evidence.created_at`, not by when the verified attempt
  or run happened (`server/src/engines/evidence.ts:139-148`). Nothing requires the retest
  evidence's attempt to differ from the artifact's attempt, or the retest unit to differ from the
  artifact unit. Example:
  - Day 0: pass a unit, record an artifact and an explain-back.
  - Day 2: call `recordEvidence({kind:'retest', attemptId: <the day-0 attempt>, …})`.
  - Result: promotion. The "changed example" was never attempted, and nothing was re-done two
    days later.
- **Why it matters**: The delayed changed-example retest is the third leg of the §6.2 honesty
  core and the W6 gate. The `+1 day rejected / +2 days accepted` tests pass only because the
  fixture writes the evidence at the same moment as a new attempt.
- **Fix**: In leg (c), join evidence to its attempt (and run) and time on `attempt.created_at`.
  Require a `kind='retest'` unit whose `variation_of_unit_id` is the artifact's unit, and
  `retest.attempt_id <> artifact.attempt_id`. Reject evidence recorded more than a few minutes
  after its attempt. Add negative tests for the reused-attempt and back-filled cases.

### 4. MAJOR: the three legs are not linked to each other (they are matched by competency only)
- **What**:
  - Leg (a) accepts any unit kind, so a 1-difficulty drill satisfies "CLI-verified project".
  - Leg (b) can come from an unrelated unit.
  - Leg (c) is any retest on the competency ≥48h after the earliest qualifying explain-back. It
    can come before the artifact (explain-back on day 0, retest on day 2, artifact on day 3
    still promotes).
  - The evidence's `competency_id` is never checked against `unit_competency`, so a JS drill can
    be filed under `communication`.
  (`server/src/engines/evidence.ts:120-149`)
- **Why it matters**: The spec says "(b) **its** explain-back" and the retest "passes ≥2 days
  later", i.e. after the artifact and its explain-back. Matching by competency alone was a
  drafting decision (see the decisions section) that weakens the rule.
- **Fix**:
  - Anchor the evaluation on an artifact whose unit kind is in
    {guided-project, http-lab, repo-task, program-unit}.
  - Require the explain-back on the same unit (or its program unit).
  - Require the retest to be a variation of that unit, with
    `created_at ≥ max(artifact, explain-back) + 48h`.
  - In `recordEvidence`, reject `competency ∉ unit_competency(unit)`.

### 5. MAJOR: XP is not tied to verification and can be farmed
- **What**: `awardXp` (`server/src/engines/xp.ts:43-90`) has four gaps:
  1. It never checks that a passing attempt or run exists.
  2. When neither `unitId` nor `attemptId` is given, both the reveal check and once-per-unit are
     skipped, so unlimited `explain-back` (20) or `study-quest` (50) awards are possible.
     `XpAwardInput` makes `unitId` optional for every kind (`shared/src/schemas.ts:126-140`), and
     the streak tests rely on unit-less awards (`server/test/streak.test.ts:63,75-76`).
  3. `difficulty` comes from the caller rather than `unit.difficulty`, so a difficulty-1 drill can
     be claimed at 50 XP.
  4. When both `unitId` and `attemptId` are given and they disagree, the reveal check runs on the
     caller's `unitId`. A guided attempt on a revealed unit then gets paid.
- **Why it matters**: The rules "Revealed solution = 0 XP forever" and "only submit counts" hold
  only if every caller is honest.
- **Fix**: For non-review kinds, require a unit (or attempt) and `attempt.outcome='pass'`
  (`'submitted'` with score ≥ threshold for study-quest and explain-back). Read difficulty from
  `unit`, and assert `attempt.unit_id = unitId`. For defence in depth, add a partial unique index
  `xp_event(unit_id, kind) WHERE amount > 0 AND kind <> 'review'`.

### 6. MAJOR: slate items are self-attested, so the streak and freeze tokens can be farmed
- **What**: `markSlateItem` (`server/src/engines/streak.ts:91-101`) marks `drill:*` and
  `campaign` done when asked. Only the `review` slot is checked against real state. Nothing counts
  the five passing drills per track or a completed campaign step. The tests complete every day
  through `markSlateItem` alone (`server/test/streak.test.ts:16-19`).
- **Why it matters**: The rule "slate day = streak day" and the token economy rest on a button
  press.
- **Fix**: Derive slot completion from the ledger at mark time and at close time:
  - `drill:<track>`: at least 5 distinct units on that track with a passing submit attempt that
    local day.
  - `campaign`: a quest-step completion row that day.
  Then make `isSlateComplete` re-derive instead of reading `done` flags.

### 7. MAJOR: demotion fires on first-exposure "Again", and each Again drops a full notch
- **What**: `review()` demotes on any `again` for a competency-linked item, whatever the card's
  state (`server/src/engines/fsrs.ts:135-137`). A brand-new quiz-miss card graded Again on first
  sight lowers the rating. The test proves this on a new card
  (`server/test/fsrs.test.ts:71-82`). Five Again grades on different linked cards in one session
  take a rating from 5 to 1.
- **Why it matters**: Spec §6.2 says "a failed FSRS **review**". A New or Learning card has not
  been learned yet, so failing it is not a lapse. As written, normal FSRS use (around 10% Again)
  will keep ratings pinned near 1, and the truth layer becomes noise.
- **Fix**:
  - Demote only when the pre-review card state was `State.Review`, i.e. a lapse.
  - Consider at most one demotion per competency per day. This is an owner decision; log it.
  - Add a test that Again on a New card does not demote.

### 8. MAJOR: `competency_rating` can be changed directly, with no evidence behind it
- **What**: `UPDATE competency_rating SET rating = 5` succeeds (confirmed by the probe). Nothing
  ties `rating` to a promotion or demotion evidence row. The tests do exactly this to set up
  state (`server/test/evidence.test.ts:157,257`; `server/test/fsrs.test.ts:72,85`).
- **Why it matters**: §9 says the current rating's history lives in evidence. A rating with no
  matching evidence breaks "last-evidence links" and the "never infer a rating" guarantee.
- **Fix**: Add a `BEFORE UPDATE` trigger that aborts unless `NEW.last_evidence_id` points at a
  promotion or demotion evidence row for the same competency with `rating = NEW.rating`. Change
  the test setup to promote through fixture legs, or write a promotion evidence row first.

### 9. MAJOR: `insertUnit` looks up `content_ref` by `stable_key` alone, which links twin repos to the wrong content
- **What**: `server/src/store/content.ts:79-82` runs
  `SELECT id FROM content_ref WHERE stable_key = ?`. Uniqueness is deliberately per
  `(repo, stable_key)` (`001_init.sql:77`), and the test inserts the same key for `ww12` and
  `organized-experiment-ww12` (`server/test/db.test.ts:253-263`). The lookup then returns
  whichever row comes first.
- **Why it matters**: Estate contract §6 says twins and template families share heading text
  ("60 identical `## Exercise 1`"). Units would silently render the other repo's guide.
- **Fix**: Make `LessonSpec.contentRef` a `{repo, stableKey}` pair (or a repo-namespaced key) and
  look up by both columns. Throw on ambiguity.

### 10–18. MINOR findings (format: what — file:line — fix)
10. **A demotion at rating 1 still resets the promotion window.** `lastRatingChangeAt` counts
    every demotion row, and `demote` writes one even when 1 stays 1 (`server/src/engines/evidence.ts:97-103,224-232`).
    One failed review discards all banked legs with no rating change; together with #7, promotion
    from 1 becomes hard to reach. Fix: exclude rows where `from === to` from the window, or
    record the reset as an owner decision.
11. **Future-dated rows are only partly guarded.** `lastRatingChangeAt` has no `created_at <= now`
    bound (`server/src/engines/evidence.ts:98-101`), so a promotion or demotion row written with
    a forward-skewed clock blocks promotion until that time, and future-dated evidence becomes
    valid later. Fix: add the bound, and make the writers keep the ledger monotonic (reject
    timestamps far from the newest row).
12. **`recordRun` stores `todo` as `fail` when `verdict` is omitted.** `r.verdict ?? (r.pass ? 'pass' : 'fail')`
    (`server/src/store/content.ts:116`). `run.unit_id` and `run.check_id` are not cross-checked
    against the attempt. Fix: when `counts` is present, use `selfRunVerdict(counts)`, and assert
    the attempt's unit matches.
13. **Reviews write evidence only when they demote.** §6.2 says "every submit/review/kata writes
    an evidence row" (`server/src/engines/fsrs.ts:120-159`). Fix: write `kind='review'` evidence
    for competency-linked items, or record in LEARNING.md that `review_log` is the record.
14. **`check.type` and `inverted` are not tied to the spec JSON** for raw inserts (`001_init.sql:133-148`).
    Fix: `CHECK (json_extract(spec,'$.type') = type)`, plus the same for `inverted` on self-run.
15. **`LessonSpec` lacks `phase`, `targetLevel` and `xp`**, so `insertUnit` never fills those
    columns and signalpost units are not lossless at the boundary
    (`shared/src/schemas.ts:55-77`, `server/src/store/content.ts:83-95`). There is also no G2
    delegation-brief unit kind (§8). Fix: add the fields, and add the kind or document that G2
    maps to `explain-back`.
16. **Enum↔SQL sync is only partly tested.** `shared/src/enums.ts:4` cites
    `server/test/schema.test.ts`, which does not exist. Only `CHECK_TYPES` and `XP_KINDS` are
    checked against the SQL (`server/test/db.test.ts:195-214`). Fix: one parametrized test over
    every enum.
17. **Migration bookkeeping.** The applied set is read outside the transaction, so two
    concurrent starters make the second fail loudly (`server/src/db/migrate.ts:39-44`), and
    applied migrations carry no checksum (edits to 001 are silently ignored). Fix: re-check
    inside `tx`, and store and verify a sha256 per migration.
18. **Smaller gaps.**
    - `review()` accepts cards that are not due yet: they reschedule and earn XP within the cap.
    - `composeSlate` marks `review` done if the queue is empty at compose time
      (`server/src/engines/streak.ts:76`).
    - `summary` is limited to 280 characters only in Zod, not SQL. Add a `length()` CHECK so a raw
      insert cannot smuggle curriculum text.
    - The clock grep misses a bare `Date()` call.

## Drafting decisions, judged against the spec

| Decision | Verdict |
|---|---|
| XP pays once per unit per kind; repeats write 0-XP `already-awarded` rows | **Accept.** Consistent with "failed submits cost nothing", and the ledger explains itself. Needs the unit-less bypass closed (#5). |
| 7-slate-day token counter is cumulative, reset only by a broken streak; credit lost at the 2-token cap | **Accept.** The spec does not say "consecutive". Losing credit at the cap is a reasonable reading of "max 2 banked". |
| Partial days keep the streak but do not extend it | **Accept.** "Slate day = streak day" implies only slate days count. |
| Promotion legs must postdate the last promotion/demotion | **Accept**, except that a floor demotion should not reset the window (#10). |
| Leg (a) requires assessor `pipeline` | **Accept.** Matches "CLI-verified". Also needs unit-kind and run linkage (#2, #4). |
| Leg (c) matched by competency, ≥48h after the earliest qualifying explain-back | **Reject.** Too weak: the spec says "*its* explain-back" and a "changed-example retest", so require a variation of the artifact's unit, after both legs, timed on the attempt (#3, #4). |
| Demotion at rating 1 writes an evidence row and stays at 1 | **Accept** the row; the window reset it causes is a side effect (#10). |
| Level curve `floor(150·n^1.6)` = cumulative XP to reach level n+1 | **Accept.** A faithful, documented reading. Boundaries tested at n=1, 2, 5 (150 / 454 / 1969). |
| Timestamps in epoch ms; day keys are local calendar days | **Accept.** Changing timezone shifts day keys; acceptable for a single owner. |
| FSRS fuzz disabled | **Accept.** Needed for deterministic injected-clock gates. The cost is clustering of due dates, which does not matter here. |

## Verdict

The foundation is mechanically solid: §9 schema, parameterized SQL, DB-path guard, clock
injection, pragmas, XP amounts and cap, level curve, streak arithmetic and FSRS wiring all match
the spec. The honesty core, though, is enforced at the wrong layer. REPLACE gets past the
append-only triggers (#1), "verified" and "pass" are caller-supplied flags rather than facts
derived from a run (#2), and the ≥2-day retest can be met by back-filling evidence on an old
attempt (#3). These are latent today because no API exists yet, but they make the plan's
"server-enforced, not convention" rule untrue. Fix #1–#9 before W1b wires endpoints onto
`recordEvidence`, `awardXp` and `markSlateItem`; each fix is small and local to these files.

## Verified clean (coverage)
- **DB setup:** foreign_keys ON, busy_timeout 5000 and WAL in the only constructor, with no other
  `DatabaseSync` in scope. `tx()` uses BEGIN IMMEDIATE with savepoints and rolls back on throw.
- **SQL and paths:** all SQL is parameterized (the only interpolation is the internal savepoint
  name). `BOOTQUEST_DB` with no default path. Tests use mkdtemp DBs only.
- **Migrations:** idempotent re-open; 002 uses INSERT OR IGNORE; numbering gaps are detected.
- **Schema:** every §9 table present; `track` rows are js / csharp / java (locked) / agentic; no
  body-text columns (test-enforced); strict Zod `content_ref`.
- **Estate contract §6:** `content_ref`, `source` and `quest` fields, ticket table, and competency
  aliases all present.
- **Checks and runs:** check types cover §4 plus node-test-file, self-run (tsc / fixtures /
  inverted, legal only on self-run) and vitest-project. `todo` is a distinct verdict, and
  `selfRunVerdict` / `starterMeetsContract` match the jstrain contract.
- **Attempts and reveal:** a CHECK makes mode, assisted and assistance_source agree, and mode is
  always derived. Reveal persists across restarts (derived from attempts). The XP check-and-insert
  runs under BEGIN IMMEDIATE, so it is race-free with a single writer. A reveal is scoped to its
  own unit.
- **XP and level:** amounts exactly as §6.1. The review cap of 30 per local day is correct and
  resets the next day. Level boundaries 150 / 454 / 1969.
- **Streak:** the 20-XP partial boundary, token earn / cap / auto-spend (partial is checked before
  spending a token), break with no token, and idempotent day closing are all correct.
- **FSRS:** ts-fsrs pinned at 5.2.3 with fuzz off; Card JSON round-trips; due dates are monotonic
  by grade; review_log is append-only; the demotion hook fires after commit.
- **Ratings:** one integer per competency, never averaged. Self-assessment evidence does not move
  the rating. Promotion and demotion cannot be written through `EvidenceInput`.
- **Clock discipline:** no `Date.now()` and no argument-less `new Date()` in engines or store.
