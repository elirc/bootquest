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
## 2026-10-07 — P3 spike results (node-test-file / signalpost)

- The M4 slice is proven: U01/U02/U03 run via a `node-test-file` runner with
  sha256+blob-sha integrity gates (CheckIntegrityError = refusal, never a
  recorded attempt), TAP parsing, `taskkill /T /F` tree-kill (grandchild PID
  verified — `node --test` runs the file in a GRANDCHILD).
- Adversarial holes found and closed: learner `process.exit(0)` at import
  forges a file-level `ok` ⇒ runner enforces `expected_tests`; env leaks
  (`NODE_TEST_CONTEXT`, `NODE_OPTIONS`, `VITEST*`) are stripped; check file is
  copied fresh, chmod 444, re-hashed post-run.
- Residual risk (documented in p3-findings.md): a submission sharing the
  module graph could monkeypatch `node:assert` to fake green — W4/W7 should
  add the suggested static-scan flag.
- Fixture bytes MUST be protected from autocrlf: `.gitattributes` rule
  `server/src/runners/node-test-file/fixtures/** -text` is part of the
  transplant; app vitest config must EXCLUDE those fixtures (upstream
  u03.test.ts otherwise gets collected and breaks the suite); `tsx` becomes a
  server runtime dependency.
- W4 implications: check paths are NOT structured data in program.json — they
  live in ticket prose (UNN-02), so W4 uses a recorded spec table (P3's
  checks.json is the model); U03's acceptance ALSO requires
  `tsc -p practice/tsconfig.json` (composite check or explicit drop — decide
  in W4); signalpost declares engines node>=24, we run 22.16 + tsx (works for
  U01–U03); estate memo correction: U02's starter is DEFECTIVE code, not a
  throwing stub.
- Transplant deferred until W1b lands (package.json/vitest-config contention).

## 2026-10-07 — P4 results (citation resolver)

- Done, 51/51 green; transplant = tools/seed/src/citations/** (+fixtures with
  `* -text` .gitattributes and PROVENANCE.md); zero runtime deps. At
  transplant: add `"type": "module"` to tools/seed/package.json and exclude
  `src/citations/fixtures/**` from tsconfig/lint (fixtures are data).
- Eight citation forms the estate memo missed are handled — notably GitHub
  `#L421-L423` anchors (~2,414 files across mirrors), `file.ts:17,22-24`
  mixed lists, en-dash ranges, `[[...publicId]].tsx` catch-alls (exempt from
  any "skip ..." rule), link targets carrying `:line`.
- W5a MUST consume: `summary.warnings` / `inheritAmbiguous` (continuation
  refs that bind plausibly-but-wrongly resolve "ok" — human review queue);
  `excludeDirs` with path form for snapshot trees (e.g.
  `astraupskill/snapshots` dupes make bare suffixes ambiguous); expect real
  failures in some mirrors (newcodex3-23 has 4/198: escapes-repo, ambiguous
  bare names, files-the-guide-says-to-create) ⇒ whitelist/quarantine step is
  required, not optional. Exact-case index keeps Windows/Linux results equal.

## 2026-10-07 — W1 integration burst (da8ca60)

- W1b landed (205743b): 177 tests + typecheck + smoke 14/14, all re-run by
  the orchestrator. W1b surprises worth keeping: root typecheck had been
  RED at 09052ae (P1 extensionless import) and the workspace typecheck gate
  had been vacuous (no workspace had a typecheck script) — both fixed;
  GET /api/dashboard performs writes (closes elapsed days, creates today's
  slate row) — flagged for the W1b reviewer's judgment; reference solutions
  live in a UnitContentStore (BOOTQUEST_UNIT_CONTENT), NOT in check.spec.
- P2–P5 transplanted in one window (da8ca60): 286 tests across 4 workspaces
  + test:csharp 18/18 (128s, own gate so the main suite stays fast) +
  client build. Integration fixes: P2 code needed ~25 noUncheckedIndexedAccess
  fixes (its worktree tsconfig was laxer — worktree-proven code still meets
  main-tree strictness only after adjustment); dual-vite type clash (root
  vite 7.3.7 hoisted for vitest 3 vs client vite 5.4.21) ⇒ vite.config.ts
  excluded from the client tsc project (vite loads its own config).
- W1c (engine unforgeability per audit + review-evidence + reading
  self-attest) and a fresh-context W1b API review (frozen git-archive copy,
  includes the client↔server binding worksheet) launched in parallel.

## 2026-10-07 — M2 landed (4632a21) + client bound (01925e2) + W2b fixes

- M2 gate run personally: fresh journal, 16 courses, 2,571/2,571 validated,
  0 quarantined, 192.9s; 410→442 tests; smoke 22/22 incl. real BootForge
  submissions. Mapping verified field-by-field across ALL 2,571 exercises
  by the fresh reviewer: clean.
- Client transplanted + prose contract aligned (top-level instructions/
  snippet/rubric; quiz question promotes to the pane heading).
- W2 review findings → W2b fix wave (in flight): F1 BLOCKER packs loadable
  without any proof of validation ⇒ validation.json stamp + loader refusal;
  F2 post-load quarantine must retire units; F3 starter-must-fail extends
  to every code drill ⇒ the 2 vacuous upstream checks (ts-fix-annotations,
  fetch-unknown) get QUARANTINED, not fixed (spec §3.1: never weaken
  tests); F6 decided: reviewOf → variation_of_unit_id, not a prerequisite;
  F9 decided: written model answers via immutable-answer-first
  (/model-answer 403 until a recorded answer attempt exists); vite dev
  fs.deny for content/packs (solutions were servable via /@fs/).
- Grader speed reality: 0.1–0.6s per run (not the feared 4s cold) — the
  full sweep is ~3 min, cheap enough to re-run fresh at every milestone.
- W2b landed (451b3b0), gates re-run by orchestrator incl. a fully fresh
  sweep (308s, 2,563 pass / 2 quarantined vacuous-check / 6 carve-out,
  stamp verified). RATIFIED: strict per-source grader fingerprint stays —
  editing grader/validator sources or upgrading node/esbuild forces a full
  re-sweep before `npm run serve` accepts the pack; stamp/quarantine files
  are committed (fresh clones refuse unstamped packs otherwise).
- M3 waves launched: W3a (csbootcamp import + drill-cs wiring + stamped
  C# sweep) in main workspace; W3b-cli (bootquest CLI + bin shim + real
  server e2e) in a worktree from the 451b3b0 archive. W3c (HTTP/repo
  checks, jstrain import, Stryker spike) follows W3a.
- W3b-cli done in worktree (78 tests + tsc green; transplant queued behind
  W3a): commander-only CLI, exit codes 0 pass / 1 fail / 2 usage-or-error,
  kind-groups test forces a decision for every new check type, never
  prints solutions (source-scan test). SHIM LESSON: `node --import tsx`
  resolves tsx from the CALLER's cwd — the committed bin/bootquest.cmd
  routes through cli/bootquest.mjs which loads tsx relative to the repo.
  Transplant hand-edits: root script "bootquest", .gitignore needs `!/bin/`
  (dotnet bin/ rule otherwise swallows the shim). CLI-reported API gaps →
  W3c: GET /units/by-key/:key; submission request shapes for guided-step/
  http/repo (CLI refuses them rather than guessing). Minor → W4/W7:
  health lacks pack/stamp info; no test-count for non-drill checks.

## 2026-10-07 — W1c landed (c762032): honesty core unforgeable

- All audit blockers/majors + W1b gaps + addendum closed; 358 tests,
  typecheck, smoke 15/15 — re-run by the orchestrator. Tests that enshrined
  holes were rewritten to assert closed behavior, not deleted.
- Residual risks accepted and documented: raw-SQL forgery can still move a
  rating exactly ONE notch (three-leg verification in a trigger is
  impractical; engine API cannot forge at all; multi-notch and
  evidence-reuse blocked in SQL); check.inverted affects only the shipped
  starter's contract, learner submissions use the plain verdict.
- W1c design notes: explain-back self-score lives on the evidence (answer
  attempt is immutable BEFORE the key is shown, so the score cannot be on
  it; 24h filing window, assessor self); review slate slot = "queue empty
  right after some review that day" (pure end-of-day would undo a clear
  when a card falls due at 23:00); promotion is currently reachable only
  through the engine — HTTP endpoints for artifact/retest evidence arrive
  with W3 (CLI submits) and W6 (players).
- OWNER DECISION DEFERRED: cap demotions at one per competency per day?
  Current behavior = every Review-state lapse demotes (spec-literal).
- Machine note: this shell's heredocs mangle backticks — agents generate
  tricky files via Python scripts in the scratchpad instead.
- Next: W2 (BootForge import + 16-course sweep) in main workspace and W1d
  (client binding per worksheet, server contract canonical) in a worktree,
  in parallel.

## 2026-10-07 — W1d results (client bound to real contract)

- Done in worktree (69 tests + build green): all 21 worksheet groups fixed;
  client defaults to HTTP API (IPv4 proxy to 127.0.0.1:4178), `dev:mock`
  keeps the standalone demo; honesty fixes in (boolean selfAssisted only,
  no correctIndex anywhere, reveal confirm "0 XP forever", no Run button
  for quiz/predict, self-attest once). Transplant AFTER W2 releases the
  workspace (fixes touch shared/).
- At transplant, apply the G-fixes in main tree: G1 remove unused Assessor
  import in shared/schemas.ts then restore client noUnusedLocals/Params;
  G2 add missing type aliases + enum exports to shared/src/api.ts;
  G5 tighten slate.status to the enum. G3 freeze-token cap stays a client
  constant (2); G4 attested-via-state is fine.
- OWNER DECISION DEFERRED (G6): quiz answers remain findable via repeated
  RECORDED submits (spec-literal: failed submits free but recorded; reveal
  laundering blocked). Accepted for V1; cooldown/shuffle possible later.
- Content gaps G7 tracked: instructions/prompt arrive with W2 packs;
  review-card front/back arrives with W4/W5 card seeding.

## 2026-10-07 — W1b fresh review (docs/recon/w1b-review.md) + decisions

No blockers; 3 majors, all folded into W1c mid-flight by addendum:
- **run() was a free answer oracle for quiz/predict** (3-choice quiz → 3 free
  runs → full-XP submit). DECISION: run returns 409 for quiz/predict-output;
  submit-only (failed submits stay free-but-recorded). Spec §4's "run is
  free" is read as applying to code drills; §0.3/§0.5 honesty outweighs the
  literal read for oracle-able types. Owner can overturn.
- **Drill slate slot gameable** (any kind counted, incl. quizzes, old passes,
  guided). DECISION: drill-kind only, non-guided, first-ever-pass-today.
- **Streak was mathematically impossible** (campaign slot always present,
  nothing completes it; tests asserted current:0 and hid it). DECISION:
  campaign slot exists only when the track has seeded campaign quests —
  keeps M1–M3 usable as the spec intends.
Also: xpKindFor made exhaustive (study-quiz/explain-back/kata were silently
paying as code); drill expected/actual feedback on run is INTENTIONAL
disclosure (the learning experience), documented — quiz/predict never echo.
Verified clean: submit atomicity, reveal gating, default-deny leak whitelist
(one nested-field gap: repo.predicates — W1d), bounded limits, WAL.
Known limitation (accepted): GET /dashboard closes elapsed days; a forward
clock jump irreversibly marks skipped days missed — W7 adds a guard if cheap.
Binding worksheet: 30 client↔server mismatches in 21 groups → W1d scope;
client designs NOT to adopt: client-sent assistance:'reveal' (server derives
reveal), mock returning correctIndex on wrong answers (resubmit exploit).

## 2026-10-07 — P2 results (C# runner spike) — warm gate MET

- Warm <10s / first ≤60s both met, but ONLY on the direct-compiler path:
  `csc.dll -shared:bq-<hash>` named compile server + prebuilt Check.dll
  (console) / warm bin + `dotnet vstest` TRX parsing (xunit). Median warm:
  console 0.66–1.75s, xunit 2.9–4.6s. Spec-literal `dotnet test` is 4–15s+
  under load — keep only as opt-in `xunitEngine:'msbuild'` fallback. W3a
  adopts the direct path as default; gate NOT widened.
- GRADER-INTEGRITY TRAP: untouched csbootcamp starters EXIT 0 —
  `NotImplementedException` counts as todo and Report() returns 1 only when
  failed>0. Pass must require failed==0 && todo==0; never trust exit codes.
- csbootcamp format facts: split is THREE parts (head/tests/tail — types
  live after `return Report();` from module 05 on), divider `// ─── tests ───`,
  solutions repeat tests byte-for-byte; `#:project` lines become comments to
  preserve learner line numbers; NO Directory.Build.props in the GitHub repo
  at e05b3505 (estate memo wrong; may apply to jstrain copy only).
- Windows quirk: Check's ✔☐✘ glyphs become `?` under redirected stdout (OEM
  code page) — fixed via injected UTF-8 module initializer.
- Transplant: server/src/runners/csharp/** + fixtures + p2-timings.md; needs
  vitest `pool:'forks'`, `fileParallelism:false`, 600s timeout for this
  suite; NuGet pins Microsoft.NET.Test.Sdk 17.14.1 / xunit 2.9.3 /
  xunit.runner.visualstudio 3.1.5. In-process mutex only — a lock file is
  needed if two server processes ever share an app-data dir. Full 31-file
  csbootcamp sweep still owed in W3a. Copy LF working-tree files, not the
  worktree-committed (autocrlf) versions.

## 2026-10-07 — P5 results (client shell)

- Done: vite build + 37 tests green; dark-only, keyboard-first (g-chords,
  1–4 review grading only after reveal, editor Ctrl+Enter), zero-layout-shift
  conventions, heatmap buckets aligned to the 20-XP partial-day rule, freeze
  days hatched. Server computes every number; client displays only.
- Transplant: all of client/ except node_modules/dist/package-lock (replaces
  the stub client/package.json). React 18.3.1 pinned; client tsconfig
  standalone (root include correctly excludes client/).
- Binding plan: swap enum types to @bootquest/shared, point http.ts at W1b's
  final route names, flip the one-line mock→real switch in client.ts, add the
  /api proxy in vite.config.ts (comment marks the spot). W1b owns route
  naming; reconcile at integration.
- Honest caveat: narrow/phone-width layout UNVERIFIED (headless capture at
  420px was ambiguous; `min-width:0` added blind). Check on a real narrow
  viewport in W7 dogfood.

## 2026-10-07 — W1a fresh-context audit (docs/recon/w1a-audit.md)

3 blockers + 6 majors in the honesty core, all latent (no API yet), all
scheduled for the W1c fix wave immediately after W1b lands. Dispositions
(all accepted):
- **REPLACE bypasses append-only triggers** (proven on a probe DB: xp_event
  amount rewritten, evidence assistance laundered). Fix: BEFORE INSERT
  WHEN-EXISTS abort triggers on all 5 tables + recursive_triggers=ON +
  REPLACE test cases.
- **Promotion legs taken on the caller's word** → evidence kinds that feed
  promotion must require a linked attempt with a passing run; `verified` set
  server-side only.
- **≥2-day retest back-fillable** (timed on evidence.created_at) → time on
  the attempt, require a DIFFERENT attempt on a variation of the artifact's
  unit.
- **Legs must be linked, not competency-matched** (auditor rejected the
  drafting decision; spec says "*its* explain-back"): artifact unit → its
  explain-back → variation retest of that unit; leg (a) restricted to
  project-kind units; evidence competency checked against unit competencies.
- **awardXp must verify** a passing attempt; difficulty read from the unit
  row; unit always required.
- **Slate self-attest removed**: drill/campaign slots derive from recorded
  attempts; only the spec'd 5-XP reading self-attest stays, unit-linked.
- **Demotion only on lapses of Review-state cards** (spec interpretation:
  "failed review" means forgetting learned material; Again on a new card
  would pin ratings at 1).
- **competency_rating needs integrity protection** tying changes to
  promotion/demotion evidence; test setups must stop using direct UPDATEs.
- **insertUnit must match content_ref by (repo, stable_key)**, not stable_key
  alone (twin repos share keys).
Verified clean by the audit: FK/WAL/busy_timeout on every connection,
parameterized SQL, no-default DB path, clock discipline, migration
idempotency, §9 schema fidelity, exact XP amounts/cap/curve, reveal
persistence, streak arithmetic, FSRS wiring, never-averaged ratings.
W1b was advised mid-flight: no client-supplied verified/assessor/score/
difficulty/assistance anywhere; XP/evidence only via the submit pipeline.

- W1a drafting decisions of note: XP pays once per unit per kind (0-XP
  'already-awarded' ledger rows — anti-farming, not in spec); 7-slate-day
  token counter cumulative, reset only by broken streak; promotion legs must
  postdate last promotion/demotion, leg (c) matched by competency ≥48h after
  leg (b); `check` is an SQL keyword — always quote the table name; node 22.16
  returns plain numbers (not BigInt) for lastInsertRowid.
