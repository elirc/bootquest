# Testing Rationale

## Test: `rejects VIEWER from triggering allocation`
File: `tests/permissions/allocation-run-permission.test.ts`

Why this matters in production:
- This verifies that read-only roles cannot trigger mutating, high-impact workflows (`runAllocation`).
- It directly protects against privilege escalation bugs introduced during policy refactors.

What a fuller production suite would add:
- Route-level integration tests for `POST /api/allocation-runs` returning 403 with real middleware wiring.
- Matrix tests over every permission in `ROLE_MATRIX` to detect accidental access broadening.

## Test: `rejects line items with non-positive amount`
File: `tests/validation/cost-schema.test.ts`

Why this matters in production:
- Financial systems are only as trustworthy as ingress validation.
- Rejecting invalid amounts catches malformed vendor exports before they contaminate historical reports.

What a fuller production suite would add:
- Boundary tests for max payload size, malformed date strings, and missing nested tags.
- Contract tests for API responses (422 payload shape and error details).

## Test: `rejects COMPLETED -> RUNNING transition`
File: `tests/state/allocation-run-transition.test.ts`

Why this matters in production:
- Allocation runs are audit records; illegal state rewinds break operational and financial trust.
- This test guards the state machine from accidental transition-map regressions.

What a fuller production suite would add:
- Transition table tests covering all valid and invalid edges.
- Integration tests ensuring failed worker executions always end in terminal `FAILED` status.

## Test: `always applies tenantId filter in monthly list query`
File: `tests/isolation/cost-repository-isolation.test.ts`

Why this matters in production:
- Cross-tenant data leakage is a critical security failure for finance data.
- This test ensures repository code keeps tenant isolation in place even after query refactors.

What a fuller production suite would add:
- End-to-end tests with two seeded tenants proving one tenant cannot read another tenant's cost/report records.
- Static analysis or shared repository helper tests to enforce tenant scoping conventions project-wide.

## Separate suite: `tests/runtime-allocation-state-lab.test.mjs`

This file is not collected by `npm test` (`vitest.config.ts` includes only `tests/**/*.test.ts`); run it with `node --experimental-vm-modules --test tests/runtime-allocation-state-lab.test.mjs`. It loads the real `src/services/allocationRunService.ts` with the repository, engine and queue modules stubbed, and covers every legal edge (PENDING→RUNNING/FAILED, RUNNING→COMPLETED/FAILED) plus terminal and skipped-phase refusals with the real `ValidationError` (status 422). That is the "transition table tests covering all valid and invalid edges" item above, at the pure-function level only.

## Gaps worth knowing before you trust the suite

- The worker's catch block writes `FAILED` directly through `updateAllocationRunStatus()` without calling `assertValidRunTransition()` (`src/services/allocationRunService.ts:102-113`), so the transition tests do not prove that a `COMPLETED` run cannot later become `FAILED`.
- Only `src/repositories/costLineItemRepository.ts` accepts an injectable client; every other repository imports `db` directly, so the isolation test pattern cannot be reused for runs, rules, budgets or reports without module mocking.
- Nothing tests `computeAllocationResults()` (`src/services/allocationEngineService.ts:27-105`): the >100% guard, the project fallback for unmatched items, rounding, or the fact that `summary.matchedRules` is the count of active rules rather than matched ones.
- Nothing tests the chargeback report's exact-equality run lookup (`src/repositories/reportRepository.ts:14`) against runs created with a non-normalised `monthStart` (`src/services/allocationRunService.ts:66`).
