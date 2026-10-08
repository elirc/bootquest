# R2 — Estate contract (what the seed tooling must parse)

Recon 2026-10-07, read-only: `Desktop\upskillorder`, `Desktop\claiufe` mirrors, `elirc/csbootcamp` and
`elirc/signalpost-swe-bootcamp` via `gh api`. Counts below were computed, not copied from prose.

## 0. Corrections to the spec (read first)

1. **`Desktop\jstrain2.2` does not exist.** The only local copy is the read-only mirror
   `Desktop\claiufe\jstrain2.2` (origin `https://github.com/elirc/jstrain2.2`, HEAD `1a8b3bf`).
   The adapter must read from a fresh clone/cache of elirc/jstrain2.2, never the claiufe mirror in place.
2. **Two different "csbootcamps".** `elirc/csbootcamp` (GitHub, pushed 2026-10-06) has only **4 modules /
   31 exercises** (01-language-core 10, 02-methods-and-delegates 8, 03-collections-and-linq 8, 04-strings-and-time 5).
   `jstrain2.2/csbootcamp/` has **29 modules / 147 exercises** (+13 quiz files). Same harness, different content:
   one pack *format*, two *sources*; dedupe by source, not title.
3. **"jstrain"** (JS Foundations act) is not an INDEX name — means `jstrain2.2` (rank 19) / `1jstrain2.2v2` (16).
4. **Spec act lists are not in INDEX order** (harbor 241, pulse 167, tracer 170): acts are thematic buckets;
   order quests *within* an act by INDEX rank.
5. **Java placeholder**: 5 Java `study` repos (ranks 11-14, 51); "the four" = ranks 11-14
   (`organized-experiment-cli-to-do-manager`, `-library-book-tracker`, `-quiz-engine`, `-src`).
6. **No estate markdown uses frontmatter** (zz9 0/19, j1 0/19, ww6 0/20, hnjobtrack 0/58, helios 0/206,
   jstrain2.2 0/594 start with `---`): `stable_key` is heading-hash ~100% on day one.

## 1. upskillorder campaign map

### 1.1 Files
- `START-HERE.md` (54 lines): 15-pick spine, template families, caveats. `INDEX.md`: title + blank + **749 entry
  lines, all matching one regex** (verified). `part-01/`…`part-08/`: `NNN-<repo>.md`, 100/part (part-08: 49).
- `assess/batch-N.jsonl` (+ `batch-N-notes.md`): **the structured source** the parts/INDEX were generated
  from by `rank.mjs`. `inventory.json`/`batch-N.tsv` = raw gh metadata (UTF-8 **with BOM** — strip U+FEFF first).

### 1.2 Entry formats
```
54. [part-01] **signalpost-swe-bootcamp** — d3/r5 study — Fundamentals to independent feature delivery; failing node:test labs, worked examples, agent-engineering module.
```
Parse regex (matches all 749):
`^(\d+)\. \[part-(\d\d)\] \*\*([^*]+)\*\* — d([1-5])/r([0-5]) (study|skim|skip) — (.*)$`
(the separators are U+2014 em dashes, not hyphens).

Part file (`part-01/001-csbootcamp.md`): `# 1. csbootcamp`, then bullets `**Repo:**`, `**Clone:**`,
`**Stack:** csharp-dotnet · **Kind:** exercise-pack · **Size:** 130 KB · **Last push:** …`,
`**Difficulty (junior):** 1/5 · **Upskilling richness:** 5/5 · **Verdict:** study (high confidence)`,
`**Teaching assets:** …`, then `**What it is:**` / `**What to learn here:**` paragraphs. JSONL row fields (all rows): `name, stack, size_kb, pushed, kind, upskill_richness, teaching_assets[],
difficulty, summary, study_focus, skip_or_study, confidence`. **Recommendation: seed from
`assess/*.jsonl` (dedupe by first-seen `name`, as rank.mjs does) joined to INDEX rank**, since INDEX
lacks stack/kind/confidence and the track assignment needs `stack`.

### 1.3 Taxonomy (computed)
- Verdict: **study 242 / skim 274 / skip 233** (only three values). Confidence: high/med/low
  (study 170h/72m; skim 93h/158m/23l; skip 153h/62m/18l).
- Difficulty d1-d5, richness r0-r5. Rank formula (rank.mjs): `diff*100 + (5-rich)*18 + sizeBucket*6`,
  +300 skim, +10000 skip, +5000 kind=empty, -12 for agent/mcp/llm/claude study repos.
- Parts are verdict bands: part-01 100 study; part-02 99 study/1 skim; part-03 43 study/57 skim;
  part-04,05 all skim; part-06 16 skim/84 skip; part-07,08 all skip.
- `stack`: ts-react-node 415, other 99, csharp-dotnet 90, python 70, js 61, java 14.
- `kind`: app 415, clone-study 92, misc 73, exercise-pack 63, course 38, empty 32, curriculum-docs 29, api 7.
- Study+skim by stack: ts-react-node 151+183, js 25+25, csharp-dotnet 46+20, python 10+26, java 5+7, other 5+13.

### 1.4 Mechanical parse → acts and quests
1. Load JSONL rows; attach `rank` from INDEX; drop `skip` (absent per spec).
2. Track: `js`/`ts-react-node` → JS; `csharp-dotnet` → C#; `java` → Java (locked act);
   `python`/`other` → **no track in V1** (report them as unplaced, don't silently drop — 54 non-skip repos).
3. Act assignment: the spec's named anchor repos pin acts (table below, all verified present in INDEX);
   un-anchored repos fall into the act whose difficulty band fits — suggested JS bands by `difficulty`:
   A1 d1-2 exercise-pack/course, A2 d2-3, A3 d3-4 app/course, A4 d4-5 course, A5 clone-study/curriculum-docs.
   C#: A1 d1-2, A2 d2-3 apps, A3 d3-4, A4 d4-5 + `*-net`, A5 d5/clone-study. Keep the mapping as a
   hand-reviewable JSON seed file (`content/campaign/acts.json`), generated once then edited.
4. Within an act: order by INDEX rank. `study` → quest (reading steps + quiz gate);
   `skim` → single reading-step quest (no gate, or a 1-question gate), flag `core=false` so it
   doesn't count toward the 80% unlock.
5. Template families (below): emit only the named picks as quests; non-pick members get no row.

Anchor ranks — JS: grok-js 3, finance-dashboard 7, jstrain2.2 19, jsprojectlearn 23, ship-it 44, trainjs 45,
signalpost 54, gitvg-astra 58, newcodexjs 66, lucasrouter 75, skillforgejs 77, opusorganize 143, gitjira 153,
pulse 167, relay-upskilling 168, tracer 170, harbor 241. C#: csbootcamp 1, csharp-tut 2, organized-dotnet-pastebin 6,
-trello 15, borrowbox 17, csharp-interview 18, dotnet-snapshot 27, nettrello 38, campusops 57, harbor-swe-bootcamp 59,
meterforge-upskilling 61, netcleanarch 62, nethris 63, buildsql 74, netgum 103, netzen 105, tracer-net 135, atlas 150,
meterforge 158, agora-net 207, pulse-net 226, netopen1 247 (harbor-net 316 / atlas-net 435 are skim).

### 1.5 Template-family sampling (from START-HERE + assess notes)
- **astraupskill 9-13 file course (~20: e1..e20, d1..d3, …)** → finance-dashboard, e15, e12, e20.
- **w*/ww*/z*/zz* CRUD (~60, 7-chapter fix course)** → batch-7 picks w22, ww18, ww19, ww27, ww29, ww35, ww39, ww4, ww7, zz1, zz8.
- **organized-experiment-* (~40)** → batch-5 picks support-hub, ww10, ww43, idempotent-payments-lab, lock-orchestrator-lab, temporal-lite-orchestrator, ww45.
- **newcodex3-NN-* (~25)** → umbrella `newcodex3` only; **dynamo-* (37)** never; 3build* over build*; jsdrillv2 over jsdrill*.
- Twins: canonical (`ww12`) vs `organized-experiment-ww12` snapshot — one quest, or a deliberate
  "spot the fix" pair (ww48, ww49, zz6, zz7, ww13, ww17, zz4 are named as ready pairs).
Store family membership as data (`family`, `family_pick: bool`) so the validator can assert
"≤4 picks per astraupskill family, no unpicked member seeded".

## 2. claiufe guide corpus

### 2.1 Manifest (`Desktop\claiufe\curriculum-manifest.md`, 890 lines)
10 `## Batch N` sections, each a table `| repo | status | guide | curriculum | notes |`.
775 rows: **done 562 / skipped 212 / BLOCKED 1** (jsharness). Real rows:
```
| andie | done (b83a374) | astraupskill/05-PRACTICE.md | astraupskill/ | ran suite: 43 pass (doc said 42); ... |
| 8-1-journal | skipped: no markdown docs at all | | |  |
```
Parse gotchas: file has a BOM; status variants are `done (<sha>)`, `done (<sha>+<sha>)`,
`done (no changes needed)`, `skipped: <reason>`, `BLOCKED: <prose>`; guide/curriculum cells are
**free prose**, not paths (`README.md + docs/`, `docs/ suite READMEs`, `fabledocs/ (authoritative, untouched)`,
`fabledocs/02+03-user-stories`) — treat as hints for discovery, then glob the repo.
Name join: all 749 upskillorder names exist in the manifest (case-sensitive exact match); the manifest
has 26 extras (25 `masterplan-NNN-*` + `security-cryptography-eded247b-90db662de474`).

### 2.2 Goal/**Check** exercises — two real shapes
Inline list (zz9 `docs/architecture/auth-and-permissions.md:88`) then sectioned (j1 `astraupskill/05-PRACTICE.md:51-55`):
```
3. **Goal:** close the scope override. **Check:** change `caseService.ts:96-100` so `...accessWhere` is spread last. Re-run exercise 2 from `docs/architecture/README.md`; the response must now be `{ "items": [] }`. ...
## Exercise 1: pin the guarantees you already have
**Goal:** before changing anything, prove three guarantees from the README with the real CLI. ...
**Check:** `practice/guarantees.test.mjs`. This passes on the delivered code. Keep it green through every later exercise.
```
So a Check is either prose-observable or a **named test file** (j1's files are described but are
NOT committed — "Every Check is a dependency-free node --test file" the learner writes from the
doc's harness). Extractor must handle: Goal/Check on one line, on separate paragraphs, and multiple
Checks per heading. `**Check:**` occurs 495× across 137 md files in the mirrors.

### 2.3 Senior-review findings — three real shapes
Numbered prose under `## Senior findings in the delivered code` (j1 `astraupskill/06-SOLUTIONS-AND-REVIEW.md:63`):
```
1. **A CRLF-converted snapshot is misdiagnosed as a broken legacy file.** `decode` sends any text not starting with exactly `TODOLIST1\n` to the legacy parser (`TaskRepository.java:107`). That parser splits on `\r?\n` and rejects ... (`TaskRepository.java:126`).
| F1 | Critical | `src/lib/auth/session.ts:13-22`, `src/lib/http/client.ts:7,31` | Authentication is a bare `x-user-id` header. Any caller with a user id is that user; ... |
```
(second line: F-table with severity, ww6 `astraupskill/06-SOLUTIONS-AND-REVIEW.md:22`, columns ID|Severity|Location|Finding.)
R-heading (hnjobtrack `training/_answers/review.md:116-117`): `**R21. The auth callback ignores
`exchangeCodeForSession` errors (`route.ts:28`).**` followed by bullet `- An expired magic link lands on the
dashboard logged out, with no message.`
Some findings carry provenance tags (`**[AI]**`) or "reproduced on 2026-10-06 against ..." preambles —
the honesty distinction (observed vs read-derived) must survive into the finding record.

Citation grammar the validator must accept: `path/file.ts:13`, ranges `:13-22`, comma lists
`client.ts:7,31`, multi-line lists `:56,79,91`, **bare filenames** resolved by unambiguous suffix
(`TaskRepository.java:107`, `route.ts:28`), **continuation refs** (`` `:12` ``, "line 53") that inherit
the previous file, root-relative and md-relative paths. Whitelist false positives: runtime files
(`dev.db`), `...` ellipses, files a doc explicitly marks absent (`SECURITY_FILTERED_FILES.md` repos).

### 2.4 Estate rules a seed tool MUST honor (HANDOFF-NEXT-LLM.md)
1. **Read-only sources.** Never edit study mirrors, the manifest, or upstream docs inside
   `organized-study-*`/`master*` snapshots; only user-authored trees (`fabledocs*/`, `fable docs/`,
   `docsclaude/`, `docs-codex-learning/`, `docs2-4/`, `gptdocs/`, `astraupskill/`, `docs/learning`…)
   are curriculum. Upstream project docs in those repos are **not** quest material.
2. **Respect `skipped:`** rows — do not seed them "helpfully"; `BLOCKED` (jsharness) excluded.
3. **Honesty discipline:** never present anything as executed unless executed; keep
   "author's recorded run" vs "derived from reading" distinct. No fabricated outputs/counts.
4. **Every path/file:line must resolve** at the pinned SHA (line ≤ file length).
5. **Twins:** keep canonical/snapshot consistent or diverge explicitly; canonicals may have fixes
   the snapshot lacks ("fixed here" vs "still open") — a finding is per-(repo, sha), not global.
6. **Generated trees are off-limits by hand:** signalpost `U*/M*` md, unionboot per-exercise docs,
   vg file-explanations — consume, never rewrite; beware `scripts/generate-*`.
7. **Known-stale anchors:** Skillforge1/skillforgejs (~820 pre-b9b79b5 anchors), tagalog apps/web+mobile,
   ww45/organized-experiment-ww45 `docs2/`+`docs3/` (marked unverified), AnkiJS1 (pinned to 06c8835),
   vg/vgdemo/perch/aaa1 (cite branches that don't exist in fresh clones). Validator failures here are
   expected → quarantine, don't "fix".
8. **Date bomb:** z8 tests fail by design after 2026-12-31 — any runner-verified quest from z8 must
   pin or skip.
9. **Secrets:** andie `VERIFICATION.md` contains a leaked Shopify token — never ingest that file's
   text into seeds, cards or the cache-served UI without redaction.
10. Ops: big repos (infisical ~971MB, tooljet, supabase) → `clone --depth 1 --single-branch`; default branch
    `main` except **vgslop = `master`**; REST listing stalls → batched GraphQL (15/query; gh exits 1 on
    NOT_FOUND but stdout has data); `git -C` not `cd`; `cmd /c rmdir /s /q`, never `Remove-Item -Recurse`.

## 3. jstrain2.2 import surface

Layout (mirror @ 1a8b3bf): `bootcamp/` (JS, 29 modules, **734 exercise files**), `tsbootcamp/`
(8 modules, **124 .ts**), `csbootcamp/` (29 modules, **147 .cs**, 13 quizzes), `quizzes/` (15 md + README,
**453 `### Q` items**), `jstrain/` (separate Vitest project: 24 exercise files in js/ts/react/capstone,
31 test files, `JSTRAIN_SOLUTIONS=1` env flips tests to solutions), plus cheatsheets/guides/docs
(prose, reference units only). Module layout: `NN-topic/{README.md, exercises/NN-name.js, solutions/NN-name.js}`
— identical filenames in both dirs (contract in `bootcamp/_lib/FORMAT.md`).

Exercise file = prompt + starter + tests in ONE file (`01-language-core/exercises/06-is-empty.js`):
```js
//  06 · isEmpty                                                 ★★☆ core
//  concepts: truthiness · emptiness · collections   |   run: node 06-is-empty.js
import { test, eq } from '../../_lib/check.js';
export function isEmpty(value) { throw new Error('TODO'); }
// ──────────────────────────── tests ──────────────────────────────────────
test('null and undefined are empty', () => { eq(isEmpty(null), true); ... });
```
Header grammar: `NN · name`, stars `★☆☆ warm-up | ★★☆ core | ★★★ stretch`, `concepts:` (· separated),
`run:`. Map stars→difficulty 1/2/3.

**Grader contract (differs from opusboot2):** the file *is* the test runner. `_lib/check.js` prints
✔/☐/✘ lines and finally `#done passed=N failed=N todo=N` on stdout (`process.exitCode=1` iff failed>0);
a test throwing `Error('TODO')` counts as **todo**, not fail. `verify.js` spawns `node <file>` with
`NO_COLOR=1`, 30 s timeout, parses that marker; "no marker" = crashed. Pass = `passed>0 && failed==0 && todo==0`.
**Inversion:** modules matching `/-debug|-hunts?$/` (24-debug-hunts, 25-codebase-debug-hunts,
26-security-hunts, tsbootcamp 08-debug-hunts, cs 24-26) ship exercises with *failing* tests (planted bug).
opusboot2 instead keeps tests as JSON `{name, code, input?}`, writes learner code to `solution.mjs`,
runs a generated RUNNER in a child node with `__BOOTFORGE_RESULTS__`/results.json and 8 s timeout, and
esbuild-transforms TS. **Adapter choice:** either (a) split the file at the `── tests ──` divider into
starter + test body and rewrite `import ... check.js` to a BootQuest shim, or (b) keep jstrain's model —
write learner code + the original tests back into one temp file beside a copied `_lib/check.js` and parse
`#done`. (b) is lower-risk for the import gate (tests run byte-identical); some exercises need
`fixtures/` (module 08) copied too.
TS track: `tsbootcamp/run.js` runs **tsc first** (strict flags from `_lib/tsc-config.js`, ~30 s cold,
TS pinned 5.9) then executes via Node type-stripping; exercises import `check.ts` and `type-assert.ts`
(`Expect<Equal<...>>`) — type assertions are part of the grade, so esbuild-only transpile would
silently drop checks.
C# track: `dotnet run file.cs` (file-based apps, `#:project ../../_lib/Check/Check.csproj`,
`Directory.Build.props` disables AOT/trim); `Check.Report()` prints the same `#done` marker.
Quizzes: free-recall, not multiple choice — `### Q1 — typeof zoo` / "What does this print?" + js block /
`<details><summary>Answer</summary>` / `` **`object`, `undefined`, `number`, `function`, `object`** — `typeof` reports
the internal type tag... `` / `</details>`. Key = the leading bold span; explanation = rest. To be "single-keyed" for the quiz gate, predict-output
items (`What does this print?` + code block) map to exact-match; verbal ones (10-interview-verbal) map
to explain-back/self-graded, not auto-graded. `redo.js` writes `bootcamp/redo/` (gitignored) — ignore.

## 4. csbootcamp (elirc/csbootcamp, via `gh api`, no clone)
Top level: `.gitignore FLIGHTPLAN.md README.md astraupskill/ bootcamp/ cheatsheets/ docs/ guides/ quizzes/`
(100 blobs, tree not truncated). `bootcamp/{_lib/Check/Check.cs, Check.csproj, FORMAT.md, progress.cs,
verify.cs, 01..04-*/{README.md, exercises/*.cs, solutions/*.cs}}`; `guides/crud-web-lab/`
(`CrudWebLab.csproj, HttpChecks.cs, Program.cs, TaskStore.cs` — an HTTP-check candidate);
`astraupskill/` 9-file course + `evidence/results.json`; `quizzes/01-04 + README`.
Exercise (`bootcamp/01-language-core/exercises/01-count-vowels.cs`): same header block as jstrain
(`01 · count the vowels  ★☆☆ warm-up`, `concepts:`, `run: dotnet run 01-count-vowels.cs`), then
`#:project ../../_lib/Check/Check.csproj`, `using static Bootcamp.Check;`,
`static int CountVowels(string text) => throw new NotImplementedException("TODO");`, divider,
`Test("counts lowercase vowels", () => Eq(CountVowels("hello"), 2));` ×6, `return Report();`.
`Check.cs` API: `Test(name, Action|Func<Task>)`, `Eq, Ok, Approx, Throws<T>, ThrowsAsync<T>, Sleep`,
`Report()` → `#done passed= failed= todo=`. `NotImplementedException` = todo. Note the divider glyph
differs from jstrain (`// ─── tests ───` vs `// ──── tests ────`) — split on `/^\/\/ ─+ tests ─+/`.
verify.cs contract: solutions passed>0/failed=0/todo=0; exercises failed=0/todo>0; hunts inverted.
Quiz format differs from jstrain: `**1.** question` + `<details><summary>answer</summary>` (lowercase).
Rate: all 6 `gh api` calls returned in seconds; no throttling.

## 5. signalpost program.json (the M4 schema model)
Path `docs/curriculum/program.json` (103,545 bytes; also `archive/program-v1.json`). Validated in-repo by
`scripts/check-curriculum.ts` (zod). Top level:
`{title, version: 2, weeklyHours: 15, pilotWeeks: 2, intent, phases: ["Foundations","Independent delivery","Senior practice"], milestones[12]}`.
Milestone (all 21 keys present on all 12):
`id` (1-12 int), `code` (`/^U\d{2}$/`, U01-U12), `title`, `phase`, `prerequisites` (codes; linear chain
U01←U02…), `competencies` (exactly 2, from a 24-name vocabulary e.g. "systematic debugging",
"HTTP API design", "authorization design"), `objective`, `lesson` (≥200 chars), `concepts[]` (≥3),
`example` (code string), `explanation`, `guided[]` (≥3, here 4), `transfer`, `drill`, `remediation`,
`readiness`, `resources[] {title,url}`, `targetLevel` (3|4), `learning_status: "unassessed"`,
`delivery_status: "materials_prepared"`, `tickets[4]`.
Ticket (13 keys): `id` ("U02-01"), `title`, `context`, `acceptance[]` (≥3), `mode` (SOLO|PAIR),
`step` (one of "Learn with guidance" / "Build independently" / "Transfer independently" /
"Feedback and delayed check"), `estimate` [lo,hi] hours, `competencies` (1-2), `dependencies` (ticket ids,
cross-milestone e.g. U02-01 → U01-04), `outOfScope`, `done[]` (≥3), `delivery_status: "not_started"`,
`learning_status: "unassessed"`.
Example (U02): objective "Turn an unclear failure into a small reproduction and a verified correction.";
transfer "A search fails only at the last item. Propose two different causes and an experiment separating
them before editing." — this is what `seed:variants` consumes.
Practice layout: `practice/checks/{u01.test.mjs, u02.test.mjs, u03.test.ts}` (read-only contracts),
`practice/learner/{u01.mjs,u02.mjs,u03.ts}` (starters throwing `"U01 learner implementation required"`),
`practice/sql-console.mjs` (U05 sandbox), `practice/tsconfig.json`. Commands: `node --test practice/checks/u01.test.mjs`;
u03 needs `node --import tsx --test`. **Only U01-U03 have check files**; U04-U12 have none → those units
register as study/explain-back units, not code-checked. Checks import `../learner/uNN.mjs` by relative
path, so the runner must materialize the learner file at that relative location (workspace mirrors repo layout).
Docs: `docs/curriculum/U01-U12.md` (generated; don't hand-edit), `M00-M12.md` (original program), plus
ASSESSMENT/DRILLS/MENTOR/REVIEW/PROJECTS/AGENT_ENGINEERING. Ticket policy: "Agent-prepared code earns no learning credit."

## 6. Schema consequences (M1 SQLite + seed validators)

- **`source`**: `{id, repo (owner/name, case-sensitive exact), role curriculum|reference|corpus,
  default_branch (resolved, not assumed — vgslop=master), pinned_sha, local_cache_path, origin_kind
  github|local-mirror, read_only=1}`. jstrain2.2 and both csbootcamps are distinct sources.
- **`stable_key` must**: (a) be namespaced by repo (twins and template families share identical heading
  text — `ww12` vs `organized-experiment-ww12`, 60 identical `## Exercise 1` headings); (b) disambiguate
  duplicate headings within one file (ordinal suffix); (c) cover anchors that are *not* headings — inline
  `1. **Goal:**` list items, F-table rows (`F1`), `**R21.**` bold paras — so key = hash(repo, kind,
  normalized heading-path + item label); (d) normalize CRLF/whitespace/em-dash before hashing; (e) be
  path-independent (file moves re-match) yet keep `path` in content_ref; (f) honor frontmatter `id:` when
  one ever appears. Keep a `stable_key_algo` version column.
- **Repo names** contain dots, underscores, capitals (`jstrain2.2`, `1jstrain2.2v2`, `AnkiJS1`,
  `jsdrill_sync_20260223_125137`, `Saleor`); no case-insensitive collisions today, but never lowercase or
  slug them into keys/URLs without escaping.
- **`content_ref`** = spec fields `{repo, path, sha, anchor, title, summary, stable_key}` plus:
  `line_start/line_end` (sections are cited by line), `kind` (guide|exercise|finding|quiz|program-unit|check-file),
  `provenance` (observed|read-derived|author-recorded — honesty rule), `status` (ok|quarantined|stale-anchor|
  missing-at-sha), `family`/`twin_of` (nullable). Text stays out of the DB; cache markdown per SHA on disk.
- **`campaign_act`/`quest`**: `track` (js|csharp|java), `act_no` 1-5, `index_rank`, `verdict` (study|skim),
  `confidence`, `difficulty`, `richness`, `stack`, `kind`, `core` (skim=false), `family`, `family_pick`.
  Seed validator: no `skip` repo seeded; no unpicked family member seeded; every quest repo exists in INDEX
  and in the manifest; manifest status `done` preferred, `skipped:`/`BLOCKED` repos may appear only as
  repo-link quests with no seeded quiz/finding content.
- **`unit`** must hold signalpost milestones losslessly: `code`, `phase`, `prerequisites[]` (codes),
  `competencies[]` (2), `target_level`, and a pointer to program.json via content_ref (field anchor
  `milestones[code=U02].transfer` — JSON-pointer-style anchors, not just md headings). Tickets need their own
  table or JSON column (`ticket_id`, `mode`, `step`, `estimate_lo/hi`, `dependencies[]` cross-unit,
  `acceptance[]`, `done[]`). Competency names: a `competency` vocabulary table seeded from the 24 strings.
- **`check`**: `type` must include at least `marker-run` (jstrain/csbootcamp `#done` contract, with
  `inverted: bool` for hunt modules and `todo` as a distinct non-pass state), `tsc+marker` (tsbootcamp),
  `node-test-file` (signalpost `practice/checks/*`, relative-import layout, `--import tsx` for .ts),
  `vitest-project` (jstrain/ subproject), `bootforge-json` (opusboot2), `dotnet-file`, `http`, `quiz`,
  `explain-back`. `spec` JSON carries runner argv, timeout (jstrain 30 s, opusboot2 8 s), fixtures to copy.
- **`run`** raw verdict JSON must store `{passed, failed, todo, crashed, stdout_tail}` — todo≠fail.
- **Quiz records**: `{stable_key, source content_ref, prompt_md, code_block?, answer_key (the bold lead),
  explanation_md, grading: exact|self|explain-back, format_origin jstrain-h3|csbootcamp-bold-num}`.
  "Single-keyed" validator: exactly one bold key span inside `<details>`; verbal items not auto-graded.
- **Finding records**: `{stable_key, repo, sha, label (F1|R21|1), severity? (only F-tables have it),
  title, body_ref, citations[] {path, line_start, line_end}, provenance, fixed_in_twin?}`. Validator:
  ≥1 citation; every citation resolves at sha (suffix-unique, line ≤ length; continuation refs inherit file);
  quarantine list pre-seeded with the known-stale repos in §2.4.7; redact secrets (andie).
- **Exercise records (Goal/Check)**: `{goal_md, check_md, check_kind prose|test-file|http, test_path?,
  test_committed: bool}` — j1's test files are described, not committed, so `test_committed=false` must
  not be presented as runnable.
- **Import gate counts**: assert loaded===built per pack: jstrain2.2 734 JS + 124 TS + 147 C#, csbootcamp
  31, quizzes 453 (jstrain) + csbootcamp quiz items; quarantine (never patch) any solution that fails.
