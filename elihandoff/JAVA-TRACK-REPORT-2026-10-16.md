# BootQuest Java track report (2026-10-16)

The owner asked: "create new java github repo and fill out the java track like others".

## TL;DR

- **Before:** Java was one locked placeholder act of 4 inert quests, with 0 units and no runner.
- **After:** Java is an unlocked, playable track like C#:
  - **javabootcamp:** a new private GitHub repo, https://github.com/elirc/javabootcamp, pinned at
    `0ec7155`. It holds **64 Java 17 exercises** in 8 modules with 882 tests, graded in-app by a
    new **Java runner** (`drill-java`).
  - **Campaign:** **3 acts**, with all **12 owner Java repos** as core study quests. Each quest has
    a stamped quest pack and Learn-more notes: 152 quizzes, 40 flashcards, 36 readings and 152
    explanations in total.
  - **Explain-backs:** 2 sets, for j5 and j7.
  - **Daily slate:** a `drill:java` slot, as C# has.
- **Branch:** everything is on `java` in `Desktop\bq-honesty`, which also contains wave 4. All
  gates are green.
- **`main` is still at `846c224`.** The owner fast-forwards it.

## How to land (wave 4 + Java together)

```
cd C:\Users\Owner\Desktop\selfboot
git status                       # clean, main at 846c224
git fetch ../bq-honesty java
git merge --ff-only FETCH_HEAD
```

**On first `npm run serve`,** migrations 010 and 011 run against the owner DB:
- **010** rebuilds the `check` table so it accepts `drill-java`.
- **011** unlocks Java and adds its slate slot.

A backup was taken first: `C:\Users\Owner\bootquest\backups\bootquest-pre-java-2026-10-16.db`.

**JDK 17 must stay on PATH** for Java grading. It is currently
`C:\Users\Owner\AppData\Local\Programs\Microsoft\jdk-17.0.10.7-hotspot`.

## What was built

| Piece | Where | Notes |
|---|---|---|
| javabootcamp repo | `Desktop\javabootcamp`, GitHub `elirc/javabootcamp` (private) | Layout mirrors csbootcamp: `bootcamp/_lib/check/bootcamp/{Check,BqMain}.java`, `FORMAT.md`, `Verify.java`, modules `NN-topic/{README,exercises,solutions}`, astraupskill guides |
| Modules | 01 language-core, 02 methods-and-lambdas, 03 collections-and-streams, 04 strings-and-time, 05 classes-records-enums, 06 exceptions-and-files, 07 money-and-validation, 08 domain-rules | 8 exercises each; 20 warm-up, 31 core, 13 stretch |
| Java runner | `server/src/runners/java/`, `server/src/api/runner-java.ts` | See "Runner" below |
| Check type | `drill-java` in shared enums/check/api/pack | Migration `010_drill_java_check.sql` rebuilds the `check` table |
| Importer + validator | `tools/seed/src/javabootcamp/*`, `tools/seed/src/validate/validate-java.ts` | `npm run seed:import:javabootcamp`, `npm run seed:validate -- --source javabootcamp` |
| Pack | `content/packs/javabootcamp/` | 64 units, stamped, 0 quarantined |
| Campaign | `content/campaign/java.json` | Built by `tools/seed/src/campaign/rules.ts` `JAVA_ACTS` and `JAVA_PROMOTE_TO_STUDY` |
| Unlock | Migration `011_unlock_java_track.sql`, `client/src/lib/view.ts` | Sets `locked=0, slate_drills=1` |
| Quest packs | `content/seed/quests/<repo>/`, `content/seed/notes/<repo>/`, drafts in `content/seed-drafts/` | 12 packs |
| Explain-back | `content/seed/explainback/{j5,j7}--astraupskill-02-CONCEPTS.md/` | Routed to Java by `ladder.ts` `trackForRepo` |
| Tests | `npm run test:java` (23 tests), `server/test/api/drill-java.test.ts`, a Java section in `smoke:api`, updated campaign, db, api, stats, streak and client tests | |

**Runner details:**
- Each attempt runs `javac --release 17` and then `java`, with no resident JVM. A warm grade takes
  about 2–4 s.
- The verdict is read only from a nonce-checked result file. Every test named in the canonical
  tests block must report, so calling `report()` early fails as incomplete.
- The compiled harness is digest-checked before each grade.

### Campaign

| Act | Unlock level | Quests (rank) |
|---|---|---|
| 1 Foundations | 1 | organized-experiment-cli-to-do-manager (11), organized-experiment-library-book-tracker (12), organized-experiment-quiz-engine (13), organized-experiment-bank-account-simulator (238) |
| 2 Money & validation | 4 | organized-experiment-src (14), j1 (210), j4 (211), j5 (212) |
| 3 Domain rules & consistency | 8 | organized-experiment-src-j7 (51), j2 (273), j3 (274), j7 (275) |

**Promoted repos.** Seven repos that the upskillorder assessment rated "skim" were promoted to
study for parity. They are recorded with their reasons in `content/campaign/manifest.json`
`report.promotedToStudy`. One reason is worth knowing: bank-account-simulator has no tests or guide
course, and its entry says so honestly.

## Quality process

Every writer's work was reviewed by a different agent.

| Work | Writer | Reviewer findings |
|---|---|---|
| javabootcamp (64 exercises) | JB | 10 exercises fixed: 2 **wrong reference solutions** that the tests were too weak to catch (02/08 retry chained suppressed exceptions instead of attaching them directly; 05/05 `best()` returned NoDiscount instead of a zero-value offer); tests strengthened; prompts made to state every behaviour the tests check |
| 6 packs: cli-to-do, library, quiz-engine, bank, src, j1 | JW-1 | 0 of 72 keys wrong (all checked by running the code). Fixed 2 partly-true distractors, 2 ambiguous prompts, 1 flashcard and 5 leaking readings. j1's `06-SOLUTIONS` guide was served as reading steps and generator flashcards leaked generator quiz keys, so the guide was dropped and its 5 location-trivia quizzes became 5 behaviour quizzes |
| 6 packs: j4, j5, src-j7, j2, j3, j7 | JW-2 | 0 of 75 keys wrong (regression suites plus probe programs plus piped CLI input). j5's `06-SOLUTIONS` guide was dropped and 1 derivable quiz replaced; 2 j4 flashcards fixed; 1 j7 key reworded so it no longer gave away another quiz; the j7 q12 key was reproduced live; explain-back prompts were widened to cover their key points |
| Integration | orchestrator | j4 `07-TRACE-LAB` dropped from generator input: its end-of-input table is the lab's answer key |

## Gates (all green on `java` @ the commit carrying this report)

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | shared 87, server 548, cli 20, client 221, 103, tools/seed 1871 (+2 skipped), exit 0 |
| `npm run test:java` | 23/23 |
| `npm run test:csharp` | 24/24 |
| `npm run smoke:api` | 69/69: a real javabootcamp starter fails as todo, a wrong answer fails with expected/received, the reference passes with +10 XP, and no javac/java process is left |
| `npm run demo:campaign` | 25/25: 204 packs; JS 143 + C# 48 + Java 12 gates |
| `npm run demo:promotion` | 38/38 |
| `npm run demo:m4` | passed |
| `npm run seed:demo:planted` | OK |
| `npm run test:mutate-fixture` | 10/10 |
| `npm run seed:check` | 510/510 packs, 10,575 items re-validated (in a clone, pass `-- --checkouts C:/Users/Owner/Desktop/selfboot/.cache/checkouts`) |
| `npm run seed:lint:answers` | OK |
| `npm run seed:campaign -- --check` | byte-identical to a fresh build |
| `npm run build:client` | built |

**Fingerprint safety.** No grader- or seed-fingerprinted file was edited. The js, csharp and
selfrun grader fingerprints still match every existing pack's stamp, so nothing had to be
re-validated except the new Java pack.

## Upstream bugs found in the owner's Java repos

All reproduced; full list in `docs/SEEDING.md`.

- **organized-experiment-src:**
  - An expense with an empty note cannot be reloaded, and the next save drops it.
  - A 3-decimal amount crashes the total report.
  - Categories are not normalised.
  - An impossible date is reported as a format error. j5 shares this one.
- **organized-experiment-bank-account-simulator:** a bad balance in accounts.txt crashes startup.
- **organized-experiment-library-book-tracker:** a bad date or id in books.txt escapes `main`'s
  catch.
- **organized-experiment-src-j7:**
  - A saved discount reloads as 0.
  - A failed load followed by Exit wipes all four data files.
  - Removing an item lowers the stored discount permanently.
  - PAID orders stay editable.
- **j4:** input ending at the delete confirmation prints "Deletion cancelled.".

## Open items

1. Fast-forward `main` (above).
2. **Optional:** a warm javac server would cut each grade by about 1.5 s, at the cost of a
   resident JVM. Trade-off in `docs/recon/java-timings.md`.
3. **Optional:** explain-backs for more Java repos, using `tools/seed/authoring/explainback/*.json`
   and `npm run seed:explainback`.
4. **Optional:** a javabootcamp quest pack. Its astraupskill guides exist, but javabootcamp is not
   in the upskillorder assessment, so it has no campaign quest yet.
5. **Not done:** Java project and mutation units. `bootquest mutate` has no Java tool without
   Maven/PIT.
6. **Cleanup:** the `Desktop\bq-*` clones are scratch.
