# rv2 stream S2b `rv2-c2`: content, part 2 (Opus implementer)

Clone `C:\Users\Owner\Desktop\bq-f52-c`, branch `rv2-c2` at `78abd4c8` (hub `rv-wave` with S1 and S2 slice 1+2
merged). No migrations. You continue S2's work: read `rv2/S2-REPORT.md` and `rv2/S2-SLICE1.md` first. Everything in
`BRIEF-S2.md` (owned files, gates, machine rules, stop report) applies to you unchanged, with these changes:
the report goes to `rv2/S2b-REPORT.md`, and the order and scope are below.

## Order (commit each; stop at a clean boundary if budget runs low)
1. **C7 must: senior Fundamentals topics.** C# 21 testing (WebApplicationFactory seams, fakes), 22 HttpClient resilience
   (timeouts, retries with jitter, cancellation), 23 authN vs authZ + resource-based checks; Java 21 JUnit 5 + Mockito
   (fake the boundary), 22 Spring Security basics (filter chain, method security), 23 Jackson contracts. Per PLAN §3 C7:
   lesson, 10 items, 8 cards, 2 plain-language drills each (no framework runtime, JDK 17 — the drills model the idea
   in plain C#/Java), `sections.json` checks, and append key ideas to `content/keyideas/fund-cs-web.json` /
   `fund-java-spring.json` (keep each file at ≤ 12 ideas; sources = the new topic gates). Follow how A1/f52 authored
   topics 21-33 for JS (see SEEDING §3 Fundamentals). Length-rank lint OK; items test behaviour, not version trivia.
   Update `FUNDAMENTALS_EXPECTED` and the `ladder-real.test.ts` pins by counting.
2. **Repairs (owner default O3 lets unattempted items be fixed; nothing has been attempted in the owner DB):**
   a. The 10 fund-js drills whose hint 2 fails E1's prose gate (`;`/parentheses): reword hint 2 to prose that does not
      give the answer; re-import + stamp fund-js (chunked); prove `seed:import:fundamentals --track js` no longer
      refuses. b. The wrong claim in the C# 06 drill-1 explanation (`new` vs `override`): correct it to what the test
      really shows. Note each changed item key in the report.
3. **C5 part 1, only what has a source.** 10 agent-PR katas + 4 tool-design katas via `tools/seed/authoring/katas` +
   `seed:patches`, if a kata can be built over pinned estate code (a patch to a real file in a pinned checkout, as the
   existing 52 katas are). Kata proofs must pass. G2 sets and quiz items only where a pinned estate doc supports every
   key point; S2 found none for injection/egress/test tampering/orchestration/context budget, so do not write those
   from general knowledge: report them as blocked. Add what you build to `paths/agentic.json` and, if useful,
   `content/keyideas/agentic.json` sources.
4. **C7 stretch** (C# 24-26, Java 24-26) if budget remains.

Not in scope: C6 (blocked: no citation anchor), C8 build (needs a slate migration), anything under `server/src`,
`client`, `shared/src`, `tools/seed/src/factory`.

Another agent (S3, clone `bq-f52-d`) is running client/server features in parallel; ~1.2 GB free RAM: targeted,
chunked, `--maxWorkers=1`, foreground. The full `test:csharp`/`test:java` suites are fine to run once at the end, alone.
