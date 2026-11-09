# 02 · Content findings

Counts were taken on branch `fund-wave` (`ce7daee4`) by script or by a read-only query of a copy of the owner
DB. For the full catalog of what exists, read `elihandoftwo/02-CONTENT-CATALOG.md`; it is still accurate apart
from the Fundamentals ladder, which adds 60 study units and 65 drills (5,201 units in total).

The lens here is boot.dev: an ordered path, short lessons, a lot of graded practice per concept, instant
feedback, and projects at the end of each course.

## What is good (keep it)

- The Fundamentals lessons I read are accurate, concrete and tied to CRUD work ("`Number('')` being 0 is the
  classic form bug"). They average 400-460 words, which is the right size.
- Drill tasks are framed as interview prompts with a reason and a worked example, and the tests name the
  behaviour they check ("retries 0 is kept, not replaced by 3").
- Every Fundamentals question has an explanation (600 of 600).
- The estate-derived material (explain-backs, DESIGN IT sets, katas) is unusual and valuable for the
  mid-to-senior step. boot.dev has nothing like it.

## C1 · The Fundamentals ladder is not in the owner's app

`main` does not contain it; `fund-wave` does. Until the owner merges that branch and restarts `npm run app`,
the most boot.dev-like content in the project does not exist for the learner. This is an owner action, not an
implementation task. Everything below that edits Fundamentals content should be done **before** it lands,
because after landing the "existing items stay byte-identical" rule freezes it.

## C2 · In Fundamentals quizzes the right answer is usually the longest one (measured)

`node fable52docs/tools/quiz-bias.cjs content` counts how often the keyed answer is the single longest choice.
With four choices, chance is about 25%.

| Content | Keyed items | Key is the longest choice | Key is the shortest |
|---|---|---|---|
| Fundamentals C# | 200 | **74%** | 4% |
| Fundamentals Java | 200 | **72%** | 5% |
| Fundamentals JS | 200 | **60%** | 9% |
| bootforge quizzes | 544 | **78%** | 2% |
| Quest-pack quizzes (`content/seed/quests`) | 3,025 | 19% | 17% |

A typical item (C# topic 05): the choices are "A readonly field", "A public property", "Only usable in a
constructor", and the key, "A primary-constructor parameter in scope for the whole class (captured, not
readonly)". A learner can pass these gates by picking the longest answer. The quest packs show the factory can
produce unbiased items; the hand-authored Fundamentals and the imported bootforge quizzes were not checked for
this.

Also in bootforge, the key is choice B in 359 of 544 items. The server shuffles choices per learner, so
position does not leak; length does.

**Fix for Fundamentals (before landing):**

1. Rewrite distractors in `tools/seed/authoring/fundamentals/<track>/*.json` so they are as long and as
   specific as the key. Lengthen distractors rather than shortening keys; a good distractor states a plausible
   wrong rule in full ("A readonly field initialised once by the compiler-generated constructor").
2. Target per track: key is the longest choice in at most 35% of items, and no item where the key is 1.5× the
   next longest choice (`--list 50` prints those).
3. While editing, wrap code-valued choices in backticks so the client can render them as code (UI finding
   U15), if the quiz renderer accepts inline code in choices; check `client/src/lib/prose.tsx` first.
4. Recompile and restamp only the Fundamentals packs with the Fundamentals seed CLI (`docs/SEEDING.md` §3 on
   that branch has the runbook), then update the census constant `FUNDAMENTALS_EXPECTED` only if counts change
   (they should not).

**Add a lint so it stays fixed:** extend `tools/seed/src/ops/answer-positions.ts` (the engine behind
`npm run seed:lint:answers`, which today checks only the position of the key) with a length check per pack:
fail when more than 40% of a pack's keyed items have the key as the single longest choice, with a baseline
file for packs that already exceed it (the same shrink-only pattern as `xleak-baseline.json`). Check whether
`tools/seed/src/ops` is inside the seeder fingerprint before editing; if it is, put the check in a new file
and wire it from the CLI.

**bootforge** is an upstream repo of the owner's. Under `AGENTS.md` that is a report item, not a fix: the
items are frozen in BootQuest. Report it to the owner (plan, D5).

## C3 · Fundamentals has about one drill per topic (measured)

| Track | Topics | Quiz questions | Flashcards | Drills |
|---|---|---|---|---|
| JS | 20 | 200 | 160 | 23 |
| C# | 20 | 200 | 160 | 21 |
| Java | 20 | 200 | 160 | 21 |

The ratio is ten recognition questions to one piece of code written. boot.dev is the reverse: most steps are
code. Yet the app holds about 3,300 drills on these same topics in other banks.

**Fix, cheapest first:**

1. **Link existing drills to topics (no new content).** Add a "More practice" list per topic that points at
   existing unit keys. Starting map for JS (bootforge course → topics): `js-fundamentals` → 01-03;
   `functions-deep` → 03-04; `arrays-objects` → 05, 07, 09; `errors-modules` → 10-11; `async-js` → 12-14;
   `ts-basics` / `ts-apps` → 15-16; `node-core` → 17; `http-rest` / `express-api` → 18; `react-fundamentals` /
   `react-state` → 19-20. For C#: `csbootcamp` modules 01-04 and `jstrain-cs`; for Java: `javabootcamp`
   modules and `javadrills`. Pick 4-8 drills per topic by reading the module lists in
   `elihandoftwo/02-CONTENT-CATALOG.md` §2 and searching with `GET /api/units/search?q=`.
   Store the map where the Fundamentals topic metadata lives without touching a fingerprinted file: a
   server-local JSON (for example `content/fundamentals/related.json`) read by
   `server/src/store/fundamentals.ts`, with the DTO field added in `shared/src/api-ext.ts`. A key that does not
   resolve must log a warning and be skipped, never fail the boot.
2. **Author more drills per topic** to reach 3-4 each (about 120 new drills): one warm-up, one "fix this bug",
   one applied CRUD task. Use the existing authoring format (`drills[]` in the topic JSON: `slug`, `title`,
   `difficulty`, `skills`, `instructions`, `starterHead`, `solutionHead`, `tests`, `tail`, `explanation`,
   `hints`).

## C4 · Lessons are read once, then tested all at once (judgment)

Each topic is one 400-word page followed by ten questions. boot.dev splits a topic into several steps of
"two paragraphs, then do something". Long-read-then-quiz favours short-term recall, and the open-book layout
(U2) makes it weaker still.

**Fix:** keep the authored lesson text, but split it at its headings into steps, and attach to each step the
quiz questions that test it. The learner answers 1-3 questions after each section and gets the explanation
immediately; the gate at the end becomes a shorter mixed quiz on the whole topic.

- This needs a `section` tag on each quiz question in the authoring JSON (the heading it belongs to). Adding an
  optional field to the Fundamentals schema is in `shared/src/fundamentals.ts`: check whether that file is in
  the pack fingerprint. If it is, keep the mapping in a side file as in C3.
- The same tag lets a failed gate say "re-read: Truthy and falsy" (UI finding U3).
- Do this after the wave-1 UI fixes; it is the largest change in this folder.

## C5 · All Fundamentals questions are multiple-choice recall (measured)

600 of 600 are four-choice questions. The app already has two better kinds for a language course:
`predict-output` (508 units elsewhere) and drills. Convert two or three of each topic's ten questions to
"what does this print?" with a typed answer, or to a two-line "fix the bug" drill. Do it in the same edit pass
as C2.

## C6 · A quarter of the review katas delete a comment that explains the defect (measured)

In 13 of 52 kata diffs, the removed lines include two or more comment lines (15+ words) that state why the
removed code mattered. Example, kata `ladder/kata/j5/1138058811e0` (see `screenshots/kata.png`), removed lines:

```
- // The session's edits exist only in memory. Exiting 0 here would tell scripts the
- // save worked while every change was thrown away, so: write a recovery snapshot and
- // exit non-zero (review finding 1 / exercise 3).
```

The learner is asked to find the seeded defect, and the diff says what it is. Other examples are in
`content/seed/patches/masterrnative-katas/items.json` ("Step-6 answer: …", "(finding F1)") and
`campusops-katas`.

**Fix:** these are existing items, so they cannot be edited in place. Options, for the owner (plan, D6):
(a) add set-B katas for the same defects from a version of the file with the comments stripped, and retire
nothing; (b) add a rule to the patches generator (`tools/seed/src/factory/patches`, fingerprinted, so a
planned restamp) that rejects a seeded patch whose removed lines contain explanatory comments; (c) have the
client render removed comment-only lines collapsed ("3 comment lines removed"), which hides the leak without
touching content. Option (c) is cheap and client-only, but it also hides legitimately suspicious comment
removals, so say so in the kata instructions.

## C7 · Three of five tracks have no real path (measured)

| Track | Units | Ordered path |
|---|---|---|
| JS/TS + React | about 4,300 | 5 acts, 259 steps + Fundamentals 20 |
| C#/.NET | about 300 | 5 acts, 67 steps + Fundamentals 20 |
| Java | about 290 | 3 acts, **12 steps** + Fundamentals 20 |
| System design | 216 | **none** |
| Agentic | 75 | **none** |

**Fix:** seed acts for system design and agentic from existing units; no new content is needed.

- System design: Act 1 "Numbers" (sysdrills 01-04: estimation, caching, reliability math, latency), Act 2
  "Data" (05-08, 11, 16), Act 3 "Scale" (09-10, 12-15), Act 4 "Web app" (17-18 plus the CRUD modules), then
  DESIGN IT sets ordered from the smallest system to the largest, each after the sysdrill modules it relies on.
- Agentic: G2 briefs → review katas (easy to hard by the `difficulty` field) → G3 → G4.
- Java: extend the campaign with javabootcamp modules 05-21 (168 drills exist; only 12 steps use them).

Campaign definitions live in `content/campaign/` and are checked by `npm run seed:campaign -- --check`. Read
`docs/SEEDING.md` for the campaign file format before editing. Verify whether adding acts changes any census
constant or the `ladder-real.test.ts` pins.

## C8 · The first explain-back assumes you remember a repo (judgment)

The first Agentic unit asks for a delegation brief on `atlas-net` "from memory", with the code hidden. The
explain-backs are built on the owner's ~217 repos; many were written long ago or by agents. Without a reading
step first, the exercise tests whether you remember the repo, not whether you can write a brief.

**Fix:** never offer an explain-back as "next up" unless the study quest for the same repo is passed, and show
a "Read first" link to that quest (or to the repo's GitHub page; the estate repos are public) on the
explain-back's start screen. The owner DB has 0 `unit_prerequisite` rows, so this rule has to be computed in
the next-up logic (`server/src/api/service.ts:784`) from the repo slug in the unit key.

## C9 · Core backend subjects have no ladder of their own (measured by key/title search)

Unit count by keyword in key or title (5,201 units): `sql` 255, `regex` 97, `test` 61, trees/graphs/lists 37,
`recursion` 26, ASP.NET/EF 23, `git` 13, `spring` 6, deploy 4, JWT/OAuth 1, Big-O/complexity 1, `docker` 0,
`linux` 0, `bash` 0, dynamic programming 0.

So SQL and testing exist but only inside the JS campaign, and several subjects on boot.dev's backend path are
absent. Proposed new Fundamentals-style ladders, each 8-12 topics in the same lesson + quiz + drills format,
language-neutral where possible:

| Ladder | Source | Notes |
|---|---|---|
| SQL & data modelling | mostly existing (`bootforge/sql-data`, jstrain SQL, sysdrills 05/16) | needs lessons; drills exist |
| HTTP & web APIs | existing (`bootforge/http-rest`, `express-api`) | needs lessons |
| Testing | existing (jstrain 20/29, jstrain-cs 21/29) | needs lessons |
| Data structures & algorithms + Big-O | partly existing (jstrain DS/algorithms) | complexity analysis is new |
| Auth & web security | existing hunts (jstrain 26) + new | JWT/OAuth/session lessons are new |
| Git | new | graded with the existing `repo` runner predicates or as predict-output on command sequences |
| Shell, Docker, deploy | new | cannot be graded without Docker at runtime (the "zero runtime spend" rule); do as quiz + predict-output only, or leave out |
| ASP.NET Core / Spring Boot web layer | new | the C# and Java ladders stop at the language; the JS ladder reaches HTTP and React |

These need a home in the UI: Fundamentals is per language track today (`GET /tracks/:id/fundamentals`). The
simplest route is a sixth track, "Core" (track ids are an enum in `shared/src/enums.ts`, which is
fingerprinted: a planned restamp), or attaching the ladders to an existing track. Owner decision (plan, D7).

## C10 · No project at the end of a course (judgment)

boot.dev ends each course with a guided project. BootQuest has one `guided-project` unit and one `repo-task`,
both agentic. `elihandoftwo/03-SENIOR-CRUD-UPSKILL-IDEAS.md` §3 already designs senior-level labs; those are
large. A cheaper first step for the Fundamentals ladder:

**A capstone per language track built from chained drills.** For example "a tasks API in 8 steps": each step
is an ordinary drill whose starter code is the previous step's solution and whose tests include all earlier
tests. It needs no new runner and no schema change, only authoring (8 drills per track) and a "Project" group
in the ladder UI after topic 20. Because each drill ships its own starter, a learner who skipped a step is not
blocked.
