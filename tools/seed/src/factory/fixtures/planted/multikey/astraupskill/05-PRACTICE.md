# Planted practice (NOT estate content)

Synthetic guide for the single-keyed quiz validator: exercises 1 and 2 share a
Check, so any goal-check quiz that offers both is multi-keyable.

**Level 1 — viewer write.**
**Goal:** a VIEWER posts a new allocation run.
**Check:** the response is 403 `FORBIDDEN` and no row is written.

**Level 2 — analyst on another tenant.**
**Goal:** an analyst posts a run for a different tenant id.
**Check:** the response is 403 `FORBIDDEN` and no row is written.

**Level 3 — admin.**
**Goal:** an admin posts a run for their own tenant.
**Check:** the response is 202 and a PENDING row exists.
