# rv3 S4 slice 1 (W7 katas): ready to merge

Branch `rv3-a` in `C:\Users\Owner\Desktop\bq-f52-c`, base `6713c8d5`. Merge through **`cbf87faa`**:

| SHA | What |
|---|---|
| `7334ebe3` | `agentpr-ww16-katas`: 8 agent-PR katas over `ww16@f649784` |
| `a76e8393` | `agenttools-mastermorphic-katas`: 4 tool-design katas and 2 agent-PR katas over `mastermorphic@c9b8310` |
| `cbf87faa` | `content/seed/kata-flags.json` and its builder, `katas-index.json` 52 -> 66, key ideas re-pointed, ladder-real census pin |

## Katas (14)
| Kata (spec id) | Shape | Difficulty | Test |
|---|---|---|---|
| ww16 `csv-arr-test-rewritten` | edited test | easy | none (zod) |
| ww16 `approve-calls-missing-repository-method` | invented API | medium | none (TS service) |
| ww16 `unknown-role-fails-open` | swallowed error | medium | drill-js |
| ww16 `test-pr-reopens-rejected-deals` | scope creep | easy | drill-js |
| ww16 `assigned-approver-check-in-service` | **clean** | medium | none |
| ww16 `domain-test-for-channel-approval-role` | **clean** | easy | none |
| mastermorphic `fetch-timeout-covers-body` | **clean** | medium | none |
| ww16 `transition-permission-table-refactor` | **decoys** (3 lines) | medium | drill-js |
| ww16 `leaderboard-quarter-from-close-date` | **decoys** (3 lines) | hard | none |
| mastermorphic `todo-progress-counts-in-progress` | **decoys** (3 lines) | easy | drill-js |
| mastermorphic `todo-write-appends` | tool design: not safe to retry | easy | drill-js |
| mastermorphic `fetch-returns-whole-page` | tool design: unbounded output | easy | drill-js |
| mastermorphic `fetch-reads-pdf-as-text` | tool design: contract vs behaviour | medium | drill-js |
| mastermorphic `search-errors-as-empty-results` | tool design: errors as data | medium | drill-js |

Every defect cites `<repo>@<sha>:path:line` (factory-resolved). None of the 14 is on `content/paths/agentic.json` (per PLAN, until S5 W9).

## How `clean` / `decoys` are carried (the F10 fallback)
`seed:patches` cannot carry them without a factory edit, for two reasons:
- `PatchesDraft` is `.strict()` (`factory/patches/run.ts`).
- `validateKataItem` refuses an empty seeded-defect key (`factory/patches/patches.ts`, "a kata needs >= 1 defect").

So:
- **`content/seed/kata-flags.json`** (`bootquest-kata-flags@1`) is keyed by the seed kata key and holds `unitKey`, `pack`, `title`, `pattern`, and either `clean: true` or `decoys: [{path, lineStart, lineEnd, in: 'patched', why}]`. It counts 3 clean katas and 3 decoy katas with 9 decoy lines. `tools/seed/authoring/katas/kata-flags.mjs` builds it from the specs, and `--check` fails when the file is stale. Each decoy must be a line the diff adds, and must not overlap a seeded defect.
- **A clean kata's key holds exactly one entry, marked `in: 'repo'`.** That entry is the shipped defect the PR fixes, never a defect of the PR. G1 counts only patched-line defects (`kata_score_detail`), so the entry adds 0 to G1 totals. **For S5 W9:** for a kata flagged `clean`, "approve" passes and any finding fails. Show the entry as "what this PR fixes", not as a missed defect.

## Gates (bq-f52-c, after `cbf87faa`)
```
katas-build (2 specs)        OK: 8 + 6 shipped, 0 quarantined, 16 real executions
kata-proof (2 new packs)     kata-proof: 14 kata(s), 0 problem(s), 16 execution(s)
kata-flags --check           up to date (3 clean, 3 decoy kata(s), 9 decoy line(s))
kata-index                   66 katas {"easy":24,"medium":30,"hard":12}, tested 58
seed:pins                    RESULT OK: 690 pack(s): 690 OK, 0 MISMATCH, 0 UNCHECKABLE
restamp:all -- --dry-run     702/702 fresh   (700 + 2 new patch packs)
seed:lint:leaks              0 new, 0 stale (146 baselined) RESULT OK
seed:lint:answers            0 new over the limit RESULT OK
seed:lint:keyideas           24 side file(s), 198 idea(s): 0 problem(s), 0 leak(s) RESULT OK
server ladder-real           6/6 (new pin: 66 katas)
server nextup / archive-real / rv-day   2/2, 5/5, 8/8
tools/seed keyideas-lint     13/13
```

## Notes for the merger
- Key ideas: in agentic, `agent-pr-failure-patterns`, `verify-dont-trust` and `tools-safe-to-retry` gain the new katas as sources, and one new idea, `tool-contract-and-bounds`, takes agentic from 10 to 11 ideas. In review-katas, `precision-matters`, `behaviour-not-style` and `test-asserts-the-change` gain sources. **Scopes are unchanged.** The katas join the scopes when they join the path (S4 task 3).
- Code-truth found while writing: ww16's review finding 6 ("quarter of approval, not of close date") cannot be fixed in the job alone, because `reportingRepository.ts:43` counts deals by `approvedAt`. That is what the hard decoy kata teaches. It is an upstream report item, not a fix.
