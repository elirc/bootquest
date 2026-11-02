# 03 · Ways to upskill to senior SWE for CRUD web-app development

Ideas for features and content. **Nothing here is built.** This is v2, rewritten after three adversarial reviews
([`review/`](review/); what changed is in [`04-REVIEW-RESOLUTION.md`](04-REVIEW-RESOLUTION.md)). Every idea keeps
BootQuest's rules: zero runtime spend (deterministic, local grading), LLM work at seed time only, the honesty
model, and the estate as the source. Effort is S / M / L. **Restamp** means an estate-wide restamp of every pack
(touches `shared/src/{enums,api,check,schemas,seed-pack}.ts`, `server/src/api/runners.ts` or a factory COMMON
file); "none" means it fits in authored units, migrations, `api-ext.ts`, `serve.ts`, store/engine code or the
client. Ids: U = unlock, L = lab, J = judgment format, B = new ideas from review R2.

## 0. The thesis

A senior CRUD engineer is judged on **shipping correct changes to a living system they did not write**, on
**turning a vague need into the right spec**, and on **judgment you can see in writing and review**. BootQuest
today is strong at reading code and estimating systems, small at building, and its truth layer is inert: no
competency can be promoted today (01 §7.3). So, in order:

1. **Use it.** Nothing below matters until the owner has real attempts (0 today).
2. **Switch the truth layer on with what already exists** (the signalpost sync), and make a rating mean
   something (tiered promotion) *before* adding anything that promotes.
3. **Build labs that are real ladder artifacts**, mostly on real repos, with the *spec* hidden rather than the
   tests.
4. **Senior judgment formats** graded by contrast and precision, not by self-scored prose alone.
5. More content in the existing formats (wave C).

What senior looks like (the target):

| Area | Mid-level | Senior |
|---|---|---|
| Requirements | builds the ticket as written | asks the 3 questions that matter, writes non-goals and acceptance examples, says "not yet" |
| Codebase | works in code they know | finds the convention and the blast radius in a large unfamiliar codebase |
| Data | writes a migration | evolves a schema under live traffic (expand/backfill/contract, NOT VALID → VALIDATE on Postgres), owns integrity, erases personal data correctly |
| Concurrency | knows transactions exist | finds the check-then-act race or lost update in a handler and picks the cheapest correct fix |
| API | builds endpoints | evolves contracts without breaking old clients: pagination that does not drift, idempotency, ETags, deprecation |
| Caching | adds a cache | knows when it is wrong: invalidation, stampede, read-after-write, keys that leak across tenants |
| Security | escapes output | threat-models a feature: IDOR, mass assignment, tenant leaks, session mistakes, PII in logs |
| Ops | reads logs | instruments the code so the next incident is answerable, writes the alert, the postmortem and the fix |
| Delivery | finishes tickets | slices an epic, estimates with calibrated ranges, ships behind a flag, plans rollback, upgrades dependencies |
| Quality | writes tests | picks the seam, writes characterization tests before a refactor, reviews others' PRs for the real risk, with precision |
| Ownership | closes the ticket | lives with earlier decisions, follows up after rollout |
| AI | uses an assistant | directs agents on CRUD work and reviews their diffs |

Not practisable solo, so not simulated: mentoring others, team conflict, incident command.

## 1. Zero-build and near-zero-build steps (do first)

| # | Step | Detail | Restamp | Effort |
|---|---|---|---|---|
| U0 | **Dogfood now, build nothing.** | Run `docs/DOGFOOD.md` (already exists) for ~10 real sessions on the new small slate; log surprises in `LEARNING.md`. Freeze new waves until ≥ 30 recorded attempts. Set a weekly hour budget and size everything below against it (the lab ideas here add up to 150-250 learner-hours). | — | 0 |
| U1 | **Sync signalpost on the owner DB.** | `bootquest sync` registers U01-U03 as program units with real node:test checks, links their committed explain-backs and arms their drill-js retests (`ladder-real.test.ts:239` proves a full promotion on exactly this). Language-fluency, feature-delivery, code-reading and testing-verification become promotable. | none | 0 (needs GitHub access) |
| U2 | **Close the G3/G4 dead end.** | Add an explicit artifact → explain-back link field to the server-local `AuthoredUnitsFile` (`store/ladder.ts:98`), author a G2-family EB set for G4 and a variant for G3; update the ladder-real pins. Opens agentic-engineering. | none | S |
| U3 | **A short "Senior CRUD path".** | ≤ 40 ordered stops, served by the slate: signalpost U04-U07, bootforge fullstack-crud (pagination, idempotency, transactions, optimistic UI drills), L7 katas, then labs as they land. A path entry naming a missing unit warns, never fails the boot. | none | S-M |
| U4 | **Placement, not test-out.** | A timed placement exam of *production* items (drills, predict-output; never MCQ) per course or act. Passing it is a real pass of its own unit, and an act may count that unit as an explicit unlock leg (the campaign rule is verified pass + level gate, so a 0-XP "tested out" status would unlock nothing, `engines/campaign.ts`). Skipped units come back at a low interleaved sample rate rather than vanishing. Only build it if dogfooding shows the fundamentals actually block. | none | M-L |

## 2. Make a rating mean something (before any lab promotes)

**B1 · Tiered promotion.** Each project unit declares a `tier` 1-5. An artifact can promote a competency only to
`min(rating + 1, tier)`, and notches 4-5 need artifacts from two different codebases. Without it, four easy
tickets in one week read as "5/5" (`evidence.ts:17-35` counts every artifact the same). Restamp: none if `tier`
lives in authored-unit / program-unit metadata and the engine; restamp if it goes into a fingerprinted schema.
Effort S-M.

**B5 (decay half) · Build skill can decay.** Today demotion fires only on recall-card lapses, so a competency
promoted by *building* is demoted by forgetting an unrelated *flashcard*. Re-expose each passed lab as a changed
ticket at ~1 week and ~1 month (see B5 below); a failed re-exposure feeds the demotion rule.

**B7 · Calibration on your own work.** Before each lab, ticket or kata submit: a 50% and 90% time estimate and
P(pass on first submit). The server derives `elapsedMs` (first open → submit; never client-supplied) and records
the verdict. Show the 90%-interval hit rate and the Brier score per competency over time. Objective, arithmetic,
display-only. Replaces the draft's self-score-vs-self-score "calibration". Restamp none (new endpoints in
`api-ext.ts`, a migration with append-only triggers). Effort S.

## 3. Build labs (the core)

### Where they live
- **Default: real repos via the sync path.** signalpost U04-U12 already *is* a senior CRUD curriculum (task API;
  SQL, integrity and migrations; React forms and stale results; permissions and revocation; review; measured
  performance; retry safety; design under change; ownership), with competency aliases mapped (mig 006). Each
  milestone needs an upstream `practice/checks/uNN.test.*` (an owner action in their own repo; BootQuest never edits
  `.cache`), a row in `content/sync/check-specs.json`, an EB set on `docs/curriculum/UNN.md` and a drill-js variant.
  No runner, schema or restamp change. Caveat: signalpost is private and quoted into a public repo — keep quotes
  short.
- **Large existing codebases for transfer**: the estate's big OSS checkouts (organized-study-twenty ≈17k TS/JS
  files, nopsolutionsnet ≈4k C#, formbricks ≈2.3k, openstatus ≈1.8k).
- **A BootQuest-owned reference app** only where a lab needs a controlled bug (L4, L5). If one is built, ship each
  ticket's starting snapshot *without git history*, with hidden tests and solutions in a separate directory, and
  make it a pinned estate repo (explain-backs need pinned provenance; ordinary EB sets must be campaign-linked,
  `ladder-real.test.ts:141`).

### Constraints every lab inherits (from review R3)
- **Retests are drill-only.** A variant's check must be drill-js / drill-cs / drill-java (`shared/src/seed-pack.ts:199`).
  A ticket-shaped retest is a restamp; otherwise leg (c) is a drill-js substitute (as the http-tasks-api variant
  already is). Prefer the substitute.
- **No `vitest-project` runner exists** (schema only; API answers 501). Labs that need a DOM or a multi-file project
  wait for one, merged in `serve.ts` as drill-java was (no restamp), with a nonce reporter or documented as the
  third non-nonce exception.
- **Hidden tests are honor-system on disk** like every other key in `content/`. State it in the README.
- **Hidden suites run on submit only.** On `run`, use the visible tests; on a failed submit, show test *names*, not
  assertions — otherwise the hidden suite becomes an answer oracle.
- **Labs and the daily loop:** a 4-hour lab must not lose to five 5-minute drills. Let a lab checkpoint count as
  the day's slate (or occupy the slate for its duration) and pay XP per checkpoint.
- **Interleave categories and include clean items** in every lab family (no announced "this is the race lab"),
  and score precision as well as recall: blocking a PR for a non-issue is a senior failure.

### The labs

| # | Lab | What the learner does | Grading (deterministic) | Restamp | Effort |
|---|---|---|---|---|---|
| L1 / B3 | **Spec-hidden feature tickets** | Gets a vague product request. (1) Picks ≤ 5 of ~12 clarifying questions before seeing answers. (2) Writes acceptance tests, stored answer-first: they must pass on the reference implementation and kill ≥ K of N seed-authored plausible-wrong implementations. (3) Builds; the hidden suite runs on submit. Topics: cursor pagination that does not drift, optimistic concurrency (If-Match / 412), idempotent create, soft delete + unique constraints, audit log, tenant isolation + RBAC, CSV import with a row report, outbox job, N+1 with a query-count assertion, API evolution with recorded v1-client replay, a dependency major bump, cache invalidation, GDPR erase/export. | menu key (precision + recall), mutant-kill count, hidden suite | none on the signalpost route | M per milestone batch; L+ for a new app |
| B2 | **Bring-your-own ticket** | Any real change in any repo (estate, OSS checkout, or the owner's job code kept local) counts if it meets predicates. | a **fail-to-pass** test (fails at base sha, passes at head; the one new predicate), full suite green, diff touches ≥ 2 layers, PR has Problem / Non-goals / Risk / Rollback / Verification (`pr-has-section`, as G3); EB leg = a generic weighted senior rubric; retest = the next BYO ticket in a different repo | none (repo runner + one predicate) | M |
| B4 | **Large-codebase navigation and blast radius** | On twenty / nopCommerce / formbricks: "where is tenant scoping enforced for X?" (path:line ranges); "which files must change to add field Y / rename Z?" (a file set). | range or set match vs a key made at seed time by actually making the change on a scratch copy | likely (new answer shape) | M |
| L2 | **Schema migration lab** | Writes expand → backfill → contract for a breaking change. | old and new app versions run against the DB between every step; any error or lost row fails | none (drill-js) | M |
| L3 | **Query-plan lab** | Writes the query and the one index that serves 3 queries; trade-off items ("this index costs writes X%: worth it?"). | result + coarse `EXPLAIN` regex (no `SCAN <hot table>`, index used) with a version floor. No rows-touched budget (not measurable via node:sqlite) | none | S-M |
| L4 | **App-level race lab** | Watches a check-then-act race, double submit, retry duplication or cache stampede happen, then fixes it. | an interleaving harness over an *injected async store* (switches only at its yield points); DB isolation, write skew and `FOR UPDATE` are modelled and labelled as a model | none (drill-js) | M-L, after a 1-2 day spike |
| L5 | **Security: exploit, then fix** | "One endpoint is exploitable, or none is." Write the exploit as a test, then fix. IDOR, mass assignment, tenant leak, SQL injection, session/JWT mistakes, PII in logs first; CSRF/XSS/SSRF need a browser or network and come later if at all. | exploit test passes on the vulnerable commit, fails after the fix, feature tests stay green | none on data-http (a new `security` competency = restamp) | M |
| L6 + B6 | **Incident → instrument → alert** | Gets a broken service + recorded telemetry. (1) Picks the root cause (commit / line / config) and writes the finding before the key. (2) Ships the fix as a fail-to-pass test. (3) Writes the alert rule as a JS predicate over the metrics. (4) Adds the log field / metric that makes "which tenant caused the spike?" answerable by a given query. Postmortem prose is secondary and self-scored. | key match; fail-to-pass; alert must fire within T on K incident traces and stay silent on M normal traces; query over emitted JSON logs | none (kata context must be byte-identical to a pinned repo, so telemetry is committed to an estate repo) | M-L |
| L7 | **PR-shaped review katas** (priority up) | Multi-file PRs with senior defects (migration without backfill, unbounded query, authz in the wrong layer, non-idempotent retry, timezone, PII in logs, missing index, stale cache) **plus clean PRs and nit distractors**, and agent-written PRs. Approve/block decision + severity rank. | catch rate *and* precision; decision and rank key | none (the patches generator already takes multi-file diffs) | S-M |
| L8 | **Legacy refactor** | Characterization tests first, on a messy estate repo; then refactor. | the learner's tests must pass on the legacy code and kill N inlined planted versions (drill-js pattern; Stryker cannot target planted mutants and is self-reported) | none | M |
| L9 | **Frontend labs** (trimmed) | Forms with accessible errors, optimistic update with rollback, cache invalidation after a mutation, loading/empty/error states. | Testing Library in jsdom; axe catches only a minority of a11y issues (say so); no layout-dependent tests | none if the runner is merged in `serve.ts` | M-L, after a vitest runner |
| B5 | **Mystery-ticket pool with spaced re-exposure** | Bug tickets with the category hidden (race, N+1, authz, migration, stale cache, timezone, or "works as designed"), served by the slate ~1 d / 1 w / 1 m after a lab is passed. Classify + cite the evidence line, then fix with a fail-to-pass test. A failed re-exposure feeds demotion. | key + runner | none | M, once ≥ 3 labs exist |

## 4. Senior judgment formats

Grade by **contrast and precision** first; self-scored prose second. Note: an explain-back's competencies are
hard-coded by family (`store/ladder.ts:240`: ordinary → language-fluency, DESIGN IT → system-design +
communication, G2 → agentic-engineering + communication). A J-format feeds `communication` only as a DESIGN IT /
G2 set, a new family (code change, no restamp), or a repo-task.

| # | Format | Grading | Effort |
|---|---|---|---|
| B8 | **Contrasting cases** (before writing anything): three seed-authored variants of a design doc / ADR / PR description / review comment / postmortem (strong, plausible-but-flawed, weak); rank them and tag each flaw from a fixed list before the key. | rank + tag key (quiz or kata flow) | S-M, mostly content |
| J5 | **PR description + rollback plan** on a real lab or BYO PR | `pr-has-section` predicates (Risk, Rollback, Verification) as G3: the one J-format that is a real leg (a) for communication | S-M |
| J1 | **Design doc as the gate of a ticket** (design before build, not standalone DESIGN IT in a new costume: 87 sets exist) | B8 first, then evidence-anchored self-score (quote the span of your doc for each key point) | M |
| J2 | **ADR for a decision visible in code that has no ADR** (so the model answer cannot be recalled) | key authored from the code at seed time | S-M |
| J3 | **Design-doc review** with clean sections and false-positive scoring | kata flow (the patches generator on a markdown doc) | M |
| J4 | **Scoping**: slice an epic, order the tickets, name the first thing to de-risk | ordering validity + de-risk key; estimates calibrated by B7 on the owner's own lab times | S-M |

Merged: the postmortem (J6) into L6. Deferred: interview mode for DESIGN IT (J8, wave D; probe fields would be a
restamp unless encoded as alternate sets). Cut: STAR behavioural prompts (J7: rehearses a performance, and
personal career content would sit in a public repo) and the promotion-packet export (U5: a self-graded export
carries little weight; real PR links from B2 do).

## 5. More content in existing formats

- **Wave C as planned** (REVIEW-2026-10-30 §4): jsdrills, sysdrills 19-21 (transactions & isolation, background
  jobs & leases, HTTP caching), csdrills 11-12, javadrills 12-13, DESIGN IT set-Bs, React data-layer and C# quest
  packs. Still valid; after U0-U3 and the first labs.
- **Classic explain-backs for CRUD-heavy repos without one** (55 repos lack one): twenty, formbricks, idurar-erp-crm,
  hoppscotch-app, umami, openstatus, nopsolutionsnet, bazaar-app — each must be campaign-linked (`:141`).
- **Candidate sysdrills**: pagination drift and cursor math; rate-limit algorithm numbers; upload/storage limits;
  notification fan-out cost. Check overlap with modules 03/09/16-18 first.
- **Not recommended**: ASP.NET and Spring twins of every lab (they add language fluency, not seniority). One C# BYO
  ticket is the transfer test instead; the Java web leg stays in wave D.

## 6. Process ideas

- **Remediation loop at seed time**: export weak spots + flagged items → a seed session authors targeted items.
- **Restamps are rarer than they look.** Only a new competency, a new check type, non-drill variant checks and new
  explain-back item fields (J8 probes) truly need one; runner merges in `serve.ts`, `api-ext.ts`, authored units and
  server-local schemas avoid it. Bundle the true ones into one planned restamp.
- **Authored units skip every seed validator** (wrong-solution filter, blind-pass, leak lint): each authored lab
  needs hand-written ladder-real tests, as G4 has.

## 7. Suggested order

1. **U0 dogfood** (this week, zero build) and an hour budget.
2. **U1 sync signalpost + U2 close G3/G4** → 5 of 8 competencies promotable.
3. **B1 tiered promotion + B7 calibration + the fail-to-pass predicate**, together.
4. **U3 senior path** (short, signalpost-led).
5. **One tracer-bullet lab**: signalpost U07 as an L1/B3 spec-hidden ticket, dogfooded end to end incl. its EB and a
   retest in a *different* repo. Reorder everything after this by what hurt.
6. **L7 with clean PRs + B8 contrasting cases** (best value per hour, mostly content).
7. **B2 bring-your-own ticket** (real work becomes the main promotion source).
8. **B4 navigation, then L2/L3** (Postgres semantics via PGlite if it resolves in the runner; otherwise SQLite with
   the differences stated).
9. **B5 mystery pool** once ≥ 3 labs exist.
10. **L6+B6, L5, L8, L4 (after its spike), L9 (after a vitest runner)**; then wave C, then U4 placement if the
    dogfood shows it is needed. System design (already the strongest area) gets its promotion path last.
