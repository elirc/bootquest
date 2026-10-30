# BootQuest handoff — START HERE (updated 2026-10-30)

BootQuest is the owner's single-user, local-first gamified upskilling app (npm workspaces `server/`, `client/`, `cli/`,
`shared/`, `tools/seed/`). This folder is the one current handoff. Everything older lives in git history and in
[`docs/SEEDING.md`](../docs/SEEDING.md) §8 (the wave log, newest bullets at the end).

## Read in this order
1. [`AGENTS.md`](../AGENTS.md): the contract for every agent (ground rules, Windows shell, content discipline,
   the gate battery, stop reports).
2. This file: current state, open items, next ideas.
3. [`OPERATIONS.md`](OPERATIONS.md): how waves are run on this machine (audit → plan → clones → ring review →
   integrate), and the lessons behind each rule.
4. [`docs/SEEDING.md`](../docs/SEEDING.md): §3 for the CLI of the content type you touch, §8 for the latest wave
   bullets ("quality wave (qw)", "CRUD wave (cw)").
5. [`README.md`](../README.md) for running the app.

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

## Next ideas (highest value first)
1. Retake sets (set-B) for the DESIGN IT primaries that have none (17, incl. the 4 new cw primaries and dotnet-auth).
2. An explain-back vs explain-back leak lint (the token lint misses paraphrase across EBs on one repo).
3. 27 older csdrills hints (hint 2) still show near-code; thin them to API names.
4. Classic architecture explain-backs on the 43 JS/TS repos with no explain-back (must be campaign-linked).
5. An authored JS drill bank (`jsdrills`), the missing JS leg of the cross-language traps.
6. Quiz layers on the remaining 12-question packs (122 packs have ≤ 12 hand quizzes).

## Where else things live
- `C:\Users\Owner\Desktop\bootquest-handoff\` (outside the repo): wave-1 briefs, the Codex guide and task queue, and
  the qw stream reports (`qw\`). Reference material only; this README supersedes its status sections.
- Agent memory for Claude sessions: `~\.claude\projects\C--Users-Owner-Desktop-selfboot\memory\`.
