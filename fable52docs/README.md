# fable52docs — app review and improvement brief (2026-11-09)

A review of BootQuest's UI and content against the goal "a personal upskilling app like boot.dev", written so
that a new LLM session with no other context can implement it. **Nothing in the app was changed.** The only
new files are in this folder, and they are uncommitted.

## Read in this order

| File | What it holds |
|---|---|
| this file | state of the repo today, the headline, the rules the implementer must follow, how to reproduce |
| [`01-UI-FINDINGS.md`](01-UI-FINDINGS.md) | 20 UI findings, each with evidence, the file to change, the fix and an acceptance check |
| [`02-CONTENT-FINDINGS.md`](02-CONTENT-FINDINGS.md) | 10 content findings with measurements and fixes |
| [`03-IMPLEMENTATION-PLAN.md`](03-IMPLEMENTATION-PLAN.md) | the same work as ordered work packages, with restamp risk, gates and open owner decisions |
| [`screenshots/`](screenshots/) | 7 screenshots taken during the review (sandbox, not the owner's data) |
| [`tools/`](tools/) | `quiz-bias.cjs` (content probe), `cdp.mjs` (headless-Chrome driver), `copydb.cjs` (safe DB copy) |

Earlier reports are still valid and are not repeated here: `elihandoftwo/01-STATE-OF-THE-APP.md` (what the app
is), `elihandoftwo/02-CONTENT-CATALOG.md` (all content, counted), `elihandoftwo/03-SENIOR-CRUD-UPSKILL-IDEAS.md`
(labs and senior-level formats). This review covers what those do not: how the app feels to learn in, and the
Fundamentals ladder, which was built after them.

## State today (checked 2026-11-09)

- `main` is at `d83ae80f`. It does **not** contain the Fundamentals ladder.
- Branch `fund-wave` (`ce7daee4`) is `main` + 9 commits: 60 Fundamentals topics (20 each for JS, C#, Java), each
  a lesson + 10-question quiz gate + 8 flashcards + 1-2 drills. It is complete and its battery was green, but
  it is **not merged and not pushed**. A clone with that branch checked out is at
  `C:\Users\Owner\Desktop\bq-claude-fund`.
- The owner's database (`C:\Users\Owner\bootquest\bootquest.db`) still has **0 attempts, 0 XP, 0 review
  cards**. The app has never been used for real learning.
- The owner's app was running on ports 4178 / 5173 from `main` during the review. I did not touch it.

## How the review was done

I ran the `fund-wave` build on ports 4290 / 5290 against a **copy** of the owner's database, and drove it with
headless Chrome. I opened every page, took a Fundamentals quiz, ran and submitted JS and C# drills, and opened
an explain-back, a review kata and a system-design drill. I checked layouts at 1440, 1024 and 390 px wide.
Every finding marked **verified** was seen in that sandbox or measured with a script; findings marked
**judgment** are my opinion.

I did not see the review (flashcard) session with real cards, because cards only become due the next day, and
I did not test with a screen reader.

## Headline

1. **The app has the content of a boot.dev but not the flow of one.** boot.dev's loop is: one obvious
   "continue" button, a short lesson, an exercise, instant feedback, the next step. BootQuest's loop is: a
   dashboard with six panels and no primary action, a lesson you read in a narrow column, a 10-question quiz
   whose wrong answers are hidden until tomorrow, and a "next unit" link that leaves the course you were in.
   Fixing the flow matters more than adding content.
2. **The Fundamentals ladder is the closest thing to boot.dev, and it is not on `main`.** It is also invisible
   outside the Campaign page: the dashboard and the daily slate never point at it.
3. **Three small defects undermine trust in the teaching:**
   - code is rendered with font ligatures, so a lesson about `===` shows a three-bar glyph instead;
   - the quiz gate is open-book (the lesson stays on screen beside the questions);
   - in the Fundamentals quizzes the correct answer is the longest choice 60-74% of the time (chance is 25%).
4. **Practice is thin where the learner starts.** Fundamentals has 65 drills for 60 topics. The app holds
   3,300 drills elsewhere, on the same topics, that the ladder does not link to.
5. **Content is plentiful but unordered outside JS.** System design (216 units) and Agentic (75) have no path,
   just an alphabetical list of repo names. Java's campaign is 12 steps.

The recommended order is in `03-IMPLEMENTATION-PLAN.md`. Wave 1 there is 10 changes: 9 client-only and one that
adds a server-only field. None needs a restamp.

## Rules the implementer must follow

These come from `AGENTS.md` (the binding contract) and from how this repo is built. Read `AGENTS.md` first.

- **Never commit to `main`, never push.** Work on your own branch, ideally in your own clone
  (`C:\Users\Owner\Desktop\bq-<agent>-<stream>`). Commit with a message file (`git commit -F msg.txt`).
- **Branch from `fund-wave`, not `main`**, unless the owner has merged it by then (check with
  `git merge-base --is-ancestor fund-wave main`). Most findings are about Fundamentals code that only exists
  there. All file and line references in this folder are for `fund-wave` at `ce7daee4`.
- **Avoid restamps.** `shared/src`, `tools/seed/src/factory` and `server/src` are fingerprinted; changing some
  of those files forces every content pack to be restamped. New API shapes go in `shared/src/api-ext.ts` (not
  `api.ts`). Client-only changes are always safe. If a change seems to need a fingerprinted file, stop and
  check which files the fingerprint covers before editing (`tools/seed/src/factory`, `pack.ts`), and run
  `npm run restamp:all -- --dry-run` afterwards: it must still report every pack fresh.
- **Content rules:** existing items on `main` stay byte-identical. The Fundamentals content is not on `main`
  yet, so it can still be edited freely; that is why the quiz fixes should happen before it lands.
- **Use Git Bash for npm scripts with flags** (PowerShell 5.1 drops the `--`).
- **Gates** to run are listed per work package in the plan. The client suite takes about 6 minutes.
- **Do not test against the owner's database.** Attempts are append-only and cannot be undone. Use the
  sandbox below.

## Reproduce the sandbox

From Git Bash, in a clone that has `fund-wave` checked out:

```bash
# 1. copy the owner DB (read-only source; VACUUM INTO writes a consistent copy)
node fable52docs/tools/copydb.cjs C:/Users/Owner/AppData/Local/Temp/bq-sandbox.db

# 2. start API + UI on other ports (takes ~60 s to load ~700 packs)
BOOTQUEST_DB='C:\Users\Owner\AppData\Local\Temp\bq-sandbox.db' BOOTQUEST_PORT=4290 BOOTQUEST_UI_PORT=5290 npm run app

# 3. open http://localhost:5290/  (or drive it: see the header of tools/cdp.mjs)
```

The first page load after a cold start takes several seconds while Vite compiles; a blank page for the first
5 seconds is normal. The client also has a mock mode with no server: `npm run dev:mock -w @bootquest/client`.

Unit ids used in the review (sandbox DB; ids can differ on a fresh DB, keys do not):

| Unit | id | key |
|---|---|---|
| Fundamentals JS topic 01 (lesson + quiz gate) | 5182 | `fund/js/01-values-types-and-coercion` |
| Fundamentals JS drill | 5119 | `fund-js/01-values-types-and-coercion/01-defaults-that-keep-zero` |
| C# drill | 2570 | `csbootcamp/01-language-core/01-count-vowels` |
| System-design drill | 4745 | `sysdrills/01-estimation/01-qps-from-dau` |
| Explain-back (G2 brief) | 4334 | `ladder/g2/atlas-net/f06a24e59100` |
| Review kata | 4388 | `ladder/kata/j5/1138058811e0` |
| Campaign quiz | 1 | `bootforge/js-fundamentals/values/variables/quiz-const-reassign` |

`GET /api/units/by-key/<url-encoded key>` resolves a key to an id.
