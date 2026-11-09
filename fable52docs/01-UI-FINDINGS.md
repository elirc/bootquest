# 01 · UI findings

File and line references are for branch `fund-wave` at `ce7daee4`. "Verified" means I saw it in the sandbox
(see README). Severity: **A** = blocks or misleads learning, **B** = slows the learner down every session,
**C** = polish. Each finding has an id (U1-U20) that the plan refers to.

## What already works well (keep it)

- Run and submit are fast: a JS drill returns in 0.2-0.4 s, a C# drill in about 6.6 s.
- Drill instructions are well structured (interview prompt, why it matters, the task, a worked example).
- Keyboard support is thorough: `g d / g c / g r / g s` navigation, Ctrl+K unit search, Ctrl+Enter to run.
- The 390 px layout has no horizontal overflow and the navigation moves to a top bar.
- No console errors or warnings appeared on any page.
- Unsent code and answers are kept as drafts in the browser, and "Load my last submitted code" works.

---

## A · Things that mislead or block

### U1 · Code is rendered with ligatures (verified)

`===` is displayed as a single three-bar glyph, `=>` as an arrow, `<-` as an arrow. This happens in lessons,
instructions, quiz prompts and the code editor. See `screenshots/fundamentals-lesson.png`: the sentence
"`'abc' === 'abc'` is true" shows a glyph where the operator should be, in a lesson whose subject is `==`
versus `===`.

- **Cause:** `client/src/styles/tokens.css:56` lists `'JetBrains Mono', 'Cascadia Code'` first. Both fonts have
  programming ligatures on by default, and Cascadia Code ships with Windows 11. Nothing turns them off.
- **Fix:** in `client/src/styles/app.css`, on the rule at line 33 (`code, pre, ...`) add
  `font-variant-ligatures: none; font-feature-settings: 'liga' 0, 'calt' 0;`. Apply the same to the editor
  textarea rules (around lines 1233-1245) and to `kbd`. Note that `body` sets `font-feature-settings` at line
  17, and the property is inherited as a whole, so set it explicitly on the code rules.
- **Accept:** on `/play/<fund topic 01>` the text `===` is three separate characters. Add one line to an
  existing CSS-reading test or a new test that asserts the rule exists.

### U2 · The quiz gate is open-book (verified)

When you press "Start quiz" on a Fundamentals topic, the lesson stays on screen in the left column. Question 1
asks "What does `typeof null` evaluate to?" while the lesson beside it reads `typeof null // 'object'`. See
`screenshots/fundamentals-quiz-open-book.png`. A gate that can be passed by looking left tests nothing, and its
pass enrols flashcards and unlocks the next topic.

- **Where:** `client/src/pages/StudyQuestPane.tsx` (lesson and quiz render side by side), layout from
  `.player` in `app.css:1172-1174`.
- **Fix:** when the quiz starts, replace the lesson with a collapsed bar ("Lesson hidden while you answer").
  Give it a "Show lesson" button that ticks and locks the existing "I had help" checkbox for this attempt, so
  the honesty model stays true (an assisted attempt already earns less; check `study-service.ts` for what
  `assisted` does on a quiz gate and keep that behaviour).
- **Accept:** after "Start quiz" no lesson text is in the DOM (or it is `hidden`) until "Show lesson" is used;
  using it submits the attempt as assisted. Client test in `client/src/pages/fundamentals.test.tsx`.

### U3 · A passed quiz never tells you what you got wrong (verified)

After I passed a gate with 8/10, the panel said: "The answers to the 2 missed questions are not shown here:
each one is now a review card ... that arrives in your review queue tomorrow." No explanation is shown for any
question, right or wrong. Every Fundamentals question has an authored explanation (600 of 600), and none of
them is shown at the moment the learner is most curious.

This is deliberate for a *failed* gate (showing the key would let you retake it from memory). It has no purpose
after a *pass*.

- **Where:** server `server/src/api/study-service.ts` (builds the quiz result; explanations at lines 39-48 and
  190-205), client `StudyQuestPane.tsx`.
- **Fix:** on a passing submit, return each question's keyed answer and explanation and show them inline under
  the question (missed ones first). On a failing submit keep answers hidden, but say which questions were
  missed (already done) and link the lesson heading to re-read (see C4 in the content file for the tag this
  needs; until then just say "re-read the lesson").
- **Restamp:** put any new response field in `shared/src/api-ext.ts`. Check whether the "Learn more" notes
  endpoint (`GET /units/:id/notes`, `explanations.released`) already releases them after an answer; if it does,
  the client can render from that with no server change.
- **Accept:** server test: a passing gate response includes explanations, a failing one does not. Client test:
  explanations render after a pass.

### U4 · "Next unit" leaves the course you are in (verified)

After passing the first Fundamentals drill of topic 01, the button read "Next unit: Quick check" and led to
`/play/1`, a quiz in the bootforge campaign. The second drill of the same topic and the topic's quiz gate were
ignored.

- **Cause:** `client/src/pages/Player.tsx:432-450` (`NextUnit`) takes the track's entry from the dashboard's
  `nextUp`, which is built in `server/src/api/service.ts:784` and knows nothing about Fundamentals.
- **Fix:** make the next step depend on where the unit lives. For a unit whose key starts with `fund/` or
  `fund-<track>/`, call `GET /api/tracks/:id/fundamentals` (already exists, `api-ext.ts`) and pick, in order:
  the topic's quiz gate if not passed → the topic's next undone drill → the next topic's lesson. For campaign
  units keep today's behaviour. Client-only.
- **Accept:** after passing drill 1 of a topic the link names drill 2 of that topic; after the last drill it
  names the quiz gate or the next topic. Test with the fixtures in `client/src/api/fixtures/fundamentals.ts`.

### U5 · Passing a quiz gate is a dead end (verified)

The only link after "Quiz gate passed" is "Back to campaign". The topic's drills and the next topic are not
offered.

- **Fix:** reuse the U4 component in the gate result: primary button "Practise: <first undone drill>", secondary
  "Next topic: <title>".
- **Accept:** both links appear after a pass; neither after a fail.

### U6 · The Fundamentals ladder is invisible outside the Campaign page (verified)

The dashboard's "Next up" and "Today's slate" never mention Fundamentals. After I passed a Fundamentals quiz
and drill, "Next up" for JS was still the bootforge quiz. A learner who lands on the dashboard has no way to
know the ladder exists.

- **Fix (client-only version):** in the dashboard hero (U7), when a language track has an unfinished
  Fundamentals ladder, the primary action is "Continue Fundamentals: <topic>". Fetch
  `GET /tracks/:id/fundamentals` for the tracks enabled in the slate settings.
- **Fix (server version, later):** let a slate slot be satisfied by, and target, the next Fundamentals step.
  This touches `server/src/engines/streak.ts`; treat it as an owner decision (plan, D2).
- **Accept:** on a fresh DB the dashboard's first button opens Fundamentals topic 01 of the first enabled
  language track.

---

## B · Things that cost time every session

### U7 · The dashboard has no primary action (verified)

See `screenshots/dashboard.png`. Above the fold: four number tiles (all zero), a "Due now" panel with a
55-word explanation of retest scheduling, and a settings form ("Choose your focus"). The slate is half-way
down in the right column; "Next up" is at the bottom, 1,400 px down. Nothing says "start here".

- **Where:** `client/src/pages/Dashboard.tsx` (tiles 75-158, panels 159-171), `components/SlateFocus.tsx`,
  `components/DueNow.tsx`.
- **Fix:**
  1. Add a hero card directly under the title: one large button for the single best next step, in this order:
     reviews due → an unfinished slate item → continue Fundamentals (U6) → next campaign unit. One line of
     context under it ("Topic 3 of 20 · about 15 min").
  2. Move "Today's slate" to the top row beside the hero.
  3. Collapse "Choose your focus" into a "Slate settings" disclosure once it has been saved once, and on a
     fresh DB show it as a one-time first-run step.
  4. When nothing is due, render "Due now" as one line ("Nothing due").
  5. Move "Next up" above "Competencies".
- **Accept:** on a 1440×900 window the hero button and the slate are both visible without scrolling. Update
  the dashboard tests.

### U8 · The competency table reads as eight errors (verified)

Eight rows, each with three grey "pending" pills and an amber warning icon with "Evidence missing". On day one
this is the largest block on the page and all of it is negative. As `elihandoftwo/01` §7.3 explains, no
competency can be promoted yet anyway.

- **Fix:** while a competency has no evidence, show the row without the warning icon and with the text "Not
  started". Keep the amber state for a competency that *had* evidence and lost a leg. Collapse the whole panel
  to a one-line summary while all eight are at rating 1 with no evidence.
- **Where:** `Dashboard.tsx` around line 387 (`Leg`) and the "Last evidence" cell.

### U9 · The player wastes half the screen for most unit kinds (verified)

The player is a fixed two-column grid, 2fr / 3fr (`app.css:1172-1174`).

- For a **study** unit the lesson gets the narrow column (about 445 px at 1440 wide) and the "Quiz gate" panel
  gets the wide one, which is empty apart from a sentence and a button until the quiz starts.
- For **explain-back, kata, quiz and written** units the left column contains one sentence, "The questions are
  in the answer pane" (`Player.tsx:127-140`), and the competency chips. See `screenshots/explain-back.png` and
  `screenshots/kata.png`.

- **Fix:** make the layout depend on the kind.
  - study: one centred reading column (max about 75 characters wide) with the lesson; the quiz gate follows as
    step 2 in the same column (this also implements U2).
  - explain-back, kata, quiz, written: one column; drop the placeholder sentence; put competencies in the
    header row.
  - drill: keep two columns, but let the editor grow (U11).
- **Accept:** no pane on any player page contains only a "see the other pane" sentence.

### U10 · The Campaign page buries the campaign (verified)

On a language track the Fundamentals section is expanded by default and is about 3,300 px tall; the acts and
the skill tree start below it. Switching to "Tree" view still shows the same 20-topic list first.

- **Where:** `client/src/pages/Campaign.tsx:96-97`, `pages/Fundamentals.tsx`.
- **Fix:** show a compact Fundamentals card: progress bar, the current topic with its start button, the next
  two topics, and "Show all 20". Remember the expanded state in `localStorage`. Locked topics need one line
  each, not four.
- **Accept:** on a fresh DB the first campaign act is visible within one screen height of the top at 1440×900.

### U11 · The code editor is a plain textarea (verified)

`client/src/pages/Player/Editor.tsx` is a `<textarea>` with a line gutter: no syntax colours, no bracket
matching, no auto-indent on Enter, no multi-cursor, fixed at 12 visible lines. Long lines scroll sideways with
no wrap option. For an app whose main activity is writing code, this is the biggest gap against boot.dev.

- **Fix:** adopt CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `language`, `lang-javascript`,
  `lang-java`, plus a C# mode from `@codemirror/legacy-modes`). It is client-only, has no runtime network
  dependency, and supports the existing "Esc then Tab leaves the editor" rule (`indentWithTab` plus its
  built-in Escape handling). Lazy-load it so the dashboard bundle does not grow. Keep the current `Editor`
  props (`value`, `onChange`, language, read-only) so `Player.tsx` and `lib/draft.ts` do not change.
- **Risk:** jsdom tests that type into the textarea will need a test double. Keep the textarea implementation
  behind the same interface and use it in tests, or render CodeMirror with its `EditorView` test helpers.
- **Also:** let the editor height follow the window (`min-height: 12 lines; height: calc(100vh - …)`).
- **Owner decision:** this adds the first non-React runtime dependency to the client (plan, D3).

### U12 · Failed-test output is noisy (verified)

See `screenshots/drill-failed-submit.png`. Each failing test shows the assertion library's diff ("+ actual -
expected", then the object spread over six lines) in the proportional font, and then the same information
again as tidy `expected` / `actual` rows in the code font.

- **Fix:** when a result has structured `expected` and `actual`, hide the raw message behind a "details"
  disclosure. Otherwise render the message in a `pre` with the code font. Show the first failing test expanded
  and the rest collapsed to their titles.
- **Where:** the results list in `Player.tsx` (search for `practice run`).

### U13 · Hints exist but are never served (verified in code)

Drill authoring carries progressive hints (each Fundamentals drill has three). The server deliberately withholds
them: `server/src/api/service.ts:218` whitelists public fields, and `shared/src/api.ts:387` says "progressive
hints (not served yet)". The only help a stuck learner has is "Reveal solution", which costs all XP forever.
boot.dev's equivalent, a cheaper intermediate step, is what keeps learners moving.

- **Fix:** `POST /units/:id/hint` returns the next hint and records that it was taken; each hint reduces the
  XP of the eventual pass (for example −25% each; a pass after hints still counts as verified). Show
  "Hint 1 of 3" in the player beside "Reveal solution".
- **Restamp:** the DTO goes in `shared/src/api-ext.ts`. It needs a migration (a `hint_taken` table with the
  same append-only triggers as the other ledgers) and a change in the XP engine. No pack change.
- **Before building:** an earlier review found that some banks carry the full solution as hint 3 (sysdrills
  modules 01-03). Check that the import rule that strips those is in place for every bank, or serve only
  hints 1 and 2.
- **Owner decision:** the XP cost of a hint (plan, D4).

### U14 · System design and Agentic have no path (verified)

`/campaign/sysdesign` says "No campaign acts are seeded for this track yet" and lists 216 units in groups
sorted alphabetically, mixing topic modules ("estimation", "caching and pools") with repo names
("3buildanalytics", "ww16", "organized-experiment-zz7"). `/campaign/agentic` is the same with 75 units. The
first "Next up" unit for Agentic is a delegation brief about a specific repo (`atlas-net`), to be answered from
memory.

- **Fix (client-only):** in `client/src/lib/trackunits.ts`, sort groups so that numbered drill modules come
  first in module order (the key has the number: `sysdrills/01-estimation/…`), under a "Core drills" heading,
  and repo-based explain-backs come second under "Design a real system", titled by their topic rather than the
  repo slug where a topic title exists.
- **Fix (content):** seed real acts for these two tracks (see content finding C7).

### U15 · The Fundamentals quiz ignores the keyboard and shows code as prose (verified)

- The single-question quiz unit supports "1-4, then Enter". The 10-question gate does not: pressing `1` and
  Enter did nothing.
- Answer choices are rendered in the proportional font, so `''` (empty string) looks like a double quote and
  `'0'` versus `0` is hard to tell apart. See question 2 in `screenshots/fundamentals-quiz-open-book.png`.

- **Fix:** show one question at a time with a progress indicator ("3 / 10"), `1-4` to choose, Enter for next,
  and a final review screen before submit. Render choices through the same inline-prose renderer as prompts
  (`client/src/lib/prose.tsx`), and in the authoring files wrap code-valued choices in backticks (content
  finding C2 covers the authoring edit).
- **Accept:** the gate can be completed without the mouse.

### U16 · The streak tile does not say today is safe (verified)

After earning 60 XP (the rule is "20 XP keeps the streak") the tile still showed "0 days" with no sign that
today counts. `server/src/engines/streak.ts:486-493` sets `todayComplete` only when the whole slate is done.

- **Fix (client-only):** when today's XP is ≥ 20 or the slate is complete, show a "today ✓" mark on the tile
  and the text "Streak safe for today". The heatmap payload already carries today's XP.

---

## C · Polish

### U17 · Lesson code has no syntax colours, and long comment lines are cut off (verified / to check)

Code blocks in lessons are one colour. In the 445 px lesson column, lines with trailing comments run past the
right edge (`typeof null // 'object' <- a bug from 1995 t…`). My screenshots were taken with scrollbars
hidden, so check whether a horizontal scrollbar is present; if not, add `overflow-x: auto` to `.code-block`
(`app.css:1404`). U9 (wider reading column) removes most of the problem. For colours, a small highlighter such
as `highlight.js` core with three languages is enough, or reuse CodeMirror's highlighter from U11 in read-only
mode.

### U18 · Copy is written for the builder, not the learner (judgment)

Examples: "Submit findings (immutable)", "solo attempt recorded", "practice run (not recorded)", "rated 1-5 ·
never averaged · promotion = artifact + explain-back ≥80% + retest ≥2 days later", and the "Due now" empty
state. The rules are sound, but the learner meets them all on day one.

- **Fix:** one copy pass. Keep each rule, shorten the surface text, and move the full rule into a tooltip or
  the existing shortcuts/help dialog. Suggested replacements: "Submit findings" (+ "You can't edit them
  afterwards" underneath), "Attempt saved", "Practice run — not saved".

### U19 · "Next up" has an orphan card (verified)

Five track cards in a four-column grid leave one alone on a second row (`screenshots/dashboard.png`). Use
`repeat(auto-fit, minmax(220px, 1fr))` or five columns at wide widths.

### U20 · Content width is inconsistent (verified)

The Campaign page content is capped at about 820 px and left-aligned inside a 1,200 px area, while the
dashboard uses the full width. Pick one content width per page type and centre it.

---

## Not checked

- The Review session with real due cards (cards become due the day after they are enrolled). The code supports
  Space to flip and 1-4 to grade (`client/src/pages/Review.tsx:18-27`).
- Screen-reader behaviour, and colour contrast beyond what `tokens.css` documents.
- The Stats page with data (it was empty; its empty states are clear).
- Java drill execution in the browser (needs JDK 17; the battery covers it).
