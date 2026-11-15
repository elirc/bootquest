# rv3 S3 `rv3-x` stop report (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-d`, branch **`rv3-x`**, base `0d5d2f31` (hub `rv-wave` + S1). HEAD = **`c7ea399f`**,
23 commits, tree clean. Nothing pushed, `main` untouched, no `--no-verify`, no history rewrite, every commit by
`git commit -F` with the Co-Authored-By line. No migration. No bound file, no `server/src`, `client`, `shared/src`,
`tools/seed/src/factory`, `.cache/checkouts`, Java content or owner DB touched. Stopped at a clean boundary: **out of
budget** (context), with JS 01-20, C# 01-20, C# 24-26 and sysdrills not done (see "What is left").

## SHAs per slice
| Slice | SHA(s) | What |
|---|---|---|
| 1 audit script | `d29468c8` | `seed:audit:explanations` (ops/explain-audit*.ts + 1 package.json line). Note: `rv3/S3-SLICE1.md` |
| 2 repairs (MF-5, MF-8) | `36336ba4` authoring, `4fe3dc50` outputs + stamps, `067bfadc` import test | see "Repairs" |
| 3 JS rewrite, 21-33 | `1cbaa2af` (21) `820821e5` (22) `56a8cfb5` (23) `eddfb3da` (24) `f4627d66` (25) `5c021b30` (26) `b4e40114` (27) `3818adc5` (28) `e56c5444` (29) `97c550f3` (30) `8917255c` (31) `c7cfe01f` (32) `26c930e6` (33); outputs `083eea88` | one commit per topic |
| 3 C# rewrite, 21-23 | `70fdac8f` (21) `167d8462` (22) `231f94c8` (23); outputs `c99dac2e` | one commit per topic |
| MF-4 S3 part | `c7ea399f` | 4 fund-js idea sentences, 6 `IDEA_LEAK_PENDING` entries removed |

(`git log --oneline 0d5d2f31..rv3-x` lists all 23.)

## Counts before -> after (all by script)
**Audit (`seed:audit:explanations`), pass = item meets every gate rule:**
| track | family | before (`d29468c8`) | after (`c7ea399f`) |
|---|---|---|---|
| js | quiz | 102/330 (31%) | **167/330 (51%)**; topics 21-33: **130/130** |
| js | drills | 36/79 (46%), D4 18 | 39/79 (49%), **D4 0** |
| js | lessons | 8/33 | 13/33; topics 21-33: **13/13** |
| csharp | quiz | 73/230 (32%) | **93/230 (40%)**; topics 21-23: **30/30** |
| csharp | drills | 5/49 (10%), D4 25 | 15/49 (31%), **D4 0** |
| csharp | lessons | 3/23 | 3/23 (21-23 passed already) |
| java | all | 96/200, 3/42, 0/20 | unchanged (S2's) |
| sysdrills | drills | 87/129 | unchanged (stretch, not started) |
Gate failures estate-wide: 722 -> 619 items. `--check` per track is still BELOW THE BAR for js and csharp (01-20 left).
- Census unchanged: js 33 / 330 / 238 / 79, csharp 23 / 230 / 184 / 49 (`FUNDAMENTALS_EXPECTED`, importer output).
- Key ideas: 24 files, 189 ideas, 0 problems, 0 leaks; `IDEA_LEAK_PENDING` 12 -> 6 (the 6 left are S1's content patch).
- Tests: tools/seed `ops/explain-audit.test.ts` new, 21/21. `fundamentals/import.test.ts` 14/16 on base (F11) -> 16/16.

## Every edited item (keys unchanged; script `.cache/rv3/changed.cjs`, diff of the authoring vs `0d5d2f31`)
- **Quiz explanations rewritten: 85.** js 21 q01 q03 q05-q08 · 22 q02 q05 q08 · 23 q03 q05 q07-q09 · 24 q01-q05 q07 ·
  25 q01 q03-q05 q08 · 26 q01 q03 q04 q06-q08 · 27 q03 q04 q06-q09 · 28 q01 q03-q08 · 29 q09 · 30 q01 q03 q06 q08 ·
  31 q01 q03 q05 q07 q08 · 32 q01 q02 q05 q07 · 33 q01 q03-q08; csharp 21 q03 q05-q09 · 22 q03 q06-q08 q10 · 23 q01-q09.
- **Prompt changed (wrong, MF-8): 1**, `fund:csharp/23-authentication-authorization-and-resource-checks/q01`: "calls an
  endpoint" -> "calls a JWT-bearer API endpoint" (its explanation said cookies redirect). No choice or keyed answer changed.
- **Lessons (one sentence added to a section under 40 words): 5**, js 23 "Do not over-index", 24 "Keyset pagination in
  SQL", 27 "Clamp the limit", 28 "Mass assignment", 31 "What N+1 looks like". Headings unchanged.
- **Hints (D4 / MF-5): 52 hints in 43 drills.** js: 01/02, 03/01, 04/01, 05/01, 06/01, 10/01, 11/01, 14/01, 14/02, 15/01,
  16/01, 16/02, 17/01, 18/01, 19/01, 25/02, 26/01, 28/01 (the 10 MF-5 hint 2s are 01/02, 03/01, 04/01, 05/01, 11/01,
  14/01, 15/01, 16/01, 17/01, 18/01). csharp: 02/01, 02/02, 03/01, 04/02, 05/01, 06/01, 06/02, 09/02, 10/01, 11/01, 11/02,
  13/01, 14/02, 15/01, 15/02, 17/02, 17/03, 18/02, 19/02, 19/03, 20/01, 20/02, 20/03, 22/02, 23/01.
- **Drills (MF-8):** csharp 06/01 + 06/02 tests (one new test, shared), 06/01 explanation; 22/01 tests (guards 10 s -> 2 s)
  + explanation; 23/01 instructions, tests (assertion dropped), tail (`CountingHandler` removed), hints, explanation.
- **Key ideas:** `idea` field only of fund-js-core `this-from-call-site`, `mutating-array-methods`; fund-js-senior
  `index-matches-query`, `keyset-pagination` (S1's proposals; keyset shortened to 29 words).

## Repairs
- **MF-5 / F11**: the importer refused js (10 hint 2s). Fixed, plus every hint 1 that fails D4. `seed:import:fundamentals`
  accepts js, csharp and java. `import.test.ts` 16/16 needed a **test fix** (`067bfadc`): its "hint 3 as code" refusal
  test only passed because fund-js 01/02 broke the hint-2 rule (whose message says "the formula is hint 3"); the js bank
  gates hint 2 since R3-09, so the test now mutates hint 2. **4fe3dc50's message says 16/16; it was 15/16 until 067bfadc.**
- **MF-8**: C# 06/01 claim made true by a test; 23/01 early exit called a shortcut and the assertion dropped; 23 q01 stem;
  22/01 guards. Proofs below.

## D3 proofs (real warm C# runner via `tools/seed/build/rv3/prove.mts`, log `tools/seed/build/rv3/proofs.log`)
| Drill | Change applied to the reference | Result |
|---|---|---|
| cs 06/01 | none | PASS |
| cs 06/01 | `new` instead of `override` on `SmsNotifier.Format` | FAIL: only "a long SMS through a Notifier reference is cut too" |
| cs 06/01 | `>= 30` instead of `> 30` | FAIL: "exactly 30 characters is not cut (boundary)" |
| cs 06/02 | reference / starter | PASS / FAIL: the boundary test |
| cs 22/01 | none | PASS |
| cs 22/01 | one `catch (OperationCanceledException)` answering 504 | FAIL: both caller tests ("expected the code to throw"), 2.5 s |
| cs 22/01 | `caller` passed straight to the call | FAIL: both 504 tests, TimeoutException from the 2 s guard, 7.5 s total (was about 20 s = the runner limit) |
| cs 22/01 | unlinked `new CancellationTokenSource(timeout)` | FAIL: mid-call caller test (wrong exception type) + boundary test, 7 s |
| cs 23/01 | none | PASS |
| cs 23/01 | no early challenge, ASP.NET-style (every handler runs, unmet auth requirement) | PASS (the test no longer pins the shortcut) |
| cs 23/01 | `Any` instead of `All` | FAIL: "every requirement must succeed..." (+ boundary) |
| cs 23/01 | `Failed` ignored | FAIL: "one Fail vetoes..." |
| cs 23/01 | always `Forbid` | FAIL: "a failed check for an anonymous caller is a challenge, not a forbid" |
| cs 23/01 | `user.Identity != null` as signed in | FAIL: the anonymous test, the no-authentication-type test, the anonymous-owner test |

## Q6 claims run (log `tools/seed/build/rv3/claims/claims.log`; scripts `claims/*.mjs`, `aspnet-check/`)
- node:sqlite (SQLite 3.x in Node 22.16): js21 q1 (5 rows; 8 with `OR status IS NULL`), q5 (COUNT(*) 1 / COUNT(o.id) 0),
  q7 (300 over 6 rows), q8 (SUM DISTINCT 50, pre-aggregated 100); js22 q5 (node:sqlite foreign_keys = 1 by default, off =
  not enforced), q8 (partial unique index; UNIQUE(customer_id, is_primary) refuses a 2nd non-primary); js23 q3, q5, q8,
  q9 (EXPLAIN QUERY PLAN: no temp b-tree; SEARCH for the range, SCAN for LIKE '%son' / lower() / upper(substr());
  prefix use); js24 q1, q2 (changes 0), q3 (4 vs 3), q5 (bound `x' OR '1'='1` matches nothing, O'Brien round-trips),
  q7 (exact error "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"); js25 q3 (0 vs 1 changed rows);
  js26 q8 (twice: paid, 20, 2 shipments, qty 3); js27 q3, q9 (strict < skips the tie; AND / OR forms); js29 q9
  ("no such column: name" after RENAME); js31 q3 (IN order and missing ids); cs21 q5 (second `:memory:` connection: "no
  such table", same engine as Microsoft.Data.Sqlite).
- Node: js25 q1/q8 (interleaved read-check-write books twice, with and without a re-check), js26 q6 (a rejected promise
  stays rejected, 1 run), js30 q3 (array replacer drops nested z; two filters share one key), q6 (delete-then-update
  caches the old row), js31 q5 (**the drill 31/02 reference loader** gets [1, 2] once), js32 q2 (toISOString identical
  under TZ New York / Tokyo; new Date not cached), js33 q1 (measured: ~61,000 salted SHA-256 a second vs one default
  scrypt 246 ms on this loaded laptop; the explanation quotes "about 60,000" and "about 4"), q5 (claims decode without
  the secret).
- .NET 10 scratch program on Microsoft.AspNetCore.App **10.0.10** (`tools/seed/build/rv3/aspnet-check`): 23/01 note
  (anonymous: handler ran 1 time, failed = DenyAnonymousAuthorizationRequirement, InvokeHandlersAfterFailure default
  true); cs21 q3 (single = last registration, IEnumerable = both, RemoveAll leaves the fake), q9 (two TimeProvider reads
  differ, both UTC); cs22 q6 (second SendAsync: InvalidOperationException "The request message was already sent..."),
  q8 (linked cancelled, request not); cs23 q3, q4 (Fail wins, FailCalled), q9 (IsAuthenticated false without a type).
- **Not run (stated from documentation, wording kept close to the old text):** js33 q7 (RFC 7519 §4.1.4 exp "on or
  after"), cs22 q7 (TIME_WAIT socket exhaustion), cs22 q10 (resilience pipeline order), cs23 q8 (fallback policy scope).

## Gates run (targeted, `--maxWorkers=1`, foreground, Git Bash; tails)
```
seed:audit:explanations -- --check            619 item(s) fail a gate rule · RESULT BELOW THE BAR (js / csharp 01-20, java, sysdrills left)
tools/seed explain-audit.test.ts              Tests 21 passed (21)
tools/seed fundamentals/import.test.ts        Tests 16 passed (16)
tools/seed ops/keyideas-lint.test.ts          Tests 13 passed (13)
seed:lint:keyideas                            24 side file(s), 189 idea(s): 0 problem(s), 0 leak(s) · RESULT OK
seed:lint:leaks                               ... 146 pair(s), 146 baselined (baseline 146), 0 new, 0 stale · RESULT OK
seed:lint:answers                             294 pack(s) ... 0 new over the limit, 2 baselined, 0 worse · RESULT OK
seed:pins                                     RESULT OK: 688 pack(s): 688 OK, 0 MISMATCH, 0 UNCHECKABLE
restamp:all -- --dry-run                      700/700 fresh · RESULT OK
seed:validate --source fund-js (083eea88)     79/79, quarantined 0, AUDIT 20 re-executed 0 mismatch · STAMP written · RESULT OK
seed:validate --source fund-csharp (c99dac2e) 49/49, quarantined 0, AUDIT 20 re-executed 0 mismatch · STAMP written · RESULT OK
server test/api/fundamentals.test.ts          Tests 13 passed (13)
tsc -p tools/seed                             no error in the new files (3 older errors: notes.test.ts, quests.test.ts, answer-rank.ts)
```
Not run: root / client typecheck, full suites, `test:csharp` (the fund-csharp drills ran under the real C# runner through
`seed:validate`), `smoke:api`, `demo:promotion`, `seed:demo:planted`, `seed:campaign`.

## Deviations
1. **Audit output in `.cache/rv3/`**, not `work/rv3/` (`work/` is not git-ignored; `.gitignore` is not S3's). In this clone
   `.cache` is a junction to `selfboot\.cache`, so every clone writes the same `explain-audit.json`; harmless, but `--out`
   per clone avoids it.
2. **Audit reads the authoring**, not `content/fundamentals/<track>/topics.json` (the importer output is byte-deterministic
   from it; the import test proves it). Rule choices: prose word counts exclude fenced code; light stemming; Q3 also passes
   on a misconception phrase; Q4 lets `above` / `below` pass as a comparison; D4 = the importer's hint-2 rule on hints 1
   and 2. All in `S3-SLICE1.md`.
3. **`tools/seed/src/fundamentals/import.test.ts` edited** (not on S3's list): the W2 acceptance (16/16) cannot be met
   without it (see Repairs).
4. **Order:** after JS 21-33 I did C# 21-23 (the other "first" set) instead of JS 01-20, so both senior paths are done
   before the budget ran out.
5. **Commit grouping:** authoring per topic; re-import + re-stamp in one commit per track after the topics.
6. Scratch tooling lives git-ignored in the clone (`tools/seed/build/rv3/`, `build/` is ignored) and in `.cache/rv3/`
   (edit, dump, changed scripts, edit files): not committed.

## Upstream / other bugs found (report items)
- `fund:java/07-collections-framework/q06` explanation says "the first choice throws for a new key": the stored first
  choice is the keyed `merge`; the throwing one is `put(w, map.get(w) + 1)` (also fails Q4). **S2's file.**
- `import.test.ts` hint-3 refusal test was vacuous since R3-09 (fixed here, deviation 3).
- `4fe3dc50`'s message claims 16/16 import tests; it was 15/16 until `067bfadc` (history not rewritten).
- F9 rest not done: the 9 C# 21-23 flashcards and 2 pretest checks that paraphrase a gate key; the 22 lesson's
  `AddStandardResilienceHandler()` default (the package is not in the shared framework, so I could not check it offline);
  the 21 lesson's case-insensitive-collation claim; weak tests in 22/02 and 23/02. F10 rest: bug hunts 05 / 06 / 07, the
  "stubbed local function" line, hint 1 of 14.

## What is left
- **W2 JS 01-20:** quiz 153 items fail (Q1 153, Q3 73, Q5 1: `fund:js/04-this-call-apply-bind/q06`), drills 40 fail D1
  (all in 01-20; D3 claim sentences 15 to prove), lessons 20 fail L1 (14 under 380 words). Run
  `npm run seed:audit:explanations -- --track js --items` for the list.
- **W2 C# 01-20:** quiz 137 fail, drills 34 fail D1, lessons 20 fail L1; `fund:csharp/16-.../q10` fails Q4 ("the first
  choice": also positionally wrong under shuffling).
- **W6 C# 24-26** not started (no census change, no `fund-cs-web.json` ideas added).
- **§2.4 sysdrills** (stretch) not started: 33 D1, 14 D4.
- `seed:audit:explanations -- --check` joins the gates only once js and csharp reach 0.
- Leftover processes matching `bq-f52-d` at stop: 0 (node, dotnet, VBCSCompiler checked).
