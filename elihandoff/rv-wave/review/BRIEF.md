# Full app + content review, 2026-11-12: shared brief for all five reviewers

## The ask (owner's words)
"Do a full review with five Opus agents using like a counselor or adversarial review of every single piece of content
and feature in the application and suggest ways to improve the app. So maybe remove some content or add new content,
new features, new learning style, teaching methods, etc."

You are one of five reviewers on a council. Round 1: review your domain on your own and write a report. Round 2: you
will be sent the other reviewers' summaries and asked to attack them. Stay available after round 1.

## What BootQuest is
A single-user, local-first gamified upskilling app for one engineer (the owner). npm workspaces: `server/` (Node +
node:sqlite), `client/` (React/Vite), `cli/`, `shared/`, `tools/seed/`. Content is seeded into stamped packs under
`content/`. Five tracks (JS, C#, Java, system design, agentic) plus a Fundamentals ladder (73 topics). Read
`AGENTS.md` and `docs/SEEDING.md` for the content model and `elihandoftwo/01-STATE-OF-THE-APP.md` +
`02-CONTENT-CATALOG.md` for the app tour and content census.

## Review target: READ-ONLY
`C:\Users\Owner\Desktop\bq-review` is a detached checkout of branch `f52-wave` at `dc2206bc`. That is `main` + the
Fundamentals ladder (`fund-wave`) + the f52 wave. It is the newest state of the app; it is not on `main` yet.
- Do not edit, create, or delete anything inside `bq-review`, `selfboot` (except your output files below),
  `bq-f52-*`, or `.cache/checkouts/*` (pinned upstream mirrors: cite from them). Do not commit, push, or run git
  commands that write.
- Write scratch scripts and intermediate output only in `C:\Users\Owner\Desktop\selfboot\review-2026-11-12\work\<your-id>\`.
- Your report goes to `C:\Users\Owner\Desktop\selfboot\review-2026-11-12\<your-id>-<domain>.md`.

## Read first, and do not re-report what is already known
Earlier reviews and waves: `fable52docs/README.md`, `01-UI-FINDINGS.md`, `02-CONTENT-FINDINGS.md`,
`fable52docs/wave/REPORT.md`, `COMMON.md`, `WAVE-B.md`; `elihandoftwo/03-SENIOR-CRUD-UPSKILL-IDEAS.md`,
`04-REVIEW-RESOLUTION.md`; `elihandoff/REVIEW-2026-10-30.md`; `docs/SEEDING.md` §8 (wave log + open owner items).
If a past finding is still unfixed in this tree, say so in one line and cite where it still bites. Your value is
what those reviews missed, and judging whether what was built since actually works.

## "Every single piece"
The content tree is ~61 MB and ~4,900 files, so nobody reads it all by eye. For your domain:
1. Sweep **all** items with scripts (counts, duplicates, near-duplicates, answer-position and length bias, trivia
   ratio, missing explanations, dead references, stale upstream citations, broken drills, orphaned units, etc.).
2. Deep-read a stratified sample: every pack or topic gets at least a few items read in full; read more where the
   sweep flags trouble.
3. End with an honest coverage statement: N items swept by script, M read in full, what you did not cover.

## Stance: adversarial, then constructive
Assume each item is wrong, trivial, duplicated or unteachable until you have checked it. Steelman why it exists, then
attack. Questions to ask everywhere: would a working mid-to-senior engineer learn something real here? Is the keyed
answer actually right (code-truth beats docs: check against the pinned code or the language spec)? Is it trivia about
one repo's incidental details? Does it leak its own answer? Does it duplicate something else? Would the owner, who
has 0 attempts so far, actually open it?

Then be constructive. The owner explicitly wants: content to **cut**, content to **add**, **new features**, **new
learning styles and teaching methods**.

## Evidence standard
- Every finding cites `path:line` or an item id, and is tagged **VERIFIED** (you read or measured it) or
  **JUDGMENT** (your opinion). Count by counting.
- For each proposed change give a size (S/M/L), the files or areas it touches, and whether it touches fingerprinted
  dirs (`shared/src`, `tools/seed/src/factory`, `server/src`): editing those forces an estate-wide restamp.

## Machine rules (important)
- ~3 GB free RAM, and five reviewers run at the same time. **No full test suites, no `restamp`, no estate-wide
  `seed:validate`.** A single targeted test file with `--maxWorkers=1` is fine. Plain `node` scripts over JSON are fine.
- Use Git Bash. Heredocs or `node -e` with backticks or `\\` get mangled: write a script file and run it.
- Only reviewer R4 may start the app (ports 4390/5390), and only against a **copy** of the owner DB made with
  `bq-review/fable52docs/tools/copydb.cjs` into its work dir. Never open `C:\Users\Owner\bootquest\bootquest.db`
  for writing. Headless Chrome driver: `bq-review/fable52docs/tools/cdp.mjs`. Stop every process you start.

## Report format (`<your-id>-<domain>.md`, keep it under ~600 lines)
1. **Verdict**: 5 lines max.
2. **Findings**: ranked table: id (e.g. R1-07), severity P1/P2/P3, VERIFIED/JUDGMENT, evidence, proposed fix.
3. **CUT**: content or features to remove, merge or demote, by id or path, with the reason and the count affected.
4. **ADD**: content gaps to fill, concretely (topic names, item types, counts).
5. **New features / learning styles / teaching methods**: each with the learning rationale, size, files touched,
   restamp risk.
6. **Coverage statement**.

Your final message (what the orchestrator sees) is at most 40 lines: verdict, top 10 items, report path.
