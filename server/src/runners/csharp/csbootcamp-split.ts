// csbootcamp format handler (elirc/csbootcamp `bootcamp/NN-*/{exercises,solutions}/*.cs`).
//
// Each exercise is a .NET 10 file-based app: header comments, `#:project
// ../../_lib/Check/Check.csproj`, `using static Bootcamp.Check;`, starter code,
// then a divider `// ─── tests ───…`, the `Test(...)` calls, `return Report();`,
// and OPTIONALLY a `// ─── the types ───` section after Report() (records/classes
// must follow top-level statements — from module 05 on, the stub class the learner
// edits lives down there). Solutions repeat the SAME tests.
//
// Grading rule: the learner owns everything except the tests block. The graded
// program = learner.head + EXERCISE.tests + learner.tail, so the learner can't
// edit the tests, and a solution file is graded against the exercise's tests (not
// its own copy). Line numbers of the learner's file are preserved as long as the
// tests block has the same length (it does unless the learner edited tests).

export const TESTS_MARKER = /^\/\/ ─+ tests ─+\s*$/m;
const REPORT_LINE = /^\s*return\s+Report\(\)\s*;\s*$/m;
const PROJECT_DIRECTIVE = /^#:project\s+(\S+)\s*$/;

export interface SplitFile {
  head: string; // everything before the tests marker line
  tests: string; // marker line .. `return Report();` line (inclusive), trailing newline kept
  tail: string; // after `return Report();` (the types section), may be ''
}

export class CsbootcampFormatError extends Error {}

function normalize(src: string): string {
  return src.replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

export function splitAtTestsMarker(src: string): SplitFile {
  const text = normalize(src);
  const m = TESTS_MARKER.exec(text);
  if (!m) throw new CsbootcampFormatError('no `// ─── tests ───` marker found');
  const head = text.slice(0, m.index);
  const rest = text.slice(m.index);
  const r = REPORT_LINE.exec(rest);
  if (!r) throw new CsbootcampFormatError('tests block has no `return Report();` line');
  let end = r.index + r[0].length;
  if (rest[end] === '\n') end += 1;
  return { head, tests: rest.slice(0, end), tail: rest.slice(end) };
}

/**
 * Rewrite file-based-app directives for the warm console-check scratch project.
 * `#:project …/Check.csproj` → the prebuilt Check.dll is already referenced, so the
 * line becomes a comment (same line count → compiler line numbers stay true).
 * Any other `#:` directive (package/sdk/property) is unsupported by the warm path.
 */
export function rewriteDirectives(src: string): string {
  return src
    .split('\n')
    .map((line, i) => {
      if (!line.startsWith('#:')) return line;
      const p = PROJECT_DIRECTIVE.exec(line.trim());
      if (p && /(^|[\\/])Check\.csproj$/.test(p[1]!)) return `// [bootquest] ${line.slice(2)}`;
      throw new CsbootcampFormatError(`line ${i + 1}: unsupported file-based-app directive: ${line.trim()}`);
    })
    .join('\n');
}

/**
 * Compose the program to grade: learner code (starter, attempt or solution) with
 * the canonical tests of the exercise. A learner file without a marker is treated
 * as all-head (they pasted just their code).
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
    tail = ex.tail; // keep the exercise's types section if the learner sent code only
  }
  return rewriteDirectives(head + ex.tests + tail);
}

// ── jstrain2.2's embedded csbootcamp revision (W3c) ───────────────────────────
//
// Same `// ─── tests ───` divider and header conventions, but its harness reports
// itself at ProcessExit, so there is NO `return Report();`: the tests block runs
// from the tests divider to the NEXT labelled divider (`// ─── types ───`, where
// records/classes must live after the top-level statements) or EOF. Same
// grading rule: learner.head + EXERCISE.tests + learner.tail.

const SECTION_DIVIDER = /^\/\/ ─+ \S.*? ─+[ \t]*$/m;

export function splitJstrainCs(src: string): SplitFile {
  const text = normalize(src);
  const m = TESTS_MARKER.exec(text);
  if (!m) throw new CsbootcampFormatError('no `// ─── tests ───` marker found');
  const head = text.slice(0, m.index);
  const afterMarker = m.index + m[0].length;
  const rest = text.slice(afterMarker);
  const next = SECTION_DIVIDER.exec(rest);
  const end = next ? afterMarker + next.index : text.length;
  return { head, tests: text.slice(m.index, end), tail: text.slice(end) };
}

/** composeGraded for the jstrain revision (tests end at the next divider, not at `return Report();`). */
export function composeGradedJstrain(learnerSrc: string, exerciseSrc: string): string {
  const ex = splitJstrainCs(exerciseSrc);
  const text = normalize(learnerSrc);
  let head: string;
  let tail: string;
  if (TESTS_MARKER.test(text)) {
    const l = splitJstrainCs(text);
    head = l.head;
    tail = l.tail;
  } else {
    head = text.endsWith('\n') ? text : text + '\n';
    tail = ex.tail;
  }
  return rewriteDirectives(head + ex.tests + tail);
}

/** True when the module follows the inverted ("ships red") contract. */
export function isHuntModule(moduleDir: string): boolean {
  return /-debug|-hunts?$/.test(moduleDir);
}
