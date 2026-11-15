# R3 — Round 2 cross-examination (R5's CUT and loop proposals; R2's CUT list)

Evidence script: `work/R3/r2-attack.mjs`. It reproduces R5's archive rule exactly: 139 of 204 quest packs, using "no
DESIGN IT set, no kata, < 20 quizzes". It then tests that rule against the campaign unlock math, against
`related.json`, and against my own classic-EB tags.

## 1. R5

**R5-01 Usage gate — CONFIRMED, with a carve-out. (VERIFIED)**
- The non-use claim matches what I saw: 0 attempts, and next-up excludes EBs and katas (`service.ts:818-825`).
- The gate should block **new content and new tracks only**. It must not block integrity fixes or routing fixes:
  - R4-01 and R4-02: gate brute force, and the open-book retry after a failed gate.
  - R4-07: "x x x" passes an EB.
  - R3-03: the kata context leak.
  - R3-08 / R5-03: the slate and path routing.
- These are bugs in what the owner would be using on day 1. Leaving them in for 14 days teaches him that gaming works.
- The gate also needs a written definition of an attempt. Card reviews live in `review_log`, not `attempt`. 100
  attempts can be about 30 Fundamentals gates. The ≥ 14 distinct days condition is the part that matters.

**R5 §3 archive of ~3,100 units — WEAKENED: right direction, wrong grain, missing mechanism. (VERIFIED)**
- **The campaign deadlocks.** `campaign.ts:13-19,38-51` unlocks act N+1 on 80% of act N's core quests. Under the 139-pack
  rule, the core quests that survive are far below that bar:

  | Act | Core quests kept | Core needed (80%) |
  |---|---|---|
  | JS act 1 | 2 of 15 | 12 |
  | JS act 2 | 6 of 22 | 18 |
  | JS act 3 | 8 of 44 | 36 |
  | C# act 1 | 0 of 5 | 4 |
  | C# act 2 | 0 of 4 | 4 |
  | Java acts 1-2 | 1 of 4 each | 4 |

  Every act gets stuck behind units the archive hides. `core.json` must also change the unlock math in
  `campaign.ts` (not fingerprinted, so no restamp). R5 does not list that file.
- **The f52 practice pool gets hidden.** 157 of the 433 drill keys in `content/fundamentals/related.json` (36%) fall
  inside R5's bootforge/jstrain/csbootcamp archive. The archive must exempt every key that `related.json` points at.
- **The repo-level rule throws out the good explain-backs.**
  - It archives 73 of the 94 classic EBs I tagged as transferable.
  - That includes 20 of the 29 weighted mx/cw-era sets: stockade idempotency, masternext BOLA, helios outbox, ww19
    index/hot-path, and both mastermorphic sets. One of those, the SSRF/prompt-injection set, is the best
    agent-security item in the app (R3-12).
  - At EB grain, my list cuts 40 (26 beginner + 14 owner-tooling).
  - Fix: archive at **item grain** using a tag side file, not at repo grain.
- **It archives all of React** (react-fundamentals, react-state, react-ts: 513 units). The owner's stack is React and
  Next.js, and the only other React content is fund-js 19-20. Archiving it is wrong for this owner. A better cut is
  R2's: demote by solution size or test weakness inside the course, not the whole course.
- **What I endorse from §3:**
  - archive, never delete;
  - an allow-list side file;
  - csbootcamp 31;
  - jstrain 01-11 language modules, after exempting the `related.json` keys;
  - JS/C#/Java Fundamentals 01-14 demoted behind placement;
  - one primary language on the slate.

**R5-10 / F2 Practice vs Evidence mode — WEAKENED (JUDGMENT).**
- **The adversary does exist.** It is the owner's own self-flattery on self-scored work, and R4-07 shows it costs
  nothing to give in to. So "loosen" is wrong for EBs, katas and DESIGN IT. There, answer-first is the learning
  mechanism itself (generation before feedback), not only an anti-cheat rule. A free reveal would destroy it.
- **R5 is right for recognition items.** Fundamentals gates and quest quizzes withhold per-item feedback and add a
  cooldown. That cuts against corrective feedback.
- **Practice must not be the default everywhere.** If it is, the evidence ledger stays empty. The ledger is already
  inert (01 §7.3), and nothing would ever move it.
- My split is in Q3. Note that practice retakes for EBs already exist (migration 015, assistance `practice`), so R5's
  F2 is partly built.

**R5-04 / F6 Redo cards — CONFIRMED diagnosis, WEAKENED mechanism. (VERIFIED)**
- R5's §7 warm-up is 10 minutes for 6 due items that include redo drills. But a drill is estimated at 5, 10 or 15
  minutes (`estimates.ts:8-12`), so the budget does not add up.
- Re-serving the **same** drill is weak:
  - Median solutions are short: sysdrills 2 lines; 36% of bootforge drills are ≤ 3 lines (R2-09).
  - So a redo of the same unit tests whether you remember the solution, not the skill.
- Better:
  - a redo card opens a **sibling** in the same module, or a changed-example variant. The variants mechanism exists:
    the `seed:variants` wrong-solution filter;
  - cap redo drills at 1 per day;
  - enrol only difficulty-2+ drills with ≥ 5-line solutions;
  - add **missed explain-back key points as cards**, which are cheap and seconds long (my M4).

**R5-03 slate starves senior content, R5-07 "Why it works" before the task — CONFIRMED.** These match my R3-08 and
R3-09 independently: 129 of 129 sysdrills have the section; 99 of 129 worked examples equal a test.

## 2. R2's CUT list

| # | Ruling | Evidence / reason |
|---|---|---|
| C1 finding-location 47 | CONFIRMED | Pure `file:line` recall. Consistent with my G2 file-path finding (R3-05). |
| C2 two-choice 15 | CONFIRMED | — |
| C3 ~200 V-class quizzes | CONFIRMED with a caveat | The rule is "the key is a bare literal". It is single-rater, so run the rule mechanically: keep a quiz if its stem asks *why*. R5 measured 65% repo-incidental on n=52 and R2 measured 31% on n=394. The larger sample wins, so ~200 is the defensible first cut. |
| C4 ~120 repo-process flashcards; M7 FSRS only for transferable cards | CONFIRMED | This is the cheapest high-value change in R2's report: an enrolment filter in `study-quest.ts`, no restamp. It is also R4-04's demotion-noise fix in disguise. |
| C5 twin packs: "merge each pair into one campaign step" | WEAKENED | `ladder-real.test.ts:141` asserts that every non-DESIGN IT explain-back is quest-linked. Twins carry classic EBs on both sides (e.g. 3buildagentteachgem ↔ astra-learning-studio; ww19 has A+B+G2). Removing a campaign step orphans those EBs and fails the suite. Use R2's other option instead: retire the thinner pack's **quiz gate** and keep the step. |
| C6 bootforge quizzes, 544 demoted | CONFIRMED | 78% longest-is-key, already baselined in `answer-length-baseline.json`. |
| C7 562 micro-drills demoted by solution size | WEAKENED | Size is a poor proxy: a one-line SQL or regex can be the hard part. Combine it with R2's own mutation-survivor list (`mut-bootforge.json`): demote drills that are small **and** weakly tested, and exempt the 157 `related.json` keys. |
| C8 jsprojectlearn system-design-lite 18, C9 ww6 6 | CONFIRMED | — |

## 3. Votes

**Q1 Restamp scope — R4 is right about `server/src`. AGENTS.md is too broad. R1 is right about `scratch.ts`, and it
reaches further than R1 said. (VERIFIED)** There are two fingerprints.
- **Code-pack stamps** (`server/src/store/grader-fingerprint.ts:56-101`) bind, per grader kind:
  - the runner files, `api/runners.ts`, `api/runner-csharp.ts` and `api/runner-java.ts`;
  - the import gate: `tools/seed/src/validate/{validate,verdicts,journal}.ts` (plus `validate-java.ts` for java);
  - the toolchain versions.

  `runners/csharp/scratch.ts` is in **both** the csharp and the java lists, so editing it restamps all drill-cs
  **and** all drill-java packs.
- **Seed-pack stamps** (`tools/seed/src/factory/fingerprint.ts:1-40`) bind each generator's import closure, walked
  over `tools/seed/src` and `shared/src`, from `shared/src/{seed-pack,check,pack}.ts` and `check.ts`. Through
  `pack.ts → api.ts`, `index.ts` and their imports, that closure takes in:
  - `api.ts`, `schemas.ts`, `enums.ts`, `check.ts`, `mutation.ts`, `sync.ts`, `thresholds.ts` and `campaign.ts`;
  - plus `runners.ts` bytes.
- **Not bound:**
  - engines, stores and services (`service.ts`, `ladder-service.ts`, `study-service.ts`, `hints.ts`, `fsrs.ts`,
    `campaign.ts` engine);
  - `shared/src/api-ext.ts`, `eb-weight.ts` and `fundamentals.ts`;
  - the client.
- **Caveat for everyone:** `thresholds.ts` (`PROMOTION_MIN_COVERAGE = 0.8`, `G1_*`) is bound. So changing the 80%
  number restamps the estate. Changing the rule in `eb-score.ts` does not. My R3-01 fix must stay in the engine and
  in `eb-weight.ts`.

**Q2 Freeze vs add — freeze content, allow fixes and routing.**
- **Allowed before use:**
  1. integrity fixes (R4-01/02/07, R3-03);
  2. routing (slate, paths, next-up);
  3. grading-semantics fixes that make existing content usable: R3-01 `[w3]` rule, R3-05 open-book G2, R3-09 hint
     order, R2 M7;
  4. small authoring repairs to items that are not on `main` yet (Q5).
- **Frozen until the R5 gate is met:** my 8 design problems, the ~30 agentic units, R1's C#/Java senior topics, R2's
  repodrills, new ladders.
- **Reason:** the marginal new unit is worth ~0 at 0 attempts. A broken grading rule on existing senior content is
  worth a lot, because it will be the owner's first impression of that content.

**Q3 Honesty model — split by item kind, and tighten where scoring is self-reported.**
- **Recognition** (Fundamentals gates, quest quizzes): per-item feedback right after submit, in a Practice attempt
  that never counts. The gate pass is a separate fresh attempt, with R4-01's server-side retry budget and no Q numbers
  in a failed response.
- **Drills:** unchanged; feedback is already immediate. Fix the sysdrills hint order (R3-09 / R4-03).
- **Self-scored kinds** (EB, DESIGN IT, kata): keep answer-first and keep the evidence rules. Add a floor:
  - an answer under ~15 words per question cannot mark any key point covered without a confirm, stored as
    `low_overlap` (R4-07);
  - plus evidence spans (my M3);
  - practice retakes stay free.
- **Net:** loosen feedback timing for recognition; tighten the claims behind self-scores.

**Q4 Archive scale — about 1,500-1,800 units, at item or module grain, via a server-local allow/deny side file that
`service.ts`, `streak.ts`, `trackunits.ts` **and `campaign.ts`** all read.**
- **What goes:**
  - R2 C6 (544 bootforge quizzes);
  - C7 restricted to small and weakly-tested drills (≈ 300-560);
  - jstrain 01-11 minus `related.json` keys (≈ 350);
  - csbootcamp 31;
  - 40 EB packs (mine);
  - R2 C1-C4 (~380 items);
  - the 12 duplicate campaign skims.
- **Quest packs:** demote their gates for the 139 thin packs from the slate and next-up, but keep the campaign steps
  counted with unlock math adjusted, not hidden wholesale.
- **Rules:** no deletion; keys byte-identical; retired EB packs only where the owner agrees.

**Q5 Fix Fundamentals before landing — fix first, but time-box it to one short pass (≤ 1 day), then land.**
- **Must-do** (cheap now, illegal after the byte-identical freeze):
  - R1-06 renumber SQL 29-32 ahead of 21-28; the keys carry the id;
  - R1-01 length-rank rebalance plus the rank lint;
  - R1-03 test gaps; content-only;
  - R1-14 the 4 version-trivia items;
  - R4-02 is client-only and can go either side.
- **After landing:** R1-08 explanation depth, R1-02 fresh examples (as set-B items), React 19 delta, JDK 21 (an owner
  decision with a drill-java restamp).
- Landing unblocks the R5 usage clock, so do not let pre-landing polish run longer than a day.

## 4. Revised top 7 for the whole app (skill gain per build hour)

1. **Land f52 after a ≤ 1-day must-do pass (Q5), sync signalpost, adopt the usage gate (R5-01).** Owner action plus S
   content work. Nothing else gains skill while attempts = 0.
2. **Close the day-1 gaming holes.**
   - R4-01/02: server-side failed-gate response and retry budget; no open-book retry.
   - R4-07 + R3-16: low-overlap confirm on EB self-scores.
   - R3-03: fold kata context files and finding markers.

   S each, no restamp.
3. **Re-route the loop to the senior material.** One "senior rep" slot rotating DESIGN IT / kata / fund-js 21-33 /
   G2; seeded paths for sysdesign and agentic; next-up C8 narrowed to unstudied repos; one primary language
   (R5-03/11, R3-08, R4-05). M, no restamp.
4. **Make DESIGN IT and G2 gradeable as built.**
   - Allow one `[w3]` miss (or a cap of 2 `[w3]` per question) in `eb-score.ts`;
   - open-book G2;
   - blind on by default for [senior].

   (R3-01/05/07.) S-M, no restamp, keep `thresholds.ts` untouched.
5. **Spacing for production and for senior misses** (redesigned R5-04):
   - missed `[w2]`/`[w3]` key points become FSRS cards;
   - 1 sibling-drill redo per day;
   - FSRS enrolment only for transferable flashcards (R2 M7), which also defuses R4-04.

   M, no restamp.
6. **Feedback timing for recognition items** (Q3 split): a Practice attempt with per-item explanations, separate from
   the counted gate. Plus the sysdrills fixes: hint order swapped, "Why it works" folded until the first failed
   submit (R3-09, R4-03, R5-07). S-M.
7. **Archive at item/module grain via a side file that `campaign.ts` also reads** (Q4: ~1,500-1,800 units, React
   kept, `related.json` keys exempt). S-M, no restamp. It shrinks the surface without deadlocking acts or hiding
   f52's practice pool.

Deliberately not in the top 7: interview mode (mine), the 8 new design problems, the agentic ladder, repodrills, the
JDK 21 move. Re-rank them after 14 days of real use.
