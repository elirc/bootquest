# C4 ruling: OPERATIONS, RISK and GATES (ab-wave draft plan, 2026-10-30)
Probed read-only on selfboot `ab-wave` @ a4fe7def. Live facts: **2.4 GB RAM free** (Chrome resident), 13 GB disk free,
owner server on :4178 started 10:32 from selfboot `npm run serve` (main 772b19cb code). Clones bq-qw-s1..s7 hold only
3-23 of the 217 pinned checkouts.
## Q3 restamp strategy: CONFIRM one hub restamp, AMEND with conditions C-a..C-d
- **Side module: works only for brand-new schemas.** `api.ts` is bound because `pack.ts` (ALWAYS_ROOT) value-imports
  `UnitContentEntry` from it (shared/src/pack.ts:2). A new `shared/src/api-ab.ts` with its own `"./api-ab"` export
  (shared/package.json is unhashed), imported by nothing in the closure, stays unbound: PUT /settings/slate, GET
  /stats/weak and GET /units/index could live there. Edits to existing strict-zod DTOs (card competencyId, slate
  targetUnitId, evidence missedIds, weighted score) cannot: server tests parse live responses with api.ts, so each edit
  duplicates nested schemas. A5 edits seed-pack.ts and factory/explainback and restamps anyway. Net: it defers nothing
  and adds debt.
- **C-a. Pure restamp, never a re-seed.** `--restamp` rewrites a stamp only if every item re-validates accept AND
  byte-identical with no guard failure (SEEDING §3, §6). If A5's validator adds `weight` to stored items, normalises
  `[wN]`, or runs the "unweighted DESIGN IT/G2 kp" refusal as a stamp-path guard, the restamp fails and becomes a
  re-seed of up to 244 EB packs (136 carry `[wN]` today). S5 keeps old items byte-stable (read-side or optional-field
  weight, refusal on new input only) and proves it in-stream (table).
- **C-b. Forbidden files:** `server/src/api/runners.ts`, `server/src/runners/**`, `runner-csharp.ts`,
  `runner-java.ts`, `tools/seed/src/validate/**` (grader stamps: full seed:validate of 8 sources, ~60 min + C#/Java), and
  `shared/src/campaign.ts` (campaign seeder fingerprint). S4's "mixed drill mode" stays in service/client code.
- **C-c. Restamp once, after ring fixes and the last fingerprinted merge.** A later api.ts/barrel/factory edit = a
  second full restamp.
- **C-d. Round 2 branches from the restamped ab-wave**, so C is content-only and runs every gate in-stream.
## Streams restamp locally, then discard: OVERTURN
- Infeasible: seed:check FAILS any pack whose checkout is missing (the clones lack 194-214 of 217). Each restamp+check
  takes about 1.5-2.5 h, and five at once with 2.4 GB free cannot run. cw never finished one full seed:check.
- Hub-only, stamp-dependent: smoke:api (the real entrypoint refuses stale stamps, store/seed-items.ts:202-214) and 4
  server test files that load real content/seed (ladder-real, ladder.test REAL case, notes, study-quests). S1-S5 may
  fail only there, and only `seed fingerprint … != current`; the grep goes in the stop report.
## "Half a day" restamp: AMEND to 2-3 h planned, half a day as contingency
- Evidence: past restamp commits landed 35-54 min after their trigger commit, at 562-601 packs: 1af61f6e→cb974362
  54 min (578 files), 06d5bf62→7ea0d6f0 38 min, 84227c26→2c950918 35 min, 213ddfc9→69644787 39 min. Now 688 packs
  (EB 244 / quests 204 / notes 204 / patches 31 / variants 5): about 45-65 min for `--restamp`, plus the same for the
  plain check.
- **`mkchunks` is LOST** (not in the repo or in handoff/tools). The hub rebuilds it: a Node script with short Desktop
  junction roots (MAX_PATH), each chunk co-locating a repo's quests+notes+EB (the eb-leak guard reads `<root>/quests`).
  Idempotent: re-run a killed chunk.
## Hub merge order: AMEND
1. S6, then S7: no fingerprint change. S6 commits its own `seed:validate --source sysdrills` stamp.
2. **Checkpoint A, stamps still fresh:** restamp:all --dry-run all fresh, leaks, answers, server vitest, smoke:api.
3. S1 (017), S2 (018), S3 (019), in order: migrate.ts:37 throws on a gap. The hub renumbers if S2 needs none, safe only
   while no real DB has applied them (checksum lock, migrate.ts:72).
4. S4 (uses S1's slate DTO and the Dashboard fetch), then S5 (ladder-service merges with S2/S3).
5. After each merge: both typechecks and the touched test files. Then census pins, then the restamp.
## Q7 landing: AMEND: stop at a gated ab-wave, no local main merge
- A restart of the owner's server from main would apply 017-019 to the real bootquest.db. If the owner overturns a
  stand-in ruling and a migration changes, the checksum lock trips. "Land" = `merge --no-ff` + push, done together on
  the owner's word.
- Never restart :4178 while selfboot is on ab-wave. At the end, `git switch main` in selfboot.
## Sharing 16 GB (2.4 GB free now): ADD a machine-wide lock
- **HEAVY, 1 holder:** `mkdir C:\Users\Owner\Desktop\bootquest-handoff\ab\locks\heavy` (atomic), `rmdir` after, retry
  every 60 s. Covers the client suite, full server vitest, tools/seed vitest, seed:check chunks, smoke, demo:promotion,
  test:csharp/java. Streams use `--maxWorkers=2`; the hub uses 3 only with ≥ 6 GB free.
- **MEDIUM, ≤ 2 holders** (`locks\med1`, `locks\med2`): tsc (~1 GB) and the lints. Targeted test files need no lock.
- Client suite: S1-S5 run it once at stop time. S6 and S7 never run it.
- Disk: round 2 reuses the clones (`git fetch origin ab-wave && git switch -c <b> origin/ab-wave`, overriding REVIEW
  tip #14's origin/main, because a4fe7def holds the briefs). Generators lack `--checkouts`, so `addrepos` only claimed
  repos. Stop and report below 4 GB free. The ~30 old bq-* dirs need the owner's OK.
## Gates per stream (✓ required · h hub-only · – n/a)
| Gate | S1 | S2 | S3 | S4 | S5 | S6 | S7 |
|---|---|---|---|---|---|---|---|
| typecheck root + client (MED); targeted test files | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| server vitest full (HEAVY): only fingerprint-refusal fails / clean | ✓ | ✓ | ✓ | ✓ | ✓ | clean | clean |
| client suite (HEAVY, once) | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| vitest --root tools/seed (HEAVY) | – | – | – | – | ✓ | ✓ | ✓ |
| planted + restamp proof: `seed:check -- --restamp --dir <chunk: 10 DESIGN IT + 10 legacy EB repos, quests/notes co-located> --checkouts selfboot\.cache\checkouts`, scratch copy, discarded | – | – | – | – | ✓ | – | – |
| demo:promotion (temp packs at the current fingerprint; confirm on first run) | ✓ | ✓ | – | – | ✓ | – | – |
| import + `seed:validate --source sysdrills` (commit stamp) | – | – | – | – | – | ✓ | – |
| scoped `seed:check --dir` on re-seeded packs; slotcheck; eblint | – | – | – | – | – | – | ✓ |
| leaks 0 + answers OK; restamp:all --dry-run all fresh | – | – | – | – | lints | ✓ | ✓ |
| smoke:api · ladder-real pins / census | h | h | h | h | h | ✓ · h | ✓ · h |
## Hub battery order (round 1 ≈ 3-4 h machine time; round 2, no restamp, ≈ 1-1.5 h)
1. Free-RAM check; all streams idle; the hub holds HEAVY. Merges, then checkpoint A.
2. Static: both typechecks, `npx vitest run --root tools/seed` (fingerprint.test pins), leaks, answers, seed:pins.
3. Chunked `seed:check -- --restamp`, then a chunked plain seed:check, then `restamp:all -- --dry-run` all fresh. One
   commit.
4. Server vitest `--maxWorkers=3`, then selfrun, then smoke:api, demo:promotion, seed:demo:planted,
   `seed:campaign -- --check`.
5. Client suite. 6. test:csharp, then test:java (JDK 17); taskkill dotnet trees.
7. A fingerprinted fix sends you back to 3. Any other fix: rerun only its gates, then the final restamp:all --dry-run.
