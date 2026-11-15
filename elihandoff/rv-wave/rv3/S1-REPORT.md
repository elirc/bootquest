# rv3 S1 `rv3-fix` stop report (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-p`, branch **`rv3-fix`**, base `3264edb3` (hub `rv-wave`). Nothing pushed, `main`
untouched, no `--no-verify`, no history rewrite. Every commit uses a message file and the Co-Authored-By line. No bound
file, no `shared/src`, no `content/**`, no owner DB touched. Migration 030 not used. HEAD = **`1b77c69d`** (12 commits), tree clean.

**Read this first.** The brief closed `content/**` to this stream, and the classifier refused my first content edit. So
the content halves of MF-2, MF-7 and MF-9 (plus six idea-sentence rewrites the new MF-4 lint asked for) are a **patch
for the orchestrator**: `rv3/S1-content.diff` (12 files, `git apply --check` clean on `1b77c69d`). It also carries the
lint edit that drops the 11 pending entries the content change resolves. Apply it in one commit:
`git apply elihandoff/rv-wave/rv3/S1-content.diff` from the repo root, then run `seed:lint:keyideas` (expect OK).

## Commits (oldest first)
| SHA | Item |
|---|---|
| `596ed564` | MF-1 server: a recap needs min(3, live ideas) met ideas besides the unit threshold |
| `17500b3d` | MF-10: no server test reads the repo's real key-ideas side files by accident |
| `3ccc38a4` | MF-3: a redo card with no live sibling is skipped, retired at startup, restored with one |
| `1d6411f9` | MF-6: one `resolveSections` per request, memoised per Db (see deviation 6: this commit's test file is mis-staged) |
| `5eb8218a` | MF-4 API + fold: `idea` withheld until met; MF-1 copy on the fold; repairs the 1d6411f9 test file |
| `aa753a46` | MF-2 + MF-4 lint: recap threshold <= 40 units; the idea sentence is leak-checked; pending lists |
| `cdef1858` | W10a: `ConfidencePick` on Player drill / quiz / predict-output submits |
| `41bbfb88` | W10b: the Stats competency table gets the real due-retest set |
| `8c719b11` | W10c server: a released redo card and a due re-check come first in `/reviews/queue` |
| `47b1f208` | should-fix F6 + L4: the recap re-enrols within the 4-a-day cap; re-check prompts fixed as of the due time |
| `d38e620e` | W10c client: the key-ideas tile names today's redo and a due re-check (+ the MF-1 client test) |
| `1b77c69d` | F6 test strengthened: the 47b1f208 version also passed on base (see the base check) |

## Must-fix items -> proving test
Each test is new or extended in this branch. "Fails on base" = run against the `3264edb3` versions of the 7 changed
server sources (see the base check below).
| MF | Fix | Proving test |
|---|---|---|
| MF-1 | `engines/keyideas.ts` `recapIdeasNeeded` = max(1, min(3, ideas with a live source)); `sectionRecap` opens only on the unit threshold AND that many met ideas; the 409 says which is missing; fold copy | server `keyideas-recap.test.ts` "rv3 MF-1 (ruling 8) ..." (1, 2, 3 met; a 2-live-idea section opens when both are met; no XP, no checkpoint while locked); client `keyideas.test.tsx` "rv3 MF-1: a locked recap ..." |
| MF-2 | lint: `MAX_RECAP_UNITS = 40`, `recapUnitsNeeded` = the server rule; **side files: in the content patch** (whole-count `recapAfter`: sysdrills 27, bootforge 12, csharp 13, java 16, jstrain 12, design-it 19; = ceil(0.8 x distinct sources); prefix scopes kept so the track-browser fold still shows). agentic and review-katas stay S4's | tools/seed `keyideas-lint.test.ts` "rv3 MF-2: a recap that needs more than 40 passed scope units is a problem ..." and the committed-side-files test |
| MF-3 | `engines/redo.ts` `redoSiblingLive` (idea in the side files + a non-archived sibling that is a live unit); `releaseRedo` skips such cards and parks one that is out; `conceptCardLive` retires / restores it at startup | server `redo.test.ts` "rv3 MF-3: a redo card whose idea lost every live sibling ..." |
| MF-4 | API: `idea: ''` for a not-met idea (the shared `KeyIdeaDto` keeps `idea` required; making it optional is an `api-ext` change for S5); fold shows "An idea you meet in its sources." Lint: the idea sentence is checked with both matchers | server `keyideas.test.ts` "GET /keyideas: prompt, answer and why are absent ..." (now also `idea`, raw body searched); client "the fold lists the met idea sentences ..."; lint "rv3 MF-4: the idea sentence is leak-checked too ..." |
| MF-6 | `resolveSections` memoised per Db until the store, the routing or the unit table changes (one aggregate signature row); `/reviews/queue` resolves at most once per page | server `keyideas.test.ts` "rv3 MF-6: /reviews/queue resolves ... at most once per request ..." (5 concept cards: 0 full resolutions when nothing changed, 1 after a new unit, 0 for keyideas + queue + dashboard after it) |
| MF-7 | **content patch only** (`content/paths/sysdesign.json`), see "MF-7 re-map" below | not testable in code; checks: the patch applies, every key is a live non-archived unit of the estate, no set on two steps (the reader dedupes by first step), 18 steps / 32 sets |
| MF-9 | S1 part (sysdrills `backlog-drain-time`): **content patch**. 4 consumers x 500/s = 2,000/s against 1,000/s arrivals = 1,000/s surplus, 1,200,000 / 1,000 = 1,200 s = 20 minutes, twice the 10-minute deadline (the drill's `surplusPerSec`). New answer: "... gets 4: their surplus over arrivals is only 1,000 a second, so catching up takes 20 minutes, twice the deadline." `why` no longer says "the lag never closes". Java part is S2's | lint on the patched copy: 0 leaks, answer 53 words |
| MF-10 | `store/keyideas.ts` `sideFilesDir()`: BOOTQUEST_KEYIDEAS wins; unset = repo `content/` except inside a vitest run (VITEST), where it means none. `store/design-side.ts` uses it too | server `keyideas-isolation.test.ts` (no store = no sections / headlines / dimensions, no key-idea warning over dashboard, queue, keyideas; outside vitest unset = `content/`) |

## W10 and the should-fix list
| Item | What | Test |
|---|---|---|
| W10a | `ConfidencePick` beside the Player's graded submits (code drill, quiz, predict-output); filed with the attempt id after the submit, cleared after each try; hidden on a redo run and once passed | client `rv2-confidence.test.tsx` "rv3 W10a: ... drill ..." and "... quiz ..." |
| W10b | Stats reads `GET /due` and passes the due retests' unit ids to the competency table | client `stats.test.tsx` "rv3 W10b: ..." (due = "open now", not due = not) |
| W10c | `engines/fsrs.ts` `PRIORITY_CARD_PREFIXES` (redo:, recheck:), `priorityDueRows`, `priorityFirst`; `/reviews/queue` serves them first (the count is unchanged); the tile names them via `getReviewQueue(3)`, mounted only inside a visible tile | server `redo.test.ts` "rv3 W10c: a released redo card is first ..., ahead of 100 older due flashcards"; client `keyideas.test.tsx` "rv3 W10c: the tile names ..." |
| should-fix 1 (F6) | `reenrol` pulls forward only a reviewed card; a never-reviewed one keeps its capped day; a missing one is created on the capped day | server `keyideas-recap.test.ts` "rv3 F6: ..." |
| should-fix 6 (L4) | the re-check's five prompts are drawn as of the card's due time (ideas met by then, grades before it), so the POST accepts the GET's set | server `keyideas-recap.test.ts` "rv3 L4: ..." |

## MF-7 re-map (`content/paths/sysdesign.json`, in the patch)
I scored every DESIGN IT set's key points against each module's maths (script in my scratchpad, `score.cjs`) and read
the key points of every candidate. Changes:
- **11** replication: `javabootcamp/48f892a920ad` (Dynamo-style KV store: R + W > N, sloppy quorum, hinted handoff). It
  was on 07. Off the path: `organized-study-support-desk-crm/03c116f58e89` (moves to 09) and `opusorganize/879d92385839`
  (saga vs 2PC: no module uses its maths).
- **07** hashing: `javabootcamp/ec7765856610` (URL shortener: the code-partitioned store on consistent hashing, mod-N resize,
  hot partition; it was on 01). 01 keeps `jsprojectlearn/31b0ab90e5f2` (envelope maths).
- **02** gains `opusorganize/9e40bcebe17f` (caching correctness; it was on 07). 02 now has 3 sets.
- **09** gains the outbox-notifications set (worker replicas, redelivery, a 6,000-email burst). 09 now has 3 sets.
- **15** node runtime: `opusorganize/0db1c6307227`, **set C** of web-app-at-10x-load (bcrypt and QR rendering on the API's
  event loop, CPU work moved to a worker: the only set with module 15's maths) + `opusorganize/3eee17f623fe`. Off the path:
  `dotnet-stripe/dac7f4b37aa1` (.NET storefront). **This breaks the old "set B/C stay off the path" rule once; the
  `_note` says so.** If you reject it, 15 keeps only `3eee17f623fe`.
- **12** failover: no set. No primary set uses RPO / RTO / region-loss maths; `masteropen/a3a62d030752`
  (idempotency over an outbox) leaves the path.
- **08, 10, 14** reviewed, kept, and named in `_note` as the closest sets: 08 (chunk counts for a 6 GiB upload; one
  counting rule for clicks), 10 (a worker pool sized from 42,000 invoices an hour), 14 (a high-cardinality column;
  alert-once markers and alert noise).
- `design-it.json` scope (= the path's primary sets, per its `_note`) gains `0db1c6307227`: 35 keys.
Path: 18 steps, **34 -> 32 sets** (4 off, 1 on, 3 moved).

## Idea-sentence leaks the new MF-4 lint found (12)
6 are in files PLAN gives S1. They are rewritten in the patch, and the lint on the patched copy shows 0 leaks:
`bank-jstrain/async-control-primitives`, `campaign-authz-tenancy/{ownership-on-every-path, not-found-for-other-tenants}`,
`campaign-migrations-rollout/expand-contract-each-its-own-deploy`, `campaign-queues-outbox/claim-with-a-conditional-update`,
`campaign-retries-timeouts/every-call-has-a-deadline`.
6 are **S3's** (`IDEA_LEAK_PENDING`, owner `rv3 S3`). Proposed sentences, which S3 should run through the lint:
- `fund-js-core/mutating-array-methods` (restates bootforge quiz "push, sort, splice, reverse" and trainjs q3.kp4): "Know
  which array methods change the array they are called on and which hand back a fresh copy, and use a copying one when the
  caller still needs the original."
- `fund-js-core/this-from-call-site` (overlaps fund/js/02 q03): "The receiver of a method call is decided at the call,
  not where the method was written; an arrow borrows the receiver of the code around it."
- `fund-js-senior/index-matches-query` (ww19 q1.kp2): "An index pays off only when its column order fits the filter and the
  sort of the query that uses it; read the plan the database prints instead of assuming."
- `fund-js-senior/keyset-pagination` (ww48 q1.kp2 and q3.kp1): "Page by continuing after the last row shown, with a unique
  tie-breaker, instead of skipping a count of rows: pages stay put when rows are added and stay cheap deep in the list."
When S3 fixes them, the lint's stale rule forces the matching `IDEA_LEAK_PENDING` lines out (same for S4 and
`RECAP_UNITS_PENDING` agentic / review-katas).

## Counts before -> after
- Server tests: keyideas-recap 3 -> 6, redo 5 -> 7, keyideas 6 -> 7, keyideas-isolation new (1). tools/seed
  keyideas-lint 11 -> 13. Client: keyideas 9 -> 11, rv2-confidence 3 -> 5, stats 17 -> 19.
- `seed:lint:keyideas` on the committed tree: 24 files, 189 ideas, **0 problems, 0 leaks**, 12 pending idea leaks, 7 pending
  recaps (4 banks + sysdrills: the patch; agentic + review-katas: S4). With the patch applied (checked on a patched copy
  against the real estate): 0 leaks, 2 pending recaps (S4), 6 pending leaks (S3).
- Migrations: 027 (unchanged). Packs / stamps: unchanged (700/700 fresh).
- Sysdesign path (after the patch): 18 steps, 34 -> 32 sets.

## Gates run (targeted, `--maxWorkers=1`, foreground or single background runs, Git Bash)
```
npm run typecheck (root)                         rc=0
npm run typecheck -w @bootquest/client           rc=0, 0 errors (not even the @codemirror/@lezer ones)
server  keyideas-recap 6, redo 7, keyideas 7, keyideas-isolation 1, keyideas-store 5, interview 3,
        keyideas-session 2, notebook 2                                                   all green (last runs)
tools/seed  src/ops/keyideas-lint.test.ts        13/13 (plus vitest's benign "Timeout calling onTaskUpdate")
client  keyideas 11, rv2-confidence 5, stats 19, player 28, review-paging 4                   all green
client  find.test.tsx                            17/18: "a mount reads /dashboard ..." FAILS on an extra
        getKeyIdeas call: the rv2 dashboard tile (e1f3ab7b) calls it on every mount. Older than this branch: the
        W10c tile line adds no call (it mounts only in a visible tile; the mock has none). Fix in find.test.tsx
        (not an S1 file): add 'getKeyIdeas' to the expected set and allow 8.
seed:lint:keyideas (node --import tsx ...cli.ts)   24 side file(s), 189 idea(s): 0 problem(s), 0 leak(s) · RESULT OK
restamp:all -- --dry-run                          700/700 fresh · RESULT OK (dry run: ... nothing was executed)
bound files (git diff 3264edb3..HEAD)             nothing under server/src/runners, api/runners.ts, runner-*.ts,
                                                  tools/seed/src/factory, shared/src or content/**
```
**Base check (W1 acceptance: each MF test fails on `3264edb3`).** The 7 changed server sources, and separately the
lint, were put back at `3264edb3` with `git checkout 3264edb3 -- <files>`, only the new tests were run, then the files were
restored from HEAD (tree clean after):
```
server, base sources:  FAIL rv3 MF-1, rv3 MF-3, GET /keyideas (MF-4), rv3 MF-6, rv3 W10c, rv3 L4, isolation (MF-10: 24
                       sections loaded), rv3 F6 (12-card version; the first, 6-card version PASSED on base and was
                       replaced in 1b77c69d)
tools/seed, base lint: FAIL rv3 MF-2 (recapUnitsNeeded missing), rv3 MF-4 (0 leaks found, 1 expected)
HEAD:                  all of them pass (runs above)
```
Client tests (MF-1 copy, MF-4 fold, W10a/b/c) were not run against base: the copy, test ids and calls they assert did
not exist there.
Not run (not S1's gates, or the orchestrator's battery): the full suites, `seed:lint:leaks`, `seed:lint:answers`,
`seed:pins`, `smoke:api`, `test:csharp`, `test:java`.

## Deviations from the brief (please rule)
1. **`content/**` closed, so content work is a patch.** PLAN §3.1 gives S1 the side files and `paths/sysdesign.json`, but the
   brief's hard rule closes `content/**` and the classifier refused the edit. MF-2's values, MF-7, MF-9 (S1 part) and
   the six idea rewrites are in `rv3/S1-content.diff` (built from scripts that refuse to run if the source text changed).
2. **MF-10 without a setup file.** A `setupFiles` line in `server/vitest.config.ts` (not an S1 file) was refused, so the
   default lives in the two S1 stores (`sideFilesDir`, keyed on vitest's own `VITEST` variable). The app and the CLI behave
   as before.
3. **Pending lists in the lint** (`RECAP_UNITS_PENDING`, `IDEA_LEAK_PENDING`) keep the gate green while the rules are live.
   Each entry names an owner, and a stale entry is a problem, so the lists can only shrink.
4. **MF-4 sends `idea: ''`** instead of dropping the field: `KeyIdeaDto.idea` is a required string in `shared/src/api-ext.ts`.
   Proposed for S5 (it owns the appended api-ext blocks): make it optional and drop the ''.
5. **MF-2 uses whole counts and keeps prefix scopes** instead of "scope = union of sources": `?unit=` (the track-browser
   fold, `TrackUnits.tsx`) matches on scope, so a sources-only scope would hide the fold on most bank units.
6. **Commit grouping.** MF-2 and MF-4's lint halves are one commit (same file, interleaved). F6 + L4 are one commit (shared
   import hunk and test file). The MF-1 client test landed in `d38e620e` (one hunk with the W10c test). **`1d6411f9`'s
   `server/test/keyideas.test.ts` is broken on its own**: a `-U0` partial stage put the MF-6 test four lines too low,
   inside the "unknown key" test. `5eb8218a` (the next commit touching it) restores the tested file. History was not
   rewritten.
7. **W10c queue order lives in `engines/fsrs.ts` + the route**: the queue SQL is `store/queries.ts reviewQueue` (not an S1
   file), so the route merges `priorityDueRows` in front of it.
8. **MF-7 choices** (set C on 15; 12 left with no set; four sets off the path). These are judgment calls, listed above.

## Upstream / other bugs found (report items, not fixed)
- `client/src/pages/find.test.tsx` dashboard call-set test is red since rv2 (`getKeyIdeas` from the key-ideas tile).
- The six S3 idea sentences above (MF-4 lint).
- `shared/src/api-ext.ts` `KeyIdeaDto.idea` should be optional (deviation 4).
- FABLE-REVIEW L7 ideas citing sources that do not teach them (`campaign-*`, `fund-cs-web`, `bank-*`): not checked by me
  (content, budget).

## What is left
- **Apply `rv3/S1-content.diff`** (orchestrator), then `seed:lint:keyideas` OK and a live look at the sysdesign path.
- Should-fix not done: 3-5 (content: F9 rest, F10 rest, L7, L8; S2 / S3 files), L5 (store `kpHash` on `ebmiss` cards: needs
  a card-key format change and new redo-test expectations), 7 (L2 `estimates.json` reader, L10 one headlines reader), 8
  (L3 confidence copy in `StudyQuestPane.tsx`, not an S1 file; L6 note cap; L12 touch scroll).
- `find.test.tsx` expected set (above).
- Leftover node processes matching `bq-f52-p`: 0 at stop.
