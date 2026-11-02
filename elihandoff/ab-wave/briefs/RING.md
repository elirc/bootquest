# ab wave ring review (S1→S2→S3→S4→S5→S6→S7→S1: each stream reviews the next one)

You are a stream agent whose own branch is done. Now review the NEXT stream's finished branch, read-only: never edit
its clone, never commit there. `S` = `C:\Users\Owner\Desktop\bootquest-handoff\ab`, `H` =
`C:\Users\Owner\Desktop\selfboot\elihandoff`. Keep scratch files in your own `scratchpad/S<you>/`.

Read: the target's brief `S\briefs\S<t>.md`, `S\RULINGS.md`, the target's stop report `S\reports\S<t>.md`, the hub
rulings in `H\ab-wave\STATUS.md` "Stream stop reports", then its diff:
`git -C C:\Users\Owner\Desktop\bq-qw-s<t> diff origin/ab-wave..ab-s<t>` (skip validation.json / manifests / stamps).

## Check (app streams S1-S5)
1. Correctness: read every changed source line. Look for real bugs: off-by-one day bounds (local day vs UTC), SQL
   that ignores closed days or retests, races between refetches, error paths, strict zod DTOs that reject new fields,
   migrations 017/018 used as declared.
2. Brief + RULINGS compliance: every Build and Acceptance item done or honestly reported missing; nothing forbidden
   touched (`git diff --stat origin/ab-wave..ab-s<t>` against RULINGS R2's list); honesty rules kept (keys only after
   a stored answer, append-only ledgers, derived slate, closed days immune).
3. Tests: does each behaviour change have a test that would fail without it? Spot-check by reasoning, or by running
   the targeted test file in the target clone read-only (`npx vitest run <file>` from its package dir is fine; no lock
   needed for a single file). Do not run full suites (HEAVY) unless your finding depends on it.
4. Cross-stream: will it merge cleanly with the other streams? Shared files: `shared/src/api-ext.ts`,
   `server/src/api/app.ts`, client `api/{types,http,mock}.ts`, `Dashboard.tsx`, `getDashboard`. Flag semantic clashes
   (e.g. S1 changes slate size while S4 computes slate targets).

## Check (content streams S6-S7) — additionally
5. Code-truth: re-check ≥ 40% of the changed keys/claims at the pin (`selfboot\.cache\checkouts`, file:line). S6:
   recompute ≥ 1/3 of the changed drill vectors by hand and run ≥ 3 trap tests (solution AND naive; the named test
   must fail only the naive). S7: stems describe a situation (not "what does the doc say"), same correct choice for the
   same reason, flashcard backs one fact ≤ 40 words, `node H\tools\slotcheck.cjs <target clone> origin/ab-wave` 0 BAD,
   pre-mx bytes unchanged (`git diff 9b7f0ea3 --stat` on the old paths). Reviewer of S7: judge the 4 accepted
   baseline pairs (helios q0.kp5/kp6, ww7 q1.kp0, masterstore q1.kp1): really not leaks?
6. Leaks both directions with `node H\tools\dossier.mjs`.

## Output
Write `S\review\S<you>-on-S<t>.md`: verdict (PASS / PASS WITH FIXES / BLOCK), then ranked BLOCKING / SHOULD / NIT,
each with file:line or item id, evidence and the exact fix. Check the report's claims by counting. Reply in ≤ 25 lines.
The target stream then fixes BLOCKING + SHOULD as NEW commits (never amend), re-runs the affected gates, and appends
a "Ring fixes" section to its report.
