# f52 wave B — council rulings and briefs (binding)

Read `COMMON.md` (hard rules) and `STATE-AFTER-WAVE-A.md` first. A three-member Fable council (curriculum,
learner experience, senior-engineer skeptic) ruled as follows.

## Machine rule (new, binding for everyone)
The machine has ~2-3 GB free memory. **Do not run full test suites, `npm ci`, the client build or more than
one heavy command at a time.** Run only targeted tests for files you touched
(`npx vitest run <file>` with `--maxWorkers=1`). The orchestrator runs the full battery at the end.
Do not start servers or headless browsers.

## Content rulings
- New topics go on the **js** Fundamentals ladder only (language-neutral backend subjects are hosted once).
  No C#/Java twins. No Git, shell/Docker, DSA/Big-O ladders, no capstone, no new track.
- Every new topic's drills must exercise the topic's own headline with injected fakes (store, clock, query
  log); no DB server, no network. SQL topics use real in-memory `node:sqlite` if the fund-js drill path
  supports it (spike first), else an injected fake.
- Per new topic: lesson 400-480 words with ≥2 concrete CRUD failure stories; **quiz 8 items** (schema
  minimum), each with an explanation; **6 flashcards**; **3 drills**, each with ≥5 tests named for behaviours
  incl. one trap edge case, and each must FAIL at least one plausible-wrong implementation (not only the
  empty stub) — state which wrong implementation in the drill's `explanation`.
- Quiz rules = `CONTENT-RULES.md` rules A-J (distractors are specific false claims; key not identifiable by
  length, hedges, backticks or a lone "No"; key is the single longest choice in ≤3 of 8 items and the
  single shortest in ≤3 of 8; four choices distinct under case folding). No flashcard back may contain a quiz
  key verbatim (the importer refuses: "FC-quiz xleak"). No answer may be readable from the prompt.
- Hints (exactly 3 per drill): hint 1 names the concept; hint 2 names the approach WITHOUT code, API names
  or the literal fix; hint 3 may be near-solution (the server never serves the last hint).
- Facts must be right for Node 22 / ES2023 / SQLite 3.4x / current HTTP RFCs. When unsure, test it with a
  small `node -e` snippet or leave it out.

## New JS topics (ids continue the ladder; level "advanced")
| # | Slug | Scope | Drills (signature idea → what tests assert) |
|---|---|---|---|
| 21 | lost-updates-and-optimistic-concurrency | check-then-act races, version columns, 409, bounded retry | `reserveSeat(store,id)` two interleaved calls → exactly one success · `updateIfVersion(store,id,patch,version)` stale → conflict, nothing written · `withRetryOnConflict(fn,max)` bounded, re-reads each time |
| 22 | idempotent-writes | idempotency keys, retries, duplicate delivery | `createOrder(store,key,body)` same key → same order, one insert; same key + different body → 422 · concurrent same-key calls → one insert (in-flight map) · `dedupeWebhook(seen,event,now)` TTL boundary |
| 23 | pagination-that-does-not-drift | offset drift, keyset on (createdAt,id), opaque cursors | `page(rows,{limit,after})` inserts/deletes between pages → no dup, no gap · `encodeCursor`/`decodeCursor` tampered → error result, never throws · limit clamp + `hasMore` without a count query (query log asserts) |
| 24 | authorization-and-tenant-scoping | IDOR, tenant filters, mass assignment, 404 vs 403 | `scopedRepo(db,tenantId)` every method filters; cross-tenant id → null · `pickAllowed(body,role)` allow-list · `can(user,action,resource)` owner/role/tenant matrix incl. cases that must be allowed |
| 25 | schema-changes-under-live-traffic | expand → backfill → contract, dual-write, resumable backfill | `checkPlan(steps)` rejects drop-before-backfill, NOT NULL without default, one-step rename · `backfill(store,batchSize)` resumable after a crash, idempotent · dual-write adapter: old and new readers pass at every step |
| 26 | cache-correctness | TTL, stampede/single-flight, invalidation, key design | `cached(fn,{ttl,clock})` 50 concurrent misses → one load · invalidate-on-write: read-after-write is fresh · `cacheKey(tenant,user,params)` no cross-tenant collision, param order normalised |
| 27 | n-plus-one-and-query-budgets | N+1, batching, loaders, query-count assertions | fix a list handler: counting store logs ≤2 queries for N=1,10,200 · `createLoader(batchFn)` per-tick batching, dedupe, order kept · `assertQueryBudget(fn,n)` helper |
| 28 | seams-fakes-and-answerable-logs | injected clock/id, characterization tests, structured logs | refactor handler to injected clock + id generator; tests pin time · learner-written `cases` pass on legacy code and fail on 3 planted mutants · `logRequest(ctx)` emits tenantId, requestId, durationMs; never password/token |
| 29 | sql-queries-nulls-and-joins | three-valued logic, ORDER/LIMIT, inner/left join, GROUP BY/HAVING, fan-out double counting | overdue-invoices query (NULL due dates excluded, ties by id) · customers with zero orders appear with 0 · fix a SUM inflated by a second join |
| 30 | sql-schema-design-and-constraints | keys, FK, UNIQUE/CHECK, normalisation, soft delete + unique | write DDL: duplicate email rejected, orphan order rejected, negative qty rejected · partial unique index for soft-deleted rows · fix a schema that allows two "primary" addresses |
| 31 | sql-indexes-and-query-plans | composite order, covering index, non-sargable predicates | add an index so `EXPLAIN QUERY PLAN` shows SEARCH not SCAN · rewrite a non-sargable predicate · pick one index that serves 3 queries (plan asserted for each) |
| 32 | sql-transactions-and-app-code | atomicity, lost update in SQL, parameters vs injection, upsert, keyset in SQL | transfer rolls back on failure · versioned UPDATE returns conflict on stale version · parameterised search that an injection string cannot widen |
| 33 | authentication-sessions-and-tokens | password hashing, sessions vs JWT, cookie flags, refresh rotation | verify an HS256 JWT with `node:crypto` (rejects `alg:none`, expired, tampered) · session id rotation on login + fixation test · refresh-token rotation with reuse detection |

Authors: **A = 21-24, B = 25-28, C = 29-33** (C spikes one SQLite drill first).

## C#/Java ruling: no new topics; 12 framework drills + repair pass (author D)
- Add 2 drills each to csharp 17, 19, 20 and java 18, 19, 20, modelling real framework behaviour as pure
  code (same style as the existing drills): pipeline short-circuit order; tracked vs detached entity update;
  concurrency token → 409; transaction rollback across two saves; `@Transactional` self-invocation trap;
  lazy load outside a session; `@ExceptionHandler` precedence; entity equals/hashCode.
- Repair pass on all 65 existing Fundamentals drills (all three tracks): rewrite hint 2 wherever it is
  code-level (names the API call / exception type / literal fix) so it follows the hint rule above; do not
  touch tests or solutions.
- Fix the garbled explanations the council found (csharp 20 quiz 8 "A single SaveChanges is already
  atomic. That includes raw SQL…" contradicts the lesson; js 18 quiz 7 allow-list sentence inverted) and scan
  every `explanation` that received an appended sentence in the wave-A rewrite for the same kind of
  non-sequitur; fix by rewriting the explanation only.

## App rulings (frontend agent F, server agent V)
1. **Hints UI** — `Player/HintBar.tsx` in the code pane between the toolbar and results. `needs-fail`:
   muted "Hints unlock after one failed Submit. Run doesn't count; a failed Submit costs nothing."
   Available: button "Show hint 1 of 2 · pass XP drops to 75%" (no confirm). Taken hints stay as a numbered
   list. `exhausted`: "No more hints. Reveal solution is the last resort (0 XP)." Render nothing for
   total 0 / not-hintable / locked. XP line shows "(75% · 1 hint)" on a hinted pass. Also change the Submit
   helper copy to say failed submits are free.
2. **Gate fail path (Fundamentals only)** — after a FAIL show the score and "Re-read: <headings of the missed
   items>" (from V's map; generic line if absent) and NO per-question marks; each new try shuffles question
   order and choice display order client-side (map back to served indices before submit); from the second
   consecutive fail "Try again" unlocks after 3 minutes (client-side countdown, localStorage per unit,
   try/catch).
3. **Complete = gate + ≥1 own drill passed** (gate alone where the topic has no live drill). Unlocking the
   next topic stays gate-only. Progress reads "3 complete · 5 gates passed". One shared `drillOpen` helper
   (a revealed, unpassed drill is never a "next step") used by the dashboard hero and `nextstep.ts`.
4. **Course rail + completion moment** — `Player/CourseRail.tsx` under the header for any `fund` unit:
   "JS Fundamentals · Topic 3/20", steps Lesson → Gate → Drill 1..n → Next topic with ticks; one shared
   `useFundLadder(track)` hook feeds the rail and NextStep. On the pass that completes a topic (and on a gate
   pass): a panel with "Topic 3 of 20 complete", XP count-up (600 ms; none under prefers-reduced-motion),
   flashcards enrolled, focused primary next button. After a gate pass the primary is "Practise: <drill>";
   "next topic" is a muted "Skip to next topic" link.
5. **More practice** — in NextStep once the topic's own drills are done, and as a closed `<details>`
   "More practice · 2/6 done" per topic row on the Campaign Fundamentals list; undone first, difficulty
   ascending; show 3 then "Show all N".
6. **Session shape** — static estimates (topic ≈10 min; drill ≈5/10/15 min by difficulty; reviews ≈N×10 s) in
   the hero context and rail; "Done for today ✓ · streak safe" hero state when 0 reviews due and (slate
   complete or ≥50 XP today) with the next step as a secondary button; streak tile shows "12 / 20 XP today"
   until safe.
7. **Lesson aids (V)** — side file `content/fundamentals/sections.json`
   `{ "<track>": { "<topicId>": { "gate": { "<1-based question number>": "<lesson heading>" }, "checks": [{heading, prompt, answer}] } } }`,
   loaded warn-and-skip like `related.json`; read-only `GET /units/:id/lesson-aids` → `{ gate: Record<string,string>, checks: [...] }`
   (DTO at the end of `shared/src/api-ext.ts`). V fills the `gate` map for all existing 60 topics (each quiz
   item → the lesson heading that teaches it; headings must match the lesson's `##`/`###` text exactly) with a
   test that every heading exists; `checks` (ungraded reveal cards on FRESH examples, never restating a gate
   key) only for JS topics 01-05 as a pilot. F renders checks after their heading (Reveal button; no XP, no
   attempt) and uses `gate` for the "Re-read" line.
Cut: server-enforced cooldown, drill-required unlock, typed predict-output items, confetti/levels.
