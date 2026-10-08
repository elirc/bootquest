# Seed-factory fixtures: provenance

Real excerpts were copied on 2026-10-08 from **sha-exact trees**: each estate mirror under
`Desktop\claiufe` was fetched (read-only) into a scratch ref and extracted with `git archive`, so
the bytes are the committed blobs at the pinned sha, not the mirrors' working trees. Nothing in a
mirror was modified. Files are byte-for-byte (CRLF and mixed line endings kept; see `.gitattributes`
`-text`). These are data, never compiled or collected (excluded in tsconfig + vitest config).

| Fixture | Repo @ sha | What | Why |
|---|---|---|---|
| `ww6/` | elirc/ww6 @ `09751ceaee909a30e5c4b5ff5cdde99880b9a3e5` | `astraupskill/05-PRACTICE.md` + `06-SOLUTIONS-AND-REVIEW.md` (whole files), every file those two guides cite (21 files incl. `vitest.config.ts`), `docs/learning/testing-rationale.md` (whole) | sectioned Goal/**Check** with bold-lead labels; F-table findings; real inheritAmbiguous + cross-block continuations; explain-back unit; kata context (`src/services/allocationEngineService.ts`, mixed CRLF/LF). A seed:quests run over this fixture is byte-identical to the run over the full mirror tree. |
| `zz9/` | elirc/zz9 @ `a1982f8801804306ad317c135354f014d2c9ca70` | `docs/architecture/auth-and-permissions.md` lines 84-89 (offset +83: `## Exercises` + four inline items), `src/services/caseService.ts`, `docs/architecture/README.md` | inline `N. **Goal:** ... **Check:** ...` shape (estate-contract §2.2) |
| `hnjobtrack/` | elirc/hnjobtrack @ `a9d10809613954b2cb8bea5df36b9faf3b931d2a` | `training/_answers/review.md` lines 105-118 (offset +104: R18-R21), `frontend/src/app/profile/page.tsx`, `frontend/src/app/auth/callback/route.ts` | R-heading findings; R19/R20 carry no file:line and are (correctly) quarantined |
| `signalpost-swe-bootcamp/` | elirc/signalpost-swe-bootcamp @ `ff8446042a16d0aaef1687b34932b4f9137e6e0d` | `docs/curriculum/program.json` (whole) | provenance for the variants drafts: U01 `transfer` (line 35), U02 `transfer` (line 203) |

The P4 citation fixtures (`../../citations/fixtures/{ww6,j1,zz8}`, incl. the deliberately broken
`ww6/astraupskill/CORRUPTED-REVIEW.md`) are reused read-only by the tests (numbered findings shape,
unresolvable-citation demo).

## Drafts (`drafts/`)

Hand-authored stand-ins for what an LLM seed session will write, grounded in the real sources above:

- `explainback-ww6-testing-rationale.json` — 3 questions x 5-6 key points, each quoting
  `docs/learning/testing-rationale.md` verbatim or citing `src/services/allocationRunService.ts:102-113`.
- `variants-signalpost-U01.json`, `variants-signalpost-U02.json` — changed-example retests from the
  U01 / U02 `transfer` fields; each wrong solution encodes the misconception the transfer names
  (equality boundary; undefined vs null; off-by-one that fails only at the last item).
- `patches-ww6.json` — two katas: (1) F9 (`allocationEngineService.ts:99`, `matchedRules: rules.length`)
  as an adapted, test-bearing module; (2) the verbatim engine file with a "refactor" diff that moves
  `totalInputAmount` past the unmatched-item `continue`. Diffs were produced with
  `git diff --no-index` (the real bytes mix CRLF and LF).
- `planted-*.json` — deliberately bad variants of the above, one defect each (see the file names).

## Planted (`planted/`)

Synthetic, clearly marked NOT estate content:

- `multikey/` — two exercises share a Check, so a goal-check quiz offering both is multi-keyable.
- `andie/` — stand-in for the andie repo. Its `astraupskill/VERIFICATION.md` is **never committed**:
  tests and `npm run seed:demo:planted` write it into a temp dir with a fake token assembled at
  runtime (`demo/plant.ts`), so no token-shaped string exists in the repo.
