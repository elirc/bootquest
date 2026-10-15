# BootQuest

BootQuest is a single-user, local-first, gamified upskilling platform for the JS/TS +
React and C#/.NET tracks. Java is a locked third track, and agentic engineering is a
fourth. Its content is the owner's own estate: thousands of verified exercises and
hundreds of curriculum guides across the elirc GitHub repos. It keeps growing as guides
are added.

Five rules shape everything:

1. **Zero runtime spend.** The running app makes no LLM API calls and needs no cloud,
   paid services or Docker. Everything it does at runtime is deterministic and local.
2. **LLM work happens at seed time only.** Quizzes, explain-back sets, retests and katas
   are authored inside Claude Code sessions. Every artifact must pass a deterministic
   validator before it is committed to `content/` (see [docs/SEEDING.md](docs/SEEDING.md)).
3. **Honesty discipline.** Nothing is marked complete without passing its check. A
   revealed solution earns 0 XP forever. Every attempt writes an immutable evidence row.
4. **The estate is the content.** GitHub sync followed by a re-seed session is a
   first-class, repeatable workflow.
5. **It verifies understanding, not just output.** XP is the fun layer. A
   competency-evidence ladder, with explain-back and delayed retests, is the truth layer.

Stack: an npm workspaces monorepo.

- `server/`: Node, Express and `node:sqlite` (one DB file).
- `client/`: Vite, React 18 and TypeScript; dark theme and keyboard-first.
- `cli/`: the `bootquest` command (commander).
- `tools/seed/`: the seed-time content factory.
- `shared/`: Zod schemas at every boundary.
- `content/`: compiled, stamped packs.
- `docs/`

## Quickstart (Windows)

```bat
npm install

rem the one DB file. There is no default: every server/CLI path refuses to guess.
set BOOTQUEST_DB=C:\Users\Owner\bootquest\bootquest.db

rem API on http://127.0.0.1:4178 (BOOTQUEST_PORT to change)
npm run serve
```

In a second terminal, start the browser UI. Vite serves it on http://localhost:5173 and
proxies `/api` to 127.0.0.1:4178. `npm run dev:mock -w @bootquest/client` runs the UI
standalone against a mock instead.

```bat
npm run dev -w @bootquest/client
```

The CLI is for serious work in your own editor. Add the repo's `bin\` folder to PATH:

```bat
setx PATH "%PATH%;C:\Users\Owner\Desktop\selfboot\bin"
rem new terminal:
bootquest status
```

`bin\bootquest.cmd` runs `cli/bootquest.mjs`, which loads tsx from the repo, so it works
from any directory. A project declares its unit in `.bootquest.json`
(`{"unitKey": "...", "file": "..."}`).

Commands:

- `bootquest run`: free and unrecorded.
- `bootquest submit`: recorded. Add `--assisted` to self-flag help.
- `bootquest status`
- `bootquest today`: today's slate (slots and done state), reviews due, streak, freeze
  tokens and next up per track. Read-only; it always exits 0, even when the server is down.
- `bootquest sync`
- `bootquest mutate`: the mutation gate on solo-project units.
- `bootquest reset --yes-really`: see below.

The server talks to `http://127.0.0.1:4178`; override it with `--server` or
`BOOTQUEST_SERVER`.

### Startup checks and stamps

All content packs are committed **with their validation stamps**, so a fresh clone
serves without re-running anything. At startup the server:

- loads every pack under `content/packs/`, the campaign map under `content/campaign/`
  and the seed packs under `content/seed/`;
- creates the ladder units (explain-back, patch-kata, retest; see SEEDING.md §7) and
  the authored agentic units in `content/units/`;
- prints one summary line per source with its counts and a ladder-units line;
- **refuses to start** on a missing or stale stamp, edited bytes, loaded !== built, a
  duplicate seed-item key, or a busy port.

A stamp goes stale when you edit a grader or validator, or upgrade node, esbuild or
.NET. If that happens:

- run `npm run seed:validate -- --source bootforge` and/or
  `npm run seed:validate -- --source csbootcamp` (foreground, about 3 to 5 minutes
  each) to re-stamp the code packs;
- run `npm run seed:check -- --restamp` for seed packs.

`seed:check` and its `--restamp` also need the source checkouts in
`.cache/checkouts/` (SEEDING.md §2).

### Resetting the DB

```bat
npm run reset -- --yes-really
bootquest reset --yes-really
```

Both refuse:

- without `--yes-really`;
- unless `BOOTQUEST_DB` is explicitly set;
- while a server holds the port or the DB.

They never delete anything: the DB file and its `-wal`/`-shm` side files are renamed to
`<file>.reset-<UTC time>.bak`, and a fresh, migrated, empty DB is created in their place.
Content is not in the DB, so the next `npm run serve` loads all of it again. Exit codes:
0 done, 1 something holds the DB or port, 2 refused by a guard.

## The honesty model

- **Run is free; submit is recorded.** `run` grades and writes nothing. `submit` writes
  an attempt and a run row (the raw verdict JSON, kept forever). For quiz and
  predict-output units, `run` is refused (409), because a free run would be an answer
  oracle.
- **Reveal = 0 XP forever.** Revealing a solution first writes a `guided` attempt; only
  then is the solution returned. From then on the unit pays 0 XP and every later attempt
  on it is guided. Reveal schedules a pre-seeded variation as practice when one exists.
- **Server-derived, never client-supplied.** The client never sends verified flags,
  scores, assistance, difficulty or XP. Assistance is the honor-system `--assisted` /
  `selfAssisted` flag, or is auto-derived from a reveal.
- **Answer first.** Explain-back and patch-kata units store your answer (transcript or
  findings {scenario, evidence, consequence}) as an immutable attempt **before** the
  server will release the key points or seeded-defect key (403 NOT_ANSWERED until then).
  This is enforced per question set or kata item, across units. You then self-score per
  key point or defect. The server computes coverage or catch rate from your marks.
- **Append-only ledger.** SQLite triggers abort UPDATE, DELETE and REPLACE on attempts,
  runs, evidence, XP events and review logs. `competency_rating` changes must be tied to
  promotion or demotion evidence.
- **Three-leg promotion** (spec §6.2). A competency moves up one notch only after all
  three legs below, all linked and timed on attempt time. A lapse on a Review-state FSRS
  card for that competency demotes it one notch.
  - (a) an independent, run-verified, solo artifact: a project-kind unit;
  - (b) *its* explain-back with ≥80% key-point coverage;
  - (c) a changed-example retest of that unit, passed solo ≥2 days later.
- **Retest gating.** A retest unit refuses `run` and `submit`, and hides its
  instructions, until a retest schedule for it is due. The schedule is created by a
  passing explain-back. This stops pre-solving the retest during the 2-day wait. The
  practice path after a reveal stays open, but those attempts are flagged and never count.
- **G1 (patch review).** The kata bank gate is ≥80% of seeded defects caught across at
  least 10 defects, counting **solo, unassisted** katas only. Assisted katas are
  reported separately.
- **What is NOT protected.** This is a single-user app over your own unsigned SQLite
  file. A fresh raw-SQL `INSERT` of a forged attempt, run and evidence into your own DB
  still succeeds. What is rejected is rewriting or laundering existing rows. A raw-SQL
  forgery can move a rating by at most one notch. Mutation-gate counts are reported by
  `bootquest mutate`, the server re-evaluates the thresholds, and nothing ties the
  counts to the exact code. The runners isolate learner code only with child processes
  and timeouts, which is acceptable because all executed code is yours or
  seed-validated.

## Gates

Each gate is a real command that must exit 0. Run them in the foreground.

| Command | What it proves |
|---|---|
| `npm test` | Unit and API suites of every workspace (shared, server, client, cli, tools/seed), incl. engine honesty rules, append-only triggers, planted-bad validator tests, and the answer-tell guards (`quiz-balance` per draft; `blind-pass`: no blind strategy clears any quest pack's 80% gate with probability > 2%) |
| `npm run typecheck` | Root TypeScript project, strict |
| `npm run build:client` | The client compiles (tsc) and bundles (vite) |
| `npm run smoke:api` | Boots the REAL server entrypoint on a temp DB and free port, then walks the honesty flows over HTTP with real runners: drills, quiz, predict, csbootcamp C#, http check, reveal, reviews, campaign, the ladder flow (real explain-back and kata), stamp refusal, busy-port refusal and the reset guard. It also proves no zombie process or port is left. See the `npm run smoke:api` output for the step list |
| `npm run demo:promotion` | One full competency promotion cycle (artifact → explain-back → ≥2-day retest) plus the negative legs, over HTTP on a temp DB with an injected clock |
| `npm run demo:m4` | Real GitHub sync of signalpost; U01 renders from the per-SHA cache; its real `u01.test.mjs` fails the starter and passes the solution; new-guide detection; fully offline re-run |
| `npm run seed:check` | Every seed pack re-verified: stamp, pins, every shipped item re-validated (variants and katas re-executed) |
| `npm run seed:validate -- --source <bootforge\|csbootcamp>` | The import gate: every imported reference solution executes green under BootQuest's runners (quarantine otherwise) |
| `npm run test:csharp` | The warm C# runner suite (slow; its own gate) |
| `npm run test:mutate-fixture` | `bootquest mutate` end to end on a fixture project (Stryker; slow) |
| `npm run seed:demo:planted` | Every generator refuses planted-bad input for the right reason |

## Machine notes

- **Windows 11, PowerShell 5.1.** There is no `&&`; use `;` or the Git Bash tool.
  `Remove-Item -Recurse` follows junctions: use `cmd /c rmdir /s /q`. Write multiline
  commit messages with `git commit -F <file>`.
- **Node 22.16** today; the engines field allows ≥22.16. Stryker 10 wants ≥22.18 (an
  EBADENGINE warning, but it runs). Upgrading node invalidates every grader and seed
  fingerprint, so re-validate and restamp afterwards.
- **No Docker.** It hangs on this machine and nothing uses it.
- **Run gates in the foreground.** Background jobs get memory-reaped on this laptop.
  Under heavy load, child-process tests can time out; re-run once before you believe a
  failure.
- **Ports:**
  - 4178: the API (`BOOTQUEST_PORT`). The server pre-checks the port and refuses to
    start if it is busy.
  - 5173: the Vite dev client.
- `node:sqlite` prints an ExperimentalWarning on stderr. It is harmless and is never
  part of graded output.

## Owner to-do

- Create the **fine-grained read-only GitHub PAT** and set `BOOTQUEST_GITHUB_TOKEN`.
  Sync uses `gh auth token` until then.
- **Upgrade node to ≥22.18**, then re-run `seed:validate` (both sources) and
  `seed:check -- --restamp`.
- **Revoke the leaked Shopify token** (andie `VERIFICATION.md`).
- Decide the **quiz-oracle** policy (G6: repeated recorded submits can find quiz
  answers) and the **demotion cap** (at most one demotion per competency per day?).
  Also decide the retake policy for one-shot explain-back and kata items.
- Fix the **upstream guide errors** listed in [docs/SEEDING.md](docs/SEEDING.md#8-backlog)
  in the source repos.
- **Clean up the home-directory repo** (`C:\Users\Owner`, origin elirc/grouphelpdesk):
  remove the agent worktrees and branches that earlier build waves created there.
- Work through the first-week [docs/DOGFOOD.md](docs/DOGFOOD.md) checklist, including
  the one-time phone-width check.

Decisions and surprises are logged in [LEARNING.md](LEARNING.md). The build plan is in
[docs/BUILD-PLAN.md](docs/BUILD-PLAN.md).
