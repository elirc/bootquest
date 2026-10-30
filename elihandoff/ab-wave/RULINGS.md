# ab wave: orchestrator rulings after the council (2026-10-30)

Council files: `council/C1-learning.md`, `C2-architecture.md`, `C3-content.md`, `C4-ops.md`, `C5-skeptic.md`.
Hub branch: selfboot `ab-wave` = `48767583` (server suite 640/640, 697/697 stamps fresh): a4fe7def review docs; 48766165 `shared/src/api-ext.ts` skeleton;
56eb163d migrations 017/018 (DDL, owned by S1/S5 from here; changing them = ask the hub) + `shared/src/eb-weight.ts`.
Every stream branches from it: `git fetch origin ab-wave && git switch -c ab-s<N> origin/ab-wave`.

## R1 Scope
- Round 1 = wave A (trimmed) + wave B (trimmed), 7 streams. **Wave C is deferred** (C1, C5: the owner has 0 XP and
  5,076 units; dogfood first; C1 jsdrills would also add a 5th drill set). Reported to the owner as a council ruling
  they can overturn. Wave D out of scope. No housekeeping deletes. No push.

## R2 Restamp-free wave (C2 design; C4's one-restamp is the fallback)
- `shared/src/api.ts` and every other fingerprinted file stay byte-identical. New schemas and `.extend()`ed strict
  DTOs go in `shared/src/api-ext.ts` (own section per stream). Verified: 697/697 fresh with the module present.
- Forbidden for every stream: `shared/src/{api,index,pack,seed-pack,check,schemas,enums,campaign,mutation,sync,
  thresholds}.ts`, `tools/seed/src/factory/**`, `tools/seed/src/validate/**`, `server/src/api/runners.ts`,
  `server/src/runners/**`, `server/src/api/runner-{csharp,java}.ts`. Need one? Stop and ask the hub.
- Every stream finishes with `npm run restamp:all -- --dry-run` = all fresh. If it is not, you touched a bound file.
- Stamps: commit the stamps a re-import / re-seed writes for the packs you changed (S6 sysdrills, S7 quest/notes/EB
  packs). Never commit restamp-only churn.

## R3 Owner decisions (REVIEW §7) — council stand-in rulings, all reported
1. Phantom missed days: display-only remap; days before the first learner action (earliest attempt, review_log or
   xp_event) render `none`. Closed rows untouched.
2. Demotion: FIX, trimmed. competencyId on quiz-miss + flashcard cards (not retest: `fsrs.ts:162` never grades them);
   cap one demotion per competency per day; no demotion row at the rating floor. **No `lapseWouldDemote` confirm**
   (it would teach the learner to press Hard instead of Again). Report: every study quest declares only
   `code-reading`, so all lapses land on one competency (owner may want a per-window cap later).
3. Frozen leaks: accept + record. S7's new lint carries a shrink-only baseline (stale entry = failure) of pairs frozen
   on both sides; anything new fails. No unfreezing, no set-B re-authoring.
4. Two-choice generator quizzes (22): **deferred**. Both fixes need a fingerprinted factory change (restamp of every
   quest pack); not worth breaking R2 for. Recorded for the next restamping wave (C3's `generate.ts` skip is the fix).
5. Frozen wrong items: stay frozen, no caveat notes this wave (owner item).
6. Wave order: A + B now; C after the owner has a dogfood log.
7. Housekeeping: not done.

## R4 Design rulings
- A1: append-only `slate_setting` rows (migration **017**), effective **tomorrow**, read as-of the day. Unconfigured
  default = 1 drill per slate track + campaign step (5 actions), stable within the day; `--preset full` = today's 4×5.
  No auto-ramp. Review slot hidden until a review card existed before day start. Client "Choose your focus" card.
- A2: client-only queue paging (refetch while `count > items.length`, no offset). A repeat quiz miss re-grades the
  card as `again` (R4 L3).
- A3: `GET /stats/weak` + Stats panel; dashboard teaser hidden when there is no data; alt sets due listed in Due now.
  Alt-set gap scaled by score: deferred (no data).
- A4: server-side `GET /units/search` (key + title only, campaign units included with the act lock), Ctrl+K palette,
  dashboard `targetUnitId` in the response DTO only (never in stored `SlateItem`), fan-out removed, mixed drill mode
  (deterministic), unit browser groups collapsed by default. Repo dossier page: only if budget remains.
- A5: `[wN]` stays in stored + served text; runtime `kpWeight()` in a new non-fingerprinted `shared/src/eb-weight.ts`.
  Gate for weighted sets = weighted ≥ 80% AND every w3 covered (the app's 80% floor stays; the prompts' "70%" is
  reported as an owner item). Migration **018** `eb_score_detail` (plain, weighted, w3_missed, missed_ids) also feeds
  A3. One pass predicate shared by evidence/ladder/xp/ladder-service. Legacy unweighted sets behave exactly as today.
  Blind toggle: client-only, if budget remains.
- B1: task-line formulas → hint 2 and hint 3 → prose across 01-14 (drills are not under the AGENTS.md freeze clause;
  hints are unserved; ruling recorded in SEEDING §8 by the hub). Two importer gates + refusal tests. Trap test only
  where a real naive variant exists. **No retirements, no difficulty relabel** (F0.2: a missing pack unit stops the
  owner's server from booting). Declare duplicates/twins in descriptions only.
- B2/B3 (S7): lint in `tools/seed/src/ops/` (not `factory/`), wired into `seed:lint:leaks`; editable doc-recall stems
  only (freeze line = items present at `9b7f0ea3`); never dilute with new items.

## R5 Machine rules (2.1 GB RAM free at dispatch)
- HEAVY lock, one holder machine-wide: `mkdir C:\Users\Owner\Desktop\bootquest-handoff\ab\locks\heavy` (fails if
  held: wait 60 s, retry), `rmdir` when done, even on failure. Covers: client suite, full server vitest, tools/seed
  vitest, smoke:api, demo:promotion, seed:validate, seed:check, test:csharp/java.
- MEDIUM lock, two holders: `locks\med1` or `locks\med2` for `npm run typecheck`, client typecheck, the lints,
  restamp:all dry-run.
- vitest `--maxWorkers=2`. Never restart or POST to the owner's server on :4178. Run tests against their own temp DBs.
- Migrations: only 017 (S1) and 018 (S5) exist this wave; `migrate.ts` throws on a gap.
- Merge order at the hub: S6, S7, checkpoint; S2, S1, S5, S3, S4.
- Landing: stop at a gated `ab-wave`; selfboot back on `main`; the owner says "land".
