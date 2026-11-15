# What changed in the rv, rv2 and rv3 waves (owner report, 2026-11-15)

Branch `rv-wave` (hub `C:\Users\Owner\Desktop\bq-f52-hub`) sits on top of `main` `d83ae80f`. It brings:
- the fund wave (the Fundamentals ladders);
- the f52 wave (review fixes and senior CRUD topics);
- the rv, rv2 and rv3 waves described here.

The plans, stop reports and reviews are in `elihandoff/rv-wave/`. Fable's final review (`rv3/FABLE-FINAL.md`)
recommends **LAND**, and it found no high-severity issue.

Your DB had 0 attempts throughout, which is why explanations could be rewritten without touching any history. It is
at schema 18. The first boot of this branch takes a backup, then migrates it to 29. Fable proved this on a copy, with
0 errors.

## 1. How it was run
1. **Review, 2026-11-12.** Five Opus reviewers worked as a council (`review/REVIEW.md`). The content was accurate. The
   problems were routing, honesty holes, answer give-aways and scale.
2. **rv.** Four streams fixed what the review ranked first. You stopped the wave part-way, and it was integrated
   afterwards (`rv2/INTEGRATION.md`).
3. **rv2.** Fable planned a layer to reinforce the key things in each section, and three streams built it. Fable's
   review then found it not landable yet, with 11 must-fix items (`rv2/FABLE-REVIEW.md`).
4. **rv3.** Fable planned this wave. Eight Opus stream runs (at most two at a time, for RAM):
   - fixed every must-fix;
   - rewrote explanations to a measured bar;
   - added Java and C# senior topics, agent-engineering content and kata precision;
   - wrote the docs.

   Fable's final review then checked it all (`rv3/FABLE-FINAL.md`).

## 2. What you will notice in the app
**A day you can finish.**
- The default slate is one language (JS), your reviews and one rotating senior rep: a DESIGN IT set, a kata, or a
  JS Fundamentals topic from 21-33.
- Everything else is one switch away in `/settings`.
- 10-minute mode caps a review session at 20 cards.
- The system-design and agentic paths drive what comes next.
- 880 low-value units are archived. Nothing was deleted.

**Honest grading.**
- A quiz gate gets 2 graded tries a day.
- Practice mode records nothing, and locks graded tries on that unit for 2 days.
- A failed gate shows which lesson sections to re-read, not the answers.
- Explain-backs need at least 15 words per answer, and a pass needs every top-weight point.
- Katas count only defects in the patched lines.
- A pass after a failed first try earns 0 XP.

**Reinforcement.**
- 24 key-idea sections hold 201 ideas.
- Each idea becomes a review card once every unit that teaches it is passed. At most 4 new cards a day, and nothing
  of an idea is shown before then.
- A section recap opens after at least 3 met ideas and a reachable unit count. You answer from memory first, it pays
  20 XP once, and it comes back as a re-check at 14 and 45 days.
- Redo cards send you to a different drill on the same idea (at most 1 a day). They come first in the queue.
- Missed explain-back points become cards.
- The error notebook turns your own notes into cards.
- Repo-recall flashcards are kept out of review.
- CLI: `bootquest review [--keyideas]` and `bootquest week`.
- None of this counts as promotion evidence, unlocks anything, or triggers the practice lock.

**Learning features.**
- An optional pretest before each lesson.
- One merged explanation panel.
- DESIGN IT interview mode, which stores your answer before showing any key point, plus a Stats profile by design
  dimension.
- A `/week` page with a reflection.
- Confidence tags with a calibration panel.

**Kata precision.**
- On 6 flagged agent katas (3 clean PRs, 3 with decoy lines) you choose approve or block before any key is shown.
- A clean PR passes only on approve. Flagging a decoy line counts as a false positive.
- The other 60 katas score exactly as before.

## 3. Content
**Explanations meet a measured bar on every track.** `seed:audit:explanations -- --check` reports 0 failures over
850 quiz items, 323 drills and 85 lessons; before rv3, 722 items failed. The bar:

| Item | Rule |
|---|---|
| Quiz explanation | 25-90 words; says why; names a wrong turn; no "option B" |
| Drill explanation | at least 60 words; names the trap and the test that catches it |
| Hints 1-2 | prose |
| Lesson | at least 380 words, with no thin section |

Every "the test catches X" claim was proven by running the wrong change, in more than 800 runs on the real JS, C# and
Java runners. Six old claims turned out wrong under those runs and were corrected. Wrong old text was fixed in lessons,
cards and key ideas.

No keyed answer changed. The exceptions to "nothing else changed" are:
- one unclear C# 23 question stem;
- choices in two never-attempted new topics (Java 24 q03, five C# 25 distractors);
- tests strengthened in a few drills where a plausible wrong solution used to pass.

**New topics and drills.**
- **C# senior topics 21-26:** testing seams, HttpClient resilience, authN vs authZ, logging, background work,
  System.Text.Json.
- **Java senior topics 21-26:** JUnit 5 + Mockito, Spring Security, Jackson, Bean Validation, SLF4J + MDC, HTTP
  clients. The drills are plain JDK 17.
- **Bug-hunt drills:** JS 17, Java 15+, C# 16+, plus one per new topic.
- **javadrills 12-14:** records, concurrency, JDBC-style data access.
- **14 agent katas** over your pinned ww16 and mastermorphic code: edited tests, invented APIs, fail-open, scope creep,
  and tool design. They are on the agentic path.
- **Eval lab (`agentdrills`):** 8 drills over harbor's eval code, graded against hand labels. Its slate slot is off by
  default.

**Side content.**
- 2044 DESIGN IT headlines and 670 checked estimate numbers.
- A hand-reviewed system-design path.
- 336 campaign titles.

## 4. Counts (before rv → now; counted by script)
| What | f52 (`dc2206bc`) | now |
|---|---|---|
| Fundamentals JS (topics / quiz / cards / drills) | 33 / 304 / 238 / 62 | 33 / 330 / 238 / 79 |
| Fundamentals C# | 20 / 200 / 160 / 27 | 26 / 260 / 208 / 55 |
| Fundamentals Java | 20 / 200 / 160 / 27 | 26 / 260 / 208 / 60 |
| javadrills | 80 | 98 |
| agentdrills | 0 | 8 |
| Patch katas (packs) | 52 (31) | 66 (33) |
| Key ideas (files / ideas) | none | 24 / 201 |
| Archive | 0 | 880 units |
| Migrations | 019 | 029 |
| Restamp | 700 | 703 |
| Pins | 688 | 690 |

Unchanged:
- explain-back packs: 244
- quest packs: 204
- sysdrills: 129
- csdrills: 72
- the imported banks

## 5. What is left (none of it blocks landing)
1. **Fable's "needs a stream" findings (`rv3/FABLE-FINAL.md`).**
   - The approve picker shows only on flagged katas, which hints at the verdict.
   - A key idea sourced from clean katas ignores the precision result.
   - A few weak drill tests (agentdrills autonomy gate, C# 25/02 and 26/02, Java 24/01).
   - One timing-sensitive Java drill (javadrills 13/03).
   - Three Java cards restate a gate key.
2. **Small items.**
   - The CLI kata self-score doesn't know the new verdict endpoints.
   - `KeyIdeaDto.idea` could be made optional.
   - The weak tests listed in `rv3/S3b-REPORT.md` and `rv3/S2b-java-REPORT.md`.
3. **Blocked on you.**
   - G2 briefs on injection, test tampering, orchestration and context budget, and the "pick the model" quizzes: no
     source docs exist in your repos.
   - Classic DESIGN IT problems.
   - Java 21, and real-framework C# drills.
   - The 141 jstrain units that have no explanation (upstream).
4. **Your decisions.**
   - The usage gate: 100 graded attempts over 14 days before more content.
   - `bootquest sync` to enable promotion.
   - Whether to turn on the eval-lab slot.
5. **Upstream bugs** (report items in your repos):
   - ww16: leaderboard quarter, demo-user header.
   - mastermorphic: the fetch timeout ends at the headers.
   - harbor: a null reply crashes an eval run; the injection patterns.
   - dotnet-intercom: logs the seeded password.

## 6. Final battery (hub `rv-wave`, run sequentially on 2026-11-15)
All green.

| Check | Result |
|---|---|
| Typecheck: root, client, CLI | rc=0 |
| Server suite | 838/838, after one fix: pretest check order in C# 24-26 and Java 22-23 |
| Server selfrun | 20/20 |
| Client suite | 632/632, run in 3 chunks |
| CLI suite | 128/128, after one stale test fix (the default slate) |
| tools/seed suite | 45 files, 2339 tests |
| Lints | `seed:lint:leaks`, `seed:lint:answers`, `seed:lint:keyideas` OK; `seed:audit:explanations -- --check` OK |
| `seed:pins` | 690/690 |
| `restamp:all -- --dry-run` | 703/703 fresh |
| `seed:campaign -- --check` | ok |
| `smoke:api` | 76/76 |
| `demo:promotion` | 39/39, after one stale step fix (the 15-word floor) |
| `seed:demo:planted` | 48/48 |
| `test:csharp` | 46/46 |
| `test:java` | 23/23 |
