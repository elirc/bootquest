// npm run seed:variants -- <draft.json> [--checkout <dir>] [--out <dir>]
// Changed-example retest tasks for one unit. Every item goes through the
// wrong-solution filter under the REAL runner (drill-js grade adapter): the test
// must PASS the reference and FAIL the deliberately wrong solution, else the
// item is discarded with its reason. No execution = no emission. drill-cs items run
// through the warm C# runner (.cache/factory-csharp), drill-java items through the
// Java runner (.cache/factory-java); both are shut down before exit.
import { withFactoryHarness } from '../harness/harness.ts';
import { finish, parseArgs } from '../report.ts';
import { runVariants } from './run.ts';

finish('seed:variants', async () => {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const draft = positional[0];
  if (!draft) throw new Error('usage: seed:variants <draft.json> [--checkout <dir>] [--out <dir>]');
  return withFactoryHarness((harness) =>
    runVariants({
      draft,
      harness,
      ...(opts.has('checkout') ? { checkout: opts.get('checkout')! } : {}),
      ...(opts.has('out') ? { out: opts.get('out')! } : {}),
      ...(opts.has('exclusions') ? { exclusionsPath: opts.get('exclusions')! } : {}),
    }),
  );
});
