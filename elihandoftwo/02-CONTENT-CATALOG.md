# 02 · Content catalog (high level, 2026-11-01)

Counted on `main` b3815126 with `bootquest-handoff/tools/census.mjs`, the `content/` files and the server's boot
log on a copy of the owner DB. "Live" = loaded, non-retired units in the owner DB.

## 1. Totals by track (live units)

| Track | Units | Main sources |
|---|---|---|
| js (JS/TS + React) | 4,231 | bootforge (16 courses, 2,569), jstrain (50 modules incl. 8 TS and 15 quiz sets, 1,308), quest packs, EBs |
| csharp (C#/.NET) | 282 | csdrills 72, jstrain-cs 81, csbootcamp 31, quest packs, EBs |
| java | 272 | javabootcamp 168, javadrills 80, quest packs, EBs |
| sysdesign | 216 | sysdrills 129, DESIGN IT explain-backs 87 |
| agentic | 75 | G2 delegation briefs 20, patch katas 52, G3/G4 projects 2, 1 retest |
| **total** | **5,076** | |

By kind: drill 3,239 (graded by drill-js 1,952 · self-run 855 · drill-java 248 · drill-cs 184) · quiz 544 · predict-output 508 · explain-back 244 · study 207 · written 147 · reading 132 ·
patch-kata 52 · retest 1 · repo-task 1 · guided-project 1.

## 2. Drill banks (runnable code, canonical tests)

| Bank | Size | Topics |
|---|---|---|
| bootforge (js) | 2,569 units / 16 courses | js-fundamentals, functions-deep, arrays-objects, async-js, errors-modules, ts-basics, ts-apps, node-core, http-rest, express-api, sql-data, react-fundamentals, react-state, react-ts, fullstack-crud, engineering-practice |
| jstrain (js) | 1,308 / 50 modules | language core → async mastery → data structures/algorithms → Node CLI/async/HTTP/persistence → testing → debug hunts, security hunts, SQL, API consumer, write-the-test; 15 quiz sets; 8 TypeScript modules |
| jstrain-cs (C#) | 81 | language core, LINQ, records, generics, nullability, async, pattern matching, JSON, validation, auth, caching, testing web apps, SQL, HttpClient resilience, write-the-test |
| csbootcamp (C#) | 31 | language core, delegates, collections/LINQ, strings/time |
| csdrills (C#, authored) | 72 / 10 modules | LINQ set reconciliation, async composition, flags, money, time, text, hashing/ids, service data structures, thread safety, CRUD endpoint logic |
| javabootcamp (Java) | 168 / 21 modules | language → collections/streams → records/sealed types → money/validation, domain rules, caching, rate limits, partitioning, messaging, storage consistency, concurrency, parsing, debugging, design patterns |
| javadrills (Java, authored) | 80 / 11 modules | collections, equality/ordering, streams, collectors, Optional, strings, exceptions, money, time zones, CompletableFuture, cross-language bugs |
| sysdrills (sysdesign, authored) | 129 / 18 modules | estimation, caching/pools, reliability math, latency, SQL/indexing, concurrency/throughput, sharding, encoding, queues/backlog, capacity/cost, replication, multi-region, search, observability, Node runtime, data access/integrity, client data layer, web authz/sessions |

sysdrills are numeric "compute the answer" functions in JS with trap tests (e.g. 65,535 bind-parameter cap,
keep-alive timeouts, optimistic-lock retry cost), not build tasks.

## 3. Quest packs (study quests: quiz gate + flashcards + reading + notes)

- **204 quest packs**, each with a "Learn more" **notes pack** (204). By app track: js 144 (143 campaign + the
  standalone ww6), csharp 48, java 12 (the census tool's language guess says js/ts 143, cs 44, java 12, docs 4,
  py 1).
- Depth: 27 packs have a hand-written layer of ≥ 20 quizzes; 48 have 13-19; 122 have 1-12; 7 are generator-only.
- Campaign: JS 5 acts (Foundations, Building, Products & teams, Flagship courses, Mastery; 259 steps), C# 5 acts
  (67), Java 3 acts (Foundations, Money & validation, Domain rules & consistency; 12). JS's 259 include 3
  content-pending study steps with no pack (Opusboot1, perch, skillforgejs).

## 4. Explain-backs (answer-first, self-scored against key points)

**244 packs over 162 repos**:

| Family | Count | What it asks |
|---|---|---|
| Classic (per repo concept docs) | 132 primaries + 5 set-B | explain how a repo's design works, cited to the code |
| G2 delegation briefs | 20 (cs 6, js/ts 13, java 1) | write the brief you would hand an agent for a task |
| DESIGN IT (system design rubrics) | 50 primaries + 33 set-B + 4 set-C = 87 over 39 repos | design a feature at scale for a real repo; weighted `[wN]` key points, `[senior]` prompts, blind mode |

136 sets are weighted. 17 DESIGN IT primaries have no alternate set yet. 55 checked-out repos have no explain-back
(43 js/ts, 12 cs).

## 5. Other content

- **Patch katas**: 31 kata specs / 52 kata units (seeded defects in diffs), feeding the G1 code-review gate.
- **Variants**: 5 (changed-example retest sources, all drill-js: agentic G4, signalpost U01-U03 — live only after a
  `bootquest sync` — and the test-only http-tasks-api fixture, which never reaches the owner DB).
- **Written** (147): 141 jstrain quiz-set items (interview-verbal, SQL, TypeScript, …) + 6 bootforge
  engineering-practice briefs (incl. 2 project briefs, 2 incident investigations, 2 PR reviews), self-assessed.
- **signalpost-swe-bootcamp curriculum** (synced, not seeded): a staged "grow as an engineer" program U01-U12
  (task API, SQL/integrity/migrations, React forms, permissions, review, performance, retry safety, design under
  change, ownership). Only U01-U03 have checks; U04-U12 sync as `study`. Not yet synced on the owner DB.
- **Agentic**: G3 live delegation (brief → Claude Code → PR you reviewed), G4 verification engineering.

## 6. Coverage map vs a senior CRUD web-app engineer (by title/module; not item-level)

Legend: ●● strong · ● present · ○ thin · — absent. "Mode" says how the skill is exercised.

| Skill area | Coverage | Mode today | Where |
|---|---|---|---|
| Language fluency JS/TS | ●● | build (drills) | bootforge, jstrain |
| Language fluency C# / Java | ● | build (drills) | jstrain-cs, csdrills, javabootcamp, javadrills |
| HTTP/REST + Express APIs | ● | build (small) | bootforge http-rest, express-api; jstrain node-http |
| SQL + indexing | ● | build (small) + estimate | bootforge sql-data, jstrain SQL, sysdrills 05 |
| Data modeling & schema evolution | ○ | build (small) + estimate + explain | bootforge fullstack-crud / engineering-practice / sql-data migration drills, jstrain 19/27, sysdrills 16, DESIGN IT zero-downtime set-C |
| Transactions & concurrency in a CRUD app | ● | build (small) + estimate + explain | bootforge fullstack-crud (withTransaction, optimistic concurrency), jstrain 19/27, javabootcamp 13/17, csdrills 09, sysdrills 16; sysdrills 19 planned |
| AuthN/AuthZ, sessions, multi-tenancy | ● | build (small) + estimate + explain | bootforge fullstack-crud (~12 token/hash/session drills), express-api guards, jstrain 26 IDOR/CSRF hunts, jstrain-cs 19, sysdrills 18, DESIGN IT rbac / auth-session |
| Web security (OWASP) | ○ | build (hunts) | jstrain 26-security-hunts |
| React + client data layer | ● | build (small) + explain | bootforge react-*, sysdrills 17, ww7/ww10/ww43/ww45 quiz layers |
| Testing strategy | ○ | build (write-the-test) | jstrain 20/29, jstrain-cs 21/29; G4 |
| Debugging | ● | build (hunts) | jstrain 24, jstrain-cs 24, javabootcamp 19/21 |
| Code review | ● | kata + written | 52 patch katas, jstrain quiz-09 spot-the-bug, 2 bootforge PR reviews |
| Reading unfamiliar code | ●● | quiz + explain | 204 quest packs, 132 classic EBs |
| System design at scale | ●● | explain + estimate | 87 DESIGN IT sets, 129 sysdrills |
| Observability & incidents | ○ | estimate + explain + written | sysdrills 14, 2 bootforge incident investigations |
| Background jobs, queues, webhooks, email | ○ | estimate + explain | sysdrills 09, DESIGN IT webhooks / durable jobs |
| Release engineering (CI/CD, flags, rollback) | ○ | explain | scattered DESIGN IT |
| Performance (N+1, caching, query plans) | ● | estimate | sysdrills 02/05/13 |
| Building a full feature end to end | ○ | build (small) + written briefs | bootforge fullstack-crud drills, 2 bootforge project briefs (self-assessed), signalpost U01-U03 after a sync; no graded multi-file feature |
| Writing: design docs, ADRs, PR descriptions | ○ | explain | G2 briefs, explain-backs |
| Estimation & scoping of product work | — | — | (sysdrills estimate capacity, not effort) |
| Forms UX / accessibility / i18n | ● / ○ / — | build (small) | ~40 form-validation drills (bootforge react-*); 52 items mention accessibility; i18n essentially absent |
| Leading: mentoring, reviews of others, incident command | — | — | |
| AI-assisted engineering | ● | build + review | agentic G2/G3/G4 |
