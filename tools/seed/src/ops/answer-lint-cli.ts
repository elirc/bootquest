// npm run seed:lint:answers [-- --all] [--max-share 0.7] [--min-quizzes 6] [--seed-dir <dir>] [--packs-dir <dir>] [--fund-dir <dir>]
//   [--length-max-share 0.4] [--length-min-items 10] [--length-baseline <file>]
// ui-audit #24: report quest packs (and code packs) whose choice-quiz answer keys pile up at one
// index, and (campaign 2 review F5, explanation-lint.ts) quiz explanations that are generator
// label artifacts, and (f52 C2, answer-length.ts) packs / Fundamentals tracks whose key is usually the single
// longest or shortest choice (shrink-only answer-length-baseline.json). Read-only (no stamps touched). Exit 0 = clean, 1 = degenerate pack(s), an
// artifact explanation outside EXPLANATION_LINT_EXEMPT or a stale exemption; 2 = usage error.
import { resolve } from 'node:path';
import { DEFAULT_SEED_DIR, parseArgs, REPO_ROOT } from '../factory/report.ts';
import { explanationLintFails, explanationLintReport, formatExplanationLintReport } from './explanation-lint.ts';
import { answerPositionReport, DEFAULT_ANSWER_POSITION_OPTIONS, formatAnswerPositionReport } from './answer-positions.ts';
import {
  answerLengthFails,
  answerLengthReport,
  codePackLengthRows,
  DEFAULT_ANSWER_LENGTH_BASELINE,
  DEFAULT_ANSWER_LENGTH_OPTIONS,
  formatAnswerLengthReport,
  fundamentalsLengthRows,
  questLengthRows,
  readAnswerLengthBaseline,
} from './answer-length.ts';

const { opts, flags } = parseArgs(process.argv.slice(2));
const num = (name: string, fallback: number): number => {
  const raw = opts.get(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`seed:lint:answers: --${name} must be a positive number (got "${raw}")`);
    process.exit(2);
  }
  return n;
};
const options = {
  maxShare: num('max-share', DEFAULT_ANSWER_POSITION_OPTIONS.maxShare),
  minQuizzes: num('min-quizzes', DEFAULT_ANSWER_POSITION_OPTIONS.minQuizzes),
};
const report = answerPositionReport(
  {
    seedDir: resolve(opts.get('seed-dir') ?? DEFAULT_SEED_DIR),
    packsDir: resolve(opts.get('packs-dir') ?? resolve(REPO_ROOT, 'content', 'packs')),
  },
  options,
);
for (const line of formatAnswerPositionReport(report, { all: flags.has('all') })) console.log(line);
const seedDir = resolve(opts.get('seed-dir') ?? DEFAULT_SEED_DIR);
const expl = explanationLintReport(seedDir);
for (const line of formatExplanationLintReport(expl)) console.log(line);
// f52 C2: answer-key length bias (quest packs, code packs, Fundamentals tracks)
const lengthOptions = {
  maxShare: num('length-max-share', DEFAULT_ANSWER_LENGTH_OPTIONS.maxShare),
  minItems: num('length-min-items', DEFAULT_ANSWER_LENGTH_OPTIONS.minItems),
};
const packsDir = resolve(opts.get('packs-dir') ?? resolve(REPO_ROOT, 'content', 'packs'));
const fundDir = resolve(opts.get('fund-dir') ?? resolve(REPO_ROOT, 'content', 'fundamentals'));
const lengthRows = [...questLengthRows(seedDir, lengthOptions), ...codePackLengthRows(packsDir, lengthOptions), ...fundamentalsLengthRows(fundDir, lengthOptions)];
const lengthReport = answerLengthReport(lengthRows, readAnswerLengthBaseline(resolve(opts.get('length-baseline') ?? DEFAULT_ANSWER_LENGTH_BASELINE)), lengthOptions);
for (const line of formatAnswerLengthReport(lengthReport, { all: flags.has('all') })) console.log(line);
process.exit(report.offenders.length || explanationLintFails(expl) || answerLengthFails(lengthReport) ? 1 : 0);
