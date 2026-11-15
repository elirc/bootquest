# rv2 S2 slice 1 (C1 + lint + C2 + C3): ready to merge

Clone `C:\Users\Owner\Desktop\bq-f52-c`, branch `rv2-c`. **Merge slice 1 at `52f40b19`** (base `499a4496`). Later
commits on the branch are slice 2 (C4 authoring, sysdrills hint) and are not part of this slice.
Nothing pushed, `main` untouched, no `--no-verify`, no history rewrite; every commit uses `-F` and the Co-Authored-By line.

## Commits (oldest first)
| SHA | What |
|---|---|
| `481f9111` | keyideas: sysdrills (18, one per module), design-it (11) |
| `5f15d72f` | keyideas: agentic (10), review-katas (7) |
| `767627f7` | keyideas: fund-js-core (11), fund-js-platform (6), fund-js-senior (12) |
| `ebcc694b` | keyideas: fund-cs-language (10), fund-cs-web (6), fund-java-language (12), fund-java-spring (5) |
| `02f7a18f` | keyideas: bank-bootforge (7), bank-jstrain (7), bank-csharp (8), bank-java (10) |
| `42562d5e` | keyideas: 8 campaign-<tag> sections + campaign-reading-code (5-6 each) |
| `9b0f7885` | `seed:lint:keyideas` (`tools/seed/src/ops/keyideas-lint{,-cli,.test}.ts`) + root `package.json` script line |
| `b9c52b13` | `content/design/headlines.json` + `estimates.json` |
| `cb4844e9` | align with the S1 reader: campaign `recapAfter: 3`, headlines in `bootquest-headlines@1` shape, lint accepts counts |
| `52f40b19` | `content/paths/sysdesign.json` hand review + `content/seed/card-tags.json` |

## Counts before -> after (counted by script)
- `content/keyideas/`: 0 -> **24 files, 186 ideas** (sysdrills 18; every other section 5-12).
- `content/design/headlines.json`: 0 -> **2044 headlines**: 70/70 primary sets (50 DESIGN IT + 20 G2) = 1342/1342 key
  points, plus the 37 set B/C alternates (702). Dimensions: trade-offs 465, consistency 410, operations 301, reliability
  238, security 213, data-and-api 159, scaling 133, requirements 125.
- `content/design/estimates.json`: 0 -> **670 numbers over 87 DESIGN IT sets**, each a verbatim substring of the prompt or
  key point named in `at` (checked by script).
- `content/paths/sysdesign.json`: 35 -> **34 sets**; 10 of 18 steps changed (list in `52f40b19`'s message and below).
- `content/seed/card-tags.json`: 0 -> **142 of 938** quest-pack flashcards tagged `repo-recall` (115 repo-docs, 27 list-recall).
- Packs, stamps, census: unchanged (no pack touched in slice 1).

## Gates (this clone, one at a time, foreground)
```
seed:lint:keyideas   24 side file(s), 186 idea(s): 0 problem(s), 0 leak(s) · RESULT OK
seed:lint:leaks      244 explain-back / 204 quest / 204 notes pack(s), 4756 key point(s): 146 pair(s), 146 baselined (baseline 146), 0 new, 0 stale, 0 unweighted · RESULT OK
seed:lint:answers    291 pack(s) / track(s) / topic(s) scanned, 0 new over the limit, 2 baselined, 0 worse, 0 stale-high, 0 stale · RESULT OK
seed:pins            RESULT OK: 688 pack(s): 688 OK, 0 MISMATCH, 0 UNCHECKABLE
restamp:all --dry-run  700/700 fresh · RESULT OK (dry run)
vitest tools/seed src/ops/keyideas-lint.test.ts   11/11 passed (includes the committed 24 files clean)
vitest server test/archive-real.test.ts            5/5 passed (paths: 18 modules, 1-2 sets each)
npm run typecheck (root)                            rc=0
```
S1 contract check: all 24 key-idea files, `headlines.json` and `card-tags.json` parse with S1's own Zod schemas
(`bq-f52-p` `server/src/store/keyideas.ts`, imported read-only).

## Contract notes for the integrator (S1 <-> S2)
- **recapAfter**: Fundamentals / banks / sysdrills / design-it / agentic / review-katas use `0.8`; the 9 campaign
  sections use the whole count `3` (S1's `RecapAfter` accepts counts >= 2; the lint now does too).
- **Sources semantics**: S1 shows an idea as met when ALL its live sources are passed (S1 deviation 1). The lint lets an
  answer restate the keyed answers of any of its sources, which is safe under that rule. Fundamentals ideas list
  `[topic gate, topic drill 1]` (so a drill pass can start a redo card); campaign ideas list 3 quests from 3 repos, so
  under "all sources" those cards enrol late. If the ruling becomes "any source", the lint must forbid an answer from
  restating any source's key: one change in `keyideas-lint.ts` (`own` = empty set for that check).
- **headlines.json** = `bootquest-headlines@1`, `sets[<unit key>][q][k] = { headline, dimension, repoSpecific, kpHash }`
  (S1 reads `<unit key>#q<i>k<j>`); top-level `dimensions` holds the 8 dimension definitions for S3.
- **card-tags.json** = `bootquest-card-tags@1`, `tags[<flashcard item key>] = ["repo-recall", "repo-docs" | "list-recall"]`.

## Path changes (ruling 7)
01: -opusorganize schema change, +javabootcamp URL shortener · 02: -URL shortener, +3buildanalytics rate limiting ·
05: -tenant-search-indexer, +grok-build-multitenant · 08: -zz7 exports, +dub click analytics · 09: -master offline
edits, +pulse-net ingest · 10: -3buildanalytics (now 1 set: billing) · 13: -groktuts, +tenant-search-indexer ·
15: -outline CRDT, +opusorganize workflow engine · 16: -twenty GraphQL, +opusorganize zero-downtime schema change ·
17: -dotnet-auth OAuth, +master offline edits. Weak: 12 (multi-region) keeps masteropen only; no primary set uses its maths.

## Deviations (slice 1)
- The binding list has 13 rows for `fund-js-senior` and `fund-java-language`; the 12-idea cap merges 24+25 (short
  transactions + lost update) and 01+08 (Java equality). Said in each file's `_note`.
- Agentic ideas on injection / tool privilege / tool errors / evals cite today's estate units (mastermorphic
  explain-backs; harbor, bootlocalopusv2, dotnet-ai-rag, aiapplybotjs quests): no G2 or kata covers them yet.
- Headlines: 42 headlines share a 4-word subject phrase with their key point after punctuation folding (names the
  subject, not the answer; spot-checked on 10 sets).
