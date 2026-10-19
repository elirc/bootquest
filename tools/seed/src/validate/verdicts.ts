/**
 * Failure names that mean "the code never got a test verdict" — THE one set, shared by the
 * import gate (drill-cs and drill-java starters in validate.ts / validate-java.ts) and the seed
 * factory harness (factory/harness/harness.ts re-exports it). A starter that "fails" only
 * this way proves nothing: no test ever ran.
 *   drill-js / self-run:  code loads without errors, code runs, finishes in time, TypeScript compiles, grader results
 *   drill-cs:             (compile), (timeout), (program) (crash / no nonce-checked result),
 *                         (format), (runner) (xunit run produced no TRX), (scaffolding) (frozen section edited),
 *                         (incomplete) (the harness reported before every literal test ran)
 *   drill-java:           (compile), (timeout), (program), (format), (incomplete)
 *
 * This lives in its own leaf module (no imports) so the factory harness can share it without
 * pulling validate.ts's server-grader imports into every generator's seed-fingerprint closure.
 */
export const NOT_A_VERDICT: ReadonlySet<string> = new Set([
  'code loads without errors',
  'code runs',
  'finishes in time',
  'TypeScript compiles',
  'grader results',
  '(compile)',
  '(timeout)',
  '(program)',
  '(format)',
  '(runner)',
  '(scaffolding)',
  '(incomplete)',
]);
