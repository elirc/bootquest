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

## Not done (paused)
- The 7 stream agents were dispatched and then stopped within minutes. **Nothing was committed in any clone.**
  - Branches `ab-s1..ab-s7` exist in `C:\Users\Owner\Desktop\bq-qw-s1..s7`, each at `origin/ab-wave`.
  - Only bq-qw-s2 has an uncommitted partial edit, to `server/src/engines/fsrs.ts`. Review it or discard it with
    `git -C C:/Users/Owner/Desktop/bq-qw-s2 checkout -- server/src/engines/fsrs.ts`.
- Still to do: run the streams, ring review, hub integration, the battery, the SEEDING §8 bullet, and the README census.

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
