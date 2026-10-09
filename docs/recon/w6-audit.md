# W6 audit: competency-ladder wave (91e9be3, repo at 228a7c6) vs spec §0.3/§4/§5/§6.2/§8

Second required honesty audit (fresh context, read-only). Scope: migration 008; engines/ladder.ts,
api/ladder-service.ts, store/seed-items.ts; the submit wiring in api/service.ts;
shared/mutation.ts, cli/mutate.ts; client LadderPanes.tsx; scripts/promotion-e2e.mjs; plus the
evidence.ts/attempts.ts/xp.ts code those files depend on. Fixed W1a items are
not re-reported. They were re-checked, and none was reopened (see "Verified clean").

The only thing executed was one read-only probe: `node` with `node:sqlite` on an in-memory DB,
applying migrations 001–008 the way migrate.ts does (FK-off marker honoured) and comparing
`sqlite_master` triggers before and after 008. The script is in the session scratchpad. No npm
commands were run, and no repo script was run.

## Findings

### 1. MAJOR: the ≥2-day retest delay can be pre-solved with free graded runs (the gate covers `submit` only)
- **What**: `assertRetestOpen` runs only in `submitUnit` (`server/src/api/service.ts:402`).
  `runUnit` (`service.ts:366-375`) grades a retest unit at any time, with no logging; the NOT_DUE
  message even says "free runs stay available" (`engines/ladder.ts:149`).
  - Retest units are open to run, submit and GET-detail before any schedule exists
    (`ladder.ts:145`, `open.length === 0` returns).
  - The gate is skipped whenever an *older*, still-open schedule for the same unit is due
    (`open.some(r => r.due)`).
- **Scenario**: Day 0, right after the explain-back: iterate `POST /units/<retest>/run` until it
  passes and save the code. Day 2: paste the code and submit, which promotes. The 48h rule on
  `attempt.created_at` holds, but the delay measures only the paste, not retention, which defeats
  §6.2(c). Runs write nothing, so the engine cannot see it.
- **Fix**: Refuse `run` (and withhold instructions/starter in GET detail) on `kind='retest'`
  units unless a schedule for that unit is due. Reveal→variation practice units need a
  carve-out. When any open schedule is not yet due, gate on that one, not on `some(due)`.

### 2. MAJOR: the G1 aggregate counts self-flagged *assisted* katas
- **What**: `kataStats` (`server/src/api/ladder-service.ts:365-398`) sums every `kind='kata'`
  evidence row. It has no `e.assistance='none'` / `a.mode='solo'` filter, yet `KataFindingsBody`
  accepts `selfAssisted: true` (`shared/src/api.ts:669`).
- **Scenario**: The learner declares help on every kata, self-scores them all as caught, and
  `/api/stats/katas` reports "G1 gate met". Declared-assisted work then counts toward §8's
  core-skill gate, against §0.3/§6.2.
- **Fix**: Filter out assisted and guided attempts in the G1 query, and report them as a
  separate count. Add a test where an assisted kata does not move `gate.met`.

### 3. MAJOR (latent): answer-before-key is enforced per UNIT, not per question set / kata
- **What**: `firstAnswer` (`ladder-service.ts:105-111`) keys on `unit_id` only. Nothing stops two
  units from referencing the same `questionSetKey` or `kataKey`. The answer stores the item key
  (`ladder-service.ts:190`), but nothing reads it back.
- **Scenario**: Units A and B both use set S. Answer A, read S's key, then answer B with the key
  known. B gets ≥80%, which becomes a leg-(b) explain-back for B's artifact. For katas, the same
  trick inflates G1. This is latent only because no real unit references seed items yet (#4).
- **Fix**: Look up the prior answer by `json_extract(answer,'$.explainBack.questionSetKey')` (and
  `$.kata.kataKey`) across all units. At unit load time, refuse two live units that share an
  item key.

### 4. MAJOR (status / claims): in the real content, no unit can reach leg (b), leg (c) or G1
- **What**: Outside test fixtures, no unit's check spec references a `questionSetKey` or
  `kataKey`. Only `ladder-service.ts` and `seed-items.ts` read them. Also:
  - no unit of kind `retest` exists in `content/packs`, `content/campaign` or the sync output;
  - `content/seed/` has no variants pack.
  The 10 explain-back sets, 6 G2 sets and 21 katas from W5c are loaded but unreachable.
- **Consequence**: On the owner's real DB, no competency can ever be promoted, and the G1 panel
  stays empty. That is honest, because nothing is faked. But "competency ladder end-to-end"
  (91e9be3) and "acts become honestly playable" (228a7c6) hold only for the fixture e2e. That
  matches the BUILD-PLAN W6 gate, but must not be reported as user-facing.
- **Fix**:
  - generate units from the seed items: explain-back units with a prerequisite → their project
    unit, and patch-kata units (1:1 with kataKey, see #3);
  - run `seed:variants` to produce `retest` units;
  - add a smoke assertion that at least one complete artifact → explain-back → retest chain
    exists in the loaded DB.

### 5. MINOR: an explain-back answer is one-shot per unit, and unit prerequisites are not enforced
- **What**: `assertOpen` (`ladder-service.ts:58-63`) checks the track and act locks only; the
  prerequisite lock is display-only. Leg (b) needs the answer to come after the artifact
  (`evidence.ts:291`).
- **Scenarios**:
  - Answer before passing the project, and that pairing is dead for good.
  - After a real demotion (or one promotion), the same explain-back unit can never anchor leg (b)
    again. This is a liveness problem, not an honesty one, because re-answering after seeing the
    key would be dishonest.
- **Fix**: Return 409 on answers until the prerequisite project units have a verified solo pass.
  Provide several question sets per project unit, or rotate sets per window.

### 6. MINOR: revealing the artifact unit's solution does not taint its changed-example retest
- **What**: `deriveMode` checks only `isRevealed` on the unit itself (`engines/attempts.ts:55-59`).
- **Scenario**: Pass the project solo, do the explain-back, reveal the project's reference
  solution, then pass the variation at +2 days. The retest counts as "no assistance flag".
- **Fix (owner decision)**: Treat a post-artifact reveal on any `variation_of` ancestor as
  `reveal` assistance for retest attempts, or at least record it in the observation.

### 7. MINOR: the seed-item loader binds only the items bytes, not the full stamp
- **What**: `readSeedPackItems` (`server/src/store/seed-items.ts:65-80`) checks only
  `itemsSha256`. The tools-side `loadSeedPack` (`tools/seed/src/factory/pack.ts:176-222`) also
  checks source, manifest sha, the seed **fingerprint**, loaded === built counts (§7) and the
  quarantine/review keys. So a pack stamped by an older validator still serves its keys. The
  stamp is unsigned in any case, which is an inherent local-file boundary.
- **Fix**: Reuse the shared verifier on the server, or at least check manifest, counts and
  fingerprint.

### 8. MINOR: key / score drift when a seed item is re-seeded after an answer
- **What**: The key and the self-score use the *current* item (`ladder-service.ts:206, 222, 321`),
  not the version that was answered. Ids are positional (`seed-items.ts:102-103`), so a re-seed
  silently re-labels them. `kataStats` recomputes `round(score × current key length)`
  (`ladder-service.ts:380-383`), so a changed defect count rewrites past G1 totals.
- **Fix**: Store the item's content hash and defect count on the answer attempt. Return 409
  CONTENT_CHANGED on mismatch, and compute G1 from the stored counts.

### 9. MINOR: the public kata payload reveals how many defects are seeded
- **What**: `kataPublic.defectCount` (`seed-items.ts:126`) and the public spec field
  (`shared/src/api.ts:203`) say "there are exactly N defects" before the learner writes findings.
  That is a search hint, and it softens G1 compared with a blind review.
- **Fix**: Owner decision. Drop it from the pre-answer payloads, or document it as deliberate.

### 10. MINOR: mutation evidence is labelled `assessor 'pipeline'`, `verified 1` although its counts are CLI-reported
- **What**: `recordMutationEvidence` (`server/src/engines/ladder.ts:281-292`) re-evaluates floor
  and break and binds the latest verified attempt. But nothing ties the counts to that attempt's
  code (a documented honour boundary), and the evidence browser shows the rows as
  pipeline-verified. Separately, `check.threshold = 0` silently disables the per-file floor
  (`shared/src/mutation.ts:98-100`).
- **Fix**: Add "(counts self-reported by bootquest mutate)" to the observation, or use
  `assessor 'self'`. Put a lower bound on the floor at pack load. It is not a leg (see below), so
  the impact is cosmetic.

### 11. MINOR: the engine's explain-back path does not check that the attempt is an explain-back answer
- **What**: `recordEvidence` kind `explain-back` (`server/src/engines/evidence.ts:144-157`)
  accepts any `submitted` attempt with a caller score. The kata path does check the unit kind.
  The evaluator's "on the artifact unit itself" branch (`evidence.ts:289`) would accept such a
  row. This cannot be reached over HTTP, because only `selfScoreExplainBack` files explain-back.
  It can be reached from raw engine callers.
- **Fix**: Require the `$.explainBack` marker and an explain-back check on the attempt's unit.
  Drop the "unit itself" branch.

### 12. MINOR: test, demo and documentation precision
- (a) The 24h window is tested only at `DAY_MS + 1` (`server/test/api/ladder.test.ts:196`).
  Nothing tests that exactly `DAY_MS` is still open (`evidence.ts:150` uses `>`).
- (b) e2e step "...still does NOT promote (leg (b) missing)" (`promotion-e2e.mjs:223`) asserts
  only "no promotion", not the cause. The fixture does wire it correctly. Assert
  `evaluatePromotion().legs` (artifact set, explainBack null).
- (c) The commit's "raw-SQL-forgery all rejected" overstates what was tested. The e2e covers
  REPLACE, INSERT OR REPLACE and UPDATE (`promotion-e2e.mjs:247-267`). Fresh `INSERT`s of a
  forged attempt + run + evidence on the owner's own unsigned DB still succeed, which is an
  inherent boundary. Say "rewriting/laundering existing rows is rejected".
- (d) 008's header says "indexes are unchanged", but it adds `evidence_attempt`
  (`008_competency_ladder.sql:55`). The index is harmless.
- (e) `ExplainBackCheck.minCoverage` is public, but the server always uses
  `PROMOTION_MIN_COVERAGE` (`ladder-service.ts:163, 231`). The server is stricter, but the UI
  could show the wrong mark.

## Verified clean (and how)

- **008 kept every honesty trigger.**
  - In-memory probe: 23 triggers after 007 and 23 after 008, none lost, none changed after
    whitespace normalisation. `PRAGMA foreign_key_check` is empty, and the FKs into
    `evidence`/`review_item` still resolve.
  - On the migrated DB:
    - REPLACE, UPDATE and DELETE on evidence abort with "append-only";
    - a two-notch promotion insert and a bare `competency_rating` UPDATE abort with "rating
      integrity";
    - `mutation` inserts, and an unknown kind fails the CHECK.
  - Columns, defaults and CHECKs match 001 line for line; only the kind lists grew.
- **Immutable answer first.**
  - Key, defect and quote/cite text exists only in `explainBackKey`/`kataKey`
    (`seed-items.ts:109-137`). Those are called only by `getExplainBackKey`/`getKataKey`, which
    return 403 NOT_ANSWERED unless a marked `submitted` attempt exists.
  - `getUnitDetail` uses only the public projections.
  - Self-score checks NOT_ANSWERED before `assertExactMarks`, so a 400 cannot enumerate key ids.
  - The answer commits in its own `db.tx` on the single synchronous connection before the
    response, so there is no race.
  - `/run` and `/submit` refuse answer-first units (`service.ts:370, 399`).
  - Reveal on these units finds no content solution and returns 404.
  - Client fixtures hold only invented key text. LadderPanes POSTs the answer, then GETs the
    key; its mount-time GET relies on the server's 403.
- **After a demotion**: the key can be re-read (it was already seen). Re-answering returns 403.
  A raw-SQL "fresh answer" is never chosen (`firstAnswer` is `ORDER BY id LIMIT 1`), and the
  original answer is already scored, so the result is 409 ALREADY_SCORED.
- **Self-score is server-derived.** Coverage and catch rate come from per-id marks checked
  against the loaded key: every id marked exactly once, strict enum, strict body. The client
  never sends a percentage. ALREADY_SCORED is keyed on the first answer's attempt id inside the
  tx, and the route id is a validated integer, so unit-key casing or whitespace cannot reach it.
  The 24h window runs on the injected clock in the engine.
- **Promotion legs** (`evidence.ts:260-354`):
  - (a) verified pass with a submit run, solo, unassisted pipeline evidence, project-kind unit
    that declares the competency, inside the window;
  - (b) ≥0.8, unassisted solo `submitted` answer at/after the artifact, linked by unit or
    prerequisite;
  - (c) a different attempt on a `retest` unit, a variation chain to the artifact unit, attempt
    time ≥ max(a, b) + 48h.
  - Raw `recordEvidence(kind:'retest')` skips NOT_DUE but not the 48h rule; the e2e probes this
    at +1 day.
  - `scheduleRetests` cannot be met by an old attempt (RETEST_DONE needs
    `created_at >= due_at`), and the schedule is not a leg.
- **Mutation is not a leg.** `mutation` appears nowhere in `evaluatePromotion`, xp, streak or
  campaign. The server recomputes floor and break. It refuses non-project units, units without a
  verified pass, and non-latest attempts (`ladder.ts:249-264`). An empty or no-score report
  fails.
- **Retest review_items** are excluded from `dueItems`, `dueCount`, `reviewQueue` and
  `dueAsOf`, and `review()` refuses them.
- **Seed loading fails closed.** An unstamped pack or a sha mismatch throws at boot, with no
  catch and no allow-unstamped bypass (`serve.ts:198`), and duplicate keys throw. CRLF
  normalisation changes only bytes outside JSON strings (raw CR/LF is illegal inside them), so
  two files that pass one stamp parse identically.
- **G1 rule**: recorded kata evidence only, no client totals, rate ≥ 0.8 and ≥ 10 defects, which
  matches §8 (caveats #2, #8, #9).
- **promotion-e2e**: all 37 `step()` calls were read.
  - Each PASS is a real boolean over:
    - HTTP status and codes;
    - DB rows (`verified` is a real boolean via `cleanRow`);
    - ledger-count equality for "nothing recorded";
    - promotion and demotion evidence rows.
  - Exit code 0 only if every step passed; a crash sets exit 1.
  - The count matches "ALL 37". The only loosely worded step is #12(b).

## Verdict
No blockers. The ladder wave did not reopen any W1a item: triggers survived, legs stay linked and
timed on attempt time, and answer-first is server-enforced per unit. Four majors remain: free runs
pre-solve the retest; assisted katas count toward G1; answer-first is per unit, not per item; and no
real content reaches legs (b)/(c) or G1. Fix #1–#3 before wiring content (#4), because #3 becomes exploitable the moment two units share
an item.
