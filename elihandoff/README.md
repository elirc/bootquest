# BootQuest handoff — START HERE (updated 2026-11-15)

BootQuest is the owner's single-user, local-first gamified upskilling app (npm workspaces `server/`, `client/`, `cli/`,
`shared/`, `tools/seed/`). This folder is the one current handoff. Everything older lives in git history and in
[`docs/SEEDING.md`](../docs/SEEDING.md) §8 (the wave log, newest bullets at the end).

> **Newest state (2026-11-15): branch `rv-wave` = fund + f52 + rv + rv2 + rv3, not on `main`.** Read
> [`rv-wave/rv3/REPORT.md`](rv-wave/rv3/REPORT.md) first: every change of the rv, rv2 and rv3 waves for the owner, with
> counts. The plans, stop reports and reviews behind it are in the orchestrator's copy
> `C:\Users\Owner\Desktop\selfboot\elihandoff\rv-wave\` (`HANDOFF.md`, `review/`, `wave/`, `rv2/`, `rv3/`).
> Landing `rv-wave` on `main` is the owner's call (O1), after the rv3 battery and Fable's review gate.

## Read in this order
1. [`AGENTS.md`](../AGENTS.md): the contract for every agent (ground rules, the bound and free files, content
   discipline and the explanation bar, the gate battery, stop reports).
2. This file: current state, open items.
3. [`rv-wave/rv3/REPORT.md`](rv-wave/rv3/REPORT.md): what the rv, rv2 and rv3 waves changed and what is left.
   [`REVIEW-2026-10-30.md`](REVIEW-2026-10-30.md) is the older review (after the cw wave); most of its plan is done.
4. [`OPERATIONS.md`](OPERATIONS.md): how waves are run on this machine (audit → plan → clones → ring review →
   integrate), and the lessons behind each rule. [`templates/`](templates/) holds the shared-brief and ring-review
   templates that worked; [`tools/`](tools/) the read-only helper scripts (`dossier.mjs` everything on one repo,
   `slotcheck.cjs` quiz slot/order drift, `addrepos.mjs` copy pinned checkouts into a clone).
5. [`docs/SEEDING.md`](../docs/SEEDING.md): §3 for the CLI of the content type you touch (key ideas, agentdrills,
   kata flags and the explanation audit are new), §8 for the latest wave bullets ("rv wave", "rv2 wave", "rv3 wave").
6. [`README.md`](../README.md) for running the app.

## Run it locally
```bat
set BOOTQUEST_DB=C:\Users\Owner\bootquest\bootquest.db
npm run serve                        & rem API on http://127.0.0.1:4178
npm run dev -w @bootquest/client     & rem UI on http://localhost:5173 (second terminal)
```
The server refuses to start on a stale stamp or a busy port, and backs up the DB before it serves.

## State
- `main` = `origin/main` on GitHub (`elirc/bootquest`, **public**) at the ab wave (`a2777ba8`, landed 2026-11-01) plus
  docs. Everything after it is on branches: `fund-wave` → `f52-wave` (`dc2206bc`) → hub `rv-wave`
  (`C:\Users\Owner\Desktop\bq-f52-hub`), which holds the rv, rv2 and rv3 waves.
- **The owner has not used the app yet:** the owner DB (`C:\Users\Owner\bootquest\bootquest.db`, schema 18) had 0
  attempts when rv3 started. Never open it for writing; count on a copy (`node fable52docs/tools/copydb.cjs <file>`).
  The first boot of `rv-wave` migrates it 18 → 29 and backs it up first.
- Content census at rv3 S5 (`431f63b6`, counted by script from the committed tree; count again before trusting it):

| Area | Count |
|---|---|
| Fundamentals ladders | js 33 topics / 330 quiz / 238 cards / 79 drills; csharp 26 / 260 / 208 / 55; java 26 / 260 / 208 / 60 |
| Authored drill banks | csdrills 72, javadrills 98 (14 modules), sysdrills 129 (18 modules), agentdrills 8 (eval lab) |
| Imported banks | bootforge 2571, jstrain 1308, jstrain-cs 81, csbootcamp 31, javabootcamp 168 |
| Quest packs | 204, each with a Learn-more notes pack |
| Explain-back packs | 244: DESIGN IT 87, G2 delegation briefs 20, classic 137 |
| Patch katas / variants | 66 in 33 packs (6 flagged: 3 clean, 3 with decoys) / 5 |
| Key ideas | 24 sections, 201 ideas |
| Side files | archive 880 units, design headlines 2044 (107 sets), estimates 670, card tags 142, paths sysdesign 18 steps / 32 sets and agentic 7 steps |
| Migrations / stamps | 29; `seed:pins` 690/690, `restamp:all -- --dry-run` 703/703 fresh |

- **Not done yet:** the Java 01-20 drill explanations and lessons (`rv3-java2`, running at the time of writing), the
  rv3 battery in the hub, Fable's rv3 review gate (`rv3/PLAN.md` §5).

## Open owner decisions
Defaults apply until overruled (`rv3/PLAN.md` §6):
- **O1** land `rv-wave` on `main` after the rv3 battery is green (one merge, by you or on your word).
- **O2** usage gate: no further content waves until 100 graded attempts over 14 distinct days. rv3 was the last content.
- **O8 / O9** still blocked: Java 21 (JDK 21 install), real-framework C# drills (restamps every C# and Java pack),
  upstream sources for the 8 classic DESIGN IT problems, the four G2 briefs (injection, test tampering, orchestration,
  context budget) and the C6 "pick the model" citations.
- **O11** run `bootquest sync` on signalpost once after landing. **O12** 141 jstrain units have no explanation upstream.
  **O13** the `drill:agentic` slate slot (the eval lab) is off; turn it on in `/settings`.
- **Upstream bugs** found in the pinned source repos are listed per stream in the stop reports and SEEDING §8 (mirrors
  are never edited). **Frozen pre-mx items** listed in earlier waves can now be fixed under rv3 ruling 1 while they have
  no attempt.
- **Housekeeping:** the working clones `bq-f52-c`, `bq-f52-p`, `bq-f52-d`, `bq-f52-s` and the review worktree
  `bq-review` can be removed once `rv-wave` lands.

## Next work
1. Fill the Java line when `rv3-java2` reports (marked in `rv-wave/rv3/REPORT.md` and SEEDING §8 "rv3 wave").
2. The rv3 battery in the hub, one suite at a time (AGENTS.md gates, now with `seed:lint:keyideas` and
   `seed:audit:explanations -- --check`), then Fable's review gate (rv3 PLAN §5).
3. Land (O1), then use the app: the usage gate (O2) decides when the next content wave starts.

## Where else things live
- `C:\Users\Owner\Desktop\bootquest-handoff\` (outside the repo): wave-1 briefs, the Codex guide (`CODEX-GUIDE.md`
  §4-§6: commands per content type, reference commits, quality bar), the superseded Codex task queue, the qw stream
  reports (`qw\`) and a copy of the 2026-10-30 review (`rv\`). Reference material only; this folder supersedes its
  status sections.
- Agent memory for Claude sessions lived in `~\.claude\projects\C--Users-Owner-Desktop-selfboot\memory\` on the
  previous account. A new account starts with none: this folder and SEEDING §8 are the only durable state.
