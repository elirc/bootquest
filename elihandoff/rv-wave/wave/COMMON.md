# rv wave: shared brief for every implementer (2026-11-12)

The owner asked to "finish all improvements" from the 2026-11-12 council review. The plan is
`C:\Users\Owner\Desktop\selfboot\review-2026-11-12\REVIEW.md`; the evidence for every item is in the R1-R5 reports and
round-2 files in that folder (cite their ids, e.g. R4-01, in commit messages). Read REVIEW.md, then the report sections
your brief points at. Read `AGENTS.md` and `docs/SEEDING.md` in your clone: they are binding.

## Branches and clones
- Hub: `C:\Users\Owner\Desktop\bq-f52-hub`, branch `rv-wave` (from `f52-wave` @ `dc2206bc`). Only the orchestrator
  merges into it.
- Your clone and branch are named in your brief (`bq-f52-<x>`, branch `rv-<x>`, origin = the hub). Commit there, one
  commit per coherent change, with a message file (`git commit -F msg.txt`). Never commit to `main`, never push, never
  force, never `--no-verify`, never rewrite history. Do not touch other clones, `selfboot`, or `.cache/checkouts`.
- End commit messages with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Owner decisions taken for this wave (the owner said "finish all"; these are the council's defaults)
- D3 Default slate: one language (JS, the hero's ladder) + reviews + one senior rep. The other language slots stay one
  setting away. Offer a one-time "pick your primary language" prompt.
- D4 Explain-back pass: weighted coverage ≥ 80% **and at most one `[w3]` missed** (was: zero). Do it now: the owner DB
  has zero evidence.
- D5 Streak: a Fundamentals step fills a slate slot; a day on which the (new, smaller) default slate is completed grows
  the streak; hero copy and streak must agree.
- D6 LLM: no runtime model calls, ever. Allowed: a client "Copy prompt for Claude" button and a CLI export that writes
  a prompt file; an optional import is stored as an advisory note, never evidence, never XP.
- D7 Java stays on JDK 17 (only 17 is installed). No real-framework C# drills this wave unless the orchestrator says so
  (they restamp every C# and Java pack).
- D8 Archive: unit grain, ~1,500-2,200 units, side file, nothing deleted, campaign-aware.

## Restamp: what is bound (council Q1, verified)
Do **not** edit: the runner files listed in `server/src/store/grader-fingerprint.ts:56-101` (incl.
`server/src/runners/**`, `server/src/runners/csharp/scratch.ts`), `server/src/api/runners.ts`, `runner-csharp.ts`,
`runner-java.ts`, `tools/seed/src/factory/**`, `shared/src/campaign.ts`, and the `shared/src` files in the seed import
closure (at least `api.ts`, `enums.ts`, `check.ts`, `schemas.ts`, `seed-pack.ts`, `thresholds.ts`, `pack.ts`; check the
closure before editing any `shared/src` file). Free to edit: engines, other services/stores, `shared/src/api-ext.ts`,
`shared/src/eb-weight.ts` (if not imported by the seed closure: check), migrations (append-only, new files only),
client, CLI, server-local side files under `content/` that are not stamped packs. Before you stop, run
`npm run restamp:all -- --dry-run` once and confirm everything is still fresh (paste the tail). If you believe a change
truly needs a bound file, stop and say so instead of doing it.

## Content discipline
Existing stamped items stay byte-identical unless your brief explicitly says the item is pre-landing Fundamentals
content (not on `main` yet, so editable) or a documented re-seed. Historical keys never change or get reused. Run
`npm run seed:lint:leaks` and `npm run seed:lint:answers` before you stop if you touched content. Code-truth beats
docs. Update census constants (`*_EXPECTED`) and `server/test/api/ladder-real.test.ts` pins by counting.

## Machine rules (hard)
- ~2 GB free RAM; up to three implementers run at once. **Never run a full suite.** Run only the test files you touched
  or that cover your files: `npx vitest run <file> --maxWorkers=1` (from the workspace dir). The orchestrator runs the
  full battery at integration.
- Git Bash, not PowerShell, for anything with flags. Heredocs/`node -e` with backticks or `\\` get mangled: write
  script files (keep scratch scripts in `C:\Users\Owner\Desktop\selfboot\review-2026-11-12\wave\work\<your-stream>\`).
- Do not start the app, the dev server or headless Chrome unless your brief says so; stop anything you start.

## Migrations
Use only the numbers assigned to your stream: B → 020-021, C → 022, D → 023-027, E → 028-029. Append-only tables,
`CREATE TABLE`/triggers in the style of `019_hint_taken.sql`. Never edit an old migration.

## Tests
Every behaviour change gets a test (server vitest or client vitest, next to the existing ones). Update tests that pin
old behaviour you were asked to change, and say which in your stop report.

## Stop report (your final message, ≤ 40 lines; also write it to `wave/<stream>-REPORT.md`)
branch + SHAs; what you implemented with REVIEW/finding ids; what you deferred and why; tests run with tails;
restamp dry-run tail; lint tails if content changed; counts before → after; files outside your ownership you had to
touch (should be none); open questions.
