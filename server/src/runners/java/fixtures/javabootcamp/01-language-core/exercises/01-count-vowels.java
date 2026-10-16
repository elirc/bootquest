// ─────────────────────────────────────────────────────────────────────────
//  01 · count the vowels                                    ★☆☆ warm-up
//  concepts: strings · loops · char
//  run: java -cp ../../_lib/out 01-count-vowels.java
// ─────────────────────────────────────────────────────────────────────────
//
//  A to-do manager wants a crude "how sayable is this tag" score, and the
//  proxy is the vowel count. Write countVowels: how many characters of the
//  text are a, e, i, o or u, in either case.
//
//      countVowels("hello")   → 2
//      countVowels("HELLO")   → 2
//      countVowels("rhythm")  → 0
//
//  hint: text.charAt(i) in a counted loop, or text.chars() as a stream.

import static bootcamp.Check.*;

class Exercise {

    static int countVowels(String text) {
        throw new UnsupportedOperationException("TODO");
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
