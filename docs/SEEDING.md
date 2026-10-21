# Seeding BootQuest content

BootQuest never calls an LLM at runtime. All authored content (quizzes, flashcards,
reading steps, explain-back question sets, changed-example retests, patch katas, learn-more notes) is
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

A checkout is always made from a **mirror**, `.cache/repos/<repo>` (a `--depth 1`
clone that holds the pinned sha; an importer's `.cache/sources/<repo>` counts too):

```sh
# Git Bash, from the app repo: mirror + the pinned sha, then the checkout
gh repo clone elirc/<repo> .cache/repos/<repo> -- --depth 1 -q
git -C .cache/repos/<repo> fetch --depth 1 origin <sha>      # when the sha is not HEAD
npm run seed:checkout -- --repo <repo> --sha <40-hex sha>    # or add --fetch to do both steps above
```

`seed:checkout` writes every blob byte-for-byte from `git cat-file` into a fresh temp
dir that is then renamed into place. **Never use `git archive | tar` (or a working
tree) for a checkout:** this machine's SYSTEM gitconfig sets `core.autocrlf=true`,
`git archive` honours it, and every LF file comes out CRLF. The old recipe (and
`.cache/tools/mkco.sh`) did exactly that, so packs recorded blob ids git never had.
Extracting over an existing dir also left deleted files behind; the temp + rename
makes that impossible.

**The rule is byte identity with git's blob, not "no CR".** About 30 pinned repos
commit CRLF files on purpose (j1/j2 guides, nopCommerce, eShop, ...): those keep their
CRs; every other file has none.

**What enforces it.** `openCheckout` looks for the mirror next to
`<cache>/checkouts/<repo>@<sha>` (or in `BOOTQUEST_REPOS`). With a mirror it opens the
dir as pin `git-tree` only if the file set and every byte size equal
`git ls-tree -r -l <sha>` (a wrong sha, a stale file or CRLF-converted bytes are
refused), and every file a generator reads or cites must hash to git's blob id, so a
pack can no longer record an id git does not have. A mirror that lacks the sha is
refused (fetch it). A `.git/HEAD` earns pin `git-head` only when the dir is the top of
a real repo whose tree git lists; a bare HEAD file is treated as a plain dir. With no
mirror at all the dir stays `caller-asserted` (test fixtures), and **no writer stamps a
pack that pins blobs that way** (fixtures and the planted demo set
`BOOTQUEST_SEED_ALLOW_UNVERIFIED_PIN=1`); `seed:check` FAILS a pack recorded `git-tree` /
`git-head` whose checkout now opens `caller-asserted` (a lost mirror is never a silent
downgrade). `npm run seed:pins` (read-only) checks every manifest's `blobs` against
the mirror: OK / MISMATCH (per file) / UNCHECKABLE (no mirror); exit 1 on any
mismatch AND on any UNCHECKABLE (strict by default; `--no-strict` only reports it). A
pack that pins 0 blobs is OK by definition (nothing to verify). `seed:check` accepts `--checkouts <dir>`,
and `BOOTQUEST_CHECKOUTS` points every tool at another checkout root. `--exclusions <file>`
is for dry exploration only: a registry that is not the committed `tools/seed/exclusions.json`
(which every stamp's fingerprint binds) never gets a pack stamped, and `seed:check` under it
fails every pack.

**Java checkouts.** The 12 Java study-quest repos (the campaign's `content/campaign/java.json`
names them, e.g. `organized-experiment-quiz-engine`, `j1`, `j7`) use the same
`<repo>@<sha>` layout and recipe; a Java quest pack directory is named exactly after its
repo. The javabootcamp drill source is different: it is not a checkout under
`.cache/checkouts/` but the importer's own cache, `.cache/sources/javabootcamp` (see §3).

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

# javabootcamp: fetches elirc/javabootcamp (private) at the pinned sha into .cache/sources/javabootcamp
npm run seed:import:javabootcamp
npm run seed:import:javabootcamp -- --sha c1e14aa8238bf5b281bd0829b799b0d2b54dab2a
# dev mode: read a local working copy in place (its HEAD and dirtiness go into the manifest)
npm run seed:import:javabootcamp -- --source C:/Users/Owner/Desktop/javabootcamp
```

The javabootcamp importer (`tools/seed/src/javabootcamp/`) reuses the csbootcamp header
grammar and checkout code. Each module `bootcamp/NN-topic/` becomes one course file; each
`exercises/NN-name.java` + `solutions/NN-name.java` pair becomes one `drill-java` unit.
The check spec carries the canonical tests block and the file tail
(`{type: 'drill-java', files: {tests, tail}, className: 'Exercise', timeoutMs}`); grading
is the learner's head + the canonical tests block + the learner's tail. The solution and
its `Walkthrough:` stay in the pack's private content (revealed only through the
solution endpoint). The pin lives in `tools/seed/src/javabootcamp/source.ts`
(`JAVABOOTCAMP_SHA`).

#### sysdrills (the sysdesign track's drill bank)

`sysdrills` has no upstream repo: its source is hand-written JSON committed in this repo,
one file per module, under `tools/seed/authoring/sysdrills/<NN-module>.json`
(format `sysdrills-authoring@1`, Zod-validated `.strict()` by
`tools/seed/src/sysdrills/source.ts`). Each exercise is an estimation / capacity /
reliability-math rep: a pure exported function, `drill-js` tests whose expectations are
exact integers, a `// TODO` starter, a reference solution, an explanation and hints. The
importer maps every exercise to a `drill-js` unit on the **sysdesign** track (competency
`system-design`, key `sysdrills/<module>/<slug>`), one course per module, into
`content/packs/sysdrills/` with manifest `{ track: 'sysdesign', grader: 'js' }`. Migration
016 gives the track a daily slate drill slot (dropped automatically when the bank is
exhausted).

```sh
# authoring JSON -> content/packs/sysdrills/{<module>.json, manifest.json} (refuses on any
# format problem or a census other than SYSDRILLS_EXPECTED; writes nothing then)
npm run seed:import:sysdrills
npm run seed:import:sysdrills -- --authoring tools/seed/authoring/sysdrills --out content/packs/sysdrills
# stamp: every reference solution passes and every starter fails under the REAL drill-js runner
npm run seed:validate -- --source sysdrills
```

Append a module: add `tools/seed/authoring/sysdrills/NN-topic.json` (next free `NN`; slugs
`NN-name`, unique test names, every test touching `mod.`, difficulty 1-3), bump
`SYSDRILLS_EXPECTED` in `tools/seed/src/sysdrills/source.ts`, then re-import, re-validate
(the journal resumes) and commit the authoring file, the pack files and the new
`validation.json` together. A quarantined exercise blocks the stamp at this bank size: fix
the authoring, never the test.

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
npm run seed:validate -- --source javabootcamp
# start over / re-run only failures
npm run seed:validate -- --source bootforge --fresh
npm run seed:validate -- --source bootforge --retry-failed
```

A full BootForge sweep takes about 3 to 5 minutes (2,571 exercises).

#### javabootcamp (`--source javabootcamp`)

Needs JDK 17 (`javac`/`java` on PATH). Each `drill-java` unit is graded twice by the real
Java runner (`tools/seed/src/validate/validate-java.ts`): the reference solution must pass
(passed > 0, failed = 0, todo = 0; one retry for a non-compile failure or a timeout) and the
untouched starter must fail as a test verdict (its `UnsupportedOperationException("TODO")`
stubs count as todo; a compile error, timeout or crash quarantines the unit). Scratch is
`BOOTQUEST_JAVA_SCRATCH`, else `.cache/seed-java`. The verdict is read from BqMain's nonce-checked result file, never from stdout or
the exit code. Grades are serialized (one attempt dir), about 2 to 3 s each, so a full
sweep takes a few minutes (timings: `docs/recon/java-timings.md`). The stamp records
`graderKind: "java"` and the JDK version.

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
- `--force-replace`: three writers target `content/seed/quests/<repo>/` (`seed:quests`,
  `seed:quests:drafts`, `quests-authored.ts`). A writer REFUSES to replace a pack whose manifest
  records a different generator or `draft:*` source (generator-only / a drafts file / an
  `.authored.json` file, and which one), because the plain generator over a drafts-built repo would
  silently drop every hand item. Every generator CLI takes `--force-replace` to discard the old pack
  deliberately.

Hand items (`seed:quests:drafts`) are `concept` quizzes and `hand-authored` flashcards; a draft
that declares another variety / shape is quarantined. Their cites carry no guide line (the
validator asserts `sourceLine = source.lines.start` instead of the parser range rule) and their
distractors no evidence (the multi-keyable rule explicitly does not apply to key-only evidence on a
concept quiz; evidence on some distractors only is refused).

Validator: every cited `path/file:line` resolves at the pinned sha (root-relative,
md-relative, or an unambiguous suffix; line within the file length). Quizzes are
single-keyed. Excluded files are dropped and counted.

### Explain-back sets: `seed:explainback`

Each set is 3 questions with 5 to 8 key points each, and every key point quotes the
unit source (a whitespace-normalized substring of at least 12 chars) or cites a
resolvable `file:line`. A cite is stored at its RESOLVED repo-root path (a guide-relative or
suffix cite as drafted is rewritten; an unresolvable or directory cite is refused), so the path the
client shows exists at the sha. The quote rule still reads the whole unit file, not just
`provenance.lines` (scoping it would reject 18 shipped key points in 9 packs today).

```sh
# LLM-authored draft (the normal path)
npm run seed:explainback -- astraupskill/02-CONCEPTS.md --checkout .cache/checkouts/borrowbox@60bc18022e664bc96683b1e25a8c98bcc2f00db6 --sha 60bc18022e664bc96683b1e25a8c98bcc2f00db6 --draft tools/seed/authoring/explainback/borrowbox.json

# deterministic scaffold (first three H2 sections, verbatim sentences)
npm run seed:explainback -- docs/learning/testing-rationale.md --checkout .cache/checkouts/ww6@09751ceaee909a30e5c4b5ff5cdde99880b9a3e5 --sha 09751ceaee909a30e5c4b5ff5cdde99880b9a3e5
```

The G2 delegation-brief rubrics are explain-back packs too: the drafts are in
`tools/seed/authoring/g2/` and the output in `content/seed/explainback/g2-brief--<repo>/`.
See `docs/recon/w5c-content.md` for the `[wN]` weight convention.

**Alternate sets (retakes).** An alternate set of an existing explain-back pack is a SIBLING
pack: the same unit path and sha as the primary pack's manifest, its own draft, `--set <id>`
(1-8 of `[a-z0-9]`, e.g. `b`; `--set` without `--draft` is refused). The item gets `set: "<id>"`,
its key origin becomes `draft-<id>` (the primary's is `draft`), so it is its own item, unit and
answer-before-key; the default pack name is `<repo>--<unit>--set-<id>`. The server derives the
sibling group from the provenance (repo, path) — nothing is stored — titles the unit
`... (set B)` and spaces FRESH answers within a group >= 2 days apart. Write the draft at
`tools/seed/authoring/explainback/<primary-pack-dir>--set-<id>.json` and pass the primary's
`--allow-no-quests` iff the primary was stamped that way:

```sh
npm run seed:explainback -- apprenticeship/curriculum/14-load-backpressure-timeouts.md \
  --checkout .cache/checkouts/opusorganize@6a6e84522bd58c88ccec72421a15b8dbef797602 \
  --sha 6a6e84522bd58c88ccec72421a15b8dbef797602 \
  --draft tools/seed/authoring/explainback/sysdesign--opusorganize--web-app-at-10x-load--set-b.json \
  --set b \
  --out content/seed/explainback/sysdesign--opusorganize--web-app-at-10x-load--set-b
```

(No `--allow-no-quests` here: opusorganize HAS a quest pack, so the eb-leak guard must run; the
flag belongs only on repos with no quest pack, e.g. the javabootcamp sets.)

The **eb-sibling guard** (factory/guards.ts, in the stamp path and in `seed:check`) fails a pack
whose prompt, or whose key-point text / quote, near-duplicates one of any OTHER set of the same
(repo, path) (`nearDuplicate`, factory/util.ts) whenever at least one of the pair is an alternate
set (two primary sets of one unit, e.g. a draft and the deterministic scaffold, are the older W7
pattern and are not compared). There is no exemption map: rewrite the draft
(fresh scenario numbers, a different angle: steady state vs a failure drill, a migration or a
capacity doubling), never admit. Keep the `DESIGN IT` prompt prefix on design sets so the
sibling routes to the sysdesign track like its primary.

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
`--checkout`: the pin is recorded as caller-asserted with 0 blobs (nothing pinned, so
nothing to verify), which `seed:check` accepts for the variants generator (it re-executes
the filter instead).

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

A kata (or variant) test may be `drill-js`, `drill-cs` or `drill-java`; each executes through
the factory harness (`tools/seed/src/factory/harness/harness.ts`) and the server's real
runner. `drill-java` needs JDK 17 on PATH and works in its own scratch dir
`.cache/factory-java` (`BOOTQUEST_FACTORY_JAVA_SCRATCH`), never seed:validate's. The Java kata
shape (j2-, j7- and organized-experiment-bank-account-simulator-katas): the test module is an
adapted, self-contained `bootquest-kata/*.Testable.java` (package lines and intra-repo imports
dropped, top-level types non-public, bodies verbatim), and `files.tests` holds the whole test
class between the `// ─── tests ───` / `// ─── end tests ───` markers with `className:
"KataTest"` and `tail: ""`, calling `bootcamp.Check.test/eq/raises` fully qualified. The three
specs are generated by `node tools/seed/authoring/java-katas-spec.mjs` (from the repo root, with
the checkouts under `.cache/checkouts/`); each kata's edits patch the verbatim repo file and the
testable module alike, then katagen -> `seed:patches` as usual.

### Learn-more notes: `seed:notes`

The "Learn more" button serves **notes**: authored readings and explanations for one quest pack.
The draft is `content/seed-drafts/notes/<pack>.json` (format `bootquest-notes-draft@1`; `<pack>` is
the dir under `content/seed/quests/`, and `repo`/`sha` must equal that pack's `manifest.json`
`source`). Two phases:

- `before`: a READING, shown before the learner answers (orientation, reading order, a concept in
  plain words, verbatim excerpts). Target `pack`, or one quiz / flashcard / reading-step key.
- `after`: an EXPLANATION of ONE quiz (why the key is right, why each distractor is wrong). The
  server releases it only once the learner has a recorded study-quiz answer that covers it.

```sh
npm run seed:notes -- C:/Users/Owner/Desktop/selfboot/.cache/checkouts/storefront@9d52bffef289c23d3136f868d201ba76b89a314c --draft content/seed-drafts/notes/storefront.json
# options: --quests <quest-packs-root> (default content/seed/quests)  --out <dir> (default content/seed/notes/<pack>)
#          --allow-quarantine (stamp with a rejected OPTIONAL note withheld; coverage must still hold)
```

Validator (every rule, deterministic):

- `id` `^[a-z0-9][a-z0-9-]{2,63}$`, unique; `target` `pack` or an exact item key of the quest pack;
  an `after` note must target a quiz, and exactly one `after` note per quiz;
- title 8-90 chars; body 60-300 words (`after`: 60-250), markdown with no HTML and no images;
- 1-4 excerpts, each a repo-root path at the pinned sha with `lineStart <= lineEnd` inside the file
  and a quote (>= 20 chars) found verbatim in those lines after collapsing whitespace runs, at token
  boundaries (a quote cut mid-word, "MAX = 3" for "MAX = 30", does not match);
- 0-4 `readMore`: the path exists, the optional line range is in range, `why` is 8-200 chars;
- nothing cites, points at or names an excluded file; no secret pattern anywhere in the draft;
- `before` notes may not leak ANY keyed answer of the pack: no normalized token-boundary substring
  of a keyed answer in the title, body, excerpt quotes or readMore `why` (shown before answering);
  token-Jaccard < 0.5 against every
  sentence and every answer-sized window; no excerpt / readMore range overlapping the keyed
  `file:line` of a finding-location quiz;
- coverage (pack level, blocks the stamp): 2-4 accepted `before` notes targeting `pack`, and one
  accepted `after` note per quiz.

The notes manifest binds the quest pack's `items.json` bytes (`quests:<pack>@items-sha256:<hex>`
in `source.inputs`). **Re-seeding a quest pack makes its notes stale**: `seed:check` and the server
refuse the notes pack until `seed:notes` is re-run on the (updated) draft. So re-seed quests first,
then notes. `seed:check` re-validates every note (quotes, ranges, leaks, coverage, the binding),
and `restamp:all` includes notes packs like every other seed pack.

**The leak rule the validator cannot check (human review, required for every new reading).** The
mechanical check only sees wording that matches a key. A reading can still give a quiz away by
stating, in other words, the specific fact that decides it ("the parser reads only the first value",
"the guard runs before the body is parsed"). In the 2026-10-15 wave a fresh audit found this in 18%
of sampled readings, and the cross-author leak pass then rewrote 231 of the 394. A `before`
reading MAY orient, name files and functions, explain a general concept, and say what to look for
("list which keys validatePayload inspects"). It MUST NOT state the outcome a quiz in the same pack
asks about: a status code, which value wins, whether something is checked or rolled back, the order
two steps run in, an edge-case return value. An excerpt that quotes the deciding line is a leak too.
Test each reading against every quiz in its pack: could someone who read only the readings pick the
key? Have someone other than the author do this pass.

**Explanations are released late on purpose.** The server releases an `after` note only after a
graded study-quiz submit covering that quiz AND (the gate passed, or that question was answered right,
or its missed-question review card is due or reviewed). Releasing on any recorded answer would hand
over the keys after a failed attempt, right before a retry.

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
- every review-queue item must still be held;
- the **pack-level guards** (`tools/seed/src/factory/guards.ts`), which every generator also
  runs before it stamps (a failure is printed as `STAMP none: guard ...`):
  - quest packs: **blind-pass** (no blind strategy clears the 80% gate with p > 0.02),
    **quiz-balance** over ALL the pack's quizzes (longest / shortest / median-ratio / rank /
    format / slots; packs with >= 10 quizzes; `QUIZ_BALANCE_EXEMPT` grandfathers failures, may only
    shrink, and is empty since the 2026-10-19 content pass) and **explanation-lint** (no generator-label explanation);
  - explain-back packs: no key point (text or quote) restates a keyed answer of a quest pack of
    the same source repo (the notes token rules, token-Jaccard >= 0.5; `EB_LEAK_EXEMPT` grandfathers
    leaks, may only shrink, and is empty since the 2026-10-19 content pass; `npm run seed:lint:leaks` lists every leak);
  - every pack: a **secret scan** of every shipped string with the registry's `secretPatterns`.

It exits 0 only when every pack passes. A guard failure is a `PROBLEM guard ...` line, and
`--restamp` never restamps a pack with one.

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
# BOOTQUEST_CHECKOUTS) reads <dir>/<repo>@<sha> instead of the draft's own `checkout` path. The draft
# is Zod-validated (strict) and secret-scanned first; per-choice `evidence` is all-or-none;
# --force-replace overwrites a pack another writer built
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
  SDK and reference versions; `java` covers the `drill-java` check type's grader: the Java
  runner and split rules (`server/src/runners/java/`), the process helpers it imports from
  the C# scratch module, the javabootcamp harness it compiles (`Check.java`, `BqMain.java`),
  the drill-java adapter (`server/src/api/runner-java.ts`), the Java validator, node and the
  JDK (`javac -version`). If you edit any of those, or upgrade node, esbuild, .NET or the
  JDK, the server refuses to start with that pack until a fresh full `seed:validate`
  re-stamps it.
- **Seed packs** (`content/seed/**/validation.json`) are bound to a **seed fingerprint**
  per generator AND per pack (`tools/seed/src/factory/fingerprint.ts`):
  - the generator's full **import closure**, derived by walking the value imports from
    `factory/<generator>/cli.ts`, the `seed:check` gate (`factory/check/check.ts`, whose
    edges into other generators' folders are declared in `CHECK_DISPATCH`) and
    `shared/src/seed-pack.ts` / `check.ts` / `pack.ts`, across `tools/seed/src` and
    `shared/src`. That picks up everything the generator runs: `quests/validate.ts`
    (`checkProvenance`), `quests/parse.ts`, the citation resolver, the shared barrel, and
    so on. Each `@bootquest/server/*` import must be declared in `SERVER_EDGES`:
    `api/runners.ts` (`gradeDeterministic`) is bound by bytes, and the C#/Java adapters
    are bound per pack. External packages (zod) are bound by installed version, plus the
    exclusion registry. An unresolvable or undeclared import throws, and
    `fingerprint.test.ts` pins the resolved file set;
  - only the **graders the pack's items execute** (the runner types of its shipped and
    review-held variant checks and kata tests): the server's grader file list for that kind
    plus its toolchain. `drill-js` adds esbuild, `drill-cs` adds the .NET SDK and ref pack,
    `drill-java` adds the JDK. A mixed pack binds the union. A pack with no runnable check
    binds no grader. So a .NET update stales only the `drill-cs` kata packs.
  Editing any bound file changes what "validated" means, so every stamp bound to it becomes
  stale.
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
- **Retake policy (RESOLVED, explain-back retakes):** the answer of record stays one-shot per
  item version (answer-first: the key is seen afterwards). Two additions:
  - **Practice retakes** (`POST /units/:id/explain-back/practice` + `.../practice-score`): once
    the answer of record is self-scored, the learner may re-answer the same set any time, one
    unscored practice attempt at a time. Each is a new append-only attempt recorded ASSISTED
    (assistance `practice`, migration 015; the answer JSON carries `practice: true`); its
    self-score files explain-back evidence with assistance `practice` and NEVER awards XP (no
    xp_event row), schedules a retest, runs promotion or touches the streak/slate. A practice (or
    prior-key) self-score never renders a failed promotion leg (the dashboard's "failed" query is
    assistance-none only).
  - **Alternate sets** (sibling packs, `seed:explainback --set <id>`, see §3): each set is its own
    item/unit/key with the full one-shot discipline; siblings are derived from the provenance
    (repo, path). A fresh answer to any sibling opens >= 2 days (`EB_SET_MIN_GAP_MS`) after the
    newest fresh answer in the group (409 `NOT_DUE`); each set pays its own 20 XP and any
    first-time set can anchor leg (b) (same prerequisites, solo + unassisted as always).
  - Follow-ups (not built): kata practice retakes; any FSRS interplay.
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
- **Upstream bugs and guide errors found by the 2026-10-19 growth wave** (fix in the source
  repos; mirrors never edited; no shipped key point rests on any of them):
  - master7 `astraupskill/02-CONCEPTS.md:59`: the table's "original bug" row ("take 25, then
    filter") contradicts its own snapshot (`services-before.ts.txt:61` never filters) and
    `06-SOLUTIONS-AND-REVIEW.md:17-18`; the app's quiz stem was reworded (re-seeded), the guide
    row is still wrong upstream;
  - organized-build-crmpyjs `backend/src/app.ts:53`: the error handler takes 3 parameters, so
    Express 4 never invokes it (quiz 81e21dd5's structured-INVALID_CREDENTIALS premise is false
    at this pin);
  - netslack: the anonymous `/dev-token` endpoint is mapped unconditionally (Program.cs:76),
    outside the Development-only block;
  - organized-build-jira `BuildJiraStore.cs:208-316`: ApplyPatch writes fields as it validates,
    so a failed later field leaves earlier changes on the in-memory issue; `Save` (:453-456) is
    a plain WriteAllText with no temp-file rename;
  - organized-dotnet-hris: `client/src` is missing App.tsx/demoData.ts/types.ts though the
    guides cite them; 05-key-flows.md:12 says demo fallback happens "on fetch failure" but it
    also fires on any non-OK response (api.ts:20-31);
  - meterforge-upskilling: `PaymentAttempt.Fail()` has no state guard (a Succeeded attempt can
    be Failed then Retried); campusops: WebhookDelivery.MarkSucceeded/MarkFailed lack
    terminal-state guards and SLA Resume accepts a time before the pause (its own chapters 12
    and 14 note both);
  - 3buildanalytics `fabledocs/01-app-overview.md` is stale against the pin (Redis limiter,
    4-role metric filter, refresh-token reuse detection all missing from it);
    organized-anti-helpdesk and organized-anti-emponb `docsclaude/**` guides quote snippets
    that do not match the code (validate vs validateRequest, controller method names) and
    overstate (groupBy "single clustered scan", Prisma include "single JOIN query");
  - eShopOnWeb (nettodo) `02-framework-mental-models.md`: open-generic repository claim ignores
    `IAggregateRoot`; DbContext registration cite and exception-middleware-first claim are off;
  - Java repos: cli-to-do-manager docs claim id stability across restarts the code does not
    keep (TaskManager.java:96-106); library-book-tracker 00-codebase-map.md:274 misplaces the
    overdue rule (it is Book.isOverdue, Book.java:74); bank-account-simulator README:246-247
    lists checks in the wrong order (BankService.java:97-102); organized-experiment-src
    README:117 overclaims the Expense constructor; j4 08-PORT-TO-THE-WEB.md:5 says "durably
    replaced" but nothing fsyncs.

### Factory backlog

Fixed in W7 (cheap ones): command names (`npm.cmd` ...), `System.*` namespaces and bare
`Program.cs` prose no longer parse as citations; the quest parser reads `- Goal:` /
`- **Check:**` bullets; colliding reading-step basenames are keyed on the full path;
per-repo `citationWhitelist` (recorded visibly as `whitelisted`, never counted as
resolved); quiz variety `concept` and flashcard shape `hand-authored`;
`seed:check --restamp`. Still open, one line each (issue, where, why deferred):

- **Choice quizzes can be re-keyed undetected:** `singleKeyedProblems` in `tools/seed/src/factory/quests/validate.ts` never checks that the keyed choice's evidence includes the goal's own key. Deferred: the authored W5c quizzes use different evidence, so a new rule needs a per-variety audit of every shipped quiz first.
- ~~**No drill-cs runner in the seed harness**~~ — CLOSED: `factoryHarness()` registers drill-cs (warm C# runner, campaign 2) and **drill-java** (the Java runner, `.cache/factory-java`; java-harness branch). Both graders and the JDK version are bound into the seed fingerprint of the executing generators (`variants`, `patches`). First Java kata packs with tests: j2-katas, j7-katas, organized-experiment-bank-account-simulator-katas (8 katas). `seed:demo:planted` V5/V6/VJ+/P5/PJ+ prove the drill-java filter is not vacuous. Review fix: a wrong solution / defective version that fails ONLY as todo (`UnsupportedOperationException("TODO")` / `NotImplementedException` stub) or NotExecuted is not a failed assertion (`failsAsVerdict`, all runner types; planted V6).
- **A wrong solution can forge its own failing test (drill-java, likely drill-cs):** learner code shares the JVM with `bootcamp.Check`, so a "wrong solution" that is the reference plus `test("x", () -> { throw new AssertionError(); })` inside the solved method fails a named test and passes the wrong-solution filter (seen through the real runner in the java-harness review). Grading is unaffected (registering tests can only add failures), but the filter is vacuous for such an item. Deferred: the runner adapter must expose each canonical test's own outcome (a server runner + grader-fingerprint change) so the harness can require a canonical test that did not pass; until then the wrong solution / diff text is reviewed by hand.
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
- **Release wave: every quest pack passes both answer-tell guards — DONE (release branch, 2026-10-15):** all 81 drafts exempted at factory-3 were rewritten by seven content agents plus a fix pass, re-seeded through `seed:quests:drafts` (counts unchanged everywhere) and reviewed against the pinned sources (about 300 items source-checked across five fresh-context reviews). `quiz-balance.test.ts` `EXEMPT` is empty. The reviews then found tells the share guards do not measure (the key has the most `, : ;`, the only comma / "and" / digit / negation, a different opening word), so `tools/seed/src/ops/blind-pass.test.ts` was added: per STAMPED pack (drafted, authored or generated, so the C# campaign packs are covered too), the exact probability that answering every quiz by one of 30 blind strategies clears the 80% gate must stay <= 0.02. With random keys at most 1 of 107 packs exceeds even 0.01; at introduction 11 real packs exceeded 0.02 (worst groktuts-web-dev-upskilling-lab 0.167). All are fixed and its `EXEMPT` is empty. Corrected along the way: masterstore q03 (wrong key; the guide's own line 03-WORKED-CHANGE.md:29 is loose about 2^53), jobtrack q04 (date rollover), grok-build-hr q02 and customer-feedback-board q06/q12 (cites), organized-experiment-support-hub q06 (near-duplicate choices had quarantined it and dropped its stamp), and a dozen partly-true distractors.
- **Finding-location explanations (release wave):** 15 generator quizzes (react 7, zz1 5, master 3) shipped a bare finding number ("3") as the explanation. `findingLocationExplanation` now writes a real sentence when the label is a bare number and there is no severity; `explanation-lint` also fails on `/^\d+$/`. Generator change, so 104 packs were restamped.
- **OPEN, minor (release final review):** style tells no guard measures, worth a pass when these drafts are next touched: some FIX-A distractors carry stilted comma padding that the keys lack (1jstrain2.2v2 q12, grokjs-javascript-learning-lab q01/q10, meterforge-upskilling q07, jstrain2.2 q09, bootlocalopusv2 q03, organized-anti-helpdesk q10/q12, organized-dotnet-vg q02/q09); a hedge only in the key (ww35 q11, meterforge-upskilling q07, campusops q08, master3 q06); ww18 q03's key is the only negation; zz1 q02's key answers only half the prompt and zz1 q10 should also cite `src/app/api/org/invitations/route.ts:28-29`; organized-experiment-support-hub q06's key could name both reasons. None leaks a key past the blind-pass guard.
- **Learn-more notes + 24 new quest packs — DONE (wave3, 2026-10-15):** every one of the 131 quest packs has a stamped notes pack (394 `before` readings, 1,738 `after` explanations: one per quiz). 24 act-4 study quests gained packs (JS: master2, organized-experiment-idempotent-payments-lab, organized-build-agenthelpdesk, organized-build-analytics, devpractice, gitjira, pulse, organized-build-ecom (perch is excluded wholesale; Opusboot1 is byte-identical to devpractice), organized-js-training-jstrain2.4, stockade, tracer, harbor, relay, ww19, ww29, zz8; C#: netgum, netzen, tracer-net, netcalendy, atlas, agora, globehire, dotnet-auth). Every key in the new packs was re-verified by a different agent; wrong keys found and fixed: organized-build-analytics 898abd3dbeb03b58, netgum 0808a7c45dfcfe39, and (existing packs, found while writing notes) ankijs 838c52d8f4fca50a and jstrain2.2 2bc4b9d487b9c2f4. 49 JS and 15 C# study quests are still content-pending, most without a local checkout. (Closed by wave 4, next bullet.)
- **Wave 4: every study quest has a pack — DONE (wave4, 2026-10-15):** 61 more study-quest packs, each with stamped notes, so 192 packs in all (581 `before` readings, 2,509 `after` explanations, one per quiz). The loader now builds JS 143 + C# 48 study-quest gates; only three JS quests stay content-pending, on purpose: perch and skillforgejs (excluded wholesale in `tools/seed/exclusions.json`) and Opusboot1 (byte-identical to devpractice). Seven writers, then seven cross-author reviews (each writer's keys re-verified by a different agent, plus the leak pass on every reading). New leak class found in review: a GENERATOR goal-check or finding choice stating a HAND quiz's answer in the same pack (W4-B lms/billing, dotnet-ai-rag, nopsolutionsnet). The 20 older packs that mix generator and hand quizzes were then swept for it (xleak): 19 had leaks (gitjira all 12 hand quizzes, ww35 9), 84 hand quizzes were replaced with new, source-verified questions on the same material and re-reviewed by another agent; ww4 was clean. Author rule: before shipping a hand quiz, read every generator item in the same pack against its key.
- **OPEN, minor (xleak):** hand quizzes where a generator item narrows the choice to 2-3 without stating it, left as is: master q08, organized-experiment-idempotent-payments-lab q05/q06, organized-study-support-desk-crm q05, netpastebin q14, recipegen-app q06, recipeview q07, relay-upskilling q04, w22 q11. Generator after-notes (`x-g-*`) were not leak-checked against hand quizzes.
- **Java track — DONE (java branch, 2026-10-16):** javabootcamp (64 drill-java exercises, private `elirc/javabootcamp` @ `0ec7155`, 64/64 validated) and 12 Java study-quest packs + notes (152 quizzes, 40 flashcards, 36 readings), j5/j7 explain-backs. Every pack and the bootcamp had a second-author review; keys were verified by compiling and running each repo. Solution guides are excluded from generator input in j1 and j5 (06-SOLUTIONS) and j4 (07-TRACE-LAB, whose end-of-input table is the lab's answer key).
- **Java System Design section — DONE (java-sysdesign, 2026-10-16):** javabootcamp re-pinned to `faf5d9d`: modules 09-13 (caching, rate limits and resilience, partitioning and ids, messaging and events, storage and consistency), 40 new drill-java exercises, 104 total, 104/104 validated, 0 quarantined. Every exercise is deterministic (injected clocks, seeded Random, no threads). Each module was cross-reviewed by a second author running new wrong-solution variants. Guide: `astraupskill/03-SYSTEM-DESIGN.md` in the bootcamp repo. Verify.java caps exercises at 4-9 tests each, so the modules pack several assertions per test.
- **javabootcamp modules 14-21 — DONE (rw-java, 2026-10-20):** javabootcamp re-pinned to `b1b099d` (`JAVABOOTCAMP_SHA` + the `JAVABOOTCAMP_EXPECTED` census in `tools/seed/src/javabootcamp/import.ts`): 14 generics and interfaces, 15 sealed types and patterns, 16 design patterns, 17 deterministic concurrency, 18 parsing and serialization, 19 debugging, 20 scaffolded, 21 design debugging; 64 new drill-java exercises, 168 total in 21 modules, 168/168 validated, 0 quarantined. Modules 01-13 are byte-identical upstream (only the 13 README changed); the harness (Check.java, BqMain.java) is unchanged, so the grader fingerprint is too. Debug hunts (19, 21) ship a COMPLETE buggy starter with no TODO stub: it fails on real failed tests, which the import gate already accepts as a test verdict (upstream `bootcamp/_lib/FORMAT.md` "Debug hunts and scaffolded drills").
- **OPEN: upstream bugs found in the Java repos (owner, all reproduced):** organized-experiment-src — an expense saved with an empty note cannot be reloaded (`ExpenseFileStorage.java:33` trims the trailing tab; the next save drops it); `formatAmount` with `RoundingMode.UNNECESSARY` crashes "Show total spending" on a hand-edited 3-decimal amount (`App.java:196-198`); loaded categories are not normalised (`ExpenseManager.java:77-87`); an impossible date like 2026-02-30 is reported as a format error (also j5 `ExpenseManager.java:145-147`). organized-experiment-bank-account-simulator — a non-numeric balance in accounts.txt is an uncaught NumberFormatException at startup (`App.java:29`). organized-experiment-library-book-tracker — a bad date or id in books.txt escapes `main`'s `catch (IOException)` (`App.java:25-36`). organized-experiment-src-j7 — a saved discount reloads as 0 (`FileDataStore.java:110-116` builds the order before its items, `Order.java:98-100` clamps), a failed load followed by Exit overwrites all four data files with empty lists (`App.java:36-41`), removing an item permanently lowers the stored discount (`Order.java:99`), PAID orders stay editable. j4 — input ending at the delete confirmation prints "Deletion cancelled." (the course says it is silent).
- **OPEN: upstream bugs found in source repos (owner):** organized-build-analytics `metricVisibility.middleware.ts:8` assigns `request.query.refresh = undefined`, which Express 5 (5.2.1 pinned) silently discards (`req.query` is a re-parsing getter), so non-admins can bypass the KPI cache; the guides claim the protection works. organized-experiment-idempotent-payments-lab `src/lib/auth/guards.ts:10` imports `RouteError` from `../api/route-helpers`, which does not export it, so `instanceof RouteError` at :48 (`requirePagePermission`) tests against undefined and a CUSTOMER visiting /admin likely gets a TypeError instead of the redirect to "/". netgum re-checks stock on its own tracked aggregate after the gateway await, so concurrent checkouts can oversell (its 03-WORKED-CHANGE.md:43 says otherwise; 02-CONCEPTS.md:27 is right).
- **OPEN: upstream guide errors found by the notes wave (fix in the source repos):** ankijs risk-register.md:5 (describes the old shallow import guard); jstrain2.2 guide 02 uses the no-dot rule for a DOM listener in places; organized-build-subbox 05-key-flows.md:104 (payment recovers on the second retry, not the third); jobtrack 03-WORKED-CHANGE.md:92 (2026-02-30 rolls to 03-02); netcleanarch 03-validation-auth-and-permissions.md:32 (role attributes OR, not AND); ww19 02-CONCEPTS.md:14 and 06:31 (schema.prisma:157, not :186); zz8 02-CONCEPTS.md:9 (404, not a conflict); agora value-objects.md (SavedPercent is int); atlas flaw-ledger (the ambient-time ban covers Now/UtcNow only); tracer-net ADR 0010 (timestamp ordering example); jsdrillv2 chapter 04:137-139 (stubs, not real setTimeout); organized-anti-emponb 04-derived-data-and-caching.md:51 (no transaction on the direct path).
- **OPEN, minor (notes wave reviews):** add a validator check for absolute words (only/always/never/every) in `after` notes, since three false explanation claims were overstatements; a lint for absurd throwaway distractors (e.g. "IProductRepository is sealed"); the generator collapses double spaces inside backticks (gitjira goal-checks quote `grep -c "^ it("`); campusops q9 distractor 1 is arguably also not caught; trainjs 06c0aaa269a001fb says a timer id "cannot be awaited" (it can; it resolves at once); netzen d07dffb3dc0a457a could not be reproduced and was left; applybot r03 still quotes the RESULT-line format (mild hint for cf2817c1e52d09c4).
- **Growth wave — DONE (2026-10-19):** drill-java in the factory harness (variants and patch
  katas can carry Java tests; planted cases VJ+/PJ+/V6; a run whose only failures are todo /
  not-executed is NOT a wrong-solution verdict — that hole let a TODO stub pass the filter and
  was closed for every runner type). Content: 14 JS act-3 explain-back sets, 23 C#/Java sets
  (every Java campaign quest now has one), 7 javabootcamp system-design rubric packs (6
  standalone DESIGN IT sets on the java track + 1 real G2), kata waves (8 Java + 11 C#/JS):
  52 katas, 50 tested. Every branch had a fresh-context cross-author review; all fixes went
  through drafts/specs + re-seed. EB review rule reaffirmed and extended: leak-check key points
  against the SAME-LINEAGE repos' quest packs too (j3 leaked bank-account-simulator README quiz
  keys), and against the pack's own quiz keys.
- **OPEN (growth wave, factory):** authoring tools `kata-proof.ts`, `kata-index.mjs` and
  `katagen.mjs` resolve paths against the CURRENT DIRECTORY (`npm --prefix` does not chdir) —
  run them chdir'd into the target tree or they silently read another checkout's packs; the
  factory never verifies a kata's adapted `*.Testable.java` copy against its repo file (only
  verbatim context files are compared; the growth-wave reviewer checked the 8 Java katas by
  hand); two factory processes in one worktree share `.cache/factory-java` (and -csharp) with no
  cross-process lock; the Java fingerprint binds `javac -version` but execution uses `java`
  from PATH (a mixed-JDK PATH is not caught; same gap as the server grader).
- **OPEN (growth wave, accepted kata/quiz overlap):** in six katas the defect IS a quest
  quiz's deciding fact and the public diff shows it before answering: w22 refund-cap vs cd4e,
  w22 partial-refund vs a393, meterforge payment-retry vs 4a6d/0bee, nethris pto vs 3e1b, ww18
  band-max vs da83/c590. Rewording cannot help (the diff itself tells); accepted because one
  narrowed quiz cannot clear a 12-quiz 80% gate, and the blind-pass guard is unaffected. The
  alternative is dropping or re-theming those katas — owner's call. Also left to the owner:
  gitvg-astra flashcard f01-favorites-acceptance's back overlaps its new explain-back set's
  Q0 key points (suggested trim of the back's last sentence); ~~the six DESIGN IT explain-back
  units carry the `language-fluency` competency (ladder.ts default), which fits system design
  poorly~~ — **RESOLVED (sd-plumb):** an explain-back set whose first prompt starts `DESIGN IT`
  routes (`store/ladder.ts` `isDesignIt`) to the new campaign-less `sysdesign` track with
  competencies `system-design` + `communication` and no quest link; migration 014 adds the
  track + competency and moves already-loaded `ladder/explain-back/javabootcamp/*` units.
- **OPEN (fix/content-review, accepted explain-back/quiz overlap):** the token leak guard
  (`EB_LEAK_JACCARD`) passes these, but each key point still answers a same-repo quiz in other
  words. In every case the explain-back PROMPT asks for exactly the fact the quiz keys, so a
  rubric without it would be hollow; left in place on purpose (do not add them to
  `EB_LEAK_EXEMPT`, which only covers token leaks). Accepted for the same reason as the kata
  overlap above (one narrowed quiz cannot clear its pack's 80% gate; blind-pass unaffected):
  bootlocalopusv2 q1.kp5 vs e0fba98f (the prompt asks what "fixed" had to mean: the parent derives
  `ok`; q1.kp4 was rewritten to the plan-of-test-names fact instead), q2.kp3+kp4 vs 6cf9d6ea and
  q2.kp5+kp6 vs e1dcc20c (the prompt asks the mechanism that neutralises each forgery), q3.kp1+kp2
  vs 066d3c34 (the prompt asks how each escape was closed); campusops q3.kp3+kp4 vs 0861d1f9 (the
  prompt asks why atomic reservations are not retry-safe); grok-build-hr q2.kp4+kp5 vs f1dec2ae
  (the prompt asks what each protection layer contributes); customer-feedback-board q2.kp3 vs
  e6ace4d8 (the prompt asks why optimistic concurrency is needed although writes are serialized).
  Residual, after rewording through the
  mechanism rather than the key: 1jstrain2.2v2 q3.kp5/kp6 (the minimum-gap and never-serve
  alternatives, restored for the prompt's "which alternatives were rejected and why") vs
  36ae6a7a/be8b4384; customer-feedback-board q1.kp2 (BEGIN IMMEDIATE as the lost-update guard) vs
  8f65790f; relay-upskilling q3.kp4 (why rows are marked uncertain before the POST) vs c1b9480f.
  Rewritten to a different fact instead: bootlocalopusv2 q1.kp4, campusops q3.kp5 (was the 401/403
  pair of a6fef2cb; now the caller-supplied demo headers), 1jstrain2.2v2 q3.kp2 (XP drop as a cost,
  no longer its replay-from-log cause, d76989), ww35 q3.kp6 (was "every closed slot gets the same
  blocked reason", quiz 0f6af4ff; now off-grid booking is accepted). Owner: e12 q1's prompt still
  asks what happens when a token is revoked mid-session, but the reviewer's q1.kp5 replacement
  dropped the only revocation point (quiz dc944e60 tests it), so the rubric no longer covers that
  half of the prompt; reword the prompt (or retire the quiz) when e12 is next touched.
- **OPEN (sysdesign wave, accepted explain-back/quiz overlap):** same doctrine as above — each
  DESIGN IT prompt asks for exactly the fact a same-repo quiz or flashcard keys, so the rubric
  keeps it; the token guard passes all of these and none goes in `EB_LEAK_EXEMPT`:
  tracer q1.kp5 vs f04-session-cookie, q1.kp4+kp8 vs c4bacf21 (the prompt asks what the server
  stores and what a request costs); dotnet-auth q2.kp2 vs 264e422a/f03 (family revocation — the
  prompt names the exfiltrated refresh token), q2.kp3 vs f04 edge 3, q2.kp4 vs f04 edge 2,
  q1.kp8 vs de17c21d (audience validation as a requirement), q1.kp7+q3.kp3 vs f02, q3.kp4 vs
  5a7c727e; payments q1.kp2 vs f03/ca8d0ee0, q1.kp3 vs 74fd1ab4, q1.kp7 vs 4f28e0fc, q3.kp3 vs
  bd1f7bad; campusops(webhooks set) q3.kp5 vs ee986536, q1.kp6+q3.kp2/kp3 vs 0861d1f9 (its own
  line, separate from the old campusops set's), q1.kp3+q3.kp6 vs f03-browser-key-lifecycle;
  grok-build-multitenant q1.kp3 vs f03-composite-fk, q1.kp4/kp5 vs f02-stale-update;
  opusorganize saga q1.kp2+q3.kp3 vs 456fe5b5/f01, saga q1.kp7 vs 59462418, web-app q1.kp5 vs
  f04, zero-downtime q1.kp5 vs 15853829/fa5e3705/f03 and q1.kp6 vs 73e9d258 (both worded at
  design level; measured ≤0.30); temporal-lite q2.kp1 vs d2a8b1f9/f01, q1.kp1+q3.kp1 vs
  53d1bb5e/f01, q1.kp3 vs 95d78a74, q1.kp4 vs f02, q1.kp5 vs c5061a36; relay q3.kp7 vs f01
  (fail-fast), q1.kp3+q3.kp3 vs f01 (retry classes), q1.kp4+q3.kp3 vs f03, q2.kp5 vs
  f02-breaker-states; bazaar q3.kp2(+kp3 by elimination) and q1.kp7 vs 007e83f2; pulse-net
  q2.kp1 vs e24830d3. Two unprompted leaks found in review were REMOVED, not accepted
  (dotnet-auth key-rotation grace vs fb361478; opusorganize web-app duplicate-checkout vs
  a4286bb0).
- **OPEN (sysdesign wave, owner decisions):** the `system-design` competency has no promotion
  path: DESIGN IT units carry no artifact leg (a) and no prerequisites for leg (b), and nothing
  else tags a unit `system-design` — migration 006's alias still maps 'system design judgment'
  to feature-delivery. Options: remap that alias, attach a project artifact to the track, or
  treat the competency as practice-only display. Also: `shared/src/sync.ts:268` still says
  "seven ladder competencies" (comment only; the file is inside the seed fingerprint, so the
  one-word fix is deferred to the next wave that already touches shared); retired javabootcamp
  DESIGN IT units moved to sysdesign by 014 keep `language-fluency` in unit_competency
  (hidden, loader re-derives only planned units).
- **OPEN: upstream bugs and doc errors found by the sysdesign wave** (fix in the source repos;
  mirrors never edited; no shipped key point rests on any of them):
  - relay: docs promise zero-duplicate checkpoint-resume replay, but live replay creates a fresh
    run id (`apps/api/src/routes/relays.ts:170-173`) and new `${runId}:${stepId}` vendor keys
    (`apps/engine/src/idempotency.ts:20-31`), so bulk replay can double-send; `breaker.ts:26-34`
    half-open admits every caller (ADR-0016 and quest flashcard f02 say one probe); CircuitBreaker
    and isStuck are wired only in tests (no retriable-failed status, no DLQ code); `dedupeWindow`
    is configured but never read, and no Idempotency-Key header is sent; `worker.ts:257,280`
    comments overstate BullMQ behavior.
  - bazaar: `ReservationService.release` flips the hold and returns stock in two separate port
    calls (`apps/api/src/inventory.ts:58-62`); `hold` skips the positive-quantity guard that
    `AtomicInventoryService.reserve` has (:41-42 vs :82-85); sprint-07 doc's SQL predicate
    (`available>=1`) disagrees with the ADR's `on_hand - reserved >= $qty`.
  - pulse-net: ADR line 80 suggests dedupe by event id but the capture contract has no event id;
    the capture rate limit partitions on the `X-Api-Key` header only, so body-key callers share
    an IP partition.
  - temporal-lite: `completeTaskStep`/`failTaskStep` update by id with no leaseToken check
    (`task-repository.ts:79-88`) — no fencing (latent while F1 means leases are never reclaimed).
  - tracer: ADR-0003 "deleting the row ends the session immediately" holds for HTTP only (an
    open WebSocket authenticates once at upgrade, `apps/api/src/ws.ts:138-147`); sprint-02 doc
    calls the OAuth state "signed, single-use" but the code uses an unsigned random cookie value;
    expired sessions are never purged.
  - dotnet-auth: the refresh grant checks the client secret only when one is sent
    (`OAuthService.cs:183-186`), so a confidential client's refresh token redeems without it.
  - 3buildanalytics: `05-pattern-catalog.md:106-115` and the critique still describe the old
    in-memory IP limiter; at the pin `rateLimit.middleware.ts` is Redis-backed (US-18 landed).
  - grok-build-multitenant `dfableandopus/05-SYSTEM-DESIGN-FOLLOWUPS.md`: practice-task numbers
    are wrong (outbox is Exercise 8 not 5; create idempotency is 6 not 3), the sibling repo path
    uses a stale name, and line 59's keyset-pagination claim does not match the all-ascending
    index (the `ordered` array mixes DESC/ASC).
  - groktuts `system-design-deep-dives.md`: calls Postgres shared buffers a "query cache"
    (:189); points at a `version`/`updatedAt` column that section 2's SQL does not define.
  - opusorganize `07-zero-downtime-migrations.md:33` says INC-003 had 4 minutes of 5xx; its own
    trace (:59-60) spans ~5.5 minutes.
  - jsprojectlearn/groktuts quest packs are untouched by their new DESIGN IT sets (no shared
    keyed facts found).
