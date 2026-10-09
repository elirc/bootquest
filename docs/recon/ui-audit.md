# UI audit — PARTIAL AUDIT (stopped by orchestrator mid-run, 2026-10-09)

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

15. **polish (UNVERIFIED candidate)** — Dashboard heatmap "today" cell outline looks visually offset/floating past the
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
