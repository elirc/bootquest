// javabootcamp format handler (elirc/javabootcamp `bootcamp/NN-*/{exercises,solutions}/*.java`).
//
// Each exercise is one top-level `class Exercise` (no package): header comments,
// `import static bootcamp.Check.*;`, the starter methods, then the tests block
//
//     // ─── tests ───────────────────────────────────────
//     public static void main(String[] args) { test(...); ... System.exit(report()); }
//     // ─── end tests ───────────────────────────────────
//
// and the class's closing brace (the tail). Solutions repeat the SAME tests block
// byte for byte.
//
// Grading rule (as csbootcamp): the learner owns everything except the tests
// block. The graded program = learner.head + EXERCISE.tests + learner.tail, so the
// learner cannot edit the tests and a solution is graded against the exercise's
// tests, not its own copy. Line numbers of the learner's file are preserved as
// long as the tests block has the same length.

/** `// ─── tests ───…` (indented: it lives inside the class body). */
export const TESTS_MARKER = /^[ \t]*\/\/ ─+ tests ─+[ \t]*$/m;
/** `// ─── end tests ───…` closes the block (inclusive). */
export const END_TESTS_MARKER = /^[ \t]*\/\/ ─+ end tests ─+[ \t]*$/m;

export interface SplitFile {
  head: string; // everything before the tests marker line (from its line start)
  tests: string; // tests marker line .. end-tests marker line (inclusive), trailing newline kept
  tail: string; // after the end-tests line (the class's closing brace), may be ''
}

export class JavabootcampFormatError extends Error {}

export function normalize(src: string): string {
  return src.replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

export function splitAtTestsMarker(src: string): SplitFile {
  const text = normalize(src);
  const m = TESTS_MARKER.exec(text);
  if (!m) throw new JavabootcampFormatError('no `// ─── tests ───` marker found');
  const head = text.slice(0, m.index);
  const rest = text.slice(m.index);
  const e = END_TESTS_MARKER.exec(rest);
  if (!e) throw new JavabootcampFormatError('tests block has no `// ─── end tests ───` line');
  let end = e.index + e[0].length;
  if (rest[end] === '\n') end += 1;
  return { head, tests: rest.slice(0, end), tail: rest.slice(end) };
}

/**
 * Compose the program to grade: learner code (starter, attempt or solution) with
 * the canonical tests of the exercise. A learner file without the tests marker is
 * treated as all-head (they pasted just their code) and gets the exercise's tail.
 */
export function composeGraded(learnerSrc: string, exerciseSrc: string): string {
  const ex = splitAtTestsMarker(exerciseSrc);
  const text = normalize(learnerSrc);
  let head: string;
  let tail: string;
  if (TESTS_MARKER.test(text)) {
    const l = splitAtTestsMarker(text);
    head = l.head;
    tail = l.tail;
  } else {
    head = text.endsWith('\n') ? text : text + '\n';
    tail = ex.tail;
  }
  return head + ex.tests + tail;
}

function unescapeJava(s: string): string {
  return s.replace(/\\(u+[0-9a-fA-F]{4}|[0-7]{1,3}|.)/g, (_, e: string) => {
    if (e[0] === 'u') return String.fromCharCode(parseInt(e.replace(/^u+/, ''), 16));
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', s: ' ' } as Record<string, string>)[e] ?? e;
  });
}

/**
 * The test names a tests block registers with a plain string literal
 * (`test("name", ...)`). The runner requires every one of them in the result,
 * so a learner who reports early (`report()` / `System.exit` from inside their
 * code, before the remaining tests ran) is an incomplete run, never a pass.
 * Names built at run time (loops, concatenation) are not listed.
 */
export function literalTestNames(tests: string): string[] {
  const names: string[] = [];
  const code = tests.replace(/^\s*\/\/.*$/gm, ''); // whole-line comments register nothing
  for (const m of code.matchAll(/\btest\(\s*"((?:[^"\\\n]|\\.)*)"\s*,/g)) names.push(unescapeJava(m[1]!));
  return names;
}
