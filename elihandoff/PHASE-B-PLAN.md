# Phase B — planned but never launched (7 agents)

Owner authorization for this campaign: "use 15 fable agents, improve app,
fix any ui issues, add more content, new features with new content".
Phase A (8 agents) is in AGENTS-IN-FLIGHT.md. These 7 were queued behind
integration points. Launch order and dependencies below. Model per the
owner's instruction was Fable throughout.

## B1. UI-FIX (main workspace; AFTER the UI audit is complete)

Fix every finding in docs/recon/ui-audit.md (complete the audit first —
see AGENTS-IN-FLIGHT §1). Priorities: the locked-act unit-detail leak is
a server fix (act gate in getUnit mirroring retestGate + ACT_LOCKED render
state in the client; add a no-leak test: locked quest's unit detail must
NOT contain quiz questions); then the 4 other "bad" findings; then polish.
Rules: no weakened tests; client tests for each fixed finding; keep
keyboard/zero-layout-shift conventions (LEARNING "P5 results").
Gates: client+server suites, typecheck, build:client, smoke, and
re-screenshots of each fixed screen (both widths, dark+light).

## B2. STATS (worktree/clone; independent)

Real charts for the Stats page (W7 placeholders): XP over time (from
xp_event, daily buckets, last 90d + all-time), pass rates (per track and
per check type, from attempt/run), review stats (due forecast from
review_item, retention from review_log). Server: add read-only endpoints
(Zod schemas in shared/src/api.ts; hygiene helpers; no new deps — charts
drawn client-side). Client: hand-rolled SVG charts in the app's token
palette (no chart library; theme-aware via CSS tokens; tabular-nums; draw
to scale, labels inside bounds — the repo convention is deliberate design,
see client/src/styles/tokens.css). Tests: bucket math unit tests + API
shape tests + a couple of render tests. Gates: suites, typecheck, build.

## B3. SKILLTREE (worktree/clone; independent)

Spec §6.1/§10 names "per-track skill trees (nodes = units/acts,
prerequisites unlock successors; Java tree greyed out)" and a "campaign
map / skill tree per track" screen — the list view exists; the TREE view
does not. Build it as an alternate view on the Campaign page (toggle):
SVG tree/path of acts→quests with node states (locked/available/
in-progress/done, content-pending badge), prerequisite edges from
unit_prerequisite + act chain, Java greyed. Keyboard navigable, both
themes, 400px behavior = vertical path. Data comes from the existing
GET /tracks/:id/campaign (+ unit prereqs — add a field if needed,
additive only). Tests for the layout math (pure functions) + render.

## B4. WRITTEN+CLI (worktree/clone; independent)

(a) Written-unit player: the 147 written units have an API flow
(POST /units/:id/answer → GET /model-answer 403-until-answered, rubric in
unit detail) but the client pane is minimal. Build the full
immutable-answer-first pane: prompt (WITH code-block rendering — overlaps
UI-audit finding 3, coordinate), textarea, confirm dialog, then model
answer + rubric self-check list; per-rubric-item self-marks stored
locally… NOTE: self-marks today have no server endpoint — keep honest:
display-only rubric, no fake scoring, unless you add a proper evidence
endpoint server-side (follow the explain-back self-score pattern,
assessor 'self', no XP unless spec'd — spec §4 written row is
self-assessed with no XP line, so NO XP).
(b) CLI `bootquest today`: prints the daily slate (slots + done state),
review due count, streak/tokens, next-up per track — read-only GETs,
exit 0 always. Tests like the existing cli suites.

## B5. ACT3-JS (clone; content; after ACT2 batches land to avoid
checkout collisions — or use distinct clone dirs)

JS act 3 "Products & teams" quest packs, first ~10 unpacked core quests by
rank, per the proven recipe (LEARNING "W5c-act1", docs/SEEDING.md §3,
AGENTS-IN-FLIGHT §6's refreshed step list and draft-format reminder).
Same quality bar and gates.

## B6. ACT3-CS (clone; content; independent of B5)

C# act 3 "Real services" quest packs (~8 core quests: meterforge,
harbor-swe-bootcamp, netcleanarch, nethris, campusops per the spec's act
themes — read content/campaign/csharp.json for the real list/ranks).
Same recipe and gates.

## B7. FINAL-REVIEW (fresh-context; LAST, before the closing commit)

A fresh-context Fable agent reviews the ENTIRE campaign delta
(git diff 3795a39..HEAD) adversarially: honesty invariants (no new leak
paths, no weakened tests/validators — diff every *.test.ts for deleted
assertions), fingerprint/stamp consistency (every stamp valid on final
bytes), UI-fix regressions, content spot-checks (≥10% of new packs vs
cited sources). Write docs/recon/campaign2-review.md. Orchestrator then
runs the full gate battery (STATE.md §Gates) + fresh sweeps if any
grader/validator byte changed, commits, updates memory + LEARNING.

## Integration order (recommended)

1. Harvest/relaunch Phase A: FACTORY and OPS first (they change
   fingerprints — land them together, ONE restamp sweep), then RUNNER
   (second fingerprint change — coordinate: ideally land FACTORY+OPS+RUNNER
   before ANY sweep, then one restamp:all), then content batches
   (ACT2-A/B, KATA-2, VARIANTS — pack-only, no fingerprints), then
   complete UI audit.
2. B1 UI-FIX (main workspace).
3. B2/B3/B4 in parallel (clones), B5/B6 in parallel (clones).
4. B7 + final gates + commit(s) + memory/LEARNING updates.
Transplants per RECIPES.md. Keep the one-main-workspace-agent rule.
