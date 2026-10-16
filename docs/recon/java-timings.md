# Java runner timings (drill-java, javabootcamp)

Measured 2026-10-16 on the dev laptop: Windows 11 Pro 10.0.26200, JDK 17.0.10 (Microsoft
build, javac/java on PATH), node v22.16.0. Other agents were running builds on the same
machine at the same time, so differences between runs include that load.
Source of truth: `server/src/runners/java/runner.test.ts` (`npm run test:java`, which writes
`%TEMP%\bootquest-java-timings.json`). All times are wall-clock `durationMs` of
`run(exercise, submission)`: mutex wait + harness prepare + javac + java.

## Against the gate (warm < 10 s, first ≤ 60 s)

| case | suite run 1 | suite run 2 | gate |
|---|---|---|---|
| first-ever grade (compiles the harness, then the attempt) | 8.3 s | 5.2 s | met |
| warm grade, median of 5 (each one a fresh edit, so a real recompile) | **3.27 s** (2.9-3.7) | **2.25 s** (2.0-2.4) | **met** |
| untouched starter (6 todo) | 3.7 s | 2.1 s | n/a |
| compile error (javac output returned verbatim) | 1.5 s | 1.4 s | n/a |
| infinite loop, 4 s timeout, process tree killed | 8.8 s | 6.9 s | n/a |
| next grade after the kill | 7.4 s | 5.4 s | n/a |

Real pack: `seed:validate` over 32 javabootcamp exercises (each exercise is graded twice:
the reference solution and the untouched starter, so 64 grades) took 172.8 s with
concurrency 1. That is about 2.7 s per grade. Result: 32/32 pass, 0 quarantined.
That was an early dry run (4 modules). The committed pack (64 exercises @ 0ec7155, 128 grades)
validated 64/64, 0 quarantined, in 335.4 s at c1e14aa and 230.5 s at 0ec7155 (20 journaled
passes re-used), about 2.6 s per grade.

## Phase split (warm, suite run 2)

- javac: 1.5-2.1 s. This is the whole cost: a cold `javac` JVM for every attempt, with
  `-J-XX:TieredStopAtLevel=1 -J-XX:+UseSerialGC -J-Xmx256m -proc:none`. Tried by hand on
  the same box: the C1-only + SerialGC flags save roughly 0.3-0.5 s compared with javac's
  defaults (about 2.5 s down to about 2.1 s).
- java (`bootcamp.BqMain Exercise`): 0.26-0.50 s.
- Timeout overhead: `taskkill /T /F` adds about 2-2.5 s on top of the timeout under load
  (4 s timeout → 6.4 s run phase).

## Not done (deliberately)

A warm compile server (one long-lived JVM calling `javax.tools.JavaCompiler`) would bring
javac down to about 0.3 s. That is the analogue of the C# runner's VBCSCompiler pipe. The
gate is already met without it, and a resident JVM costs about 100-200 MB of RAM on a
machine that has about 5 GB free. Revisit only if warm grades approach the gate.
