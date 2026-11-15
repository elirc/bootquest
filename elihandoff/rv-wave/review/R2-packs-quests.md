# R2 · Repo-derived practice content: drill packs, quest packs, notes

Reviewer R2, round 1, 2026-11-12. Target: `C:\Users\Owner\Desktop\bq-review` (`f52-wave` @ `dc2206bc`), read-only.
Scripts and raw output: `C:\Users\Owner\Desktop\selfboot\review-2026-11-12\work\R2\` (file names below). Every number
here was counted by a script in that folder unless it is tagged JUDGMENT.

## 1. Verdict

1. The facts hold up. 508 of 508 predict-output keys reproduce when run, 18 of 18 quest quizzes I checked against the
   pinned code are right, all 6,333 note excerpts match the code at the pin, and quest-quiz length bias sits at chance
   (19%). The content is accurate. The problem is what much of it teaches.
2. About **31% of hand-written quest quizzes are repo-incidental trivia** (an error string, a menu number, a role list,
   which ADR says what). 43% are repo behaviour that carries a transferable lesson; 26% are transferable outright.
   Flashcards are similar (about 37% repo-recall), and spaced repetition will drill those for years.
3. **The drill tests are weaker than they look.** A plausible boundary or off-by-one variant of the reference solution
   passes all tests in about a quarter of the bootforge and jstrain drills I could mutate. sysdrills is strong (6.5%).
4. **The f52 hint feature reaches only about 22% of the non-Fundamentals drills.** 1,388 bootforge drills have exactly one hint, which the
   "never the last hint" rule withholds, and 1,135 drills (jstrain, javabootcamp, jstrain-cs, csbootcamp) have no hints at all.
5. Cut or demote about 1,500 low-value items (bootforge micro-drills and longest-is-key quizzes, generator trivia, twin
   packs, repo-recall cards). Then turn the repo material into practice that uses the code: reimplement-from-repo
   drills, trace ordering, kill-the-mutant tests and concept-interleaved review.

## 2. Findings (ranked)

| id | sev | tag | finding | evidence | proposed fix |
|---|---|---|---|---|---|
| R2-01 | P1 | VERIFIED (count) + JUDGMENT (class) | **Trivia share of hand-written quest quizzes.** Stratified sample of 394 items (2 per pack, 197 packs with hand items, seeded RNG). Each item classed V (repo-incidental: literal messages, menu numbers, role lists, which-ADR-says), R (this repo's behaviour, with a lesson that transfers) or T (transferable without the repo). Result: **V 31.0% ±4.6, R 42.9%, T 26.1% ±4.3**. Extrapolated to 2,776 items: V ≈ 860, R ≈ 1,190, T ≈ 725. By family: Java CLI apps V 50% (n 24); OSS study `organized-study-*` V 50% (n 36); `organized-*` owner builds V 33%; agent-built apps (master*/grok*/ww*/zz*/3build*) V 31%; .NET apps V 31%; tutorials/labs V 21%. | `work/R2/sample-hand.txt`, `sample-classified.txt`, `classify.cjs`. V examples: harbor `2c3c7e4e` (crossedThresholds → `[0.75, 0.9]`), j4 `cfaefa8e` (menu 5, types abc → exact print), organized-build-agenthelpdesk `72690ae1` (retryRecommendation string), organized-study-dify `9185f0d2` (`le=100`), umami `8ac8cdc9` (`{ ok:false, reason:"replay_disabled" }`), mastertwenty `8e1a8d73` (ADR-002 recall). Corroborated by regex: 381 keys carry an HTTP status, 94 quote a message string, 520 of 3,018 have all-numeric choices. | §3 C3. For new items: an authoring rule that the key must state a reason or consequence ("…because X"), never a bare literal. A literal key passes only if the stem asks for the reason. |
| R2-02 | P1 | VERIFIED | **Drill tests accept plausible wrong solutions.** Single-site mutation run (relational boundary, ceil/floor/round, `&&`/`||`, `??`→`\|\|`, ±1, drop a guard) on the reference solution, re-run against the shipped tests. **bootforge** (every 3rd drill, 609; 486 load in plain node): 240 had an applicable mutant, **90 (37.5%) kept a surviving mutant**, 121 of 446 mutants survived. A hand check of 12 survivors found 8 real gaps and 4 equivalent mutants. That puts real gaps at about 23% of mutable drills, a lower bound of about 200 drills pack-wide. **jstrain** self-run (every 9th JS drill, 78): 47 of 67 mutable drills had a survivor. 9 checked: 3-4 real, 5 equivalent, so about 27% real. **sysdrills** (all 129): 7 of 107 (6.5%); the 3 I checked are all real. | `mutrun.cjs`, `srmut.cjs`, `mut-*.json`. Real gaps: `bootforge/arrays-objects/arrays/array-basics/safe-get` (i ≤ 0 passes: index 0 never tested); `bootforge/async-js/patterns/async-utilities/fix-retry-stale-promise` (one extra attempt passes: call count never asserted); `bootforge/fullstack-crud/api-patterns/pagination/to-positive-int` (`n <= 1` passes: input "1" untested); `bootforge/http-rest/rest-and-urls/request-validation/validate-new-todo` (length 100 boundary untested); `bootforge/express-api/middleware-and-routing/auth-middleware/protected-endpoint` (`\|\|`→`&&` on the Bearer check passes); `bootforge/fullstack-crud/integration/validation-pipeline/validate-body` (value == min untested); `jstrain/06-errors-and-robustness/08-parse-dont-validate` (ages 0/149 untested); `jstrain/14-swe-design-patterns/33-anti-corruption-layer` (`Math.round`→`Math.floor` on cents passes); `sysdrills/02-caching-and-pools/06-shard-count` (Math.floor passes: every test divides exactly); `sysdrills/16-data-access-and-integrity/01-soft-delete-unique` (ignoring the email passes: no other-email row in any test). | Add one "at the limit" test per surviving boundary (the test name says which naive variant it defeats, as sysdrills 15-18 already do). bootforge and jstrain are upstream (opusboot2, jstrain2.2): report items, then re-import. sysdrills is authored here: fix it now (§4 A1). Make mutation survival a seed-time lint (§5 M8). |
| R2-03 | P1 | VERIFIED | **Most drills can never show a hint.** `servableHints` returns `authored.slice(0, -1)`, so a unit with one hint gets nothing (`server/src/engines/hints.ts:40-42`). bootforge: 1,388 of 1,825 drills have exactly 1 hint, 300 have 2 and 136 have 3. jstrain 855, javabootcamp 168, jstrain-cs 81 and csbootcamp 31 have none. **2,523 of 3,241 non-Fundamentals drills (78%) are not hintable.** The withheld bootforge hints are good nudges, not solutions ("Index 0 and index length - 1.", "Read the header, guard against it being missing, then `startsWith`."). | `hints.cjs`; `server/src/engines/hints.ts:40` | Per-bank policy: withhold the last hint only for banks whose last hint is approach-level (csdrills, javadrills, sysdrills, fund-*). Serve all hints for bootforge. S, `server/src/engines/hints.ts` (f52 edited server/src with `restamp:all -- --dry-run` 700/700 fresh; re-check). |
| R2-04 | P1 | VERIFIED (prior, still open) | **bootforge quizzes: the longest choice is the key 78% of the time** (423 of 544, the baseline). The key is at least 1.5× the next-longest choice in 64%, with a mean key/other length ratio of 2.63. Always picking the longest choice scores 79.3%. Each bootforge quiz is a one-item "Quick check" unit, so that strategy passes. By course: react-fundamentals 97%, react-ts 97%, express-api 96%, async-js 94%, fullstack-crud 94%, ts-basics 86%; only js-fundamentals (6%) and arrays-objects (18%) are clean. Distractors are weak ("There is no difference", "Throwing strings is slower"). | `cues.cjs`, `abs.cjs`; `tools/seed/src/ops/answer-length-baseline.json` | Demote the 544 from next-up and the slate until upstream rebalances them (§3 C6). Report to opusboot2. |
| R2-05 | P2 | VERIFIED + JUDGMENT | **Spaced repetition is spent on repo trivia.** Sample of 30 flashcards: 11 repo-recall (V), 7 repo behaviour with a lesson (R), 12 transferable (T). Repo-recall cards include tracer "Tracer session cookie settings", pulse "two API key types", 3buildagentteaching "acceptance criteria that shipped partial, per 03-progress.md", ww4 "What getSessionContext does on every authenticated request". By regex, 88 of 938 cards ask about the repo's docs or process (ADR, US-nn, finding, capstone, guide) and 32 are list-recall. Every card enrols into FSRS on the first pass (`server/src/engines/study-quest.ts` header). Card length is fixed since 10-30: median back 37 words, 43 over 60. | `work/R2` flashcard sample (in transcript); `quests.json` | Tag repo-fact cards and do not enrol them in FSRS; they stay readable as notes (§5 M7). Cut 120 now (§3 C4). |
| R2-06 | P2 | VERIFIED | **Twin packs: 15 pairs of quest packs study the same code** (identical blob SHAs in `manifest.json`). Example: organized-experiment-idempotent-payments-lab ↔ w22 share 22 blobs; temporal-lite ↔ ww19 20; netslack ↔ organized-dotnet-slack 17; 3buildagentteachgem ↔ astra-learning-studio 16, with 5 of 11 stems near-twins (claimJob `0451c551` ≈ `1df02e4e`, Section Average badge, attendance date key). 30 packs, 243 quizzes on the A side, 15 near-twin stems at Jaccard ≥ 0.3; the true conceptual overlap is higher (JUDGMENT). | §2 script output; `dups.cjs` | Merge each pair into one campaign step, or retire the thinner pack's quiz gate (§3 C5). |
| R2-07 | P2 | VERIFIED | **The Java quest layer is CLI trivia.** All 12 Java packs (j1-j7 and organized-experiment-{bank-account-simulator, cli-to-do-manager, library-book-tracker, quiz-engine, src, src-j7}) are console apps: 186 quizzes, 56 (30%) with menu or print stems ("In menu 14 the librarian…", "types abc at the prompt"), 21 with a key that quotes a printed message. Sample V share is 50%. There is still no Java web stack (prior R3 finding, still true). | regex in transcript; sample rows 117-128, 253-266 | Keep the money, atomic-save and concurrency items (j3 `be9ebe28`, j1 `a3f273a2`); cut the 56 menu/print items; build the Java web pack (prior plan wave D). |
| R2-08 | P2 | VERIFIED | **sysdrills still hand over the formula (prior R1 K1, moved, not fixed).** The ab wave cleaned the "Your task" lines and made every hint 3 prose (0 of 129 contain code). But "**Why it works.**" states the model in 105 of 129 drills, and 49 starters carry it as a TODO comment (01/01 `// TODO: requests per day / seconds per day`, 02/03 `// TODO: busy connections + headroom, rounded UP`, 01/07 `// TODO: L = lambda x W (mind the ms)`). The drill turns prose into code; the interview prompt's reasoning is given away. Within-module difficulty is unordered: 2 of 18 modules are non-decreasing. Duplicates still ship (R1): 01/07 and 06/04 are both Little's law; `SYSDRILLS_EXPECTED` is still 129 (B1 planned 125). | `sysdrills/09-queues-and-backlog/06-batch-vs-single-requests`, `05-sql-and-indexing/03-btree-depth`, `16-data-access-and-integrity/02-optimistic-contention` (read in full) | Answer first: show the interview prompt and ask for the number (a one-test drill), then reveal "Why it works" as hint 1. Drop the TODO formulas. Content-only (authoring JSON), S-M. |
| R2-09 | P2 | VERIFIED + JUDGMENT | **bootforge is mostly micro-exercises with flat labels.** 661 of 1,825 drill solutions (36%) are 3 code lines or fewer; 562 if sql-data is excluded, where short is fine. Median solution length by course is 3-9 lines. Difficulty 2 covers 1,553 drills (85%), and the mean label is 2.07 in the first third against 1.96 in the last: no curve. 687 drills (38%) have 2 tests or fewer. For a mid-to-senior owner, `firstAndLast`, `increment` and `isSecure` are not practice (JUDGMENT). | `shape`/size scripts in transcript; `bootforge/js-fundamentals/values/variables/increment` | Demote the micro-drills to optional warm-ups (§3 C7). |
| R2-10 | P2 | VERIFIED | **Notes repeat their quiz's explanation.** 2,268 of 3,018 after-notes (75%) contain at least 60% of the content words of their quiz's explanation. Notes total about 448k words (after-note median 118, before-note median 148). What they add is real: a verbatim code excerpt (all 3,660 notes have one, and all 6,333 match the pin) and "Why the others are wrong". | `leaks.cjs`-style overlap check in transcript; grok-build-team `x-strict-calendar`, umami `x-q01` read in full | Client-only: merge the explanation and the after-note into one panel (excerpt plus why-others-wrong). No content change, S. |
| R2-11 | P3 | VERIFIED | **Generator debris (prior W4/K3, still open).** 47 `finding-location` items are pure `file:line` recall (borrowbox "Which line enforces that equality is illegal?"). 22 two-choice items remain (react 7, support-desk-crm 6, relay-upskilling 3, gitjira/nethris/recipegen 2 each) with 53 three-choice. 7 packs are generator-only (borrowbox, csbootcamp, csharp-interview, csharp-tut, dotnet-snapshot, nettrello, ww6) and 6 packs have 0 flashcards. In ww6, 6 flashcards ↔ finding-location quizzes are near-copies (Jaccard ≥ 0.5): the card front names the location the quiz asks for. | `dups.json` (ww6 `d23e497c…` ↔ `4c30a8df…`) | §3 C1/C2. Hand-write layers for the C# anchors (prior C5). |
| R2-12 | P3 | VERIFIED | **Concept repetition across the estate and against Fundamentals.** 1,046 of 2,776 hand quizzes (38%) touch nine CRUD-correctness themes: outbox/queue/worker 253 in 100 packs, validation/400 212/102, authz 401/403 173/90, races 165/102, transactions 129/77, optimistic version/ETag 117/56, idempotency 110/48, tenancy 72/28. These are the same subjects as Fundamentals JS 21-33. Of 304 fund-js quiz items, 29 have a near-verbatim twin in bootforge or jstrain (`fund:js/01…/q01` = `bootforge/js-fundamentals/values/primitive-types/quiz-typeof-null`). Steelman: varied contexts help transfer. But nothing links them, so the learner meets them as noise, not as practice spread over time. | `concepts.cjs`, `fundov.cjs` | Concept index plus interleaved concept sessions (§5 M6). |
| R2-13 | P3 | VERIFIED | **Doc-recall stems are 120 of 2,776 (4.3%), clustered** in bazaar 16, harbor-swe-bootcamp 14, relay 14, atlas-swe-bootcamp 11, dotnet-auth 9 and mastertwenty 7. 673 quizzes (22%) cite docs only, with no code citation; 16 packs are at least 80% doc-only (buildsql, folio-app, gitvg-astra, grok-js, harbor-swe-bootcamp, meterforge-upskilling, netcleanarch, relay-app, trainjs…). SEEDING §8 lists about 20 upstream guides that contradict their code, so doc-only keys are the risky class. | strict regex in transcript | When a doc-only item is next edited, add a code citation, or a note saying the code does not yet do it. |
| R2-14 | P3 | VERIFIED | **Katas show the defect twice.** 21 of 52 katas include a `bootquest-kata/*.Testable.*` harness mirror in the diff, so the seeded change appears twice and the harness is exposed (e.g. campusops `4bfed01c…`). Median diff: 5 changed lines. | patch scan in transcript | Client: fold `bootquest-kata/` hunks like the comment folding f52 added. S, client only. |
| R2-15 | P3 | VERIFIED | **12 of 141 jstrain "written" items are print-prediction** ("What does this print?") but self-graded with a rubric, although they could be machine-checked (`jstrain/quiz-01-language-core/q06`, `q38`). 24 interview-verbal and 30 SQL written items are fine as self-graded. | spec `checks: []` | Upstream report: convert the 12 to predict-output. |
| R2-16 | P3 | VERIFIED | **Quarantine and review queues are small and not worth human time.** Quest quarantine has 210 entries, all reading steps (broken doc citations: ambiguous suffix 100, missing file 85, line out of range 20). The review queue has 104 entries: 92 reading steps, 7 quizzes, 5 flashcards. Drill quarantine has 2 (bootforge vacuous checks: `react-state/…/fetch-unknown`, `ts-basics/…/ts-fix-annotations`). Nothing in them blocks a learner. | `quests.json` qmeta; `content/packs/bootforge/quarantine.json` | Leave them. Fix the 12 held quiz/flashcard items only if their pack is on the campaign path. Delete nothing (the hold rule needs the entries). |
| R2-17 | — | VERIFIED (positive) | **What is sound:** predict-output 508/508 keys reproduce (472 JS run as-is, 36 TS with `--experimental-strip-types`); 18/18 code-truth spot checks are correct (ww10, mastermorphic, support-desk-crm, jsprojectlearn, masternext, ww45, nextcrm, organized-experiment-src, e20, astraboot1, netgum, ww18, reactbullet, recipegen, gitjira, twenty, master2, jstrain3); all 1,374 readMore paths exist at the pin; quest-quiz cue solvers score chance (longest 19%, eliminate-absolutes 25.7% against 25.0% chance); no packs over 40% longest or shortest; 0 quiz keys restated in another stem of the same gate. Drafts are not dead weight: 197 quest drafts and 204 note drafts are 1:1 inputs of stamped manifests, and every draft quiz ships. | `po.cjs`, `po2.cjs`, `cite.cjs`, `leaks.cjs` | Keep. |

Past findings still open, one line each:
- 10-30 R3 W4: 22 two-choice quizzes, unchanged (R2-11).
- R3 K3: 7 generator-only packs, 6 with 0 flashcards (R2-11).
- R1 K1: sysdrills formula moved into "Why it works" and the starter TODOs (R2-08).
- R1 duplicates: 01/07 and 06/04 both ship (R2-08).
- f52 C2: bootforge 78% longest-is-key (R2-04).
- R3 "Java has no web stack": still none (R2-07).

Fixed since: sysdrills hint 3 (V4) is prose in 129/129 and is never served anyway (`hints.ts:41`); flashcard back length (R3 K2: median now 37 words).

## 3. CUT (remove, merge or demote)

"Cut" means re-seed without the item (quests: drop it from the draft and re-run `seed:quests:drafts` + `seed:notes`, one
commit per pack). Historical keys are never reused; quiz-miss cards on a dropped key just stop being served. "Demote"
means the unit stays loaded but leaves next-up, the slate and the campaign (a server-side filter, no content change).

| # | What | Count | Why | How / size / restamp |
|---|---|---|---|---|
| C1 | `finding-location` generator quizzes | 47 | `file:line` recall, the purest trivia in the estate | re-seed the 6+ packs with `--exclude`; S; content-only |
| C2 | Two-choice generator quizzes (net of C1) | 15 | coin flips inside an 80% gate (7 already in C1) | same re-seed; S |
| C3 | V-class quest quizzes, first pass by rule: Java CLI menu/print stems (56), keys that only quote a message string (94), ADR-recall stems (120, review each); keep any that also ask *why* | ~200 after overlap and review (JUDGMENT), of an estimated 860 V | the answer is a literal from one repo; they make the 80% gate a memory test of strings | edit drafts, re-seed per pack; M; content-only. Then lower the gate's V share pack by pack, no bulk deletion |
| C4 | Flashcards about repo docs/process (88) + list-recall cards (32) | ~120 now; ~350 estimated repo-recall cards should leave FSRS (§5 M7) | FSRS should schedule transferable rules, not cookie settings | re-seed per pack; S; content-only |
| C5 | Twin packs: keep one of each of the 15 pairs as the campaign step and retire the other's quiz gate, or merge both drafts into one pack | 15 packs, ~200 quizzes | same code, same questions, two XP payouts | campaign map + re-seed; M; `seed:campaign -- --check`, census/ladder pins change |
| C6 | bootforge quiz units | 544 demoted | longest-is-key 78%; a one-item Quick check the longest choice passes | demotion filter in next-up/slate (`server/src/api/service.ts`); S; report upstream to opusboot2 |
| C7 | bootforge micro-drills (≤ 3 code lines, sql-data excluded) | 562 demoted to optional warm-ups | not practice for a mid-to-senior engineer; the Fundamentals ladder plus `related.json` already covers the level | same filter, keyed by solution size, computed at import or kept as a side list; S |
| C8 | jsprojectlearn items copied from the repo's own quiz bank (`content/questions/system-design-lite.json`) | 18 | textbook system design that sysdrills and DESIGN IT do better; soft distractors (prior R3 K4) | re-seed; S |
| C9 | ww6 flashcards that copy its finding-location quizzes | 6 | near-duplicates of C1 items | re-seed; S |

Not cut, deliberately: the jstrain predict-output set (312, all correct), the R-class quest items (repo behaviour with a
transferable lesson; they are the estate's distinct value), the notes (merge in the UI instead), quarantine and review
queues (R2-16), and the drafts (they are the sources).

## 4. ADD

| # | What | Count | Detail |
|---|---|---|---|
| A1 | Boundary tests that kill the surviving mutants | sysdrills 3-7 now; bootforge ≥ 200 and jstrain ≈ 200 upstream | sysdrills (authored here): 02/06 a non-divisible input (`shardCount(5.5e12, 1e12, …)`), 16/01 a row with another email, 15/05 `preStop + longest == grace`, then 04/03, 12/02, 16/03, 17/03 after a look. Test names say the naive variant they defeat. bootforge and jstrain: hand `work/R2/mut-bootforge.json` and `mut-jstrain.json` (survivor lists) to the upstream owner. |
| A2 | Reimplement-from-repo drill bank (new bank, e.g. `repodrills`) | 40 to start | Pure functions the quest quizzes already probe, with tests generated by running the pinned function: masternext `escapeCSV`/`generateCSV` (`nextcrm-app/actions/reports/export-csv.ts:3-16`); support-desk-crm `canTransitionTicket` (`packages/domain/src/index.ts:32-37`); enterprise-billing `calculateInvoice`; grav-vg `computeTaxForRule` (wage-base cap); harbor `crossedThresholds`; stockade refund health split; jobtrack calendar-date round trip; masterstore `price_min` parser; organized-build-analytics `toCsv` (CSV injection); dotnet-ai-rag scorer; e12 atomic `#commit`; ankijs outbox coalescing. Each replaces a cluster of 2-5 V/R quiz items with one practice rep whose key is code-truth by construction. |
| A3 | Kill-the-mutant test-writing drills | 30 to start | Give the reference solution and one surviving mutant (from A1's lists); the learner writes the test that passes the solution and fails the mutant. jstrain `29-write-the-test` already has the meta-test harness. |
| A4 | Concept tags on every hand quiz and flashcard | 3,714 items, ~30-term vocabulary | Side file (e.g. `content/seed/concepts.json`, item key → concept), never inside the stamped pack. Map the concepts to Fundamentals JS 21-33 and sysdrills 16/18. |
| A5 | Doc-vs-code divergence items | 30 | From the upstream guide errors in SEEDING §8 and notes that already say so (umami `x-q01`: the guide says 404, the code returns 400): "The guide claims X; is it true at the pin? Which line decides?" Teaches reading the code over the docs. |
| A6 | Hand layers for the 7 generator-only packs | 7 × 10 quizzes + 6 flashcards | prior plan C5; nettrello first |
| A7 | Java web pack (Spring Boot + JPA) | 1 pack + drills | prior plan wave D; needs an owner repo |

## 5. New features, learning styles, teaching methods

| # | Method | Learning rationale | Size | Files | Restamp risk |
|---|---|---|---|---|---|
| M1 | **Reimplement-a-function from the repo** (A2) | Turns reading into generation (stronger than recognition). The repo function is the reference, so code-truth is by construction, and the learner rebuilds what the quiz only asked about. | M | new importer `tools/seed/src/repodrills/` modelled on `tools/seed/src/sysdrills`, `*_EXPECTED`, ladder pins | none if the importer stays outside `factory/` (sysdrills/csdrills precedent; verify with `restamp:all -- --dry-run`) |
| M2 | **Trace-the-request as an ordered answer** | Retrieval of a causal chain, which is the skill a senior uses when debugging. Graded exactly, with no schema change: a drill-js unit whose solution is `export const trace = ['requireUser', 'validate', 'service.create', 'tx.commit', 'outbox']` and whose tests compare prefixes, as jstrain `07-async-mastery/32-order-await-settled` already does for log order. Seed the trace from the citations quest items already carry. | S-M | authoring JSON in a drill bank | none |
| M3 | **Change-impact questions, computed by mutation at seed time** | "If this line changes, what breaks?" is the core review question. At seed time, apply the edit to a temp copy of a pinned checkout, run the repo's own tests, record which fail, and ask "which of these tests fails first?" (single key) or "how many fail?" | L | a new tool outside `factory/`; only repos whose tests run offline | none if tooling only; heavy CPU once |
| M4 | **Find-the-bug with clean controls** | The 52 katas are always guilty (prior 04 #17), so there is no precision cost. Mix in about 30% clean diffs mined from real fix commits in the estate's git history, and score precision and recall. | M-L | `tools/seed/src/factory/patches` | **yes** (factory is fingerprinted): plan one restamp |
| M5 | **Code-reading tour with checkpoints** | Reading steps and quizzes are already linked by provenance path and lines. Serve 1-2 quiz items right after the reading step they cite (the Fundamentals step-lesson pilot, applied to quests), not 10-30 at the end. Retrieval spread through the reading beats one end-loaded quiz. | M | `server/src/engines/study-quest.ts`, client quest page; mapping derived from existing provenance | none expected (server/src was edited in f52 without restamp; re-check) |
| M6 | **Concept-interleaved review** (needs A4) | Interleaving the same concept across 5 different repos is the textbook route to transfer, and the estate already holds about 110 idempotency items over 48 packs. A "concept session" draws 5 items (quiz, card, sysdrill, drill) on one concept from different sources. Fundamentals topics link to "seen in real code" items. | M | new endpoint plus side file; client | none |
| M7 | **FSRS only for transferable cards** | Long-term scheduling should hold rules ("a timeout can mean accepted-but-unacknowledged; persist intent first"), not one repo's cookie flags. Tag repo-fact cards (A4 side file or a rule) and skip them in `enrollFlashcards`; they stay readable as notes. | S | `server/src/engines/study-quest.ts` (enrol filter) | none expected |
| M8 | **Two seed-time lints**: (a) mutation survival for drill-js banks: fail a new drill whose reference survives a boundary mutant (my operator set; ~1 s per drill); (b) predict-by-execution: for "what does f(x) return" items in repos with runnable JS/TS, run the pinned function and compare with the key | Moves "do tests reject plausible wrong solutions" and "is the key right" from reviewer sampling to a gate | M | `tools/seed/src/ops/` (outside the fingerprint walk, like `answer-length.ts`) | none |
| M9 | **Answer-first estimation for sysdrills** (R2-08) | The interview prompt asks for a number; let the learner commit to one (a one-test drill with a tolerance) before "Why it works" is revealed as hint 1. That turns transcription back into reasoning. | S-M | sysdrills authoring JSON (lesson and title kept; tests added); importer gate update | none (authoring is content-only) |
| M10 | **Merge explanation and Learn-more** (R2-10) | One panel: verdict, why each distractor is wrong, and the code excerpt. Removes a 118-word re-read of the same point. | S | client quest/notes panes | none |

## 6. Coverage statement

**Swept by script (all items):**
- 4,440 drill-pack units across the eight non-Fundamentals banks: 3,241 drills, 544 quizzes, 508 predict-output, 147 written. Counts, hints, test counts, solution size, difficulty curve and served-hint reachability.
- 7,732 quest-pack items (3,018 quizzes, 938 flashcards, 3,776 reading steps): length and position cues, three cue-solvers, two-choice, near-duplicates (3-gram Jaccard, within and across packs), within-gate and before-note leaks, doc-only citations, concept themes, doc-recall regex.
- 3,660 notes (explanation restatement, length).
- 6,333 note excerpts, checked verbatim at the pinned checkout.
- 1,374 readMore paths.
- 314 quarantine and review entries.
- 401 quest and note drafts, matched to manifests and shipped items.
- 52 katas.
- Twin packs, by blob-SHA overlap across 204 manifests.

**Executed:**
- All 508 predict-output snippets.
- Mutation runs:
  - sysdrills: all 129 drills, 182 mutants.
  - bootforge: 609 drills sampled, 486 loadable, 446 mutants.
  - jstrain self-run JS: 78 drills sampled, 194 mutants.

**Read in full:**
- 394 quest-quiz stems with their keys, classified by hand.
- 30 flashcards.
- 18 quest quizzes against the cited pinned code.
- 21 mutant survivors: 12 bootforge, 9 jstrain.
- 9 bootforge quizzes.
- 48 drill heads, 6 per bank.
- 3 sysdrills in full.
- 3 notes.
- 1 kata.
- 6 generator items.

**Not covered:**
- No mutation or execution for the C#/Java banks: csdrills, javadrills, javabootcamp, csbootcamp, jstrain-cs (432 drills; test counts only, min 4-6 per drill).
- 123 bootforge TS/JSX drills could not be loaded by my plain-node runner.
- The 5 variants were not reviewed.
- Reading-step text quality was not reviewed.
- Explain-backs and the Fundamentals ladder are other reviewers' domains, touched only for overlap.
- The V/R/T classification is single-rater JUDGMENT: no blind second rater, and the V/R line is the softest part.
- The jstrain and bootforge real-gap rates rest on 9 and 12 hand-checked survivors.
