# W1b review: Express API layer (commit 205743b)

Reviewer: fresh-context Opus, read-only. Read a frozen `git archive 205743b` only (client: `da8ca60:client/src/api/*`).
No npm run. Engine holes already in `docs/recon/w1a-audit.md` (#1-#18) are not re-reported; where an API path
*amplifies* one, that is said. Paths below are relative to the repo; line numbers are at 205743b.

## Findings

1. **MAJOR: `run` is a zero-trace answer oracle for quiz and predict-output.**
   - Where: `server/src/api/service.ts:170-175` → `server/src/api/runners.ts:64-77`. `run` returns `pass:true/false`
     for a quiz and writes nothing (the test proves this, `server/test/api/api.test.ts:175-195`).
   - Scenario: a 3-choice quiz takes ≤3 free `run` calls to find the key, then one `submit` earns full XP and a
     `verified:true` evidence row with mode `solo`. The ledger shows one clean first-try pass. Predict-output can
     be narrowed the same way.
   - §4 says "run is free and unlimited". That rule was written for code drills. For single-keyed items it defeats
     §0.5 ("verifies understanding").
   - Fix (owner decision; log it): `run` on `quiz` / `predict-output` returns 409 `RUN_NOT_APPLICABLE`, or returns
     the result with no verdict. Add a test that `run` cannot be used to tell a right answer from a wrong one.

2. **MAJOR: the drill-set slate slot can be gamed (and it amplifies W1a #6).**
   - Where: `server/src/store/queries.ts:111-121` counts any unit kind with `outcome='pass'` today. It runs from
     `service.ts:253-260`.
   - Scenario 1: the test itself ticks `drill:csharp` with five 2-choice **quizzes** (`api.test.ts:261-273`).
   - Scenario 2: re-submitting five already-passed units every day ticks it (0 XP, still counted).
   - Scenario 3: reveal five drills, paste the solutions, and get a guided "pass" that counts.
   - Fix:
     - Filter on `u.kind = 'drill'`.
     - Exclude `a.mode = 'guided'`; consider excluding `assisted` too.
     - Decide whether re-passes count; my suggestion is to require ≥1 never-before-passed unit, or none (log it).
     - Re-derive the slot at close time, as W1a #6 says.

3. **MAJOR: no slate can ever be complete through the API, so the streak is stuck at 0 and tokens are never earned.**
   - Where: `server/src/engines/streak.ts:75` always adds a `campaign` slot, and no endpoint or service path marks
     it (grep: no `markSlateItem(…'campaign'…)`).
   - `isSlateComplete` (streak.ts:58-60) needs every item done, so every day closes as `partial` at best. That
     keeps but never increments `current` (streak.ts:146-147). The dashboard test only sees `current: 0`
     (`api.test.ts:402,412`), which hides this.
   - Fix: leave the `campaign` slot out of `composeSlate` while no campaign/quest content is seeded, or derive it
     from a quest-step completion row (W5). Add an API-level test: 5 drills per active track plus a cleared queue,
     then the next day `current === 1`.

4. **MINOR (owner decision): drill `run` failures echo test-private material.**
   - Where: `server/src/api/runners.ts:45-50` passes `expected`, `actual` and `message` through. `message` is the
     assertion message *written inside `tests[].code`*.
   - The smoke fixture shows it. `SMOKE_TESTCODE_MARKER` is the custom message of `assert.equal(…, 5, 'SMOKE_TESTCODE_MARKER')`
     (`server/scripts/fixtures/smoke-units.json:36`). `run(addWrong)` therefore returns the "leak" marker.
   - The smoke checks markers only on `GET /units/:id` (`smoke-api.mjs:128-134`), not on the run response at
     :140-146, so this is invisible.
   - `shared/src/api.ts:100` claims tests are private *because* they encode expected values.
   - Fix: decide that boot.dev-style expected/actual is intended and document it in api.ts, then make the smoke
     use a marker that is not an assert message and assert it is absent from run output. Otherwise strip
     `expected` / `message` for hidden tests.

5. **MINOR (latent major): `xpKindFor` is not exhaustive.**
   - Where: `service.ts:177-181`. Every type that is not quiz or predict maps to `code` (10×difficulty).
   - The types are study-quiz (50), explain-back (20), patch-kata (15), review (1), and guided-step / http / repo
     / node-test-file / self-run.
   - It is latent only because those types 501 today. The first W3/W6 runner registration will mis-pay.
   - Fix: an exhaustive `switch` with a `never` default, plus a table test over `CHECK_TYPES`.

6. **MINOR: a null difficulty silently pays 10 XP.**
   - Where: `service.ts:229` (`unit.difficulty ?? 1`).
   - Fix: refuse (500, or 409 `NO_DIFFICULTY`), or make `difficulty` NOT NULL for drill-like kinds at seed time.

7. **MINOR: prerequisite locks are display-only.**
   - Where: `service.ts:170-175,196-205,303-307`. These only check *track* lock, so a learner can run, submit and
     reveal a `locked` unit.
   - `getRevealedSolution` (`service.ts:316-324`) skips `assertTrackOpen` entirely.
   - Not an honesty hole, but the skill tree is advisory. Decide and document, or enforce with 403 `UNIT_LOCKED`.

8. **MINOR: units without a check can never become `done`, so they block their successors and pin `nextUp`.**
   - Where: `queries.ts:82-84` (done = has a pass attempt); `service.ts:371-376`.
   - A study or reading unit placed early in a track locks the rest forever, and `nextUp` points at it forever.
     The fixture `fixture:no-check` already exists.
   - Fix: skip check-less units in `nextUp`, and in `lockStateFor` treat them as satisfied, or add the §6.1
     "reading self-attest" endpoint.

9. **MINOR: the runner's richer verdict is dropped.**
   - Where: `CanonicalRunResult` (`shared/src/api.ts:200-207`) is strict and has no `verdict`. `submitUnit` maps
     everything to pass/fail (`service.ts:206`).
   - Effect: timeout, crashed and todo are recorded as `fail` in both `run.verdict` and `attempt.outcome`. The
     client wants `RunVerdict` (worksheet W-14).
   - Fix: add an optional `verdict` and pass it through to `recordRun`.

10. **MINOR: `GET /api/dashboard` writes.** Judgment: sound for a single-user local app.
    - Why it is sound: node:sqlite is synchronous, the whole handler is one `BEGIN IMMEDIATE` with no await
      inside, closing is idempotent, and two concurrent GETs serialize.
    - The real hazard is clock skew, and it is irreversible: one GET with a forward-jumped clock closes every
      intervening day as `missed` (streak reset, tokens burned). It also advances `last_closed_day` and inserts
      `items:'[]'` rows for days that later become "today". Those days can then never hold a slate.
      `service.ts:353-366` → `streak.ts:123-185`.
    - Prefetchers also trigger it, harmlessly.
    - Fix: refuse to close more than N days, or any day after the newest ledger row + 1, without a confirming
      POST. At minimum, log a warning when `today` < `last_closed_day`.

11. **MINOR: the error handler mislabels foreign 4xx errors.** `app.ts:163-166` maps *any* error carrying a
    numeric 4xx `status` to code `VALIDATION`, including future library errors thrown from engines.
    Fix: restrict this to body-parser errors (`e.type` present). Send everything else to 500, and log it.

12. **MINOR: the body limit and the field limit disagree.** `JSON_BODY_LIMIT='256kb'` (`app.ts:34`) is in bytes;
    `MAX_CODE_CHARS=100_000` (`api.ts:68`) is in UTF-16 units. 100k chars of CJK or emoji (~300-400 KB) gets 413
    instead of a VALIDATION issue. Fix: raise the limit to ~512kb, or document it.

13. **MINOR: shutdown and port robustness.**
    - (a) `installShutdown` uses `proc.once` (`serve.ts:131-132`), so a second Ctrl+C has no listener and Node
      hard-kills. The `done` guard only covers SIGINT followed by SIGTERM. That is acceptable as "force quit";
      document it.
    - (b) `process.exit(0)` right after `close()` can orphan an in-flight drill-js grandchild (the §13 zombie
      lesson). Track live runner children and kill them in `close()`.
    - (c) `assertPortFree` probes 127.0.0.1 only (`serve.ts:52-61`). On Windows, another app on `[::1]:4178`
      (Vite-style IPv6 localhost) does not collide, so a client or proxy using `localhost` can reach the wrong
      server. Pin the Vite proxy target to `http://127.0.0.1:4178`. The TOCTOU between probe and listen is
      handled at :97.
    - (d) The smoke `child.kill()` is TerminateProcess on Windows, so the graceful path is never exercised end
      to end.

14. **MINOR: smoke script gaps.**
    - Boot loop: a non-OK `/api/health` response skips the `sleep`, so it busy-loops 120× (`smoke-api.mjs:107-114`).
    - Run step: no leak assertion (see #4).
    - `main()` returns `true` even after failed steps (harmless: the exit code is computed from `results`).
    - Otherwise it asserts what it claims: real entrypoint, temp DB, free port, ledger via a second connection,
      port free and pid gone.

15. **MINOR: defence-in-depth is uneven.**
    - Only `GET /units/:id` re-parses its response (`app.ts:97`). Reveal, submit and dashboard are unparsed.
      Cheap fix: parse every response with its shared schema in tests or under `NODE_ENV!=='production'`.
    - `repo.predicates` is whitelisted as whole objects (`api.ts:119,176`, `z.record(z.unknown())`). A future
      predicate with a private field (e.g. an expected PR-section body) would leak.
    - The whitelist is otherwise default-deny. It is tested for every `CHECK_TYPES` member with every *current*
      private field set (`shared/test/api.test.ts:8-55`). New private fields are therefore safe by construction;
      new *nested* fields under whitelisted arrays or records are not. Project predicates per `kind`.

16. **MINOR: quiz answer typing traps.**
    - `grading:'choice'` with a string `answerKey` (allowed by `QuizCheck`) can never pass (`runners.ts:70`).
    - `grading:'exact'` requires a *string* answer, so a numeric exact key needs `"42"`, not `42`.
    - Fix: a seed-time refine (choice ⇒ integer key < choices.length) and documentation in the contract.

## Binding worksheet: client (`da8ca60:client/src/api/{types,http}.ts`) vs server (205743b)

Server routes: `GET /api/health|dashboard|tracks|tracks/:id/units|units/:id|units/:id/solution|reviews/queue`,
`POST /api/units/:id/run|submit|reveal`, `POST /api/reviews/:itemId/grade`.

**Cross-cutting**

| # | Client expects | Server has |
|---|---|---|
| W-1 | ids are `string` (`unitId`, `cardId`, `attemptId`, `EvidenceRef.id`) | `number` |
| W-2 | timestamps are ISO-8601 strings (`at`, `nextDueAt`, `retestDueAt`) | epoch ms (`createdAt`, `prevDueAt`, `nextDueAt`, `dueAt`) |
| W-3 | errors: any 404 means `ApiNotFoundError`; otherwise raw text | `{error:{code,message,issues?}}`. A 404 can also be `NO_SOLUTION`, and the client cannot tell them apart. |

**Dashboard** (`GET /dashboard`)

| # | Client expects | Server has |
|---|---|---|
| W-4 | heatmap `date` | `day` |
| W-5 | heatmap status `slate\|partial\|freeze\|none` | `open\|slate\|partial\|frozen\|missed\|none` |
| W-6 | `streak.freezeTokens`, `freezeTokensMax`, `slateDaysToNextToken`, `todayCounts` (slate **or partial**) | `tokens`, (none), `slateDaysBanked` (the inverse quantity), `todayComplete` (slate only) |
| W-7 | `level:{level,xpTotal,xpIntoLevel,xpLevelSpan,xpToday}` | `xp:{total,level,intoLevel,levelSpan,nextAt}`; no `xpToday` |
| W-8 | `competencies[].label`, `rating: number\|null`, `promotion: PromotionProgress\|null` | `name`; `rating: number`; no `promotion` (W6) |
| W-9 | `lastEvidence:{id,kind,at,summary,assessor,assisted}` | `{id,kind,createdAt}` |
| W-10 | `slate: SlateItem[]` with `{id,kind,trackId,label,done:number,total:number,href}` and kind `review-queue` | `slate:{day,status,items:[{slot,kind,track?,size?,done:boolean}]}`; kind `review-clear`; no progress count (n/5) |
| W-11 | `reviewDue` | `reviewQueue.due` |
| W-12 | `nextUp[]` flat `{trackId,unitId,title,kind,actTitle,href}` | `{trackId, unit:{id,key,title,kind}\|null}`; no `actTitle` |

**Tracks / campaign**

| # | Client expects | Server has |
|---|---|---|
| W-13a | `GET /tracks` returns `Track[]` (a bare array) | `{tracks:[…]}` |
| W-13b | `short`, `status:'active'\|'locked'`, `lockedReason`, `unitsDone`, `unitsTotal` | `locked: boolean`, `doneCount`, `unitCount`; no `short` or `lockedReason` |
| W-13c | `GET /tracks/:id/campaign` returns acts and steps, with NodeState `locked\|available\|in-progress\|complete` | only `GET /tracks/:id/units` (a flat list, `state: locked\|available\|done`); no acts (W5) |

**Exercise player**

| # | Client expects | Server has |
|---|---|---|
| W-14a | `GET /units/:id` returns flat `Exercise` | `{unit, check:{id,threshold,spec}, starter}` |
| W-14b | `difficulty: number` | `number\|null` |
| W-14c | `xp` | none |
| W-14d | `language: javascript\|typescript\|csharp` | `spec.language: js\|ts\|sql\|cs` |
| W-14e | `instructions[]`, `breadcrumb[]`, `quiz.prompt` | none (no prose source on the server; the content store holds only starter/solution) |
| W-14f | `starterCode: string` | `starter: string\|null` |
| W-15a | `runExercise` sends `{code}` only | quiz and predict also need `{answer}` (string or number) |
| W-15b | response `RunResult{verdict,durationMs,tests[{name,status,message,expected,actual}],stdout,stderr}` | `{result:{pass,output,failures[{name,message,expected?,actual?}],durationMs}}`: wrapped, failures only, no verdict, no stderr |
| W-16a | submit route `POST /units/:id/attempts` | `/submit` |
| W-16b | body `{code, assistance}`: the client can self-declare `'reveal'`/`'none'` | `{code\|answer, selfAssisted:boolean}`, strict. The server must keep this; reveal is derived, never declared. |
| W-16c | response `{attemptId, run, xpAwarded, xpZeroReason}` | `{result, verdict, attempt:{id,mode,outcome}, runId, xp:{id,amount,reason}\|null, evidenceIds}` |
| W-17a | `POST /units/:id/quiz-answer {choiceIndex}` returns `{correct, correctIndex, explanation, xpAwarded}` | `/submit {answer:<index>}`; no `explanation` |
| W-17b | **HONESTY:** the mock returns `correctIndex` even on a wrong answer, with no reveal row (`mock.ts:182-186`). With "failed submits cost nothing", the learner then resubmits for full XP. | Do **not** adopt this. The key may only come from `POST /reveal`. |
| W-18 | no reveal or solution calls at all | `POST /units/:id/reveal`, `GET /units/:id/solution`. The client needs an explicit reveal action. |

**Reviews**

| # | Client expects | Server has |
|---|---|---|
| W-19 | `GET /review/count` returns `{due, newToday}` | no route; `count` is in `/reviews/queue`; no `newToday` |
| W-20a | `/review/*` (singular) | `/reviews/*` (plural) |
| W-20b | `GET /review/queue` returns `ReviewCard[]` `{id,trackId,competency,front,back,source}` | `{count, items:[{id,cardKey,kind,unitId,competencyId,dueAt}]}`; no front/back/source (card text has no server source) |
| W-21 | grade response `{cardId, grade, nextDueAt (ISO), xpAwarded}` | `{itemId, grade, prevDueAt, nextDueAt (ms), xp:{…}, demotion, remainingDue}` |

**Enums**: TrackId, CompetencyId, UnitKind, RunVerdict, Assistance, ReviewGrade, XpZeroReason and EvidenceKind
match `shared/src/enums.ts` verbatim. DayStatus (W-5), SlateItemKind (W-10) and NodeState (W-13c) do not.

**Count: 21 numbered groups; 30 itemised mismatches, after splitting each row by field and route above.**
Recommendation: replace `client/src/api/types.ts` with `import type` from `@bootquest/shared/api` and adapt the
UI. Keep the server as the authority, especially W-16b, W-17b and W-18. Content gaps W-14e and W-20b need a
public prose/card store, which is a W2/W4 decision.

## Verified clean

- **Request validation**: strict Zod on every body, params and query. Ids are `^[1-9]\d{0,14}$`. `limit` is
  bounded 1..1000. Client-supplied `verified`/`xp`/`difficulty`/`assistance` are rejected (tested).
- **Reference solutions**: kept out of the DB. `GET /solution` returns 403 until a `revealed` attempt row exists.
  Reveal writes the row in autocommit *before* building the response, and re-reads it. A unit with no solution
  gets 404 before any write (tested).
- **Reveal races**: no reveal race on the single connection. The reveal path has no `await`, so check-then-insert
  is atomic. In reveal-during-submit grading, the submit transaction runs `deriveMode` after the reveal commits,
  so the attempt is guided with 0 XP.
- **Submit atomicity**: grading runs outside the transaction. The attempt, run, XP, evidence and slate writes are
  one `BEGIN IMMEDIATE` (nested savepoints) and roll back together. No crash path awards XP without the attempt
  and run rows. A runner infrastructure failure leaves no row and no XP (acceptable; document it).
- **Run writes nothing**: no ledger rows and no `daily_slate` row (tested). Quiz and predict failure objects never
  echo the key or the expected output (tested with markers).
- **Response hygiene**: `toPlain` gives null-prototype rows a plain prototype, refuses unsafe BigInt, drops
  `undefined`. Booleans are converted at the Db layer.
- **Errors**: JSON-only 404 and errors; BAD_JSON and 413 mapped. 5xx gives a generic message and logs to the
  console, so Zod internals never reach the client.
- **Startup**: WAL and busy_timeout are set on the server's own connection and asserted. `BOOTQUEST_DB` has no
  default. The busy-port check runs before the DB is opened, and the DB is closed on startup failure. `close()`
  is memoized.
- **Public/private split**: the check-spec whitelist is default-deny, with a per-type strict `PublicCheck` and a
  test over all 14 types.
