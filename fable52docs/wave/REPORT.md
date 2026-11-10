# f52 wave — stop report (2026-11-09)

Implements `fable52docs/` (the app review) plus a second, council-ruled round of app and content work.

- **Branch:** `f52-wave` in `C:\Users\Owner\Desktop\bq-f52-hub`. Base `fund-wave` `ce7daee4`; 70+ commits.
  **Not merged into `main`, not pushed.** It contains `fund-wave`, so landing it lands the Fundamentals ladder too.
- **Stream branches** (all merged into the hub; kept for reference): `f52-p`, `f52-d`, `f52-c`, `f52-s` in
  `bq-f52-p`, `-d`, `-c`, `-s`.
- **No restamp:** `restamp:all -- --dry-run` 700/700 fresh. No fingerprinted file was edited.
- **One new migration:** `019_hint_taken` (append-only table). The owner DB is at schema 18 and migrates on
  the next start.

## How it was run
Two councils (3 agents each: feasibility, frontend, learning design; then curriculum, learner experience,
senior-engineer skeptic) ruled before each round; rulings are in `COMMON.md` and `WAVE-B.md`. Implementers
worked in separate clones. Every quiz rewrite and every new topic was blind-answered by a different agent.
Two adversarial code reviewers (server/honesty model, client) reviewed the full diff; 14 findings were fixed.

## What changed

### Learning flow (client)
- Dashboard: one hero "next step" button (reviews due → first unfinished Fundamentals ladder → slate →
  next-up), "Done for today" state, slate beside it, calmer competency table, streak-safe mark, time estimates.
- Fundamentals lesson page: one reading column, syntax colours, ligatures off, a course rail
  (Lesson → Gate → Drills → Next topic) and a completion panel.
- Quiz gate (Fundamentals): closed-book ("Show lesson" marks the try assisted), one question at a time with
  1-4 / Enter and a review screen, questions and choices reshuffled on every try, no per-question marks after
  a fail (only "Re-read: <sections>"), 3-minute cooldown from the second consecutive fail, answers and
  explanations shown after a pass.
- A topic is "complete" only when its gate **and** at least one of its drills are passed.
- Drill player: CodeMirror 6 editor (lazy-loaded; plain textarea as fallback and in tests), hints bar,
  quieter failed-test output, "more practice" lists, next step stays inside the course.
- Campaign page: compact Fundamentals card; ordered lists for System design and Agentic.
- Review katas: runs of removed comment lines are folded (by file type) so they no longer give away the defect.

### Server
- Hints: `GET /units/:id/hints`, `POST /units/:id/hint`. Only after one failed submit, never the last
  authored hint, never on project or retest units; each hint costs 25% of the pass XP (floor 50%); a hinted
  pass is not promotion evidence.
- Lesson aids: `GET /units/:id/lesson-aids` (quiz item → lesson heading for all 73 topics; 32 ungraded
  "check yourself" cards for JS topics 01-05).
- "More practice": `content/fundamentals/related.json` maps 450+ existing drills onto the 73 topics.
- Slate drill slots prefer Fundamentals drills; next-up never offers an explain-back while other units are open.
- Passed-gate explanations are released through the notes endpoint; quiz-miss cards of a Fundamentals gate
  are held back until the gate is passed (they used to hand the key to a retry a day later).
- `seed:lint:answers` now also fails a pack or topic where the keyed answer is the longest (or shortest)
  choice in more than 40% of items (bootforge baselined at 78%, frozen upstream).

### Content
| | Before | After |
|---|---|---|
| Fundamentals topics | 60 | 73 (JS 33, C# 20, Java 20) |
| Quiz items | 600 | 704 |
| Flashcards | 480 | 558 |
| Fundamentals drills | 65 | 116 (JS 62, C# 27, Java 27) |
| Key is the longest choice | JS 60%, C# 74%, Java 72% | JS 17%, C# 20%, Java 16% |

- All 600 existing quiz items: choices rewritten to remove the answer-length cue; blind checks found and
  fixed 2 swapped keys, 4 wrong or conditional keys and about 15 defensible distractors.
- 13 new JS topics (21-33) on senior CRUD judgment, each with 3 drills that fail a named plausible-wrong
  implementation: lost updates, idempotent writes, pagination drift, tenant scoping, live schema changes,
  cache correctness, N+1, seams/logging, four SQL topics on real in-memory SQLite, authentication.
- 12 framework-behaviour drills for C# 17/19/20 and Java 18/19/20.
- Hint 2 rewritten to approach level on 64 drills; 10 garbled explanations fixed.
- `seed:validate`: fund-js 62, fund-csharp 27, fund-java 27 — RESULT OK, 0 quarantined.

## Gates on the final tree (`ba62601b` + docs)
| Gate | Result |
|---|---|
| `npm run typecheck`, client typecheck | pass |
| client suite | 49 files, 610 tests passed |
| server suite | 56 files, 747 passed |
| server selfrun | 20 passed |
| `tools/seed` suite | 41 files, 2,293 passed |
| `seed:lint:leaks`, `seed:lint:answers` | RESULT OK |
| `seed:pins` | 688/688 OK |
| `restamp:all -- --dry-run` | 700/700 fresh |
| `seed:campaign -- --check` | ok |
| `smoke:api` | 76/76 |
| `demo:promotion` | 39/39 |
| `seed:demo:planted` | RESULT OK |
| `test:java` | 23 passed |
| `test:csharp` | 45 of 46 — see below |
| cli suite | 101 passed, 19 skipped — see below |

**Two time-limit failures, both environmental as far as could be shown.** The machine had ~2 GB free memory
for the whole session and every suite ran 3-5× slower than the documented times.
- cli `test/e2e.test.ts`: "server did not start in 90s" (19 tests skipped). The identical failure occurs on
  the untouched baseline clone (`bq-claude-fund`, `ce7daee4`) on this machine.
- `test:csharp` "warm runs: median of 5" (a speed benchmark) failed twice on the wave tree; the untouched baseline fails it too on this machine (median 21.9 s against
  the 10 s limit).
Rerun both on a quiet machine before landing.

## Not verified
- The CodeMirror editor, gate stepper and dashboard were browser-checked in a sandbox mid-wave; the wave B
  UI (hints bar, course rail, completion panel, shuffle, cooldown, check-yourself cards, more practice) and
  the review fixes are covered by tests only. **Nothing after wave A was looked at in a real browser.**
- The client production build was last run before wave B.
- 540 of the 600 quiz-item → heading mappings were made by subagents and spot-checked (60), not re-read.

## Deviations from the review's plan
- Dropped: acts for System design / Agentic (campaign files are generated and hash-checked; client-side
  ordering instead). Refused by council: Git, DSA, shell/Docker ladders, a sixth track, C#/Java twins,
  capstones, typed predict-output items.
- Assisted attempts do not cost XP (the review said they did); the UI does not claim it.
- A failed gate's response still carries per-question marks (strict schema in a fingerprinted file); the
  client hides them.
- `GET /evidence` still lists a hinted pass as assistance "none" (same reason); it is excluded from
  promotion in the engine.

## Upstream / report items
- bootforge quizzes: key is the longest choice in 78% of 544 items (upstream repo; frozen here).
- Five quiz items test something their lesson never states (js 04 q10, js 11 q5, js 14 q6, csharp 18 q7,
  java 06 q8); csharp 18 q1 tests a .NET 10 API on a .NET 8 track.
- No existing drills cover indexes/query plans beyond the three linked to topic 31.

## Left for the owner
1. Look at it: `BOOTQUEST_DB=<a copy> BOOTQUEST_PORT=4290 BOOTQUEST_UI_PORT=5290 npm run app` in
   `bq-f52-hub` (recipe in `fable52docs/README.md`).
2. Rerun `test:csharp` and the cli suite on a quiet machine.
3. Decide the landing: `f52-wave` → `main` lands Fundamentals (73 topics) and this wave together. After that
   the content is frozen by the byte-identical rule.
4. Still open from the review: step-by-step lessons beyond the JS 01-05 pilot, capstones, a path for
   System design / Agentic, and the senior labs in `elihandoftwo/03`.
