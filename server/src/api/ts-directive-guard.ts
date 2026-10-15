import type { CheckSpec } from '@bootquest/shared';
import { normalizeSource, TESTS_DIVIDER } from '../runners/self-run/compose.ts';

/**
 * campaign 2 release (F3): a type-check leg cannot be switched off by the learner.
 *
 * Two graders run the repo-pinned `tsc` as part of the verdict: self-run TS drills
 * (`spec.tsc`, jstrain tsbootcamp) and the node-test-file U03 composite (`tscProject`).
 * A `// @ts-nocheck` (whole file), `// @ts-ignore` or `// @ts-expect-error` (next line) in
 * the learner's own code would silence exactly the errors that leg grades, so such a
 * submission is REFUSED before anything runs (422 TYPECHECK_SUPPRESSED, nothing recorded).
 *
 * Only learner-editable text is scanned: for self-run that is the head (the protected tests
 * after the divider legitimately use `@ts-expect-error` probes and are replaced by the
 * shipped copy anyway, compose.ts); for node-test-file it is the whole learner module.
 * Detection is deliberately conservative: a directive-shaped comment start anywhere in the
 * line (`//`, `///`, `/*`, a `*` block-comment line, or a line that starts with the directive
 * inside a block comment) counts, even
 * where tsc might not honour it. Prose that merely mentions a directive mid-comment
 * ("what the @ts-expect-error probes catch") does not.
 *
 * This lives in the API layer on purpose: the self-run runner and runners.ts are part of
 * the grader fingerprints, and the guard decides what may be graded, not how.
 *
 * Whitespace is matched with \s (tsc also accepts \v, \f, NBSP and BOM there), and lines are
 * split on every terminator the TypeScript scanner honours (CR, LF, U+2028, U+2029), so a lone
 * CR inside a block comment cannot hide a directive on its "last line" (release review of F3).
 */
export const SUPPRESSION_DIRECTIVE = /(?:\/\/|\/\*|^\s*\*|^)[\s/*]*@ts-(nocheck|ignore|expect-error)\b/iu;
/** Every line terminator the TypeScript scanner recognises. */
const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/;

/** The learner-editable text of a submission for a type-checked spec, or null when the spec has no tsc leg. */
export function typeCheckedLearnerText(spec: CheckSpec, code: string): string | null {
  if (spec.type === 'self-run' && spec.language === 'ts' && spec.tsc) {
    const text = normalizeSource(code);
    const m = TESTS_DIVIDER.exec(text);
    return m ? text.slice(0, m.index) : text;
  }
  if (spec.type === 'node-test-file' && spec.tscProject !== undefined) return code;
  return null;
}

/** The first suppression directive in the learner-editable code of a type-checked spec (1-based line), or null. */
export function findTypeCheckSuppression(spec: CheckSpec, code: string): { directive: string; line: number } | null {
  const text = typeCheckedLearnerText(spec, code);
  if (text === null) return null;
  const lines = text.split(LINE_BREAK);
  for (let i = 0; i < lines.length; i++) {
    const m = SUPPRESSION_DIRECTIVE.exec(lines[i]!);
    if (m) return { directive: `@ts-${m[1]!.toLowerCase()}`, line: i + 1 };
  }
  return null;
}
