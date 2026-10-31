# ab wave (day-one app fixes + content repair): shared brief for the 7 Opus stream agents (2026-10-30)

## Owner order
"review plan in elihandoff and implement, use 7 opus agents, council of 5 agents to review high level choices".
The plan is `H\REVIEW-2026-10-30.md`; a 5-member council amended it; the binding version is `S\RULINGS.md`. Where
RULINGS and REVIEW disagree, RULINGS wins. The owner has NEVER used the app (0 XP): this wave makes day one usable
and repairs content defects a learner would hit. **Quality over quantity**: small, correct, tested changes.

`S` = `C:\Users\Owner\Desktop\bootquest-handoff\ab`   `H` = `C:\Users\Owner\Desktop\selfboot\elihandoff`
Council files with the evidence behind each ruling: `S\council\C1..C5-*.md` (read the ones your brief names).

## Read first
1. `C:\Users\Owner\Desktop\selfboot\AGENTS.md` (contract; Windows shell gotchas).
2. `S\RULINGS.md` (binding), then your stream brief `S\briefs\S<N>.md`.
3. `H\REVIEW-2026-10-30.md` §5 (your stream's original brief) and §6 (rules); the report(s) your brief names.

## Workspace
```
cd /c/Users/Owner/Desktop/bq-qw-s<N>
git status                      # must be clean
git fetch origin ab-wave        # origin = selfboot; ab-wave = 48767583 (review docs + contracts; server suite 640/640)
git switch -c ab-s<N> origin/ab-wave
npm install --prefer-offline    # only if node_modules is missing or package.json changed
```
Do NOT branch from origin/main (it lacks the review, the tools and the api-ext module). Commit per logical change with
a message file (`git commit -F msg.txt`), conventional type, body with what/why/tests, ending
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, never touch selfboot or another clone, never
amend a reported commit, never `--no-verify`. Git Bash for every npm command with flags (`npm run x -- --flag`).

## Machine (16 GB laptop, ~2 GB free at dispatch; 7 agents share it)
- HEAVY lock, ONE holder machine-wide: `mkdir /c/Users/Owner/Desktop/bootquest-handoff/ab/locks/heavy` succeeds only
  if free; if it fails, wait 60 s (use a Monitor/until loop, not sleep) and retry. `rmdir` it the moment you finish,
  also on failure. HEAVY = client suite, full server vitest, `vitest --root tools/seed`, smoke:api, demo:promotion,
  seed:validate, seed:check, seed:quests/notes/explainback re-seeds of more than one pack, test:csharp/java.
- MEDIUM lock, two holders (`locks/med1` or `locks/med2`): `npm run typecheck`, client typecheck, the lints,
  `restamp:all -- --dry-run`. Targeted single test files need no lock.
- Free-RAM gate (0.5 GB free at re-dispatch): before taking HEAVY check free memory with
  `powershell -c "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB"` (GB). HEAVY needs >= 2.5 GB,
  MEDIUM >= 1.5 GB; below that, wait (Monitor/until loop, 2-minute checks) and retry. Never kill processes you did
  not start (the owner's browsers and server are resident). If you wait more than 45 minutes, report what you have.
- Never hold a lock while thinking or writing code. Hold it only for the command. vitest `--maxWorkers=2`.
- Never start, restart or POST to the owner's server on :4178. Tests use their own temp DBs.
- Run anything longer than ~2 minutes with `run_in_background` and wait for the notification.

## Rules (all streams)
- Restamp-free wave: never edit the forbidden fingerprinted files listed in RULINGS R2. New API schemas and
  extended DTOs go in your own section of `shared/src/api-ext.ts`. If you believe you need a forbidden file, stop and
  say so in your reply instead of editing it.
- Finish with `npm run restamp:all -- --dry-run` showing all fresh.
- Code: follow the house style of the file you edit; every behaviour change has a test; prefer new test files over
  editing shared ones (`server/test/api/api.test.ts` append-only). Keep the honesty rules: answer-before-key,
  explanations only after a recorded answer, once-per-item answer of record, append-only ledger tables, a derived
  slate, closed days immune.
- Content: code-truth at the pinned checkout (`.cache/checkouts/<repo>@<sha>`, cite file:line); pre-mx items (present
  at `9b7f0ea3`) are byte-identical unless RULINGS says otherwise; leaks checked both directions with
  `node H/tools/dossier.mjs`; `seed:lint:leaks` 0 and `seed:lint:answers` OK before reporting.
- Do not edit `server/test/api/ladder-real.test.ts` pins or `docs/SEEDING.md`: the hub does. Put the deltas and a
  draft SEEDING §8 bullet in your report.
- Upstream bugs in the pinned repos are report items.

## Gates before your stop report (see RULINGS R5 for locks)
Both typechecks; your targeted tests; full server vitest from `server/` (HEAVY); S1-S5 also the client suite once
(HEAVY, from `client/`: `npx vitest run --maxWorkers=2`, ~6 min); S5-S7 also
`npx vitest run --root tools/seed --maxWorkers=2` (HEAVY); `seed:lint:leaks`, `seed:lint:answers`,
`restamp:all -- --dry-run`. S1/S2/S5 also `npm run demo:promotion`. Never report a gate you did not see finish;
paste the tails.

## Stop report
`S\reports\S<N>.md` (≤ 80 lines): branch + SHAs, what changed (files, endpoints, items with ids), counts before → after
by counting, gates with tails, deviations from RULINGS/brief, upstream findings, draft SEEDING §8 bullet, what's left.
Reply to the orchestrator in ≤ 30 lines. Later you will ring-review one other stream (`H\templates\RING-brief.md`) and
fix what your reviewer finds as NEW commits.

## Interruptions (added 2026-10-31, session 3: two sessions were cut off mid-stream by usage limits)
- Your clone may already hold work from an earlier, interrupted run of your stream (commits on `ab-s<N>` and/or
  uncommitted changes). Start with `git log --oneline origin/ab-wave..HEAD`, `git status`, `git diff`. Review that
  work against your brief like a reviewer: keep and finish what is right, fix what is wrong, discard only what is
  clearly broken (say so in your report). Never `git reset --hard` or `git clean` blindly.
- Checkpoint as you go: commit each coherent piece as soon as its targeted tests pass, and after every commit update
  a `## Progress` section at the top of `S\reports\S<N>.md` (done / in progress / next, with SHAs). A session that
  resumes after a cut-off reads that section first.
