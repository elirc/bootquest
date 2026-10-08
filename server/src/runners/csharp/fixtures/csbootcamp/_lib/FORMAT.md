# C# bootcamp authoring format — the contract

Every module in `bootcamp/` follows this format exactly. It is optimized for
offline solo study: every exercise is a single self-contained file, runnable
with plain `dotnet run <file>.cs`, readable top to bottom without opening
anything else.

## Why one file works at all

.NET 10 runs **file-based apps**: a `.cs` file with top-level statements is a
program, no `.csproj` required. The only thing an exercise needs from the
outside is the test harness, and it asks for that with one directive:

```csharp
#:project ../../_lib/Check/Check.csproj
```

That is the whole build system. No NuGet, no test runner, no solution file,
nothing to restore from the network.

## Module layout

```
bootcamp/NN-topic-name/
├── README.md          the lesson (read first, ~10 min)
├── exercises/
│   ├── 01-short-name.cs
│   └── ...
└── solutions/
    ├── 01-short-name.cs   same tests, working code, + walkthrough comment
    └── ...
```

- Two-digit numbering, kebab-case names, identical filenames between
  `exercises/` and `solutions/`.
- Zero dependencies. The BCL only — if it is not in the box, it is not used.
- Files starting with `_` are ignored by the tools.

## Exercise file template

```csharp
// ─────────────────────────────────────────────────────────────────────────
//  07 · two answers from one call                            ★☆☆ warm-up
//  concepts: value tuples · deconstruction
//  run: dotnet run 07-tuples-and-deconstruction.cs
// ─────────────────────────────────────────────────────────────────────────
//
//  Real-world setup in one or two sentences, then exactly what to build.
//  Show concrete input → output examples:
//
//      MinMax([3, 1, 4])   → (Min: 1, Max: 4)
//
//  hint: one line, last in the block, never the whole approach.

#:project ../../_lib/Check/Check.csproj

using static Bootcamp.Check;

static (int Min, int Max) MinMax(IEnumerable<int> numbers) =>
    throw new NotImplementedException("TODO");

// ─── tests ───────────────────────────────────────────────────────────────

Test("finds both ends", () => Eq(MinMax(new[] { 3, 1, 4 }), (1, 4)));

// ...4–9 focused tests total

return Report();

// ─── the types ───────────────────────────────────────────────────────────
// (only when the exercise needs them — see "Where the types go")

record Order(int Weight, string Destination);
```

Rules:

1. **Header block**: number · name, difficulty stars + tier, `concepts:`
   line, `run:` line. Difficulty: `★☆☆ warm-up`, `★★☆ core`,
   `★★★ stretch`.
2. **Prompt**: 3–18 comment lines. Concrete examples with `→` arrows. One
   `hint:` line for ★★☆ and up, placed last. Never reveal the approach.
3. **Starter code**: static local functions with real parameter names and
   `throw new NotImplementedException("TODO")` as the body — the harness
   reports that as `☐ todo`, not as a failure. One TODO per method.
4. **Tests**: 4–9 per exercise, after the divider. Names read as a spec
   ("is case-insensitive", not "test 2"). Cover the happy path, at least
   one edge case, and the tricky case that catches the naive solution.
   Every test must exercise the student's code — a test that passes
   against the untouched stub teaches nothing.
5. **`return Report();`** is the last statement. It prints the summary and
   becomes the process exit code, which is what the tools read.
6. Available from `Bootcamp.Check` via `using static`: `Test, Eq, Ok,
   Throws<T>, ThrowsAsync<T>, Approx, Sleep, Report`, plus the `Spy` and
   `Spy<T>` recorders. `Test` accepts an `Action` or a `Func<Task>`. `Eq`
   is deep and structural: lists, arrays and dictionaries compare by
   contents, not by reference.
7. Timers in tests: keep total waiting under ~300ms per file; assert order
   and counts, never exact milliseconds. Never depend on wall-clock time,
   the current culture, or randomness — inject them instead.
8. Comment lines ≤ 78 chars. Code: modern C#, `var` where the type is
   obvious, expression-bodied members where they fit, file-scoped style.

## Where the types go

C# requires top-level statements to come **before** any type declaration, so
an exercise that needs a `record`, `class` or `struct` puts it at the BOTTOM
of the file under a `// ─── the types ───` banner, after `return Report();`.
When that happens, say so in the prompt ("defined at the BOTTOM of this
file") — the reader should never have to hunt.

If the thing being built IS a type (module 05 onwards), the stub class lives
at the bottom too, and the prompt says the code you edit is down there.

## Solution file template

Identical file, with:

- ` — SOLUTION` appended to the header name line,
- a `Walkthrough:` comment block (6–20 lines) after the header explaining
  the approach and WHY, naming the concept it drills, the classic wrong
  turn, and — where it exists — the .NET-specific trap,
- the TODO replaced by a clean, idiomatic implementation,
- the SAME tests, unchanged.

Both files must run under `dotnet run`:

- exercise file → every test reports `todo`, exit code 0
- solution file → every test passes, exit code 0

## Module README.md (the lesson)

Structure, in order — total read ~8–12 minutes:

```md
# NN · Topic Name

One-paragraph "why this matters" hook.

## The mental model
The 2–4 core ideas, each with a tiny runnable snippet.

## The details that bite
Numbered gotchas with one-line code proof each.

## Cheat table (optional)
Small table if the topic is API-shaped.

## Exercises
| # | file | ★ | what you build |

Then: "Do the warm-ups and core in order. Stretch if time allows."
```

Tone: direct, second person, no fluff. A sharp senior explaining to a
junior at a whiteboard.

## The README footer (every module has one)

The last line of a module README, after a `---` rule. Two variants:

**Teaching modules** point at the reference, the recall check, and the next
stop:

```md
**Stuck?** `cheatsheets/x.md` (what's in it) · **Self-check:** `quizzes/NN-y.md` · **Next:** `bootcamp/NN-next`
```

**Reinforcement and hunt modules** deliberately drop the hint links —
finding the reference yourself is the retrieval those modules train — but
still carry a `Next:` so the path never dead-ends:

```md
**No "Stuck?" line here, on purpose** — … · **Next:** `bootcamp/NN-next`
```

## Debug / hunt modules (dir name contains `-debug`, or ends in `-hunts`)

These invert the contract: the student reads instead of writes. The
"ships-red" behaviour is triggered by the module directory name, and
`verify.cs` and `progress.cs` share that rule.

- The exercise ships **complete, plausible code** — no stubs, no TODO —
  with a planted defect: ≥1 failing test and 0 todos. `verify.cs` enforces
  both halves; a hunt exercise that already passes has no bug to find and
  is reported broken.
- The prompt states the CORRECT behaviour and the symptom. It never names
  the bug, the line, or the fix — that IS the exercise.
- The solution is the **minimal** fix, plus a `Walkthrough:` naming the bug
  CLASS so the next one is recognisable on sight.
- `progress.cs` shows a still-red hunt exercise as 🐛, not ✘: red is the
  starting state here, not a scolding.

## Verification (mandatory before you finish)

```
dotnet run bootcamp/verify.cs        every module
dotnet run bootcamp/verify.cs 07     one module
```

Every solution must end `all green — next file!`. Every exercise must report
only `todo` (0 failed) — or, in a hunt module, ≥1 failed and 0 todo. Fix
before finishing; do not report done with red files.

The first run compiles everything and is slow (a few seconds per file);
later runs hit the build cache. `verify.cs` runs files in parallel across
your cores.
