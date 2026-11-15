# rv + rv2 waves: report (2026-11-14)

Hub `C:\Users\Owner\Desktop\bq-f52-hub`, branch **`rv-wave` @ `3264edb3`** (from `f52-wave` `dc2206bc`; 395 files,
+46.6k / -6.1k lines). Nothing is on `main`, nothing pushed. Landing is the owner's call (O1).
Agents stopped on 2026-11-14 at the weekly API limit (resets 2026-11-20 8am PT).

## 1. What was done

### Review (2026-11-12)
Five-Opus council review of every feature and content area → `../review/REVIEW.md`. The rv2 plan was then written by
Fable → `PLAN.md` (binding rulings, 24 key-idea sections, features F1-F10, content C1-C8).

### rv wave (integrated, `INTEGRATION.md`)
- **Grading honesty (B):** retry budget of 2 graded tries / 24 h, a separate practice mode with a 2-day lock, gate
  status, per-bank hint policy, ≥ 15-word explain-back answers, an EB pass needs every `[w3]` point, katas count
  patched-line defects only, 0 XP for a pass after a failed first try. Migrations 020, 021.
- **Daily loop (C):** a finishable default day, a senior-rep slot, `/settings`, 10-minute mode, paths for system design
  and agentic work, Next-up panel and Tree view removed, archive of 880 low-value units, 336 campaign titles.
  Migration 022.
- **Fundamentals fixes (A1):** SQL topics renumbered, test holes closed, answer-length lint, 150 explanations
  rewritten, pretest checks for every topic, 17 JS and 15 Java bug-hunt drills.
- **System-design drills (E1):** hint 2 is prose and hint 3 the formula; TODO giveaways removed from starters;
  boundary tests added; one duplicate archived.

### rv2 S1: reinforcement engine (`S1-REPORT.md`)
- Key-idea review cards: unlock when all of an idea's teaching units are passed, at most 4 new a day.
- Section recap answered from memory first (20 XP once), then re-checks at 14 and 45 days.
- Interleaved "Key ideas" session (12 cards, 5 in 10-minute mode) with a tag filter, which serves as the concept index.
- Redo cards that send you to a sibling drill (1 a day), and cards for missed explain-back points (3 per attempt).
- Error notebook, whose entries become cards. Repo-recall flashcards are kept out of review.
- Hard 20-card cap in 10-minute mode, plus `bootquest review [--keyideas]`.
- Fixes: a repeat pass says `already-awarded` again; tied hints withhold the last hint.
- Migrations 023, 024.
- None of this writes evidence or ladder legs, unlocks anything, or triggers the practice lock (tested).

### rv2 S2 + S2b: content (`S2-SLICE1.md`, `S2-REPORT.md`)
- **24 key-idea files, 186 ideas** covering Fundamentals JS/C#/Java, the four drill banks, sysdrills (18), DESIGN IT,
  agentic, review katas, 8 campaign concept tags and reading code. New lint `seed:lint:keyideas`.
- `content/design/headlines.json`: 2044 headlines, covering every key point of the 70 primary sets, with 8 dimensions.
  `estimates.json`: 670 numbers, each checked against its set.
- `paths/sysdesign.json` reviewed by hand (10 of 18 steps changed). `card-tags.json` tags 142 repo-recall cards.
- 16 C# bug-hunt drills; one sysdrills formula hint reworded.
- **S2b:** C# senior topics 21 testing seams, 22 HttpClient resilience, 23 authN vs authZ. Each has a lesson, items,
  cards, drills and checks, and they add key ideas to `fund-cs-web`.

### rv2 S3: learning features (`S3-REPORT.md`)
- Optional pretest before lessons, and one merged explanation and learn-more panel.
- DESIGN IT interview mode (timer, blind, answer stored before any key point), with a dimension profile on Stats.
- `/week` page with a reflection, plus `bootquest week`.
- Confidence tags on quiz and EB answers, with a calibration panel.
- The key-ideas section on the Fundamentals page and the track browser; the notebook line after a missed EB point.
- Migrations 025-027.

### Orchestrator fixes
Smoke assertions brought up to date (S1); CLI review typing; the mock XP test.

## 2. Verified
- Restamp dry-run 700/700 fresh, and no bound file changed: runners, factory and the seed-closure `shared/src` files.
- Root and client typecheck rc=0; CLI tsc rc=0.
- `seed:lint:keyideas` OK (0 leaks); `seed:lint:leaks` and `seed:lint:answers` OK; pins 688/688; campaign check OK.
- Each stream's targeted suites are green, per the reports.
- Full hub battery: see §4 (appended when the run finishes).

## 3. What remains (in order)
1. **Fable review gate (PLAN §5).** It was started and stopped at the limit before it wrote anything. Resume it
   after 2026-11-20 and fix its must-fix list.
2. **Full battery items not yet run:** `smoke:api` (boot over 180 s here: run it on a quiet machine),
   `demo:promotion`, `seed:demo:planted`, `test:csharp`, `test:java`, and a live walk at 390 px.
3. **Java senior topics 21-23.** Java 21 is authored but its re-import was not finished; it is kept on hub branch
   `rv2-c2-wip` (`003cca9a`), with Java 22 authoring left uncommitted in `bq-f52-c`. Java 22 and 23 are not written.
   Append the ideas to `fund-java-spring.json`.
4. **Repairs:**
   - 10 fund-js drill hint 2s that fail the prose gate, so `seed:import:fundamentals --track js` refuses.
   - The wrong `new`/`override` claim in the C# 06 drill-1 explanation.
5. **Content not built:**
   - C5 agent-PR and tool-design katas (only over pinned code).
   - C7 stretch (C# 24-26, Java 24-26).
   - C8 eval-lab bank: needs a slate migration, since agentic has `slate_drills = 0`.
6. **Blocked (owner):**
   - The G2 briefs on injection, test tampering, orchestration and context budget have no pinned sources.
   - C6 "pick the model" quizzes have no citation anchor.
   - Plus O8 and O9.
7. **Features not built:**
   - F10, kata precision and clean PRs (needs the C5 katas).
   - The confidence tag on Player drills.
   - Small findings in S3-REPORT: the Stats retest leg is never "open now", and boolean column aliases.
8. **Docs:** the AGENTS.md restamp list plus `seed:lint:keyideas` in the gates, SEEDING §3/§8, `elihandoff/README.md`.
9. **Owner:** O1-O11 (PLAN §6). Defaults apply: land after a green battery; usage gate after rv2; freeze at the first
   attempt; JS primary.

## 4. Battery (hub `3264edb3`)
(running; results appended below)
