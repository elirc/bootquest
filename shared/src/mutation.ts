/**
 * Mutation gate (spec §5, W6; thresholds from docs/recon/stryker-spike.md).
 *
 * ZOD-FREE on purpose: the CLI imports this at runtime (it parses Stryker's
 * JSON report and pre-checks the gate) and the server imports it to RE-EVALUATE
 * the same numbers before it records anything — the CLI's verdict is never
 * trusted on its own.
 *
 * Semantics (BINDING, spike memo):
 *  - per file: score = (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage).
 *    NoCoverage counts as a failure (the TOTAL score, not the covered score);
 *    Ignored / CompileError / RuntimeError / Pending are left out.
 *  - per-FILE floor (default 40%, per-lesson override) — Stryker's own aggregate
 *    `break` misses a gutted file diluted by honest ones;
 *  - AND an overall break of 60% as the second net.
 */

export const DEFAULT_FILE_FLOOR_PCT = 40;
export const OVERALL_BREAK_PCT = 60;
/** hard wall-clock cap for one `bootquest mutate` run */
export const MUTATE_TIMEOUT_MS = 15 * 60 * 1000;

export const MUTATION_TOOLS = ['stryker-js', 'stryker-net'] as const;
export type MutationTool = (typeof MUTATION_TOOLS)[number];

export interface MutationFileStat {
  /** report path (relative to the project as Stryker printed it) */
  path: string;
  killed: number;
  timeout: number;
  survived: number;
  noCoverage: number;
}

export interface Survivor {
  path: string;
  line: number | null;
  mutator: string;
  replacement: string | null;
  status: 'Survived' | 'NoCoverage';
}

export interface ParsedMutationReport {
  files: MutationFileStat[];
  survivors: Survivor[];
}

export interface FileVerdict {
  path: string;
  /** null when the file has no scorable mutants (all ignored / compile errors) */
  scorePct: number | null;
  pass: boolean;
}

export interface MutationVerdict {
  pass: boolean;
  overallPct: number | null;
  floorPct: number;
  breakPct: number;
  files: FileVerdict[];
  /** human-readable reasons the gate failed (empty on pass) */
  failures: string[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function fileScorePct(f: MutationFileStat): number | null {
  const detected = f.killed + f.timeout;
  const total = detected + f.survived + f.noCoverage;
  return total === 0 ? null : round2((detected / total) * 100);
}

/** The gate. A file with no scorable mutants neither passes nor fails it; a report with none at all fails. */
export function evaluateMutation(
  files: readonly MutationFileStat[],
  opts: { floorPct?: number; breakPct?: number } = {},
): MutationVerdict {
  const floorPct = opts.floorPct ?? DEFAULT_FILE_FLOOR_PCT;
  const breakPct = opts.breakPct ?? OVERALL_BREAK_PCT;
  const failures: string[] = [];
  const verdicts: FileVerdict[] = files.map((f) => {
    const scorePct = fileScorePct(f);
    const pass = scorePct === null || scorePct >= floorPct;
    if (!pass) failures.push(`${f.path}: ${scorePct}% < per-file floor ${floorPct}%`);
    return { path: f.path, scorePct, pass };
  });
  const sum = files.reduce(
    (a, f) => ({ detected: a.detected + f.killed + f.timeout, total: a.total + f.killed + f.timeout + f.survived + f.noCoverage }),
    { detected: 0, total: 0 },
  );
  const overallPct = sum.total === 0 ? null : round2((sum.detected / sum.total) * 100);
  if (overallPct === null) failures.push('the report holds no scorable mutants');
  else if (overallPct < breakPct) failures.push(`overall ${overallPct}% < break ${breakPct}%`);
  return { pass: failures.length === 0, overallPct, floorPct, breakPct, files: verdicts, failures };
}

/** The per-lesson floor: check.threshold (0..1) when set, else the 40% default. */
export function floorPctFor(threshold: number | null | undefined): number {
  return threshold === null || threshold === undefined ? DEFAULT_FILE_FLOOR_PCT : round2(threshold * 100);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class MutationReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutationReportError';
  }
}

/**
 * Parse a mutation-testing-elements JSON report (Stryker JS `reports/mutation/mutation.json`
 * and Stryker.NET `StrykerOutput/<ts>/reports/mutation-report.json` share the schema:
 * `files[path].mutants[].status`). Paths are normalized to forward slashes.
 */
export function parseMutationReport(json: unknown): ParsedMutationReport {
  if (!isObj(json) || !isObj(json.files)) throw new MutationReportError('not a mutation-testing-elements report (no `files` object)');
  const files: MutationFileStat[] = [];
  const survivors: Survivor[] = [];
  for (const [rawPath, entry] of Object.entries(json.files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isObj(entry) || !Array.isArray(entry.mutants)) throw new MutationReportError(`files["${rawPath}"] has no mutants array`);
    const path = rawPath.replace(/\\/g, '/');
    const stat: MutationFileStat = { path, killed: 0, timeout: 0, survived: 0, noCoverage: 0 };
    for (const m of entry.mutants as unknown[]) {
      if (!isObj(m) || typeof m.status !== 'string') throw new MutationReportError(`files["${rawPath}"] holds a mutant without a status`);
      switch (m.status) {
        case 'Killed':
          stat.killed += 1;
          break;
        case 'Timeout':
          stat.timeout += 1;
          break;
        case 'Survived':
        case 'NoCoverage': {
          if (m.status === 'Survived') stat.survived += 1;
          else stat.noCoverage += 1;
          const start = isObj(m.location) && isObj(m.location.start) ? m.location.start.line : null;
          survivors.push({
            path,
            line: typeof start === 'number' ? start : null,
            mutator: typeof m.mutatorName === 'string' ? m.mutatorName : 'unknown',
            replacement: typeof m.replacement === 'string' ? m.replacement : null,
            status: m.status,
          });
          break;
        }
        default:
          break; // Ignored, CompileError, RuntimeError, Pending: not part of the score
      }
    }
    files.push(stat);
  }
  if (files.length === 0) throw new MutationReportError('the report lists no files');
  return { files, survivors };
}
