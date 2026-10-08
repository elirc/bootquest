# LEARNING.md — decisions and surprises

Append-only. Newest at the bottom. Kept by the orchestrator (Fable).

## 2026-10-07 — bootstrap

- **Build location is `Desktop\selfboot`, not the spec's `Desktop\bootquest`.**
  The owner started the build session here; app/package name stays `bootquest`.
  `git init -b main` created a nested repo that shadows the stray home-directory
  git repo (whose root is `C:\Users\Owner`). Repo-local identity set:
  `elirc <elirc3@gmail.com>`.
- **jstrain2.2 is at `Desktop\claiufe\jstrain2.2`**, not `Desktop\jstrain2.2` as
  the spec says. It is a claiufe study mirror: read-only, never edit.
- Toolchain on this machine: node v22.16.0, npm 10.9.2, dotnet 10.0.302, gh CLI
  authenticated as elirc over https.
- Orchestration: Fable plans/reviews/gates/commits; Opus drafts everything; an
  Opus second opinion reviews the initial plan before M1 (owner's instruction).

## 2026-10-07 — R1 recon decisions (opusboot2 import)

- **Copy opusboot2 from the WORKING TREE, not HEAD (7ee7493).** The uncommitted
  `server/grade-core.mjs` is the superior grader (structured expected/actual
  feedback, results-shape checks, early-exit detection); the working tree also
  holds a 16th untracked course, `engineering-practice`.
- **W2 gate scope: 16 courses, 2,571 exercises** (1,825 code / 544 quiz /
  196 output / 6 written), not the spec's "2,559/15" which predates the 16th
  course. `seed:validate` executes every exercise with a runnable reference;
  the 6 `written` exercises are schema-validated and reported as an explicit
  counted carve-out (no runnable reference exists), never silently skipped.
- Import reads compiled `content/build/*.json` (5.7 MB, tracked), not the
  `.course.mjs` sources.
- Grader adoption: copy `grade-core.mjs` + its test file near-verbatim (rename,
  add `--disable-warning=ExperimentalWarning` — confirmed working on node
  22.16 — drop dead MARKER constant); Zod validation wraps it at the server
  boundary rather than editing the grader. `shared/types.ts` becomes Zod
  schemas. `tools/validate.mjs` → `seed:validate` with per-course foreground
  runs, quarantine list, timeout retry. Keep smoke.mjs's busy-port check,
  `process.execPath --import tsx` spawn, loaded===built assertion.
- Confirmed machine gotchas to honor in M1/M2 code: null-prototype sqlite rows
  (spread first), BigInt insert IDs, 0/1 booleans, `createRequire` for
  `node:sqlite` under vite/vitest, AsyncFunction (not Function) test execution,
  shared module instance across tests (state can leak), ~4s grade cold start
  (parallel sweeps can bust the 8s timeout → per-course foreground), JSON
  content files over template literals, grader is NOT a sandbox (learner code
  could write its own results.json — acceptable per spec §5 isolation stance).

## 2026-10-07 — second opinion incorporated (plan v2)

Opus plan review (`docs/recon/plan-review.md`) returned 2 blockers + 17 majors;
**all accepted**, BUILD-PLAN.md rewritten to v2. The structural changes:
- Engines get an injected clock so the M6 promotion gate (≥2-day retest) can be
  demonstrated honestly on a temp DB with fixture-labelled data — the real
  evidence DB never receives fixture rows. Negative legs are part of the gate.
- New W1.5 spike: signalpost checks are `node:test` files importing learner
  modules (U01 stub throws by design; program.json lives at `docs/curriculum/`;
  only 3 of 12 milestones have check files) — BootForge's AsyncFunction grader
  cannot run them, so a `node-test-file` check type is in the schema from M1.
- Anti-vacuous gates: quarantine ceiling ≤1% + planted-bad negative tests for
  every validator; count assertions on all seeding; API usability smoke in
  W2/W3; W1a gate is an enumerated test-case list.
- Server-enforced honesty: 403 before immutable answer rows; append-only via
  SQLite triggers. Single-writer: CLI goes through HTTP only.
- `seed:validate` gets a resumable per-exercise journal (10-min foreground cap
  + memory-reaper on this laptop).
- Decisions: canonical csbootcamp = GitHub repo (jstrain's embedded copy
  excluded); CLI ships as committed `bin/bootquest.cmd` (never npm link);
  sync uses `gh auth token` for now — **owner to-do: create the fine-grained
  read-only PAT** the spec calls for.
- Anti-rubber-stamping: spec-trace table required from every agent;
  fresh-context Opus audits after W1a and W6; Fable spot-checks ≥10% of all
  seeded content.

## 2026-10-07 — R2 recon decisions (estate contract)

- **Two csbootcamps, one pack format** — GitHub elirc/csbootcamp (4 modules /
  31 ex) stays the .NET opener; jstrain2.2's embedded csbootcamp/ (29 modules /
  147 ex) imports in W3b with name-based dedup (GitHub copy wins). This
  REVERSES the earlier "exclude embedded copy" decision made on the reviewer's
  partial information — R2 confirmed same harness format.
- **jstrain grading protocol is its own runner mode**: single self-testing
  files printing `#done passed= failed= todo=`; `todo` is not a failure;
  `*-debug`/`*-hunts` modules fail BY DESIGN (inverted checks); TS track must
  run real `tsc` (esbuild alone silently drops type-assertion grading).
  Schema therefore carries a `todo` result state and an `inverted` check flag
  from M1.
- **stable_key reality**: no sampled markdown has frontmatter → heading-hash
  fallback is the day-one norm; keys scoped per repo (twin repos share heading
  text); must disambiguate duplicate headings.
- **Campaign seeds from `Desktop\upskillorder\assess\*.jsonl`** (stack/kind/
  confidence fields; INDEX.md is generated from it). Spec's act lists are
  themed buckets, not INDEX order — order quests by rank within acts. 54
  study/skim repos have no V1 track → reported count, excluded from V1 acts.
- **Seed-tool exclusion/redaction list is mandatory**: known-stale-anchor
  repos; z8 tests expire 2026-12-31; andie's VERIFICATION.md contains a leaked
  Shopify token (never ingest unredacted — and the owner still owes that
  token's revocation, flagged since the Astra audit).
- signalpost: program.json v2 (12 milestones, 21 fields each) already has a
  zod schema in its own `scripts/check-curriculum.ts` — borrow it in W4;
  only U01–U03 are code-checkable, U04–U12 register as study units; check
  files import `../learner/uNN.mjs` so the W1.5 runner workspace must mirror
  repo layout.
- Minor: a `shared/` workspace is added to the spec's layout for Zod schemas
  used by server, cli, and tools (spec §2 listed only server/client/cli/
  tools/seed/content/docs).

## 2026-10-07 — scale-up (owner directive: more agents, more quality)

- Parallelism model changed: the one-agent rule now applies only to the MAIN
  workspace; independent modules build concurrently in isolated git worktrees
  (P1 JS grader port, P2 C# runner spike, P3 node-test-file spike = W1.5,
  P4 citation resolver, P5 client shell prototype) and are transplanted by the
  orchestrator at integration points. This front-loads the two
  hardware-risk gates (dotnet warm <10s; signalpost checks actually runnable).
- Quality upgrade: EVERY wave's diff gets a fresh-context Opus review before
  Fable runs the gate and commits (previously only W1a/W6).

## 2026-10-07 — worktree-isolation gotcha (machine)

- Agent worktree isolation cut worktrees from the STRAY HOME-DIR REPO
  (C:\Users\Owner, origin elirc/grouphelpdesk) instead of selfboot — the
  session started before selfboot's `git init`, so the harness resolved the
  wrong root. Consequences: P-agent worktree commits sit on helpdesk history
  (never cherry-pick — transplant by file copy); `npm --prefix` inside such a
  worktree adds a stray `"helpdesk": "file:.."` dep + junction (strip it;
  delete junction with non-recursive unlink). All P agents were warned
  mid-flight. Cleanup owed at the end: remove the agent worktrees + branches
  from the home repo.
- Pipe-masked exits strike again: `cmd | tail; echo $?` reports tail's exit.
  Gate verification uses `set -o pipefail` or captures the exit before piping.
- W1a landed (0d6df99) + P1 grader transplant (09052ae): server 8 test files
  (96 tests) + shared 27, typecheck clean — all re-run by the orchestrator.
- W1a drafting decisions of note: XP pays once per unit per kind (0-XP
  'already-awarded' ledger rows — anti-farming, not in spec); 7-slate-day
  token counter cumulative, reset only by broken streak; promotion legs must
  postdate last promotion/demotion, leg (c) matched by competency ≥48h after
  leg (b); `check` is an SQL keyword — always quote the table name; node 22.16
  returns plain numbers (not BigInt) for lastInsertRowid.
