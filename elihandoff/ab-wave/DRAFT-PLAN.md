# ab wave: draft orchestration plan for the council (2026-10-30)

Owner order (verbatim): "review plan in elihandoff and implement, use 7 opus agents, council of 5 agents to review
high level choices".

Source plan: `C:\Users\Owner\Desktop\selfboot\elihandoff\REVIEW-2026-10-30.md` (§4 waves, §5 briefs, §6 tips, §7
owner decisions). Detailed findings: `...\elihandoff\review-2026-10-30\R1..R4`. Contract: `selfboot\AGENTS.md`.
`main` = `772b19cb`. The owner is not reachable mid-wave: the council's rulings stand in for §7 where the call is
reversible, and every such ruling is reported to the owner.

## Facts the orchestrator re-checked today
- Live DB still has zero usage: `xp.total` 0, streak 0, 16 "missed" heatmap days (2026-10-15..29). So §1 holds and
  wave A goes first.
- `shared/src/api.ts` (and `index.ts`, `schemas.ts`, `enums.ts`, …) is inside the seed fingerprint set
  (`tools/seed/src/factory/fingerprint.test.ts:28`). Every wave-A stream that adds an API schema stales every seed
  stamp, not only A5. A restamp (`seed:check -- --restamp` then `seed:check`, ~half a day foreground) is therefore
  unavoidable if any of A1-A5 ships.
- Migrations end at `016_sysdesign_slate_drills.sql` (`server/src/db/migrations/`). `track.slate_drills` is a 0/1
  CHECK column.
- 7 reusable clean clones: `C:\Users\Owner\Desktop\bq-qw-s1..s7`. Disk 13 GB free, 16 GB RAM.

## Proposed scope
- **Round 1 (7 streams):** wave A (A1-A5) + wave B (B1-B4). Integrate on branch `ab-wave` in selfboot, one restamp
  at the hub after all merges, full battery.
- **Round 2 (same 7 agents, after round 1 integrates):** wave C (C1-C5), branched from `ab-wave`. Content-only
  except C1 (new importer; must be verified not fingerprinted).
- **Out of scope:** wave D (needs a new owner repo or owner product calls), housekeeping deletes (remote branch,
  clones), pushing. The orchestrator stops at a gated `ab-wave` (and maybe a local merge to main) and reports; the
  owner says "land".

## Proposed round-1 streams (one clone each, disjoint ownership where possible)
| Stream | Clone | Scope (REVIEW §4/§5) | Main files |
|---|---|---|---|
| S1 slate | s1 | A1: `PUT /settings/slate`, `bootquest slate`, smaller first-run default as a pure function of the ledger, hide review slot while all-time cards = 0, pre-first-attempt days render `none` | streak.ts, new settings-service.ts, migration 017, cli, Dashboard.tsx (slot) |
| S2 truth layer | s2 | A2: competencyId on quiz-miss/flashcard/retest cards, demotion cap 1/competency/day, `lapseWouldDemote` + confirm on Again, review queue paging, tests | study-quest.ts, ladder.ts, fsrs.ts, Review.tsx, migration 018 if needed |
| S3 weak spots | s3 | A3: `GET /stats/weak`, Stats panel + dashboard teaser, `missedIds` JSON on evidence, alt sets due listed under Due now, alt-set gap by last coverage | stats-service.ts, ladder-service.ts, Stats.tsx, Dashboard.tsx (teaser), migration 019 |
| S4 find | s4 | A4: `GET /units/index`, Ctrl+K palette, `/repo/:name` page, mixed drill mode, slate `targetUnitId` (kills the fan-out), windowed unit browser | queries.ts, service.ts, new client components, TrackUnits.tsx, Dashboard.tsx (fetch) |
| S5 weights | s5 | A5: `[wN]` → `weight`, weighted self-score + w3 gate for DESIGN IT/G2, blind toggle for `[senior]`, lint refusal for unweighted DESIGN IT/G2 kp; B4 `[wN]` docs | factory/explainback/*, shared seed-pack.ts, ladder-service.ts (self-score), LadderPanes.tsx |
| S6 sysdrills | s6 | B1 in full (hint 3 prose, task formulas → hint 2, trap tests, difficulty relabel, 4 retire/merge, twins declared, 2 importer gates + refusal tests) + B4 drill docs + csdrills hint-2 thinning if budget | authoring/sysdrills/01-14, src/sysdrills/import.ts, source.ts |
| S7 repair | s7 | B2 (66 doc-recall stems, flashcard backs, ww7 explanations, nettrello dup, 2-choice quizzes per §7.4 ruling) + B3 (cites, markers, K4 kps, new `elihandoff/tools/eblint.mjs`) | content/seed-drafts/quests/*, authoring/explainback/*, elihandoff/tools/ |

Hotspots the hub resolves at merge: `shared/src/api.ts` (S1-S5 add schemas: each stream appends in its own
delimited block), `Dashboard.tsx` (S1, S3, S4), `service.ts` (S1, S4), `ladder-service.ts` (S2?, S3, S5),
`ladder-real.test.ts` pins (hub only).

## Proposed rulings on REVIEW §7 (council: confirm, amend or overturn)
1. Phantom missed days: render days before the first recorded attempt as `none`. (reversible, display semantics)
2. Demotion: fix the rule with a one-per-competency-per-day cap (the README and Review page already promise it).
3. Frozen leaks (≈20 pre-mx EB↔note verbatim pairs + V7): accept and record; the new eblint baselines them as
   known pairs and gates anything new. No unfreezing (AGENTS.md "existing items stay byte-identical").
4. Two-choice generator quizzes (22): since a restamp happens anyway this wave, the factory min-3 rule is cheap
   now; but it would refuse 6 existing packs, forcing re-seeds that retire frozen generator items. Proposed:
   re-seed the 6 packs with `--exclude` + hand items, no factory rule. (Open question.)
5. Frozen wrong items: stay frozen; S7 adds a corrective note where the pack has none (new text, no frozen edit)?
6. Wave order: A + B, then C.
7. Housekeeping: not done (destructive/outward-facing, owner decision).

## Proposed process rules
- Streams never commit restamped `validation.json` (merge conflicts across thousands of files); the hub restamps
  once. Streams that need a fresh stamp to run `smoke:api` restamp locally and discard (`git checkout -- content`).
- Migration numbers assigned up front: S1 017, S2 018, S3 019 (S5 020 if needed).
- Council (5) now; then the 7 stream agents get COMMON-brief + per-stream brief; claims file for content repos;
  ring review S1→S2→…→S7→S1 after stop reports; fixes as new commits; hub integrates, restamps, runs the battery.

## Questions for the council
Q1 Scope: is round 1 = A + B, round 2 = C right for 7 agents, or should C start in parallel with B?
Q2 Stream split: is the 7-way split balanced? (S7 carries two M streams; S1/S4 both touch the dashboard fetch.)
Q3 Restamp strategy: one hub restamp after integration vs. moving new API schemas to a non-fingerprinted module.
Q4 Each §7 ruling above.
Q5 A5 design: strip `[wN]` from served text or keep it; weighted gate thresholds (weighted ≥ 70% AND every w3).
Q6 A1 "smaller default when no attempts": what size, and should it stay small until N days of activity?
Q7 Landing: stop at a gated `ab-wave`, or merge to local `main` (never push) once the battery is green?
Q8 Anything in the plan the council would cut as low value for a learner who has not started yet.
