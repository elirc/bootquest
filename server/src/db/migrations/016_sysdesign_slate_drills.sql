-- 016_sysdesign_slate_drills: the sysdesign track gains a daily drill slot.
-- The sysdrills pack (content/packs/sysdrills, drill-js, track sysdesign)
-- gives the track its first drill bank; slate composition (engines/streak.ts)
-- sizes the slot min(5, remaining) and drops it at 0, so a DB without the
-- pack (or an exhausted bank) is unchanged in behavior.
UPDATE track SET slate_drills = 1 WHERE id = 'sysdesign';
