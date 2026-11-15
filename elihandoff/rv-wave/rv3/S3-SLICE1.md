# rv3 S3 slice 1: `seed:audit:explanations` (ready to merge)

Clone `C:\Users\Owner\Desktop\bq-f52-d`, branch `rv3-x`, base `0d5d2f31`. **Slice 1 = `d29468c8`** (one commit, no
content change). Files: `tools/seed/src/ops/explain-audit.ts`, `explain-audit-cli.ts`, `explain-audit.test.ts`, one
line in the root `package.json` (`seed:audit:explanations`). Nothing bound, no `content/**`.

## Use
```sh
npm run seed:audit:explanations                          # all tracks: js, csharp, java, sysdrills
npm run seed:audit:explanations -- --track java --check  # exit 1 when a gate rule fails on java
npm run seed:audit:explanations -- --track java --items  # one line per failing item, with the reason
npm run seed:audit:explanations -- --track java --listed # + reading lists: D2, D3 claim sentences, L2, L3
npm run seed:audit:explanations -- --rule Q3             # only the items failing one rule
npm run seed:audit:explanations -- --track js --node-check   # + L4: node --check on every ```js lesson block
```
It reads the committed **authoring** (`tools/seed/authoring/fundamentals/<track>/*.json`, `tools/seed/authoring/sysdrills/*.json`;
the importer turns them into `content/` byte-deterministically, so no re-import is needed to see a fix) and
`content/fundamentals/sections.json`. Item ids are the shipped keys (`fund:<track>/<topic>/qNN`, `fund-<track>/<topic>/<slug>`,
`fund/<track>/<topic>`, `sysdrills/<module>/<slug>`). The per-item audit goes to `.cache/rv3/explain-audit.json`.

## Rules as implemented (PLAN §2; choices I made are marked *)
| Rule | Implementation | Gate |
|---|---|---|
| Q1 | 25..90 prose words (* fenced code not counted) | gate |
| Q2 | distinct content words (stop words and 1-letter words dropped, * light stemming) of the explanation: <= 70% occur in prompt + keyed choice | gate |
| Q3 | a content word of a non-keyed choice that is not in the keyed choice occurs in the explanation, or * a misconception phrase (`instead of`, `rather than`, `mistake`, `misconception`, `trap`, `tempting`, `wrongly`, `contrary to`, `a common belief/guess/...`) | gate |
| Q4 | `option B`, `choice 2`, `the first / second / last choice / option / answer`, `the answer above`, `the above`; * `above` / `below` as a comparison (`above 2^53`) passes | gate |
| Q5 | `leakMatchPrepared` (EB_LEAK_JACCARD / EB_LEAK_OPTIONS) of the explanation against every other keyed choice of the same topic | gate |
| D1 | >= 60 prose words (* fenced code not counted) | gate |
| D2 | listed when no test is named (verbatim, or >= 60% of one test name's content words plus the word "test") or no wrong approach (`instead of`, `rather than`, `not`, `n't`) | list |
| D3 | listed: sentences with fail / fails / break / breaks / throw / throws that also say "test": the proof worklist | list (gate by report) |
| D4 | hint 1 **and** hint 2 pass the importer's own `hintProseCode` (`sysdrills/import.ts`; java also refuses `->`); fewer than 3 hints fails | gate |
| L1 | >= 380 prose words, and no `##` section under 40 prose words | gate |
| L2 | a gate item whose `sections.json` heading is missing or not a lesson section, or whose section holds < 50% of the keyed choice's content words | list |
| L3 | a `##` section with no code block, no inline code span and no digit | list |
| L4 | `--node-check` (js only): each ```js / javascript / mjs block through `node --check` as a module | report |

## Summary table on `d29468c8` (counted by the script, before any rv3 rewrite)
| track | family | pass (all gate rules) | gate failures by rule | listed for reading |
|---|---|---|---|---|
| js | quiz | 102/330 (31%) | Q1 206, Q3 98, Q5 2 | - |
| js | drills | 36/79 (46%) | D1 40, D4 18 | D2 50, D3 14; D3 claim sentences 15 |
| js | lessons | 8/33 (24%) | L1 25 | L2 30, L3 9 |
| csharp | quiz | 73/230 (32%) | Q1 148, Q3 73, Q4 1 | - |
| csharp | drills | 5/49 (10%) | D1 35, D4 25 | D2 40, D3 16; D3 claim sentences 18 |
| csharp | lessons | 3/23 (13%) | L1 20 | L2 18, L3 4 |
| java | quiz | 96/200 (48%) | Q1 102, Q2 1, Q3 41, Q4 1, Q5 1 | - |
| java | drills | 3/42 (7%) | D1 35, D4 14 | D2 39, D3 7; D3 claim sentences 7 |
| java | lessons | 0/20 (0%) | L1 20 | L2 16, L3 2 |
| sysdrills | drills | 87/129 (67%) | D1 33, D4 14 | D2 129; D3 claim sentences 0 |

760 quiz items, 299 drills, 76 lessons: **722 items fail a gate rule**. Every Q1 failure is "too short" (none over 90).
L4 (js): 46/53 blocks pass `node --check`; the 7 that do not are fragments (`...`, bare expressions, a redeclared name).
Lessons: L1 fails on short sections far more than on total length (js 24 of 25, csharp 20/20, java 20/20 have a section under 40 words; 14 / 18 / 17 are under 380 words).

## Notes for S2 (java, W4) and the orchestrator
- `fund:java/07-collections-framework/q06` fails Q4 **and is wrong**: its explanation says "the first choice throws for a new
  key", but the stored first choice is the keyed `merge`; the `put(w, map.get(w) + 1)` choice is the one that throws.
- D4 is the importer's hint-2 rule applied to hint 1 too, as PLAN §2.2 says: a `;` in a prose hint 1 fails (js 18, csharp 25,
  java 14 drills). The 10 fund-js hint 2s of MF-5 are among the js 18.
- Deviation: the audit JSON is written to `.cache/rv3/` (git-ignored) instead of `work/rv3/`: `work/` is not in `.gitignore`
  and `.gitignore` is not an S3 file.
- `--check` is per selected track, so S2 can gate java alone; after rv3 the battery line is `seed:audit:explanations -- --check`.
- Test: `npx vitest run --root tools/seed src/ops/explain-audit.test.ts --maxWorkers=1` 21/21. `tsc -p tools/seed`: no error
  in the new files (the three it reports are older, in `notes.test.ts`, `quests.test.ts`, `answer-rank.ts`).
