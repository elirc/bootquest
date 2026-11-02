# 04 · Adversarial review: findings and resolution

Three Opus agents reviewed the draft (read-only, one review file each, verbatim in [`review/`](review/)):

| Reviewer | Angle | Verdict (short) |
|---|---|---|
| [R1](review/R1-factcheck.md) | fact-checker: every count and claim vs code, content and a DB copy | counts almost all correct; the headline promotion claim wrong |
| [R2](review/R2-senior-skeptic.md) | senior engineer + learning-science skeptic | lab direction right; the plan built a toy-app gym with inflatable ratings, ignored the estate's own senior curriculum, and built before use |
| [R3](review/R3-feasibility.md) | feasibility + architecture adversary | direction sound; L1 rested on a runner that does not exist and retests that cannot be tickets; most of L1 already exists in the signalpost sync path |

The "Evidence" column names the code, file or query behind each finding ("—" = a judgment or language-semantics
argument accepted on its reasoning). The orchestrator independently re-checked rows 1-3, 5-7, 11, 13-14, 22 and 25
against the code or the DB copy; the other rows rely on the reviewers' cited evidence.

## Accepted and applied

| # | Finding | Source | Evidence | Change |
|---|---|---|---|---|
| 1 | **No competency can be promoted today**, not "6 of 8": G3/G4 can never get leg (b) (0 `unit_prerequisite`, 0 `unit_ref` rows; prerequisites come only from synced content refs); G3 has no variant | R1 E1, R3 | DB query; `evidence.ts:288-305`; `store/ladder.ts:351-363` | 01 §7.3 rewritten |
| 2 | Demotion is inert too: all ratings are 1, `lapseMayDemote` refuses at the floor | R1 E2, R3 | DB (`competency_rating` all 1); `fsrs.ts:179-180` | 01 §7.3 |
| 3 | One existing `bootquest sync` of signalpost makes 4 competencies promotable with zero code (U01-U03 + committed EBs + drill-js variants; `ladder-real.test.ts:239`) | R1, R3 | test and `content/sync/check-specs.json`; `sync_run` = 0 | 01 §7.3; 03 U1 |
| 4 | The http-tasks-api retest is test-only and never reaches the owner DB | R1 E3, R3 | `server/test/fixtures` | 01, 02 |
| 5 | No `vitest-project` runner (schema only, 501); Stryker is self-reported, not a grader or leg | R3 | `runners.ts:123-132` | 01 §3; 03 §3 constraints, L9 |
| 6 | Variants are drill-only (`seed-pack.ts:199`); ticket retests would restamp | R3 | `seed-pack.ts` | 03 §3 constraints |
| 7 | EB competencies are hard-coded by family; J-formats do not feed `communication` as claimed | R3 | `store/ladder.ts:240` | 03 §4 |
| 8 | A 0-XP test-out unlocks nothing under the campaign rule; making it unlock conflicts with the honesty model | R3, R2 | `engines/campaign.ts` header | 03 U4 redesigned as placement |
| 9 | L3 rows-touched budget not measurable via node:sqlite; EXPLAIN text drifts across SQLite versions | R3 | `package.json` engines `>=22.16` | 03 L3 |
| 10 | L4 cannot "switch at every await"; only at an injected port's yield points; node:sqlite is synchronous | R3 | — (Node semantics) | 03 L4 rescoped to app-level races |
| 11 | SQLite lacks NOT VALID, row locks and write skew; PGlite (used by signalpost) is an option | R2, R3 | signalpost `package.json` (`@electric-sql/pglite` 0.5.8) | 03 §0, L2, L3, order step 8 |
| 12 | Promotion ignores difficulty (four easy tickets → 5/5) | R2 | `evidence.ts:17-35` | 01 §7.5; 03 B1 |
| 13 | Building before use again; `docs/DOGFOOD.md` already exists; no hour budget | R2 | file exists | 03 U0 |
| 14 | signalpost U04-U12 is already a senior CRUD curriculum; `repo-task` predicates and `http-lab` exist | R2, R3 | `docs/curriculum/program.json` | 03 §3 "Where they live" |
| 15 | Hidden tests + free `run` = oracle; seniors must find the spec | R2 | README honesty model | 03 L1/B3, constraints |
| 16 | Hidden keys are honor-system on disk; the README does not say so | R3 | `content/` on a public repo | 01 §7.6; 03 constraints |
| 17 | Labs announce their category and katas are always guilty: no precision cost | R2 | — | 03 constraints, L5, L7, J3, B5 |
| 18 | Build skill never decays; demotion is recall-only | R2 | `fsrs.ts` | 03 §2, B5 |
| 19 | U4 calibration was circular (self-score vs self-score) | R2 | — | replaced by B7 |
| 20 | Labs lose to drills in the daily loop | R2 | `streak.ts` rules | 03 §3 constraints |
| 21 | Missing senior skills: ambiguity → spec, large codebases, ownership over time, API evolution, dependency upgrades, caching correctness, GDPR, instrumentation, directing AI agents | R2 | — | 03 §0 table, L1 topics, B2-B6 |
| 22 | Written 147 = 141 jstrain + 6 bootforge (not "BootForge"); jstrain has 50 modules | R1 E4, E5 | DB query; file count | 02 |
| 23 | Coverage map undersold build drills (data modeling, transactions, auth, forms, a11y, code review, incidents) | R1 E6 | spot-checked titles | 02 §6 rows |
| 24 | Quest packs by app track js 144 / csharp 48 / java 12; JS has 3 content-pending steps | R1 E7 | — | 02 §3 |
| 25 | 855 of the drills are graded by `self-run` | R1 | DB query (drill-js 1,952, self-run 855, drill-java 248, drill-cs 184) | 01 §3, 02 §1 |
| 26 | Restamps are rarer than the draft implied | R3 | `fingerprint.test.ts` input set | 03 §6 |
| 27 | Authored units skip every seed validator | R3 | — | 03 §6 |

## Ideas changed, cut or added

- **Added (R2):** B1 tiered promotion, B2 bring-your-own ticket, B3 spec-hidden tickets (merged with L1), B4
  large-codebase navigation, B5 mystery pool with spaced re-exposure, B6 executable alerts and instrumentation
  (merged with L6), B7 calibration on own work, B8 contrasting cases.
- **Added (R3):** U1 sync signalpost, U2 close the G3/G4 dead end.
- **Cut:** U5 promotion packet, J7 STAR prompts, the ASP.NET/Spring twins of every lab.
- **Deferred:** J8 interview mode, the system-design promotion path (system design is the strongest area).
- **Merged:** J6 postmortem into L6.

## Not accepted, or accepted with a caveat

- **R2's "freeze new waves until ≥ 30 attempts"** is kept as a recommendation (U0), not a rule: the owner decides.
- **PGlite for L2/L3** is recommended only if it resolves inside the drill/node-test-file child (R3's caveat); the
  fallback is SQLite with the differences stated in the lab.
- **R3's estimate of the signalpost route as "M per milestone batch"** assumes the owner writes the upstream check
  files in their private repo; that owner time is not counted in the effort column.
