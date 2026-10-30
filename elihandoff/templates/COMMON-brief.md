# <wave name> (<tag>): shared brief for the <N> Opus stream agents (<date>)

This is the brief shape that worked for the qw and cw waves (2026-10-30). Replace every `<…>`. Keep it under
80 lines: agents read it once. Per-stream details go in `S\briefs\<stream>.md`.

## Owner order
"<the owner's words, verbatim>". <Two or three sentences on the gap this wave closes and the quality bar.>
**Quality over quantity**: the qw wave spent days removing padding, duplicates and items that test the brief
instead of the code. Do not create the next round of that.

`S` = the wave's shared folder: `<absolute path, outside the repo, e.g. C:\Users\Owner\Desktop\bootquest-handoff\<tag>\>`
`H` = `C:\Users\Owner\Desktop\selfboot\elihandoff` (this handoff: REVIEW plan, tools, templates).

## Read first
1. `C:\Users\Owner\Desktop\selfboot\AGENTS.md` (contract; Windows shell gotchas).
2. `H\REVIEW-2026-10-30.md` §5 (your stream's brief) and §6 (rules), then `H\review-2026-10-30\R<n>-*.md` for the
   findings your stream acts on.
3. `docs/SEEDING.md` §3 for your content type's CLI, and §8's latest bullets (house rules the last review enforced).
4. Reference commits for your type: imitate their shape exactly.
   <e.g. cw sysdrills: `git log --oneline 772b19cb -- tools/seed/authoring/sysdrills/15-18-*.json`;
   cw DESIGN IT: `-- tools/seed/authoring/explainback/sysdesign--*ww48*`; cw quiz layer:
   `-- content/seed-drafts/quests/organized-experiment-ww7.json`.>

## Workspace
You get an existing clone (no new clone: disk is tight): `C:\Users\Owner\Desktop\bq-qw-s<N>` (N in your message).
```
cd C:\Users\Owner\Desktop\bq-qw-s<N>
git status            # must be clean
git fetch origin main # origin = selfboot; main = <sha>
git switch -c <tag>-<stream> origin/main
node H\tools\addrepos.mjs C:\Users\Owner\Desktop\bq-qw-s<N> <repo1,repo2,...>   # copy the pinned checkouts you need
```
Commit per module/pack with a message file ending `Co-Authored-By: Claude <Model> <noreply@anthropic.com>`. Never
push, never touch selfboot, never touch another agent's clone, never amend a commit after you have reported it.
Git Bash for every npm command with flags. vitest `--maxWorkers=2`. Run anything longer than ~2 minutes with
`run_in_background` and wait for its notification. Write big files in pieces.

## Repo claims (one repo, one stream)
Before authoring on a repo, append a line to `S\claims.md`: `<repo> — <stream> — <content type> — <topic>`. Read it
first; if another stream claimed the repo, pick another unless your brief says you share it (then read their keys
before keying anything).

## Rules (all streams)
- Code-truth: every claim about a repo is true at the pinned checkout (`.cache/checkouts/<repo>@<sha>`), cited
  file:line. Framework facts with no repo line need a scratch probe at the pinned version or a named authoritative
  source, recorded in your records and the commit message. If you cannot prove it, do not key it.
- NEAREST: before any new item, find the nearest existing unit(s) across the estate (grep concept words, not just
  API names: all drill banks, jstrain*, katas, quiz packs, all EB/G2/DESIGN IT sets) and record why yours is distinct
  in `S\records\<stream>\nearest.md`. Duplicates are rejected.
- Leaks: no note, flashcard back or EB key point may restate another item's keyed answer, both directions, both ages,
  EB-vs-EB on the same repo included. `node H\tools\dossier.mjs <clone-root> <repo> [--grep re]` prints everything on
  a repo. Record checks in `S\records\<stream>\xleak.md`. Finish with `seed:lint:leaks` 0 and `seed:lint:answers` OK.
- Pre-mx items (exist at 9b7f0ea3) stay byte-identical; new text yields. In-place quiz edits keep the correct choice,
  slot and order: `node H\tools\slotcheck.cjs <clone-root> origin/main` must print no changes.
- Drills: 4-8 tests incl. one `(boundary)`; hint 3 prose, never pasteable (no `return`, `;`, `=>`, parentheses);
  "Your task" states semantics, never the formula; each trap has a named naive variant and the test that defeats it;
  recompute every expected value independently.
- Prose: wrapped list items indented ≥ 1 space (client prose corpus guard). Interview-grade: numbers, trade-offs,
  failure modes; stack specifics where they matter.
- Counts: report before → after BY COUNTING. Do not edit `server/test/api/ladder-real.test.ts` or `docs/SEEDING.md`;
  the hub does. Put your deltas and a draft SEEDING §8 bullet in your report.
- Upstream bugs you find are report items (mirrors untouched).

## Stop report
`S\reports\<stream>.md` (≤ 80 lines): branch + SHAs, counts before → after, items added (ids/keys + one-line topic
each), gates run with tails, deviations, upstream findings, draft SEEDING bullet, what's left. Reply ≤ 40 lines.
Later you review one other stream (ring) and fix what your reviewer finds, as NEW commits.
