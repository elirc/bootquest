# rv3 S3b `rv3-x2` stop report (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-d`, branch **`rv3-x2`**, base `c1acf7a8` (hub `rv-wave` + S3). HEAD = **`7c9262eb`**,
67 commits, tree clean. Nothing pushed, `main` untouched, no `--no-verify`, no history rewrite, every commit made with
`git commit -F` and ending in the Co-Authored-By line. No migration. I touched none of these: `server/src`, `client`,
`shared/src`, `tools/seed/src/factory`, `.cache/checkouts`, Java content, the system-design path, keyideas files outside
`fund-js-*` / `fund-cs-*`, or the owner DB.

**Status: done.** Every item in the work list is finished: JS 01-20, C# 01-20, F9/F10 rest, W6 C# 24-26, and the
sysdrills stretch.

**How the work was done.** I split the writing across six writer subagents, each with a binding brief
(`tools/seed/build/rv3b/BRIEF.md`, git-ignored):
- jsA, jsB (JS 01-10, 11-20)
- csA, csB (C# 01-10, 11-20)
- w6 (C# 24-26)
- sys (sysdrills)
- tst (the 22/02 and 23/02 tests)

Writers edited only the authoring files they were given and committed nothing. One lock dir allowed one heavy process
(tsx, dotnet) at a time across the machine. I did the following myself:
- checked every changed file field by field against HEAD (`tools/seed/build/rv3b/me/fields.cjs`)
- spot-read rewrites
- made the F9 card, check and lesson fixes
- made every commit, re-import, validation and gate run

The writers' scratch files (edit files, claim programs, proof inputs, logs) are in `tools/seed/build/rv3b/<id>/`.

## SHAs
| Work | Commits |
|---|---|
| F9 rest (cards, lessons, checks, weak tests) | `601c3865` `023b2582` (21-23 cards + 21/22 lesson), `6834b241` (2 pretest checks), `86644a3f` (22/02 + 23/02 tests) |
| JS 01-20 rewrite | `d8e1b4e3` (01) `2e81cb1a` `bd6966f6` `137cba40` `d8fe0c4b` `1299f618` `f0f094f0` `55ab1e38` `5f7a54ec` `1f2c6f7f` (10) `2ba3f46d` (11) `b89a8613` `34a04206` `b472cfb4` `78b03d6d` `4bdc7052` `9f5419f9` `57e817ae` `c7ddb7cd` `5f9a3de6` (20); outputs + stamp `723fd381` |
| C# 01-20 rewrite (+ F10) | `2f7d480a` (01) `aaebba03` `704de17b` `05c2fd2b` `67abd8da` `b71b9254` `2d23d74f` `c2941ea1` `958d67b9` `52d8ddd9` (10), 11-20 the ten commits ending `897dbcfb` `90bb8905` `5a436202` |
| W6 C# 24-26 | `138c8dae` (24) `136939bd` (25) `793f9f3f` (26) `f7cae8e8` (side files + census); 25 answer-rank fix = the commit before `7c9262eb` |
| fund-csharp outputs + stamp | `7c9262eb` |
| sysdrills stretch | `8843f741` ... `f66942e5` (one commit per module, 15); outputs + stamp `78aa8ba8` |

`git log --oneline c1acf7a8..rv3-x2` lists all 67.

## Counts before → after (all taken by script)

### Audit pass rates (`seed:audit:explanations`)
| Track | Family | At `c1acf7a8` | At `7c9262eb` |
|---|---|---|---|
| js | quiz | 167/330 (51%) | **330/330** |
| js | drills | 39/79 | **79/79** |
| js | lessons | 13/33 | **33/33** |
| csharp | quiz | 93/230 (40%) | **260/260** (30 new) |
| csharp | drills | 15/49 | **55/55** (6 new) |
| csharp | lessons | 3/23 | **26/26** (3 new) |
| sysdrills | drills | 87/129 | **129/129** |
| java | all | 96/200, 3/42, 0/20 | unchanged (S2's) |

- `--check` gives RESULT OK for js, for csharp and for sysdrills.
- Estate-wide gate failures went from 619 to 163, and all 163 are Java.

### Census
- `FUNDAMENTALS_EXPECTED` csharp: 23 / 230 / 184 / 49 → **26 / 260 / 208 / 55**.
- js: 33 / 330 / 238 / 79 (unchanged).
- sysdrills: 129 (unchanged).
- `fund-cs-web.json`: 9 → 12 ideas (the cap).
- Key ideas estate-wide: 24 files, 192 ideas.
- `seed:pins` 688 packs and `restamp:all` 700 are unchanged: no new pack, since the new topics live inside `fund-csharp`. `ladder-real.test.ts` has no fund pins, so it needed no change.

### Items rewritten (keys unchanged)
| Track | Quiz explanations | Drill explanations | Lessons |
|---|---|---|---|
| JS 01-20 | 86 (jsA) + 77 (jsB) | 40 | 20 |
| C# 01-20 | about 140 | 37 | 20 |
| sysdrills | — | 42 exercises (explanation and/or hint 1) | — |

Per-topic lists are in the commit messages and the writer logs.

## Changes outside explanations and lessons (each listed)
- **Prompts and keyed answers: none changed.**
- **Choices: one change.** C# 25 (a new topic): five distractors of q6, q8 and q9 were lengthened, because `seed:lint:answers` flagged the key's length rank as SKEWED (60% on one rank).
- **Flashcards:**
  - C# 21 c5, c6, c8; 22 c4, c5, c6; 23 c1, c3, c4, c5, c7 were re-angled (F9: the card back paraphrased a gate key).
  - JS 11 c8: the back was wrong on Node 22. A typeless `.js` file with import/export syntax is reparsed as ESM.
  - New-topic cards: 25 c8 re-angled; 26 c4 lost "off by default". Both implied a keyed default.
- **Pretest checks:** `sections.json` check 2 of C# 21 and check 2 of C# 23 (F9: they gave away the q08 key).
- **Drill tests:**
  - 22/02: 2 tests strengthened and renamed.
  - 23/02: 1 test strengthened and renamed.
  - Reason: the importer caps a drill at 8 test names, so tests were replaced rather than added.
  - 25/02 (new): test 1 adjusted while it was being authored.
- **Drill instructions:**
  - 21/02: the case-insensitive unique index is now stated as `COLLATE NOCASE` / `lower(email)`.
  - F10(a): "Implement the stubbed …" was reworded in the bug hunts of C# 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 14, 16, 18.
- **Bug-hunt bugs re-planted (F10(c)):**
  - 05: a mutable-record `Cents` / `Add` replaces the `/ 100` integer division. The plant is in `tail`.
  - 06: `public new string Format` replaces the `>= 30` boundary. The plant is in `tail`.
  - 07: `new T[size]` with `default(T)` slots replaces `Count / size`. The plant is in `starterHead`.
  - Hints rewritten for all three.
- **Hints:**
  - C# 14 bug-hunt hint 1 no longer names the bug (F10(b)).
  - sysdrills hint 1 in 14 exercises (D4).
- **Lesson factual fixes:**
  - C# 21: a plain unique index is case-sensitive.
  - C# 22: `AddStandardResilienceHandler` order and defaults, and its retry covers POST by default (`DisableForUnsafeHttpMethods`).
  - C# 12: `AggregateException`, not AggregateError; WhenAll's first exception is not in argument order.
  - JS 06: private fields and DevTools.
  - JS 13: a garbled `Promise.all` sentence.
  - JS 14: string iteration counts.
  - JS 16: a cast is not validation.
  - JS 04: a misplaced paragraph.
  - Examples moved off the quiz keys they spelled out: C# 14 span example, C# 20 bulk example.

## Proofs and claims (all in logs, by writer)
- **D3 proofs.** Every reference passes, every starter fails, and each wrong change fails on the test the text names.
  The writers used `tools/seed/build/rv3b/prove.mts`, which runs the real drill-js runner and the real warm C# runner,
  plus the gradeCode harness for sysdrills.
  | Writer | Proof runs | Log |
  |---|---|---|
  | jsA | 62 | `jsA/proofs.log` |
  | jsB | about 45 | `jsB/proofs.log` |
  | csA | about 40 | `csA/proofs.log` |
  | csB | 67 | `csB/proofs.log` |
  | w6 | 68 | `w6/proofs.log` |
  | tst | 20 | `tst/proofs.log` |
  | sys | 95 | `sys/proofs.log` (+ worked-number checks for all 42) |
- **Proofs disproved six claims.** Two were the writers' own drafts and four were old text: JS 02/02, JS 04/02, C# 02/01,
  C# 09/01 (a compile error, not a test failure), C# 19/01 and C# 19/02. Each sentence was rewritten to match what the
  run showed.
- **Q6 claims run.**
  | Writer | Claims | Run on |
  |---|---|---|
  | jsA | about 240 | node |
  | jsB | 116 | node 22.16, tsc 5.9.3 strict, React 18.3.1 + jsdom |
  | csA | — | .NET 10 runtime and compile-error builds (CS8852, CS0206, CS1061, CS0070, ...) |
  | csB | — | .NET 10 / Kestrel (DI, options, routing, middleware, ProblemDetails, GC/LOH, Span) |
  | w6 | 81 | Microsoft.AspNetCore.App 10: logging, host/BackgroundService, channels, PeriodicTimer, System.Text.Json |
  | me | — | node:sqlite (the C# 21 collation claims) |
- **Not run** (stated conservatively and listed in the writer reports):
  - EF Core claims, C# 19-20: not in the shared framework.
  - React 19 features.
  - A few docs-only facts: TimSort, the ESLint rule, Python defaults, `document.all`.
  - `AddStandardResilienceHandler` defaults: taken from learn.microsoft.com (docs commit 156931bb); the package is not offline.

## Gates run (targeted, `--maxWorkers=1` / `--concurrency 1`, foreground, Git Bash; output tails)
```
seed:audit:explanations --track js|csharp|sysdrills --check   RESULT OK (x3)
seed:import:fundamentals --track js       topics 33 · quiz 330 · flashcards 238 · drills 79 === expected
seed:import:fundamentals --track csharp   topics 26 · quiz 260 · flashcards 208 · drills 55 === expected
seed:import:sysdrills                     TOTAL 129 (code 129) === expected
seed:validate --source fund-js            79/79, quarantined 0, AUDIT 20 re-executed 0 mismatch, STAMP written, RESULT OK (25.9s)
seed:validate --source fund-csharp        55/55, quarantined 0, AUDIT 20 re-executed 0 mismatch, STAMP written, RESULT OK (84.3s)
seed:validate --source sysdrills          129/129, quarantined 0, STAMP written, RESULT OK (74.4s)
seed:lint:keyideas                        24 side file(s), 192 idea(s): 0 problem(s), 0 leak(s) · RESULT OK
seed:lint:leaks                           146 pair(s), 146 baselined (baseline 146), 0 new, 0 stale · RESULT OK
seed:lint:answers                         0 new over the limit, 2 baselined, 0 worse · RESULT OK
seed:pins                                 RESULT OK: 688 pack(s): 688 OK, 0 MISMATCH, 0 UNCHECKABLE
restamp:all -- --dry-run                  700/700 fresh · RESULT OK
tools/seed: fundamentals/import, ops/explain-audit, ops/keyideas-lint, sysdrills/import   Test Files 4 passed, Tests 72 passed
server: test/api/fundamentals.test.ts, test/rv-day.test.ts                             Test Files 2 passed, Tests 21 passed
```
Not run, all left for the orchestrator's battery:
- root and client typecheck
- full suites
- `test:csharp` (the fund-csharp drills ran under the real C# runner through `seed:validate`)
- `smoke:api`, `demo:promotion`, `seed:demo:planted`, `seed:campaign`

## Deviations
1. **Writing was delegated** to six writer subagents under one brief (see the top). I did the review, the commits and every gate.
2. **One commit message overstates.** `2f7d480a` (C# 01) says F10(a) reworded its bug hunt; topic 01 had no such change. History was not rewritten.
3. **One environmental validation failure.** C# validation of 06/02 failed once with "C# runner unavailable: console-check: Check.dll failed to compile"; it passed on `--retry-failed`.
4. **Drill tests replaced, not added.** 22/02 and 23/02 already had 8 tests, the importer's maximum, so existing tests were strengthened and renamed instead of new ones being added.
5. **A lock removed by mistake.** jsB once removed the lock dir held by jsA and recreated it within seconds. The writers' heavy runs never overlapped after that.

## Upstream and other bugs found (report items, not fixed)
- **Upstream:** `dotnet-intercom@74e0a289 src/NetIntercom.Infrastructure/Persistence/DbSeeder.cs:78` logs the seeded default password (`LogInformation("... password '{Password}'", DefaultPassword)`).
- **`docs/SEEDING.md` §3 sysdrills is stale.** It says "the formula goes in hint 2; hint 3 is the approach in words"; the importer has enforced the reverse since R3-09.
- **Drill runner:**
  - drill-js user code does not behave as a strict ES module: module-level `this` is not undefined (jsA).
  - drill-js has no heap cap: the JS 14/02 starter (`Array.from` of an infinite generator) can use gigabytes until the 8 s timeout (jsB).
- **Weak tests seen, claims kept off them:**
  - JS 04/01: the explicit TypeError check is not enforced.
  - JS 05/01: a nested object that only one side has is not cloned.
  - JS 12/01: clearing the timer only in `.then` passes.
  - JS 20/01: a deps-length shrink is not tested.
- **Possible key overlap, under the lint gates.** Local stricter checks flag flashcards or checks that sit close to keyed answers, below the verbatim `seed:lint:leaks` gate:
  - C# 02 c1; 06 c4, c7; 08 c5; 10 c1, c8
  - C# 11 c6, c8; 14 c1, c3; 16 c6; 17 c2, c5; 18 c1, c8; 20 c4
  - checks: 05 "static", 18, 19
  - C# 16: the key is the longest choice in 4 of 10 items, under the lint limit.
- **Old code blocks** that fail `node --check` (L4, not gated): JS 01 blocks 2-3, 10 block 2, 11 block 1, 13 block 1, 14 block 1.
- **sysdrills:** the 07/06 test name "a third the vnodes" is ambiguous; 11/01 has two near-duplicate sentences.

## What is left
- **Java** (S2, W4) is the only track below the bar: quiz 96/200, drills 3/42, lessons 0/20. After it, `seed:audit:explanations -- --check` can join the gates with a baseline of 0.
- **`FUNDAMENTALS_EXPECTED` conflict on merge.** S3b changed the csharp line and S2 changes the java line of the same `source.ts` constant; keep both lines.
- **Optional:** re-angle the flashcards and checks in the "Possible key overlap" list above, if the review agrees.
- **Leftover processes:** none at stop. node, dotnet and VBCSCompiler matching `bq-f52-d` were checked, 0 found.
