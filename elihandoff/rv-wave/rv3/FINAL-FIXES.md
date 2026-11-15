# rv3 final fixes: Fable's obvious fixes (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-d`, branch **`rv3-final`**, base `9726c1d9` (hub `rv-wave`). Tip **`10d8c5d0`**,
7 commits, tree clean. Nothing was pushed and `main` is untouched. No `--no-verify` and no history rewrite. Every commit
was made with `git commit -F` and ends with the Co-Authored-By line. I did not touch the owner DB, `.cache/checkouts` or
any bound file. Afterwards no node, dotnet, java or VBCSCompiler process matching `bq-f52-d` was left (0 found).

**Status: done.** All nine of Fable's obvious fixes are applied (FABLE-FINAL §3). T3 is narrowed, not recoded (see below).

## SHAs (oldest first)
| SHA | What |
|---|---|
| `38cd762f` | fund-js authoring: T5, T6 |
| `9d39bef5` | fund-js re-import + re-stamp |
| `6fb79092` | fund-csharp authoring: T1, T8 |
| `b3f754df` | fund-csharp re-import + re-stamp |
| `b08fb2d9` | fund-java authoring: T2, T3, T4, T7 |
| `1c079ee5` | fund-java re-import + re-stamp |
| `10d8c5d0` | `server/src/engines/streak.ts` header comment (L1) |

## Each fix
A script compared every field against `9726c1d9`. Exactly 9 fields changed, all in explanations, lessons or one card back.
- 0 prompts, 0 choices, 0 keyed answers, 0 item keys changed.
- No course file under `content/packs/` changed. Each pack changed only in `manifest.json` (gitHead) and `validation.json`.

| # | Field | Change |
|---|---|---|
| T1 | csharp 25 `lesson` | "Since .NET 8 an exception that escapes `ExecuteAsync` stops the whole host" → "Since .NET 6 ...". |
| T8 | csharp 26 card c08 `back` | Was "It leaks internal columns, invites over-posting on input, throws on navigation cycles and ties the API to the database schema." This restated q01's key. Now: "It ties the API to the database schema and throws on navigation cycles; a DTO names exactly the fields of the contract." |
| T2 | java 04 q08 `explanation` | "so == is correct and null-safe when the constant is on the left." → "so == is correct and cannot throw for null on either side, unlike x.equals(RED)." |
| T3 | java 20 q10 `explanation` | "applies setMaxResults in memory, with a warning (HHH000104)." → "applies setMaxResults in memory, logging a warning that it did so." **Narrowed, not recoded:** no Hibernate source or jar is available offline, and a grep of all 217 pinned checkouts for `HHH90003004`, `HHH000104` and "applying in memory" found nothing. So the Hibernate 6 code could not be verified. |
| T4 | java 21 q04 `explanation` | Appended: "That holds for a plain `mock(...)`: under MockitoExtension's strict stubs the mismatched call fails with PotentialStubbingProblem instead." The prompt edit Fable suggests ("a plain `mock(UserRepo.class)`") is a prompt change, so I did not make it. |
| T7 | java 22 `lesson` | The first section now ends "Everything below is Spring Security 6 as shipped with Spring Boot 3." |
| T7 | java 23 `lesson` | The first section's prose now ends "Everything below is Jackson 2.x as shipped with Spring Boot 3." |
| T5 | js 14 q01 `explanation` | "`for...of` starts by calling `obj[Symbol.iterator]()`." (q10's key, rule Q5) → "`for...of` starts by asking the object for its iterator method." |
| T6 | js 33 q01 `explanation` | "Even plain Node on a busy laptop managed about 60,000 salted SHA-256 guesses a second, against about 4 default scrypt calls." → "Cracking hardware tests billions of salted SHA-256 guesses a second, while one default scrypt call takes 16 MB of memory and tens of milliseconds or more." This differs from Fable's wording on purpose, because the time measured here is longer (see the note below the table). |
| L1 | `server/src/engines/streak.ts:42-44` (comment only) | Was "a track with no row is on the slate ... so day one asks for one drill per track". Now "a track with no row is OFF the slate (rv wave C, D3: the default day is the Fundamentals step plus a senior rep), and a track's size falls back to DEFAULT_DRILL_SET_SIZE = 1 when no row sets one". This matches `slateShape` at line 254. |

On T6: Node's default scrypt parameters are N=16384, r=8, so it needs 128·N·r = 16 MiB. One call measured 257 ms on this
machine, so I wrote "tens of milliseconds or more" rather than Fable's "costs tens of milliseconds".

## Per track: import, validate, stamp
`seed:import:fundamentals` output (each count === expected):

| Track | Topics | Quiz | Flashcards | Drills |
|---|---|---|---|---|
| js | 33 | 330 | 238 | 79 |
| csharp | 26 | 260 | 208 | 55 |
| java | 26 | 260 | 208 | 60 |

`seed:validate` ran each course on its own with `--concurrency 1`, then a full run. No `--retry-failed` was needed.

| Pack | Per-course runs | Full run |
|---|---|---|
| fund-js | 33 RESULT OK | validated 79, quarantined 0, AUDIT 20 re-executed / 0 mismatch, STAMP written, RESULT OK (29.5s) |
| fund-csharp | 26 RESULT OK | validated 55, quarantined 0, AUDIT 20 / 0, STAMP written, RESULT OK (60.3s) |
| fund-java | 26 RESULT OK | validated 60, quarantined 0, AUDIT 20 / 0, STAMP written, RESULT OK (125.7s) |

fund-java used a clone-local `BOOTQUEST_JAVA_SCRATCH=C:/Users/Owner/Desktop/bq-f52-d/tools/seed/build/rv3j/seed-java`,
as S2b did.

## Gates (Git Bash, foreground, one heavy process at a time)
```
seed:audit:explanations -- --check   850 quiz item(s), 323 drill(s), 85 lesson(s): 0 item(s) fail a gate rule · RESULT OK
seed:lint:leaks                      146 pair(s), 146 baselined (baseline 146), 0 new, 0 stale, 0 unweighted · RESULT OK
seed:lint:answers                    304 scanned, 0 new over the limit, 2 baselined, 0 worse, 0 stale-high, 0 stale · RESULT OK
seed:lint:keyideas                   24 side file(s), 201 idea(s): 0 problem(s), 0 leak(s) · RESULT OK
seed:pins                            RESULT OK: 690 pack(s): 690 OK, 0 MISMATCH, 0 UNCHECKABLE
restamp:all -- --dry-run             703/703 fresh · RESULT OK
tools/seed src/fundamentals/import.test.ts (--maxWorkers=1)                    Test Files 1 passed, Tests 16 passed
server test/api/fundamentals.test.ts + test/api/ladder-real.test.ts (--maxWorkers=1)   Test Files 2 passed, Tests 20 passed
npm run typecheck (root)             tsc --noEmit -p tsconfig.json · rc=0
```
The streak.ts edit is a comment and not a bound file. `restamp:all` stayed 703/703 fresh after it.

## Skipped, deviations
- **T3** was narrowed rather than given the Hibernate 6 code, because I could not verify that code (see above).
- **T4**: only the explanation sentence changed. The prompt edit is left for a stream, as Fable says.
- **T8**: only C# 26/c08 changed. The Java cards 23/c04, 25/c05 and 26/c04 are left for a stream, as Fable says.
- **T6** wording differs from Fable's, as noted in the table.
- **Not run:** client typecheck, full suites, `smoke:api`, `demo:promotion`, `seed:demo:planted`, `seed:campaign`,
  `test:csharp`, `test:java`. These are left for the orchestrator's battery. No runner, client or shared file changed.

## Upstream bugs found
None.
