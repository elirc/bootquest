# AGENTS.md — shared contract for coding agents (Codex, Claude, others)

BootQuest is a single-user, local-first gamified upskilling app (npm workspaces: `server/`, `client/`, `cli/`, `shared/`,
`tools/seed/`). Content is seeded into stamped packs under `content/`. `docs/SEEDING.md` is the seeding runbook and the
wave log (§8).

## Ground rules
- **Never commit to `main` and never push.** Work on your own branch, ideally in your own clone
  (`C:\Users\Owner\Desktop\bq-<agent>-<stream>`). The orchestrator integrates, runs the gates and lands.
- Commit per pack/module, using a message file (`git commit -F msg.txt`). Uncommitted work counts as unverified. Never
  `--no-verify`, never force-push, never rewrite history.
- Edit only the files your task brief lists. Content goes through authoring JSON / drafts and the seed CLIs
  (`docs/SEEDING.md` §3).
- **Bound files (fingerprinted: an edit restamps packs, so never without an explicit brief):** the runner file lists in
  `server/src/store/grader-fingerprint.ts:56-101` (all of `server/src/runners/**`, incl. `runners/csharp/scratch.ts`,
  which is in both the C# and the Java list), `server/src/api/runners.ts`, `runner-csharp.ts`, `runner-java.ts`,
  `tools/seed/src/factory/**`, `shared/src/campaign.ts`, and the `shared/src` files in the seed import closure (at least
  `api.ts`, `enums.ts`, `check.ts`, `schemas.ts`, `seed-pack.ts`, `thresholds.ts`, `pack.ts`). Toolchain versions are
  bound too: a Node upgrade restamps everything.
- **Free (no restamp):** engines, the other services and stores, `shared/src/api-ext.ts`, `shared/src/eb-weight.ts`,
  append-only migrations, client, CLI, server-local side files (`content/keyideas`, `paths`, `archive.json`,
  `seed/kata-flags.json`, `design/*.json`). A new `review_item.kind` would touch `api.ts` (bound) and a DB CHECK: reuse
  the existing kind `'concept'`. Always finish with `npm run restamp:all -- --dry-run` = N/N fresh.
- `.cache/checkouts/<repo>@<sha>` are pinned read-only mirrors of upstream repos. Never edit them. Cite from them.
- Treat upstream bugs you find as report items, not fixes.

## Shell (Windows)
- Run commands with flags from **Git Bash** or via `npx`. PowerShell 5.1 drops the `--` in `npm run x -- --flag`, so the
  flags silently never reach the script.
- Run heavy jobs in the foreground. Chunk validations with `--course`.
- vitest's "Timeout calling onTaskUpdate" unhandled errors are benign when all tests pass.

## Content discipline (quiz, flashcards, notes, explain-backs)
- Keys never change: item keys and historical quarantine/review keys. A key that was dropped is never reused.
- An existing item may be edited until its **first attempt in the owner DB** (rv3 ruling 1; count on a read-only copy
  made with `node fable52docs/tools/copydb.cjs <file>`). Explanations, hints, lessons and drill tests may be rewritten;
  a prompt, choice or keyed answer changes only when it is wrong, and every such change is listed in the stop report.
  Once an item has an attempt, it stays byte-identical.
- A note, flashcard, explain-back key point or key idea must not restate another item's keyed answer (xleak).
- Explanation bar (rv3 PLAN §2, `seed:audit:explanations`): a quiz explanation has 25-90 words, says why rather than
  repeating the prompt and key, names a wrong turn, never points at a position ("option B", "above") and restates no
  other key; a drill explanation has at least 60 words and names the trap and the test that catches it; hints 1 and 2
  are prose; a lesson has at least 380 words and no section under 40.
- Code-truth beats briefs and docs: state what the pinned code does, and cite it.
- Before reporting done: `npm run seed:lint:leaks` (0 leaks), `npm run seed:lint:answers` (OK),
  `npm run seed:lint:keyideas` (OK) and, for Fundamentals or sysdrills content, `npm run seed:audit:explanations --
  --track <track> --check` (OK).

## Gates (run what your change touches; the orchestrator runs all of them before landing)
`npm run typecheck` · `npm run typecheck -w @bootquest/client` · client suite (~6 min) · from `server/`:
`npx vitest run --maxWorkers=3` and `npx vitest run --config vitest.selfrun.config.ts --maxWorkers=3` ·
`npx vitest run --root tools/seed` · `seed:lint:leaks` · `seed:lint:answers` · `seed:lint:keyideas` ·
`seed:audit:explanations -- --check` · `seed:pins` · `restamp:all -- --dry-run` · `smoke:api` · `demo:promotion` ·
`seed:demo:planted` · `seed:campaign -- --check` · `test:csharp` · `test:java` (JDK 17).
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
