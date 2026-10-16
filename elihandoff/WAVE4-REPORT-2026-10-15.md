# BootQuest wave 4 report: every study quest gets a quest pack (2026-10-15)

Written by the crash-recovery orchestrator session (Claude Opus 5.5) on 2026-10-15.
It covers the whole of wave 4: the original session's writers and reviewers, and the recovery
session that finished the work after the original orchestrator crashed.

## TL;DR

- **Built:** 61 new study-quest packs, each with stamped Learn-more notes.
- **Totals:** BootQuest now has **192 quest packs**, **2,509 quizzes**, **719 flashcards**,
  **581 `before` readings** and **2,509 `after` explanations** (one per quiz).
- **Coverage:** every study quest on both tracks has a pack except three JS quests left out on
  purpose:
  - perch and skillforgejs are excluded in `tools/seed/exclusions.json`.
  - Opusboot1 is byte-identical to devpractice.
- **Loader:** builds **JS 143 + C# 48** study-quest gates, up from JS 97 + C# 33.
- **Review:** every answer key was re-verified by a different agent than its writer.
- **New leak class:** an auto-generated quiz stating a hand-written quiz's answer in the same
  pack. Found during review, then swept from the 20 older packs that mix both kinds. 19 of them
  had it, and 84 hand quizzes were replaced and then re-reviewed.
- **Gates:** all green on branch `wave4` (head `9966988` before this report's commit).
- **Not yet done:** `main` still points at `846c224`. Fast-forwarding it was blocked by Claude
  Code's auto-mode safety rule on shared resources, so the owner has to run it. See "How to land".

## How to land

```
cd C:\Users\Owner\Desktop\selfboot
git status                       # must be clean, main at 846c224
git fetch ../bq-honesty wave4
git merge --ff-only FETCH_HEAD
```

`wave4` descends directly from `846c224`, so this is a pure fast-forward: no merge commit and no
conflicts. This report file arrives on `main` with it.

## Where the work lives

| Thing | Location |
|---|---|
| Integration branch | `Desktop\bq-honesty`, branch `wave4` |
| Writer clones (scratch) | `Desktop\bq-act2a` (W4-A), `bq-act2b` (W4-B), `bq-act3cs` (W4-C), `bq-act3d` (W4-D), `bq-stats` (W4-E), `bq-tree` (W4-F), `bq-ui` (W4-G) |
| Review branches | rv-a .. rv-g, rv-x, xleak (each in one of the clones above) |
| Writer / reviewer briefs | `%TEMP%\claude\C--Users-Owner-Desktop-selfboot\baa0bfee-94e2-4536-b874-68796572e444\scratchpad\PACK-BRIEF.md` and `REVIEW-BRIEF.md` |
| Runbook + backlog | `docs/SEEDING.md` (new bullets "Wave 4" and "OPEN, minor (xleak)") |
| Lessons | `LEARNING.md` section "2026-10-15 — Wave 4" |

The `Desktop\bq-*` clones are scratch and can be deleted once `main` is fast-forwarded.

## Timeline

1. **Original session:** the owner asked "do the other 64 quests too". Three were skipped up front
   (perch, skillforgejs, Opusboot1). The other 61 were split across seven Opus writers, five on JS
   and two on C#. Memory was tight (about 3 GB free), so agents ran light gates only, with no forks
   and no dev servers.
2. **Original session, stage 2:** each writer's packs were cross-reviewed by a different agent.
   Reviews rv-a, rv-b, rv-c, rv-d, rv-f and rv-g were merged into `wave4` (head `c91dcfb`).
3. **Original session, xleak:** reviewers found that generator goal-check and finding quizzes could
   give away hand-quiz answers. A sweep of the 20 older mixed packs started and finished 2 of them
   (buildsubbox, devdeck). Then **the orchestrator crashed.** At that point rv-e had not started
   (one stray cite edit on disk) and xleak was 2 of 20 done.
4. **Recovery session** (this report):
   - Rebuilt the state from branch tips, the memory notes and the last messages of the prior
     transcript.
   - Relaunched rv-e and the remaining 18 xleak packs in parallel.
   - Merged both, then launched rv-x to cross-review xleak's new questions, and merged that.
   - Re-summed the hard-coded counts, wrote the docs, and ran the full gate battery.
   - Deliberately did **not** merge bq-ui `w4-g` `95764ce`. It is a writer's late duplicate fix of
     nopsolutionsnet; reviewer rv-g's version (`50882f0`) of the same fix was already merged.

## The 61 new packs, by writer and reviewer

| Writer | Track | Packs | Reviewer |
|---|---|---|---|
| W4-A | JS | 3buildagenthelpdesk, 3buildagentteaching, organized-build-agentteaching, organized-build-scedulingpyjs, organized-grav-vg-vg, organized-grav-vg-vgdemo, organized-study-globalwork-eor-platform, e20, master1 | rv-a |
| W4-B | JS | forgeai, grok-build-multitenant, organized-anti-testbuild, organized-experiment-temporal-lite-orchestrator, organized-experiment-ww10, organized-experiment-ww43, organized-study-enterprise-billing-platform, organized-study-enterprise-lms-certification-platform, ww7 | rv-b |
| W4-C | JS | astraspacegameweb, bazaar, helios-interplanetary, masteridur, opusorganize, organized-js-training-reactbullet, organized-study-idurar-erp-crm, organized-study-linkwarden, reactbullet | rv-c |
| W4-D | JS | mastermorphic, masternext, masterumami, organized-js-training-jstrain5, organized-study-cal-com, organized-study-dub-monorepo, organized-study-morphic, organized-study-nextcrm-app, organized-study-umami | rv-d |
| W4-E | JS | masteroutline-outline, organized-study-hoppscotch-app, organized-study-dify, organized-study-gitroom, masteropen, openstatus, organized-study-openstatus, mastertwenty, organized-study-twenty, organized-study-formbricks | rv-e (recovery session) |
| W4-F | C# | atlas-swe-bootcamp, dotnet-ai-rag, dotnet-drop, dotnet-intercom, dotnet-stripe, netvg, organized-dotnet-calendy, organized-dotnet-slack | rv-f |
| W4-G | C# | agora-net, bazaar-app, buildsql, netarchitectureproject, netopen1, nopsolutionsnet, pulse-net | rv-g |

Every pack has about 12-13 quizzes and 3-4 flashcards. Every notes pack has 3-4 readings and one
explanation per quiz.

## What the reviews found and fixed

### rv-a (W4-A)

- All 110 hand quizzes re-checked against the cited code; no key changed.
- Replaced one defensible distractor (globalwork q07).
- Rewrote readings that stated or quoted a deciding fact: helpdesk, scedulingpyjs, e20, teaching,
  vg-vg, globalwork.
- Corrected two explanation lines.

### rv-b (W4-B)

- ww7: the r02 excerpt quoted the q12 key.
- ww43: softened an overstated session-cleanup claim.
- lms-certification: replaced q10 and q12, whose keys the generator goal-check choices printed.
- billing-platform: moved q01 off the design doc's example numbers.

### rv-c (W4-C)

- Cross-author key check and a leak pass over all nine packs (one commit).

### rv-d (W4-D)

- Leak and key fixes in cal-com, jstrain5, nextcrm, dub-monorepo, umami.
- Removed excerpts that stated verdicts (masternext, morphic).

### rv-e (W4-E, recovery session)

- **Checked:** 120 quizzes; **0 keys wrong**.
- **Code over guides:** the writer flagged six keys that follow the code where a guide says
  otherwise. All six hold at the pinned shas:
  - hoppscotch retry wrapping
  - dify `tag_ids`
  - openstatus `getScheduledTime` returns seconds
  - SMS quota uses `>`
  - SSRF check does no DNS resolution
  - outline cancan return value
- **gitroom q04:** the prompt now targets the login JWT. Its after-note falsely said role changes
  wait for a new token, but the middleware reloads roles on every request, so that was fixed.
- **gitroom q09:** an explanation said the upload pipe "never rewrites files", which is false.
- **mastertwenty q05:** a defensible `search_path` distractor; the prompt is now scoped.
- **formbricks q09:** a key-format tell, reworded.
- **Other fixes:** 7 explanation and after-note fixes in total, 13 leaking reading passages in 11
  readings, and 1 excerpt replaced.
- Kept the crashed reviewer's dify q11 cite fix (line 162 → 163), which was correct.

### rv-f (W4-F)

- dotnet-ai-rag: three hand quizzes were given away by generator goal-checks; rewrote them.
- Fixed one sealed-answer cite (no quiz may cite a repo's answer or solution files).
- Leak pass and explanation fixes.

### rv-g (W4-G)

- nopsolutionsnet: three hand quizzes were given away by generator checks; replaced them.
- netarchitectureproject: stopped citing the SOLUTIONS files.
- buildsql: replaced the options-cache quiz.
- agora-net and bazaar-app: pinned down the order-number race.
- netopen1: two explanation lines made literally true.

## xleak: the generator-gives-away-hand-quiz sweep

**The problem.** The answer-tell guards (quiz-balance, blind-pass) and the reading leak rule never
compare one quiz's text with another quiz's answer. Auto-generated goal-check quizzes print things
like "prove GetByIdAsync returns soft-deleted rows", which can state a hand quiz's answer in the
same pack.

**The sweep.** It covered the 20 older packs on `main` that mix generator and hand quizzes. For
each leak, the hand quiz got a new question on the same cited material, with the item id kept so
notes targets survive. Each new key was verified at the pinned sha, and its after-note rewritten.

| Pack | Leaked hand quizzes replaced |
|---|---|
| buildsubbox | 5 |
| devdeck | 5 |
| gitjira | 12 (all) |
| master | 4 |
| master3 | 6 |
| nethris | 3 |
| netpastebin | 3 |
| organized-experiment-idempotent-payments-lab | 4 |
| organized-experiment-support-hub | 4 |
| organized-experiment-ww45 | 2 |
| organized-study-atlas-fulfillment | 4 |
| organized-study-support-desk-crm | 2 |
| react | 7 |
| recipegen-app | 2 |
| recipeview | 3 |
| relay-upskilling | 2 |
| w22 | 2 |
| ww35 | 9 |
| zz1 | 5 |
| ww4 | clean |
| **Total** | **84** |

**Typical new questions:**
- Which guard fires first.
- Exact status codes, such as 409 vs 412 vs 428.
- Boundaries, such as "exactly at the reorder point is low", a 91-day query, or 0 ms.
- Framework defaults.

### rv-x: review of the 84 new questions

- **0 keys wrong.**
- **22 distractors replaced:**
  - Several new quizzes keyed the only choice quoting an error message, or the only unquoted
    choice.
  - Some distractors were ruled out by other quizzes or flashcards in the same pack: master3 SLA
    boundaries, w22, support-desk-crm, ww35 flashcards f01, f02 and f04.
- **3 keys** reworded with no change of meaning.
- **2 prompts** changed:
  - recipegen q11, which was given away by a goal-check.
  - zz1 q09, which now says the JWT names the membership, because without it the answer differs.
- **1 flashcard back** rewritten (ww35 f02).
- **8 readings and 4 excerpts** fixed: devdeck, gitjira r03 (the flagged borderline does leak),
  master3, nethris, netpastebin, ww45, atlas.

## Code and doc changes (non-content)

- `server/scripts/campaign-e2e.mjs`:
  - 131 → **192** packs, and 130 of 131 → **191 of 192** for the Part B withheld-pack step.
  - Loader gates JS 97 + C# 33 → **JS 143 + C# 48**. The step failed until this was re-summed:
    the parallel merges hid the count drift, the same lesson as wave 3.
- `docs/SEEDING.md`:
  - New "Wave 4" DONE bullet, and the wave-3 "content-pending" line marked closed.
  - New "OPEN, minor (xleak)" bullet.
  - The payments-lab upstream bug added to the upstream-bugs list.
- `LEARNING.md`: a new "Wave 4" section covering crash recovery, the quiz-to-quiz leak class,
  duplicate fixes and count re-summing.

## Gates: all green on wave4 after the final merge

| Gate | Result |
|---|---|
| `npm test` (all workspaces) | exit 0. shared 84, server 540, cli 20, client 219, 103, tools/seed 1763 passed (+2 skipped) |
| `npm run typecheck` | clean |
| `npm run build:client` | built |
| `npm run smoke:api` | 62/62 |
| `npm run demo:campaign` | 25/25 |
| `npm run demo:promotion` | 38/38 |
| `npm run test:csharp` | 24/24 |
| `npm run demo:m4` | all checks passed |
| `npm run seed:demo:planted` | 28/28 |
| `npm run test:mutate-fixture` | 10/10 |
| `npm run seed:check` | 484/484 packs ok, 10,021 items re-validated (run in a clone, it needs `-- --checkouts C:/Users/Owner/Desktop/selfboot/.cache/checkouts`) |
| `npm run seed:lint:answers` | RESULT OK, 192 packs |

**One run had an error, not a test failure.** The first `npm test` ran while a review agent was
also running tests. It hit `[vitest-worker]: Timeout calling "onTaskUpdate"` even though every
test passed. This is the known load artifact recorded in LEARNING.md. The re-run on a quiet
machine exited 0.

## Open items for the owner

1. **Fast-forward `main`** (see "How to land").
2. **Upstream bug** in source repo organized-experiment-idempotent-payments-lab:
   - `src/lib/auth/guards.ts:10` imports `RouteError` from `../api/route-helpers`, which does not
     export it.
   - So `instanceof RouteError` at :48 (`requirePagePermission`) tests against `undefined`.
   - A CUSTOMER visiting /admin likely gets a TypeError instead of the redirect to "/".
   - Not quizzed.
3. **Borderline hand quizzes.** A generator item narrows these to 2-3 choices without stating the
   answer, so they were left as is: master q08, payments-lab q05/q06, support-desk-crm q05,
   netpastebin q14, recipegen-app q06, recipeview q07, relay-upskilling q04, w22 q11. Two more were
   judged acceptable: support-hub q08, and payments-lab q01 / master q09 against conceptual
   generator items.
4. **Generator after-notes** (`x-g-*`) have not been leak-checked against hand quizzes.
5. **Suggested guard (not built):** an automated cross-quiz check. For each hand quiz, flag any
   generator prompt or choice in the same pack whose text shares the key's distinctive tokens. A
   simple key-substring scan (scratch `xleak.mts`) finds 0 hits today, because the leaks were
   paraphrases. A useful guard needs semantic matching or a human pass. For now the rule is in
   SEEDING.md: before shipping a hand quiz, read every generator item in the same pack against it.
6. Earlier open items still stand: LEARNING.md "Release decisions for the owner" (F4, F8-F11), the
   SEEDING.md backlog (upstream bugs, guide errors, validator ideas).
7. **Cleanup:** after the fast-forward, the `Desktop\bq-*` clones can be removed.

## Lessons (also in LEARNING.md)

- **Commit per pack.** The crash cost only one uncommitted line because every writer and reviewer
  committed per pack.
- **Recover from evidence.** Branch tips, merge-base ancestry checks and the last orchestrator
  messages in the transcript JSONL were enough to reconstruct exactly what was pending.
- **Merge only review branches.** A writer and a reviewer independently fixed the same pack; take
  the reviewed one.
- **Re-sum hard-coded counts** after every content merge.
- **Replacement questions are new content.** They need their own cross-author review. rv-x found
  no wrong keys, but it did find 22 distractor or format problems.
