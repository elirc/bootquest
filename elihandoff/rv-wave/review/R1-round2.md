# R1 · Round 2: cross-examination of R4 (honesty and engine) and R2 (drill mutation)

Target: `bq-review` @ `dc2206bc`, read-only. New probes are in `work/R1/mut/r2check.cjs`. I also re-read
R4's `work/R4/brute.mjs` and `eb.mjs`.

## 1. R4 rulings

| R4 id | Ruling | My evidence | Comment |
|---|---|---|---|
| R4-01 gate brute force | **CONFIRMED (mechanism); WEAKENED (severity P1 → P2; fix incomplete)** | `server/src/api/study-service.ts:158-174` builds `missedNos`, puts `missed Q2, Q3…` into `output` and names each miss in `failures[]`. `StudyQuizOutcome.items` (`shared/src/api.ts:599`) is a plain `z.array(…)` with no `.min()`, so `items: []` is schema-valid. That contradicts the f52 REPORT deviation ("strict schema in a fingerprinted file"). | **Why the fix is incomplete:** stripping per-question marks is not enough. `correct`/`total` alone still leaks: change one answer at a time and the score delta shows whether that question is right. That is ≤3 submits per question, so ≤30 per gate. The server retry budget (R4's second fix) is the real control and must not be optional. **Why the severity drops:** the only party who can run `brute.mjs` is the owner, and an owner who scripts the API gains nothing. The P1 harm is that ordinary UI use records misleading `solo` passes, which is R4-02. |
| R4-02 open-book fail screen | **CONFIRMED; root cause is wider** | `client/src/pages/StudyQuestPane.tsx:232`: `gateOpen = started && submit === null`. After a fail, `gateOpen` is false, so the lesson renders again (`:312`). All questions stay rendered, disabled and unmarked, with the learner's picks (`:445-460`). The "Re-read: <headings>" line (`:618-627`) also narrows down which questions were missed. | Hiding the list is right (S), but it does not fix the cause. Every retake serves the **same 10 items**, which the learner has already read once. So a retake is never a fresh test, however the fail screen looks (my R1-02: 198 items copy the lesson's own examples). **Fix:** R4-02, plus a server retry budget, plus a rotating set B on retake (my T1). |
| R4-07 "x, x, x" explain-back | **CONFIRMED; simpler fix** | `work/R4/eb.mjs` posts the answers **before** fetching the key, so the answer is locked when the key is released. An overlap or length check on the locked answer is therefore meaningful, not gameable by pasting. This matters because an EB pass is a promotion leg (`evidence.ts` explain-back leg: `mode = 'solo'`, `EB_PASS_SQL`). | **Proposed fix:** start with a server-side floor of at least 15 content words per question, below which self-score is refused (S). Add R4's per-key-point overlap flag later. Self-scoring stays honour-based by design, so stop the trivial case and do not pretend to grade prose. |
| R4-04 demotion | **CONFIRMED; if anything understated** | `engines/fsrs.ts:225-235` demotes on `again` from `State.Review`, capped once per competency per day (`lapseMayDemote`, `:178-191`). `evidence.ts:238-250` `lastRatingChangeAt` counts a real lowering, and every leg query requires `created_at > since`, so a recall lapse voids banked artifact, EB and retest legs. | **On R4's lapse rate:** R4 used 1 − 0.9 retention. That figure is FSRS's target for mature cards. Young Review-state cards (the first weeks after a gate pass, when all 558 Fundamentals cards enter) lapse at well above 10%, so daily demotion is more likely than 65% for an active learner. **Agreed fix:** a window-based rule (retention < 70% over the last 20, at most once per 7 days, no leg reset), M. **Priority:** low. The rule is inert while every rating sits at the floor and no competency is promotable (R4-20), so fix it in the same change that makes promotion reachable, not before. |
| R4-05 hero vs streak | **CONFIRMED** | `Dashboard.tsx:34,47`: `DONE_XP = 50` → "Done for today". `engines/streak.ts:415-425`: only `isSlateComplete` increments `current`; `xp >= PARTIAL_DAY_XP` only keeps it. The default slate spans 4 languages; slate settings exist but sit at the foot of the page. | **Recommendation: Option A over B.** A Fundamentals step fills the campaign slot, and the default slate becomes reviews + 1 Fundamentals step + 1 drill. B lets 50 XP of review-farming (R4-14) grow the streak, while A ties the streak to the hero's actual advice. M, no restamp. |

## 2. R2's mutation method and numbers

**What is sound.** The method is good: single-site mutants run against the shipped tests. I re-ran four of R2's
named "real gaps" with my own runner (`work/R1/mut/r2check.cjs`, plain `node:assert/strict`, the same harness shape as
`grade-core.mjs`). **All four wrong variants pass:**
- `safe-get` with `i <= 0`: passes 3/3; index 0 is never tested.
- `to-positive-int` with `n <= 1`: passes 4/4; input "1" is never tested.
- `protected-endpoint` with `||` → `&&` on the Bearer check: passes 4/4; there is no `Basic …` header case.
- `validate-new-todo`: worse than R2 says. Deleting the whole 100-character rule passes 5/5, because no test has a
  long title at all.

**CONFIRMED** that bootforge/jstrain tests have real boundary holes.

**What is weaker:**

1. **The "real gap" rates rest on tiny hand-check samples, so "lower bound ~200 drills" is the wrong label.**
   - 8 of 12 bootforge survivors were real, and 3.5 of 9 jstrain. The 95% intervals on those proportions are
     roughly 35-90% and 14-70%.
   - That makes bootforge's real-gap share of mutable drills about 13-34% (point estimate 23%), and jstrain's
     10-49%.
   - "~200 drills" is a point estimate with a wide interval, and only over loadable JS (123 TS/JSX drills
     failed to load). It is not a lower bound. **WEAKENED.**
2. **Raw survivor rates overstate gaps 3-5×, which kills the proposed hard-fail lint (M8).**
   - On fund-js with a similar operator set, 20 of 49 mutable drills (41%) had a survivor, but only about 4
     were real gaps; the rest were equivalent (`?? → ||` on non-falsy values, `await` dropped on sync fakes).
   - R2's own hand checks find 4 equivalent out of 12 and 5 out of 9.
   - A seed lint that **fails** on a survivor would block good drills and invite tests written to kill
     equivalent mutants. Make M8 a report with a reviewed baseline (the shrink-only `xleak-baseline.json`
     pattern), not a gate.
3. **The operator order biases what gets found.**
   - `mutants.cjs` takes the *first* regex match per operator, and `mutrun.cjs` keeps only the first 4 mutants
     (`slice(0, maxM)`). Relational operators are listed first.
   - So the survivor list samples loop bounds and early guards, and almost never `Math.*`, `??` or constants.
     Fine for a smoke test, but do not compare banks on it (sysdrills, rich in `Math.ceil`, gets different
     operators applied than bootforge).
4. **Cross-check (consistent with R2):** fund-js measured about 8% real-gap drills, sysdrills about 6.5%, and
   bootforge/jstrain about 23-27%. The hand-authored banks are about 3× tighter than the imported ones. That
   supports R2-02's fix split: fix sysdrills here; report bootforge/jstrain upstream.

## 3. Votes on the contested questions

**Q1 · Restamp scope: there are two distinct bindings, and neither covers all of `server/src`.**
- **Seed-generator stamp (estate-wide).** `tools/seed/src/factory/fingerprint.test.ts:28-48` pins `COMMON`, which
  includes 11 `shared/src` files (`api`, `campaign`, `check`, `enums`, `index`, `mutation`, `pack`, `schemas`,
  `seed-pack`, `sync`, `thresholds`), `server/src/api/runners.ts`, `tools/seed/exclusions.json`, the citation
  resolver and ~13 factory files. Editing any of these stales every stamp of the 5 generators.
- **Grader fingerprint (per drill kind).** `server/src/store/grader-fingerprint.ts:56-101` binds the runner files
  per kind; a change re-validates that kind's packs.
- **Correction to my round 1:** `server/src/runners/csharp/scratch.ts` is in **both** the `csharp` and the `java`
  lists (`:65` and `:93`). Editing it restales every drill-cs **and** drill-java pack (csbootcamp, csdrills,
  jstrain-cs, fund-csharp, javabootcamp, javadrills, fund-java), not only drill-cs.
- **R4's map is right but incomplete.** It names `api/enums/check/schemas/seed-pack` and misses
  `campaign/index/mutation/pack/sync/thresholds`.
- **Free to change:** everything else in `server/src` (services, engines, store, migrations), `shared/src/api-ext.ts`,
  `shared/src/fundamentals.ts`, the client and the CLI. AGENTS.md should say exactly this.

**Q2 · Freeze vs add: freeze new content waves, with three exceptions.** I concede R5's point against my own ADD
list. The 7+7 C#/Java topics, real-framework drills and new ladders should wait for usage. My gate would be 100 graded
attempts over 14 days **and** 5 Fundamentals topics completed. The exceptions:
- (a) Fundamentals fixes that are cheap only before landing (Q5).
- (b) S-sized fixes that make the first week work: R4-02, R4-05, R4-06, the hint policy, the content fences.
- (c) Test-case additions that close verified holes (R1-03, R2-A1 sysdrills). These are corrections, not waves.

Nothing else until the owner has used the app.

**Q3 · Honesty model: split.** The model exists for the owner's self-measurement and promotion evidence, not to stop
an adversary.
- **Graded mode** (the default for gates, drills and EBs that write evidence): closed-book, a server-enforced retry
  budget (3 graded tries per unit per 24 h), set B on retake, no per-question marks on a fail, an EB answer floor,
  and XP only on the first graded pass for single-question quizzes (R4-09).
- **Practice mode** (R5): Run/answer freely and see the marks. It writes no evidence, earns no XP, never counts
  as "first try solo", and is clearly labelled.
- **Do not build:** defences against API scripting beyond the retry budget.

That tightens what corrupts the signal in normal use and loosens everything else.

**Q4 · Archive scale: demote about 1,200 measured items now; decide the rest from usage.**
- **Measured and objective (R2):** bootforge one-item quizzes with longest-is-key 78% (544), bootforge micro-drills
  with ≤3 code lines outside sql-data (562), `finding-location` (47), two-choice items (15), ww6 card copies (6).
- **Mechanism:** a server-local side list (`content/demoted.json`, read by next-up, the slate and the campaign the
  way `related.json` is loaded, warn-and-skip). Units stay loaded and searchable, keys and stamps unchanged; no
  re-seed, no deletion.
- **R5's ~3,100 archive:** too much to decide on judgment with 0 attempts. Revisit it once the attempt log shows
  what the owner actually opens.
- **R2's repo-trivia quiz cuts (C3, about 200):** they need a re-seed, so do them pack by pack only for packs on
  the campaign path.

**Q5 · Fundamentals: fix first, timeboxed to about 2 working days, then land.** After landing, the byte-identical
rule freezes choices, prompts and ids. Must-do:
1. Rebalance the key's length rank, and add the rank lint (R1-01). After landing it cannot be fixed.
2. Add the R1-03 test cases (5 drills).
3. Renumber SQL 29-32 ahead of 21-28 (R1-06). Ids carry the order, so this is now or never.
4. Remove the 2 raw ``` fences (R4-13).
5. Add the 3 missing lesson sentences (R1-11).
6. Fix the stale ".NET 8" distractors (R1-13).

Defer to after landing, as additions rather than edits: fresh-example set B (T1), thicker explanations (if read per
key), extra items for 8-item gates. If the fix pass slips past a week, land anyway. Usage matters more than these
fixes.

## 4. Revised top 7 for the whole app (skill gain per build-hour)

1. **A day you can finish (R4-05 option A + R4-N1).** A hero-aligned default slate (reviews + 1 Fundamentals step
   + 1 drill), a streak that grows on it, and a bounded 10-minute mode. The owner has made 8 visits and 0 submits:
   nothing else pays until this does. M, no restamp.
2. **The Fundamentals fix pass, then land (Q5 must-dos).** This puts the most boot.dev-like content in front of the
   owner, with the cues and test holes that can never be fixed later closed first. S-M, fund packs only.
3. **Make the gate mean something (R4-02 + server retry budget from R4-01 + set B on retake later).** Without this,
   "complete" and "first try solo", the only honest number, drift. S now, M for set B.
4. **Hints that help but don't solve.** R2-03 (serve all bootforge hints: 1,388 single-hint drills currently show
   nothing) plus R4-03 (do not serve the sysdrills formula hint). One file, `server/src/engines/hints.ts` /
   `api/hints-service.ts`, outside both fingerprints. S.
5. **Answerable review cards (R4-06).** Put the choices on quiz-miss card fronts; every gate miss becomes such a
   card. S, `study-service.ts:183-212`.
6. **Debugging practice from what already exists.** Bug-hunt drills whose starter is the plausible-wrong version each
   drill's explanation names (R1 T2), plus R2's kill-the-mutant test-writing drills seeded from the verified survivor
   lists. These are the highest-value senior formats at the lowest authoring cost (tests exist). Start after the
   usage gate, with about 20 drills. S per drill.
7. **Demote the measured noise (Q4, about 1,200 items via a side list).** It shortens the "what next" surfaces
   without re-seeding anything. S.

Not in the top 7, on purpose:
- **Demotion redesign (R4-04):** do it together with the first promotion path.
- **Real-framework C# drills (R1-04/T10):** they restamp both drill-cs and drill-java via `scratch.ts`. Plan it after
  usage.
- **New C#/Java topics:** frozen until usage (Q2).
