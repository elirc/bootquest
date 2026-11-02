# R2 — Explain-back review (classic EBs, DESIGN IT sets, G2 briefs)

Read-only review of `content/seed/explainback/*` (244 packs) at main 772b19cb, 2026-10-30. Drafts in
`tools/seed/authoring/explainback/` (165 files) and `tools/seed/authoring/g2/` (26 files); the remaining 53 classic
drafts live in `content/seed-drafts/explainback/`. Everything below was counted from `items.json`/`manifest.json`
(script: scratchpad `rv/inv.mjs`), not from the handoff.

## 1. Inventory

Counts (verified): **244 packs = 244 items** (one item per pack). By the server's routing rule
(`server/src/store/ladder.ts:69-74`: Q0 prompt prefix `G2 BRIEF` → agentic, `DESIGN IT` → sysdesign, else classic):

| Kind | Items | Notes |
|---|---|---|
| Classic explain-back | **137** | 128 repos; 9 repos have 2-3 items (atlas, netgum, organized-build-analytics, ww19, zz8 each have a set-B; helios-interplanetary, mastermorphic 2 units; signalpost 3 units). Stack (campaign tag): 72 ts-react-node, 30 csharp-dotnet, 22 js, 12 java, 1 other. |
| G2 delegation brief | **20** | 26 `g2-brief--*` packs, of which 6 (`g2-brief--javabootcamp-*`) carry a `DESIGN IT` prompt and are DESIGN IT items by design (SEEDING §8 sd-plumb). |
| DESIGN IT | **87** | 81 `sysdesign--*` packs + the 6 javabootcamp packs. **50 primaries** over **39 repos**, **37 retakes** (33 set-B + 4 set-C: grok-build-multitenant, opusorganize 10x-load, opusorganize zero-downtime, idempotent-payments-lab). |

Weights: **136 items carry `[wN]` on every kp, 108 carry none** (no mixed items). All 108 unweighted items are classic
EBs (79% of the classic layer); every G2 and DESIGN IT item is weighted.

Review queues: 0 held items across all 244 packs. kp counts: every question has 5-8 kps and every item has 3 questions.

### 1.1 DESIGN IT primaries (50)

| # | repo | unit | topic (Q0 prompt) | set-B | set-C |
|---|---|---|---|---|---|
| 1 | 3buildanalytics | docs/upskill/03-…/05-pattern-catalog.md | rate limiting a public API: one process, then a fleet [mid] | yes | - |
| 2 | bazaar | docs/adr/0006-multi-layer-cache-coherence.md | cache coherence across layers for a storefront [senior] | yes | - |
| 3 | bazaar | docs/adr/0007-inventory-consistency.md | inventory that cannot oversell [senior] | yes | - |
| 4 | campusops | astraupskill/advanced/extended-course/14-webhook-enqueue-and-retry-state.md | outbound webhooks that retry safely [mid] | **-** | - |
| 5 | dotnet-auth | docs2/03-oauth-from-the-code.md | OAuth login end-to-end [senior] | **-** | - |
| 6 | dotnet-drop | docs/upskill/03-…/04-side-effects-async-and-reliability.md | resumable chunked uploads with quarantine [mid] | yes | - |
| 7 | dotnet-stripe | docs2/03-…/04-side-effects-async-and-reliability.md | payment side-effects that survive retries (.NET) [mid] | yes | - |
| 8 | grok-build-multitenant | dfableandopus/05-SYSTEM-DESIGN-FOLLOWUPS.md | multi-tenant isolation for a B2B CRUD app [mid] | yes | yes |
| 9 | groktuts-web-dev-upskilling-lab | system-design-deep-dives.md | data model, API and caching for a listing-heavy app | yes | - |
| 10 | harbor | docs/adr/0007-sla-clock-and-escalation.md | SLA clocks, pause rules and escalation [senior] | yes | - |
| 11-16 | javabootcamp (6) | bootcamp/09..13 README, astraupskill/03-SYSTEM-DESIGN.md | job queue, URL shortener, rate-limited API, Dynamo-style KV, feed fan-out, ticket booking | **-** | - |
| 17 | jsprojectlearn | content/modules/system-design-for-crud.md | a CRUD product end-to-end in 45 minutes [mid] | yes | - |
| 18 | masteropen | openstatus/fabledocs3/adr-009-idempotency-over-outbox.md | choosing idempotency over an outbox [senior] | yes | - |
| 19 | masteroutline-outline | fabledocs2/03-data-access.md | permission-filtered full-text search [senior] | yes | - |
| 20 | masteroutline-outline | fabledocs3/adr-007-crdt-triple-representation.md | real-time collaborative editing [senior] | **-** | - |
| 21 | mastertwenty | twenty/fabledocs3/adr-006-generated-graphql-single-pipeline.md | GraphQL API generated from workspace metadata [senior] | yes | - |
| 22 | masterumami | umami/fabledocs/upskill/03-…/02-data-model-and-persistence.md | privacy-first analytics write path and read side [mid] | yes | - |
| 23 | master | README.md | offline edits for a planner app: optimistic UI, sync conflicts [senior] | **-** | - |
| 24 | meterforge-upskilling | astra docs/notes/04-distributed-reliability.md | metering and billing that survive retries and crashes [senior] | yes | - |
| 25 | netcalendy | astraupskill/02-CONCEPTS.md | Calendly-style booking that never double-books [mid] | yes | - |
| 26 | netslack | docs/architecture.md | real-time channel message delivery [mid] | yes | - |
| 27 | opusorganize | apprenticeship/curriculum/06-caching-correctness.md | caching that stays correct [senior] | yes | - |
| 28 | opusorganize | …/07-zero-downtime-migrations.md | zero-downtime schema change [senior] | yes | yes |
| 29 | opusorganize | …/14-load-backpressure-timeouts.md | keeping a web app alive at 10x load [senior] | yes | yes |
| 30 | opusorganize | …/16-sagas-vs-2pc-vs-outbox.md | multi-service order flow: saga vs 2PC vs outbox [senior] | yes | - |
| 31 | opusorganize | …/18-durable-execution.md | durable workflow engine [senior] | yes | - |
| 32 | organized-build-ecom | docs/upskill/03-…/03-validation-auth-and-permissions.md | roles and permissions for a multi-seller marketplace [senior] | **-** | - |
| 33 | organized-build-scedulingpyjs | ARCHITECTURE.md | reminders and recurring bookings as time-fired work [mid] | yes | - |
| 34 | organized-experiment-idempotent-payments-lab | docs/learning/concepts-demonstrated.md | idempotent checkout with payment webhooks [mid] | yes | yes |
| 35 | organized-experiment-internal-case-management-system | docs/learning/flow-traces.md | audit trail: complete, queryable, no dual write [mid] | yes | - |
| 36 | organized-experiment-temporal-lite-orchestrator | docs/learning/concepts-demonstrated.md | durable job runner on Postgres [senior] | **-** | - |
| 37 | organized-experiment-tenant-search-indexer | docs/learning/concepts-demonstrated.md | search index that stays fresh [mid] | yes | - |
| 38 | organized-experiment-ww48 | docs/architecture/domain-model.md | CRM pipeline board and list at scale: pages, search, counts, URL state [senior] | **-** | - |
| 39 | organized-experiment-zz7 | docs/learning/flow-traces.md | async report exports: queue, claim, stream, deliver [senior] | **-** | - |
| 40 | organized-study-cal-com | cal.diy/fabledocs/upskill/03-…/06-architecture-critique.md | database-backed feature flags and staged rollout [mid] | yes | - |
| 41 | organized-study-dify | dify/fable docs/upskill/01-…/05-key-flows.md | knowledge-base ingestion and retrieval (RAG) [senior] | **-** | - |
| 42 | organized-study-dub-monorepo | dub/fable docs/upskill/01-…/05-key-flows.md | click-analytics pipeline for a link shortener [senior] | **-** | - |
| 43 | organized-study-enterprise-billing-platform | docs/system-design-current.md | subscription invoicing and dunning [senior] | yes | - |
| 44 | organized-study-linkwarden | linkwarden/fabledocs/upskill/03-…/03-validation-auth-and-permissions.md | object-level sharing and permissions [senior] | yes | - |
| 45 | organized-study-support-desk-crm | docs/features/003-outbox-worker-notifications.md | notifications without dual writes [mid] | yes | - |
| 46 | pulse-net | docs/adr/0001-async-ingestion-durable-queue.md | ingest pipeline that cannot lose events [senior] | yes | - |
| 47 | relay | docs/adr/0009-durable-execution.md | operating a workflow engine: retries by error class [senior] | **-** | - |
| 48 | tracer | docs/adr/0003-sessions-over-jwt.md | auth and session design [mid] | yes | - |
| 49 | w22 | docs/architecture/domain-model.md | consuming payment webhooks when the provider is the truth [mid] | yes | - |
| 50 | zz1 | docs/architecture/auth-and-tenant-isolation.md | auth + tenant isolation for a small B2B app [mid] | yes | - |

Primaries without a retake: **17** (6 javabootcamp, campusops, dotnet-auth, master, masteroutline realtime-collab,
organized-build-ecom, temporal-lite, ww48, zz7, dify, dub, relay) — matches `elihandoff/README.md` idea 1. Stack of the
50 primaries by campaign tag: 26 ts-react-node, 8 csharp-dotnet, 1 js, 5 opusorganize (curriculum repo), 10 on repos
with no campaign quest (the 6 javabootcamp sets, zz7, ww48 and two others).

### 1.2 Classic explain-backs by repo (137 items / 128 repos)

Repos with more than one item: atlas 2 (A+b), helios-interplanetary 2 (2 units), mastermorphic 2 (2 units), netgum 2
(A+b), organized-build-analytics 2 (A+b), signalpost-swe-bootcamp 3 (U01-U03), ww19 2 (A+b), zz8 2 (A+b). The other
120 repos have exactly one. Unit types: 41 are `astraupskill/02-CONCEPTS.md` (the fundamentals-wave template), 7 are
`README.md`, 5 are a raw source file (`BuildJiraStore.cs`, `store.js`, `12-async-await-2.0.cs`, `02-dependency-
injection-2.0.cs`, `35-event-loop-and-concurrency.js`); the rest are ADRs, architecture docs, request-lifecycle traces
and audits.

By stack: ts-react-node 72, csharp-dotnet 30, js 22, java 12, other 1 (eliapplybot-extension). Weighted classic items
(29): the mx/qw/cw-era ones (netgum A+b, zz8 A+b, ww19 A+b, organized-build-analytics A+b, atlas A+b, gitjira, pulse,
agora, e20?, globehire, tenantadmin, helios-interplanetary x2, masterstore, ww27/ww39/ww4/ww7, masteridur,
mastermorphic x2, masternext, masteroutline, mastertwenty, masterumami, stockade, support-hub, ww18, ww29, nextcrm-app).
The 108 unweighted ones are the 2026-10-08..10-19 generations (W5c act-1 sets, fundamentals wave, Java track).

### 1.3 G2 briefs (20) by finding topic

| Topic | Count | Repos |
|---|---|---|
| Concurrency / race / stuck state | 4 | gitjira (fractional-key race), netgum (double completion), ww19 (lease expiry never compared), tenant-search-indexer (rebuild flag never cleared) |
| Retry / background-job selection | 3 | w22 (FAILED never re-selected), dotnet-drop (chunk cleanup + janitor), relay (dedupe never wired) |
| Authz / security hole | 5 | masterumami (ip/userAgent override), organized-build-analytics (role self-assignment on register), icms (`case:assign` unchecked), tracer-net (rate-limit partition on raw header), pulse (PII scrub depth + unsalted hash) |
| Error mapping / validation boundary | 3 | netslack (slug normalisation + NRE→500), ww48 (missing `await` → 500), zz8 (ZodError/JSON parse → 500) |
| Data normalisation | 2 | ww6 (monthStart equality), netcalendy (multiple rules per weekday) |
| Tests-only delegation | 2 | atlas-net (payslip snapshot regression), signalpost (top-level schema parse untested) |
| Design delegation | 1 | javabootcamp (parking-lot design brief) |

Stacks: 13 Node/TS, 6 .NET, 1 Java. Every G2 has the 3-question shape BRIEF / PRE-MORTEM / HANDBACK REVIEW with 7/5/5
kps (javabootcamp 8/6/6).

## 2. Quality findings

Sample read in full: classic — netgum A+set-b, masternext, fableopusrecallv2, jsdrillv2, organized-experiment-support-hub,
stockade, formforge, relay-app, csharp-interview, ww18 (11 items, dates 2026-10-08 → 10-30); DESIGN IT — tracer A+B,
opusorganize 10x A+B+C, idempotent-payments-lab A+B+C, netcalendy A+B, ww48, zz7, dotnet-auth, masteropen A+B,
jsprojectlearn A+B, javabootcamp url-shortener (18 items); G2 — w22, gitjira, netslack, tracer-net (4). Code-truth:
**46 cited claims checked at the pinned checkout, 46 correct** (list in §2.4). Paraphrase scan over all 4,756 kps vs
7,616 quiz/flashcard/note texts of the same repo (content-word containment ≥ 0.55, ≥ 7 shared words): 140 pairs, 94 of
them EB↔note (scratchpad `rv/leak-out.txt`).

### 2.1 WRONG (behaviour-changing or misleading)

None of the 46 code-truth checks failed. One mis-cite is close to wrong:

- **W1 — payments-lab primary q0.kp6 cites a to-do as if it were the code.**
  `sysdesign--organized-experiment-idempotent-payments-lab--idempotent-checkout-webhooks` q0.kp6 ("the payment row is
  locked inside the refund transaction and the already-refunded sum is recomputed under that lock") cites
  `docs/learning/build-journal.md:147`, which is item 2 of "What I would change first" (a recommendation). The code at
  the pin does the opposite: `src/services/refundService.ts:25-36` reads the payment and `sumSuccessfulRefundsForPayment`
  *before* `prisma.$transaction` opens (set-C q1.kp3 and `docs/architecture/request-lifecycle.md:123` say so
  correctly). The kp is phrased as the target design, so a learner is not taught a false fact, but the cite sends them
  to a line that does not show what the kp describes. Fix: cite `request-lifecycle.md:123` or `refundService.ts:25-36`
  and add "(the lab does not yet)".

### 2.2 WEAK (rubric quality)

- **K1 — Weights are text-only; 108 classic items have none, and the client never reads them.**
  Every DESIGN IT/G2 prompt ends "tick the checkpoints you covered and add up the weights (suggested pass: 70% with every
  [w3] hit)", but `client/src/pages/LadderPanes.tsx:600-617,687-698` scores `covered / allIds.length` and the promotion
  gate is that plain coverage; `[wN]` is never parsed (no `\[w` match anywhere in `client/src` or `server/src`). So a
  learner can pass a senior DESIGN IT set by ticking every [w1]/[w2] and missing every [w3]. For the 108 unweighted
  classic items the prompt-level instruction does not even exist. Evidence: `inv.json` weights column; e.g.
  `fableopusrecallv2--…07-server-actions…` q0 has 6 kps, no weights, and "Atomic means commit together…" (a definition)
  counts the same as "read-compute-write without a lock" (the insight). Fix: make `weight` a field (factory reads
  `[wN]`, falls back to 1), store weighted coverage on the self-score, gate on "weighted ≥ 70% AND all w3 covered".

- **K2 — Two generations of classic EB. The ≤ 2026-10-19 generation (≈100 items) is doc-restatement, and its kps are
  often verbatim in same-repo notes/quiz explanations/flashcards.** The leak lint (`factory/guards.ts:399-461`) compares
  kp text only with quiz *choice* text (`keyedQuizIndex`), not with quiz explanations, flashcard backs, notes or other
  EBs, so it reports 0. Verbatim or near-verbatim pairs (containment 1.00) found:
  - `relay-upskilling--…CODE-TOUR.md` q1.kp0 ≡ note `x-3f649ea6de6e4de3` ("Saving a mapping or correcting a row bumps
    mapping_version, resets validation and clears approved_hash in the same UPDATE").
  - `fableopusrecallv2` q0.kp5 ≡ quiz `3e0f836f` explanation ≡ note `x-q01-atomic-not-idempotent`; q2.kp4 ≡ note
    `x-q11-lost-response-on-main` ≡ quiz `dd80c9e7` explanation; q1.kp3 ≡ quiz `b725e055`.
  - `bootlocalopusv2--…005-where-the-trust-boundary…` q1.kp2 ≡ quiz `6cf9d6ea` explanation ≡ note `x-6cf9d6ea…`; q0.kp4 ≡
    quiz `e0fba98f`; q0.kp2 ≡ note `x-d4cfc4e3…`; q2.kp0 ≡ note `x-066d3c34…`.
  - `jstrain2.2--guides-01-the-event-loop…` q1.kp4 ≡ quiz `a47141a8` ≡ note `x-before-first-await`.
  - `jsprojectlearn--…09-the-roadmap-as-data…` q1.kp2 ≡ quiz `50cd845a`; q0.kp4 ≡ note `r02-position-keys`; q2.kp2 ≡ note
    `x-q05-frozen-generator`.
  - `j5` q0.kp2 ≡ fc `f01-validate-in-constructor`; `js1` q2.kp5 ≡ note `x-q03-fix-at-boundary`; `storefront` q0.kp3 ≡
    note `x-format-at-the-edge`; `unionboot` q1.kp0 ≡ note `x-q03-nullish-empty-string`; `andie` q2.kp5 ≡ note
    `x-q05-partial-apply`; `buildsubbox` q0.kp2 ≡ quiz `afd621e7` ≡ note `x-q14…`; `grok-build-order` q1.kp0 ≡ note
    `x-q03-write-boundary`; `master4` q2.kp5 ≡ note `x-q08-check-then-act`; `newcodexjs` q1.kp5 ≡ quiz `2c80d9ed`;
    `organized-js-training-jstrain2` q1.kp4 ≡ fc `f03-queue-why`; `recipeweb` q0.kp0 ≡ note `r01-start-here`.
  Notes and explanations are shown after the quiz, which the ladder places before the EB, so the EB kp is handed over.
  SEEDING §8 accepts EB/quiz overlap "when the prompt asks for exactly the fact" — that doctrine does not cover the note
  layer, which was added after most of these EBs. Fix: extend the lint to quiz `explanation`, flashcard `back` and
  note `body` (same Jaccard rule), and let it also compare EB↔EB across items of one repo (the handoff's idea 2); then
  rewrite the ~20 kps above as scenario/code-truth statements (the newer packs show the pattern).

- **K3 — The DESIGN IT Q0 prompt enumerates the answer's sections in kp order.** Every Q0 lists 6-9 headings ("the token
  and where it lives, what the server stores, the cookie settings…, how the OAuth callback is protected, and what one
  authenticated request costs" → tracer kp0-kp7 in that order). The learner never practises *scoping* the problem,
  which is what a real design round tests first. Fix: a `blind` variant (or a toggle) that shows only the scenario and
  reveals the heading list after the answer is stored; keep the headings for [mid] sets, hide them for [senior].

- **K4 — Trivia / vendor-recall kps inside otherwise good sets.**
  - `sysdesign--opusorganize--web-app-at-10x-load` q0.kp1 [w3] expects "the Stripe SDK default of 80 s or Anthropic SDK
    default of 10 min, or a Redis client configured to retry forever" — the design point (every hop shorter than its
    caller) is right; the vendor numbers belong in the quote, not the kp text.
  - `sysdesign--dotnet-auth--oauth-login-end-to-end` q0.kp1 [w2] "discovery document" is doc recall; q2.kp3 [w2] cites
    "RFC 9700 requires exact string matching" as the reason — fine as evidence, weak as a checkpoint.
  - `formforge--docs-security-threat-model.md` q1.kp3 "The demo seed uses fictional example.com addresses"; q0 is five
    sentences copied from the doc's boundary list. The whole set is recall of a 35-line doc.
  - `jsdrillv2--…08-migrations…` q1.kp5 "json_each passes the whole id list as a single parameter";
    `relay-app--…0007-external-id-import-mapping.md` q1.kp5 "A newly created imported flow starts disabled".
  - `jsprojectlearn--crud-product-45-minutes` q0.kp1 [w2] "Round a day to 100,000 seconds" — the trick is fine, but
    it is the only arithmetic checkpoint and the numbers are given in the prompt.

- **K5 — Prompts that give away their own kps (classic layer).**
  - `csharp-interview--…02-async-concurrency.md` Q1: "why blocking with .Result deadlocks in classic ASP.NET but starves
    the thread pool in ASP.NET Core" states kp0-kp2's conclusion; Q2 lists "obtain, pass and treat".
  - `jsdrillv2` Q1 "evolved from a hard delete to a soft delete" (= kp3) and Q2 "why CREATE TABLE IF NOT EXISTS is not
    enough" (= kp0).
  - `relay-app` Q2 names "Prod/Test example", "ConcurrencyToken" and "attempts/backoff" — kp1, kp5, kp4.
  - `fableopusrecallv2` Q0 "covering atomicity, idempotency and lost updates" hands over the three concepts.

- **K6 — Set-B/C are genuinely different angles (good), with one soft echo.** 10x-load A/B/C = drop day → second venue
  capacity plan → provider outage + recovery storm; payments-lab A/B/C = checkout → EOD reconciliation → client release
  that defeated idempotency; netcalendy A/B = single host → round-robin pool; tracer A/B = sessions → invites/roles/
  guests; masteropen A/B = outbox judgment → 10x growth + alert fatigue; jsprojectlearn A/B = 45-min CRUD → offline
  collaborative board. Only echo: `masteropen--set-b` q2.kp4 ("each new piece of state … has to be deterministic too,
  because the pipeline still retries at every hop") restates primary q0.kp0/kp2 doctrine — NIT, already noted as a
  "doctrine echo" in SEEDING §8.

### 2.3 NIT

- `sysdesign--organized-experiment-zz7` q0.kp4 ends "The storage piece is a supposition: the repo has none." — good
  honesty; apply the same marker to tracer-B q0.kp5 and ww48 q0.kp3 (pg_trgm), which also prescribe things the repo lacks.
- `g2-brief--netslack` q0.kp5 and q1.kp4 both key the ".NET 8 target cannot run on .NET 10" fact; one is enough.
- `g2-brief--tracer-net` q2.kp2 "the suite total moved from 591 by exactly the tests added" — a count pin that will
  rot if the mirror is ever re-pinned; keep it in the quote.
- `sysdesign--netcalendy` q0.kp1 asserts "today the slot list's display string is formatted from the UTC instant" —
  not spot-checked; cite points at the handler, fine.
- `tools/seed/authoring/explainback/organized-experiment-ww48.json` (2026-10-08) has no corresponding classic pack
  (ww48 only has a G2 and a DESIGN IT); stale draft or intended? Housekeeping only.
- The `[wN]` convention is documented in `docs/recon/w5c-content.md:55-57`, not in SEEDING §3; a new author of a
  classic EB would not find it.

### 2.4 Code-truth spot checks (46/46 correct)

tracer A: `apps/api/src/auth/tokens.ts:3-6` (32-byte base64url) ✓; `docs/curriculum/sprint-02.md:28-29` ✓;
`auth/session.ts:35-43` expiry on lookup ✓ and `:41` never deletes ✓; `auth/state.ts:3-15` timingSafeEqual ✓;
`ws.ts:138-147` auth at upgrade, user pinned on socket ✓; `routes/auth.ts:87-91` logout deletes row + clears cookie ✓;
`server.ts:41-43` CORS origin WEB_URL + credentials ✓; `session.ts:24-25` sameSite lax / secure in prod ✓.
tracer B: `packages/shared/src/authz.ts:9-19` ✓; `routes/issues.ts:251-261` load-then-gate ✓; `guards.ts:26-27`
requireAdmin → 403 ✓; Session model has no role ✓; `routes/invites.ts:15-36` 7-day hashed token ✓, `:33` logs raw token
✓, `:38-58` no email comparison, used-check before tx, unconditional acceptedAt update ✓, `:45-55` guestTeamIds: [] ✓;
`issues.ts:298-304` delete = team gate only ✓; `issues.ts:264-284` assigneeId unchecked ✓; `routes/auth.ts:18-53` dev
provider fallback + open redirect ✓; `routes/me.ts:11-19` assignee-only filter ✓; `auth/oauth.ts:64-71` noreply
fallback ✓; `guards.ts:35-50` ✓; `routes/search.ts:21-34` loop ✓; Membership has only createdAt ✓.
G2 w22: `webhookRepository.ts:29-37` PENDING only ✓, `:53-64` FAILED + nextAttemptAt +60 s + attempts increment ✓;
`webhookService.ts:30-37` PROCESSED short-circuit ✓; `schema.prisma:211` (status, nextAttemptAt) index ✓.
G2 gitjira: `issue.service.js:36-43` global-client findFirst before tx ✓, `:51-56` counter increment inside tx ✓;
`fractional-index.js:30-33` throws on a ≥ b ✓; `issue-schemas.js:52-55` position min(1) ✓.
G2 netslack: `WorkspaceService.cs:26` `.Trim()` on null ✓; `Workspace.cs:57-69` private NormalizeSlug ✓; `:42-55`
DbUpdateException recovery ✓; `ExceptionHandlingMiddleware.cs:23-30` mapping table ✓; `WorkspaceConfiguration.cs:17` unique slug ✓.
G2 tracer-net: `Program.cs:83-86` limiter before auth ✓; `WriteRateLimiter.cs:54-58` raw header partition ✓, `:39-44`
reads unmetered ✓, `:50-52` config permit limit ✓.
netgum: `DependencyInjection.cs:19-20` EnableRetryOnFailure ✓; `Program.cs:47-58` DomainException→400,
InvalidOperationException→409, default 500 ✓. masternext: `lib/authz/scopes/crm.ts:12-43` OR(assigned_to, createdBy)
+ updateMany count > 0 ✓. payments-lab: `refundService.ts:25-36` reads outside tx ✓ (set-C q1.kp3); `paymentService.ts:62-84`
header-present + same-body only ✓ (set-C q0.kp0).

## 3. Coverage matrix (canonical CRUD / system-design interview topics)

Legend: **D** = a DESIGN IT set owns it; **c** = classic EB only; **s** = sysdrills module only; **–** = nothing.
Already-listed ideas (SEEDING §8 report items, handoff "Next ideas") are marked (listed).

| Topic | Status | Owned by |
|---|---|---|
| Idempotency (keys, retries, webhooks) | D | payments-lab A/B/C, masteropen, dotnet-stripe, w22, meterforge; classic stockade, netgum |
| Pagination (keyset vs offset, counts) | D | ww48 pipeline board; classic support-hub; sysdrills 05 |
| Caching & invalidation | D | opusorganize caching A/B, bazaar coherence A/B, groktuts listing A/B, url-shortener |
| Rate limiting / admission | D | 3buildanalytics A/B, javabootcamp rate-limited API, 10x-load; G2 tracer-net |
| Auth / sessions / OAuth | D | tracer A/B, dotnet-auth, zz1 A/B; sysdrills 18 |
| RBAC / object-level authz / sharing | D | organized-build-ecom, linkwarden A/B, tracer-B, masteroutline search; classic masternext |
| Multi-tenancy | D | grok-build-multitenant A/B/C, zz1 A/B, jsprojectlearn Q2 |
| Background jobs / durable execution | D | scedulingpyjs A/B, temporal-lite, opusorganize durable A/B, relay ops, zz7, javabootcamp job queue |
| Search (FTS, permission-filtered, freshness) | D | masteroutline A/B, tenant-search-indexer A/B, ww48 (trigram) |
| File uploads / object storage | D (.NET only) | dotnet-drop A/B; zz7 (export files). No Node/presigned-URL/S3 set |
| Webhooks — outbound | D (no set-B) | campusops |
| Webhooks — inbound | D | w22 A/B, payments-lab |
| Notifications / fan-out / email | D | support-desk-crm A/B, netslack A/B, javabootcamp feed fan-out, masteropen paging |
| Audit logs | D | icms A/B; zz7 Q0 |
| Soft delete | s / c | sysdrills 16 (soft delete vs unique index); classic jsdrillv2, masternext Q2. **No design set** |
| Schema migration / backfill | D | opusorganize zero-downtime A/B/C; classic jsdrillv2 |
| Observability (logs, metrics, traces, SLOs, alerting) | s / partial | sysdrills 14; 10x-load set-C (health checks, absent-signal alerts); classic 3buildagentteachgem Q1. **No design set** |
| Feature flags / staged rollout | D | cal-com A/B |
| Consistency (read-your-writes, replicas, lost updates) | partial | jsprojectlearn Q1 (replica lag), bazaar inventory, netgum/ww18 classic (lost update), sysdrills 11/16. No set on "which consistency where" for a CRUD app |
| Outbox | D | support-desk-crm, masteropen, opusorganize saga; classic helios-outbox |
| CQRS / read models / projections | partial | masterumami rollups (read side); dotnet-intercom (CQRS-lite, **no EB**). No set |
| Event sourcing | – | none (low priority for CRUD apps) |
| API versioning / deprecation / error contract | – | classic ww18 (error mapping), G2 zz8/ww48 (500s). **No design set** |
| GraphQL vs REST | partial | mastertwenty generated GraphQL A/B (generation, not the choice) |
| BFF / API gateway / token handling for SPAs | – | dotnet-auth touches SPA+PKCE; no BFF set |
| SSR / RSC / server-actions data flow & cache | c only | fableopusrecallv2, nextcrm-app, 3buildagentteachgem classic; sysdrills 17 (client data layer). **No design set** — the owner's primary stack |
| Realtime (WebSocket/SSE scaling, presence) | D | netslack A/B, masteroutline CRDT, jsprojectlearn-B; sysdrills 17 (SSE across tabs) |
| Offline / optimistic UI / sync | D | master, jsprojectlearn-B |
| i18n / time zones | partial | netcalendy A (DST, zones), scedulingpyjs; no i18n (locale, translations, currency formatting) set |
| Accessibility | – | none |
| Testing strategy (pyramid, DB isolation, contract, flaky) | c / G2 | classic folio-app, grok-build-team/ecommerce; G2 stop conditions; gitjira ADR 0022 (rollback isolation) **unused**. No design set |
| CI/CD / deploy / rollback / release safety | – | opusorganize 13-release-safety cited by 10x-C only; sysdrills 15 (drain budget). No set |
| Cost / capacity planning | s | sysdrills 10; 10x-load set-B (connection budget). No set |
| Bulk import (CSV, validation, dedupe, partial failure) | c | classic relay-app ADR-0007, relay-upskilling; enterprise-lms (CSV import, **no EB**). No design set |
| Data history / GDPR erase / retention | – | (listed: SEEDING §8 cw report item) |
| Booking / inventory / money | D | netcalendy, bazaar inventory, enterprise-billing, meterforge, harbor SLA |

## 4. Repos in `.cache/checkouts` with no explain-back

217 checkouts, 162 with ≥ 1 EB item, **55 without**. Of the 55, 49 have a campaign quest AND a quest pack (so a classic
EB is campaign-linkable); 6 have neither (Opusboot1 has a quest but no pack; clinical-trial-tracker,
workspace-overview, world, ww16, ww37 are not in the campaign — ww16 was tried and reverted in cw for that reason).

Duplicates of repos that already have an EB under another name (not real gaps): organized-study-{umami, twenty,
idurar-erp-crm, nextcrm-app*, morphic, openstatus} ≈ master{umami, twenty, idur, next, morphic, open};
organized-dotnet-{calendy, slack} ≈ net{calendy, slack}; organized-build-{agenthelpdesk, agentteaching} ≈
3buildagent{helpdesk, teaching} (both without EB); organized-js-training-reactbullet ≈ reactbullet;
organized-grav-vg-vg/vgdemo ≈ gitvg-astra/organized-dotnet-vg family. (*nextcrm-app has an EB.)

Best architecture-walkthrough candidates (Node/React/TS CRUD first; all have a quest pack unless noted):

| Repo | Stack | Why it is a good walkthrough | Pack |
|---|---|---|---|
| organized-anti-helpdesk | Express + Prisma + TanStack Query, multi-tenant CRUD | the canonical owner stack; tenant filter + React Query cache keys; docs over-claim (SEEDING §8) → good "defend or indict" | yes |
| organized-experiment-ww43 | Next.js, optimistic concurrency + collaborator permissions | OCC / lost-update walkthrough with a known stale-draft doc error (§8) | yes |
| organized-experiment-ww45 | Next.js, Postgres FTS via Prisma.sql, React Query | search + editorial state; known bugs (404-for-everything, totalCount 0, tags OR) | yes |
| organized-experiment-ww10 | Next.js, workflow state machines, provider reconciliation | state-machine + reconciliation walkthrough; known UI error-path gap | yes |
| 3buildagenthelpdesk / organized-build-agenthelpdesk | Node modular monolith, real Postgres tests | modular-monolith boundaries, PR-by-PR delivery | yes |
| organized-js-training-jstrain5 | Next.js, Auth.js RBAC, Drizzle, envelope responses, worker | the only Drizzle + Auth.js repo; envelope API contract | yes |
| forgeai | Node, tenant scoping, reservations, durable workflows | mid-level systems study per campaign notes | yes |
| master1 / master2 | Next.js modular monolith; tenant-scoped payment webhooks + worker jobs | sibling of `master` (which has a DESIGN IT) | yes |
| organized-study-enterprise-lms-certification-platform | Next.js, versioning, grading workflows, outbox, CSV import, migrations | the CSV-import gap above | yes |
| organized-study-globalwork-eor-platform / organized-anti-testbuild | NestJS, multi-tenant RBAC, state machines | the only NestJS CRUD repos; contrast with Express/Next | yes |
| organized-study-hoppscotch-app / gitroom / formbricks | NestJS + Temporal / Next+Prisma monorepo | large real clones; TOCTOU, OAuth token handling, quota race seams | yes |
| devpractice | pnpm monorepo, Prisma, sandboxed code eval | sandboxing/trust boundary (pairs with bootlocalopusv2) | yes |
| .NET: dotnet-intercom (SignalR, CQRS-lite, Testcontainers), dotnet-ai-rag (outbox table, RBAC), netzen (ticket workflow + authz), netarchitectureproject (DDD modular monolith, C4), agora-net | csharp-dotnet | the CQRS/MediatR and SignalR gaps; dotnet-intercom is the only CQRS-lite repo | yes |
| Opusboot1 | Next.js course (missions: ownership defect, N+1, idempotency, concurrency) | rich (5) but **no quest pack** → needs a pack first | no |

Not candidates: ankijs/astraspacegameweb (not CRUD), buildsql/atlas-swe-bootcamp (courses), elihyper/eliapplybot
(extension/CLI), reactbullet (frontend conventions only; a frontend-architecture EB would fit but is not sysdesign).

## 5. Proposed new content (ranked by value for a JS/TS+React / .NET / Java senior-CRUD interview target)

1. **DESIGN IT primary — "Next.js data flow: server components, server actions, caching and revalidation for a CRUD
   app"** (repo: `organized-study-nextcrm-app` or `fableopusrecallv2`; alt `3buildagentteachgem`). The owner's main
   stack has no design set. Angles: RSC/client boundary and what crosses it (Decimal/Date lie); where fetching lives and
   N+1 across components; server action = public endpoint (validate + authz inside); `revalidatePath/Tag` vs React
   Query ownership; optimistic UI and rollback; streaming/Suspense and loading states; caching layers (fetch cache,
   route segment, CDN) and what invalidates each. PRE-MORTEM: stale list after mutation, action called with another
   user's id, form double-submit. Effort M.
2. **DESIGN IT primary — "Observability for a CRUD web app"** (repo: `3buildagentteachgem` observability package, or
   `pulse`/`masteropen`). Angles: request id through API → job worker → email; structured logs vs events, fingerprint
   grouping; RED/USE metrics per route and per dependency; traces across the outbox hop; SLOs and alert on absence;
   PII in logs (pulse G2 finding); what a 500 looks like to the user vs the operator; dashboards that lie (queue length
   vs completions — reuse 10x-C). Effort M.
3. **DESIGN IT primary — "Testing strategy and release safety for a CRUD app"** (repo: `gitjira` — ADR 0022 rollback
   isolation, docker-compose Postgres, race suites; alt `opusorganize` 13-release-safety). Angles: pyramid and what each
   layer may stub; integration tests against real Postgres with transaction-rollback isolation and when to opt out
   (races, constraints); contract tests for the API envelope; flaky-test policy; migrations in CI; preview envs; rolling
   deploy + drain; rollback vs roll-forward; kill switch via flag. PRE-MORTEM: green suite, broken prod. Effort M.
4. **DESIGN IT primary — "API contract: versioning, deprecation, errors and envelopes"** (repo: `tracer-net` RFC 7807
   ProblemDetails + API keys; alt `organized-js-training-jstrain5` envelopes, `ww18` error mapping). Angles: what is a
   breaking change; URL vs header versioning vs additive-only; sunset headers and client telemetry; error shape (code,
   message, details, request id) and the 4xx/5xx boundary (ww18/zz8/ww48 500s as the anti-pattern); pagination/filter
   envelope; idempotency key header; SDK generation from OpenAPI; BFF for the SPA (token handling, aggregation).
   Effort M.
5. **DESIGN IT primary — "Bulk CSV import: validate, dedupe, partial failure, idempotent re-run"** (repo:
   `organized-study-enterprise-lms-certification-platform` CSV import, or `relay-upskilling` import mapping). The
   import twin of zz7's export. Angles: upload → staging table → validate → preview → commit; row-level errors and
   partial success contract; natural keys and upsert; re-running the same file; 600k-row streaming; audit of who
   imported what; encoding/locale traps; Excel formula injection on the way back out. Effort M.
6. **Set-B retakes for the 17 primaries without one** (endorse handoff idea 1), in this order: campusops outbound
   webhooks (B: signing, replay, consumer-side verification and the "one webhook per event vs per state" choice);
   dotnet-auth (B: SPA token handling — BFF vs in-browser tokens, refresh in a tab storm, logout everywhere);
   organized-build-ecom (B: permission caching and stale claims after a role change); ww48 (B: the board's write side —
   drag/drop reorder with fractional keys, optimistic move, concurrent moves → borrow gitjira's finding); zz7 (B:
   scheduled recurring reports + email delivery + retention); master offline edits (B: conflict UI and merge rules
   per field); relay (B: upgrading workflow definitions with in-flight runs). Effort S each.
7. **Classic architecture EBs on no-EB JS/TS repos** (endorse handoff idea 4), first five: organized-anti-helpdesk,
   organized-experiment-ww43, organized-experiment-ww45, organized-experiment-ww10, organized-js-training-jstrain5
   (all campaign-linked, packs exist). Use the cw template (walkthrough / explain-the-drift / defend-or-indict with
   numbers). Effort S-M each.
8. **DESIGN IT primary — "Soft delete, data history and GDPR erase"** (listed in SEEDING §8 as a report item; endorse).
   Repo: `masternext` (soft-delete gaps doc) or `jsdrillv2`. Angles: soft delete vs unique index (sysdrills 16),
   cascades, read-path filters, restore, retention jobs, erase vs anonymise, backups and audit rows that must survive.
   Effort M.
9. **G2 briefs on .NET/Java** to balance the 13/6/1 split: `dotnet-intercom` (SignalR + CQRS seam), `netzen` (authz
   fix), `javabootcamp` module bug (a real code G2, not a design one). Effort S each.
10. **Re-author the 10 weakest unweighted classic EBs** as weighted scenario sets (new set-B siblings rather than
    editing, to keep the frozen items byte-identical): formforge, jsdrillv2, relay-app, fableopusrecallv2,
    csharp-interview, bootlocalopusv2, jstrain2.2, jsprojectlearn (case-study 09), js1, storefront — the ones with the
    verbatim note/quiz overlaps in §2.2 K2. Effort S each.

## 6. Format ideas (what would make the practice closer to a real interview)

1. **Real weights.** Parse `[wN]` in the factory into a `weight` field; the client shows weighted coverage and the gate
   becomes "weighted ≥ 70% and every w3 covered" for DESIGN IT/G2, plain coverage for unweighted legacy sets. Today the
   "every [w3] hit" rule is honour-system only (K1).
2. **Blind mode for [senior] sets (K3).** Show only the scenario; reveal the section list after the answer is stored.
   Score "did the candidate raise the section unprompted" as a separate signal.
3. **Follow-up probe (adaptive Q4).** After self-score, generate one pointed probe from the highest-weight kps marked
   `missed` ("You did not say how a stolen laptop's open WebSocket is cut. Walk me through it."), answered in the same
   practice-retake channel (0 XP). This is what an interviewer actually does next.
4. **Time box.** A visible timer per question (DESIGN IT Q0 20-25 min, PRE-MORTEM 10, TRADE-OFF 10; classic 8 min);
   record elapsed time with the answer so the owner can see "right but slow".
5. **Model answer after grading.** For DESIGN IT sets, a short synthesised answer (one paragraph per section, built from
   the kps and their quotes) shown after the self-score, so the learner sees *how* a strong candidate would say it,
   not just a checklist. The kps already carry the text; the factory can assemble it deterministically.
6. **Numbers check.** Where a kp is arithmetic (17,500 tasks/s; 200 rps; 1 GB cache), add an optional numeric field the
   client checks automatically; self-ticking arithmetic is the most self-flattering tick.
7. **Section labels on kps** (requirements / API / data / consistency / scale / failure / ops / trade-off) so Stats can
   show which interview section is repeatedly missed across sets — today the only signal is per-set coverage.
8. **Diagram prompt.** DESIGN IT Q0 asks for a components list / ASCII box diagram as a separate text box; graded by a
   kp like "names the queue, the worker and the object store as separate boxes".
9. **"What would you change in this repo first?"** as the last kp of every classic set (the cw sets already end with a
   verdict + first change; make it the convention and weight it w2).
10. **Author guard additions.** Lint: (a) the prompt must not contain a kp's distinctive noun phrase (K5); (b) EB↔note/
    flashcard/explanation/EB overlap (K2); (c) every DESIGN IT kp whose cite is a docs/*.md recommendation must say so
    ("the repo does not yet …") (W1).
