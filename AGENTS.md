# AGENTS.md — shared contract for coding agents (Codex, Claude, others)

BootQuest is a single-user, local-first gamified upskilling app (npm workspaces: `server/`, `client/`, `cli/`, `shared/`,
`tools/seed/`). Content is seeded into stamped packs under `content/`. `docs/SEEDING.md` is the seeding runbook and the
wave log (§8).

## Ground rules
- **Never commit to `main` and never push.** Work on your own branch, ideally in your own clone
  (`C:\Users\Owner\Desktop\bq-<agent>-<stream>`). The orchestrator integrates, runs the gates and lands.
- Commit per pack/module, using a message file (`git commit -F msg.txt`). Uncommitted work counts as unverified. Never
  `--no-verify`, never force-push, never rewrite history.
- Don't edit `shared/src`, `tools/seed/src/factory` or `server/src` unless your task brief says so. These are
  fingerprinted, and touching them forces an estate-wide restamp. Content goes through authoring JSON / drafts and the
  seed CLIs (`docs/SEEDING.md` §3).
- `.cache/checkouts/<repo>@<sha>` are pinned read-only mirrors of upstream repos. Never edit them. Cite from them.
- Treat upstream bugs you find as report items, not fixes.

## Shell (Windows)
- Run commands with flags from **Git Bash** or via `npx`. PowerShell 5.1 drops the `--` in `npm run x -- --flag`, so the
  flags silently never reach the script.
- Run heavy jobs in the foreground. Chunk validations with `--course`.
- vitest's "Timeout calling onTaskUpdate" unhandled errors are benign when all tests pass.

## Content discipline (quiz, flashcards, notes, explain-backs)
- Existing items stay byte-identical. Historical quarantine/review keys never change.
- A note, flashcard or explain-back key point must not restate another item's keyed answer (xleak).
- Code-truth beats briefs and docs: state what the pinned code does, and cite it.
- Before reporting done: `npm run seed:lint:leaks` (0 leaks) and `npm run seed:lint:answers` (OK).

## Gates (run what your change touches; the orchestrator runs all of them before landing)
`npm run typecheck` · `npm run typecheck -w @bootquest/client` · client suite (~6 min) · from `server/`:
`npx vitest run --maxWorkers=3` and `npx vitest run --config vitest.selfrun.config.ts --maxWorkers=3` ·
`npx vitest run --root tools/seed` · `seed:lint:leaks` · `seed:lint:answers` · `seed:pins` · `restamp:all -- --dry-run` ·
`smoke:api` · `demo:promotion` · `seed:demo:planted` · `seed:campaign -- --check` · `test:csharp` · `test:java` (JDK 17).
When counts change, update the census constants (`*_EXPECTED`) and the `server/test/api/ladder-real.test.ts` pins.
Verify every count by counting.

## Stop report
When you stop (done, blocked or out of budget), write a short report and give it to the orchestrator:
- branch + SHAs
- counts before → after
- gates run, with output tails
- deviations from the brief
- upstream bugs found
- what is left
