# rv2 S3 `rv2-f` stop report (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-d`, branch **`rv2-f`**, base `700973e3` (hub `rv-wave` + S1 `rv2-k`). Nothing pushed,
`main` untouched, no `--no-verify`, no history rewrite. Every commit uses a message file and the Co-Authored-By line.
No `content/**`, no bound file, no owner DB touched.

## Commits (oldest first)
| SHA | What |
|---|---|
| `8b63328d` | task 0: due-weak test on the current dashboard; `KeyIdeasForUnit` on the Fundamentals card + open track-browser groups; EB notebook line |
| `a13d58bb` | task 1 (F4): pretest before a Fundamentals lesson + one merged explanation / learn-more panel |
| `9e05a4c7` | task 2 (F5): DESIGN IT interview mode S + dimension profile on Stats, migration 025 `eb_attempt_meta` |
| `4f46a8db` | task 3 (F7): weekly review page `/week` + `bootquest week`, migration 026 `week_reflection` |
| `b13cef35` | task 4 stretch (F9): confidence tag on graded answers + calibration panel, migration 027 `answer_confidence` |

HEAD = **`b13cef35`**. Tree clean (apart from the two stale placeholder migrations, see deviation 1).

## Counts before -> after
- Migrations 024 -> **027** (025 `eb_attempt_meta`, 026 `week_reflection`, 027 `answer_confidence`; contiguous, each
  append-only with the three triggers). Schema pins 24 -> 27 in `db.test.ts`, `packs.test.ts`, `ladder-sysdesign.test.ts`.
- Content / packs / stamps: unchanged (restamp dry-run 700/700 fresh).
- New API routes: 6 (`POST /units/:id/explain-back/interview`, `GET /stats/design-profile`, `GET /week`,
  `POST /week/reflection`, `POST /attempts/:id/confidence`, `GET /stats/calibration`). New client route `/week`.
  New CLI command `bootquest week [--start YYYY-MM-DD]`.
- New tests: server 4 files / 9 (interview 3, week 2, confidence 2, + design-side cases inside interview); client 5
  files / 20 (rv2-s3-leftovers 4, rv2-pretest 5, rv2-interview 5, rv2-week 3, rv2-confidence 3); CLI 1 file / 3.

## Acceptance (feature -> proving test)
| Feature | Acceptance | Test |
|---|---|---|
| 0a | due-weak on the current dashboard (no competency table on `/`; legs on `/stats`) | `client/src/pages/due-weak.test.tsx` (10/10) |
| 0b | the key-ideas fold on the Fundamentals card (current topic's section) and in an OPEN track-browser group only | `rv2-s3-leftovers.test.tsx` "Fundamentals card ...", "track browser: only an OPEN group ..." |
| 0c | notebook line after a missed EB key point, posts the EB attempt id; none when all covered | `rv2-s3-leftovers.test.tsx` "a missed key point offers ..." / "every key point covered" |
| F4 | pretest skippable, unscored (no write call), shows no gate item; remembered once done | `rv2-pretest.test.tsx` "offered above the lesson ...", "skippable twice over", "never a gate item ..." |
| F4 | one panel after a graded item (answer + explanation + item readings + drawer button; none in the question) | `rv2-pretest.test.tsx` "a pass shows ONE panel per question ..." |
| F5 | answer stored before any key point is shown (key 403 before; meta only after the answer; key after meta) | `server/test/interview.test.ts` "answer stored first ..."; client `rv2-interview.test.tsx` call order |
| F5 | meta writes nothing but its row; grade identical to a no-meta twin; refusals (scored, foreign, non-DESIGN IT, second) | `interview.test.ts` "answer stored first ...", "refused: ..." |
| F5 | profile reads headlines.json dimensions; a set with no headlines (or no file) still works (unclassified) | `interview.test.ts` "profile: per dimension ..."; client `rv2-interview.test.tsx` Stats cases |
| F7 | numbers equal direct SQL counts on a seeded fixture (3 weeks; outside activity ignored) | `server/test/week.test.ts` "every number equals a direct SQL count ..." |
| F7 | reflection 0 XP, append-only, newest wins, no future week, needs >= 1 answer | `week.test.ts` (same test, reflection block) |
| F7 | page renders every number, pages by week, saves; CLI prints them | `rv2-week.test.tsx` (3); `cli/test/rv2-week.test.ts` (3) |
| F9 | tag on graded submit / EB answer of record only, once, within 10 min, EB before its self-score; nothing else written | `server/test/confidence.test.ts` (2) |
| F9 | calibration per level, pending EBs apart, sure-but-failed | `confidence.test.ts`; client `rv2-confidence.test.tsx` (3) |
| Honesty | no S3 path writes evidence, a ladder leg, practice_log, XP, or unlocks a unit; none calls practice | interview / week / confidence tests (ledger counts unchanged); pretest test (no write call) |

## Gates run (targeted, `--maxWorkers=1`, foreground or backgrounded single runs, Git Bash)
```
npm run typecheck (root)                     rc=0
npm run typecheck -w @bootquest/client       only the known @codemirror/@lezer errors (codelang.ts, CodeMirrorEditor.tsx); nothing else
cli tsc                                      only S1's review command (program.ts:322 'r.tags' unknown) - pre-existing, not S3
server (final tree): confidence, interview, week, db, packs, ladder-sysdesign, stats, api/ladder, api/stats,
        api/rv-ladder, eb-weights, notebook, redo, keyideas, api/mock-contract, api/fundamentals
                                             Test Files 16 passed (16) · Tests 219 passed (219)
client (final tree) batch A: rv2-confidence, rv2-interview, rv2-pretest, rv2-s3-leftovers, rv2-week, stats, due-weak
                                             Test Files 7 passed (7) · Tests 47 passed (47)
client (final tree) batch B: ladder, eb-weights, fundamentals, lesson-aids, study, gate-closed-book, learn-more,
        gate-failpath, rv-ladder, gate-focus, App, trackunits, keyideas   Test Files 13 passed (13) · Tests 163 passed (163)
client (F4 tree): rv2-pretest, fundamentals, lesson-aids, gate-closed-book, learn-more, study   6 files / 43 passed
client (F5 tree): rv2-interview, ladder, eb-weights, stats, rv-ladder                          5 files / 78 passed
client (F7 tree): rv2-week, App, http green; api/mock.test.ts 1 FAIL pre-existing (see below)
cli: rv2-week, rv2-review, format                                                              3 files / 22 passed
seed:lint:leaks                              146 pairs, 146 baselined, 0 new, 0 stale · RESULT OK
seed:lint:answers                            0 new over the limit, 2 baselined · RESULT OK
restamp:all -- --dry-run                     700/700 fresh · RESULT OK (dry run)
bound files (git diff 700973e3..HEAD)        nothing under server/src/runners, api/runners.ts, runner-*.ts, tools/seed/src/factory,
                                             shared/src/{api,enums,check,schemas,seed-pack,thresholds,pack,campaign}.ts, or content/**
```
Leftover node processes matching `bq-f52-d`: killed (0 left).

## Deviations from the brief (please rule)
1. **Two stale migration files in this clone** (`server/src/db/migrations/020_placeholder_streamb.sql`,
   `021_placeholder_streamb.sql`, git-excluded via `.git/info/exclude`, left by stream C) made `migrate` see duplicate
   numbers, so no server test could run. I moved them (not deleted) to my scratchpad
   (`C:\Users\Owner\AppData\Local\Temp\claude\c3385c767fed3579\ab1aa697-5ee4-4bb9-858f-49a59fa4aa1f\scratchpad\stale-migrations\`).
   Nothing tracked changed. The hub does not have them.
2. **Pretest is offered, not forced.** A small "What do you already know?" card sits above the lesson with
   "Take the pretest" / "Not now"; taken, the cards replace the lesson until finished or skipped. Forcing it in place of
   the lesson would have changed the first screen of every existing Fundamentals test for topic 207 (10 files I do not
   own). One click to switch to "forced" if you want it (`pretestPhase` initial value).
3. **Merged panel placement.** The panel renders right after its question's `<fieldset>` (not inside it): the fieldset is
   disabled after a submit, which would disable the drawer button. Test ids `explain-N` and `learn-more-qN` are kept.
4. **Interview meta is filed by the client** right after `POST .../answers` and before `GET .../key` (the answer body is
   bound in `api.ts`). The server refuses it once the answer is self-scored and only for the current answer of record
   of a DESIGN IT set, so it can describe only an answer written before its grade. The elapsed time is the client's
   timer (informational: it changes no grade).
5. **Dimension reader.** S1's `store/keyideas.ts` keeps only the headline text, so `store/design-side.ts` reads the same
   `headlines.json` again (S1's `HeadlinesFile` schema, same env var `BOOTQUEST_KEYIDEAS`) and keeps `dimension` plus
   the top-level `dimensions` descriptions. The 8 dimension ids are `DESIGN_DIMENSIONS` in `api-ext.ts` (S2's list).
   A set re-seeded since the answer (hash differs) is left out of the profile.
6. **Files outside the listed set I had to touch:** `client/src/pages/TrackUnits.tsx` (the track browser renders there;
   mount only, 4 lines), `client/src/App.tsx` (the `/week` route), `server/test/packs.test.ts` (S2-owned; schema pins
   only, same as S1 did), new `server/src/api/confidence-service.ts` (F9). Week page CSS: none (existing classes only,
   no `styles/` edit).
7. **F9 scope:** the tag is on quiz gates / quick checks (`StudyQuestPane`) and explain-back answers of record
   (`LadderPanes`), not on Player drills/quizzes: `Player.tsx` is S1's file. The server endpoint accepts any graded
   submit, so a Player hook is a few lines later.
8. **F9 window:** a tag is refused more than 10 minutes after its attempt (`CONFIDENCE_WINDOW_MS`), so it cannot be added
   after the fact.
9. **F10 not done** (stretch, ruling 9): it needs clean-PR kata content (S2 C5) and a G1 scoring change in
   `ladder-service.ts`; I stopped after F9. The existing G1 pass rule is untouched.
10. Commit split: the shared `api-ext.ts` S3 section was committed per task (F5 schemas, then F7, then F9).

## Upstream / other bugs found (report items, not fixed)
- `client/src/api/mock.test.ts` "a wrong quiz submit says incorrect and carries no key" expects +2 XP for a pass after a
  failed first try; rv B R4-09 made that 0 XP. Pre-existing test drift (not run by the integrator), same family as the
  smoke:api items.
- `cli` typecheck: S1's `review` command, `program.ts:322` (`r.tags` is `unknown` in the `'tags' in r` branch).
- Stats' competency table passes an empty `dueRetestUnits` set, so its retest leg can never say "open now" there (the
  dashboard's Due-now panel says it instead). Cosmetic; flagged while fixing due-weak.
- `db` row hygiene turns any column ALIASED `verified` (and the other `BOOLEAN_COLUMNS` names) into a boolean; a
  computed `... AS verified` compares false to `=== 1`. I renamed my alias; worth knowing for later SQL.

## What is left
- F10 (kata precision + approve/block on clean PRs), after S2's clean-PR katas exist.
- Client typecheck + the full battery in the hub (this clone lacks CodeMirror). Live walk on a sandbox: Fundamentals
  pretest -> gate -> merged panel; a DESIGN IT set in interview mode -> profile on Stats; `/week` + reflection; 390 px.
- After S2's `content/design/headlines.json` merges, eyeball the profile on real data (all 70 primary sets have
  dimensions; S2 keys sets by unit key, which `kpDimension` reads second after the set key).
- Optional: hook `ConfidencePick` into Player drill / quiz submits (S1's file).
