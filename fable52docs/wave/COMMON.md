# f52 wave — common brief (binding for every stream)

You are one of several agents implementing `fable52docs/` (read `README.md`, then the findings file(s) your
stream names, then `03-IMPLEMENTATION-PLAN.md`). Read `AGENTS.md` first; it is the repo contract.

## Hard rules
- Work ONLY in your own clone and on your own branch (named in your brief). Never touch
  `C:\Users\Owner\Desktop\selfboot`, never commit to `main`, never push, never `--no-verify`, never rewrite history.
- Never start a server on ports 4178 or 5173 (the owner's live app) and never open
  `C:\Users\Owner\bootquest\bootquest.db` for writing. If you need a live check, use the sandbox recipe in
  `fable52docs/README.md` with your stream's ports (in your brief) and stop the server when done.
- Use the Bash tool (Git Bash) for npm scripts. Run heavy jobs in the foreground.
- Commit per logical change with a message file: `git commit -F <file>`; end every message with
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Uncommitted work counts as not done.
- Do not edit files another stream owns (ownership is in your brief). If you believe you must, stop and say so
  in your report instead.
- No restamp: `npm run restamp:all -- --dry-run` must still report every pack fresh (Fundamentals content
  stream excepted: it recompiles its own packs by the runbook). `shared/src/api.ts`, `enums.ts`, `check.ts`,
  `schemas.ts`, `seed-pack.ts`, `server/src/api/runners.ts` and `tools/seed/src/factory/**` are off limits.
  New DTOs go in `shared/src/api-ext.ts`.
- Keep every existing `data-testid` unless your brief says otherwise. Update tests you break; add tests for
  what you add. Do not delete a test to make the suite green.
- Report truthfully. If something is not done or a gate fails, say so with the output tail.

## Council rulings (override the docs where they differ)
1. Assisted attempts do NOT earn less today (only reveal zeroes XP). Do not claim otherwise in UI copy.
2. Fundamentals quiz gate is closed-book: the lesson is hidden while the gate is open. "Show lesson" sets the
   attempt assisted (checkbox ticked + disabled) for that try; retry hides the lesson again.
3. The gate stepper (one question at a time, 1-4 + Enter, back/forward, review screen, NO right/wrong signal
   before submit) applies to Fundamentals topics only; campaign study quests keep the all-at-once form.
4. After a PASSED gate show keyed answers + explanations; after a FAILED gate show only which questions were
   missed. Review cards for missed questions stay enrolled exactly as today.
5. Dashboard hero priority: reviews due → Fundamentals next step (first enabled language track with an
   unfinished ladder) → first undone slate item → nextUp[0]. Never an explain-back.
6. Hints: hint N is available only after ≥1 recorded failed submit on the unit; serve hints 1-2 only (never
   the last authored hint); hint 1 costs 25% of the pass XP, hint 2 a further 25% (floor 50%); a hinted pass
   is a verified pass but must not count as unassisted ladder evidence. Reveal stays 0 XP.
7. Deferred (do not build): new ladders (C9), capstones (C10), sysdesign/agentic acts (C7), full step-lesson
   engine (C4), kata generator rule (C6 option b).
8. CSS: Stream P may edit `client/src/styles/app.css` only at lines 33-36 and inside the player/editor/results
   region (~1171-1415) and adds new rules in `client/src/styles/player.css`. Stream D must not edit `app.css`;
   it adds `client/src/styles/dashboard.css` and owns `fundamentals.css`, `trackunits.css`, `slatefocus.css`.
   Import new CSS from `client/src/main.tsx` (P: directly after the app.css import; D: after find.css).
9. `client/src/api/types.ts`, `http.ts`, `mock.ts`, `fixtures/*.json`: only the stream whose brief says so.

## Stop report (your final message, ≤ 400 words)
branch + commit SHAs · what you changed per finding id · gates run with the last lines of output ·
deviations from the brief and why · anything left undone · bugs found outside your scope.
