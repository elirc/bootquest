# BootQuest full review, 2026-11-12: council of five Opus reviewers

**Target:** branch `f52-wave` @ `dc2206bc` (= `main` + Fundamentals ladder + f52 wave), reviewed read-only in a detached
worktree `C:\Users\Owner\Desktop\bq-review`. Nothing in the app or repo was changed.

**Method:** five Opus reviewers, each sweeping every item in a domain by script and then reading a stratified sample in
full (R1 Fundamentals, R2 repo-derived packs/quests/notes, R3 explain-backs/system design/campaign/agentic/katas,
R4 features/engine/UX with a live sandbox run, R5 learning design and whole-app skeptic). Round 2: each attacked two
other reports and all five voted on five contested questions. I spot-checked the headline code claims
(`hints.ts:40-42`, `service.ts:818-824`, `eb-score.ts:72-74`, `study-service.ts:160-176`, `Dashboard.tsx:34`).

| File | What |
|---|---|
| `BRIEF.md`, `ROUND2.md` | the reviewers' instructions |
| `R1-fundamentals.md` … `R5-learning-design.md` | round-1 reports (findings, CUT, ADD, methods, coverage) |
| `R1-round2.md` … `R5-round2.md` | cross-examination rulings and votes |
| `work/R1..R5/` | every probe script and its output (mutation runs, sweeps, DB queries, 24 screenshots in `work/R4/shots/`) |

Coverage: about 15,800 repo-derived items, 704 Fundamentals gate items (all read by hand), 244 explain-back sets (4,756
key points), 52 katas, 3,357 drills (hint and test sweeps; mutation runs on all 62 Fundamentals JS drills, all 129
sysdrills, about 600 bootforge and 78 jstrain drills), all 508 predict-output snippets executed, about 6,300 note excerpts
checked against the pinned code. Not covered: running the C#/Java drill banks (RAM), the 5 variants, reading-step prose.

---

## 1. Verdict

1. **The content is accurate.** No wrong answer keys were found anywhere checked: 704/704 Fundamentals items, 508/508
   predict-output keys, 25/25 new code-truth checks against the pinned repos, and every note excerpt matches the code at the pin.
2. **Nobody has learned from it yet.** The owner DB still has **0 attempts, 0 XP, 0 reviews**. The dashboard was opened on
   5 days, and nothing was ever submitted. 1,147 commits went in over 34 days. The content adds up to about 980 learner-hours
   (≈5 years at 30 min/day).
3. **The daily loop leads away from the best material.** DESIGN IT, the review katas, G2 briefs and Fundamentals JS 21-33
   are senior-grade. But the slate is four drill slots across three languages plus a repo-reading quest, and next-up never
   offers an explain-back or kata while anything else is open. The streak can't grow if you follow the hero.
4. **The app gives away answers where it should withhold them, and withholds where it should give.** The sysdrills hint the
   server serves *is* the formula, 209 drills explain the answer above the task, and a failed gate leaves the lesson and all
   questions on screen. Meanwhile corrective feedback is held back, and 78% of drills can never show a hint.
5. **The fix is mostly subtract, re-route and repair, not build.** Almost all of it is restamp-free.

---

## 2. Council rulings on the contested questions

| Q | Ruling | Vote |
|---|---|---|
| **Q1 Restamp scope** | **AGENTS.md overstates it.** Bound: (a) code packs → the runner file lists in `server/src/store/grader-fingerprint.ts:56-101` (note `runners/csharp/scratch.ts` is in **both** the C# and Java lists), the validate gate and toolchain versions (a Node upgrade restamps everything); (b) seed packs → `server/src/api/runners.ts`, 11 `shared/src` files in the seed closure (incl. `api.ts`, `enums.ts`, `check.ts`, `schemas.ts`, `seed-pack.ts`, `thresholds.ts`) and the factory; (c) campaign map → its seeder + `shared/src/campaign.ts`. **Free:** engines, services, `api-ext.ts`, `eb-weight.ts`, migrations, client, CLI, server-local side files. Changing the 80% number restamps (`thresholds.ts`); changing the rule in `eb-score.ts` does not. Replace the AGENTS.md line with this exact list. | 5-0 |
| **Q2 Freeze vs add** | **Freeze all new content units until a usage gate is met** (proposed: ≥100 graded attempts over ≥14 distinct days, one `SELECT`). Repairs to items on the learner's path, integrity/honesty fixes, routing side files and grading-rule fixes are exempt. | 5-0 on freezing; threshold 3 votes 100/14, R4 30/7 |
| **Q3 Honesty model** | **Split it.** *Practice:* immediate per-item feedback, free hints, never evidence. It must be a grading endpoint that **records nothing**, because today any recorded attempt unlocks topics, ticks slots and pays XP (R4). *Evidence:* server-side retry budget, no per-question marks on a fail, a fresh question set on retake (later), a minimum real answer for explain-backs, XP on first try only. Self-scored kinds (EBs, design) stay answer-first. Practising the same 10 items leaks the Evidence gate, so until a set B exists an Evidence gate opens ≥2 days after the last practice. | 5-0 |
| **Q4 Archive scale** | **R5's ~3,100-unit wholesale archive is rejected.** It deadlocks the campaign (act N+1 unlocks at 80% of act N's core: JS act 1 would keep 2 of 12 needed, C# acts 1-2 keep 0). It also hides 36% of the Fundamentals "more practice" drills, 73 of 94 transferable classic EBs and all 513 React drills. **Adopt a unit-grain archive side file of ~1,500-2,200 units** that `campaign.ts` core counting also reads, exempting `related.json` keys. Nothing deleted, keys unchanged. | 4-1 (R5 dissent) |
| **Q5 Fundamentals before landing** | **Fix first, time-boxed to 1-2 days, then land; land anyway if it slips past a week.** After landing the byte-identical rule freezes the ladder. Must-dos are in §3 Wave 1a. Owner option (R5): change the freeze rule so an item freezes at its first attempt in the owner DB (today the rule protects 0 rows). | 5-0 |

---

## 3. The plan, ranked by skill gain per build hour

### Wave 0: owner actions (no build)
1. **Pick a goal, a date, weekly hours and one primary language for 90 days.** Turn the other language slots off
   (`slate_setting` already supports it).
2. **Adopt the usage gate** (Q2) and write it in AGENTS.md so agents refuse new content waves.
3. **Land `f52-wave`** after Wave 1a. Run `bootquest sync` on signalpost once: it is the only thing that makes any
   competency promotable (`sync_run` = 0 today, all ratings at 1).
4. **Use it for 7 days** (DOGFOOD.md) and log what hurt in LEARNING.md. Re-order Wave 2 by that log.

### Wave 1a: Fundamentals fix pass before landing (1-2 days, content only, no restamp)
| Fix | Evidence |
|---|---|
| Renumber SQL 29-32 → 21-24 (shift 21-28 up). Topics 21-27 already use UPDATE/WHERE/OFFSET/IN/ALTER. | R1-06 |
| Add the missing tests: java/08 `"1.2."` and `"+1"`; js/13 deterministic start counting (not timers); js/07 tie case; js/28/03 statuses 500/400; js lazy-chunks size 1; a sentence in js/33/01 that timing safety isn't tested. | R1-03, R2-r2 |
| Make ~30 keys per track the **shortest** choice (today 2-8% vs ~16% in clean content) and extend `seed:lint:answers` to check the full length-rank spread (f52 only checks longest/shortest, which the rewrite slipped past). | R1-01 as weakened by R2 |
| Rewrite the ~22 items that show the lesson's own code with the answer beside it. | R1-02 as weakened by R2 |
| Replace 4 version/compiler-number items (`csharp/02 q8`, `csharp/11 q6`, `java/16 q3`, `java/14 q9`), fix stale ".NET 8" distractors, the 2 raw ``` fences (`js/02 q01/q02`), and add the 3 missing lesson sentences (`js/04 q10`, `java/06 q8`, `csharp/18 q7`). | R1-13/14, R4-13, R1-11 |
| Drop the ~14 off-topic `related.json` mappings. | R1-09 |

### Wave 1b: app repairs (S-M each, no restamp; this is the core of the review)
| # | Change | Why | Files |
|---|---|---|---|
| 1 | **Gate integrity.** On a failed gate return no per-question marks (`items: []` is schema-legal), keep the question list off screen, add a server retry budget (e.g. 3rd graded try in 24 h → 409), hide "Try again" after a pass. Mark campaign study-quest retakes `prior-key` once a miss card was shown. | A gate falls to blind guessing in 3 submits (+50 XP, solo, next topic unlocked); the fail screen is open-book; the cooldown is client-only. | `api/study-service.ts`, `service.ts`, `StudyQuestPane.tsx` |
| 2 | **Stop handing over answers.** Fold the "Why it works" section until the first failed submit or pass (209 drills). Swap sysdrills hints 2↔3 (hint 2 is the formula in 127/129 and is the one served). Per-bank hint policy: serve all bootforge hints (1,388 single-hint drills currently show none). Fold the same comment runs in kata **context files** (14/52 leak) and mask finding markers. | The task grades typing, not reasoning; the f52 kata fold is defeated. | client Player, `hints-service.ts`, authoring/sysdrills, `LadderPanes.tsx` |
| 3 | **One finishable day.** Default slate = reviews + the hero's Fundamentals step + one senior rep; a Fundamentals step fills a slot; the streak counts that day. Remove the Next up panel (it contradicts the hero and offers G3 on day one). Add a 10-minute mode. | Following the hero leaves the streak at 0 forever; 3 languages on day one. | `engines/streak.ts`, `settings-service.ts`, `Dashboard.tsx` |
| 4 | **Route to the senior content.** Path side files `content/paths/{sysdesign,agentic}.json` (sysdrill module → the DESIGN IT sets that use it, mid before senior; agentic G2 → katas easy→hard → G3 → G4). A rotating "senior rep" slot (design / kata / fund-js 21-33). | DESIGN IT waits until all 129 sysdrills pass; agentic next-up is the last unit; browsers sort by repo name. | `service.ts`, `trackunits.ts`, side files |
| 5 | **Make DESIGN IT, G2 and katas passable and honest.** Allow at most one `[w3]` miss (49% of design key points are `[w3]`, so covering 80% of points passes ~12% of sets). Decide this **now**, while there is zero evidence. G2 open-book with a pinned-repo link (needs a tiny `api-ext` source endpoint). G1 counts only defects in the patched lines (59/120 are downstream consequences). Minimum real answer for EBs ("x, x, x" passed 18/18 with evidence). Blind mode on by default for [senior]. | The best material can't work as graded. | `eb-score.ts`, `ladder-service.ts`, `LadderPanes.tsx`, `api-ext.ts` |
| 6 | **Review cards you can answer.** Put the choices on quiz-miss card fronts ("Which of these values is truthy?" shows no choices). Pay review XP once per card per day (Again-farming pays). Quiz retries pay 0 XP after a failed first try. | | `study-service.ts` `reviewCardText`, `engines/xp.ts` |
| 7 | **Archive side file** (Q4), unit grain, read by next-up, slate, track browser **and** campaign core counting. First contents: 544 bootforge quizzes (78% longest-is-key), ~560 bootforge micro-drills that are also weakly tested, 47 `finding-location` quizzes, 15 two-choice quizzes, 12 duplicate campaign skims, the thinner pack's gate in each of 15 twin-pack pairs, 26 beginner + 14 owner-tooling classic EBs (demote, not retire), G4 → drill, and repo-recall flashcards out of FSRS. | Shrinks the active surface by ~40% without breaking unlocks. | `content/archive.json`, `service.ts`, `streak.ts`, `trackunits.ts`, `engines/campaign.ts` |
| 8 | Small: fix the misleading "run restamp" error when checkouts are mixed (`serve.ts`); retitle campaign quests by concept, not repo slug; move the 40-option focus form off the dashboard; hide the inert competency table until a promotion path exists. | | various |

### Wave 2: after the usage gate (M, mostly no restamp)
- **Spaced production.** Four reviewers proposed it independently: only recognition is spaced today. Redo cards for passed
  drills/katas use the existing unused `review_item` kind `'concept'` (a new kind would touch `api.ts` → restamp). Serve a
  *sibling* drill, at most one a day. Add missed-key-point cards for EBs, and spaced re-gates of passed Fundamentals topics.
- **Practice mode endpoint** (Q3), confidence tags on graded answers, a calibration panel, a one-line **error notebook**
  whose entries become cards, and a **weekly review page** (`bootquest week`).
- **DESIGN IT interview mode**, S version first: a timer, blind by default, framework headings. Later: clarifying-question
  menu, an auto-checked estimate box, and one follow-up probe. Plus a headline + dimension side file (≤12-word tick targets;
  "you miss failure handling in 7 of 9 sets").
- **"Ask Claude" copy-prompt / offline grading bridge** (owner decision: it bends the no-runtime-LLM rule). The app writes
  question + answer + rubric to a file; you grade in your own Claude Code; the import is advisory evidence only.
- **Placement by production** for working engineers (don't start a senior on `typeof null`), and **window-based demotion**
  (shipped together with the first promotion path; today one forgotten card would void banked legs almost daily).
- Concept index side file plus interleaved concept sessions (idempotency appears in 292 items across dozens of repos,
  unlinked).

### Wave 3: new content, once the gate is met
1. **Bug-hunt drills** from each Fundamentals drill's own named wrong solution, using its existing tests (~49+, cheapest new practice).
2. **Agent engineering:** an eval lab on recorded model outputs, agent-PR katas with clean and nit-only decoys, context-budget drills, G2s on prompt injection, tool-design katas. Today: 0 files mention prompt injection or context windows.
3. **C#/Java senior topics** (testing, authN/Z, HttpClient, logging, background work, serialization). Real ASP.NET Core/EF Core drills are feasible offline from the local NuGet cache, but `scratch.ts` restamps all C# and Java packs: bundle it into one planned restamp. **Java 21** (owner decision): the lessons currently teach the Java 17 workaround.
4. **8 classic design problems** (typeahead, proximity, top-K, ID generator, lock with fencing, time-series with SLOs, media/CDN, crawler) and the 6 unbuilt CRUD primaries.
5. **Repo-native practice:** reimplement-a-function-from-the-repo (40, tests generated from the pinned code), kill-the-mutant test-writing, trace-the-request as an ordered answer, contrasting cases (compare two designs/PRs), postmortem/ADR review katas.
6. Parsons problems, only inside a planned restamp bundle.

**Deliberately not recommended:** more repos or breadth ladders, a sixth track, an in-app LLM tutor, leaderboards, PWA/LAN exposure, video.

---

## 4. Owner decisions needed
1. Usage-gate threshold (100 attempts / 14 days proposed) and whether the freeze rule moves to "frozen at first attempt".
2. One primary language for the next 90 days.
3. EB pass rule: "≤1 `[w3]` miss" (or a weight-override side file). Decide before any evidence exists.
4. Streak rule: a Fundamentals step fills a slot (preferred) vs "50 XP grows the streak".
5. Offline Claude grading bridge: allowed, as advisory evidence?
6. Java runner to JDK 21? Real-framework C# drills (one planned restamp)?
7. Archive scale within the 1,500-2,200 range.

## 5. Upstream report items (not fixes)
- bootforge: ~200 drills accept a plausible wrong solution (survivor list `work/R2/mut-bootforge.json`); quizzes 78% longest-is-key. jstrain: ~27% of mutable drills have real gaps (`work/R2/mut-jstrain.json`); 12 "written" print-prediction items could be machine-checked.
- sysdrills (authored here, fixable): 02/06 shard count, 16/01 soft-delete unique and others listed in R2-r2. Duplicates 01/07 and 06/04 still ship.

## 6. What holds up (keep, don't churn)
Accuracy across the estate; the hero's first step; the keyboard gate stepper; CodeMirror; the pass panel; the course
rail; the alternate EB sets (genuinely different angles); "first try, solo" stats; the 390 px layout; hint XP economics;
migration 019. R4 saw no console errors live.
