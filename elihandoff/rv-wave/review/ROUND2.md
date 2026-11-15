# Round 2: cross-examination (all five reviewers)

All five round-1 reports are in `C:\Users\Owner\Desktop\selfboot\review-2026-11-12\`:
R1-fundamentals.md, R2-packs-quests.md, R3-explainback-design.md, R4-features-ux.md, R5-learning-design.md.
The BRIEF.md rules still apply: read-only, low RAM, targeted runs only, cite and tag VERIFIED/JUDGMENT.

## Your job
1. Read the reports assigned to you below, in full.
2. Attack their top findings: for each, rule **CONFIRMED**, **WEAKENED** (true but overstated or the fix is wrong) or
   **REFUTED**, with your own evidence (re-run their probe or check the cited lines). Do not just agree. Their
   reports cite their scripts in `work/<id>/`.
3. Rule on the five contested questions below (everyone votes on all five, with a one-paragraph reason).
4. Give your revised **top 7 for the whole app** (across all domains), ranked by skill gain for the owner per
   hour of build effort.

Write `<your-id>-round2.md` in the same folder (under ~150 lines). Final message: at most 25 lines.

## Assignments
| Reviewer | Attack |
|---|---|
| R1 | R4 (honesty holes R4-01/02/07, demotion R4-04, streak R4-05) and R2's drill-mutation method and numbers |
| R2 | R1 (R1-01 length cue, R1-02 example reuse, R1-03 mutants) and R3 (R3-03 kata fold, R3-04 consequences, R3-06 repo-specific rubrics) |
| R3 | R5 (the big archive CUT, Practice mode, redo cards, usage gate) and R2's CUT list |
| R4 | R5's code claims (service.ts next-up, slate composition, "only recognition is spaced") and R3's proposed fixes (eb-weight side file, open-book G2, interview mode) for feasibility |
| R5 | R1, R3 and R4's ADD lists: which additions contradict "stop building, start using", and which earn their place |

## Contested questions (everyone votes)
- **Q1 Restamp scope.** AGENTS.md says `shared/src`, `tools/seed/src/factory`, `server/src` are fingerprinted. R4 says only
  the runner files and a few seed-imported shared files are bound (`grader-fingerprint.ts:56-101`); R1 says a change
  to `scratch.ts` restamps every drill-cs pack. What is actually true? Check the fingerprint code yourself.
- **Q2 Freeze vs add.** R5 wants a usage gate (no new content waves until ≥100 attempts over ≥14 days). R1 and R3
  propose substantial additions (C#/Java senior topics, 8 design problems, ~30 agentic units). Which additions, if
  any, should be allowed before the owner uses the app?
- **Q3 Honesty model.** R4 found real holes (blind brute force, "x x x" EB passes). R5 says the honesty model guards
  against an adversary that doesn't exist and wants a Practice mode. Tighten, loosen, or split? What exactly?
- **Q4 Archive scale.** R5 proposes archiving ~3,100 of ~5,200 units; R2 proposes demoting ~1,500 items. How much,
  which, and by what mechanism (no deletion of stamped content; historical keys stay byte-identical)?
- **Q5 Fix Fundamentals before landing.** R1 says renumbering (SQL basics first) and other fixes are only cheap before
  `f52-wave` lands on `main`. Should the owner land now and fix later, or fix first? Which fixes are must-do?
