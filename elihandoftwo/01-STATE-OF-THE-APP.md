# 01 · State of the app (2026-11-01, `main` b3815126)

High-level tour of what BootQuest is, what it does today, and where it is weak. Counts were taken on 2026-11-01
by counting (census tool, `content/` files, a read-only query of the owner DB, and the gate battery run at the ab
landing). Content detail is in [`02-CONTENT-CATALOG.md`](02-CONTENT-CATALOG.md).

## 1. What it is

A single-user, local-first, gamified upskilling app for one engineer (the owner). Five rules (README "BootQuest"):

1. **Zero runtime spend.** No LLM calls, no cloud, no Docker at runtime. Everything at runtime is deterministic.
2. **LLM work happens at seed time only.** Content is authored in Claude Code sessions and must pass a
   deterministic validator before it is committed to `content/` with a stamp.
3. **Honesty discipline.** Nothing completes without passing its check; a revealed solution earns 0 XP forever;
   every attempt writes an immutable evidence row.
4. **The estate is the content.** ~217 pinned checkouts of the owner's own GitHub repos are the source material.
5. **Understanding over output.** XP is the fun layer; a competency-evidence ladder is the truth layer.

Stack: npm workspaces. `server/` (Node, Express, `node:sqlite`, one DB file), `client/` (Vite + React 18 + TS,
dark, keyboard-first), `cli/` (`bootquest`, commander), `shared/` (Zod at every boundary), `tools/seed/` (the
content factory), `content/` (compiled, stamped packs). 18 SQL migrations (001-018).

## 2. The learner loop (what a day looks like)

| Layer | What the learner sees | Engine |
|---|---|---|
| **Daily slate** | 1 drill per slate track (js, csharp, java, sysdesign) + 1 campaign step, a review slot once cards exist; configurable (tracks on/off, size 1-10, presets) from tomorrow | `engines/streak.ts`, `slate_setting` (mig 017) |
| **Streak** | slate-day = all slots done; ≥ 20 XP keeps a streak without a slate-day; freeze tokens banked from slate-days | `streak.ts` |
| **XP + levels** | per-attempt XP (0 after reveal), level curve, XP-over-time chart | `xp.ts`, `level.ts` |
| **Campaign** | per track: JS 5 acts (259 steps), C# 5 acts (67), Java 3 acts (12); quests unlock by act | `campaign.ts`, `content/campaign/` |
| **Review** | FSRS spaced repetition of missed quiz questions and flashcards; paging past 200; demotion on lapse (capped 1/competency/day) | `fsrs.ts` |
| **Competency ladder** | 8 competencies rated 1-5; promotion = artifact + its explain-back ≥ 80% (weighted for `[wN]` sets, no `[w3]` missed) + changed-example retest ≥ 2 days later | `evidence.ts`, `ladder.ts`, `eb-score.ts` |
| **Due now / weak spots** | open retests + alternate explain-back sets whose 2-day gate opened; weak spots per repo / drill module (recency-weighted) | `due-service.ts`, `weak-service.ts` |
| **Find** | Ctrl+K unit palette (search by key + title), slate rows link straight to their target unit, "mixed drills" across today's slate tracks | `find-service.ts` |

Competencies: language-fluency, feature-delivery, data-http, testing-verification, agentic-engineering,
code-reading, communication, system-design.

## 3. Unit kinds and how each is graded

| Kind (live count) | Grading |
|---|---|
| drill (3,239) | runs learner code against canonical tests: drill-js, drill-cs (console-check / xunit), drill-java; verdict via a nonce-checked channel, never stdout |
| quiz (544), predict-output (508) | server-graded; `run` refused (no answer oracle); choices served in a stable secret permutation |
| study (207) | study-quest: a quest pack's quiz gate + flashcards + reading steps, with a "Learn more" notes drawer that never answers for you |
| explain-back (244) | answer-first: transcript stored immutably, then key points released, then self-score per key point; weighted `[wN]` sets; alternate sets B/C as retakes; blind mode on `[senior]` DESIGN IT prompts |
| written (147) | imported self-assessed exercise (model answer + rubric): 141 jstrain quiz-set items + 6 bootforge engineering-practice briefs; no check, never a pass target |
| reading (132) | self-attested reading step |
| patch-kata (52) | find seeded defects in a diff; findings {scenario, evidence, consequence} stored before the key; G1 gate ≥ 80% caught across ≥ 10 defects, solo only |
| retest / repo-task / guided-project (1 / 1 / 1) | the ladder's changed-example retest; the agentic G3/G4 tasks |

Registered runners: drill-js, drill-cs, drill-java, `self-run` (jstrain; 855 of the drills), `http`, `repo`
(predicates on a real GitHub repo: branch, ci-green, pr-has-section, …) and `node-test-file` (TAP).
`vitest-project` exists only as a schema: no runner is registered, so the API answers 501 RUNNER_UNAVAILABLE
(`server/src/api/runners.ts:123-132`, `service.ts:368`). The Stryker mutation gate (`bootquest mutate`) is
self-reported evidence, not a grader and not a promotion leg.

Live unit count (owner DB, 2026-11-01): **5,076** — js 4,231, csharp 282, java 272, sysdesign 216, agentic 75.

## 4. Interfaces

- **Web UI** (`npm run app` starts API + UI in one process): Dashboard (tiles, slate, focus card, Due now, Weak
  spots teaser, competency table, heatmap, Next up), Campaign / Campaign tree / Track units browser, Player
  (per-kind panes: code editor + run/submit, quiz, study quest, explain-back, kata, written), Review (FSRS
  session), Stats (XP over time, pass rates, reviews, campaign progress, catch rate G1, evidence browser, weak
  spots).
- **API**: 44 routes (29 GET, 14 POST, 1 PUT) under `/api`, Zod-validated both ways; refuses to start on a stale
  stamp or busy port; backs up the DB before serving; dev server denies `content/` and `.cache/`.
- **CLI** `bootquest`: run, submit (`--assisted`), status, today, slate, sync, mutate, reset.
- **GitHub sync**: `POST /sync` + re-seed session keeps the estate current; pins are git-tree hashes.

## 5. Integrity machinery (why content can be trusted)

- Every pack is **stamped** against a fingerprint of the seeder code that built it; the server refuses a stale
  stamp. `restamp:all -- --dry-run`: 697/697 fresh. `seed:pins`: 688/688 packs match their pinned upstream bytes.
- Append-only ledger: SQLite triggers abort UPDATE/DELETE/REPLACE on attempts, runs, evidence, XP and review logs.
- Content lints: `seed:lint:leaks` (token leaks 0; the xleak paraphrase lint with a shrink-only baseline of 146),
  `seed:lint:answers`, slot/order drift checks, quarantine files per pack, historical keys never change.
- The gate battery (AGENTS.md) at the ab landing: server 705 + selfrun 20, client 430, tools/seed 2,270, cli 120,
  smoke:api 76/76, demo:promotion 39/39, seed:demo:planted 48/48, test:csharp 46, test:java 23.

## 6. How it is built (process)

Content and features arrive in **waves** run by an orchestrator plus parallel agents in separate clones, with a
council for high-level rulings, ring review, hub integration and a full battery before landing (see
`elihandoff/OPERATIONS.md`). Recent waves: mx (bulk content), qw (quality/pruning), cw (CRUD web-app system design),
ab (day-one app fixes + content repair, landed 2026-11-01). `docs/SEEDING.md` §8 is the wave log.

## 7. Honest assessment

**Strengths**
- The honesty model is unusually rigorous (answer-first, reveal = 0 XP, nonce-checked verdicts, append-only
  ledger, three-leg promotion). Progress in this app means something.
- The content is the owner's own code, so every exercise is about systems the owner has actually built.
- The factory is reproducible: stamps, pins, lints and a large test battery catch drift.

**Weaknesses**
1. **Zero usage.** The owner DB has 0 attempts, 0 XP, 0 review cards (checked 2026-11-01). Every design choice is
   untested by a real learner. The ab wave made day one smaller; nobody has lived through day one yet.
2. **Skewed toward fundamentals.** 3,239 of 5,076 units are drills, most of them language fundamentals
   (JS track 4,231 units; the JS next-up on a fresh DB is a "const reassign" quick check, per REVIEW-2026-10-30 §1).
   A mid-level engineer aiming at senior has no placement test and no way to test out of the basics.
3. **No competency can be promoted today.** (Corrected after review R1/R3; the draft said "6 of 8".)
   - Leg (a) needs a project-kind unit (`PROJECT_UNIT_KINDS` = guided-project, http-lab, repo-task, program-unit).
     The owner DB holds two, both agentic: G3 `agentic/g3-live-delegation` (repo-task) and G4
     `agentic/g4-verification-engineering` (guided-project).
   - Leg (b) needs an explain-back on that unit or on an explain-back unit that lists it as a prerequisite
     (`evidence.ts:288-305`). Prerequisites are derived only from a synced `content_ref` path that matches the
     EB set's provenance (`store/ladder.ts:351-363`). The owner DB has **0 `unit_prerequisite` rows and 0
     `unit_ref` rows**, and G3/G4 have no content ref, so neither can ever get leg (b). G3 also has no variant
     (no leg c).
   - All 8 ratings sit at 1, the floor, and `lapseMayDemote` refuses at the floor (`fsrs.ts:179-180`): the lapse
     demotion rule is inert too. **The truth layer is currently inert end to end.**
   - **One existing command fixes half of it:** `bootquest sync` of `elirc/signalpost-swe-bootcamp` (never run:
     `sync_run` = 0) registers U01-U03 as `program-unit`s with node-test-file checks, links their committed EB sets
     and arms their committed drill-js retests — the path pinned by `server/test/api/ladder-real.test.ts:239`
     ("ONE FULL PROMOTION on real content"). That makes **language-fluency, feature-delivery, code-reading and
     testing-verification** promotable with zero code. **data-http, communication, system-design and
     agentic-engineering** stay stuck without new content (signalpost U04-U12 sync as `study`, without checks).
   - The `fixture:http-tasks-api` retest is test-only: its artifact lives in `server/test/fixtures` and never
     reaches the owner DB, so it stays pending forever by design.
4. **Senior skills are mostly read-and-explain, rarely build-and-ship.** Explain-backs, DESIGN IT sets, quizzes
   and sysdrills (numeric estimation in JS functions) dominate the senior material. Every study quest declares only
   `code-reading`, so the review/demotion loop concentrates on one competency.
5. **Self-scoring everywhere above drills.** Explain-backs, written units and katas are self-scored against key
   points. Honest by design, but calibration is never measured, and the promotion rule ignores difficulty: any
   verified artifact + its EB + a retest moves a competency one notch (`evidence.ts:17-35`), so an easy artifact
   counts the same as a hard one.
6. **Keys are honor-system on disk.** The API never serves keys early, but `content/` (EB key points, kata keys,
   G4's solution) is readable on disk and the GitHub repo is public. The README honesty model does not say so.
7. **Thin Java and C# campaigns** (12 and 67 steps vs JS 259); Java has no web/Spring leg.
8. **Process weight.** Any change to a fingerprinted file forces an estate-wide restamp; content rules freeze old
   items byte-identical. Good for trust, slow for iteration.

**Open owner decisions** (SEEDING §8 "ab wave"): 80% app floor vs "suggested pass 70%" in 81 DESIGN IT prompts;
the single `code-reading` competency on study quests; two-choice quizzes (needs factory change + restamp); frozen
wrong items; 5 javadrills task lines that still give the formula; the Fable review; deleting merged clones.
