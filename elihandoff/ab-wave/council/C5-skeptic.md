# C5 SKEPTIC / SCOPE CRITIC: ruling on the ab draft plan (2026-10-30)

Read: DRAFT-PLAN, REVIEW-2026-10-30 (full), elihandoff/README, R1-R4 (skimmed; R4 read in depth), docs/DOGFOOD.md.
Read-only. No server calls made (note: `GET /dashboard` is NOT side-effect free: it composes and writes today's slate).

## 1. Spot-checks of the central claims (code at selfboot `ab-wave` = a4fe7def)
| Claim | Verdict | Evidence |
|---|---|---|
| Demotion is dead | HOLDS | `study-quest.ts:66-98` enqueue/addReviewItem pass no competencyId; `ladder.ts:147-148` inserts `competency_id NULL`; `fsrs.ts:180` gates on `competency_id !== null` |
| ...and fixing it changes little now | NEW | every competency is at 1 and `demote` floors at MIN (`evidence.ts:424`): a fix today writes "demotion 1→1" rows on every lapse. Retest cards can never be graded by recall (`fsrs.ts:162` WRONG_UNIT_KIND), so competencyId on retest cards is moot. Promotion needs leg c, and the estate has 1 live retest unit (R4) |
| Slate = 21 actions day one | HOLDS (22 slots-worth; 21 counted) | `streak.ts:91,171-184`: 4 tracks × 5 + campaign + review. The review slot is ALREADY shown "nothing due" and excluded from X/N (`Dashboard.tsx:50-57`), so A1's "hide review slot" is mostly done |
| ...and it is a crushing day | OVERSTATED | `streak.ts:358-366`: ≥20 XP = `partial`, streak kept. Two difficulty-1 drills keep the streak. A "missed" day while streak=0 costs nothing (§7.1 is cosmetic) |
| `[wN]` parsed nowhere | HOLDS | no `[w` parse in client/server/shared/tools; `LadderPanes.tsx:609-611` covered÷total. BUT the prefix is in the served kp text (`content/seed/explainback/agora--…/items.json` "text": "[w3] …"), so weights can be computed server-side in `ladder-service.ts` (not fingerprinted) with ZERO factory/shared change |
| Hint 3s are solutions | HOLDS but INVISIBLE | `sysdrills/01-estimation.json:64` "return (dau * requestsPerUser) / 86400;". Hints are never served: `shared/src/api.ts:386` "hints (not served yet)", `service.ts:216` whitelist, no `hints` in `client/src`. The K1 task-line formulas ARE served, and sysdrills 01 is the sysdesign slate's day-one set |
| api.ts forces a restamp | HOLDS, avoidable | fingerprint is an import-graph walk (`fingerprint.ts:17`, pinned list `fingerprint.test.ts:28`). New schemas in a non-barrel subpath module (e.g. `@bootquest/shared/ab`) not imported by api/index would stay outside the walk: spike it with `restamp:all -- --dry-run` before committing to a half-day restamp |

## 2. The case for cutting
- 994 commits; since 10-10, 774 touched content and 99 touched server/client. LEARNING.md has no `dogfood` section;
  DOGFOOD.md was never run. R4 itself says "the highest-value next step is to dogfood two weeks and then re-read §2
  against real data". Every A3/A4/A5 design choice is a guess about a learner with zero rows. This plan is better aimed
  than past waves, but 7 parallel streams + round 2 still optimises agent throughput, not the owner's first hour.
- The estate is 5,076 units; JS alone 3,972. Nothing the owner can reach in a month is short of content.
- **What the plan misses (what would get the app opened daily):** (a) launching takes two terminals, an env var and a
  Vite dev server; the API does not serve a built client (no static serving in `server/src`). A one-command start
  (`npm run app` / desktop `.cmd`: serve + built client + open browser) is S and beats any panel. (b) R4 P13
  `bootquest today --notify` toast + documented Task Scheduler entry; fix `today` swallowing errors with exit 0
  (`cli/src/program.ts:226-231`). (c) A first-visit "pick 1-2 tracks, size 3" card (A1 settings surfaced in the UI,
  not only CLI). (d) An acceptance gate: DOGFOOD day 1 walked on a COPY of the real DB.

## 3. Stream verdicts
- **S1 slate (KEEP, grow):** + launcher, notify, `today` exit code, first-visit track picker, slate `targetUnitId`.
  Sole owner of `Dashboard.tsx`.
- **S2 truth layer (TRIM):** competencyId on quiz-miss/flashcard only; no evidence/demotion when rating = MIN; cap 1/day;
  queue paging (cheap; 200 due is weeks away). DROP "confirm on Again": friction on the honest grade is an honesty
  regression; use a post-grade banner. Decide the multi-competency unit rule explicitly.
- **S3 weak spots (TRIM):** alt sets under Due now + gap by score (S) are real; start storing `missedIds` JSON now.
  Ship `GET /stats/weak`; defer the panel/teaser until there is data to design against.
- **S4 find (CUT most):** palette, `/repo/:name`, windowed browser are UI surface for a learner who has not opened the
  dashboard; 841 KB in 0.2 s locally is not pain. Move `targetUnitId` to S1; mixed drill mode optional.
- **S5 weights (AMEND):** weight server-side from the existing prefix, keep the prefix as served, unweighted legacy =
  plain coverage, lint refusal in `elihandoff/tools/eblint.mjs`, not `factory/`. Defer blind mode (new UX, no data).
  Take the payments-lab q0.kp6 false cite (B3 W1). Net: no restamp from S5.
- **S6 sysdrills (KEEP, reorder):** task-line formulas in 01-03 first (day-one visible), then 04-14; importer gates;
  trap tests. Hint-3 rewrites last (invisible until hints are served). Retire/merge 4 OK, pins by counting.
- **S7 repair (CUT B2, KEEP B3 lint):** the 66 doc-recall stems sit in netcalendy/openstatus/tracer/j2 layers the owner
  will not reach for weeks, and every edit risks slot-hash drift; redo them when dogfood flags them. eblint is a
  durable gate: keep. Flashcard trims only for packs in act 1-2.

## 4. Rulings
- **Q1 AMEND:** round 1 = trimmed A + B1/B3. **No round 2 this session.** Wave C repeats the mx pattern the qw wave had to
  prune, and is guesswork before any usage; C1 would also add a 5th drill set to the slate.
- **Q2 AMEND:** keep 7 agents, not 7 code streams: S1(+targetUnitId), S2, S3, S5, S6, S7 = B3 eblint + EB fixes, and one
  day-one QA agent (first hour on a DB copy, phone width, launcher; then ring reviewer). One owner each for
  `Dashboard.tsx` (S1) and `shared` additions. Clones must branch from local `ab-wave` a4fe7def (the handoff commit is
  unpushed; `origin/main` lacks REVIEW, templates, `tools/slotcheck.cjs`), not the §6.14 `origin/main` recipe.
- **Q7 CONFIRM gated `ab-wave`, AMEND:** no local main merge. Before stopping, put selfboot back on `main` or say why not:
  migrations 017-019 hit the owner's real DB on the next `serve` from `ab-wave`; test that main's server still starts on
  a migrated DB copy (rollback path), and report it.
- **Q8 cut:** command palette, repo dossier, windowed browser, blind mode, weak-spots UI, B2 stems, hint-3 rewrites
  (defer), "confirm on Again", all of wave C.
- **§7.1 CONFIRM** (cosmetic, a few lines). **§7.2 AMEND** (fix + cap + MIN guard; no Again confirm). **§7.3 CONFIRM**
  (baseline in eblint). **§7.4 OVERTURN for this wave:** defer both options (22 items; a re-seed churns frozen generator
  items); revisit if a pack sits in act 1-2. **§7.5 CONFIRM** frozen; corrective notes only for early-act items
  (netcalendy already has x-q27). **§7.6 AMEND:** trimmed A + trimmed B; C only after a dogfood log exists. **§7.7 CONFIRM.**

## 5. If only 5 of 7 finish, keep
1. S1 slate + first run + launcher/notify (the only stream that changes whether the app gets opened)
2. S6 sysdrills task-line fix (day-one visible content defect) + importer gates
3. S5 weights server-side + payments-lab cite (removes a cosmetic-honesty lie; no restamp)
4. S2 trimmed (competencyId + MIN guard + cap + paging)
5. S7-as-B3 eblint gate (protects every future wave)
Cut first: S4, then S3's UI.
