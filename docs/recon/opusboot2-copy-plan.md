# R1 — opusboot2 (BootForge) copy plan

Recon of `C:\Users\Owner\Desktop\opusboot2` (read-only), 2026-10-07, Node v22.16.0; paths relative to it.

## 0. State of the source repo (read this first)

- HEAD is `7ee7493`, but the **working tree carries large uncommitted changes** (modified
  grade-core/tools/_lib/types/all build JSON; untracked `server/learning.ts`, course 16
  `engineering-practice`, `tests/learning.test.mjs`, `tests/drafts.test.mjs`).
- **Copy from the working tree, not `git show HEAD:`** — it has the better grader (structured
  diagnostics, result-shape validation, early-exit detection). Everything quoted is working-tree.
- Content census today (`npm run stats:content`): **16 courses / 138 lessons / 2,571
  exercises** (1,825 code, 544 quiz, 196 output, 6 written). The "2,559" figure = the 15
  committed courses; the extra 12 are `engineering-practice` (6 code + 6 written).
  **W2 gate wording ("all 2,559 refs") must decide: import 15 courses (2,559) or 16 (2,571).**
  Written exercises have no executable refs; executable refs = 1,825 code + 196 output.
- `content/build/` is git-tracked (5.7 MB of JSON). It is the import surface — BootQuest
  should ingest the **compiled JSON**, never the `.course.mjs` sources.

## 1. The grader / runner — `server/grade-core.mjs` (166 lines, plain ESM JS)

Single file, shared by the live server (`server/index.ts`) and both content tools
(`tools/generate.mjs`, `tools/validate.mjs`). Dependencies: `node:fs/os/path`,
`node:child_process.execFile`, `esbuild` (only for TS).

### Exports / interfaces
```js
export async function gradeCode(code, language /* 'js'|'ts' */, tests /* {name, code, input?}[] */)
  // -> { pass: boolean,
  //      results: { name, pass, message?, input?, expected?, actual?, operator? }[],
  //      stdout?: string, stderr?: string }
export async function runSnippet(code, language = 'js')
  // -> { stdout, stderr, timedOut: boolean, exitCode: number|null, error?: string }
export function normalizeOutput(s)   // CRLF->LF, rtrim each line, strip leading/trailing blank lines
export const _internal = { MARKER, TIMEOUT_MS }   // MARKER '__BOOTFORGE_RESULTS__' is now dead (L9)
```

### How grading works (L53-115)
1. TS: `esbuild.transform(code, { loader: 'ts', format: 'esm' })` (L57). Transpile only,
   **no type-check**. Transform error -> single result `{name:'TypeScript compiles', pass:false}`.
2. `fs.mkdtempSync(os.tmpdir()/bootforge-)`; writes `solution.mjs`, `tests.json`,
   `runner.mjs` (the `RUNNER` string constant, L12-45). Dir removed in `finally` (L113).
3. Runner (inside child): `mod = await import('./solution.mjs')` — import failure ->
   one result `'code loads without errors'`. Then for each test, sequentially, in one process:
   `const AsyncFunction = (async () => {}).constructor;`
   `new AsyncFunction('mod', 'assert', t.code)` and `await fn(mod, assert)` with
   `assert = node:assert/strict`. Failures capture `message` (<=2000 chars) and, if the error
   has `expected` (AssertionError), `expected/actual/operator` via `util.inspect` (depth 5,
   `customInspect:false`, <=4000 chars — handles circular values). `input` comes from author
   metadata `t.input`, never from wrapping exports (preserves export identity, L22-23).
4. **Results go through a file, not stdout**: runner writes `results.json` (L20); learner
   `console.log` stays in `stdout` and cannot spoof results via stdout (test at
   `tests/grade-core.test.mjs:64`).
5. Parent validation (L104-107): results must be a non-empty array of `{name:string, pass:boolean}`
   AND either be the single load-failure row OR have exactly `tests.length` rows whose names
   match test order. Missing file or `exitCode !== 0` -> `{name:'code runs'}` failure with
   stderr text (catches learner `process.exit(0)` before grading finished — test L81).

### The spawn call (verbatim, L136-154)
```js
function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { cwd, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          timedOut: Boolean(err && err.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && (err.killed || err.signal === 'SIGTERM')),
          exitCode: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          error: err ? String(err.message).slice(0, 2000) : undefined,
        });
      }
    );
    child.on('error', () => resolve({ stdout: '', stderr: 'failed to spawn node', timedOut: false, exitCode: null }));
  });
}
```
Called as `run(process.execPath, ['runner.mjs'], dir)` (L78) / `['snippet.mjs']` (L130).
- **No shell**, direct `process.execPath` -> on Windows the timeout kill (TerminateProcess)
  hits the real node process; no orphaned grandchild.
- **Timeout**: `TIMEOUT_MS = 8000` via execFile's `timeout` option (Node kills with SIGTERM).
  Timed out -> single result `{name:'finishes in time', message:'Timed out after 8s — infinite loop?'}`.
- maxBuffer 1 MB; overflow is explicitly *not* labelled a timeout (exitCode becomes null ->
  "code runs" failure).
- **Env is inherited** (no `env` option). Not a sandbox (CONTENT_GUIDE rule 13); see gotcha 12.

### SQL exercises
There is **no separate SQL runner**. SQL exercises are ordinary `code` exercises: the learner
exports `query`/`ddl` strings, and the generated test code does
`const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;'); db.exec(<seed>)` then `db.prepare(mod.query).all(...)
.map((r) => ({ ...r }))` and `assert.deepStrictEqual(rows, <expected literal>)`.
Expected rows are computed **at authoring/build time** by running the reference SQL against
the seed (`content/src/11-sql-data/_sql.mjs` `rowsOf`, `queryEx`, `mutationEx`, `returningEx`,
`ddlEx`; same pattern in `content/src/15-fullstack-crud/_fx.mjs`) and baked in as JSON literals.

### stderr / ExperimentalWarning noise
- Nothing suppresses warnings (`grep` finds no `--no-warnings`, `NODE_NO_WARNINGS`,
  `--disable-warning`). On Node 22.16, `import('node:sqlite')` in the child prints an
  ExperimentalWarning to stderr.
- `gradeCode` is immune: pass/fail comes only from `results.json`; stderr is merely returned
  (and the client prints it under "Console output" — `client/src/components/ExercisePanel.tsx:20,38`).
- `normalizeOutput` comparison for output exercises never sees stderr (stdout only).
- **But `tools/generate.mjs` L75 treats any stderr as failure** for AUTO output snippets:
  `if (r.timedOut || r.stderr) failures.push(...)`. So any `outputEx` touching `node:sqlite`
  fails the build -> BootForge authors used quizzes instead (the "AUTO-stderr" gotcha).

Grader tests: `tests/grade-core.test.mjs` (114 lines, vitest) — pass/fail diagnostics, syntax
& TS errors, timeout, async, stdout separation, export identity, early exit, circular values,
`runSnippet` exit codes, `normalizeOutput`.

## 2. Exercise JSON schema (compiled, `content/build/<courseId>.json`)

Type source of truth: `shared/types.ts` (188 lines). Hierarchy:
`Course {id, order, title, description, modules[]}` -> `Module {id, title, lessons[]}` ->
`Lesson {id, title, explanation (markdown, >=100 chars enforced), exercises[]}`.

Real example, verbatim (`js-fundamentals.json`):
```json
{
 "id": "js-fundamentals/control-flow/switch-and-ternary/yes-no",
 "type": "code",
 "title": "yesNo",
 "prompt": "Export a function `yesNo` that converts a boolean to the string `'yes'` or `'no'` with a ternary.",
 "difficulty": 2,
 "xp": 20,
 "language": "js",
 "starter": "export function yesNo(/* ... */) {\n  // your code here\n}\n",
 "solution": "export function yesNo(b) {\n  return b ? 'yes' : 'no';\n}",
 "tests": [
  {
   "name": "yesNo(true) → \"yes\"",
   "input": [
    true
   ],
   "code": "\n      assert.equal(typeof mod.yesNo, 'function', 'export a function named yesNo');\n      const got = mod.yesNo(...[true]);\n      assert.deepStrictEqual(got, \"yes\");\n    "
  },
  {
   "name": "yesNo(false) → \"no\"",
   "input": [
    false
   ],
   "code": "\n      assert.equal(typeof mod.yesNo, 'function', 'export a function named yesNo');\n      const got = mod.yesNo(...[false]);\n      assert.deepStrictEqual(got, \"no\");\n    "
  }
 ],
 "hints": [
  "The boolean IS the condition — no comparison needed."
 ],
 "explanation": "Writing `b === true ? …` is redundant: `b` is already a boolean and the ternary consumes it directly. Boolean-to-label conversion is the smallest possible ternary and a very common display helper.",
 "skills": [
  "js-fundamentals/control-flow"
 ]
}
```
Output example: `js-fundamentals/values/variables/output-let-reassign` has
`"code":"let score = 10;\nscore = score + 5;\n...console.log(bonus);"`, `"expected":"15\n30"`.

### Fields (union observed across all 16 build files)
| Field | Types | Meaning |
|---|---|---|
| `id` | all | Full path id `course/module/lesson/slug`; globally unique (generator expands slug) |
| `type` | all | `code` \| `quiz` \| `output` \| `written` |
| `title`, `prompt` | all | Markdown prompt; quiz default title "Quick check", output "Predict the output" |
| `difficulty` | all | 1 warmup / 2 standard / 3 challenge |
| `xp` | all | Default code/output 10/20/35; quiz `max(5, XP-5)` = 5/15/30 |
| `hints` | all | 0-3 progressive strings |
| `explanation` | all | Shown after solve (stripped from public payload) |
| `skills` | all (optional in type) | Stable lowercase ids; generator defaults `[courseId/moduleId]` |
| `format` | code, written (optional) | `debugging\|test-writing\|pr-review\|schema-migration\|incident\|project` |
| `reviewOf` | code, written (optional) | Full id of another existing exercise (alternate review) |
| `language` | code | `js` \| `ts` (output exercises have it deleted at build) |
| `starter` | code, written | Scaffold, never the answer |
| `solution` | code, written | **Reference solution inline in the JSON** (written: model answer) |
| `tests[]` | code | `{name, code, input?}` — `code` is AsyncFunction body over `mod`, `assert` |
| `options`, `answerIndex` | quiz | 2+ unique options; index of correct one |
| `code`, `expected` | output | Snippet + normalized stdout captured at build (`AUTO`) |
| `rubric[]` | written | `{id (kebab), label}`; self-assessed |

Public stripping (`server/content.ts:58-73` `toPublic`): code drops `solution/explanation/tests`
and adds `testNames`; quiz drops `answerIndex/explanation`; written drops `solution/explanation`;
output drops `expected/explanation`.

Reference solutions are validated by **execution**: `tools/validate.mjs` runs every code
`solution` through `gradeCode` against its own `tests`; output `expected` is produced by
really running the snippet in `tools/generate.mjs`. Formatted exercises additionally must have
their `starter` **fail** (validate.mjs L104-107).

## 3. Content pipeline

npm scripts (`package.json`): `build:content` = `node tools/generate.mjs`,
`validate:content` = `node tools/validate.mjs`, `stats:content` = `node tools/stats.mjs`,
`smoke` = `node tools/smoke.mjs`, `test` = `vitest run` (`tests/**/*.test.mjs`, 30s timeout).
Order: **generate -> validate -> (test) -> smoke**, per course with `--course <id>`.

Authoring: `content/src/NN-<id>.course.mjs` default-exports a course built with helpers from
`content/src/_lib.mjs` (221 lines): `codeEx`, `fnEx` (cases -> tests, `name` =
`fn(args) → expect`, `input` = args, optional `await:true`), `quiz` (answer by index or string),
`outputEx` (`expected = AUTO = '__AUTO_OUTPUT__'`), `writtenEx`, `lesson` (rejects duplicate
slugs), `module_`, `variants`, `code` (dedenting tag), `EXERCISE_FORMATS`. Helpers throw on
missing slug/title/prompt/solution/explanation/tests at import time.

`tools/generate.mjs` (105 lines): imports each spec (sorted filenames), expands ids, defaults
`skills`, checks type/format/written-rubric/duplicate ids, runs AUTO output snippets through
`runSnippet` with a promise pool (`--concurrency`, default 8, 1-32), fails on timeout/any
stderr/empty stdout, deletes `language` from output exercises, writes
`JSON.stringify(spec, null, 1)` to `content/build/<id>.json`. Exit 1 on any failure.

`tools/validate.mjs` (125 lines, flags `--course <id>`, `--skip-run`): schema pass — course
`id/title/description/modules`; every module has lessons; lesson explanation >=100 chars and
>=1 exercise; global id uniqueness; prompt + explanation present; difficulty in {1,2,3}; xp>0;
format enum; skills regex `^[a-z0-9]+(?:[/-][a-z0-9]+)*$` unique; quiz >=2 unique options and
answerIndex in range; output has code+expected; code has solution, tests, language js|ts;
written has model answer + unique kebab rubric ids; `reviewOf` targets another existing id
(across all built courses when `--course` is used). Run pass: 8 workers, `gradeCode(solution)`
must pass; formatted exercise starters must fail. Exit 1 on any error.

`tests/content-schema.test.mjs` repeats invariants over built JSON (incl. no leftover AUTO
sentinel); `tests/lib.test.mjs` covers the helpers.

**loaded === built invariant**: lives in the smoke suite, not validate — smoke counts
exercises straight from `content/build/*.json` (same `BOOTFORGE_CONTENT` dir the server reads)
and asserts `GET /api/health` `.exercises` equals it (`tools/smoke.mjs:28-35, 68-72`).
Server loader: `server/content.ts:10-27` (`loadContent`, env `BOOTFORGE_CONTENT`, logs counts).

## 4. Smoke suite — `tools/smoke.mjs` (304 lines), `npm run smoke`

Boots the real server on port **8921** with a temp `BOOTFORGE_DATA` dir, walks the API, kills it.
- Pre-check: if `GET /api/health` answers within 3s the port is busy -> FATAL exit 1 (L12-26).
- Spawn (verbatim, L41): `spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), BOOTFORGE_DATA: dataDir }, stdio: 'pipe' })`
  — comment L37-40 explains the tsx-CLI grandchild zombie on Windows.
- `waitFor` polls health up to 90s. Teardown: `server.kill()`, 500 ms delay, rm data dir, exit.
- Checks (30 `check()` call sites today; was 27 at the last memory note): health ok;
  loaded==built count; course list; course detail; lesson explanation >100; lesson exercises;
  code exercise present; solution/tests stripped; wrong code fails; failed submission +
  diagnostics persisted in history; reveal returns solution; reference solution passes grader;
  no XP after reveal; assisted mastery + 2 submissions; solved status persists; alternate review
  scheduled; walk first lesson of every module of every course; found quiz+output; quiz answer
  stripped; brute-force quiz: exactly one option passes, explanation returned, XP awarded;
  output expected stripped; wrong output fails; revealed output + `\r\n` passes (CRLF);
  TS exercise grades end to end; 404 lesson; 404 grade; `/api/run` prints 42; `/api/stats`.

## 5. Copy verdicts for BootQuest (server/ client/ cli/ tools/ seed/ content/, npm workspaces, Zod)

| Area | Verdict | Detail |
|---|---|---|
| `server/grade-core.mjs` | **Copy verbatim** (rename only) | -> e.g. `server/src/runner/js/grade-core.mjs`. Keep RUNNER, results-file protocol, result validation, `run()`. Changes allowed: rename `bootforge-` tmp prefix/MARKER, drop dead `MARKER`, add `--disable-warning=ExperimentalWarning` to the child args (`[ '--disable-warning=ExperimentalWarning', 'runner.mjs' ]`, Node >=21.3) and optionally a minimal `env`. Keep it plain `.mjs` so tools import it without tsx. Wrap the *result* in a Zod schema at the server boundary rather than editing internals. |
| `tests/grade-core.test.mjs` | **Copy verbatim** | Fix import path only. It is the grader's regression net. |
| Compiled JSON `content/build/*.json` | **Import as data** (seed source) | BootQuest's `seed` import reads these files; define a Zod schema mirroring §2 (discriminated union on `type`, optional `format/skills/reviewOf/input`). Must accept old JSON without metadata (CONTENT_GUIDE). Store `solution`/`tests` server-side only. |
| `shared/types.ts` | **Copy with adaptation** | Becomes the Zod schemas (`z.infer` replaces the interfaces) in a shared workspace package. |
| `tools/validate.mjs` | **Copy with adaptation** | Becomes `seed:validate`: read from BootQuest's store/import dir, keep every schema rule + run-every-solution + starter-must-fail. Add: per-course foreground runs, completion marker, quarantine list (W2 gate says "0 unquarantined failures"), retry-once-on-timeout before reporting. |
| `tools/generate.mjs` + `content/src/_lib.mjs` | **Copy with adaptation, only if BootQuest authors new JS content** | Per plan, new content is JSON, not template literals: keep the AUTO-capture idea (run snippet, store normalized stdout) and the id-expansion/default-skills logic as a JSON-in/JSON-out step. Change the AUTO failure rule to `timedOut || exitCode !== 0` (or filter ExperimentalWarning) instead of `|| r.stderr`. `_lib.mjs` helpers `fnEx`/`variants`/`code` are worth keeping for any scripted generation. |
| `content/src/11-sql-data/_sql.mjs` pattern | **Copy the pattern** | Build-time expected rows + `{...r}` spread + `PRAGMA foreign_keys = ON`. |
| `tools/smoke.mjs` | **Copy with adaptation** | Keep busy-port pre-check, `process.execPath --import tsx` spawn, loaded==built assertion, temp data dir, 500 ms Windows release delay. Re-point endpoints/env names to BootQuest's API and workspace entry (`server/src/index.ts`), add XP-ledger/streak/FSRS checks. |
| `server/content.ts` | **Reimplement** (small) | In-memory index + `toPublic` stripping is fine as a reference, but BootQuest stores content via seed/DB with `content_ref`; keep the stripping rules exactly. |
| `server/db.ts`, `server/learning.ts` | **Reimplement** | BootQuest has its own schema (append-only `attempt/run/evidence/xp_event`, FSRS via ts-fsrs). Reuse only: `createRequire` load of `node:sqlite` (db.ts L6-8), `BEGIN IMMEDIATE` submission txn (L130-149), anti-cheese rule "reveal => 0 XP, mastery 'assisted'" (L69-94). |
| `server/index.ts` routes | **Reimplement** with Zod | Hand-rolled `typeof` checks today; reference for endpoint semantics (`/api/grade`, `grade-quiz`, `grade-output` with reveal-on-wrong, `reveal`, `run`, `hint`). |
| `client/` | **Reimplement** | Reference only (`ExercisePanel.tsx` output formatting). |
| `tools/stats.mjs` | Copy with adaptation | Trivial census; useful for the 2,559/2,571 count assertion. |

## 6. Gotchas confirmed in code

1. **node:sqlite rows have a null prototype** — every SQL test spreads: `.map((r) => ({ ...r }))`
   or `{ ...row }` before `deepStrictEqual` (`_sql.mjs:4-5,20,58`; `15-fullstack-crud/_fx.mjs:3-4`;
   lesson text `integration.mjs:2519`). `deepStrictEqual` compares prototypes, so un-spread rows
   fail against plain literals. Same rule applies to Zod parsing/serialization in BootQuest.
2. **node:sqlite `lastInsertRowid` is a BigInt** — wrap in `Number()` (`db.ts:141,180`;
   `data-layer.mjs:1570`). Booleans are 0/1 integers.
3. **Vite/vitest doesn't know `node:sqlite` as a builtin** — `db.ts:6-8` loads it via
   `createRequire(import.meta.url)('node:sqlite')`. Inside grader tests, `await import('node:sqlite')`
   works because the child is plain node.
4. **ExperimentalWarning on stderr** — harmless to `gradeCode`, fatal to AUTO capture
   (`generate.mjs:75`), visible to learners. Fix: `--disable-warning=ExperimentalWarning` on the
   child (verified on this box's Node 22.16: silences the sqlite warning) + exit-code AUTO check.
5. **Backtick escaping** — CONTENT_GUIDE rule 9: specs are template literals, so markdown/code
   backticks must be `\``; memory note calls it the #1 authoring bug. Confirmed throughout
   `_sql.mjs` (e.g. L255 `` Table \`users\` ``). BootQuest's JSON-content rule removes this class
   of bug; never re-introduce JS-literal content files.
6. **CONTENT_GUIDE rule 6 is stale**: says `new Function('mod','assert',code)`; the runner
   actually uses `AsyncFunction` (top-level `await` allowed in test code). `shared/types.ts`
   comment is stale the same way. Document the AsyncFunction contract in BootQuest.
7. **Tests share one process and one module instance**, sequentially — module-level state leaks
   between tests; authors must make tests order-independent or reset state.
8. **TS is transpiled, not type-checked** (esbuild). TS tests must assert runtime behaviour.
9. **Grader cold start ~4s per submission**; full 1,825-solution validate under 8-way
   concurrency can flake the 8s timeout and was once memory-reaped as a background job on this
   laptop — run per course in the foreground, re-run timeouts before calling them failures.
10. **Zombie servers on Windows** — spawning via shell or `tsx` CLI then `kill()` orphans the
    real node grandchild (stale server on 8921 once passed smokes with old content). Fix is in
    `smoke.mjs:37-44` plus the busy-port check and loaded==built assertion.
11. **Output comparison** is `normalizeOutput` on both sides (CRLF, trailing whitespace,
    surrounding blank lines). A wrong output answer triggers `recordReveal` because the
    diagnostic shows `expected` (`index.ts:202-205`) — keep that anti-cheese semantic.
12. **Result-file trust** — the child can forge `results.json` (it can read `tests.json` names).
    Fine for a local single-user tool; don't claim sandboxing (guide rule 13 is explicit).
13. **CRLF** — git warns LF->CRLF on these files; add `.gitattributes` `* text=auto eol=lf`.
    Limits: `express.json({ limit: '256kb' })` on submissions, `maxBuffer` 1 MB on child output.
