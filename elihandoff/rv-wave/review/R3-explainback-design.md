# R3 — Explain-backs, system design, campaign, agentic track, review katas

Reviewer R3, round 1, 2026-11-12. Target: `C:\Users\Owner\Desktop\bq-review` (`f52-wave` @ `dc2206bc`), read-only.
Scripts and their outputs are in `review-2026-11-12\work\R3\` (`eb-inv.mjs` → `eb-inv.json`, `eb-w.mjs`, `eb-q.mjs`,
`design-cov.mjs`, `sib.mjs`, `classify.mjs` → `classic-tags.json`, `repo-recall.mjs`, `sysd.mjs`, `kata.mjs` →
`kata-sweep.json`, `show.mjs`). Every number below was produced by one of them or by reading the cited file.

The explain-back layer is byte-identical to what the 2026-10-30 R2 review saw. The only changes since then are the
masterstore q2.kp2 rewrite and the tracer-B / ww48 "the repo does not yet" edits (SEEDING §8 ab S7). So this report
skips what R2 already covered. It concentrates on what was built since then: live `[wN]` weights, blind mode, the
xleak lint, the f52 kata fold, f52 hints, f52 next-up and track ordering. It also covers how the content and the
grading interact, which R2 could not see because weights were not live yet.

## 1. Verdict

1. The content is accurate. 7/7 new code-truth checks passed, on top of R2's 46/46. DESIGN IT and G2 are the best
   senior material in the app. The **grading wrapped around them is miscalibrated**, so as built they cannot work as
   intended:
   - 49% of design key points are `[w3]` and a single missed `[w3]` fails the set.
   - Key points run to a median of 49 words, and each one is ticked as a single covered/missed.
   - G2 briefs are graded closed-book on exact file paths.
   - The rubrics are the source repo's as-built design.
2. The kata fold shipped in f52 does not stop the leak. In 14 of the 52 katas, the context file shows the same comment
   unfolded. Half of the 120 "defects" are consequence narratives, not defects in the patch.
3. sysdrills are still formula transcription: the model is in prose in every one, the worked example equals a test in
   99, and the median solution is 2 lines. Since f52, the formula is the last hint the server serves.
4. The agentic track teaches PR review and delegation briefs, not agent engineering. Nothing covers evals, tool design,
   context management or agent-specific failure modes.
5. Campaign, sysdesign and agentic have no concept path. Next-up never offers DESIGN IT until all 129 sysdrills are
   done. On the agentic track, next-up points first at G3, the unit that is meant to come last.

## 2. Findings (ranked)

Restamp column: "none" means the change fits in client code, server engine/store/api code (except
`server/src/api/runners.ts`), `shared/src/api-ext.ts`, `shared/src/eb-weight.ts` (its header says it is not
fingerprinted), migrations, side files or authoring JSON. "restamp" means it touches `shared/src/{api,enums,check,
schemas,seed-pack}.ts`, `runners.ts` or `tools/seed/src/factory/**`.

| id | sev | tag | finding + evidence | proposed fix (size · restamp) |
|---|---|---|---|---|
| R3-01 | P1 | VERIFIED + JUDGMENT | **`[w3]` inflation turns the weighted gate into "hit every one of ~10 must-haves".**<br>**Counts.** 831 of 1,701 DESIGN IT kps are `[w3]` (49%): Q0 356/659 (54%), Q1 266/535, Q2 209/507. That is 9.6 `[w3]` per design set, 6.5 per G2 set and 8.6 per weighted classic set. Across all 136 weighted sets, `[w3]` is 46% of kps.<br>**The weighted floor almost never bites.** With every `[w3]` hit, a set can still miss 4-6 lower-weight kps and stay ≥ 80% (slack distribution 4:32, 5:61, 6:43 sets). Only 1 set reaches 80% from its `[w3]` kps alone.<br>**Rule.** `eb-score.ts:79-81`: any `[w3]` miss fails. SEEDING §3 says: "use `[w3]` only for a point an answer cannot pass without".<br>**Model (JUDGMENT).** A candidate who covers each point with probability 0.8 passes about 0.8^9.6 ≈ 12% of sets; at 0.9, about 36%. That is harsher than any real interview loop, and it pushes a self-scorer to tick generously. | Weight override side file `content/eb-weight-overrides.json` `{itemKey: {kpId: 1\|2\|3}}`, read in `shared/src/eb-weight.ts` (a runtime derivation, so the frozen seed text stays byte-identical). Cap `[w3]` at 2 per question (≤ 6 per set). Or the cheaper gate: "weighted ≥ 80% AND at most one `[w3]` missed". **Owner decision:** this changes how frozen items score. S-M · none |
| R3-02 | P1 | VERIFIED | **DESIGN IT kps are paragraphs, not checkpoints.**<br>**Length.** Median 49 words; 1,185/1,701 (70%) are over 40 words, 418 over 60. G2 median 29; classic median 15.<br>**Example.** `sysdesign--organized-study-dify--rag-ingestion-and-retrieval` q0.kp1 packs four claims into one tick: plan queues, a per-workspace isolation queue, a running flag with a 1-hour expiry, and a non-atomic read-then-set.<br>**Effect.** A binary covered/missed on that is not honestly answerable, and calibration cannot be measured. | Side file with a ≤ 12-word **headline** per kp: the tick target is the headline, and the paragraph is shown as the explanation after the tick. Same file as R3-01 and R3-06. Client `LadderPanes.tsx` `ExplainBackKeyView`. M (authoring 87 sets × ~20 headlines at seed time) · none |
| R3-03 | P1 | VERIFIED | **The f52 kata comment fold is defeated by the context files.**<br>**Context-file leak.** In 14/52 katas, a removed explanatory comment appears verbatim in an unfolded context file. `ContextFiles` render full content (`LadderPanes.tsx:1441-1448`), and the fold only touches the diff (`:1305-1320`).<br>**The f52 example still leaks.** `j5-katas` "Expense session: keep exit simple": the context file `src/expensetracker/session.mjs` still says "Exiting 0 here would tell scripts the save worked … exit non-zero (review finding 1 / exercise 3)".<br>**Finding markers.** 12/52 diffs or contexts carry markers that point at the defect: "Finding T4", "(F10)", "Step-6 answer", "finding A1".<br>**Titles.** 6/52 titles put the bad rationale in scare quotes: "redundant", "ids are interned", "a copy has one active loan anyway".<br>Script: `kata.mjs`. | Client: fold the same comment runs inside context files. Render finding markers (`/finding [A-Z]?\d+\|\(F\d+\)\|Step-\d+ answer\|exercise \d+/i`) as "[ref]". Expanding a fold records `selfAssisted` (prompt the learner to tick it). Longer term: set-B re-cuts of the 14 katas from comment-stripped files. S · none (client); set-B katas M · none |
| R3-04 | P1 | VERIFIED | **Half the kata "defects" are consequence narratives, so G1 measures retelling.**<br>**Counts.** 120 seeded defects; 59 (49%) have `evidence.in = repo`, i.e. unchanged code describing a downstream consequence or "the pattern elsewhere". 43/52 katas have ≤ 1 defect in the patched lines. Median diff: 5 changed lines; 24/52 change ≤ 4 lines.<br>**Example.** `ww18` maxQuantity (1 changed line) carries 3 defects. d2 is "What 'no rule' means downstream" and d3 is "How bands are defined".<br>**Effect.** A reviewer who finds the bug and names one consequence self-scores 33-50%. G1 ("≥ 80% across ≥ 10 defects", `ladder-service.ts:758+`) rewards reproducing the author's chain.<br>Still unfixed: no clean PRs, and no precision (elihandoftwo/03 L7). | Key view groups defects into "the defect" (`in: patched`) and "consequences". G1 counts patched defects only; consequences stay in the observation. `kataStats` / `selfScoreKata` in `server/src/api/ladder-service.ts` plus client. M · none |
| R3-05 | P1 | VERIFIED | **G2 delegation briefs are graded closed-book on repo specifics.**<br>**UI.** The pane says "Code hidden. Answer from memory" (`LadderPanes.tsx:592-593`).<br>**Rubric.** 55/140 Q0 brief kps name exact files, identifiers or commands. Example: `g2-brief--w22` q0.kp3 (w2) "Allowed files: src/repositories/webhookRepository.ts, src/services/providerSimulatorService.ts … one new tests/*.test.mjs". q0.kp5 is the `node --experimental-vm-modules --test` + `loadTypeScript` stub command.<br>**Effect.** A real brief is written with the repo open. As built, G2 tests recall, not the skill. | G2 = open book. While answering, show the pinned tree link (`https://github.com/elirc/<repo>/tree/<sha>`; estate repos are public). Do not mark it assisted. Keep classic EBs closed-book. Client, plus the family from the prompt prefix (`store/ladder.ts:69-74`). S · none |
| R3-06 | P1 | VERIFIED (examples) + JUDGMENT | **DESIGN IT rubrics key on the source repo's as-built design and its bugs, not on design dimensions.**<br>**dify (read in full; 4 code-truth checks correct).** q0.kp2 [w3]: "automatic mode cuts at 500 with an overlap of 50 (the console pre-fills 1,024, custom 50-4,000) … measures characters" (true: `dify/api/models/dataset.py:468`, `core/rag/splitter/fixed_text_splitter.py:44`). q1.kp4: the monitor watches only the `dataset` queue, not `priority_dataset` (true: `schedule/queue_monitor_task.py:35`, `tasks/document_indexing_task.py:248`). q0.kp7 [w3] is dify's own dataset-permission bug.<br>**cal-com.** q0.kp0 [w3] is cal.com's `Feature`/`TeamFeatures`/`UserFeatures` schema.<br>**Lower bound.** 186/1,701 design kps (114 of the `[w3]`) carry code identifiers or "the repo / today / the lab" phrasing. Prose like dify's is not caught by the regex.<br>**Effect.** A strong generic design misses `[w3]`s and fails; a learner who read the repo passes. | In the side file, tag each kp with `dimension` (requirements, estimate, API, data, consistency, async, cache, scale, failure, ops, security, trade-off) and `repoSpecific`. A repo-specific kp drops to w1, or is shown as "how <repo> did it" after scoring. Each set then has a generic rubric that a well-designed alternative can pass. M · none |
| R3-07 | P1 | VERIFIED | **The interview skeleton is missing, and blind mode is partial.**<br>**Scoping.** Every Q0 gives the requirements and the numbers. Only 21/87 sets have a scoping or requirements kp among their first 9.<br>**Estimation.** 8/87 Q0 prompts ask for an estimate, 6 of them the javabootcamp problems.<br>**SLOs.** SLOs or error budgets appear in 1 set.<br>**Trade-offs.** 70/87 Q2 prompts list the trade-offs to defend.<br>**Blind mode.** Client-only and default off (`LadderPanes.tsx:491`); it hides only the Q0 section list, on 51/87 sets.<br>**Sets with no blind toggle.** `dotnet-auth`; opusorganize zero-downtime A/B/C, saga-B and 10x-B (all [senior]); and the 6 javabootcamp classics, which have no tier tag. | Interview mode (§5 M1): blind on by default for [senior]; a clarifying-question menu; a numeric estimate box checked against a side-file answer; a time box; one follow-up probe. L · none if it lives in side files + `api-ext.ts` |
| R3-08 | P1 | VERIFIED (code) | **The best design and review content is unreachable by default, and the agentic order is inverted.**<br>**Next-up.** `service.ts:818-825` never makes an explain-back or kata next-up while any other unit is open. On sysdesign, that means after all 129 sysdrills. The slate's sysdesign slot is always a drill.<br>**Agentic.** Next-up is the first non-memory unit in id order (`queries.ts:98-103` `ORDER BY id`), and G3/G4 load last, so it is G3 live delegation (or G4). G3's own text says "Do this after the G1 kata bank gate … and at least one G2" (`agentic.json` G3 instructions).<br>**Track browser.** Agentic groups by repo label, alphabetical (`trackunits.ts:44-53,149-170`), so G2s and katas are interleaved by repo name. DESIGN IT sorts by repo, so the first sets are 3buildanalytics [mid], then four bazaar [senior].<br>**Still unbuilt.** C7 (acts for sysdesign/agentic) was dropped in f52. | Path side files `content/paths/{sysdesign,agentic}.json`: ordered unit keys, warn-and-skip like `content/fundamentals/related.json`. Next-up and the track browser follow them. For sysdesign: sysdrill module → the 1-2 DESIGN IT sets that use it, [mid] before [senior]. For agentic: G2 → katas easy→hard → G3 → G4. M · none |
| R3-09 | P2 | VERIFIED | **sysdrills are still formula transcription, and the hint ladder is inverted.**<br>**Model given up front.** 129/129 instructions carry a "Why it works" section that states the model in prose ("fleet size is total work ÷ one consumer's work, rounded UP", `09-queues-and-backlog` 03), plus a worked example. The worked example equals a test case in 99/129. Solution body median: 2 lines (96/129 ≤ 2).<br>**Hints.** Hint 2 is the exact formula in 127/129. f52 serves every hint except the last (`engines/hints.ts:40-42`). ab S6 rewrote hint 3 as prose, so the served hints run concept → formula, and the gentler prose hint is never served.<br>**Test names.** 733/776 test names spell "inputs → expected". | Swap hint 2 and hint 3 in `tools/seed/authoring/sysdrills/*.json` (drills are outside the freeze, per S6) and re-import. Put "Why it works" behind a "Show the model" button that marks the attempt assisted. Add a "pick the model" quiz layer (§4). S-M · none (importer not fingerprinted, SEEDING §8 qw) |
| R3-10 | P2 | VERIFIED (counts) + JUDGMENT (tags) | **43 of 137 classic explain-backs are below mid level or about the owner's own tooling.**<br>**Beginner (26).** Java toy "name the four layers", map/filter, closures, "what is await", records.<br>**Owner tooling / meta (17).** A flashcard app's mastery ADR, a grader trust boundary, an autofill bot, a content seeder, Nova v2 config, learning-app stores, curricula.<br>**Leak share.** These 43 (18% of EBs) hold **68 of the 136** frozen EB leak pairs in `tools/seed/src/ops/xleak-baseline.json`; 56 EB packs have at least one.<br>**Examples.** `organized-experiment-quiz-engine` Q1: "Give the format's advantages the README lists". `groktuts…08-lesson` q0.kp5: "Example: turning every title to upper case with map". The full list is in `classic-tags.json`. | CUT (§3). Retire the packs; units retire on the next load. Keep signalpost U01-U03 (the promotion path). S · none |
| R3-11 | P2 | VERIFIED | **Explain-backs are one-shot: a missed kp never comes back.** There is no FSRS link for explain-backs (SEEDING §8 retake policy: "Follow-ups (not built) … any FSRS interplay"). 127 classic EBs and 17 DESIGN IT primaries have no alternate set. Practice retakes exist but nothing schedules them. | Missed-kp review cards (§5 M4). M · none (engine + migration) |
| R3-12 | P2 | VERIFIED | **The agentic track is PR review plus briefs, not agent engineering.**<br>**Composition.** 75 units = 52 human-seeded review katas + 20 G2 rubrics + G3 + G4 + 1 retest.<br>**What G2 covers.** The PRE-MORTEM/HANDBACK kps cover scope creep 13/20, false green 9/20, wrong layer 5/20 and mocks 4/20. Test tampering, hallucinated APIs, context management, tool design, evals and prompt injection: 0/20.<br>**G3.** It checks presence only: branch, Claude trailer, CI green, non-empty `## Brief` / `## Patch review` (`agentic.json`). "x" passes.<br>**G4.** It rebuilds BootQuest's own wrong-solution filter. The instructions list all 6 rejection rules and the 7 test names restate them: spec transcription about the app's own tooling.<br>**Misplaced.** The best agent-security item, `mastermorphic` SSRF/prompt-injection through the fetch tool (2 code-truth checks correct: `morphic/lib/schema/fetch.tsx:4-12`, `lib/agents/researcher.ts:95-110`), sits on the JS track. | ADD (§4: agent-PR katas, an eval lab, G2s on context and injection). G3: require `## Patch review` ≥ N lines and a `## Findings` list in `{scenario, evidence, consequence}` shape (repo predicate `pr-has-section` already exists; a min-length predicate kind would need `shared/src/check.ts` → restamp). Relabel G4 as a drill. M · mixed |
| R3-13 | P2 | VERIFIED | **The campaign is a list of repos ranked by an assessment, not a concept path.**<br>**Shape.** JS act 3 is 74 quests, all difficulty 3. JS Foundations includes owner tooling (1jstrain2.2v2, ship-it, jsdrill_sync) and the TS repo `dotnet-snapshot1`. Unit titles are "Study quest: <repo-slug>".<br>**Readings.** 12 of 132 reading steps describe themselves as duplicates, "pick one" or game code, e.g. js2 `curse`: "rest is duplicate Jeopardy code" (`content/campaign/js.json` `focus`).<br>**Unlock cost.** Opening JS act 4 needs about 66 passed study quests (80% of each act's core). | Cut the 12 duplicate skims. Retitle quests by concept: a title map side file plus `focus`. The concept path itself belongs with the quest-pack reviewer. S · none |
| R3-14 | P3 | VERIFIED | **Doctrine concentration, and gaps in the classic problems.**<br>**Concentration.** 35/87 sets touch idempotency, 28 leases/claims, 16 the outbox. About 17 of 50 primaries are "durable async work" problems.<br>**Absent.** Typeahead, proximity/geo, leaderboard/top-K, ID generator, approximate counting (HyperLogLog: 0) and BFF: 0 sets. Leader election/fencing: 4. A time-series store: 2. SLOs: 1. | ADD (§4) |
| R3-15 | P3 | VERIFIED (positive) | **Alternate sets really are different angles.** Sibling kp-bag Jaccard is 0.19 on average (max 0.28, zz8 A/B), against 0.11 for unrelated primaries (`sib.mjs`). Example: bazaar inventory A (conditional decrement) → B (lottery drop with bot defence and bulkhead). Keep the format. The only spacing is the ≥ 2-day gap; nothing longer. | — |
| R3-16 | P3 | VERIFIED | **Self-scoring has no calibration signal anywhere.** No code reads the stored answer during self-score (`grep -i calibrat` server/client: 0 hits). Keyword-stuffing cannot "win" because nothing is auto-scored. The real risk is generous ticking, which R3-01 and R3-02 make easy. | §5 M3 (evidence spans + blind re-score) · none |

**Still unfixed from earlier reviews, one line each:**
- 17 DESIGN IT primaries have no retake, and the six C4 CRUD primaries (Next.js data flow, observability,
  testing/release, API contract, CSV import, soft delete/GDPR) are unbuilt (SEEDING §8 ab: "wave C deferred").
- "suggested pass: 70%" still appears in 81 DESIGN IT prompts, against the 80% gate (open owner item).
- R2 W1: the payments-lab primary q0.kp6 still cites `docs/learning/build-journal.md:147`, a recommendation, not the
  code.
- R2 K4: the opusorganize 10x q0.kp1 [w3] still keys the "Stripe 80 s / Anthropic 10 min" vendor defaults.
- 136 EB leak pairs are frozen in the xleak baseline (93 EB-note, 26 EB-quiz, 14 EB-fc, 3 EB-EB) across 56 EB packs.
- Promotion artifacts are trivial: the only live chain (signalpost U01-U03) checks 2, 1 and 2 tests
  (`content/sync/check-specs.json`), so "one notch per artifact" still ignores difficulty (01 §7.5).
- System design and agentic engineering still have no promotable artifact (01 §7.3).

## 3. CUT (remove, merge or demote)

| What | Count | Reason |
|---|---|---|
| **Beginner classic EBs:** groktuts map/filter; trainjs closures; organized-js-training-trainjs async; grokjs-javascript-learning-lab event loop; jstrain2.2 event loop; csharp-tut async; grokjs-dotnet DI lifetimes; organized-dotnet-vg records; the 6 Java toy READMEs/maps (cli-to-do, library, quiz-engine, src, src-j7, bank-simulator); j1, j2, j3, j5, j7; grok-js; newcodexjs; dotnet-snapshot1; devdeck; finance-dashboard; react; recipeweb | 26 | Below mid level. Fundamentals (73 topics) now teaches these subjects with graded drills. Most are README recall: 4 of 10 classic "the README lists / the guide names" prompts are in this group. Their concepts can come back as Fundamentals check-yourself cards. |
| **Owner-tooling classic EBs:** 1jstrain2.2v2 ADR-0015, astraboot1, bootlocalopusv2, eliapplybot-extension, elihyper2, jsdrillv2, jsprojectlearn roadmap, jsdrill_sync Ramp, organized-js-training-react store, ship-it, astra-learning-studio, fableopusrecallv2, masterrnative break-it, unionboot 3439 merge | 14 (of 17; keep signalpost U01-U03) | About the owner's learning apps and personal tools, not transferable engineering. They carry 33 frozen leak pairs: bootlocalopusv2 10, fableopusrecallv2 9. Where a concept is real (grader trust boundary, atomic-not-idempotent), it is already covered by DESIGN IT sets or the Fundamentals topics 21/22. |
| **Campaign duplicate skims** (JSprojectlearn1, curse, jep-vs-code ×2, finaljepgame, globgame, AnkiJS1, globehire-swe-learning, gitvg, astra2, aral-tagalog-v2-v2, organized-other-curse) | 12 reading steps | Self-described duplicates, "pick one", or game code. They never count toward unlock and they clutter every act list. |
| **G4 as a "guided project"** | 1 → demote to drill | 7 tests, and every rule is stated in the instructions. It is not a project and must not stand in for a project artifact (`PROJECT_UNIT_KINDS`). |
| **Opt-in blind toggle** | 1 control | Replace it with blind-by-default for [senior] sets, plus an explicit "show sections (assisted)" button. |
| **Kata context-file comments** | 14 katas (display only) | Fold them in the context view (R3-03), or replace with set-B katas. |
| **Do not cut** | | DESIGN IT (87), G2 (20) or the 52 katas: re-grade them instead (R3-01/02/04/05/06). Do not cut sysdrills: reshape the hints and the model reveal (R3-09). |

Net: retire 40 EB packs (244 → 204; the EB census and `ladder-real.test.ts` pins must be updated by counting) and 12
campaign reading steps. The xleak baseline shrinks by about 68 entries.

## 4. ADD (concrete)

**DESIGN IT primaries: classic interview problems the bank lacks (8).** Each needs an estate source doc.
`javabootcamp astraupskill/03-SYSTEM-DESIGN.md` already hosts the six classics, so extend that guide upstream first,
then seed:
1. typeahead/autocomplete: trie vs prefix index, top-K per prefix, update lag.
2. proximity search ("nearby stores/drivers"): geohash/quadtree, hot cells, moving writers.
3. leaderboard / top-K / heavy hitters: sorted sets, sharded counters, approximate counting (Count-Min, HyperLogLog).
4. distributed ID generator: snowflake layout, clock skew, the cost of uniqueness.
5. distributed lock and leader election with fencing tokens. Lease expiry is already a theme in 28 sets; the lock
   itself never is.
6. metrics/time-series ingestion: cardinality explosion, downsampling, retention tiers, SLO burn-rate alerts.
7. media upload → transcode → CDN: presigned URLs (1 set today), signed delivery, purge.
8. web crawler: politeness, dedupe, frontier, a Bloom filter (1 mention today).

**DESIGN IT, CRUD-senior (endorse R2 §5, still unbuilt; 6 primaries + 17 set-Bs).** Next.js data flow, observability
with SLOs (SLOs appear in 1 set today), testing strategy + release safety, API contract/versioning/BFF (BFF: 0 sets),
bulk CSV import, soft delete + GDPR erase. Add set-Bs for the 17 primaries without one, in R2 §5.6's order.

**Estimation inside design (87 small items).** One numeric "envelope" question per DESIGN IT set, for example "peak
writes/s" or "cache GB". The answer and its tolerance go in a side file, and the client checks the number when the
answer is stored. Today 8/87 sets ask for an estimate and nothing auto-checks a number.

**sysdrills "pick the model" layer (18 modules × 4 = 72 quiz items).** A scenario plus four candidate models, e.g.
"arrivals during the drain window: included / ignored / doubled / capped". This drills the choice that the "Why it
works" section currently hands over. Author as quest-pack quizzes through `seed:quests:drafts` (no factory change).

**Agentic, real agent engineering (about 30 units):**
- **10 agent-PR katas** built from agent-typical failures: a test edited to pass, a snapshot regenerated, an invented
  API or config key, a swallowed error behind a fallback, scope creep across a boundary, over-mocking that hides the
  bug. Add **5 clean agent PRs** and **5 nit-only PRs**, so precision can be scored (L7).
- **Eval lab, 8 drill-js drills.** Given 20-40 *recorded* model outputs for one task (fixtures committed at seed
  time), write `grade(output)`. It must match the hand labels at ≥ 90% precision and recall, and later drills add
  adversarial outputs. This teaches evals with zero runtime LLM.
- **Context-budget drills, 6 quiz/kata items.** Given a task, a repo map and a CLAUDE.md, choose the files and
  instructions to load under a token budget. The key is seed-authored relevance. Also: spot the instruction in an
  AGENTS.md that causes a known failure.
- **4 G2 sets** on injection/egress (mastermorphic fetch tool, dify retrieval), test-tampering prevention in briefs,
  and a long-running multi-agent orchestration brief. The owner's own wave process is the source; teach the
  transferable rules, not the setup.
- **Tool-design katas, 4.** A tool schema, its description and its error strings get reviewed in the kata flow:
  ambiguous parameters, errors that make an agent retry forever, missing idempotency on a write tool.

**Katas (beyond the agent set).** Set-B re-cuts of the 14 katas whose context files leak (R3-03). Multi-file PRs; the
median today is 5 changed lines.

## 5. New features, learning styles, teaching methods

| id | Method | Why it teaches | Size · files · restamp |
|---|---|---|---|
| M1 | **Interview mode for DESIGN IT.** (1) Brief scenario only (no numbers, no sections). (2) Clarifying-question menu: pick ≤ 5 of 12; the picked ones reveal their answers (side-file data; precision of the picks is scored). (3) Envelope box, auto-checked numerically. (4) A 35-min time box; elapsed time is stored with the answer. (5) Design, stored. (6) One seed-authored follow-up probe chosen from the highest-weight dimension the learner later marks missed, answered as a second stored stage (0 XP, like practice). | A senior round is scored on driving scope and numbers, and the bank never practises that (R3-07). Deterministic: menu and numbers are keyed. | L · client `LadderPanes.tsx`, `content/interview/<itemKey>.json`, endpoints in `api-ext.ts` + a new service, 1 migration · none |
| M2 | **Rubric dimensions + headlines + weight overrides** (one side file feeding R3-01/02/06). Stats then show "you miss *failure handling* in 7 of 9 sets". | Turns 87 separate checklists into one profile of interview dimensions. Deliberate practice needs a named weakness. | M · side file, `shared/src/eb-weight.ts`, `eb-score.ts`, client, Stats · none |
| M3 | **Calibration on self-scores.** (a) Evidence spans: to mark a kp "covered", the learner highlights the span of their *stored* answer that covers it. Offsets are stored in a new append-only table; a tick with no span counts as "unsupported" in the summary. (b) Blind re-score: 7 days later, re-score an old answer without seeing your earlier ticks. The agreement rate is shown on Stats. | Self-scoring is the whole truth layer above drills (01 §7.5), and nobody measures its honesty. A span must exist in text written before the key was seen, so keyword-stuffing after the fact cannot help. | S-M · client key view, 1 migration, engine `eb-score.ts` · none |
| M4 | **Missed-kp review cards.** Each missed `[w2]`/`[w3]` kp becomes an FSRS card. Front: the question plus the headline's topic ("what was the point about the hot row?"). Back: the kp text. Competency: system-design / agentic-engineering. | The only spaced loop today is quizzes and flashcards. EB misses, the most senior material, vanish (R3-11). It also gives the inert system-design competency real review traffic. | M · `engines/fsrs.ts` enrolment, a migration, review UI · none |
| M5 | **Compare two designs (contrasting cases).** For each DESIGN IT primary, two seed-authored short designs, one carrying a flaw taken from its own PRE-MORTEM kps. Pick the better one and tag the flaw from a fixed list. Quiz-graded. | Spotting the flaw comes before generating the design. Grading is deterministic, and the existing PRE-MORTEM content is reused. (03 B8 names the format; this is the concrete feed.) | M content · quest-pack quiz drafts · none |
| M6 | **Failure-mode timeline drills.** A log/metrics excerpt (seed-authored from a PRE-MORTEM scenario, e.g. 10x-load "pool-timeout errors on unrelated routes"). Pick the first cause and the first mitigation from a fixed menu; predict which signal moves next. | Incident reasoning is today only prose inside a self-scored PRE-MORTEM. This makes it keyed and fast, about 3 minutes per item, so it can sit on the daily slate. | M · quiz/predict-output items in quest drafts · none |
| M7 | **Postmortem and ADR review in the kata flow.** A markdown postmortem or ADR with seeded flaws: blames a person, root cause is a symptom, an action has no owner, an action does not prevent recurrence, a rejected alternative is a straw man. Reviewed as a kata with precision. | Senior writing is judged by review. The patches generator already takes any file. (Complements 03 J2/J3; the postmortem variant is new.) | S-M · `tools/seed/authoring/katas/*.json` · none |
| M8 | **Verbal explain-back.** Record audio locally (MediaRecorder, no cloud speech API), store the blob with the answer, play it back beside the key during self-score, and store the duration. Optionally type a summary afterwards. | Interviews are spoken. Speaking from memory exposes gaps that typed answers paper over, and a timed 2-minute recording trains concision. | M · client + a blob table (migration) · none |
| M9 | **Open-book vs closed-book by family.** G2 open (repo link at the sha), classic closed, DESIGN IT closed. The prompt says which. | Matches each format to the skill it claims (R3-05). | S · client · none |
| M10 | **Seeded paths for sysdesign and agentic** (R3-08), with an "unlocks after" note per DESIGN IT set naming the sysdrill module it relies on. | Turns 216 + 75 alphabetical units into a course. | M · `content/paths/*.json`, `service.ts`, `trackunits.ts` · none |
| M11 | **BYO-LLM critique, offline (owner decision; it bends rule 2).** `bootquest export-eb <unit>` writes the stored answer plus the rubric as a prompt file. The owner runs it in any Claude Code session. `bootquest import-critique` stores the result as advisory evidence (assistance `external-review`), never as promotion and never as XP. Runtime stays deterministic. | Gives free-text design answers a second opinion that is not the learner's own, without runtime spend. | S · cli + one endpoint + a migration · none |
| M12 | **Kata precision + decoys** (03 L7, endorsed). Findings that match no defect are self-marked "noise"; G1 reports catch rate and precision; clean PRs ask approve/block. | Blocking a fine PR is a senior failure the bank cannot observe today. | S-M · ladder-service, client, content · none |

Recommended order: R3-03 (client fold, S) → R3-05/M9 (open-book G2, S) → R3-01 gate rule (S, owner decision) →
R3-08/M10 paths → M2 side file (drives R3-01/02/06) → M4 → M3 → M1. Content ADDs after the owner's first real week.

## 6. Coverage statement

- **Swept by script:**
  - all 244 explain-back items: 4,756 kps, 732 prompts; weights, lengths, prompt overlap, families, tiers, the blind
    marker, siblings, doctrine and topic coverage, repo-recall phrasing, source type;
  - all 136 entries of the xleak baseline;
  - the 53 drafts in `content/seed-drafts/explainback`: each maps to a pack;
  - all 129 sysdrills: instructions, hints, 776 tests, solutions;
  - all 52 katas: diff, fold simulation ported from `LadderPanes.tsx:1178-1320`, context files, defect evidence,
    markers, titles;
  - all 3 campaign files: 259 + 67 + 12 quest entries, 132 reading steps;
  - `agentic.json`, `check-specs.json` and `curriculum.yaml`, all read in full.
- **Read in full, about 30 items:**
  - 13 explain-backs: opusorganize 10x A, javabootcamp URL shortener, dify RAG, cal-com (Q0), bazaar inventory B,
    groktuts listing [mid], quiz-engine, 1jstrain ADR-0015, borrowbox, mastermorphic SSRF, groktuts map/filter,
    g2 w22; plus the Q0 prompts of all 244;
  - 3 katas in full (ww18 maxQuantity, ww48 `return await`, j5 exit), and all 52 titles and defect lists by script;
  - 6 sysdrills (09/03 in full; hint 2 and "Why it works" of 5 more);
  - grading code: `eb-score.ts`, `eb-weight.ts`, `hints.ts` `servableHints`, `ladder-service.ts` (kata findings,
    self-score, stats), `service.ts` next-up, `seed-items.ts` public/private projections, `LadderPanes.tsx`
    (EB pane, key view, blind mode, diff fold), `trackunits.ts`, `campaign.ts` unlock rule.
- **Code-truth:** 7 new checks at the pinned checkouts, all correct: dify ×4, mastermorphic ×2, cal-com ×1. R2's
  46/46 cover the rest of the sampled sets.
- **Not covered:**
  - quest-pack content behind campaign steps (another reviewer's domain);
  - C#/Java drill banks;
  - the live UI (R4 owns the browser);
  - the 2-day alternate-set gate and practice-retake flows, which I did not exercise at runtime;
  - classic EB code-truth beyond R2's sample;
  - the 6 javabootcamp classics, of which I read only the URL shortener in full.
- **Judgment calls:** the beginner / owner-tooling tagging of the 137 classic EBs is mine, from the Q0 prompt and the
  source path (`classify.mjs`, `classic-tags.json`). The 12% / 36% pass-rate model in R3-01 assumes independent
  coverage.
