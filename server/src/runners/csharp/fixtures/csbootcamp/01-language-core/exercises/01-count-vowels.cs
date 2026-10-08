// ─────────────────────────────────────────────────────────────────────────
//  01 · count the vowels                                    ★☆☆ warm-up
//  concepts: strings · loops · char
//  run: dotnet run 01-count-vowels.cs
// ─────────────────────────────────────────────────────────────────────────
//
//  A tag cleaner needs to know how "sayable" a slug is, and the crude
//  proxy is the vowel count. Write CountVowels: how many characters of
//  the text are a, e, i, o or u, in either case.
//
//      CountVowels("hello")   → 2
//      CountVowels("HELLO")   → 2
//      CountVowels("rhythm")  → 0
//
//  A string is an IEnumerable<char>, so you can foreach over it.

#:project ../../_lib/Check/Check.csproj

using static Bootcamp.Check;

static int CountVowels(string text) => throw new NotImplementedException("TODO");

// ─── tests ───────────────────────────────────────────────────────────────

Test("counts lowercase vowels", () => Eq(CountVowels("hello"), 2));

Test("is case-insensitive", () => Eq(CountVowels("HELLO"), 2));

Test("handles the empty string", () => Eq(CountVowels(""), 0));

Test("counts nothing in a word with no vowels", () => Eq(CountVowels("rhythm"), 0));

Test("counts every vowel exactly once", () => Eq(CountVowels("AeIoU"), 5));

Test("ignores digits and punctuation", () => Eq(CountVowels("a1e-i!"), 3));

return Report();
