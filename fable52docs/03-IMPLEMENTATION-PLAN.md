# 03 · Implementation plan

Work packages in the order I recommend, built from the findings in `01-UI-FINDINGS.md` (U-ids) and
`02-CONTENT-FINDINGS.md` (C-ids). Read the README's "Rules the implementer must follow" first.

## Before starting

1. Read `AGENTS.md` and `docs/SEEDING.md` §3 (on `fund-wave`, which has the Fundamentals runbook).
2. Check whether `fund-wave` is merged: `git merge-base --is-ancestor fund-wave main && echo merged`.
   - Not merged (the state on 2026-11-09): create your clone and branch **from `fund-wave`**. Your stop report
     must say that your branch contains `fund-wave`.
   - Merged: branch from `main`.
3. Suggested clone and branch: `C:\Users\Owner\Desktop\bq-fable52-ui`, branch `f52-wave1`. The `.cache`
   folder is large; the Fundamentals clone uses a junction to `selfboot/.cache` instead of a copy.
4. Start the sandbox (README) and reproduce U1, U2 and U4 so you know the baseline.

## Wave 1 · Make the learning loop work (no restamp)

Ten changes: nine are client-only, W1.6 adds one server response field.

| # | Change | Findings | Main files | Size |
|---|---|---|---|---|
| W1.1 | Turn off code ligatures | U1 | `client/src/styles/app.css` (rule at line 33; editor rules ~1233-1245) | XS |
| W1.2 | Context-aware "next step" component, used after a drill pass and after a quiz-gate pass | U4, U5 | `client/src/pages/Player.tsx:432-450`, `pages/StudyQuestPane.tsx`, new `client/src/lib/nextstep.ts` | S |
| W1.3 | Dashboard hero with one primary action; reorder panels; collapse settings and empty "Due now" | U7, U6 | `client/src/pages/Dashboard.tsx`, `components/SlateFocus.tsx`, `components/DueNow.tsx` | M |
| W1.4 | Competency table: neutral "Not started" state | U8 | `Dashboard.tsx` (~line 387) | XS |
| W1.5 | Player layout per unit kind; lesson in a reading column; hide the lesson during the quiz | U9, U2 | `Player.tsx:120-140`, `StudyQuestPane.tsx`, `app.css:1172-1174` | M |
| W1.6 | Show answers and explanations after a *passed* gate | U3 | `server/src/api/study-service.ts`, `shared/src/api-ext.ts`, `StudyQuestPane.tsx` | S |
| W1.7 | Compact Fundamentals card on the Campaign page | U10 | `client/src/pages/Fundamentals.tsx`, `pages/Campaign.tsx:96-97`, `styles/fundamentals.css` | S |
| W1.8 | One-question-at-a-time gate with keyboard; choices rendered as inline prose | U15 | `StudyQuestPane.tsx`, `client/src/lib/prose.tsx`, `lib/keys.ts` | M |
| W1.9 | Order the System design and Agentic unit lists | U14 | `client/src/lib/trackunits.ts`, `pages/TrackUnits.tsx` | S |
| W1.10 | Small fixes: streak "safe today", "Next up" grid, failed-test output, content width | U16, U19, U12, U20 | `Dashboard.tsx`, `Player.tsx`, `app.css` | S |

Notes:

- **W1.2 selection rule.** Unit key starts with `fund/<track>/` (a topic) or `fund-<track>/<topic>/` (a
  drill): load `GET /api/tracks/<track>/fundamentals` and pick the first that applies: (1) this topic's quiz
  gate, if not passed; (2) this topic's next drill that is not passed; (3) the next topic. Otherwise fall back
  to the current `nextUp` behaviour. The response shape is in `shared/src/api-ext.ts`; each topic has `unit`
  (the study unit with `state`) and `drills[]`.
- **W1.3 priority for the hero button:** reviews due (`reviewQueue.due > 0`) → first undone slate item →
  Fundamentals next step for the first enabled language track → `nextUp[0]`.
- **W1.5 and W1.8 touch the same component.** Do W1.5 first, or do both in one commit series.
- **W1.6:** first check whether `GET /units/:id/notes` already returns released explanations after an answer
  (`StudyQuestPane.tsx:46-65` suggests it does for campaign study quests). If Fundamentals topics are covered
  by it too, W1.6 is client-only.
- Keep every existing `data-testid`; the client suite relies on them.

**Gates for wave 1:** `npm run typecheck` · `npm run typecheck -w @bootquest/client` · the client suite · from
`server/`: `npx vitest run --maxWorkers=3` (W1.6 only) · `npm run smoke:api` (W1.6 only) ·
`npm run restamp:all -- --dry-run` (must report every pack fresh; this proves no fingerprinted file changed).

**Acceptance for wave 1 (in the sandbox, fresh copy of the DB):**

1. Dashboard at 1440×900: one primary button above the fold; it opens Fundamentals JS topic 01.
2. On the lesson page `===` shows as three characters, and the lesson is in one readable column.
3. "Start quiz" hides the lesson; the gate can be finished with the keyboard only.
4. After a pass, each question shows its explanation, and there are buttons for the topic's first drill and
   the next topic.
5. After passing that drill, the next link stays inside Fundamentals.
6. `/campaign/js` shows the first act within one screen; `/campaign/sysdesign` lists numbered modules first,
   in order.

## Wave 2 · Fix the Fundamentals content before it lands (content only)

| # | Change | Findings | Where | Size |
|---|---|---|---|---|
| W2.1 | Rewrite distractors so the key is not the longest choice; backtick code-valued choices | C2, U15 | `tools/seed/authoring/fundamentals/<track>/*.json` (60 files, 600 items) | M |
| W2.2 | Convert 2-3 questions per topic to predict-output or fix-the-bug | C5 | same files | M |
| W2.3 | Length-bias lint with a shrink-only baseline | C2 | `tools/seed/src/ops/answer-positions.ts` (or a new file beside it), `answer-lint-cli.ts` | S |
| W2.4 | "More practice" map: 4-8 existing drills per topic | C3 | new `content/fundamentals/related.json`, `server/src/store/fundamentals.ts`, `shared/src/api-ext.ts`, `client/src/pages/Fundamentals.tsx` | M |

Notes:

- W2.1 and W2.2 change item text and possibly item kinds. Recompile with the Fundamentals seed CLI and follow
  the runbook's census step. Count the results yourself: 20 topics per track, and whatever the new split of
  quiz versus predict-output items is; update `FUNDAMENTALS_EXPECTED` in
  `tools/seed/src/fundamentals/source.ts` to match.
- W2.2 depends on whether the Fundamentals importer accepts kinds other than four-choice quiz. Read
  `tools/seed/src/fundamentals/import.ts` first. If it does not, do W2.1 only and report W2.2 as left.
- Measure before and after with `node fable52docs/tools/quiz-bias.cjs content` and put both tables in the stop
  report. Target: at most 35% per track.

**Gates for wave 2:** `npx vitest run --root tools/seed` · `npm run seed:lint:leaks` (0 leaks) ·
`npm run seed:lint:answers` (OK) · `npm run seed:pins` · `npm run restamp:all -- --dry-run` ·
`npm run smoke:api` · server suite (the Fundamentals tests pin counts) · client suite if W2.4 is done.

## Wave 3 · Bigger features (each needs an owner decision first)

| # | Change | Findings | Restamp | Size | Decision |
|---|---|---|---|---|---|
| W3.1 | CodeMirror editor | U11, U17 | none (client) | M | D3 |
| W3.2 | Progressive hints with an XP cost | U13 | none if the DTO is in `api-ext.ts`; needs a migration | M | D4 |
| W3.3 | Acts for System design and Agentic; longer Java campaign | C7 | none expected (campaign files); verify pins | M | — |
| W3.4 | Step-by-step lessons with per-section questions | C4, U3 | depends on where the `section` tag lives | L | D8 |
| W3.5 | Capstone project per language track from chained drills | C10 | none (authoring) | M per track | — |
| W3.6 | Explain-back "read first" rule in next-up | C8 | none (`service.ts`, client) | S | — |
| W3.7 | Kata comment leak | C6 | option (c) none; option (b) restamp | S-M | D6 |
| W3.8 | New ladders: SQL, HTTP, testing, DSA, security, Git | C9 | yes if a new track id is added | L | D7 |
| W3.9 | Let the slate target Fundamentals | U6 | none (`streak.ts` is server, check fingerprint) | M | D2 |
| W3.10 | Copy pass | U18 | none | S | — |

After wave 3, the senior-level labs in `elihandoftwo/03-SENIOR-CRUD-UPSKILL-IDEAS.md` §7 are the next thing to
build. I did not re-review them.

## Owner decisions

| # | Question | My recommendation |
|---|---|---|
| D1 | Merge and push `fund-wave` now, or after wave 2 fixes its quizzes? | Merge after wave 2. Once it is on `main` the items are frozen, and 60-74% of them have the length cue. If you want to start learning today, merge now and accept that the fix becomes "add corrected items, retire nothing". |
| D2 | Should the daily slate be able to point at Fundamentals steps? | Yes. Otherwise the slate and the ladder compete for the same 30 minutes. |
| D3 | Add CodeMirror 6 as a client dependency? | Yes. It is the single biggest improvement to the daily experience. |
| D4 | What does a hint cost? | 25% of the unit's XP per hint, floor at 25%; a pass after hints still counts as verified and unassisted for the ladder only if no hint was taken. |
| D5 | bootforge quizzes: 78% length cue, upstream repo. | Fix upstream in bootforge when convenient; do not touch the imported items now. |
| D6 | Kata comment leak: which option? | (c) now (client-only collapse of removed comment lines), (b) at the next planned restamp. |
| D7 | Where do language-neutral ladders live? | A sixth track "Core", added at the next planned restamp together with D6(b). |
| D8 | Split lessons into steps? | Yes, but only after you have used wave 1 for a week; the real friction may be elsewhere. |

## Stop report

`AGENTS.md` requires one when you stop. Use its list (branch and SHAs, counts before → after, gates run with
output tails, deviations, upstream bugs, what is left), and add: the `quiz-bias.cjs` tables before and after,
and one screenshot per acceptance item of the wave you finished (`tools/cdp.mjs` can take them).
