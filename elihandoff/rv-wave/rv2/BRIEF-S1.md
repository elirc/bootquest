# rv2 stream S1 `rv2-k`: key ideas + spaced production (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-p`, branch `rv2-k` (cut from the integrated hub `rv-wave`). Migrations 023, 024.

## Read first (in this order)
1. `C:\Users\Owner\Desktop\selfboot\AGENTS.md` (contract; never `main`, never push, never `--no-verify`, commit with `-F`).
2. `C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\rv2\PLAN.md`: **binding**. Your scope is §1 rulings 2, 3, 6,
   §2.1 (all of it), §3 features F1, F2, F3, F6, F8, and §4 "S1". §5 is how Fable will review you: build to pass it.
3. `C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\HANDOFF.md` §3 (restamp rules: which files are bound) and §8
   (machine lessons).
4. `C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\rv2\INTEGRATION.md` (what the integrated base contains).

## Owned files
Exactly the list in PLAN §4 "S1 owns". Anything else: stop and ask the orchestrator (me) via your stop report; do not
edit it. You do **not** touch `content/**` (S2 writes the real side files in parallel). Write your own fixture side
files under `server/test/fixtures/keyideas/` in the PLAN §2.1 format, and make the store read
`content/keyideas/` from the content root (missing dir = no ideas, no warning spam, server starts).

## Bound files (never edit; editing them forces an estate restamp)
`server/src/runners/**`, `server/src/api/runners.ts`, `runner-csharp.ts`, `runner-java.ts`, `tools/seed/src/factory/**`,
`shared/src/campaign.ts`, and the seed-closure `shared/src` files (api.ts, enums.ts, check.ts, schemas.ts, seed-pack.ts,
thresholds.ts, pack.ts). New API types go in `shared/src/api-ext.ts`. Prove it at the end with
`npm run restamp:all -- --dry-run` = all fresh.

## Tasks (PLAN §4 S1, in order, one commit or more per task)
1. Store + schema validation (fixtures). 2. Concept-card enrolment / text / retire-restore / 4-per-day cap; ruling-6 test
(no practice lock from any reinforcement path). 3. Review UI: key-idea cards, `mode=keyideas` interleave (cap 12, 5 in
10-minute mode), tag chip, hard 20-card cap (F8). 4. Recap checkpoint (migration 023, 20 XP once, >= 8 words typed
first), 14/45-day re-check, dashboard tile, `KeyIdeas.tsx` fold; API omits `answer` until the idea's sources are
passed. 5. Redo cards (<= 1/day, practice-mode run, no evidence) + `ebmiss` cards (<= 3/attempt, `[w3]` first, headline
from `content/design/headlines.json` if present, else "one key point you missed") + F3 enrol filter from
`content/seed/card-tags.json` (absent file = no filter). 6. Error notebook (migration 024, `note:<id>` card).

Keep it small and honest: reinforcement never writes `evidence`, a ladder leg, `practice_log`, or unlocks a unit.

## Machine rules (about 1.2 GB free RAM; another agent runs in parallel)
- Git Bash. Targeted tests only: from `server/`, `npx vitest run test/<file> --maxWorkers=1`; client
  `npx vitest run src/<file> --maxWorkers=1` from `client/`. Never a full suite. Foreground only.
- Root `npm run typecheck` is fine. The **client** typecheck fails in this clone for `@codemirror`/`@lezer` only; ignore
  those errors, report any other client type error, and the orchestrator re-runs it in the hub.
- Do not run `npm run app`/`serve` from this clone (fingerprint roots differ). Never touch
  `C:\Users\Owner\bootquest\bootquest.db`.
- Write helper scripts to files (no `node -e` with backticks). No `du` or recursive scans.
- Before you stop, kill your leftover vitest/node processes:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -match 'bq-f52-p' } | % { Stop-Process -Id $_.ProcessId -Force }`

## Done = stop report (AGENTS.md format)
Write it to `C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\rv2\S1-REPORT.md` and return its summary: branch + SHAs,
tests run with tails, the F1/F2/F3/F6/F8 acceptance lines each with the test that proves it, restamp dry-run tail,
deviations, what is left. Uncommitted work counts as not done.

## Added after integration (INTEGRATION.md "leftovers"; these are yours, do them first, one commit each)
0a. **`server/scripts/smoke-api.mjs`** (you own it for this task): smoke is 65/76 because 11 assertions pin pre-rv
    behaviour (R4-09 0-XP pass after a failed first try and the later XP totals; C's default slate without a
    campaign/drill:sysdesign slot; the 15-word EB floor; G1 patched-line defects only; notes rule (b) removed). Update
    those assertions to the new, intended behaviour. One open point: a repeat pass now returns reason `null` instead of
    `already-awarded`. Orchestrator ruling: find the commit that changed it; if it was not an explicit B decision,
    restore `already-awarded` in the server (honest feedback beats a silent null) and keep the smoke assertion. Note
    what you found in your report. Smoke boots slowly here (> 180 s at 100% CPU): run it once, when the other agent is
    not running a test, with a longer boot deadline if the script has one; never edit the deadline in the committed
    script without saying so.
0b. **`server/src/engines/hints.ts:91`** (free file, not fingerprinted): a tied hint score still withholds hint 2, which
    matched the old hint order. After E1's flip (hint 2 prose, hint 3 formula), `sysdrills/16-data-access-and-integrity/
    01-soft-delete-unique` serves its answer as hint 3. Fix: on a tie, withhold the last hint. Add a test.
