# Separate solutions and review rubric

## Solutions

1. PENDING → RUNNING, FAILED; RUNNING → COMPLETED, FAILED; COMPLETED and FAILED are terminal.
2. 422 `VALIDATION_ERROR`; completion without execution skips work.
3. Conditional claim on `status: "PENDING"`; on count 0, return without computing. Future design, not current runtime evidence.
4. FAILED with `failureReason`; old results for this run id do not exist yet because replacement never ran.
5. FAILED over COMPLETED, because the catch (`src/services/allocationRunService.ts:102-113`) does not consult the policy. The current code enqueues each run once (`:71-75`), so this needs at-least-once delivery or a manual re-enqueue to occur — but nothing prevents it.
6. One row of 60; the 40 remainder is silent.
7. 5.
8. 422 for the offset form; March computed but not reportable for the `Z` form.
9. Nothing; cross-tenant foreign keys are accepted.
10. Explicit product decision; prefer a new run row so COMPLETED/FAILED stay immutable.

## Senior review findings

From code reading in this clone; none reproduced against a database.

| # | Sev | Location | Finding |
|---|---|---|---|
| F1 | Critical | `src/lib/auth/session.ts:13-22`, `src/lib/http/client.ts:7,31` | Authentication is a bare `x-user-id` header. Any caller with a user id is that user; the id the UI uses is shipped in the public bundle via `NEXT_PUBLIC_`. |
| F2 | High | `src/services/allocationRunService.ts:66`, `src/repositories/reportRepository.ts:14` | Run `monthStart` is stored un-normalised but the report looks it up by equality with the normalised window start. Any non-first-of-month input produces runs the report never sees. `budgetService.ts:18` has the same un-normalised store despite the comment at `:12` claiming normalisation. |
| F3 | High | `src/services/allocationRuleService.ts:20-28`, `src/services/budgetService.ts:13-21`, `src/services/ingestionService.ts:14-26`, `prisma/schema.prisma:148-149` | Body-supplied `teamId`/`projectId` are never checked against the caller's tenant; relations are id-only. Cross-tenant references are possible. |
| F4 | High | `src/services/allocationRunService.ts:35-61`, `src/repositories/allocationRunRepository.ts:67-72` | Read-then-update transitions with no status predicate; catch path writes FAILED unguarded (`:106-112`). Terminal states are not durable. |
| F5 | Medium | `src/lib/queue/allocationQueue.ts:19-29` | In-process `setTimeout` queue. Jobs are lost on restart; PENDING runs are never recovered. If the FAILED write in the catch itself throws, the rejection escapes the `setTimeout` callback unhandled. |
| F6 | Medium | `src/services/anomalyService.ts:53-55`, `src/repositories/anomalyRepository.ts:36-39` | `refresh=true` inserts a fresh copy of every anomaly each call (no dedupe), and the read filters by `detectedAt`, so refreshing a past month returns nothing new. |
| F7 | Medium | `src/services/allocationEngineService.ts:56,79,91` | Money handled as JS `number` from `Decimal`; per-row amounts are not rounded before writing `Decimal(12,2)`, so team/project totals can drift from the input total by cents. Partial weights (<100%) leave unreported remainders. |
| F8 | Medium | `prisma/schema.prisma:156-173` | No uniqueness on `(tenantId, monthStart)` for runs and no in-flight check in `createRunAndQueue`; concurrent runs for one month race, and the report silently picks the latest completed. |
| F9 | Low | `src/services/allocationEngineService.ts:99` | `summary.matchedRules` reports `rules.length` (all active rules), not matched rules. |
| F10 | Low | `src/app/api/cost-line-items/route.ts:27-28` | `limit`/`offset` are unvalidated `Number(...)`: NaN → 500, negative or huge values pass through. `monthQuerySchema` (`src/lib/validation/reportSchemas.ts:9-12`) exists but no route uses it. |
| F11 | Low | `src/services/ingestionService.ts:12-34` | Re-ingesting the same export duplicates every line item; no natural key or upsert, despite the comment at `:13` about idempotent refeeds. |
| F12 | Low | `src/services/forecastService.ts:12-17` | The "forecast" for month M is 1.08 × M's own actuals; refreshing the current month changes the prediction as data arrives. Delete-then-create is not transactional (`src/repositories/forecastRepository.ts:19-32`). |
| F13 | Info | `src/app/api/budgets/route.ts:23-28` | `TEAM_MANAGER` can create budgets for any team in the tenant, as the in-code note at `:24` already admits. |

## Test blind spots

- No test touches the worker, the engine, the report or any route.
- Only `costLineItemRepository` accepts an injected client, so tenant-scope tests exist for one repository out of eight.
- `npm test` does not run the `.mjs` lab (`vitest.config.ts:13`).

## Rubric

Review the lab for actual production-module execution, full legal-edge coverage, invalid-edge coverage and stated limits. It earns state-policy credit, not queue or database credit. Reject a copied state table or a test that only checks array membership. A strong review names F4 and F5 from the code; a senior review also finds F1–F3 and ranks F1 first because every other control depends on knowing who the caller is.
