# Seeding BootQuest content

BootQuest never calls an LLM at runtime. All authored content (quizzes, flashcards,
reading steps, explain-back question sets, changed-example retests, patch katas) is
produced at **seed time**, inside a Claude Code build or maintenance session. A
deterministic validator must accept every generated item before it is written into
`content/`. The running app only serves what is committed and stamped.

This document is the runbook for that work (spec §7).

## 1. Re-seed runbook

Use this when you have added or changed guides in your GitHub repos.

1. **Add guides to your repos** as usual (Goal / **Check** exercises, findings, lessons).
2. **`bootquest sync`** (or `npm run seed:sync`). The sync job walks every repo listed in
   `curriculum.yaml` at its HEAD, refreshes `content_ref` rows and registers
   `program.json` units. It also queues every **new stable_key** for the next seed
   session. To see the queue, run `npm run seed:sync -- --queue 50` or call
   `GET /api/sync/queue`.
3. **Open a Claude Code session in the app repo** (`Desktop\selfboot`).
4. **Run the seed generators for the new stable_keys**: `seed:quests` /
   `seed:quests:drafts` for guides, `seed:explainback` for units worth an explain-back,
   `seed:variants` for changed-example retests, and `seed:patches` for katas built from
   new findings. Section 3 has the exact commands.
5. **Validators green.** Every generator stamps its pack only when its validator accepts
   the output. Then run `npm run seed:check`. It must print `RESULT OK` and exit 0. If you
   changed grader or validator code, also run `npm run seed:validate` (see section 6).
6. **Commit** the new or changed `content/seed/**` packs, any drafts under
   `content/seed-drafts/` or `tools/seed/authoring/`, and the stamps.

This replaces paid, self-improving background jobs with free maintenance driven by a
session. Sync detects work, a session does it, and validators decide.

The raw queue is wide: the first full sync queued about 1,468 `initial` items across 4
repos. Triage it. Seed what you will actually study, not everything that is new.

## 2. Source checkouts (`.cache/checkouts/<repo>@<sha>`)

Generators and `seed:check` read source repos from plain checkouts pinned by sha:

```
.cache/checkouts/<repo>@<40-hex sha>/
```

`<repo>` is the exact estate spelling, for example `ww6`, `jstrain2.2` or
`signalpost-swe-bootcamp`. `.cache/` is gitignored, so a fresh clone has no checkouts,
and `seed:check` FAILS for every pack whose checkout is missing. A pack that cannot be
re-verified is never assumed good.

To create a checkout (Git Bash), reading HEAD of the GitHub repo:

```sh
gh repo clone elirc/<repo> .cache/repos/<repo> -- --depth 1 -q
sha=$(git -C .cache/repos/<repo> rev-parse HEAD)
mkdir -p ".cache/checkouts/<repo>@$sha"
git -C .cache/repos/<repo> archive HEAD | tar -x -C ".cache/checkouts/<repo>@$sha"
```

`.cache/tools/mkco.sh` is the same recipe. It is hard-wired to an old agent worktree
path, so copy the commands rather than running it. To reproduce an existing pack, check
out the sha recorded in that pack's `manifest.json` (`source.sha`):

```sh
git -C .cache/repos/<repo> fetch --depth 1 origin <sha>
git -C .cache/repos/<repo> archive <sha> | tar -x -C ".cache/checkouts/<repo>@<sha>"
```

`git archive` writes LF bytes, and recorded blob hashes assume that. Do not copy a
working tree that autocrlf has converted. `seed:check` accepts `--checkouts <dir>`, and
`BOOTQUEST_CHECKOUTS` points every tool at another checkout root.

## 3. Seed CLIs, with real invocations

All of these run from the repo root in the **foreground**: background jobs get
memory-reaped on this laptop. Arguments go after `--`.

### Pack importers (spec §3.1)

```sh
# BootForge: reads Desktop\opusboot2 compiled content/build/*.json (read-only)
npm run seed:import:bootforge
npm run seed:import:bootforge -- --source C:/Users/Owner/Desktop/opusboot2 --out content/packs/bootforge

# csbootcamp: fetches elirc/csbootcamp at the pinned sha into .cache/sources/csbootcamp
npm run seed:import:csbootcamp
npm run seed:import:csbootcamp -- --sha e05b3505f22acbb95ed4531204e08991d29a7da9
```

### The import gate: `seed:validate`

`seed:validate` executes EVERY imported reference solution under BootQuest's own
runners. Failures go to `quarantine.json` / `QUARANTINE.md`. They are never shipped, and
never fixed by weakening a test. Only a clean full run writes the `validation.json`
stamp that the server requires.

```sh
# per course in the foreground (resumable journal under .seed-journal/<source>.jsonl)
npm run seed:validate -- --source bootforge --course js-fundamentals
npm run seed:validate -- --source bootforge --course react-state
# final full run: re-checks from the journal, asserts the counts, writes the stamp
npm run seed:validate -- --source bootforge
npm run seed:validate -- --source csbootcamp
# start over / re-run only failures
npm run seed:validate -- --source bootforge --fresh
npm run seed:validate -- --source bootforge --retry-failed
```

A full BootForge sweep takes about 3 to 5 minutes (2,571 exercises).

### GitHub sync: `seed:sync`

`seed:sync` runs the same job as `POST /api/sync` and `bootquest sync`, directly against
`BOOTQUEST_DB`.

```sh
set BOOTQUEST_DB=C:\Users\Owner\bootquest\bootquest.db
npm run seed:sync
npm run seed:sync -- --repo elirc/signalpost-swe-bootcamp --queue 50
npm run seed:sync -- --offline          # cache only (BOOTQUEST_OFFLINE=1)
```

Environment variables:

- `BOOTQUEST_CURRICULUM` (default `curriculum.yaml`)
- `BOOTQUEST_CHECK_SPECS` (default `content/sync/check-specs.json`)
- `BOOTQUEST_GITHUB_CACHE` (default `.cache/github`)

### Campaign map: `seed:campaign`

```sh
npm run seed:campaign                    # reads Desktop\upskillorder, writes content/campaign/
npm run seed:campaign -- --check         # exit 1 unless the committed files are byte-identical
```

### Quest content: `seed:quests` and `seed:quests:drafts`

```sh
# generator only: Goal/**Check** exercises -> quizzes, findings -> flashcards, sections -> reading steps
npm run seed:quests -- .cache/checkouts/ww6@09751ceaee909a30e5c4b5ff5cdde99880b9a3e5 --sha 09751ceaee909a30e5c4b5ff5cdde99880b9a3e5 --guides astraupskill/05-PRACTICE.md,astraupskill/06-SOLUTIONS-AND-REVIEW.md --exclude-dir astraupskill/snapshots

# generator + hand-authored items from a committed draft (the W5c-js path)
npm run seed:quests:drafts -- .cache/checkouts/grok-js@ea6e57ea26e7703846ddee5889e27ad77435cb3a --draft content/seed-drafts/quests/grok-js.json
```

Other options:

- `--repo <name>`: needed when the checkout dir name is not `<repo>@<sha>`.
- `--out <dir>`
- `--exclude-dir a,b`
- `--allow-quarantine`: stamp even when some candidates were quarantined. Exit 0 means
  stamped with nothing quarantined.

Validator: every cited `path/file:line` resolves at the pinned sha (root-relative,
md-relative, or an unambiguous suffix; line within the file length). Quizzes are
single-keyed. Excluded files are dropped and counted.

### Explain-back sets: `seed:explainback`

Each set is 3 questions with 5 to 8 key points each, and every key point quotes the
unit source (a whitespace-normalized substring of at least 12 chars) or cites a
resolvable `file:line`.

```sh
# LLM-authored draft (the normal path)
npm run seed:explainback -- astraupskill/02-CONCEPTS.md --checkout .cache/checkouts/borrowbox@60bc18022e664bc96683b1e25a8c98bcc2f00db6 --sha 60bc18022e664bc96683b1e25a8c98bcc2f00db6 --draft tools/seed/authoring/explainback/borrowbox.json

# deterministic scaffold (first three H2 sections, verbatim sentences)
npm run seed:explainback -- docs/learning/testing-rationale.md --checkout .cache/checkouts/ww6@09751ceaee909a30e5c4b5ff5cdde99880b9a3e5 --sha 09751ceaee909a30e5c4b5ff5cdde99880b9a3e5
```

The G2 delegation-brief rubrics are explain-back packs too: the drafts are in
`tools/seed/authoring/g2/` and the output in `content/seed/explainback/g2-brief--<repo>/`.
See `docs/recon/w5c-content.md` for the `[wN]` weight convention.

### Changed-example retests: `seed:variants`

A draft holds `{unit, provenance, items[{id, task, check, referenceSolution,
deliberatelyWrongSolution, wrongBecause}]}`. `unit` is the **unit key** of the artifact
the retest re-checks, for example `gh:elirc/signalpost-swe-bootcamp:U01`. The
**wrong-solution filter** is mandatory: the test must PASS the reference and FAIL the
deliberately wrong solution, both executed by the real runner. Otherwise the item is
discarded.

```sh
npm run seed:variants -- tools/seed/authoring/variants/signalpost-swe-bootcamp-u01.json --checkout .cache/checkouts/signalpost-swe-bootcamp@ff8446042a16d0aaef1687b34932b4f9137e6e0d
```

Output: `content/seed/variants/<unit-slug>/` (the example writes
`content/seed/variants/gh-elirc-signalpost-swe-bootcamp-U01/`: U01's delayed transfer,
"return the first title longer than a supplied length", with a `>=` deliberately wrong
solution). Its explain-back partner is
`tools/seed/authoring/explainback/signalpost-swe-bootcamp-u01.json`:

```sh
npm run seed:explainback -- docs/curriculum/U01.md --checkout .cache/checkouts/signalpost-swe-bootcamp@ff8446042a16d0aaef1687b34932b4f9137e6e0d --sha ff8446042a16d0aaef1687b34932b4f9137e6e0d --draft tools/seed/authoring/explainback/signalpost-swe-bootcamp-u01.json
```

Together with the synced U01 program unit they form the first complete real
artifact -> explain-back -> retest chain (proven end to end by
`server/test/api/ladder-real.test.ts`).

The variants wave-2 drafts extend the coverage: `signalpost-swe-bootcamp-u02.json`
(U02's delayed transfer, a search whose deliberately wrong loop stops at
`length - 1` and so fails only at the last item) and `signalpost-swe-bootcamp-u03.json`
(U03's book-request boundary; the wrong solution narrows `pages` with `typeof`
only, accepting `0`/`1.5`/`NaN`) run with `--checkout` as above, each paired with
an explain-back draft in `tools/seed/authoring/explainback/`. `agentic-g4.json`
(unit `agentic/g4-verification-engineering`: a changed task, NOT the G4 filter —
`splitRunEvidence(outcome)` classifies one run of a wrong solution into
`{ evidence, named, infrastructure }`; the changed planted-bad case is a run whose
only failures are parenthesized infrastructure names, and the deliberately wrong
classifier counts those as test-owned. Its reference solution deliberately solves a
different function, so revealing the retest never hands over G4's hidden
`wrongSolutionFilter`) and `http-tasks-api.json` (unit `fixture:http-tasks-api`, a
drill-js substitution — see the backlog) cite `selfboot` files and run WITHOUT
`--checkout`: the pin is recorded as caller-asserted, which `seed:check` accepts
for the variants generator (it re-executes the filter instead).

### Patch katas: `seed:patches`

```sh
npm run seed:patches -- tools/seed/authoring/katas/ww16.draft.json --checkout .cache/checkouts/ww16@f6497849f7c36139753105d0c5d04cbb5371b1fa --sha f6497849f7c36139753105d0c5d04cbb5371b1fa --out content/seed/patches/ww16-katas
```

Validator:

- the defect key is non-empty;
- every evidence `file:line` resolves, either in the repo at the pinned sha or in the
  patched context;
- the diff applies cleanly (`git apply --check` in a temp dir);
- where a test exists, it passes on the context and FAILS on the defective version
  (real runner).

### Re-verify everything: `seed:check`

```sh
npm run seed:check
npm run seed:check -- --checkouts D:/elsewhere/checkouts
npm run seed:check -- --restamp     # see section 6
```

`seed:check` re-verifies every pack under `content/seed/<generator>/<name>/`:

- structure and loaded === built counts;
- the stamp, bound to the current fingerprint;
- the source pin (blob hashes);
- every shipped item, re-run through its validator, must come back `accept` and
  byte-identical (variants and patches are re-executed);
- every review-queue item must still be held.

It exits 0 only when every pack passes.

### Planted-bad proof: `seed:demo:planted`

```sh
npm run seed:demo:planted
```

This runs every generator's real CLI against planted-bad inputs: wrong solution passes,
diff does not apply, excluded repo, unregistered secret, and others. Each must exit
nonzero for the right reason, and positive controls must exit 0. It proves the
validators are not vacuous.

### Authoring helpers (`tools/seed/authoring/`, not fingerprinted)

These only prepare drafts. The factory validators are still the only judge.

```sh
# kata SPEC -> seed:patches DRAFT (machine-generated unified diff, line numbers by substring search)
node tools/seed/authoring/katagen.mjs tools/seed/authoring/katas/ww16.spec.json tools/seed/authoring/katas/ww16.draft.json
# rebuild every kata pack from its committed spec (katagen -> seed:patches)
node tools/seed/authoring/katas-build.mjs
node tools/seed/authoring/katas-build.mjs ww16.spec.json
# content/seed/patches/katas-index.json (difficulty lives in the spec)
node tools/seed/authoring/kata-index.mjs
# proof printer: clean git apply + test on clean vs defective, per kata
node --import tsx tools/seed/authoring/kata-proof.ts content/seed/patches
# seed:quests generator + hand-authored quizzes (C# quest packs); stored choice order is hash-seeded from
# the item key (the draft's `answer` index only names WHICH choice is keyed). --checkouts <dir> (or
# BOOTQUEST_CHECKOUTS) reads <dir>/<repo>@<sha> instead of the draft's own `checkout` path
node --import tsx tools/seed/authoring/quests-authored.ts tools/seed/authoring/quests/borrowbox.authored.json
```

## 4. Exclusion and redaction registry (`tools/seed/exclusions.json`)

Every generator consults this registry and reports each skip. Nothing is dropped
silently. It has four parts.

**`entries`**: repos or paths that are never ingested, each with an `id`, a `repo` (exact
case), optional `paths` (`dir/` prefix or `*`/`**` globs), a `reason` and a `note`:

- `leaked-secret`: `andie` `**/VERIFICATION.md` contains a **leaked Shopify token**. It
  is never ingested unredacted. **The owner still owes revoking that token.**
- `expiring-tests`: `z8`, whose tests fail by design after 2026-12-31. The entry stays
  active until a human sets `until.clearedBy`. The clock never clears it, because seed
  output must be deterministic.
- `stale-anchors`: Skillforge1, skillforgejs, tagalog `apps/web/` and `apps/mobile/`,
  ww45 and organized-experiment-ww45 `docs2/` and `docs3/`, AnkiJS1, vg, vgdemo, perch,
  aaa1.

**`citationWhitelist`**: paths that guides cite but that legitimately do not exist at the
sha, such as runtime files like `dev.db` (`repo: "*"`). A whitelisted citation is
recorded as such, never silently "ok".

**`secretPatterns`**: the secret scanner. It looks for Shopify, GitHub, AWS,
private-key, Slack, Stripe-live, Anthropic and OpenAI key shapes. Every source file and
every draft a generator reads is scanned. A match in a file that is not registered here
is a hard refusal (`UNREGISTERED SECRET`). Redact and revoke at the source, or register
the file with reason `leaked-secret`.

**Adding an entry:** append an object to `entries` with a unique `id`, the exact-case
`repo`, `paths` if it is narrower than the whole repo, a `reason` from
`stale-anchors | expiring-tests | leaked-secret`, and a `note` that says where the
evidence is. The registry is part of every seed fingerprint, so editing it makes every
stamp stale: run `npm run seed:check -- --restamp`, then `npm run seed:check`.

Mirrors are never edited. Guide errors found while seeding go into the owner's to-do
list (see Backlog), not into the repo.

## 5. Review-queue policy

Each pack has a `review-queue.json` for items a generator could not vouch for. Examples
are inherited-ambiguous continuation citations, cross-block bindings and resolver
warnings.

- **Held is not a pass.** Review items are not shipped, are not in `items.json` and are
  not counted as loaded.
- **Never auto-promoted.** If a held item later validates clean, `seed:check` FAILS the
  pack ("held for review but now validates clean"), so the hold is re-decided rather than
  silently released.
- **A human clears an item by re-seeding.** Fix the source or the draft (for example,
  give the citation an explicit file), re-run the generator, and let the validator decide
  again. Never move an entry from `review-queue.json` into `items.json` by hand. The stamp
  binds both files, and the server refuses edited packs.
- The validators prove that citations **resolve**, not that they **support** the claim.
  Human spot-checks of shipped items stay mandatory: at least 10% per batch.

## 6. Stamps and fingerprints

- **Code packs** (`content/packs/<source>/validation.json`) are bound to a **grader
  fingerprint** per grader kind: `js` covers grade-core, the JS adapter,
  `server/src/api/runners.ts`, the validator, node and esbuild; `csharp` covers the C#
  runner sources, the Check harness, the drill-cs adapter, the validator and the .NET
  SDK and reference versions. If you edit any of those, or upgrade node, esbuild or
  .NET, the server refuses to start with that pack until a fresh full `seed:validate`
  re-stamps it.
- **Seed packs** (`content/seed/**/validation.json`) are bound to a **seed fingerprint**
  per generator. It covers `shared/src/seed-pack.ts`, the exclusion registry, the
  citation resolver, the shared factory files, the generator's own sources and, for
  `variants` and `patches`, the JS grader and its toolchain. Editing a validator changes
  what "validated" means, so every stamp it produced becomes stale.
- **Restamp** (`npm run seed:check -- --restamp`) handles packs whose ONLY problem is a
  stale fingerprint or toolchain. It re-validates every shipped item under the current
  validators: each must come back `accept` and byte-identical, pins must hold, and review
  items must still be held. Only then does it rewrite `validation.json`. Any other
  problem means no restamp and a FAIL. Then run plain `npm run seed:check` and commit the
  stamps.
- The **campaign** has a light stamp: `content/campaign/manifest.json` carries the seeder
  fingerprint and the file hashes. `npm run seed:campaign -- --check` re-verifies them
  against Desktop\upskillorder.
- **At startup the server** refuses an unstamped or edited pack, a stale code-pack stamp,
  a campaign whose seeder fingerprint does not match, and any loaded !== built. It prints
  one summary line per pack, campaign and seed source with its counts, plus a
  ladder-units line.

## 7. How seed content becomes playable (ladder wiring)

At startup the server loader turns seed items into units. There is no separate import
step.

- **Explain-back units**: one per explain-back seed item. This includes the 6 G2
  delegation-brief rubrics, which live on the agentic track. An explain-back unit links
  to its repo's campaign quest when one exists.
- **Patch-kata units**: one per kata, all on the agentic track. Together they form the G1
  "Kata bank".
- **Retest units**: from `content/seed/variants/*` packs. Each is a variation of the
  artifact unit named by the variant's `unitKey`. It stays **pending** until that unit
  exists, for example until `bootquest sync` has registered signalpost U01. Authored
  units (G3/G4) load AFTER retests in the same pass, so a retest of an authored unit
  (the G4 variant) is pending on a DB's FIRST boot by design and goes live on the next
  ladder load — a sync re-link or a restart. A retest of a test fixture unit
  (`fixture:http-tasks-api`) only ever goes live where that fixture is inserted
  (`smoke-api.mjs` pre-seeds it, so the smoke boots with that retest live).
- **Two live units may not reference the same question-set or kata key.** A duplicate
  refuses startup, because answer-before-key is enforced per item.
- **G3 "live delegation"** (a repo-task with branch, CI and PR-section predicates) and
  **G4 "verification engineering"** (a guided project: rebuild the wrong-solution filter;
  the gate is that it rejects a planted bad task) are authored unit definitions in
  `content/units/agentic.json`. They sit on the agentic track at mid tier; the target
  level is documented in that file.

## 8. Backlog

### Deferred owner decisions

- **Quiz oracle (G6):** quiz answers can still be found by repeated *recorded* submits.
  Failed submits are free but recorded, as the spec says. Options are a cooldown or
  choice shuffling. Accepted for V1.
- **Demotion cap:** every lapse of a Review-state FSRS card demotes its competency by one
  notch, as the spec literally says. Should demotions be capped at one per competency per
  day?
- **Retake policy:** explain-back and kata answers are one-shot per item (answer-first:
  the key is seen afterwards). After a demotion or a promotion, an item cannot anchor leg
  (b) again. Options are several question sets per project unit or rotating sets per
  window.
- **Node upgrade:** node 22.16 → ≥22.18. Stryker 10 / Babel 8 warns with EBADENGINE but
  runs. Upgrading invalidates every grader and seed fingerprint, so plan a full
  re-validate and restamp afterwards.
- **Fine-grained read-only PAT:** sync currently uses `gh auth token`. Create the PAT the
  spec calls for and set `BOOTQUEST_GITHUB_TOKEN`.
- **Revoke the old Shopify token** leaked in `andie` VERIFICATION.md.
- **Upstream guide errors** (fix in the source repos; mirrors are never edited):
  - borrowbox `02-CONCEPTS.md:50` says `lock(_gate)`, but the code is `lock(item)`;
  - csharp-tut `10-linq.md:231`: the comment says "2 4", the actual output is "24";
  - dotnet-snapshot snapshot-12 `queryDtos.ts:17`: the NaN page case is not in NOTES.

### Factory backlog

Fixed in W7 (cheap ones): command names (`npm.cmd` ...), `System.*` namespaces and bare
`Program.cs` prose no longer parse as citations; the quest parser reads `- Goal:` /
`- **Check:**` bullets; colliding reading-step basenames are keyed on the full path;
per-repo `citationWhitelist` (recorded visibly as `whitelisted`, never counted as
resolved); quiz variety `concept` and flashcard shape `hand-authored`;
`seed:check --restamp`. Still open, one line each (issue, where, why deferred):

- **Choice quizzes can be re-keyed undetected:** `singleKeyedProblems` in `tools/seed/src/factory/quests/validate.ts` never checks that the keyed choice's evidence includes the goal's own key. Deferred: the authored W5c quizzes use different evidence, so a new rule needs a per-variety audit of every shipped quiz first.
- **No drill-cs runner in the seed harness:** `tools/seed/src/factory/harness/harness.ts` registers drill-js only, so C# katas and variants cannot carry tests. Deferred: needs the warm C# runner at seed time, a fingerprint change and a C# sweep.
- **The http-lab retest is a drill-js substitution:** `SeedRunnableCheck` is drill-js|drill-cs only, so `fixture:http-tasks-api`'s variant (`tools/seed/authoring/variants/http-tasks-api.json`) drills the create-endpoint contract as a pure `handleCreateTask(store, rawBody)` function — a retest cannot boot and probe the learner's HTTP server. Deferred: a true http variant needs a seed-time http harness (learner-server lifecycle) and a schema change.
- **Revealing a retest does not touch its artifact:** `revealUnit` (`server/src/api/service.ts`) checks only `assertTrackOpen`, and `revealedInVariationChain` (`server/src/engines/attempts.ts`) walks only UP the `variation_of` chain, so revealing a CHILD retest never taints its artifact unit. Content keeps it harmless today (every variant's reference solution solves a different function from its artifact's), but the engine should either apply `assertRetestGate` to retest units in `revealUnit` or propagate a retest reveal to its artifact. Deferred: server rule change outside the variants content branch; needs a decision on which semantics and an XP-ledger test. **RESOLVED (campaign 2 HONESTY):** `revealUnit` now applies `assertRetestGate` to a retest that is not yet revealed: before its gate opens a reveal refuses (409 `NOT_DUE` / `RETEST_NOT_OPEN`) and writes nothing, so a closed retest's reference can never be pre-read; once open, the reveal is guided practice and the retest can no longer be a leg (test: `server/test/api/ladder.test.ts` "reveal on a CLOSED retest").
- **U03's compile leg is not retested:** the U03 variant is runtime-meaningful on purpose — the drill-js `ts` language type-strips via esbuild and never type-checks. A compile-leg variant wants the composite repo-pinned tsc check (the node-test-file `tscProject` design in the OPS recon), which the variants harness does not run. Deferred with the drill-cs harness item.
- **`PatchesDraft` has no `difficulty` field:** `tools/seed/src/factory/patches/run.ts`; difficulty lives only in `content/seed/patches/katas-index.json` (the server reads it for display). Deferred: changes the shipped kata schema; every kata pack would be re-seeded.
- **Guides under `snapshots/` are refused as quest sources:** `discoverGuides` in `tools/seed/src/factory/quests/generate.ts`. Deferred: snapshot trees duplicate paths; needs a dedup and key policy decision.
- **Near-duplicate check ignores token order:** `nearDuplicate` in `tools/seed/src/factory/util.ts`. Deferred: tightening it changes validation of shipped items.
- **Explain-back keys can collide:** the key is `(repo, unit, origin)` in `tools/seed/src/factory/explainback/explainback.ts`, so a G2 rubric and an ordinary set on the same unit collide. Deferred: a key change re-keys every shipped explain-back pack and the server's ladder units are keyed by it. Workaround: one unit per rubric.
- **Validators check that citations resolve, not that they support the claim:** all validators. Not solvable deterministically; human spot-checks stay mandatory.
- **App-root suffix resolution for multi-app repos:** `tools/seed/src/citations/resolve.ts` (bare suffixes are ambiguous across `apps/*`). Deferred: resolver semantics change; would re-resolve every shipped citation.
- **Guide discovery misses `docs/upskill`, `docs/lessons`, `upskilling/`, nested `astraupskill/`:** the `GUIDE_ROOTS` regex in `tools/seed/src/factory/quests/generate.ts`. Deferred: widening discovery changes every repo's input set; needs triage + include lists.
- **No real `citationWhitelist` entries yet** (e.g. j1-style Checks naming test files the learner will write): `tools/seed/exclusions.json`. Deferred: an entry only pays off when that repo is regenerated, and each needs a human note.
- **No review-queue approval path:** held items stay unshipped until a re-seed decides them again (section 5). Deferred: needs an approval-workflow decision.
- **Kata `findingRef` is not cross-checked** against the quests flashcard keys. Deferred: needs a cross-pack index.
- **Numbered findings lists include non-defects** ("good design worth naming"). Deferred: curation, not a parser fix.
- ~~**Quest packs are not served yet**~~ — CLOSED in W8: `server/src/store/study-quests.ts` gives every campaign study quest whose repo has a stamped quest pack its `study-quiz` gate (JS 18, C# 8 on the committed map after W5c-act1; `ww6`'s pack matches no quest and is reported). Misses become FSRS cards; `npm run demo:campaign` proves an act unlock.
- ~~**JS act 2 cannot unlock on real content**~~ — CLOSED in W5c-act1: all 15 JS act-1 core quests and all 5 C# act-1 core quests now have stamped packs (drafts in `content/seed-drafts/quests/`, one explain-back set each in `content/seed-drafts/explainback/`). On the committed map, 15/15 JS act-1 passes give 750 XP = level 3 < act 2's `unlockLevel` 4, so the level leg still holds; adding the 5 C# act-1 passes (1000 XP, level 4) unlocks JS act 2 and C# act 2 for real (`npm run demo:campaign` Part A). **Most later-act study quests still have no pack** (JS 128 / C# 40 content-pending): the gap is content, not code.
- **Drafts path labels:** `buildDraftItem` in `tools/seed/src/drafts/quests.ts` still stamps hand quizzes `variety: 'goal-check'` and hand flashcards `shape: 'numbered'` (W7 added `concept` / `hand-authored` but this path does not use them). Deferred: switching re-keys nothing but changes every drafts pack's bytes, so it needs a restamp sweep.
- **Drafts path cannot take `snapshots/` guides:** `runQuestsWithDrafts` checks the pruned `co.index`, so `snapshots/*/NOTES.md` is "not found" (dotnet-snapshot1 used README + LEARNING-JOURNAL as guides; hand items still cite snapshot files). `quests-authored.ts` does not have this limit.
- **Bold/italic Goal shapes still missed:** `**Goal.**`/`**Check.**` (buildsubbox 05-PRACTICE) and `*Goal:*` (groktuts interview-questions.md) are not parsed as exercises; prose `process.env` still parses as a citation.
- **Bare `**Goal**` in prose — FIXED (campaign 2 factory-2):** `GOAL` in `tools/seed/src/factory/quests/parse.ts` now takes a bare `**Goal**` only at the start of a line or list item (or `**Goal:**` / `**Goal.**` / `**Goal**:` anywhere), so intros like "Each has a **Goal** and a **Check** you can observe." are no longer exercises (their orphan `**Check**` is a counted `check-without-goal` skip). master3 `05-PRACTICE.md` and atlas `final-system-design.md` / `002-audit-log-viewer.md` are generator guides again. A bare mid-line marker after a lead-in (`Exercise: **Goal** ... **Check** ...`, world `docs/file-explanations/*.explanation.md`) is NOT read; no shipped pack uses that shape. The CHECK marker is unchanged (a bare mid-line `**Check**` still splits a Goal paragraph).
- **Answer-key position — FIXED (campaign 2 factory-2):** generator and drafts-path quizzes were already hash-ordered; `tools/seed/authoring/quests-authored.ts` stored the authored order (csharp-interview / csharp-tut / dotnet-snapshot keyed 100% at choice 0). It now hash-orders like the other two paths, and `seed:lint:answers` gates in the tools/seed suite (`answer-positions.test.ts` "GATE").
- **Continuation-line Goal/Check bled into the next list item — FIXED (campaign 2 factory-2 fix pass):** in the shape `N. **Title.**` / `   *Goal:* ...` / `   *Check:* ...` (atlas `final-system-design.md`, `002-audit-log-viewer.md`) every Check but the last absorbed the NEXT item's title ("... the export returns 200. 3. **Pass the actor through.**"), because only a Goal ON the list-item line ended at a sibling item. `extractGoalChecks` now finds the enclosing list item of an indented Goal line and ends the exercise at a sibling (indent <= the enclosing item's). Regenerating all 107 packs before/after the fix changes only `organized-study-atlas-fulfillment` (9 goal-checks, 0 choices carrying a list-item title, was 29); master3 is byte-identical.
- **Answer-LENGTH bias in generator goal-check quizzes — aggregate none, 9 single-item tells (FIXED in the release wave, factory-3; history below):** the keyed Check is the strictly longest choice in 29 of 105 shipped generator goal-checks (prompt "Which check verifies this goal?") against 30.7 expected by chance, because distractors are other exercises' Checks from the same guide. But the aggregate hides individual tells: 9 items have a key longer than 1.5x the longest distractor — master3 `1dc72083cc6b2bb6` (05-PRACTICE.md:46, 972 vs 577 chars; the Check is TWO concatenated `test(` blocks, the only choice with two, so it is identifiable unread), ww6 `535a75d1e6ee893f` (2.88x), relay-upskilling `170f048de10181c2` (2.84x), react `3f4c3db1876cd28f` (2.60x), organized-study-atlas-fulfillment `094ea5e66ea7630f` (2.49x) and `d8ab4a4175f7d385` (1.50x), recipeview `c9e0334ad7d33ac8` (2.26x), w22 `ed05e327802061a6` (1.54x), devdeck `cb4ba2df947c4b1d` (1.53x). Not fixed in the generator yet: skipping or re-picking distractors re-seeds 8 packs, most of them drafts packs that carry the drafts-path drift below, so it belongs with the drafts rebalance re-seed. Fix then: in `generate.ts` goal-check assembly, prefer length-matched distractors or count a `length-tell` skip when key > 1.5x the longest distractor. (Hand-draft quizzes, which the drafts path also labels `goal-check`, were far more biased — key longest in ~500 of ~540 before rebalancing; see the hand-draft length-bias bullet below for what rebalance-3 covered and what is still open. The react tell above survived the rebalance-3 re-seed of the react pack.)
- **Generator goal-check length tells — FIXED (release wave, factory-3):** `pickGoalCheckDistractors` in `tools/seed/src/factory/quests/generate.ts` keeps the historical hash-order pick whenever the key is at most `LENGTH_TELL_RATIO` (1.5) x its longest distractor, so every non-telling item is byte-identical. When the pick tells, it re-picks the `MAX_DISTRACTORS` other Checks closest in length to the key (log-ratio distance, ties in hash order). If even that set tells, the item is NOT generated and the manifest records a counted `length-tell (key N chars > 1.5x the longest distractor M chars; ...)` skip; it never ships with fewer distractors. Of the 9 tells, 2 were re-picked (devdeck `cb4ba2df947c4b1d` now 496 vs 486 chars; organized-study-atlas-fulfillment `094ea5e66ea7630f` now 1.34x) and 7 are skips: master3 `1dc72083cc6b2bb6`, ww6 `535a75d1e6ee893f`, relay-upskilling `170f048de10181c2`, react `3f4c3db1876cd28f`, organized-study-atlas-fulfillment `d8ab4a4175f7d385`, recipeview `c9e0334ad7d33ac8`, w22 `ed05e327802061a6`. Those 7 keys are gone from their packs; no file outside the packs and this note referenced them. Tests: `quests.test.ts` "goal-check answer-LENGTH tells" (the ww6 fixture now ships 18 quizzes, not 19: its 05-PRACTICE.md:33 item is the counted skip).
- **Generator explanations were parser labels — FIXED (release wave, factory-3; campaign 2 review F5):** goal-check quizzes used the raw label as their explanation (`"1 (inline list item)"` x30, `"- (inline list item)"` x8, `"goal N"` x68), which the learner saw on the review-card back. `goalCheckExplanation` now writes where the guide pairs the Goal with the Check (`In <guide>:<lines> (exercise "<bold title>"), the guide pairs this Goal with this Check; the other choices are the Checks of other exercises in the same guide.`; the title only for a real bold lead label). No hand draft or authored file carries such an explanation, so `EXPLANATION_LINT_EXEMPT` in `tools/seed/src/ops/explanation-lint.ts` is empty. `seed:lint:answers` now also runs that lint (`/^\d+ \(.*item\)$/`, `/^- \(.*item\)$/`, `/^goal \d+$/i` over every shipped quest quiz): it fails on a non-exempt pack AND on a stale exemption, and `explanation-lint.test.ts` "GATE" makes it part of the tools/seed suite. Finding-location explanations (`F3 (Medium)`, a finding id from the guide) are unchanged.
- **Re-seed record (factory-3):** before/after regeneration of ALL 107 quest packs (100 drafts, 6 authored, ww6 generator; old code first reproduced every shipped pack byte for byte) changed exactly 19 packs and nothing else: 108 goal-check explanations (only that field), the 2 re-picked items (choices, key, explanation) and the 7 removed items plus their skips. Re-seeded with their own commands: buildsubbox, csbootcamp (authored), devdeck, master3, nethris, netpastebin, organized-experiment-support-hub, organized-experiment-ww45, organized-study-atlas-fulfillment, organized-study-support-desk-crm, react, recipegen-app, recipeview, relay-upskilling, w22, ww35, ww4, ww6 (generator), zz1; the other 88 quest packs were restamped (`seed:check -- --restamp`).
- **Unreported churn in the factory-2 re-seed (8807c81), recorded here:** besides choice order, `dotnet-snapshot` had all 42 reading-step items re-keyed and reordered (content identical; the W7 `readingStepKeyBases` change had never been applied to that pack), and `borrowbox` and `csbootcamp` each lost one reading-step's ambiguous path-only `Program.cs` citation (W7 citation resolution). Reading-step keys are not persisted anywhere: the server builds `readingSteps` in memory from the pack (`server/src/store/seed-items.ts`, served by `server/src/api/study-service.ts`), the client uses them only as React list keys, and no migration's table (`review_item.card_key`, `evidence`, `attempt`, ...) stores them; no file outside each pack's own `items.json` / `review-queue.json` / `validation.json` references a shipped reading-step key (the one hit elsewhere, `w7-fixes.test.ts`, is a synthetic `j1/.../0123456789abcdef`).
- **Hand-draft answer-LENGTH bias, rebalance-2 slice — FIXED (campaign 2 final wave):** 15 drafts (jobtrack, js1, jsdrillv2, jsprojectlearn, jstrain2.2, master, masterrnative, mobiletagalog, nettodo, newcodexjs, organized-app-job-track, organized-build-gum, organized-build-subbox, organized-dotnet-pastebin, organized-dotnet-trello; 178 quizzes) had the key as the strictly longest choice in 83-100% of quizzes. Keys were trimmed to their claim (justification moved to the explanation) and distractors made equally specific; now 15-33% longest per draft, median key/longest-distractor ratio 0.96-1.00. `quiz-balance.test.ts` guards them and adds a median-ratio bound (0.8-1.2) for every guarded draft. `organized-app-job-track`'s guide list now names `ARCHITECTURE_DEEP_DIVE.md` instead of two `.js` route files (closing that half of the drafts-path drift note below); it ships 10 real reading steps instead of two `(untitled guide)` ones and is stamped with `--allow-quarantine` because one step cites `/src/main.jsx` (an `index.html` script URL, not a repo path). Item fix: `organized-dotnet-pastebin` q05 said the slug alphabet has 58 characters; it has 57. Fix pass after review: `organized-dotnet-pastebin` q10 claimed that without the endpoint's 2-char guard a 1-char search would scan every public paste, but `SearchPublicAsync` repeats the check (`PasteStore.cs:158-162`) and returns `[]`; the key now says so and cites it. q06's example slugs used the digit 1, which `RandomToken` never emits. `organized-build-gum` q08 said an unknown status badge matches no CSS rule; the generic `.pill` rule still applies, so only the status colour is lost. `tools/seed/src/drafts/item-corrections.test.ts` pins all three against the drafts and the pinned source.
- **Drafts-path drift (pre-existing, found by factory-2):** re-running `seed:quests:drafts` on today's code changes the bytes of most hand packs (hand quizzes now `variety: 'concept'`, flashcards `shape: 'hand-authored'`; some citation/reading-step re-keys). One draft no longer runs at all: `grokjs-grokbuildjs` lists a non-markdown guide (`backend/src/routes/tasks.ts`), which the drafts path now refuses. Its shipped pack still passes `seed:check` (it re-validates stored items, it does not regenerate). Fix that guide list when the pack is next re-seeded. (`organized-app-job-track` had the same problem and was fixed and re-seeded in rebalance-2; see the entry above.)
- **Hand-draft quiz length bias — 25 drafts rebalanced and guarded, the rest OPEN (campaign 2 rebalance-3, 3b9fc24 + fix pass):** rebalance-3 rewrote the 162 hand quizzes in 14 drafts (organized-js-training-jsdrill_sync_20260223_125137, -jstrain2, -jstrain2.2, -jstrain2.3, -jstrain3, -react, -trainjs, react, recipegen-app, recipeweb, relay-app, ship-it, trainjs, unionboot) and re-seeded those 14 packs with `seed:quests:drafts`, so they now carry the drafts-path drift below (hand quizzes `variety: 'concept'`, flashcards `shape: 'hand-authored'`). `tools/seed/src/drafts/quiz-balance.test.ts` guards 25 drafts: key strictly longest <= 35%, strictly shortest <= 40%, median answer/longest-distractor ratio in [0.8, 1.2], every answer slot keyed, and (fix pass) no single key-length rank (1 + distractors strictly longer than the key) in more than 50% of a draft's quizzes, after the first pass left the key second-longest in 7/12 of react and jsdrill_sync. The fix pass also corrected two wrong items: trainjs `q03-reduce-initial-value` (deleting the `0` from a reduce over product objects breaks every non-empty cart, so a distractor was true; now the price chain, where only the empty case throws) and recipeweb `q02-string-is-iterable` (the key now asks what the guide's bare spread gives; the real code would throw at `.filter`). STILL OPEN: the 75 unguarded hand drafts key the strictly longest choice in 503 of 929 quizzes (measured at the fix pass); and the react generator goal-check length tell `3f4c3db1876cd28f` (2.60x, see the generator bullet above) is still in the re-seeded react pack, because the hand-draft rebalance does not touch generator items.
- **quiz-balance covers EVERY draft (release wave, factory-3; campaign 2 review F1/F2):** `tools/seed/src/drafts/quiz-balance.test.ts` no longer has a `GUARDED` allow-list: every draft in `content/seed-drafts/quests` with quizzes (100) runs all six guards (`longest` <= 35%, `shortest` <= 40% (F2), `median-ratio` in [0.8, 1.2], `rank` <= 50%, `format` strategies <= 0.35, `slots`: every answer slot keyed in the stamped pack). `GUARDED`, `RANK_UNGUARDED` and `FORMAT_UNGUARDED` are replaced by ONE `EXEMPT` map (draft -> the guards it fails today), grouped by the release-wave content agent that owns each draft. An exempt guard that passes fails the suite (the map only shrinks); a non-exempt guard that fails fails the suite. At introduction: 81 drafts exempt on 120 guards (format 69, rank 21, longest 13, median-ratio 12, slots 4, shortest 1); three are in no agent's assignment and sit in the `UNASSIGNED` group: dotnet-ramp, master4, organized-app-job-track (all `format`).
