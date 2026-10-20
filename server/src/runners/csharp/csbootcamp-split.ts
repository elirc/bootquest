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
 *
 * With a `gate` (the runner always passes one; see wrapTestsBlock) the canonical
 * tests block is wrapped in a local function of that per-grade random name, which
 * the launcher (BqLaunch.cs) requires directly beneath every harness record it
 * believes.
 */
export function composeGraded(learnerSrc: string, exerciseSrc: string, gate?: string): string {
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
  return rewriteDirectives(head + (gate === undefined ? ex.tests : wrapTestsBlock(ex.tests, gate, 'csbootcamp')) + tail);
}

/** A gate name the runner may use: a C# identifier no submission can have spelled (fresh per grade). */
export const GATE_NAME = /^__bqTests_[0-9a-f]{16}$/;

/**
 * Wrap a canonical tests block in a local function named `gate` and call it where the
 * block used to run, WITHOUT changing the line count (compiler line numbers of the
 * learner's file stay true):
 *   csbootcamp: `int <gate>() { // ─── tests ───` … `return Report(); } return <gate>();`
 *   jstrain:    `void <gate>() { // ─── tests ───` … `} <gate>();` on the block's last line
 *               (a blank or comment-only last line; a code last line gets one extra line).
 *
 * Why (verdict integrity, see BqLaunch.cs): the harness's Test/Report are public and
 * learner code compiles into the same assembly, so "printed by Check.dll" proves
 * nothing about WHO called Test. The launcher records a test only when the Check.Test
 * frame is called directly by this wrapper, called directly by the entry point. The
 * name is random per grade, so no submission can name it, and the launcher refuses
 * to grade a program in which the wrapper does not exist: learner text that comments
 * out / `#if`s away / string-swallows the canonical block removes the wrapper too.
 * The wrapper body is exactly the canonical block: once its opener parses as code,
 * nothing outside the block can change where the block ends.
 */
export function wrapTestsBlock(tests: string, gate: string, format: 'csbootcamp' | 'jstrain'): string {
  if (!GATE_NAME.test(gate)) throw new CsbootcampFormatError(`invalid gate name ${JSON.stringify(gate)}`);
  if (!TESTS_MARKER.test(tests) || TESTS_MARKER.exec(tests)!.index !== 0) throw new CsbootcampFormatError('tests block does not start with the tests marker');
  if (format === 'csbootcamp') {
    const r = /return\s+Report\(\)\s*;(?=\s*$)/.exec(tests);
    if (!r) throw new CsbootcampFormatError('tests block does not end with `return Report();`');
    const end = r.index + r[0].length;
    return `int ${gate}() { ${tests.slice(0, end)} } return ${gate}();${tests.slice(end)}`;
  }
  const closer = `} ${gate}();`;
  const open = `void ${gate}() { `;
  const nl = tests.endsWith('\n');
  const lines = (nl ? tests.slice(0, -1) : tests).split('\n');
  const last = lines.length - 1;
  const l = lines[last]!;
  if (last > 0 && l.trim() === '') lines[last] = closer;
  else if (last > 0 && l.trimStart().startsWith('//')) lines[last] = `${closer} ${l}`;
  else lines.push(closer);
  return open + lines.join('\n') + (nl ? '\n' : '');
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
export function composeGradedJstrain(learnerSrc: string, exerciseSrc: string, gate?: string): string {
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
  return rewriteDirectives(head + (gate === undefined ? ex.tests : wrapTestsBlock(ex.tests, gate, 'jstrain')) + tail);
}

function unescapeCs(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|x[0-9a-fA-F]{1,4}|.)/g, (_, e: string) => {
    if (e[0] === 'u' || e[0] === 'U' || (e[0] === 'x' && e.length > 1)) return String.fromCodePoint(parseInt(e.slice(1), 16));
    return ({ n: '\n', t: '\t', r: '\r', 0: '\0', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b' } as Record<string, string>)[e] ?? e;
  });
}

/**
 * The test names a tests block registers with a plain string literal
 * (`Test("name", ...)`, either harness revision). The runner requires every one of
 * them in the recorded report, so a run that stops early (an `Environment.Exit` from
 * inside learner code, before the remaining tests ran) is incomplete, never a pass.
 * This is a completeness check only: a name being present proves nothing about who
 * called Test with it (Test is public and learner code shares the assembly). That
 * a recorded test came from the canonical block is the launcher's stack rule
 * (BqLaunch.cs + wrapTestsBlock). Names built at run time (interpolation, loops,
 * verbatim or raw literals) are not listed.
 */
export function literalTestNames(tests: string): string[] {
  const names: string[] = [];
  const code = normalize(tests).replace(/^\s*\/\/.*$/gm, ''); // whole-line comments register nothing
  for (const m of code.matchAll(/(?<![\w.])(?:Check\.)?Test\(\s*"((?:[^"\\\n]|\\.)*)"\s*,/g)) names.push(unescapeCs(m[1]!));
  return names;
}

/** True when the module follows the inverted ("ships red") contract. */
export function isHuntModule(moduleDir: string): boolean {
  return /-debug|-hunts?$/.test(moduleDir);
}
