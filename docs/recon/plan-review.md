# BootQuest BUILD-PLAN — Opus second opinion (R3)

Reviewer: Opus. Inputs: `Desktop\bootquest-final-prompt.md` (spec of record),
`docs\BUILD-PLAN.md` (plan under review), plus direct inspection of `Desktop\opusboot2`,
`Desktop\claiufe\signalpost-swe-bootcamp`, `Desktop\claiufe\jstrain2.2`, and
`github.com/elirc/csbootcamp` (via gh API). Findings are cited against what is actually on disk, not
just what the spec describes.

Bottom line: the plan has the right sequencing and roles, but it is too thin to steer the build.
Most gates are copied from the spec's one-line milestone gates, and nearly all of them can pass
while the milestone is broken: everything quarantined, nothing seeded, or evidence fabricated by
the agent. Three facts on disk contradict assumptions the plan inherits. (a) The signalpost check
is a `node:test` file with no shipped solution. (b) csbootcamp is .NET 10 file-based apps with the
tests inline, not xunit. (c) jstrain is vitest. So none of the three "copy BootForge's grader"
assumptions hold beyond BootForge itself.

---

## Blockers

1. **[blocker] The M6 gate cannot pass honestly as written.**
   - *What:* the promotion rule needs a changed-example retest that passes ≥2 days after the
     artifact. It also needs an independent artifact with no assistance flag. W6 has one agent
     "demonstrate one full promotion cycle end-to-end on real content".
   - *Why:* that leaves three options. The agent waits 2 wall-clock days, which stalls the build.
     It backdates rows, which fabricates evidence (spec §0.3). Or it writes the "independent"
     artifact itself and records it as the owner's evidence (spec §6.2: "never infers a rating
     from agent-written code"). All three are bad, and a time-pressured agent will pick the
     second or third silently.
   - *Fix:*
     - Every engine takes an injected `clock`.
     - The M6 gate becomes a scripted e2e test (`npm run e2e:promotion`). It runs against a
       throwaway DB file under the OS temp dir and advances the injected clock by 2 days. It uses
       a fixture artifact labelled `assessor=fixture`.
     - The test also asserts the negative paths: retest at day 1 is refused, an assisted artifact
       is refused, coverage below 80% is refused, and a failed FSRS review drops the rating one
       notch.
     - The owner's real DB never receives fixture evidence. State this in the plan as a rule.

2. **[blocker] The M4 vertical slice is not secured and needs a runner the plan never mentions.**
   - *What:* `signalpost/practice/checks/u01.test.mjs` is a `node:test` file. It does
     `import … from "../learner/u01.mjs"`. The shipped learner file is a stub that throws, so 2 of
     2 tests fail today (verified). No solution exists anywhere.
   - *Other format facts:* `u03.test.ts` needs `node --import tsx --test`. `program.json` lives at
     `docs/curriculum/program.json`, not at the repo root. It has 12 milestones but only 3 check
     files.
   - *Why:* BootForge's grader is `AsyncFunction('mod','assert')` over a single module. It cannot
     run this, so W2's "copy the grader" gives W4 nothing. The plan's only M1 provision is "the
     content_ref table exists", which does not prove the data model. Meanwhile spec §14 says to
     build M1 with the M4 slice in mind specifically so the model gets proved early.
   - *Fix:*
     - (a) Add a **W1.5 slice spike** right after W1. Read U01 from the local claiufe mirror (no
       Octokit yet). Register it as unit + check + content_ref rows. Run the check with a new
       check type `node-test-file`, whose spec is `{repo, sha, checkPath, learnerPath,
       runner:'node --test'|'node --import tsx --test'}`.
       - It materializes a temp dir: the check file at its pinned SHA (hash recorded and verified,
         so the test stays read-only), plus the learner file copied to the same relative path.
       - It resolves `tsx` from BootQuest's `node_modules`, not the fetched repo's.
     - (b) The gate needs both directions. The starter stub FAILS via the app, and a fixture
       solution in `tests/fixtures/signalpost-u01/` (never in the mirror, never in the real DB)
       PASSES.
     - (c) Milestones without a check file register as study units, not as broken check units.
     - (d) Milestone `competencies` are free text ("programming fundamentals", "tool fluency").
       Seed a mapping table onto the spec's 7 competencies in M1.

## Majors

3. **[major] jstrain2.2 import has no wave.**
   - Spec §3.1 lists it as the third V1 import. The wave table has only BootForge (W2) and
     csbootcamp (W3).
   - Its drills are a vitest harness (`jstrain/exercises|solutions|tests`, `vitest.config.ts`),
     and its quizzes are markdown (`quizzes/01-language-core.md` …). That means a third runner
     mode plus a quiz parser with a single-key validator.
   - It also contains its own, larger `csbootcamp/` (9+ modules) that differs from elirc/csbootcamp
     (4 modules, 31 exercises). Dedupe/provenance is undecided.
   - *Fix:* add jstrain to W3 (or a W3b) with its own sweep gate. Decide in R2 which csbootcamp is
     canonical, and record that as a deviation if it is not elirc/csbootcamp.

4. **[major] The csbootcamp format does not match the spec's C# runner design, and the plan's W3
   gate does not define what "sweep" means.**
   - Exercises are .NET 10 file-based apps: `dotnet run 01-count-vowels.cs`, with
     `#:project ../../_lib/Check/Check.csproj` and the tests inline below a
     `// ─── tests ───` marker.
   - Solutions repeat the tests in the same file. Running the solution file just runs the
     solution's own copy of the tests.
   - *Why:* a "sweep green" that runs `solutions/*.cs` as-is proves nothing about the read-only
     contract.
   - *Fix:* the adapter splits each exercise at the marker into learner region and test region,
     treats the exercise's test region as the read-only contract, and grades
     `solution learner region + exercise test region`. It asserts that the solution's test region
     is byte-identical to the exercise's after EOL normalization, and quarantines it otherwise.
     Prefer the console + `Check.csproj` shape (zero NuGet deps) over xunit, so "restore once,
     offline after" is trivially true.
   - *Gate addition:* run each starter (`throw NotImplementedException`) and require it to FAIL.

5. **[major] Quarantine makes the M2/M3 gates vacuous.**
   - "0 unquarantined failures" passes if everything is quarantined.
   - Separately, "all 2,559 refs" is a hardcoded number. `content/build` has 16 course files
     against the spec's "15 courses", and quiz items have no runnable ref.
   - *Fix:* each sweep emits `reports/sweep-<pack>.json` with `{built, loaded, runnable, passed,
     quarantined[] with reason}`. The gate asserts:
     - `loaded===built`
     - `passed+quarantined===runnable`
     - `quarantined ≤ 1%`, with each one listed in the commit body
     - a planted broken reference is quarantined, as a negative test

6. **[major] There is no gate that the app is usable after M1–M3.**
   - The spec promises "M1–M3 alone = a usable gamified drill app". W1–W3 gates are unit tests,
     `vite build`, and sweeps. None of them proves a drill can be opened, submitted, graded, and
     XP awarded.
   - *Fix:* pull a minimal API smoke forward into W2: boot the server on a scratch port and
     scratch DB, then submit a BootForge ref and a wrong answer. Assert the `xp_event` count and
     the `attempt` and `run` rows. Extend it in W3 with a C# drill and a CLI `submit`. M7 then
     hardens an existing smoke instead of writing the first one.

7. **[major] The honesty flows are client-side unless the plan says otherwise.**
   - Explain-back and G2 both need "answers stored immutably before the key is revealed". Revealing
     a solution must zero XP forever.
   - If the key ships in the same payload as the questions, that ordering lives only in React.
   - *Fix:*
     - The M1 constraints add a rule: the key/checklist/solution endpoints return 403 unless an
       immutable answer row exists, and reveal writes a `guided` attempt that the XP engine
       honours forever.
     - "Append-only" is enforced by SQLite `BEFORE UPDATE/DELETE … RAISE(ABORT)` triggers on
       `attempt`, `run`, `evidence`, and `xp_event`, not by convention ("no UPDATE path in the
       data layer").
     - The W1 tests must prove both.

8. **[major] The owner's DB can be destroyed by tests, sweeps, and smoke.**
   - Memory records shared-DB truncation as a failure on this machine. Evidence is the "truth
     layer" and is kept forever.
   - *Fix:*
     - The DB path comes from `BOOTQUEST_DB`, and the real DB lives in an app-data dir outside
       the repo.
     - Vitest, sweeps, smoke, and e2e always use OS-temp files. A guard throws if `NODE_ENV=test`
       and the path equals the real DB.
     - The M7 `seed/reset` refuses to touch the evidence, attempt, run, and xp_event tables
       without `--i-mean-it`.

9. **[major] CLI ↔ server ↔ seed-tool concurrency on one `node:sqlite` file is undecided.**
   - `bootquest submit` from the editor, the dev server, and `seed:*` can all write at once.
   - *Fix:* decide in W1 that the CLI writes only through the server's HTTP API, so there is a
     single writer. The CLI prints a clear error when the server is down. Seed tools write JSON to
     `content/`, never to the DB. Also set WAL + `busy_timeout`.
   - Decide how `bootquest` lands on PATH. npm-link shims on Windows went stale before (vgslop
     memory). Recommend `npm i -g ./cli` re-run by an `npm run cli:install` script, verified with
     `where bootquest`.

10. **[major] Windows process trees under timeouts.**
    - `child.kill()` on Windows does not kill descendants. `dotnet test`/`dotnet run` spawn
      MSBuild nodes, VBCSCompiler, and testhost, and those hold locks on the reused `bin/obj`.
    - The next attempt then fails with file-in-use errors, which look like flaky "compile errors".
    - *Fix:*
      - The C# runner kills with `taskkill /PID <pid> /T /F` on timeout.
      - A per-shape mutex serializes dotnet attempts, because reused `bin/obj` cannot be shared
        across concurrent builds.
      - Measure warm runs with and without `-nodeReuse:false`/build server (the build server is
        what makes <10s possible, and it is also the zombie source).
      - Add a W3 test: submit an infinite-loop C# exercise, then confirm with `tasklist` that
        nothing survives and the next attempt passes.

11. **[major] The Bash tool's 10-minute foreground cap versus a 2,559-exercise sweep.**
    - The grader spawns one node process per exercise, about 4s cold (spec §13). That puts a
      course at roughly 170 exercises, or 3–11 minutes. Background jobs get reaped.
    - "Per-course foreground" alone is not enough. One slow course hits the cap, and the agent
      then either backgrounds it (reaped) or reports partial results.
    - *Fix:* make `seed:validate` resumable. It journals per-exercise results to
      `reports/sweep-<pack>.jsonl` and skips already-passed `(id, contentHash, runnerVersion)`
      entries. It takes `--course` and `--limit` and writes a completion marker. The gate reads the
      journal and checks it is complete, so a chunked run is still a full run.

12. **[major] The M5 gate passes with zero content, and W5 is too big for one agent.**
    - "Citation validator green across all seeded content" is vacuously green when nothing is
      seeded.
    - W5 bundles the upskillorder parser, act/unlock logic, the campaign UI, the seed tool
      framework, three validators, roughly 20 repos of LLM-authored quizzes and flashcards, and
      20 katas (`seed:patches` is not even named in the plan's W5 row).
    - *Fix:*
      - **W5a** tooling + validators, each with a planted-bad negative test: a bad `file:line`
        citation, a multi-keyed quiz, a kata with no defect.
      - **W5b** acts from INDEX.md plus the campaign map and the unlock rule.
      - **W5c** content authoring in batches of about 5 repos per agent. These agents write
        disjoint JSON files and run no installs, so 2–3 can run in parallel. Fable serializes the
        validator runs.
      - The gate asserts counts: both tracks have 5 acts, Act-1 has ≥10 repos/track with quizzes,
        and there are ≥20 katas.

13. **[major] Pinned SHA source of truth for citation validation is undecided.**
    - The spec pins citations to a SHA. Seed sources include the claiufe mirrors, which may be
      ahead of or behind GitHub, and the network-dependent GitHub API.
    - `--depth 1` clones cannot check out an arbitrary older SHA.
    - *Fix:* sync records the GitHub HEAD SHA. The validator reads files from a per-SHA disk
      cache, populated from the GitHub tarball/zipball at that SHA (or a mirror only when
      `git rev-parse HEAD` equals the pinned SHA). The full validate then works offline after
      first fill, and M7's "full validate" is not flaky on the network.

14. **[major] Nothing is gated for spec items with no home in any wave** (spec §§1, 4, 6, 8, 10):
    - Agentic track G1–G4: not in the plan or the spec milestones. The 20 katas (M5) feed G1, but
      G2's brief rubrics and immutable-first flow, G3's external quest/repo check, and G4's guided
      project have no wave. *Fix:* G1+G2 go in W6 (they share the immutable-answer player with
      explain-back). G3+G4 go in W7, or are explicitly deferred with the owner's sign-off.
    - The repo-check type (M3): the W3 gate tests only HTTP. Add a repo-check fixture (a local
      git branch-exists predicate). Stub GitHub predicates (CI green, PR description) behind an
      interface, since the Octokit client otherwise only arrives in W4.
    - UI surfaces with no wave: heatmap, daily slate view, skill tree per track, review session,
      stats/evidence browser. Assign them:
      - W1: dashboard shell, heatmap, slate
      - W2: exercise player (drill/quiz/predict)
      - W5: campaign map and skill tree
      - W6: explain-back, kata, and review players
      - W7: stats/evidence browser
    - The `bootquest sync` CLI command and "new stable_keys queued for the next seed session": put
      both in the W4 gate. Adding a heading to a fixture repo must surface exactly one new key.
    - "Reveal schedules a pre-seeded variation": variations exist only from M6. The M1 schema needs
      the `unit → variant` link, and W2–W5 reveal must degrade gracefully, logging "variant
      pending".

15. **[major] The Stryker gate is an unmeasured feasibility risk in the last feature wave.**
    - Stryker.NET (`dotnet tool install dotnet-stryker`) and StrykerJS are heavy, spawn process
      trees, and run long on this laptop. M6 also needs "one sample solo project" that does not
      exist yet.
    - *Fix:* spike it in W3, while the dotnet runner is fresh. Install it, run it on a 2-file
      fixture project, and record its runtime in LEARNING.md. If it exceeds the foreground cap, the
      M6 gate runs it on the fixture with `--since`/a small mutate glob. State that this is not a
      gate widening.

16. **[major] W1 gate is untestable as a quality bar.**
    - "Engine unit tests green" passes with one trivial test.
    - *Fix:* list the required cases in the plan:
      - level curve `150·n^1.6` at n=1, 2, 10
      - XP table values
      - FSRS XP cap at 30/day
      - partial day (≥20 XP) keeps the streak and earns no token
      - 7 slate-days earn 1 token, at most 2 banked, auto-spent
      - local-timezone day boundary with the injected clock
      - reveal earns 0 XP on a later pass
      - promotion evaluator: positive and each negative leg
      - append-only triggers reject UPDATE and DELETE
      - zero-migration rows (Java, agentic, U01)
    - The gate is `vitest run` with a minimum-count assertion, or a test that greps for named
      `describe` blocks.

17. **[major] Review burden on Fable will turn into rubber-stamping, and the owner's ask is wider
    than one plan review.**
    - The owner wants Opus to second-opinion everything Fable does initially. The plan uses Opus
      review once, for this plan.
    - W1 (schema + engines + API + client scaffold + workspaces) and W5/W6 are each several
      thousand lines. "Targeted reads" plus re-running a weak gate (see 5, 12, 16) will not catch
      honesty-rule violations.
    - *Fix:*
      - Every drafting agent's report must include a **spec-trace table**: spec bullet → file → test
        name.
      - Fable verifies the table and the negative tests, not the diff wholesale.
      - A fresh-context Opus reviewer audits the W1 schema/engines and the W6 honesty flows before
        commit.
      - Content batches (W5c/W6 seed output) get Fable spot-checks of ≥10% of items against
        sources, because quiz correctness is only partly machine-checkable.
      - Split W1 into W1a (workspaces + schema + engines) and W1b (API + React shell).

18. **[major] No recon brief covers the M4 target or the C# format.**
    - R2 covers upskillorder, claiufe, jstrain, and csbootcamp "import surfaces". Nothing covers
      signalpost's `program.json` and check harness, which is the data-model proof.
    - The facts in items 2 and 4 were found by this review, not by the planned recon.
    - *Fix:* fold items 2, 3, and 4 into R2's memo, or add R4 (signalpost contract plus a dotnet
      file-based-app warm-run measurement). Do this before W1 freezes the `check.spec` union.

19. **[major] The GitHub token is a human dependency nobody has scheduled.**
    - The spec says Octokit plus a **fine-grained read-only PAT**. `gh auth token` returns gh's
      broad OAuth token, which is not that.
    - *Fix:* before W4, either the owner creates the PAT (stored in `%APPDATA%\bootquest\token`,
      never in the repo), or the use of `gh auth token` is recorded as a deviation. Either way the
      owner decides, not the agent at runtime.

## Minors

20. **[minor] Line-ending handling is undecided.** On Windows git with autocrlf: predict-output
    compares exactly (§4), `stable_key` hashes heading text, and the csbootcamp test-region
    equality check (item 4) compares bytes. *Fix:* normalize `\r\n→\n` at every compare/hash
    boundary, with a test using a CRLF fixture.

21. **[minor] Long paths.** The SHA cache is `%APPDATA%\…\<repo>\<sha>\…` holding repos with deep
    `node_modules`-style paths. *Fix:* cache only the paths sync needs (md + checks + program.json),
    and set `core.longpaths=true` if any git checkout is used.

22. **[minor] The plan contradicts itself on parallelism.** "One build agent at a time" sits beside
    W5's "1–2 Opus". *Fix:* state that the rule is no concurrent installs, DB writes, or runner
    sweeps. Content-only agents writing disjoint files may run in parallel (see item 12).

23. **[minor] jstrain is read from the claiufe mirror.** The mirror is currently at
    `main...origin/main` (in sync), which is acceptable. *Fix:* record the imported SHA in
    `source`, and fail the import if the mirror is dirty or diverged.

24. **[minor] "Nothing fetched runs" (§5) versus running a fetched signalpost check.** *Fix:* allow
    execution only of check files from `curriculum.yaml` repos owned by elirc, at the pinned SHA,
    with a recorded content hash. Note this in LEARNING.md as the interpretation.

25. **[minor] The warm-run gate needs a defined measurement.** *Fix:* "median of 5 consecutive
    submits of the same csbootcamp exercise after one cold run, timed in-process, printed in the
    commit body". Cold ≤60s is measured the same way after `cmd /c rmdir /s /q` of the scratch dir.

26. **[minor] The W4 gate wording "renders" is not a command.** *Fix:* an API test checks that
    `GET /api/units/signalpost:U01/content` returns markdown with `sha` equal to the pinned SHA.
    A second call with the Octokit client stubbed to throw still succeeds (offline after first
    view).

27. **[minor] Busy-port pre-check and loaded===built are listed under M7.** Spec §13 says to obey
    them from the start. The plan's risk 3 does say this. *Fix:* make them W1 code with W1 tests.

## Sound as written

- The W1→W7 order matches spec M1–M7. Putting `content_ref` in M1 is correct, though not
  sufficient (see item 2).
- The repo-location and jstrain-path deviations are recorded properly.
- Fable re-running every gate in the foreground before commit is right.
- The commit discipline, `git commit -F`, and Co-Authored-By rules match spec §13.
- Risk items 1 (copy the grader first), 3 (spawn `process.execPath`), 4 (surface rather than widen
  the dotnet gate), and 5 (PowerShell traps) are correct and sufficient as stated.
