# review-2026-10-30: the detailed reports behind `../REVIEW-2026-10-30.md`

Four read-only reviews of the estate at `main` = `772b19cb`, written by Opus agents and spot-verified by the
orchestrator (see REVIEW §2). Nothing here was implemented. Every finding has file:line evidence at the pinned
checkouts (`.cache/checkouts/<repo>@<sha>`).

| File | Slice | What it holds |
|---|---|---|
| `R1-drills.md` | csdrills 72, javadrills 80, sysdrills 129 | §1 topic map, §2 quality findings (W1 hint-3 solutions, K1 task formulas, K2-K6), §3 proposals P1-P10, §4 the 15 jsdrills candidates, §5 duplicates. 45 drills read in full; all 129 sysdrills solutions executed. |
| `R1-topicmap.md` | all 281 drills | one line per drill: slug, topic, difficulty, skills, test count. Use it for NEAREST checks. |
| `R2-explainbacks.md` | classic 137, G2 20, DESIGN IT 87 | §1 inventory (which primaries lack set-B/C), §2 findings (W1 cite, K1 weights, K2 verbatim EB↔note pairs, K3 prompts list the sections), §2.4 46 code-truth checks, §3 coverage matrix, §5 proposals, §6 format ideas. |
| `R3-quests.md` | 204 quest packs | §1 distribution (thinnest/richest packs), §2 findings (W1-W5, K1 doc-recall drift, K2 flashcard length, K3 generator items), §3 campaign shape and XP math, §4 coverage matrix, §5 proposals P1-P11 with example stems. |
| `R4-app.md` | server, client, CLI | §1 feature inventory incl. shortcuts, scheduling, slate, XP, DESIGN IT rotation; §2 learning-science audit L1-L13; §3 UX findings BUG/WEAK/NIT; §4 server/CLI; §5 proposals P1-P14. |
| `scripts/` | the reviewers' helpers | see below |

## scripts/

Small read-only scripts the reviewers used, kept so the next wave can re-measure instead of re-estimating. The
reports refer to them as `scratchpad/rv/<name>`; that folder is gone, this is it. Run from the repo root unless a
script says otherwise; check the first lines for the paths each one expects (some were written for the scratchpad
and take the repo root as an argument or constant).

- `recompute.mjs`: runs every sysdrills solution and starter against its tests under node (R1: 129/129 pass, 0
  starters pass). Re-run after any sysdrills edit (wave B1).
- `taskformula.mjs`, `lint.txt`: per-drill flags for "formula in the Your-task line" and "code-like hint 3"
  (R1 W1/K1). `lint.txt` is the list wave B1 works through.
- `pairs.mjs`, `pairs.txt`, `cover.mjs`, `map.mjs`: duplicate-candidate pairs, keyword coverage scan and the
  topic-map generator for the drill banks.
- `inv.mjs`: explain-back inventory (repo, title, set, weights present). `leak.mjs`, `leak-out.txt`: the paraphrase
  scan of all 4,756 key points against same-repo quiz/flashcard/note text (140 pairs; the verbatim ones are R2 K2
  and owner decision §7.3).
- `dist.py`, `newitems.py`, `topics.py`, `compact.py`, `dumppack.py`, `dumpnew.py`, `dump.mjs`, `show.mjs`: quest-pack
  census, new-vs-old item split by `git log` date, keyword coverage, and compact dumps for reading packs (R3).
  Python 3 standard library only; run with `python -I` from the repo root. Pipeline order:
  `python -I elihandoff/review-2026-10-30/scripts/dist.py elihandoff/review-2026-10-30/scripts/out/dist.json` →
  `newitems.py` (writes `out/newitems.json`) → `dumppack.py <pack>` / `dumpnew.py` / `compact.py new|old`.
  All outputs land in `scripts/out/` (git-ignored; created on first run).
- `apiprobe.mjs`: read-only probe of the running API (`MSYS_NO_PATHCONV=1 node apiprobe.mjs /dashboard /stats/xp`;
  `FULL=6000` prints bodies). The orchestrator used it to establish REVIEW §1.
