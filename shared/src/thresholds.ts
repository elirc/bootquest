/**
 * Pass marks shared by the server (which ENFORCES them) and the client (which only PREVIEWS
 * them before a self-score is filed). One definition, so the preview can never drift from the
 * rule.
 *
 * Deliberately import-free (no zod): the client imports this module at RUNTIME, and nothing in
 * it may pull the schema layer into the browser bundle. Re-exported by './api.ts' and the
 * package index.
 */

/**
 * Promotion leg (b): an explain-back counts at >= 80% self-scored key-point coverage. A unit's
 * own check may be stricter (its minCoverage), never laxer: the effective mark is the max of the
 * two, served to the client as ExplainBackPublic.minCoveragePct.
 */
export const PROMOTION_MIN_COVERAGE = 0.8;

/** G1 (spec §8): catch >= 8/10 seeded defects across the kata bank. */
export const G1_TARGET_RATE = 0.8;
export const G1_MIN_DEFECTS = 10;
