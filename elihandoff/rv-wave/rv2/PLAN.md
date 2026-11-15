# rv2 plan: reinforce the key ideas, finish the learning features, add targeted content

Written 2026-11-13 by Fable (orchestrator-in-chief). Binding on the rv2 implementers; the main loop runs the mechanics.
Read with `../HANDOFF.md` (state, D3-D8, restamp rules §3, machine lessons §8), `../review/REVIEW.md` and `AGENTS.md`.

**Precondition (hard).** rv2 branches are cut only after the integrator's `rv-wave` in `bq-f52-hub` contains `rv-p`
(merged, `63dda197`), `rv-d`, `rv-c` and the finished WIPs (`rv-p-wip` client, `rv-c-wip` Java bug-hunts, `rv-e1-wip`
sysdrills), with typecheck, the targeted suites and `restamp:all -- --dry-run` green. If a WIP is not finished, the
integrator drops it and says so; the dropped work is then added to the stream named in §4 ("inherits").
Not checked by me: I read the reports, side files and branch contents, and ran no test.

## 1. Review delta (what I change in REVIEW.md's plan)

| # | Ruling | Reason |
|---|---|---|
| 1 | **The content freeze (Q2, 5-0) is lifted by the owner, but only narrowly.** New content is allowed when it (a) is on a path the slate serves, and (b) comes with its key-idea entries (§2). No new repos, no new track, no breadth ladders. | The owner asked for more content after the vote. The council's reason (0 attempts) still holds, so everything new must be reachable from the default day. |
| 2 | **Spaced production and the key-ideas layer go first; confidence tags and the calibration panel go last.** | Calibration needs attempts and there are none. Redo cards and key-idea cards change what the first week feels like. |
| 3 | **Add: the review never says what a learner must own per section.** It lists defects by item type. §2 adds a per-section key-ideas list as data, and one mechanism that spaces it. This also replaces the separate "concept index" (R5-08): a key idea's `tags` are the index. | "Reinforce the key things in each section" needs a definition of "key things" that the app can read. |
| 4 | **No item-level quest cuts by re-seed this round** (HANDOFF §6.3). Keep `card-tags.json` (flashcards out of FSRS) only. | Re-seeding ~460 items churns stamped packs and gate composition for material that the default day no longer serves. Low gain, real risk. Owner decision O5. |
| 5 | **The archive stays at 879 units.** | Routing (paths, default day) already hides the rest. Growing it buys nothing until there is usage data. |
| 6 | **B's "2-day lock on graded tries after practice" must not fire from key-idea cards, checkpoints, redo cards or pretest checks.** Only `POST /units/:id/practice` on the same unit locks. | Otherwise reinforcement would lock the gate it reinforces. S1 adds a test. |
| 7 | **`paths/sysdesign.json` is a keyword match and is reviewed by hand in S2 before interview mode ships.** | Stream C said so itself; the senior-rep slot walks this file daily. |
| 8 | **Placement by production, window-based demotion, verbal explain-back, BYO-LLM import, Parsons: not in rv2.** | Placement needs a diagnostic bank; demotion needs a promotion path (needs `sync`, an owner action); the rest are low gain or blocked. |
| 9 | **Kata precision + clean/nit-only decoys is a stretch item**, and the agent-PR katas ship without decoys if it slips. | It changes G1 scoring (`ladder-service.ts`), which B just changed; do not stack two scoring changes untested. |

Confirmed and unchanged: D3-D8, restamp list (HANDOFF §3), reuse of `review_item.kind = 'concept'` (the DB CHECK in
`001_init.sql:287` and `engines/fsrs.ts:28` already allow it; nothing writes it today).

## 2. Reinforce the key things in each section

### 2.1 One mechanism: the key-ideas layer
**Data** (server-local side files, never stamped, never fingerprinted): `content/keyideas/<section-id>.json`
```json
{ "format": "bootquest-keyideas@1", "section": "fund-js-senior", "title": "JS: senior CRUD (topics 21-33)",
  "track": "js", "scope": ["fund/js/25-", "fund/js/26-"], "recapAfter": 0.8,
  "ideas": [ { "id": "idempotent-write", "idea": "<one sentence, <= 30 words>", "why": "<what breaks without it>",
     "prompt": "<a question that needs the idea, not a definition>", "answer": "<= 60 words",
     "tags": ["idempotency"], "sources": ["fund/js/26-idempotent-writes"], "siblings": ["<drill unit key>"] } ] }
```
- `scope`: unit keys or key prefixes (same prefix rule as `content/paths/*.json`) that make up the section.
- `sources`: the units that teach the idea. `siblings`: drills that exercise it, used for redo cards (0-3 per idea).
- 5-12 ideas per section (sysdrills: 18, one per module). `id` is permanent once any card exists (same rule as historical keys).

**Server** (all free files): `store/keyideas.ts` (reader in the style of `store/fundamentals.ts`: never refuses startup,
warns once on an unknown key, skips archived keys), `engines/keyideas.ts`, `api/keyideas-service.ts`.
1. **Key-concept cards (FSRS, kind `'concept'`).** When the learner passes a unit listed in an idea's `sources`
   (first graded pass, any assistance), enrol `card_key = keyidea:<section>/<id>`. Text is resolved from the side file at
   read time (`reviewCardText`). First due = +1 day; at most 4 new key-idea cards become due per day (later ones get
   +2, +3 ... days). `store/review-cards.ts` retires a card whose idea is gone and restores it if it returns.
   Front = `prompt`; back = `answer` + `why` + links to `sources`. Self-rated like every card. Review XP once per card
   per day (B's rule). Never evidence, never a ladder leg.
2. **End-of-section recap + retrieval checkpoint.** When `recapAfter` (default 0.8) of the section's live, non-archived
   units are passed, the section's last unit result panel and the dashboard show "Section recap". The recap is
   answer-first: each prompt takes typed free recall (>= 8 words, B's minimum-answer check), then the answer is shown and
   the learner marks got it / partly / missed. Missed and partly ideas are (re)enrolled due tomorrow. The recap pays a
   flat 20 XP once per section and writes one row to `keyidea_checkpoint` (migration 023). It is not evidence.
3. **Spaced re-check.** 14 and 45 days after a recap, the section appears once in the reviews queue as a 5-prompt
   "re-check" drawn from the ideas with the worst FSRS state. For Fundamentals sections this replaces the planned spaced
   re-gate (R1 T5): it does not replay gate items, so it cannot leak the gate and needs no set B.
4. **Interleaved "Key ideas" session.** `/review?mode=keyideas` (and `bootquest review --keyideas`): due key-idea cards
   from all sections, shuffled so that no two neighbours share a section, capped at 12. The 10-minute mode takes 5.
   The Review page gets a filter chip by `tag` (the concept index: "idempotency" pulls cards from Fundamentals, sysdrills,
   DESIGN IT and campaign sections).
5. **Redo of a sibling drill (spaced production).** 3 days after a drill pass that is a `source` of an enrolled idea,
   enrol `redo:<section>/<id>` (kind `'concept'`). The card opens one of `siblings` the learner has not passed (else the
   least recently passed) in the Player in practice mode. A passing run rates the card good, a fail rates it again.
   At most one redo card is served per day. No sibling listed = no redo card.
6. **Missed-key-point cards (EB, DESIGN IT, G2).** On self-score, each missed `[w2]`/`[w3]` key point enrols
   `ebmiss:<unit key>#<kp index>` (kind `'concept'`). Front: the question + the key point's headline from
   `content/design/headlines.json` (falls back to "one key point you missed"); back: the key point. Max 3 per attempt,
   highest weight first. Retired when the unit's set is re-seeded without that key point.
7. **Pretest.** The T9 check-yourself cards in `sections.json` are shown before the lesson as "what do you already
   know?" (answer-first, unscored, skippable). Data exists; this is client only.

**Xleak rule for key ideas** (AGENTS.md content discipline applies): an `answer` may restate the keyed answer of an item
only if that item belongs to a unit in the idea's own `sources` (the card is enrolled after that unit is passed). New
lint `seed:lint:keyideas` (S2, `tools/seed/src/ops/keyideas-lint.ts`, outside the factory): schema, idea count, word
limits, every `scope`/`sources`/`siblings` key resolves to a live unit, >= 1 source per idea, no archived key, unique
ids, and the existing leak matcher run on `prompt`+`answer` against all items outside `sources` = 0 leaks.

**Where it shows.** Dashboard: one "Key ideas" tile (owned / shaky / not yet met, per track). Track browser and
Fundamentals page: a per-section "Key ideas" fold listing the `idea` sentences, with `answer` hidden until the idea's
sources are passed. Weekly page (S3): ideas rated again >= 2 times this week.

### 2.2 The key ideas per section (S2 turns each row into one side file; wording is theirs, the list is binding)
| Section id (scope) | Key ideas the learner must own |
|---|---|
| `fund-js-core` (fund/js 01-14) | `===` and explicit conversion, `??` vs `\|\|` · a closure captures the variable, not the value · `this` comes from the call site, arrows take it lexically · property lookup walks the prototype chain, `class` is sugar · which array methods mutate (`sort`, `splice`) and which copy · Map/Set vs plain objects, what JSON drops · throw `Error` subclasses with `cause`, never swallow · ESM is static and live-bound, CJS copies at require time · microtasks run before the next macrotask · `await` in a loop is sequential, `Promise.all` fails fast, `allSettled` does not · iterators and generators are lazy |
| `fund-js-platform` (15-20) | narrow `unknown`, do not reach for `any` · generics express a relation between input and output · streams need backpressure (`pipeline`) · validate at the HTTP edge, pick the status by who must act · React state is a snapshot, render is pure, update immutably · an effect syncs with an external system: deps, cleanup, stale closures |
| `fund-js-senior` (21-33) | NULL is three-valued, a join can multiply rows · the schema constraint is the last line of defence · an index must match predicate and order: read the plan · keep transactions short, no network call inside · lost update: version column or conditional `UPDATE`, check the row count · idempotency key stored with the result in the same transaction · keyset pagination, not OFFSET, with a unique tie-breaker · every query scoped by tenant, 404 vs 403 on purpose · expand, migrate, contract for live schema change · cache: invalidate on write, bound by TTL, guard the stampede · N+1: batch and set a query budget · seams and fakes over mocks, logs carry a request id · session vs token: storage, cookie flags, revocation |
| `fund-cs-language` (fund/csharp 01-14) | value types copy, reference types alias, boxing allocates · nullable reference types are compile-time only: guard the boundary · ordinal vs culture string comparison · exhaustive pattern matching · records: value equality and `with` · LINQ is deferred: do not enumerate twice · async all the way, never `.Result`, pass the `CancellationToken` · override `Equals` and `GetHashCode` together · `using`/`IDisposable` for anything that owns a handle · `Span<T>` and allocation awareness on hot paths |
| `fund-cs-web` (15-20, +21-26 when added) | DI lifetimes and the captive dependency · middleware order is behaviour · validate the model, answer with ProblemDetails · `DbContext` is a scoped unit of work with change tracking · project and `AsNoTracking` for reads, spot N+1 · one `SaveChanges` is one transaction: know when you need an explicit one · (new topics) test through `WebApplicationFactory` seams, timeouts + retries with jitter on `HttpClient`, authenticate vs authorize and resource-based checks, structured logs without secrets |
| `fund-java-language` (fund/java 01-16) | `==` vs `equals`, the Integer cache · Strings are immutable: `StringBuilder` in loops · exhaustive `switch` over sealed types · records and enums as data · PECS and erasure · pick the collection by access pattern, iterators fail fast · `equals`/`hashCode`/`compareTo` must agree · streams are lazy, single-use, side-effect free · `Optional` is a return type only · try-with-resources and suppressed exceptions · `Instant` for moments, zone only at the edge · visibility and atomicity, shut executors down · compose `CompletableFuture`, handle the exceptional path |
| `fund-java-spring` (17-20, +21-26) | constructor injection, singletons must be stateless · validate in the controller, map errors in one advice · entity identity and what a derived query really runs · `@Transactional` works through a proxy: self-invocation skips it · lazy loading outside a transaction, N+1, fetch join / entity graph · (new topics) JUnit 5 + Mockito: fake the boundary not the unit, filter chain and method security, Jackson contracts, MDC request ids, client timeouts |
| `bank-bootforge` (16 courses) | transform arrays/objects without mutation · sequence async work and handle rejection · an Express handler is validate → act → status · derive React state, do not duplicate it · lift state / reducer when two components need it · SQL join + group + filter in the right order · type a function boundary in TS first |
| `bank-jstrain` (01-29 + quizzes) | closure and `this` fluency under time · promise pool, retry with backoff, timeout with `AbortSignal` · reproduce the bug with a failing test before fixing · write the test that kills the mutant (boundaries, error path) · security hunts: injection, path traversal, prototype pollution · Node persistence: atomic write, parameterised SQL · pick the data structure for the operation mix |
| `bank-csharp` (csbootcamp 01-04, csdrills 01-10) | reconcile two sets by key (join / except), not nested loops · `Task.WhenAll`, cancellation and exception aggregation · `decimal` for money, name the rounding mode · store UTC, convert at the edge, DST gaps · `[Flags]` enums and bit tests · stable hashing and identifier normalisation · `Interlocked` / `lock` / concurrent collections: pick one invariant · ETag preconditions and CRUD endpoint status logic |
| `bank-java` (javabootcamp 01-21, javadrills 01-11) | collection behaviour contracts (ordering, nulls, views) · equality and ordering consistency in sets and maps · stream execution order and short-circuiting · collectors: `groupingBy`, downstream, merge function · `Optional` chains without `get()` · `BigDecimal`: `compareTo` vs `equals`, scale, rounding · `Instant`/`ZonedDateTime` arithmetic · `CompletableFuture` composition and timeouts · deterministic concurrency tests · the same bug in three languages (cross-language module) |
| `sysdrills` (18 modules; one idea per module, `siblings` = that module's drills) | DAU → QPS → storage envelope · hit ratio and pool sizing · availability in series vs parallel, retry budgets · tail latency grows with fan-out · selectivity decides whether an index helps · Little's law and Amdahl bound throughput · consistent hashing and shard skew · bytes per record, approximate counting · backlog and drain time · headroom and unit cost · quorum `R + W > N`, replication lag · RPO/RTO and failover cost · inverted index size and update lag · SLO, error budget, burn rate · a blocked event loop stalls every request · uniqueness with soft delete, lost updates · client cache staleness and invalidation · session and authz checks per request |
| `design-it` (DESIGN IT sets on `paths/sysdesign.json`) | the frame: requirements + numbers → entities/API → high level → deep dive → pre-mortem → trade-offs · state one envelope number before drawing · name the consistency need per data item · every retried write is idempotent · say what happens when each dependency is down · find the hot key / hot row · queues need backpressure and a dead-letter plan · tenant isolation in the data model · what is measured, what pages (SLO) · rollout and migration plan · every trade-off names what was given up |
| `agentic` (G2 → katas → G3, + new agent-engineering units) | a brief has goal, context, constraints, acceptance checks and stop conditions · verify, do not trust: checks the agent cannot edit · file ownership with no overlaps · load only the context the task needs · build an eval on recorded outputs before changing a prompt · tool output is data, never instructions (injection) · least privilege and egress limits for tools · tools are idempotent and return errors an agent can act on · the typical agent-PR failures: edited test, invented API, swallowed error, scope creep · independent review and a stop report |
| `review-katas` (G1, 52 + new) | review behaviour, not style · a finding = location + failing input + consequence + fix · look in the patched lines first · check that the test asserts the changed behaviour · the checklist: boundary, null, error path, concurrency, authz · order findings by severity · approve a clean PR (precision matters) |
| `campaign-<tag>` (study quests; 8 tag sections, not per repo: `idempotency`, `retries-timeouts`, `pagination`, `authz-tenancy`, `caching`, `validation-at-boundaries`, `queues-outbox`, `migrations-rollout`) | per tag, 5-8 ideas of the form "where the invariant is enforced, what breaks if it moves, the trade-off this repo chose", with `sources` = 3-6 non-archived campaign quests from different repos that show it. `recapAfter` here = any 3 sources passed. |
| `campaign-reading-code` | find the entry point · trace one request end to end · find where the invariant lives · find the seam · state the decision and its cost |

That is 24 side files and about 200 ideas. Per-section code: none.

## 3. New features and new content, ranked by skill gain per build hour
Restamp risk is "none" for every feature row: only free files (HANDOFF §3). Each stream proves it with
`restamp:all -- --dry-run` = N/N fresh, where N = 700 + the new packs that stream added.

### Features
| Rank | Feature | Size | Files | Acceptance |
|---|---|---|---|---|
| F1 | Key-ideas layer: store, concept cards, recap checkpoint, re-check, interleaved session, tag filter (§2.1 items 1-4) | M | new `store/keyideas.ts`, `engines/keyideas.ts`, `api/keyideas-service.ts`; `study-service.ts` (`reviewCardText`), `store/review-cards.ts`, `due-service.ts`; client `Review.tsx`, new `KeyIdeas.tsx`, `SectionRecap.tsx`; migration 023 | passing a source unit enrols exactly one card, due +1 d, 4/day cap; a removed idea retires its card; recap pays 20 XP once; recap/cards write no evidence row and no `practice_log` row; unknown key warns and the server starts |
| F2 | Spaced production: sibling redo cards and EB missed-key-point cards (§2.1 items 5-6) | M | new `engines/redo.ts`; `ladder-service.ts` (enrol hook only), `Player.tsx` (redo entry) | at most 1 redo/day; a redo run never writes evidence or XP beyond the card's review XP; max 3 `ebmiss` cards per attempt, `[w3]` first; grading a retired card is refused |
| F3 | FSRS enrol filter from `content/seed/card-tags.json` (repo-recall flashcards not enrolled) | S | `engines/study-quest.ts`, store reader | a tagged card is never enrolled; existing rows untouched |
| F4 | Pretest before the lesson + one merged "explanation + learn more" panel | S | `Fundamentals.tsx`, `StudyQuestPane.tsx`, `LearnMore.tsx` | pretest is skippable, unscored, shows no gate item; one panel after a graded item |
| F5 | DESIGN IT interview mode S (timer, blind, six framework headings, elapsed time stored) + dimension profile on Stats | M | `LadderPanes.tsx`, `ladder-service.ts`, `stats-service.ts`, `Stats.tsx`, new `store/design-side.ts`; migration 025 (`eb_attempt_meta`: mode, elapsed) | answer stored before any key point is shown; profile reads `headlines.json` dimensions; a set with no headlines still works |
| F6 | Error notebook: one line + category after a failed submit or missed key point; entry becomes a `'concept'` card `note:<id>` | S-M | new `api/notebook-service.ts`, `Player.tsx`, `Review.tsx`; migration 024 | optional, never blocks; 0 XP for writing; card front = the learner's own line |
| F7 | Weekly review page + `bootquest week` (time, passes, key ideas shaky, notebook top categories, 3-question reflection) | S | new `Week.tsx`, `api/week-service.ts`, `cli/`; migration 026 (`week_reflection`) | numbers equal direct SQL counts on a seeded fixture |
| F8 | Hard 20-card cap in Review for 10-minute mode (C deferred) | S | `Review.tsx` | cap holds across paging |
| F9 | Confidence tag on graded answers + calibration panel | S-M | migration 027, `Player.tsx`, `Stats.tsx` | stretch; skip if S3 runs long (then 027 stays unused) |
| F10 | Kata precision + approve/block on clean PRs | S-M | `ladder-service.ts`, `LadderPanes.tsx` | stretch (ruling 9); G1 pass rule for existing katas unchanged |

### Content (S2; all through authoring JSON and the seed CLIs; existing items byte-identical)
| Rank | Content | Size | Restamp risk | Acceptance |
|---|---|---|---|---|
| C1 | 24 key-idea side files (§2.2) | M | none (side files) | `seed:lint:keyideas` OK; every section has 5-12 ideas; sysdrills has 18 |
| C2 | `content/design/headlines.json` (87 DESIGN IT sets then 20 G2: <= 12-word headline, dimension, `repoSpecific`) and `estimates.json` (numbers only from the set itself) | M | none | every key point of every primary set has a headline that does not give the point away; dimensions from a fixed list of 8; counts verified by a script |
| C3 | Review `paths/sysdesign.json` by hand (ruling 7); `content/seed/card-tags.json` | S | none | each module's 1-2 sets use that module's maths; a list of changed mappings in the stop report |
| C4 | C# bug-hunt drills (one per single-drill topic, from the topic's named wrong solution); Java ones if the integrator dropped `rv-c-wip` | S | new drills in `fund-csharp`/`fund-java` packs only: those packs are re-validated and restamped, nothing else | `test:csharp`/`test:java` targeted run green; `FUNDAMENTALS_EXPECTED` re-counted |
| C5 | Agent engineering, part 1: 10 agent-PR katas + 4 tool-design katas (`tools/seed/authoring/katas`, `seed:patches`), 4 G2 sets (injection/egress, test tampering, orchestration, context budget) **only from pinned estate docs**, 6 context-budget quiz items via `seed:quests:drafts`; added to `paths/agentic.json` | M-L | new packs only (pins and census rise) | kata proofs pass (`kata-proof.ts`); every G2 key point cites a pinned file; `seed:pins` OK; a G2 with no pinned source is not written and is reported |
| C6 | sysdrills "pick the model" quizzes, 2 per module = 36 (`seed:quests:drafts`), on the sysdesign path after each module | M | new quest packs only | keyed answers pass both lints; no item restates a drill's formula hint |
| C7 | Senior Fundamentals topics, must: C# 21 testing, 22 HttpClient resilience, 23 authN/Z; Java 21 JUnit 5 + Mockito, 22 Spring Security basics, 23 Jackson contracts. Stretch: C# 24-26 (logging, background work, System.Text.Json), Java 24-26 (validation in depth, SLF4J/MDC, HTTP clients). Each: lesson, 10 items, 8 cards, 2 plain-language drills (D7: no framework runtime, JDK 17), `sections.json` checks, key ideas appended to `fund-cs-web` / `fund-java-spring` | L | `fund-csharp`/`fund-java` packs only | length-rank lint OK; each item tests behaviour, not version trivia; census and `ladder-real.test.ts` pins updated by counting |
| C8 | Agent engineering, part 2: eval lab (8 drill-js on recorded outputs). **Spike first (<= 1 h):** can the sysdrills importer (`tools/seed/src/sysdrills`, not under `factory/`) emit a second bank on track `agentic` with no bound-file edit? If yes, build it as bank `agentdrills`. If no, stop and report; do not touch `factory/`, `runners.ts` or `shared/src`. | M | must be new-pack only, else not built | fixtures committed; each grader is checked against hand labels at >= 90% precision and recall by its own tests |

Not in rv2: `repodrills`, kill-the-mutant, 8 classic DESIGN IT problems and CRUD primaries (need upstream docs: owner),
set-B expansion, worked-example fading, item-level quest cuts, anything in HANDOFF §7.

## 4. Streams
Max 2 at a time. Phase 1: **S1 + S2**. Phase 2 (after S1 is merged into `rv-wave` in the hub): **S3 + S2 (continuing)**.
Rules for all: branch from the integrated `rv-wave`; never `main`, never push; commit per task with `git commit -F`;
targeted tests only, `--maxWorkers=1`, foreground, Git Bash; kill leftover `node.exe` before stopping; client typecheck
is run by the orchestrator in the hub (clone `node_modules` lack CodeMirror); never write to the owner DB; stop report
per AGENTS.md. A file not listed for a stream is not that stream's to edit: ask the orchestrator.

### S1 `rv2-k`: key ideas + spaced production (clone `bq-f52-p`, migrations 023, 024)
Owns: `server/src/store/keyideas.ts`, `engines/keyideas.ts`, `engines/redo.ts`, `api/keyideas-service.ts`,
`api/notebook-service.ts` (all new); `store/review-cards.ts`, `api/due-service.ts`, `engines/study-quest.ts`,
`engines/fsrs.ts` (enrol helpers only), `api/study-service.ts` (`reviewCardText` and review routes only),
`api/ladder-service.ts` (one enrol hook after self-score; no scoring change), `api/app.ts`, `shared/src/api-ext.ts`,
the CLI review command only; client `pages/Review.tsx`, `pages/KeyIdeas.tsx`, `components/SectionRecap.tsx`,
`components/DueNow.tsx`, `pages/Dashboard.tsx` (one tile), `pages/Player.tsx` + `pages/Player/**` (redo entry, notebook
line), `App.tsx`, `client/src/api/{types,http,mock}.ts`; migrations `023_keyidea_checkpoint.sql`, `024_error_note.sql`;
its own new test files and fixtures under `server/test/fixtures/keyideas/`. Does not touch `content/**`.
1. Store + schema validation against the §2.1 format, with fixture files. *Check:* a bad file warns and is skipped; the server starts with no `content/keyideas/`.
2. Concept-card enrolment, card text, retire/restore, daily cap (F1). *Check:* F1 acceptance; ruling 6 test (no practice lock).
3. Review UI: key-idea cards, `mode=keyideas` interleaving, tag chip, 20-card cap (F8). *Check:* no two neighbours share a section when >= 2 sections are due.
4. Recap checkpoint + 14/45-day re-check + dashboard tile + `KeyIdeas.tsx` fold. *Check:* the API omits `answer` until the idea's sources are passed.
5. Redo cards and `ebmiss` cards (F2); enrol filter (F3). *Check:* F2/F3 acceptance.
6. Error notebook (F6). *Check:* F6 acceptance.
Tests: new `server/test/keyideas*.test.ts`, `redo.test.ts`, `notebook.test.ts`; existing `fsrs`, `study-quests`, `ladder`,
`db` (schema pin → 24), `streak`; client `review-paging`, `due-weak`, `dashboard`, `player`, new `keyideas.test.tsx`.
Root `npm run typecheck`. `restamp:all -- --dry-run` fresh.

### S2 `rv2-c`: content and side files (clone `bq-f52-c`, no migrations)
Owns: `content/**` (incl. `content/keyideas/**`, `content/design/**`, `content/paths/**`, `content/seed/card-tags.json`,
`content/fundamentals/**`, new packs), `tools/seed/authoring/**`, `tools/seed/src/ops/keyideas-lint*.ts` (new),
`tools/seed/src/fundamentals/source.ts` (census constant only), a spike-approved new importer dir for C8, root
`package.json` (script lines only), census/pin tests (`server/test/api/ladder-real.test.ts`, `packs.test.ts` pins,
`tools/seed` tests for its lint). Does not touch `server/src`, `client`, `shared/src`, `tools/seed/src/factory`.
Order: C1 (sysdrills, design-it, agentic, review-katas, fund-js-* first, since they are on the default day) → lint →
C2 → C3 → C4 → C5 → C6 → C7 must → C8 spike → C7 stretch. Commit per side-file group / per pack.
Inherits: the Java bug-hunt re-import if `rv-c-wip` was dropped; the sysdrills re-import/validate and remaining boundary
tests (02/06, 16/01, 15/05) if `rv-e1-wip` was dropped.
Tests after each pack: `seed:validate` chunked with `--course`, `seed:lint:leaks` (0), `seed:lint:answers` (OK),
`seed:lint:keyideas`, `seed:pins`, `npx vitest run --root tools/seed` (targeted files), `restamp:all -- --dry-run`,
`test:csharp` / `test:java` targeted for C4/C7. Report every count before → after, counted by script.

### S3 `rv2-f`: learning features on the senior path (clone `bq-f52-d`, migrations 025, 026, 027; starts after S1 merges)
Owns: client `pages/LadderPanes.tsx`, `pages/Fundamentals.tsx`, `pages/StudyQuestPane.tsx`, `pages/Stats.tsx`,
`components/StatsCharts.tsx`, `components/LearnMore.tsx`, new `pages/Week.tsx`; server `store/design-side.ts`,
`api/week-service.ts` (new), `api/stats-service.ts`, `api/fundamentals-service.ts`, `api/ladder-service.ts` (interview
meta, and F10 if reached); `cli/**` except the review command; and, because S1 is already merged, appended blocks in
`api/app.ts`, `shared/src/api-ext.ts`, `App.tsx`, `client/src/api/{types,http,mock}.ts`.
1. Pretest + merged explanation panel (F4). 2. Interview mode S + dimension profile (F5; reads S2's `headlines.json`,
must work when it is absent). 3. Weekly page + `bootquest week` (F7). 4. Stretch: F9, then F10. Checks: §3 acceptance.
Tests: `ladder`, `eb-weights`, `fundamentals`, `lesson-aids`, `study`, `stats` client suites; server `ladder`,
`ladder-sysdesign`, `stats`, `db` (schema pin), new `week.test.ts`, `interview.test.ts`; CLI unit tests. Typecheck. Dry-run restamp.

Merge order into `rv-wave`: S1 → S2 first slice (C1-C3, so the app has real key ideas) → S3 → S2 rest.

## 5. Review gate
**My adversarial review of the integrated branch** (read the diff, then probe a sandbox on a copied DB, ports 4390/5390):
1. Bound files: `git diff dc2206bc..rv-wave --stat` shows nothing under `server/src/runners`, `api/runners.ts`,
   `runner-*.ts`, `tools/seed/src/factory`, or the bound `shared/src` files. `restamp:all -- --dry-run` N/N fresh.
2. Honesty: no key-idea, recap, redo, pretest or notebook path writes `evidence`, a ladder leg, or unlocks a unit; none
   triggers the practice lock; XP is capped as specified (try to farm: rate again 20 times, replay a recap).
3. Leaks: a key idea's answer is invisible before its sources are passed (in the API response, not only the UI); the
   pretest shows no gate item; `ebmiss` fronts do not contain the key point; `seed:lint:keyideas` rejects an empty
   `sources` list.
4. Robustness: delete `content/keyideas/`, corrupt one file, archive a source unit, re-seed away an idea: the server
   starts, cards retire, no card is stuck due.
5. Flood: pass 10 units in one day on a fixture; new key-idea cards due per day <= 4, redo <= 1.
6. Content sample: 3 ideas per side file read against their sources (accurate, a real idea, the prompt needs thought);
   every new Fundamentals item and kata read in full; headlines checked on 10 sets; path mappings on all 18 modules.
7. Counts: every census number re-counted by my own script; existing items byte-identical (`git diff` on stamped
   packs shows additions only, apart from the fund packs that gained drills or topics).
8. Migrations 023-027 contiguous (no gap if F9 is skipped: then the last is 026), append-only, and they apply to a copy
   of the owner DB (schema 18 → latest) with 0 errors.
9. Live walk: default day → Fundamentals step → pass → card tomorrow (clock moved) → recap → interview mode → week page;
   390 px layout; no console errors.

**Battery (hub, sequential, one suite at a time, `--maxWorkers=2`, foreground):**
`npm run typecheck` → `npm run typecheck -w @bootquest/client` → client suite → from `server/`: `npx vitest run
--maxWorkers=2` → `npx vitest run --config vitest.selfrun.config.ts --maxWorkers=2` → `npx vitest run --root tools/seed`
→ `seed:lint:leaks` → `seed:lint:answers` → `seed:lint:keyideas` → `seed:pins` → `restamp:all -- --dry-run` → `smoke:api`
→ `demo:promotion` → `seed:demo:planted` → `seed:campaign -- --check` → `test:csharp` → `test:java` (JDK 17).
The known environmental failures on this machine (C# warm-run benchmark, CLI e2e "server did not start in 90s") are
re-run once on a quiet machine and reported as such, never waved through silently. Then docs: AGENTS.md restamp line
(HANDOFF §3 list) + `seed:lint:keyideas` in the gates, SEEDING §3/§8, `rv2/REPORT.md`, `elihandoff/README.md`.

## 6. Owner decisions still open (my default applies until overruled)
| # | Decision | Default |
|---|---|---|
| O1 | Land `rv-wave` (with the f52 and fund waves) on `main` | Land after the rv2 battery is green; one merge, by the owner or on the owner's word. Agents never do it. |
| O2 | Usage gate for further content waves | Adopt 100 graded attempts over 14 distinct days, starting after rv2. rv2 is the last content before it. |
| O3 | Freeze rule "byte-identical after landing" → "frozen at first attempt in the owner DB" | Adopt: it protects real history and keeps unused items fixable. |
| O4 | Primary language for 90 days | JS (D3); the C#/Java topics from C7 stay one setting away. |
| O5 | Item-level quest cuts by re-seed | Not now (ruling 4); revisit with usage data. |
| O6 | Archive scale | Stay at 879 (ruling 5). |
| O7 | R4-24 per-track act gating (breaks `demo:campaign`) | Leave as is. |
| O8 | Java 21, real-framework C# drills (planned restamp bundle) | No this round (D7). |
| O9 | Upstream source docs for the 8 classic design problems and CRUD primaries | Owner writes or approves them upstream first; a later wave seeds them. |
| O10 | Recap XP (20 once per section) and key-idea cards counting toward the reviews slot | Yes to both. |
| O11 | `bootquest sync` on signalpost so a competency can be promoted | Owner runs it once after landing. |
