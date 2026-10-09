# Phase A agents — status at handoff and how to resume each

8 Fable agents were running when the owner paused the session. All received
stop orders ("commit only consistent, validator-green work; report state").
Statuses below are from their stop reports; agents marked UNKNOWN never
reported before the session ended — inspect their workspace (`git -C <path>
log --oneline -3` + `git status`) before deciding to harvest or relaunch.

General rules for every resume: foreground-only commands; mirrors READ-ONLY;
don't patch factory/fingerprinted code from content agents; gates before
commit; the RECIPES.md transplant procedure brings work to main.

---

## 1. UI-AUDIT — PARTIAL AUDIT DELIVERED (report is in the repo)

- **Report**: `docs/recon/ui-audit.md`, marked PARTIAL, committed with this
  handoff. 42 URL-screens shot at 1440x900 + 400x850 (~26 personally
  inspected); the INTERACTIVE half (submit/reveal/self-score flows, review
  with due cards, seeded dashboard/stats, act-2-unlocked states, focus
  visibility) was NOT reached — the md contains exact per-state recipes,
  incl. the ≤5-free-submits trick to solve any study-quiz gate and the
  node:sqlite due_at bump to make review cards due today, plus a
  rebuild-the-rig section (note: vite preview binds ::1 only).
- **Findings so far**: 0 broken / 5 bad / 9 polish / 1 unverified. The
  automated probe found ZERO document-level horizontal overflow at 400px on
  every screen (the old blind min-width:0 fix held). The five worst:
  1. **Locked-act leak (bad, honesty-relevant)**: GET /api/units/<act-2-
     locked quest> returns state "available" + the full reading list AND
     all quiz questions; the player is fully playable until submit 403s.
     Fix: act gate in getUnit (mirror retestGate) + a locked render state
     client-side.
  2. Quiz prompts uppercased + raw markdown: .panel-title text-transform
     turns code into CONST X = 1; code fences render literal backticks
     (Player.tsx panes + app.css ~336).
  3. Written-unit instructions flatten code to prose — /play/2564's
     line-numbered handler renders as one wrapped paragraph (unitProse
     pipeline lacks code-block support).
  4. Sidebar TRACKS list intermittently empty on campaign pages (/api/
     tracks ~580ms, fetched twice concurrently, no loading placeholder —
     AppShell.tsx ~100). Needs confirmation it ever fills.
  5. Stats evidence-browser <select> is an unstyled white native control on
     dark theme (Stats.tsx; app.css styles no select).
- **Successor**: finish the audit per the md's next-steps (confirm finding
  4 and the heatmap today-cell offset #15, view the ~16 uninspected shots,
  run the interactive matrix, seed review/act-2 states, re-shoot), THEN run
  the UI-FIX wave (PHASE-B-PLAN.md) against the complete findings list.
  All processes were killed and ports verified free at pause.

## 2. FACTORY (branch `factory-fixes`) — STOPPED CLEAN, ZERO CODE, FILE-PRECISE PLAN DONE

- **Workspace**: worktree `C:\Users\Owner\.claude\worktrees\agent-a370053794cd5f38b`,
  branch `factory-fixes` @ 3795a39 (clean baseline), npm ci DONE.
- Its recon produced an implementation plan a successor should follow
  verbatim (verified against real files):
  - **Fix 1 (labels)**: tools/seed/src/drafts/quests.ts — DraftQuiz +=
    optional `variety` enum(concept|goal-check|finding-location);
    DraftFlashcard += optional `shape` enum(hand-authored|f-table|numbered|
    r-heading); buildDraftItem defaults `variety: d.variety ?? 'concept'`,
    `shape: d.shape ?? 'hand-authored'` (schema values exist at
    shared/src/seed-pack.ts:120,134). Update drafts/quests.test.ts:48.
    Committed packs stay valid until re-seeded.
  - **Fix 2 (guides)**: runQuestsWithDrafts guide loop (~line 155-159):
    `co.index.files.has(g)` → `co.fullIndex.files.has(g)` (snapshots/ OK);
    refuse non-`.md` guides with a clear error (prevents the
    '(untitled guide)' step from parse.ts:456). Leave quests/run.ts
    discovery unchanged (deliberate backlog).
  - **Fix 3a (shapes)**: factory/quests/parse.ts:86-87 — GOAL regex gains
    `\*\*Goal[.:]?\*\*:?`, `\*Goal:\*`, bullet `- Goal:` forms (bold form
    stays FIRST alternative); CHECK likewise; extend the blank/fence
    lookahead at :181-192 for buildsubbox's bare `**Check.**`-then-fence
    case. Pinned guards: ww6 05+06 = 41 candidates / 33 items
    (quests.test.ts:112), zz9 inline ×4, hnjobtrack R-headings, w7-fixes
    nettrello bullets.
  - **Fix 3b (dotted identifiers)**: add `isIdentifierToken` (lowercase-led,
    `/^[a-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/`, no '/') in
    citations/parse.ts; DROP logic in factory/quests/generate.ts right
    after seedCitations (~line 103): path-only line-less citations matching
    the shape that resolveAt says missing-file → drop + gc.skipped entry
    ("not-a-citation: …"). NOT in validate.ts checkCitations (shipped items
    never contain these). Guards: ww6 CORRUPTED fixture + parse.test.ts
    looksLikeFile cases.
  - **Fix 4 (stale quarantine)**: NEW tools/seed/src/validate/prune.ts
    (NOT fingerprinted — validate.ts is grader-fingerprinted but cli.ts and
    new files are not!) called from validate/cli.ts before runValidate:
    drop quarantine entries whose course isn't in the manifest; rewrite in
    writeQuarantine's exact format; one PRUNED line each; malformed file →
    leave for the F8 refusal. Root cause: writeQuarantine:664 keeps
    out-of-scope entries and the stamp (:620) binds them.
  - **Fix 5 (app-root suffix)**: citations/resolve.ts suffix block
    (~:168-187): ONLY when matches.length>1, walk the guide's ancestor dirs
    innermost→outermost, restrict matches to each scope; single scoped
    match resolves via 'suffix'; ≥2 → ambiguous with scoped candidates
    (keep 'matches N files' wording — quests.test.ts:142 pins it); no
    scope match → current global behavior. Single-match path untouched ⇒
    all shipped resolutions preserved.
  - **js1 proof**: committed draft excludes 95 dirs; guides under
    budget-tracker/astraupskill/; run seed:quests:drafts twice (committed
    draft vs copy minus excludeDirs) to temp out dirs → items.json
    byte-identical. Checkout exists:
    selfboot/.cache/checkouts/js1@3c738920d79cfcaad9b6551b3b9dbf770f86973c.
  - **Fingerprint consequence**: these edits change the SEED fingerprint →
    `BOOTQUEST_CHECKOUTS=C:/Users/Owner/Desktop/selfboot/.cache/checkouts
    npm run seed:check -- --restamp` (worktree has no .cache) and COMMIT
    the restamped validation.json files. Also run seed:demo:planted.
- **Gates**: tools/seed suite; seed:check --restamp then plain (77 packs
  OK); js1 proof; typecheck; planted demo.

## 3. RUNNER (branch `kata-cs-tests`) — STOPPED CLEAN, ZERO CODE, RECON CORRECTED THE BRIEF

- **Workspace**: worktree `C:\Users\Owner\.claude\worktrees\agent-a75624ba0e831f4df`,
  branch `kata-cs-tests` @ 3795a39 (clean), npm ci DONE. No dotnet ever
  spawned; no pack touched; nothing to revert.
- **FACT CORRECTIONS from its recon (trust these over older notes)**:
  - jstrain has **2** quarantined quiz items, not 4:
    quiz-04-async-event-loop/q10 (key tokens "A1, B1, …" not in captured
    output) and quiz-06-classes-prototypes/q11 (snippet exits 0; upstream
    key claims a ReferenceError).
  - **ww6 is CORRECTLY absent from the campaign**: assess says skim /
    ts-react-node, it's a ww-crud family member (not a pick), and
    content/campaign/manifest.json report.families[ww-crud].familySampled
    lists it. NO seeder change. Remaining work = wire content/seed/quests/
    ww6 (33 items) as standalone reference material, kata-bank style:
    touch server/src/store/ladder.ts (PlannedUnit families; kata-bank
    precedent ~line 164) and/or store/study-quests.ts (ww6 currently in
    stats.unmatchedPacks); loader test; mind assertUniqueSeedItemRefs +
    loaded===built.
  - **C# kata test mechanics (critical)**: the patches validator runs
    item.test.check against the SINGLE context file named test.module —
    clean must PASS, patched must FAIL with a NAMED test (compile
    error/crash/timeout = NOT a verdict). So the diff MUST touch
    test.module, and the warm xunit project compiles ONLY
    xunit 2.9.3 / Test.Sdk 17.14.1 / runner.visualstudio 3.1.5 + implicit
    usings — NO MediatR/NSubstitute/FluentAssertions ⇒ verbatim repo files
    can never compile standalone. Follow the master2 precedent: one ADAPTED
    self-contained module (origin 'adapted', repoPath = real file) as
    test.module; extend the diff with the same defect hunk there; plain
    Assert tests named "ported from <repo test file>:<line>". netcalendy:
    rewrite CreateEventTypeHandlerTests.cs:54 (FluentAssertions → Assert)
    AND assert ResultExtensions.cs:28's substring mapping so the patched
    "EventType.SlugConflict" regresses 409→400.
  - **Harness registration**: factory/harness/harness.ts withRunner;
    runner = server/src/api/runner-csharp.ts createDrillCsRunner({appDataDir})
    with `.runner` + awaited `.shutdown()`; use a SEPARATE scratch dir
    (.cache/factory-csharp), never the validator's .cache/seed-csharp. CLIs
    to update: factory/{patches,variants,check}/cli.ts (all currently
    drill-js-only defaultHarness()).
  - **Fingerprint consequence**: factory/fingerprint.ts EXECUTING
    {variants,patches} must ADD FINGERPRINT_FILES.csharp (minus validate.ts)
    + csharp toolchain versions ⇒ ALL 16 patches packs + variants pack
    stamps stale ⇒ `seed:check -- --restamp` sweep after. Checkouts: use
    `BOOTQUEST_CHECKOUTS=C:/Users/Owner/Desktop/selfboot/.cache/checkouts`.
  - **jstrain fix path**: per-item key-correction overlay in
    tools/seed/src/jstrain/quiz.ts (routeItem/answerKey; keys come from the
    upstream answer's backtick tokens); capture real output with
    runScriptSnippet from @bootquest/server/runners/self-run/snippet. NEVER
    touch validate.ts:266-277 (ambiguous-key check — also it's
    grader-fingerprinted). Re-import kills the stamp → copy
    selfboot/.seed-journal/jstrain.jsonl into the worktree FIRST (entries
    bind to exerciseHash(unit, content, selfrun fingerprint) so unchanged
    exercises resume fast; only the 2 changed items + the audit sample
    re-execute); JSTRAIN_EXPECTED census in tools/seed/src/jstrain/cli.ts
    {total:1308, code:855, output:312, written:141} SHIFTS if items move
    categories — update per what the import prints. Full-source run writes
    the stamp; revert the re-import if the sweep can't finish.
  - **The 6 test-less C# katas**: netcalendy/slug-conflict-rename,
    netgum/download-missing-order-domain-exception,
    netslack/slug-collapse-dashes, netzen/problem-detail-raw-message,
    relay-app/swallow-duplicate-key-500, tracer-net/rate-limit-partition-raw-key.
    Kata keys survive edits (stableKey = draft name + kata id); packs must
    be REGENERATED via seed:patches from drafts (never hand-edit bytes).
- **Successor order**: (1) copy journal + checkouts/env; (2) ww6 wiring
  (smallest); (3) harness + fingerprint + CLI change → kata test upgrades →
  restamp sweep; (4) jstrain overlay + re-import + journal-resumed sweep;
  (5) gates: tools/seed suite, seed:check, test:csharp, typecheck; commit.

## 4. OPS (branch `ops-ergonomics`) — STOPPED CLEAN, ZERO CODE, FULL DESIGN RECON DONE

- **Workspace**: worktree `C:\Users\Owner\.claude\worktrees\agent-a52a14627cab55aaa`,
  branch `ops-ergonomics` @ 3795a39 (= main), tree clean, npm ci done.
- Its recon is GOLD — the successor should follow it verbatim:
  - **Fingerprint safety map (verified)**: node-test-file/index.ts is in NO
    fingerprint; new `tools/seed/src/ops/` dir is outside every set; the
    node-test-file API adapter is `server/src/api/runner-node-test-file.ts`
    (NOT fingerprinted); NEVER touch `server/src/api/runners.ts` (js+selfrun
    sets). shared/src/{check,api,sync}.ts + content/sync/check-specs.json
    are un-fingerprinted.
  - **Item 1 restamp:all**: tools/seed/src/ops/{restamp-all.ts,cli.ts,
    restamp-all.test.ts}; script `restamp:all`; sequential
    runValidate({packDir, journalPath}) per source (validate.ts rm's the
    stamp at run start; journal = interrupt-safe), one
    shutdownValidatorRunners(), then runCheck({restamp:true}); final table
    mirrors packs.ts verifyStamp for code packs, loadSeedPack(requireStamp)
    try/catch for seed packs, campaignSeederFingerprint() for campaign;
    --dry-run prints the table, executes nothing. GATE ON --dry-run ONLY
    (full run ~60 min).
  - **Item 2 hygiene tmpdir**: node-test-file/index.ts ~line 369: mkdtemp
    under per-process parent `tmpdir()/bq-ntf-${process.pid}` (mkdir
    recursive first); scope runner.test.ts workspaceDirs() (~line 49) to
    that parent (ENOENT → []); add server/scripts/sweep-ntf.mjs (+ script
    sweep:ntf) removing dead-pid dirs + age-flagged others.
  - **Item 3 smoke boot**: smoke-api.mjs ~line 250 — replace
    iteration-capped poll with wall-clock deadline +180s, 250ms sleeps
    between ALL attempts; keep the GET-ECONNRESET retry (~line 170).
  - **Item 4 U03 tscProject** (full design in its report, abridged):
    shared/src/check.ts NodeTestFileCheck += `tscProject` optional;
    api.ts PUBLIC_CHECK_FIELDS['node-test-file'] += 'tscProject' (+ public
    schema field ~line 335); sync.ts RecordedCheck += tsc_project;
    program.ts passes through. Runner: exercise gains projectFiles
    (repo-relative→content map, resolveInside, collision/missing →
    CheckIntegrityError); run repo-pinned tsc (createRequire resolve
    'typescript/package.json' → lib/tsc.js; `--typeRoots` = dirname of
    resolved @types/node since workspace lacks node_modules) with
    `-p <proj> --noEmit --pretty false`, 120s cap, BEFORE node --test;
    parse `file(line,col): error TS…` → failures named '(tsc)' (mirror
    self-run/index.ts:232 parseTscOutput). Adapter walks tsconfig extends
    chain via cache.treeFile (signalpost practice/tsconfig.json extends
    ../tsconfig.json — both verified in the checkout @ff84460); relative
    extends only, depth-capped. check-specs.json U03 += tsc_project, drop
    its uncovered_legs. UnitDetailResponse += optional uncoveredLegs
    (service.ts: for gh:…:UNN keys with deps.sync, surface from the spec
    table). Fixture: add the two tsconfigs (LF bytes, sha256+blob-sha into
    fixtures checks.json `tsc` record); composite tests: solution passes;
    solution + `const bqBad: number = "s"` fails TS2322 structured; missing
    projectFiles → CheckIntegrityError; keep tsc_project OUT of the
    fixture U03 spec so existing tests stay cheap.
  - **Gates**: server suite, tools/seed suite, typecheck, smoke (~5 min),
    restamp:all --dry-run output.

## 5. KATA-2 (branch `kata-wave-2`) — STOPPED CLEAN, ZERO KATAS, SLATE + CHECKOUTS READY

- **Workspace**: worktree `C:\Users\Owner\.claude\worktrees\agent-a38d2721e27799e9e`,
  branch `kata-wave-2` @ 3795a39, tree clean, npm ci done; 47 existing
  checkouts JUNCTIONED into its .cache/checkouts (PowerShell New-Item
  Junction from the main checkout's .cache).
- **Its sandbox gotcha**: that worktree refuses git commands TARGETING the
  mirrors; working recipe (one repo per command, run from the worktree):
  `git fetch -q "C:/Users/Owner/Desktop/claiufe/<repo>" "HEAD:refs/mirrors/<repo>"`
  then `git archive refs/mirrors/<repo> | tar -x -C ".cache/checkouts/<repo>@<sha>"`.
- **Planned 12-kata slate** (manifest-verified; successor must code-verify
  each finding at the pinned sha before authoring; ≤2/repo; no overlap with
  the 21 existing katas — checked vs katas-index.json):
  idempotent-payments-lab@7e9832ba (2 races) ·
  tenant-search-indexer@0c15ff9d (1 race "cutover loses concurrent changes"
  + 1 authz "cross-tenant run-pending") ·
  internal-case-management-system@4bbcf27b (2 authz: "client filters
  REPLACE team scope", "restricted comments leak via audit metadata") ·
  world@25b27ed2 (authz: "payslip download has no tenant check") ·
  masterrnative@d14bebbd (race "double-write dup sale on retry" + silent
  "bare catch{}") · mobiletagalog@ac003b50 (silent "adapter ignores
  rejected list = silent deletes", sync.ts) · j5@fe67601e (silent "lost
  save exits 0"). First 5 extracted into .cache/checkouts; mobiletagalog +
  j5 refs fetched but NOT extracted.
  Themes 4/4/4; target ≥8 drill-js failing-test proofs; ~4E/6M/2H.
- **Plus 2 G2 rubrics** from kata repos (existing briefs cover atlas-net,
  netslack, ww48, signalpost, tracer-net, ww6 — avoid those; format per
  docs/recon/w5c-content.md: Q1 7 weighted checkpoints, Q2 pre-mortem 5,
  Q3 handback 5, `[wN] ` weight prefixes).
- **Build path**: spec per tools/seed/authoring/katas/ww37.spec.json
  template → `node tools/seed/authoring/katas-build.mjs <repo>` → update
  katas-index.json → gates: seed:check, kata-proof.ts, tools/seed suite,
  typecheck.

## 6. ACT2-A (clone `C:\Users\Owner\Desktop\bq-act2a`, branch `act2-js-a`) — STOPPED CLEAN, ZERO PACKS, CHECKOUTS + SURVEY DONE

- Clone @ 3795a39, tree clean, npm ci done. .cache/checkouts already
  extracted (gitignored — stays in the clone) for all 10 slice repos:
  organized-build-gum@c5a2069e · recipeweb@a7d0462d · devdeck@a79dd2c8
  (shallow clone, no mirror) · jobtrack@e27d4c3d · jsdrillv2@080f06e3 ·
  master@3fa45f35 · masterrnative@d14bebbd · mobiletagalog@ac003b50 ·
  react@d0ab7017 · recipegen-app@d4fe7ecd.
- **Slice (stated)**: JS act 2 has 22 core quests, 3 packed; ACT2-A = FIRST
  10 unpacked by rank: r21 organized-build-gum, r22 recipeweb, r26 devdeck,
  r32 jobtrack, r34 jsdrillv2, r35 master, r36 masterrnative,
  r37 mobiletagalog, r42 react, r43 recipegen-app.
- **Guide survey done**: devdeck/jobtrack/react/recipeweb have plain
  astraupskill/; master/masterrnative/mobiletagalog/recipegen-app ALSO have
  snapshots/ + evidence/ (suffix-ambiguity risk — draft excludeDirs for
  astraupskill/snapshots ONLY if guides don't cite snapshot paths; test
  first); react has 08-HTTP-COMPANION.md; jsdrillv2 guides live in
  upskilling/chapters/01..11 (drafts path takes explicit guide lists);
  organized-build-gum guides in docs/upskill/ (sibling pack
  organized-build-subbox is the template: 4 selected guides, 30 items, 0
  quarantined).
- **Draft format reminder** (bootquest-quest-drafts@1): repo, sha,
  guides[], optional excludeDirs[], items[] quiz {id,kind,source{path,
  lines},cites[],prompt,answer,distractors(2-4),explanation} / flashcard
  {id,kind,source,cites[],front,back}; ≥1 cite per hand item is a hard
  requirement. ≥10 quizzes + ≥3 flashcards per repo; one explain-back set
  per repo (3×5–8, quotes = ws-normalized ≥12-char substrings), unit doc
  not used by any existing explainback pack (key = repo+unit+origin).
- **Twin caution**: jsdrillv2 is family 'jsdrill' — existing pack
  jsdrill_sync… covers README.md; keep coverage disjoint. DO NOT edit
  exclusions.json (stales every stamp estate-wide).

## 7. ACT2-B (clone `C:\Users\Owner\Desktop\bq-act2b`, branch `act2-js-b`) — STOPPED CLEAN, ZERO PACKS, SLICE COMPUTED + 3 CHECKOUTS

- Clone @ 3795a39, tree clean, npm ci DONE.
- **Slice (verified, no overlap/gap with ACT2-A)**: JS act-2's 19 unpacked
  core quests by rank are 21,22,26,32,34,35,36,37,42,43 (ACT2-A) |
  46,47,48,50,53,115,116,117,128 (ACT2-B): r46 unionboot,
  r47 eliapplybot-extension, r48 grokjs-grokbuildjs,
  r50 organized-app-job-track, r53 organized-js-training-jstrain2,
  r115 …jstrain2.2, r116 …jstrain2.3, r117 …jstrain3, r128 andie.
  PLUS C# act-2: r6 organized-dotnet-pastebin, r15 organized-dotnet-trello.
- **Checkouts done** (in bq-act2b/.cache/checkouts, gitignored):
  unionboot@02582be7 · grokjs-grokbuildjs@5256ab65 ·
  organized-app-job-track@f1153882. PARTIAL/suspect:
  .cache/repos/organized-js-training-jstrain2 (interrupted — DELETE and
  re-clone). Remaining 8 repos not started; claiufe mirrors exist for
  job-track, jstrain2/.3, jstrain3, pastebin, trello, unionboot; NOT for
  andie, grokbuildjs, eliapplybot-extension, jstrain2.2 → GitHub HEAD clone,
  ONE repo per foreground command (a 6-repo loop blew the 600s cap).
- **Corrections/friction from its recon**:
  - `gh repo clone elirc/eliapplybot-extension` FAILS — the campaign name
    may not match a real GitHub repo (claiufe has
    organized-app-eliapplybot / -python instead). Check the quest's
    provenance jsonl line for the true name; if genuinely nonexistent,
    report unavailable — never substitute.
  - andie is NOT whole-repo excluded — only **/VERIFICATION.md
    (leaked-secret). Ingest the repo; the generator reports the file skip.
  - organized-dotnet-pastebin/trello were skipped by the W5c-katas batch
    for unrecorded reasons (possibly the Goal/Check bullet bug W7 fixed) —
    do a generator dry-run before authoring.
- Recipe/gates identical to ACT2-A (§6).

## 8. VARIANTS (clone `C:\Users\Owner\Desktop\bq-variants`, branch `variants-wave`) — STOPPED CLEAN, ZERO DRAFTS, COMPLETE PER-UNIT PLAN

- Clone @ 3795a39, tree clean; 47 checkouts copied into its
  .cache/checkouts (incl. signalpost@ff84460); npm ci NOT yet run (do it
  first, foreground).
- **Its recon is a complete implementation plan — follow it**:
  - Draft shape = tools/seed/authoring/variants/signalpost-swe-bootcamp-
    u01.json: {unit, provenance{repo,sha,path,lines}, items[{id, task,
    check(DrillJsCheck: tests[{name,code}] on `mod`/`assert`),
    referenceSolution, deliberatelyWrongSolution, wrongBecause}]}.
    seed:variants takes --checkout ONLY for signalpost; G4/http-lab run
    WITHOUT it (caller-asserted pin — seed:check accepts: needsCheckout
    excludes 'variants', check.ts:100).
  - **U02**: unitKey `gh:elirc/signalpost-swe-bootcamp:U02`, provenance
    docs/curriculum/U02.md:114-118 (transfer: search fails only at the
    last item). Item: findTitles-style trimmed case-insensitive search
    (whitespace-only query → all; preserve order/input; Object.freeze
    mutation test); wrong solution loops `i < arr.length - 1`.
  - **U03**: provenance docs/curriculum/U03.md:115-119. drill-js 'ts'
    TYPE-STRIPS via esbuild — make it runtime-meaningful:
    parseBookRequest(value: unknown), trim/nonempty/≤80 title + OPTIONAL
    integer pages≥1; wrong solution checks only typeof === 'number'
    (accepts 0 / 1.5 / NaN). Note in docs: a compile-leg variant wants the
    composite tsc check (not in the variants harness).
  - **G4**: unitKey `agentic/g4-verification-engineering`; changed
    planted-bad scenario against the same wrongSolutionFilter(task, run)
    contract; wrong solution omits the named-failure leg. Provenance repo
    'selfboot' @ 3795a39, content/units/agentic.json:62-123. NOTE: authored
    units load AFTER retests in loadLadderIntoDb → the G4 retest is PENDING
    on first boot and goes live on the next load/sync re-link.
  - **http-lab**: unitKey `fixture:http-tasks-api`
    (server/test/fixtures/check-lessons.json:3-56). SeedRunnableCheck is
    drill-js|drill-cs ONLY → author as drill-js on the same concept
    (handleCreateTask(store, rawBody): malformed JSON→400, invalid
    title→400 with store unchanged, else 201 + server id + done:false);
    wrong solution inserts before validating. Document the substitution in
    SEEDING backlog.
  - **Explain-backs U02/U03**: drafts in tools/seed/authoring/explainback/,
    {questions:[{prompt, keyPoints:[{text, quote?|cite?}]}]}, 3×5–8;
    quotes = ws-normalized ≥12-char substrings of the Uxx.md (beware the
    en-dash in "1–240"). PAIRING: linking is by item provenance.path
    matching the program unit's guide ref `docs/curriculum/<code>.md`
    (sync job.ts:417) + repo `%/signalpost-swe-bootcamp` — the positional
    source arg MUST be docs/curriculum/U02.md / U03.md. Item key =
    stableKey('explainback', repo, 'explain-back', [unitPath,'draft']).
  - **KNOWN TEST FALLOUT to fix with the content**: ladder-real.test.ts
    hard-assumes exactly 1 signalpost explain-back + 1 variant (select by
    U01 title/path; retest count after sync = variantItems − pending;
    promotion leg picks the U01 variant via retestUnitKey()); smoke-api.mjs
    pre-inserts fixture:http-tasks-api BEFORE boot (line 211-212) so the
    http-lab retest is LIVE there — ladderUnitCount (line 80),
    wantUnits/wantChecks (271-272) and `counts.retests === 0` (line 616)
    need a dynamic liveRetests adjustment.
- **Gates**: tools/seed suite; seed:check (re-executes variants = filter
  re-proof); verbatim seed:variants output per draft (reference-pass +
  wrong-fail); targeted ladder-real + a TWO-BOOT serve proof (boot 1: new
  retests pending incl. G4; boot 2 after sync/reload: signalpost+G4 live,
  http-lab still pending); typecheck.
