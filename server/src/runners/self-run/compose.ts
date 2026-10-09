// jstrain2.2 self-testing file format (bootcamp/_lib/FORMAT.md, tsbootcamp/_lib/FORMAT-TS.md).
//
// An exercise is ONE file: header comments, imports from ../../_lib/check.js
// (or check.ts + type-assert.ts), starter code, then a divider line
//     // ──────────── tests ────────────      (JS track)
//     // ──────────── runtime tests ────────  (TS track; `type tests` follow)
//     // ─── meta-tests (do not edit) ───      (29-write-the-test)
// and the tests to EOF. Solutions repeat the same tests.
//
// Grading rule (same as the C# console-check split, W3a): the learner owns the
// head; the graded program is learner.head + EXERCISE.tests, so a submission can
// never edit, drop or add to the shipped tests (a learner file without the
// divider is treated as all-head). Head line numbers are preserved.
//
// Frozen scaffolding: some heads carry labelled sections the tests depend on
// (`// ── fixtures ──`, `// ── fake responses ──`, the "provided"
// implementations of write-the-test). A section is FROZEN when its body
// (comments + blank lines stripped) appears verbatim in the reference
// solution's head — the solution did not need to touch it. The importer records
// frozen bodies in the check spec; the runner refuses (structured failure) a
// submission that no longer contains them.

export const TESTS_DIVIDER = /^\/\/ ─+ (tests|runtime tests|meta-tests \(do not edit\)) ─+[ \t]*$/m;
/** any labelled divider line: `// ── label ──…` */
const SECTION_DIVIDER = /^\/\/ ─+ (\S.*?) ─+[ \t]*$/;

export class SelfRunFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfRunFormatError';
  }
}

export const normalizeSource = (src: string): string => src.replace(/^﻿/, '').replace(/\r\n/g, '\n');

export interface SelfRunSplit {
  /** everything before the tests divider line (the learner's part) */
  head: string;
  /** the divider line through EOF (the protected part) */
  tests: string;
}

export function splitSelfRun(src: string): SelfRunSplit {
  const text = normalizeSource(src);
  const m = TESTS_DIVIDER.exec(text);
  if (!m) throw new SelfRunFormatError('no `// ─── tests ───` (or `runtime tests` / `meta-tests`) divider found');
  return { head: text.slice(0, m.index), tests: text.slice(m.index) };
}

/** learner head (their file up to its own divider, or all of it) + the exercise's protected tests. */
export function composeSelfRun(learnerSrc: string, exerciseTests: string): string {
  if (!TESTS_DIVIDER.test(exerciseTests.split('\n')[0] ?? '')) {
    throw new SelfRunFormatError('the protected tests block must start with its divider line');
  }
  const text = normalizeSource(learnerSrc);
  const m = TESTS_DIVIDER.exec(text);
  let head = m ? text.slice(0, m.index) : text;
  if (head.length > 0 && !head.endsWith('\n')) head += '\n';
  return head + exerciseTests;
}

/** Strip `//` comments (full-line, or after whitespace) and trailing blanks; drop empty lines. */
export function normalizeForFrozen(text: string): string {
  return normalizeSource(text)
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s+\/\/\s.*$/, '').replace(/\s+$/, ''))
    .filter((l) => l !== '')
    .join('\n');
}

export interface FrozenBlock {
  label: string;
  body: string;
}

/** Labelled sections of a head: [label, body] for every divider before the tests divider. */
export function headSections(head: string): FrozenBlock[] {
  const lines = normalizeSource(head).split('\n');
  const out: FrozenBlock[] = [];
  let cur: { label: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = SECTION_DIVIDER.exec(line);
    if (m) {
      if (cur) out.push({ label: cur.label, body: cur.body.join('\n') });
      cur = { label: m[1]!.trim(), body: [] };
      continue;
    }
    if (cur) cur.body.push(line);
  }
  if (cur) out.push({ label: cur.label, body: cur.body.join('\n') });
  return out;
}

/**
 * Frozen scaffolding of an exercise: labelled head sections whose normalized
 * body appears verbatim in the solution's normalized head. Bodies are stored
 * normalized.
 */
export function frozenBlocks(exerciseHead: string, solutionHead: string): FrozenBlock[] {
  const sol = normalizeForFrozen(solutionHead);
  const out: FrozenBlock[] = [];
  for (const s of headSections(exerciseHead)) {
    const body = normalizeForFrozen(s.body);
    if (body && sol.includes(body)) out.push({ label: s.label, body });
  }
  return out;
}

/**
 * Frozen blocks missing from a learner submission (normalized comparison).
 * Self-run files: only the head is the learner's (cut at the tests divider).
 * `wholeFile` (jstrain-cs C#, where scaffolding also lives AFTER the tests):
 * the whole submission is searched.
 */
export function missingFrozen(learnerSrc: string, frozen: readonly FrozenBlock[], opts: { wholeFile?: boolean } = {}): FrozenBlock[] {
  if (frozen.length === 0) return [];
  const text = normalizeSource(learnerSrc);
  const m = opts.wholeFile ? null : TESTS_DIVIDER.exec(text);
  const head = normalizeForFrozen(m ? text.slice(0, m.index) : text);
  return frozen.filter((f) => !head.includes(f.body));
}

/** True when the module follows the inverted ("ships red") contract: `-debug` anywhere or a `-hunts` suffix. */
export function isHuntModule(moduleDir: string): boolean {
  return /-debug|-hunts?$/.test(moduleDir);
}
