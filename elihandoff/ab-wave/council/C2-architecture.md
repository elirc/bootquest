# C2 ruling: architecture and integration (ab wave draft, main 772b19cb)

## Q3 restamp (decides how Q2 integrates): AMEND: make wave A restamp-free
- Why: `shared/src/pack.ts:2` imports `api.ts`, so api.ts is fingerprinted. The server refuses stale seed stamps at boot (`store/seed-items.ts:214`).
  In every clone that edits api.ts (S1-S5), `ladder-real`/`study-quests`/`notes` tests and `smoke:api` fail until a half-day restamp (5 in parallel
  won't fit in 16 GB), so streams would in practice report without their real-content gates.
- Change: api.ts stays byte-identical. The hub adds `shared/src/api-ext.ts` with subpath `./api-ext` (precedent: `./thresholds`); index.ts and
  pack.ts never import it. Existing strict responses grow there with `.extend()`, and app.ts parses with the extended schema. With the A5 design
  below, no stream touches a fingerprinted file. Hub gates: `fingerprint.test.ts` unchanged + green, `restamp:all -- --dry-run` 0 stale; else one hub restamp.

## Q2 stream split: AMEND (re-cut S3/S5, hand out the hotspot files, land a contracts commit first)
1. **Contracts commit on `ab-wave` before anyone branches** (hub, about 1 h): migrations 017/018 (DDL), an api-ext.ts skeleton with one section per
   stream, ApiClient stubs in `client/src/api/{types,http,mock}.ts`, and empty `registerS<n>Routes(router, deps)` lines in app.ts. All routes live
   in app.ts today (`app.ts:171-443`). The draft's hotspot list leaves out app.ts and the client api trio, and every stream edits both.
2. **Move from S3 to S5** the missedIds storage, the alt-set gap by last coverage and the `altSetsDue` computation. Self-score
   (`ladder-service.ts:476-530`), practice-score (`:585-645`) and `ebSetGate` (`:310-323`) are the same code A5 rewrites, and the gap keys off the
   score A5 redefines. S3 keeps `/stats/weak`, Stats panel, teaser, altSetsDue rendering. S5 has room (its factory work mostly disappears).
3. **Drop the retest card from A2.** `fsrs.ts:162-164` refuses to grade `retest` rows, so `competency_id` at `ladder.ts:147` is cosmetic.
4. Don't merge S1+S4 or S2+S3: with getDashboard owned by S4 they overlap in one function each.

| Hotspot file | Owner | Others (rule) |
|---|---|---|
| shared/src/api.ts | frozen | none (fingerprint) |
| shared/src/api-ext.ts (new) | hub skeleton | S1-S5 append in own section only |
| shared/src/eb-weight.ts (new, not fingerprinted) | S5 | S7 eblint imports it |
| server/src/api/app.ts | hub | streams register routes from their own new files |
| service.ts `getDashboard` (`:764-806`) | S4 (targetUnitId) | S1 none: the phantom-day remap goes in `slateStatuses` |
| store/queries.ts | S4 (new fns appended) | S1 `slateStatuses` only; S2 `reviewQueue` only |
| engines/streak.ts / fsrs.ts + study-quest.ts | S1 / S2 | none |
| ladder-service.ts, evidence.ts:298, ladder.ts:275, xp.ts:139 | S5 | S3 reads only |
| Dashboard.tsx | S4 (`:26-30` fetch, `:265-393` slate) | S3 `DueNowPanel :204-246` + teaser mount; S1 one link; new UI in new files |
| Review / LadderPanes / TrackUnits / Stats.tsx + stats-service / cli program.ts | S2 / S5 / S4 / S3 / S1 | none |
| client/src/api/{types,http,mock}.ts + fixtures | each stream, own block | dashboard.json: S4; hub resolves |
| ladder-real pins, `*_EXPECTED`, migrations dir; api.test.ts | hub; append-only | streams prefer new test files |

Merge order: contracts, S2, S1, S5, S3, S4, then S6/S7.

## Migration numbering: AMEND
- `migrate.ts:36-37` throws on a numbering gap, so a reserved number that never ships breaks boot. Only 2 migrations are needed, both created in
  the contracts commit: **017_slate_settings** (S1), **018_eb_score_detail** (S5). S2/S3 need none (cap derivable from `evidence`; 0 live cards).

## A1 design: AMEND
- Storage: append-only `slate_setting(id, track_id, enabled, size NULL, effective_day, created_at)` with UPDATE/DELETE triggers like migration 003.
  `slateStructure(db, day)` (`streak.ts:171-184`) reads the latest row per track with `effective_day <= day`. Without a row it falls back to
  `track.slate_drills` and DRILL_SET_SIZE. `track.slate_drills` is never UPDATEd.
- **effective_day is always tomorrow.** Today's open row is refreshed from the current structure (`:296-306`). A setting that applied at once would
  let the learner switch tracks off at 23:00 and complete the day, and it would change today's slate, which the acceptance criterion forbids.
  No-row past days are re-derived through `slateStructure` (`:348`), so as-of reads keep closed days immune.
- First-run default: `size = min(setting ?? 5, R, ramp(activeDaysBefore(dayStart)))`, judged at day start like R (`:147-168`), so it is ledger-pure
  and stable within the day. With 4 slate tracks plus campaign, "≤ 8 actions" forces ramp size 1 (4·1+1 = 5); size 2 gives 9. S1 owns the
  existing size-5 expectations (streak.test.ts, cli tests, client fixture).
- Review slot: hidden when no non-retest `review_item` has created_at < day start. An empty slate never completes (`streak.ts:125-127`): partial only.
- Phantom days: remap at display only. In `slateStatuses` (`queries.ts:165-171`), `missed` before the first attempt day becomes `none`. Don't touch
  `closeElapsedDays`. The cause is `GET /dashboard` opening a slate row (`service.ts:777`), which `firstActivityDay` (`streak.ts:318-323`) counts.

## A2 design: AMEND
- competencyId: `enqueue` (`study-quest.ts:66`) takes `unitCompetencies(unitId)[0]` (`queries.ts:47-55`). **Fact: every study-quest unit declares
  exactly `code-reading`** (`store/study-quests.ts:39,154`; GET /units/3990, /4200), so all quiz-miss and flashcard lapses estate-wide land on one
  competency. Any Review-state lapse among hundreds of cards a day means code-reading is demoted almost daily, and a 1/day cap doesn't prevent
  that. Owner call: also cap at one demotion per competency per promotion window, or accept 1/day knowing the effect.
- Cap mechanics: in `fsrs.ts` `review()` before `demote` (`:186-188`), check `EXISTS evidence kind='demotion' AND competency_id=? AND created_at IN dayBounds(dayKey(t))`.
  A capped lapse still writes review evidence; `review_log.demotion_evidence_id` stays NULL. `lapseWouldDemote = competency && state == Review && rating > 1 && !cappedToday` (without `rating > 1`
  the confirm fires on every Again: every competency is at 1).
- Paging (BUG-2): client-only fix. When `count > items.length`, Review.tsx refetches `/reviews/queue`: graded cards have left the due set, so the next
  fetch is the next batch. **No offset param** (offset over a shrinking set skips cards); `ReviewQueueQuery` (`api.ts:138-147`) unchanged.

## A4 design: AMEND
- Size, measured on the live server (GET): the slim index (id, key, title, kind, track, state) is **775 KB for 4,738 units** (76% of the full 1.02 MB;
  110 KB gzipped; app.ts has no compression). Titles repeat ("Quick check"), so search needs the key, and that is not slim. **Use server-side
  `GET /units/search?q=&limit=30`** over key + title only, never seed item text (prompts, kps, notes). Add `GET /repos/:name` for the dossier.
- Coverage gap: `unitsForTrack` (`queries.ts:96-101`) excludes `campaign/` units, which are the 146 study quests. Search must add them with the act
  lock from `campaignState`. A locked act shows title + `locked`; opening it hits the existing `actGate` (`service.ts:174-191`).
- targetUnitId: computed in the `getDashboard` response mapping and added to SlateItemDto in api-ext. **Never put it in `SlateItem`**: that JSON is
  stored in `daily_slate.items` (`streak.ts:291,306,371`) and frozen in closed-day snapshots. The drill target is the first passable, unrevealed
  drill. `nextUp` (`service.ts:782-788`) picks any kind, so it is not the drill target. Mixed mode is deterministic (day + pass count, no Math.random).

## Q5 / A5 design: OVERTURN "parse `[wN]` into a `weight` field"
- Keep `[wN]` in the stored and served text, and derive the weight at runtime with `kpWeight(text)` (`eb-weight.ts`). The client strips the prefix
  for display and shows a chip. Restamp re-validates shipped items byte-identical (`factory/check/check.ts:13,42`), so the 136 weighted sets
  (of 244; 108 unweighted; 0 mixed) would never gain the field without a re-seed. A re-seed changes `seedItemHash` (`seed-items.ts:193-194`), which
  supersedes answer records, so runtime parsing is needed anyway. The lint refusal goes in non-fingerprinted `tools/seed/src/ops` (or S7's eblint),
  not `factory/`. Weights show only via the key endpoint, after the answer is stored: no leak.
- Gate: the code enforces 80% in four places: `evidence.ts:298`, `ladder.ts:275`, `xp.ts:139`, and `effectiveMinCoverage` "never laxer"
  (`ladder-service.ts:270-274`). The frozen prompts say "suggested pass: 70% with every [w3] hit". Ruling: **weighted ≥ 80% AND every w3**. Going to
  70% lowers the truth-layer floor (owner call). Report the prompt-vs-app mismatch.
- Storage: `evidence.score` = weighted coverage for weighted sets and plain coverage otherwise (legacy behaviour is identical). Migration 018 adds
  `eb_score_detail(evidence_id PK, plain, weighted, w3_missed, missed_ids JSON)`; it also serves A3. One exported `EB_PASS_SQL`
  (`score >= floor AND NOT EXISTS detail.w3_missed > 0`) replaces the three SQL comparisons, so promotion, XP and the leg display can't disagree with
  `passed`. Legacy rows have no detail row: unchanged.
- Blind `[senior]` (57 sets): client-only toggle split on a fixed marker sentence; no seed/API change. Low value (Q8 candidate).
