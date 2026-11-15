# rv2 stream S3 `rv2-f`: learning features on the senior path (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-d`, branch `rv2-f` at `700973e3` (hub `rv-wave` with S1 `rv2-k` merged).
Migrations 025, 026, 027 (027 only if F9 is reached; if you skip F9 there is no 027 and no gap).

## Read first
1. `C:\Users\Owner\Desktop\selfboot\AGENTS.md`.
2. `C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\rv2\PLAN.md` (binding): §1, §3 features F4, F5, F7, F9, F10,
   §4 "S3", §5 (Fable's review gate: build to pass it).
3. `C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\HANDOFF.md` §3 (bound files) and §8 (machine lessons).
4. `C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\rv2\S1-REPORT.md`: what S1 built (key-ideas API in
   `shared/src/api-ext.ts`, `client/src/pages/KeyIdeas.tsx` exports, notebook API, the `headlines.json` format).
5. `rv2/INTEGRATION.md` for the base state.

## Owned files
PLAN §4 "S3 owns", plus (for the leftovers below) `client/src/pages/Campaign.tsx` (or wherever the track browser renders;
mount only) and `client/src/pages/due-weak.test.tsx`. S1 is merged, so in `api/app.ts`, `shared/src/api-ext.ts`,
`App.tsx`, `client/src/api/{types,http,mock}.ts` you **append** blocks; do not restructure S1's code. Never edit
`content/**` (S2 owns it and is running now in another clone) or any bound file (runners, `api/runners.ts`,
`runner-*.ts`, `tools/seed/src/factory/**`, `shared/src/campaign.ts`, the seed-closure `shared/src` files).

`content/design/headlines.json` (S2 writes it; format `{"format":"bootquest-headlines@1","sets":{"<setKey or EB unit
key>": [[entry per key point] per question] | {"q1k2": entry}}}`, entry = `{headline, dimension, repoSpecific}` |
string | null). Read it via S1's reader in `server/src/store/keyideas.ts` if one exists there, else a reader in
`store/design-side.ts`. The interview profile must work when the file is absent or a set has no entries.

## Tasks (in order, commit each)
0. Leftovers from S1 (do first):
   a. `client/src/pages/due-weak.test.tsx`: 2 tests fail on `getByRole('table')` on the dashboard (since rv C moved
      the competency table to /stats). Fix the test to the current, intended dashboard. Don't change the dashboard.
   b. Mount S1's `KeyIdeasForUnit` fold (exported from `client/src/pages/KeyIdeas.tsx`) on the Fundamentals page
      section view and the track browser.
   c. The notebook line after a missed EB key point, in `LadderPanes.tsx`. S1's notebook API already accepts the EB
      attempt id.
1. F4 pretest + one merged explanation/learn-more panel.
2. F5 interview mode S + dimension profile on Stats (migration 025 `eb_attempt_meta`).
3. F7 weekly page + `bootquest week` (migration 026 `week_reflection`).
4. Stretch: F9 (migration 027), then F10 (ruling 9: the G1 pass rule for existing katas is unchanged).

Reinforcement and interview paths never write `evidence`, a ladder leg, `practice_log`, or unlock a unit, except where
the existing EB grading already does so for a graded attempt (interview mode is a graded EB attempt plus meta).

## Machine rules (about 1.2 GB free RAM; S2 runs in parallel)
- Git Bash, targeted tests only, `--maxWorkers=1`, foreground, never a full suite.
- The client typecheck in this clone fails for `@codemirror`/`@lezer` only: ignore those and report anything else.
  The orchestrator re-runs it in the hub.
- No `npm run app`/`serve` here. Never touch `C:\Users\Owner\bootquest\bootquest.db`. Scripts to files, no `du`.
- Kill leftover node processes matching `bq-f52-d` before you stop.

## Done = stop report
`C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\rv2\S3-REPORT.md` (AGENTS.md format) and the summary as your final
message: SHAs, acceptance line per feature with the proving test, test/typecheck/restamp-dry-run tails, deviations,
what is left.
