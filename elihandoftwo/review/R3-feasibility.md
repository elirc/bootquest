# R3 · Feasibility + architecture review of 03-SENIOR-CRUD-UPSKILL-IDEAS (and 01)

Reviewer: R3 (feasibility / architecture adversary). Read-only against `main` b3815126. DB facts come from the
read-only scratch copy of the owner DB (`livedb/bq.db`, SQLite 3.49.1 under Node 22.16.0).

## Verdict

The direction is right, but L1 as written ("Ledgerly" in `content/` graded by a vitest-project runner that "exists
today") rests on two false premises. Most of what it wants is already wired in BootQuest's **signalpost program-unit
sync path**, which the report never mentions. And the ladder's real bottleneck is a missing explain-back link,
not a missing artifact.

## Blocking problems

1. **There is no vitest-project runner.** The check type has only a schema: `shared/src/check.ts:429` and
   `PublicCheck` at `shared/src/api.ts:368`. Nothing registers a runner for it: `defaultRunners` at
   `server/src/api/runners.ts:123-132` and the merge at `server/src/api/serve.ts:270-274` both leave it out. So the
   API answers `501 RUNNER_UNAVAILABLE` (`server/src/api/service.ts:368`), and the CLI refuses it as "not wired
   yet" (`cli/src/units.ts:25-34`). The Stryker gate is not a grader either. It is self-reported mutation evidence
   (`server/src/engines/ladder.ts:317-360`, README "What is NOT protected"). `evaluatePromotion`
   (`server/src/engines/evidence.ts:265-357`) never reads it, so it is not a promotion leg. Every lab in 03 §2 that
   needs a DOM or a multi-file project (L1 UI tests, L8 refactor, L9) depends on a runner that someone has to build.
2. **Retests cannot be "variant tickets".** A variant's check must be `SeedRunnableCheck = DrillJs | DrillCs |
   DrillJava` (`shared/src/seed-pack.ts:199`). `seed-pack.ts` is in the pinned SHARED input of every generator
   (`tools/seed/src/factory/fingerprint.test.ts:28`). So a vitest-project or http retest forces an **estate-wide
   restamp**. Without that, every L-lab's leg (c) has to be a drill-js substitute. The http-tasks-api variant
   already works this way (`content/seed/variants/fixture-http-tasks-api/items.json`, "a drill-js substitution").
3. **An explain-back can link to a new project unit only through a synced content_ref.** `artifactUnitsFor`
   (`server/src/store/ladder.ts:351-362`) joins `unit_ref`→`content_ref.path` to the EB's provenance path. Units
   authored in `content/units/*.json` have no such ref. G3/G4 carry none. An authored unit that pointed
   `contentRef` at a sync-only ref would throw `unknown content_ref` in `insertUnit`
   (`server/src/store/content.ts:87-88`), and then `loaded !== built` stops the boot (`ladder.ts:621`). So any lab
   that does not go through sync needs a new explicit link (artifact → explain-back set keys). That means a change to
   `server/src/store/ladder.ts`. It needs no restamp, provided the field lives in `AuthoredUnitsFile` (`ladder.ts:98`),
   which is server-local, and not in `LessonSpec` (`shared/src/schemas.ts`, fingerprinted).
4. **Explain-back competencies are hard-coded by prompt prefix** (`ladder.ts:240`): ordinary sets get
   `language-fluency`, DESIGN IT sets get `system-design + communication`, and G2 sets get
   `agentic-engineering + communication`. Each also inherits its artifact's competencies. A J-format set declares
   `communication` only when it is a DESIGN IT or G2 set, or when a new prefix family is added in `ladder.ts`. Any
   ordinary set must also be campaign-linked (`server/test/api/ladder-real.test.ts:141`).
5. **A hidden acceptance suite is honor-system only.** Private check fields are kept out of the API
   (`toPublicCheck`, `api.ts:334`; http exposes only name/method/path, `api.ts:360`). Anything under `content/` is
   still readable on disk, and the GitHub repo is public. That matches today's posture: EB key points, kata keys and
   G4's `solution` all sit in `content/`. But the README honesty model never says so, and it should. L1 adds two leaks
   of its own:
   - If the reference app lives in `content/` next to its hidden tests, copying the app copies the tests.
   - If ticket N starts from ticket N-1's solution in one git history, `git log` hands over the next solution.
   Ship each ticket's starting snapshot without history, with hidden tests and solutions in a separate directory.
   A vitest runner also cannot use the nonce channel unless it adds a main-process reporter. Without one, its
   verdict is a third documented non-nonce exception, joining node-test-file TAP and xunit TRX (README §honesty).

## Per-idea table

Restamp key: **ESTATE** = touches `shared/src/{enums,api,check,schemas,seed-pack,…}.ts` or `server/src/api/runners.ts`
(COMMON, `fingerprint.test.ts:30-49`) or a factory COMMON file. **pack** = only the new pack's own stamp.
**none** = authored units, migrations, `api-ext.ts`, `serve.ts`, store/engine code, or the client.

| idea | reuses | must change | restamp? | invariant risk | realistic effort | verdict |
|---|---|---|---|---|---|---|
| U1 dogfood + instrumentation | attempt timestamps; `api-ext.ts` (header: not fingerprinted) | a migration for a view/flag/self-rating table with append-only triggers. Derive elapsedMs on the server (first GET → submit); never take it from the client. Adding it to `SubmissionBody` (`api.ts:168`) would be ESTATE | none if new endpoints go in api-ext | low; keep it display-only, never XP | S-M | **do first** |
| U2 test-out | study-quiz check; quiz serving | campaign engine. An act unlocks only on a **verified pass** of its core quests **AND level ≥ unlock_level** (`server/src/engines/campaign.ts` header; js acts need levels 1/4/8/12/16). A 0-XP, non-done "tested out" status therefore unlocks nothing. Also needs a migration (exam table), slate/next-up changes and a client page | none (keep it out of enums/api.ts) | **high**: "nothing completes without passing its check". Make the exam its own unit whose pass is a real pass and add an explicit unlock leg, or it either cheats or does nothing | M-L (report M) | redesign before building |
| U3 senior path view | unit keys, Find palette | a new content JSON + loader + api-ext route + client page. A path entry naming a missing unit key must warn, not fail the boot | none | low | S-M | ok |
| U4 calibration | EB/kata self-score rows | a confidence row recorded **before** submit, linked server-side to the next attempt (`SubmissionBody` is strict and fingerprinted). "Self-score drift vs retest" has nearly no data: 5 variant items exist, and only 1 retest unit is live | none | low | M | defer; the drift half is data-starved |
| U5 packet export | evidence browser GETs, CLI | a CLI command | none | none | S | low value: no promotion is possible today (see corrections) |
| U6 system-design path | sysdrills drill-js; the G4 pattern (`guided-project` + `drill-js`, `content/units/agentic.json`) | DESIGN IT sets are excluded from artifact linking by design (`ladder.ts:566`). No `competency_alias` maps to system-design (mig 006:57-81). Needs authored design-lab units + the explicit link from blocking problem 3 + ladder-real pins (`ladder-real.test.ts:117,121`) | none | low if it reuses drill-js | M | ok, after the link field |
| L1 feature tickets | **sync path**: program.json → `program-unit` + node-test-file (`server/src/sync/job.ts:256-300`, `content/sync/check-specs.json`); http runner for `http-lab`; EB→artifact linking; drill-js variants | as written: a new vitest-project runner (merge it in `serve.ts`, never in runners.ts, as drill-java did, `serve.ts:266-267`), CLI delivery, a multi-file authored loader, the explicit EB link, a reference app, 12×(starter snapshot, hidden tests, solution, EB, drill-js variant). http checks have **no response capture** (`check.ts:226-258`), so ETag/If-Match, cursor follow-through and idempotency-replay comparison need deterministic-state conventions (a reset-first request) or a check.ts change (ESTATE) | none if it is runner-in-serve + authored units + drill variants. **ESTATE** if it uses vitest/http variants or new check fields | nonce: vitest needs its own reporter channel. Authored units **skip every seed validator** (wrong-solution filter, blind-pass, leak lint), so each lab needs hand tests like G4's in ladder-real | **L+** (two waves). Via signalpost U04-U07: **M** per milestone batch | build it on the signalpost route |
| L2 migration lab | drill-js SQL drills (tests open in-memory node:sqlite, `runners.ts` graderLanguage comment) | content only: the learner exports step SQL; tests run old- and new-app queries between steps. Put it in a new drill pack, or in an authored guided-project to make it leg (a) | pack / none | low | M | ok. Caveat: SQLite has no `NOT VALID`/`VALIDATE`, and adding NOT NULL means a table rebuild. 03 §0's own Postgres framing does not carry over. PGlite (used by signalpost, `package.json:49`) is a dependency option, but the drill child must be able to resolve it |
| L3 query-plan lab | drill-js + node:sqlite | content only | pack / none | **grading drift**: engines is `>=22.16.0` with no upper bound (`package.json:14-16`), so the bundled SQLite floats. EQP `detail` text has changed across versions ("SCAN TABLE t" became "SCAN t" in 3.36; bloom-filter and automatic-index lines differ). Grade on coarse regex (no `SCAN <hot table>`, `USING (COVERING )?INDEX <name>`), with no ANALYZE, plus a version floor. **The rows-touched budget is infeasible**: node:sqlite `StatementSync` has no stmt_status/scanstatus (verified: iterate/all/get/run/columns/set*) | S-M | ok without the rows budget |
| L4 race lab | drill-js (async tests are fine; G4 tests `await`) | a scheduler harness inlined into the test code | none | **soundness**: Node offers no way to "switch at every await" in arbitrary code. Interleave only at the yield points of an **injected async DB port** whose promises the scheduler resolves. node:sqlite is synchronous: a handler with no await between read and write cannot race at all. Two handlers on one connection hit a nested-BEGIN error. Separate connections with busy_timeout block the single thread, so you get deadlock until timeout. SQLite locks the whole database, so write skew and `FOR UPDATE` must be **modelled** in a fake store rather than demonstrated in SQLite | M-L; a 1-2 day design spike first | ok as a modelled-store lab; do not promise real-DB semantics |
| L5 security | drill-js inversion (the G4 shape); http checks with fixed auth headers for IDOR/mass assignment | content. A new `security` competency means COMPETENCY_IDS in `enums.ts:10` (**ESTATE**, precedent: mig 014 + full restamp) plus a migration | none on data-http; ESTATE for `security` | CSRF, stored XSS and SSRF have no browser or outbound network in a pure handler (and outbound fetch is nondeterministic) | M for IDOR/SQLi/mass-assign/path/JWT | ok on data-http; skip the new competency |
| L6 incident sim | kata answer-first flow; EB; drill-js for the alert rule | 2-3 linked units. Kata context files must be **byte-identical to an estate repo at its pin** (`tools/seed/src/factory/patches/patches.ts:8`), so synthetic telemetry must be committed to an estate repo or put in patched context | none | low | M-L | later |
| L7 PR-shaped katas | the patches generator already takes multi-file diffs (`diffTargets`, `patches.ts`); G1 | content only | none (existing generator) | katas declare only `code-reading` (`ladder.ts:256`) and are never leg (a) | S-M | **cheap, ok** |
| L8 legacy refactor | the G4 drill-js pattern: the learner exports tests; canonical code runs them against the reference + inlined planted versions | content. Stryker cannot do "kill N **planted** mutants": it generates its own mutants and its counts are self-reported | none | low | M | ok as drill-js |
| L9 frontend | — | needs the vitest-project runner + jsdom/RTL/axe resolvable from the runner. drill-js runs plain node with no DOM and no TSX | none (runner merged in serve.ts) | nonce, as in L1 | M-L | after L1's runner |
| J1 design doc / J2 ADR | the explainback generator, `[wN]` sets | content. Must be an ordinary set on a campaign repo (`ladder-real:141`, competency language-fluency) or DESIGN IT-prefixed (sysdesign track) | none | xleak vs existing EBs | S-M | ok, but it does **not** "feed communication" unless DESIGN IT-prefixed |
| J3 design-doc review | the patches generator (a diff that adds a markdown doc) | content | none | none | M | ok |
| J4 scoping | EB | content | none | none | S-M | ok |
| J5 PR description + rollback | a **repo-task with `pr-has-section`** (G3 precedent, `content/units/agentic.json`) gives a real leg (a) for communication | authored unit + link field. Leg (c) still has to be a drill-js retest, which is a poor fit for writing | none | none | S-M | the best J for the ladder |
| J6 postmortem | EB | content | none | none | S | ok |
| J7 behavioural STAR | EB flow | provenance must cite an estate file (checkProvenance). Personal career content in a **public** repo | none | **privacy** | S | anchor it to signalpost PORTFOLIO/MENTOR docs, or drop it |
| J8 interview mode | DESIGN IT sets | two-phase answer (probe before key): new endpoints in api-ext plus a start row (migration). Probe text as a new EB item field = `seed-pack.ts` = **ESTATE** (or encode probes as an alternate set) | ESTATE unless probes are alternate sets | answer-first must hold per phase | L | later |

## Cheapest high-value path (least new machinery)

1. **Sync signalpost on the owner DB** (`bootquest sync`; the path already exists). It registers U01-U03 as
   `program-unit`s with node-test-file checks (`ladder-real.test.ts:194-230`). Their EB sets and drill-js variants
   are already committed (`content/seed/explainback/signalpost-*U0{1,2,3}*`, `content/seed/variants/gh-elirc-signalpost-*`).
   A full promotion on this real content is already a test (`ladder-real.test.ts:244` "ONE FULL PROMOTION").
   Result: **language-fluency, code-reading, feature-delivery and testing-verification** become promotable with zero
   code.
2. **Close the G3/G4 dead end.** Add an explicit artifact→EB-set link to `AuthoredUnitsFile` (`ladder.ts:98`, a
   server-local schema), and author one EB set (G2-prefixed, so agentic+communication) for G4. Update ladder-real
   pins `:117`/`:121`. No restamp.
3. **Use signalpost U04-U12 as the L1 curriculum.** It already is one: U04 task API, U05 SQL, integrity and
   migrations, U06 React forms and stale results, U07 permissions and revocation, U08 review, U09 measured
   performance, U10 retry safety, U11 design under change, U12 ownership. The competency aliases already map them to
   data-http (U04, U05, U07), feature-delivery, communication (U08, U11, U12), testing-verification and code-reading
   (mig 006:57-81). Each milestone needs:
   - an upstream `practice/checks/uNN.test.*` in the owner's signalpost repo (an owner action; BootQuest never edits
     `.cache`);
   - a row in `content/sync/check-specs.json`;
   - an EB set on `docs/curriculum/UNN.md` (signalpost is a campaign repo, so `:141` holds);
   - a drill-js variant.
   Runners, schemas and fingerprints all stay as they are, and nothing restamps. Caveats:
   - U05's PGlite import must resolve inside the node-test-file workspace (check this, or use node:sqlite).
   - signalpost is a **private** repo quoted into a public one; keep quotes short.
   - Its check files are **visible** contracts, not hidden ones ("Do not change the supplied expectations", signalpost
     README:18). Accept that, since sha256 pins stop the learner editing them.
4. Then add the content-only labs on drill-js (L2, L3 without the rows budget, L7, L8), and L4 as a modelled store
   after a spike.
5. Build the vitest-project runner (merged in `serve.ts`, with a nonce reporter) only when L9 or UI tickets are next.

After steps 1-3, the only competency still without a path is system-design (U6).

## Corrections to the report

- **01 §7 W3, "6 of 8 … have no promotion path; agentic/testing have one". Wrong in both directions.**
  - *Today no competency can be promoted.* Neither G3 nor G4 has a reachable leg (b): no EB unit lists them as a
    prerequisite (live DB: 0 `unit_prerequisite` rows on project units), they carry no contentRef, and G2 sets get
    `prerequisites: []` (`ladder.ts:566`). G3 also has no variant.
  - *After one existing sync, four competencies can be promoted* (see the path above). Only data-http,
    communication, system-design and agentic-engineering stay stuck.
- **01 §7, "they can only be demoted".** All 8 ratings are 1 (live DB) and the floor is 1
  (`evidence.ts` MIN_RATING). Demotion is a no-op too.
- **01 §7, "4 more retests … wait on … the http-tasks-api fixture".** `fixture:http-tasks-api` exists only in
  `server/test/fixtures/check-lessons.json`. That variant stays pending in **every** DB by design
  (`ladder-real.test.ts:221-224`). It is dead weight, not waiting.
- **01 §3 / 03 §2, "runners that exist today (vitest-project …, the Stryker mutation gate)".** vitest-project has
  no runner (blocking problem 1). Stryker is self-reported evidence, not a grader or a leg.
- **03 L1, "a changed-example retest (a variant ticket)".** Variants are drill-only (`seed-pack.ts:199`). A ticket
  variant is ESTATE.
- **03 L1, "Ledgerly kept in content/ as a fixture project".** Explain-backs cannot cite it: provenance needs a
  pinned estate repo, and `:141` needs a campaign repo. It also cannot link to EBs without new code. A
  signalpost-style GitHub program repo gets all of this through sync.
- **03 L3 "rows-touched budget".** Not measurable through node:sqlite.
- **03 L4 "switches at every await".** Only at the yield points of an injected port. Real-SQLite transaction and
  FOR UPDATE semantics cannot be shown in one synchronous process.
- **03 L5 "new `security` competency … fingerprint check needed".** The answer is known: `enums.ts` is in every
  stamp's input, so it is an estate-wide restamp (the system-design precedent, mig 014).
- **03 J-formats "feed `communication`".** They don't unless they are DESIGN IT/G2-prefixed or a new prefix family
  is added (`ladder.ts:240`). Even then communication has no artifact. J5 as a repo-task, or signalpost
  U08/U11/U12, is the only real route.
- **03 U2 "0 XP … new status".** Under the existing campaign rule (verified-pass core % AND level gate), a 0-XP
  test-out unlocks nothing. Designing it so that it does unlock acts collides with "nothing completes without
  passing its check".
- **03 §5 "group the fingerprinted changes into one planned restamp".** Mostly unnecessary. Runner merge in
  `serve.ts`, `api-ext.ts`, authored units and server-local schemas avoid every restamp. The ideas that truly need
  one are a new competency, a new check type, new variant check types, and new EB item fields (J8 probes).
