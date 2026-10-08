# Architecture Overview

This project (`internal-case-management-system`, `package.json:2`) is a Next.js 15 App Router application with a backend-heavy structure for internal operations casework. HTTP entry points live in `src/app/api/**/route.ts`, auth and validation boundaries in `src/lib/**`, business rules in `src/services/**`, and Prisma queries in `src/repositories/**`. Data is PostgreSQL via Prisma 6 (`prisma/schema.prisma:5-8`); passwords use bcrypt (`src/lib/auth/password.ts:3-9`); sessions are opaque random tokens stored hashed in a `Session` table (`src/lib/auth/session.ts:19-25`).

Line numbers below refer to this clone. Re-check them after edits.

## Layers

| Folder | Role | Concrete example |
|---|---|---|
| `src/app/api` | 13 REST route files | `src/app/api/cases/route.ts:32-42` parses the body and calls `createCase()` |
| `src/app` (pages) | 5 pages (`/`, `/login`, `/cases`, `/cases/[caseId]`, `/reports`) | `src/app/cases/[caseId]/page.tsx:4-19` renders `CaseDetailView` |
| `src/components` | UI only | `src/components/cases/CaseDetailView.tsx:25-270` triggers mutations, owns no rules |
| `src/hooks` | React Query access | `src/hooks/useCaseDetail.ts:30-46` posts and invalidates `["cases"]` plus the detail key |
| `src/lib/auth` | session, policy, guards | `authorize.ts:42-58` (`buildCaseAccessWhere`), `permissions.ts:29-88` (matrix) |
| `src/lib/middleware` | `withAuth` wrapper | `withAuth.ts:32-43` rejects with 401 before the handler runs |
| `src/lib/validation` | Zod schemas + `parseOrThrow` | `caseSchemas.ts:16-61`, `parse.ts:14-22` |
| `src/lib/workflow` | pure status graph | `caseWorkflow.ts:13-22` |
| `src/lib/http` | response helpers, error mapper, browser client | `handle-route-error.ts:9-38` |
| `src/services` | business behavior | `caseService.ts:394-456` (`transitionCase`) |
| `src/repositories` | Prisma queries and include graphs | `caseRepository.ts:63-165` (detail include) |
| `prisma` | schema and seed | `seed.ts:6-150` seeds 3 teams, 5 users, 1 case |

## Request shape

- Client screens call hooks such as `src/hooks/useCases.ts:30-50`.
- Hooks call REST endpoints through `requestJson()` (`src/lib/http/client.ts:11-31`), which throws an `ApiError` carrying the HTTP status and returns the raw JSON body (there is no `{ data }` envelope in this project).
- Protected routes are wrapped in `withAuth(...)` (`src/lib/middleware/withAuth.ts:32-43`), so the session lookup runs **before** the route body. The route body then parses input with `parseOrThrow` and calls a service.
- Services apply permissions (`ensurePermission`), visibility scope (`buildCaseAccessWhere`), workflow rules and audit logging, opening `db.$transaction` for writes.
- Every route catches errors with `handleRouteError()` (`src/lib/http/handle-route-error.ts:9-38`), which maps five known error classes to their own `status` and logs everything else before returning 500.

## Route inventory

| Route | Method | Wrapper | Service permission |
|---|---|---|---|
| `/api/auth/login` | POST | none | none (credential check) |
| `/api/auth/logout` | POST | none | none |
| `/api/auth/session` | GET | none | none; returns `{ user: null }` when signed out |
| `/api/cases` | GET / POST | `withAuth` | `case:view` / `case:create` |
| `/api/cases/[caseId]` | GET / PATCH | `withAuth` | `case:view` / `case:update` |
| `/api/cases/[caseId]/transition` | POST | `withAuth` | `case:transition` |
| `/api/cases/[caseId]/notes` | POST | `withAuth` | `note:create` |
| `/api/cases/[caseId]/deadlines` | POST | `withAuth` | `deadline:manage` |
| `/api/cases/[caseId]/attachments` | POST | `withAuth` | `attachment:create` |
| `/api/reference-data/teams` | GET | `withAuth` | `case:view` |
| `/api/reference-data/assignable-users` | GET | `withAuth` | `case:view` + team check |
| `/api/reports/queue-summary` | GET | `withAuth` | `report:view` |
| `/api/admin/escalation-sweeps` | POST | `withAuth` | `admin:run-escalation` |

Permissions are checked in services, not routes, so the route file alone never tells you who may call it. Two permissions in the matrix are never checked anywhere: `case:assign` and `escalation:manage` (`src/lib/auth/permissions.ts:17`, `:23`; a repo-wide grep finds them only in the matrix).

## Why no multi-tenancy

The design deliberately has one company and team-scoped visibility (`src/lib/auth/authorize.ts:42-58`). Adding tenants later would mean a `tenantId` column, a tenant field on `AuthenticatedActor` (`authorize.ts:15-21`), and an extra key in `buildCaseAccessWhere`. The service and repository boundaries already route every case read through that one function, which is what makes the later change tractable.

## Senior-review findings (architecture level)

Confirmed by reading this clone; none were reproduced against a running server.

- **A1. Client filters can replace the team scope.** `buildCaseListWhere()` spreads `accessWhere` first and then the client's `owningTeamId` filter (`src/services/caseService.ts:96-100`). Because both set the same key, the later spread wins: a `CASE_WORKER` calling `GET /api/cases?owningTeamId=<other team id>` receives that team's cases. `getScopedQueueSummary()` has the same shape (`src/services/reportService.ts:19-22`) despite its own comment saying filters are "additive". The scope test (`src/services/caseService.test.ts:23-47`) does not pass an `owningTeamId`, so it cannot see this.
- **A2. Restricted text leaks through the audit log.** Escalation comments become restricted notes (`caseService.ts:443-450`), but the same comment is copied into audit metadata (`:436-440`). `serializeCaseDetail` filters notes only (`:47-53`), and the detail include returns the 20 newest audit rows with `metadata` (`src/repositories/caseRepository.ts:150-164`). A case worker on the owning team can read the restricted comment from the JSON.
- **A3. Escalations have no exit.** Nothing in `src/` ever sets an escalation to `ACKNOWLEDGED` or `RESOLVED`, yet `transitionCase` refuses `CLOSED` while any escalation is unresolved (`caseService.ts:416-422`). Once the sweep escalates a case, it can be resolved but never closed.
- **A4. The sweep bypasses the workflow graph.** `runEscalationSweep` writes `status: ESCALATED` directly (`src/services/escalationService.ts:44-48`), including from `NEW`, `TRIAGED` and `RESOLVED`, none of which allow `ESCALATED` in `allowedTransitions` (`src/lib/workflow/caseWorkflow.ts:14-15`, `:19`).
- **A5. Read-validate-write without a predicate.** Every case mutation loads the case outside the transaction (`getCaseForActor`, `caseService.ts:65-74`), validates, then updates by bare id (`caseRepository.ts:199-207`). Two concurrent transitions can both pass `assertAllowedTransition` against the same old status.

## Exercises

1. **Goal:** confirm the wrapper ordering. **Check:** in `withAuth.ts:33-41`, identify the line that would have to move for an unauthenticated request to reach `parseOrThrow`. (Answer: none can; the handler is only invoked on `:41` after the null check on `:36`.)
2. **Goal:** reproduce finding A1 safely. **Check:** sign in as `case.worker@corp.local` (Billing Review team), look up the Operations team id in the database, and call `GET /api/cases?owningTeamId=<ops id>`. A correct implementation returns an empty `items` array; this one returns Operations cases if any exist.
3. **Goal:** map permissions to call sites. **Check:** grep `src/services` for `ensurePermission(` and list each permission string. You should find 9 distinct strings; the 12-permission matrix minus that set is `case:assign`, `escalation:manage` and `note:view:restricted` (the last is used, but through `canViewRestrictedNotes`, `authorize.ts:60-62`).
</content>
