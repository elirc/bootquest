Each question is answerable from the file named in the step. Answers cite the line.

| Step | Question | Answer |
| --- | --- | --- |
| 1 | What does `GET /api/employees` return with no headers? | 200 and the full northstar directory: the request is treated as `user_hr_admin` (`session.ts:17-19`, `demo-sessions.ts:13-20`). |
| 1 | Which status does an empty `x-demo-user-id: ""` produce? | 401. `??` keeps empty strings, and `demoSessions[""]` is undefined (`session.ts:17,22-24`). |
| 2 | Can `assertPlatformRole` ever throw in the current code? | No. Its only caller already checked the role is in the allowed list (`integration-service.ts:108,115-119`). |
| 2 | Does `PLATFORM_SUPPORT` bypass `assertTenantRole`? | No, only `PLATFORM_ADMIN` does (`permissions.ts:16`). |
| 3 | Which session field becomes `actorUserId`? | `session.userId` (`repository-context.ts:17`). |
| 4 | Which two unique constraints does `ReviewResponse` have? | `reviewAssignmentId @unique` (line 271) and `@@unique([tenantId, reviewAssignmentId])` (line 282). |
| 4 | What stops a manager from another tenant being stored in `Employee.managerId`? | Nothing in the schema (line 191). Only the service check in `employee-service.ts:112-118`. |
| 5 | How many `AuditLogRepository` instances exist at runtime? | One, shared by all three services (`service-factory.ts:15`). |
| 6 | Can an employee be their own manager? | Yes. `assertTenantReferences` only checks the manager exists in the tenant (`employee-service.ts:112-118`). Test G3, run. |
| 6 | What does the update audit row record? | Only the names of the changed fields (`employee-service.ts:100`), not old or new values. |
| 7 | Which fields does `list()` return for each employee? | Every scalar column, including `compensationCents`, plus the selected `manager` and `orgUnit` fields (`employee-repository.ts:46-53`; `include` keeps all scalars). |
