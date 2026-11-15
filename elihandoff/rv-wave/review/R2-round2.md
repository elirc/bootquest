# R2 · Round 2: cross-examination of R1 and R3, votes, revised top 7

Reviewer R2, 2026-11-12. Same read-only rules. New scripts are in `work/R2/`: `r2rank.cjs` (length ranks),
`r2verb.cjs` (verbatim reuse), `mutrun.cjs fund-js` → `mut-fund-js.json` (Fundamentals mutants), `r2kata.cjs` (kata
context leak), plus inline counts over `work/R3/eb-inv.json` and the patch items.

## 1. Rulings on R1

| finding | ruling | evidence (mine) |
|---|---|---|
| **R1-01 length cue displaced** | **CONFIRMED, but WEAKENED in size.** | **Reproduced** (VERIFIED, `r2rank.cjs`). Key length rank 0/1/2/3 (0 = longest): JS 30.9/41.4/19.4/8.2%, C# 30.5/38.5/29.0/2.0%, Java 28.0/42.0/25.5/4.5%. "Pick the second-longest" scores 40.5/39.0/41.5%, and R1's gate model reproduces exactly (p = 0.6: 0.38 → 0.56).<br>**The missing baseline.** The estate's own unbiased quest quizzes (2,776, which pass every cue test) show rank 0/1/2/3 = 29.1/33.9/20.6/16.4%, and second-longest scores 34.5% there. Keys are naturally a little more specific, so "second-longest" is not 25% even in clean content. The real excess is about 6 points over the estate's own baseline, not 15 over chance.<br>**Where the bias sits.** The clear defect is the shortest rank: 2-8% against 16% in clean content. "Never pick the shortest" alone is worth little, though (27-29.5% against 25%).<br>**On the fix.** A flat rank band (15-35%) is the right lint. A full rebalance of about 500 items before landing is too much: making about 30 keys per track the shortest choice gets the same result. |
| **R1-02 lesson-example reuse** | **WEAKENED.** True, but the 198 overstates it. | R1's threshold is ≥ 8 characters of prompt code found in the lesson, which counts canonical one-liners such as `typeof null` as copies. Re-run (VERIFIED, `r2verb.cjs`):<br>- ≥ 8 chars: 198 (R1's number reproduced).<br>- ≥ 20 chars: 78 (JS 35, C# 16, Java 27).<br>- Lesson shows the same code with the key printed within ~80 characters (genuine "remember the worked example"): 22 (JS 12, C# 4, Java 6). Examples: `js/02 q4` `for (var i…setTimeout` → `3 3 3`; `js/03 q2` `['1','2','3'].map(parseInt)`; `js/08 q4` `'a-b-c'.split('-', 2)`; `js/09 q2` Set order.<br>**Fix size.** The must-fix before landing is those 22, plus some of the 78 by judgment. "About 100 replacements" is more than the evidence supports. The set-B idea (T1) is the better long-term answer. |
| **R1-03 drill mutants** | **CONFIRMED** (independently reproduced). R1's "most survivors equivalent" also holds. | Ran my own operator set on all 62 fund-js drills (VERIFIED, `mut-fund-js.json`): 120 mutants, 19 survived (15.8%; R1: 12.9% of 264). 14 of 49 mutable drills keep a survivor.<br>**Reproduced.** R1's (c) `07-array-methods/01-multi-key-sort` (`<` → `<=` passes) and (d) `28…/03-answerable-request-log` (`>= 500` → `> 500`, `>= 400` → `> 400` and the `??` tenantId mutant all pass).<br>**Equivalent, not gaps.** My extra survivors on `31…/02-sargable-day-filter` (`<` ↔ `<=`) are equivalent: the ISO timestamp compares as text against `date($day)`, so the midnight test cannot tell them apart. `28…/02` mutates the frozen legacy code under characterization.<br>**One new real gap.** `14…/01-lazy-chunks` `size < 1` → `<= 1` passes: size 1 is never tested (minor).<br>**Comparison.** The Fundamentals drills are about twice as strong as bootforge/jstrain (R2-02: 37-70% raw survival), which is consistent with f52's named-trap tests. |

## 2. Rulings on R3

| finding | ruling | evidence (mine) |
|---|---|---|
| **R3-03 kata fold defeated by context files** | **CONFIRMED.** One addition to the fix. | VERIFIED (`r2kata.cjs`): 14 katas remove an explanatory comment of ≥ 5 words, and **14 of 14** show the same comment in a context file. The context file is the pre-patch source (`origin.kind` verbatim 23 / adapted 52). It renders unfolded inside a `<details>` (`LadderPanes.tsx:1443-1449`); the fold only runs over the diff (`diffRows`, `:1305-1320`). The j5 example is exactly as R3 describes.<br>**Addition.** The fold is itself a cue: a removed comment run is a flag ("look here"). Combined with R2-14 (21/52 diffs show a `bootquest-kata/*.Testable` mirror of the change), client folding is a patch, not a fix. The real fix is set-B re-cuts from comment-stripped sources (R3's longer-term option), and that should be the default, not the follow-up. |
| **R3-04 half the defects are consequence narratives** | **CONFIRMED.** | VERIFIED: 120 defects, 61 `evidence.in = patched`, 59 `repo`. 43 katas have exactly 1 patched defect and 9 have 2. Of the 59 repo defects, my regex puts 25 as history or doc narrative ("The repo already shipped this fix", "ADR 0005 known gap", "the course's exercise-3 answer"). Most of the rest are the invariant behind the main defect ("What a pause is supposed to mean", "How bands are defined").<br>**Nuance.** About 12 are pre-existing bugs in the touched code path, and naming those is a real senior review skill ("Production has this same double-spend today", idempotent-payments). R3's fix (G1 counts patched defects only) is right. Keep those ~12 as optional credit rather than folding them into "consequences". |
| **R3-06 DESIGN IT rubrics key on the as-built repo** | **WEAKENED.** True for a large minority; the fix overlaps R3-02. | The dify set reads as R3 says: q0.kp2 [w3] keys "500 with an overlap of 50 … console pre-fills 1,024", and q0.kp7 [w3] is dify's own permission bug.<br>But most kps are built "generic principle : repo instance". In 878 of 1,701 design kps (52%) the lead clause (≤ 14 words before `:`/`;`/`.`) has no identifier and no number; for `[w3]` it is 455 of 831 (55%). Examples: dify q0 opens "Split the write path from the pipeline:", "Fairness per workspace:", "Size chunks in the unit the model pays for:", "Embedding is the long pole:". A strong generic design does cover these lead claims.<br>**The fix.** Make the R3-02 headline the tick target, with the lead clause as the default headline. That fixes R3-06 for about half the kps at no authoring cost. The `repoSpecific → w1` tag is needed only for the ~45% whose lead clause is itself repo-specific, and above all for `[w3]` kps that are the source repo's bugs (dify kp7). |

## 3. Votes on the contested questions

**Q1 Restamp scope: neither blanket claim is true.** (VERIFIED, read the code.) There are two separate bindings.

- **Code packs** (`content/packs/*`) bind per grader kind only to the file lists in `server/src/store/grader-fingerprint.ts:56-101`. These are:
  - the runner sources;
  - `server/src/api/runners.ts`, `runner-csharp.ts`, `runner-java.ts`;
  - the harness fixtures;
  - the import gate `tools/seed/src/validate/{validate,verdicts,journal}.ts`, which is in every kind, so editing it restamps all code packs;
  - the toolchain versions.
- **Seed packs** (quests, notes, explain-backs, patches, variants) bind the generator's walked import closure (`tools/seed/src/factory/fingerprint.ts:1-60`). The pinned set (`fingerprint.test.ts:28-40`) is:
  - 11 shared files: `api, campaign, check, enums, index, mutation, pack, schemas, seed-pack, sync, thresholds`;
  - `server/src/api/runners.ts`;
  - factory and citations;
  - `exclusions.json`;
  - per pack, the runner lists of the checks it executes.

So R4 is right that most of `server/src` (engines, store, api services) and `shared/src/api-ext.ts`, `eb-weight.ts`, `fundamentals.ts` are free.

R1 is right about `scratch.ts`, and understated: `scratch.ts` is in both the `csharp` and `java` lists, so editing it restamps every drill-cs **and** drill-java pack, plus any kata or variant pack that runs those checks.

`shared/src/api.ts` *is* bound for seed packs. AGENTS.md's "these three dirs are fingerprinted" is a safe over-approximation; replace it with this list.

**Q2 Freeze vs add.** Back R5's usage gate for new content waves, with two exemptions that start now:
- **(a) Fixes to items already on the learner's path.** R1-03 tests; my sysdrills A1 tests; R1's 22 example-recall items; the R3-03/R3-04 kata changes; R2-03 hint policy.
- **(b) Side files that re-route existing content and change no stamped bytes.** Concept tags, paths, kp headlines and weight caps, archive list.

Everything that is new content waits for the gate: R1 §4 B/C/D (14 C#/Java topics), R3's 8 design problems and about 30 agentic units, and my own A2/A3/A5. The one exception I would argue for is the Java web pack, and only if the owner says Java is a goal. My data shows the existing content is accurate. Its problem is that the loop never reaches it, and new content would not change that.

**Q3 Honesty model: split it.** Practice mode is the default for MCQ, drills and predict-output:
- per-question marks right after the attempt;
- free reveal and free hints;
- small XP, never evidence.

Evidence mode keeps today's rules and is the only path to ladder legs. On that path, close R4's two cheap holes:
- a server-side cooldown or attempt cap on Fundamentals gate submits;
- a minimum substantive answer for explain-back evidence (for example, at least N content words per question, and no duplicate lines).

R5 is right that withholding feedback costs learning. R4 is right that the evidence ledger is the app's whole promotion promise. Splitting serves both, and R3-16 (generous self-ticking) argues for keeping evidence strict.

**Q4 Archive scale: about 1,700 to 2,200 units (the upper figure counts the jstrain modules), unit-level, through a side file.** Mechanism:
- `content/archive.json` lists unit keys or prefixes, read by the loader.
- Archived units leave next-up, the slate, the campaign and the default browser filter.
- They stay searchable, and their FSRS cards are suspended.
- Stamped content stays byte-identical; nothing is deleted.

Contents:
- bootforge quiz units (544);
- bootforge micro-drills (562);
- R3's 43 sub-mid and owner-tooling classic EBs;
- the 12 Java CLI quest packs and one side of each of the 15 twin pairs, unless the owner makes Java a goal (about 27 study-quest units plus their reading steps);
- jsprojectlearn's copied quiz bank;
- the jstrain language-core modules that `related.json` already maps onto Fundamentals topics, taken module by module once the ladder is passed.

I would not archive 139 of 204 quest packs wholesale, as R5 proposes. In my 394-item sample, 43% of items are repo behaviour with a lesson that transfers, and 26% transfer outright. Whole-pack archiving throws those away with the trivia. Archive by family where the trivia share is highest (Java CLI 50%, OSS study 50%), and leave item-level cleanup (R2 C3) to re-seeds after the usage gate.

**Q5 Fix Fundamentals before landing? Yes, with a short must-fix list (about 1 day), then land.** These must be done before landing, because the byte-identical rule freezes them afterwards:
- R1-06 SQL renumber (it changes keys);
- R1-03 test cases (5 drills, plus `14/01` size 1);
- the 22 example-recall items (R1-02 as I scoped it);
- R1-14's 4 version-trivia items;
- making about 30 keys per track the shortest choice (R1-01 as I scoped it), plus the rank lint.

These can wait until after landing: R1-08 explanations (not keys), R1-13 version text, the React 19 delta, and every new topic. Do not let the before-landing window become another wave: each week of delay costs more learning than these fixes add.

## 4. Revised top 7 for the whole app (skill gain per build hour)

| # | Change | Why it ranks here | Size · restamp |
|---|---|---|---|
| 1 | **Route the daily loop to the senior content.** Narrow next-up's "no explain-back or kata while anything is open" rule (`service.ts:818-825`) to the repo's own study quest. Add one rotating "senior rep" slot (DESIGN IT / kata / fund-js 21-33 / signalpost). Add path side files for sysdesign and agentic (R5-03, R3-08). | The best material is unreachable by default; this unlocks the most skill per hour. | S-M · none |
| 2 | **Practice / Evidence split** (Q3), with immediate per-item feedback, free hints in Practice, and the per-bank hint policy (R2-03: 1,388 bootforge hints currently withheld). | Feedback on error is the biggest single learning effect the app now withholds. | S-M · none (`api-ext.ts`, engines, client) |
| 3 | **Hide the worked model until the first failed submit**: fold "Why it works" in 209 sysdrills/javadrills (R5-07, R2-08), swap sysdrills hints 2 and 3 (R3-09), drop the TODO-formula starters. | Turns about 200 transcription drills back into reasoning; mostly client-side. | S · none |
| 4 | **Fundamentals must-fix, then land** (Q5). | The most practice-like content is still not on `main`. | S · none (fund packs self-stamp) |
| 5 | **Archive and core side file** (Q4), with a finite named core and a visible finish line. | Removes about 1,700 to 2,200 low-value units from the loop at no content risk. | S-M · none |
| 6 | **DESIGN IT scoring that a good generic design can pass**: cap `[w3]` or allow one `[w3]` miss (R3-01), tick on the ≤ 12-word headline / lead clause (R3-02, R3-06 as weakened), and G1 counts only patched defects (R3-04). | The app's best senior content is currently scored so that about 12% of sets pass at 80% coverage. | M · none (side files, `eb-weight.ts`, `ladder-service.ts`) |
| 7 | **Redo cards** for passed drills, predict-output and katas (R5-04). Seed them first from the units whose tests are strong: fund-js and sysdrills. bootforge and jstrain can come back once their boundary tests are fixed, otherwise "redo" re-runs the same weak tests (R2-02). | Spacing for production items; today only recognition is spaced. | M · none |

**Coverage of round 2:**
- Read: R1 in full; R3 §1-3 in full; the verdicts and findings tables of R4 and R5.
- Re-ran: R1's length and verbatim probes with a baseline and stricter thresholds; mutation over all 62 fund-js drills; R3's kata leak and defect counts; a lead-clause analysis over all 1,701 design kps.
- Read the code for Q1: both fingerprint modules.
- Not re-checked: R1's Java/C# variant runs, R1-04 NuGet cache claims, R3-01 slack distribution, R3-05 G2 path counts.
