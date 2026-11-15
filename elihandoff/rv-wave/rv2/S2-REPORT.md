# rv2 S2 `rv2-c` stop report (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-c`, branch **`rv2-c`**, base `499a4496` (integrated `rv-wave`). Nothing pushed,
`main` untouched, no `--no-verify`, no force, no history rewrite. Every commit uses `git commit -F` and ends with the
Co-Authored-By line. Stopped at a clean commit boundary (tree clean). Slice 1 details: `S2-SLICE1.md`.

## Branch + SHAs
**Slice 1 (C1 + lint + C2 + C3), merge at `52f40b19`:**
`481f9111` `5f15d72f` `767627f7` `ebcc694b` `02f7a18f` `42562d5e` (24 key-idea files) · `9b0f7885` (`seed:lint:keyideas`)
· `b9c52b13` (headlines + estimates) · `cb4844e9` (aligned with S1's reader) · `52f40b19` (sysdesign path + card-tags).

**Slice 2 (after `52f40b19`):**
| SHA | What |
|---|---|
| `712040bd` | C4 authoring: 16 C# bug-hunt drills + `FUNDAMENTALS_EXPECTED.csharp.drills` 27 -> 43 |
| `743094cd` | added-after-integration: sysdrills 02/01 hint 1 in prose |
| `07261208` | sysdrills re-import + stamp (129/129) |
| `f6ebf1fd` | campaign scopes broadened (orchestrator note: 2-3 sources per idea, broad scope) |
| `85cc8683` | C4: 06 bug hunt re-bugged (the first version was vacuous: seed:validate quarantined it) |
| `7a05d363` | C4 outputs: fund-csharp re-import + stamp, 43/43 |

## Counts before -> after (all counted by script)
- Key ideas: 0 -> **24 side files, 186 ideas** (per section below). Sources per idea: 1-3 everywhere (campaign: 3 quests
  from 3 repos). Campaign scopes after `f6ebf1fd`: idempotency 17, retries-timeouts 12, pagination 10, authz-tenancy 15,
  caching 16, validation 21, queues-outbox 20, migrations-rollout 19, reading-code 26 live quests (`recapAfter: 3`).
- Inherited items: none (INTEGRATION merged `rv-c-wip` and `rv-e1-wip`); the "added after integration" hint fix is done.
- `content/design/headlines.json`: 0 -> **2044** (70/70 primary sets = 1342/1342 key points; + 37 set B/C alternates = 702).
- `content/design/estimates.json`: 0 -> **670** numbers over 87 DESIGN IT sets (verbatim from the set).
- `content/paths/sysdesign.json`: 35 -> **34** sets on the path, 10 of 18 steps changed.
- `content/seed/card-tags.json`: 0 -> **142 / 938** quest flashcards tagged `repo-recall` (115 repo-docs, 27 list-recall).
- Fundamentals census (C#): drills **27 -> 43** (topics 20, quiz 200, flashcards 160 unchanged). JS 79 / Java 42 unchanged.
- sysdrills: 129 -> 129 (one hint reworded). Archive 880 unchanged. Packs 688 -> 688 (no new pack). Restamp N = 700.
- tools/seed tests: +11 (`keyideas-lint.test.ts`).

## Ideas per section
agentic 10 · bank-bootforge 7 · bank-csharp 8 · bank-java 10 · bank-jstrain 7 · campaign-authz-tenancy 6 ·
campaign-caching 5 · campaign-idempotency 5 · campaign-migrations-rollout 5 · campaign-pagination 5 ·
campaign-queues-outbox 5 · campaign-reading-code 5 · campaign-retries-timeouts 5 · campaign-validation-at-boundaries 5 ·
design-it 11 · fund-cs-language 10 · fund-cs-web 6 · fund-java-language 12 · fund-java-spring 5 · fund-js-core 11 ·
fund-js-platform 6 · fund-js-senior 12 · review-katas 7 · sysdrills 18 = **186**.

## Gates run (this clone, one at a time, foreground, `--maxWorkers=1`)
Slice 1 (at `52f40b19`): see `S2-SLICE1.md` (keyideas OK, leaks OK, answers OK, pins 688 OK, restamp 700/700,
keyideas-lint test 11/11, archive-real 5/5, root typecheck rc=0).

Slice 2 (final tree `7a05d363`):
```
seed:import:sysdrills                    TOTAL 129 === expected; validate --course 02: 6/6; full: 129/129, 0 quarantined, audit 6/0, stamp written, RESULT OK
seed:import:fundamentals --track csharp  topics 20 · quiz 200 · flashcards 160 · drills 43 === expected
seed:validate fund-csharp --course (16)  all pass after the 06 fix (06 first run: vacuous-check quarantine -> 85cc8683)
seed:validate --source fund-csharp       43/43, 0 quarantined, AUDIT 20 re-executed / 0 mismatches, STAMP written, RESULT OK (250.6s)
seed:lint:keyideas                       24 side file(s), 186 idea(s): 0 problem(s), 0 leak(s) · RESULT OK
seed:lint:leaks                          RESULT OK (146 baselined, 0 new, 0 stale)
seed:lint:answers                        RESULT OK
seed:pins                                RESULT OK: 688 pack(s): 688 OK, 0 MISMATCH, 0 UNCHECKABLE
restamp:all --dry-run                    700/700 fresh · RESULT OK
vitest tools/seed sysdrills/import.test.ts      22/22
vitest tools/seed fundamentals/import.test.ts   14/16: both failures PRE-EXISTING (js authoring vs E1's hint-2 gate, see bugs); csharp and java byte-match pass
vitest server test/api/fundamentals.test.ts     13/13
```
`test:csharp` was not run as a suite: the targeted C4 check is `seed:validate` under the real warm C# runner (each
reference passes, each bug-hunt starter fails as a test verdict). `test:java` not needed (no Java change).

## Deviations from the brief
1. **Two sections merge two binding rows** to stay within 5-12 ideas: `fund-js-senior` (24 short transactions + 25 lost
   update) and `fund-java-language` (01 `==`/Integer cache + 08 equals/hashCode/compareTo). Noted in each `_note`.
2. **Agentic ideas on injection, tool privilege, tool errors and evals** cite today's estate units (mastermorphic
   explain-backs; harbor, bootlocalopusv2, dotnet-ai-rag, organized-ai-learning-aiapplybotjs quests). C5 did not land,
   so no agent-engineering unit exists to add as a source.
3. **Formats were set by S1's reader**: campaign sections use `recapAfter: 3` (count); `headlines.json` is
   `bootquest-headlines@1` with `sets[<unit key>][q][k]` objects (extra fields `dimension`, `repoSpecific`, `kpHash`;
   top-level `dimensions`); `card-tags.json` is `bootquest-card-tags@1`. All parse with S1's Zod schemas.
4. **Sources semantics**: S1 counts an idea as met when ALL live sources are passed; the lint allows restating keys of
   any source, which is safe under that rule (see S2-SLICE1 "Contract notes" if the ruling changes).
5. **Scope** holds exact unit keys or `/`-ending prefixes only (the PLAN example `fund/js/25-` is not a paths-style
   prefix); Fundamentals sections scope the topic gates only (drills are sources/siblings).
6. **C4 bugs**: 9 of 16 starters use the wrong solution the topic's drill explanation names (02, 03, 05, 06, 11, 12,
   13, 14, 18). The other 7 carry one plausible bug in the topic's subject: 04's named swap and 09's named missing
   `ToList` would not compile (a starter must compile), so 04 drops the empty-errors guard and 09 the tie-breaker; 07,
   08, 10, 15 and 16 name no wrong solution (10 follows its explanation's point: a new lambda in `-=`). Starter
   headers say "02 · bug hunt:".
7. **C5, C6, C7 and C8-build not done** (budget). C8 spike done (below).

## C8 spike result
- `tools/seed/src/sysdrills/import.ts` hardcodes `SOURCE_KEY = 'sysdrills'`, `TRACK = 'sysdesign'`, competency
  `system-design`, the key prefix and the out dir (lines 41-56, 146-151, 185, 243-244); its CLI takes only
  `--authoring/--out`. As is, it cannot emit an `agentdrills` bank.
- No bound file stands in the way: `import.ts` is outside the seed fingerprint closure; the server loads every
  `content/packs/<dir>` with a manifest (`server/src/api/serve.ts` `defaultPackDirs`); the stamp follows the manifest's
  grader kind (`grader: 'js'` works for any track, `store/grader-fingerprint.ts` `graderKindForManifest`); `agentic` is a
  TrackId and `agentic-engineering` a competency; `seed:validate` takes any `--source` pack name (`validate/cli.ts:38-40`).
- **Verdict: yes, via a new importer dir** `tools/seed/src/agentdrills/` reusing the sysdrills source schema and
  `mapExercise` with its own constants and census; no bound-file edit. Caveats: the agentic track has
  `slate_drills = 0` (`002_seed_vocabulary.sql:9`), so without a migration the bank is reachable only from
  `content/paths/agentic.json` and the track browser; restamp N and the pins rise by one pack.
- Not built (budget): the 8 eval-lab drills, recorded-output fixtures and the >= 90% precision/recall checks.

## Upstream / other bugs found (report items, not fixed)
- **fund-js authoring fails E1's hint-2-prose gate (pre-existing on `499a4496`)**: `tools/seed/src/fundamentals/import.test.ts`
  fails 2/16 because 10 of 79 JS Fundamentals drills have a hint 2 containing `;` or parentheses (01/02-parse-a-quantity-field,
  03/01-pipe, 04/01-bind-all, 05/01-safe-deep-merge, 11/01-commonjs-loader, 14/01-lazy-chunks, 15/01, 16/01, 17/01,
  18/01). The gate (`sysdrills/import.ts:137-140`, merged with rv-e1-wip at `3d737270`) reaches fund-js through
  `mapExercise`, and fund-js was not re-imported after it, so `seed:import:fundamentals -- --track js` refuses today.
  Fixing it means rewriting 10 existing hints and restamping fund-js: not S2's call (existing items byte-identical).
- `fund-csharp/06-interfaces-inheritance-and-polymorphism/01-polymorphic-notifiers` explanation says declaring
  `Format` with `new` instead of `override` "would make that test fail". It does not: the only test calling `Format`
  through a `Notifier` reference uses a short message, so nothing is cut either way (seed:validate quarantined my first
  06 bug hunt, which used exactly that bug, as vacuous). Drill 1 stays byte-identical; fix the sentence or add a long
  message to that test when the topic is next re-authored (that changes drill 1 and the bug hunt's shared tests).
- `tools/seed` typecheck (`npx tsc --noEmit -p tools/seed/tsconfig.json`) has 3 pre-existing errors, not in the root
  typecheck: `factory/notes/notes.test.ts:189` (TS2698), `factory/quests/quests.test.ts:398` (TS7015),
  `ops/answer-rank.ts:71` (TS2532). `factory/` is bound; left as found.
- The estate has no primary DESIGN IT set that uses multi-region / failover maths (sysdrills module 12 keeps one weak
  set) and none on capacity cost beyond billing (module 10). Needs upstream docs (owner, O9).
- The estate has no G2 brief or kata on prompt injection, egress limits, test tampering, orchestration or context
  budget; C5's "G2 only from pinned estate docs" would have to report most of them as unwritable today.
- C6 needs a pinned repo to cite: `seed:quests:drafts` anchors every item at `<repo>@<sha>`, and sysdrills has no
  upstream repo (its authoring lives in this repo). Either cite the selfboot repo at a pinned sha (new checkout under
  `.cache/checkouts`, an owner call) or author them as Fundamentals-style items.
- Bank recap thresholds are large by construction (`bank-bootforge` scope 1760 live units x 0.8).

## What is left
- **C5** agent-engineering part 1 (10 agent-PR + 4 tool-design katas, 4 G2 sets, 6 context-budget quiz items).
- **C6** 36 "pick the model" quizzes (blocked on the citation anchor above).
- **C7 must** (C# 21-23, Java 21-23) and **C7 stretch** (C# 24-26, Java 24-26); their key ideas then append to
  `fund-cs-web` / `fund-java-spring`, and topic 21+ gates join those scopes.
- **C8 build** (agentdrills eval lab), feasible per the spike.
- Orchestrator: merge slice 1 (`52f40b19`), then the slice-2 commits; client typecheck and the full battery in the hub.
