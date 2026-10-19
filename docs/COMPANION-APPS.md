# Companion apps — standalone builds alongside the campaign

Six large webapps to build **outside** this repo, one per campaign phase, each picked to avoid
domains the estate already covers (helpdesk, CRM, jira/slack/calendly clones, pastebin, todo,
HRIS, e-commerce, gumroad/subbox, analytics, feedback board, job tracker, recipes) and to turn
what BootQuest drills into something real.

## Working rules (apply to every app)

These mirror the honesty model — the point is real skill, not shipped features:

- **LLM scaffolds, you own the core.** Let the LLM write boilerplate, config, migrations, and UI
  chrome. Write the core domain invariants solo — they are your promotion-ladder leg (a)
  artifacts, currently the scarcest evidence type in the system.
- **Review every LLM diff like a kata.** Evidence, file:line, defect named, before merging.
  This is G1 practiced on live code.
- **Brief before delegating.** Write a G2-style delegation brief for any feature you hand to the
  LLM: context, constraints, acceptance checks, what the agent must not touch.
- **Run the estate loop.** Keep `docs/guides` as you build. When an app stabilizes, add the repo
  to `curriculum.yaml` and run a seed session — your own app becomes new BootQuest quests
  (rule 4: the estate is the content).
- **One app at a time.** Start each when its act's material is fresh; finish before the next.

## The apps

### 1. Group expense ledger with settlements — JS/TS track, acts 2–3 (start now)

Split bills, double-entry **append-only ledger**, debt-graph simplification, idempotent payment
recording, receipt parsing via an LLM API call. Exercises the money/validation drills; the
ledger invariant ("no row ever rewritten") is BootQuest's own discipline applied to a new domain.

- **Solo:** the ledger engine and settlement algorithm (+ property tests on conservation).
- **Delegate:** UI, import/export, the receipt-parsing pipeline.

### 2. Event ticketing with seat holds — C#/.NET, acts 3–4

Seat maps, timed holds, contention on the last seat, optimistic locking vs write skew,
hold-expiry background jobs, payment idempotency keys, webhook outbox. The ticket-booking
design rubric and the campusops race kata made real.

- **Solo:** the reservation state machine and its concurrency tests.
- **Delegate:** seat-map rendering, admin screens.

### 3. Community feed with notifications — JS or C#, act 4

Posts, follows, fan-out on write vs read, unread counts, digest batching, per-user rate limits,
cache invalidation. Operationalizes the feed-fanout and rate-limited-API rubrics.

- **Solo:** the fan-out strategy and cache correctness.
- **Delegate:** everything visual.

### 4. Warehouse/order service in Java — after javabootcamp modules 09–13

The Java track is drills-only today; this is the "now deploy it" step. Spring Boot REST service
with JPA, **transactional outbox + consumer**, cache-aside Redis layer, token-bucket rate
limiting, snowflake IDs, thin React admin. One service using all five system-design modules at
once.

- **Solo:** transaction boundaries and the outbox.
- **Delegate:** DTOs, mappers, the admin UI.

### 5. Self-hosted uptime/observability platform — cross-track, ~act 5

Check scheduler, ingestion with bounded queues and backpressure, retention windows, alert dedupe
and escalation. Doubles as real infrastructure: point it at apps 1–4. Good polyglot option —
collector in Java or C#, UI in React.

- **Solo:** the ingestion path (queues, backpressure, dedupe).
- **Delegate:** dashboards, notification channel integrations.

### 6. Agentic capstone: PR-review bot for your own repos — agentic track, G1–G4 made real

Fetches diffs, reports findings as `{scenario, evidence, consequence}` (the kata format). Then
**verification-engineer it**: plant known-bad PRs and measure its catch rate the way G4 tests
the wrong-solution filter. The skill is the product — and it then reviews the LLM's diffs on
apps 1–5.

- **Solo:** the finding-verification harness and planted-defect corpus.
- **Delegate:** GitHub plumbing, report formatting.
