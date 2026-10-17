# BootQuest Java System Design section (2026-10-16)

The owner asked: "add 2-5 x more java system design content, new section use opus agents too".

## TL;DR

- **Before:** the Java track's only design material was javabootcamp module 08 (domain rules), with
  8 exercises.
- **After:** a new **System Design** section, javabootcamp block 5, with **modules 09–13**:
  - **40 new graded Java exercises**, 5× module 08, with 338 new tests.
  - Each module has a full README.
  - A new study guide, `astraupskill/03-SYSTEM-DESIGN.md`.
- **javabootcamp now holds 104 exercises in 13 modules.** Its full Verify runs 1,562 test checks (each test against both the starter and the solution) and passes.
  - It is pushed to `elirc/javabootcamp` `main` at `faf5d9d`.
  - The app pins that commit, and 104 of 104 units pass validation in-app, with 0 quarantined.
- **Branch:** `java-sysdesign` in `Desktop\bq-honesty`, based on `java`, so it contains wave 4, the
  Java track and this section. `main` is still at `846c224`.

## How to land (wave 4 + Java + System Design together)

```
cd C:\Users\Owner\Desktop\selfboot
git fetch ../bq-honesty java-sysdesign
git merge --ff-only FETCH_HEAD
```

**Database:** no new migrations. The new units load from the pack on the next `npm run serve`. The
Java-track migrations 010 and 011 still run first; the backup is at
`C:\Users\Owner\bootquest\backups\bootquest-pre-java-2026-10-16.db`.

## The modules

| Module | Exercises (tier) |
|---|---|
| **09 caching** | LRU ★, TTL with injected clock ★, cache-aside vs write-through ★★, read-through loader with stats ★★, negative caching ★★, removal listener ★★, LFU ★★★, single-flight stampede dedupe ★★★ |
| **10 rate limits and resilience** | token bucket ★, fixed window ★, sliding window log ★★, retry with backoff and jitter ★★, circuit breaker ★★, bulkhead ★★, deadlines and time budgets ★★★, idempotency keys with replay ★★★ |
| **11 partitioning and ids** | hash mod N sharding ★, base62 short links ★, range partitions ★★, consistent-hash ring with virtual nodes ★★, rendezvous hashing ★★, snowflake ids ★★, bloom filter ★★★, quorum reads/writes with read repair ★★★ |
| **12 messaging and events** | pub/sub bus ★, bounded queue with backpressure ★, at-least-once with dedupe ★★, retries and a dead-letter queue ★★, transactional outbox ★★, delay/priority scheduler ★★, event sourcing and projections ★★★, saga with compensation ★★★ |
| **13 storage and consistency** | versioned writes / optimistic locking ★, write-ahead log recovery ★★, LSM memtable and sorted runs ★★, MVCC snapshots ★★★, CRDT merge (G-counter, LWW) ★, vector clocks ★★, leader lease with fencing tokens ★★, two-phase commit ★★★ |

**How the exercises are built:**
- **Deterministic:** clocks are injected, `Random` is seeded, and futures are completed by hand. No
  test sleeps or starts a thread.
- **Small:** every exercise models one production idea in a single file.
- **Self-contained:** the prompt states every behaviour the tests check.
- **Grading:** the same as the rest of the track, in-app through the Java runner (`drill-java`).

**The guide** (`astraupskill/03-SYSTEM-DESIGN.md`) covers:
- how to approach a design question, with back-of-envelope sizing and trade-off tables;
- how the five modules combine into classic designs: URL shortener, rate-limited API,
  feed/notifications, ticket booking with holds, job queue, key-value store;
- a map from each idea to the module that practises it.

It contains no answers.

**Other docs updated:**
- `README.md`, `FLIGHTPLAN.md`: 13 modules, about 50–60 hours, route block "5 · system design".
- `02-CONCEPTS.md`, `01-START-HERE.md`: counts updated.
- Module 08's README now points to module 09.

## Process (Opus agents)

| Step | Agents | Result |
|---|---|---|
| Write | 3 Opus writers in separate clones (A: 09+10, B: 11+12, C: 13 + guide + docs) | Each one ran its own wrong-solution checks: 23, 52 and 57 variants |
| Review | 3 Opus reviewers, each a different author from the module's writer | Each wrote **new** wrong variants and checked every claim about a real system |
| Integrate | orchestrator | merged, full Verify, push, re-pin, import, validate, gates |

## Review findings

- **0 wrong reference solutions**, across all 40 exercises.
- **17 exercises had weak tests**, which a plausible wrong solution passed. All are fixed, with test
  blocks kept byte-identical between exercise and solution. Examples:
  - an LRU that evicts on a replace;
  - mark-then-publish in the outbox (the at-most-once bug that exercise exists to teach);
  - a dead-letter redrive placed at the front of the queue;
  - partial writes on an MVCC commit conflict;
  - a leader lease release that ignores the fencing token;
  - base62 overflow that wraps to a positive number;
  - scheduler tie-breaks that happened to be alphabetical.
- **2 prompt gaps fixed:**
  - 09/06: the sweep happens only on overflow.
  - 11/03: `count()` was undocumented.
- **11 wrong claims about real systems fixed:**
  - nginx `limit_req` is a leaky bucket.
  - Polly allows one half-open trial call.
  - The 422 status comes from the IETF Idempotency-Key draft, not Stripe.
  - Retry budgets are fleet-wide.
  - Caffeine has a COLLECTED removal cause.
  - RabbitMQ `*` matches exactly one word.
  - At-least-once delivery depends on ack and commit settings.
  - Kafka's idempotent producer does not dedupe consumer redeliveries.
  - An append is not durable without fsync.
  - LSM write amplification was misstated.
  - Dynamo-style stores rely on sloppy quorums and hinted handoff.
- **Left on purpose:** a few variants that tests can't tell apart, either single-threaded or
  identical on a ring. Each review report lists them.

## Gates (all green on `java-sysdesign`)

| Gate | Result |
|---|---|
| javabootcamp `java bootcamp/Verify.java` | 208 files, 1,562 test checks, 0 broken, 0 slow (13 modules, 104 exercises) |
| `npm run seed:validate -- --source javabootcamp` | 104/104 validated, 0 quarantined, 20 journaled passes re-executed with 0 mismatches (284 s) |
| `npm run typecheck` | clean |
| `npm test` | shared 87, server 548, cli 20, client 221, 103, tools/seed: all passed |
| `npm run test:java` | 23/23 |
| `npm run smoke:api` | 69/69 (the Java section lists all 104 javabootcamp drills plus the j5/j7 explain-backs) |
| `npm run demo:campaign` | 25/25 |
| `npm run demo:promotion` | 38/38 |
| `npm run seed:check` | 510/510 packs, 10,575 items re-validated |
| `npm run seed:lint:answers` | OK |
| `npm run seed:campaign -- --check` | byte-identical |
| `npm run build:client` | built |

**Fingerprint rule:** no grader- or seed-fingerprinted file was edited. Only `JAVABOOTCAMP_SHA` and
`JAVABOOTCAMP_EXPECTED` changed, so only the javabootcamp pack was re-validated.

## Open items

1. Fast-forward `main` (above).
2. **Optional:** raise Verify's 4–9 tests-per-exercise cap if you want finer-grained test names.
   The modules currently pack several assertions into each test.
3. **Optional:** a System Design study-quest pack or explain-back built from the new guide. It would
   need a campaign quest, and javabootcamp is not in the upskillorder assessment.
4. **Cleanup:** the scratch clones `Desktop\jb-sd-a`, `jb-sd-b` and `jb-sd-c` can be deleted.
