# C1 (lens: learning value / product): rulings on the ab draft plan

Lens: owner at 0 XP. Day one must be finishable in ~40 min, week one builds a habit, month one shows what is weak.
Content volume (5,076 units) is not the bottleneck. Live DB checked read-only, GET calls only.

**Q1 scope/order: AMEND.** Round 1 = A + a trimmed B (see Q8); no C in parallel. Start round 2 only after re-checking
`xp.total`: R4 itself says "dogfood two weeks, then re-read §2" (R4-app.md:14-16). If it runs anyway, keep C1-C4
(interview-core: JS traps, txn/jobs/caching, LINQ/Java screening traps, DESIGN IT gaps). Swap C5 (more quiz layers on
top of 2,776 hand quizzes) for P4 drill re-exposure (R4 §5), the largest retention gap (L1).

**Q6 first-run slate: AMEND (fixes a defect in the draft).** "Smaller default when no attempts" breaks on the first
attempt. While the day is open, `composeSlate` rebuilds today's structure on every call and keeps the old size only for
drill sets already done (streak.ts:296-303), so the first verified drill would grow today's slate from ~5 to 21 actions.
Rule instead: the **unconfigured default itself is small**, and it stays small until the owner saves a settings row.
That is still a pure ledger function, because settings rows are ledger rows. No auto-ramp: silently growing the daily
load kills streaks. Default: **4 tracks × 1 drill + campaign step, review slot hidden while all-time cards = 0, so 5
actions.** It interleaves all four interview targets (L7), and week one shows where to focus. Keep 4×5 as an explicit
preset (`bootquest slate --preset full`). Acceptance becomes "≤ 6 actions, and unchanged after today's first pass".
Test churn: `streak.test.ts`, `api/api.test.ts`, `api/campaign.test.ts`.

**Missing from A1: a client focus picker.** An API + CLI alone gives day one nothing in the web app. Add a "Choose your
focus" dashboard card while no settings row exists (tracks on/off, size 1-5), plus an optional per-track **start
course** (`phase`) that the slate's `targetUnitId` (A4) points into. Today's next-ups are "Quick check: const" and
"Count the vowels" ×2 (GET /dashboard): warm-ups for an interview candidate. This changes pointing only:
`newDrillPasses` already counts any first pass on the track (streak.ts:186-200), and nothing is marked passed.

**Q5 weights: AMEND.** Use 70% + every w3 **for the unit pass/XP only**. All 81 DESIGN IT prompts already promise
"suggested pass: 70% with every [w3] hit", while the app enforces plain 80%, so today the app contradicts its own
content. But `evidence.score` must stay **plain coverage**, with weighted coverage in a new field. Promotion leg (b)
reads `e.score >= PROMOTION_MIN_COVERAGE` (evidence.ts:290-298), and `effectiveMinCoverage` is "never laxer than 80%"
(ladder-service.ts:270-275). A weighted `score` would quietly loosen promotion, so pin this invariant in a test.
**Strip `[wN]`: no.** Served text stays byte-identical (the frozen prompts say "add up the weights"); the client
renders the weight as a badge. **Blind mode: CONFIRM, high value.** Scoping is what system-design interviews test, and
every Q0 lists its sections in key-point order (R2 K3). Split at "Write your design before you look:", which 51 of 57
`[senior]` prompts contain; the other 6 get no toggle (no guessing). The toggle is stored on the answer (display only),
defaults to off, and is also offered on set-B/C retakes.

**§7.1 phantom missed days: AMEND.** Display-only, and closed rows stay untouched (streak.ts:348). Anchor the cutoff on
the **first learner action** (the minimum over attempt, review_log and xp_event), not on the first slate.
`firstActivityDay` uses MIN(daily_slate.day) (streak.ts:316-321), so merely opening the dashboard started the clock;
that is where the 15 "missed" days came from. Apply the cutoff in `getDashboard` (service.ts:772-776).

**§7.2 demotion: AMEND (fix, smaller).** Set `competencyId` on cards: 203 quest units have exactly one competency and
135 have none (DB count), so nothing is ambiguous. Add the 1-per-competency-per-day cap. **Cut `lapseWouldDemote` + the
confirm on Again.** A warning shown only on an honest "Again" invites a "Hard" instead, which corrupts FSRS; show the
demotion afterwards (the banner exists). Month-one effect is ~0: all ratings are 1, a floor demotion keeps banked legs
(evidence.ts:230-247), and /ladder reports `retests: 1`. Fold L3 into S2: a repeat miss "leaves its schedule alone"
(study-quest.ts:70-76) and should re-grade as `again` (S).

**Q8 cut or demote as low value now:**
- **Cut:** the B1 difficulty relabel (K5); B1's 4 duplicate retirements (declare twins only, no pin churn); the
  `lapseWouldDemote` confirm.
- **Defer:** A3's alt-set gap by score. It is a priori tuning with no data, and no alt set is reachable for weeks.
- **Demote to the importer gate only:** B1's 22 hint-3 rewrites. Hints are "not served yet" (shared/src/api.ts:387),
  so the rewrites have zero learner value today.
- **Keep, high value:** B1's task-line formulas → hint 2. Day one's sysdesign slot is 01-estimation, whose task text
  gives the formula away (K1).
- **Keep:** B2 (the flashcard-back trim, because long backs slow every review; the doc-recall stems; the 2-choice
  quizzes) and B3 (the payments-lab cite is a wrong fact; eblint).

**Missing, more important than the cuts (realistic in this wave):**
1. The focus picker + start course above (S, inside S1).
2. **Honest promotion reachability.** The competency panel should say how many units can complete leg (c) today (7
   live variants in the DB, 1 retest per /ladder). Plan variant seeding for act-1/2 artifacts as round-2 content;
   otherwise the truth layer stays inert for months.
3. Hide the A3 weak-spots teaser while there is no data (an empty "no weak spots" is false reassurance).

**Outside my lens, briefly:** §7.3 accept + baseline: CONFIRM. §7.4 re-seed the 6 packs: CONFIRM. §7.5 corrective note
where none exists: CONFIRM (otherwise a wrong key goes untaught). Q7: stop at a gated `ab-wave`.
