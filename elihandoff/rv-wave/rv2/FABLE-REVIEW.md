# rv2: Fable adversarial review (PLAN §5 gate)

Reviewed 2026-11-14 by Fable. Hub `C:\Users\Owner\Desktop\bq-f52-hub`, branch `rv-wave`.
Code and the first probes ran on `d8967cac`; the S2b C# topics 21-23, the re-counts, the restart probe and the 390 px
walk on `3264edb3`. Review only: no fix written, no commit, nothing edited in the hub or a clone.

**Verdict: not ready to land.** The honesty rules, XP caps, migrations, counts and bound files hold. Four things are
broken or cannot work (F1, F2, F7, F11) and six more must be fixed first (§4). All are scheduled in `../rv3/PLAN.md` §3.1.

**How it was checked.**
- Diff `499a4496..rv-wave` read for the server, the lint and the main client pages; `dc2206bc..rv-wave` for bound files.
- Sandbox: the owner DB copied read-only with `copydb.cjs` (schema 18, 0 attempts), the hub server on port 4390 with a
  settable clock and a scratch copy of the side files (`BOOTQUEST_KEYIDEAS`, `BOOTQUEST_ROUTING`), UI on 5390. Probe
  scripts `p1.mjs`-`p7.mjs`, `census.cjs`, `walk.json` and the launcher are in
  `C:\Users\Owner\AppData\Local\Temp\claude\c3385c767fed3579\ab1aa697-5ee4-4bb9-858f-49a59fa4aa1f\scratchpad\rv2\`.
- Content: two read-only Opus readers (key ideas / headlines / path; C# 21-23 and the 16 C# bug hunts). I re-checked
  their strongest claims against the files; the rest is their reading, marked "(reader)".

**Not done** (§6): the server, selfrun, client and CLI suites (the battery was killed for low memory mid-run),
`smoke:api`, `demo:promotion`, `seed:demo:planted`, `test:csharp`, `test:java`; a gate pass, a recap and a card grade
clicked through the UI (they were driven through the API).

## 1. Verdict per §5 item

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Bound files | **Pass** | `git diff --stat dc2206bc..rv-wave` over `server/src/runners`, `api/runners.ts`, `runner-*.ts`, `tools/seed/src/factory`, `shared/src`: only `shared/src/api-ext.ts` and `shared/src/eb-weight.ts` changed, both outside the seed closure. Battery `restamp:all -- --dry-run` rc=0 on `3264edb3`. |
| 2 | Honesty | **Pass** | After 28 passes, 1 recap, 1 re-check, 2 redo runs, 31 notes, 163 card grades and 1 interview answer: `practice_log` has 0 rows; no evidence row came from a concept card (the 117 review-evidence rows are the 117 competency-linked flashcard and quiz-miss grades); the redo runs wrote 0 attempts and 0 evidence. Farming: "again" 20 times on one card = 1 XP, then 19 × `NOT_DUE`; 162 cards graded in a day = 30 XP (daily cap); the recap replayed 3 times = `ALREADY_SCORED`, 20 XP once; a not-due card, a parked redo and a bare redo or re-check grade are refused. |
| 3 | Leaks | **Pass with findings** | With nothing passed, `GET /keyideas` returns 186 ideas and none carries `prompt`, `answer` or `why` (raw body searched for the text). After the gate only (1 of 2 sources): still hidden, reveal 403. Recap prompts carry no answer; reveal needs 8 words first. `ebmiss` cards: 3 per attempt, `[w3]` first. The lint rejects an empty `sources` (`keyideas-lint.test.ts:103`) and so does the reader. Findings: F4 (the `idea` sentence is served before the sources pass) and F9 (cards and pretest checks paraphrase gate keys in C# 21-23). |
| 4 | Robustness | **Pass with one finding** | Live (store reloaded): a truncated `fund-js-core.json` is skipped with one warning and every route stays 200; an empty `sources` is refused by the reader; with no `content/keyideas/` the API returns no sections and the dashboard loads; a bad `headlines.json` is ignored. Restart on the same DB with one idea removed, one file made invalid JSON and one source archived: the server starts, the removed idea's key-idea and redo cards are retired, the invalid section is absent, the idea with the archived source stays met, no queue card is without text. Finding F3: a redo card whose idea lost its siblings stays out for good. |
| 5 | Flood | **Pass, one gap** | 13 gates + 13 drills in one day: 11 key-idea cards due 4 / 4 / 3 over three days; 11 redo cards parked, one released per day. Gap F6: the recap re-enrols every "partly / missed" card for tomorrow, so 11 never-reviewed cards were due on one day. Notes have no cap (31 cards due on one day), bounded by the 30 XP review cap. |
| 6 | Content sample | **Fail on the path; pass with findings elsewhere** | Key ideas (75 read by the reader; 3 leak claims and 1 error re-checked by me): senior-relevant, prompts are scenarios; one wrong statement (F8); about a third of the Fundamentals `idea` sentences restate a gate key (F4); 6 ideas cite a source that does not teach them (L7). Headlines (11 sets): clean structure, about a dozen give the point away, the dimension follows the question number (L8). **Path: 2 of 18 steps are wrong and 5 are matched on a shared word (F7).** C# 21-23 and the 16 bug hunts read in full by the reader: no wrong keyed answer, no answer-position bias; findings F9, F10. rv2 added no kata. |
| 7 | Counts | **Pass** | My script: Fundamentals js 33 / 330 / 238 / 79, csharp 23 / 230 / 184 / 49, java 20 / 200 / 160 / 42 = `FUNDAMENTALS_EXPECTED`. Key ideas 24 files, **189** ideas (186 + 3 for C# 21-23). Headlines 107 sets, 2044. Card tags 142. Archive 880. Sysdesign path 18 steps, 34 sets. Every pack's unit count equals its manifest. Stamped content `499a4496..rv-wave`: only `fund-csharp` (new drills and topics) and one sysdrills hint line changed; C# topics 01-20 quiz items and cards are byte-identical (reader, by script). |
| 8 | Migrations | **Pass** | 023-027 contiguous, each append-only with the three triggers. The owner-DB copy went 18 → 27 at boot with 0 errors (`schema_version` has 27 rows); the pre-migration backup was written. |
| 9 | Live walk | **Pass, UI clicks partial** | Through the API with the clock moved: gate + drill → card due the next day → recap → re-check on day 14 → redo on days 3-6 → interview meta → week numbers. Headless at 390 × 844 on 12 screens (dashboard, key ideas, key-ideas session, 10-minute review, campaign, a Fundamentals topic with the pretest opened, a DESIGN IT set with interview mode started, stats, week, settings): no horizontal page scroll on any (`scrollWidth` = 390), no console error or exception. The Vite cold start took over 20 s; the first attempt rendered blank for that reason. |

## 2. Rulings on the deviations

| Deviation | Ruling |
|---|---|
| **Orchestrator: met = all live sources passed** (S1 dev. 1, S2 dev. 4) | **Confirmed.** It is what makes the xleak rule safe, and it holds in the API. Fundamentals ideas list `[gate, drill 1]`, and the Fundamentals step serves the gate and then the topic's drills (`nextstep-service.ts:60-72`), so cards do enrol on the default day. Campaign ideas (3 quests, 3 repos) enrol late; accepted, since the campaign is off the default slate. No "any source" switch now. |
| **Orchestrator: `recapAfter` whole count ≥ 2** (S1 dev. 2) | **Confirmed**, with F1 and F2. |
| **Orchestrator: redo parking via a far-future `due_at`** (S1 dev. 5) | **Confirmed.** No due count or queue saw a parked card and exactly one was out per day. Condition: fix F3. |
| **Orchestrator: a repeat pass returns `already-awarded`** (S1 0a) | **Confirmed.** For the docs: a Fundamentals gate passed after a failed first try still pays 50 XP (probe, topic 02). That is B's rule for study gates, not an rv2 change. |
| S1 dev. 3: side-file formats defined by the reader | Confirmed; S2 wrote to them and both parse. |
| S1 dev. 4: recap XP as `xp_event` kind `study-quest`, no unit | Confirmed (XpKind is bound). Stats counts it under study quests: say so in the docs. |
| S1 dev. 6, S3 dev. 10: one server commit for tasks 2-6; api-ext split per task | Accepted. |
| S1 dev. 7, S3 dev. 6: files outside the owned list (`xp.ts`, `hints.ts`, schema pins, `TrackUnits.tsx`, `confidence-service.ts`) | Accepted: each is the smallest place for the change and none is bound. |
| S1 dev. 8: read-only `bootquest review` | Confirmed. |
| S1 dev. 9: a retired card's grade is 404 | Confirmed. |
| S1 dev. 10: the dashboard review link opens `/review?ten=1` | Confirmed, with L1. |
| S2 dev. 1: two sections merge two binding rows to stay at 12 ideas | Confirmed. |
| S2 dev. 2: agentic ideas cite today's estate units | Accepted until rv3 W7 lands; then re-point them. |
| S2 dev. 5: scope = exact keys or `/` prefixes; Fundamentals scope = gates only | Confirmed for Fundamentals. For the banks and ladder sections see F2. |
| S2 dev. 6: 7 of 16 C# bug hunts use a bug the topic does not name | Accepted, with F10. |
| S2 dev. 7: C5, C6, C7 rest, C8 build not done | Accepted; rv3. C6 stays blocked on the owner. |
| S3 dev. 1: stale placeholder migrations moved out of the clone | Accepted. The orchestrator cleans each clone before reuse. |
| S3 dev. 2: the pretest is offered, not forced | **Confirmed.** PLAN says skippable. |
| S3 dev. 3: the merged panel sits after the fieldset | Confirmed. |
| S3 dev. 4: interview meta filed by the client after the answer, before the key | Confirmed. Probe: key 403 before the answer; meta refused before the answer, after the self-score and a second time; the meta changed no ledger count. |
| S3 dev. 5: `design-side.ts` reads `headlines.json` a second time | Accepted (L10). |
| S3 dev. 7: confidence tag on quiz gates and explain-backs only | Accepted; Player drills are rv3 W10. |
| S3 dev. 8: 10-minute window for a tag | Accepted, with L3. |
| S3 dev. 9: F10 not done | Accepted (ruling 9); rv3 W9. |

## 3. Findings

**High** = wrong content on the daily path, or a feature that cannot work. **Medium** = a plan rule is not met, or a
card can get stuck. **Low** = polish. "Live" = reproduced in the sandbox.

### High

**F1. A recap opens on one met idea, pays 20 XP and closes the section for good (live).**
`server/src/api/keyideas-service.ts:163-164` (`p.open && anyMet`), `:382` (prompts = met ideas only).
Scenario: pass 5 of the 6 `fund-js-platform` gates and one drill. One idea is met, the recap opens with 1 prompt, an
8-word answer pays 20 XP, the state is `done`. The other 5 ideas are never recapped. The campaign sections
(`recapAfter: 3`, ideas needing 3 quests from 3 repos) will nearly always open this way.
Fix: open only when the scope threshold is reached and met ideas ≥ min(3, live ideas). Test with 1, 2 and 3 met ideas.

**F2. Outside Fundamentals the recap threshold cannot be reached in practice.**
The scope is every unit of the bank or ladder and `recapAfter` is 0.8: `sysdrills` needs 104 of 129 drills,
`design-it` 28 of 34 self-scored sets, `agentic` 59 of 73, `review-katas` 42 of 52, `bank-bootforge` about 1400 of
1760 (`content/keyideas/*.json`; S2 reported the bank case). So the recap and the 14 / 45-day re-checks exist only for
the 7 Fundamentals sections.
Fix (side files): set `scope` to the union of the ideas' `sources`, or use a count; add a lint rule that the
threshold is at most 40 units.

**F7. `content/paths/sysdesign.json`: steps 11 and 15 are wrong, 5 more are weak.**
Ruling 7 asked for a hand review before interview mode shipped; the senior-rep slot walks this file.
- 11 replication-and-consistency → `organized-study-support-desk-crm/03c116f58e89` (outbox notifications; its
  "replicas" are worker processes) and `opusorganize/879d92385839` (saga vs 2PC): no quorum or lag maths. Use
  `javabootcamp/48f892a920ad` (KV store, `R + W > N`), now on step 07.
- 15 node-service-runtime → `dotnet-stripe/dac7f4b37aa1` is a .NET storefront set. Use `opusorganize/0db1c6307227`
  (CPU work on the event loop) (reader's suggestion).
- Weak (reader): 07 `opusorganize/9e40bcebe17f` (caching: belongs under 02), 08
  `organized-study-dub-monorepo/644bca3ff165`, 10 the billing set, 12 `masteropen/a3a62d030752`, 14 both sets.
Fix: re-map 11 and 15; for the weak ones move the set or say in `_note` that no primary set uses the module's maths.

**F11. The tools/seed suite is red on the committed fund-js authoring.**
`tools/seed/src/fundamentals/import.test.ts` fails 2 tests: 10 fund-js drills have a hint 2 that the importer's prose
gate refuses (`tools/seed/src/sysdrills/import.ts:137-140`), so `seed:import:fundamentals -- --track js` cannot run.
Older than rv2, but the battery cannot be green with it.
Fix: rewrite the 10 hints, re-import, validate and stamp `fund-js`.

### Medium

**F3. A redo card with no live sibling is stuck out and blocks every other redo card (live).**
`server/src/engines/redo.ts:70-93` (`releaseRedo` never looks at siblings), `:190-195` (`conceptCardLive` checks only
that the idea exists); `runRedo` answers 409 `CONTENT_PENDING`; `app.ts:466` refuses a bare grade.
Scenario: an idea's `siblings` are emptied or archived after its redo card was enrolled (rv3 will edit these lists).
The card was out on days 17, 18 and 20, could be neither run nor graded, and no other redo was released.
Fix: a redo card is live only while its idea has ≥ 1 live sibling (retire at startup, restore when one returns), and
`releaseRedo` skips such cards.

**F4. The `idea` sentence is served before the sources are passed and is not leak-checked.**
`keyideas-service.ts:205` puts `idea` in the DTO of a not-met idea; `tools/seed/src/ops/keyideas-lint.ts:305` checks
only `prompt` and `answer`, and only against items outside the sources. The fold is mounted on the Fundamentals card
of the current topic.
Checked by me: `fund-js-core/lazy-iterators-generators` ("each value is produced only when the consumer asks for it")
is topic 14 q07's key; `fund-js-platform/narrow-unknown` is topic 15 q03's key; `fund-java-spring/transactional-proxy`
is topic 20 q02's key. The reader's script flags 22 of 65 Fundamentals ideas.
Fix: for a not-met idea the API sends id, tags, sources and status but no `idea` text (the fold shows "opens after
<source titles>"). Also run the lint's matchers on `idea` against items outside the sources.

**F5. `/reviews/queue` resolves every section once per concept card; the dashboard re-syncs on every read.**
`server/src/api/app.ts:454` calls `conceptCardText` without the resolved sections, so each concept card runs
`resolveSections` (all 5313 units, every prefix). Measured: the default queue 2.8 s, against 0.35 s with `limit=50`
and one concept card; `GET /dashboard` 1.35-1.4 s with key ideas, 0.9 s without (`app.ts:196`).
Fix: resolve once per request and pass it down; cache the resolution until the unit table or the store changes;
sync on passes and review reads, not on every dashboard read.

**F6. The recap bypasses the 4-a-day cap (live).**
`keyideas-service.ts:348-359` (`reenrol`) sets every "partly / missed" card due tomorrow, including cards never
reviewed: 13 topics and the recap on one day gave 11 new key-idea cards due on one day.
Fix: `reenrol` leaves a never-reviewed card on its capped day; only reviewed cards are pulled forward.

**F8. Wrong statements in key ideas.**
- `content/keyideas/fund-java-language.json` `equality-contracts`, prompt: "a TreeSet of versions drops '1.0' when
  '1.0.0' is added". `TreeSet.add` keeps the element already in the set and refuses the new one (checked by me).
- `sysdrills.json` `backlog-drain-time`, answer: 4 consumers at 2,000/s against 1,000/s arrivals do not "barely beat
  arrivals" (reader).
- `fund-java-spring.json` `entity-identity-and-derived-queries`, answer: claims an AND / OR precedence that its
  sources do not teach (reader).

**F9. C# topics 21-23** (reader; I re-checked 23 q01, 23 q08, its card and its pretest check).
- `fund-csharp/23-.../01-evaluate-a-policy`: the drill and its test (`counting.Calls == 0`) assert an early exit for
  an unauthenticated user "the way the authorization service does". ASP.NET Core runs the handlers anyway. Fix: drop
  the assertion or call it a simplification.
- `topics.json` 23 q01: the stem names no scheme, and its own explanation says cookies redirect. Fix: "a JWT-bearer API".
- 22 lesson: `AddStandardResilienceHandler()` "stacks the pieces for you", with no word that it retries unsafe methods
  by default, right after the lesson warns about retried payments. The reader states this from memory: check the
  package docs before editing.
- 21 lesson, q04 and drill 21/02: a case-only duplicate email trips a unique index only under a case-insensitive
  collation; SQLite is called "the real engine".
- Weak tests: 22/02 passes GET-only or all-but-POST retry rules and a hard-coded jitter; 23/02 passes a
  role-before-tenant order that confirms existence by 403. 22/01: a wrong solution probably hits the 20 s runner
  limit, not an assertion (not run).
- 9 flashcards and 2 pretest checks paraphrase a gate key of their own topic (for example the card "Default policy
  versus fallback policy" and check 2 of topic 23 against q08). The importer's rule is verbatim only.

**F10. C# drills from slice 2** (reader; S2 reported the 06 claim).
- `fund-csharp/06-.../01-polymorphic-notifiers` explanation: "Declaring it `new` instead of `override` would make
  that test fail" is false. The only test through a `Notifier` reference uses a short message, so `new` passes all five.
- Bug hunts 05, 06 and 07 plant an integer-division or boundary bug that does not exercise the topic.
- All 16 say "Implement the stubbed local function" although nothing is stubbed; 14 names its bug in hint 1.

### Low
- **L1.** Redo and re-check cards sit at the end of the queue (`engines/fsrs.ts:151` orders by `due_at`; a released
  redo gets `due_at = now`). With 160 flashcards due, the redo card was not in the first 50, and the dashboard link
  stops at 20 cards.
- **L2.** `content/design/estimates.json` (670 numbers) has no reader in `server/src` or `client/src`.
- **L3.** A confidence tag on a quiz submit is filed after the grade is known (`confidence-service.ts:32-48`; the
  attempt row exists only after grading, and the `/submit` body is bound). Say so in the copy.
- **L4.** The re-check's five prompts are re-drawn on submit (`keyideas-service.ts:418`, `:444`): a card graded
  between GET and POST changes the set, the submit is refused and the typed recalls are lost.
- **L5.** An `ebmiss` card is keyed by position (`redo.ts` `ebmissTarget`); after a re-seed that reorders key points
  it shows another point. `headlines.json` carries `kpHash`: store it and retire on mismatch.
- **L6.** The recall check counts words only ("a a a a a a a a" passes); notes have no daily cap. Both are
  self-rated and bounded by the review XP cap.
- **L7.** Six ideas cite a source that does not teach them (reader, keyword search):
  `campaign-migrations-rollout/migrate-client-data-with-a-backup` (mobiletagalog),
  `campaign-idempotency/key-bound-to-request` (bazaar), `campaign-authz-tenancy/scope-related-ids-too`
  (netcleanarch), `fund-cs-web/efcore-read-paths` (needs topic 19), `bank-bootforge/type-the-boundary-first`,
  `bank-java/same-bug-three-languages`.
- **L8.** Headlines (reader): about a dozen "Why X / Whether X" forms presuppose the point; 449 of the 608
  third-question key points are tagged `trade-offs`, so the Stats dimension profile is close to a per-question profile.
- **L9.** Server tests that load a pack subset read the repo's real `content/keyideas`: that is the "sibling
  `sysdrills/18-web-authz-and-sessions/04-access-token-lifetime` matches no live unit" warning in the battery log.
  The key exists in the pack, and a full-estate boot printed no such warning, so the lint and the server agree on the
  real content. The gap is test setup, not the lint.
- **L10.** `design-side.ts` and `store/keyideas.ts` each parse `headlines.json`.
- **L11.** 3 ideas have 4 sources and 3 have 1; the "1-3 sources" in the reports is not a lint rule.
- **L12.** At 390 px the dashboard heatmap and the Stats competency table are wider than the viewport inside their
  own containers (no page scroll); check that both scroll by touch.

## 4. Must fix before landing

"Landing" = `rv-wave` going to `main` (O1). Each is scheduled in `../rv3/PLAN.md` §3.1.

| MF | Finding | Fix in |
|---|---|---|
| MF-1 | F1 one-idea recap | rv3 S1 |
| MF-2 | F2 recap unreachable outside Fundamentals | rv3 S1, S4 (side files + lint rule) |
| MF-3 | F3 stuck redo card | rv3 S1 |
| MF-4 | F4 `idea` sentence served before the sources pass | rv3 S1 |
| MF-5 | F11 fund-js hint 2s; tools/seed suite red | rv3 S3 task 2 |
| MF-6 | F5 queue and dashboard latency | rv3 S1 |
| MF-7 | F7 sysdesign path steps 11 and 15, the weak five reviewed | rv3 S1 |
| MF-8 | F9 / F10: C# 06/01 claim, 23/01 early exit, 23 q01 stem, 22/01 guard times | rv3 S3 task 2 |
| MF-9 | F8 wrong statements in key ideas | rv3 S1, S2 |
| MF-10 | L9 test setup reads the real side files | rv3 S1 |
| MF-11 | The suites not run here (§6) run green, or their failures are shown to be environmental on a quiet machine | orchestrator |

## 5. Should fix (rv3 S1 task 3 and the content streams, in this order)
1. F6: recap re-enrolment honours the daily cap.
2. L1: redo and re-check cards first in the queue and named on the dashboard tile (rv3 W10).
3. F9 rest: weak tests in 22/02 and 23/02, the topic 21 and 22 lesson claims, cards and pretest checks that paraphrase
   a gate key (extend the importer's verbatim rule to the leak matcher).
4. F10 rest: bug hunts 05 / 06 / 07 re-bugged on topic, the stale "stubbed" line, hint 1 of 14.
5. L7 sources; L8 headlines and dimensions.
6. L4 re-check prompts fixed at the first GET; L5 `kpHash` on `ebmiss` cards.
7. L2: give `estimates.json` a reader (interview mode: "the numbers in this prompt") or drop it; L10 one headlines reader.
8. L3 confidence copy; L6 a note cap (10 a day); L12.

## 6. Left open
- **Battery on `3264edb3`.** Green: root typecheck, `seed:lint:leaks`, `seed:lint:answers`, `seed:lint:keyideas`,
  `seed:pins`, `restamp:all -- --dry-run`, `seed:campaign -- --check`. tools/seed: 3 failed of 2310 (2 are F11;
  `factory/fingerprint.test.ts` timed out at 124 s and `notes.test.ts` hit a 10 s hook timeout under load: re-run
  alone). The server suite was killed mid-run. Not started: selfrun, client, CLI, client typecheck, `smoke:api`,
  `demo:promotion`, `seed:demo:planted`, `test:csharp`, `test:java`.
- **UI clicks not done:** passing a gate, the recap screen, grading a card and a redo run by clicking; the merged
  explanation panel after a graded item. The API behind each was probed. To finish: `walk.json` with
  `fable52docs/tools/cdp.mjs`, server via `launch.mjs` (`SANDBOX_UI=1`); allow 25 s for the first page.
- **Not read by me in full:** the client pages other than `Review.tsx`, `RedoBar.tsx` and the dashboard / player
  diffs; `week-service.ts` beyond its key-idea query; S2b's Java 21 on `rv2-c2-wip` (not merged, outside this review).
- **Reader claims not re-checked by me:** the 22 lesson's resilience-handler default, the 22/01 timing, the campaign
  source mismatches, headline giveaways beyond the listed ten, path steps other than 11 and 15.
- The sandbox DB and side-file copies are scratch only. The owner DB was read once, read-only, by `copydb.cjs`.
