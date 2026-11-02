# R1 · Fact-check of 01-STATE-OF-THE-APP / 02-CONTENT-CATALOG (+ factual claims in 03)

Reviewer R1 (fact-checker), 2026-11-01, `main` b3815126. I worked read-only and counted everything myself. DB facts
come only from the scratchpad copy `livedb/bq.db` (node:sqlite, `readOnly: true`, WAL included). My query helper is
`scratchpad/r1/q.mjs`, the keyword counter is `scratchpad/r1/kw.mjs`, and the census output is `scratchpad/r1/census.json`.

## Verdict

Almost every number is right. The headline claim in 01 §7 weakness 3 is wrong in the direction that matters. In the
owner DB today, **0 of 8** competencies can be promoted, not 2. A signalpost sync would open 4 of them. The
claim that the rest "can only be demoted" is also false. The coverage map in 02 §6 undersells build content in
4–5 rows.

## Errors

### E1 (major). "6 of 8 competencies have no promotion path", which implies agentic-engineering and testing-verification have one
- **Where:** 01:100-107, repeated in 03:13-14 ("6 of 8 competencies have no project artifact") and 03:66-67.
- **What is true:** on the owner DB as it stands, **no competency has a complete three-leg chain**.
  - Leg (b) needs an explain-back answer attempt on the artifact unit itself, or on an `explain-back`-kind unit that
    lists the artifact as a `unit_prerequisite` (`server/src/engines/evidence.ts:288-305`;
    `server/src/engines/ladder.ts:68-78`).
  - `unit_prerequisite` has **0 rows** and `unit_ref` has **0 rows** (`SELECT count(*) FROM unit_prerequisite` → 0).
  - G3 and G4 have no `unit_ref`/`content_ref` (`content_ref_id` NULL). Their checks are `repo` and `drill-js`, and
    explain-back answers are only accepted on units with an `explain-back` check (`server/src/api/ladder-service.ts:390`
    `requireExplainBack`; `service.ts:432-441`).
  - EB prerequisites are derived only from project units whose `unit_ref` path equals the EB set's provenance path
    (`server/src/store/ladder.ts:351-363,566-574`). No EB pack has `repo: selfboot`, so nothing can ever link to G3 or G4.
  - G3 also has no variant, so it has no leg (c) (`content/seed/variants/`: 5 items, none for G3).
  - So G4 gives agentic-engineering and testing-verification legs (a) and (c) but never (b). G3 gives only (a).
- **Precise conditions, per competency:**

  | Competency | Today (owner DB, `sync_run` = 0) | After `bootquest sync` of `elirc/signalpost-swe-bootcamp` | Otherwise |
  |---|---|---|---|
  | language-fluency | no path | **path** via U01 (programming fundamentals, tool fluency) and U03 (typed domain modeling) | — |
  | feature-delivery | no path | **path** via U02 (problem decomposition) | — |
  | code-reading | no path | **path** via U02 (systematic debugging) | — |
  | testing-verification | no path (G4: no leg b) | **path** via U03 (behavioral testing) | — |
  | agentic-engineering | no path (G4: no leg b; G3: no legs b, c) | still none | needs an EB unit linked to G3/G4 + a G3 variant |
  | data-http | no path | still none: U04 "HTTP API design" syncs as `study` (no check) | only the test fixture `fixture:http-tasks-api` (http-lab), which never exists in the owner DB |
  | communication | no path | none | no project unit declares it |
  | system-design | no path | none | no project unit declares it (DESIGN IT = EB, sysdrills = drill) |

  - Mapping: `competency_alias` rows in the DB. Milestone competencies come from
    `.cache/checkouts/signalpost-swe-bootcamp@ff84460…/docs/curriculum/program.json`. U01-U03 become `program-unit`,
    and U04-U12 become `study` (`server/src/sync/program.ts:9-19`, `sync/job.ts:255-345`).
  - After the sync, the ladder reload links `signalpost-swe-bootcamp--docs-curriculum-U0{1,2,3}.md` as their leg (b)
    and creates the 3 retests. This is pinned by `server/test/api/ladder-real.test.ts:194-229`.
  - The sync needs GitHub access. `curriculum.yaml` registers signalpost as `role: curriculum`.
- **Evidence:** `node r1/q.mjs livedb/bq.db "select count(*) from unit_prerequisite;; select count(*) from unit_ref;; select count(*) from sync_run"` → 0, 0, 0.

### E2 (major). "They can only be demoted (lapse rule), never promoted"
- **Where:** 01:107.
- **What is true:** every rating is 1 (`competency_rating`: all 8 = 1). `lapseMayDemote` returns false at
  `rating <= MIN_RATING` (`server/src/engines/fsrs.ts:179-180`). A competency that can never be promoted stays at 1
  and **cannot be demoted either**, so the lapse rule is inert for it.

### E3 (minor). "4 more retests … wait on artifacts not yet in the DB: the http-tasks-api fixture and signalpost U01-U03"
- **Where:** 01:104-105, and 02:60 lists it as a source.
- **What is true:** `fixture:http-tasks-api` (kind `http-lab`, data-http) exists only in
  `server/test/fixtures/check-lessons.json`, which is loaded by tests and `smoke-api.mjs`. It will never arrive in
  the owner DB. `ladder-real.test.ts:118,215,220` says "fixture:* artifacts never exist here … the http-lab variant
  stays pending". Only the 3 signalpost retests are waiting on something real (a sync).

### E4. "Written (147): BootForge model-answer exercises"
- **Where:** 02:61.
- **What is true:** only **6** are BootForge (`bootforge/engineering-practice`). **141** are jstrain quiz-set written
  items: quiz-10-interview-verbal 24, quiz-13-sql 30, quiz-11-typescript 28, quiz-12 14, quiz-09 11, and others.
- **Evidence:** `select substr(key,1,instr(key,'/')-1), count(*) from unit where kind='written' group by 1` → bootforge 6, jstrain 141.

### E5. jstrain "≈49 courses/files"
- **Where:** 02:10 and 02:25.
- **What is true:** exactly **50** modules: 27 numbered, 8 `ts-*` and 15 `quiz-*` (`content/packs/jstrain/manifest.json` `courses.length`).

### E6. Coverage map rows that say "estimate + explain" when build drills exist
- **Where:** 02:74-77, 02:88 and 02:91.
- **Data modeling & schema evolution (02:74):** there are build drills. jstrain 19 "A migration runner"; jstrain 27
  "Model it — orders, items, refunds" and "Schema migrations, applied once". bootforge fullstack-crud "The migration
  runner", "Lint the migration list", "Plan a partial migration", "Flag destructive DDL". bootforge
  engineering-practice "Apply a migration and its ledger atomically" and "Backfill normalized emails without losing
  customer data". bootforge sql-data "FOREIGN KEY", "a fully-guarded inventory schema". Mode should read "build
  (small) + estimate + explain". The ○ rating is defensible.
- **Transactions & concurrency (02:75):** there are build drills. bootforge fullstack-crud "withTransaction helper",
  "Optimistic concurrency". jstrain 19 "Transactions: all or nothing". jstrain 27 "All or nothing — transactions",
  "UPSERT". javabootcamp 13-storage-and-consistency (8, incl. "Versioned writes", "Snapshot reads").
  javabootcamp 17-deterministic-concurrency (8, incl. "Lost updates, replayed"). csdrills 09-thread-safety (9).
  Mode should include build. Rating ○→● is arguable.
- **AuthN/AuthZ (02:76):** the mode is listed as "estimate + explain", but bootforge fullstack-crud has ~12 token,
  hash and session build drills ("Salted hash", "Mint a token", "Refresh window"). express-api has "Challenge:
  ownership guard" and "Attribute-based guard", and jstrain 26 has IDOR/CSRF hunts.
- **Accessibility, i18n, forms UX = "—" absent (02:91):** wrong for forms and for accessibility.
  - Forms: bootforge react-fundamentals "requiredError", "emailError", "Fieldset", "makeLabeledInput"; react-ts
    "makeFormState", "Form helper: firstErrorField"; react-state "selectCanSubmit". That is ~40 form-validation items
    (`r1/kw.mjs` "form…validat|error").
  - Accessibility: 52 items mention it (bootforge react 7, engineering-practice 4, quest packs 19, notes 15, EBs 5).
    Accessibility is thin (○), not absent.
  - i18n is essentially absent (14 incidental mentions).
- **Building a full feature end to end (02:88):** this row cites "1 guided-project, 1 repo-task", but neither is a
  CRUD feature. G4 rebuilds a wrong-solution filter and G3 is an agent-delegation PR. The row omits bootforge
  engineering-practice "Build a multi-organization issue tracker" and "Build an inventory and order console that
  survives retries" (self-assessed `written` project briefs).
- **Observability & incidents (02:84) and Code review (02:81):** both omit bootforge engineering-practice. That
  course has 2 written incident investigations ("migration that fails differently on retry", "duplicate customers
  after an import retry") and 2 written PR reviews. Code review also omits jstrain quiz-09-spot-the-bug (24).

### E7 (minor). Quest packs by language and campaign steps
- **Where:** 02:38-39 and 02:41-42 (and 01:30).
- **Language split:** "js/ts 143, cs 44, java 12, docs 4, py 1" is the census tool's cheap language guess. By the
  app's own tracks it is **js 144** (143 campaign + standalone `ladder/study/ww6`), **csharp 48** and **java 12**.
  The C# campaign has 48 study quests, all with packs.
- **Campaign steps:** JS's 259 steps include **3 content-pending study steps with no pack and no check**: Opusboot1,
  perch and skillforgejs (`quest.content_pending = 1`). So 207 study units = 203 campaign packs + ww6 + 3 placeholders.

## Unverifiable or misleading claims

- **Gate numbers** (01:76-77, server 705 + selfrun 20 … test:java 23): not re-run by me. They match
  `elihandoff/ab-wave/STATUS.md:146-148` and `docs/SEEDING.md:1790-1793`.
  - I independently confirmed 697 stamped manifests (8 packs + 244 + 204 + 31 + 204 + 5 + 1 campaign), consistent
    with restamp 697/697, and the xleak baseline of 146 (`tools/seed/src/ops/xleak-baseline.json`).
- **"most of them language fundamentals"** (01:97-98): this is debatable. Of bootforge's 1,823 drills, the
  node/http/express/sql/react/fullstack courses hold 1,007 code drills, against 818 in the 7 language courses. The
  claim holds for jstrain (855) and the bootcamps. "3,826 units declare language-fluency" is the better-grounded statement.
- **"Every study quest declares only code-reading"** (01:110): this is 204 of 207 study units. The 3 placeholders
  declare nothing.
- **01 §3 drill row** (01:43): it lists drill-js/cs/java, but **855 of 3,239 drills are `self-run`** (jstrain). The
  check-type split is drill-js 1,952 · self-run 855 · drill-java 248 · drill-cs 184. `self-run` is named only in
  "Other runners".
- **01 §1 rule 4** (01:16): the text says "~217 pinned checkouts … are the source material". README rule 4 actually
  says "GitHub sync followed by a re-seed session is a first-class, repeatable workflow". The 217 is right
  (`ls .cache/checkouts | wc -l`). The quote is a paraphrase.
- **01 W1** (01:95): this is correct but should add that the owner DB has **never been synced** (`sync_run` = 0). That
  is why the signalpost artifacts are absent, and it is directly relevant to E1.
- **03 overlaps not acknowledged** (03 is ideas, but the "Nothing here is built" framing invites duplication):
  - L1.2 (cursor pagination) overlaps bootforge fullstack-crud "Opaque cursor", "Keyset page" and jstrain 27
    "keyset vs offset".
  - L1.3 (optimistic concurrency) overlaps fullstack-crud "Optimistic concurrency".
  - L5 (security) overlaps jstrain 26-security-hunts, which already covers SQLi, stored XSS, path traversal, IDOR,
    guessable reset tokens, mass assignment ("profile update that grants admin"), open redirect, ReDoS, password
    logging and CSRF as fix-the-bug drills.
  - J7 overlaps jstrain quiz-10-interview-verbal (24 written, e.g. "walk me through a bug you fixed").
- **03 L1 design gotcha (missing):** a new lab is a ladder leg only if an `explain-back`-kind unit lists it as a
  prerequisite. The loader derives that only from a `unit_ref` whose path equals the EB set's provenance path
  (`store/ladder.ts:351`). G3 and G4 show what happens when this is skipped: they are authored with no ref, so they
  have no leg (b). L1 must plan the unit_ref/EB wiring, or a loader change (fingerprinted `server/src`).
- **03:125-126** "communication … 135 units": confirmed (107 EB + 28 written).

## Confirmed claims (counted)

- **Units:** 5,076 live, 0 retired. By track: js 4,231 · csharp 282 · java 272 · sysdesign 216 · agentic 75. By
  kind: drill 3,239 · quiz 544 · predict-output 508 · explain-back 244 · study 207 · written 147 · reading 132 ·
  patch-kata 52 · retest/repo-task/guided-project 1/1/1.
- **Track composition:**
  - bootforge 2,569 (1,823 + 196 + 544 + 6), 16 courses with the names listed.
  - jstrain 1,308 (855 + 312 + 141).
  - csharp drills 184 = csdrills 72 + jstrain-cs 81 + csbootcamp 31.
  - java 168 + 80.
  - sysdesign 129 + 87.
  - agentic 20 + 52 + 2 + 1.
- **API:** 44 routes = 29 GET / 14 POST / 1 PUT (`grep -rhoE "router\.(get|post|put|…)\(" server/src`).
- **Migrations:** 18 (001-018, both on disk and in `schema_version`).
- **Competencies:** 8 ids and order as listed. Declarations: language-fluency 3,826, data-http 826, communication 135.
- **Campaign:**
  - JS 24 + 41 + 74 + 69 + 51 = 259 (acts Foundations / Building / Products & teams / Flagship courses / Mastery).
  - C# 6 + 5 + 23 + 23 + 10 = 67.
  - Java 4 + 4 + 4 = 12 (Foundations / Money & validation / Domain rules & consistency).
- **Drill banks:** csdrills 10/72, javadrills 11/80, sysdrills 18/129, csbootcamp 4/31, jstrain-cs 19/81,
  javabootcamp 21/168. Module topics match.
- **Packs:** quest packs 204, notes 204, depth buckets 27/48/122/7.
- **Explain-backs:** 244 over 162 repos = classic 132 + 5 B, G2 20 (cs 6 / js-ts 13 / java 1), DESIGN IT 50 + 33 + 4
  = 87 over 39 repos. 17 primaries have no alternate. 136 weighted sets. 81 DESIGN IT sets carry "70%". 57 `[senior]` prompts.
- **Repos:** 217 checkouts; 55 with no EB (43/12).
- **Katas and variants:** 31 kata specs / 52 kata units; 5 variants.
- **Project units:** exactly 2 (G3 repo-task: agentic-engineering; G4 guided-project: agentic-engineering +
  testing-verification) + 1 live G4 retest.
- **Owner DB usage:** 0 attempts / 0 XP / 0 review items / 0 evidence.
- **Slate and streak:** slate tracks js/csharp/java/sysdesign (`track.slate_drills`); slate size 1-10, presets
  default/full; partial-day 20 XP; review queue limit 200.
- **Ladder rules:** lapse demotion capped at 1 per competency per day; G1 gate 0.8 / ≥ 10 defects; promotion floor 0.8.
- **CLI:** 8 commands as listed.
- **UI:** routes / campaign / play / review / stats. Stats panels: tiles, weak spots, XP over time, pass rates,
  reviews, campaign progress, catch rate G1, evidence browser.
- **Append-only triggers:** on attempt, run, evidence, xp_event, review_log (also eb_score_detail, slate_setting).
- **Serve and dev guards:** backup before serve, busy-port pre-check, Vite `fs.deny` for content/.cache.
- **Owner items:** match SEEDING.md:1794-1798.
- **Coverage rows checked and found fair:**
  - Web security is thin as build: jstrain 26 has 10 units. The map should note it is also present in the quiz
    layer: IDOR 66, CSRF 21 and XSS 21 items, mostly quest packs and notes.
  - Testing is thin: jstrain 20 (16), 29 (4), jstrain-cs 21 (3), 29 (5), engineering-practice 2, G4. testing-verification is declared by only 24 units.
  - Estimation of product work is absent: 3 incidental hits.
  - Leading/mentoring is absent: 1 incidental hit.
  - Debugging rows match jstrain 24, jstrain-cs 24, javabootcamp 19/21.

## Suggested corrections (exact text)

1. **01:100-107** — replace the paragraph from "3. **The truth layer has almost nothing to promote on.**" with:
   > 3. **The truth layer cannot promote anything today.** Leg (a) needs a project-kind unit (`PROJECT_UNIT_KINDS` =
   > guided-project, http-lab, repo-task, program-unit). The owner DB holds exactly two, both agentic:
   > `agentic/g3-live-delegation` (repo-task; agentic-engineering) and `agentic/g4-verification-engineering`
   > (guided-project; agentic-engineering + testing-verification), plus one live retest for G4. Neither has a linked
   > explain-back. Leg (b) needs an explain-back unit that lists the artifact as a prerequisite, and the DB has 0
   > `unit_prerequisite` rows. G3 has no variant, so it also has no retest. So **0 of 8 competencies can be promoted
   > on the owner DB today.** One `bootquest sync` of `elirc/signalpost-swe-bootcamp` (never run: `sync_run` = 0)
   > would add U01-U03 as program units, link their 3 explain-back sets and create their 3 retests. That opens
   > language-fluency, feature-delivery, code-reading and testing-verification. agentic-engineering, data-http,
   > communication and system-design would still have no path. The http-tasks-api variant targets a test fixture
   > that never exists in the owner DB. Ratings all sit at the floor (1), so the lapse rule cannot demote them either.
2. **02:61** — replace with "**Written** (147): self-assessed model-answer exercises. 141 come from jstrain quiz sets
   (interview-verbal, SQL, TypeScript, spot-the-bug, …) and 6 from bootforge engineering-practice (PR reviews,
   incident investigations, 2 project briefs)."
3. **02:10 and 02:25** — replace "≈49 courses" / "≈49 files" with "50 modules (27 core, 8 TypeScript, 15 quiz sets)".
4. **02:60** — replace with "**Variants**: 5 (changed-example retest sources: agentic G4 (live); signalpost U01-U03
   (pending until a signalpost sync); the http-tasks-api test fixture (never live in the owner DB))."
5. **02:38-39** — replace the language split with "by track: js 144 (143 campaign + standalone ww6), csharp 48, java 12".
   Add to 02:41: "JS's 259 steps include 3 content-pending placeholders (Opusboot1, perch, skillforgejs) with no pack."
6. **02 §6 rows:**
   - Data modeling → "○ | build (small) + estimate + explain | jstrain 19/27 migrations + modeling, bootforge
     fullstack-crud migration drills, engineering-practice migrations, sysdrills 16, DESIGN IT zero-downtime".
   - Transactions & concurrency → "○ | build (small) + estimate + explain | bootforge fullstack-crud
     withTransaction/optimistic concurrency, jstrain 19/27, javabootcamp 13/17, csdrills 09, sysdrills 16, DESIGN
     IT; sysdrills 19 planned".
   - AuthN/AuthZ → mode "build (small) + estimate + explain", where += "bootforge fullstack-crud tokens, express-api guards, jstrain 26".
   - Accessibility/i18n/forms → split into "Forms UX & validation | ● | build (small) | bootforge react-fundamentals,
     react-ts, react-state" and "Accessibility, i18n | ○ / — | read | a11y in a few react drills + quest quizzes; i18n absent".
   - Full feature → where "bootforge fullstack-crud; engineering-practice 2 self-assessed project briefs (G3/G4 are agentic, not CRUD features)".
   - Observability & incidents → where += "engineering-practice 2 incident write-ups".
   - Code review → where += "engineering-practice 2 PR reviews, jstrain quiz-09 spot-the-bug".
   - Web security → where += "quiz layer (IDOR 66, CSRF 21, XSS 21 items), sysdrills 18".
7. **01:43** — append "(855 jstrain drills grade via `self-run`: learner head + the shipped tests)".
8. **03:13-14** — replace "(01 §7: 6 of 8 competencies have no project artifact, so they can never be promoted)"
   with "(01 §7: no competency can be promoted on the owner DB today; a signalpost sync opens 4, and the other 4 have
   no project artifact at all)".
9. **03:67** — replace "This alone gives 3 stuck competencies a real promotion path." with "This gives data-http its
   first path and a second, CRUD-shaped path to feature-delivery and testing-verification. Each lab must ship with a
   linked explain-back unit (unit_ref path = EB provenance path, `store/ladder.ts:351`) and a variant, or it repeats
   G3/G4's missing leg (b)."
10. **03:110** — replace "Fills the 'accessibility, forms UX' gap in 02 §6." with "Deepens forms UX (present as small
    drills) and fills the accessibility gap (thin)." Add to L5: "Builds on jstrain 26-security-hunts (10 fix-the-bug
    drills over most of these classes); the new part is exploit-first on a multi-file app."
