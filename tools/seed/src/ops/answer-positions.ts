// ui-audit #24 seed-time LINT: degenerate answer-key POSITIONS in multiple-choice content.
//
// Three quest packs (csharp-tut, csharp-interview, dotnet-snapshot) key every quiz at choice 0.
// The server now serves choices in a stable secret permutation (server/src/api/choice-order.ts),
// so the bias is no longer exploitable, but a pack whose keys pile up at one index is still an
// authoring smell (the generator or the drafter is not varying where the right answer sits) and
// would be live again on any surface that shows authored order. This lint reports it.
//
// Deliberately OUTSIDE the fingerprinted factory / validate code: it only READS items.json /
// pack JSON (no stamp check, no execution) and changes nothing, so it never invalidates a stamp.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AnswerPositionOptions {
  /** a pack is degenerate when MORE than this share of its keys sit at one index (default 0.7) */
  maxShare: number;
  /** ...and it has at least this many choice-graded quizzes (default 6) */
  minQuizzes: number;
}

export const DEFAULT_ANSWER_POSITION_OPTIONS: AnswerPositionOptions = { maxShare: 0.7, minQuizzes: 6 };

/** One pack's key-position histogram. */
export interface AnswerPositionRow {
  /** 'quests/<repo>' for seed quest packs, 'packs/<source>' for code packs */
  pack: string;
  quizzes: number;
  /** keys per stored choice index (index -> count) */
  histogram: Record<number, number>;
  dominantIndex: number | null;
  dominantShare: number;
  degenerate: boolean;
}

export interface AnswerPositionReport {
  rows: AnswerPositionRow[];
  offenders: AnswerPositionRow[];
  options: AnswerPositionOptions;
}

/** A choice-graded quiz check anywhere in a JSON value: its numeric answer key. */
interface ChoiceCheck {
  type: 'quiz';
  grading: 'choice';
  answerKey: number;
}

function isChoiceCheck(v: unknown): v is ChoiceCheck {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return o.type === 'quiz' && o.grading === 'choice' && typeof o.answerKey === 'number' && Number.isInteger(o.answerKey) && o.answerKey >= 0;
}

/**
 * Every choice-graded quiz answer key in a parsed document, in document order. A check object is
 * counted once (its nested values are not searched again).
 */
export function choiceAnswerKeys(doc: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown): void => {
    if (isChoiceCheck(v)) {
      out.push(v.answerKey);
      return;
    }
    if (Array.isArray(v)) for (const x of v) walk(x);
    else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) walk(x);
  };
  walk(doc);
  return out;
}

/** PURE: the histogram row for one pack's keys. */
export function answerPositionRow(pack: string, keys: readonly number[], options: AnswerPositionOptions = DEFAULT_ANSWER_POSITION_OPTIONS): AnswerPositionRow {
  const histogram: Record<number, number> = {};
  for (const k of keys) histogram[k] = (histogram[k] ?? 0) + 1;
  let dominantIndex: number | null = null;
  let dominantCount = 0;
  for (const [k, n] of Object.entries(histogram)) {
    if (n > dominantCount) {
      dominantCount = n;
      dominantIndex = Number(k);
    }
  }
  const dominantShare = keys.length ? dominantCount / keys.length : 0;
  return {
    pack,
    quizzes: keys.length,
    histogram,
    dominantIndex,
    dominantShare,
    degenerate: keys.length >= options.minQuizzes && dominantShare > options.maxShare,
  };
}

/** The seed quest packs under <seedDir>/quests (each <repo>/items.json). */
export function questPackRows(seedDir: string, options: AnswerPositionOptions = DEFAULT_ANSWER_POSITION_OPTIONS): AnswerPositionRow[] {
  const dir = join(seedDir, 'quests');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'items.json')))
    .map((e) => e.name)
    .sort()
    .map((repo) => {
      const doc = JSON.parse(readFileSync(join(dir, repo, 'items.json'), 'utf8')) as { items?: { kind?: string; check?: unknown }[] };
      const keys = (doc.items ?? []).filter((i) => i.kind === 'quiz').flatMap((i) => (isChoiceCheck(i.check) ? [i.check.answerKey] : []));
      return answerPositionRow(`quests/${repo}`, keys, options);
    });
}

/** The code packs under <packsDir> (each <source>/*.json course file, manifest excluded), one row per source. */
export function codePackRows(packsDir: string, options: AnswerPositionOptions = DEFAULT_ANSWER_POSITION_OPTIONS): AnswerPositionRow[] {
  if (!existsSync(packsDir)) return [];
  return readdirSync(packsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(packsDir, e.name, 'manifest.json')))
    .map((e) => e.name)
    .sort()
    .map((source) => {
      const files = readdirSync(join(packsDir, source))
        .filter((f) => f.endsWith('.json') && !['manifest.json', 'quarantine.json', 'validation.json', 'review-queue.json'].includes(f))
        .sort();
      const keys = files.flatMap((f) => {
        const doc = JSON.parse(readFileSync(join(packsDir, source, f), 'utf8')) as { units?: unknown };
        return choiceAnswerKeys(doc.units ?? []);
      });
      return answerPositionRow(`packs/${source}`, keys, options);
    });
}

export function answerPositionReport(paths: { seedDir: string; packsDir?: string }, options: AnswerPositionOptions = DEFAULT_ANSWER_POSITION_OPTIONS): AnswerPositionReport {
  const rows = [...questPackRows(paths.seedDir, options), ...(paths.packsDir ? codePackRows(paths.packsDir, options) : [])];
  return { rows, offenders: rows.filter((r) => r.degenerate), options };
}

export function formatAnswerPositionReport(report: AnswerPositionReport, opts: { all?: boolean } = {}): string[] {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const fmt = (r: AnswerPositionRow) => {
    const hist = Object.entries(r.histogram)
      .map(([k, n]) => `${k}:${n}`)
      .join(' ');
    return `${r.degenerate ? 'DEGENERATE' : 'ok        '}  ${r.pack.padEnd(46)} ${String(r.quizzes).padStart(4)} quizzes  top ${r.dominantIndex ?? '-'} @ ${pct(r.dominantShare).padStart(4)}  [${hist}]`;
  };
  const shown = opts.all ? report.rows : report.offenders;
  const lines = [
    `seed:lint:answers — choice-graded quiz key positions (degenerate: > ${pct(report.options.maxShare)} at one index with >= ${report.options.minQuizzes} quizzes)`,
    ...shown.map(fmt),
    `${report.rows.length} pack(s) scanned, ${report.offenders.length} degenerate` +
      (report.offenders.length
        ? ' — the server hides positions at serve time (choice-order.ts), but re-seed these packs with balanced key positions'
        : ''),
    `RESULT ${report.offenders.length ? 'DEGENERATE' : 'OK'}`,
  ];
  return lines;
}
