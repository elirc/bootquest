# R4 · Round 2: cross-examination of R5 (code claims) and R3 (fix feasibility)

Everything here comes from code reading and read-only queries on my sandbox copy. I did not start the app again.
VERIFIED means I read the cited line or ran the query; JUDGMENT is opinion.

## 0. Self-correction first

My round-1 report says the owner loaded the dashboard in "about 8 sessions". That is **overstated**. The 8 distinct
`daily_slate.created_at` values fall on **5 UTC days** (10-15, 10-16, 10-30, 11-04, 11-09). On 10-30, 11-04 and 11-09,
each pair of values is about 0.4 s apart: the back-fill row and today's row are written in the same request. R5's "5
distinct days" is right. **VERIFIED** (`work/R4/q.cjs`: group by `date(created_at)`).

## 1. R5's code claims

| R5 claim | Ruling | Evidence |
|---|---|---|
| R5-03: next-up never offers an explain-back or kata while the track has another open unit, so DESIGN IT never shows until all 129 sysdrills are passed | **CONFIRMED** | `service.ts:769` `ANSWER_FROM_MEMORY_KINDS = {explain-back, patch-kata}`; `:821-823` picks the first non-memory open unit, then a studied-repo EB, then `open[0]`. sysdrills have no prerequisites, so they stay `available` until passed. Agentic falls through to G3 because repo-task and guided-project are not memory kinds (my R4-10). |
| R5-03 fix: "narrow C8 to an EB whose repo's study quest is not passed" | **WEAKENED (the fix is wrong)** | `studiedRepoSlugs` (`service.ts:781-792`) counts campaign quest repos. Many DESIGN IT repos sit in **locked** later JS acts: e.g. `campaign/js/masteropen` has state `locked` (live palette search, round 1). So the narrowed rule would still hide most sets behind JS act progress. Use R3-08's path side files instead: an ordered key list that next-up and the browser follow, warn-and-skip like `related.json`. |
| R5-03: the slate has no EB, kata or design slot | **CONFIRMED** | `streak.ts:118-120`: only `drill-set`, `campaign-step` and `review-clear` slots exist. A drill slot counts `kind='drill'` only (`:83-86`). The sysdesign slot is therefore always a sysdrill. |
| R5-04: "only recognition is spaced" | **CONFIRMED, with a footnote** | There are only two `review_item` writers: `study-quest.ts:85` (quiz misses + flashcards) and `ladder.ts:151` (the changed-example **retest schedule**). The retest is spaced production, but it is one-shot, comes after legs (a)+(b), and the DB holds 1 retest unit, so it is spacing in name only. Single-question quizzes and predict-output queue nothing on a miss (`service.ts:533-541`: study-quiz only). |
| R5-04/F6 fix: a new FSRS kind `redo`, "restamp none" | **WEAKENED** | `review_item.kind` has a CHECK constraint `('card','finding','quiz-miss','concept','retest')` (`008_competency_ladder.sql:96`): a new value needs a table-rebuild migration. Worse, `ReviewQueueItem.kind` is `z.enum(['card','finding','quiz-miss','concept'])` at `shared/src/api.ts:736`, and `api.ts` is in the seed fingerprint (Q1), so adding `redo` **restamps every seed pack**. Reuse the existing, never-written `'concept'` kind: no migration, no restamp. My round-1 N2 says the same. |
| R5-10/F2: a Practice mode via a new api-ext route, size S-M | **WEAKENED (bigger than S-M)** | If a practice try writes an `attempt` + submit `run`, it becomes a verified pass. `VERIFIED_PASS_SQL` (`attempts.ts`) ignores mode, so the pass would unlock topics and acts, tick slate slots (which exclude only `guided`), earn XP and complete Fundamentals topics. Every pass predicate would need a practice exclusion. The cheaper, safe form is a gate-practice endpoint that grades, returns per-item feedback + explanations and queues miss cards, but **writes no attempt** (like `/run`). That is S-M. |
| R5-07/F3: fold "Why it works" client-side | **CONFIRMED feasible** (S, no restamp) | The instructions are served as markdown (`service.ts:217`); splitting at `**Why it works.**` is pure client work. I saw the leak live: `sysdrills/01-estimation/01-qps-from-dau` states the formula before "Your task". This pairs with my R4-03: sysdrills also serve the formula as hint 2. |
| R5 F1 `content/core.json` archive read by `service.ts`, `streak.ts`, `trackunits.ts` | **WEAKENED (one missed dependency)** | Act unlock = `coreDone/coreTotal ≥ 0.8` over the act's study quests (`campaign.ts` header, `meetsCorePct`). Hiding 139 of 204 quest packs without also dropping them from `coreTotal` makes every later act **unopenable**. The archive must also filter campaign core counting, or regenerate the campaign files via `seed:campaign` (hash-checked; that is not a pack restamp). |

## 2. R3's proposed fixes: feasibility

| R3 fix | Ruling | Evidence and the amendment |
|---|---|---|
| R3-01/M2: weight-override side file "read in `shared/src/eb-weight.ts`" | **WEAKENED (it cannot live there)** | `eb-weight.ts` is imported by the **client** (`client/src/lib/eb-weights.ts`) and by `tools/seed/src/ops/xleak-lint.ts`. Its header requires it to stay zod-free and runtime-pure, so it cannot read files. Load the overrides server-side (`eb-score.ts`/`ladder-service.ts`). The client then needs them too, but `KeyPointDto`/`ExplainBackKeyResponse` are strict in `api.ts` (bound), so ship them through a new `api-ext` endpoint or field. Still **no restamp**; M. |
| R3-01: cheaper gate "at most one `[w3]` missed" | **CONFIRMED feasible, needs versioning** | `EB_PASS_SQL` (`eb-score.ts`) evaluates the stored `eb_score_detail.w3_missed` **at read time**, and `xp.ts` and promotion leg (b) use it. Changing `> 0` to `> 1` would retroactively turn old fails into passes. There is zero evidence in the owner DB today, so do it now, or store a rule version per detail row. S. |
| R3-02: ≤12-word kp headlines in the side file | **CONFIRMED feasible** (M, mostly authoring) | Display-only, so no grading change. The risk is that side files skip `seed:validate`/xleak (01-STATE §5: "authored units skip every seed validator"), so add the headlines to the xleak lint. |
| R3-05/M9: open-book G2, "client only" | **WEAKENED on "client only"; the direction is CONFIRMED** | `ExplainBackPublic` (`api.ts:472-533`) carries no repo or sha, and `refs` is empty (0 `unit_ref`/`content_ref` rows). The client can derive the repo slug from the key (`ladder/g2/<repo>/<hash>`) but **not the pinned sha**, and a HEAD link drifts from rubric kps that name exact files. Add a tiny `api-ext` `GET /units/:id/source` → `{repo, sha}` from the seed provenance. S, no restamp. Answers are stored before the key, so open-book leaks no key. It does change what leg (b) means for `agentic-engineering`: owner decision. |
| R3-07/M1: interview mode (L) | **CONFIRMED as L; split it** | (1) The answer of record is exactly 3 answers in one POST, once per set version (`api.ts:821-826`, bound). A staged flow (clarify → estimate → design → probe) needs a staging table + `api-ext` endpoints that assemble the record at the end. (2) Any key-point reveal between stages makes later stages prior-key, so R5's "stepwise reveal" can never be evidence. R3's clarifying-answer reveal is fine only if those answers are not key points. (3) 87 sets × (12 clarifiers + estimate + probe) of unvalidated side-file content. **Do first (S):** blind on by default for `[senior]` (`LadderPanes.tsx:491`), a client timer and framework headings. Build the staged L version only after the owner has done ~5 DESIGN IT sets. |
| R3-08: path side files for sysdesign/agentic | **CONFIRMED feasible** (M, no restamp) | Same warn-and-skip loader pattern as `content/fundamentals/related.json` (`store/fundamentals.ts`); `getDashboard` nextUp and `lib/trackunits.ts` read it. It also covers R5-03's fix and my R4-10. |

## 3. Votes on Q1-Q5

**Q1 Restamp scope.** I checked the code (`tools/seed/src/factory/fingerprint.test.ts:28-84` PINNED,
`server/src/store/grader-fingerprint.ts:56-101`, `store/campaign-fingerprint.ts`). There are three separate stamps:

- **(a) Drill packs** (`content/packs/*`, 11 packs) bind their grader kind's files and toolchain:
  - JS: `runners/js/*` + `api/runners.ts`.
  - C#: `runners/csharp/*` (incl. `scratch.ts`), `result-channel.ts`, `self-run/compose.ts`, `api/runner-csharp.ts`.
  - Java: `runners/java/*`, `scratch.ts`, `api/runner-java.ts`.
  - All three also bind the validate gate (`validate.ts`, `verdicts.ts`, `journal.ts`, plus `validate-java.ts` for
    Java) and the **node version** (plus esbuild/.NET/JDK).
- **(b) Seed packs** (quests, explainback, variants, patches, notes) bind:
  - `server/src/api/runners.ts`;
  - **11 shared files**: `api`, `campaign`, `check`, `enums`, `index`, `mutation`, `pack`, `schemas`, `seed-pack`,
    `sync`, `thresholds`;
  - the whole factory closure, `citations/resolve.ts`, `exclusions.json` and `verdicts.ts`;
  - npm dependency versions;
  - runner files when the pack executes drills.
- **(c) The campaign map** binds `tools/seed/src/campaign/*.ts` + `shared/src/campaign.ts`.

So:
- **AGENTS.md is too broad.** Engines, services, store, `db/`, `sync/`, migrations, `shared/src/api-ext.ts`,
  `eb-weight.ts`, `fundamentals.ts`, the client and the CLI are all free to change.
- **My round-1 wording was too narrow.** "A few shared files" is really 11, including `api.ts`, and I missed that
  a **Node upgrade restamps everything** (`process.version` is bound in both (a) and (b)).
- **R1 is right, and it is broader than stated:** `scratch.ts` restamps every drill-cs **and** drill-java pack.

AGENTS.md should list exactly these files, not directories.

**Q2 Freeze vs add.** Freeze content waves until the owner has used the app: ≥30 attempts over ≥7 days as the first
checkpoint, then R5's 100/14 before any new pack. Allowed before that, because they make **existing** content usable
rather than adding more:
- (i) Fundamentals fixes that only work pre-landing (Q5);
- (ii) honesty and feedback fixes (R4-01/02/03/06, R5-07);
- (iii) routing side files (R3-08 paths, R5 core path);
- (iv) the R3-01 gate rule, before any evidence exists.

Not allowed yet: C#/Java senior topics (R1-07), the 8 design problems, ~30 agentic units and contrasting-case
packs. JUDGMENT: none of those can be judged without seeing where the owner actually gets stuck.

**Q3 Honesty model: split, along the line between feedback and evidence.** R5 is right that withholding feedback
hurts learning. I am right that the current gates are blind-brute-forceable and open-book after one fail, so they
certify nothing. The way out is to stop pretending gates are evidence:

1. **Loosen** Fundamentals gates and campaign quizzes into practice. Grade, then show every item's verdict +
   explanation at once. Unlocks are navigation, so they can follow. XP goes only to the first try (my R4-09). Write
   attempts only through a path every pass predicate can exclude (§1 R5-10 row).
2. **Tighten** only what feeds the ladder: artifacts, EBs and retests.
   - Hints never formula-level on any evidence-capable unit (R4-03).
   - EB answers below a length/overlap floor cannot self-score "covered" without a confirmation, and get flagged
     (R4-07).
   - Server-side retry budgets wherever a pass becomes evidence.
   - Keep reveal = 0 XP.
3. **Drop** decoration with no consequence: client-only cooldowns, and the "Show lesson → assisted" ceremony (R4-08).

**Q4 Archive scale.** The routing matters more than the count.
- Mechanism: R5's server-local allow-list (`content/core.json`) controls the hero, slate and next-up. It also
  **filters campaign core counting** (or regenerates the campaign via `seed:campaign`), otherwise acts lock forever
  (§1).
- Stamped content is never touched, and keys stay byte-identical.
- The library (track browser, Ctrl+K) keeps everything, with an "Archive" filter.
- Default-hide in phase 1: R5's bootforge language/React banks (1,867), jstrain 01-11/ts/quiz basics (946) and
  csbootcamp (31): about 2,850 units that duplicate Fundamentals.
- Quest-pack archiving (139 packs) waits for a hand-check of more than R5's 52-item sample, plus the campaign
  re-derivation. R2's ~1,500 demotions fit inside that. JUDGMENT.

**Q5 Fix Fundamentals before landing.** Fix first, but time-box it to about 2 days. Then land. Must-do now:
- **R1-06 SQL renumbering.** It renames keys, so it is impossible later.
- **R1-03 drill test gaps.** Wrong code passes today.
- **R1-14 trivia items** (4).
- **R4-13 raw fences** (2 items).
- **R1-11 missing lesson sentences** (3).
- **R1-13 stale version distractors.**

The R1-01/R1-02 bulk rewrites (100-300 items) do not need to block landing. With 0 attempts they can still land
before first use; after that, use "retire old item + new key" (`012_reseed_retire` already supports retirement).

## 4. Revised top 7 for the whole app (skill gain per build hour)

| # | What | Why it ranks here | Size · restamp |
|---|---|---|---|
| 1 | **Owner wave 0:** land f52 after the Q5 must-dos, `bootquest sync` signalpost, pick one language, and use the app 7 days with DOGFOOD notes | 5 visit days and 0 submits in 4 weeks; nothing else matters until this moves | 0 build |
| 2 | **Q5 pre-landing Fundamentals fixes** (R1-06/03/14/11/13, R4-13) | The only time-limited item; the ladder is the hero's path | S-M content · Fundamentals packs recompile by runbook |
| 3 | **Gate feedback/evidence split** (Q3): fail feedback with explanations, first-try XP, no client theatre; server no-marks + retry budget only where a pass becomes evidence | Feedback right after an error is the cheapest learning gain in the app, and it removes R4-01/02 at the same time | S-M · no |
| 4 | **One daily loop:** one language; hero = slate = streak (R4-05); a rotating "senior rep" slot fed by path side files (R3-08/R5-03: DESIGN IT, kata, fund-js 21-33) | Routes the owner to the best content, which is unreachable by default today | M · no |
| 5 | **Desirable-difficulty repair:** fold "Why it works" (R5-07, 209 drills) + per-bank hint order (R4-03, 127 sysdrills) | Turns 209 transcription drills back into reasoning, for about a day of work | S · no |
| 6 | **Review queue that trains production:** choices on quiz-miss fronts (R4-06) + redo cards for passed drills on the `'concept'` kind (R5-04, amended) + a one-line error note on a miss | Spacing finally reaches code, and every card is answerable | M · no (if `'concept'` is reused) |
| 7 | **EB grading repair:** versioned "≤1 `[w3]` missed" rule now (R3-01), headlines/dimensions side file (R3-02/06) served via `api-ext`, overlap/calibration flag (R4-07), open-book G2 with a pinned-sha link (R3-05 amended) | Makes the best senior content gradeable honestly | M · no |

Deferred: interview mode L (R3-07; start with the S version), C#/Java senior topics, new design/agentic content,
Practice mode in its full attempt-writing form, PWA.
