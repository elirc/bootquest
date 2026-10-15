# BootQuest campaign 2: final review (B7)

**Scope:** `git diff 3795a39..3c166f3`: 31 commits, 1,149 files, +197,966 / −587. About 13.5k lines of that are code, tests and tooling. The rest is seed content.
**Mode:** read-only. Nothing in the repo was edited or committed, and `git status` is clean. No servers were left running. Smoke and demos ran with `BOOTQUEST_PORT=4330`.

## Verdict

**Do not release as-is. One blocker.**

The code changes are honest. I found no new server-side leak path. No test assertion was deleted or loosened without a good reason, every stamp is fresh, and every V1 flow (promotion, campaign unlock, sync, runners) still passes its gates.

The blocker is in the content. In 37 of the 80 new study-quest packs, the right answer is very often the longest choice. In 11 of them it is the longest choice every single time. So "always pick the longest choice" passes those quiz gates (80% needed to pass) without reading anything. The campaign's own guard test was written to stop exactly this, but it only checks the 11 act-3 slice-A packs.

## Gates run in this review

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` (all workspaces) | exit 0: shared 84/84 · server 502/502 + self-run 20/20 · tools/seed 181/181 (13 files) · cli 103/103 · client 242/242 (23 files) |
| `npm run restamp:all -- --dry-run` (bash) | **212/212 fresh** (4 code packs + 207 seed packs + 1 campaign map), RESULT OK |
| `npm run seed:check` | **207 ok, 0 failed; 3,796 shipped items re-validated**, RESULT OK |
| `npm run demo:promotion` | ALL 38 STEPS PASSED |
| `npm run demo:campaign` | ALL 25 STEPS PASSED (107 packs; JS 81 + C# 25 gates, loaded === built) |
| `npm run smoke:api` (port 4330) | 57/57 steps passed |
| `npm run seed:lint:answers` | RESULT DEGENERATE: the 3 known V1 packs (csharp-interview, csharp-tut, dotnet-snapshot) key every quiz at choice 0. The server's served choice order hides this (see section 1). |

## 1. Honesty invariants

### Every route walked (`server/src/api/app.ts`)

**Choice order.** This is new: `choice-order.ts` plus migration 009.
- Choices are shuffled with an HMAC under a per-database secret (64 hex characters, made by SQLite's random generator). Triggers stop that secret from being updated or deleted, and the code fails closed if it is missing.
- `GET /units/:id` (single-question quizzes via `servedQuizSpec`, study quests via `studyQuestPublicFor`) serves only the shuffled order.
- `POST /submit` maps the shuffled index back to the stored one (`storedQuizSubmission` / `gradeStudySubmission`).
- `POST /reveal` returns the key as an index in the shuffled frame, plus its text.
- Review cards quote the keyed choice by text, never by position.
- `/run` refuses quiz, predict-output and study-quiz.
- Failure messages never echo the key.

**Can the client turn the order into a key?** No:
- The shuffle is per unit and item, and the secret never leaves the server.
- A reveal discloses only that one unit's key, and the unit is marked "guided" from then on.
- The only position or format signal left is choice *length* (see F1).

**Locked act** (`getUnitDetail`): the response is complete. No check, prose, starter, rubric, study questions, explain-back or kata halves, or refs. All writes still answer 403 `ACT_LOCKED`. `demo:campaign` now asserts the withheld detail.

**Written units** (`rubric`, `model-answer`):
- The leak was real: the generated jstrain rubric quoted the model answer's key point. It is fixed. The rubric is now `null` until the learner's first non-empty answer row exists.
- `GET /model-answer` now also checks `assertTrackOpen`.
- Tested at three levels: API test, smoke on a real jstrain item, and a locked-track test with a raw answer row.

**Retest reveal:**
- `POST /reveal` on a closed changed-example retest now refuses (409 NOT_DUE / RETEST_NOT_OPEN) and writes nothing.
- A retest revealed while it was open still answers.
- `GET /solution` still needs the reveal row.
- `ladder-real` asserts that the G4 retest's reference does not contain G4's hidden solution.

**Explain-back and kata keys:** unchanged, still answer-first. The only addition is a read-only `answered` flag, which uses the same predicate as the key endpoint.

**`uncoveredLegs` / tsc pins:** the `tscFiles` pins stay private. `sync-api` asserts they are absent from the public spec.

**`/stats/*`:** read-only aggregates. No keys, no writes.

**`/refs/:id/content`:** not act-gated. That is V1 behaviour (F8).

### Append-only ledgers

- No trigger was dropped. Migration 009 only adds triggers.
- The new `UPDATE "check"` in `sync/job.ts` runs only when no attempt or run row references that check. The check table was never append-only, and `study-quests.ts` already followed the same "update in place while unreferenced" pattern.

### Immutable answer before key

Unchanged for explain-back and kata, and extended to written-unit rubrics.

### XP

- Payouts are unchanged by check type.
- New: the standalone ladder "study" unit (ww6) pays study-quest XP (50) on its first verified pass. That follows the `study-quiz → study-quest` mapping, but it is reference material that is not in the campaign (F10).

### Stats

- `passRate()` counts a pass only when `verified && mode !== 'guided'`. Guided passes are reported separately as `guidedPasses`, and this is tested end to end through the real reveal route.
- Progress percentages (track `practiceDone` and campaign `coreDone`) still use V1's `passedUnitIds` / `doneUnitIds`, which **do** count guided passes (F9).

## 2. Test changes

No test file was deleted. I diffed every modified `*.test.ts(x)`, `harness.ts`, `sync-helpers.ts`, `campaign-e2e.mjs` and `smoke-api.mjs`:

| Change | Verdict |
|---|---|
| `api.test` / `study-quests.test` / `packs.test` / smoke / campaign-e2e: answers moved from stored indexes to served indexes (`servedQuizAnswer`, `served()`, `servedChoice`); the reveal test now expects the shuffled index plus the same text | **Justified.** The shuffle requires it, and the new helpers look up choices by text and throw rather than guess. |
| `study-quests.test`: `choices toEqual stored order` became "set-equal per question" | **Justified.** Order is shuffled on purpose. Coverage is wider: every question, not just the first. |
| `api.test`: "detail serves rubric before answer" became "rubric null, no rubric text in body" | **Justified and stricter.** The old assertion was the leak itself. |
| `ladder-real`: "every retest pending / `retests: 0`" became "live exactly for variants whose artifact exists", plus G4 hidden-solution checks | **Justified and stricter.** |
| smoke: `counts.retests === 0` became `=== liveRetests` | **Justified.** The http-lab fixture artifact is pre-inserted before boot. |
| `db.test`: schema version 8 became 9, plus a secret-row assertion | **Justified.** |
| `quests.test` (drafts): hand items now `variety 'concept'` / `shape 'hand-authored'` instead of `goal-check` | **Justified.** The labels are now truthful, and a new test covers explicit draft labels. |
| `campaign-e2e`: the locked-act submit uses the oracle's stored keys (the locked detail no longer serves questions) | **Justified.** It is still refused with 403, and the withheld detail is newly asserted. |
| `client/src/test/setup.ts`: `asyncUtilTimeout` raised to 5000 ms; `ui-audit` kata `findBy` raised to 15 s; smoke boot loop changed to a 180 s wall-clock deadline | **Timing only, acceptable.** It hides slowness, not failures. |
| `ui-audit.test.tsx:124` / `:138`: "no key probe on mount" asserted after a fixed 50 ms sleep | **Weak.** A probe fired after 50 ms would go undetected (F13). |
| jstrain `QUARANTINE.md`: 2 items released via a `KEY_CORRECTIONS` overlay | **Justified.** The import gate is not weakened: the corrected tokens must appear in order in freshly captured output, and a stale overlay throws. |

## 3. Fingerprints and stamps

- `restamp:all --dry-run`: 212/212 fresh. `seed:check`: 207/207 ok.
- `fingerprint.ts` now binds the drill-cs grader sources plus the .NET SDK and ref-pack versions for executing generators. That widens what invalidates a stamp, which is the right direction.
- `seed:check` gives each pack its own execution count.
- `seed:validate` prunes stale quarantine entries before validating.
- Six V1 .NET katas (netcalendy, netgum, netslack, netzen, relay-app, tracer-net) changed in place under the **same item key**. Each gained a testable module, a drill-cs test and an extra diff hunk; netgum also gained a corrected line citation (`Program.cs:56→54`, verified against the checkout). The meaning is unchanged, but they are silent in-place rebinds (F11).

## 4. V1 regressions

**None found.**
- Promotion, campaign unlock (both legs: percentage and level), sync (including the new old-table to new-table re-registration, both referenced and unreferenced), and every runner (self-run forgery, drill-cs, node-test-file composite, http, jstrain/-cs) pass in the gates above.
- The node-test-file per-process workspace parent (`tmpdir/bq-ntf-<pid>`) is never removed on a normal exit. Cleanup relies on `sweep:ntf` (F12).

## 5. Content spot-checks (against `.cache/checkouts` at the pinned commit)

**Sample:** 9 of 80 new quest packs (11%), 2–4 quizzes each with their cited lines read in full:
- act-2: andie, organized-dotnet-trello
- act-3 JS: signalpost-swe-bootcamp (A), grok-build-ecommerce (B), master3 (C), ww35 (D)
- act-3 C#: nethris, dotnet-ramp, relay-app

Also 1 of 7 new katas (idempotent-payments-lab, including its xunit/drill-js test), 1 modified kata (netgum), 1 of 2 new G2 briefs (tenant-search-indexer T3), and 1 of 4 new variants (signalpost U02).

**Every keyed answer I checked is supported by its cited span.** For example, nethris `5f368f…` matches `02-CONCEPTS.md:39` word for word, and the tenant-search T3 brief matches `README.md:49` and `tenantSearchStateRepository.ts:66-92`.

**Problems found:**
- **Length tell (F1).** I computed this over all 80 new packs: how often the key is strictly the longest choice.
  - 37/80 are above the guard's own 0.35 limit.
  - These are at 1.00 (key always longest): andie, eliapplybot-extension, jobtrack, jsdrillv2, masterrnative, mobiletagalog, organized-build-gum, organized-dotnet-trello, organized-js-training-jstrain2, jstrain2.3, recipeweb.
  - These are at about 0.9: grokjs-grokbuildjs, organized-app-job-track, jstrain2.2, jstrain3, organized-dotnet-pastebin, unionboot.
  - Others above the limit include master 0.87, recipegen-app 0.78, devdeck/react 0.68, nettodo 0.62, grok-build-ecommerce 0.58, relay-app 0.57, plus about a dozen more between 0.36 and 0.5.
  - The worst offenders are the **phase-A act-2 packs (commit 41b858c)**. Act-3 slice A (the guarded list) sits between 0.07 and 0.27.
- **Generator-artifact explanations (F5).** 30 shipped quizzes have explanations like `"1 (inline list item)"`: ww35 ×8, organized-study-support-desk-crm ×6, organized-experiment-support-hub ×5, zz1 ×5, react ×3, ww4 ×3. The learner sees this text on the back of the review card after a miss.

## 6. Architecture and code quality

- `service.ts` keeps growing: check-table cache, `uncoveredLegsFor`, choice-order mapping, skill-tree prerequisites. The cache and carve-out logic belongs in `sync/`.
- Two JSDoc blocks sit back to back at `service.ts:165`. The first, describing the carve-outs, is detached from its function.
- `uncoveredLegsFor` (catch at `service.ts:246`) swallows every exception silently, which contradicts its own "report LOUDLY" comment.
- The tsconfig pin hashing is duplicated between `runner-node-test-file.ts:41` (`collectProjectFiles`) and `sync/job.ts:423`. One shared verifier would do.
- `getUnitDetail` calls `questUnitUnlocked`, which rebuilds the full `campaignState` on every unit-detail request (and `getUnitDetail` also rebuilds it for `trackCounts`). This is fine at the current size but scales with the number of quests.
- `client/src/api/mock.ts` (+200 lines) re-implements server rules (guided-pass exclusion, written gating). It can drift from the server, so a shared fixture contract test would help.
- `trackForRepo` guesses the track from repo-name prefixes (`/^(net|dotnet|csharp|cs)|-net$/`). That is fragile for standalone study units.
- `quiz-balance.test.ts` hard-codes a list of 11 packs (`GUARDED`). It should cover every pack, with an explicit allow-list of known exceptions.

## Findings

| id | severity | area | file:line | issue | recommended fix |
|---|---|---|---|---|---|
| F1 | **blocker** | content / honesty | `tools/seed/src/drafts/quiz-balance.test.ts:17`; `content/seed/quests/{andie,jobtrack,recipeweb,…}/items.json` | The keyed answer is strictly the longest choice in 37/80 new packs above the 0.35 limit, and in 100% of quizzes in 11 packs (mostly the act-2 phase-A packs from 41b858c). "Pick the longest" passes those 80% core gates, which unlock acts and pay 50 XP. The shuffle hides position, not length. The guard only covers 11 slice-A packs. | Rewrite choices so lengths are balanced in every pack over the limit, then restamp. Make `quiz-balance` iterate **all** `content/seed/quests` packs with an explicit, justified exception list. Also add a length-share report to `seed:lint:answers`. |
| F2 | major | content / honesty | same packs (shortest share) | Some packs also lean on the shortest choice (ankijs 0.42, organized-experiment-support-hub 0.35, organized-study-support-desk-crm 0.33). | Same guard covers both the longest and the shortest tell. |
| F3 | minor | runner honesty | `server/src/runners/node-test-file/index.ts:508` | The U03 tsc type-check step can be switched off by the learner's own `// @ts-nocheck` or `@ts-ignore`. Self-run TS grading has the same gap; no guard exists anywhere. | Refuse or flag these directives in the learner file before running tsc, or list the hole as an uncovered leg. |
| F4 | minor | honesty / design | `server/src/engines/campaign.ts:274` | Explain-back ladder units linked to locked act-2/3 quests are not act-gated. Their key points, readable after a throwaway answer, summarize the same CONCEPTS docs the locked quizzes test. This campaign added 39 such sets. | Decide on purpose: either gate explain-back units whose linked quest's act is locked, or document that they are open on purpose. |
| F5 | minor | content | `content/seed/quests/ww35/items.json` (+5 packs) | 30 quizzes ship explanations like `"1 (inline list item)"`, shown on review-card backs. | Drop or rewrite them in the drafts, restamp, and add a lint for the `^\d+ \(.*item\)$` pattern. |
| F6 | minor | content | `seed:lint:answers` output | 3 V1 packs still key every quiz at choice 0. Not exploitable on screens that use the served order, but still an authoring smell. | Rebalance key positions when those packs are next re-seeded. |
| F7 | minor | code quality | `server/src/api/service.ts:165`, `:246` | Orphan JSDoc block; `uncoveredLegsFor` swallows all errors silently despite the "loud" policy. | Move the cache and carve-out logic to `sync/`. Log once per table version in the catch. |
| F8 | minor | honesty (V1) | `server/src/api/app.ts:379` | `/refs/:id/content` serves any registered markdown ref by id with no act or track gate. The locked detail returns `refs: []`, but the ids can be enumerated. | Gate on the referencing unit's track/act, or accept it as public guide content and document that. |
| F9 | minor | stats consistency | `server/src/engines/stats.ts:213`; `store/queries.ts:101` | Pass rates exclude guided passes, but track and campaign progress (and V1 act unlock) count them, so the Stats page mixes two definitions of "passed". | Show guided completions separately in progress, or document the distinction on the page. Changing the unlock rule is a spec decision. |
| F10 | minor | XP | `server/src/store/ladder.ts:189` | The standalone ww6 study unit pays 50 XP (study-quest rate) for reference material that is not in the campaign. | Confirm against the spec. If not intended, use a reduced amount or 0 for ladder study units. |
| F11 | minor | content identity | `content/seed/patches/{netgum,netslack,…}-katas/items.json` | 6 V1 katas changed diff, context and test under the same item key. That is a silent in-place rebind, which the ladder explicitly avoids for study units. | Accept with a note (the meaning is unchanged), or version the keys when a learner-visible diff changes. |
| F12 | minor | runner hygiene | `server/src/runners/node-test-file/index.ts:473` | The per-process `bq-ntf-<pid>` parent directory is never removed on a normal exit. It builds up until `sweep:ntf` runs. | Remove the empty parent on shutdown, or run the sweep at server start. |
| F13 | minor | tests | `client/src/pages/ui-audit.test.tsx:124` | The "no key probe on mount" assertion runs after a fixed 50 ms sleep, so a later probe would be missed. | Wait for the pane to settle (`waitFor` idle, or flush the mock queue), then assert. |
| F14 | minor | tests | `client/src/test/setup.ts:8` | Global `asyncUtilTimeout` of 5 s (and 15 s in ui-audit) hides render slowness. | Keep it, but track render time, and tighten it again once parallel load is gone. |
| F15 | minor | refactor | `server/src/api/runner-node-test-file.ts:41`, `server/src/sync/job.ts:423` | Duplicated tsconfig-pin hashing and validation. | Extract one shared `verifyTsconfigChain()`. |
| F16 | minor | performance | `server/src/api/service.ts:251` (`getUnitDetail`) | Full `campaignState` is rebuilt per request, more than once. | Memoize per request, or compute the act lock for one unit. |
| F17 | minor | duplication | `client/src/api/mock.ts` | The mock re-implements server honesty rules (guided passes, written gating). | Add a shared contract test that runs mock and server against the same fixtures. |

**Orchestrator action before closing:** fix F1 (and F2): rewrite choices in the 37 flagged packs, extend the guard to every pack, then run `restamp:all` and `seed:check`. The pack files in `content/seed/quests` are pack-only; no fingerprinted file is involved. Then rerun the gate battery. F3–F17 can ship as recorded follow-ups.