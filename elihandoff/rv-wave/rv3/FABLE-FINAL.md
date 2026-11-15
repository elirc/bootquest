# rv3: Fable final review (PLAN §5 gate)

Reviewed 2026-11-15 by Fable. Hub `C:\Users\Owner\Desktop\bq-f52-hub`, branch `rv-wave` @ **`9726c1d9`**
(sandbox probes ran on `a1adabe7`; the only later change is the Java 01-20 content merge, checked separately).
Review only: nothing edited or committed in the hub or a clone; the sandbox is stopped.

## Recommendation: LAND

No high-severity finding. Every rv2 must-fix replays as fixed, the scoring change cannot be gamed, no keyed answer
is wrong in any of the three readers' full reads, and `origin/main` (`d83ae80f`) is an ancestor of `rv-wave`, so the
landing is a fast-forward (576 files, +111.8k / -3.5k lines).

Two conditions, both the orchestrator's:
1. **The suites I did not run are green on `9726c1d9`** (§4). At the least, after the Java merge: tools/seed
   `fundamentals/import.test.ts`, server `api/fundamentals.test.ts` and `ladder-real.test.ts`, `seed:lint:leaks`,
   `seed:lint:answers`, `seed:pins`, client typecheck.
2. If any "obvious fix" of §3 is applied first, re-run for the touched track: `seed:import:fundamentals`, the import
   test, `seed:audit:explanations -- --check`, `restamp:all -- --dry-run`. None of the obvious fixes is needed to land.

**How it was checked.** The owner DB was copied read-only with `copydb.cjs` (schema 18, `attempt` = 0: the precondition
of ruling 1 holds). The hub server ran on 4390 / 5390 with a settable clock and scratch copies of the side files.
Probe scripts `r1.mjs`-`r3.mjs`, `walk.json` and outputs:
`C:\Users\Owner\AppData\Local\Temp\claude\c3385c767fed3579\ab1aa697-5ee4-4bb9-858f-49a59fa4aa1f\scratchpad\rv3\`.
Content was read in full by three read-only Opus readers (JS + C#; Java; katas, scoring and agentdrills). I re-checked
the claims marked "(checked)"; the others are their reading, marked "(reader)".

## 1. Verdict per §5 item

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Bound files, restamp | **Pass** | `git diff --stat dc2206bc..rv-wave` over `server/src/runners`, `api/runners.ts`, `runner-*.ts`, `tools/seed/src/factory`, `shared/src`: only `shared/src/api-ext.ts` and `eb-weight.ts`. `restamp:all -- --dry-run` on `9726c1d9`: **703/703 fresh**. Root typecheck rc=0. |
| 2 | Every MF replayed | **Pass** | Fresh DB copy. MF-1: 5 gates + 1 drill → locked ("opens once 3 of its ideas are met; 1 so far"), 2 met → locked, 3 met → open with 3 prompts. MF-2: every recap threshold is now ≤ 27 units (sysdrills 27, agentic 25, design-it 19, review-katas 17, banks 12-16). MF-3: with the siblings of the released redo card emptied, the card is parked and the next redo is released the same day. MF-4: 201 ideas, 0 not-met ideas carry `idea` text, 0 carry an answer. MF-6: default `/reviews/queue` 14 ms with 165 cards due (was 2.8 s), dashboard 0.24-0.27 s (was 1.4 s). F6: 14 topics + a recap with every idea "missed" → new key-idea cards due 4 / 4 / 4 / 2. W10c: the redo card is first in the queue. MF-5 / MF-8: audit and import are green; C# 06/01 now has the long-message test through a `Notifier` reference and 23/01 no longer asserts a handler count (reader). MF-7 / MF-9: applied in `b8b6b217` (path 18 steps, 32 sets); the Java `TreeSet` prompt now has the right direction (reader). MF-10: test in S1's report; not re-run by me. |
| 3 | Explanations | **Pass** | `seed:audit:explanations -- --check` on `9726c1d9`: 850 quiz items, 323 drills, 85 lessons, **0 gate failures**, every track. Readers read 92 JS, 60 C# and 40 Java rewritten explanations and every changed lesson paragraph: all true except the items in §2 (none changes a keyed answer). D3: I ran 6 JS drills through the real runner (reference passes, starter fails) and one named claim as a mutant (`??` → `\|\|` fails "retries 0 is kept, not replaced by 3"); a reader checked 21 more claims by reading. I did not re-run C# or Java D3 proofs. |
| 4 | No key, choice or prompt changed except those listed | **Pass** | My script, `3264edb3` vs `9726c1d9`, matched by item key. JS: 228 explanations, 25 lessons, 1 card (11/c08), 0 prompts / choices / answers. C#: 157 explanations, 22 lessons, 1 prompt (23/q01, MF-8), 11 cards (21, 22, 23: the F9 re-angles), 0 choices / answers. Java: 104 explanations, 20 lessons, nothing else. No key removed. This equals the lists in the stop reports. |
| 5 | New items read in full; Java determinism | **Pass, determinism partial** | Java 21-26 (60 items, 18 drills), javadrills 12-14 (18 drills), C# 24-26 (30 items, 6 drills), 14 katas and 8 agentdrills were read in full by the readers: no wrong key, no broken drill, nothing above Java 17. I ran the six javadrills 13 references 3 times each (18 passes of 18) and their starters (all fail). Not the 5 runs of every Java drill the plan asked for: the authors report 3-5. |
| 6 | F10 | **Pass with findings** | Live: an unflagged kata refuses approve (409, nothing written) and the old self-score refuses a flagged kata. Clean kata + a random finding → verdict block, `passed: false`, score 0; a later approve is 403; marks on a clean kata are 400; a second score is 409. Clean kata approved → pass. Decoy kata approved → fail, score 0. Before the answer the unit detail and `/kata/review` say nothing about clean, decoys or the defect count, and the key is 403. The base rule for unflagged katas is untouched (reader, diff). Findings K1-K3. |
| 7 | Migrations | **Pass** | 028 and 029 contiguous, 029 append-only with the three triggers on both tables. The owner-DB copy went 18 → 29 at boot with 0 errors. A fresh DB's slate is `fund` + `senior` only: no agentic drill slot; `/settings/slate` shows agentic `enabled: false`. |
| 8 | Counts, 390 px walk | **Pass** | My script: Fundamentals js 33 / 330 / 238 / 79, csharp 26 / 260 / 208 / 55, java 26 / 260 / 208 / 60 = `FUNDAMENTALS_EXPECTED`; javadrills 98; agentdrills 8; katas 66 in 33 packs; key ideas 24 files, **201**; every pack's units equal its manifest. SEEDING §8 states the same numbers. Walk at 390 × 844 over 9 screens (dashboard, rewritten JS topic 23, new Java topic 21, a flagged kata, an agentdrill, key ideas, 10-minute review, stats, settings): no horizontal page scroll, no console error. |

**Java 01-20 sample (`rv3-java2`, the last merge).** Against `a1adabe7`: 20 lessons changed, 0 explanations,
prompts, choices, answers or cards. I read three rewritten drill explanations (07/01, 12/01, 15/01) and the added
lesson text of topics 05 and 14: accurate, each wrong approach is tied to a named test, hints 1 and 2 are prose.
The report lists 7 topics whose drill tests were strengthened, each with a proof run. Two notes: 15/01's "the
fetches run concurrently" test is timing-based (150 ms fetches) and can fail under heavy load; 14/01 still passes
without `pool.shutdown()` (the report says so).

## 2. Findings

No **High**. "Obvious fix" = a text or comment edit the orchestrator can make now; quiz, lesson and card text lives in
`tools/seed/authoring/fundamentals/<track>/*.json` → `content/fundamentals/<track>/topics.json` and is not part of a
stamped pack, so it needs a re-import but no restamp (confirm with the dry-run). "Needs a stream" = drill pack
content (re-validate and stamp), code with tests, or a design choice.

### Medium

| # | Where | What | Fix | Who |
|---|---|---|---|---|
| T1 | `content/fundamentals/csharp/topics.json` topic 25 lesson (checked) | "Since .NET 8 an exception that escapes `ExecuteAsync` stops the whole host". The `StopHost` default arrived in .NET 6. | "Since .NET 6 ..." | **Obvious fix** |
| T2 | `java/topics.json` 04 q08 explanation (checked) | "== is correct and null-safe when the constant is on the left". `==` never throws on either side; the caveat belongs to `equals`. | "so == is correct and cannot throw for null on either side, unlike x.equals(RED)." | **Obvious fix** |
| T3 | `java/topics.json` 20 q10 explanation (checked) | "with a warning (HHH000104)" is the Hibernate 5 code; Hibernate 6 (Boot 3) logs HHH90003004 (reader, from memory). | "with a warning (HHH000104 in Hibernate 5, HHH90003004 in Hibernate 6)", after checking the code. | **Obvious fix** |
| T4 | `java/topics.json` 21 q04 (checked) | Keyed `Optional.empty()` for a stub called with other arguments. Under `MockitoExtension` strict stubs (which q10 teaches) the call fails with `PotentialStubbingProblem`, so "an exception" is defensible. | Append to the explanation: "This is a plain `mock(...)`; under MockitoExtension's strict stubs the mismatched call fails with PotentialStubbingProblem instead." Better, later: put "a plain `mock(UserRepo.class)`" in the prompt. | **Obvious fix** (explanation); prompt edit needs a stream |
| T5 | `js/topics.json` 14 q01 explanation (checked) | "`for...of` starts by calling `obj[Symbol.iterator]()`" is q10's keyed answer in the same gate (rule Q5). | "`for...of` starts by asking the object for its iterator method." | **Obvious fix** |
| T6 | `js/topics.json` 33 q01 explanation (checked) | "plain Node on a busy laptop managed about 60,000 salted SHA-256 guesses a second, against about 4 default scrypt calls". A real measurement, but it undersells the attack by orders of magnitude; the lesson says billions. | "Cracking hardware tests billions of salted SHA-256 guesses a second, while one default scrypt call costs tens of milliseconds and 16 MB of memory." | **Obvious fix** |
| T7 | `java/topics.json` topic 23 lesson, q01, q03, q05 (reader) | The Jackson defaults taught are 2.x behaviour and the lesson names no version. | Add to the first section: "Everything below is Jackson 2.x as shipped with Spring Boot 3." Same one-line note for topic 22 (Spring Security 6). | **Obvious fix** |
| T8 | Flashcards that carry a same-topic gate key (reader): `csharp` 26/c08 vs q01; `java` 23/c04 vs q08, 25/c05 vs q06, 26/c04 vs q04 | The card back restates the keyed choice nearly word for word. | Re-angle each back (C# 26/c08: "It ties the API to the database schema and throws on navigation cycles; a DTO names exactly the fields of the contract."). | **Obvious fix** for 26/c08; the Java three need a stream to re-angle |
| K1 | `server/src/api/ladder-service.ts:991`, `client/src/pages/LadderPanes.tsx:1732-1742` (checked live) | Only the 6 flagged katas ask for a verdict, and 3 of them are clean: the approve picker itself says "50% clean". An unflagged kata still says "find every seeded defect". | Flag the other 8 agent katas as verdict-asked with no decoys (needs a flag form with neither `clean` nor `decoys`). | Needs a stream |
| K2 | `server/src/api/keyideas-service.ts:218`; `content/keyideas/review-katas.json` `precision-matters`, `behaviour-not-style` (reader) | For an unmet idea the id and its source list still go out. `precision-matters` lists the 3 clean katas, `behaviour-not-style` the 3 decoy katas: the verdict class can be read on the Key ideas page before answering. | Send an opaque id while unmet, or mix defect katas into those two source lists. | Needs a stream |
| K3 | `server/src/engines/keyideas.ts:145` (`e.kind = 'kata' AND e.score > 0`) (reader; consistent with my probe) | A flagged kata's pass for key ideas ignores `kata_precision.passed`. A clean kata blocked once scores 0 and its answer is immutable, so `precision-matters` can never be met; a decoy kata with decoys flagged and one defect caught counts as passed. | For a flagged kata, "passed" = it has a `kata_precision` row (any verdict), with a test. | Needs a stream |
| K4 | `content/packs/agentdrills/02-eval-gates.json` `04-autonomy-gate` (reader ran two wrong graders: both pass 5 of 5) | A grader that ignores `businessHoursOnly`, and one that uses `<=` and checks the mode before the refusal, both pass. | Add three cases (business hours off, refused with mode off, confidence exactly at the threshold). | Needs a stream (pack restamp) |
| D1 | Weak drill tests (reader): C# 25/02 (no job throws its own cancellation), 26/02 (no `Unspecified` kind row), 24/01; Java 24/01 (no component without `@Valid`, although the explanation says the tests catch it), 22/01, 23/01, 25/02, 26/01 | A plausible wrong solution passes. Java 24/01 also breaks rule D3: its explanation claims a catch that no test makes. | Add the missing case per drill; for 24/01 add it or drop the sentence. | Needs a stream |
| D2 | `fund-csharp/25-*/02-graceful-stop-with-a-deadline` explanation (reader) | "`await foreach` over `ReadAllAsync(deadline)` throws as soon as the deadline fires": it keeps yielding queued items and throws at its next wait. | "... ends in an `OperationCanceledException` once the deadline has fired (at once in the boundary test), so the stop throws instead of returning its report." | Needs a stream (pack content) |
| D3 | `fund-java/25-*/01-the-placeholder-rules` (reader, from memory of SLF4J: verify) | Rule 4 makes a trailing `Throwable` conditional on "more arguments than placeholders"; SLF4J takes a trailing Throwable unconditionally. No test exercises the difference. | Verify against slf4j-api, then reword rule 4 and the solution. | Needs a stream |
| D4 | `content/packs/javadrills/13-*.json` `03-shut-an-executor-down` test 2 (reader; passed 3 of 3 here) | Asserts `pool.isTerminated()` right after a 50 ms grace: a correct solution can fail on a loaded machine. | `pool.awaitTermination(2, TimeUnit.SECONDS)` before the assert. | Needs a stream |

### Low
- **L1** `server/src/engines/streak.ts:42-44`: the header still says "a track with no row is on the slate"; line 254
  does the opposite. **Obvious fix** (comment only).
- **L2** Kata tells (reader): all 3 clean katas are `.ts`-only and every `.mjs` kata has a defect; the clean fetch
  kata is the only diff with CRLF; `fd79…` and `c0eb…` add no test, so "no test" is a defensible finding that fails the
  kata; the PDF kata cites line 28 (the comment) and not 29. Needs a stream (next kata batch).
- **L3** `029_kata_verdict.sql:46`: the no-replace guard on `kata_precision` keys on `id`, not `evidence_id`. Same
  pattern as the earlier tables; no code uses `OR REPLACE`. Leave.
- **L4** `server/src/store/kata-flags.ts:117`: a malformed flags file unflags all 6 katas with only a console warning;
  a clean kata then asks for "every seeded defect". Surface `problems` in health. Needs a stream.
- **L5** A failed verdict still pays 15 XP (live). Same as the unflagged self-score rule; noted only.
- **L6** C# 23 cards c01, c03, c04, c05, c07 now teach a different fact under the same key. Allowed by ruling 1 (0
  attempts); after the first attempt this must not happen again.
- **L7** C# 24-26 have 2 drills each and no bug hunt (W6 said "same shape as W3"). Accept.
- **L8** Small wording (reader): Java 26 q08 "retries 3 times", 24 q07 "every built-in constraint", 06 q02, 24 bug-hunt
  hint 1 "two failing tests" (three fail), 22/03, 23/03, 25/03 "drill 1"; C# 15 lesson "scope validation rejects
  it" (Development only), 26 lesson "numbers sent as strings"; Java topic 22 keys index 1 in 5 of 10 items.
- **L9** Five untouched cards carry a gate key (reader): C# 08/c01, 12/c06, 14/c03, 06/c07; JS 13/c02. The lint
  matches verbatim only.
- **L10** Key-idea sources (reader): `bank-java` `record-value-semantics` and `jdbc-data-access` list too few of the
  drills they cover; no idea has javadrills 13 as a source; `tool-output-is-data` ← injection screen is a loose fit.
- **L11** Still open from `rv2/FABLE-REVIEW.md` §5: `estimates.json` has no reader, `ebmiss` cards are positional,
  confidence copy, note cap, touch scroll of the heatmap and the Stats table at 390 px.
- **L12** `fable52docs/screenshots/*.png` (7 files) go public with the push. They come from a sandbox; look at them
  once before pushing.

## 3. Obvious fixes, in one list (optional before landing)
T1, T2, T3 (after checking the code), T4 (explanation sentence), T5, T6, T7, T8 (C# 26/c08), L1.
All but L1 are edits in `tools/seed/authoring/fundamentals/{csharp,java,js}/*.json` followed by
`seed:import:fundamentals -- --track <t>`; then the checks in condition 2. If the import changes any file under
`content/packs/`, stop: that edit was not text-only.

## 4. Not run by me
- Full suites: server, selfrun, client, CLI, tools/seed; client typecheck; `smoke:api`, `demo:promotion`,
  `seed:demo:planted`, `seed:campaign -- --check`, `seed:lint:leaks`, `seed:lint:answers`, `seed:pins`, `test:csharp`,
  `test:java`. The orchestrator reported smoke 76/76, restamp 703/703 and pins 690 before the Java merge.
- C# and Java D3 proofs; 5 determinism runs per Java drill (3 runs of javadrills 13 only).
- UI clicks through a kata verdict, a recap and a card grade (driven through the API; the kata page text and the
  verdict radios were checked in the walk).
- Reader claims I did not re-check: SLF4J trailing-Throwable rule, Jackson 3 defaults, the Hibernate 6 warning code,
  the weak-test lists, the kata provenance lines.

## 5. After landing (one small stream, in this order)
K3, K2, K1 (kata precision honesty), K4 and D1-D4 (tests and drill text, one restamp per pack), T4 prompt and T8
Java cards, L2 with the next kata batch, L4, then the rv2 leftovers in L11.
