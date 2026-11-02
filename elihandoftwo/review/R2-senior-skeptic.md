# R2 · Senior-engineer + learning-science skeptic review of 03-SENIOR-CRUD-UPSKILL-IDEAS.md

Reviewer R2, 2026-11-01, read-only against `main` b3815126. Evidence is cited as file paths. Everything marked
"checked" I verified by reading or counting; everything else is judgment.

## Verdict

The lab list is the right direction. As written, though, it would mostly produce a well-tested *toy-app gym* and
a ladder that says "5/5 senior" after four easy tickets. It also skips the senior curriculum and the
real-repo grader the owner already has, and it schedules yet more building before the first learning attempt.

## Biggest problems (ranked)

1. **The truth layer cannot tell a senior artifact from a junior one, and the plan pours promotion-eligible labs
   into it.** `server/src/engines/evidence.ts:17-35` (checked): a promotion is one notch for *any* verified solo
   project artifact plus its EB plus a ≥48 h retest. No unit tier, no difficulty, no "notch N needs a tier-N
   artifact". So L1 ticket 1 ("add a field end to end") moves feature-delivery 1→2 in exactly the same way that
   ticket 9 (outbox) moves it 4→5. Four tickets in one week (the retest legs can overlap) give "5/5". The thesis says
   L1 "gives 3 stuck competencies a real promotion path". That path has no ceiling discipline, so a rating of 5 stops
   meaning anything. This has to be fixed **before** any lab can promote (idea B1 below).

2. **It plans more building before the first learning attempt, for the third time.** 0 attempts, 0 XP
   (01 §7). REVIEW §1 already said "the owner has never used the app", and `docs/DOGFOOD.md` already holds a
   first-week checklist. U1 answers this with... new instrumentation (S of build) and then a two-week wait. Then
   §6 queues roughly 6 L-sized items plus twins. Nowhere does the plan count opportunity cost or a weekly hour
   budget. The lab ladder (12 tickets × 2-6 h, 8 labs, 8 formats) is 150-250 learner-hours at least. The honest
   risk is that BootQuest becomes the owner's main project instead of the owner's career.

3. **It ignores the senior curriculum and real-repo grading the estate already contains.** Checked:
   - `signalpost-swe-bootcamp` has U01-U12, with U07 "Own a complete feature", U08 "Maintain code with other
     people", U10 "Reliability and operating a service", U11 "Design under uncertain requirements" and U12
     "Ownership, mentoring and readiness". Its tasks are 4-8 h each, already split into PAIR/SOLO/Transfer/Delayed
     check. Only U01-U03 have checks (`practice/checks/u01-u03`) and BootQuest variants.
   - The `repo-task` kind already grades a real repo deterministically by predicates (branch, commits, `ci-green`,
     `pr-has-section`, `file-exists-at-head`; `content/units/agentic.json`, `server/test/fixtures/check-lessons.json`).
   - `http-lab` already checks a live API.

   A large part of L1/J1/J5 is "write checks for signalpost U04-U12 and add one predicate". Building a new
   "Ledgerly" plus ASP.NET and Spring twins from scratch is not needed for that.

4. **Hidden tests plus a free `run` make an oracle, so the ticket ladder trains you to satisfy a spec rather than
   find one.** The honesty model refuses `run` only for quiz/predict (README "Run is free"). If a ticket's hidden
   acceptance suite runs on `run`, the learner iterates against it and learns test-driven guessing. If it does not,
   the learner gets no feedback. The plan says neither. More fundamentally, a senior's hard part is turning a vague
   need into acceptance criteria and non-goals (signalpost U07 says so itself), and every L1 ticket hands that part
   over pre-done. A senior ticket should hide the *spec*, not the *tests* (idea B3).

5. **The data-layer labs teach the wrong engine for the skills they name.** §0 promises "constraints NOT VALID →
   VALIDATE", `SELECT … FOR UPDATE` and write skew. `node:sqlite` has none of these. SQLite has no NOT VALID
   constraints, has a limited ALTER TABLE (you rebuild the table), runs a single writer (so it is effectively
   serializable, with no write skew), and has no row locks. L2/L3/L4 would teach the SQLite table-rebuild dance and
   an *emulated* lock model, and the learner would learn the emulator. The estate already uses **PGlite**: signalpost
   README says "the normal TypeScript suite uses PGlite to execute actual PostgreSQL semantics locally". That is
   WASM Postgres, npm-only, with no Docker and no spend. Use it for L2/L3 (real `EXPLAIN`, `NOT VALID`, real DDL).
   PGlite is single-connection, so L4 still has to model concurrency: scope L4 to app-level races (check-then-act
   across awaits, double submit, retries) and label its DB-isolation parts as a model.

6. **Blocked practice and always-guilty items train category recognition, not diagnosis.**
   - Every lab announces its category. In the "race lab" the bug is a race; in the "security lab" there is a vuln.
   - Every kata has seeded defects, so the learner learns the base rate "there is always a bug".
   - Real senior work starts with *which kind of problem is this, and is it a problem at all*.

   No idea in the plan interleaves categories or includes clean items. So L7/J3/L5 measure recall (hit rate) with
   no false-positive cost. Seniors are judged on precision too: blocking a PR for a non-issue is a senior failure.

7. **Labs are one-shot; only recall decays.** Labs give one ≥48 h retest, then never come back. Demotion fires
   only on FSRS lapses of quiz/flashcard cards (`evidence.ts` header; `fsrs.ts`). So a competency promoted by
   *building* can be demoted only by forgetting a *recall* card on an unrelated quest. The truth layer promotes on
   one construct and demotes on another. Build skill also needs expanding re-exposure (about 1 w, then 1 m) to a
   *changed* ticket.

8. **Self-scoring is still the leg (b) gate everywhere, and U4 "calibrates" it against itself.** "Self-score
   drift (EB self-score vs the later retest outcome)" compares a self-rated prose rubric with a code retest on a
   different task, so the two are barely related constructs. Real calibration needs an objective outcome: predicted
   vs actual pass on first submit, and estimated vs actual time. Both are available deterministically (idea B7).
   For the J-formats the learner cannot recognise a good design doc yet, so marking key points "covered" on their
   own prose is the generous-grader problem in its purest form.

9. **The formats fit the daily loop badly.** Slate, streak and XP reward many small ticks (01 §2: ≥20 XP keeps a
   streak; the slate is drills plus a campaign step). A 4 h ticket earns one tick and competes with five
   5-minute drills, so the incentive gradient points away from the labs. The plan does not say how a lab occupies
   a slate day, checkpoints, or keeps a streak.

10. **The target in §0 is over-weighted where the estate is already strong and silent where seniors are actually
    judged.** See "Missing senior skills". System design is already ●● (87 DESIGN IT sets + 129 sysdrills) and
    still gets U6 + J8. Language twins (ASP.NET, Spring) triple L1's cost and add language fluency, not seniority.

## Idea-by-idea verdicts

| # | Verdict | Why (one line) |
|---|---|---|
| U1 | **Change** | Dogfood *now* with zero new build (DOGFOOD.md exists). Keep only `elapsedMs` and fold it into B7. Two weeks of fundamentals drills tells you about the loop's UX, not whether labs make you senior. |
| U2 | **Change** | Use test-out as *placement* (unlock an act or course) from production items (drills/predict under a time box), never from MCQ. Tested-out units come back at a low interleaved sample rate. A permanent "tested out" status lets recognition skip what recall cannot do. |
| U3 | **Keep** | Cheap and needed. Cap it at about 40 ordered stops, make it what the slate serves, and lead with signalpost U04-U12 and bootforge fullstack-crud (142 drills on pagination, idempotency, transactions and optimistic UI; checked). |
| U4 | **Change** | Calibrate against objective outcomes (first-submit pass, time), not self-score vs self-score. Brier on self-rated items is circular. |
| U5 | **Cut** (for now) | A self-graded export from a self-built app carries ~0 weight in a real review. Real PR links from B2 do. Build it later as an S. |
| U6 | **Change / defer** | Making a sysdrills module (arithmetic functions) an artifact leg would let estimation promote design. Wait for a design-then-build artifact or interview mode. System design is the least starved area. |
| L1 | **Change** | Right core. But: build it on signalpost U04-U07 + repo-task first; hide the spec, not the tests (B3); run the hidden suite on submit only, and on failure show test *names*, not assertions; drop the twins; make the variant ticket a different codebase for real transfer; add tickets for API evolution with an old-client replay, a dependency major bump, cache invalidation correctness, and GDPR erase/export. |
| L2 | **Keep, on PGlite** | Running old and new app versions between every expand/backfill/contract step is a genuinely deterministic build-the-skill grader. On SQLite it teaches the wrong DDL. |
| L3 | **Change** | Use PGlite `EXPLAIN` (Postgres is the CRUD default); keep the rows-touched budget; add "this index makes writes X% slower: is it worth it?" trade-offs. A SQLite planner is a misleading teacher. |
| L4 | **Keep, rescope** | Distinctive and builds real fear-of-races. Limit it to Node-level interleavings (await points, retries, double submit, cache stampede), state that DB isolation is modelled, and call the effort L. |
| L5 | **Keep, interleave** | Exploit-as-test then fix is generative and deterministic. Don't announce the class: "one endpoint is exploitable, or none is". Cut SSRF/path traversal before IDOR, mass assignment, tenant leak and session handling. |
| L6 | **Change** | Grade the deterministic parts: the root-cause pick (commit/line/config from the snapshot), the fix as a fail-to-pass test, and the alert rule as an *executable predicate* over the metrics (B6). The postmortem prose is secondary, and self-scored. |
| L7 | **Keep, priority up** | Best value per effort in the doc. Add clean PRs and nit distractors, score precision as well as recall, and add an approve/block decision plus severity rank. Include agent-written PRs, which is the 2026 reality. |
| L8 | **Keep** | Characterization tests that must pass on legacy code and kill planted mutants is real deliberate practice. Note that Stryker counts are honor-system (README "What is NOT protected"). Use an estate repo with real mess, not a clean fixture. |
| L9 | **Change, trim** | Keep forms + accessible errors and optimistic rollback. Cut "survives refetch without losing scroll": jsdom has no layout, so the test would be fake. axe in jsdom catches a minority of a11y issues; say so. |
| J1 | **Change** | As written it is DESIGN IT in a new costume, and 87 sets already exist. Make J1 the gate of an L1/B3 ticket (design before build), and grade it with contrasting cases (B8) plus evidence-anchored self-score (quote the span of your doc for each key point). |
| J2 | **Change** | If the repo's real ADR is the model answer and the learner may have read it, this is recall. Pick decisions visible in code with no ADR and seed-author the key from the code. |
| J3 | **Keep** | Kata flow with a deterministic catch rate. Add clean sections and false-positive scoring. |
| J4 | **Change** | Self-scored slicing is weak. Grade the ordering deterministically (dependency validity, "first thing to de-risk" matches the key), and calibrate the estimate part on the owner's *own* lab times (B7). |
| J5 | **Keep** | S, and it attaches to a real artifact. Check it with `pr-has-section` predicates as G3 does (Risk, Rollback, Verification). |
| J6 | **Merge into L6** | Not a separate unit. |
| J7 | **Cut** (unless job-hunting) | STAR answers with no lived senior stories rehearse a performance, not a skill. If kept, use ranked contrasting answers rather than self-scored prose. |
| J8 | **Defer** | Interview skill is not seniority. It is an L already in wave D. Revisit when job-hunting. |

What is new versus REVIEW-2026-10-30 §4: U2-U5, L1-L9 and J1-J7 are new. U1 (QoL instrumentation), U6
(system-design path) and J8 (interview mode) are wave D items re-listed. Wave C content is unchanged.

## Missing senior skills

Missing or barely touched in §0 (roughly in order of how often they decide "senior" in a CRUD job):

1. **Turning ambiguity into a spec.** Clarifying questions, non-goals, acceptance examples, saying no or "not
   yet". It is the first line of signalpost U07 and U11 and absent from the plan.
2. **Working in a large existing codebase.** Navigating, finding the convention, estimating blast radius. The
   estate has the material, checked: organized-study-twenty ≈17k TS/JS files, nopsolutionsnet ≈4k C#,
   formbricks ≈2.3k, openstatus ≈1.8k. A ~2k-LOC Ledgerly written by agents for the app has no legacy, no
   inconsistent conventions and no other authors.
3. **Ownership over time.** Living with your own earlier decisions: the incident caused by *your* ticket-3
   schema, the follow-up after a rollout. Every L1 ticket starts from a fresh canonical commit, so nothing you
   build ever bites you.
4. **API evolution.** Additive changes, old clients that keep working (replay recorded v1 traffic), deprecation,
   contract tests. §0 names it; no lab builds it.
5. **Dependency upgrades and the supply chain.** A major version bump with breaking changes, lockfile review,
   audit triage. This is daily senior work and absent.
6. **Performance profiling.** Measure first: `--cpu-prof`, flame graphs, a p95 budget, a load script. The plan
   has the N+1 query count only.
7. **Caching correctness.** Invalidation, stampede, stale reads after write, cache keys that leak across tenants.
   L7 mentions one defect; there is no lab.
8. **Data privacy.** GDPR erase/export across tables, logs and backups; retention; PII in analytics. One line in
   L5 at most.
9. **Instrumenting, not just reading, telemetry.** Adding the log field or metric that makes the next incident
   answerable. L6 only reads.
10. **Reading production data to answer a product question.** Ad-hoc SQL over events: "did the change reduce
    failed checkouts?" This is unrepresented.
11. **Cost awareness.** What the feature costs per month (query volume, storage, egress). The sysdrills capacity
    and cost module exists but is not tied to any build.
12. **Deploy and CI ownership.** Migrations in the pipeline, env config, secrets, rollback mechanics. Docker hangs
    here, but config- and predicate-level labs are possible.
13. **Reviewing other people's code with prioritisation and tone.** Blocking vs non-blocking, and what to leave
    out. L7 covers catching only.
14. **Directing and reviewing AI agents on CRUD work.** The agentic track (G2-G4) is disconnected from the CRUD
    labs. In 2026 a senior's diff volume is mostly agent-written.

Over-weighted:
- System-design-at-scale (U6, J8 on top of ●●).
- Language twins.
- Behavioural STAR (J7).
- "Mentors" in the Influence row: this cannot be practised solo. Say so instead of simulating it.

## Better ideas (≤ 8)

All are graded deterministically at runtime, with LLM work at seed time only.

**B1 · Tiered promotion (fix before any lab promotes).**
- What: each project unit declares `tier` (1-5). An artifact may promote a competency only to `min(rating+1, tier)`,
  and notches 4-5 need artifacts from two different codebases.
- Why: without this, the labs inflate the ladder and "senior" stops meaning anything.
- Grading: the existing SQL chain plus one comparison.
- Effort: **S-M** (fingerprinted shared/server, so bundle it into the single planned restamp of §5).

**B2 · Bring-your-own ticket (real work counts).**
- What: a repo-task template for *any* repo (estate, OSS checkout, or the owner's job code, kept local). The
  predicates are:
  - a **fail-to-pass** test: the named test fails at the base sha and passes at the head;
  - the full suite is green;
  - the diff touches ≥2 layers;
  - the PR has Problem / Non-goals / Risk / Rollback / Verification sections.

  Its EB leg is seed-time-free: a generic weighted senior rubric. The retest is the next BYO ticket in a different
  repo.
- Why: seniority comes from real changes to living systems. This makes BootQuest the ledger and reflection layer
  over that work instead of a substitute for it.
- Grading: `git` + the test runner + the existing `pr-has-section`. Fail-to-pass is the one new predicate.
- Effort: **M**.

**B3 · Spec-hidden tickets (hide the spec, not the tests).**
- What: the ticket is a vague product request.
- Step 1, clarify: pick ≤5 of 12 clarifying questions before seeing the answers (key: the 4 that matter; scored on
  precision and recall). The chosen answers are then released.
- Step 2, specify: write acceptance tests, stored answer-first. They must pass on the reference implementation (no
  over-specifying) and kill ≥K of N seed-authored plausible-wrong implementations.
- Step 3, build: the implementation passes the hidden suite on submit only.
- Why: it trains elicitation, test design and building in the right order.
- Grading: the menu key, mutant-kill counts and the hidden tests. All deterministic.
- Effort: **M-L** (start with signalpost U07/U11 tasks as the source).

**B4 · Large-codebase navigation and blast radius.**
- What: on twenty, nopCommerce and formbricks checkouts.
  - (a) "Where is tenant scoping enforced for X?" The answer is path:line ranges.
  - (b) "Which files must change to add field Y / rename Z?" The answer is a file set, graded on precision and
    recall against a key produced at seed time by actually making the change on a scratch copy and recording the
    diff's file list.
- Why: working in large unfamiliar code is the most common senior day, and the estate already holds it.
- Grading: range or set match.
- Effort: **M** (new answer shape, so a fingerprint).

**B5 · Mystery-ticket pool with spaced re-exposure.**
- What: bug tickets whose category is hidden (race, N+1, authz, migration, stale cache, timezone, none). The pool
  is interleaved across labs and served by the slate at roughly 1 d / 1 w / 1 m after a lab is passed.
  - Step 1: classify the bug and cite the evidence line (key match).
  - Step 2: fix it with a fail-to-pass test.
  - Clean "works as designed" tickets are included.
- Why: interleaving and spacing turn the lab knowledge into diagnosis that lasts and transfers. A failed
  re-exposure should also feed demotion, so build skill can decay as well as recall.
- Grading: the key plus the runner.
- Effort: **M** (reuses lab infra).

**B6 · Executable alerts and instrumentation.**
- What:
  - (a) The learner writes an alert rule (a small JS predicate over a recorded metrics series). It must fire within
    T of onset on K incident traces and stay silent on M normal traces.
  - (b) The learner adds structured log fields or metrics to a handler so that a given question ("which tenant
    caused the spike?") can be answered by a provided query over the emitted JSON logs.
- Why: it builds operating, not just reading.
- Grading: deterministic replay.
- Effort: **M**.

**B7 · Calibration on your own work.**
- What: before each lab, ticket or kata submit, the learner states a 50% and 90% time estimate and P(pass on first
  submit). Record `elapsedMs` and the verdict. Show the 90%-interval hit rate and Brier score per competency over
  time.
- Why: estimation is the senior skill with the worst feedback loop at work, and this is the only objective
  calibration signal a solo app can produce. It replaces U4 and the instrumentation half of U1.
- Grading: arithmetic on recorded rows.
- Effort: **S**.

**B8 · Contrasting cases for senior taste.**
- What: for design docs, ADRs, PR descriptions, review comments and postmortems, show three seed-authored variants
  (strong, plausible-but-flawed, weak). The learner ranks them and tags each flaw from a fixed list before the key.
  These come *before* the learner writes their own J-format.
- Why: comparative judgment builds the internal standard that self-scoring assumes the learner already has.
  Worked contrasts beat writing into the void.
- Grading: rank and tag key.
- Effort: **S-M**, mostly content (quiz or kata flow).

## Recommended order

0. **This week, zero build:** run DOGFOOD.md for 10 real sessions on the ab-wave slate and log in LEARNING.md.
   Freeze new waves until there are ≥30 recorded attempts. In parallel, set a weekly hour budget and size
   everything below against it.
1. **B1 tiered promotion + B7 calibration + the fail-to-pass predicate**, in one planned restamp (they are small,
   and B1 must precede any promoting lab).
2. **U3 senior path**, short: signalpost U04-U07 + fullstack-crud + L7 katas.
3. **One tracer-bullet lab:** signalpost U07 (or Ledgerly tickets 1-3) as a B3 spec-hidden ticket on PGlite. Dogfood
   it end to end, including its EB and its retest in a *different* repo. Reorder the rest by what hurt.
4. **L7 with clean PRs and precision scoring, plus B8 contrasting cases** (mostly content; the best value per hour).
5. **B2 bring-your-own ticket** (real work becomes the main promotion source).
6. **B4 large-codebase navigation, then L2/L3 on PGlite.**
7. **B5 mystery pool with spaced re-exposure**, once ≥3 labs exist to interleave.
8. **L6 + B6, then L5, L8, L4 (rescoped), L9 (trimmed).**
9. **U2 as placement** (only if the dogfood shows fundamentals blocking), then wave C content.
10. Cut or defer: U5, U6-as-sysdrills, J7, J8, the ASP.NET and Spring twins (replace them with one C# BYO ticket as
    the transfer test).
