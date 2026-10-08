/**
 * Batch citation validation: one guide (or many) against one repo tree.
 * Feeds the seed:validate gate — `summary.failed === 0` is green.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseCitations, type Citation, type ParseNote } from './parse.ts';
import { buildRepoIndex, resolveCitation, type RepoIndex, type Resolution } from './resolve.ts';

export type Verdict = Resolution | { status: 'skipped'; reason: string };

export interface CitationResult {
  citation: Citation;
  verdict: Verdict;
}

export interface Summary {
  /** ok + failed (skipped citations are not counted toward the gate). */
  total: number;
  ok: number;
  failed: number;
  skipped: number;
  /** Resolved-ok citations whose inherited file was a guess among 2+ block files (not a gate failure). */
  warnings: number;
}

export interface GuideReport {
  guide: string;
  results: CitationResult[];
  notes: ParseNote[];
  summary: Summary;
}

export interface ValidateOptions {
  /** Reuse one index across guides of the same repo. */
  index?: RepoIndex;
  /** Passed to buildRepoIndex when no index is given (default DEFAULT_EXCLUDED_DIRS). */
  excludeDirs?: string[];
  /**
   * Whitelist (estate-contract §2.3: runtime files like `dev.db`, files a doc marks absent).
   * A string matches the cited path exactly or as a '/'-suffix; a RegExp is tested against it.
   */
  ignore?: Array<string | RegExp>;
  /** 'check' (default) validates path-only citations too; 'skip' marks them skipped. */
  pathOnly?: 'check' | 'skip';
}

function ignored(p: string, ignore: Array<string | RegExp>): string | null {
  for (const rule of ignore) {
    if (typeof rule === 'string' ? p === rule || p.endsWith(`/${rule}`) : rule.test(p)) return `ignored by ${String(rule)}`;
  }
  return null;
}

export function summarise(results: CitationResult[]): Summary {
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let warnings = 0;
  for (const r of results) {
    if (r.verdict.status === 'ok') {
      ok++;
      if (r.citation.inheritAmbiguous) warnings++;
    } else if (r.verdict.status === 'error') failed++;
    else skipped++;
  }
  return { total: ok + failed, ok, failed, skipped, warnings };
}

/** Validate already-loaded guide text. `guidePath` is repo-relative. */
export function validateGuideText(repoRoot: string, guidePath: string, text: string, opts: ValidateOptions = {}): GuideReport {
  const index = opts.index ?? buildRepoIndex(repoRoot, opts.excludeDirs);
  const { citations, notes } = parseCitations(text, guidePath);
  const results: CitationResult[] = citations.map((citation) => {
    if (citation.path !== null && opts.ignore?.length) {
      const why = ignored(citation.path, opts.ignore);
      if (why) return { citation, verdict: { status: 'skipped', reason: why } };
    }
    if (opts.pathOnly === 'skip' && citation.form === 'path-only') {
      return { citation, verdict: { status: 'skipped', reason: 'path-only citations skipped' } };
    }
    return { citation, verdict: resolveCitation(repoRoot, guidePath, citation, index) };
  });
  return { guide: guidePath, results, notes, summary: summarise(results) };
}

/** Read a guide (repo-relative or absolute path) and validate every citation in it. */
export function validateGuide(repoRoot: string, guidePath: string, opts: ValidateOptions = {}): GuideReport {
  const abs = path.isAbsolute(guidePath) ? guidePath : path.join(repoRoot, guidePath);
  const rel = path.relative(path.resolve(repoRoot), abs).replace(/\\/g, '/');
  return validateGuideText(repoRoot, rel, fs.readFileSync(abs, 'utf8'), opts);
}

/** Validate many guides of one repo with one shared index. */
export function validateGuides(
  repoRoot: string,
  guidePaths: string[],
  opts: ValidateOptions = {},
): { reports: GuideReport[]; summary: Summary } {
  const index = opts.index ?? buildRepoIndex(repoRoot, opts.excludeDirs);
  const reports = guidePaths.map((g) => validateGuide(repoRoot, g, { ...opts, index }));
  return { reports, summary: summarise(reports.flatMap((r) => r.results)) };
}

/** One line per ok-but-guessed inherited citation, for human review. */
export function formatWarnings(report: GuideReport): string[] {
  return report.results
    .filter((r) => r.verdict.status === 'ok' && r.citation.inheritAmbiguous)
    .map(({ citation: c }) => {
      const where = `${c.source.file}:${c.source.line}:${c.source.column}`;
      return `${where} \`${c.raw}\` bound to ${c.path} (block also cites: ${c.inheritAmbiguous!.filter((f) => f !== c.path).join(', ')})`;
    });
}

/** One line per failure: `guide.md:12:5 \`raw\` -> reason: message [candidates]`. */
export function formatFailures(report: GuideReport): string[] {
  const out: string[] = [];
  for (const { citation: c, verdict: v } of report.results) {
    if (v.status !== 'error') continue;
    const where = `${c.source.file}:${c.source.line}:${c.source.column}`;
    const cands = v.candidates ? ` [${v.candidates.join(', ')}]` : '';
    out.push(`${where} \`${c.raw}\` -> ${v.reason}: ${v.message}${cands}`);
  }
  return out;
}
