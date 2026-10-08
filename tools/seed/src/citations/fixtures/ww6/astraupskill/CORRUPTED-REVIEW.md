# Deliberately corrupted copy of ww6 findings (test fixture, not real content)

Each row below is a real ww6 row (06-SOLUTIONS-AND-REVIEW.md:22,28,31) with one citation broken on purpose.

| # | Sev | Location | Finding |
|---|---|---|---|
| F1 | Critical | `src/lib/auth/session.ts:13-99`, `src/lib/http/client.ts:7,31` | Range end pushed past the 32-line file. |
| F7 | Medium | `src/services/allocationEngineServce.ts:56,79,91` | File name misspelt (missing "i"). |
| F10 | Low | `route.ts:27-28` | Bare filename that matches two route.ts files. |
| F13 | Info | `:24` with no file earlier in the row | Orphan continuation. |
