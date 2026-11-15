# rv2 S1 `rv2-k` stop report (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-p`, branch **`rv2-k`**, base `499a4496` (integrated `rv-wave`). Nothing pushed,
`main` untouched, no `--no-verify`, no history rewrite. Every commit uses a message file and the Co-Authored-By line.

## Commits (oldest first)
| SHA | What |
|---|---|
| `50613472` | 0b: hints tie withholds the last hint (+ test) |
| `91a32e07` | 0a: smoke-api pins rv B/C behaviour; xp.ts repeat pass = already-awarded (+ rv2-xp-repeat.test) |
| `47700ff1` | task 1: store/keyideas.ts reader + fixtures + keyideas-store.test |
| `5b6452c5` | tasks 2-6 server: engines/keyideas.ts, engines/redo.ts, api/keyideas-service.ts, api/notebook-service.ts, review-cards reconcile, app.ts hooks/routes, ladder-service enrol hook, study-quest F3 filter, migrations 023/024, api-ext section, schema pins, 5 test files |
| `da15bf24` | task 3 CLI: `bootquest review [--keyideas] [--tag]` (+ cli/test/rv2-review.test) |
| `52e83999` | test typing fix (root typecheck) |
| `e1f3ab7b` | tasks 3-6 client: Review modes + F8 cap, SectionRecap, KeyIdeas page/fold/tile, RedoBar, NotebookLine, api types/http/mock, keyideas.test.tsx |

HEAD = **`e1f3ab7b`**. Tree clean.

## Counts before -> after
- Migrations 022 -> **024** (023 `keyidea_checkpoint`, 024 `error_note`; both append-only with the three triggers).
  Schema pins 22 -> 24 in `db.test.ts`, `packs.test.ts`, `ladder-sysdesign.test.ts`.
- Content: none (no `content/**` touched). Packs / stamps unchanged: restamp dry-run below.
- New API routes: 11 (`/keyideas`, `/keyideas/queue`, `/keyideas/cards/:id`, `/keyideas/recap/:section` GET+POST,
  `/keyideas/sections/:section/reveal`, `/keyideas/recheck/:id` GET+POST, `/redo/:id/run`, `/notebook` GET+POST).
- New tests: server 7 files / 25 (keyideas-store 5, keyideas 6, keyideas-recap 3, keyideas-session 2, redo 5, notebook 2, rv2-xp-repeat 2) + 1 in api/hints; CLI 1 file / 2; client 1 file / 9.

## 0a smoke-api + `already-awarded`
- `server/scripts/smoke-api.mjs`: the 11 stale assertions now pin the intended behaviour (R4-09 0-XP pass after a
  failed first try, XP totals `XP0 = 1`; C D3 default slate: no campaign / drill:java / drill:sysdesign slot, sysdesign
  slate-capable and off in `/settings/slate`; R4-07 answers >= 15 words; R3-04 G1 counts patched-line defects;
  R4-01 a failed notes gate releases nothing). The 180 s boot deadline in the committed script is unchanged.
- Found: the `null` reason came from **`47f12b28`** (rv B R4-09). The `already-awarded` check reads
  `amount > 0`; after a 0-XP first-try-missed pass a repeat pass fell into the first-try-missed branch. B's comment
  covers only the first 0-XP pass, so it was not an explicit decision. Per the ruling, `engines/xp.ts` now returns
  `already-awarded` for the repeat pass (the first one keeps reason null + note). Test `server/test/rv2-xp-repeat.test.ts`.
- Smoke run: run ONCE with a scratch copy whose only change was the boot deadline (180 s -> 900 s; deleted after, the committed script keeps 180 s). It booted, and **all 57 steps that ran PASSED, 0 FAIL**, including 10 of the 11 updated assertions (first-try 0 XP, `already-awarded` again, xp totals 1/22/42/52, no campaign / drill:java / drill:sysdesign slot, real EB >= 15 words, real kata patched-line G1). Then the script **crashed** right after the "reset guards" step: `fetch failed ... write ECONNABORTED` on the next `GET /api/dashboard` (the main server's socket was aborted under 100% CPU; earlier dashboard GETs on the same server passed, and no step had failed). The notes-gate assertion (R4-01) and the steps after it were not reached. **Re-run on a quiet machine in the hub.**

## 0b hints tie
`engines/hints.ts`: on a tied formula score the LAST tied hint is withheld. Audit over the 129 sysdrills: 128 withhold
exactly hint 3; `02-caching-and-pools/01-effective-latency` withholds 1 and 3 (its hint 1 is a formula: S2's item).
`16-data-access-and-integrity/01-soft-delete-unique` now serves hints 1 and 2 (test in `server/test/api/hints.test.ts`).

## Acceptance (feature -> test)
| Feature | Acceptance | Test |
|---|---|---|
| F1 | passing a source unit enrols exactly one card, due +1 d (multi-source idea: after its last source) | `server/test/keyideas.test.ts` "passing a single-source idea's source ..." |
| F1 | <= 4 new key-idea cards due per day (flood: 10 passes in one day -> 4/4/2) | `keyideas.test.ts` "at most 4 new key-idea cards ..." |
| F1 | a removed idea retires its card (startup reconcile), returning restores; retired = not served, grade refused | `keyideas.test.ts` "a removed idea retires its card ..." |
| F1 | recap pays 20 XP once (replays 409, nothing paid twice), one checkpoint row, partly/missed re-enrolled tomorrow | `server/test/keyideas-recap.test.ts` "answer-first, 20 XP once ..." |
| F1 | recap / cards write no evidence row and no practice_log row; ruling 6: no practice lock from any reinforcement path | `keyideas.test.ts` "ruling 6 + honesty ...", `keyideas-recap.test.ts`, `redo.test.ts` (redo run ledger unchanged) |
| F1 | unknown key warns once and the server serves; no content/keyideas/ = nothing breaks | `keyideas.test.ts` "an unknown key warns once ...", `keyideas-store.test.ts` |
| F1 | the API omits prompt / answer / why until the idea's sources are passed | `keyideas.test.ts` "GET /keyideas: prompt, answer and why are absent ..." |
| F1 | 14/45-day re-check appears once, graded by its prompts, then never due again | `keyideas-recap.test.ts` "the 14-day re-check ..." |
| S1.3 | no two neighbours share a section when >= 2 sections are due; cap 12 / limit 5; tag filter | `server/test/keyideas-session.test.ts`, client `keyideas.test.tsx` "serves the interleaved ..." |
| F2 | at most 1 redo/day (three earned on one day come out on three days) | `server/test/redo.test.ts` "three redo cards earned on one day ..." |
| F2 | a redo run writes no attempt / run / evidence / practice_log, no XP beyond the card's review XP; bare grade refused | `redo.test.ts` "a redo run grades only the card ..." |
| F2 | max 3 ebmiss cards per attempt, [w3] first, front = headline never the key point | `redo.test.ts` "<= 3 per attempt, [w3] first ..." |
| F2 | grading a retired card is refused | `redo.test.ts` "a key point re-seeded away retires its card ...", `keyideas.test.ts` |
| F3 | a tagged card is never enrolled; existing rows untouched | `redo.test.ts` "F3: a repo-recall flashcard ..." |
| F6 | optional, never blocks; 0 XP; card front = the learner's own line | `server/test/notebook.test.ts` (2), client `keyideas.test.tsx` "a failed submit offers the optional notebook line" |
| F8 | the 20-card cap holds across paging (pages of 10, 30 due -> stops after card 20) | client `keyideas.test.tsx` "pages of 10 with 30 due ..." |

## Gates run (targeted, `--maxWorkers=1`, foreground, Git Bash)
```
npm run typecheck (root)                      rc=0 (after the test-typing fix)
npm run typecheck -w @bootquest/client        no error outside @codemirror/@lezer (the one-character Player regex fix after it is not re-typechecked)
server  keyideas-store 5, keyideas 6, keyideas-recap 3, keyideas-session 2, redo 5, notebook 2, rv2-xp-repeat 2   all green
server  api/hints 16, db 43 + ladder-sysdesign 5 (48), fsrs + streak + study-quest-revive + api/study-quests + api/ladder + api/rv-ladder (124),
        api/api + packs + eb-weights + api/rv-gates + api/notes (106), xp-level + rv-gates + rv2-xp-repeat (31), clock-discipline 4   all green
cli     rv2-review 2                                                                                                         green
client  keyideas 9 + dashboard + player: 3 files, 62 tests                                                                  green
client  keyideas + review-paging + due-weak + rv-dashboard: 28 passed, 2 failed (due-weak "Due now": getByRole('table') on '/';
        the dashboard has no table since rv C moved the competency table to Stats (R4-20); my tile renders nothing on the mock.
        Pre-existing, not run by the integrator; please confirm in the hub)
client  App.test.tsx: not completed (killed by my 170 s timeout under load); the hub battery runs it
restamp:all -- --dry-run                      700/700 fresh · RESULT OK (dry run: table reflects the CURRENT stamps; nothing was executed)
bound files (git diff 499a4496..HEAD)         nothing under server/src/runners, api/runners.ts, runner-*.ts, tools/seed/src/factory, the bound shared/src files, or content/**
smoke:api                                     see 0a: 57/57 run steps PASS, then ECONNABORTED crash under load (re-run needed)
```
Leftover node processes matching bq-f52-p: killed (0 left).

## Deviations from the brief (please rule)
1. **Met = ALL live sources passed**, not "a source passed". An idea's answer may restate the keyed answer of any of
   its sources (PLAN xleak rule), so showing it after the first source would open another source's gate. The card is
   enrolled, and prompt / answer / why leave the API, once every live source is passed. For campaign tag sections
   (3-6 sources from different repos) this enrols late; if you want "any source", S2's lint must then forbid a
   multi-source answer from restating any source's key, and the switch is one function (`metAt`).
2. `recapAfter` also accepts a **whole count >= 2** (campaign sections: "any 3 sources passed" = `recapAfter: 3`).
   S2's lint (in its clone) currently allows only `(0, 1]`; it must accept integers >= 2.
3. Side-file formats I had to define (S2 must write these, or tell me theirs):
   `content/seed/card-tags.json` = `{ format: "bootquest-card-tags@1", tags: {<flashcard item key>: ["repo-recall", ...]}, noEnrol?: [keys] }`;
   `content/design/headlines.json` = `{ format: "bootquest-headlines@1", sets: {<questionSetKey or EB unit key>: [[{headline, dimension, repoSpecific} | "text" | null per key point] per question] or {"q1k2": ...}} }`.
4. Recap XP: `xp_event` kind **`study-quest`**, `unit_id` NULL (XpKind / the CHECK are bound); once per section is
   held by `keyidea_checkpoint UNIQUE(section, kind)`.
5. Redo "at most one a day" is held by **parking**: a waiting redo card's `due_at` = its FSRS due + 100 years
   (`engines/redo.ts`), so no due count, queue, forecast or review-clear slot sees it; one is released (`due_at = now`,
   never earlier) when none is out and none was graded today; after its run it is parked again.
6. Server tasks 2-6 landed in **one server commit** (engines, service and app.ts are shared across them); tests per
   task are separate files. Client work for tasks 3-6 is one client commit.
7. Files outside "S1 owns" that I had to touch: `engines/xp.ts` (0a ruling), `engines/hints.ts` (0b), `server/test/api/hints.test.ts`,
   schema pins in `packs.test.ts` (S2-owned file, pins only) and `ladder-sysdesign.test.ts`. `server/test/rv2-xp-repeat.test.ts` is new.
8. The CLI had **no `review` command**: added a read-only `bootquest review [--keyideas] [--tag x]` (grading stays in the app).
9. A retired card's grade is refused with **404** (the existing `reviewItemExists` rule), not 409; the grade route also
   maps a `STALE` honesty error to 409 should one ever reach it.
10. Dashboard: besides the tile, the 10-minute plan's review link now opens `/review?ten=1` (F8 needs it).

## Upstream / other bugs found
- `sysdrills/02-caching-and-pools/01-effective-latency` hint 1 reads as a formula (S2 already has it).
- Pre-existing: `gradeReview`'s `withHonesty` does not map `STALE`; unreachable today because `reviewItemExists` 404s first.

## What is left
- Mount `KeyIdeasForUnit` (exported from `client/src/pages/KeyIdeas.tsx`) on the track browser and the Fundamentals
  page (not S1 files: S3 / orchestrator).
- The notebook line after a missed EB key point lives in `LadderPanes.tsx` (S3's file); the API (`POST /notebook`
  with the EB attempt id) already accepts it. The Player shows it after a failed code submit.
- Client typecheck + the full battery in the hub (this clone lacks CodeMirror). Live walk on a sandbox.
- Weekly page "ideas rated again >= 2 times" (S3) can read `review_log` for `keyidea:%` cards; notebook categories from `GET /notebook`.
