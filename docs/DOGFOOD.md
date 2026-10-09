# First-week dogfood checklist

The goal is to use BootQuest for real for a week on a real DB, and to log every
surprise. Each item says what "good" looks like.

**Where to log:** append a dated `## YYYY-MM-DD — dogfood` section to `LEARNING.md` for
every surprise, with one line each: what you did, what you expected, what happened.
Bugs that block you go at the top of that section. Do not fix anything mid-session: log
it first.

## Day 1: boot and drills

- [ ] **Boot on a real DB.** `set BOOTQUEST_DB=C:\Users\Owner\bootquest\bootquest.db`,
  then `npm run serve`.
  - Good: one summary line per pack (bootforge, csbootcamp), per campaign track and per
    seed source, each with loaded === built, plus a ladder-units line, then
    `API listening on http://127.0.0.1:4178`. A refusal names exactly what is stale and
    the command that fixes it.
- [ ] **Start the UI.** `npm run dev -w @bootquest/client`, then open
  http://localhost:5173.
  - Good: a dark dashboard with streak 0, level 1, the 7 competency rows at 1, an empty
    heatmap and today's slate.
- [ ] **Busy port.** Start a second `npm run serve` while the first is running.
  - Good: a clear "port 4178 is already in use" refusal; the DB is untouched.
- [ ] **Drill set on the JS track:** 5 BootForge drills. Use run first, then submit.
  - Good: run never moves XP; submit pays 10 x difficulty once; the drill slate slot
    ticks after the first-ever pass today.
- [ ] **Drill set on the C# track:** csbootcamp.
  - Good: the first C# grade is within about 60s (warm-up); later grades are under
    10s; the untouched starter is graded FAIL even though it exits 0 upstream.
- [ ] **Clear the review queue** (if any cards are due). Grade them with keys 1 to 4
  after revealing each card.
  - Good: XP is 1 per review, capped at 30 per day.

## Day 2: campaign and answer-first players

- [ ] **Campaign act 1 reading steps**, on both tracks.
  - Good: each reading step self-attests once for 5 XP and ticks the campaign slot.
    Act 2 shows as locked, and its units answer 403 ACT_LOCKED.
- [ ] **One explain-back, end to end.** Pick one from your act-1 repo, for example
  grok-js or jstrain2.2.
  - Good: the questions show and the key points do not. You answer with the code
    hidden, and the answer is stored first. Only then does the key open. You mark each
    key point covered or missed, and the server computes the coverage. ≥80% pays 20 XP
    once. A second answer is refused.
- [ ] **One patch kata, end to end** (agentic track, Kata bank).
  - Good: the diff and context are shown without a defect count. You write findings as
    {scenario, evidence, consequence} before the key opens. Self-scoring per defect pays
    15 XP. Stats shows the G1 catch rate. If you flag the kata as assisted, it is
    counted separately and does not move the G1 gate.

## Day 3: sync and the artifact leg

- [ ] **Sync signalpost.** Run `bootquest sync`, or the sync button in the UI.
  - Good: the report shows 12 program units (U01 to U03 checked, U04 to U12 study) and
    a seed-queue count. Restart the server so the ladder loader links U01's explain-back
    and its retest variant.
- [ ] **U01 artifact from your own editor.**
  1. Create a project folder with `.bootquest.json`:
     `{"unitKey": "gh:elirc/signalpost-swe-bootcamp:U01", "file": "practice/learner/u01.mjs"}`.
  2. Write the code, then `bootquest run` until it is green, then `bootquest submit`.
  - Good: exit 0 on pass; a verified, solo artifact leg shows on the dashboard.
- [ ] **U01's explain-back**, right after the artifact.
  - Good: once you self-score ≥80%, the dashboard shows the retest leg as "scheduled"
    with an opening date 2 or more days out. Before that date, the retest unit refuses
    run and submit (NOT_DUE) and does not show its instructions.

## Days 4-5: habits

- [ ] Daily slate: one drill set per track, one campaign step and an empty review queue.
  - Good: the streak increments, and any day with 20+ XP counts as partial.
- [ ] Two or three more katas, working towards G1 (≥80% across ≥10 seeded defects).
- [ ] **One G2 delegation brief** (agentic track). Write the brief before opening the
  rubric. Self-score it with the weights.
- [ ] **Mutation gate once**, on one solo-project unit you passed. Run `bootquest mutate`
  from the project folder.
  - Good: either a pass, recorded as evidence on your latest passing submit, or a list
    of the surviving mutants, with the per-file floor and the overall 60% both enforced.

## Day 5 or later: the retest

- [ ] **The U01 changed-example retest**, once it opens (2 or more days after the
  artifact and the explain-back). Solve it solo.
  - Good: the pass promotes the U01 competency one notch. The competency table shows
    all three legs done, with links to the evidence.

## Once only: phone width

- [ ] **Phone-width check.** Open the UI in a narrow window (about 390 to 420 px), or
  use device emulation in DevTools. Walk the dashboard, a drill, the campaign map and
  the explain-back and kata players. This was never verified at build time: the P5
  headless capture at 420px was ambiguous, and `min-width:0` was added blind.
  - Good: no horizontal page scroll, readable text, the heatmap scrolls within its
    panel, and the editor is usable.
  - Log the result either way.

## End of week

- [ ] Write a short summary in LEARNING.md covering:
  - what you used daily;
  - what you skipped and why;
  - which content felt thin;
  - which owner decisions in docs/SEEDING.md "Backlog" are now clear.
- [ ] Back up the DB file. Wipe it only if you want to: `npm run reset -- --yes-really`
  moves it aside and never deletes it.
