# Fundamentals quiz rewrite — authoring rules (binding)

Problem (fable52docs/02-CONTENT-FINDINGS.md C2): in the Fundamentals quizzes the keyed answer is the single
longest choice in 60-74% of items, so "pick the longest" passes the gate. Fix the choices.

Files: `tools/seed/authoring/fundamentals/<track>/*.json`. Each has `quiz[]` items
`{prompt, choices[4], answer (index), explanation}`.

## What you may change
- The text of `choices` (distractors, and the key only under rule G). Nothing else in the file: not `prompt`
  (unless rule E forces it), not `answer`, not `explanation` meaning, not `lesson`, `flashcards`, `drills`,
  order of items, order of choices, or JSON formatting style (keep 2-space indent / the file's existing style,
  UTF-8, final newline as it is).
- Rule G may move explanatory words from the key into `explanation` (append a sentence; never drop meaning).

## Rules
A. Every distractor is a specific, plausible misconception stated as a full claim, of the same grammatical
   form and specificity as the key. Prefer real confusions: another language's behaviour, an older-version
   rule, an off-by-one, the neighbouring API.
B. Every distractor must be verifiably FALSE for the prompt as written, per the language spec / standard
   library, for current versions (JS: ES2023 + Node 22; C#: 12/.NET 8; Java: 17). If you cannot state in one
   line why it is wrong, do not use it.
C. No hedges or absolutes ("always", "never", "only") unless the key has one too. No "all/none of the above",
   no jokes, no two distractors that say the same thing.
D. Parenthetical qualifiers or "because…" clauses appear on at least two choices or on none.
E. No distractor may be true under another reasonable reading of the prompt. If the prompt is ambiguous,
   make the smallest prompt edit that removes the ambiguity and note it in your report.
F. Length: after your edit the key should be within ±25% of the median choice length, and at least one
   distractor should be as long as the key or longer. Across each file aim for the key being the single
   longest choice in ≤ 3 of 10 items and the single shortest in ≤ 3 of 10.
G. Shorten the KEY instead of padding distractors when its extra length is explanation rather than answer
   (move that text to `explanation`), or when the answer is a value/token: then all four choices are bare
   values.
H. Code-valued choices (a value, an expression, an identifier, a type) are wrapped in backticks, e.g.
   `` `'object'` ``; apply consistently to all four choices of an item. Prose choices are not.
I. Do not make an item easier by making distractors absurd, nor harder by making them nearly-true.
J. Never change which index is keyed. Never leak another item's answer.

## Do not
- Do not run seed/compile/stamp commands, do not commit, do not touch files outside your track's folder.
  (Other agents are editing the other tracks in the same clone at the same time; a finisher compiles.)

## Check your work
`node fable52docs/tools/quiz-bias.cjs tools/seed/authoring/fundamentals` (run from the clone root) prints the
per-track table; `--list 50` prints the worst items. Every file must still `JSON.parse`. Count: each file
still has exactly the same number of quiz items, each with 4 choices and the same `answer` index as before
(verify with `git diff` — the `"answer"` lines must not appear in the diff).

## Report (final message, ≤ 250 words)
before → after "key is longest %" and "key is shortest %" for your track · number of items edited · list of
any prompt edits (file + item) · any item whose keyed answer you believe is WRONG or ambiguous (do not fix
the key; report it).
