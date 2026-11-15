# rv wave: handoff for the next session (written 2026-11-13)

**Read this first if you are a new LLM session asked to "implement the remaining fixes".** It covers what was
reviewed, what was decided, what is already built (and where), what is half-built, and exactly what is left.

## 0. One-paragraph context
BootQuest is the owner's single-user, local-first upskilling app (see `AGENTS.md`, binding, and `elihandoff/README.md`).
On 2026-11-12 five Opus reviewers ran a council review of every content type and feature on branch `f52-wave`
(`dc2206bc`). The consolidated result is [`review/REVIEW.md`](review/REVIEW.md); the evidence is in the R1-R5 reports and
round-2 cross-examinations next to it. The owner then said "finish all improvements". An implementation wave (the
**rv wave**) started with parallel streams in separate clones, and on 2026-11-13 the owner said **stop**. Nothing has
been integrated: the hub branch `rv-wave` is still at `dc2206bc`. Stream branches are saved in the hub, some with
an unverified WIP commit on top.

**Headline facts the next session must not lose:**
- The content is accurate (no wrong keys found). The problems are routing, honesty holes, answer give-aways and scale.
- The owner DB (`C:\Users\Owner\bootquest\bootquest.db`, schema 18) still has **0 attempts**. Never write to it; copy
  it with `fable52docs/tools/copydb.cjs` for any live check.
- `f52-wave` and everything after it are **not on `main`**; `main` is `d83ae80f`. Landing is the owner's call. Never
  commit to `main`, never push.

## 1. Where things are
| What | Path |
|---|---|
| Consolidated review and ranked plan | `elihandoff/rv-wave/review/REVIEW.md` (copy of `selfboot/review-2026-11-12/REVIEW.md`) |
| Reviewer reports + round-2 rulings | `elihandoff/rv-wave/review/R{1..5}-*.md`, `R{1..5}-round2.md` |
| Reviewers' probe scripts and data (mutation survivor lists, classifications, screenshots) | `C:\Users\Owner\Desktop\selfboot\review-2026-11-12\work\R1..R5\` (not copied; large). Key files: `work/R2/mut-bootforge.json`, `mut-jstrain.json`, `sample-classified.txt`; `work/R3/classic-tags.json`, `kata-sweep.json`; `work/R4/shots/`, `brute.mjs`, `eb.mjs`, `hintleak.cjs` |
| Wave rules every implementer followed | `elihandoff/rv-wave/wave/COMMON.md` (paths in it point at `selfboot/review-2026-11-12/`, same files) |
| Wave plan (streams, phases) | `elihandoff/rv-wave/wave/PLAN.md` |
| Stream C stop report (the only stream that finished) | `elihandoff/rv-wave/wave/C-REPORT.md` |
| Hub clone (has real `node_modules`; run the battery here) | `C:\Users\Owner\Desktop\bq-f52-hub`, branch `rv-wave` @ `dc2206bc` |
| Stream clones (origin = hub; their `node_modules` are older and lack `@codemirror`/`@lezer`, so the client typecheck there reports those as missing) | `bq-f52-c`, `bq-f52-p`, `bq-f52-d`, `bq-f52-s` |
| Read-only review worktree (can be removed) | `C:\Users\Owner\Desktop\bq-review` (detached `dc2206bc`; `git -C selfboot worktree remove --force ../bq-review`) |

## 2. Owner decisions taken as defaults (reversible; the owner did not overrule them)
- **D3** Default slate = one language (JS) + reviews + one senior rep; other slots one setting away; one-time "pick your primary language" prompt.
- **D4** Explain-back pass = weighted ≥ 80% **and ≤ 1 `[w3]` missed** (rule in `eb-score.ts`; the 80% constant in `shared/src/thresholds.ts` is untouched, because that file is bound).
- **D5** A Fundamentals step fills a slate slot; completing the default slate grows the streak; hero, streak tile and CLI agree.
- **D6** No runtime LLM calls. Only a client "Copy prompt for Claude" button and a CLI export; any import is an advisory note, never evidence, never XP.
- **D7** Java stays on JDK 17 (only 17 is installed). No real-framework C# drills (they would restamp every C# **and** Java pack, because `server/src/runners/csharp/scratch.ts` is in both runner lists).
- **D8** Archive at unit grain via `content/archive.json`, campaign-aware, nothing deleted.
- Still open for the owner (REVIEW.md §4): the usage-gate threshold (freeze new content until ~100 graded attempts over 14 days), the freeze-at-first-attempt rule, R4-24 (per-track act gating breaks `demo:campaign`), archive scale.

## 3. Restamp rules (verified by the council; AGENTS.md still says it too broadly)
Bound, do not edit: the runner file lists in `server/src/store/grader-fingerprint.ts:56-101` (all of `server/src/runners/**`
incl. `runners/csharp/scratch.ts`), `server/src/api/runners.ts`, `runner-csharp.ts`, `runner-java.ts`,
`tools/seed/src/factory/**`, `shared/src/campaign.ts`, and the `shared/src` files in the seed import closure (at least
`api.ts`, `enums.ts`, `check.ts`, `schemas.ts`, `seed-pack.ts`, `thresholds.ts`, `pack.ts`). Toolchain versions are bound
too: a Node upgrade restamps everything. Free: engines, other services/stores, `shared/src/api-ext.ts`,
`shared/src/eb-weight.ts`, append-only migrations, client, CLI, server-local side files. A new `review_item.kind` would
touch `api.ts` (bound) and a DB CHECK: reuse the existing, never-written kind `'concept'`. Always finish with
`npm run restamp:all -- --dry-run` = 700/700 fresh.

## 4. What exists, per stream
Branches are in the hub (`git -C bq-f52-hub branch | grep rv-`). "WIP" = an unverified commit made by the orchestrator
when the owner stopped the wave. Treat WIP as a draft: read, test, fix or drop it.

### Stream C, daily loop / routing / archive: DONE (branch `rv-d`, 5 commits `ccbde0ec..d8f90d95`)
Read `wave/C-REPORT.md`. Built: finishable default day (D3/D5) with primary-language prompt (`PUT /settings/learner`,
migration `022_learner_setting.sql`); senior-rep slot rotating design / kata / fund-js 21-33; `content/paths/sysdesign.json`
(18 modules → 35 DESIGN IT sets; **keyword first cut, needs review**) and `content/paths/agentic.json`; next-up and track
browsers follow paths; C8 rule narrowed; Next up panel, Campaign Tree view and `skill_node*` tables removed; focus form →
`/settings` page; competency table → Stats; 10-minute mode; `content/archive.json` with **879 units** (target was
1,500-2,200); campaign core counting skips archived quests (acts still unlock); `content/campaign-titles.json` (336 concept
titles); CLI `today` + `serve.ts` message fixes. Targeted tests green; `restamp:all --dry-run` 700/700.
Caveats: migration 022 needs 020/021 to exist (they come from stream B); the clone had untracked placeholder 020/021 files
(excluded via `.git/info/exclude`, never committed). Deferred: R4-24, the 20-card cap inside Review.tsx, item-level cuts.

### Stream B, honesty / grading / feedback: SERVER DONE, CLIENT WIP (branch `rv-p` = 1 commit `47f12b28`; `rv-p-wip` = +`4aac37ba`)
Server commit (read its message): failed gate returns `items: []` with no Q numbers and server-computed "re-read"
sections; **retry budget 2 graded tries / 24 h → 409 NOT_DUE**; prior-key retakes; practice endpoint
`POST /units/:id/practice` (records only `practice_log`, migration `020_practice_log.sql`) and a 2-day lock on graded tries
after practice; `GET /units/:id/gate-status`; per-bank hint policy (bootforge all, csdrills/javadrills/fund-* all-but-last,
sysdrills all except formula-level hints found by text); D4 pass rule; ≥ 15 words per EB question; G1 counts patched-line
defects only (`021_kata_score_detail.sql`); `GET /units/:id/source` (repo + sha + tree url, G2 open-book); choices on miss-card
fronts; 0 XP for a pass after a failed first try; review XP once per card per day; assisted pass = half XP; `hinted` on
evidence rows. Touched outside its list: one line each in `engines/fsrs.ts`, `engines/evidence.ts`; `service.ts` run/submit only.
**WIP `4aac37ba` (client, 19 files, untested as a whole):** gate fail screen, practice toggle, `Player/WhyItWorks.tsx` fold,
kata context-file fold + marker masking in `LadderPanes.tsx`, `lib/claude-prompt.tsx` copy-prompt, blind-by-default,
G2 source link, new tests `rv-ladder.test.tsx`, `rv-player.test.tsx`. The agent was writing kata/LadderPanes tests when stopped.

### Stream A1, Fundamentals pre-landing fixes: MOSTLY DONE (branch `rv-c` = 9 commits `bfad4790..ae4ce6ff`; `rv-c-wip` = +`856f6cda`)
Done, one commit each: R1-06 SQL renumber (29-32 → 21-24); R1-03 drill test holes; R1-01 length-rank rebalance + new lint
`tools/seed/src/ops/answer-rank.ts` (+test); R1-02 fresh examples + senior JS gates 8 → 10 items; R1-14/13/11/R4-13
(version trivia, .NET 8 text, fences, lesson sentences, React 19 delta); R1-08 150 explanations rewritten; R1-09 14
`related.json` mappings dropped; T9 check-yourself cards for every topic (data only, in `sections.json`); T2 **17 JS
bug-hunt drills**. **WIP `856f6cda`:** Java bug-hunt drills, stopped **mid re-import** (`content/packs/fund-java/validation.json`
was deleted by the importer run); redo the Java import and validation from the authoring files rather than trusting it.
Not started: C# bug-hunt drills, T4 worked-example fading. `FUNDAMENTALS_EXPECTED` and pins: re-count.
Not verified by the stream: final `seed:lint:*`, `restamp --dry-run`, the stream stop report.

### Stream E1, content repairs: WIP ONLY (branch `rv-e1` = stream C's `rv-d`; `rv-e1-wip` = +`b228d853`)
WIP: sysdrills authored hint order flipped to **hint 2 = approach prose, hint 3 = formula** (so "serve all but last"
withholds the formula; compatible with B's text-based policy), formula TODO comments removed from starters, some boundary
tests added, importer gate in `tools/seed/src/sysdrills/import.ts` + its test updated (hint-2-prose rule), and
`sysdrills/06-…/04-littles-law-worker-pool` added to `archive.json` as the duplicate. Not re-imported/validated as a whole.
Check `import.ts` is outside the seed fingerprint closure before keeping it (sysdrills importer is not under `factory/`).
Not started: item-level quest cuts, FSRS card tags, DESIGN IT headline/estimate side files, "pick the model" quizzes.

### Streams not started: D (learning features), E2/E3 (new content), A2 (C#/Java senior topics)

## 5. Integration order (do this first)
Work in the hub `bq-f52-hub` on `rv-wave`. Merge with `--no-ff`, one at a time, running the targeted tests of each stream
after each merge:
1. `rv-p` (B server; brings migrations 020/021).
2. `rv-d` (C; brings 022). Conflicts expected in `server/src/api/service.ts` (B: run/submit; C: dashboard/next-up),
   `shared/src/api-ext.ts`, `client/src/api/{mock,types,http}.ts`, `Stats.tsx`, and test pins (`db.test.ts`,
   `packs.test.ts`, `ladder-sysdesign.test.ts`, `study-quests.test.ts`). Keep both sides.
3. `rv-c` (A1 committed). Check that stream C's senior-rep rotation and `content/paths/*`/`archive.json` do not name the
   renumbered JS keys (fund-js 21-32 moved; grep for `fund:js/2` and `fund:js/3`).
4. Then the WIP branches, each reviewed and finished before merging: `rv-p-wip` (B client), `rv-c-wip` (Java bug-hunts),
   `rv-e1-wip` (sysdrills; it is based on `rv-d`, so merge it after step 2).
After integration, run the full battery from AGENTS.md **one suite at a time** with `--maxWorkers=2` (about 2 GB free RAM;
Claude Code kills background jobs when memory is critical). `test:csharp` warm-run benchmark and the CLI e2e "server did
not start in 90s" failed on the untouched baseline on this machine before: they are environmental, but re-run them on a
quiet machine.

## 6. Remaining work (in priority order)
Each line names the REVIEW/finding id; details and evidence are in the reports.
1. **Finish stream B client** (`rv-p-wip`): make it pass, then live-check gate fail screen, practice toggle, WhyItWorks fold,
   kata fold, copy prompt in a sandbox (copy DB, ports 4390/5390, `fable52docs/tools/cdp.mjs`; start from the hub, not
   from a clone with junctioned `node_modules`).
2. **Finish A1**: Java bug-hunt re-import + validate; C# bug-hunt drills; T4 fading (JS 01-08) optional; final lints, census,
   pins, stop report. Fundamentals must be finished before `f52-wave`/`rv-wave` lands, since landing freezes it.
3. **Finish E1** (`rv-e1-wip` + not-started items):
   - sysdrills re-import/validate; remaining boundary tests (02/06, 16/01, 15/05, then 04/03, 12/02, 16/03, 17/03).
   - Item-level quest cuts by re-seed (R2 C1 47 finding-location, C2 15 two-choice, C8 18 jsprojectlearn, C9 6 ww6 cards,
     56 Java CLI menu/print stems, first pass of C3 ~200 literal-only keys and C4 ~120 repo-recall cards). Keep a CSV of
     dropped keys. Keys are never reused.
   - `content/seed/card-tags.json` (repo-recall flashcards not enrolled in FSRS; R2-05/M7).
   - `content/design/headlines.json` (≤ 12-word headline + dimension + repoSpecific per key point, 87 DESIGN IT sets, then
     20 G2) and `content/design/estimates.json` (one numeric envelope per set, numbers only from the set itself).
   - Review stream C's `content/paths/sysdesign.json` matching.
   - Grow `archive.json` toward D8 if the owner wants (C reached 879).
4. **Stream D, learning features** (Wave 2; none started; migrations 023-027 reserved):
   - spaced production: redo cards for passed drills/katas on kind `'concept'`, a *sibling* drill, ≤ 1/day; missed-key-point
     cards for EBs; spaced re-gates of passed Fundamentals topics (R5-04, R3-11, R1 T5, R4 N2);
   - FSRS enrol filter reading `card-tags.json` (`engines/study-quest.ts`);
   - confidence tags on graded answers + calibration panel (R5 F4, R1 T8, R4 N6);
   - error notebook (one line per miss, becomes a card; R5 F5, R4 N3);
   - weekly review page + `bootquest week` (R5 F7, R4 N9);
   - DESIGN IT interview mode S (timer, blind, framework headings) using `headlines.json`/`estimates.json`; dimension
     profile on Stats (R3 M1/M2, R5 F9);
   - placement by production / test-out (R5 F11, R4 N7, needs B's gate integrity);
   - window-based demotion that keeps banked legs, shipped with the first promotion path (R4-04);
   - concept index side file + interleaved concept sessions (R5-08, R2 M6, R4 N4);
   - merge quiz explanation and Learn-more note into one panel (R2-10/M10);
   - pretest UI: show the T9 check-yourself cards before the lesson (R1 T9, R4 N5);
   - the 20-card cap in Review.tsx for the 10-minute mode (C deferred).
5. **New content (Wave 3; none started)**. The council voted to freeze new content until the owner has used the app, but
   the owner asked for "all", so do it last:
   - agent engineering: eval lab (8 drill-js on recorded outputs), 10 agent-PR katas + 5 clean + 5 nit-only (needs kata
     precision/approve support), context-budget items, 4 G2s (injection/egress, test tampering, orchestration), 4 tool-design
     katas (R3 §4, R5 A4);
   - C#/Java senior Fundamentals topics (C# 21-27, Java 21-26; R1 §4 B/C) without real-framework drills (D7);
   - repo-native: reimplement-from-repo `repodrills` bank (40), kill-the-mutant drills (30), trace-the-request, change-impact,
     contrasting cases, postmortem/ADR review katas, failure-timeline items, doc-vs-code items (R2 §4-5, R3 M5-M7);
   - 8 classic DESIGN IT problems + 6 CRUD primaries + 17 set-Bs **only where a pinned estate source doc exists** (adding
     docs upstream is an outward action: ask the owner).
6. **Docs at the end**: replace AGENTS.md's restamp line with the §3 list; add the usage gate if the owner adopts it;
   SEEDING §8 "rv wave" bullet; a wave REPORT.md; update `elihandoff/README.md` state.

## 7. Blocked or out of scope (report, don't do)
Java 21 (JDK install = owner), real-framework C# drills (restamp bundle = owner), Java web pack (needs an owner repo),
bootforge/jstrain test gaps and bootforge 78% longest-is-key (upstream report items; survivor lists in `work/R2/`),
R4-24 per-track act gating (breaks `demo:campaign`; owner decision), Parsons problems (needs a new unit kind → restamp).

## 8. Lessons from this session (machine and process)
- About 2 GB free RAM. Three implementer agents at once was the limit; each ran only targeted test files with
  `--maxWorkers=1`. Stopped agents leave vitest processes behind: list them with
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -match 'bq-f52-' }` and kill them.
- `npm run app` refuses to start from a checkout whose `node_modules` is a junction into another clone (the fingerprint
  roots differ). Run live checks from the hub.
- Stream clones' `node_modules` predate CodeMirror: the client typecheck there reports `@codemirror`/`@lezer` missing.
  Typecheck the client in the hub.
- `migrate.ts` refuses gaps in migration numbers: merge B (020/021) before C (022).
- Git Bash for commands with flags; write scripts to files instead of `node -e` with backticks.
- `du`/recursive scans over `node_modules` or the content tree time out; avoid them.
