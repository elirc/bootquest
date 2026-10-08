# BootQuest — orchestration & build plan (v2)

Author: Fable (orchestrator). v2 incorporates the Opus second opinion
(`docs/recon/plan-review.md`: 2 blockers, 17 majors — all accepted, none
rebutted) and the R1 opusboot2 recon (`docs/recon/opusboot2-copy-plan.md`).
Spec of record: `Desktop\bootquest-final-prompt.md`. This plan decides how the
build runs; it does not restate the spec.

## Deviations from the spec (recorded, not re-opened)

1. **Repo location** `Desktop\selfboot` (owner started the session here); app
   name stays `bootquest`. Nested git repo shadows the stray home-dir repo.
2. **jstrain2.2 path** is `Desktop\claiufe\jstrain2.2` (read-only mirror).
3. **BootForge scope** is the working tree (not HEAD): 16 courses / 2,571
   exercises incl. untracked `engineering-practice`; the newer uncommitted
   grader is the one copied.
4. **csbootcamp is two sources of one pack format** (R2): GitHub
   `elirc/csbootcamp` = 4 modules / 31 exercises and stays the .NET-track
   opener (W3a); jstrain2.2's embedded `csbootcamp/` = 29 modules / 147
   exercises, imported in W3b as a separate source with an import-time dedup
   (same module+exercise name → GitHub copy wins).
5. **GitHub auth**: dev/sync uses the gh CLI's token (`gh auth token`) for now;
   the spec's fine-grained read-only PAT is an owner to-do surfaced at the end
   of the build (not blocking).
6. **CLI on PATH**: committed `bin/bootquest.cmd` shim + README instruction;
   never `npm link` (stale-shim history on this machine).

## Roles and standing rules

- **Fable**: plan, decompose, review every diff, re-run every gate personally,
  commit per milestone, keep LEARNING.md.
- **Opus**: drafts all code/content. **One build agent in the workspace at a
  time**; parallelism only for read-only recon and for W5c content batches
  (distinct output files, read-only estate).
- **Spec-trace**: every build agent's report must include a table mapping each
  spec requirement in its brief → file/test that satisfies it, or "NOT DONE".
- **Fresh-context Opus audits** (anti-rubber-stamping): after W1a (schema +
  engines) and after W6 (honesty flows), a fresh Opus agent audits the result
  against spec §6/§9 with no knowledge of the drafting conversation.
- **Seeded-content spot-checks**: Fable manually verifies ≥10% of every seeded
  batch against the source material before its commit.
- **DB safety**: server/tools resolve the DB only via `BOOTQUEST_DB`; tests and
  sweeps always use temp DBs; `reset` refuses without `--yes-really`; the
  owner's real evidence DB never receives fixture rows.
- **Single writer**: only the server opens the real DB (WAL + busy_timeout);
  the CLI talks HTTP only; seed tools write `content/`, not the DB.
- **Honesty is server-enforced**: key/solution endpoints 403 until the
  immutable answer/attempt row exists; append-only tables get SQLite
  UPDATE/DELETE-blocking triggers, not convention.
- **Process hygiene**: spawn `process.execPath` (no shell), kill via
  `taskkill /T /F` on Windows, per-scratch-project mutex for dotnet, planted
  infinite-loop test must be reaped cleanly.
- Engines take an **injected clock** (`now()` passed in), never `Date.now()`
  directly — required for the W6 gate to be honest.

## Waves

Sequential unless marked. Each wave: Opus drafts → Fable reviews diff → Fable
re-runs gate foreground → fix cycle → conventional commit (`git commit -F`,
Co-Authored-By trailer of the drafting model). A wave is never reported green
without Fable seeing exit 0 itself.

| Wave | Scope | Gate (all real commands, exit 0) |
|---|---|---|
| W0 | Recon ×3 + this plan (done) | memos in `docs/recon/` |
| W1a | Workspaces scaffold; full SQLite schema (spec §9 + `check.type` incl. `node-test-file`, reveal→variation link, append-only triggers); engines: XP ledger + `150·n^1.6` curve, streak/freeze/slate, ts-fsrs wrapper, evidence writer + promotion evaluator (injected clock); Zod schemas | `npm test` with the **required case list** below |
| W1b | Express API + React shell (dashboard skeleton, review session, exercise-player stub); API smoke script | API tests + `vite build` + smoke: health, create attempt, xp row visible |
| audit | Fresh-context Opus audit of W1a vs spec §6/§9 | findings fixed or logged |
| W1.5 | M4 spike: `node-test-file` check type running signalpost U01 from the local claiufe mirror (temp dir, SHA-pinned + hash-verified check file, tsx from app's node_modules), free-text→7-competency mapping seed | U01 stub **fails**, fixture solution **passes**, both via the real check runner |
| W2 | JS/TS runner (copy `grade-core.mjs` + tests verbatim, `--disable-warning=ExperimentalWarning`); BootForge adapter (reads `content/build/*.json`); `seed:validate` with per-exercise resumable journal, quarantine report, ≤1% quarantine ceiling, planted-bad negative test | per-course foreground sweeps: 16/16 green, 2,571 counted, 6 `written` as explicit carve-out, 0 quarantined (ceiling 1%); API smoke: real exercise submitted → graded → XP + attempt rows |
| W3a | C# runner: warm scratch per exercise shape, file-based-app split-at-tests-marker grading, verbatim compiler errors, dotnet process hygiene; csbootcamp import (31 exercises from GitHub) | full csbootcamp sweep green **and every starter fails**; warm run measured <10s; infinite-loop reaped |
| W3b | `bootquest` CLI (run/submit/status/sync — HTTP-only writes, `.bootquest.json` detection); HTTP-check + repo-check types; jstrain2.2 import — self-run `#done passed= failed= todo=` protocol, real `tsc` for the TS track (esbuild alone drops type assertions), inverted checks for `*-debug`/`*-hunts`, embedded csbootcamp deduped vs GitHub; Stryker + Stryker.NET spike (measure, pick threshold) | jstrain sweep green (todo ≠ fail; hunts inverted); one HTTP-check lesson passes against a local server; repo-check passes against a local fixture repo; CLI e2e: submit from a scratch project |
| W4 | GitHub sync: source registry, `curriculum.yaml`, content_ref/stable_key resolution, program.json parsing (at `docs/curriculum/`), per-SHA markdown render cache **and per-SHA tarball cache** (offline revalidate), new-stable_key detection queue | signalpost U01 renders + its real check passes **via the app**; simulated new guide lands in the seed queue; revalidate works with network cut |
| W5a | Seed tools: `seed:quests`, `seed:patches`, `seed:explainback`, `seed:variants` (wrong-solution filter) + all validators + an **exclusion/redaction list** honored by every generator (known-stale-anchor repos quarantined; z8's tests expire 2026-12-31; andie's VERIFICATION.md holds a leaked Shopify token — never ingested unredacted) | each validator **rejects a planted bad artifact** and accepts a known-good fixture; wrong-solution filter proven against the real runner; exclusion list unit-tested |
| W5b | Campaign: 5 acts × 2 tracks seeded from upskillorder `assess/*.jsonl` (has stack/kind/confidence; INDEX.md was generated from it) — spec act lists are themed buckets, quests ordered by rank within each act; Java placeholder act; act-unlock rule; the 54 study/skim repos with no V1 track reported, not silently dropped | acts/quests seeded, rank-order spot-check by Fable, unlock logic unit-tested, no-track count in seed report |
| W5c | Content batches (parallel, distinct files): Act-1 quizzes/flashcards ~10 repos/track, 20 patch katas from real claiufe findings, G2 delegation-brief rubrics | citation validator green over **all** seeded content; count assertions (≥10+10 repos, ≥20 katas); Fable spot-checks ≥10% |
| W6 | Competency ladder end-to-end: promotion flow + ≥2-day retest scheduling (injected clock), explain-back + patch-kata players (immutable-answer-then-key, server-enforced), reveal→variation graceful degrade, heatmap + daily slate UI; Stryker gate wired on one sample solo project | scripted promotion e2e on a temp DB with fixture-labelled artifact: happy path **and** negative legs (day-1 retest rejected, assisted artifact rejected, <80% coverage rejected, failed-review demotion) |
| audit | Fresh-context Opus audit of honesty flows | findings fixed or logged |
| W7 | Hardening: smoke suite (~30 checks, opusboot2 model), busy-port pre-check, loaded===built, guarded reset, SEEDING.md, README, dogfood checklist; stats + evidence-browser UI; G1 gate wiring, G3/G4 unit definitions | `npm test` + full journaled validate + smoke, all green, run by Fable in one sitting |

## W1a required engine test cases (the gate is this list, not "tests green")

XP: per-type amounts incl. 10×difficulty; FSRS-review daily cap 30; append-only
trigger rejects UPDATE. Level: curve boundaries at n=1,2,5. Streak: slate-day
earns streak; 20+ XP partial keeps streak without token credit; 7 slate-days →
1 freeze token, max 2 banked, auto-spend on gap day; gap without token breaks
streak. FSRS: Again/Hard/Good/Easy transitions change due_at monotonically
sensibly; failed review on a competency-linked item triggers demotion hook.
Evidence/promotion: promotion requires all three legs (unassisted verified
artifact + explain-back ≥80% + retest ≥2 days later unassisted) — each leg
tested missing → no promotion; reveal zeroes XP forever and flags guided;
assistance flag propagates; ratings never averaged. Clock injection: retest at
+1 day rejected, +2 days accepted.

## Spec coverage map (every spec section → wave)

§1 tracks W1a (Java inert rows) · §2 stack W1a/b · §3.1 imports W2/W3a/W3b ·
§3.2 sync W1.5+W4 · §3.3 campaign W5b · §4 types: drill/quiz/predict W2,
guided/HTTP/repo W3b, study-quest W4/W5b, explain-back/kata players W6,
review W1b/W6 · §5 runners W2/W3a, mutation W3b spike + W6 wire · §6.1 XP W1a,
heatmap/slate UI W6 · §6.2 ladder W1a engines + W6 flow · §7 seed tools
W5a/W5c, SEEDING.md W7 · §8 agentic: G1 bank W5c + gate W7, G2 rubrics W5c,
G3/G4 definitions W7 (G3 uses W3b repo-check) · §9 schema W1a · §10 UI: shell
W1b, map/tree W5b, players W2/W6, stats/evidence browser W7 · §11 gates above ·
§13 gotchas: standing rules + R1 list in LEARNING.md.

## Standing risks (beyond v1)

- Sweeps vs 10-min foreground cap and memory-reaper → journaled resumable
  `seed:validate`, invoked per-course by the orchestrator.
- dotnet zombies hold bin/obj locks → fake compile errors; taskkill /T /F.
- signalpost has checks for only 3 of 12 milestones; others register as
  study/reference units — W4 must not assume uniform coverage.
- Review-burden honesty: audits + spot-checks above; Fable never summarizes a
  gate it didn't run.
