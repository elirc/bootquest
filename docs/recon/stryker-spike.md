# W3c spike: mutation testing (Stryker JS + Stryker.NET) on this machine

Date: 2026-10-08. Box: Win11, 8 logical cores, node 22.16.0, .NET SDK 10.0.302. Throwaway fixtures were built in an
agent worktree, not in this repo. Other agents were running vitest suites at the same time, so wall times are noisy
(the same C# run took 1:22 once and 2:48 the next). Read them as "minutes, not seconds".
**Gate: PASSED.** Both tools ran to real JSON and HTML reports. Every gutted variant scored lower.

## Fixtures
- **JS**: 4 ESM modules, ~83 LOC (cart, validator, dates, slug = deliberately thin), 23 vitest tests, **165 mutants**.
- **C#**: 3 classes, ~70 LOC (Account, InterestCalculator, IbanFormatter = thin), 15 xunit tests, **55 mutants**
  (46 tested, 8 "Ignored (block already covered)", 1 CompileError).
- **Gutted** = same test calls, every assertion deleted (exceptions swallowed): the "tests that test nothing" case.

## Measured numbers
| Run | Total score | Per-file score of the gutted target | Wall (Stryker's own figure) |
|---|---|---|---|
| JS honest, cold (first run) | **80.61** (133 killed / 22 survived / 10 no-cov) | slug 41.67 | 3:00 (1:59) |
| JS honest, warm | 80.61 | slug 41.67 | 1:38 (1:28) |
| JS honest, `--ignoreStatic` | 81.46 | slug 41.67 | 1:49 (1:36): no real gain |
| JS honest, `--incremental` rerun, no change | 80.61 | - | **0:27 (0:13)** |
| JS gutted A: slug assertions removed | **71.52** | slug **41.67 -> 0.00** | 2:26 (2:11) |
| JS gutted B: cart assertions removed | **55.15** | cart **97.78 -> 4.44** | 2:19 (1:58) |
| C# honest, first run | **91.30** (42 killed / 4 survived) | Iban 83.33, Account 95.45 | 1:22 (1:20) |
| C# honest, second run | 91.30 | - | 2:48 (2:41): machine load |
| C# gutted A: Iban assertions removed | **73.91** | Iban **83.33 -> 16.67** | 2:40 (2:36) |
| C# gutted B: Account assertions removed | **56.52** | Account **95.45 -> 22.73** | 2:18 (2:11) |

- **Fixed cost before the first mutant:** C# ~45-60 s (analysis + `dotnet build` + initial run); JS ~16 s (vitest
  startup: 64 ms of test time vs 5.7 s overhead). **Per mutant:** JS 0.5-0.8 s (concurrency 4), C# 0.7-1.7 s.
- **What a gutted file keeps**: it still kills a few mutants (cart 2, Account 5). These are mutants that make the code
  throw on valid input. That is why gutted files land at 4-23% and not 0%.

## Key finding: Stryker's `break` threshold is aggregate and misses gutting
- With `break: 50`, **every gutted run passed** (71.5 / 55.2 / 73.9 / 56.5): the gutted module is diluted by honest ones.
- The per-file score is the signal: gutted files 0-23%, honest files >= 41.7% (incl. the deliberately thin slug).

## Recommended threshold semantics (W6)
1. **The gate is a per-file floor, enforced by BootQuest and not by Stryker.**
   - BootQuest parses `mutation.json` / `mutation-report.json`. Both use the same mutation-testing-elements schema:
     `files[path].mutants[].status`.
   - Score per file = (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage).
   - Count NoCoverage as a failure, i.e. use the *total* score and not the covered score. Ignore `Ignored`,
     `CompileError` and `RuntimeError`.
   - The fixture's `score.mjs` (25 lines) did this and matched Stryker.NET's own 91.30.
2. **Default per-file floor: 40%.** Fails every gutted file seen (0 / 4.4 / 16.7 / 22.7), passes every honest file
   (incl. thin slug at 41.67). A lesson can raise it via `mutation: { fileFloor: N }` in its unit manifest.
3. **Also set Stryker's aggregate `break: 60` as a second net.** Fails both "well-tested module gutted" runs
   (55.15, 56.52); passes the honest suites (80.6 / 91.3).
4. Report survivors to the learner as a list of `file:line original -> mutant` taken from the JSON. That is the
   teaching payload. Do not show only a number.

## Where it runs
- **Not a submit-time gate.** About 80 LOC already took 1.5-3 min. A real solo-project unit (300-1000 LOC with a few
  dozen tests) extrapolates to **5-20 min**, because cost grows with mutants times test time.
- **Recommended: an explicit `bootquest mutate <unit>` step** that must pass before a solo-project unit is marked
  complete. Hard timeout **15 min per unit**; concurrency = cores/2 (4 here).
  - JS reruns use `--incremental` (unchanged rerun: 27 s; only changed files/tests re-run). Keep
    `reports/stryker-incremental.json` in the learner workspace, git-ignored.
  - C# reruns: `--since:<branch>` (needs git) or `--with-baseline` exist but were **not measured**.
- **Also at seed time** (`seed:validate`, opt-in flag, slow): the reference solution + tests must clear the unit's
  floor, proving it is achievable. Nightly is pointless for a single-user app. Never applied to drills (spec).

## Exact pins (all at least 2 weeks old as of 2026-10-08)
- npm: `@stryker-mutator/core@10.0.0` and `@stryker-mutator/vitest-runner@10.0.0` (2026-08-14). Run against
  `vitest@3.2.4`, the repo's pin. The runner's peer range is `vitest >=2.0.0`, so 3.2.4 is fine.
- dotnet local tool: `dotnet-stryker` **5.0.0** (2026-09-11).
- Test project as `dotnet new xunit` generates it on SDK 10.0.302: xunit 2.9.3, xunit.runner.visualstudio 3.1.4,
  Microsoft.NET.Test.Sdk 17.14.1, coverlet.collector 6.0.4. This is VSTest. xunit v3 / MTP was not tested.

## Config: JS (`stryker.config.json`, next to package.json, ESM project)
```json
{
  "testRunner": "vitest",
  "plugins": ["@stryker-mutator/vitest-runner"],
  "mutate": ["src/**/*.js"],
  "reporters": ["json", "html", "clear-text"],
  "coverageAnalysis": "perTest",
  "concurrency": 4,
  "thresholds": { "high": 80, "low": 60, "break": 60 },
  "incremental": true,
  "tempDirName": ".stryker-tmp",
  "cleanTempDir": "always"
}
```
Command: `npx stryker run`. Output: `reports/mutation/mutation.json`. The exit code is non-zero when the score is
under `break`.

## Config: C# (`stryker-config.json` inside the test project dir, run from that dir)
```json
{
  "stryker-config": {
    "project": "Ledger.csproj",
    "test-projects": ["Ledger.Tests.csproj"],
    "reporters": ["json", "html", "progress"],
    "thresholds": { "high": 80, "low": 60, "break": 60 },
    "concurrency": 4,
    "mutation-level": "Standard"
  }
}
```
- Install: `dotnet new tool-manifest` then `dotnet tool install dotnet-stryker --version 5.0.0`; run: `dotnet tool run dotnet-stryker`.
- Output goes to `StrykerOutput/<timestamp>/reports/mutation-report.json`, a new timestamped dir each run. Glob for the
  latest one or pass `--output`.

## Friction hit (verbatim / diagnosed)
- **No node:sqlite or ESM friction.** `"type": "module"` + plain vitest config needed no flags. node:sqlite was not
  exercised; the runner executes tests in vitest's own workers, so whatever passes `vitest run` should mutate fine.
- **Node engine warning:** Stryker 10 pulls Babel 8:
  `npm warn EBADENGINE required: { node: '^22.18.0 || >=24.11.0' } current: { node: 'v22.16.0' }`.
  Warning only, every run succeeded; bump node to >= 22.18 before W6 to stay in the supported range.
- **`npm install --prefix <dir>` from a folder with its own package.json** installed that folder as a
  `"<name>": "file:.."` dependency. Use `(cd <dir> && npm install)` instead.
- **Static mutants:** module-level regex/constants give
  `Detected 14 static mutants (8% of total) that are estimated to take 45% of the time`.
  `ignoreStatic` saved nothing measurable; leave it off (it also lowers rigour).
- **Stryker.NET's cleartext table is column-truncated in a narrow non-TTY console.** Never parse the console; parse JSON.
- **.NET 10 SDK:** `dotnet new tool-manifest` writes `dotnet-tools.json` at the root (not `.config/`); `dotnet new sln`
  writes `.slnx`. Running from the test-project dir avoids needing the solution at all.
- **Stryker.NET leaves `VBCSCompiler.exe` running after exit.** The runner must kill it or set
  `UseSharedCompilation=false`. No Windows file-lock failures in 4 runs.
