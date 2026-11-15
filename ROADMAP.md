# BootQuest roadmap

Planned work, in order. It is taken from the owner's own plan in
`elihandoftwo/03-SENIOR-CRUD-UPSKILL-IDEAS.md` (section 7, "Suggested order"), the
honest assessment in `elihandoftwo/01-STATE-OF-THE-APP.md` (section 7) and the
first-week checklist in `docs/DOGFOOD.md`. Item codes (U0, B1, L7...) are the ones
those documents use, so each line can be traced back to its full specification.
Status as of 2026-11-06.

## Now: use the app, build nothing new

1. **U0 Dogfood for real.** Run `docs/DOGFOOD.md` on a real DB for about ten
   sessions, log every surprise in `LEARNING.md`, fix only what blocks. No new
   content waves until at least 30 recorded attempts exist (the owner DB has 0).
2. **U1 Switch the truth layer on.** Run `bootquest sync` for
   `elirc/signalpost-swe-bootcamp` so U01 to U03 register as program units with
   real node:test checks; that makes four of the eight competencies promotable
   with no code change. Record the outcome.
3. **U2 Close the G3/G4 dead end.** Add the artifact to explain-back link field
   in the server-local authored-units file, author an explain-back set for G4 and
   a variant for G3, so a fifth competency can promote.

## Next: make a rating mean something

4. **B1 Tiered promotion.** Each project unit declares a `tier` 1 to 5; an
   artifact promotes a competency only to `min(rating + 1, tier)`, and notches 4
   and 5 need artifacts from two different codebases.
5. **B7 Calibration.** Before each lab, ticket or kata submit: a 50% and 90% time
   estimate and P(pass on first submit); the server derives elapsed time and
   shows the 90% hit rate and Brier score per competency. Ship with the
   fail-to-pass predicate.
6. **U3 Senior CRUD path.** At most 40 ordered stops served by the slate:
   signalpost U04 to U07, the bootforge fullstack-crud drills, L7 katas, then labs
   as they land.
7. **L1/B3 One tracer-bullet lab.** signalpost U07 as a spec-hidden feature
   ticket, dogfooded end to end including its explain-back and a retest in a
   different repo. Reorder everything after this by what hurt.
8. **L7 + B8 PR-shaped review katas** with clean PRs and contrasting cases.
   Mostly content; best value per hour.
9. **B2 Bring-your-own ticket.** Any real change in any repo counts when it
   meets the fail-to-pass predicate, so real work becomes the main promotion
   source.

## Later: labs, in the order the dogfood decides

- **B4** large-codebase navigation and blast radius, then **L2** schema
  migration (expand, backfill, contract) and **L3** query-plan labs.
- **B5** mystery-ticket pool with spaced re-exposure, once three labs exist.
- **L6 + B6** incident, instrument, alert; **L5** security exploit-then-fix;
  **L8** legacy refactor with characterization tests; **L4** app-level race lab
  after its spike; **L9** frontend labs after a vitest runner; then wave C
  content.
- **U4** placement exam, only if the dogfood shows it is needed.
- Thicken the Java and C# campaigns (12 and 67 steps against 259 for JS); Java
  has no web leg yet.
- README: state that content keys are readable on disk in the public repo.

## Open owner decisions (SEEDING.md, section 8)

The 80% app floor against the "suggested pass 70%" in the DESIGN IT prompts; the
single code-reading competency on study quests; two-choice quizzes (a factory
change plus a restamp); frozen wrong items; the five javadrills task lines that
still give the formula.
