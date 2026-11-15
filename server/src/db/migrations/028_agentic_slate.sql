-- 028_agentic_slate: the agentic track gains a daily drill SLOT CAPABILITY (rv3 S4 W8, PLAN O13).
-- The agentdrills pack (content/packs/agentdrills, drill-js, track agentic) gives the track its first drill
-- bank. track.slate_drills is only the capability flag ("this track can give a drill set"): since rv wave C
-- an unconfigured track is OFF on the slate (engines/streak.ts slateShape), so this changes nothing on any
-- day until the learner turns drill:agentic on in /settings (an append-only slate_setting row, migration 017).
-- No slate_setting row is written here: the default slate of a fresh or existing DB is unchanged.
UPDATE track SET slate_drills = 1 WHERE id = 'agentic';
