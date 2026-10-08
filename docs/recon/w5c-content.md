# W5c content batch: formats and authoring paths

W5c seeded three kinds of content. All of it is ordinary `bootquest-seed-pack@1` output,
and `npm run seed:check` re-verifies every pack. The authoring helpers live in
`tools/seed/authoring/`. They sit outside `tools/seed/src/factory`, so they are not part of
any seed fingerprint. They only prepare drafts; acceptance is always decided by the
factory's own validators.

## Patch katas (G1): `content/seed/patches/<repo>-katas/`

- The source is `tools/seed/authoring/katas/<repo>.spec.json`. It records the kata, its
  difficulty, its context files, the edits as find/replace pairs, and the defects located
  by exact substring. `katagen.mjs` turns a spec into a `seed:patches` draft
  (`<repo>.draft.json`). The tool generates the unified diff by machine and keeps the
  CR/LF bytes of each line. It finds line numbers by substring search, so nobody types
  them in.
- Difficulty is not a field in the kata schema (W5a's `PatchesDraft` is strict). It is
  recorded in the spec and in `content/seed/patches/katas-index.json`.
- Tests: the `seed:patches` harness only registers drill-js. JS/TS katas can carry an
  adapted single-file module plus drill-js tests. Where possible, these are ported from
  the source repo's own test, and the name says so. C# katas ship without a test until a
  drill-cs runner is registered in the seed harness.
- `kata-proof.ts` prints, for every shipped kata, the clean `git apply` result and the
  test result on the clean context and on the defective version.

## C# quest content: `content/seed/quests/<repo>/` + `content/seed/explainback/<repo>--<unit>/`

- `seed:quests` cannot read hand-authored items; it only parses guide shapes. For these
  repos, `quests-authored.ts` runs the same generator over a curated guide list and adds
  the session's authored quizzes from `tools/seed/authoring/quests/<repo>.authored.json`.
  Every candidate then goes through `validateQuestItem` before `writeSeedPack` stamps the
  pack.
- An authored quiz is bound to the guide lines that support its key. Its citations are
  the parser's citations inside that range.
- Explain-back sets are plain `seed:explainback --draft` runs. The drafts are in
  `tools/seed/authoring/explainback/`.

## G2 delegation-brief rubrics: `content/seed/explainback/g2-brief--<repo>/`

- Kind: `explain-back`, generator `explainback`, one item per pack. This kind was chosen
  because spec §8 says G2 is "self-scored with immutable-answer-first flow like
  explain-back". The explain-back validator requires every checkpoint to quote the unit
  or cite a resolvable `file:line`.
- Unit (`provenance.path`/`lines`): the scenario repo document that states the work being
  delegated, such as a finding or an exercise.
- Questions are always three, because the explain-back validator requires exactly three
  with 5–8 key points each:
  1. `G2 BRIEF — …`: the scenario. The learner writes the brief (goal, allowed files,
     boundaries, test command, stop condition) before seeing the model answer. Its 6–8
     key points ARE the model-answer rubric.
  2. `G2 PRE-MORTEM — …`: the likeliest ways an agent fails on this task, and the brief
     line that prevents each one (5 checkpoints).
  3. `G2 HANDBACK REVIEW — …`: what to verify before accepting the agent's handback
     (5 checkpoints).
- Weights: every key point's `text` starts with `[wN] `, where N is 1–3
  (`/^\[w([1-3])\] /`). Self-score per question is the sum of the weights ticked divided
  by the sum of the question's weights. Suggested G2 pass: Q1 ≥ 70 % with every `[w3]`
  checkpoint in Q1 hit.
- Key collision note: explain-back keys are `(repo, unit path, 'draft')`. A G2 rubric
  and an ordinary explain-back set on the same unit would collide, so each rubric uses a
  unit no explain-back set uses.
