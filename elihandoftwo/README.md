# elihandoftwo — BootQuest state report + senior CRUD upskilling ideas (2026-11-01)

Read-only report written after the ab wave landed (`main` b3815126). **Nothing in the app was changed.** This
folder is a report and a list of ideas; the previous handoff (`../elihandoff/`) stays the operational runbook.

## Files

| File | What it holds |
|---|---|
| [`01-STATE-OF-THE-APP.md`](01-STATE-OF-THE-APP.md) | what BootQuest is, the learner loop, unit kinds and grading, interfaces, integrity machinery, process, honest strengths/weaknesses, open owner decisions |
| [`02-CONTENT-CATALOG.md`](02-CONTENT-CATALOG.md) | all content at a high level by track and type, with counts, and a coverage map against a senior CRUD web-app engineer |
| [`03-SENIOR-CRUD-UPSKILL-IDEAS.md`](03-SENIOR-CRUD-UPSKILL-IDEAS.md) | proposed features, labs, writing formats and content to get from mid-level to senior, with effort and a suggested order |
| [`04-REVIEW-RESOLUTION.md`](04-REVIEW-RESOLUTION.md) | what the 3 adversarial reviewers found and how the report changed |
| [`review/`](review/) | the three reviews, verbatim: R1 fact-check, R2 senior-engineer / learning-science skeptic, R3 feasibility / architecture |

## Headline (details in 01 and 03)

1. **BootQuest is a large, rigorous, unused app.** 5,076 units over 5 tracks (3,239 drills, 244 explain-backs, 204
   quest packs with notes, 129 sysdrills, 52 katas), an unusually strict honesty model, and a full test battery
   that is green. The owner DB still has 0 attempts.
2. **Its truth layer is switched off.** No competency can be promoted today, and since every rating sits at the
   floor, demotion does nothing either. One existing command (`bootquest sync` of signalpost) makes 4 of 8
   competencies promotable, and a small server-only link field makes a 5th.
3. **Content is strong at reading and estimating and small at building.** Senior CRUD skill is mostly about
   shipping correct changes to living systems you did not write, and turning vague needs into specs.
4. **The proposed path** (03 §7):
   1. Use the app now.
   2. Switch the ladder on with the signalpost sync, and close the G3/G4 dead end.
   3. Make ratings mean something with tiered promotion, plus calibration on your own work.
   4. One spec-hidden feature ticket on signalpost as a tracer bullet.
   5. Review katas with clean PRs, and contrasting cases.
   6. Bring-your-own real tickets.
   7. Then navigation, migration, query-plan, race, security and incident labs; wave C content last.
5. **Process:** the draft was attacked by 3 Opus reviewers (fact-check, senior-engineer skeptic, feasibility).
   27 findings were applied (04): the factual ones were re-checked against code or a DB copy first, including the
   corrected headline above; the judgment ones (e.g. labs announce their category) were accepted on argument.
