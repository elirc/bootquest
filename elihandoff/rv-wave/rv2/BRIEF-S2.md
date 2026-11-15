# rv2 stream S2 `rv2-c`: content and side files (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-c`, branch `rv2-c` (cut from the integrated hub `rv-wave`). No migrations.

## Read first (in this order)
1. `C:\Users\Owner\Desktop\selfboot\AGENTS.md` (contract + content discipline: existing items byte-identical, xleak
   rule, code-truth beats docs, cite pinned code, upstream bugs are report items).
2. `C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\rv2\PLAN.md`: **binding**. Your scope is §1 rulings 1, 4, 5, 7,
   §2.1 (format + the xleak rule + the `seed:lint:keyideas` spec), **§2.2 (the binding list of key ideas per section)**,
   §3 content C1-C8, and §4 "S2". §5 items 3, 6, 7 are how Fable will review your content.
3. `C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\HANDOFF.md` §3 (bound files) and §8 (machine lessons).
4. `C:\Users\Owner\Desktop\selfboot\docs\SEEDING.md` §3 for the CLI of each content type you touch (in your clone too).
5. `C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\rv2\INTEGRATION.md` (what the base contains; whether any WIP was
   dropped and passed to you under "Inherits").

## Owned files
Exactly PLAN §4 "S2 owns". You do not touch `server/src`, `client`, `shared/src`, `tools/seed/src/factory`. Stream S1
(parallel, other clone) builds the server reader for `content/keyideas/<section>.json`; the format in PLAN §2.1 is the
contract between you. Keys in `scope`/`sources`/`siblings` must be real unit keys: look them up from the packs and
`content/paths/*.json`, never guess. Skip archived keys (`content/archive.json`).

## Order and slices
**Slice 1 (merged first, so the app has real key ideas):** C1 in the order PLAN §4 gives (sysdrills, design-it, agentic,
review-katas, fund-js-* first, then the rest of the 24), then the `seed:lint:keyideas` lint (+ its tools/seed test +
root `package.json` script line), then C2 (`content/design/headlines.json`, `estimates.json`), then C3 (hand review of
`paths/sysdesign.json`, `content/seed/card-tags.json`). When slice 1 is committed and its gates are green, write
`S2-SLICE1.md` next to this brief (SHA + gates) and **keep going**; the orchestrator merges slice 1 from your branch.
**Slice 2:** C4 → C5 → C6 → C7 must → C8 spike (<= 1 h; stop-and-report if it needs a bound file) → C7 stretch.
Commit per side-file group / per pack. If you run low on budget, stop at a clean commit boundary: a finished smaller set
beats a half-imported pack.

## Gates after each pack (targeted, chunked)
`seed:validate` with `--course`, `seed:lint:leaks` (0), `seed:lint:answers` (OK), `seed:lint:keyideas`, `seed:pins`,
targeted `npx vitest run --root tools/seed <file>`, `restamp:all -- --dry-run`, targeted `test:csharp`/`test:java`
for C4/C7 (JDK 17). When counts change, update census constants (`*_EXPECTED`) and `server/test/api/ladder-real.test.ts`
/ `packs.test.ts` pins by counting with a script. Report every count before → after.

## Machine rules (about 1.2 GB free RAM; another agent runs in parallel)
- Git Bash with flags (`npm run x -- --flag`). Foreground only, `--maxWorkers=1`. Never a full suite.
- Write helper scripts to files (no `node -e` with backticks). No `du` or recursive scans of node_modules.
- Never edit `.cache/checkouts`. Never touch `C:\Users\Owner\bootquest\bootquest.db`. Don't run `npm run app` here.
- Before you stop, kill leftover node processes whose command line matches `bq-f52-c`.

## Done = stop report (AGENTS.md format)
Write `C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\rv2\S2-REPORT.md` and return its summary: branch + SHAs per
slice, counts before → after, gates with tails, ideas per section file, deviations, upstream bugs, what is left.

## Added after integration
- `sysdrills/02-caching-and-pools/01-effective-latency`: hint 1 is a formula; reword it to prose (re-import + stamp
  sysdrills, chunked). Bug-hunt key `fund/java/14-.../02` was dropped by the integrator (data race): never reuse it.
- Archive is now 880 keys (E1 archived sysdrills 06/04); `FUNDAMENTALS_EXPECTED` java drills = 42. Re-count before you
  change any pin.
