# BootQuest handoff — START HERE (updated 2026-10-30)

BootQuest is the owner's single-user, local-first gamified upskilling app (npm workspaces `server/`, `client/`, `cli/`,
`shared/`, `tools/seed/`). This folder is the one current handoff. Everything older lives in git history and in
[`docs/SEEDING.md`](../docs/SEEDING.md) §8 (the wave log, newest bullets at the end).

## Read in this order
1. [`AGENTS.md`](../AGENTS.md): the contract for every agent (ground rules, Windows shell, content discipline,
   the gate battery, stop reports).
2. This file: current state, open items.
3. [`REVIEW-2026-10-30.md`](REVIEW-2026-10-30.md): the full read-only review of the app and the content after the
   cw wave, the ranked four-wave plan with one brief per stream, the orchestration tips for the next Opus/Fable
   session, and the owner decisions it needs. The four detailed reports are in
   [`review-2026-10-30/`](review-2026-10-30/). **Start the next wave from this file.**
4. [`OPERATIONS.md`](OPERATIONS.md): how waves are run on this machine (audit → plan → clones → ring review →
   integrate), and the lessons behind each rule. [`templates/`](templates/) holds the shared-brief and ring-review
   templates that worked; [`tools/`](tools/) the read-only helper scripts (`dossier.mjs` everything on one repo,
   `slotcheck.cjs` quiz slot/order drift, `addrepos.mjs` copy pinned checkouts into a clone).
5. [`docs/SEEDING.md`](../docs/SEEDING.md): §3 for the CLI of the content type you touch, §8 for the latest wave
   bullets ("quality wave (qw)", "CRUD wave (cw)").
6. [`README.md`](../README.md) for running the app.

## Run it locally
```bat
set BOOTQUEST_DB=C:\Users\Owner\bootquest\bootquest.db
npm run serve                        & rem API on http://127.0.0.1:4178
npm run dev -w @bootquest/client     & rem UI on http://localhost:5173 (second terminal)
```
The server refuses to start on a stale stamp or a busy port, and backs up the DB before it serves.

## State
- `main` = `origin/main` on GitHub (`elirc/bootquest`, **public**). Recent waves: mx (2026-10-23..26, bulk content),
  qw (2026-10-30, review and pruning of mx), cw (2026-10-30, CRUD web-app system design and architecture).
- **The owner has not used the app yet** (checked 2026-10-30: 0 attempts, 0 XP, 0 review cards, 15 "missed" days on
  the heatmap since 10-15). REVIEW-2026-10-30 §1 explains why that puts the "day one" app wave first. Re-check with
  `GET /api/dashboard` before planning.
- Nothing from the 2026-10-30 review is implemented. No wave is in flight.
- Content census (count again before trusting a number; `C:\Users\Owner\Desktop\bootquest-handoff\tools\census.mjs`
  is a read-only counter):

| Area | Count |
|---|---|
| Drill banks (authored, runnable) | csdrills 72 (C#), javadrills 80 (Java), sysdrills 129 (system design, 18 modules) |
| Quest packs (quizzes, flashcards, reading) | 204, every one with a Learn-more notes pack |
| Explain-back packs | 244: classic 137, G2 delegation briefs 20, DESIGN IT 87 (39 repos; 50 primaries + 37 set-B/C retakes) |
| Patch katas / variants | 31 / 5 |

- Gates at the cw landing are recorded in SEEDING §8. The battery itself is listed in AGENTS.md.

## Open owner decisions
- **Fable review:** both 2026-10-30 waves were orchestrated and reviewed by Opus agents because the Fable quota was
  exhausted. A Fable high-level review of qw and cw is still owed if the owner wants one.
- **Frozen pre-mx items that are wrong** (content rules keep old items byte-identical; the owner decides):
  masteropen quiz 74848a10 explanation (seconds vs ms), masteroutline fc 22b1860a, mastertwenty note
  x-retry-is-repair, linkwarden note x-member-cannot-move, netcalendy quiz 298d7218 (true only at the handler level).
- **Upstream bugs** found in the pinned source repos are listed per wave in SEEDING §8 (mirrors are never edited).
- **Housekeeping:** the stray remote branch `origin/mx-wave` is identical to what landed and can be deleted
  (`git push origin --delete mx-wave`) once the owner OKs it. The working clones `C:\Users\Owner\Desktop\bq-qw-s1..s7`
  and older `bq-mx-*` / `bq-*` folders are merged and can be deleted to free disk.

## Next work
The ranked plan is REVIEW-2026-10-30 §4 (four waves: A day-one app fixes, B content repair, C new content, D
owner-dependent), with a brief per stream in §5 and the orchestration tips in §6. In one line each:
1. **Wave A (app):** configurable smaller slate + first-run fixes; fix the dead lapse→demotion rule and the 200-card
   review page; weak-spots panel and due alternate sets; search, per-repo dossier, mixed drill mode; real explain-back
   weights and a blind mode.
2. **Wave B (repair):** sysdrills hints/task formulas/duplicates + importer gates; 66 doc-recall quiz stems and the
   long flashcard backs in the new layers; explain-back cite fixes and a standalone EB↔note/flashcard/EB leak lint.
3. **Wave C (new content):** a `jsdrills` bank; sysdrills 19-21 (transactions, background jobs, HTTP caching);
   csdrills 11-12 and javadrills 12-13; six DESIGN IT primaries + 17 set-Bs + 3 .NET/Java G2s; React data-layer,
   atlas-net, tenantadmin, C#-anchor and testing quest packs.
4. **Wave D (owner-dependent):** a Java web leg (needs a new repo), the `world` pack, interview mode, drill
   re-exposure cards, the system-design promotion path.
Earlier ideas still valid and folded into the plan: set-Bs for the 17 primaries (C4), the EB-vs-EB leak lint (B3),
classic EBs on the no-EB JS/TS repos (C4/C5), `jsdrills` (C1), quiz layers on thin packs (C5). Not yet placed:
thinning the 27 older csdrills hint 2s (small; add to B1 if there is budget).

## Where else things live
- `C:\Users\Owner\Desktop\bootquest-handoff\` (outside the repo): wave-1 briefs, the Codex guide (`CODEX-GUIDE.md`
  §4-§6: commands per content type, reference commits, quality bar), the superseded Codex task queue, the qw stream
  reports (`qw\`) and a copy of the 2026-10-30 review (`rv\`). Reference material only; this folder supersedes its
  status sections.
- Agent memory for Claude sessions lived in `~\.claude\projects\C--Users-Owner-Desktop-selfboot\memory\` on the
  previous account. A new account starts with none: this folder and SEEDING §8 are the only durable state.
