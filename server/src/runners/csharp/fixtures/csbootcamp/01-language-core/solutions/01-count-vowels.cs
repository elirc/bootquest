// ─────────────────────────────────────────────────────────────────────────
//  01 · count the vowels — SOLUTION                         ★☆☆ warm-up
//  concepts: strings · loops · char
//  run: dotnet run 01-count-vowels.cs
// ─────────────────────────────────────────────────────────────────────────
//
//  Walkthrough:
//  A string is a sequence of chars, so `foreach (var c in text)` is the
//  plain loop — and because LINQ works on any IEnumerable<T>, the whole
//  thing collapses to one Count with a predicate. Both are idiomatic;
//  the LINQ version is what you would write in review.
//  The case question has two answers and only one of them is right.
//  `char.ToLower(c)` uses the CURRENT CULTURE, which is a real bug in
//  Turkish locales (where lowercasing 'I' does not give 'i'). Comparing
//  against a set of both cases, or using `char.ToLowerInvariant`, is
//  culture-proof. This is your first meeting with a rule that runs
//  through the whole track: text operations that "obviously" do not
//  depend on locale usually do.
//  The classic wrong turn is `text.Count(c => "aeiou".Contains(c))`
//  without handling case — green on "hello", red on "HELLO".

#:project ../../_lib/Check/Check.csproj

using static Bootcamp.Check;

static int CountVowels(string text) =>
    text.Count(c => "aeiouAEIOU".Contains(c));

// ─── tests ───────────────────────────────────────────────────────────────

Test("counts lowercase vowels", () => Eq(CountVowels("hello"), 2));

Test("is case-insensitive", () => Eq(CountVowels("HELLO"), 2));

Test("handles the empty string", () => Eq(CountVowels(""), 0));

Test("counts nothing in a word with no vowels", () => Eq(CountVowels("rhythm"), 0));

Test("counts every vowel exactly once", () => Eq(CountVowels("AeIoU"), 5));

Test("ignores digits and punctuation", () => Eq(CountVowels("a1e-i!"), 3));

return Report();
