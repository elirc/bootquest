# Citation fixtures: provenance

Each top-level folder is a miniature repo root: a guide excerpt at its original repo-relative
path plus the cited source files copied byte-for-byte (CRLF kept; see `.gitattributes`). Source
files are copied whole, so line numbers and line counts match the mirror exactly. Guide excerpts
are contiguous line ranges, so a guide line N here is line (N + offset) in the original.
Copied on 2026-10-07 from the read-only mirrors under `Desktop\claiufe` (never modified).

| Fixture | Origin repo @ mirror HEAD | Guide excerpt | Cited files copied |
|---|---|---|---|
| `ww6/` | elirc/ww6 @ `09751ceaee909a30e5c4b5ff5cdde99880b9a3e5` | `astraupskill/06-SOLUTIONS-AND-REVIEW.md` lines 16-35 (offset +15): F-table F1-F13 | `src/lib/auth/session.ts`, `src/lib/http/client.ts`, `src/services/{allocationRunService,budgetService,allocationEngineService}.ts`, `src/repositories/reportRepository.ts`, `src/app/api/{cost-line-items,budgets}/route.ts`, `src/lib/validation/reportSchemas.ts`, `src/services/{allocationRuleService,ingestionService,anomalyService,forecastService}.ts`, `src/repositories/{allocationRunRepository,anomalyRepository,forecastRepository}.ts`, `src/lib/queue/allocationQueue.ts`, `prisma/schema.prisma` |
| `j1/` | elirc/j1 @ `efc26ca7e2cd19dd481aeeba1aedf6bf0265948b` | `astraupskill/06-SOLUTIONS-AND-REVIEW.md` lines 59-68 (offset +58): numbered "Senior findings" | `src/todo/App.java`, `src/todo/repository/TaskRepository.java`, `src/todo/service/TaskManager.java`, `test/todo/TaskWorkflowTest.java` |
| `zz8/` | elirc/zz8 @ `ae8c8234428271147fda7d136e3936acf3c4c692` | `docs/learning/guided-reading-path.md` lines 107-121 (offset +106): "Check yourself" answer table | `src/lib/auth/{session,permissions}.ts`, `src/lib/demo/demo-sessions.ts`, `src/services/{integration-service,employee-service,service-factory}.ts`, `src/repositories/{repository-context,employee-repository}.ts` |

Exactly the files the three excerpts cite were copied, so every citation in the real excerpts
resolves (ww6 30/30, j1 14/14, zz8 13/13). The same validator run against the full mirrors
(not fixtures) gave ww6 33/33, j1 23/23, zz8 78/79 (one real failure: bare `route.ts:15` at
guided-reading-path.md:122 is ambiguous among 8 route.ts files).

`ww6/astraupskill/CORRUPTED-REVIEW.md` is NOT real content: four ww6 rows, each with one citation
broken on purpose (range overflow, misspelt file, ambiguous bare `route.ts`, orphan `:24`).

The ww6 tree keeps two `route.ts` files on purpose: the real guide cites both by full path, and a
bare `route.ts` must be rejected as an ambiguous suffix.

These `.ts` / `.java` files are data, not code: exclude `src/citations/fixtures/**` from any
tsconfig / lint include.
