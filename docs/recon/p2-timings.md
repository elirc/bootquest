# P2 — C# runner timings (W3a de-risk spike)

Measured 2026-10-07 on the dev laptop: Windows 11 Pro 10.0.26200, .NET SDK 10.0.302
(ref pack Microsoft.NETCore.App.Ref 10.0.10), node v22.16.0. Other build agents were
running in parallel on the same box, so treat spread between runs as real-world noise.
Source of truth: `server/src/runners/csharp/runner.test.ts` (writes
`%TEMP%\bootquest-p2-timings.json`). All times are wall-clock `durationMs` of
`run(exercise, submission)` as the app would see it (mutex wait + prepare + compile + run).

## Verdict against the spec gate (warm < 10 s, first ≤ 60 s)

| shape | engine | first-ever | warm median of 5 (3 suite runs) | gate |
|---|---|---|---|---|
| console-check (csbootcamp) | csc-direct + `dotnet Exercise.dll` | 3.8 / 5.9 / 4.2 s | **1.75 / 0.92 / 0.66 s** (worst single 2.7 s) | **MET** |
| xunit (make-tests-pass) | csc-direct + `dotnet vstest` | 23.7 / 17.9 / 15.2 s | **4.6 / 2.9 / 3.5 s** (worst single 5.4 s) | **MET** |
| xunit | spec-literal `dotnet test --no-restore` | 25.0 / 15.3 / 12.0 s | 14.9 / 4.6 / 4.1 s (3 warm each) | **NOT reliably met** (first suite run under load: 14-17 s) |

**This machine meets the gate only on the csc-direct warm path.** The spec-literal
MSBuild paths (`dotnet test`, and `dotnet run file.cs` with `#:project`) sit at or over
10 s whenever the box is loaded. Recommendation: ship the csc-direct path as the
default engine. Keep `dotnet test` as an opt-in fallback engine (`xunitEngine: 'msbuild'`).
Do not widen the gate.

"First-ever" here means a fresh app-data dir, a new named compiler server (cold
VBCSCompiler), and for xunit `dotnet restore` + the first `dotnet build`. The NuGet
global cache already held xunit 2.9.3 / xunit.runner.visualstudio 3.1.5 /
Microsoft.NET.Test.Sdk 17.14.1. On a machine with an empty cache, first xunit run also
downloads those packages. That case was not measured. console-check needs no restore at all.

## Phase split (suite run 3, warm)

- console-check: compile 370-410 ms (csc via warm compiler server), run 210-300 ms.
- xunit: compile 170-380 ms, `dotnet vstest` 1.9-3.9 s (vstest.console + testhost startup is the floor).
- Compile error: 0.3-0.4 s end to end (no run phase).
- Infinite loop: timeout + `taskkill /T /F` costs ~0.6 s over the timeout (console 4 s → 4.6 s;
  xunit 15 s → 15.2 s). The next grade after the kill passed in 0.6 s (console) and 1.9 s (xunit),
  so bin/ was not left locked.

## Probes that decided the design (single samples, same box, pre-suite)

| approach (console-check, count-vowels solution) | first | warm |
|---|---|---|
| A. as authored: `dotnet run 01-count-vowels.cs` with `#:project ../Check/Check.csproj` | 33.6 s | 9.0-9.6 s |
| B. classic csproj, `dotnet build --no-restore` + `dotnet Exercise.dll` | restore 6.9 s | 8.5-21.9 s |
| B'. `dotnet run --artifacts-path X file.cs` (to keep bin/obj in app-data) | 14.7 s | 7.2-12.8 s (disables the fast path) |
| C. file-based fast path (no directives, Check inlined) `dotnet run a.cs` | - | 2.5-3.4 s (bin lives in %TEMP%\dotnet\runfile) |
| **D. `dotnet csc.dll -shared` + `dotnet Exercise.dll` (chosen)** | - | **1.9-2.6 s probe, 0.6-1.8 s in suite** |
| xunit: `dotnet test` (MSBuild every time) | 22.2 s | 14.1-14.7 s |
| xunit: `dotnet build` + `dotnet test --no-build` | - | 11.0 s |
| **xunit: csc into warm bin/ + `dotnet vstest` (chosen)** | - | 5.3-6.7 s probe, 2.9-4.6 s in suite |

Why MSBuild loses: each `dotnet build`/`test` spends 4-15 s on evaluation, restore checks,
and up-to-date checks for a two-file project. Roslyn's compiler server compiles the same
two files in ~0.4 s once it's warm.

## How the warm path works (server/src/runners/csharp/scratch.ts)

- `<appData>/csharp/<shape>/` is prepared once and marked with a `.ready` file:
  - console-check: compiles csbootcamp's `Check.cs` to `bin/Check.dll` and writes `refs.rsp`
    (ref pack + Check.dll) plus `src/_globals.cs`, which holds the SDK implicit usings, a
    TargetFramework attribute, and a UTF-8 console module initializer.
  - xunit: writes the csproj with pinned packages, runs `dotnet restore` and one `dotnet build`
    (this populates bin/ with deps.json, the xunit adapter and testhost), then writes `refs.rsp`.
- Each attempt rewrites `src/*.cs` and compiles with `dotnet <sdk>/Roslyn/bincore/csc.dll -noconfig
  -shared:bq-<hash(appData)>` into the same `bin/`. Console runs `dotnet bin/Exercise.dll` and
  parses the Check output. xunit runs `dotnet vstest bin/Scratch.Tests.dll --logger:trx` and
  parses the TRX.
- The compiler server uses a named pipe per app-data dir, so `shutdown()` stops exactly our
  VBCSCompiler (`VBCSCompiler.dll -shutdown -pipename:…`). After the suite, a CIM process
  query found no process mentioning the app-data dir or the pipe name.
- A per-shape mutex serializes same-shape grades, and different shapes run concurrently.
  It is in-process only: two server processes sharing one app-data dir would need a lock file.

## Risks / follow-ups for W3a proper

- csc-direct bypasses MSBuild, so a csbootcamp file with `#:package`/`#:sdk`/`#:property` is
  rejected with a clear format error. The GitHub pack is BCL-only by its FORMAT.md contract, so
  none of its files should hit this. The full 31-file sweep is still owed in W3a, and the jstrain2.2
  embedded copy (147 files) is unchecked.
- The xunit fast path reuses deps.json from the first build. If an exercise ever needs a package
  outside xunit+BCL, give it its own shape, prepared with that package.
- Variance: suite run 1 (box busy) was 2-3× slower than runs 2-3 across the board. Even then,
  the chosen path stayed under the gate.
