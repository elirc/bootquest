// npm run seed:lint:answers [-- --all] [--max-share 0.7] [--min-quizzes 6] [--seed-dir <dir>] [--packs-dir <dir>]
// ui-audit #24: report quest packs (and code packs) whose choice-quiz answer keys pile up at one
// index. Read-only (no stamps touched). Exit 0 = none degenerate, 1 = degenerate pack(s) found,
// 2 = usage error.
import { resolve } from 'node:path';
import { DEFAULT_SEED_DIR, parseArgs, REPO_ROOT } from '../factory/report.ts';
import { answerPositionReport, DEFAULT_ANSWER_POSITION_OPTIONS, formatAnswerPositionReport } from './answer-positions.ts';

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
process.exit(report.offenders.length ? 1 : 0);
