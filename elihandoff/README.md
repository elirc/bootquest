# BootQuest handoff — START HERE

Written 2026-10-09 by the outgoing orchestrator (Fable) at session pause.
The owner switched subscriptions mid-flight; you are the successor session.

## 30-second orientation

- **App**: BootQuest, the owner's single-user gamified upskilling platform.
  Spec of record: `Desktop\bootquest-final-prompt.md`. Repo: THIS repo
  (`Desktop\selfboot`), local git only, branch `main`.
- **V1 is COMPLETE and verified** at commit `3795a39` (24 commits): spec
  M1–M7 + study-quest gates + act-1 content; 931 tests, smoke 56/56,
  demo:promotion 38/38, demo:campaign 24/24, 4 stamped code packs
  (~4,000 exercises), 77 seed packs. Nothing on main is broken or pending.
- **A second campaign ("improve app, fix UI, more content, new features",
  owner-authorized at 15-agent scale) was MID-FLIGHT at pause.** 8 agents
  were running (Phase A); 7 more were planned (Phase B). The running agents
  received stop orders to commit consistent work and report; whatever they
  left is on disk at the paths in `AGENTS-IN-FLIGHT.md`.

## Reading order

1. This file.
2. `STATE.md` — repo state, gate commands, machine gotchas digest.
3. `AGENTS-IN-FLIGHT.md` — the 8 Phase-A agents: what each was doing,
   where its work lives, how to harvest or relaunch it.
4. `PHASE-B-PLAN.md` — the 7 not-yet-launched agents with ready briefs.
5. `RECIPES.md` — the proven orchestration mechanics (transplant, restamp,
   gates, commit format). Follow these exactly; they encode hard lessons.
6. Deep background only as needed: `../LEARNING.md` (every decision with
   its why, newest items under the 2026-10-08/09 headers),
   `../docs/SEEDING.md` (content runbook + backlog),
   `../docs/BUILD-PLAN.md` (original wave plan), `../docs/recon/*` (audits).

## How to resume (suggested)

1. Verify main is clean and green: `git status`, then the gate battery in
   `STATE.md` §Gates (fast subset first: typecheck + smoke).
2. Harvest Phase A per `AGENTS-IN-FLIGHT.md`: for each workspace, check
   `git log` for a (possibly WIP) commit; green, complete work → transplant
   per `RECIPES.md`; partial/absent → relaunch that agent with the brief
   included there.
3. Launch Phase B per `PHASE-B-PLAN.md` (UI-FIX needs the UI audit's
   report; if the audit died incomplete, relaunch it first).
4. Keep the orchestration discipline: you (orchestrator) re-run every gate
   yourself before committing; fresh-context review for every wave; owner's
   standing instruction this campaign was "15 fable agents".
5. Delete this folder when it has served its purpose (it is committed on
   main for safekeeping).

## Owner-facing context

- The post-V1 roadmap was published as a private artifact (owner has the
  link; a copy of its substance lives in `../docs/SEEDING.md` backlog +
  LEARNING). Owner to-dos surfaced there: fine-grained read-only GitHub
  PAT, node ≥22.18 upgrade, 4 policy decisions (explain-back retakes,
  demotion cap, quiz oracle, two-strikes rule), upstream guide errata,
  revoke the old Shopify token, delete 8 locked old worktree dirs under
  `~\.claude\worktrees` (plus possibly new ones from this campaign).
- Persistent memory: `~\.claude\projects\C--Users-Owner\memory\
  bootquest-gamified-platform.md` (update it when you reach a milestone).
