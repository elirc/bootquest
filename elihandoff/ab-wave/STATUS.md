# ab wave: status and how to resume (paused 2026-10-30, out of usage)

Owner order: "review plan in elihandoff and implement, use 7 opus agents, council of 5 agents to review high level
choices". The plan is `../REVIEW-2026-10-30.md`. This folder holds what the paused session produced. A new session can
resume from here without re-auditing or re-running the council.

## Done
1. **Council of 5 Opus agents** reviewed the plan: `council/C1-learning.md`, `C2-architecture.md`, `C3-content.md`,
   `C4-ops.md`, `C5-skeptic.md`. They reviewed the draft in `DRAFT-PLAN.md`.
2. **Binding rulings** in `RULINGS.md`. Where it disagrees with REVIEW, RULINGS wins. Headlines:
   - Scope is wave A (trimmed) + wave B (trimmed). Wave C is deferred until the owner has used the app. Wave D is
     out of scope.
   - **Restamp-free wave.** `shared/src/api.ts` is fingerprinted, because `pack.ts:2` imports it. New and extended
     DTOs go in the new `shared/src/api-ext.ts`, and `[wN]` weights are parsed at runtime.
   - REVIEW §7 stand-in rulings: phantom days are a display-only fix; demotion gets a trimmed fix with no confirm on
     Again; frozen leaks are accepted and baselined; the two-choice quizzes and frozen wrong items are deferred.
   - No sysdrill retirements: a unit missing from a pack stops the owner's server from booting.
3. **Hub branch `ab-wave` in selfboot**, 4 commits on top of `main` 772b19cb. All gates were green at 48767583:
   server suite 640/640, both typechecks, `restamp:all -- --dry-run` 697/697 fresh.
   - a4fe7def: review docs, tools and templates (previously uncommitted).
   - 48766165: `shared/src/api-ext.ts` skeleton plus its `./api-ext` subpath and client alias.
   - 56eb163d: migrations 017 `slate_setting` and 018 `eb_score_detail`, the `shared/src/eb-weight.ts` helper with
     its test, and the migration-count pins.
   - 48767583: packs.test migration pins.
4. **Briefs** for the 7 stream agents in `briefs/`: COMMON.md (shared rules, machine locks, gates, stop report) plus
   S1-S7.md.

## Progress log (newest last; every session appends here before and after each phase)
- **Session 1 (2026-10-30, to ~14:40):** council, rulings, hub contracts and briefs. The 7 stream agents were
  dispatched and stopped within minutes, with nothing committed.
- **Session 2 (2026-10-30, ~18:30-19:07):** re-dispatched the 7 streams; they were cut off at ~19:07 (out of
  usage), with no stop reports and no locks left. COMMON.md gained the free-RAM gate (uncommitted until session 3).
  State each clone was left in (`C:\Users\Owner\Desktop\bq-qw-s<N>`, branch `ab-s<N>`):

| Stream | Commits on top of ab-wave | Uncommitted work left behind |
|---|---|---|
| S1 slate | none | settings routes/service, streak.ts, queries.ts, api-ext.ts, 4 test files (WIP) |
| S2 review | fe8c2d3b demotion cap, 5d27c51a competency on cards, 42978194 repeat miss = again | client Review.tsx paging + test |
| S3 weak/due | 306c7a0f GET /stats/weak + GET /due | client WeakSpots, DueNow, Stats, Dashboard |
| S4 find | 0cc56192 unit search, targetUnitId, mixed drills | client api types/http/mock |
| S5 EB weights | f54fbd6a [wN] weights + eb_score_detail | client LadderPanes, eb-weights lib |
| S6 sysdrills | none | authoring 01-08 edits + importer gates in import.ts |
| S7 leaks/stems | none | tracer/pulse quest+notes re-seed (pulse validation.json deleted mid-run), xleak-lint.ts |

- **Session 3 (2026-10-31):** recorded the state above (b082f41e); added the "Interruptions" section to
  COMMON.md (adopt partial work, checkpoint commits, a `## Progress` section at the top of each `S\reports\S<N>.md`);
  re-dispatched the 7 streams with the resume prompt (step 4). **If this session is cut off too:** read each
  `S\reports\S<N>.md` Progress section plus `git -C bq-qw-s<N> log/status`, then re-dispatch only the unfinished
  streams with the same prompt.
- **Session 3, 2026-10-31 ~08:30:** all 7 agents hit the 5-hour usage limit at once (reset 12:50 PT). By then every
  stream had checkpointed. S1-S6 were code-complete with targeted tests, the medium gates and their commits done; only
  the HEAVY gates (server/client/tools-seed suites, demo:promotion, seed:validate, boot proof) and the final report
  were left. S7 had committed its lint (cd022534, baseline 149) and was mid-way through the stem/flashcard rewrites
  (tracer, pulse, jsdrillv2; uncommitted). A stale `locks/heavy` was removed. Per-stream detail is in each
  `S\reports\S<N>.md` Progress section. After the reset the same agents were resumed (SendMessage).
- **Stream stop reports (session 3):**
  - S5 DONE: ab-s5 f54fbd6a + 23243909; all gates green (server 650/650, client 385/385, tools/seed 2244+2 skipped,
    demo:promotion 39/39, restamp 697/697). Hub decision noted: `EB_PASS_SQL` uses the 80% floor while `passed` uses
    a unit's own `minCoverage` (none set today; only a stricter hand-authored unit would diverge).
  - S4 DONE except the full client suite: ab-s4 0cc56192, 30c4e042, c5084752; server 654/654, typechecks, lints,
    restamp 697/697 green; targeted client tests green. **Still owed: S4's full client suite** (run it at ring review
    or let the hub battery cover it). Deviations: 4 server tests swap an import to the extended dashboard schema
    (incl. append-only `api.test.ts`); expect a `Dashboard.tsx`/`getDashboard` conflict with S1 at merge.
  - S3 DONE: ab-s3 306c7a0f, 6a69bf11, 1f3aa61c (`npm run app` launcher on the Vite dev server); server 654/654,
    client 385/385, typechecks, lints, restamp 697/697 green; launcher live-checked on a DB copy (4391/5391).
    Deviations: weak spots live in a new `weak-service.ts`; one added `export` on `explanationRelease` in
    `notes-service.ts`; a stale comment in `Dashboard.tsx` about Due now waiting on `/competencies` (fix at merge).
  - S6 DONE: ab-s6 ea90e361, 34258321, 9a76dd7b (importer gates), 8b1b5546 (manifest + validation stamp);
    taskformula 95/111 → 0/111, recompute 129/129, 8 naive variants each fail only their trap test; sysdrills 129
    unchanged, tests 767 → 776; server 640/640, tools/seed 2250+2 skipped, restamp 697/697, lints green; boot proof on
    a DB copy (:4199) loaded 129. Deviations: 13/02 and 14/09 keep 9 tests; cs/java twins not declared (outside S6
    files); optional csdrills hint 2s not done.
  - S7 DONE: ab-s7 11 commits (cd022534 xleak lint; cb3c7dc9 tracer, 9f3510ea pulse, 5b562500 jsdrillv2, 1f27ed5d
    dotnet-drop, ec7bfd7d j2, f189b828 netcalendy, 28912fbd j7, b63dade4 ww7; e8df084a EB markers; 3b457c21 baseline
    test fix). Doc-recall stems 61 → 2 (all packs < 5%), flashcard backs > 60 words 28 → 0, baseline 149 → 147 (143
    frozen-both-sides + 4 accepted), lint precision 17/20 on a hand sample, slotcheck 0 BAD; tools/seed 2260, server
    640/640, scoped seed:check 19/19, restamp 697/697, lints green. `seed:pins` must run at the hub (clone lacks the
    mirrors). Pulse re-seeded with `--allow-quarantine` (pre-existing quarantined reading step; keys unchanged).
  - S1 DONE: ab-s1 e1b74801 engine, 88db9719 settings API, 2731d447 CLI, 908f6f55 client; server 658/658 (own
    re-run, scratchpad/S1/S1-server.txt 14:22), cli 120/120 incl. e2e, client 385/385, demo:promotion 39/39, restamp
    697/697, lints green. Its report still says "in progress" because the cut-off hit before it updated it.
  - S2 DONE: ab-s2 fe8c2d3b, 5d27c51a, 42978194, 228f916f (Review paging), 90474337 (README rule); server 646/646,
    client 381/381, demo:promotion 39/39, restamp 697/697, lints green (all re-run by S2 itself after the incident).
    Hub accepted its 3 deviations: "Queue cleared" only when the server due count is 0 (else "Session done" + "Review
    the N due"); a repeat quiz miss reschedules but never demotes (only Again on Review demotes); any demotion uses up
    the competency's daily cap. Owner item: every study quest declares only `code-reading` (206 entries, up to 3,956
    cards on one competency); the owner may want a per-promotion-window cap.
  - **Hub ruling (S7's 4 accepted pairs):** helios q0.kp5/kp6, ww7 q1.kp0, masterstore q1.kp1 stay in the baseline as
    reviewed false positives (related, not restating; masterstore's prompt asks for that overlap), although R3.3 says
    frozen-only. Rewriting correct kps to dodge the lint would make content worse. The S7 ring reviewer checks these 4;
    the SEEDING §8 bullet records the exception.
  - **Hub ruling (request count):** with S3 + S4 the dashboard mount makes dashboard + competencies + tracks + `/due` +
    `/stats/weak`. Accepted (the cap's purpose was killing the 11-request fan-out; folding weak rows into `/due` would
    mix concerns). At merge, update S4's "≤ 3 requests" mock test to the merged set, by counting.
  - **Incident (13:50):** stream agents shared one session scratchpad; S4 ran a `heavy.sh` that S2 had overwritten,
    which started S2's gates in bq-qw-s2 (bash PID 24056, holds `locks/heavy` until its demo:promotion ends). It is
    S2's own gate run, so it was left to finish rather than killed. Fix: every agent keeps scripts and logs in its
    own `scratchpad/S<N>/` (COMMON.md "Interruptions", and told to the live agents).
- **Ring review (session 3):** brief `briefs/RING.md` (app-code checks for S1-S5, content checks for S6-S7). Pairs:
  S1 reviews S2, S2→S3, S3→S4, S4→S5, S5→S6, S6→S7, S7→S1. Started the 5 pairs that do not involve S1 (S1 was still
  re-running its server suite); S4 was also asked to run its owed full client suite first. Reviews land in
  `S\review\S<you>-on-S<t>.md`; then each target fixes BLOCKING + SHOULD as new commits.
  2026-10-31 ~14:30 all 7 agents hit the usage limit again (reset 18:40 PT) before any review was written; on
  Review verdicts and hub merge items (fill in as they arrive):
  - S3-on-S4 PASS WITH FIXES: S4 fixes SHOULD-1 (mixed drills follow today's slate tracks) + N1 (palette Enter during
    debounce). **Hub at merge:** swap S1's `server/test/api/settings.test.ts` to `DashboardResponseExt` (strict slate
    item rejects `targetUnitId`); expect import-block conflicts in `api.test.ts`, `campaign.test.ts`, `api-ext.ts`,
    client `api/`, `Dashboard.tsx`; refresh the request-count comment; check the "Review-only day" note on an empty slate.
  - S5-on-S6 PASS WITH FIXES (0 BLOCKING; 9/9 new test values recomputed, 9 trap tests solution+naive OK): S6 fixes
    its report's SEEDING bullet (only sysdrills is gated). Next-wave item: 5 javadrills task lines still hand over a
    formula (03-streams 2, 07-exception-flow 1, 08-money-math 1, 10-completablefuture 1).
  - S7-on-S1 PASS WITH FIXES: S1 adds a local-midnight boundary test + fixes README:69-70 ("today always exits 0").
    **Hub at merge:** S1's focus card also fetches the slate settings on each dashboard load, so the merged mount =
    dashboard + competencies + tracks + `/due` + `/stats/weak` + `/settings/slate`; update S4's `find.test.tsx:47-49`
    to that set, by counting.
  - S2-on-S3 PASS WITH FIXES, 1 BLOCKING: S3's weak-due test double-inserts `eb_score_detail` once S5 is merged
    (018 trigger aborts). S3 fixes it + hub-approved `client/vite.config.ts` deny of `**/content/**` and `**/.cache/**`
    (the Vite dev server could serve answer keys from `content/seed` via `/@fs/`; pre-existing for `npm run dev`) +
    a real retest in the /due-vs-/competencies test + relative `BOOTQUEST_DB` handling in the launcher.
  - S6-on-S7 PASS WITH FIXES (code-truth 37/92 keys OK; 143 frozen entries verified byte-identical at 9b7f0ea3):
    the masterstore accepted pair is a REAL leak (the note restates a whole [w3] kp). **Hub ruling revised:** S7
    fixes it on the editable side and drops it from the baseline (accepted pairs ≤ 3); S7 also adds a ratchet test
    (shrink-only was not enforced) and settles one id convention (the reports mixed 0- and 1-based ids). S6 fixed
    its own report (SEEDING bullet: only sysdrills gates task lines).
  - S1-on-S2 PASS (0 BLOCKING, 0 SHOULD; targeted 17/17 + 4/4; counts verified). **Hub at merge:** refresh the
    `demote()` doc comment in `evidence.ts` (still says a row is written at the floor). Accepted NIT: a repeat quiz miss
    moves the card to Relearning, so a later Again on it does not demote (conservative).
  - S1 ring fixes DONE: a52edb5c (midnight-boundary tests), 08cbd895 + a7f7d6e7 (README `today` exits 2; the
    `bootquest slate` README line is drafted in S1's report for the hub). Expected server count 660 (not re-run).
  2026-11-01 all 7 were resumed with their review (S1 on S2 and S7 on S1 added; S4 still owes its client suite).

## Not done
- Finish the streams (resume prompt below tells each agent to adopt its clone's partial work), ring review, hub
  integration, the battery, the SEEDING §8 bullet, and the README census.

## Resume (new session)
1. Read `../../AGENTS.md`, then this file, then `RULINGS.md`, then `briefs/COMMON.md`. Do not re-run the council.
2. `git -C C:/Users/Owner/Desktop/selfboot branch --show-current` should print `ab-wave`.
3. The working folder `S` = `C:\Users\Owner\Desktop\bootquest-handoff\ab\`.
   - It holds the same briefs plus empty `reports/`, `review/`, `locks/` and `claims.md`.
   - If `locks/heavy`, `locks/med1` or `locks/med2` exists, no agent is running, so remove it.
   - The briefs reference S paths, so keep using S. This folder is the committed copy.
4. Dispatch 7 Opus agents, one per stream, in the background. Use this prompt with N = 1..7:
   > You are stream agent S<N> of the BootQuest "ab" wave (7 Opus stream agents in parallel, one clone each). Your
   > clone is C:\Users\Owner\Desktop\bq-qw-s<N> (branch ab-s<N>, already created at origin/ab-wave; continue on it).
   > Read, in order: C:\Users\Owner\Desktop\bootquest-handoff\ab\briefs\COMMON.md, ...\ab\RULINGS.md (binding),
   > ...\ab\briefs\S<N>.md, then the council files and report sections it names. Implement your brief fully, commit
   > per logical change, run the gates, write your stop report to ...\ab\reports\S<N>.md, reply in ≤ 30 lines. Never
   > push, never touch selfboot or another clone, never POST to or restart the server on :4178, never edit the
   > forbidden fingerprinted files. If blocked on an orchestrator decision, say so instead of guessing.
   > Your clone holds partial work from an interrupted earlier run: follow COMMON.md "Interruptions" first.
5. Ring review after all 7 stop reports: S1→S2→S3→S4→S5→S6→S7→S1, using `../templates/RING-brief.md` with S paths.
   Fixes land as NEW commits.
6. Integrate on `ab-wave`: `git fetch C:/Users/Owner/Desktop/bq-qw-s<N> ab-s<N>:ab-s<N>`, then
   `git merge --no-ff ab-s<N>`.
   - Merge order: S6, S7, then a checkpoint (`restamp:all -- --dry-run`, the lints, server vitest), then S2, S1, S5,
     S3, S4.
   - Expected conflicts are append-only: `shared/src/api-ext.ts` sections, the `app.ts` route lines, the client
     `api/{types,http,mock}.ts` blocks and `Dashboard.tsx`.
7. Run the battery from AGENTS.md, one HEAVY job at a time (RAM is tight: ~2 GB free at dispatch).
   - `restamp:all -- --dry-run` must stay all fresh. If it is not, someone touched a fingerprinted file: find it
     before restamping. Only S6/S7's own re-imported or re-seeded packs carry new committed stamps.
8. Update `ladder-real.test.ts` pins by counting, write the SEEDING §8 "ab wave" bullet (drafts are in the stream
   reports), and update `../README.md` State. Stop at a gated `ab-wave`; the owner says "land", which means merge
   to main and push.

## Warnings
- **selfboot is checked out on `ab-wave`.** Do not run `npm run serve` from selfboot against the real DB
  (`C:\Users\Owner\bootquest\bootquest.db`) until the wave lands. It would apply migrations 017/018 to the owner's
  ledger, and any later DDL change would then trip the checksum lock.
  - To use the app meanwhile, run `git -C C:/Users/Owner/Desktop/selfboot switch main` first. Untracked files stay;
    this folder is committed on ab-wave only.
  - The server already running on :4178 was started from main and is unaffected.
- `GET /api/dashboard` writes today's slate row: even read-only probes of the live server have that side effect.
- Owner items to report at the end, collected so far:
  - Wave C was deferred by the council.
  - The 80% app floor differs from the "suggested pass: 70%" in 81 DESIGN IT prompts.
  - Every study quest declares only `code-reading`, so all lapses demote one competency.
  - The §7.4 two-choice quizzes need a factory change and a restamp.
  - The frozen wrong items stay frozen.
  - The Fable review is still owed.
