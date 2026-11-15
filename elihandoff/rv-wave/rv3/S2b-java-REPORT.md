# rv3 S2b `rv3-java2` stop report (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-d`, branch **`rv3-java2`**, base `73132ecb` (hub `rv-wave` with every rv3 stream
except agent engineering). Tip **`f88906ec`**, 21 commits, tree clean. Nothing pushed, `main` untouched, no `--no-verify`,
no history rewrite. Every commit was made with `git commit -F` and ends with the Co-Authored-By line. The owner DB was
never opened. No node, java or javac process matching `bq-f52-d` was left at stop (0 found).

**Status: done.** Java Fundamentals 01-20 meet the §2 bar, and `seed:audit:explanations -- --check` is OK for all tracks.

**How it was done.** I wrote topics 01-13 myself. One writer subagent wrote 14-20 under a binding brief
(`tools/seed/build/rv3j/BRIEF.md`, git-ignored) and committed nothing. A lock dir (`rv3j/locked.sh`) allowed one heavy
process at a time (prove runs, java snippets, the audit, tsx). I checked each of the writer's topics field by field
against HEAD (`rv3j/fields.cjs`). I made every commit, the re-import, the validation and every gate run. All scratch
files are in `tools/seed/build/rv3j/` (git-ignored): `prove.mts` (the D3 harness over the real drill-java runner),
`p/` and `w/p/` (proofs), `e/` and `w/e/` (edit files), `snip/` and `w/snip/` (JDK 17 snippets), `proofs.log` and
`w/proofs.log`.

## Branch + SHAs (oldest first)
| SHA | What |
|---|---|
| `f951c6bb` `7f0cf549` `f8159da4` `732060fc` `6f086be1` `ec9ebe52` `534c6113` `53a09fc1` `b4fba94b` `2d5ac9d6` `87ff2527` `c8d387a7` `9008cb29` | Topics 01 to 13, one commit each (me) |
| `3962722f` `aebcdf50` `06ab0026` `903319e6` `1ab0f14f` `88276c56` `758f43b3` | Topics 14 to 20, one commit each (writer text, my review and commit) |
| `f88906ec` | Re-import fund-java (topics 01-26) and re-stamp |

## Counts before → after (by script)
**Explanation audit, java (`seed:audit:explanations`):**

| Family | At `73132ecb` | At `f88906ec` |
|---|---|---|
| quiz | 260/260 | 260/260 |
| drills | 25/60 (D1 35) | **60/60** |
| lessons | 6/26 (L1 20) | **26/26** |

- Estate-wide gate failures went from 163 (all Java) to **0**.
- Reading lists for java: D2 42 → 3, D3 16 → 22 (every listed claim sentence is proven), L2 20 → 9, L3 5 → 3.

**Fields changed in `tools/seed/authoring/fundamentals/java/01-20` vs `73132ecb` (script `rv3j/diffbase.cjs`):**
- 20 `lesson`
- 42 `drill.explanation`
- 12 `drill.starter` and 12 `drill.solution`: the test blocks of 6 strengthened drill pairs.
- **0 quiz fields** (prompts, choices, answers, explanations), **0 flashcards**, 0 hints, 0 instructions, 0 `##` headings.
- `sections.json` and `related.json` are unchanged.

**Census:** `FUNDAMENTALS_EXPECTED.java` 26 / 260 / 208 / 60 is unchanged. Key ideas: 24 files, 200 ideas. Packs 688,
restamp 700 (no pack added).

## Changes outside explanations and lessons (each listed)
- **Prompts, choices and keyed answers: none changed.**
- **Drill tests strengthened.** In every case a run showed a plausible wrong change passing a rule the instructions
  state. Each change is in all copies the pair shares, and test names are unchanged unless marked "new". After each
  change I ran the reference (PASS), the starter (FAIL), the bug-hunt starter (FAIL on its own test only) and the
  mutant (FAIL).

| Topic | Test | Change | What passed before |
|---|---|---|---|
| 03 | "express is halved from 10000 cents" | also checks exactly 10000 | `> 10000` |
| 07 | **new** "domains come out sorted whatever their hash order" | shop.io / api.io / mail.io | `HashMap`, `Map.copyOf` |
| 07 | "invalid addresses are skipped" | adds `a@b.io@` | `split("@")` without -1 |
| 09 | "status and min combine with AND" | accepts exactly 1000 for `min:1000` | `>` |
| 12 | bad-line test | input `100\n\nabc`, expects "line 3" | counting non-blank lines only |
| 14 | **new** "a failing task is rethrown as an unchecked exception" | drill 01 only | `awaitTermination` that drops task errors |
| 17 | "several candidates without one primary fail" | adds a two-primaries case | first of two primaries wins |
| 17 | **new** "a singleton is created on first use, once" | — | eager singletons |
| 20 | "distinct ids are loaded in batches" | ids 30, 10, 20 in first-seen order | `HashSet` dedupe |

- **Lesson code (L4).** In 13, the DST code block had a pseudo-code line (`Duration.between(sat noon, sun noon ...)`) that
  did not compile. It is now real code, and it prints 23.

## Old text found wrong (fixed, proven)
- **07:** "split("@", -1) ... so "ana@" is rejected". It is rejected either way; `-1` matters only for a trailing `@`.
- **07:** the sorted-order test could not tell a `HashMap`.
- **10:** the bug-hunt text said "comes back scrambled". Only the tie test catches it; the other keys came out in order by luck.
- **16:** named a test that does not exist ("get refreshes"); now "a read refreshes an entry".
- **17:** code block called a `pickPrimary` helper that is not in the solution.
- **18:** two claims narrowed:
  - the map-order version picked `Exception` for `ConflictException`, not `NotFoundException`;
  - method-after-route gives 405 with only `GET`, not 404.
- **19:** code block showed `split("And")`; the solution uses `split("And", -1)`.
- **20:** two corrections:
  - a rethrown `InvocationTargetException` reaches `refund` callers raw (it declares `throws Exception`), and only
    `placeOrder` callers get `UndeclaredThrowableException`;
  - a "view returns the entity" variant is impossible by the signature, so it was replaced by two proven variants.

**Runs that disproved draft sentences (narrowed to "passes these tests"):**
- 02 `split` without `+`
- 03 `default -> 0`
- 04 `trim()`
- 06 `List<T>` / `Comparable<T>` / `Collection<Number>` (the lesson shows the calls only the wildcard signatures accept)
- 08 `major - o.major`
- 11 `map` instead of `flatMap` compiles here (`Map.get(Object)`)
- 14 the `threads < 1` check is redundant
- 15 `handle`
- 16 `synchronizedMap`

## Gates (this clone, one heavy process at a time, Git Bash, foreground or one background job)
```
seed:audit:explanations -- --check        850 quiz, 323 drills, 85 lessons: 0 fail a gate rule · RESULT OK (all tracks)
seed:import:fundamentals --track java     topics 26 · quiz 260 · flashcards 208 · drills 60 === expected
seed:validate --source fund-java          26 courses one by one (--concurrency 1): 26 RESULT OK, 0 quarantined;
                                          full run: COUNTS validated 60 · AUDIT 20 re-executed / 0 mismatches ·
                                          STAMP written · RESULT OK (74.4s)
seed:lint:leaks                           146 pair(s), 146 baselined (baseline 146), 0 new, 0 stale · RESULT OK
seed:lint:answers                         303 scanned, 0 new over the limit, 2 baselined, 0 worse · RESULT OK
seed:lint:keyideas                        24 side file(s), 200 idea(s): 0 problem(s), 0 leak(s) · RESULT OK
seed:pins                                 RESULT OK: 688 pack(s): 688 OK, 0 MISMATCH, 0 UNCHECKABLE
restamp:all -- --dry-run                  700/700 fresh · RESULT OK
vitest tools/seed fundamentals/import + ops/explain-audit   Test Files 2 passed, Tests 37 passed
vitest server test/api/fundamentals.test.ts                 Test Files 1 passed, Tests 13 passed
```
- Validation used a clone-local `BOOTQUEST_JAVA_SCRATCH` (`tools/seed/build/rv3j/seed-java`), because `.cache` is
  shared with `bq-f52-c`.
- Not run, left for the orchestrator's battery: root/client typecheck, full suites, `test:java` (no runner file changed;
  the Java checks are the real-runner `seed:validate` stamp), `smoke:api`, `demo:promotion`, `seed:demo:planted`,
  `seed:campaign`.

### D3 / Q6 proofs (real drill-java runner, JDK 17.0.10)
- **334 proof runs**: 178 in `rv3j/proofs.log` (01-13), 156 in `rv3j/w/proofs.log` (14-20).
- Every drill's reference passes and its starter fails.
- Every bug-hunt starter fails only the test its explanation names.
- Every "fails / throws" sentence about a test was run as a mutant and fails the test it names.
- Every new runtime fact in a lesson was run in a JDK 17 snippet (22 files in `rv3j/snip`, more in `rv3j/w/snip`). Examples:
  - casts clamp and NaN → 0
  - a ternary-unboxing NPE
  - `split` edge cases
  - pattern scope and the sealed compile errors
  - `equals(Order)` overloading
  - lost HashMap updates (107,407 to 187,833 of 200,000 over 5 runs)
  - the `a - b` comparator sorting `MIN_VALUE` last
  - `Integer::toString` ambiguity
  - `orElse` vs `orElseGet` call counts
  - `toMap` null-value NPE
  - `finally` swallowing an exception
  - multi-catch compile errors
  - `Period` vs `Duration` across the Berlin DST change
  - volatile `count++` totals, CompletableFuture timings, the `System.gc()` full pause, JDK proxy self-invocation
- **Docs-only claims** (no framework jars offline; stated conservatively):
  - JPA `@Enumerated` defaults to ORDINAL (04).
  - Spring creates singletons eagerly unless `@Lazy` (17).
  - 18: Spring MVC status codes, `defaultValue` binding, `@Valid` listing every field error, null passing most
    constraints, advice order (drill 02 models the advice rule).
  - 19: Hibernate proxies are runtime subclasses, a derived-query typo fails at startup, and `findByIdAndCustomerId`
    returns empty for another customer's order.
  - 20: rollback rules, the versioned UPDATE shape, `PageRequest`.

## Deviations from the brief
1. **Writing for 14-20 was delegated** to one writer subagent (the brief allowed up to 2). It ran under the lock; I did
   the review, every commit and every gate.
2. **Drill tests were strengthened in 7 topics** (listed above), which goes beyond explanation text. Ruling 1 allows
   drill tests to be rewritten, and each change is proven. No test was renamed; three tests were added (07, 14, 17),
   each drill staying under the cap of 8.
3. **Extra drills and the 13 code block.** I also tidied two drills that already passed: 13/01 now names its tests (D2),
   and 18/02-03, 19/02-03 and 20/02-03 had their last paragraph rewritten to quote verbatim test names. I also replaced
   one non-compiling lesson code line (13).

## Upstream and other bugs found (report items, not fixed)
**Weak tests left:**
- 14/01: removing `pool.shutdown()` passes every test ("never leaks" is untested).
- 05: removing `final` from `withdraw` is untestable by design.
- 09: `split(":")` without a limit passes (no value contains `:`).
- 11, 04: locale-free `toLowerCase` / `toUpperCase` pass under the default locale.

**19/01 reference:** the `contains("Or")` check rejects valid names such as `findByOriginCountry` and
`findByOrderNumber`. The instructions' "no Or" rule is ambiguous, so the tests were left alone; the explanation says so.

**Proof harness:**
- The drill-java spec replaces the tests region with the canonical tests, so a proof cannot edit or add a test inside
  `main`. Mutate code outside the tests, or change the authoring file itself.
- A relative `BOOTQUEST_JAVA_SCRATCH` / scratch dir makes every compile fail; use an absolute path.

**Tooling:** the Bash tool on this machine collapses `\\` to `\`, even inside quoted heredocs, which corrupted regex
needles and a Java snippet. Write files with backslashes through the Write tool.

**Java 17 notes for later lesson work:**
- A `final String` field initialised with a constant is inlined, so it is visible in an override called from the
  super constructor. Only fields assigned in the constructor are null there.
- `Optional` is final and not `Serializable`, so `Optional.of(x) instanceof Serializable` does not compile.

## What is left
- **Orchestrator:**
  - merge `rv3-java2` at `f88906ec` into the hub;
  - run the battery: client typecheck in the hub, full suites, `test:java` if wanted;
  - add `seed:audit:explanations -- --check` to the gates with a baseline of 0 (it is 0 now).
- **Optional:**
  - the weak tests listed above;
  - the 19/01 `Or` rule;
  - the remaining reading-list items (java L2 9, L3 3, D2 3).
