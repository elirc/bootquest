# R1 · Fundamentals ladder review (round 1)

Reviewer R1. Target: `C:\Users\Owner\Desktop\bq-review` (`f52-wave` @ `dc2206bc`), read-only. Scope:
`content/fundamentals/**`, `content/packs/fund-{js,csharp,java}`, `tools/seed/authoring/fundamentals/**`.
Scripts and raw output are in `review-2026-11-12/work/R1/` (`sweep.cjs`, `testwise.cjs`, `verbatim.cjs`,
`coverage.cjs`, `sections.cjs`, `hints.cjs`, `related.cjs`, `mut/mutate.cjs` + `mut/mut-report.json`,
`mut/wrong.cjs`, `mut/w07.cjs`, `mut/w13.cjs`, `jv/wrongj.cjs`, `cs/wrongcs.cjs`, `cs/check.cs`, `jv/Check.java`,
`sqlcheck.mjs`).

## 1. Verdict

The ladder is accurate. I read all 704 gate items and found no wrong key. I checked 27 doubtful keys by
running them on Node 22.16, .NET 10.0.10 and JDK 17. The lessons are current and tight, and the senior JS
drills reject the plausible wrong code they claim to reject. The weak spots are elsewhere:
- **The gate measures recall of the lesson's own examples.** 198 of 704 items reuse the lesson's own expression verbatim.
- **The answer-length cue moved rather than disappeared.** The key is now usually the second-longest choice, almost never the shortest.
- **Every C#/Java framework drill re-implements the framework** instead of using it.
- **Java is pinned to 17.**
- **SQL basics come after the topics that use SQL.**

All of these are cheap to fix only **before** `f52-wave` lands; after that, the byte-identical rule freezes them.

## 2. Findings

| id | sev | tag | evidence | proposed fix |
|---|---|---|---|---|
| R1-01 | P2 | VERIFIED | **The length cue was displaced, not removed.** Key length rank (0 = longest) per track: JS 94/126/59/25, C# 61/77/58/4, Java 56/84/51/9 (`testwise.cjs`). So the key is the longest or second-longest choice in 72% (JS), 69% (C#) and 70% (Java) of items, against 50% by chance. It is the shortest only 8% / 2% / 4.5% of the time. "Pick the second-longest" scores 40.5% / 39.0% / 41.5% against 25%. On items they do not know, a learner who knows 60% and uses this cue raises their pass chance on a 10-item gate from 0.38 to 0.56 (8-item: 0.26 to 0.39); at 70% knowledge it goes from 0.60 to 0.74. The f52 lint only checks the single longest and single shortest choice (`seed:lint:answers`, 40% rule), so the rewrite passed it by making the key the second-longest choice instead. | Before landing, rebalance so each length rank holds 15-35% of keys per track, and make no rank under 10%. Extend the lint (`tools/seed/src/ops/answer-positions.ts`, not fingerprinted per SEEDING §8) to check the full rank distribution. S-M, content + lint, no restamp. |
| R1-02 | P2 | VERIFIED | **The gate tests recall of the lesson's own examples, not transfer.** In 198 of 704 items (28%), the prompt's code (8 or more characters) appears verbatim in that topic's lesson: JS 72/175, C# 54/110, Java 72/110 code-bearing items (`verbatim.cjs`). Examples: `csharp/03` lesson line `decimal.Parse("1,5", CultureInfo.InvariantCulture) // 15` is q2; `$"{id:D3}" // 007` is q9; `java/13` `YYYY` trap is q5. Closed-book makes the gate harder to open, but the gate still checks whether you remember the lesson's examples. | Before landing, give ~100 of these items a fresh expression with the same concept and a new value (keys and explanations adjusted). After landing, add 2 "fresh-example" items per topic (the schema allows 12) or a rotating set B (see §5 T1). M, content only. |
| R1-03 | P2 | VERIFIED | **Drill test gaps (wrong code that passes).** (a) `fund-java/08…/01-semantic-version`: the spec rejects "signs" and empty parts, yet `split("\\.")` without `-1` (accepts `"1.2."`) and parseInt-then-reject-negatives (accepts `"+1"`) both pass 5/5 (`jv/wrongj.cjs`). (b) `fund-js/13…/01-map-with-concurrency-limit`: a mapLimit **with no failure flag** that keeps starting calls after a rejection passes 5/5 on this Windows machine. The test waits 30 ms with 5 ms timers, and Windows timer granularity (~15 ms) hides the extra starts (`mut/w13.cjs`). (c) `fund-js/07…/01-multi-key-sort`: a comparator with `<=` (it returns on ties and never consults the second key) passes 5/5 (`mut/w07.cjs`). (d) `fund-js/28…/03-answerable-request-log`: the 500 and 400 boundaries are untested (`>= 500` to `> 500` survives; the drill killed 0 of 5 mutants). (e) `fund-js/33…/01-verify-hs256-jwt`: a timing-unsafe `===` signature compare passes. Behaviour cannot catch this, but the explanation should say so. Wider sweep: all 62 JS reference solutions pass and every starter fails; 264 single-site mutants on 49 drills, 230 killed (87.1%), most survivors equivalent (`mut/mut-report.json`); 14 of 15 hand-written plausible-wrong senior JS solutions were rejected; C# `12/01` deferred-`Select` re-fetch was rejected. | Add test cases: `"1.2."`, `"+1"` (java 08); count `started` deterministically with a manual scheduler or a gate promise instead of timers (js 13); add a 3-row tie case where the second key decides (js 07); add statuses 500 and 400 (js 28/03); one sentence in the js 33/01 explanation that timing safety is not tested. S, content only (fund packs re-validate with `seed:validate`, no estate restamp). |
| R1-04 | P2 | VERIFIED + JUDGMENT | **All 22 C#/Java framework drills re-implement the framework instead of using it.** C# 15-20 (12 drills: mini DI container, route matcher, pipeline, exception middleware, authorize-after-routing, validate-signup, three change-tracker emulations, batch load, concurrency-token, two-save transaction) and Java 17-20 (10: mini container, two `@ExceptionHandler` resolvers, status-code order, derived-query parser, entity equals, persist-or-merge, batching, self-invocation, lazy load). For example, `csharp/20/02-concurrency-token-to-409` is a `Dictionary` version check, the same exercise as `js/21/02` in C# syntax. The learner never writes `MapGet`, a `DbContext` query, `[ConcurrencyCheck]` or a `@RestController`. SEEDING §8 says "the graders have no framework runtimes", but for C# this machine's NuGet cache already holds `microsoft.entityframeworkcore.sqlite` 10.0.12, `microsoft.aspnetcore.testhost` / `mvc.testing` 10.0.10-12 and `xunit` 2.9.3, the ASP.NET Core shared framework is installed, and `server/src/runners/csharp/scratch.ts:46` already has an xunit PackageReference shape. There are no Spring jars in `~/.m2`. | Add a "real framework" C# shape: xunit + `WebApplicationFactory`/TestHost + EF Core Sqlite in-memory, restored offline from the cache. Author 6-8 real-framework drills (C# 16-20). Keep the emulations as the "how it works" warm-up. L; touches `server/src/runners/csharp/scratch.ts` (fingerprinted for drill-cs: **restamp of all drill-cs packs**). Java: no change possible until Spring jars are vendored (owner decision). |
| R1-05 | P2 | VERIFIED | **Java is pinned to 17.** JDK 17.0.10 is the only JDK, and the runner and `test:java` target 17. The lessons teach the 17 workaround: `java/03` says "in 17 you use instanceof chains" (pattern switch "became standard in Java 21"), `java/14` says virtual threads "are not available on Java 17", and quiz `java/14 q9` keys "No: … standard feature in Java 21". Java 21 LTS (2023) and 25 LTS (2025) are current, so a 2026 senior Java engineer is expected to know virtual threads, pattern switch, record patterns and sequenced collections. | Owner decision: move the Java runner to JDK 21 (or 25). Then add topic "java/21-modern-java-21" and replace the "not on 17" items before landing. M (env + `test:java`), restamp of drill-java packs if the toolchain fingerprint changes. |
| R1-06 | P2 | VERIFIED | **SQL basics come after the topics that use SQL.** JS 29-32 (NULL logic, joins, constraints, indexes, transactions) follow 21-27, whose lessons and 10 gate items already use `UPDATE … WHERE version = ?`, `WHERE created_at < ?`, OFFSET, `IN (…)` and `ALTER TABLE` (`js/21 q3`, `js/23 q1-q3`, `js/25 q3/q5/q8`, `js/27 q3/q4`). Topic ids carry the `NN` order and item keys carry the id (`fund:js/21-…/q01`), so reordering means renaming keys, which is allowed only before landing. | Before landing, renumber SQL 29-32 as 21-24 and shift 21-28 to 25-32 (ids, keys, `sections.json`, `related.json`, `FUNDAMENTALS_EXPECTED` unchanged). S-M, content only. |
| R1-07 | P2 | VERIFIED | **Coverage holes in C#/Java (stops at 20 topics).** No testing topic (xUnit/NUnit, JUnit 5/Mockito, test slices), no authN/Z in ASP.NET Core or Spring Security, no HttpClient/RestClient + timeouts, no logging/observability (`ILogger`, SLF4J/MDC), no background work (`BackgroundService`, `@Scheduled`, Channels), no serialization topic (System.Text.Json, Jackson). The 13 senior CRUD topics (21-33) exist only on JS by council ruling, so a C#/Java-only learner never meets pagination drift, idempotency, tenant scoping or SQL. JS also has no "testing basics" topic (28 covers seams, not test design). | See §4. |
| R1-08 | P3 | VERIFIED | **Explanations are too thin to teach on a miss.** Median words: JS 19, C# 14, Java 11. 108 of 200 Java explanations are under 12 words (C# 63/200, JS 19/304). Examples: `java/07 q9` "It is the standard grouping idiom.", `java/03 q6` "Check for null before switching.", `csharp/11 q4` "That guarantee is the whole point of using." | Rewrite the bottom ~150 so each says why the key is right **and** why the most tempting distractor is wrong (≥25 words). S-M, content; explanations are not keys, so this is legal before landing (and after, if the byte-identical rule is read per key). |
| R1-09 | P3 | VERIFIED | **related.json ("more practice") has off-topic mappings.** All 448 keys resolve (0 missing; 15 keys mapped to 2 topics). About 14 are off-topic: `csharp/02` → `csdrills/06…/08-clean-input`; `csharp/06` → `csbootcamp/04…/05-durations-and-the-clock`; `csharp/14` → `csdrills/08…/02-ring-buffer`; `csharp/17` → `csdrills/06…/07-auth-headers`; `csharp/19` → `csdrills/01…/01-sync-added-removed` and `jstrain-cs/21…/04-test-isolation`; `csharp/15` → `…/04-test-isolation`; `java/05` → `javabootcamp/19-debugging/05-email-set` (an equals bug); `java/16` → `12-messaging-and-events/01-pubsub-bus` and `16-design-patterns/04-observer-stock`; `java/17` → `17-deterministic-concurrency/05-manual-executor`; `java/18` → `javadrills/07…/02-catch-order`; `java/19` → `…/09-mutable-hashmap-key`; `js/31` → `bootforge/engineering-practice/…/normalized-email`. Six topics have 3 or fewer entries (`js/31`, `csharp/16`, `csharp/17`, `csharp/19`, `java/18`, `java/19`): the framework topics are padded with stand-ins. | Drop the 14. Show "no matching practice yet" rather than stand-ins. S, `content/fundamentals/related.json` (server-local, not fingerprinted). |
| R1-10 | P3 | VERIFIED | **The hardest gates have the strictest bar.** The 13 senior JS topics have 8-item gates. `meetsCorePct` (`server/src/engines/campaign.ts:38-40`) needs 7/8 = 87.5% (one miss allowed); every 10-item gate needs 8/10 (two misses allowed). | Give 21-33 two more items each (10, which also gives more transfer items, R1-02), or accept the difference and say so in the UI. S, content. |
| R1-11 | P3 | VERIFIED | **Known items from `fable52docs/wave/REPORT.md` are still unfixed.** `js/04 q10` (`f.call(null)` in strict code is `null`): the lesson says only that a plain call gets `undefined`. `java/06 q8` (why `Comparable<? super T>`): the lesson shows the signature without the reason. `csharp/18 q7` (`[Range]` is inclusive): only implied by the example error text. | Add one sentence to each lesson. S. |
| R1-12 | P3 | VERIFIED | **Most topics have only one drill.** 49 of 73 topics have exactly one drill of 5 tests: JS 04-20 (17), C# 02-16 and 18 (16), Java 02-17 (16). The ratio is 704 MCQ to 116 drills. | §5 T2 (bug-hunt drills derived from existing tests) adds ~49 cheaply. |
| R1-13 | P3 | VERIFIED | **Stale version references.** On a .NET 10 runner, distractors say "obsolete in .NET 8" (`csharp/08 q9`, `csharp/09 q8`), and `fable52docs/wave/CONTENT-RULES.md` rule B still says "C# 12/.NET 8". The React topics (19-20) are React 18 (`js/19` "React 18 batches…"), with nothing on React 19 Actions, `use`, `useActionState`, ref-as-prop or the compiler's auto-memoization. | Update the distractors and rule doc. Add a React 19 delta section to `js/19-20` before landing. S. |
| R1-14 | P3 | JUDGMENT | **Version and diagnostic trivia in the gate.** `csharp/02 q8` (the code number CS8618), `csharp/11 q6` (CS0160), `java/16 q3` (the default GC on 17), `java/14 q9` (virtual threads on 17). These test what a version or compiler number is, not what to do. | Replace them with behaviour questions before landing (4 items). S. |
| R1-15 | P3 | JUDGMENT | **Many drills repeat across tracks.** N+1 batching appears 3× (`js/27/01`, `csharp/20/01`, `java/20/01`), version check → 409 3× (`js/21/02`, `js/32/02`, `csharp/20/02`), DI mini-container 2× (`csharp/15`, `java/17`), route matcher 2× (`js/18`, `csharp/16`), LRU 2× (`js/09`, `java/16`) plus 2 LRU drills in javabootcamp (`09-caching/01`, `20-scaffolded/04`). Single-track learners won't notice; a polyglot owner will. | No cut needed. Mark the cross-track twins in the UI ("you solved this in JS"), and use them for the contrast idea in §5 T7. |
| R1-16 | — | VERIFIED (positive) | **Things that hold up.** 0 wrong keys in 704 (all read). Keys run and confirmed include `decimal.Parse("1,5", Invariant)` = 15, `string.Concat` reference inequality, tr-TR `İ`, `Long.valueOf(1).equals(1)` false, `YYYY` → 2027, `Period` P1M14D, the Berlin DST 23 h, and SQLite ADD COLUMN NOT NULL failing only on a non-empty table. Compiled `topics.json` equals the authoring files (73/73, lesson trailing newline aside). Gate→heading map: all 704 headings exist, and a heuristic flags only 3 as possibly pointing at the wrong section (`js/04 q10`, `js/12 q6`, `csharp/02 q7`). Hints: 116 drills × 3, no backticks in served hints, ~5 served hints name an API (`java/11/01` "Optional.ofNullable" in hint 1, `csharp/14/01` "int.Parse accepts a span", `java/16/01` "eldest"). Quarantine is empty in all 3 packs. | Keep. |

## 3. CUT (merge or demote)

| What | Count | Why |
|---|---|---|
| Version and diagnostic trivia gate items: `csharp/02 q8`, `csharp/11 q6`, `java/16 q3`, `java/14 q9` | 4 items | They test a version or compiler number, not behaviour (R1-14). Replace before landing, or retire after. |
| Off-topic `related.json` entries (list in R1-09) | 14 mappings | They send the learner to unrelated practice and make thin topics look covered. |
| "Not on Java 17" framing in `java/03`, `java/14` lessons and `java/14 q9` | 2 sections, 1 item | Teaches a workaround that is out of date in 2026; keep only if the JDK stays pinned (R1-05). |
| Demote, not delete: C#/Java emulation drills as the *only* framework practice | 22 drills | Keep them as "how it works" warm-ups. Once real-framework drills exist (R1-04), label them "mechanism" so "framework topic complete" never means "never touched the framework". |
| React 19-20 drills and gates: demote to optional | 2 topics, 20 items, 2 drills | The lessons are fine, but the drills simulate React in plain JS (`createEffectSlot`, a reducer), and `related.json` already maps 15 React drills onto them (13 from bootforge `react-fundamentals`/`react-state`). For a CRUD-backend upskill they are the least useful step on the path. JUDGMENT. |
| Nothing else | — | Lessons, flashcards and quiz items are accurate and on-level. I found nothing else worth deleting. |

## 4. ADD

**A. Before landing (the window closes when `f52-wave` merges):**
1. ~100 fresh-example replacements for the verbatim-copied gate items (R1-02), weighted to Java (72) and
   C# (54).
2. Choice rebalancing so the key's length rank is flat (R1-01). This touches roughly the 220 JS / 138 C# /
   140 Java items where the key is ranked 0-1.
3. Two more items per senior JS topic, 21-33 (+26), so all gates are 10 items (R1-10).
4. Renumber SQL 29-32 as 21-24 (R1-06).
5. The missing test cases from R1-03 (5 drills).

**B. New C# topics (21-27), same format (lesson, 10 items, 8 cards, 2-3 drills):**
`21-testing-with-xunit-and-webapplicationfactory` (real drills feasible offline; see R1-04),
`22-httpclient-timeouts-and-resilience` (IHttpClientFactory, cancellation, retries with jitter),
`23-authentication-and-authorization` (JWT bearer, cookie auth, policies, resource-based checks, 401 vs 403 vs 404),
`24-logging-and-observability` (ILogger templates, scopes, no secrets, request ids, OpenTelemetry basics),
`25-background-work-and-graceful-shutdown` (BackgroundService, Channels, stopping tokens),
`26-serialization-with-system-text-json` (naming, nulls, polymorphism, source generation, dates),
`27-caching-in-aspnet-core` (IMemoryCache, HybridCache, output caching, invalidation).
That is 7 topics, ~70 items, ~56 cards and ~18 drills.

**C. New Java topics (21-27):** `21-testing-junit5-assertj-mockito` (plain JUnit runs on the existing
javabootcamp harness style; Spring test slices only as quiz items), `22-spring-security-basics` (filter
chain, method security; quiz + emulation drill), `23-bean-validation-in-depth`, `24-jackson-serialization`,
`25-logging-slf4j-and-mdc`, `26-http-clients-restclient-and-timeouts`, `27-modern-java-21` (virtual
threads, pattern switch, record patterns, sequenced collections; needs JDK 21, see R1-05).

**D. All three tracks:**
`testing-fundamentals` (test design: arrange/act/assert, boundaries, what not to mock, flaky tests. The js/13
timer flake in R1-03 is a ready-made example). `concurrency-in-the-database` (isolation levels, SELECT … FOR
UPDATE vs version columns, deadlocks; partly in `js/32`). `http-caching-and-conditional-requests` (ETag/If-Match,
Cache-Control; `csdrills/10…/06-etag-precondition` exists to link). For C# and Java, **thin
"bridge" topics** that point at the JS senior topics 21-33 instead of twins: one lesson per track mapping the
JS concept to EF Core / JPA code, with a 4-item gate. This respects the council's "no twins" rule.

**E. Drills:** one bug-hunt drill for each of the 49 single-drill topics (R1-12; method in §5 T2).

## 5. New features, learning styles and teaching methods

| id | Method | Learning rationale | Size | Files | Restamp risk |
|---|---|---|---|---|---|
| T1 | **Rotating fresh-example gate sets (set B/C)**, served on retake like the EB rotating sets. Each topic gets a second 10-item set on the same headings with new values and expressions. | It separates "remembers the example" from "can apply the rule" (R1-02), and a retake stops being a re-read of the same 10 questions. The shuffle hides question order, not the content. | M (content ~700 items over time) + S server | authoring JSON (`quizB[]` side file like `sections.json`, or new keys), `server/src/store/fundamentals.ts` | None if kept in a side file. `server/src/store` is not in `fingerprint.test.ts`'s input set (f52 edited it with 700/700 fresh). |
| T2 | **Bug-hunt variants from existing drills.** For each drill, a sibling drill whose starter is the plausible-wrong implementation that the drill's own `explanation` names, using the same tests. Senior JS explanations already spell these out ("filters on createdAt alone…", "collects every handler and picks the globally closest"). | Debugging a near-right solution is the main skill of a senior CRUD engineer, and it is graded by the existing runners. It roughly doubles practice at near-zero test-authoring cost. | S per drill; ~49 + 39 | authoring `drills[]`, fund packs re-validated | None (fund packs are self-stamped; no new check type). |
| T3 | **Predict-the-output with "run it" after answering.** An MCQ whose prompt is a fresh 3-6 line snippet. After the learner answers, a "Run" button executes it in the existing js runner (C#/Java later) and shows the real output. | Output prediction plus immediate execution feedback builds the "code-truth" habit and removes the explain-it-to-me dependency. The council cut typed predict-output, but MCQ plus run keeps the existing grading. | M | client quiz review screen; new read-only endpoint wrapping `runners/js` | A new endpoint is fine. Changing `server/src/runners/js/*` would restamp drill-js, so call it, don't edit it. |
| T4 | **Worked-example fading per topic.** Drill 1 is a fully solved example with 1-2 lines blanked (fill-in), drill 2 has the core loop blanked, drill 3 is blank. javabootcamp `20-scaffolded/04-lru-cache-fill-in` is the precedent. | Fading suits the beginner and intermediate topics (JS 01-12, C# 01-08, Java 01-08). Their single drill is currently a full build-from-blank, the largest jump for a novice. | S per topic | authoring `drills[]` (starter = solution minus lines) | None. |
| T5 | **Spaced re-gates (retention checks).** At +7 and +30 days after a pass, a 4-item mixed check from that topic (set B if T1 exists) appears in the dashboard hero after reviews. A miss marks the topic "rusty" and links the "Re-read" sections from `sections.json`. | Flashcards re-test card facts; nothing re-tests the gate concepts, so a passed topic is "complete" forever. Spaced retrieval of the gate concepts is what makes the ladder stick. | M | `server/src/store/fundamentals.ts` scheduler (reuse FSRS due dates), client hero | None if done outside fingerprinted runners and enums (no new check type: reuse `study-quiz` with a subset `itemKeys`). |
| T6 | **Parsons problems for beginner drills.** Reorder the shuffled lines of the reference solution; graded by running the reordered code against the drill's tests (so any order that works passes). | It lowers syntax load for novices so the topic, not typing, is practised. Running the code avoids "one true order" grading. | M | client drill player (drag-reorder producing a code submission) | None: the submission is still code graded by `drill-js`/`drill-cs`/`drill-java`. |
| T7 | **Cross-language contrast items for the polyglot owner.** "Same code, three languages": `split` semantics (Java drops trailing empties `java/02 q4`, C# keeps them `csharp/03 q7`, JS's limit truncates `js/08 q4`), `finally { return }`, integer overflow, string equality, month-end arithmetic (`js/28 q3` = 2025-03-03 vs `java/13 q2` = Feb 28). | Contrasting cases are among the strongest transfer tools, and the owner works in all three languages. The material already exists in three tracks. | S (content: ~20 items in a "contrast" card deck) | flashcards or a side deck | None. |
| T8 | **Confidence-tagged answers.** On each gate question the learner taps sure / unsure. Confident-wrong answers get a review card immediately (after a pass), and calibration is shown per topic. | It targets misconceptions, the most expensive kind of error, and gives the owner a calibration signal that 0 attempts so far cannot. | M | client gate stepper; attempt payload extension (`api-ext.ts`) | `api-ext.ts` is the sanctioned DTO file (f52 used it). Check the attempt schema in `shared/src/api.ts` is not touched. |
| T9 | **Pretest before reading.** Two ungraded "check yourself" cards shown *before* the lesson, with the answer revealed after the matching section. Extend the 32 JS 01-05 checks to all 73 topics. | The pretesting effect: attempting first, even wrongly, improves later encoding. The `checks[]` mechanism already exists. | S-M (content: ~140 checks) | `content/fundamentals/sections.json` | None. |
| T10 | **Real-framework C# drills** (R1-04): xunit + `WebApplicationFactory` + EF Core Sqlite, from the local NuGet cache. | Transfer from "I can describe the change tracker" to "I can write the query and see the SQL". This is the largest skill gap the C# track leaves. | L | new shape in `server/src/runners/csharp/scratch.ts` | **Yes: drill-cs fingerprint includes `scratch.ts` (`tools/seed/src/factory/fingerprint.test.ts:67`), so every drill-cs pack restamps.** |
| T11 | **Length-rank lint** (R1-01): fail a topic when any key length rank holds over 40% or under 10% of keys, and when the key is "not shortest" in over 90%. | It closes the loophole that the f52 rewrite used. | S | `tools/seed/src/ops/answer-positions.ts` | Check the factory fingerprint walk; `ops/` was edited by f52 without a restamp. |

## 6. Coverage statement

- **Swept by script (all items):** 73 topics, 704 quiz items, 558 flashcards, 116 drills, 704 gate→heading
  mappings, 32 checks, 448 more-practice mappings.
  - Quiz items: counts, positions, length ranks, test-wise strategies, hedges, prompt overlap, near-duplicates,
    explanation length, verbatim reuse, lesson token coverage.
  - Flashcards: near-duplicates against quiz items and against each other, length.
  - Drills: hint leaks, test counts, hint lengths.
  - Mappings: heading existence, a section-relevance heuristic, key resolution against 4,311 indexed units.
  - Compiled `topics.json` was checked against the authoring files: 73/73 equal.
- **Read in full:** all 704 quiz items (prompt, 4 choices, key), with explanations for the flagged ones
  and ~60 others. Flashcards for 8 topics (64 cards) plus the 23 flagged pairs. 4 lessons in full
  (`js/33`, `csharp/03`, `csharp/12`, `java/20`) and grep excerpts from ~25 more. 12 drills in full
  (instructions, solution, tests). All 448 more-practice titles.
- **Executed:** 27 doubtful quiz facts on Node 22.16 / node:sqlite 3.49.1, .NET 10.0.10, JDK 17.0.10. All 62 JS
  drills (reference solution + starter) and 264 mutants. 15 hand-written plausible-wrong JS solutions,
  4 Java variants (`java/08`), 2 C# variants (`csharp/12`).
- **Not covered:**
  - C# drills other than `12/01`, and Java drills other than `08/01`, were not executed. Their reference
    solutions are trusted from `validation.json`.
  - 69 lessons were not read end to end. Lesson accuracy beyond the 4 full reads rests on gate-key checks
    and excerpts.
  - Flashcard backs outside the 8 topics were swept, not read.
  - The client rendering of the ladder was not viewed (R4's domain).
  - `seed:lint:leaks` and `seed:lint:answers` were not run (estate-wide; the machine rules). The f52 report
    says both are OK.
