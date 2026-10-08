# Graduated practice

Attempt each level before reading [06](06-SOLUTIONS-AND-REVIEW.md). For each prediction, record actor, tenant, current status, requested status, and the first forbidden side effect.

**Level 1 — policy table.**
**Goal:** list all legal targets from PENDING and RUNNING and identify terminal statuses.
**Check:** your answer matches `src/services/allocationRunService.ts:20-25` exactly.

**Level 2 — skipped phase.**
**Goal:** predict the error for PENDING→COMPLETED and explain why a worker must claim RUNNING first.
**Check:** `ValidationError`, status 422, code `VALIDATION_ERROR`, message "Invalid run transition: PENDING -> COMPLETED" (`:31`).

**Level 3 — atomic claim.**
**Goal:** design a conditional claim that returns count zero; contrast it with the current read-then-update.
**Check:** your `where` includes `status: "PENDING"` and your design names `allocationRunRepository.ts:67-72` as the line that changes.

**Level 4 — failure after RUNNING.**
**Goal:** computation throws after RUNNING. Predict the terminal state and the persisted fields.
**Check:** FAILED, `completedAt` set, `failureReason` = error message, `startedAt` kept, previous results untouched because `replaceAllocationResults` never ran (`:102-113`).

**Level 5 — duplicate delivery.**
**Goal:** the same job is processed twice, the second time after the first completed. Predict the final status.
**Check:** FAILED, overwriting COMPLETED, with `failureReason` "Invalid run transition: COMPLETED -> RUNNING".

**Level 6 — allocation arithmetic.**
**Goal:** a $100.00 item tagged `team=core` matches one active rule at 60% targeting team A. Predict result rows and summary.
**Check:** one row of 60 to team A; `totalInputAmount` 100, `totalAllocatedAmount` 60; the remaining 40 is not represented by any row and is not flagged as unallocated (`src/services/allocationEngineService.ts:77-92`).

**Level 7 — summary naming.**
**Goal:** a tenant has 5 active rules and none match this month's items. What is `summary.matchedRules`?
**Check:** 5 — the field is `rules.length` (`allocationEngineService.ts:99`), not a match count.

**Level 8 — month keys.**
**Goal:** post a run with `monthStart` `2026-03-31T23:30:00-05:00`, then with `2026-03-31T23:30:00Z`. What happens to each?
**Check:** the first is rejected with 422 because Zod's `.datetime()` without `{ offset: true }` accepts only `Z` timestamps (`src/lib/validation/allocationSchemas.ts:25-27`). The second is accepted; March is computed (`src/lib/time/month.ts:17`), but the stored key is that instant, which never equals the March window start, so the report returns `NO_COMPLETED_RUN`.

**Level 9 — tenant boundary.**
**Goal:** as a FINOPS_ANALYST in tenant A, create a rule targeting a team id from tenant B. What stops it?
**Check:** nothing in `allocationSchemas.ts:9-23`, `allocationRuleService.ts:14-29` or the schema relation at `prisma/schema.prisma:148`.

**Level 10 — retry policy.**
**Goal:** design an explicit retry for FAILED runs including tenant scope, authorization, idempotency and tests.
**Check:** you decide "new run" vs "reopen", and if reopening you add a FAILED→PENDING edge rather than letting FAILED→RUNNING happen silently.
