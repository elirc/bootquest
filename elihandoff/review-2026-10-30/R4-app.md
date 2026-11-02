# R4 — BootQuest APP review (read-only, 2026-10-30, main @ 772b19cb)

Scope: the app (server, client, CLI, engines), not the content. Every claim cites `file:line` under
`C:\Users\Owner\Desktop\selfboot\`. Nothing was edited; only GETs were made against the running
server (127.0.0.1:4178).

## Context the owner should know first

- **Live counts** (`GET /api/health`, `/api/tracks`, `/api/ladder`): 5,076 units / 4,794 checks. JS 3,972
  practice units (146 core quests), C# 215 (48 core), Java 260 (12 core), agentic 75, sysdesign 216.
  Ladder: 224 explain-back, 20 G2, 52 katas, **1 live retest**, 2 authored.
- **The owner's DB has never been used**: `GET /api/dashboard` → 0 XP, level 1, streak 0, 0 review cards,
  0 evidence, 0 graded attempts, every competency at rating 1 with all three legs pending. Every
  learning-science tuning below is therefore an a-priori judgement; the highest-value next step is to
  dogfood two weeks and then re-read §2 against real data (docs/DOGFOOD.md is the checklist; the
  phone-width item there is still open, README.md:292).
- `GET /api/tracks/js/units` is 841 KB / 3,972 rows in one response (0.2 s locally).

---

## 1. Feature inventory

### 1.1 Pages and components (client)

| Feature | Where | What it does |
|---|---|---|
| App shell, sidebar nav, track list with % | `client/src/components/AppShell.tsx:36-201` | Nav (Dashboard/Campaign/Review/Stats) with `g <x>` chords; review badge re-read on every navigation (`:47`), counted down live during a session (`:49-52`); tracks via `TracksProvider`; skip link; page title focused after each route change (`:79-90`). |
| Shortcut help overlay | `components/ShortcutHelp.tsx` | `?` toggles; Esc closes; captures every key while open (`:21-29`). |
| Dashboard tiles | `pages/Dashboard.tsx:71-148` | Streak (days, freeze tokens, banked, best), Level (XP, progress bar, +XP today), Review queue due, Today's slate X/N. |
| Due now (retests) | `Dashboard.tsx:204-246` | Open changed-example retests from `GET /competencies`; says alt sets are NOT listed here (`:224`). |
| Activity heatmap | `components/Heatmap.tsx`; 120 days (`server/src/api/service.ts:76`) | XP buckets 0-4 + day status (slate/partial/frozen/missed), hover readout, totals. |
| Today's slate | `Dashboard.tsx:326-393` | One row per slot with deep link: drill set → next unpassed drill (`useSlateTargets :265-305`: up to 4× `/tracks/:id/units` + 5× `/tracks/:id/campaign`), campaign step, clear reviews; "vacuous" review slot shown as "nothing due" (`:54-57`). |
| Competency table | `Dashboard.tsx:438-478` | 8 ratings as pips, three promotion legs (Artifact / Explain / Retest chips, states done/pending/scheduled/failed), last evidence link. |
| Next up | `Dashboard.tsx:165-190` | First `available` non-written unit per unlocked track (`service.ts:782-788`, `ORDER BY id`) + "Browse all". |
| Campaign page (list) | `pages/Campaign.tsx` | Track tabs (←/→), act cards with unlock rule and core progress, quest nodes (done/available/pending/locked), `?unit=` focus target, `j`/`k` walk, `v` toggles view. |
| Campaign skill tree | `pages/CampaignTree.tsx` | SVG tree with prerequisite edges, roving tabindex, arrow-key navigation, expand/collapse acts, legend; view remembered in localStorage. |
| Practice-unit browser | `pages/TrackUnits.tsx` | Every unit of a track grouped by repo/module; text filter, kind filter (All/Drills/Explain-backs/Other), Hide done; collapsed under a campaign, expanded on campaign-less tracks; `#units` deep link. Renders every row (no paging/virtualisation, `:130-147`). |
| Exercise player (shell) | `pages/Player.tsx:73-200` | Breadcrumb, kind/difficulty chips, "Guided · 0 XP" badge, Learn-more (`i`), instructions pane (refs, uncovered legs, competencies, reveal), work pane per check type; closed-retest and locked-act views. |
| Code pane | `Player.tsx:489-699`, `Player/Editor.tsx` | Plain textarea editor with gutter, Tab/Shift+Tab indent, Esc-then-Tab exit; localStorage draft keyed by unit+content hash, restore/reset/undo, "Load my last submitted code" (`GET /attempts/:id`), dirty guard when storage is unavailable; Run (Ctrl+Enter, free) / Submit (Ctrl+Shift+Enter, recorded); verdict, failures with expected/actual, output; promotions; next unit. |
| Quiz / predict panes | `Player.tsx:838-1002` | Submit-only (no Run); `1-4` picks, Enter checks; correct/incorrect only (key only via reveal); "I had help" checkbox. |
| Reveal flow | `Player/RevealFlow.tsx` | Inline alertdialog naming what is forfeited (0 XP forever; artifact/retest leg); solution view; link to the seeded variation as practice. |
| Reading pane | `Player.tsx:1006-1059` | One-time self-attest (+5 XP). |
| Written pane | `pages/WrittenPane.tsx` | Answer stored immutably (confirm), then model answer + rubric self-check (ticks local only, no XP). |
| Study-quest pane | `pages/StudyQuestPane.tsx` | Reading list (GitHub links at the pinned sha), quiz gate answered all at once (≥80%), per-question right/wrong, misses → review cards tomorrow, flashcards enrolled on first pass, Learn-more per item. |
| Explain-back pane | `pages/LadderPanes.tsx:396-580` | Answer-first form with draft, artifact lock (409 ARTIFACT_REQUIRED), alt-set strip + rotation gate (409 NOT_DUE), confirm; key view with per-key-point covered/missed radios, live preview vs gate, permanent self-score confirm; result (coverage, XP, retest scheduled / alt-set hint, promotions); practice retakes (`:737-974`). |
| Patch-kata pane | `LadderPanes.tsx:1062-1325` | Unified diff viewer (wrap toggle), context files, findings table (scenario/evidence/consequence), key with caught/missed radios, G1 preview, catch result. |
| Learn-more drawer | `components/LearnMore.tsx` | Readings (before), explanations (released per quiz after answer/pass/card due), unit explanation / revealed solution, material refs with in-drawer markdown viewer (`GET /refs/:id/content`); Tab trap, Esc, focus return. |
| Review session | `pages/Review.tsx` | Card front/back (seeded text or key), Space/Enter flip, `1-4` grade, running tally, +XP, demotion banner, next-due line, "Queue cleared". |
| Stats page | `pages/Stats.tsx`, `components/StatsCharts.tsx` | Tiles (XP 120d, active days, slate days, avg XP/active day); XP over time (90 days daily / all-time weekly, stacked by track, arrow-key readout + data table); pass rates by track and check type (pass, first-try-solo, guided-not-counted); reviews (due now, retention 30d/all-time, 14-day forecast, grade shares); campaign progress per act; G1 catch rate; evidence browser (newest 200, competency filter, `#evidence-<id>` deep link, attempt detail expand). |

### 1.2 Keyboard shortcuts (all)

| Keys | Scope | Where |
|---|---|---|
| `g d` / `g c` / `g r` / `g s` | global navigation (1.2 s chord window) | `lib/keys.ts:36-43`, `AppShell.tsx:54-76` |
| `?` | shortcut help | `AppShell.tsx:56-60` |
| `j` / `k`, `v`, `←`/`→` (tabs) | Campaign | `Campaign.tsx:62-82`, `:160-168` |
| `↑ ↓ ← →`, Home/End, Enter | skill tree | `CampaignTree.tsx:163-174`, `lib/skilltree.ts` |
| `Ctrl+Enter` run, `Ctrl+Shift+Enter` submit | code / predict panes | `Player.tsx:604-608`, `:967-971` |
| `1-4` pick, `Enter` check | quiz pane | `Player.tsx:875-896` |
| `Tab`/`Shift+Tab` indent, `Esc` then `Tab` leaves | code editor | `Player/Editor.tsx:71-90` |
| `i` | Learn-more (one owner per page) | `LearnMore.tsx:418-427` |
| `Space`/`Enter` flip, `1-4` grade | Review | `Review.tsx:91-103` |
| `←`/`→`/Home/End | bar-chart readout | `StatsCharts.tsx:102-110` |
| `Esc` | every overlay / inline confirm | `ShortcutHelp.tsx:22`, `LearnMore.tsx:142`, `RevealFlow.tsx:102`, `LadderPanes.tsx:306,560`, `WrittenPane.tsx:156` |

Gating of bare keys (dialog open, repeat, focused control owns the key, typing): `lib/shortcuts.ts:27-85`.

### 1.3 API surface (server) — `server/src/api/app.ts`

GET `/health :171`, `/dashboard :176`, `/tracks :181`, `/tracks/:id/units :186`, `/units/by-key/:key :193`,
`/tracks/:id/campaign :199`, `/units/:id :206`, `/units/:id/notes :214`, `/units/:id/solution :255`,
`/units/:id/model-answer :269`, `/units/:id/explain-back/key :285`, `/units/:id/kata/key :321`,
`/competencies :342`, `/evidence :347`, `/attempts/:id :352`, `/stats/katas|xp|pass-rates|reviews|campaign :358-382`,
`/ladder :385` (unused by the client), `/reviews/queue :392`, `/sync/queue :437`, `/refs/:id/content :443`.
POST `/units/:id/run :220` (free, refused for quiz/predict/study-quiz, `service.ts:427`), `/submit :228`,
`/reveal :241`, `/self-attest :248`, `/answer :262`, `/explain-back/answers|self-score|practice|practice-score :278-312`,
`/kata/findings|self-score :314-332`, `/mutation :335`, `/reviews/:itemId/grade :402`, `/sync :412`.
Guards: Host/Origin/Content-Type lockdown (`guard.ts`), 256 KB JSON body (`app.ts:95`), every response strict-parsed
through the shared Zod schemas. No `PUT`/`DELETE` anywhere; no settings endpoint.

### 1.4 Engines — the rules that matter for learning

**Review scheduling (FSRS)** — `server/src/engines/fsrs.ts`
- `ts-fsrs` 5.2.3 with `generatorParameters({ enable_fuzz: false })` (`:13`): the library defaults
  (desired retention 0.9, FSRS-5 default weights, max interval 36,500 d), never re-fitted to the learner.
- A grade (`again|hard|good|easy`) calls `scheduler.next(card, now, rating)` (`:59-61`) and stores the
  whole FSRS card JSON (`stability`, `difficulty`, `reps`, `lapses`, `state`) in `review_item.fsrs_state`
  (`:39-52`). Only `due_at` is read back by the app; `lapses`/`difficulty` are never consulted.
- Card sources: (1) **quiz misses** → one card per missed item, due `now + 1 day`, deduped by key: a
  second miss "finds the existing card and leaves its schedule alone" (`study-quest.ts:66-92`); (2)
  **flashcards** → the whole pack enrolled on the quest's FIRST pass, all due `now + 1 day`
  (`study-quest.ts:95-98`). No other content type creates FSRS cards.
- Grading before due is refused (`fsrs.ts:168`); 1 XP per review, 30/day cap (`xp.ts:19,176-181`).
- Lapse rule: `again` on a card in FSRS `Review` state **with a competency_id** writes review evidence and
  demotes that competency one notch (`fsrs.ts:180-189`). See §4 BUG-1: no production card has a competency.
- No new-cards/day cap, no leech threshold, no suspend/bury, no "hard" interval floor.

**Changed-example retests (leg c)** — `engines/ladder.ts`: a passing (≥80%) explain-back self-score writes a
`review_item` of kind `retest` due `max(artifact pass, answer) + 2 days` (`:133-160`,
`evidence.ts:39 RETEST_MIN_DELAY_MS`); the retest unit withholds its task until due (`:210-217`,
`service.ts:384-400`); done = a verified solo pass at/after due. Only artifacts with a seeded variant get
one (`attempts.ts:260-263`); the live estate has **1** such unit.

**Explain-back alternate sets (DESIGN IT rotation)** — `api/ladder-service.ts`
- Siblings = explain-back items with the same provenance repo+path (`:301-303`); labels `A` (no `set`),
  `B`, `C` (`:298`).
- Gate: a FRESH answer to any sibling is refused with 409 `NOT_DUE` until `EB_SET_MIN_GAP_MS` = 2 days after
  the newest fresh answer anywhere in the group (`:310-323`, `engines/ladder.ts:38`); the first answer is
  never gated. The gap is **fixed**, not performance-based.
- After self-score, unlimited **practice** retakes of the same set (assisted, 0 XP, feedback only)
  (`:543-649`). Nothing writes a schedule row for the next set and nothing lists sets whose gate has
  opened; the only place the opening time appears is the unit page (`LadderPanes.tsx:382-394`).

**Daily slate / "today"** — `engines/streak.ts`
- Slots (`:171-184`): one `drill:<track>` per unlocked track with `slate_drills=1` (js, csharp, java,
  sysdesign — migrations 002/011/016), size `min(5, drills remaining)`; one `campaign` slot iff an
  actionable not-done quest exists in an unlocked act (or the step was done today); always one `review`
  slot. Done flags are DERIVED from the ledger (`:262-274`): ≥ size distinct drills with a first-ever
  unguided verified pass today; first-ever quest completion today; review queue empty after a review today
  (or simply empty, except on review-only days).
- Today, for this owner: 4 drill sets × 5 + campaign + review = **22 actions for a "slate" day**
  (`GET /dashboard` output). No API/CLI/UI toggles `slate_drills`; the engine comment itself says a track
  should be taken off the slate "explicitly (track.slate_drills = 0 or locked), which is a recorded
  state" (`streak.ts:40-42`), but only raw SQL can do it.
- Day close (`:343-367`): `slate` → streak+1, +1 banked; `partial` (≥ 20 XP) → streak kept; else auto-spend
  a freeze token (`frozen`) or break (`missed`, banked reset). Tokens: every 7 slate-days → 1, max 2 banked
  (`:91-94`). Closed days are re-derived from their stored slot list (`:348`).

**XP and level** — `engines/xp.ts:8-19`: code 10 × difficulty, quiz 2, predict 4, study-quest 50, reading 5,
explain-back 20, patch-kata 15, review 1 (cap 30/day); paid once per unit+kind (`:163-166`, unique index
`003_honesty_hardening.sql:79`); 0 forever after a reveal (`:160-162`). Level n+1 at `floor(150·n^1.6)`
(`level.ts:14-23`): L2 150, L3 454, L6 1,969.

**Competency ladder** — `engines/evidence.ts:264-358`: one linked chain (a) solo verified project artifact →
(b) its explain-back ≥ 80% unassisted at/after (a) → (c) retest of (a)'s unit ≥ 48 h after both; ratings 1-5,
never averaged.

### 1.5 CLI — `cli/src` (`bootquest`)

`run [path]` (free), `submit [path] --assisted`, `status`, `today` (one GET /dashboard; always exit 0),
`sync --repo`, `mutate [projectDir]` (Stryker / Stryker.NET, 15-min cap), `reset --yes-really`.
Config: `.bootquest.json` walked up from cwd (`config.ts:58-67`); `--server` > `BOOTQUEST_SERVER` > default.
Timeouts: GET 120 s, run/submit 15 min, sync 600 s. Exit codes 0/1/2 (`program.ts:14-21`).
**Not reachable from the CLI**: reviews (only the due count), explain-back / kata answer+key+score, notes,
campaign browsing, stats, evidence, self-attest, reveal (deliberately), written answers.

---

## 2. Learning-science audit

Each point: what a good spaced-repetition / deliberate-practice system does → where BootQuest is → proposed change.

**L1. Spaced retrieval covers ~2% of the content.** Only quiz misses and quest flashcards become FSRS cards
(`study-quest.ts:85-98`). Code drills (4,000+), sysdrills, katas, explain-backs and DESIGN IT sets are
one-shot: a passed drill is never resurfaced (slate counts first-ever passes only, `streak.ts:186-200`;
re-passes earn 0 XP by the once-per-unit rule, `xp.ts:163`). Retention of the thing the app exists for
(writing the code) is never measured after day 0.
→ Add a **drill re-exposure card** per passed drill *module* (not per unit): an FSRS `concept` card whose
"review" is "re-pass one random unpassed-today drill of this module within N minutes" (recorded as a normal
attempt, 0 XP, never a slate tick) and whose grade is derived from pass/fail + time. Lives in
`engines/study-quest.ts`-style enroll on module completion + a `kind:'concept'` branch in `reviews/queue`.

**L2. Intervals are fixed where they should be adaptive.** Retest leg (c) opens at a flat ≥ 2 days
(`evidence.ts:39`) and alt sets rotate on a flat 2-day gap regardless of the coverage score
(`ladder-service.ts:310-323`); the first FSRS due of every seeded card is exactly tomorrow
(`study-quest.ts:88,97`). A 95% coverage and a 40% coverage schedule the same next exposure.
→ Make the alt-set gap a function of the last self-score (e.g. ≥ 90% → 7 d, 80-89% → 4 d, < 80% → 2 d) and
let the quiz-miss card's first due use FSRS `again` scheduling instead of a hard-coded `+DAY_MS`.

**L3. No feedback on the *second* miss.** A re-missed quiz question dedups onto the existing card and
"leaves its schedule alone" (`study-quest.ts:70-76`). Repeated failure of the same item is invisible to the
scheduler and to the learner.
→ On a repeat miss of a card that is not yet due, re-grade it as `again` server-side (an honest signal: the
learner just failed it) or at least surface "missed again" in the submit result.

**L4. No leech handling.** `lapses` is stored in `fsrs_state` but never read (`fsrs.ts:39-52`); a card can be
failed forever with no suspension, no "study this instead" pointer, no cap on cards/day.
→ `lapses ≥ 4` → mark the card a leech in the queue payload (`ReviewQueueItem`), show its Learn-more
explanation up front, and stop scheduling it until the learner re-passes the quest.

**L5. The lapse → demotion rule is dead code in production** (see §4 BUG-1): seeded cards carry no
`competency_id`, so the README promise "a lapse on a Review-state FSRS card for that competency demotes it"
never happens, review evidence is never written, and the Review page's demotion banner can never show.
→ Decide: either set `competencyId` on quiz-miss/flashcard cards from the quest unit's `unit_competency`
(then the deferred "demotion cap" decision becomes urgent), or drop the rule from README/spec.

**L6. No per-topic weakness surfacing.** Evidence is tagged with 8 coarse competencies; stats aggregate by
track and check type only (`stats-service.ts:66-84`). Missed key points are serialised into free text
(`ladder-service.ts:507 "missed q1.kp3"`), missed quiz items are review cards, failed drills are attempts
— none is aggregated by module/repo/topic anywhere in the UI.
→ A "Weak spots" panel (§5 P1).

**L7. No interleaving.** Next-up is the first `available` unit by `id` (`service.ts:786`); the slate is
per-track blocks of 5; the unit browser preserves seed order. Blocked practice is the default.
→ A mixed-drill picker (§5 P3) and a shuffled "next 5" inside a module.

**L8. No difficulty adaptation.** `unit.difficulty` only scales XP (`xp.ts:59-65`); selection never reads
pass history, time-on-task or confidence. The app knows nothing about *how* a pass happened: the runner's
`durationMs` is machine time, the editor records no learner time, and there is no confidence prompt.
→ Capture `elapsedMs` (first edit → submit) and a pre-verdict confidence (1-3) on the attempt's `answer`
JSON (client-supplied, so display-only, never XP) → calibration and struggle detection.

**L9. Explain-back feedback is key points only.** After self-scoring there is no model narrative, no
example of a strong answer, and DESIGN IT sets have no follow-up probe ("what if traffic 10×?"). The
practice-retake path exists but is unstructured.
→ Seed-time authored `modelAnswer` (prose) and `followUp` per set, released after the self-score
(seed content, deterministic, no runtime LLM). Rubric calibration: show the learner's self-score vs. the
retest outcome when both exist.

**L10. No time-boxing anywhere.** No timer on DESIGN IT sets, explain-backs or drills; no session goal.
→ Client-side countdown chosen by the learner (25/35/45 min) stored on the answer as `timeBoxMs` /
`elapsedMs` (display-only); an "interview mode" (§5 P2).

**L11. Self-score is binary and un-calibrated.** `covered|missed` per key point (`LadderPanes.tsx:664`); no
"partly"; the only external check is the retest, which only 1 live unit has.
→ Add `partial` (counts 0.5, below the gate it is still honest) and show calibration stats where a retest
exists; otherwise rely on the alternate-set score trend.

**L12. The slate is a fixed 22-action day with no owner control.** Streak logic is sound (derived, gaming-
resistant), but 4 drill tracks × 5 is a lot for a working professional, and there is no way to say "this
month: Java + system design" except raw SQL on `track.slate_drills` (`streak.ts:40-42`).
→ A settings endpoint + `bootquest slate --tracks` (§5 P6). Closed days are already immune
(`streak.ts:348`), so this is safe.

**L13. Reading before testing is the only order.** Study quests present the reading list then the quiz;
there is no optional pre-test (the "test first, then read" effect). Low priority; the honesty model
(explanations withheld until answered) already enforces retrieval before explanation.

What is already good and should be kept: answer-before-key everywhere; immediate structured feedback on
code; explanations released only after a recorded answer (`notes-service.ts:99-107`); the once-per-item
answer of record with unlimited practice; the 2-day minimum before any retest; the "vacuous review slot"
honesty on the dashboard; the derived, un-gameable slate.

---

## 3. UX / robustness findings (BUG / WEAK / NIT)

**BUG-1 Lapse-demotion never fires; Review demotion banner is unreachable.** `study-quest.ts:78`
creates every production card with no `competencyId`; `ladder.ts:147` writes `competency_id NULL`;
`fsrs.ts:180-189` only demotes when `item.competency_id !== null`. README.md:192-193 and the Review page
(`Review.tsx:217-236`) promise otherwise. Fix: pass the quest unit's competencies into `enqueue`, or
amend README.

**BUG-2 "Queue cleared" lies past 200 cards.** `Review.tsx:39` calls `getReviewQueue()` with no limit →
`DEFAULT_QUEUE_LIMIT = 200` (`app.ts:96,395`); after grading the 200 the done panel says "Queue cleared"
(`Review.tsx:111`) while `remainingDue` can be > 0 (nav badge still shows it). Fix: when `count >
items.length`, refetch the next page instead of ending the session, or title it "Batch done, N more due".

**BUG-3 (edge) `Cancel` on the reveal confirm cannot be reached by Tab from the Reveal button in all
cases** — not reproduced; the `autoFocus` on Cancel (`RevealFlow.tsx:124`) covers it. Downgraded to NIT;
listed so nobody re-investigates.

**WEAK-1 One mis-key grades a card permanently (and, once BUG-1 is fixed, demotes a competency).**
`Review.tsx:98-102` grades on the first `1-4` keypress after flip; evidence is append-only, so there is no
undo by design. Proposal: the queue item carries `lapseWouldDemote: boolean` (server knows `state ===
Review` and the competency); the client asks "Again will demote <competency> — confirm" only for those.

**WEAK-2 3,972-row DOM list with no paging.** `TrackUnits.tsx:130-147` renders every unit of the track;
`queries.ts:96-101` returns them all (841 KB). Filtering is client-side and fine; first render of the JS
browser is the cost. Proposal: render groups collapsed by default above ~300 units, or a windowed list;
server side, a slim `GET /units/index` (id, key, title, kind, track, state) for search.

**WEAK-3 Dashboard mount fans out up to 11 requests.** `Dashboard.tsx:26,30` (dashboard + competencies) then
`useSlateTargets :276-303` → `getTrackUnits` for each drill track whose next-up is not a drill (up to 4 ×
841 KB-class payloads) and `getCampaign` for all 5 tracks. Proposal: have `GET /dashboard` return the slate
target unit ids (the server already computes `nextUp`; add `slate.items[].targetUnitId`).

**WEAK-4 Evidence browser cannot page.** `listEvidence` has `limit` (max 1000, `shared/src/api.ts:1120-1130`)
but no offset/cursor (`ladder-service.ts:871-894`); the UI shows "200 of N" (`Stats.tsx:520-522`) with no
way to see older rows, and a `#evidence-<id>` deep link to an old row shows "not in this list".
Proposal: `before=<id>` cursor + "Load older".

**WEAK-5 Alt-set due dates are surfaced nowhere but the unit page.** Dashboard explicitly says so
(`Dashboard.tsx:224`); with 50 DESIGN IT primaries and 37 set-B/C the learner must remember to revisit
each. Proposal: `GET /competencies` (or `/ladder`) gains `altSetsDue: [{unitId, label, opensAt}]` computed
from `ebSetGate` across groups; render under "Due now".

**WEAK-6 No global search / no per-repo view.** Search exists only inside one track's unit browser
(`TrackUnits.tsx:96-103`). Nothing shows everything about one repo (quest pack, EB sets, katas, notes,
evidence) although every unit key and seed item carries the repo (`lib/trackunits.ts:31-49`).

**WEAK-7 Code editor is a textarea.** `Player/Editor.tsx:54-120`: no highlighting, bracket match, or
auto-indent. For 20 drills/day in-browser this is friction; the README positions the CLI as the serious
path, so this is a deliberate trade-off — but the slate pushes browser use. Proposal: CodeMirror 6 (local
bundle, deterministic) or keep and document "use the CLI for drills".

**WEAK-8 Swallowed error.** `StudyQuestPane.tsx:47-50` `loadNotes` → on failure `setNotes(null)`: per-item
Learn-more buttons silently vanish, no message. `Dashboard.tsx:283` swallows `getTrackUnits` failures (link
falls back to the campaign page — acceptable, but silent).

**WEAK-9 Review-clear slot semantics confuse on day 1.** On a fresh DB the slate shows the review slot `done`
("nothing due") and the tile 0/5 (`GET /dashboard` today, `Dashboard.tsx:54-57`); the copy is honest but a
first-time learner sees a ticked box they did nothing for. Proposal: hide the review slot entirely while
`cards === 0` all-time (not just due === 0).

**WEAK-10 Narrow layout unverified.** 14 `@media` blocks (`app.css:1847,1855,1933,1948,2116,2451,2505,2536,
2762`, `trackunits.css:149`) and the DOGFOOD phone check are untested (coverage agent: no page renders under
a narrow viewport; only skill-tree layout math). The sidebar is fixed 232 px (`tokens.css:79`).

**WEAK-11 No automated a11y sweep.** No axe; a11y is asserted via roles + ~35 focus checks. Good practice
exists (live regions, alertdialogs, focus return, skip link, `forced-colors`), so a one-time axe run is cheap
insurance.

**NIT-1 Quiz pane steals the route-change focus.** `Player.tsx:861` focuses the first radio on mount after
`AppShell.tsx:85-86` focused the page title → the title announcement is lost on quiz units.

**NIT-2 Wrong choice is marked by colour only.** `Player.tsx:909` (`choice-wrong`); the verdict text says
"Incorrect" so information is not lost, but add an inline "(your pick)" for the marked choice.

**NIT-3 Heatmap cells are mouse-only.** `Heatmap.tsx:18` `aria-hidden` body; `title` tooltips; keyboard users
get only the aggregate label and today's readout.

**NIT-4 "Next unit" after a pass refetches the whole dashboard.** `Player.tsx:433` — 12 KB and cheap, but
`GET /dashboard` closes days and composes the slate in a write transaction (`service.ts:766`) for a read.

**NIT-5 Dark only.** `tokens.css:1-3` says so by design; `color-scheme: dark`. Nothing "reads worse in
light" because there is no light. If the owner ever wants light, `--faint`/`--muted` contrast notes at
`tokens.css:17-19` are the pattern to repeat.

**NIT-6 No `/` to focus the unit filter, no shortcut for "Start quiz" / "Mark as read".**

**NIT-7 Stats page waits for all 5 panel requests before painting anything** (`Stats.tsx:49-58`); one slow
request blanks the whole page (by design to avoid CLS, but a 400 px skeleton for several seconds).

Already covered well by tests (so not re-raised): error envelopes and Retry, empty states, keyboard gates,
drafts/dirty guard, sidebar refetch after mutation, honesty of locked content. Gaps the coverage agent found:
loading states on Dashboard/Review/Campaign/Player initial fetch; network-down on first load; dashboard
slate/heatmap refetch after a submit; zero-unit track; zero-row evidence browser; long lists; narrow viewport.

---

## 4. Server / CLI findings

**Correctness**
- **BUG-1** (above): no competency-linked FSRS card is ever created → `writeReviewEvidence` and `demote`
  in `fsrs.ts:180-189` are unreachable in production; `test/fsrs.test.ts` exercises them only with
  hand-built cards. The deferred "demotion cap" owner decision (SEEDING §8) is moot until this is fixed.
- `GET /dashboard` is a write path: `getDashboard` runs `closeElapsedDays` + `composeSlate` inside `db.tx`
  (`service.ts:766-777`). Correct and idempotent, but a read endpoint that writes rows is worth a comment in
  the API doc; `GET /competencies` and `/stats/*` do not.
- `/api/ladder` (`app.ts:385-390`) is served, Zod-parsed and tested but no client or CLI calls it.

**Scaling with evidence growth** (fine today at 0 rows; worth a note for year 2)
- `reviewCleared` → `dueAsOf` runs a correlated subquery over `review_item × review_log` once per review
  moment of the day (`streak.ts:228-256`); `composeSlate` calls it on every submit, grade and dashboard load.
  With R reviews/day and I cards it is O(R · I · log L) per request, re-done on each grade → quadratic over
  a session. Cache the per-day "cleared at" moment once found (append-only log makes it stable).
- `passRates` loads every graded attempt (`stats-service.ts:67-77`) and `reviewStats` every `review_log` row
  (`:92-94`) into memory per request; add `WHERE a.created_at >= ?` for the window or precompute.
- `getDashboard.nextUp` scans `unitsForTrack` (3,972 rows for JS) per request (`service.ts:782-788`);
  `getUnitDetail` → `questUnitUnlocked` builds campaign state per unit view (`service.ts:174`,
  `campaign.ts:287-300`). F16 already reduced this; a per-request memo of `campaignState` would remove the
  rest (`slateStructure` builds it twice per dashboard: `streak.ts:174` via `composeSlate` and again via
  `streakStatus`).
- Indexes present and adequate (`001_init.sql:100-296`, `008:54-55,113`, `012:20`): `attempt(unit_id,
  created_at)`, `evidence(competency_id, created_at)`, `review_item(due_at)`, `xp_event(day)`. Missing:
  `review_log(review_item_id, reviewed_at)` (used by `dueAsOf`) and `review_item(card_key)` (looked up per
  enqueue and per notes release, `study-quest.ts:70`, `notes-service.ts:103`).

**Pagination**
- `GET /tracks/:id/units` unbounded (`queries.ts:96-101`); `GET /reviews/queue` max 1000, default 200
  (`shared/src/api.ts:138-147`); `GET /evidence` max 1000, no cursor (`:1120-1130`, `ladder-service.ts:884-892`).

**Backup / restore / DB growth**
- Startup `VACUUM INTO` snapshot, quick_check, keep 7 / hard cap 20 (`db/backup.ts:33-35,106-144`): solid.
  Gaps: no on-demand backup (only at start), restore is manual file copy + deleting `-wal`/`-shm`
  (README.md:95-97), no `bootquest backup|restore` commands, no portable export. Backups live beside the DB
  (same disk) — fine for a laptop, but say so.
- DB growth: `run.raw` stores the full verdict JSON per submit forever (`attempts.ts:202-215`); drill
  outputs are small, but C#/Java compile errors can be tens of KB. Not a problem for years; a `VACUUM`
  already happens via the backup.

**Error handling / transactions**
- Grading happens outside the write transaction (`service.ts:514` then `:517`): good.
- `withHonesty`/`honest` map known codes; any other `HonestyRuleError` → 500 by design (`service.ts:416`,
  `ladder-service.ts:105`). Unknown errors log a stack and return `INTERNAL` (`app.ts:475-476`).
- Sync post-step failure is loud and explicit (`app.ts:128-142`): good.

**CLI** (from the CLI review; file:line in `cli/src`)
- WEAK `program.ts:303` `mutate` runs a 15-min Stryker before the server can say NOT_VERIFIED → pre-check
  the unit's latest pass.
- WEAK `mutate.ts:109-111,200` `spawn dotnet` ENOENT surfaces as "Unexpected error: spawn dotnet ENOENT".
- WEAK `mutate.ts:499` corrupt Stryker report → raw SyntaxError.
- WEAK `program.ts:338-339` `sync` report is lost if the follow-up `/sync/queue` GET fails (exit 2).
- WEAK `client.ts:209` responses are cast, never shape-checked; an older/newer server makes `today` print
  "Cannot read properties of undefined" with exit 0 (`program.ts:226-231` swallows every error).
- WEAK `format.ts:251-252` timeout advice says "run status" but `status` cannot show the last attempt.
- NIT `[path]` means file for run/submit and directory for mutate (`program.ts:238,268`); `--repo` means
  `<owner/name>` for sync and `<dir>` for run.
- NIT `client.ts:212-223` `health()/tracks()/trackUnits()` are dead code; `today` drops `slot` names and
  `slateDaysBanked` (`format.ts:161-172`).
- Not covered by `cli/test`: `mutate` end-to-end, `reset` happy path, `sync` queue-fetch failure.

**TODO/FIXME/XXX/HACK grep** (`server/src client/src shared/src cli/src`): **zero real work markers.** Every
hit is the "todo" verdict convention or a fixture stub (`UnsupportedOperationException("TODO")`,
`new Error('TODO')`, TAP `# TODO`, `Outcome.TODO` in `runners/java/.../Check.java`, starter fixtures).

**Missing tests worth adding**: review queue > 200 (BUG-2); competency-linked card lapse through the real
study-quiz path (BUG-1); `reviewCleared` cost with 1,000 cards / 100 reviews; `GET /tracks/js/units` size
guard; narrow-viewport render of Player and Review; axe sweep of each page.

---

## 5. Feature proposals (ranked by learning value)

Hard constraints respected: zero runtime LLM spend, deterministic, local-only, honesty rules untouched.
Effort S (≤ 1 day), M (2-4 days), L (a wave). "Honesty risk" = could it leak a key, pay XP wrongly, or
rewrite history.

**P1. Weak-spots panel** — what: aggregate, per repo/module/pack: quiz-miss cards (count, lapses), missed
explain-back key points (parse `evidence.observation` "missed …" or, better, store `missedIds` JSON on the
evidence row from `ladder-service.ts:487`), drill fails vs passes, `again` grades. Why: L6 — the learner
currently has no idea *what* to practise next beyond "next by id". Where: `GET /stats/weak` in
`stats-service.ts` + a Stats panel + a 3-row dashboard teaser linking to the unit browser pre-filtered.
Effort M. Risk: none if it shows only items whose key the learner has already seen (missed key points are
released by definition; quiz-miss cards only once due — reuse `explanationRelease`).

**P2. Interview mode for DESIGN IT** — what: learner picks a time box (25/35/45 min) → countdown → answers
are stored at the bell (or earlier) → key points + a seed-time authored `followUp` probe is released, whose
answer is stored before the probe's key points → self-score both. Why: L9/L10 — realism, time pressure,
and the "second question" that real interviews use. Where: `SeedExplainBackItem` gains optional
`followUps[]`, `ladder-service.ts` gains a second answer-first stage, `LadderPanes.tsx` the timer. Effort
L. Risk: medium — a new answer-first stage must keep the one-shot per item version and be covered by
`seed:lint:leaks`.

**P3. Random / mixed drill mode** — what: `GET /drills/next?tracks=js,java&mode=mixed` returns one unpassed,
unrevealed drill, interleaving modules and tracks, weighted toward modules with recent fails (P1 data);
"Next" button after each pass. Why: L7/L8 — interleaving and desirable difficulty. Where: `service.ts` next
to `nextUp`; a `/drill` route in the client. Effort S-M. Risk: none (same submit path; slate ticks are
already derived).

**P4. Drill re-exposure (retention cards for code)** — what: on completing a module (all drills passed), enrol
one FSRS `concept` card "re-pass a <module> drill"; reviewing it opens a random drill of that module in a
"retention" frame; pass → `good`, fail → `again`, grade written by the server from the verdict. Why: L1 —
the biggest gap: nothing measures retention of code skills. Where: `study-quest.ts`-style enroll +
`reviews/queue` branch + `Review.tsx` card type. Effort M. Risk: low — the re-pass pays 0 XP (once-per-unit
rule) and never ticks the slate (first-pass rule); the review XP cap applies.

**P5. Due alt-sets in "Due now" + alt-set gap by score** — what: list DESIGN IT/alt sets whose gate opened and
that are unanswered; make the gap depend on the last coverage (L2). Where: `ladder-service.ts:310-336`,
`CompetenciesResponse`, `Dashboard.tsx:204-246`. Effort S. Risk: none.

**P6. Slate settings + focus** — what: `track.slate_drills` and `DRILL_SET_SIZE` per track editable via
`PUT /settings/slate` and `bootquest slate --tracks java,sysdesign --size 3`; the engine already derives
closed days from stored rows (`streak.ts:348`), so history is safe. Why: L12 — a 22-action day is not
sustainable; focus blocks are a legitimate practice design. Effort S. Risk: low; log the change as a row so
the heatmap can annotate it.

**P7. Demotion guard + undo-proofing in Review** — what: `ReviewQueueItem.lapseWouldDemote`; confirm on
`Again` for those; fix BUG-1 first; endorse the backlog's **demotion cap** (one per competency per day) with
the reason that a single bad evening of flashcards should not erase a three-leg promotion. Effort S. Risk:
none.

**P8. Global search + repo dossier** — what: `Ctrl+K` palette over a slim `GET /units/index` (id, key, title,
kind, track, state); `/repo/:name` page listing the repo's quest pack, EB sets (A/B/C state), katas, notes,
and the learner's evidence on them. Why: 5,076 units are unreachable except by walking a track; a dossier is
how you prepare a repo for an interview. Effort M. Risk: none (titles/states only; locked acts stay locked as
in `getUnitDetail`).

**P9. Self-rating + time-on-task** — what: before the verdict is shown, a one-key confidence (1 sure / 2
unsure / 3 guessing) and the editor's `elapsedMs`; stored on `attempt.answer` (client-supplied, never read by
XP/evidence); Stats shows calibration (confidence vs verdict) and a "slow passes" list. Why: L8/L11 —
metacognition and struggle detection without any grading change. Effort S. Risk: low; document it as
display-only like the rubric ticks.

**P10. Competency over time** — what: a step chart per competency from `evidence` rows of kind
promotion/demotion (already append-only) plus the explain-back coverage trend. Where: `GET /stats/competency`,
Stats panel. Effort S. Risk: none.

**P11. Backup/export/restore ergonomics** — what: `bootquest backup` (VACUUM INTO on demand),
`bootquest restore <snapshot>` (refuses while the server runs, renames the current DB like `reset`),
`bootquest export --jsonl` (attempts, runs, evidence, xp_event, review_log) for the owner's own analysis.
No JSON *import* (a forgery path); restore is whole-snapshot only. Effort S-M. Risk: none.

**P12. Card flagging for the next seed session** — what: "Flag this card/item" on Review and Player writes a
local `content_flag` row (key, note, created_at); `bootquest flags` lists them. Why: the owner already keeps
a list of frozen wrong items (elihandoff/README.md:43-46); capture them where they are noticed. Effort S.
Risk: none.

**P13. CLI review mode + reminders** — what: `bootquest review` (text front/back, 1-4 grade) so the CLI
covers the daily loop; `bootquest today --notify` emits a Windows toast via PowerShell when the slate is
open after a chosen hour (Task Scheduler entry documented). Effort S. Risk: none. (A phone flashcard mode
would need the Host guard relaxed to a LAN address — a deliberate security trade-off; the CLI mode is the
no-risk alternative.)

**P14. Rubber-duck voice notes** — record in-browser (MediaRecorder), save to `<db dir>/voice/<attempt>.webm`
via a new POST; no transcription (no ASR offline), so it is a reflection aid, not an answer medium. Effort M.
Low learning value relative to P1-P9; listed because it was asked.

Endorsed from the existing backlog (reason only, not re-proposed): **demotion cap** (P7 reason); the
**system-design promotion path** (SEEDING §8 "OPEN (sysdesign wave, owner decisions)") — with 87 DESIGN IT
sets and 129 sysdrills, the competency the owner is investing most in cannot move, which undercuts the
truth layer; a sysdrills-module-based artifact leg would be the cheapest option.
