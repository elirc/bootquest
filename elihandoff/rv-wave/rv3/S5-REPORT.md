# rv3 S5 `rv3-f`: stop report (saved by the orchestrator from the stream's inline report)

The harness stopped the stream from creating new `.md` report files, so its report came back inline. This is a
condensed copy.

Clone `bq-f52-p`, branch `rv3-f`, base `123df8a6`. Merged into hub `rv-wave` as `a1adabe7`. Nothing pushed, no
bound file or owner DB touched.

| SHA | What |
|---|---|
| `7345c00e` | W9 kata precision: migration 029 (`kata_verdict`, `kata_precision`), `store/kata-flags.ts`, `api/kata-verdict-routes.ts` (review, approve, verdict-score), kata pane approve/block + `KataVerdictKeyView`, tests |
| `431f63b6` | S4 task 3: the 14 agent katas on `paths/agentic.json` and in the agentic and review-katas key-idea scopes |
| `4da35352` | W11 docs: `AGENTS.md`, `docs/SEEDING.md` §3/§8 (with a JAVA LINE placeholder), `elihandoff/README.md` |

## W9 acceptance and the test that proves each
- **Unflagged katas:** G1 numbers are byte-identical with the real flags file, with no flags, and with an unrelated store. Server `api/ladder` "rv3 W9 …".
- **Clean PR:** approve passes, and any finding fails it. Server `api/rv-ladder` and `ladder-real`, client `rv-ladder`.
- **Decoy line:** flagging one counts as a false positive (score 2/3, G1 1/2). Server `api/rv-ladder` and `ladder-real`.
- **No key before findings are stored:** `review` looks the same for clean and decoy katas, and the key returns 403 before the answer.
- **Migration 029:** append-only (`db`). Schema pins go from 28 to 29.
- **`smoke:api`:** 76/76. The script is unchanged and its kata is unflagged.

## Gates
- Root and client typecheck: rc=0.
- Server suites: rv-ladder 9, ladder 55, ladder-real 7, db+packs+ladder-sysdesign 76, archive-real+rv-day 13, nextup+keyideas 15.
- Client suites: rv-ladder+ladder+kata-diff 62, mock+http+ui-audit 54.
- `seed:lint:keyideas`: 201 ideas, 0 problems. `seed:lint:leaks`: 0 new. `seed:lint:answers`: OK.
- `seed:pins`: 690 OK. `restamp:all --dry-run`: 703/703.
- `seed:audit:explanations --check`: below the bar for Java only (rv3-java2 is running).

## Deviations
1. `app.ts` gained 2 lines (route registration).
2. Migration 029 adds a second table, `kata_precision`, so a later flags edit never moves scored numbers.
3. Decoy marks are self-marked, pre-set from the citations.
4. The verdict prompt appears only on the 6 flagged katas.
5. New katas are appended at the end of their difficulty step.
6. One clause in `agentic.json` `tool-contract-and-bounds` was reworded, because it overlapped C# 26 q02's key.

## Found
- The CLI kata self-score does not know the verdict endpoints (409 on flagged katas).
- `KeyIdeaDto.idea` is still `''` rather than optional.
