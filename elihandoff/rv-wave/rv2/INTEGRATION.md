# rv wave: integration report (2026-11-13/14)

Integrator: hub `C:\Users\Owner\Desktop\bq-f52-hub`, branch **`rv-wave`**, `dc2206bc` → **`499a4496`**.
Nothing pushed, `main` untouched, no force, no history rewrite, no `--no-verify`. All commits use message files
and end with the Co-Authored-By line. The working tree is clean.

## 1. Commits on `rv-wave` (first parent, oldest first)
| SHA | What |
|---|---|
| `63dda197` | merge `rv-p` (B server, migrations 020/021). No conflicts |
| `65e94fca` | fix: `ladder-real` kata G1 pin counts patched-line defects only (B R3-04) |
| `32718a2c` | merge `rv-d` (C, migration 022). 4 conflicts, see §2 |
| `ea7e60e5` | merge `rv-c` (A1 committed). No conflicts |
| `3abc0b5c` | merge `rv-p-wip` (B client half), as saved |
| `e4d6dae7` | fix: `ladder.test.tsx` promotion legs read the competency table on `/stats` (C R4-20) |
| `577a1f62` | fix: `learn-more.test.tsx`, a failed gate releases nothing (B R4-01) |
| `8434fb65` | merge `rv-c-wip` (A1 Java bug-hunts, authoring) |
| `a0166265` | content: drop Java bug-hunt 14/02 (data race, non-deterministic), census java drills 43 → 42 |
| `14eda73c` | content: re-import + stamp fund-java (42/42) |
| `3d737270` | merge `rv-e1-wip` (E1 sysdrills authoring + importer gate + archive 06/04). No conflicts |
| `499a4496` | content: re-import + stamp sysdrills (129/129) |

## 2. Conflicts and how they were resolved
Only the `rv-d` merge conflicted. Each hunk was resolved on its own (script `work/integrator/resolve.mjs`); no file was taken wholesale.
- `server/src/api/service.ts`: one import hunk. Kept **both** (B `practice-service`, C `nextstep-service`).
- `server/test/db.test.ts` (4 hunks), `packs.test.ts` (3), `ladder-sysdesign.test.ts` (2): schema-version pins. Took
  C's side (…20, 21, 22 / version 22), which already includes B's 020/021.
- Expected-but-clean: `shared/src/api-ext.ts`, `client/src/api/{mock,types,http}.ts`, `Stats.tsx`, `study-quests.test.ts` auto-merged.

**Renumber check (after `rv-c`).** Stream C's side files (`content/archive.json`, `content/paths/*.json`,
`content/campaign-titles.json`) and code name no fund-js 21-32 key. C's senior-rep rule is the numeric range
`FUND_SENIOR_TOPICS = { track: 'js', from: 21, to: 33 }` (`server/src/engines/streak.ts:141`). The renumber only
permutes topics inside 21-32, so the set of topics counted is unchanged. The only `fund/js/21-*` string outside
the packs is a test fixture (`server/test/rv-day.test.ts:60`). Nothing to fix.

## 3. What the merges broke, and the fixes
1. `server/test/api/ladder-real.test.ts` (kata G1 stats): it pinned `defectsTotal = all seeded defects`. Under B's
   rule (migration 021) G1 counts only `evidence.in === 'patched'` defects. The pin now derives patched total and
   caught from the key view.
2. `server/test/api/mock-contract.test.ts` failed after `rv-p` alone: the client mock still had notes rule (b).
   That is expected. `rv-p-wip`'s mock carries B's rule, and after that merge the test is 13/13.
3. `client/src/pages/ladder.test.tsx` "dashboard promotion legs": C moved the competency table to Stats (R4-20) but
   did not run this file. The test now renders `/stats` and selects `table.comp-table`, as C did in `dashboard.test.tsx`.
4. `client/src/pages/learn-more.test.tsx` "after a FAILED submit": it pinned the removed rule (b). Rewritten to B's
   rule, mirroring server `notes.test`: no per-question Learn-more button, and the drawer says explanations unlock on a pass.
5. **fund-java (`rv-c-wip`)**: `rv-c` had already changed the Java authoring (R1-03 test holes) without re-importing,
   so `fundamentals/import.test` java byte-match failed after the `rv-c` merge. That is expected; the WIP finishes it.
   I re-imported from authoring with a clean HEAD (`seed:import:fundamentals -- --track java`). The WIP's pack bytes
   matched; only the manifest gitHead/dirty changed. Then I validated per course (`--concurrency 1 --retry-failed`) and
   ran the full stamp: **42/42 pass, 0 quarantined, audit 20 re-executed / 0 mismatches, RESULT OK**. The WIP's 9
   quarantine rows were javac timeouts under load (the runner's 30 s `COMPILE_TIMEOUT`, bound). The same timeouts
   recurred here at 100% CPU and cleared on retry.
   - **Dropped `fund-java/14-threads-executors-and-synchronization/02-bug-hunt-parallel-word-count`.** Its only bug
     is a `HashMap` written by 8 threads. Whether an update is lost is up to the scheduler, and the gate quarantined
     it as `vacuous-check: the untouched starter passes its own tests`. A bug-hunt starter must fail every time, and
     the tests are drill 1's (shared byte-for-byte), so no fix is possible without a new deterministic bug. It never
     shipped; the key must not be reused. `FUNDAMENTALS_EXPECTED.java.drills` 27 → **42** (A1's WIP said 43).
   - Proof per bug-hunt (journal `.seed-journal/fund-java.jsonl`, final verdicts): all 15 shipped bug-hunts
     (02-13, 15-17) are `pass`. A `pass` means the reference passes and the starter fails *as a test verdict* under
     the real Java runner (JDK 17).
6. **sysdrills (`rv-e1-wip`)**: `tools/seed/src/sysdrills/import.ts` is outside the seed fingerprint closure. No
   `factory/`, `quests/` or `shared/src` file imports it, and `factory/fingerprint.test.ts` (29/29) pins the walked set.
   `seed:import:sysdrills`: 129 drills, and the new hint-2-prose gate holds. `seed:validate -- --source sysdrills`:
   129/129, 0 quarantined, RESULT OK.
- Pins: no other census constant or `ladder-real` pin names Java drill counts (grep), and `seed:pins` is OK.
  `archive-real` is pinned at 880 by E1 and passes.

## 4. Tests run (targeted, `--maxWorkers=1`, hub)
Typechecks `npm run typecheck` and `-w @bootquest/client` rc=0 after every merge and at the end.
- After `rv-p`: server rv-gates 12, rv-ladder 3, hints 15, notes, eb-weights, db 43, fundamentals 13, ladder 54,
  study-quests 25, weak-due 11, ladder-sets 4, ladder-sysdesign 5, packs 27, ladder-real 6. All green except
  mock-contract (item 2 above) and ladder-real kata (item 1, fixed, re-run 1/1).
- After `rv-d`: server 18 files (rv-day 8, archive-real 5, rv-routes 5, serve-mixed 2, slate-settings 14, settings 6,
  slate-fund 5, nextup 2, campaign 12, api/campaign 13, find 14, db 43, ladder-sysdesign 5, packs 27, api 43,
  study-quests 25, rv-gates 12, streak 31), all green. Client 10 files (App 26, trackunits 24/20, dashboard-hero 25,
  dashboard 25, fundamentals 16, rv-dashboard 7, session-shape 9, slate-focus 7, w11-final 18), all green. CLI
  rv-today 3, format 17, green (`program.test` skipped: it spawns child servers and timed out under load for C too).
- After `rv-c`: tools/seed answer-rank 6, answer-length 7, answer-positions 7, fundamentals/import 15/16 (java
  byte-match, item 5). Server fundamentals 13, lesson-aids 7, related 3, slate-fund 5, rv-gates 12, archive-real 5,
  ladder-real 6, all green.
- After `rv-p-wip`: client 22 files: rv-ladder 7, rv-player 3, eb-weights 8, kata-diff 10, gate-failpath 10,
  gate-closed-book 2, study 6, player 28, hints 7, fundamentals 16, App 26, lesson-aids 5, gate-focus 4,
  fund-complete 6, stats 17, more-practice 7, ui-audit 17, w10-polish 25, written 6, draft 1, learn-more 9 (after
  fix), ladder 41 (fixed case re-run). Server mock-contract 13/13.
- After `rv-c-wip`: tools/seed fundamentals/import 16/16; server fundamentals 13, related 3, lesson-aids 7, slate-fund 5.
- After `rv-e1-wip`: tools/seed sysdrills/import 22, factory/fingerprint 29 (51/51, plus the benign
  "Timeout calling onTaskUpdate"); server hints 15, weak-due 11, rv-routes 5, archive-real 5, ladder-sysdesign 5.

## 5. Gates (run one at a time, final tree `499a4496`)
```
typecheck            rc=0
typecheck (client)   rc=0
seed:lint:leaks      244 explain-back / 204 quest / 204 notes pack(s), 4756 key point(s): 146 pair(s), 146 baselined, 0 new, 0 stale, 0 unweighted · RESULT OK
seed:lint:answers    291 pack(s) / track(s) / topic(s) scanned, 0 new over the limit, 2 baselined, 0 worse, 0 stale-high, 0 stale · RESULT OK
seed:pins            RESULT OK: 688 pack(s): 688 OK, 0 MISMATCH, 0 UNCHECKABLE
seed:campaign --check  check ok: committed campaign packs equal a fresh build byte-for-byte
restamp:all --dry-run  700/700 fresh · RESULT OK (dry run)
smoke:api            FAIL: "smoke:api 3/4 steps passed" (twice): server boot > 180 s deadline at 100% CPU
```
**smoke:api is still broken, for two separate reasons.**
1. *Boot under load.* Both gate runs failed at "server boots on temp DB + free port". The child was alive with no
   error: the kill step found it, and only the unstamped-packs notice was printed. So it was still loading at the
   180 s deadline. A scratch copy with a 15-minute deadline (`work/integrator/smoke-long.mjs`, otherwise
   byte-identical) booted in **120 s**. That is environmental, but close to the limit: re-run on a quiet machine.
2. *Stale smoke assertions (real, needs a fix).* With the server up: **`smoke:api 65/76 steps passed`**. All 11
   failures pin behaviour that rv B or C changed on purpose. Neither stream ran smoke.
   - B R4-09 (0 XP for a pass after a failed first try): `submit right: XP row (+2)` now gives `{"amount":0,"reason":null}`.
     That cascades into `dashboard: xp total 3` (→ 1), `xp total 24` (→ 22), `xp total 44` (→ 42) and `xp total 54` (→ 52).
     `submit right again: 0 XP already-awarded` now returns reason `null`. **Owner/B call:** is `null` right for a
     repeat pass whose first pass paid 0, or should it stay `already-awarded`?
   - C default slate (campaign step and drill sets off unless configured): `campaign slate slot` and
     `drill:sysdesign slate slot` see slots `drill:js,senior`.
   - B R4-07 (≥ 15 words per EB answer): `ladder flow (real explain-back, jstrain2.2)`: the smoke's answers are short.
   - B R3-04 (G1 counts patched-line defects only): `ladder flow (real kata, tenantadmin)`.
   - B R4-01 (notes rule (b) removed): `notes gate … after a FAILED submit the 9 questions answered right are explained`.
   The fix belongs in `server/scripts/smoke-api.mjs` (not bound). I left it for stream B/C or the owner, because of
   the open `already-awarded` question and because each smoke run takes about 10 minutes on this machine.

## 6. Counts before → after (`dc2206bc` → `499a4496`)
- Fundamentals census: js quiz 304 → 330, js drills 62 → 79 (A1: senior gates + 17 bug-hunts); java drills 27 → 42
  (15 bug-hunts); C# unchanged (20/200/160/27).
- sysdrills 129 → 129 (same keys; hints flipped, starters' formula TODOs removed, tests added; 06/04 archived).
- `content/archive.json`: none → 880 unit keys in 7 groups (C 879 + E1 1).
- Migrations: 019 → 022 (020/021 B, 022 C). `restamp:all` 700/700 before and after.

## 7. Found, not fixed (report items)
1. **sysdrills hint policy vs E1's flip** (`server/src/engines/hints.ts:91`, B). On a formula-score tie,
   `withoutFormula` withholds hint 2. That matched the old order, but E1 now authors hint 2 as prose and hint 3 as the
   answer. Over the 129 drills (script `work/integrator/sysdrills-hints.ts`), 127 withhold exactly hint 3. Two do not:
   - `sysdrills/16-data-access-and-integrity/01-soft-delete-unique` withholds **hint 2** and **serves hint 3**, which is
     the answer ("unique-email: any row with the email blocks; (email, deleted_at): …; partial: …").
   - `sysdrills/02-caching-and-pools/01-effective-latency` withholds hints 1 and 3 and serves only hint 2. Its hint 1
     is a full formula; content should reword hint 1 to prose.
   The fix is one line: on a tie, drop the last tied hint (`const drop = tied[tied.length - 1]`), plus a comment and a
   test. I did not make it: AGENTS.md keeps `server/src` out of scope unless the brief says so, and the edit was refused
   in this session. Owner or stream B to apply.
2. Java bug-hunt 14/02 dropped (§3.5). A1 can re-author it with a deterministic concurrency bug (for example, a missing
   `f.get()` wait is still timing-dependent, so a better choice is a check-then-act whose tests force the interleaving).
3. Bug-hunt starters' header comments say "01 · …" (copied from drill 1). Cosmetic only, left as authored.
4. Java validation is load-sensitive: the bound 30 s javac cap times out at 100% CPU. Validate on a quiet machine,
   and expect per-course retries.

## 8. Left to do
- **smoke:api**: update the 11 stale assertions (§5) and re-run on a quiet machine.
- **hints.ts tie-break** (§7.1): one line in `server/src/engines/hints.ts` plus a test.
- Live checks of the B client half (gate fail screen, practice toggle, WhyItWorks fold, kata fold, copy prompt) in a
  sandbox: HANDOFF §6.1. Not done here: no app or browser started.
- The full battery one suite at a time (client suite, both server configs, tools/seed, demo:*, test:csharp,
  test:java, CLI program/e2e). Only targeted files were run here.
- HANDOFF §6 items 2-6: C# bug-hunts, T4 fading, E1 not-started items, stream D, new content, docs.
