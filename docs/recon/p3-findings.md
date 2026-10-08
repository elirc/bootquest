# P3 findings — `node-test-file` check runner spike (W1.5)

Source: `elirc/signalpost-swe-bootcamp` @ `ff8446042a16d0aaef1687b34932b4f9137e6e0d` (GitHub `main`
== local mirror `Desktop\claiufe\signalpost-swe-bootcamp` HEAD on 2026-10-07; mirror bytes hash to
the GitHub blob shas). Runner: `server/src/runners/node-test-file/index.ts`; 21 vitest cases green.

## `check.spec` JSON for `type = 'node-test-file'` (what the runner must know)
| field | req | notes |
|---|---|---|
| `repo` | yes | `owner/name`, case-sensitive |
| `sha` | yes | pinned commit the check was recorded at |
| `path` | yes | repo-relative POSIX path of the check (`practice/checks/u01.test.mjs`); workspace mirrors it |
| `sha256` | yes | of the exact LF bytes; verified before EVERY run, mismatch ⇒ `CheckIntegrityError`, nothing spawned |
| `blob_sha` | rec. | git blob sha from the tree at `sha`; ties bytes to provenance (cheap second check) |
| `learner_path` | yes | where the submission is written (`practice/learner/u01.mjs`); must stay inside workspace |
| `needs_tsx` | yes | `true` ⇒ `--import <file URL of BootQuest's node_modules/tsx/dist/loader.mjs>` |
| `module_type` | opt | workspace-root `package.json` `type`; signalpost is `"module"` (default) |
| `timeout_ms` | opt | default 30 000; whole `node --test` tree killed (`taskkill /T /F`) |
| `expected_tests` | rec. | top-level test names from a reference run; pass requires each reported `ok` |
| `starter` | opt | `{path, blob_sha, sha256}` of the upstream learner stub (seed/UI starting code) |

Not in spec (runtime inputs): `exercise.checkFile` = local cached bytes (W4 per-SHA cache), and
`submission.code`. Result is the canonical `{pass, output, failures[{name,message,expected?,actual?}], durationMs}`;
integrity refusal is a thrown error, not a learner fail — the caller must record no attempt.

## U01 / U02 / U03 differences
- **U01** `u01.test.mjs` → `../learner/u01.mjs`; 2 tests; stub THROWS `"U01 learner implementation required"`
  (failures carry that message, no expected/actual). Plain `node --test`.
- **U02** `u02.test.mjs` → `../learner/u02.mjs`; 1 test; stub is a deliberately DEFECTIVE implementation
  (off-by-one loop + case/trim), not a throw — failures carry `expected`/`actual` from `deepStrictEqual`.
- **U03** `u03.test.ts` imports `../learner/u03.ts` **with the `.ts` extension**; needs `--import tsx`
  on node 22.16 (proven: without tsx it fails). U03-02 acceptance ALSO requires "practice typecheck pass"
  (`tsc -p practice/tsconfig.json`, which `extends ../tsconfig.json`) — a second check this runner does
  not cover; model it as an extra `tsc` check or drop that leg explicitly. Not faked here.
- Check file paths are NOT structured fields in program.json: they appear only in prose in ticket
  `UNN-02` `context`/`acceptance` (e.g. "node --test practice/checks/u01.test.mjs passes…"). W4 must
  either regex those strings or seed the specs from a recorded table (fixture `checks.json` is that table).

## Mechanics that proved load-bearing
- Use `--test-reporter=tap --test-reporter-destination=stdout`. node 22 TAP gives per-test YAML with
  `error`, `failureType`, `expected`, `actual`, `operator`; nested suites indent by 4 (parser joins with ` > `,
  skips `subtestsFailed` parent rows). Learner `console.log` is re-emitted as `# …` comments, so a
  submission cannot inject `ok`/summary lines.
- `node --test <file>` runs the file in a GRANDCHILD process: timeout must kill the tree (verified both
  pids dead after `taskkill /T /F`; no node.exe left after the suite).
- **`process.exit(0)` at learner import fakes a pass in raw node** (`ok 1 - practice\checks\u01.test.mjs`,
  `# pass 1`, exit 0). Runner rejects the synthetic file-level point and enforces `expected_tests`.
- Strip `NODE_OPTIONS`, `NODE_TEST_CONTEXT` (else child speaks the internal protocol, not TAP) and `VITEST*`.
- Check copied fresh per run and `chmod 444`: a submission writing `../checks/u01.test.mjs` gets EPERM on
  Windows; post-run re-hash flags it anyway. `fs.rm({recursive, force})` still removes the read-only copy.
- The fixture tree contains `u03.test.ts`: any app vitest `include` of `**/*.test.ts` must exclude
  `server/src/runners/node-test-file/fixtures/**` (it broke the first run).
- Pinned bytes must be committed `-text` (`.gitattributes`): this machine has `core.autocrlf=true`, and a
  CRLF copy is (correctly) refused by the sha256 gate.
- `tsx` must be a runtime **dependency** of `server` (resolved via `createRequire(import.meta.url)`), not
  only a root devDependency, or production runs of TS checks break.

## Residual risk (not solved, by design of a local single-user app)
A submission shares the module graph with the check, so it could monkeypatch `node:assert` and fake
green. Honesty is enforced elsewhere (attempt rows, explain-back, retest); a cheap later guard is a
static flag on submissions importing `node:assert`/`node:test` or calling `process.exit`.

## What the estate memo (§5) got wrong or left out
- signalpost `package.json` has `"engines": {"node": ">=24"}`; BootQuest runs it on 22.16 — fine for U01–U03
  with tsx, but not upstream's supported runtime (inferred, not run: on 24 default type-stripping should handle U03's erasable-only TS without tsx).
- U03's acceptance includes a typecheck leg, not just the test file.
- Check paths live only in ticket prose, not a schema field (memo implies a discoverable layout).
- U02's starter is defective code, not a throwing stub ("starters throwing …" is true only for U01/U03).
- Otherwise confirmed: 3 check files only, `../learner/uNN.*` relative imports, `--import tsx` for U03.
