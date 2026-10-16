-- 011_unlock_java_track: the Java track goes live (owner request 2026-10-16,
-- "fill out the java track like others"). Until now Java was a greyed-out
-- placeholder (002: locked = 1, slate_drills = 0). It now has a playable
-- 3-act campaign (content/campaign/java.json) and a drill pack graded by the
-- drill-java runner, so it unlocks and contributes a drill slot to the daily
-- slate exactly like C# (002: locked = 0, slate_drills = 1).
UPDATE track SET locked = 0, slate_drills = 1 WHERE id = 'java';
