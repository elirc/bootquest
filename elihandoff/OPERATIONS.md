# Operations: how work gets done on this repo

The contract for every agent is the repo-root [`AGENTS.md`](../AGENTS.md) (ground rules, Windows shell, content
discipline, the gate battery, stop-report format). The content runbook is [`docs/SEEDING.md`](../docs/SEEDING.md)
(§3 CLIs, §8 the wave log). This file only adds the orchestration mechanics that have proven themselves.

## Wave shape that works
1. **Audit before authoring.** One agent per content slice, read-only, writes findings with file:line evidence.
2. **Plan + council.** One orchestrator turns the audits into streams (one per agent, disjoint file ownership);
   the stream agents review the plan before anyone writes.
3. **Implement in clones.** One clone + branch per stream (`git clone --local` via
   `C:\Users\Owner\Desktop\bootquest-handoff\tools\mkclone2.mjs`, or reuse a finished clone:
   `git fetch origin main && git switch -c <branch> origin/main`). Copy extra pinned checkouts in with robocopy
   rather than re-cloning (disk is tight on this laptop). Claim repos in a shared claims file so two streams never
   author on the same repo.
4. **Ring review.** Each stream reviews another stream's branch read-only (code-truth at the pin, recomputed vectors,
   NEAREST duplicates, two-way and EB-vs-EB leaks, honesty of the stop report); fixes land as NEW commits.
5. **Integrate in selfboot** on a wave branch (`git fetch <clone> <branch>:<branch>`, `git merge --no-ff`), update the
   census pins BY COUNTING, write the SEEDING §8 bullet, run the full battery, then merge to `main` and push.

## Rules learned the hard way
- Validation proves solution == tests, not that the tests are right: recompute every expected value by hand, and
  record a naive version that each trap test catches.
- The leak lint is token-based; paraphrase leaks (a rubric restating an older quiz key) need a hand check. Use the
  dossier script (all items on one repo) and check both directions, including explain-back vs explain-back.
- Quiz choices are ordered by a hash of their text: editing a choice's wording can move the correct slot. Check slot
  and full order against the base commit after any in-place quiz edit.
- An explain-back that is not campaign-linked is a ladder dead end (`server/test/api/ladder-real.test.ts:141`);
  only system-design units are exempt.
- Code-truth beats docs and briefs. Framework facts with no repo line need a probe or a named authoritative source.
- `seed:validate --course` deletes the stamp by design; finish with a full `--source` run. `--fresh` ignores the
  journal (use it to prove a racy test three times in a row).
- Never report a gate you did not see. Gate tails go in the stop report.

## Machine gotchas (Windows 11 laptop)
- Run flagged npm scripts from **Git Bash** or `npx` (PowerShell 5.1 drops the `--` in `npm run x -- --flag`).
- Memory is limited (16 GB, browsers + editors resident): background shells get killed under pressure. Run the heavy
  battery steps one at a time; vitest `--maxWorkers=2`; chunk `seed:validate` per course (10-minute shell cap).
- Long blocking commands can stall an agent's stream: run long jobs in the background and wait for completion.
- Never hand-fix generated pack bytes; regenerate with the deterministic importer/seeder.
- dotnet: kill process trees (`taskkill /T /F`); watch for leftover VBCSCompiler.
- Commits: `git commit -F <msgfile>`, conventional type, end with the drafting model's `Co-Authored-By` trailer.
  Repo-local identity is `elirc <elirc3@gmail.com>`. Never force-push or rewrite history.
- The GitHub repo `elirc/bootquest` is **public**: no secrets, tokens or private data in commits.
