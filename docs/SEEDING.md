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
# seed:quests generator + hand-authored quizzes (C# quest packs)
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
  exists, for example until `bootquest sync` has registered signalpost U01.
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
- **Quest packs are not served yet:** the 17 `content/seed/quests/*` packs pass `seed:check`, but no server loader turns their quizzes into the campaign quiz gates, so every study quest is still content-pending and acts 2+ cannot unlock. Deferred past W7 (structural: quest-gate loader + campaign engine change).
