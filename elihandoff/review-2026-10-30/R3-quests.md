# R3 — Quest packs review (quizzes, flashcards, Learn-more notes, code legs)

Read-only review of `content/seed/quests/*` (204 packs), `content/seed/notes/*` (204), `content/campaign/*.json`,
`content/packs/*` and the campaign/ladder code in `server/src`. All counts below were produced by scripts in
`scratchpad/rv/` (`dist.py`, `newitems.py`, `topics.py`, `compact.py`) and re-counted; every file:line claim was read
at the pinned checkout under `.cache/checkouts/`. Nothing in the repo was edited.

"Old" = items present in a pack's first commit (2026-10-08..16). "New" = items added to a pack after that
(growth 10-19, spaced-repetition 10-20/21, mx 10-25/26, qw/cw 10-30), detected by diffing item keys between the first
commit of each `items.json` and HEAD (`newitems.json`): 47 packs touched, 363 new hand quizzes, 180 new flashcards.

---

## 1. Distribution

### 1.1 Totals

| kind | count |
|---|---|
| quest packs | 204 (every one has a notes pack) |
| hand (`concept`) quizzes | 2,776 |
| generator quizzes (`goal-check` 195 + `finding-location` 47) | 242, in 31 packs |
| flashcards hand-authored / generator (`numbered`, `f-table`) | 910 / 28 |
| reading steps | 3,776 |
| notes (before + after) | 3,660 |

### 1.2 Per track and act (packs = quest packs whose repo is a study quest in that act)

| track/act | packs | hand quizzes | gen quizzes | hand fc | gen fc | reading steps | notes |
|---|---|---|---|---|---|---|---|
| js/1 Foundations | 15 | 191 | 9 | 61 | 0 | 279 | 245 |
| js/2 Building | 22 | 286 | 25 | 99 | 10 | 343 | 379 |
| js/3 Products & teams | 44 | 549 | 68 | 169 | 5 | 660 | 751 |
| js/4 Flagship courses | 35 (+2 pending) | 537 | 26 | 191 | 2 | 758 | 677 |
| js/5 Mastery | 27 (+1 pending) | 359 | 0 | 110 | 0 | 483 | 442 |
| csharp/1 Foundations | 5 | 27 | 41 | 10 | 0 | 130 | 83 |
| csharp/2 First APIs | 4 | 20 | 25 | 6 | 0 | 91 | 57 |
| csharp/3 Real services | 15 | 259 | 7 | 85 | 0 | 382 | 315 |
| csharp/4 Flagship | 19 | 314 | 2 | 105 | 0 | 340 | 381 |
| csharp/5 Mastery | 5 | 48 | 21 | 16 | 0 | 135 | 84 |
| java/1 | 4 | 48 | 0 | 12 | 0 | 77 | 60 |
| java/2 | 4 | 68 | 0 | 20 | 0 | 46 | 81 |
| java/3 | 4 | 70 | 0 | 26 | 0 | 49 | 84 |
| (ww6, not a campaign quest) | 1 | 0 | 18 | 0 | 11 | 3 | 21 |

Read: JS owns 69% of hand quizzes (1,922), C# 24% (668), Java 7% (186). C# acts 1-2 together have 47 hand quizzes and
16 flashcards across 9 packs; 5 of those 9 packs are generator-only (0 hand quizzes, 0 flashcards).

Hand-quiz histogram per pack: 0 (7 packs), 10 (5), 11 (15), 12 (102), 13 (35), 14 (12), 17-24 (10), 26-31 (18).
129 packs have <= 12 hand quizzes (the handoff says 122; 7 of the 129 are the generator-only packs). 107 packs have
<= 12 quizzes of any kind.

### 1.3 The 20 thinnest packs (by quizzes, then flashcards)

| pack | track/act | quizzes hand+gen | fc hand+gen | reading | notes | pack first commit |
|---|---|---|---|---|---|---|
| organized-dotnet-pastebin | csharp/2 | 10+0 | 3+0 | 20 | 13 | 2026-10-14 |
| organized-js-training-jstrain2.3 | js/2 | 10+0 | 3+0 | 20 | 13 | 10-14 |
| organized-js-training-jstrain2 | js/2 | 10+0 | 3+0 | 21 | 13 | 10-14 |
| unionboot | js/2 | 10+0 | 3+0 | 21 | 13 | 10-14 |
| organized-dotnet-trello | csharp/2 | 10+0 | 3+0 | 24 | 13 | 10-14 |
| lucasrouter | js/3 | 11+0 | 3+0 | 4 | 14 | 10-14 |
| fableopusrecallv2 | js/3 | 11+0 | 3+0 | 5 | 14 | 10-14 |
| organized-js-training-react | js/2 | 11+0 | 3+0 | 5 | 14 | 10-08 |
| ship-it | js/1 | 11+0 | 3+0 | 6 | 14 | 10-08 |
| elihyper2 | js/3 | 11+0 | 3+0 | 7 | 14 | 10-14 |
| grokjs-grokbuildjs | js/2 | 11+0 | 3+0 | 7 | 14 | 10-14 |
| organized-app-job-track | js/2 | 11+0 | 3+0 | 10 | 14 | 10-14 |
| 3buildagentteachgem | js/3 | 11+0 | 3+0 | 11 | 14 | 10-14 |
| andie | js/2 | 11+0 | 3+0 | 12 | 14 | 10-14 |
| bootlocalopusv2 | js/3 | 11+0 | 3+0 | 12 | 14 | 10-14 |
| organized-js-training-jstrain3 | js/2 | 11+0 | 3+0 | 15 | 14 | 10-14 |
| organized-build-crmpyjs | js/3 | 11+0 | 3+0 | 18 | 14 | 10-14 |
| 3buildanalytics | js/3 | 11+0 | 3+0 | 19 | 14 | 10-14 |
| organized-app-grouphelpdesk | js/3 | 11+0 | 3+0 | 25 | 14 | 10-14 |
| organized-js-training-jstrain2.2 | js/2 | 11+0 | 3+0 | 26 | 14 | 10-14 |

Also thin in a different way (generator-only, 0 flashcards, 0 hand quizzes): nettrello (csharp/2, 12 gen), borrowbox
(csharp/1, 12 gen), csbootcamp (csharp/1, 17 gen), csharp-tut (csharp/1, 12 gen), dotnet-snapshot (csharp/2, 13 gen),
csharp-interview (csharp/5, 21 gen), ww6 (18 gen).

### 1.4 The 10 richest packs

| pack | track/act | quizzes hand+gen | fc | reading | notes | layers |
|---|---|---|---|---|---|---|
| w22 | js/3 | 26+6 | 11 | 19 | 36 | doctrine 10-21 |
| atlas-swe-bootcamp | csharp/4 | 31+0 | 12 | 24 | 35 | fundamentals 10-21 |
| organized-experiment-idempotent-payments-lab | js/4 | 24+7 | 10 | 27 | 35 | fundamentals 10-21 |
| jsprojectlearn | js/2 | 30+0 | 16 | 29 | 34 | sysdesign 10-20 |
| harbor-swe-bootcamp | csharp/3 | 30+0 | 11 | 29 | 34 | fundamentals 10-21 |
| dotnet-stripe | csharp/4 | 29+0 | 11 | 7 | 33 | doctrine 10-21 |
| organized-experiment-ww45 | js/3 | 21+8 | 7 | 12 | 33 | cw 10-30 |
| jsdrillv2 | js/2 | 28+0 | 12 | 12 | 32 | batch 3 10-25 |
| relay-app | csharp/3 | 28+0 | 11 | 23 | 32 | batch 3 10-25 |
| bazaar | js/5 | 28+0 | 11 | 22 | 32 | doctrine 10-21 |

(zz8, meterforge-upskilling, tracer, pulse, dotnet-auth, netcalendy, j2 follow at 26-28.)

### 1.5 Items vs. importance (keyword scan of quiz + flashcard text, `topics.py`)

Strong (hundreds of items, 100+ packs): SQL/Postgres (765 items / 173 packs), async/concurrency/queues (1,040 / 185),
authorization/RBAC/tenant (613 / 153), HTTP status semantics + idempotency (594 / 146), auth/sessions/JWT (442 / 135),
pagination/search (336 / 146), ORM (294 / 98, Prisma + EF Core).

Thin relative to the owner's goal (CRUD web apps in JS/TS+React, C#/.NET, Java): React hooks pitfalls (useEffect 3
items, useMemo/useCallback 3, StrictMode 4, re-render 10), TanStack Query 33 / 16 packs, zustand 7, redux 0,
react-hook-form 2, Testing Library 17 / 6 packs, Playwright 6 / 5, Vitest-specific ~0, Testcontainers 5, xUnit 6,
JUnit 2, Fastify 1, Express 31 / 20, Docker 4, GitHub Actions/CI 23 / 12, OpenTelemetry/trace ids 21, Cache-Control 2,
ETag/304 23 / 16, CSRF 11, XSS 10, SSRF 4, ASP.NET minimal APIs 5, MediatR 10, FluentValidation 6, ASP.NET Core
Identity 0, Spring/JPA/Spring Security 1 (a passing mention in masterumami), git workflow 5, profiling/flame graphs 1.

Over-represented vs. importance: the `organized-experiment-*` repos' audit/idempotency/queue material (temporal-lite,
payments-lab, support-hub) and the `master*` clone studies each carry 20-30 items on outbox/queue/lock topics that the
sysdrills bank (129 units) and 87 DESIGN IT sets also own.

---

## 2. Quality findings

Sample read in full (prompt, every choice, explanation, after-note): storefront 12q/3fc, lucasrouter 11/3, nettrello
12/0, organized-dotnet-pastebin 10/3, ww7 (cw) 8 new q / 3 new fc, netcalendy (qw) 11/6, j2 (qw) 11/6 = 75 quizzes,
24 flashcards, 24 before-notes, ~60 after-notes. Sample read as prompt + key + distractors (no explanation):
dotnet-auth 14q/7fc, tracer 13/7, openstatus 10/5, zz8 16/7, relay-app 14/7, jsprojectlearn 18/12, j3 13/3, devdeck
19/4, grok-js 14/4, organized-study-cal-com 13/3, netgum 12/4 = 156 quizzes, 63 flashcards. 18 packs, 231 quizzes,
87 flashcards. ~55 cited claims checked at the pinned sha; all of the following were correct:

storefront `server/services/catalog.ts:1` (`import "server-only"`), `:63` (`priceVaries = new Set(...).size > 1`),
`:66` (`find(isPrimary) ?? images[0] ?? null`), `test/fitness/no-float-money.test.ts:20` (`SCAN_DIR = join(ROOT,
"server")`), `lib/money.ts:19,28-31,74`; lucasrouter `src/lib/deliveryValidation.ts:4,17-21,39-43`,
`src/store/useAppStore.ts:942,946`; nettrello `Board.cs:89-90,104`, `BoardColumn.cs:53-55`, `BoardEndpoints.cs:46-51`,
`BoardService.cs:77-79,112`, `BoardDtos.cs:65-67,120,125-128`, `InMemoryBoardRepository.cs:45,77-78`,
`ExceptionHandlingMiddleware.cs:31-34`; ww7 `workflow-repository.ts:170-183` (no scope), `workflow-run-repository.ts:
93-109` (no `take`), `schema.prisma:160` (`onDelete: Restrict`), `workflow-builder.tsx:79-101,149-159`,
`use-workflow.ts:14-20`, `app-providers.tsx:8-17`, `workflow-monitoring-service.ts:22-31,40`, `ingest/route.ts:6-10`;
netcalendy `BookingsController.cs:20` (`[AllowAnonymous]`), no `AddRateLimiter` in `Program.cs`,
`02-data-model-and-persistence.md:101`, `06-architecture-critique.md:73-77`,
`GetAvailableSlotsHandler.cs:31,40`; j2 `App.java:78,180,194`, `Values.java:11-14`, `LibraryManager.java:44`,
`08-TRANSLATION.md:8-12`; pastebin `PasteStore.cs:110,141-144,158-162,199-205,236-249`, `Program.cs:39-42,90-94`;
cal-com `slots/util.ts:79,134` (`parseInt(... ) || 2000`), `webhooks/lib/sendPayload.ts:299` (`"no-secret-provided"`);
masteropen `alerting.ts:89-90,117`.

### 2.1 WRONG (factual, or a content rule broken)

| # | pack / item | evidence | suggested fix |
|---|---|---|---|
| W1 | masteroutline-outline flashcard `b8ab1a9d` vs quiz `a422c4e0` | The card back reads "... ORDER BY createdAt, FOR UPDATE SKIP LOCKED; enqueue each ..." and the quiz key is exactly `FOR UPDATE SKIP LOCKED` ("Two cron pods run the outbox relay at the same moment. Which clause ... stops them from claiming the same rows?"). Same pack, so the card is enrolled into FSRS on the first pass and then answers the gate item on every retake. `seed:lint:leaks` is note/EB-oriented and missed it (my scan found it as the only verbatim fc->quiz key leak estate-wide). | Reword the back to name the mechanism without the clause ("a row-locking select that lets a second worker skip rows already claimed") or drop the clause from the card. Frozen pre-mx item: owner decision. |
| W2 | netcalendy quiz `298d7218` (frozen, already in the handoff list) | Key "An empty successful list, returned before bookings are read" is true of `GetAvailableSlotsHandler.cs:31` (`if (schedule is null) return Result.Success(...[])`, before `ListByHostAsync` at :40). But the same pack's new after-note `x-q27` (qw, 10-30) now states that in the pinned code available-slots answers 500 before the handler reaches that line (`ScheduleRepository` `Include("_rules")` on an owned collection mapped as `Rules`). The pack contradicts itself: one item asks what the endpoint returns, a newer note says it never gets there. | Re-scope the stem to "In `GetAvailableSlotsHandler` alone ..." when the owner allows a re-seed; until then add the caveat to the before-note `r03-what-is-not-fixed`. |
| W3 | masteropen quiz `74848a10` (frozen, in the handoff list) | Key and the `> limit` reasoning are right (`alerting.ts:117` `if ((smsSent[0]?.count ?? 0) > data.limits["sms-limit"])`); the window is `setMonth(getMonth() - 1)` (`:89-90`), so the explanation's time arithmetic wording is the only defect, as the handoff says. | Explanation-only fix; low impact. |
| W4 | react pack: 7 two-choice finding-location quizzes `ca4bcd97`, `38233cce`, `5d65946c`, `57c85f95`, `49a8df69`, ... | "Which location holds this defect? Shadowed parameter." -> `store.js:64` vs `main.js:10`; explanation: "the guide records this defect at this location". A coin flip in an 80% gate, and `main.js:23`/`store.js:5` are the key of one item and the distractor of the next. Estate-wide 22 quizzes have exactly 2 choices: react 7, organized-study-support-desk-crm 6, relay-upskilling 3, gitjira 2, nethris 2, recipegen-app 2 (all generator `finding-location`/`goal-check`: 7 + 15). | A minimum of 3 choices in `quests/validate.ts` (factory change, restamp) or re-seed those 6 packs with `--exclude` of the finding list and hand items instead. |
| W5 | nettrello `687466e7` + `c8920198` | Both test review finding A with identical cites (`BoardEndpoints.cs:48-51`, `BoardService.cs:112`); the HTTP-side key is the service-side distractor set and vice versa. Also `bcf92917`/`fe118b82`/`dde7402b` have 3 choices. | Keep one; replace the other with a behaviour question ("a client sends `X-Board-Version: abc` ..."). |

### 2.2 WEAK (ranked by how much of the estate it touches)

**K1. The new layers drifted from "predict the system" to "recall the document".** Stems that ask what a
guide/ADR/critique/table says: 55 of 2,413 pre-mx hand quizzes (2.3%) vs 66 of 363 items added since 10-19 (18.2%).
By pack (new items only): netcalendy qw 10/11 ("Per the persistence guide's safe schema change checklist, how should a
column be removed" `42a452a6`; "What does the critique say that catches, which mock-based tests miss?" `e89ab3ac`;
"How does the upskill guide describe that overlap?" `ea6f56be`), j2 qw 7/11 (five "How does the translation table
express/carry/model ..." items `2477bba7 2a3728d3 552d5ca1 d287d2cd ea36ab6f` all sourced from
`08-TRANSLATION.md:5-12`), tracer batch-3 9/13 ("ADR-0002's Revisit line says 'never'. What reason does it give?"
`ec317fd1`; "What trigger does it name for adopting a library?" key "...past ~200 lines" `6a89fce5`; `2a003d5f`,
`aef7c578`, `b237734a`, `dc57301b`, `e873bbde`, `fda20aec`), openstatus fundamentals 10/10 ("According to the lab's
test map, what does the `withTestTransaction` helper do" `815143d9`; "Which caller kinds do they model? User, API key,
MCP, Slack and system-job" `5e93d4c5`; "what does the test pass to `expectAuditRow`" `046a8d97`), dotnet-auth
fundamentals ~9/14 are "Per finding Fn / per doc 07" but at least scenario-shaped. Old packs are not immune:
lucasrouter 5/11 ("What does the guide tell you to do?" `63b9f36b`, "Where does the guide send you first?" `ea04d8eb`,
"stated purpose" `d71cba08`, "documented limits" `7e1d6a05`).
The contrast is in the same waves: ww7 (cw) 8/8 new quizzes are code-truth scenarios with probes (Q `764617b2` event
fan-out ignores scope, `8b5036cd` no `take`, `d1a4b370` Restrict FK -> 500, `b644e2f5` useEffect form sync), zz8
batch-3 16/16 (`fbead252` "delete the tenantId filter ... which existing test fails? Not one"), relay-app 14/14,
pastebin 10/10, j3 13/13, storefront 12/12.
Fix: keep the doc as evidence, make the stem a situation. netcalendy `c7210b5f` is one word away ("A handler changes
one property and calls `repository.Update(aggregate)`. Which columns does the UPDATE write?" - drop "per the guide");
j2 `2a3728d3` -> "You import 1,200 loans whose Java ids start at 0 into a table with an identity PK; loans reference
book ids. What keeps the references valid?"; openstatus `815143d9` -> "A service test inserts a page and the next test
in the file reads it back and finds nothing. Which helper explains that?".

**K2. Flashcards are turning into readings and tables.** New-layer backs: median 54 words, 57/180 (32%) over 60
words; pre-mx: median 35, 14/758 (1.8%). FSRS self-grading on a 90-word list is noise and the card never becomes
"easy". Examples: dotnet-auth `2d90f717` ("which findings did each review pass catch? Trust boundary: F1, F2, F8, F17.
Asset: F7, F9. State machine: F3, F4, F5, F11, F15 ..."), `7209d710` (ms costs of RSA/SHA/indexed lookups),
netcalendy `7b902111` (every bookings column + three indexes), `d1a8e2f3` ("five confirmed strongest architecture
choices"), `2eedb01e`/`4a1983e8` (checklists), j2 `098985ee` ("goal of each of exercises 0 to 4"), `2989efe7`,
`345b5c17`, `ef2b5697` (review-checklist contents), zz8 `351befb5` (5-session role table), `b6577d46` (route gates per
API family), `f91b1577` ("How zz8's docs checked the code without installed dependencies" - meta), tracer `57fce49e`
("Tracer v2 ideas from the retrospective"), `fc1e07ee` ("five-phase course arc"), `3398d356` ("flaw ledger"),
lucasrouter `00719c15` (pnpm check order), relay-app `74083eb6` (why Microsoft.OpenApi was removed).
Fix: one fact per card, <= 40-word back, a situation on the front (grok-js `4ce788d2` "`settings.pageSize || 10` and a
user saved 0 - what does the app use?" and jsprojectlearn's "what is wrong?" cards are the right shape); split tables
into N cards or drop them.

**K3. Generator items are comprehension, not prediction (242 quizzes / 31 packs; the only quizzes in 7 packs).**
`goal-check` = "Which check verifies this goal?" with the other exercises' Checks as distractors: devdeck's 7
goal-checks share 6 Check paragraphs of 60-120 words (`2f6502ec`, `cb4ba2df`, `eab8c1ed`), so after three answers the
rest are elimination; `ce8ed020` ("write a one-page note") is keyed by "a reviewer can answer from your note alone".
`finding-location` = "which file:line" (nettrello 7 of 12: `33265a7c 687466e7 89b2aced bcf92917 c8920198 dde7402b
fe118b82`). Five of the seven generator-only packs are the C# act 1-2 anchors (borrowbox, csbootcamp, csharp-tut,
nettrello, dotnet-snapshot), which therefore also enrol **zero** FSRS cards. Fix: see P8.

**K4. jsprojectlearn sysdesign layer (18 quizzes, source `system-design-lite.json`) is a textbook with soft
distractors.** Not about the repo's code; several distractors are not defensible: "Take the site offline for five
minutes" (`ad8856ff`), "Give every object a public URL so that users can clean up their own abandoned files"
(`7be13031`), "Delete it silently on the first failure" (`954ce759`), "Sticky sessions, so slow users stay on one
server only" (`6f9f1dd7`), "Raise max_connections to 2,000" (`ae91517b`); `9ec10fed` is a definition
(cache-aside vs write-through). The cw notes say ~20 such topics were dropped from sysdrills "as already owned" -
idempotency keys, outbox, cache stampede, N+1 are owned by sysdrills and DESIGN IT already. The 12 "what is wrong?"
flashcards in the same layer are good. Fix: tighten distractors to two defensible options each, or retire the quiz
half and keep the cards.

**K5. Trivia about the course artefact rather than the system.** netgum `e790016d` (the original catch block "used
Python `from ex` syntax, so the solution did not compile"), tracer fc `237a970e` (ADR says ~80 lines, file is 48),
zz8 fc `f91b1577` (how the docs were produced), openstatus fc `3b879e30` (what the "Illustrative fake code" label
means), tracer `6a89fce5` (~200-line threshold), cal-com `0570af08` (literal `no-secret-provided`; code-true but a
string), lucasrouter `e0b16db3` (why a literal became `PHOTO_BUDGET_BYTES - 40`; fine, but low value).

**K6. Ambiguity (two defensible answers unless the stem leans on "what the doc says").** netcalendy `e89ab3ac`:
distractor "Race conditions, deadlocks, lock waits and isolation-level anomalies" is also something a real-Postgres
test catches; jsprojectlearn `7be13031`: a monthly job deleting objects older than 30 days is a legitimate orphan
cleanup; dotnet-auth `6a1534cc` ("at the layer where the bug lived" vs "at every layer it crossed") is a doctrine
preference; nettrello `e73c813e` 3 choices, the key is the most specific; storefront `2f4861e7` key "needless hop" vs
distractor "bypasses authentication" - fine but the explanation concedes authorization "belongs in the service".

**K7. Explanations that duplicate the after-note.** ww7 `88d89c00`, `9e4be48d`, `d1a4b370` explanations run 120-180
words and the after-note repeats them nearly verbatim; the explanation is the review-card back. Trim explanations to
the deciding fact and leave the walk-through to the note.

### 2.3 NIT

- N1 lucasrouter after-notes open with "**Key: ...**" bold; other packs do not. Cosmetic inconsistency.
- N2 netcalendy after-note `x-q27` appends an unrelated upstream finding (`Include("_rules")` 500) to an after-note; it
  belongs in a before-note or §8.
- N3 organized-experiment-ww10 `bba3125e` / `04a2a6bd` stems are 75% identical (CREDIT_PULL providerSequence pairs)
  with different keys - a deliberate pair, but the second reads as a re-ask.
- N4 j2 `4034fc76` rests on "a scratch probe on EF Core 10.0.12 with SQLite" and cites only `08-TRANSLATION.md`; the
  Java repo has no C# code, so the quiz is about hypothetical code. Good question, odd home.
- N5 storefront `5e93c720` cites only `docs/concepts/optimistic-ui.md`; the scenario (no `onError`) is hypothetical
  against `add-to-cart.tsx`, which does wire `onError`. Fine, but say "in the guide's scenario" (it does).
- N6 nettrello `e73c813e` key "4 red, 17 green ..." and `c5e08257` key are the most detailed options (within the 1.5x
  ratio, still a tell).
- N7 Duplicate-stem scan: only 6 near-duplicate pairs estate-wide (above plus relay `af9d022e`/`f098d74c`, jstrain5
  `0104067a`/`2ded6b70` - both legitimate pairs). Within-pack duplication is not a problem.

---

## 3. Campaign shape

Source: `server/src/engines/campaign.ts`, `store/campaign.ts`, `store/study-quests.ts`, `store/ladder.ts`,
`store/packs.ts`, `engines/xp.ts`, `engines/level.ts`, `content/campaign/*.json`.

- **Spine.** Three tracks (js 5 acts, csharp 5, java 3). Each act holds `study-quest` quests (core) and `reading`
  quests (skims, never count). A study quest is playable only when its repo has a stamped quest pack: the pack's
  quizzes become one `study-quiz` check (pass >= 80%, integer math), its reading steps become the unit's reading list,
  its flashcards enrol as FSRS cards on the first pass, misses become `quiz-miss` cards. Act N+1 opens when
  coreDone/coreTotal of act N >= 0.8 AND the global level >= act N+1's `unlockLevel` (4, 8, 12, 16). Nothing is stored
  as unlocked; it is derived from the ledger every call.
- **XP.** study-quest pass 50, explain-back 20, patch-kata 15, code drill 10, reading 5, predict 4, quiz 2, review 1.
  Level thresholds (150*(n-1)^1.6): L4 869, L8 3,374, L12 6,955, L16 11,424. All 206 study quests passed once = 10,300
  XP < L16, so act 5 of every track needs XP from the code legs / explain-backs / reviews; Java act 3 (L8 = 3,374) is
  unreachable from Java quests alone (12 x 50 = 600). The level is global, so in practice JS XP opens C# and Java acts.
- **Code legs are not campaign quests.** `content/packs/*` units (bootforge 2,571 in 16 courses; jstrain 1,308 in 50
  courses incl. 15 quiz courses and 8 TS courses; jstrain-cs 81; csbootcamp 31; javabootcamp 168 in 21 modules; csdrills
  72; javadrills 80; sysdrills 129) load as track units with `phase = <course>` and no act gate. The js act-2 theme
  says "drill banks" but `js.json` has only `study-quest` and `reading` quests. So the campaign is a quiz spine and the
  drills are a parallel, ungated leg; the only coupling is XP.
- **Pending core quests.** Opusboot1 (js/4, core, has a checkout, no pack), perch (js/4, excluded as stale-anchors),
  skillforgejs (js/5, excluded). Act 4 can still reach 35/37 = 94.6%, so no dead end; Opusboot1 is a free pack slot.
- **Depth by track.**

| | JS | C# | Java |
|---|---|---|---|
| study quests (core) | 146 | 48 | 12 |
| hand quizzes / flashcards | 1,922 / 630 | 668 / 222 | 186 / 58 |
| code-drill units | 3,879 (bootforge + jstrain) | 112 (jstrain-cs 81 + csbootcamp 31) + csdrills 72 | 168 + javadrills 80 |
| web framework in the repos | Next.js/Express/Vite + Prisma/Drizzle, 100+ repos | ASP.NET Core + EF Core, ~25 repos | none: all 12 are JDK-17 CLI apps |

  C# code drills are 5% of the JS volume and C# acts 1-2 rest on 9 packs, 5 of them generator-only with zero
  flashcards (K3/K6). Java has a decent drill leg (248 units) but its quest side is 12 CLI-app packs and there is no
  Java web stack anywhere (Spring/JPA/Spring Security: 1 incidental mention). Act 2 of C# ("First APIs") has 4 core
  quests with 10-12 quizzes each - the thinnest act in the estate for its importance.

---

## 4. Coverage matrix (quest-pack quizzes + flashcards; drills/EBs noted where they carry the topic)

| topic a CRUD-web engineer needs | quest items (packs) | where it lives | verdict |
|---|---|---|---|
| TS type-level patterns (generics, conditional/mapped, branded, narrowing, `asserts`) | 79 (59) scattered; no pack owns it | devdeck `addbf62c` asserts; storefront `d5bcbe90` brand; jstrain ts-01..08 code (124 units) + quiz-11-typescript (28) | thin as quiz, served by jstrain code |
| React hooks pitfalls (useEffect sync, stale closures, StrictMode, memo) | useEffect 3, useMemo 3, StrictMode 4, re-render 10 | ww7 `b644e2f5` is the one good useEffect item; bootforge react-fundamentals/react-state 343 code units | **gap** |
| State management / server state (TanStack Query, RSC, zustand) | TanStack 33 (16), Next.js 33 (19), zustand 7, redux 0 | storefront, ww10/43/45/7 (cw), reactbullet; sysdrills 17 client-data-layer (4) | moderate, cw helped |
| Forms/validation (zod, react-hook-form, FluentValidation, Bean Validation) | zod 73 (46), FluentValidation 6, react-hook-form 2, Bean Validation 0 | many | fine for zod; forms libraries thin |
| Testing (Vitest, RTL, Playwright, xUnit, JUnit, Testcontainers) | RTL 17 (6), Playwright 6, Testcontainers 5, xUnit 6, JUnit 2 | finance-dashboard, openstatus lab (doc-recall), netcleanarch; jstrain 20-testing (16) + 29-write-the-test | **thin**, and the one dedicated layer (openstatus) is K1 |
| Node/Express/Fastify/Next route handlers | Express 31 (20), Fastify 1, middleware 163 | j5, 3buildanalytics, newcodexjs; bootforge express-api 171 code | moderate |
| ORM (Prisma, Drizzle, knex, EF Core, JPA) | 294 (98): Prisma heavy, EF Core good, Drizzle 3, knex 2, JPA 0 | netcalendy/netcleanarch/j2 (EF), ww*/zz* (Prisma) | fine except JPA |
| SQL/Postgres (indexes, transactions, isolation, constraints, migrations) | 765 (173); EXPLAIN 66 (36) | payments-lab, w22, gitjira, zz1; sysdrills 05, 16 | strong |
| Auth (sessions, JWT, cookies, OAuth, Identity) | 442 (135); ASP.NET Core Identity 0 | dotnet-auth (custom), zz8, umami, ww4 | strong (custom auth); Identity absent |
| Authorization (RBAC, ownership, tenant, IDOR) | 613 (153) | netcalendy, zz1, zz8, w22, meterforge | strong |
| HTTP caching/semantics (ETag, Cache-Control, 304, idempotency, 409/422) | status codes + idempotency 594; ETag/304 23 (16); Cache-Control 2 | nethris, csbootcamp, ww45; jsprojectlearn `1f03c169` | caching headers **thin** |
| Security in practice (OWASP) | 229 (116): CSRF 11, XSS 10, SSRF 4, mass assignment present, rate limit present | relay, lucasrouter, dotnet-auth, ww45 | moderate; XSS/CSRF/SSRF thin |
| Docker / CI / env config | Docker 4, CI 23 (12), env var ~100 | dotnet-auth `1a6543f0`, pulse, 3buildanalytics | **thin** (§8 notes git-workflow unserved; Docker/CI similar) |
| Observability (logging, metrics, tracing, health) | 250 (111) by loose match; OpenTelemetry/trace id 21 (17) | tracer, meterforge-upskilling; sysdrills 14 (9) | moderate |
| .NET web (minimal APIs, DI lifetimes, middleware, ProblemDetails, MediatR) | minimal API 5, MediatR 10, DI/captive 38 (18) | netcalendy `65d1d863`, netcleanarch, nettodo; jstrain-cs 81 + csbootcamp 31 code | thin for a target stack |
| Spring Boot / JPA / Spring Security | 1 | - | **absent** |
| Git workflows / code review / PR hygiene | git ops 5; review checklists in j2 fc | j2 `docs/onboarding/02-review-checklists.md`, netcalendy senior checks | unserved (already noted in §8 as intentional) |
| Debugging / profiling / performance | 89 (50); flame/profiler 1 | ww27, eliapplybot-extension, tracer sprint-12 audit, gitjira EXPLAIN | thin on tooling |
| Money / decimal / time zones | 207 (92) | storefront, atlas, j5, relay-app UTC ticks | fine |
| Pagination / search | 336 (146) | harbor-swe-bootcamp, ww45, relay | strong |

Already proposed elsewhere (not re-proposed here, endorsed where marked): handoff "Next ideas" 1-6 (set-B retakes,
EB-vs-EB leak lint, csdrills hints, classic EBs on 43 JS repos, `jsdrills`, quiz layers on the <= 12-question packs -
**endorsed with the priority order in P8/P10**); SEEDING §8 report items (JS leg of cross-language traps, javadrills
task-text fixes, typeahead load drill, login-lockout math, data-history/GDPR-erase DESIGN IT, set-Bs for the cw
primaries, git workflow "intentionally unserved").

### 4.1 Checkouts with no quest pack (13 of 217)

| checkout | campaign | other content | pack-worthy? |
|---|---|---|---|
| atlas-net | csharp/4 **reading** | G2 brief only | **yes** - 9 ADRs (API-key auth, cross-client 404 policy, DateTimeOffset UTC ticks, decimal rounding, append-only salary history, version-token concurrency, payroll snapshot, ProblemDetails + header pagination) -> P3 |
| tenantadmin | js/3 **reading** | classic EB | **yes** - small Express+Prisma RBAC/audit app -> P4 |
| world | not in map | none | **yes** - Next.js+Prisma+BullMQ+outbox EOR MVP -> P5 (needs a map entry) |
| organized-experiment-zz7 | not in map | DESIGN IT async-report-exports | yes - same doc skeleton as ww7/ww10 -> P6 |
| organized-experiment-ww48 | not in map | G2 + DESIGN IT pipeline-board | yes -> P6 |
| Opusboot1 | js/4 **core, pending** | none | yes - DevPractice pnpm monorepo (Postgres, missions: ownership defect, N+1, idempotency, concurrency); the only free core slot |
| ww16, ww37 | not in map | none (ww16 pack built then reverted in cw because unlinked) | only if added to the map; both have the full `astraupskill/` course -> the generator path works as-is |
| organized-experiment-clinical-trial-tracker | not in map | none | maybe (Next+Prisma, has `docs/` + tests) |
| organized-experiment-internal-case-management-system | not in map | G2 + DESIGN IT audit-log-integrity (+set-B) | maybe; EB-heavy already |
| organized-experiment-tenant-search-indexer | not in map | G2 + DESIGN IT search-freshness (+set-B) | maybe (Drizzle! the only Drizzle repo besides openstatus) |
| organized-experiment-workspace-overview | not in map | none | no - umbrella of founder-crm-lite + customer-feedback-board (the latter has its own pack) |
| javabootcamp | not in map (code pack) | 7 G2 briefs | no quiz pack needed; the drills are the content |

---

## 5. Proposed new content (ranked by value to the owner's goal)

Effort: S = one drafts-path pack or layer (< 1 agent-day), M = 1-3 packs or a layer across several repos, L = needs a
new owner repo or a factory change (restamp).

**P1. A Java web leg: Spring Boot + JPA + Spring Security (L).** Zero items today; all 12 Java quests are CLI apps.
There is no owner repo to cite, so this needs a repo first: port nettrello (board PATCH + move) or netcalendy (public
booking + tenant scope) to Spring Boot with the same `astraupskill/` chapter set, then run the normal drafts path
(quest pack + classic EB + a javadrills module). Stems: a `@Transactional` method called from another method of the
same bean - does the second call run in a transaction?; a DTO built from a lazy `@OneToMany` outside the request -
which exception and where?; `@Version` on the card and a PATCH with a stale version - 409 or 200?; `permitAll()` on
`/api/bookings` but the JWT filter still runs - what does an invalid token do?; `@Valid` on a nested record field -
is the nested object validated?; `spring.jpa.open-in-view=true` - what does the N+1 cost in the controller vs the
service?; `@ControllerAdvice` returning `ProblemDetail` vs `ResponseStatusException` - which one the client sees for a
`MethodArgumentNotValidException`; `GenerationType.IDENTITY` and `saveAll(2,000 rows)` - how many INSERTs?

**P2. React client data-layer and hooks pitfalls layer (M).** Thinnest topic in the JS target stack (useEffect 3,
useMemo 3, StrictMode 4 items). Ground it in repos already pinned where cw/qw found UI defects: ww7 (builder form sync,
no `refetchInterval`, no mutation error rendering), ww10 (no component renders query errors, 404 loads forever), ww43
(stale draft in cache), ww45 (`["tags"]` never invalidated, Date fields arrive as strings), ww48 (abort signal
ignored), organized-js-training-react (11 quizzes, act 2). Stems: StrictMode mounts twice - the socket subscribe in
`useEffect` has no cleanup, how many connections?; `setInterval` callback reads a `useState` value - which value after
three ticks?; the detail page keys its form on nothing and `useEffect([data])` copies server data - what happens to
unsaved edits on refetch?; `enabled: false` then `refetch()` - does `isLoading` go true?; `onSuccess: setQueryData`
races a background refetch - which wins?; a `queryFn` ignores `signal` - what happens to the response of a cancelled
query?; `useMemo` on an object passed as an effect dependency - why did the effect stop re-running?; a Date from JSON
rendered with `toLocaleDateString()` - what is it at runtime?

**P3. atlas-net quest pack (M).** C# act 4 reading-only repo with the best ADR set among the un-packed checkouts, and
the C# flagship act is already where the owner's C# depth lives. Stems: client A GETs client B's contract id - 404 or
403, and why the ADR picks it; a `DateTimeOffset` with +02:00 saved as UTC ticks and read back - what offset?; payroll
line 1234.565 rounded - which `MidpointRounding` and where it is applied once; a contract amendment lands - which row
answers "salary on 2026-03-15"?; a PUT without the version token vs. with a stale one; a payroll run after the tax
table changes - which rates does the payslip show?; a `Link`/`X-Total-Count` header pagination response - what a
client must send for page 3; an API key rotated mid-session - which requests fail first. Promote the quest from
`reading` to `study-quest` in `Desktop\upskillorder` so it gates.

**P4. tenantadmin quest pack (S-M).** JS act 3 reading-only; a 2-package Express + Prisma + SQLite app with opaque
hashed session tokens, magic links, a fixed permission catalogue and an append-only audit log, and no tests (a feature:
every stem can be "write the test that proves it"). Stems: a magic-link token is used twice within its TTL - second
result?; the sessions table leaks - what does an attacker hold?; the body carries `tenantId` of another tenant while
the session says tenant A - which rows does `GET /users` return?; an audit row records the wrong actor - how is it
corrected without an UPDATE?; the list endpoint paginates and filters - does the `total` count honour the filter?; a
new role needs a permission not in the catalogue - which layer rejects it?; the session cookie flags (`HttpOnly`,
`SameSite`) and the magic-link GET - is the login CSRF-able?; `lint` scripts are `echo` stubs - what CI believes.
Promote to `study-quest`.

**P5. world (Velocity Grid) quest pack + classic EB (M-L; needs a map entry).** The richest un-packed JS CRUD app:
Next.js App Router (JS, not TS), Prisma/Postgres, Redis + BullMQ with an inline fallback, domain-event outbox,
payroll with approval, leave balances, CSV bulk import, invoice generation. Stems: Redis is down so BullMQ "falls back
to inline mode" - what happens to retries and to the request latency?; the outbox relay publishes a row twice - what
makes the consumer safe?; a CSV import of 500 rows fails at row 301 - what is in the DB?; payroll `approve` is clicked
twice from two tabs - how many payslips?; a leave request and a cancellation race on the same balance; the invoice job
runs on the 1st at 00:00 in two regions - two invoices?; an org admin changes a tax rule after a run is processed -
which run is affected?; JWT cookie session - what does a role change do before expiry?

**P6. zz7 (VendorOS) and ww48 (CRM pipeline) quest packs (M each; standalone units unless added to the map).** Same
`docs/architecture` + `docs/learning/flow-traces.md` skeleton that gave ww7/ww10/ww43/ww45 their best cw items, and
the upstream findings are already catalogued in §8 (zz7: the runner reads the live report definition, not the queued
snapshot, and no file is written; ANALYST can export purchase orders without PO read permission; ww48: the hook cannot
send the owner filter; the query function ignores the abort signal). Stems (zz7): an analyst queues a report, the
definition is edited before the worker runs - which columns are in the export?; the export job "succeeds" - where is
the file?; a quote is accepted after the RFQ closed; a PO approval by its own creator; receiving more than ordered;
`SESSION_SECRET` unset in production. Stems (ww48): keyset paging per column when two leads share `updatedAt`; the
owner filter the UI cannot send - what does the API return?; a stage transition the state machine forbids; the
activity log on a lost update.

**P7. Testing-in-practice layer (M).** RTL 17 items in 6 packs, Playwright 6, Vitest-specific ~0, Testcontainers 5,
xUnit 6. Rewrite the openstatus fundamentals layer (10 doc-recall quizzes, K1) as predict-the-failure items, and add a
layer on finance-dashboard (already 7 RTL items) and netcleanarch (Playwright 2, Testcontainers). Stems: `getByText`
on a value that arrives after a fetch - which query fixes the flake?; `fireEvent.change` on a controlled input vs
`userEvent.type` - which one the handler sees per keystroke; a Playwright `page.waitForTimeout(500)` test passes
locally and fails in CI - what replaces it?; a fake repository that implements the rule under test (zz8 `2f02bebc`
is the model) - what the test proves; `vi.useFakeTimers()` and a TanStack Query retry with backoff - does the test
finish?; Testcontainers DB not reset between methods (netcalendy `3fe396bb`) - which test order breaks; a
`WebApplicationFactory` that forgets to remove the real `DbContextOptions` registration - which DB do the tests hit?

**P8. Hand layers on the generator-only C# anchors (M = 6 x S): nettrello, borrowbox, csbootcamp, csharp-tut,
dotnet-snapshot, csharp-interview.** They gate C# acts 1, 2 and 5 with 0 hand quizzes and 0 flashcards, so nothing
enters FSRS from C# foundations. nettrello's course alone supports: a PATCH field sent as `null` vs omitted
(`JsonValueKind`); `X-Board-Version: abc` (the `int.TryParse` branch at `BoardEndpoints.cs:53`); same-column move to
position 99 vs -1 (clamp vs 400); a second server instance and the `SemaphoreSlim`; a client mutating the board it got
from `GetAsync`; `Development` vs `Production` for an unknown JSON property. Keep <= 4 generator items per pack.

**P9. Docker / CI / config and observability layer (M).** Docker 4 items, CI 23, Cache-Control 2, OpenTelemetry 21.
Candidates with real CI/compose in the pinned trees: dotnet-auth (CI runs only the UnitTests project - `1a6543f0`
already), pulse (CI 4), netcleanarch, world/ww48/ww16 `docker-compose.yml`, netcalendy Testcontainers. Stems: a
compose `depends_on` without `condition: service_healthy` and a migration on boot; `SESSION_SECRET` unset -> a silent
dev default (zz7 `src/lib/env.ts:15-16`, relay `relay-dev-master-key` `789c8f21` is the model); a CI matrix that
skips Docker-dependent tests; a readiness probe that passes while the DB pool is exhausted; a `Cache-Control:
max-age=300` on `GET /api/me` behind a CDN (jsprojectlearn `1f03c169` is the model, make it repo-grounded); a
correlation id that stops at the queue boundary; p99 vs mean when one tenant's export runs.

**P10. Quiz layers on the thin act-1/2 anchors, in this order (S each; endorses handoff #6):** C# act 2
(organized-dotnet-pastebin 10, organized-dotnet-trello 10), then js act 1-2 (grok-js 14, ship-it 11, unionboot 10,
organized-js-training-jstrain2/2.2/2.3/3/react 10-11), then js act 3 (lucasrouter 11, elihyper2 11). pastebin's
existing 10 are all code-truth scenarios (`47e7f0a2`, `7fc440d4`, `92d4254b`) - extend in that style, not K1's.

**P11. TS type-level pack (M).** 79 scattered items, no owner. Repos with real type-level code: tracer
`packages/shared` (filter AST compiled two ways, zod-inferred field enum `3b9f7ed7`), devdeck (`asserts payload is
ExportData` `addbf62c`), storefront (branded `Cents`), jobtrack, recipeweb. Stems: an `asserts` guard vs a boolean
guard - which one lets a bad payload past an `if`; a discriminated union gains a variant and a `switch` with a `never`
default - where does the build fail?; `z.infer` after adding `.transform()` - input vs output type; `satisfies` vs an
annotation on a route map - which keeps literal keys?; a `readonly string[]` passed where `string[]` is expected;
a generic `sortBy<T, K extends keyof T>` called with a nested path; template-literal route keys and a typo; a branded
`Cents` assigned from `price * 100`.

---

### Appendix - method notes

- Distribution: `dist.py` over every `manifest.json`/`items.json`; track/act from `content/campaign/*.json`
  (`study-quest` quests only); first-commit date via `git log --diff-filter=A --follow`.
- New-vs-old: `newitems.py` diffs item keys between each pack's first commit and HEAD (47 packs changed after
  10-16; 18 of them only by distractor rebalances or leak fixes, no new items).
- Doc-recall share: regex over hand-quiz stems (`per the guide|according to|what does the (guide|critique|ADR|table|
  lab|map|kata|workout) ...|stated purpose|documented limits|...`); it under-counts (tracer's "ADR-0002's Revisit line
  says" is not matched), so 18% is a floor.
- Leak/duplicate scan: token-Jaccard on stems and keys within a pack; verbatim keyed-answer substring (>= 4 words)
  in flashcard backs. One hit (W1).
- Scripts, dumps and verification output: `scratchpad/rv/` (`packs/*.txt`, `compact-*.txt`, `dist.json`,
  `newitems.json`).
