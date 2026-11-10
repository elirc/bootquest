# f52 wave A — what is merged on hub branch `f52-wave` (2026-11-09)

Hub clone: `C:\Users\Owner\Desktop\bq-f52-hub`, branch `f52-wave` = `fund-wave` + this wave. Not on `main`,
not pushed. Full gate battery on the merged tree is still to run.

## Done (merged)
- **Content:** all 600 Fundamentals quiz items had their choices rewritten (key-is-longest 60-74% → 16-20%),
  each track blind-answered by an independent verifier (2 swapped keys, 4 wrong/conditional keys and ~10
  defensible distractors fixed). Length-bias lint added to `seed:lint:answers` (bootforge baselined).
- **Player (client):** ligatures off; single reading column for lessons; closed-book Fundamentals gate with a
  one-question stepper (1-4/Enter, review screen); answers + explanations after a passed gate; context-aware
  next step (gate → drills → next topic); cleaner failed-test output; kata removed-comment collapse;
  CodeMirror 6 editor (lazy, textarea fallback) and syntax colours in lesson code.
- **Dashboard/campaign (client):** hero "next step" button; reorder; "Not started" competencies; streak-safe
  mark; compact Fundamentals card; ordered unit lists for system design / agentic; copy pass.
- **Server:** hints API (`GET /units/:id/hints`, `POST /units/:id/hint`; after a failed submit; never the last
  authored hint; −25% XP each, floor 50%; hinted pass not ladder evidence); slate drill slots target the next
  Fundamentals drill; "more practice" map `content/fundamentals/related.json` (355 existing drills over 60
  topics, exposed as `related[]` per topic); next-up never offers an explain-back when other units are open.

## Built on the server but NOT yet in the UI
- Hints button in the drill player (API exists, client `getHints`/`takeHint` exist).
- "More practice" list per Fundamentals topic (`related[]` is in the response; not rendered).

## Deferred by the first council (candidates for the next wave)
- C4-lite: open-book "check yourself" questions after each lesson section (needs a section map side file).
- C5: typed predict-output questions in gates (importer accepts only 4-choice items today).
- C3 part 2: more drills per Fundamentals topic (today 65 drills for 60 topics; 1-2 per topic).
- C9: new ladders — SQL & data modelling, HTTP & web APIs, testing, DSA + Big-O, auth & security, Git.
  A new track id needs an estate-wide restamp (enums.ts); a ladder attached to an existing track does not.
- C10: capstone project per language track from chained drills.
- C7: acts for system design / agentic (campaign files are generated + hash-checked; needs a different
  "path" mechanism, e.g. the Fundamentals pattern).
- Known drill gaps (stream S, by search): ASP.NET routing/middleware, EF Core basics, Spring web, JPA
  entities, CommonJS/circular modules, React rules of hooks. Topics with < 4 related drills: csharp 16, 17,
  19; java 18, 19.
- Fail path: unlimited instant retakes of identical gate items (no cooldown, no item variation).
- Topic counts as complete after the gate alone (no drill required).

## Hard constraints for any next wave
- No restamp: `shared/src/{api,enums,check,schemas,seed-pack,campaign,pack}.ts`, `server/src/api/runners.ts`,
  `server/src/runners/**`, `tools/seed/src/factory/**`, `tools/seed/src/campaign/**` are off limits.
- Fundamentals content is not on `main` yet, so it can still be edited; everything already on `main` is frozen.
- Fundamentals authoring format: `tools/seed/authoring/fundamentals/<track>/NN-topic.json`
  `{format, track, topic, title, level, summary, lesson, quiz[8..12], flashcards, drills[]}`; tracks are
  js | csharp | java only (the Fundamentals schema and UI are per language track). Census constant
  `FUNDAMENTALS_EXPECTED` in `tools/seed/src/fundamentals/source.ts`. New drills must pass
  `npm run seed:validate -- --source fund-<track>` (C# needs .NET, Java needs JDK 17).
- Zero runtime spend: no LLM, Docker or network at runtime; grading is deterministic and local.
- The machine is memory-constrained (≈2-3 GB free): heavy jobs one at a time.
- Owner has 0 attempts so far; goal is "a personal upskilling app like boot.dev" for a mid-level engineer
  aiming at senior CRUD web-app work (JS/TS+React, C#/.NET, Java).
