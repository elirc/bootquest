# C3 ruling: content integrity and house rules (ab draft plan, 2026-10-30)

Freeze line = items present at `9b7f0ea3` (REVIEW §6.8). I checked what each wave-B target looks like on the two sides of that line, ran re-seeds into the scratchpad, and queried the live API (GET only). The repo is untouched.

## F0. Findings that change the briefs (every ruling below depends on these)
- **F0.1 Much of wave B's list is frozen.** sysdrills 01-10 (78 drills) are byte-identical to `9b7f0ea3` (`git diff --stat 9b7f0ea3 HEAD -- tools/seed/authoring/sysdrills/` touches only 11-18). The 4 B3 repair sets are also unchanged since that sha: payments-lab primary (R2 calls it "cw, editable"; it was added on 10-20 in 892e828c), 10x-load, dotnet-auth and formforge. Frozen quest items include all of openstatus's 10 doc-recall stems (815143d9, 5e93d4c5, 046a8d97 …), the dotnet-auth stems, lucasrouter 63b9f36b/ea04d8eb, the dotnet-auth fc backs 2d90f717/7209d710, lucasrouter 00719c15 and the **nettrello pair 687466e7/c8920198 (W5)**. R3's "added since 10-19" window is not the freeze line. Editable doc-recall stems: about 45-50, in tracer, pulse, jsdrillv2, dotnet-drop, j2 and netcalendy.
- **F0.2 Deleting a drill crashes the owner's server.** The pack loader REFUSES TO START when a live DB unit is missing from its pack (`server/src/store/packs.ts:415-437`, test `server/test/packs.test.ts:287-301`). Seed content behaves differently: it retires missing units (`store/ladder.ts:461-466`). 01/07 (id 4751) and 14/04 (id 4850) are live in the owner DB today. `smoke:api` runs on a fresh DB, so no gate would catch this.
- **F0.3 The draft plan's `--exclude` does not exist.** `drafts/cli.ts:13-21` accepts only `--out`, `--exclusions`, `--allow-quarantine` and `--force-replace`. The `QuestDrafts` schema has only `guides` and `excludeDirs` (`drafts/quests.ts:63-73`). `exclusions.json` works per file and is part of the fingerprint (`factory/fingerprint.ts:57`).
- **F0.4 Re-seeds are byte-stable today.** I re-seeded all 6 two-choice packs with `seed:quests:drafts --out <scratch>`. items, review-queue, quarantine and manifest came out byte-identical. `seed:notes` for masteropen and react came out byte-identical too.
- **F0.5 Clones need the right base.** `elihandoff/tools` (slotcheck, dossier) and the templates exist only on `ab-wave` (a4fe7def). `origin/main` is 772b19cb. Branch the streams from ab-wave, not from `origin/main` as tip 14 says.

## Q §7.3 frozen leaks: CONFIRM accept+record, with AMENDMENTS
- Do not unfreeze. AGENTS.md "Existing items stay byte-identical" is the owner's rule, and a council cannot waive it. Re-authoring the primaries as set-B creates padding plus sibling-guard churn (SEEDING §3 eb-sibling guard). Reject both.
- The "~20" figure is wrong. I re-ran R2's own scan (`scripts/leak.mjs`: containment ≥ 0.55, n ≥ 7). It finds **140 pairs, 24 of them ≥ 0.99**. Classified by presence at `9b7f0ea3`, 134 are frozen on both sides and 6 have an editable side (ww7 x-q04, j2 f05, j7 16d1f3d5, helios ×2, masterstore). The method is heuristic because note ids like `x-q04` are reused across packs, so recount in B3. Acceptance "reports ~20 and nothing new" would fail on day one.
- Baseline = (a) the pairs that are frozen on both sides, machine-checked as byte-identical at `9b7f0ea3`, plus (b) the overlaps SEEDING §8 already accepts in qw and cw, cited by id. It is shrink-only, like `EB_LEAK_EXEMPT` (`ops/leak-lint-cli.ts:4-6`). A baseline entry that no longer fires fails the lint as stale. Every editable-side pair is either fixed or recorded with a reason. V7 (fc b8ab1a9d ↔ quiz a422c4e0) is fc↔quiz, which an EB-only lint never sees. Add a fc-back vs same-pack quiz-key pass and baseline V7. Report the retire+new-key fix for V7 to the owner as the cheapest one.

## Q §7.4 two-choice quizzes: OVERTURN the draft, adopt the factory rule as a generator SKIP
- Option B (`--exclude`): there is no item-level exclude (F0.3). The only levers are dropping a guide from `guides`, which also retires that guide's good reading steps and flashcards (all frozen), or an exclusions.json entry, which is file-level and fingerprinted. In both cases more frozen items go than needed.
- Option A, made precise: in `factory/quests/generate.ts`, skip any quiz with fewer than 2 distractors, recording the reason. The pattern already exists for the `no-distractors` skips at :255-258 and :282-285. Do not add it as a `validate.ts` refusal: that would fail the 6 stored packs in `seed:check` until they are re-seeded. Then re-seed exactly the 6 packs and re-run `seed:notes` for each.
- What happens to the items: because re-seeds are byte-stable (F0.4), the only diff is −22 quizzes and their 22 after-notes. Every other key is unchanged (`stableKey` takes headingPath + label, generate.ts:251,272), and so are review-queue and quarantine keys. The 22 units retire with history kept (ladder.ts:461-466) and their cards retire too (serve.ts:167). A revert plus a re-seed restores the same keys, so this is reversible. The restamp needs nothing extra if wave A ships; if Q3 moves the schemas out of the fingerprint, this rule alone forces a restamp.
- Add a non-fingerprinted shipped-pack guard ("0 quizzes with < 3 choices") next to `drafts/shipped-goal-checks.test.ts`.
- No 1:1 back-fill with hand items. Add one only where a NEAREST check shows an untested behaviour (react drops 21→14 quizzes, still gateable).
- nettrello W5 is frozen and not two-choice: record it, do not fix it.

## Q §7.5 frozen wrong items: CONFIRM stay frozen; AMEND the corrective-note rule
- Every quiz already has its one `after` note (SEEDING §3 notes: "exactly one after note per quiz"). So a correction can only be a `before` note, and `before` notes are shown before the learner answers, so the before-note leak rule applies (SEEDING §3 notes).
- 298d7218: the correction *is* the deciding fact, so it gets no note (netcalendy also already has 4/4 pack-level before notes). Record it only.
- masteropen 74848a10 (explanation arithmetic only), masteroutline fc 22b1860a, mastertwenty x-retry-is-repair and linkwarden x-member-cannot-move: at most one new pack-level `before` caveat each. Packs 1-3 are at 3/4. Phrase it as "the pinned code …" and have a second agent run a leak pass against every quiz in the pack. Keep the existing notes byte-identical, which F0.4 shows a re-seed does.
- Optional: qw-era x-q27 (editable) can drop the off-topic tail (R3 N2).

## Q B1 retire/merge, net −4: AMEND to "differentiate, retire at most 2, and only after a live-DB proof"
- F0.2 decides this. Before deleting anything, start the B1 server on a **copy** of `C:\Users\Owner\bootquest\bootquest.db`. If it refuses to start, either keep the drills or add an S-sized loader change (packs.ts retires stale units the way ladder.ts does). That change needs an explicit brief, because AGENTS.md says no server/src edits otherwise. Wiping the owner DB is not the council's call.
- 01/05 is the **only** cache-working-set drill (grep). Dropping its "half" changes its title and lesson, which under the drill rule means a retirement. Keep it.
- 04/07 is the inverse of 01/04, not a duplicate. Give it a trap test instead.
- Real candidates are 01/07 (identical to 06/04 apart from renamed parameters) and 14/04 (14/09 is its inverse). So net −2, `SYSDRILLS_EXPECTED` 129→127, and slugs are never reused.
- Difficulty relabels move code XP (10× difficulty, `engines/xp.ts:59-62`; 01-14 is d1 35 / d2 61 / d3 15). Report the XP delta.
- Twins: declare them in instructions or explanation. Exercises have no description field (`sysdrills/source.ts` keys).

## Q formulas → hint 2, hint 3 → prose: CONFIRM for 11-14 (mx-era); AMEND for 01-10 (pre-mx)
- It fits the qw drill rule (lesson and title kept, ≤ 1 function replaced; SEEDING §8 qw), as long as solutions stay untouched.
- For 01-10 the plan needs an explicit scope ruling, because tip 8 and the qw policy say "pre-mx stays byte-identical" and R1 mislabels these drills as mx. My ruling: AGENTS.md's content-discipline clause names quiz, flashcards, notes and explain-backs, not drills. Drill history is protected by the check policy (retire-and-replace once referenced, `packs.ts:291-294`), and hints are not served (`shared/src/api.ts:387`). So text, hint and test edits are allowed. Record the scope ruling in SEEDING §8 and report it to the owner.
- Anti-padding: add a "tempting wrong model" test only where a real naive variant exists and is recorded. No quota of 95.

## Q B2 in-place rules: AMEND
- slotcheck prints `ok … (text edited)` for every legitimate edit. The criterion is **0 BAD / exit 0**, not "prints no changes" (`slotcheck.cjs:30-35`).
- Use the branch point (a4fe7def) as the slotcheck base, so qw and cw items are checked too. Use `9b7f0ea3` only for the "frozen untouched" diff.
- Hit the <5% doc-recall target by rewriting editable stems only, never by adding items to dilute the share. The frozen stems (openstatus 10/10 and others) are recorded.
- Flashcards: trim to one fact. Split a card only into situation cards, and the touched packs' net flashcard count must not rise.
- Re-run `seed:notes` after every quest re-seed (notes bind the items bytes, SEEDING §3).
- Drop the nettrello duplicate from B2's list (it is frozen).

## Q B3 eblint design: AMEND
- Metric: use containment over the smaller token set with ≥ 7 shared tokens, threshold 0.55 (R2's measured setting). Token-Jaccard 0.5 (`guards.ts:414`) suits short quiz answers but misses a 20-word kp that sits verbatim inside a 150-word note body.
- Scope: EB↔note, EB↔fc, EB↔quiz explanation, EB↔EB on the same repo across units (the sibling guard covers only the same repo+path), and fc↔quiz key.
- Home: **`tools/seed/src/ops/` + an ops test + a call from `seed:lint:leaks`.** ops is outside the fingerprint walk (`fingerprint.ts:6-23`), and only tests import it. AGENTS.md already requires `seed:lint:leaks` before "done", and the `--root tools/seed` suite runs it. An `elihandoff/tools` script is gated by nothing.
- B3's editable repair list shrinks to tracer-B q0.kp5 and ww48 q0.kp3. payments-lab W1 and the K4 vendor/trivia kps are frozen: record them and ask the owner.

## Q S7 = B2+B3 in one agent: CONFIRM, given F0.1's cuts and this order
Order: eblint first (it gates the new stems), then the generate.ts skip and the 6 re-seeds, then stems, then flashcard trims, then the 2 markers. Drop the flashcard trims first if the budget runs out. S7's brief must name `factory/quests/generate.ts` explicitly (AGENTS.md: factory edits only when the brief says so).

## Conflicts with AGENTS.md / SEEDING
1. "Never commit restamped validation.json" clashes with SEEDING §3 sysdrills ("commit … the new validation.json together"). Commit stamps of packs you re-imported or re-seeded; never commit stamps from a restamp only.
2. The `git checkout -- content` discard step is only safe after the stream's own content is committed.
3. `--exclude` (F0.3) and the B1 delete path (F0.2) as noted above.
4. Tip 14's `origin/main` clone base (F0.5).
