# R4 · Every app feature: client UX, server engine, CLI (review 2026-11-12)

Target: `f52-wave` @ `dc2206bc` (read-only). Live check ran the identical commit from `bq-f52-hub` on ports
4390/5390 against a `copydb.cjs` copy of the owner DB (`work/R4/r4.db`), driven by `cdp.mjs`. Screenshots are in
`work/R4/shots/`, probe scripts are in `work/R4/*.mjs|*.cjs`. All processes were stopped afterwards, and `bq-f52-hub`
is still `git status` clean.

**Deviation:** `npm run app` from `bq-review` refuses to start (R4-19). `bq-review/node_modules` is a junction into
`bq-f52-hub`, so the two fingerprint modules compute different repo roots. I ran the same SHA from `bq-f52-hub`.
`bq-review`'s own `node_modules` resolves there anyway, so this changes nothing about what was tested.

## 1. Verdict

- **The f52 flow works.** A new learner gets one obvious next step, a readable lesson, a keyboard quiz stepper,
  CodeMirror, hints, a pass panel with explanations and a course rail. Day one is much better than in the 11-09
  review.
- **The honesty model has holes the wave added or left open.**
  - A Fundamentals gate can be passed blind in 3 API submits, or open-book in plain UI after one free fail.
  - On 127 of 129 sysdrills, the served hint 2 is the solution formula.
  - An explain-back answered "x, x, x" passes and records evidence.
- **Engine "fixes" are real in code but inert in use.** Demotion is now wired. Once promotion becomes possible, it
  would fire almost daily from normal FSRS forgetting and wipe the legs already banked.
- **The streak cannot grow if you follow the app's own advice.** The hero says "Done for today ✓" at 50 XP, but
  the streak only goes up after a full 5-slot slate across 4 languages.
- **The owner has opened the app in 8 sessions since 10-15, with 0 attempts.** The product problem is getting
  started, not missing content.

## 2. Owner DB real usage (copy taken 2026-11-12)

| Measure | Value |
|---|---|
| attempt / run / xp_event / evidence / review_item / review_log | **0 / 0 / 0 / 0 / 0 / 0** |
| competency_rating | 8 rows, all 1 |
| daily_slate | 26 rows, 2026-10-15 to 2026-11-09: 25 `missed`, 1 `open`, total XP 0 |
| distinct slate-creation moments | **8** (the dashboard was loaded in about 8 sessions; the last was 2026-11-09 23:03 UTC) |
| streak | current 0, longest 0, tokens 0 |
| slate_setting / sync_run / unit_prerequisite / unit_ref / content_ref | 0 / 0 / 0 / 0 / 0 |
| schema_version | 18 (`019_hint_taken` migrates on the next start of f52) |
| last server start (backup file) | `bootquest-20261104T205405.211Z.db`; `-wal`/`-shm` files present, owner app not running |

So the earlier "0 attempts" finding still holds, with one addition. The owner did **look** at the app about 8 times
and never pressed Submit. **VERIFIED** (`q.cjs` queries on the copy).

## 3. Feature inventory

Legend: L = seen live in the sandbox, C = code read, — = not exercised.

| Feature | Works | Reachable | Keep? | Main friction (finding) |
|---|---|---|---|---|
| Dashboard hero "next step" | L yes | 1st thing on the page | **keep** | Hero card is mostly empty space; "Done for today" contradicts the streak (R4-05) |
| Today's slate | L yes | top right | keep, reshape | 5 slots across 4 languages + a repo study quest; Fundamentals gates tick no slot (R4-05, R4-11) |
| Slate settings ("Choose your focus") | L renders | bottom of dashboard | move | 40 `<option>`s at the page foot; changes apply tomorrow |
| Streak / heatmap / freezes | L yes | tiles | keep | Increments only on a full slate (R4-05); Again-farming keeps it (R4-14) |
| XP / levels | L yes | tile | keep, re-weight | Global level gates every track's acts (R4-24) |
| Campaign acts (JS 5, C# 5, Java 3) | L yes | g c | keep, retitle | Act 1 = 15 parallel quests named by repo slug (R4-11) |
| Campaign tree view | C | Campaign › Tree | **cut** | Renders exactly the list payload (`CampaignTree.tsx:3-6`) |
| Fundamentals ladder (73 topics) | L yes | hero, campaign card | **keep (core)** | Gate integrity (R4-01, R4-02); fences (R4-13) |
| Lesson + check-yourself cards | L yes | /play/fund | keep | Checks exist only for JS 01-05 (known) |
| Quiz gate stepper + review screen | L yes | Start quiz | keep | Raw ``` fences; "solo attempt #6" label (R4-13, R4-15) |
| Gate pass panel (answers + explanations, course rail, next) | L yes | after a pass | keep | "Try again" offered after a pass (R4-16) |
| Drill player + CodeMirror + run/submit | L yes | /play/drill | **keep (core)** | — |
| Hints bar (019) | L/API yes | after a failed submit | keep, fix | Sysdrills hint 2 = solution (R4-03); 75% of drills have no hint (R4-12) |
| Reveal solution | C | player | keep | — |
| Campaign single-question quiz / predict-output | L yes | campaign | demote | Trial-and-error, full XP (R4-09) |
| Campaign study quests (repo reading list + gate) | L yes | slate campaign slot | keep, reshape | Open-key retake after 24 h, recorded solo (R4-01b) |
| Review (FSRS) session | L yes | g r, hero | **keep (core)** | Card fronts without choices (R4-06); Again pays like Good (R4-14) |
| Explain-backs / DESIGN IT | API yes | track lists | keep | Trivial answers pass (R4-07) |
| Patch katas | — | track lists | keep | Not exercised live |
| Written units (147) | C | track lists, palette | demote | 0 XP, never a pass target |
| Reading self-attest (132) | C | campaign | demote | 5 XP per click |
| Sysdesign / agentic track browsers | L yes | Campaign tabs | keep | Groups named by repo slug ("master", "opusorganize 12") |
| Ctrl+K palette / search | L yes | everywhere | keep | 42 hits for "idempot" across 6 banks (content duplication: R1-R3's domain) |
| Due now / weak spots | L yes | dashboard, stats | keep | Weak spots count blind-guess misses as weaknesses |
| Stats (XP, pass rates incl. **first try solo**, reviews, evidence) | L yes | g s | keep | The first-try metric is the one honest number; make it prominent |
| Competency ladder (8, three-leg promotion) | C | dashboard (collapsed) | hide until live | Inert end to end (R4-20); demotion design (R4-04) |
| Next up panel | L yes | dashboard bottom | **cut/merge** | Contradicts the hero (R4-10) |
| Mixed drills | C | slate | keep | — |
| Backup on start (keep 7) / manual restore | L (2 backups made) | automatic / README §121 | keep | Restore is manual copy-over |
| CLI `today/status/slate/run/submit/sync/reset/mutate` | L `today` | terminal | trim | Disagrees with the dashboard; `mutate` serves 2 units (R4-17) |
| GitHub sync | C | CLI/API | keep | Never run (`sync_run` 0): it is the only switch that makes promotion possible |

## 4. Findings (ranked)

| id | Sev | Tag | Evidence | Proposed fix (size · files · restamp) |
|---|---|---|---|---|
| R4-01 | **P1** | VERIFIED (live) | **A Fundamentals gate falls to blind brute force in 3 submits.** The failed-submit response lists missed questions in both `studyQuiz.items[].correct` and the `output` string ("missed Q2, Q3…", `study-service.ts:164-174`), and the served choice order is stable per unit. `work/R4/brute.mjs` on unit 5233: 4/10 → 7/10 → **8/10 pass, mode solo, +50 XP**, next topic unlocked, 8 flashcards enrolled. No server rate limit: the 3-minute cooldown is client `localStorage` (`bq:gate-fails:v1:<id>`). Scale: act 2 needs level 4 = 869 XP = **18 blind gates**. (b) Campaign study quests (non-Fundamentals) release a missed question's key when its card is due (`notes-service.ts` rule (c)), and a retake the next day is recorded `solo` (`attempts.ts deriveMode`: no prior-key for submits). | S · `server/src/api/study-service.ts` + `service.ts`: on a **failed** gate return `items: []` (the schema allows it, `api.ts:599`), no Q numbers in `output`/`failures`, and send re-read headings server-side. Enforce a server retry budget from the ledger (e.g. the 3rd graded try in 24 h → 409). Mark a study-quiz retake as `prior-key` when any of its miss cards has been shown. **No restamp** (neither file is in `FINGERPRINT_FILES`). |
| R4-02 | **P1** | VERIFIED (live) | **A failed gate is open-book in plain UI.** After a failed submit the lesson comes back **and all 10 questions with your picks stay on screen**, and "Try again" sits beside them (`StudyQuestPane.tsx:232` `gateOpen = started && submit === null`; `:312`; shot `07-gate-fail.png`). Read the lesson against the questions, retry, pass solo. The first fail has no cooldown. | S · client: on a fail render only score + "Re-read: <headings>" and drop the question list until a pass. Test in `gate-failpath.test.tsx`. No restamp. |
| R4-03 | P2 | VERIFIED (script + read) | **The hint that the server serves is the solution for sysdrills.** The server serves all but the last authored hint (`engines/hints.ts:40`), but the ab-wave reshape put the formula at H2 and approach prose at H3. Served H2 is formula-level in **127/129 sysdrills** (e.g. `01-qps-from-dau` H2 `avgQps = dau × requestsPerUser ÷ 86,400`; `14/09-multi-window-burn-alert` H2 gives the full threshold) and API-level in ~50/72 csdrills. Repro: submit the starter (free fail) → 2 hints → pass at 50% XP; the slate drill slot ticks. This is the 10-30 "sysdrills hint leak" moved from H3 to H2. | S · `server/src/api/hints-service.ts`: a per-bank servable map (sysdrills serve [H1, H3]; csdrills serve H1 only), or a lint that fails a servable hint matching formula/API patterns (`work/R4/hintleak.cjs`). No restamp. |
| R4-04 | P2 | VERIFIED (code) + JUDGMENT (rates) | **Demotion is wired but would wreck the ladder once it can fire.** Cards now carry the unit's first competency (`study-quest.ts:79`), so every Fundamentals card (558 flashcards + miss cards) demotes `language-fluency` on a Review-state lapse, capped at 1/day (`fsrs.ts:165-177, 233-235`). ts-fsrs targets 90% retention, so about 1 in 10 review-state reviews lapses: with ≥10 such reviews a day, P(≥1 lapse) ≈ 65%. Each demotion moves `lastRatingChangeAt` (`evidence.ts:238-250`), and every leg must postdate it (`:281`), so a forgotten `typeof null` card also **voids banked artifact, EB and retest legs**. Today it is inert: all ratings are at the floor and no promotion path exists (R4-20). | M · `engines/fsrs.ts` + `evidence.ts`: demote on **retention below a threshold over a window** (e.g. <70% over the competency's last 20 review-state reviews, max once per 7 days); never reset the leg window on a recall demotion. No restamp. |
| R4-05 | P2 | VERIFIED (live + code) | **Hero and streak disagree.** After 55 XP the hero says "**Done for today ✓ · streak safe**" (`Dashboard.tsx:42-47`, `DONE_XP = 50`) while the Streak tile stays at 0. A partial day (≥20 XP) keeps the streak but never increments it (`streak.ts:415-425`); only a full slate counts. The default slate is 4 drill slots (JS, C#, Java, sysdesign) + a campaign quest (≈1-1.5 h), and a Fundamentals gate pass ticks **no** slot (the campaign slot wants a unit a campaign quest points at, `streak.ts:86-90`). A learner who follows the hero every day keeps a streak of 0 forever. | M · owner decision (f52 D2). Option A: a Fundamentals step satisfies the campaign slot, and the default slate = reviews + 1 Fundamentals step + 1 drill. Option B: a "done" day (≥50 XP) increments the streak. `engines/streak.ts`, `settings-service.ts`, client copy. No restamp. |
| R4-06 | P2 | VERIFIED (live + script) | **Quiz-miss review cards drop the choices.** The front is the bare MCQ prompt: card 1 on day one read "**Which of these values is truthy?**" with nothing to choose from (shot `11-review-front.png`; `study-service.ts:183-212` builds the front from `prompt` only). Regex sweep: 17/704 Fundamentals prompts ("which of these / which statement…") depend on their choices (the examples read true). Up to 49/3,018 seed-quest quiz prompts also match, but that count is unreviewed and includes false positives. Every gate miss becomes such a card. | S · `reviewCardText`: for quiz-miss cards, front = prompt + the choices as a list (the back already names the keyed text). `server/src/api/study-service.ts`. No restamp. |
| R4-07 | P2 | VERIFIED (live) | **An explain-back passes on a trivial answer.** DESIGN IT unit 4988: answers `["x","x","x"]` → key released → self-score 18/18 covered → `passed: true`, **+20 XP, explain-back evidence for 2 competencies, mode solo** (`work/R4/eb.mjs`, `eb2.mjs`). The weights (A5) are real now (`eb-score.ts:58-80`), but they weigh whatever you claim. | M · `ladder-service.ts` + new table: per key point compute token overlap between the answer and the key point. Below a floor (e.g. answer <15 words or 0 shared content words), "covered" asks for confirmation and is stored with `low_overlap`; Stats shows a calibration rate. No restamp (new migration only). |
| R4-08 | P2 | VERIFIED (code) | **Honesty flags carry no consequence anywhere reachable.** "Show lesson" ticks "I had help", yet an assisted gate pass earns the same 50 XP (`xp.ts:118-170` never reads mode), unlocks the next topic and enrols flashcards (`VERIFIED_PASS_SQL` any mode, `campaign.ts`), and completes the topic. Only Stats' first-try rate and the (unreachable) promotion legs read it. The closed-book ceremony is decoration. | S · pick one: an assisted gate pass schedules a closed-book **re-gate in 2 days** before the next-next topic unlocks (honest, uses `review_item` kind `'concept'`, which exists unused), or drop the ceremony. Server `study-service`/`fund` + client. No restamp. |
| R4-09 | P3 | VERIFIED (live) | Campaign single-question quizzes are trial-and-error: unit 1 answered 0 ✗, 1 ✗, 2 ✓ → **solo, +2 XP**, quest progress counted. 544 quiz + 508 predict-output units behave this way. | S · `engines/xp.ts`: XP only when the unit's first graded submit passes; later passes mark done at 0 XP (reason `retry`). No restamp. |
| R4-10 | P3 | VERIFIED (live) | **Next up contradicts the hero.** JS Next up = bootforge "Quick check" while the hero = Fundamentals 01 (`service.ts:817-826` knows nothing of Fundamentals). Agentic Next up = **G3 live delegation** (open a PR via Claude Code), whose own text says do it after G1 + G2 at level 8+ (shot `22-agentic-g3.png`). The CLI `today` prints the same list. | S · drop the panel (the hero, the slate and the Campaign page cover it), or make server nextUp prefer the Fundamentals step and skip project kinds. No restamp. |
| R4-11 | P2 | VERIFIED (live) | **The day-one campaign step is a repo-reading assignment.** Slate campaign target = `campaign/js/grok-js`: 17 GitHub sections (mostly a 1,400-line markdown) + a 14-question gate (shot `20-campaign-study-grokjs.png`). JS Act 1 lists 15 parallel core quests **titled by repo slug** (`organized-js-training-jsdrill_sync_20260223_125137`, `dotnet-snapshot1` inside a JS act, `1jstrain2.2v2`, `js1`). | M · campaign titles from the pack summary (campaign files are generated + hash-checked: `seed:campaign`), and for language tracks let the Fundamentals ladder **be** act 0 of the campaign. Content/campaign build, no fingerprint. |
| R4-12 | P2 | VERIFIED (script) | **75% of drills have no hint**: 834 of 3,357 serve one; jstrain 855, javabootcamp 168, jstrain-cs 81, csbootcamp 31 and 1,388 bootforge serve none. The C# and Java day-one Next up drills (`csbootcamp/.../count-vowels`, `javabootcamp/...`) show no hint bar, so Reveal (0 XP) is the only help. | M content (R1-R3's domain): author H1/H2 for the 3 Next-up banks first (280 drills). Interim S: a generic H1 "your first failing test is X; re-read its name" from the run result (client). |
| R4-13 | P3 | VERIFIED (live + script) | Raw ``` fences render in the gate (stepper and review screen): `fund:js/02-…/q01`, `q02` ("What does this log? \`\`\`js console.log(x); var x = 5; \`\`\`"). 2/704 items. `InlineProse` has no fence support. | S · content edit (Fundamentals is not on main yet, so it is still editable) or a fence branch in `lib/prose.tsx`. |
| R4-14 | P3 | VERIFIED (live) | **Review XP is farmable.** 14 Again grades = **14 XP**, live. Again on a new/learning card re-dues after ts-fsrs's first learning step (1 min by default; I did not time it), so 20 XP (streak kept) costs a few minutes of pressing 1 (`xp.ts awardReviewXp` pays any grade; cap 30/day). | S · pay review XP once per card per day, and only for the card's first grade that day. `engines/xp.ts`/`fsrs.ts`. No restamp. |
| R4-15 | P3 | VERIFIED (live) | The gate result reads "**solo attempt #6**", which is the global attempt id, not this unit's try number. | S client. |
| R4-16 | P3 | VERIFIED (live) | "Try again" is offered after a **pass**, with every keyed answer still on screen (shot `24-gate-pass.png`). | S client: hide it after a pass. |
| R4-17 | P3 | VERIFIED (live) | CLI `today` says "Streak: 0 days - today not complete yet" while the dashboard says "Streak safe for today ✓" (same server, 69 XP). The CLI has no Fundamentals step. `run/submit` work for any unit via `.bootquest.json` (solving drills in your own editor), but nothing in the UI says so; `mutate` serves only project units (2 in the DB) and is not a promotion leg. | S · `cli/src/format.ts`: show the partial-day state; document "solve this drill in your editor"; hide `mutate`. |
| R4-18 | P3 | VERIFIED (grep) | Dead schema: `skill_node` and `skill_node_prereq` are never inserted (`store/campaign.ts:278` only deletes); `review_item.kind` `'concept'` and `'finding'` are never created. | S · reuse `'concept'` for R4-08/A7, else drop it. Migration only. |
| R4-19 | P3 | VERIFIED (live) | `npm run app` in a checkout whose workspace junctions point at another clone refuses with "IMPORT_GATE_FILES names … run `npm run seed:check -- --restamp`". **The suggested remedy is wrong and expensive**: nothing is stale, the roots differ. | S · reword in `server/src/api/serve.ts` (catch + explain mixed checkouts). Do **not** touch `factory/fingerprint.ts` (fingerprinted). |
| R4-20 | P2 | VERIFIED (DB) | **Still unfixed (04-REVIEW #1-3):** no competency is promotable in the owner DB (0 `unit_prerequisite`, 0 `unit_ref`, `sync_run` 0, all ratings 1). The competency table, the demotion rule and `GET /evidence` describe a layer nobody can move. | Run `bootquest sync` of signalpost once (zero code), or hide the ladder UI until it is live. |
| R4-21 | P3 | VERIFIED (code) | **Still unfixed (f52 deviation):** `GET /evidence` lists a hinted pass as assistance `none` (live: evidence id 5 for the hinted drill 5131). | S · derive "hint" in `ladder-service` read path (no enum change: add an `hinted: boolean` in an api-ext DTO). |
| R4-22 | P3 | JUDGMENT | **The default slate interleaves 3 languages + sysdesign + a repo quest on day one**, while the hero only ever walks the JS ladder. For one learner, the slate should follow the hero, not compete with it. | Part of R4-05 option A. |
| R4-23 | P3 | VERIFIED (live) | The hero card stretches to the slate's height with the button floating in empty space (shot `01-dashboard.png`). The settings form (40 options) sits at the foot of the dashboard. | S client (`dashboard.css`). |
| R4-24 | P3 | JUDGMENT | **A global level gates every track's acts** (`campaign.ts` header): JS Fundamentals XP unlocks C# act 4 (level 12). The level gate measures grind, not readiness, and per R4-01 grind is cheap. | M · gate acts on per-track core % only; keep levels cosmetic. `engines/campaign.ts`. No restamp. |

**Checked from the brief:**
- 10-30 "cosmetic EB weights" is **fixed** (`eb-score.ts`; the XP check uses `EB_PASS_SQL`).
- 10-30 "dead demotion" is **plumbed but inert** (R4-04, R4-20).
- 10-30 "sysdrills hint-3 leak" **came back as hint 2** (R4-03).
- `019_hint_taken` applied cleanly (schema 19 on the copy). Its append-only triggers are in place, and the XP cut
  is correct: 10 XP × 50% = 5 after 2 hints, live.
- FSRS: fuzz is off and new cards are first due the next day.
  - A re-missed gate item re-grades as Again without XP or a log row (`fsrs.ts:122-130`).
  - Held Fundamentals miss cards are excluded by `REVIEWABLE_SQL` (`fsrs.ts:150`). I only saw them **after** the
    pass; the hold before a pass was not exercised live.
- The Fundamentals completion rule (gate + ≥1 drill) holds live: topic 1 showed "1 complete · 1 gate passed".
  Hinted passes count toward it.

**What works well (keep, do not churn):**
- The hero picks the right first step on a fresh DB.
- The stepper is fully keyboard-driven.
- Closed-book holds on the first try.
- The pass panel shows answers and explanations and points to the next drill.
- The course rail, CodeMirror and the quiet failed-test list all work.
- The hint bar copy is clear.
- The palette search is fast.
- Weak spots and Stats' "first try, solo" rate are honest.
- The 390 px layout has no overflow (`scrollWidth == clientWidth`).
- No console errors appeared on any page I drove.

## 5. CUT (remove, merge or demote)

| What | Count | Why |
|---|---|---|
| Campaign **Tree** view (`CampaignTree.tsx`, `lib/skilltree.ts`, toggle) | 1 view, ~2 files + tests | Same payload as the list; adds a mode to a page that already has three sections. |
| Dashboard **Next up** panel | 5 cards | Contradicts the hero and offers G3 on day one (R4-10). Keep "Browse all" links on the Campaign page. |
| Dead tables `skill_node`, `skill_node_prereq` | 2 tables | Never written (R4-18). |
| `bootquest mutate` + `POST /units/:id/mutation` from help and UI | 1 command | Self-reported, not a grader or promotion leg; serves 2 project units; needs Stryker. Keep the code, hide it. |
| Competency table on the dashboard | 8 rows | Inert (R4-20). Move it to Stats until a promotion path exists. |
| XP for campaign quiz/predict retries; 5-XP reading self-attests | 1,052 + 132 units | Pays for clicking. Mark done at 0 XP after a failed first try (R4-09); reading = 0 XP. |
| "Choose your focus" form on the dashboard | 1 panel | Move to a small Settings page or a hero menu. |
| Agentic **G3/G4** from any "next" surface | 2 units | Advanced external tasks; their own text gates them behind G1/G2 + level 8. |
| Default slate's C#/Java/sysdesign slots for a JS-first learner | 3 of 5 slots | Day one should be one language (R4-22). Default = reviews + 1 Fundamentals step + 1 drill. |

## 6. ADD (app features that close gaps, not content)

| # | What | Size | Files | Restamp |
|---|---|---|---|---|
| A1 | Gate integrity server-side: no marks on fail, a retry budget, prior-key on open-key retakes (R4-01) | S | `api/study-service.ts`, `service.ts` | no |
| A2 | Closed fail screen: score + re-read headings only (R4-02) | S | `StudyQuestPane.tsx` | no |
| A3 | Choices on quiz-miss card fronts (R4-06) | S | `api/study-service.ts` | no |
| A4 | Per-bank hint ordering + a formula-leak lint (R4-03) | S | `api/hints-service.ts`, `tools/seed` lint (not factory) | no |
| A5 | Hero-aligned slate + streak (R4-05) | M | `engines/streak.ts`, settings, Dashboard | no (owner decision) |
| A6 | Window-based demotion that keeps banked legs (R4-04) | M | `engines/fsrs.ts`, `evidence.ts` | no |
| A7 | EB overlap and calibration signal (R4-07) | M | `ladder-service.ts`, migration 020 | no |

**Restamp note.** The brief says "server/src and shared/src are fingerprinted". That is broader than the code.
Only the files in `server/src/store/grader-fingerprint.ts:56-101` are bound: runners, `api/runners.ts`,
`runner-csharp.ts`, `runner-java.ts` and the validate gate. Add to those the `shared/src` modules the seed closure
imports (`api.ts`, `enums.ts`, `check.ts`, `schemas.ts`, `seed-pack.ts`). Services, engines, migrations, the client,
the CLI and `shared/src/api-ext.ts` are free to change. Everything above sits in the free zone.

## 7. New features, learning styles and teaching methods (grounded in what the engine already has)

| # | Idea | Learning rationale | Engine hook already present | Size · files · restamp |
|---|---|---|---|---|
| N1 | **Daily 10-minute mode** (one button: due reviews capped at 20 → one Fundamentals step or one drill → stop) | The owner's problem is starting (8 visits, 0 submits). A bounded, finishable session beats an open slate. | `lib/estimates.ts`, hero picker, `reviewQueue.due` | S · client only · no |
| N2 | **Drill decay reviews**: a passed drill comes back as a review card after FSRS spacing; you re-solve it in practice mode (Run only), and pass/fail grades the card | Build skill never decays today (04-REVIEW #18); retrieval practice for code, not only facts. | `review_item.kind 'concept'` (unused), `/run` (free, not logged), FSRS engine | M · `engines/fsrs.ts`, `study-quest.ts`-style enqueue on first pass, Review page branch · no |
| N3 | **Error-log notebook**: every miss (gate question, Again, failed submit, EB key point marked missed) gets a one-line "why I missed it", shown again with the card | Self-explanation of errors; turns weak spots into reflection. | `weak-service.ts` already joins all four miss sources | M · migration 020 `miss_note` (append-only), Stats tab, card back · no |
| N4 | **Interleaved retrieval session**: "Mixed practice" draws drills from Fundamentals topics already passed (≥2 topics back) across `related.json` | Interleaving + spacing beat blocked practice for transfer. | `/drills/next` (find-service), `content/fundamentals/related.json` (450+ links) | S-M · `api/find-service.ts` + one button · no |
| N5 | **Pretest before the lesson**: show 2 check-yourself prompts before the lesson, not after | The pretesting effect: a failed guess primes encoding. | `GET /units/:id/lesson-aids` `checks` (JS 01-05) | S client · content for other topics · no |
| N6 | **Calibration**: before submitting a gate or self-scoring an EB, predict your score; Stats shows predicted vs actual | Metacognition; also the only honest check on self-scored EBs (R4-07). | gate result, `eb_score_detail` | S-M · client + a small table · no |
| N7 | **Placement sprint / test-out**: take topic gates N..M back to back, closed-book, server-limited to one try per gate per day; passes unlock, failures drop you in | A mid-senior learner should not grind 33 JS basics (01-STATE weakness 2). | Gate grading; requires A1 first or it is gameable | M · `fundamentals-service.ts` + client · no |
| N8 | **"Ask Claude about this miss"** button: copies a prompt (question, your answer, keyed answer after a pass, lesson section via lesson-aids) for the owner's own Claude Code session | Gives an LLM tutor without breaking the "no runtime LLM / zero spend" rule. The app never calls a model. | lesson-aids gate map, notes endpoint | S · client only · no. An in-app LLM tutor is **not** recommended: it breaks rule 1 of the README. |
| N9 | **Weekly review page / `bootquest week`**: last 7 days of XP, attempts, first-try-solo rate, retention, top 5 weak spots, cards due next 7 days | Reflection at a weekly cadence; makes zero-usage visible. Email would break local-first; write a markdown file instead. | stats-service, weak-service, `dueItems` | S-M · `stats-service.ts`, CLI `format.ts` · no |
| N10 | **Session timer + focus mode** (hide nav, 25-min timer, end-of-session summary) | Low learning value on its own; worth it only combined with N1. | none needed | S · client · no |
| N11 | Mobile/PWA flashcards | Review is the most mobile-friendly surface, but the server is locked to 127.0.0.1 by design (hardening wave); LAN exposure needs auth. | Review page | L · server bind + token auth · no restamp, but a security decision. **Defer.** |

Priority if only five things get built: **A2 + A1** (the gate means something again), **A5/N1** (a day you can
finish that grows the streak), **A3** (cards you can answer), **A4** (stop serving solutions as hints). All five
are S or M and none needs a restamp.

## 8. Coverage statement

- **Live (sandbox copy):**
  - Pages: dashboard (fresh and after activity), Fundamentals lesson, gate stepper (q1, q3, review screen, fail,
    pass), drill player (fail, hint bar), Review session (front, back), Campaign JS / sysdesign / agentic, Stats,
    Ctrl+K palette, 390 px dashboard and drill, a campaign study quest, a campaign quiz and the G3 unit.
  - API probes: gate brute force, the full hint flow, quiz retry, a trivial EB pass, review Again-farming.
  - CLI: `today`.
  - 24 screenshots.
- **Code read in full or in the relevant part:**
  - Server: `engines/hints.ts`, `xp.ts`, `attempts.ts`, `fsrs.ts`, `study-quest.ts`, `fund-review-hold.ts`,
    `eb-score.ts`, `level.ts`; `api/hints-service.ts`, `study-service.ts`, `notes-service.ts`; `service.ts`
    (detail, run/submit, dashboard); `streak.ts` (rules, close); `campaign.ts` (header); `evidence.ts` (legs);
    `grader-fingerprint.ts`; migration 019.
  - Client: `StudyQuestPane.tsx` (gate), `Dashboard.tsx` (hero).
  - CLI: `cli/src/program.ts`.
- **Swept by script:**
  - 3,357 drills (hint counts and the leak pattern on the last served hint).
  - 704 Fundamentals quiz items + 3,018 seed-quest quiz items (choice-dependent prompts).
  - 704 items (fences).
  - XP available over all 5,265 units; owner-DB usage tables.
- **Not covered:**
  - Patch-kata and written flows live.
  - Changed-example retest; the Tree view render; saving slate settings.
  - C# and Java drill execution (RAM rule).
  - Sync, mutate, reset, backup restore.
  - Screen readers.
  - Slate engine internals beyond the rules quoted.
  - `ladder-service.ts` beyond EB answer/score.
- **Sandbox state:** my copy `work/R4/r4.db` now holds about 20 test attempts. In it I edited `review_item.due_at` on
  14 cards to drive the Review page. It is not the owner's DB.
