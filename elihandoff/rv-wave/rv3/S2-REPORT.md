# rv3 S2 `rv3-java` stop report (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-c`, branch **`rv3-java`**, base hub `rv-wave` `3264edb3` (+ cherry-pick `28c7ced4`),
hub merged at `872fd550` (hub `c1acf7a8`, for S3's audit script). Tip **`6ad66826`**, tree clean. Nothing pushed, `main`
untouched, no `--no-verify`, no force, no history rewrite. Every commit uses `git commit -F` and the Co-Authored-By line.
No leftover node / java / javac process for `bq-f52-c`. Owner DB never opened.

## Branch + SHAs (oldest first, first-parent)
| SHA | What |
|---|---|
| `28c7ced4` | (orchestrator cherry-pick of `003cca9a`) Java 21 authoring |
| `2df2a119`, `dee9a293` | MF-9: `fund-java-language/equality-contracts` prompt (TreeSet refuses the new element), `fund-java-spring/entity-identity-and-derived-queries` prompt + answer (And/Or precedence replaced by what topic 19 teaches); answer back under 60 words |
| `862c9c5a` | Java 21 brought to the §2 bar (5 explanations, 2 hints) + bug hunt 03 |
| `5f3e2d1a` | Java 22 Spring Security (restored authoring, reviewed: 9 explanations, 2 lesson sections, 3 cards) + bug hunt 03 |
| `fd58d105` | Java 23 Jackson JSON contracts (new) |
| `fde50f45` | re-import + stamp fund-java (23 topics, 51 drills) |
| `244ebd94`, `62f3ac0a`, `99cc968d` | javadrills modules 12, 13, 14 (6 drills each) + census; `bank-java` ideas with 14 |
| `0db3fc72` | re-import + stamp javadrills (98) |
| `d8706942`, `88ff9f54`, `74cd721e` | Java 24 Bean Validation, 25 SLF4J + MDC, 26 HTTP clients (stretch, done) |
| `a6ca6188`, `8211fe42`, `ae8dd52c`, `3eac1535`, `4f72a1e8` | stamps; 24 q03 key + one idea reworded to clear a key-idea xleak; six short 21/22 explanations lengthened |
| `872fd550` | merge hub `rv-wave` (S3 audit) |
| `f6f6caf6` .. `74e7901d` (21 commits) | W4: Java 01-20 quiz explanations, one commit per topic (07 includes the S3-found q06 repair; 26 lesson section) |
| `ddf78337` | W4: 18 drill hints (14 drills) to prose (D4) |
| `6ad66826` | re-import + stamp fund-java (60/60) |

## Counts before -> after (by script)
- Fundamentals java (`FUNDAMENTALS_EXPECTED.java`, authoring counted): **20/200/160/42 -> 26/260/208/60** (topics/quiz/cards/drills). Each of 21-26: lesson, 10 items, 8 cards, 2 drills + 1 bug hunt.
- javadrills (`JAVADRILLS_EXPECTED`): **80 -> 98**, modules 11 -> 14 (import.test.ts pin updated).
- Key ideas: **189 -> 197** (24 files). `fund-java-spring` 5 -> 11 (21..26 one each), `bank-java` 10 -> 12 (cap), `fund-java-language` 12.
- Explanation audit, java (S3 `seed:audit:explanations`): quiz **96/200 -> 260/260** pass; drills 3/42 baseline -> **25/60**, D4 14 -> **0**, D1 **35** left; lessons 0/20 -> **6/26**, L1 **20** left (all old topics 01-20).
- `topics.json` vs `3264edb3`: **104 fields changed, all `explanation` of topics 01-20**; 0 prompts, choices or keys of old items changed.
- Packs 688, restamp N 700 (no new pack: fund-java and javadrills grew in place).

## Gates (this clone, one at a time, foreground or single background job, `--concurrency 1` / `--maxWorkers=1`)
```
seed:validate --source fund-java      COUNTS validated 60 · AUDIT 20 re-executed / 0 mismatches · STAMP written · RESULT OK
seed:validate --source javadrills     COUNTS validated 98 · 0 quarantined · AUDIT 18 / 0 mismatches · STAMP written · RESULT OK (1634 s)
seed:audit:explanations --track java  quiz 260/260 · drills 25/60 (D1 35) · lessons 6/26 (L1 20)
seed:lint:keyideas                    24 side file(s), 197 idea(s): 0 problem(s), 0 leak(s) · RESULT OK
seed:lint:leaks                       146 pair(s), 146 baselined, 0 new, 0 stale · RESULT OK
seed:lint:answers                     300 scanned, 0 new over the limit, 2 baselined · RESULT OK
seed:pins                             688 pack(s): 688 OK, 0 MISMATCH · RESULT OK
restamp:all -- --dry-run              700/700 fresh · RESULT OK
vitest tools/seed javadrills/import + fundamentals/import + keyideas-lint   3 files, 51/51 passed
vitest server test/api/fundamentals.test.ts                                 13/13 passed
```
`test:java` (the runner's own suite) was not run: no runner file changed; the Java checks are the two real-runner `seed:validate` stamps above.

### D3 / Q6 proofs (scratch `javac`/`java`, JDK 17.0.10, harness `scratchpad/tools/mut.mjs`)
Every drill: reference passes, starter fails (todo, or the one named test for bug hunts). Every "the tests catch X" claim in a
new or touched explanation was run as a mutant and fails the test it names: Java 21 (5+6), 22 (6+4), 23 (6+5), 24 (4+5),
25 (4+4), 26 (5+3); bug hunts 21-26 each fail only the test(s) their explanation names; javadrills 12 (17), 13 (19), 14 (23).
Module 13 references passed 3 of 3 scratch runs plus the course and audit runs (5); modules 12 and 14: 1 scratch + course +
audit (3). Five explanation sentences were narrowed to what the runs showed (13/01 stress test, 13/04 blocking acquire,
14/03 and 14/04 test names, 24 bug hunt). Snippets run for lesson / idea claims: TreeSet refuses `1.0.0` when `1.0` is held;
Integer cache 127/1000; record `equals` NaN/-0.0 and field-not-accessor; record `toString` prints the password;
`BigDecimal` 1.5 vs 1.50 and `1E+1`; Turkish `I`; `unmodifiableList` is a view; `List.copyOf` NPE on null;
`HttpRequest.timeout()` / `HttpClient.connectTimeout()` empty by default, redirects `NEVER`.

## Deviations from the brief
1. **javadrills 12 is records only** (`12-records-and-value-semantics`): sealed types and instanceof patterns are already
   drilled in javabootcamp module 15, and pattern `switch` / record patterns need JDK 21 (D7). Module 13 is
   `13-forced-interleavings`, 14 is `14-jdbc-data-access` (real `java.sql` interfaces faked by dynamic proxies).
2. **bank-java**: 2 ideas added (cap 12), and the existing `deterministic-concurrency-tests` idea's siblings re-pointed at
   module 13 (id and sources unchanged). PLAN §3.1 also lists `bank-*` for S1; the hub had no change to it, so no conflict.
3. Framework topics (21-26) have no pinned estate source (no JUnit/Mockito/Spring Security/Jackson/SLF4J code in
   `.cache/checkouts`); claims are documented framework behaviour, drills model them in plain JDK 17, as topics 17-20 do.
4. Existing item edits beyond explanations (ruling 1, listed): `fund:java/24-.../q03` keyed choice reworded (new topic,
   never attempted) to clear a key-idea xleak; no old item's prompt, choice or key changed. `fund:java/07-.../q06`
   explanation repaired (it named the keyed `merge` as the choice that throws).
5. W4 done for quiz items and D4 only. **D1 (35 drill explanations) and L1 (20 lessons) of topics 01-20 are not done**
   (budget): both change drill pack content / lessons and need D3 proofs and L4 compile checks.
6. A second `seed:validate` started by mistake collided on `.cache/seed-java` (EBUSY) and journaled 20 crashes; fixed with
   `--retry-failed`, final stamp clean. Audit `--out` files were moved out of the clone (`work/` would dirty the tree).

## Upstream / other bugs found (report items)
- `seed:validate` journals runner crashes (EBUSY on the shared scratch dir) as quarantines, and a later run trusts them;
  two runs on one clone are not refused. Consider a lock file on `.cache/seed-java`.
- Old fund-java journal entries quarantined by load (javac 41-56 s compile timeouts, 15/02's 600 ms timing check) survive
  into later runs until `--retry-failed`; 15/02 is timing-sensitive under load.
- S3's audit counts "prose words" without inline code; the C# / JS tracks may see similar L1 gaps in long-code lessons.

## What is left
- **W4 rest (gate rules, all topics 01-20):** D1 for 35 drill explanations (>= 60 prose words, name the trap and its test,
  prove each claim) and L1 for 20 lessons (>= 380 prose words, no section under 40). List: `seed:audit:explanations --
  --track java --items`. Reading lists D2 42, D3 16, L2 20, L3 5 untouched.
- Orchestrator: merge `rv3-java` at `6ad66826`; client typecheck and the battery in the hub; `test:java` if wanted.
