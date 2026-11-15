# R5 · Learning design and whole-app skeptic review (2026-11-12)

Reviewer R5. Target: `C:\Users\Owner\Desktop\bq-review` (`f52-wave` @ `dc2206bc`), read-only. Scripts and outputs are
in `review-2026-11-12/work/R5/` (`census.cjs` → `census.json`, `overlap.cjs`, `prov.cjs`, `qprint.cjs`,
`sample.cjs`, `db*.cjs`). The owner DB was opened only with `node:sqlite` `{ readOnly: true }`.

## 1. Verdict

1. BootQuest is a strong content and integrity factory that has not yet been used to learn anything. The owner DB holds
   0 attempts, 0 runs, 0 XP and 0 reviews. 1,147 commits and about 88k words of process docs went in over 34 days.
   At the app's own time estimates, the content adds up to roughly 980 learner-hours.
2. The parts that would make a working engineer senior are already here: the DESIGN IT sets, the review katas, the
   Fundamentals JS 21-33 topics, the G2 briefs and the signalpost curriculum. But the daily loop sends the learner away
   from them. The slate is four drill slots (JS, C#, Java, sysdrills) plus a campaign step, and next-up never offers an
   explain-back or kata while any other unit is open.
3. In learning-science terms, spacing and feedback go to the weakest item types. Only MCQ misses and flashcards are
   spaced. None of the 3,357 drills, 508 predict-output items or 52 katas ever comes back after a pass. 209 drills
   explain their answer before the task.
4. The fix is mainly to subtract and re-route, not to build. Archive about 60% of the active units, set a dated goal,
   make the loop "warm-up of spaced redo items → one hard senior rep → one-line error log", and freeze content waves
   until the app has been used.
5. Most of the high-value changes need no restamp: client code, migrations, non-fingerprinted server engines, and
   server-local JSON like `related.json`.

## 2. Findings (ranked)

| id | sev | tag | finding and evidence | proposed fix |
|---|---|---|---|---|
| R5-01 | P1 | VERIFIED | **Non-use is the main result, and building has replaced using.** The owner DB has `attempt`=0, `run`=0, `xp_event`=0, `review_log`=0, `evidence`=0 and `sync_run`=0 (`work/R5/db.cjs`). `daily_slate` has 26 rows, but `created_at` shows only **5 distinct days** when the server composed a slate (10-15, 10-16, 10-30, 11-04, 11-09). The other 21 days were back-filled as `missed` (`db3.cjs`). Those five days match wave landings and reviews, not learning sessions. `git log`: 1,147 commits in 34 days (20 active days). `LEARNING.md` has 0 dogfood entries, though `docs/DOGFOOD.md` asks for them. `elihandoftwo/03 U0` recommended on 11-01 to "freeze new waves until ≥ 30 recorded attempts". The f52 wave that followed added 13 topics and 51 drills, and attempts are still 0. | A usage gate the owner sets and keeps: no new content wave until the owner DB shows ≥ 100 attempts over ≥ 14 distinct days (one `SELECT`). Write it in `AGENTS.md` so agents refuse content waves. Size S. Restamp none. |
| R5-02 | P1 | VERIFIED (arithmetic) / JUDGMENT (minutes for EB/quests) | **The volume cannot be finished.** Drill time at `client/src/lib/estimates.ts` rates (5/10/15 min by difficulty): d1 387 + d2 2,372 + d3 598 = **577 h** for 3,357 drills (`census.json` `drillDiff`). My own estimates for the rest: 204 study quests × 30 min ≈ 102 h, 732 EB questions × 15 min ≈ 183 h, 147 written ≈ 37 h, 1,052 quiz + predict ≈ 26 h, katas 13 h, 73 topics 12 h, lifetime card reviews ≈ 33 h. Total ≈ **980 h**: about 5.4 years at 30 min/day, or 2.7 years at 1 h/day. The senior-CRUD-relevant part (DESIGN IT, katas, fund-js 21-33, sysdrills, csdrills/javadrills, signalpost, G2, bootforge http/express/sql/fullstack) is roughly 25% of those hours. | Section 3 CUT: archive about 60% of the active units and show a finite named core with a visible finish line ("Senior CRUD 120"). |
| R5-03 | P1 | VERIFIED | **The daily loop starves the senior content.** `track` rows: js/csharp/java/sysdesign `slate_drills`=1, agentic 0. The 11-09 slate = 4 drill slots + 1 campaign step (`db4.cjs`), with no explain-back, kata or design slot. `server/src/api/service.ts:818-824` (f52 C8): next-up never offers an explain-back or patch kata while the track has any other available unit. On sysdesign, the 87 DESIGN IT sets therefore never show as next-up until all 129 sysdrills are passed. On JS, the classic EBs wait behind about 4,000 units. The best content in the app is reachable only by browsing. | Replace the slate with the loop in §7 (one "senior rep" slot that rotates design / kata / lab / fund-js 21-33). Narrow C8 to "an EB whose repo's study quest is not passed" so it does not apply to whole tracks. Files: `engines/streak.ts`, `api/service.ts`, `client/src/pages/Dashboard.tsx`. Size M. Restamp none (SEEDING §6 binds only `runners.ts` and the runner adapters; check with `restamp:all -- --dry-run`). |
| R5-04 | P1 | VERIFIED | **Spacing applies only to recognition items.** FSRS cards are created only by `queueQuizMisses` (study-quiz misses) and by `enrollFlashcards` when a quest is passed (`api/service.ts:537-541`, `engines/study-quest.ts:85,102`). After a pass, these never come back: **3,357 drills, 508 predict-output, 544 bootforge quizzes, 52 katas, 732 EB questions** (EB set-B/C retakes behind a 2-day gate are the only exception). A study-quiz item answered right by a lucky guess (25% odds) is never scheduled again. Execute Program does the opposite and re-serves the *code tasks* on a spacing schedule. | "Redo cards": a passed drill, predict-output or kata enrolls an FSRS card of a new kind `redo`. Due cards open the same unit blank, or a sibling from the same module, and the existing runner grades them. A failed redo grades the card Again. Files: `engines/fsrs.ts` (kind), `store/review-cards.ts`, `client/src/pages/Review.tsx` → reuse the Player. Size M. Restamp none. |
| R5-05 | P1 | VERIFIED | **Recognition far outweighs production.** Recognition and passive items: MCQ 4,266 (quest 3,018 + Fundamentals 704 + bootforge 544), flashcards 1,496 (938 + 558), reading steps 3,776, notes 3,660. Production items: 3,357 drills, 508 typed predict-output (all typed, `predictOutput.typed`=508, which is good), 732 EB questions, 52 katas. Fundamentals is 704 MCQ to **116** drills. Fundamentals C5 ("convert 2-3 per topic to typed predict-output") was refused by the f52 council (`fable52docs/wave/REPORT.md` "Deviations"). | In the core path, put production before recognition: each core topic opens with a predict-output or drill attempt ("try first", Brilliant style), and the MCQ gate shrinks to 5. The new topics come from §5 F3/F8. No change to existing items. |
| R5-06 | P1 | JUDGMENT (n=52 by hand) + VERIFIED (regex) | **Most study-quest questions test one repo's incidental behaviour.** I hand-classified 52 random quest quizzes (`qprint.cjs` seeds 11 and 977). About **18 (≈35%)** test a principle that carries over (EnsureSuccessStatusCode throws on 404; the owner comes from the session, never the body; code before the first `await` blocks). About **34 (≈65%)** test details of one repo: nextcrm "402 NO_API_KEY", folio "child blocks nest only under a Toggle", bazaar "p95 > 500 ms or lock wait > 100 ms for five minutes", cli-to-do "C gets id 3", umami "retry is false". Regex check: 1,111 of 3,018 (36.8%) prompts name an identifier, file or doc. 61% of quest quiz/flashcard provenance paths are learning docs (`upskill/`, `fabledocs/`, guides; `prov.cjs`: 2,416 of 3,956). So these are quizzes about tutorials about the repos. Steelman: knowing your own systems well matters. Attack: these are mostly agent-written practice repos the owner will never maintain, so recall of them does not carry over. | Archive 139 of 204 packs (§3). In the 65 kept, the remediation rule for new items: every question must survive the test "would this be true in a different codebase?" |
| R5-07 | P1 | VERIFIED | **Worked answer before the task, with no fading (low desirable difficulty).** In **209 drills** a "**Why it works.**" section comes before "**Your task.**": javadrills 80/80 and sysdrills 129/129 (`packs/*` scan). In 109 of the 129 sysdrills that section contains the arithmetic. Examples: `sysdrills/09-queues-and-backlog/08-load-shedding` ("The excess is arrivals − capacity, never below zero … shed × 1000 ÷ arrivals"), `sysdrills/04-networking-and-latency/06-timeout-cascade` ("`d ≤ (edge − minUseful) / overhead`, rounded down"), `javadrills/06-strings-and-text/08-replace-vs-replaceall` (states the whole answer). The ab S6 reshape took formulas off the task line only (`docs/SEEDING.md:1820`), and the importer gate checks only the task line (`SEEDING.md:169`). The derivation is one paragraph higher. The drill then grades typing, not reasoning. | Client-only: split the instructions at `**Why it works.**` and fold that section until after the first failed submit or the pass (the same fold mechanism as the kata comment fold). Size S. Restamp none. Content stays byte-identical. |
| R5-08 | P2 | VERIFIED (regex, `overlap.cjs`) | **The same senior concept is scattered over repos instead of being organized for transfer.** Idempotency appears in **292** items, of which only about 37 are runnable drills (bootforge 11, jstrain 14, fund-js 3, javabootcamp 5, csdrills 1, jstrain-cs 2). The other ~255 are quiz, flashcard, reading, note or EB items spread over dozens of repos. Optimistic concurrency: 80. Cursor pagination: 80. N+1: 42. Seeing one principle in many contexts is exactly what transfer needs, but nothing groups or interleaves them. A learner meets idempotency once per repo pack in arbitrary order. | Concept index: a seed-time tagging pass writes `content/concepts.json` (concept → item keys, like `related.json`). A "concept quest" interleaves 1 item from each of 5 repos, then a drill, then a DESIGN IT checkpoint. Size M. Restamp none (side file, not in a stamped pack). |
| R5-09 | P2 | VERIFIED | **No goal, deadline, plan, reflection, calibration or error notebook.** Grep across `server/src`, `client/src` and `shared/src`: "confidence" appears only as upskillorder's assessment field (`store/campaign.ts`). No goal, deadline, journal or calibration code. Calibration (B7, `elihandoftwo/03 §2`) is still unbuilt. | §5 F4, F5, F7. |
| R5-10 | P2 | JUDGMENT | **The honesty model is tuned against an adversary that does not exist, and it costs real learning.** There is one user, and every key is readable on disk in a public repo (`01 §7.6`). Yet a failed Fundamentals gate shows no per-question marks, plus a 3-minute cooldown after the second fail (`fable52docs/wave/REPORT.md`). Reveal means 0 XP forever, and hints cost 25%. Corrective feedback right after an error is one of the most reliable learning effects, and here it is withheld to protect a ledger nobody is attacking. "Reveal = 0 XP forever" also makes being stuck feel costly, which is the moment learners quit. | Two modes. **Practice** (default): immediate per-item feedback, free reveal, small XP, never evidence. **Evidence**: today's rules, opt in per attempt, required for ladder legs. Files: `StudyQuestPane.tsx`, `study-service.ts`, `api-ext.ts`. Size S-M. Restamp none (the strict schema in `api.ts` stays; Practice uses a new `api-ext` route). |
| R5-11 | P2 | VERIFIED | **Daily context switching across five worlds.** The default slate covers 3 languages + sysdesign + campaign (`db4.cjs`). For one engineer aiming at senior CRUD, three languages in parallel spreads the effort thin and multiplies first-session friction (the C# first grade takes about 60 s, `DOGFOOD.md`). | Onboarding asks for one primary language for 90 days and turns the other slate slots off by default (`slate_setting` already supports this). Size S. |
| R5-12 | P2 | VERIFIED | **Flashcards break the minimum-information rule.** Back length median 37 words, P90 54, and **332 of 938** quest flashcard backs are over 40 words (`census.json`). Example: zz8 "How zz8's docs checked the code without installed dependencies" (≈60-word back, all repo trivia). Long backs, self-graded after reveal (`Review.tsx:266` "Recall the answer, then reveal"), turn into "I roughly knew that" and inflate recall. | In the kept packs only, split cards over 40 words into 1-fact cards as new items (the old ones stay byte-identical and are archived). Optional typed answer before reveal on the Review page (client-only). Size S-M. |
| R5-13 | P3 | VERIFIED | **Weak tests on many bootforge drills.** 687 of 1,825 bootforge drills have ≤ 2 tests (`drillTestHist`). Example: `async-greet` with 2 example tests. A wrong-but-plausible solution often passes, so the feedback is thin. Plus the known 78% longest-key bias in bootforge quizzes (frozen upstream). | Archive most of them (§3). The kept http/express/sql/fullstack courses get no edits (upstream-frozen); report upstream. |
| R5-14 | P2 | VERIFIED | **The agentic track teaches "direct a coding agent", not "build agentic systems".** Agentic = 20 G2 briefs + 52 katas + G3 + G4 (`units/agentic.json`, 2 units). File-level grep across `content/`: "prompt injection" 0 files, "context window" 0, "token budget/cost" 1. Nothing on eval harnesses, tool schemas, retries/timeouts on model calls, cost/latency budgets, or injection defence. | ADD §4 A4. |
| R5-15 | P2 | VERIFIED (read) | **DESIGN IT is the best content in the app, and it is self-scored with no structure for the timed interview it imitates.** I read `sysdesign--bazaar--inventory-no-oversell` in full: invariant placement, conditional UPDATE, TTL holds, pre-mortem, trade-off handback. This is senior material. But it is answer-then-tick against 6-8 key points with no time box, no stepwise reveal and no delivery framework. | §5 F9 (interview mode) and F10 (grading bridge). |
| R5-16 | P3 | VERIFIED | Still unfixed from past reviews: (a) no placement test. The hero opens JS Fundamentals topic 01 "Values, types & coercion" (beginner) for a working engineer (`Dashboard.tsx:148`, `topics.json` order 1). (b) The truth layer is inert: `sync_run`=0, all 8 `competency_rating`=1. (c) The best content is not on `main` (`fund-wave`/`f52-wave` unlanded). (d) Self-score with no calibration (`01 §7.5`). | (a) see §5 F11. (b) U1 sync (owner action). (c) owner lands. (d) F4. |

## 3. CUT (archive, freeze, demote)

"Archive" means hidden from the slate, hero, next-up and the default track/campaign view. It stays searchable in Ctrl+K
and in an "Archive" tab, is never deleted, and stays byte-identical. Implementation: a server-local
`content/core.json` (an allow-list of unit-key prefixes) read by `service.ts`, `streak.ts` and `trackunits.ts`. Size S-M.
Restamp none.

| What | Count affected | Reason |
|---|---|---|
| bootforge language/React courses: js-fundamentals 147, functions-deep 172, arrays-objects 181, errors-modules 170, async-js 172, ts-basics 170, ts-apps 171, node-core 171, react-fundamentals 171, react-state 172, react-ts 170 | **1,867 units** | Beginner-to-intermediate drill banks a working engineer has mostly mastered. 687 bootforge drills have ≤ 2 tests. Fundamentals + jstrain cover the same ground. **Keep** http-rest 170, express-api 171, sql-data 171, fullstack-crud 180, engineering-practice 12 (704). |
| jstrain 01-11 language modules (454), ts-01..08 (124), quiz sets 01-08, 11, 12, 14 (368) | **946 units** | Same JS language ground as above and as Fundamentals 01-20. **Keep** 12-29 (node, persistence, testing, debug hunts, security hunts, SQL, write-the-test) and quiz-09 spot-the-bug, quiz-10 interview-verbal, quiz-13 SQL, quiz-15 stack traces. |
| csbootcamp | **31** | Duplicated by fund-csharp + jstrain-cs + csdrills. |
| Quest packs whose repo has no DESIGN IT set, no kata and < 20 quizzes | **139 of 204 packs**: 1,754 quizzes, 495 flashcards, 2,594 reading steps (plus their notes) | Mostly repo-incidental (R5-06). **Keep 65 packs**: 1,264 quizzes, 443 flashcards, 1,182 reading steps. |
| Classic explain-backs on archived repos | **117 of 137** classic EB dirs (20 sit on kept repos) | Same reason. They stay reachable from the archive. |
| Fundamentals JS/C#/Java topics 01-14 | 42 topics, demoted, not archived | Behind a placement check (F11). They become the remediation pool and stop being the hero's first step. |
| A second and third language | C# 211 + Java 275 drills off the default slate | Owner picks one primary language for 90 days (R5-11). The rest stays one toggle away. |
| **Freeze**: new content waves, new tracks (Git/Docker/DSA ladders, a sixth track), new quest packs on more repos, C#/Java twins | — | Nothing new until the R5-01 usage gate is met. The marginal unit is worth roughly zero while attempts = 0. |

In unit terms the archive is 2,844 pack units + 139 study units + 117 EB units ≈ 3,100. That takes the active
surface from about 5,200 units to about 2,100, with C#/Java off the default slate but not archived. The core path the
hero walks is about 120 stops (§7).
Nothing is deleted, so the "historical keys never change" and ledger rules are untouched.

## 4. ADD (content gaps, concrete)

Only after the usage gate, except A1, which is mostly ordering.

| id | Content | Item types and counts | Notes |
|---|---|---|---|
| A1 | **"Senior CRUD 120"**: an ordered core of existing units | about 120 stops: fund-js 21-33 (13 topics, 39 drills), signalpost U01-U12, 30 DESIGN IT primaries ordered small to large, 25 katas (easy → hard), 15 G2 briefs, sysdrills 15-18 + 6 others, fullstack-crud 20 drills | Ordering only, in `core.json`. Size S. |
| A2 | **Contrasting cases** (B8 in `03`): rank 3 versions of a design doc / PR description / postmortem and tag their flaws | 24 sets × 3 variants, via the quiz/kata flow | New packs only (they get their own stamps; no estate restamp). Size M. |
| A3 | **Clean PRs and nit distractors** in the kata bank (L7) | 20 multi-file PRs, about 30% clean, scored on precision and recall | Patches generator already takes multi-file diffs. Size S-M. |
| A4 | **Building agentic systems** mini-ladder (fund-js style, drill-js with an injected fake model) | 6 topics × (lesson, 6-item gate, 3 drills): tool-call schema validation and repair; retries/timeouts/budgets around a model call; an eval harness (golden set, pass@k, regression gate); prompt-injection defence for tool output; context assembly and truncation; cost/latency accounting | Fills R5-14. New pack only. Size M. |
| A5 | **Debugging labs on broken repos**: a failing test or incident trace in a pinned estate repo; find the line, then fix with a fail-to-pass test | 10 labs | Uses `node-test-file`/`repo` runners. A new predicate is possibly bound to the js grader fingerprint: check `runners.ts`. Size M-L. |
| A6 | **One-fact flashcards** replacing over-long backs in the 65 kept packs | about 150 new cards | Old cards are archived, not edited. Size S. |
| A7 | **Predict-output on senior topics** (async ordering in handlers, transaction outcomes, cache read-after-write, HTTP status flows) | 40 typed items, front-loaded in the core topics | The typed predict-output kind already exists, so no restamp. Size S-M. |

## 5. New features, learning styles and teaching methods (ranked by skill gain per build hour)

Restamp risk: per `docs/SEEDING.md §6`, only `server/src/api/runners.ts`, the runner adapters and the seed factory
closure (`shared/src/{seed-pack,check,pack}.ts` and their imports) are fingerprinted. Engines, `service.ts`,
`api-ext.ts`, migrations and the client are not. Every "none" below should be confirmed with `restamp:all -- --dry-run`.

| rank | Feature | Learning rationale | Size | Files | Restamp |
|---|---|---|---|---|---|
| F1 | **Core path + archive + new slate** (§3, §7) | Scope is the root cause of non-use. A finite list with a finish line is NeetCode's whole value. | S-M | `content/core.json`, `api/service.ts` next-up, `engines/streak.ts` slate, `Dashboard.tsx`, `trackunits.ts` | none |
| F2 | **Practice vs Evidence mode** (R5-10) | Immediate, specific corrective feedback, and permission to be stuck | S-M | `StudyQuestPane.tsx`, `study-service.ts`, `api-ext.ts`, Player | none |
| F3 | **Fold "Why it works" / try-first** (R5-07) | Generation before explanation, plus desirable difficulty. A worked example is shown after the attempt, not instead of it. | S | client Player prose split | none |
| F4 | **Confidence on every graded answer** (sure / think so / guess) and a calibration panel (accuracy by confidence, Brier score, B7 time-estimate intervals) | Metacognition. It also fixes the "self-score everywhere" weakness by showing over-confidence. | S-M | migration 020 (append-only), `api-ext.ts`, Player, `Stats.tsx` | none |
| F5 | **Error notebook**: after any failed submit or missed key point, a 1-line "why I got it wrong" plus a category (misread / concept gap / slip / didn't know API). Each entry becomes an FSRS card ("what did you get wrong about X?") | Elaboration on errors, deliberate practice aimed at real weak spots, and personal content that is always relevant | S-M | migration, `engines/fsrs.ts` kind, Review UI | none |
| F6 | **Redo cards for passed production items** (R5-04) | Spaced retrieval of *procedures*, as Execute Program does | M | `fsrs.ts`, `review-cards.ts`, `Review.tsx` → Player | none |
| F7 | **Goal and deadline plus weekly review**: owner sets a goal ("senior loop at X by 2027-02-15" or "promotion packet by Q1"), a weekly hour budget and a date. The weekly page shows hours done vs plan, evidence gained, the notebook's top 3 categories, and a 3-question reflection | An external target is the strongest single predictor of a self-learner showing up. The reflection supports metacognition. | S | migration, `Dashboard.tsx`, new `Week.tsx` | none |
| F8 | **Concept index + interleaved concept quests** (R5-08) | Interleaving and variability of practice lead to transfer | M | seed-time tagging script → `content/concepts.json`, a server reader like `store/fundamentals.ts` | none |
| F9 | **DESIGN IT interview mode**: 45-min timer; a fixed delivery framework (requirements → entities/API → high level → deep dive → pre-mortem → trade-offs); stepwise answer → that step's key points → next step, using the existing 3 questions as steps; a "say it out loud" option with a local recording the owner replays | Hello Interview's guided practice without a model. Timed retrieval under interview conditions. | M | `LadderPanes.tsx`, EB service via `api-ext` | none (new probe fields would restamp: don't add them) |
| F10 | **Claude Code grading bridge** (owner decision on rule 1): `bootquest export-attempt <id>` writes the stored answer + key points + rubric. The owner runs a slash command in their own Claude Code, which grades key-point coverage with quotes. `bootquest import-grade` stores it as a separate evidence class "model-graded", shown next to the self-score, never a ladder leg at first | Fixes self-scoring on all senior writing with no runtime spend in the app. The disagreement between self-score and model score is itself a calibration signal. | M | `cli/`, migration, `api-ext.ts` | none |
| F11 | **Placement by production**: a 20-minute diagnostic per language (typed predict-output + 3 drills from topics 01-14). Topics passed are marked "placed", come back as redo cards at a low rate, and drop out of the hero | Respects prior knowledge, and gives a day-one experience that is interesting, not `typeof null` | M | client + `fundamentals-service.ts` + migration | none |
| F12 | **Write-then-compare** after every drill pass: show 2 reference solutions with trade-off notes (Exercism's community-solutions moment), authored at seed time in a side file | Elaboration and exposure to idiom | S per bank (content) | side JSON + Player | none |
| F13 | **Bring-your-own ticket** (B2 in `03`) and the signalpost labs (L1) | The real build-and-ship artifact. Codecrafters' "tests run against your own repo". | M-L | `repo` runner predicate (fail-to-pass) | **possible** if the predicate lands in `runners.ts` |
| F14 | **Parsons problems** (reorder lines into a correct handler or migration) | Good scaffolding between worked example and blank page | M | new unit kind in `shared/src/enums.ts` | **yes**: bundle into one planned restamp, or skip |
| F15 | **Accountability export**: weekly report as markdown, to send to a peer/mentor or paste into a 1:1 | Social commitment | S | client | none |

Deliberately not built: in-app runtime LLM tutor by default, leaderboards and social, video, more breadth ladders,
more repos.

### Learning-science map

| Method | Status | Evidence |
|---|---|---|
| Retrieval practice | ◐ served, but mostly recognition | 4,266 MCQ vs 732 EB free-recall questions. EBs are answer-first (good). Fund gates are closed-book (good). |
| Spacing | ◐ recognition only | R5-04 |
| Interleaving | ◐ weak | "mixed drills" across slate tracks, jstrain 21 and quiz-14 exist. Blocked by topic elsewhere. No interleaving by concept (R5-08). |
| Worked examples → faded scaffolding | ✕ undermined | worked answer before the task in 209 drills (R5-07). No fading sequence anywhere. |
| Deliberate practice with feedback | ◐ | drills give instant runner feedback and named tests. Gates withhold item feedback (R5-10). 687 bootforge drills have ≤ 2 tests. |
| Generation / elaboration | ● for EBs, katas, G2 and predict-output (typed); ○ elsewhere | no "explain why" after a drill pass, no error notebook |
| Desirable difficulty | ◐ | closed-book gate and cooldown (good). Formula-in-prompt drills and beginner day one (bad). |
| Transfer | ◐ asset present, unorganized | same concept over many repos (R5-08). About 65% of quest questions are repo-incidental (R5-06). |
| Metacognition / calibration | ✕ missing | R5-09. Self-score everywhere with no measurement. |
| Goal-setting / implementation intentions | ✕ missing | R5-09 |

## 6. What to steal and what not to copy

| Product | Steal | Do not copy |
|---|---|---|
| boot.dev | One obvious "continue" path; lesson → exercise every few paragraphs; a guided project at the end of a course; a Socratic tutor that will not hand over answers (here: F10 as an offline bridge) | its breadth beginner curriculum (BootQuest already has too much of it) |
| Exercism | Seeing other solutions after a pass (F12); mentor-style comments on idiom | community and mentoring infrastructure |
| Anki | The minimum-information card; the learner authoring their own cards (F5 notebook) | deck sprawl: 1,496 seeded cards is already Anki's failure mode |
| Execute Program | Spaced repetition of **code tasks**, not cards (F6); lessons unlock on review performance | — (the closest model for BootQuest) |
| Codecrafters | Staged projects whose tests run against your own repo (F13, signalpost) | toy reimplementations (Redis/Git) that aren't senior CRUD |
| Brilliant | Problem first, explanation second (F3, A7) | heavy production of animated interactives |
| LeetCode / NeetCode | A finite curated list with a roadmap and a completion count (F1: "Senior CRUD 120") | the algorithm-puzzle grind |
| Hello Interview | A fixed delivery framework, stepwise feedback, timed mocks (F9) | the paid AI-mock dependency. Use the bridge (F10) instead. |
| Frontend Masters / Educative | Pattern catalogues ("Grokking"-style) as a reference index (F8 does this over the estate) | long passive video or reading courses |

## 7. Target shape

**One sentence.** BootQuest is a 45-minute daily senior-CRUD gym: a short spaced warm-up of things you once did, one
hard senior rep on real code or a real design, and one line about what you got wrong, all aimed at a dated goal you
chose.

**The one daily loop (≈ 45 min)**
1. **Warm-up, 10 min.** 6 due items from one queue: redo drills (F6), typed predict-output, quiz misses, flashcards
   and notebook cards. Each is confidence-rated (F4).
2. **Senior rep, 25-30 min.** The next stop in "Senior CRUD 120", rotating by weekday: Mon/Thu a fund-js 21-33 drill
   trio or a signalpost milestone, Tue/Fri a DESIGN IT in interview mode (F9), Wed a kata (with clean PRs), Sat a BYO
   ticket or lab. Practice mode by default, with Evidence one click away.
3. **Close, 3 min.** One notebook entry (F5) and the streak tick. **Weekly, 15 min:** the review page against the goal
   (F7).

The streak counts this loop, not XP from drills in four tracks.

**Why the owner would come back.** Day 1: a 20-minute placement (F11) that is *interesting* (a race to find, a design
pre-mortem) and ends with a personal map, a goal and a date. Day 7: the first weekly page shows real redo cards
coming back, a notebook with patterns, and calibration numbers that are probably humbling. Day 30: one promoted
competency (signalpost sync), one shipped lab/BYO PR, and a timed-design score trend.

**Three-wave roadmap**
- **Wave 0 (this week, about 0 build, owner actions):** land `f52-wave`; adopt the usage gate (R5-01); pick a goal,
  date, weekly hours and one primary language; `bootquest sync` signalpost; run DOGFOOD.md for 7 days and log in
  LEARNING.md.
- **Wave 1 (S-M, no restamp, about 1 week build, *after* 7 days of use):** F1 core path + archive + new slate, F2
  practice mode, F3 fold, F4 confidence, F5 notebook, F7 goal/week page. Re-order Wave 2 by what the dogfood log
  says hurt.
- **Wave 2 (M, mostly no restamp):** F6 redo cards, F9 interview mode, F10 grading bridge, F11 placement, A2/A3
  contrasting cases and clean PRs, F8 concept index. **Wave 3 (L):** F13 BYO ticket and signalpost spec-hidden labs, A5
  debugging labs, A4 building-agents ladder, then one planned restamp bundle (F14 Parsons and anything else that
  truly needs it).

## 8. Coverage statement

- **Swept by script (all items):** every pack unit in `content/packs/*` (4,556 units incl. 3,357 drills, 544 quizzes,
  508 predict-output, 147 written): kind, track, difficulty, test count, XP, predict-output grading, "Why it works"
  structure. Every seed item in `content/seed/{quests,notes,explainback,patches,variants}`: 3,018 quizzes, 938
  flashcards, 3,776 reading steps, 3,660 notes, 244 EB sets (732 questions, 4,756 key points), 52 katas, 5 variants.
  For these: kinds, variety, explanation presence, repo-anchoring regex, provenance class, flashcard length, concept
  overlap for 13 concepts. Also all 73 Fundamentals topics (704 quiz, 558 flashcards, 116 drill keys, lesson length,
  level), the 3 campaign files, `related.json` (448 keys), and the owner DB (read-only: counts, slates, tracks,
  ratings).
- **Read in full (about 95 items):** 52 quest quizzes; 6 flashcards; 1 note; 3 bootforge drills + 1 predict-output; 1
  jstrain drill + 1 jstrain written; 3 sysdrills; 1 each of csdrills, javadrills, jstrain-cs, javabootcamp; 4
  Fundamentals topics (8 quiz items, 4 flashcards); 2 EB sets (DESIGN IT bazaar, G2 atlas-net: 6 questions,
  key points read in part); 1 kata; G3. Engine and UI code read for the loop: `service.ts` (submit, dashboard/next-up),
  `fsrs.ts`, `study-quest.ts`, `streak.ts` (slate), `estimates.ts`, `Review.tsx`, `Dashboard.tsx` (hero).
- **Not covered:** I did not run the app (R4's job), did not check keyed answers against pinned code (R1/R2/R3's
  depth), did not read Fundamentals lessons end to end, did not sample C#/Java quest packs separately from the random
  draw, and did not verify that the "restamp none" claims hold in the fingerprint test. The 65/35 trivia split is one
  reviewer's hand classification of 52 items. The hour totals use my own minute estimates for EB questions and study
  quests.
- **Web:** two searches (Execute Program spaced repetition of code tasks; Hello Interview guided practice). The other
  product descriptions are from general knowledge.
