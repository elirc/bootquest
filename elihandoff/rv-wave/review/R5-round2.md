# R5 · Round 2: attacking the ADD lists of R1, R3 and R4; votes on Q1-Q5; revised top 7

I test every proposed addition against one rule: **it earns its place before real use only if it changes what
happens in the owner's first 14 days of sessions.** Changing what exists counts: routing, feedback, honesty holes the
learner would actually meet. Adding to the pile does not. New content units are judged at the usage gate
(≥ 100 attempts over ≥ 14 distinct days).

## 0. Corrections to my own round 1 (cross-checked against R2 and R4)

- **WEAKENED (mine): "about 65% of quest quizzes are repo-incidental".** R2's finer three-way split is 31% pure trivia,
  43% repo behaviour that carries a transferable lesson, and 26% transferable outright. My two-way split put R2's middle
  class into "incidental". The honest number for *trivia* is about 31%. The CUT stands, because the mechanism is
  demotion, not deletion, but the headline was overstated.
- **WEAKENED (R4 §2): "the owner opened the app in about 8 sessions".** The 8 distinct `daily_slate.created_at`
  values come in pairs less than 1 s apart: 10-16 13:35:33.169/.226, 10-30 19:41:56.720/57.274, 11-04
  21:00:30.683/.763, 11-09 23:03:28.055/.501 (`work/R5/db3.cjs`). Each pair is one load: the backfill of missed days
  plus today's slate. So there were **5 loads on 5 days**. The 11-09 23:03 load overlaps the fable52 review, which ran
  "the owner's app … from main during the review" (`fable52docs/README.md`). Some of the 5 may not be the owner at all.
  VERIFIED.

## 1. ADD lists: earns its place now / after the gate / reject

Legend: **NOW** = do it before or during the first 14 days of use (it fixes the path the learner walks). **GATE** =
only after the usage gate. **REJECT** = not worth it even then, or wrong as specified.

### R1 (Fundamentals)
| Item | Ruling | Reason |
|---|---|---|
| A5 / R1-03: missing test cases on 5 drills (java 08, js 07/13/28, js 33 note) | **NOW** | Wrong code passes. This is a correctness defect on the hero's own path. S, content only. I re-read R1's mutant evidence files and did not re-run them. |
| R1-14: 4 version/diagnostic trivia items; R1-11: 3 one-sentence lesson gaps; R1-13: stale ".NET 8" distractors; R4-13: 2 raw fences | **NOW** | About 10 edits, all on the path, and free while unlanded. |
| R1-09: drop 14 off-topic `related.json` mappings | **NOW** | A side file, not frozen. Wrong "more practice" erodes trust in the path. |
| A4 / R1-06: renumber SQL 29-32 ahead of 21-28 | **NOW only if it fits in the 1-day time box**, else GATE | Right pedagogically, but it does not block a mid-level owner, who already knows `UPDATE … WHERE`. With 0 attempts, renaming keys costs nothing to the ledger (see Q5). |
| A1 / R1-02: about 100 fresh-example rewrites; A2 / R1-01: length-rank rebalance of about 500 items; A3: +26 gate items | **GATE** (as R1's own T1 set B) | Each is a full agent wave with blind checks, the pattern that produced 0 attempts. The length cue (40% for "second-longest") matters for an adversary or a guesser. An honest single user gains little until gates are used. Ship the **lint** (T11, S) now so new content can't regress. |
| B, C, D: 14 C#/Java topics + 3 cross-track topics + bridges | **GATE** | Real gaps (testing, authN/Z, HttpClient, logging), but they add about 140 items + 40 drills to a ladder nobody has opened. Only worth it after the owner picks C# or Java as primary (R5-11). Then build that track's 7, not both. |
| E / T2: 49 bug-hunt drills from the explanations' named wrong code | **GATE, first in line** | Best production-per-hour item in R1. It reuses tests and the starter equals a known wrong solution. |
| T3 run-after-answer, T4 fading, T6 Parsons, T7 contrast deck, T9 pretest | **GATE** (T9 pretest is S content: first after the gate) | Sound methods, but each is a new UI path or about 140 new content items. |
| T5 spaced re-gates, T8 confidence | **NOW, folded into the cross-reviewer items below** | Four reviewers proposed the same thing independently (§3, top 7 items 6-7). |
| T10 real-framework C# drills | **GATE + owner decision** | L, plus a restamp of every drill-cs **and drill-java** pack (Q1: `scratch.ts` is in both lists). Highest transfer for C#, but only if C# is the primary. |

### R3 (explain-backs, design, agentic, katas)
| Item | Ruling | Reason |
|---|---|---|
| R3-01 cheap rule "weighted ≥ 80% AND ≤ 1 `[w3]` missed" | **NOW** | One line in `eb-score.ts`. Today about 12% pass odds at 0.8 per-point coverage makes the best content unpassable, which drives quitting or generous ticking. Owner decision, S. The full override side file and headline rewrite (M2, 87 × 20 headlines) is **GATE**. |
| R3-05 / M9: G2 open-book | **NOW** | S client change. It makes the item test the claimed skill. |
| R3-03: fold the same comments in kata context files + mask finding markers | **NOW** | S client change. The f52 fix is defeated today. |
| R3-08 / M10: path side files for sysdesign and agentic | **NOW** | This is routing, the core of my R5-03. Same mechanism as my `core.json`; build one, not two. |
| R3-09: swap sysdrills hint 2 and hint 3 + "Show the model" button (assisted) | **NOW** | Same defect as R4-03 and my R5-07. Combine them into one change: serve H1 + prose H3, and fold "Why it works". |
| R3-04: G1 counts only patched defects | **NOW (S-M)** | The fix is in `ladder-service.ts`, with no content change. Otherwise G1 rewards retelling. |
| M3 evidence spans / M4 missed-kp cards | **NOW**, inside the shared "spaced production" and "calibration" items | Matches R4 N2/N6 and my F4/F6. |
| R3-10 retire 40 EB packs | **Demote instead of retire** | Same outcome with no census/pin churn and no re-seed. Reversible. Retiring is a wave; demoting is a list entry. |
| 8 classic design problems; 6 CRUD primaries + 17 set-Bs; 87 envelope items; 72 "pick the model" items; ~30 agentic units | **GATE** | All net-new content. The 8 classics need upstream docs written first (R3's own note), so they are two waves. They also tilt the app toward interview breadth, while the owner's stated goal is senior CRUD. Exception: once the gate is met, the **8-drill eval lab** is the first agentic addition. It fills a real gap (0 eval/injection coverage, confirmed by R3-12 and my R5-14) with zero runtime LLM. |
| M1 interview mode (L) | **GATE**, after 10 DESIGN IT attempts exist | It is the right feature, but only once the owner has shown they will sit a 35-minute design. M8 verbal recording is cheaper (M) and could come first. |
| M11 BYO-LLM critique | **GATE, S** | Converges with my F10 and R4 N8. Start with R4 N8 (copy prompt, S client), which needs no CLI or migration. |

### R4 (features, UX, engine)
| Item | Ruling | Reason |
|---|---|---|
| A5 + N1: hero-aligned bounded session; streak counts it | **NOW, top** | The single most direct answer to "never pressed Submit". |
| A3: choices on quiz-miss card fronts | **NOW** | S. A card you cannot answer is broken on day 2. |
| A4: per-bank servable hints + leak lint | **NOW** | Merge with R3-09. |
| A1 / A2: server-side gate integrity, closed fail screen | **NOW, but only for Evidence attempts** (Q3) | Fully applied, A2 removes the corrective feedback a learner needs. |
| A7: EB low-overlap confirmation | **NOW, simplified** | A minimum answer length (≥ 15 words per question) plus "confirm covered" on 0-overlap points. S. The table and calibration rate can wait for M3. |
| A6: window-based demotion | **GATE** (build with the promotion path) | Inert until any rating is above 1 (R4-20). Fixing it now is building for a layer that is switched off. |
| R4-09 (0 XP for retries), R4-14 (review XP once per card per day) | **NOW, S** | Removes XP-for-clicking before habits form. |
| N2 drill decay, N3 error log, N6 calibration, N9 weekly page, N8 "Ask Claude" | **NOW** (N2/N3/N6 as the shared items below; N8, N9 S) | Convergent across reviewers. |
| N4 interleaved mixed practice | **NOW, S** | Uses `related.json` + find-service. It is the cheapest interleaving in any report. |
| N7 placement sprint | **GATE** (needs A1 first, R4's own caveat) | — |
| N10 focus timer, N11 PWA | **REJECT for now** | N10 has low value on its own. N11 is a security decision for a local-first app. |
| CUTs: Campaign Tree, Next up panel, competency table → Stats, `mutate` hidden, G3/G4 off next surfaces | **CONFIRMED** | All are subtractions, which is what this app needs. |

## 2. Votes on the contested questions

**Q1 Restamp scope: R4 is right on scope, R1 is right on `scratch.ts`, and AGENTS.md is too broad.** VERIFIED from
code. Code-pack stamps bind only the per-kind file lists in `server/src/store/grader-fingerprint.ts:56-101`: the js /
csharp / selfrun / java runners, `api/runners.ts`, `runner-csharp.ts`, `runner-java.ts`, `result-channel.ts`, the
fixtures' `Check.*`, and the `tools/seed/src/validate/*` import gate. Seed-pack stamps bind each generator's import
closure plus the shared files listed in `tools/seed/src/factory/fingerprint.test.ts:28`: `shared/src/{api, campaign,
check, enums, index, mutation, pack, schemas, seed-pack, sync, thresholds}.ts`, the factory `COMMON` files, and the
graders of the runner types the pack's items execute (`PINNED_RUNNERS`, `:57-78`). Two things the round-1 reports
missed:
- `server/src/runners/csharp/scratch.ts` is in **both** the csharp and the java lists (`grader-fingerprint.ts` csharp
  and java arrays, and `PINNED_RUNNERS` drill-cs and drill-java). R1's T10 therefore restamps every drill-cs pack,
  **every drill-java pack**, and every seed pack whose items run those graders.
- `shared/src/api.ts` *is* in the seed closure. A change to the strict submit schema (the R4-01 "per-question marks"
  workaround) is a restamp, which is why the f52 wave left it alone.

Free to change: engines, `api/*-service.ts`, `service.ts`, store (except the fingerprint module), migrations, the
client, the CLI, `shared/src/api-ext.ts`, and server-local side files. `eb-weight.ts` and `fundamentals.ts` are
not on the SHARED list, but I did not walk every generator closure for them, so confirm with `restamp:all -- --dry-run`.
**Fix AGENTS.md** to name these lists, because the current wording makes agents avoid free files and overbuild
workarounds.

**Q2 Freeze vs add: freeze all net-new content units. Allow repairs and routing.** Allowed before use:
- defect fixes on the path (Q5 must-dos);
- routing and flow (core/path side files, slate, hero, next-up);
- honesty holes the learner would meet (gate brute force in Evidence mode, hints that are solutions, kata leaks, card
  fronts);
- the shared learning-loop features in §3 (items 6-7).

Not allowed: R1's 14+ topics, R3's 8 classics, 6 CRUD primaries, set-Bs and ~30 agentic units, and any new pack.
Reason: every past wave ended with "owner: look at it", and the next wave started instead. Once the gate is met, the
first three additions are R1 T2 bug-hunt drills, R3's eval lab and one primary-language framework track. They come in
that order, each sized against the owner's logged weekly hours.

**Q3 Honesty model: split it, then tighten the Evidence half.**
- **Practice** (default) gives immediate per-item marks plus explanations, free reveal, no cooldown, and token or no
  XP. It never counts as evidence or toward unlocks.
- **Evidence** (opt in per attempt; required for ladder legs and act unlocks) gets R4-01 server-side:
  - no per-item marks in a failed response (served `items: []`; `api.ts` stays untouched because the schema allows an
    empty array);
  - a ledger-based retry budget (3 graded tries per 24 h);
  - prior-key marking on retakes after a miss card was shown;
  - the R4-07 minimum-answer and low-overlap confirmation on EBs;
  - R4-14 review XP once per card per day.

The catch I owe the council: practice on the same 10 items is an answer oracle for the Evidence gate. So an Evidence
gate must either draw items that were not seen in Practice (R1 T1 set B, GATE) or open ≥ 2 days after the last
Practice try on that topic. Until set B exists, use the 2-day rule. It is honest enough and it turns spacing into a
feature. Loosen nothing on the ledger itself (append-only, nonce verdicts, reveal never pays).

**Q4 Archive scale: about 3,100 units, by a unit-level allow-list, with no re-seed.** Mechanism: one server-local
`content/core.json` (prefix allow-list plus R3's path order) read by next-up, the slate, the hero and the track
browser. Everything else is "Archive": searchable in Ctrl+K, one click away, byte-identical, reversible by editing
one file. My counts: 1,867 bootforge language/React units, 946 jstrain units, csbootcamp 31, 139 quest packs, and 117
classic EBs. R3's 40 retirements and R2's demotions C6/C7 (544 quizzes, 562 micro-drills) all fall inside this set.
R2's item-level re-seeds (C1-C5: about 400 items edited inside kept packs) are **GATE**: they are content waves, and
they matter only in packs the owner actually takes. The two counts don't conflict. Mine is the unit surface, R2's the
items inside units. Demote by unit now; prune items later, where usage shows them.

**Q5 Fundamentals: land after a 1-day time box of must-dos, and change the freeze rule.**
- **Must-do before landing:** R1-03 test gaps (5 drills); the 4 trivia items (R1-14); 3 lesson sentences (R1-11);
  stale .NET-8 text (R1-13); the 2 fences (R4-13); the 14 related mappings (R1-09, a side file). Optional within the
  same day: the SQL renumber (R1-06).
- **Not must-do:** the length-rank rebalance, the 100 fresh-example rewrites, and +26 items. They go into set B later.
- **The bolder point:** "existing items stay byte-identical" exists to protect attempt rows and review keys. The owner
  DB has **0 attempts and 0 review_items**, so the rule protects nothing yet. Amend `AGENTS.md`: an item freezes once it
  has its first attempt in the owner DB, or after a declared landing date plus 14 days. That removes the "fix it all
  before landing" pressure that would otherwise become one more month of waves.

## 3. Revised top 7 for the whole app (skill gain per build hour)

1. **Wave 0, owner actions, about 0 build.**
   - Adopt the usage gate and the amended freeze rule (Q5).
   - Do the 1-day Fundamentals must-dos, then land `f52-wave`.
   - Pick a goal, a date, weekly hours and **one** primary language.
   - `bootquest sync` signalpost.
   - Fix the AGENTS.md fingerprint wording (Q1).
2. **One bounded daily session that the streak counts.**
   - Session: reviews (≤ 20) → one step on the core path → stop.
   - Default slate: reviews + 1 path step + 1 drill in the primary language.
   - Hero, slate and streak agree; the Next up panel is cut. (R4 A5/N1/R4-10, R5 §7.) S-M, no restamp.
3. **Route to the senior content.**
   - `core.json` archive/allow-list plus sysdesign/agentic path order, built as one file and one reader.
   - Narrow the C8 next-up rule to "repo not studied". (R5 F1, R3-08/M10, R2 C6/C7.) M, no restamp.
4. **Stop handing over answers, and give feedback.**
   - Practice/Evidence split (Q3).
   - sysdrills hints: serve H1 + prose H3; fold "Why it works" (R3-09, R4-03, R5-07).
   - Kata context-file fold (R3-03).
   - Choices on miss-card fronts (R4-06).
   - Each piece is S, client/service only, no restamp.
5. **Make the best content passable and honest.**
   - "≤ 1 `[w3]` missed" rule (R3-01).
   - G2 open-book (R3-05).
   - Minimum answer length + low-overlap confirm on EBs (R4-07).
   - G1 counts patched defects only (R3-04).
   - S-M, no restamp; the `[w3]` rule is an owner decision.
6. **Spaced production: one engine change, three sources.**
   - FSRS `redo` cards for passed drills and katas (re-solved in the Player).
   - Missed `[w2]`/`[w3]` EB key-point cards.
   - +7/+30-day mini re-gates.
   - Sources: R5 F6, R4 N2, R3 M4, R1 T5; four reviewers proposed this independently. M, no restamp.
7. **Metacognition loop.**
   - Confidence tag on each graded answer, with a calibration panel (R1 T8, R4 N6, R5 F4).
   - One-line error notebook that feeds cards (R4 N3, R5 F5).
   - Weekly page against the goal (R4 N9, R5 F7).
   - "Ask Claude about this miss" copy-prompt (R4 N8; the offline LLM bridge, no runtime spend).
   - S-M, one migration, no restamp.

Content additions, in order, only after the usage gate: R1 T2 bug-hunt drills → R3 eval lab (8) → the primary
language's framework track (R1 B or C, one of them) → R3 M1 interview mode → R2 item pruning inside packs the owner
actually took.
