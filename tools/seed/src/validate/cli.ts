// npm run seed:validate [-- --source <bootforge|csbootcamp>] [--course <id>]
//                           [--pack <dir>] [--journal <file>]
//                           [--concurrency <n>] [--retry-failed] [--fresh]
// --source picks content/packs/<source> (default bootforge); --pack overrides it.
// Each source has its own journal (.seed-journal/<source>.jsonl), stamp and
// grader fingerprint (js | csharp, from the manifest track).
// Per-course foreground runs are the intended use on this laptop (10-minute
// shell cap, memory reaper): the journal makes every run resumable, and a final
// run without --course re-checks everything from the journal (fast) and asserts
// the full counts. Exit 0 only when every assertion holds. Only that clean
// full run writes the validation.json stamp the server's pack loader requires
// (and re-executes a random 2% / min-20 sample of journaled passes first).
import { basename, join, resolve } from 'node:path';
import { DEFAULT_OUT_DIR } from '../bootforge/import.ts';
import { pruneStaleQuarantine } from './prune.ts';
import { DEFAULT_JOURNAL_DIR, formatCounts, QUARANTINE_CEILING, runValidate, shutdownValidatorRunners, validatorCsharpScratch } from './validate.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<number> {
  const source = arg('source');
  if (source !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(source)) throw new Error('--source must be a pack name, e.g. bootforge or csbootcamp');
  const packDir = resolve(arg('pack') ?? (source ? join(DEFAULT_OUT_DIR, '..', source) : DEFAULT_OUT_DIR));
  const journalPath = resolve(arg('journal') ?? join(DEFAULT_JOURNAL_DIR, `${basename(packDir)}.jsonl`));
  const concurrencyRaw = arg('concurrency');
  const concurrency = concurrencyRaw === undefined ? 4 : Number(concurrencyRaw);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('--concurrency must be an integer 1-16');
  const course = arg('course');
  const started = Date.now();
  console.log(`[seed:validate] pack ${packDir}`);
  console.log(`[seed:validate] journal ${journalPath}`);
  console.log(`[seed:validate] scope ${course ?? 'all courses'}, concurrency ${concurrency}`);

  // fix 4: quarantine entries for courses the manifest no longer lists would otherwise
  // never be in any run's scope again (writeQuarantine keeps out-of-scope entries) and
  // would stay bound into every stamp — prune them before validating
  pruneStaleQuarantine(packDir, (l) => console.log(`[seed:validate] ${l}`));

  let report;
  try {
    report = await runValidate({
      packDir,
      journalPath,
      concurrency,
      ...(course !== undefined ? { course } : {}),
      retryFailed: flag('retry-failed'),
      fresh: flag('fresh'),
      log: (l) => console.log(l),
    });
  } finally {
    // stops the C# compiler server + any dotnet child the validator started
    await shutdownValidatorRunners();
  }
  console.log(`[seed:validate] grader ${report.graderKind ?? '?'}${report.graderKind === 'csharp' ? ` (scratch ${validatorCsharpScratch()})` : ''}`);

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
  if (!course) console.log(`AUDIT re-executed ${report.audit.sampled} journaled pass(es), ${report.audit.mismatches.length} mismatch(es)`);
  for (const p of report.problems) console.log(`PROBLEM ${p}`);
  console.log(
    report.stampPath
      ? `STAMP written ${report.stampPath}`
      : `STAMP none (${course ? 'a --course run never stamps; finish with a full run' : 'run failed'}): the server will refuse this pack`,
  );
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
