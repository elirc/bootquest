# Ring review brief (<tag>): <S1>→<S2>→…→<S1>

You review ANOTHER stream's finished branch, read-only (do not edit its clone). The target stream is in your
message. Read its stop report `S\reports\<target>.md`, its records `S\records\<target>\`, and its diff
(`git -C C:\Users\Owner\Desktop\bq-qw-s<t> diff origin/main..<branch>`, skipping validation.json and manifests).
Pinned checkouts: `C:\Users\Owner\Desktop\selfboot\.cache\checkouts` (read-only, complete).

Check:
1. Code-truth: read at least 40% of the new key points / keys / drill claims at the pin (file:line). Recompute drill
   vectors by hand for at least 1/3 of the drills and re-run at least 3 trap records (run the solution AND the
   recorded naive variant; the named test must fail the naive one).
2. Quality bar: interview-grade, relevant to the owner's goal, stack specifics correct (probe framework claims if in
   doubt), no padding, no trivia or doc recall (a stem must describe a situation, not ask what a document says), a
   "Your task" that never hands over the answer, hint 3 not pasteable, flashcard backs one fact ≤ 40 words.
3. NEAREST: is anything a duplicate of an existing unit, including the other streams' new items (read `S\claims.md`
   and their reports)?
4. Leaks: both directions, both ages, EB-vs-EB, flashcard backs as keys, against your own stream's new items too
   (`node H\tools\dossier.mjs`). Pre-mx bytes unchanged (`git diff 9b7f0ea3 --stat -- <old paths>` empty); quiz slots
   and order unchanged (`node H\tools\slotcheck.cjs`).
5. Honesty of the stop report (counts by counting, gates actually run, claims).
Write `S\review\<you>-on-<target>.md`: ranked BLOCKING / SHOULD / NIT, each with file, item id, evidence and the exact
fix. Reply ≤ 25 lines: verdict (PASS / PASS WITH FIXES / BLOCK) + the BLOCKING and SHOULD items.
