# UI audit — COMPLETE (started 2026-10-09, completed and fixed 2026-10-14 on branch `ui-fixes`)

> Status: the 2026-10-09 run below was PARTIAL (stopped mid-run). The 2026-10-14 completion pass
> (section **Completion pass** at the end) finished the interactive matrix, confirmed #4 and #15,
> added findings #16-#26 and FIXED every bad and polish UI finding (fix-status table at the end).
> Two content findings (#24, #25) are routed to the content/factory owners, not fixed here.
> 2026-10-14 **W10 polish** (section at the end, branch `ui-polish`): the routed prose / tracks-refresh / uncovered-legs /
> empty-reading / untitled-guide items, plus re-audit findings #27-#28, all fixed.
> 2026-10-14 **W11 final sweep** (section at the end, branch `ui-final`): the post-W10 screens (B2 stats charts, B3 skill
> tree, B4 written player, merged track refresh) on a seeded multi-day DB; findings W11-1..W11-13, all fixed.

Audit of the live stack at 3795a39: server `BOOTQUEST_DB=<temp> BOOTQUEST_PORT=4178 node --import tsx server/src/api/serve.ts`
(all packs loaded: 3,987 pack units, 259/67/4 campaign quests, 26 study-quest gates), client `npm run build:client` +
`npx vite preview --port 4173` from client/ (preview inherits the `/api` proxy from `server.proxy`; NOTE: preview binds
**[::1]:4173 only**, not 127.0.0.1 — curl/browse via `localhost` or `[::1]`). Driven with headless Chrome over CDP
(no puppeteer needed — Node 22 native WebSocket; driver at `<scratchpad>/cdp.mjs`, scenario sweep `<scratchpad>/batch1.mjs`,
machine metrics in `<scratchpad>/batch1-report.json`). Screenshots in `<scratchpad>/shots/` where
`<scratchpad> = C:\Users\Owner\AppData\Local\Temp\claude\C--Users-Owner-Desktop-selfboot\93c1cb20-7eb4-4ebb-b2c2-8ac3a836aca3\scratchpad`
(session-scoped — may be gone for a successor; every finding below names its screenshot, and all are reproducible from the URLs given).

Automated probe result: **no document-level horizontal overflow on ANY screen at 400x850 or 1440x900** (scrollWidth vs
innerWidth checked on all 42 page loads) — the blind `min-width:0` fix from P5 held. Remaining phone issues are inner-scroll
and clipping issues, listed below.

Unit-id map used (fresh temp DB, stable for a fresh seed): quiz 1 · predict-output 3 · drill-js 4 · drill-cs 2570 ·
written 2564 · reading 4003 · study-quest 3988 (available) / 4012 (act-2 locked) · explain-back 4314 · G2 brief 4324 ·
kata 4347 · repo-task 4368 · guided-project 4369.

## Findings

Severity: broken (unusable/dishonest) | bad (wrong but survivable) | polish.

1. **bad** — Locked-act unit is fully served and playable by direct URL. `/play/4012` (act-2 js study quest, campaign
   state "locked") renders the complete reading list, pinned sha and quiz gate; `GET /api/units/4012` returns
   `unit.state:"available"` plus the full `studyQuest` (5 reading steps, 11 questions). Only `POST /submit` is refused
   (403 ACT_LOCKED) — so the learner reads locked content and can fill all 11 answers before hitting a generic error.
   Shots: `play-study-locked-1440.png`, `play-study-locked-400.png`. Suspect: server `server/src/api/service.ts`
   (getUnit has no act gate — contrast the `retestGate` pattern which hides a closed retest's task) and client
   `client/src/pages/Player.tsx` (no ACT_LOCKED render state). Fix: serve a gate object (like `retestGate`) for
   locked-act units and render a locked panel; do not serve readingSteps/questions.

2. **bad** — Quiz prompts are UPPERCASED and show raw markdown fences. `/play/1` renders the question as
   `WHAT HAPPENS WHEN YOU RUN: ```JS CONST X = 1; X = 2; ``` ` — `.panel-title { text-transform: uppercase }`
   (client/src/styles/app.css ~line 336) destroys case-sensitive code (`const x` → `CONST X`), and the fenced code
   block is not parsed. Shot: `play-quiz-1440.png` (also -400). Suspect: `client/src/pages/Player.tsx` QuizPane/PredictPane
   `<h2 className="panel-title">{prompt}</h2>` + `client/src/lib/view.ts` unitProse. Fix: render the prompt as body text
   (not a panel-title), extract ``` fences into `.code-block`.

3. **bad** — Written-unit instructions flatten code into prose. `/play/2564` shows the proposed handler as one wrapped
   paragraph: `1 app.patch('/tasks/:id', requireSession, async (req,res) => { 2 const task = ...` — line numbers inline,
   unreadable for the review task it sets. Shot: `play-written-1440.png`. Suspect: instruction prose pipeline
   (`unitProse` paragraph-split + `<p>` rendering in Player.tsx instructions panel) — no code-block support.
   Fix: preserve/detect code blocks in instructions and render them in `<pre class="code-block">`.

4. **bad** — Sidebar "TRACKS" list intermittently empty on campaign pages. `campaign-csharp-1440.png` and
   `campaign-java-1440.png` show the TRACKS header with zero rows (the page's own track tabs render fine);
   `campaign-js-1440.png` shows it populated. `GET /api/tracks` takes ~580ms per call (it counts 4,369 units) and
   campaign pages fire two concurrent copies (AppShell + CampaignView) plus campaign + review-queue; AppShell renders
   `tracks.data ?? []` with no loading placeholder, so the list collapses to nothing while slow/failed. NOT yet
   confirmed whether it fills in eventually (stop order hit first) — successor: load /campaign/csharp, wait 5s,
   re-screenshot. Suspect: `client/src/components/AppShell.tsx` (~line 100) + slow `/tracks` endpoint; fix: skeleton
   rows or share one getTracks via context, and cache the counts server-side.

5. **bad** — Evidence-browser `<select>` renders as a white/light native control on the dark theme (hard contrast
   break, looks broken next to tokens). Shot: `stats-1440.png` (top-right of Evidence browser panel). Suspect:
   `client/src/pages/Stats.tsx` competency filter select — app.css never styles `select`. Fix: style it like `.btn`
   (background var(--surface-2), color var(--text), border var(--border)).

6. **polish** — Phone nav (≤760px breakpoint): at 400px the 4th item "Stats" is clipped at the right edge (icon
   half-visible, label off-screen); the bar is `overflow-x:auto` but nothing signals scrollability. Shots:
   `dash-400.png`, `review-empty-400.png`. Suspect: app.css @media 760 `.sidebar`/`.nav`. Fix: tighter padding/labels
   or icon-only nav at ≤420px.

7. **polish** — Dashboard competency table at 400px: Promotion + Last-evidence columns are cut off behind the
   `.table-wrap` inner scroll with no affordance, and rows are ~90px tall with dead space. Shot: `dash-400-bottom.png`.
   Suspect: `.table-wrap`/`.comp-table` CSS. Fix: stacked card layout or a scroll shadow at phone width.

8. **polish** — Reading unit gives nothing to read. `/play/4003` ("Reading: JS-Exercise-Closures-…") has no link to the
   repo/material, instructions say "No written instructions are served", and an empty "Competencies" label renders with
   zero chips. Shot: `play-reading-1440.png`. Known G7 content gap, but the player should at least link the repo (the
   study-quest pane shows how) and hide the empty competencies row. Suspect: Player.tsx ins-foot + ReadingPane.

9. **polish** — Stats placeholders say "Lands in W7." for XP-over-time and pass-rates while the repo is past W8.
   Stale copy either way: ship the charts or reword. Shot: `stats-1440.png`. Suspect: `client/src/pages/Stats.tsx`.

10. **polish** — Explain-back and kata players fire an expected 403 on mount (key endpoint probed to detect an already-
    answered unit), logging a network error to the console on every load (seen on /play/4314, /play/4324, /play/4347 in
    `batch1-report.json`). Suspect: `client/src/pages/LadderPanes.tsx` (comment at line 43) — have the server return
    200 `{available:false}` instead, or accept the noise.

11. **polish** — Kata diff: long lines clip at the pane edge and need horizontal scrolling inside `.code-block`
    (overflow-x:auto — scrollable, not lost); at 400px the diff is clipped mid-token and sideways-scrolls poorly. The
    kata panel title also duplicates the full page title, uppercased (3 lines of shouting at phone width). Shots:
    `play-kata-1440.png`, `play-kata-400.png`. Suspect: KataPane title + `.code-block` CSS; consider a wrap toggle and
    dropping the duplicate title.

12. **polish** — Campaign track tabs wrap to two lines each at 400px ("JS/TS + / React", underline under the second
    line). Functional but scruffy. Shot: `campaign-js-400.png`. Suspect: `.tabs`/`.tab` CSS (allow horizontal scroll
    like the nav, or shorter labels).

13. **polish** — `/play/999999` (NOT_FOUND) shows a big empty error panel with a pointless "Retry" button for a
    permanent 404. Shot: `unit-404-1440.png`. Suspect: PlayerPage error path passing `onRetry` unconditionally
    (`client/src/pages/Player.tsx` ~line 41).

14. **polish** — Phone stats tiles each carry ~80px of dead vertical space (min-height sized for desktop). Shot:
    `stats-400.png`. Suspect: `.tile`/stats tile CSS.

15. **polish (CONFIRMED 2026-10-14, see Completion pass)** — Dashboard heatmap "today" cell outline looks visually offset/floating past the
    right edge of the grid between row lines. Shot: `dash-1440.png` (right end of the grid). Not zoomed/confirmed
    before the stop — successor: screenshot `.heatmap` region cropped, check `client/src/components/Heatmap.tsx`
    today-cell styling.

Noted, not defects: fresh-DB slate shows "1 / 4 cleared" because the review-clear slot auto-completes when nothing is
due (spec'd); locked acts list all quests making /campaign/js very long (~13k px) — scrolling stayed smooth in capture;
act ordinals render per-track ("Act 1") though the API's act ids are global — correct as displayed.

## Verified-OK screens (viewed, no issues beyond the findings above)

Desktop 1440x900: dashboard (top+bottom), campaign js (top/mid/bottom), campaign csharp (top), campaign java (locked
banner + placeholder act), review empty state, stats, unit-404 error state, drill player (js), quiz, predict-output,
study-quest (available), explain-back, G2 brief, kata, written, reading.
Phone 400x850: dashboard (top+bottom), campaign js (top), review empty, stats (top), drill js, quiz, kata, study-quest
(bottom). No horizontal document overflow anywhere (automated check, all screens, both viewports).

## NOT covered (successor's worklist)

Captured to `<scratchpad>/shots/` but never inspected (re-capture if scratchpad is gone): notfound-1440/400 (the `*`
route), unit-404-400, play-drill-cs-1440/400, play-predict-400, play-written-400, play-explainback-400, play-g2brief-400,
play-reading-400, play-study-400 (top), play-study-locked-400, play-repotask-1440/400(+bottom), play-guided-1440/400
(+bottom), campaign-csharp mid/bottom + all csharp/java 400 shots, campaign-js-400 mid/bottom, stats-400-bottom.

Never reached at all (the whole interactive half of the mission):
- Drill run/submit results (failure diff rows, pass verdict, XP line, zero-layout-shift while busy), both js and cs
  (a cs run spins up the csc compile server — first run ≤60s).
- Reveal flow: confirm dialog (`role=alertdialog`), "0 XP forever" badge, revealed solution view, quiz choice-right
  marking from a revealed key.
- Quiz wrong/right submit states; predict-output wrong/right; reading self-attest (+5 XP verdict / already-attested).
- Study-quest quiz form, fail result (miss-cards notice), pass result, "Try again" reset; ACT_LOCKED submit error
  rendering on /play/4012.
- Explain-back full flow (answers → stored → key + self-score checklist → coverage result) and kata flow (findings →
  key → self-score) — the diff/self-score UIs are the least-tested screens in the app.
- Review session WITH due cards. Recipe: `POST /api/units/3988/submit {"answers":[0,0,0,0,0,0,0,0,0,0,0,0,0,0],"selfAssisted":false}`
  (14 questions — misses become cards due TOMORROW), then bump them due with node:sqlite against the temp DB:
  `UPDATE review_item SET due_at = <now_ms> WHERE kind <> 'retest'` (review_item has no append-only trigger; the server
  itself UPDATEs it on grade), then /review: front, revealed back, grade bar, long-code fronts, keyboard 1–4 grading.
- Stats with evidence rows + competency filter + `#evidence-<id>` deep link from the dashboard table.
- Dashboard seeded state (XP today, heatmap buckets, slate drill/campaign slots done, streak day counted).
- ShortcutHelp (`?`) and g-chord hint overlays; focus-visible pass (Tab ring on step boxes, choices, grade buttons).
- Act-2 unlocked rendering. Cheap method found: study-quiz submits echo per-question correct flags, so each gate is
  solvable in ≤5 free submits (submit all-0, all-1, all-2, all-3; compose the correct vector; submit it). js act-2
  needs 80% of act-1's 15 core quests (12 passes) AND level 4 — check /api/dashboard xp after passing 12 gates
  (50 XP each) whether level 4 is reached; csharp act-2 needs level 4 too with only 5 act-1 gates, likely NOT
  reachable → verify ladder/level math or accept locked-only coverage.
- Forced-colors / --force-dark-mode spot checks (app is dark-only by design — tokens.css declares no light variant,
  so "light theme" findings don't apply; forced-colors mode was still unchecked).

## Rebuild-the-rig notes for the successor

- Server boot ~75s (pack loading); startup summary prints course/quest counts. DB is any temp path.
- vite preview listens on ::1 only; the CDP driver uses `http://localhost:4173` which resolves fine in Chrome.
- CDP driver (`cdp.mjs`): launch chrome `--headless=new --remote-debugging-port=9333 --remote-allow-origins=*`,
  `PUT /json/new`, native WebSocket, Emulation.setDeviceMetricsOverride per viewport, Page.captureScreenshot,
  Runtime.evaluate for clicks/typing, console/exception capture, and an overflow probe (scrollWidth + offending
  elements) per shot. `.main` is the scroll container (the document never scrolls) — "full page" = scroll `.main`
  and shoot viewport slices; captureBeyondViewport does NOT work here.
- Settle condition: `[data-page-title]` present && no `.skeleton` && +600ms.


---

## Completion pass (2026-10-14, W9 — branch `ui-fixes`)

Rig: same as above, but client in **dev mode** (`npx vite --port 5173` from `client/`, `/api` proxied) and the server
on a copy of the predecessor's seeded DB (`ui3.db`, already holding review cards, evidence and attempts). NOTE: two
stale processes from the 2026-10-09 run were still listening on 4178/5173 (the earlier "all killed" note was wrong);
they were tree-killed before the rebuild. Driver: the same `cdp.mjs`; re-shoot scripts `cap9.mjs` / `cap9b.mjs`
(prefixes `w9-`, `w9b-`, `w9dark-` in `<scratchpad>/shots/`). Every re-shot screen at 1440x900 AND 400x850 passed the
document-overflow probe (zero horizontal overflow) and logged no console errors except the deliberate 404 on
`/play/999999`.

### Confirmations

- **#4 CONFIRMED** — the sidebar TRACKS list DOES fill eventually (`f4b-csharp-after5s.png`), but is empty while
  `/tracks` is in flight (`f4b-csharp-early.png`); the campaign tabs meanwhile show raw ids (`js csharp agentic java`)
  in the wrong order and relabel/reorder on arrival (new finding #22). `/tracks` on an idle server measures ~0.1s
  (three calls: 0.106 / 0.112 / 0.076s); the ~580ms seen on 10-09 was during pack loading under load.
- **#15 CONFIRMED** — the today ring is a `box-shadow` outline on the last grid column, clipped by `.heatmap-body`'s
  `overflow-x: auto` box (`f15-heatmap-zoom.png`).

### Interactive matrix (all states reached)

Driven by the predecessor's `ia1`-`ia4` scripts (shots `ix-*`, inspected in this pass) plus `ia6-unlock.mjs`:
drill run (fail rows) + submit (pass verdict, XP line) for js and C# (first C# run 51.5s: compile-server warm-up);
reveal confirm -> revealed solution -> "Guided · 0 XP" badge -> 0 XP (revealed) guided submit; quiz wrong/right, with
the right choice marked only from a revealed key; predict wrong; reading attest (+5 XP) and already-attested;
study-quest fail (miss-cards notice) / pass / Try again reset; ACT_LOCKED submit error on the locked quest;
explain-back full flow (answers -> confirm -> stored key -> self-score -> coverage verdict); kata findings -> key ->
catch score; review session with 18 due cards (Space reveal, 1-4 grading, long fronts); dashboard + stats seeded
(evidence rows, competency filter, `#evidence-<id>` deep link scrolls to the row); `?` shortcut help, g-chord hint,
focus rings on steps / choices / grade buttons. **Act 2 unlocked**: solving all 19 loaded act-1 gates (js 14 +
csharp 5) by the echo trick reached level 4 (1,032 XP); js act 2 unlocked (`core 15/15`) and `/play/4012` became
available with its 11 questions (`w9-campaign-js-act2-*`, `w9-play-study-unlocked-*`). Force-dark spot check
(`w9dark-*`): identical — the app is dark-only by design (tokens.css has no light variant), so no light-theme
findings apply.

### New findings

16. **bad** — `.dialog` was defined TWICE in app.css: the W1d inline-confirm rule (translucent `--warning-soft`
    background) also hit the modal shortcut help, so the page bled through the modal (`ix-shortcuts-1440.png`); the
    inline reveal / explain-back confirms inherited the modal's `width: min(720px, ...)` and overflowed across the
    neighbouring pane with the content behind showing through (`ix-reveal-dialog.png`, `ix-eb-confirm.png`). They
    also claimed `aria-modal="true"` without being modal, and nothing took focus.
17. **bad** — raw markdown well beyond #2: literal backticks and `**bold**` in drill instructions (`swap`,
    `**Concepts:**`), quiz and study-quest choices (rendered as whole-line monospace), study-quest prompts, review
    card fronts and backs, explain-back prompts and kata defect text; the C# drill's 4-space-indented examples were
    joined into one prose line (`ix-drill-cs-run.png`, `ix-review-front.png`, `ix-study-fail.png`).
18. **polish** — a failing check's multi-line assertion message (`Expected values to be strictly deep-equal:` plus
    its diff) collapsed into one unreadable line (`ix-drill-run-fail.png`).
19. **polish** — after a keyboard action the route-change focus target (the page `<h1>`) shows a large focus ring,
    e.g. the review title after Space (`ix-review-back.png`).
20. **polish** — the "Guided · 0 XP" header chip sits ~2px below its sibling chips (its wrapper span is inline, not
    flex) (`ix-drill-submit-pass.png`).
21. **polish** — a long page title squeezes the header chips into a vertical stack (kata, `ix-kata-key.png`).
22. **polish** — campaign tabs render raw track ids in the wrong order until `/tracks` answers, then relabel and
    reorder (layout shift) (`f4b-csharp-early.png`).
23. **polish** — quiz / predict units say "No written instructions are served for this unit yet." in the
    instructions panel although the question was promoted into the answer pane (`play-quiz-1440.png`).
24. **bad (content honesty — ROUTED, not a UI fix)** — quest packs `csharp-tut` (14/14), `csharp-interview` (13/13)
    and `dotnet-snapshot` (13/13) key EVERY quiz question at choice index 0, and choices are served in authored
    order, so "always pick the first answer" passes the gate. Observed live: the `csharp-tut` gate passed on the
    uniform all-0 submit (`ia6-unlock.mjs` output). Owner: factory / `seed:quests` (balance or shuffle key positions
    at seed time, then `seed:check -- --restamp`). Not touched here: fingerprinted content, outside the UI wave.
25. **polish (content — ROUTED)** — js act 2 holds 22 core quests of which only 2 have quest packs (20 content
    pending), so act 3 (80% of act-2 core) is unreachable until that content lands; the map shows it honestly.
26. **observation (not changed)** — sidebar track % stays 0% after clearing campaign quests: the count is over
    practice units only (campaign placeholder units are excluded by design). Candidate for the stats wave.

Not defects (re-checked): the streak shows 0 days on a day with +950 XP — today is "in progress" until day close
(spec'd); the quiz pane's tall empty results box is the zero-layout-shift reservation for the verdict.

### Fix status (all fixes on `ui-fixes`; re-shots `w9-*` / `w9b-*` at 1440 and 400)

| # | sev | status | fix (file) | re-shot |
|---|-----|--------|------------|---------|
| 1 | bad | FIXED (server + client) | `getUnitDetail` act gate mirroring the retest withhold: a unit whose every act is locked returns `actGate: {locked: true}`, `unit.state: "locked"` and NO check / instructions / starter / snippet / rubric / refs / studyQuest / explainBack / kata (`server/src/api/service.ts`); writes still 403 ACT_LOCKED. The client renders a locked panel linking to the unlock rule (`Player.tsx` `ActLocked`). Tests: no-leak (raw body holds no question prompt, choice or `readingSteps`; by-key too) and 403 on submit / run / reveal (`server/test/api/study-quests.test.ts`), plus a client render test. | `w9-play-locked-*` |
| 2 | bad | FIXED | the prompt is an `h2.prompt-title` in original case with inline code; a fence renders as `pre.code-block` (`client/src/lib/prose.tsx`: tiny escape-safe renderer, React nodes only, no markdown library; `Player.tsx` `PromptHead`) | `w9-play-quiz-*`, `w9-play-predict-*` |
| 3 | bad | FIXED | `unitProse` keeps the raw text (chunks split at blank lines outside fences); the renderer turns fences, 4-space indents and 1..n numbered listings into code blocks (`lib/view.ts`, `lib/prose.tsx`) | `w9-play-written-*`, `w9-play-drill-cs-*` |
| 4 | bad | FIXED | ONE shared `/tracks` request (`lib/tracks.tsx` provider mounted by `AppShell`; Campaign reuses it) + placeholder rows in the server's order and names with `aria-busy` (no empty header, no shift) | `w9b-tracks-early-1440`, `w9-campaign-csharp-*` |
| 5 | bad | FIXED | `select` / `option` styled with the dark tokens (`app.css`) | `w9-stats-*` |
| 6 | polish | FIXED | at 480px and below the nav is icon over a small label, the four items share the bar, the badge is pinned (`app.css`) | `w9-dash-400` |
| 7 | polish | FIXED | at 760px and below the competency table becomes stacked rows (no hidden columns) | `w9-dash-bottom-400` |
| 8 | polish | PARTIAL | the empty Competencies row is hidden; unit `refs` render as sha-pinned GitHub links (`Player.tsx` `RefList`). `/play/4003` itself serves no refs and no prose (content gap G7), so there is nothing to link | `w9-play-reading-*` |
| 9 | polish | FIXED | placeholder copy no longer promises "W7" (`Stats.tsx`) | `w9-stats-*` |
| 10 | polish | FIXED | unit detail carries `explainBack.answered` / `kata.answered` (the key route's own predicate); the client skips the key probe when false: zero console 403s on /play/4314, 4324, 4347 (`ladder-service.ts`, `LadderPanes.tsx`, `shared/src/api.ts`) | `w9-report.json` probes |
| 11 | polish | FIXED | kata pane heading "Review the patch" (no uppercased duplicate title) + a Wrap lines toggle (`aria-pressed`) for long diff lines | `w9-play-kata-*`, `w9-play-kata-wrap-*` |
| 12 | polish | FIXED | at 760px and below the track tabs scroll sideways and labels never wrap | `w9-campaign-csharp-400` |
| 13 | polish | FIXED | NOT_FOUND renders a compact message + links: no Retry, no 560px box | `w9b-unit-404-*` |
| 14 | polish | FIXED | at 760px and below tiles size to their content | `w9dark-stats-400`, `w9-dash-400` |
| 15 | polish | FIXED | the today ring is an INSET shadow, never clipped by the scroll box | `w9-dash-1440` |
| 16 | bad | FIXED | inline confirms get their own opaque `.confirm` class; the modal `.dialog` is opaque again; no false `aria-modal`; Cancel takes focus; Escape cancels | `w9b-reveal-confirm-*`, `w9b-eb-confirm-*`, `w9-shortcuts-1440` |
| 17 | bad | FIXED | prose / inline prose in instructions, choices, study prompts, review faces, explain-back prompts, kata key text | `w9-review-*`, `w9-play-study-unlocked-*` |
| 18 | polish | FIXED | `.test-msg` keeps its line breaks | `w9-drill-run-fail-1440` |
| 19 | polish | FIXED | no ring on the programmatically focused page title | `w9-review-back-*` |
| 20 | polish | FIXED | header chips share one baseline | `w9-play-drill-js-1440` |
| 21 | polish | FIXED | header chips never shrink on desktop; they wrap under the title at 760px and below | `w9-play-kata-*` |
| 22 | polish | FIXED | tab placeholder = the server's order + names (`TRACK_PLACEHOLDER`, `lib/view.ts`) | `w9b-tracks-early-1440` |
| 23 | polish | FIXED | "The question is in the answer pane." | `w9-play-quiz-*` |
| 24 | bad | ROUTED | content / factory (see the finding) | — |
| 25 | polish | ROUTED | content | — |
| 26 | obs | FIXED (campaign 2 B2, branch `stats-charts`) | one server-owned `TrackProgress` (shared/src/api.ts; rule in server/src/engines/stats.ts `trackProgress`): campaign core quests done / total over all acts (practice units when a track has no core); GET /tracks, /tracks/:id/units and /stats/campaign all use it; sidebar + campaign page show it with the definition as tooltip; a successful progress mutation (submit, self-attest, explain-back / kata self-score, review grade) marks the list stale and the NEXT navigation re-reads /tracks silently (lib/tracks.tsx; plain navigations cost no request). Definition is core-only by design (practice is shown in the tooltip, not blended into the %) | verified by tests (server/test/api/stats.test.ts "ui-audit #26", client/src/pages/stats.test.tsx "ui-audit #26"); the `b2b-campaign-*` / `b2b-stats-*` screenshots were session-scratchpad only and are NOT committed (like every other shot in this report). Only the dark theme exists (tokens.css is dark-only), so no light-theme check was made |

Client regression tests: `client/src/pages/ui-audit.test.tsx` (16 tests: renderer parse + escape-safety, prompt case +
fence, numbered listing, locked act, 404 without Retry, no key probe, kata heading + wrap, confirm focus / Escape, one
shared `/tracks` + placeholder rows, refs + hidden empty competencies). Server: no-leak + 403
(`server/test/api/study-quests.test.ts`), `answered` flags (`server/test/api/ladder.test.ts`).


---

## W10 polish (2026-10-14, branch `ui-polish`)

Rig: server `BOOTQUEST_DB=<copy of ui3.db> BOOTQUEST_PORT=4301 node --import tsx server/src/api/serve.ts` + client dev
`BOOTQUEST_PORT=4301 npx vite --port 5301` (the vite `/api` proxy now reads `BOOTQUEST_PORT`, default still 4178, so a
parallel rig never collides with 4178/5173). Same CDP driver as W9 on its own debugging port (9401), one foreground
shell call per sweep (`rig.sh`: boot, capture, tree-kill 4301/5301/9401). Sweep: dashboard, campaign js, drill, drill with
uncovered legs, quiz, written, study quest, study quest with untitled guides (4026), explain-back, kata, reading (4003),
review, stats at 1440x900 and 400x850, `prefers-color-scheme` dark AND light (76 viewport shots + bottoms, prefixes
`w10-`, `w10s-`, `w10b-`, `<scratchpad>/w10/shots/`). Every shot: zero document-level horizontal overflow, zero console
errors or warnings. The light-scheme shots are byte-identical to the dark ones (`cmp`): the app is dark-only by design
(tokens.css declares no light variant; settled in P5), so "light" is verified as "renders the same, legibly", not themed.
Rig gotcha: `Tab.waitFor` treats a STRING as a CSS selector; pass a function for a predicate (the first W10 sweep waited
the full 20s per screen because of this; its shots are still post-load, the re-shoots `w10s-`/`w10b-` settle properly).

### Routed findings fixed

| item | fix (file) | test | shot |
|------|------------|------|------|
| prose (a) | a numbered run is code only with 3+ lines or a code-like character `( { ; =` (`=>` included) after the number; a two-step prose list stays prose (`lib/prose.tsx`) | `w10-polish.test.tsx` prose (a) | `w10-play-written-*` |
| prose (b) | a fence closes only on a line that is exactly a marker (`/^\s{0,3}(```+\|~~~+)\s*$/`) of the same character and at least the opening length; `proseChunks` uses the same rule (`closesFence`) | prose (b) | — |
| prose (c) | `splitPrompt` promotes the first block to the heading only when it is a paragraph; a code-first prompt keeps source order under the fallback heading | prose (c) incl. a render test | `w10b-play-quiz-*` |
| tracks refresh | `TracksProvider.refresh()`: background re-read, rows stay until the answer lands (no placeholder flash, no `aria-busy`, no shift); requests never overlap (a refresh during a read queues ONE follow-up; `{join:true}` shares the in-flight read); a failed background refresh keeps the rows. Called after every recorded drill / quiz / predict submit, reading self-attest, study-quiz submit and explain-back / kata self-score, and on Campaign mount (joins the first read on a cold load, so the W9 one-request test still holds) (`lib/tracks.tsx`, `Player.tsx`, `StudyQuestPane.tsx`, `LadderPanes.tsx`, `Campaign.tsx`) | 6 tests | live: attest on /play/4005 fired a 2nd `/api/tracks`, then dashboard -> campaign a 3rd (`refresh10.mjs`, `w10-refresh-after-attest-1440`) |
| uncoveredLegs | the program-unit player shows an honest "Not machine-checked" note (warning tokens, `role=note`) listing every leg under the instructions; nothing when absent (`Player.tsx` `UncoveredLegs`) | 2 tests | `w10-play-uncovered-*` (legs INJECTED via CDP `Fetch` into `/api/units/4`: this DB has no synced `gh:` program unit and `check-specs.json` currently declares no legs) |
| #8 reading empty | a reading unit with no prose and no refs says so and names what its own key does (`campaign/<track>/<repo>`): the campaign map link + the source repo as code; no GitHub link is built (the unit carries no owner); a non-campaign key says the source is not named (`Player.tsx` `ReadingEmpty`, `view.ts` `campaignSourceOf`) | 3 tests | `w10s-play-reading-*` |
| "(untitled guide)" | client-only: a reading item titled with the factory placeholder shows its path basename (study-quest reading list and unit refs); factory untouched (`view.ts` `readingTitle`) | 2 tests | `w10-play-study-untitled-*` (4026 shows `taskService.ts`, `tasks.ts`) |

### New findings (W10 re-audit)

27. **polish — FIXED** — answer-first units (study quest, explain-back, kata) said "No written instructions are served
    for this unit yet." in the instructions panel although their task sits in the work pane (same class as #23). Now:
    "The reading list and the quiz gate are in the study pane." / "The patch to review is in the review pane." / "The
    questions are in the answer pane."; a content-pending study quest (no `studyQuest`) keeps the old honest line.
    Test in `w10-polish.test.tsx`; shots `w10b-play-study-*`, `w10b-play-kata-*`, `w10b-play-explainback-*`.
28. **test flake — FIXED (no assertion weakened)** — under ten-agent CPU load the client suite's full-app flows
    intermittently missed Testing Library's 1s `findBy`/`waitFor` window (seen: W9's kata key test, a W10 render test).
    `client/src/test/setup.ts` sets `asyncUtilTimeout: 5000` (a longer window only delays a failing wait), and the W9
    kata test now unmounts its first app before mounting the second. Three consecutive full client runs green after.

Observed, not changed: at 400px a short page title lets the header chips sit beside the eyebrow (quiz) while a long one
wraps them under the title (drill, kata), both readable (W9 #21 behaviour); the study reading list repeats the file name
in the path line after the basename fallback (the path carries the directory and line range, so it stays); sidebar
track % stays 0% after campaign progress (#26, practice units only).


---

## W11 final sweep (2026-10-14, branch `ui-final`)

Scope: everything that landed after W10's sweep (B2 stats charts, B3 skill tree, B4 written player, the merged
track-progress / tracks-refresh behaviour) plus a re-look at every player type, at 1440x900 and 400x850.

Rig (session scratchpad `w11/`, not committed): a FRESH temp DB booted through the real entrypoint defaults (all 107
quest packs, 4 code packs, campaign, seed items) by `serve-clock.mts`, a wrapper around `startServer` whose clock is
`Date.now() + <ms in clock-offset.txt>` re-read per call; server on 4322, vite dev on 5322 (`BOOTQUEST_PORT=4322`),
headless Chrome over CDP on 9422 (the W9/W10 `cdp.mjs`). `seed-activity.mjs` drove REAL API submits day by day from 130
days ago to today: bootforge quizzes (some wrong first; answers looked up in the SERVED choice order, since #24 shuffles
it), JS drills (some starter fails first; two after a reveal = guided), predict-output (wrong then right), C# drills
(starter fail + pass, real `csc`), reading self-attests, study-quiz gates (fail-only and echo-solved) and review grades
across all four ratings; six days cleared the full slate (5 new JS + 5 new C# drill passes, a campaign step, the review
queue), so the streak, banked slate days and heatmap statuses are server-derived, not faked. Then today: 9 more js act-1
gates (js act 2 unlocked, act 3 locked) and 10 cards made due with the W9 node:sqlite recipe. Rig gotcha: the clock may
only move FORWARD between calls that reach `closeElapsedDays` (any `/dashboard` or slate read). A first attempt read
`/dashboard` at real time between batches, which closed every later day as "missed" before its activity was written (a
rig artifact; a real learner cannot travel back), so the DB was rebuilt in one forward pass. Final state: level 8, 3,830
XP, 66 active / 5 slate / 47 partial days, streak 4, 493 graded submits, 219 review cards, 62 due.

Sweep (`cap.mjs`, `ix.mjs`, `verify.mjs`): dashboard, campaign js / csharp (list), skill tree (default, keyboard focus
ring, act collapsed via Enter, Collapse all / Expand all, Enter on an available quest, locked node inert, `v` toggle,
csharp tree), stats (empty state on the fresh DB AND populated: tiles, XP daily + weekly, pass rates, review forecast,
grades, campaign progress, catch rate, evidence, data tables open, arrow-key readouts), study quest, JS and C# drill,
explain-back, kata, written (before, typed, confirm, after with model answer + rubric ticked by keyboard, reload),
reading, quiz, locked-act unit, review (Space reveal, keyboard grades 1-4, grade-bar focus ring). Automated per screen:
document-level horizontal overflow (none, any screen, both widths), console errors / warnings (none), SVG chart text
outside its svg box, clipped text (scrollWidth > clientWidth under overflow hidden / ellipsis), and cumulative layout
shift (PerformanceObserver: max 0.0067 on /stats while the async panels fill, 0 on review / written, 0.0001 campaign).

Numbers cross-checked by hand against the seeding tally and each other: stats tiles (3,661 XP in 120 days, 66 active, 5
slate, avg 55 = 3,661 / 66); the XP chart's 90-day and all-time totals against the dashboard's 3,830; pass rates (63% =
311 of 493, the by-track and by-check-type rows each sum to 311/493, "1 pass after a reveal not counted"); the review
panel (due now = forecast day 0; forecast + "due later" = 219 cards; 30-day retention 286/325 = 88%; all-time from the
grade shares); campaign progress (8% = 12/146 js core, 2% = 1/48 csharp); streak semantics (partial days hold, missed
days reset: 4 = slate days 5..2, then a partial day 1); act unlock state against level 8.

### Findings

| id | sev | screen | issue | fix | status |
|----|-----|--------|-------|-----|--------|
| W11-1 | bad | campaign list | the act header's core progress bar was invisible: `.bar` has no width and `.act-side` is an end-aligned flex column, so it collapsed to 0px on every act | `.act-side .bar { width: 96px }` (`app.css`); live: 96px on all 5 acts | FIXED |
| W11-2 | bad | campaign list | CSS class collision: W9's locked-unit panel rule `.act-locked` (Player) also matched the campaign ActCard state class `act act-locked`, so locked act cards were narrowed to 720px (820 for the others) and their unlock line lost its warning colour and 48px indent (`.act-locked p { margin: 0; color: var(--text-2) }`) | the Player panel is `.unit-locked` now (`Player.tsx`, `app.css`); live: all act cards 820px, gate line `rgb(210,153,34)`, `margin-left: 48px` | FIXED |
| W11-3 | polish | campaign list + tree | the unlock rule listed a level the learner already had as an open requirement ("level 8 (you are level 8)") | a met level reads "level 8 (reached)" in both views (`Campaign.tsx` `unlockText`, `CampaignTree.tsx` `unlockLine`) | FIXED |
| W11-4 | polish | stats, review forecast | the x-axis dropped TOMORROW's label (the wide "Today" label overlapped it), so the tallest bar (tomorrow's misses) was unlabelled at both widths | every bar keeps its weekday; "Today" is a second, left-anchored row under the first bar (`BarChart` `subLabels`, `Stats.tsx`) | FIXED |
| W11-5 | polish | stats, reviews panel | the forecast's "Data table" rendered below the Grades block (reading as the grades' table) and also when there were no cards | the table sits under the forecast, only when cards exist | FIXED |
| W11-6 | bad | written player | Submit was enabled on the untouched starter template: one confirm click stored the empty template IMMUTABLY (no second chance at the unit) | Submit stays disabled while the answer equals the template, with a one-line reason under the field (`WrittenPane.tsx`). Fix pass: the server enforces it too: `answerWrittenUnit` refuses an answer whose trimmed text equals the trimmed starter with 422 `UNTOUCHED_TEMPLATE` (new shared error code; mock mirrors it; `errorText` maps it to a learner line), so a non-UI caller cannot store the template either. Live: POST of unit 2567's starter -> 422, model answer still 403 | FIXED |
| W11-7 | bad (a11y) | written player | after "Store answer" the form and its focused button unmounted and keyboard focus fell to `<body>` | focus moves to the "Compare with the model answer" heading (`tabIndex=-1`) after a store in this session | FIXED |
| W11-8 | polish (wrong number) | nav badge during a review session | the Review badge kept the session's starting count while grading (it was only re-read on navigation): still 62 after four grades | the Review page reports each grade's server `remainingDue` to the shell (`useDueReport`, `AppShell.tsx`), cleared on navigation; live: 59 -> 57 after two grades | FIXED |
| W11-9 | polish | study quest reading list | step titles showed literal backticks (`` `Try` ``, `` `null` ``) | titles render through `InlineProse` (`<code>`), in the study list and the unit refs; live: 0 titles with a backtick, 26 code spans on /play/4250 | FIXED |
| W11-10 | polish | written / explain-back / kata / evidence | stored timestamps were UTC ("stored Oct 15, 04:04 AM UTC") while the app's day keys are LOCAL days (the dashboard said Wednesday Oct 14), so a late-evening answer looked like tomorrow's | one local formatter (`lib/format.ts` `fmtWhen`, `fmtStamp`) in the written, explain-back, kata (+ retest date) and evidence views | FIXED |
| W11-11 | polish | campaign list, 400px | the repo meta line ellipsizes with no way to read the full repo name | fix pass: the first fix was only a `title` tooltip, which touch and keyboard cannot reach. `.step-meta` now wraps (`overflow-wrap: anywhere`, no nowrap / ellipsis), so the full repo name is visible text at every width; the tooltip was dropped. Live at 400: `grokjs-javascript-learning-lab` scrollWidth 209 -> 192 = clientWidth (wraps) | FIXED |
| W11-12 | routed (W10 review minor) | program unit | the uncovered-legs warning border was a raw rgba | `--warning-line` token in `tokens.css`, used by `.uncovered` and `.verdict-todo` | FIXED |
| W11-13 | routed | reading (empty) / locked unit | ReadingEmpty linked only the track map; the Campaign page could not target a quest | Campaign accepts `?unit=<unitId>`: the quest the campaign payload lists for that unit is marked (`step-target` / `tree-q-target`, `aria-current="location"`), scrolled to and focused, and the tree expands its act. ReadingEmpty and the locked-unit panel link `/campaign/<track>?unit=<id>`; a junk id targets nothing; a locked target stays inert. Live: /play/4036 -> `astra4.2` focused in the list; /play/4055 -> act 3 expanded, locked node q:66 focused. Fix pass (review major): at 400px the tree target was focused but NOT in view (rect top 3062 in an 850px viewport): the focus effect scrolled on the first render, laid out at the 960px fallback width, and the measured-width relayout then moved the node down. `useWidth` now reports `measured`, and the pending focus/scroll waits for the measured layout. Live re-check (`tree-probe.mjs`, direct load and the locked-panel link): 400px top 426..476 of 850, 1440px top 417..483 of 900, both in view, q:66 focused | FIXED |

Tests: `client/src/pages/w11-final.test.tsx` (17: CSS regressions for W11-1/2/12 read from the stylesheets, unlock text
in both views and both cases, `?unit=` list + tree + junk id, untouched template, focus after store, local timestamps,
forecast labels + table placement + no-cards, reading-title code, live badge countdown). The two existing href
assertions for the locked panel (`ui-audit.test.tsx`) and ReadingEmpty (`w10-polish.test.tsx`) now expect the
quest-targeted URL (stricter, same intent). Client suite 181 -> 198. No server change.

Fix pass (review of W11): tests +4 client (`w11-final.test.tsx`: the tree target is scrolled to only on the MEASURED phone-width layout, which fails on the old code; `.step-meta` wraps and shows the repo as text; the mock refuses the untouched template with 422; a server `UNTOUCHED_TEMPLATE` refusal renders as a learner line and stores nothing) and +1 server (`api.test.ts`: the untouched starter, also trimmed or padded, is refused with 422 and records no attempt; any edit is accepted). Client suite 198 -> 202, server +1. The W11-13 'scrolled to' claim was only true at 1440 until this pass.

Checked, not defects: the 1px "SVG text outside the box" hits are the glyph side bearing of rate-chart row labels drawn
at x=0 (no visible clipping at either width); the heatmap's last column holds only Mon-Wed of the current week (future
days are not drawn); "0 / 0 seeded defects caught" with "No kata self-scored yet." for a learner with no katas; the stats
chart focus ring is the SVG's own outline (arrow keys read the bars); a written unit that is not a campaign quest still
says "Back to campaign" (harmless; there is no better home). Only the dark theme exists (tokens.css), so no light-theme
check was made.
