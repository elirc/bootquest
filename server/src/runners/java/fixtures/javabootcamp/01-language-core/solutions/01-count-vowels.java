// ─────────────────────────────────────────────────────────────────────────
//  01 · count the vowels — SOLUTION                         ★☆☆ warm-up
//  concepts: strings · loops · char
//  run: java -cp ../../_lib/out 01-count-vowels.java
// ─────────────────────────────────────────────────────────────────────────
//
//  Walkthrough:
//  A String is not Iterable in Java, so there is no for-each over it
//  directly. You have three idiomatic options: a counted loop with
//  charAt(i), a for-each over text.toCharArray() (which copies), or
//  text.chars() — an IntStream of the char values — with a filter and a
//  count. The stream version reads like the spec, so that is what is here.
//  The case question has a trap. toLowerCase() with no argument uses the
//  DEFAULT LOCALE, and in Turkish "I".toLowerCase() is a dotless ı, not i.
//  Checking membership in "aeiouAEIOU" sidesteps locale entirely; when you
//  do need to fold case on keys, say toLowerCase(Locale.ROOT).
//  Note that chars() yields ints, so indexOf(c) takes an int — no cast.
//  The classic wrong turn is "aeiou".indexOf(c) >= 0 without the capitals:
//  green on "hello", red on "HELLO".

import static bootcamp.Check.*;

class Exercise {

    static int countVowels(String text) {
        return (int) text.chars().filter(c -> "aeiouAEIOU".indexOf(c) >= 0).count();
    }

    // ─── tests ───────────────────────────────────────────────────────────
    public static void main(String[] args) {
        test("counts lowercase vowels", () -> eq(countVowels("hello"), 2));
        test("is case-insensitive", () -> eq(countVowels("HELLO"), 2));
        test("handles the empty string", () -> eq(countVowels(""), 0));
        test("counts nothing in a word with no vowels", () -> eq(countVowels("rhythm"), 0));
        test("counts every vowel exactly once", () -> eq(countVowels("AeIoU"), 5));
        test("ignores digits and punctuation", () -> eq(countVowels("a1e-i!"), 3));
        System.exit(report());
    }
    // ─── end tests ───────────────────────────────────────────────────────
}
