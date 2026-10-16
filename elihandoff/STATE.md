# Repo state and machine digest

## State at pause (2026-10-09)

- `main` @ `3795a39`, clean tree, 24 commits, local-only (no remote).
- All gates were green at that commit, verified by the orchestrator:
  - Tests: shared 82 · server 430 (+20 self-run via `vitest.selfrun.config.ts`,
    +24 csharp via `npm run test:csharp`) · client 87 · cli 98 · tools/seed 184.
  - `npm run smoke:api` → 56/56 · `npm run demo:promotion` → 38/38 ·
    `npm run demo:campaign` → 24/24 · `npm run demo:m4` → all pass ·
    `npm run build:client` green · `npm run typecheck` 0.
  - Packs stamped on current bytes: bootforge (2,563 pass / 2 vacuous
    quarantined / 6 written carve-out), csbootcamp (31), jstrain (1,164 /
    4 quarantined ambiguous-key / 141 carve-out), jstrain-cs (81);
    seed packs 77 OK / 1,035 items via `npm run seed:check`.
- One known flake, environmental: the js adapter "kills an infinite loop"
  test fails ONLY in combined runs under heavy CPU load; passes solo.

## Gates (run these yourself before any commit you make)

```
npm run typecheck && npm run smoke:api        # fast confidence
npm test -w @bootquest/shared ; npm test -w @bootquest/client
npm test -w @bootquest/cli ; npx vitest run --root tools/seed
npm test -w @bootquest/server                 # slowest; retry flaked timing test solo
npm run test:csharp ; npm run test:java       # runner suites (test:java needs JDK 17 on PATH)
npm run demo:promotion ; npm run demo:campaign
npm run seed:check                            # all seed packs stamped
npm run build:client
```

## Fingerprint / stamp discipline (CRITICAL — fail-closed by design)

- Editing grader/validator bytes invalidates pack stamps and `npm run serve`
  REFUSES to start until re-swept. JS fingerprint: `server/src/runners/js/*`,
  `server/src/api/runners.ts`, `tools/seed/src/validate/validate.ts`.
  C# fingerprint adds the csharp runner + dotnet SDK. selfrun likewise.
  Java fingerprint: `server/src/runners/java/*`, `server/src/api/runner-java.ts`,
  the javabootcamp harness, the Java validator, node + JDK (`javac -version`).
  Seed-pack fingerprint: `tools/seed/src/factory/**`, `citations/**`,
  `shared/src/seed-pack.ts`, `exclusions.json`.
- Remedies: code packs → `npm run seed:validate` per source (chunk
  per-course in the FOREGROUND, journal in `.seed-journal/` makes chunks
  durable; full-source run writes the stamp); seed packs →
  `npm run seed:check -- --restamp`.
- SEQUENCE TRANSPLANTS BEFORE SWEEPING — a sweep on mid-integration bytes
  is wasted (learned twice).

## Machine gotchas (Windows 11 laptop — obey, all learned the hard way)

- **Memory reaper kills background jobs** when the session idles. Run
  everything FOREGROUND; chunk long sweeps under the ~10-min shell cap
  (one TS course per call; 4-6 JS courses per call).
- **Transit drift**: applying patches can mangle pack/content bytes →
  sha-refusal. Never hand-fix; regenerate with the deterministic
  importer/seeder (`seed:import:*`, `seed:campaign`, `seed:quests:drafts`).
- **gh CLI stalls** on keyring sometimes → `taskkill //IM gh.exe //F`, retry.
- **node:sqlite** rows have null prototype; ExperimentalWarning on stderr is
  normal; never assert stderr empty.
- Bash heredocs here mangle backticks; agents generate tricky files via
  Python in their scratchpad. No `cd` in compound commands; `git -C`.
- PowerShell 5.1: no `&&`. Junction-safe delete: `cmd //c "rmdir /s /q X"`.
- Multiline commits via `git commit -F <file>`.
- **Worktree isolation is cut from the WRONG repo** (stray home-dir repo
  `C:\Users\Owner`, origin grouphelpdesk). Proven workaround inside such a
  worktree: `git fetch C:/Users/Owner/Desktop/selfboot main:refs/selfboot/main`
  then `git checkout -b <branch> refs/selfboot/main`. LATE DISCOVERY: plain
  local clones are simpler and avoid the home repo entirely:
  `git clone --local C:/Users/Owner/Desktop/selfboot C:/Users/Owner/Desktop/bq-<name>`
  — prefer clones for new parallel agents.
- Home repo worktree metadata may still be corrupt from interrupted
  cleanup; `git -C C:/Users/Owner worktree prune` before creating worktrees,
  or just use clones.
- Grader speed: JS ~0.1–0.6s/run; C# warm <5s; TS (`tsc`) 8–25s/exercise —
  the jstrain TS courses dominate sweep time (~40 min total).
- dotnet: kill process TREES (`taskkill /T /F`); watch for VBCSCompiler
  leftovers after Stryker.NET.

## Commit conventions

Conventional commits, milestone/wave-per-commit, message via `git commit -F`,
end with the drafting model's trailer(s). This campaign's agents were Fable:
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (plus your own
model's trailer per your session's attribution rules). Repo-local identity
is already `elirc <elirc3@gmail.com>`.
