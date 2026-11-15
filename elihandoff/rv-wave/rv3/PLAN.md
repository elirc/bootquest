# rv3 plan: better explanations, more Java, finish what rv2 left

Written 2026-11-14 by Fable (orchestrator-in-chief). Binding on the rv3 implementers (five Opus streams); the main
loop runs the mechanics. Read with `../rv2/PLAN.md` (rulings 1-9 and §2 stay in force), `../rv2/FABLE-REVIEW.md`
(the must-fix list, ids MF-n), `../rv2/REPORT.md`, `../HANDOFF.md` (restamp rules §3, machine lessons §8) and `AGENTS.md`.

**Preconditions (hard).**
1. rv3 branches are cut from hub `rv-wave` (`C:\Users\Owner\Desktop\bq-f52-hub`) after the rv2 battery is green or its
   failures are listed as environmental in `rv2/REPORT.md` §4. Base today: `3264edb3`.
2. Before the first content edit, the orchestrator re-counts the owner DB with
   `node fable52docs/tools/copydb.cjs <new file>` (read-only copy): `attempt` must be 0. If it is not 0, ruling 1
   below is void for every item that has an attempt, and the stream stops and reports.
Not checked by me: Java authoring on `rv2-c2-wip` (I read the branch list and the diff stat only).

## 1. Rulings

| # | Ruling | Reason |
|---|---|---|
| 1 | **O3 is adopted for rv3: an existing item may be edited until its first attempt in the owner DB.** Keys never change. Prompts, choices and keyed answers change only when they are wrong, and each such change is listed in the stop report. Explanations, hints, lessons and drill tests may be rewritten. | The owner asked for better explanations; the owner DB has 0 attempts, so no history is rewritten. AGENTS.md "byte-identical" is replaced by this rule in the docs task (S5). |
| 2 | **The explanation rewrite is selected by script, not by taste** (§2). A stream rewrites the selected set plus anything it finds wrong while reading. Nothing else. | "Improve explanations" needs a bar that a gate can check and a bounded work list. |
| 3 | **Imported banks are out of the rewrite**: `bootforge`, `jstrain`, `jstrain-cs`, `csbootcamp`, `javabootcamp` come from pinned upstream repos. The 141 jstrain units with no explanation are a report item for the owner. Quest packs (3018 quiz items) are out too: the default day does not serve them (rv2 ruling 4). | AGENTS.md: upstream bugs are report items. Low gain off the default day. |
| 4 | **New content stays inside rv2 ruling 1**: on a path the slate serves, and with its key-idea entries. New in rv3: Java topics 21-26, C# 24-26, three javadrills modules, the agent katas, the `agentdrills` bank. No new repo, no new track. | Same reason as rv2. |
| 5 | **G2 briefs on injection / test tampering / orchestration / context budget, C6 "pick the model" quizzes, the 8 classic DESIGN IT problems, Java 21, real-framework C# drills: still blocked on the owner** (O8, O9, pinned sources). No stream writes them. | No pinned source exists. Code-truth beats briefs. |
| 6 | **F10 changes G1 scoring only for katas that carry the new `clean` or `decoys` field.** The G1 rule for the 52 existing katas stays as it is, pinned by a test. | rv2 ruling 9: do not stack two scoring changes untested. |
| 7 | **Each kata and each agentdrill is built over pinned code** (`.cache/checkouts/<repo>@<sha>`), cited by path and line. A kata with no pinned source is not written and is reported. | Same rule as C5 in rv2. |
| 8 | **The 4 new key-idea cards a day cap also holds for recap re-enrolment of never-reviewed cards** (MF list), and a section recap needs at least 3 met ideas (or all of them). | Found in the review: a recap with one prompt paid 20 XP and closed the section for good. |

## 2. The explanation bar (measurable) and how items are selected

New script `tools/seed/src/ops/explain-audit.ts` + CLI `npm run seed:audit:explanations` (S3 task 1, outside the
factory, read-only). It scores every item below and writes `work/rv3/explain-audit.json` (git-ignored) plus a summary
table. `--check` exits 1 when a rule marked **gate** fails; it joins the gates after rv3 with a baseline of 0.

### 2.1 Fundamentals quiz explanations (`content/fundamentals/<track>/topics.json`, 760 items today)
| Rule | Test | Gate |
|---|---|---|
| Q1 length | 25 to 90 words | gate |
| Q2 says why, not what | at most 70% of the explanation's content words (stop words removed) occur in the prompt + the keyed choice | gate |
| Q3 names a wrong turn | mentions at least one distractor: a content word of a non-keyed choice that is not in the keyed choice, or the misconception in words | gate |
| Q4 no position reference | no "option A/B/C/D", "first/second/last option or choice", "above/below" (choices are served shuffled) | gate |
| Q5 no cross-leak | does not restate the keyed answer of another item of the same gate (existing matcher `leakMatchPrepared`) | gate |
| Q6 true | read by the author against the lesson and, for behaviour claims, a 5-line snippet run in the track's runner | stop report lists every claim that was run |

Today (my count): explanations under 20 words: JS 131 of 330, C# 111 of 230, Java 87 of 200. Expect about 350-420
selected items. **Selection = every item failing Q1-Q5.** The keyed answer, choices and prompt stay unless wrong.

### 2.2 Fundamentals drill explanations and hints (170 drills in `tools/seed/authoring/fundamentals/**`)
| Rule | Test | Gate |
|---|---|---|
| D1 length | explanation at least 60 words | gate |
| D2 names the trap | names one wrong approach and which test catches it | listed for reading (script flags explanations with no test name and no "instead of / rather than / not") |
| D3 claims are proven | every sentence matching "would fail / fails / breaks / throws" about a test is proven: the author applies the named wrong change to the reference and runs the drill's tests in a scratch dir; the result goes in the stop report | gate by report |
| D4 hint ladder | hint 1 and hint 2 are prose (no `;`, no call parentheses, no formula: the importer's own gate, `tools/seed/src/sysdrills/import.ts:137-140`), hint 3 may be near the answer | gate (`seed:import:fundamentals` must accept all three tracks) |

Fixed items inside this bar: the 10 fund-js hint 2s that fail D4 (list in `rv2/S2-REPORT.md`, "Upstream / other
bugs"), and the false `new` vs `override` claim in `fund-csharp/06-.../01-polymorphic-notifiers` (fix the sentence
**and** add a long-message case to the test so the claim becomes true; the 06 bug hunt shares the tests and is
re-validated).

### 2.3 Lessons (76 topics)
| Rule | Test | Gate |
|---|---|---|
| L1 | at least 380 words; no `##` section under 40 words | gate |
| L2 | every gate item maps to a lesson heading in `sections.json` `gate`, and that section contains the fact the item keys on (script lists items whose keyed-choice content words are absent from the mapped section) | listed for reading |
| L3 | every section has a code block or a concrete case | listed for reading |
| L4 | code in a lesson compiles / runs (JS: `node --check`; C# and Java: the author pastes the snippet into a scratch drill run) | stop report |

A lesson is rewritten only where L1-L4 flag it or the reader finds a wrong claim. Each rewritten lesson keeps its
headings unless `sections.json` is updated in the same commit.

### 2.4 sysdrills explanations (129, `tools/seed/authoring/sysdrills`)
D1, D2 and D4 apply. D3 for sysdrills: the explanation's worked number equals the reference's output for the first test.

## 3. Work, ranked by skill gain per build hour

| Rank | Item | Size | Restamp | Acceptance |
|---|---|---|---|---|
| W1 | Must-fix list of `rv2/FABLE-REVIEW.md` (MF-n) | S-M | none (free files) | each MF has a test that fails on `3264edb3` and passes after |
| W2 | Explanation audit script + rewrite, JS and C# Fundamentals (§2.1-2.3), 10 hint-2 repairs, C# 06 | L | `fund-js`, `fund-csharp` only | `seed:audit:explanations --check` OK for js and csharp; `seed:import:fundamentals` accepts all tracks; `tools/seed` `fundamentals/import.test.ts` 16/16 |
| W3 | Java Fundamentals 21-23 (must), 24-26 (stretch): finish 21 from `rv2-c2-wip` `003cca9a`, 22 Spring Security filter chain + method security, 23 Jackson contracts, 24 Bean Validation in depth, 25 SLF4J + MDC request ids, 26 HTTP clients with timeouts. Each: lesson, 10 items, 8 cards, 2 plain-Java drills (D7: no framework runtime, JDK 17) + 1 bug hunt, `sections.json` checks, key ideas in `fund-java-spring.json` | L | `fund-java` only | census by counting; each new item meets §2 on day one; `test:java` targeted green; ideas appended, scope extended, `seed:lint:keyideas` OK |
| W4 | Java explanation rewrite (§2.1-2.3 for the 20 existing topics) | M | `fund-java` only | `seed:audit:explanations --check` OK for java |
| W5 | javadrills modules 12-14 (6-8 drills each): 12 records, sealed types and pattern matching; 13 deterministic concurrency (`ConcurrentHashMap.compute`, `CountDownLatch`-forced interleavings, executor shutdown); 14 JDBC-shaped data access in plain Java (in-memory fake `Connection`-like seam, transactions, batch, N+1 count). Key ideas appended to `bank-java.json` | M | `javadrills` only | each drill: reference passes, starter fails as a test verdict, deterministic over 5 runs; `JAVADRILLS_EXPECTED` by counting |
| W6 | C# Fundamentals 24-26: 24 structured logging without secrets, 25 background work (`BackgroundService`-shaped loop, cancellation, graceful stop, in plain C#), 26 System.Text.Json contracts. Same shape as W3; ideas in `fund-cs-web.json` | M | `fund-csharp` only | as W3, `test:csharp` targeted |
| W7 | C5: 10 agent-PR katas (edited test, invented API, swallowed error, scope creep, plus 3 **clean** PRs and 3 with nit-only decoys) and 4 tool-design katas, over pinned code; on `paths/agentic.json`; ideas in `agentic.json` / `review-katas.json` re-pointed to them | M-L | new packs only (pins and census rise) | `kata-proof.ts` passes for each; every defect cites `<repo>@<sha>:path:line`; `seed:pins` OK |
| W8 | C8: bank `agentdrills` (8 eval-lab drills, drill-js on recorded outputs) via a new importer dir `tools/seed/src/agentdrills/` reusing the sysdrills source schema; migration 028 sets `track.slate_drills = 1` for `agentic` and a `drill:agentic` slate setting that is **off** by default (same rule as C's default slate) | M | new pack only | fixtures committed; each grader checked against hand labels at 90% precision and recall by its own tests; the default slate is unchanged on a fresh DB (test) |
| W9 | F10: kata precision. A kata item may carry `clean: true` (no defect) or `decoys` (nit-only lines). The learner files findings or "approve". G1 for such katas = caught defects and no finding on a decoy line; approving a clean PR passes; a finding on a clean PR fails. Migration 029 `kata_verdict` (attempt_id, verdict approve / block, created_at; append-only) | M | none | existing 52 katas: G1 numbers identical before and after on a fixture (pinned test); clean kata approve = pass, block = fail; no key before findings are stored |
| W10 | Small features: confidence tag on Player drill / quiz submits (`ConfidencePick`); Stats competency table passes the real due-retest set (S3-REPORT bug); redo and re-check cards are served first in the review queue and named on the dashboard tile | S | none | client tests per item; the redo card is in the first page when 100 flashcards are due |
| W11 | Docs: AGENTS.md (restamp list from HANDOFF §3, `seed:lint:keyideas` and `seed:audit:explanations` in the gates, ruling 1 in place of "byte-identical"), SEEDING §3/§8 (rv, rv2, rv3 waves, every census number), `elihandoff/README.md`, `rv3/REPORT.md` | S | none | every number in the docs equals a number counted by script in the stop report |

### 3.1 Where each must-fix goes
| MF | What | Stream |
|---|---|---|
| MF-1 | a recap needs >= 3 met ideas (or all of them); ruling 8 | S1 |
| MF-2 | recap reachable outside Fundamentals: scope = the ideas' source units (or a count) in `sysdrills`, `design-it`, `bank-*` (S1 edits these side files), `agentic`, `review-katas` (S4), with the lint rule "recap threshold <= 40 units" | S1, S4 |
| MF-3 | a redo card with no live sibling is retired, never released | S1 |
| MF-4 | the `idea` sentence leaves the API only once the idea is met; the lint also checks `idea` | S1 |
| MF-5 | the 10 fund-js hint 2s (the tools/seed suite is red on them) | S3 task 2 |
| MF-6 | one `resolveSections` per request; no per-card resolve in `/reviews/queue` | S1 |
| MF-7 | `paths/sysdesign.json` steps 11 and 15 re-mapped; steps 07, 08, 10, 12, 14 reviewed | S1 (owns this file for rv3) |
| MF-8 | C# 06/01 claim, 23/01 invented early exit, 23 q01 stem, 22/01 guard times | S3 task 2 |
| MF-9 | wrong statements in key ideas: Java `equality-contracts` prompt (S2), sysdrills `backlog-drain-time` answer (S1) | S1, S2 |
| MF-10 | server tests that load a pack subset still read the repo's real `content/keyideas` (the "sibling ... matches no live unit" warning in the battery log; a full-estate boot has 0 such warnings): the test setup installs an empty store unless a test sets its own | S1 |

For MF-2, MF-7, MF-9 and MF-10, S1 also owns `content/keyideas/{sysdrills,design-it,bank-*,campaign-*}.json` and
`content/paths/sysdesign.json`. If the live probes left open in `rv2/FABLE-REVIEW.md` §6 add an MF, it goes to S1.

Not in rv3: everything in ruling 5; `repodrills`; kill-the-mutant; placement; Parsons; item-level quest cuts; quest
pack explanation rewrites; Java 21 (the JDK); anything in HANDOFF §7.

## 4. Streams
Five Opus streams, **at most 2 running at a time** (RAM). Clones: `bq-f52-p`, `bq-f52-c`, `bq-f52-d`.
Rules for all: branch from the hub's `rv-wave` at start (fetch the hub, never `main`, never push); commit per task or
per pack with `git commit -F`; targeted tests only, `--maxWorkers=1`, foreground, Git Bash; kill leftover `node.exe`,
`dotnet.exe` and `java.exe` before stopping; client typecheck is run by the orchestrator in the hub; never open the
owner DB; stop report per AGENTS.md with every count taken by script. A file not listed for a stream is not that
stream's to edit: ask the orchestrator. `shared/src/api.ts`, `server/src/runners/**`, `server/src/api/runners.ts`,
`runner-*.ts`, `tools/seed/src/factory/**` and the bound `shared/src` files are closed to every stream.
Before a clone is reused, the orchestrator checks it is clean, removes stale git-excluded migration files
(S3-REPORT deviation 1) and saves any uncommitted authoring (see S2).

| Phase | Running | Starts when |
|---|---|---|
| 1 | **S1** (`bq-f52-p`) + **S2** (`bq-f52-c`) | preconditions hold |
| 2 | **S3** (`bq-f52-d`) joins | S1 is merged (S3 needs no S1 code, only the free slot) |
| 3 | **S4** (`bq-f52-c`) joins | S2 is merged |
| 4 | **S5** (`bq-f52-p`) joins | S3 is merged and S4's kata slice (W7) is merged |

### S1 `rv3-fix`: review must-fix + small features (clone `bq-f52-p`; migration 030 reserved, expected unused)
Owns: `server/src/engines/keyideas.ts`, `engines/redo.ts`, `engines/fsrs.ts` (queue order only),
`api/keyideas-service.ts`, `api/notebook-service.ts`, `api/confidence-service.ts`, `api/app.ts` (the rv2 hooks and the
review routes only), `store/keyideas.ts`, `store/review-cards.ts`, `store/design-side.ts`,
`tools/seed/src/ops/keyideas-lint*.ts`; client `pages/Review.tsx`, `pages/KeyIdeas.tsx`, `components/SectionRecap.tsx`,
`pages/Player.tsx` + `pages/Player/**`, `pages/Stats.tsx` (the `dueRetestUnits` prop only), `client/src/api/mock.ts`
(its own routes); its tests.
1. Every MF item of `rv2/FABLE-REVIEW.md`, one commit each, test first. *Check:* W1 acceptance.
2. W10 a: `ConfidencePick` on Player submits. b: Stats retest leg. c: redo / re-check first in the queue + tile line.
3. The "should fix" list of the review, in its order, as far as the budget goes.
Tests: `server/test/keyideas*.test.ts`, `redo.test.ts`, `notebook.test.ts`, `confidence.test.ts`, `fsrs`, `api/api`;
`tools/seed` `ops/keyideas-lint.test.ts`; client `keyideas`, `review-paging`, `player`, `stats`, `rv2-confidence`.
Root typecheck. `restamp:all -- --dry-run` fresh (700/700: no pack touched).

### S2 `rv3-java`: all Java (clone `bq-f52-c`, no migration)
Owns: `tools/seed/authoring/fundamentals/java/**`, `tools/seed/authoring/javadrills/**`,
`content/fundamentals/java/**`, `content/packs/fund-java/**`, `content/packs/javadrills/**`, the `java` blocks of
`content/fundamentals/sections.json` and `related.json`, `content/keyideas/fund-java-language.json`,
`fund-java-spring.json`, `bank-java.json`, the `java` line of `FUNDAMENTALS_EXPECTED` and `JAVADRILLS_EXPECTED`,
Java pins in `server/test/api/ladder-real.test.ts`.
Start: the orchestrator cherry-picks `003cca9a` (Java 21 authoring) onto the new branch and restores the uncommitted
`22-spring-security-filter-chain-and-method-security.json` from `bq-f52-c`; the stream reviews both against §2 before
building on them.
1. W3 must: Java 21, 22, 23 (re-import, validate per course with `--concurrency 1 --retry-failed`, stamp). Commit per topic.
2. W5: javadrills 12-14. Commit per module.
3. W3 stretch: Java 24-26.
4. W4: the Java rewrite, after S3's slice 1 (the audit script) is in the hub: merge the hub, run the audit, rewrite.
Tests after each pack: `seed:validate` chunked, `seed:lint:leaks`, `seed:lint:answers`, `seed:lint:keyideas`,
`seed:pins`, `restamp:all -- --dry-run`, `test:java` targeted, `tools/seed` `fundamentals/import.test.ts` and
`javadrills` tests, server `api/fundamentals.test.ts`. Java validation is load-sensitive (javac 30 s cap): retry per
course, never raise the cap (bound).

### S3 `rv3-x`: explanations for JS and C#, and C# 24-26 (clone `bq-f52-d`, no migration)
Owns: `tools/seed/src/ops/explain-audit*.ts` (new), root `package.json` (one script line),
`tools/seed/authoring/fundamentals/js/**` and `csharp/**`, `tools/seed/authoring/sysdrills/**`,
`content/fundamentals/js/**`, `csharp/**`, `content/packs/fund-js/**`, `fund-csharp/**`, `sysdrills/**`, the `js` and
`csharp` blocks of `sections.json` / `related.json`, `content/keyideas/fund-js-*.json`, `fund-cs-*.json`, the `js`
and `csharp` lines of `FUNDAMENTALS_EXPECTED`, their pins.
1. **Slice 1 (first, at most 2 h, merged at once):** the audit script, its tests (a failing and a passing fixture
   per rule), the summary table for all three tracks in the stop note. No content change.
2. Repairs: the 10 hint 2s, C# 06 (sentence + test), then re-import + validate + stamp `fund-js` and `fund-csharp`.
3. W2: JS rewrite (topics 21-33 first: they are the senior path), then C# (21-23 first). Commit per topic.
4. W6: C# 24-26.
5. §2.4 sysdrills explanations, if the budget allows (stretch).
Tests: as S2 with `test:csharp` targeted; `seed:audit:explanations --check` per track.

### S4 `rv3-a`: agent engineering content (clone `bq-f52-c` after S2; migration 028)
Owns: `tools/seed/authoring/katas/**`, `tools/seed/src/agentdrills/**` (new), `tools/seed/authoring/agentdrills/**`
(new), new packs under `content/seed/patches/**` and `content/packs/agentdrills/**`, `content/paths/agentic.json`,
`content/keyideas/agentic.json`, `review-katas.json`, root `package.json` (script lines),
`server/src/db/migrations/028_agentic_slate.sql`, the schema-version pins (`db.test.ts`, `packs.test.ts`,
`ladder-sysdesign.test.ts`), census constants and `ladder-real.test.ts` pins for katas.
1. W7 katas, **clean and decoy katas first** (S5 needs them). They carry `clean` / `decoys` in authoring; until W9
   lands they are seeded with the fields ignored by the server and kept **off** `paths/agentic.json`. Slice merged.
2. W8: importer, 8 drills, fixtures, grader tests, migration 028, slate test.
3. Put the W7 katas on the agentic path once S5's W9 is merged (one commit, orchestrator may do it).
If `seed:patches` (factory) cannot carry the two new fields without a factory edit: stop and report; the fields then
live in a side file `content/seed/kata-flags.json` read by the server (S5 writes the reader).
Tests: `kata-proof.ts`, `seed:pins`, `seed:lint:*`, `restamp:all -- --dry-run` (N = 700 + new packs), server `db`,
`slate-settings`, `rv-day`, `archive-real`.

### S5 `rv3-f`: F10 and docs (clone `bq-f52-p` after S1; migration 029)
Owns: `server/src/api/ladder-service.ts` (kata paths only), `engines/ladder.ts` (kata stats only),
`store/seed-items.ts` or a new `store/kata-flags.ts`, `shared/src/api-ext.ts` (appended block),
`client/src/pages/LadderPanes.tsx` (kata pane), `client/src/api/{types,http,mock}.ts` (appended),
`server/src/db/migrations/029_kata_verdict.sql`, schema pins; `AGENTS.md`, `docs/SEEDING.md`, `elihandoff/README.md`,
`elihandoff/rv-wave/rv3/REPORT.md`.
1. W9 (ruling 6). *Check:* W9 acceptance, plus smoke-api's real-kata step unchanged.
2. W11 docs, last, after every other stream is merged; numbers from the stop reports, re-counted.
Tests: server `api/ladder`, `api/rv-ladder`, `ladder-real`, `db`; client `ladder`, `kata-diff`, `rv-ladder`.

**Merge order into `rv-wave`:** S1 → S3 slice 1 → S2 (tasks 1-3) → S3 rest → S2 task 4 → S4 slice 1 (katas) → S4 rest
→ S5. Schema pins: 028 (S4) and 029 (S5) merge in number order; if S5 is ready first it waits.

## 5. Review gate
**My adversarial review of the integrated branch** (diff first, then a sandbox on a copied DB, ports 4390/5390):
1. Bound files untouched; `restamp:all -- --dry-run` N/N fresh with N counted.
2. Every MF item: its failing scenario from `rv2/FABLE-REVIEW.md` replayed in the sandbox.
3. Explanations: `seed:audit:explanations --check` OK; I read 40 rewritten quiz explanations per track, every
   rewritten lesson section, every D3 proof in the reports; I re-run 5 D3 proofs myself.
4. No keyed answer, choice or prompt changed except those listed; diff of `topics.json` by script (fields other than
   `explanation` and `lesson` changed = listed or rejected).
5. Every new Java and C# item, kata and agentdrill read in full; Java drills run 5 times each for determinism.
6. F10: the 52 old katas score the same; a clean PR cannot be passed by filing a random finding; no key before findings.
7. Migrations 028-029 contiguous, append-only, applied to a copy of the owner DB (27 → 29); a fresh DB's default slate
   is unchanged.
8. Counts re-counted by my own script; live walk at 390 px of one rewritten JS topic, one new Java topic and one kata.

**Battery** as in `rv2/PLAN.md` §5, plus `seed:audit:explanations -- --check`. Environmental failures (C# warm-run
benchmark, CLI e2e boot, `smoke:api` boot over 180 s) are re-run once on a quiet machine and reported, never waved through.

## 6. Owner decisions (defaults apply until overruled)
| # | Decision | Default |
|---|---|---|
| O1 | Land `rv-wave` (f52 + fund + rv + rv2 + rv3) on `main` | After the rv3 battery is green; one merge, by the owner or on the owner's word |
| O2 | Usage gate for further content waves | 100 graded attempts over 14 distinct days, starting after rv3. rv3 is the last content before it |
| O3 | "Frozen at first attempt in the owner DB" | Adopted for rv3 (ruling 1) |
| O8 | Java 21, real-framework C# drills | No (D7) |
| O9 | Upstream docs for the classic design problems, the four G2 briefs, C6 citations | Owner writes or approves them upstream; a later wave seeds them |
| O11 | `bootquest sync` on signalpost | Owner runs it once after landing |
| O12 | jstrain: 141 units without an explanation (upstream) | Report item; fix upstream, then re-import |
| O13 | `drill:agentic` slate slot | Off by default; the owner turns it on in `/settings` |
