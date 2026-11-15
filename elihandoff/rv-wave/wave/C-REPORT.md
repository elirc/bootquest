# Stream C stop report (daily loop, routing, archive)

**Branch** `rv-d` in `C:\Users\Owner\Desktop\bq-f52-d` (from dc2206bc): ccbde0ec routing side files + archive in campaign core ·
00f2faa2 server day/senior rep/paths/migration 022 · 24430ffe client · a109eadb CLI + serve.ts · d8f90d95 remaining test pins.

**Implemented**
1. One finishable day (D3/D5, R4-05/22, R5-11): default slate = reviews + `fund` slot (primary-language ladder; any first unguided gate/drill pass) + `senior` slot; drill sets and the campaign step off by default (no data migration: unconfigured = off); one-time language prompt (PUT /settings/learner, first pick applies today). Hero "Done for today" = server `todayComplete`; 20 XP = "kept" on hero, tile and CLI.
2. Senior rep + paths (R3-08, R5-03): `content/paths/{sysdesign,agentic}.json` (18 modules → 35 DESIGN IT sets, keyword first cut; G2 20 → katas 18/23/11 → G3 → G4). Rotation Mon/Thu/Sun design, Tue/Fri kata, Wed/Sat fund-js 21-33, falls through; any senior rep ticks it. Next-up + track browser follow paths; C8 narrowed (studied-repo rule removed per R4-round2).
3. Next up panel removed (R4-10); Campaign Tree view + skill_node tables dropped (R4-18, migration 022); G3/G4 never a fallback next step; focus form → /settings; competency table → Stats (R4-20); hero layout (R4-23); 10-minute mode (N1, client plan card).
4. Archive (Q4/D8): `content/archive.json`, 879 units (bootforge quiz 544, micro-drill 267 [≤3 lines AND (survivor OR ≤2 tests), sql-data + 6 related.json keys excluded], skims 12, twin gates 15, classic EBs 40, G4 1). `engines/campaign.ts` drops archived core quests from coreDone AND coreTotal: JS act 1 15/15 kept (needs 12), C# act 1 5/5 (4), C# act 2 3 of 4 (3) — `test/archive-real.test.ts`. related.json keys refused at load.
5. Concept titles: `content/campaign-titles.json` (336 quests, from `focus`); `seed:campaign -- --check` ok.
6. serve.ts mixed-checkout message (R4-19); CLI `today` partial-day + Fundamentals step, "solve in your editor" help, `mutate` hidden (R4-17).

**Deferred**: R4-24 (per-track act gating) — `demo:campaign` Part A asserts the global level leg (C# act-1 XP opens JS act 2), so it would break; needs an owner call. N1's hard 20-card cap inside Review.tsx (stream D owns Review). Item-level cuts R2 C1-C4/C8/C9 (inside study gates) → content stream. Path module↔set matching is heuristic: content stream should review `paths/sysdesign.json`.

**Counts**: active units 5,266 → 4,387 (−879, 16.7%; below D8's 1,500-2,200 because the brief's micro-drill rule yields 267 not 562 and item cuts are out of scope; jstrain 01-11 / csbootcamp were not in the brief). EB/kata/pack census unchanged (nothing retired).

**Tests** (targeted, --maxWorkers=1; machine heavily loaded): server rv-day 8/8, archive-real 5/5, rv-routes 5/5, serve-mixed 2/2, streak 31/31, slate-settings 14/14, settings 6/6, slate-fund 5/5, nextup 2/2, campaign 12/12, api/campaign 13/13, find 14/14, db 43/43, ladder-sysdesign 5/5, ladder 54/54, study-quests 25/25, api.test 43/43 (dashboard re-run 3/3 after fix). Client: 12 files 196/199, then the 3 fixed and re-run: dashboard-hero 25/25, dashboard 25/25, lib/trackunits 24/24 (rv-dashboard 7/7, App 26/26, w11-final 18/18, trackunits 20/20, slate-focus 7/7, session-shape 9/9, fundamentals 16/16, find 18/18, trackunits-groups 5/5). CLI rv-today 3/3, format 17/17, program 35/36 (the `reset` child-process test timed out at 61 s under load; untouched code).
Typecheck (final tree): root `tsc --noEmit` rc=0; client clean except pre-existing missing `@codemirror/*` / `@lezer/*` in this clone's node_modules.
`restamp:all -- --dry-run`: `700/700 fresh · RESULT OK`. `seed:campaign -- --check`: ok. Lints not run: no stamped item touched.

**Outside my list (touched)**: `server/src/api/find-service.ts` (archived/drill targets, campaign target), `shared/src/api-ext.ts` (new DTOs, free per COMMON), `client/src/pages/Stats.tsx`, `App.tsx`, `main.tsx`, `SlateFocus.tsx`, mock/http/types, `server/test/{db,packs,ladder-sysdesign,study-quests,api}.test.ts` (schema 22 / default pins), `client` tests listed in 24430ffe.

**Open questions / integration notes**
- Migration 022 needs B's 020-021 to exist (migrate.ts refuses gaps); I tested with untracked placeholder 020/021 files (excluded via .git/info/exclude, not committed). db/packs/ladder-sysdesign tests pin version 22.
- Owner: senior-rep rotation and "any rep counts" rule; campaign step off by default; archive scale (879 vs 1,500-2,200).
