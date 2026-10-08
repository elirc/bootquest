// npm run seed:validate [-- --course <id>] [--pack <dir>] [--journal <file>]
//                           [--concurrency <n>] [--retry-failed] [--fresh]
// Per-course foreground runs are the intended use on this laptop (10-minute
// shell cap, memory reaper): the journal makes every run resumable, and a final
// run without --course re-checks everything from the journal (fast) and asserts
// the full counts. Exit 0 only when every assertion holds.
import { basename, join, resolve } from 'node:path';
import { DEFAULT_OUT_DIR } from '../bootforge/import.ts';
import { DEFAULT_JOURNAL_DIR, formatCounts, QUARANTINE_CEILING, runValidate } from './validate.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<number> {
  const packDir = resolve(arg('pack') ?? DEFAULT_OUT_DIR);
  const journalPath = resolve(arg('journal') ?? join(DEFAULT_JOURNAL_DIR, `${basename(packDir)}.jsonl`));
  const concurrencyRaw = arg('concurrency');
  const concurrency = concurrencyRaw === undefined ? 4 : Number(concurrencyRaw);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('--concurrency must be an integer 1-16');
  const course = arg('course');
  const started = Date.now();
  console.log(`[seed:validate] pack ${packDir}`);
  console.log(`[seed:validate] journal ${journalPath}`);
  console.log(`[seed:validate] scope ${course ?? 'all courses'}, concurrency ${concurrency}`);

  const report = await runValidate({
    packDir,
    journalPath,
    concurrency,
    ...(course !== undefined ? { course } : {}),
    retryFailed: flag('retry-failed'),
    fresh: flag('fresh'),
    log: (l) => console.log(l),
  });

  console.log('');
  for (const c of report.courses) {
    console.log(
      `  ${c.id.padEnd(22)} pass ${String(c.passed).padStart(4)}  quarantined ${c.failed}  carve-out ${c.carveOut}  ` +
        `(ran ${c.executedNow}, resumed ${c.resumed})  validated ${c.validated.total}/${c.pack?.total ?? '?'}`,
    );
  }
  const t = report.totals;
  console.log('');
  console.log(`COUNTS importer  ${formatCounts(t.importer)}`);
  console.log(`COUNTS pack      ${formatCounts(t.pack)}`);
  console.log(`COUNTS validated ${formatCounts(t.validated)}`);
  if (!course && report.expected) console.log(`COUNTS expected  ${formatCounts(report.expected)}`);
  console.log(`executable ${report.executable}, written carve-out ${report.carveOut} (schema-validated, no check), quarantined ${report.quarantined.length} (ceiling ${QUARANTINE_CEILING * 100}%)`);
  for (const q of report.quarantined) console.log(`  QUARANTINED ${q.key} [${q.type}]: ${q.reason}`);
  if (report.journalSkippedLines) console.log(`journal: skipped ${report.journalSkippedLines} torn/invalid line(s)`);
  for (const p of report.problems) console.log(`PROBLEM ${p}`);
  console.log(`RESULT ${report.ok ? 'OK' : 'FAIL'} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return report.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[seed:validate] CRASHED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  },
);
